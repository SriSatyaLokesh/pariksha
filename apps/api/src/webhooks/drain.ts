// Phase 8d Task 4: the drain, the backoff, and the second cron (K22).
//
// Task 3's `fireWebhooks` attempts `attempt.submitted` once, inline, and
// writes a `webhook_delivery` row for anything that did not deliver —
// `test.closed` lands there unconditionally, and so does every hook past
// `INLINE_FANOUT_LIMIT`. This module is what makes
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
export const NEVER_AGAIN = Number.MAX_SAFE_INTEGER;

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
 *
 * Fix round 1, MINOR 2 — the wall-clock question, answered rather than
 * guessed: the Workers **Free plan has no duration limit at all** ("No
 * charge for duration," per Cloudflare's own docs), so 20 sequential
 * `fetch`es each waiting up to `DELIVERY_TIMEOUT_MS` is not a ceiling this
 * can breach — that wait is wall clock, not CPU, and the plan does not
 * meter wall clock. What the free plan *does* cap is **10 ms of CPU time
 * per invocation**, and this handler's only CPU cost is `DRAIN_BATCH_LIMIT`
 * HMAC-SHA256 signatures (`tryDeliver` → `signatureHeader`) over small
 * JSON bodies, plus the `JSON.stringify`/`jsonValue` work around them —
 * hashing a few hundred bytes is microseconds of actual CPU, not
 * milliseconds, so 20 of them stay nowhere near 10 ms even accounting for
 * `crypto.subtle`'s per-call overhead. `DRAIN_BATCH_LIMIT` is sized off
 * the subrequest ceiling above, not the CPU one, because the CPU one is
 * not the binding constraint here.
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
    // CRITICAL-1 (whole-branch review): a delivered row that keeps its old
    // `next_attempt_at` stays inside the due-row index range forever —
    // nothing else ever deletes a `webhook_delivery` row, so every row this
    // drain has ever delivered would be re-read by the `SELECT` on every
    // one of the 288 daily ticks. Measured on this schema: 50,000 delivered
    // rows left in range cost 5.67ms and a full index scan per tick; moved
    // to `NEVER_AGAIN`, the same tick costs 0.17ms. At ~20,000 accumulated
    // rows that is 5.76M **D1 rows read** per day against the Free plan's
    // 5M/day allowance — on a day with zero webhook traffic. `NEVER_AGAIN`
    // now means one thing uniformly: this row is finished, delivered or
    // not, and the drain's only reader of `next_attempt_at` never sees it
    // again either way.
    return {
      sql:
        "UPDATE webhook_delivery SET attempt_count = ?, last_status = ?, last_error = NULL, " +
        "delivered_at = ?, next_attempt_at = ? WHERE id = ?",
      params: [attemptCount, attempt.status, now, NEVER_AGAIN, row.id],
    };
  }

  // `attempt.error` is only ever set by `tryDeliver`'s own `catch` — a
  // thrown/aborted fetch. An ordinary non-2xx response leaves it `null`,
  // so without this fallback a ten-hour-old retry would carry a bare
  // `last_status` and no sentence anyone reading the row could act on.
  // Fix round 1, MINOR 1: this used to be computed only inside the
  // give-up branch below, so an ordinary retry wrote `last_error = NULL`.
  const reason = attempt.error ?? (attempt.status !== null ? `http ${attempt.status}` : "unknown error");

  const age = now - row.created_at;
  if (age >= MAX_RETRY_WINDOW_MS) {
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
    params: [attemptCount, attempt.status, reason, now + delay, row.id],
  };
}

async function drain(deps: AppDeps): Promise<{ summary: string }> {
  const now = deps.now();
  const http = deps.http ?? globalThis.fetch;

  const due = await deps.db.query<DueRow>(
    "SELECT wd.id, wd.workspace_id, wd.webhook_id, wd.event, wd.payload_json, wd.attempt_count, " +
      "wd.created_at, w.url, w.signing_secret " +
      "FROM webhook_delivery wd JOIN webhook w ON w.id = wd.webhook_id " +
      // MAJOR-2 (whole-branch review): the inline path only ever reads
      // through `listActiveWebhooksForEvent` (`active = 1`); this join had
      // no such filter, so Pause did nothing for a row already queued —
      // it kept being retried for up to 24h after the organiser paused it.
      // A paused row's age (from `created_at`) keeps advancing in real
      // time while it waits here, so a long pause does not store up a
      // burst on resume — it lets the 24h give-up deadline do its job.
      "WHERE w.active AND wd.delivered_at IS NULL AND wd.next_attempt_at <= ? " +
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
  // Merge note (phase-8b/phase-8e, `ScheduledJob.maxSubrequests`): 22 —
  // `2 + DRAIN_BATCH_LIMIT`, this file's own worst-case arithmetic above.
  maxSubrequests: 2 + DRAIN_BATCH_LIMIT,
  run: drain,
};
