// Phase 8d Task 4: the drain, the backoff, and the second cron (K22).
//
// Task 3's `fireWebhooks` attempts `attempt.submitted` once, inline, and
// writes a `webhook_delivery` row for anything that did not deliver —
// `attempt.started` and `test.closed` land there unconditionally, and so
// does every hook past `INLINE_FANOUT_LIMIT`. This module is what makes
// those rows real: a `ScheduledJob` that runs every five minutes, retries
// what is due, and reuses `tryDeliver`/`deliveryRawBody` from `deliver.ts`
// rather than a second delivery implementation — two paths signing and
// sending the same bytes two different ways is how they drift apart.
//
// The one rule this file exists to enforce (the task's own words): **a row
// retried past 24 hours must terminate.** Exponential backoff that keeps
// growing but never stops trying turns one permanently broken endpoint
// into a standing cost on every tick, forever. `MAX_RETRY_WINDOW_MS` bounds
// that — past it, a failing row is marked "gave up" and its
// `next_attempt_at` is pushed to `NEVER_AGAIN`, a sentinel this table has
// no boolean column for but the drain's own `WHERE next_attempt_at <= ?`
// filter already honours. No new column, no migration — 7e holds `0010`
// and `0011` on another branch, and this task was told to stop and ask
// rather than add one. The terminal state is visible in `last_error`
// ("gave up after 24h: …") rather than silent.

import type { WebhookEvent } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import type { ScheduledJob } from "../scheduled.js";
import { deliveryRawBody, tryDeliver, type Attempt } from "./deliver.js";

/** First retry one minute out, doubling every failure after that. Small
 *  enough that a receiver back up for a minute does not miss its own
 *  recovery window, and `MAX_RETRY_WINDOW_MS` is what actually bounds the
 *  total retry period — this constant only shapes the curve inside it. */
const BACKOFF_BASE_MS = 60_000;

/** `K22`: retries stop after 24 hours, measured from when the row was
 *  created (the first failed attempt, inline or queued) — not from the
 *  most recent retry, so a row cannot refresh its own deadline by failing
 *  on schedule forever. */
const MAX_RETRY_WINDOW_MS = 24 * 3600_000;

/** A `next_attempt_at` no real clock reaches, placed once a row has given
 *  up. `Number.MAX_SAFE_INTEGER` rather than `Infinity`: this value is
 *  bound as a SQL parameter and must round-trip through three dialects as
 *  an integer, and better-sqlite3 throws on reading back anything past
 *  this exact number (no `safeIntegers` mode here — see `client.ts`). */
const NEVER_AGAIN = Number.MAX_SAFE_INTEGER;

/**
 * The most due deliveries one tick will ever attempt. The arithmetic
 * (Review Focus item 5, the 50-subrequest ceiling):
 *
 * - One `SELECT … JOIN webhook …` for the due rows **and** the secrets
 *   needed to sign them, in a single query — no second lookup "by id IN
 *   (…)", so there is no 100-bound-parameter list to chunk here at all.
 * - One `fetch` per row attempted, sequentially — at most
 *   `DRAIN_BATCH_LIMIT`.
 * - One `db.batch()` for every row's outcome, win or lose — one
 *   subrequest regardless of how many statements it carries (the same
 *   rule `queueWebhookDeliveries` and `writeImportedBank` already follow).
 *
 * Worst case: `2 + DRAIN_BATCH_LIMIT` subrequests. At 20 that is 22,
 * comfortably under 50 even with real headroom to spare — a backlog past
 * this bound simply waits for the next tick, five minutes later, rather
 * than growing this tick's cost.
 */
export const DRAIN_BATCH_LIMIT = 20;

interface DueRow {
  id: string;
  workspace_id: string;
  webhook_id: string;
  event: string;
  payload_json: unknown;
  attempt_count: number;
  created_at: number;
  url: string;
  signing_secret: string;
}

/** Decided once per row, after the one delivery attempt it gets this
 *  tick — never logs `rawBody`, `url` or the secret (`KG5`): only ids,
 *  status codes and the error's own name ever reach `last_error`. */
function nextState(row: DueRow, now: number, attempt: Attempt): { sql: string; params: unknown[] } {
  const attemptCount = row.attempt_count + 1;

  if (attempt.ok) {
    return {
      sql:
        "UPDATE webhook_delivery SET attempt_count = ?, last_status = ?, last_error = NULL, delivered_at = ? " +
        "WHERE id = ?",
      params: [attemptCount, attempt.status, now, row.id],
    };
  }

  const age = now - row.created_at;
  if (age >= MAX_RETRY_WINDOW_MS) {
    const reason = attempt.error ?? (attempt.status !== null ? `http ${attempt.status}` : "unknown error");
    return {
      sql:
        "UPDATE webhook_delivery SET attempt_count = ?, last_status = ?, last_error = ?, next_attempt_at = ? " +
        "WHERE id = ?",
      params: [attemptCount, attempt.status, `gave up after 24h: ${reason}`, NEVER_AGAIN, row.id],
    };
  }

  const delay = BACKOFF_BASE_MS * 2 ** (attemptCount - 1);
  return {
    sql:
      "UPDATE webhook_delivery SET attempt_count = ?, last_status = ?, last_error = ?, next_attempt_at = ? " +
      "WHERE id = ?",
    params: [attemptCount, attempt.status, attempt.error, now + delay, row.id],
  };
}

async function drain(deps: AppDeps): Promise<{ summary: string }> {
  const now = deps.now();
  const http = deps.http ?? globalThis.fetch;

  const due = await deps.db.query<DueRow>(
    "SELECT wd.id, wd.workspace_id, wd.webhook_id, wd.event, wd.payload_json, wd.attempt_count, " +
      "wd.created_at, w.url, w.signing_secret " +
      "FROM webhook_delivery wd JOIN webhook w ON w.id = wd.webhook_id " +
      "WHERE wd.delivered_at IS NULL AND wd.next_attempt_at <= ? " +
      "ORDER BY wd.next_attempt_at ASC LIMIT ?",
    [now, DRAIN_BATCH_LIMIT],
  );

  if (due.length === 0) return { summary: "drained 0 of 0 due deliveries" };

  const nowSeconds = Math.floor(now / 1000);
  let delivered = 0;
  const writes: { sql: string; params: unknown[] }[] = [];

  for (const row of due) {
    const payload = deps.db.jsonValue(row.payload_json);
    const rawBody = deliveryRawBody(row.event as WebhookEvent, payload);
    const attempt = await tryDeliver(http, row.url, rawBody, row.signing_secret, nowSeconds);
    if (attempt.ok) delivered++;
    writes.push(nextState(row, now, attempt));
  }

  await deps.db.batch(writes);

  return { summary: `drained ${String(delivered)} of ${String(due.length)} due deliveries` };
}

export const webhookDrainJob: ScheduledJob = {
  name: "webhook-drain",
  cron: "*/5 * * * *",
  run: drain,
};
