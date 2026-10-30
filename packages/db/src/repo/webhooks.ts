// Webhook endpoints: CRUD, and the secret shown once (Phase 8d Task 1,
// `K35`, `K36`, `KG5`).

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { urlRefusal } from "../net.js";
import { scoped } from "./guard.js";

// `K43`: "attempt.flagged" is NOT a member of `WEBHOOK_EVENTS`. Its only
// trigger is 8g's integrity recompute and 8g is deferred whole with 7e — an
// event a selector offers but nothing can ever fire is the `Q1b` defect. It
// returns with 8g, as one more member here plus its caller.
//
// MAJOR-3 (whole-branch review): "attempt.started" was the identical defect,
// shipped rather than caught — offered in this set, in the web mirror and
// in the UI's event checklist, with `deliver.ts`'s header carrying a whole
// paragraph of design rationale for a caller that never existed.
// `fireWebhooks` had exactly two production call sites (`attempt.submitted`
// from the submit route, `test.closed` from the close route) and
// "attempt.started" was not one of them — an organiser who ticked it would
// never see a delivery, with no error and no empty-state hint. Dropped,
// the way `attempt.flagged` already was and for the identical reason; it
// returns with its first real caller. The delivery machinery (Task 3) is
// event-agnostic and needs no change for either.
export const WEBHOOK_EVENTS = ["attempt.submitted", "test.closed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const WEBHOOK_EVENT_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);

/**
 * The organiser-facing shape. **Never `signingSecret`** (`KG5`) — the
 * column exists so deliveries can be signed, but once creation has
 * answered it the only reader for the rest of this row's life is
 * `listActiveWebhooksForEvent`, below, which Task 3's delivery machinery
 * calls directly and no route ever serialises.
 */
export interface WebhookRow {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: number;
}

interface WebhookRecord {
  id: string;
  url: string;
  events_json: unknown;
  active: unknown;
  created_at: number;
}

const WEBHOOK_COLUMNS = "id, url, events_json, active, created_at";

function toWebhookRow(db: DbClient, row: WebhookRecord): WebhookRow {
  return {
    id: row.id,
    url: row.url,
    events: db.jsonValue<WebhookEvent[]>(row.events_json),
    active: Boolean(row.active),
    createdAt: Number(row.created_at),
  };
}

/** `whsec_` plus 32 random bytes, hex — the same `crypto.getRandomValues`
 * source `ids.ts`'s `newId` draws from, not a second RNG. Not an
 * `IdPrefix` (`ids.ts`): this is a bearer secret handed to the organiser
 * once, never a row this database addresses by it. */
function generateSigningSecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `whsec_${hex}`;
}

/**
 * Creates the webhook and returns its signing secret — the one and only
 * time this database hands it back (`KG5`). `listWebhooks` below reads the
 * same row and never includes it.
 *
 * Refuses two ways, both before the row is written: an event outside the
 * closed `WEBHOOK_EVENTS` set (a stale client, or one that invented its
 * own), and a URL `urlRefusal` (`../net.js`, T-19's rules) would refuse to
 * fetch — the same hazard `check_reachable` exists for: an organiser-
 * supplied URL this Worker itself will fetch, repeatedly, carrying a
 * signing secret in its headers.
 */
export const createWebhook = scoped(
  "createWebhook",
  async (
    db: DbClient,
    workspaceId: string,
    input: { url: string; events: readonly WebhookEvent[]; now: number },
  ): Promise<{ webhookId: string; signingSecret: string }> => {
    for (const event of input.events) {
      if (!WEBHOOK_EVENT_SET.has(event)) {
        throw new Error(`createWebhook: "${event}" is not a webhook event.`);
      }
    }
    const refused = urlRefusal(input.url);
    if (refused !== null) {
      throw new Error(`createWebhook: ${refused}.`);
    }

    const id = newId("whk");
    const signingSecret = generateSigningSecret();
    const { changes } = await db.run(
      "INSERT INTO webhook (id, workspace_id, url, events_json, signing_secret, active, created_at) " +
        "SELECT ?, ?, ?, ?, ?, true, ? WHERE NOT EXISTS (" +
        "SELECT 1 FROM workspace WHERE id = ? AND (" +
        "slug LIKE 'demo-%' OR " +
        "settings_json LIKE '%\"is_demo\":true%' OR " +
        "settings_json LIKE '%\"is_demo\": true%'" +
        ")" +
        ")",
      [id, workspaceId, input.url, db.jsonParam(input.events), signingSecret, input.now, workspaceId],
    );

    if (changes === 0) {
      throw new Error("Demo workspaces cannot register webhooks.");
    }

    return { webhookId: id, signingSecret };
  },
);

/** Every webhook in the workspace, active or not — the organiser's own
 * list. Never `signingSecret` (`KG5`). */
export const listWebhooks = scoped(
  "listWebhooks",
  async (db: DbClient, workspaceId: string): Promise<WebhookRow[]> => {
    const rows = await db.query<WebhookRecord>(
      `SELECT ${WEBHOOK_COLUMNS} FROM webhook WHERE workspace_id = ? ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map((row) => toWebhookRow(db, row));
  },
);

/** Sentinel value for deliveries belonging to a paused webhook (#231).
 * Excludes pending deliveries from the drain query range (`next_attempt_at <= ?`)
 * without creating a separate column or migration. Distinct from `NEVER_AGAIN`
 * (`Number.MAX_SAFE_INTEGER`), allowing give-up rows to remain untouched when resumed. */
export const PAUSED_SENTINEL = Number.MAX_SAFE_INTEGER - 1;

/** Toggles delivery on or off without touching the URL, the events or the
 * secret — the organiser's pause button, not a re-creation. Throws when no
 * such webhook exists in this workspace, which the route turns into its
 * own 404 (the same "existence is not disclosed across a workspace
 * boundary" shape `setTestStatus`'s callers already follow). */
export const setWebhookActive = scoped(
  "setWebhookActive",
  async (db: DbClient, workspaceId: string, webhookId: string, active: boolean, now: number = Date.now()): Promise<void> => {
    const stmts: { sql: string; params?: unknown[] }[] = [
      {
        sql: "UPDATE webhook SET active = ? WHERE workspace_id = ? AND id = ?",
        params: [db.dialect === "pg" ? active : (active ? 1 : 0), workspaceId, webhookId],
      },
    ];
    if (!active) {
      stmts.push({
        sql: "UPDATE webhook_delivery SET next_attempt_at = ? WHERE workspace_id = ? AND webhook_id = ? AND delivered_at IS NULL AND next_attempt_at < ?",
        params: [PAUSED_SENTINEL, workspaceId, webhookId, PAUSED_SENTINEL],
      });
    } else {
      stmts.push({
        sql: "UPDATE webhook_delivery SET next_attempt_at = ? WHERE workspace_id = ? AND webhook_id = ? AND delivered_at IS NULL AND next_attempt_at = ?",
        params: [now, workspaceId, webhookId, PAUSED_SENTINEL],
      });
    }
    const results = await db.batch(stmts);
    if (results[0]!.changes === 0) throw new Error("setWebhookActive: no such webhook in this workspace.");
  },
);

/** Revokes the endpoint outright, and retires its queued rows in the same
 * `db.batch()` call (one subrequest, `K23`'s own rule — `queueWebhookDeliveries`
 * follows it too).
 *
 * MINOR-5 (whole-branch review): this used to leave `webhook_delivery`
 * rows queued for the webhook exactly as they were. The drain's `JOIN
 * webhook` is an INNER join and `0009` declares no foreign key, so those
 * rows became invisible the moment the `webhook` row was gone — never
 * delivered, never marked, never cleaned, just unbounded storage on a
 * metered account. Deleting them here is the direct fix; not attempted is
 * not the same as cleaned up. */
export const deleteWebhook = scoped(
  "deleteWebhook",
  async (db: DbClient, workspaceId: string, webhookId: string): Promise<void> => {
    const results = await db.batch([
      { sql: "DELETE FROM webhook WHERE workspace_id = ? AND id = ?", params: [workspaceId, webhookId] },
      {
        sql: "DELETE FROM webhook_delivery WHERE workspace_id = ? AND webhook_id = ?",
        params: [workspaceId, webhookId],
      },
    ]);
    if (results[0]!.changes === 0) throw new Error("deleteWebhook: no such webhook in this workspace.");
  },
);

/** The delivery machinery's own shape — carries `signingSecret` because
 * signing the payload is the only reason this read exists. Nothing in
 * `apps/api/src/routes` may call this (`KG5`'s scan asserts it): the one
 * caller this function has is Task 3's drain queue, not an HTTP response. */
export interface DeliverableWebhook {
  id: string;
  url: string;
  signingSecret: string;
}

/**
 * Task 3's read: every **active** webhook in `workspaceId` subscribed to
 * `event` — what fans one candidate event out to deliveries. Filtered in
 * application code rather than a dialect-specific JSON operator
 * (`events_json @> '...'` on Postgres has no SQLite equivalent, and a
 * workspace's webhook count is small enough that this never costs more
 * than one statement plus an in-memory filter over a handful of rows).
 */
export const listActiveWebhooksForEvent = scoped(
  "listActiveWebhooksForEvent",
  async (db: DbClient, workspaceId: string, event: WebhookEvent): Promise<DeliverableWebhook[]> => {
    const rows = await db.query<{ id: string; url: string; signing_secret: string; events_json: unknown }>(
      "SELECT id, url, signing_secret, events_json FROM webhook WHERE workspace_id = ? AND active",
      [workspaceId],
    );
    return rows
      .filter((row) => db.jsonValue<WebhookEvent[]>(row.events_json).includes(event))
      .map((row) => ({ id: row.id, url: row.url, signingSecret: row.signing_secret }));
  },
);

/** One `webhook_delivery` row, as `queueWebhookDeliveries` writes it.
 *  `attemptCount`/`lastStatus`/`lastError` are the caller's own record of
 *  what just happened — `0` and two `null`s for a hook that was never
 *  tried at all (`attempt.started`/`test.closed`, `K37`/`K43`, and any
 *  hook past Task 3's `INLINE_FANOUT_LIMIT`, fix round 1 `F1`), and `1`
 *  plus whatever the one inline try came back with for a hook that was. */
export interface QueuedWebhookDelivery {
  webhookId: string;
  event: WebhookEvent;
  payload: unknown;
  attemptCount: number;
  lastStatus: number | null;
  lastError: string | null;
  now: number;
}

/**
 * Task 3's write: one `webhook_delivery` row per entry for Task 4's drain
 * to pick up off `webhook_delivery_next_attempt_idx`. Never the signing
 * secret (`KG5`): nothing here reads `signing_secret` at all.
 *
 * **One `db.batch()` call, not one `INSERT` per row** (fix round 1, F1) —
 * the same rule `writeImportedBank` (`banks.ts`) already follows: N
 * single-row writes cost ~N subrequests, one `batch()` costs one no
 * matter how big N gets. This is what keeps an organiser's own webhook
 * count from being able to grow the candidate's submit request's
 * subrequest cost — `deliver.ts`'s `INLINE_FANOUT_LIMIT` bounds the
 * `fetch` side of that same problem, this bounds the write side. A no-op,
 * not an empty `batch()` call, when there is nothing to queue.
 */
export const queueWebhookDeliveries = scoped(
  "queueWebhookDeliveries",
  async (db: DbClient, workspaceId: string, rows: readonly QueuedWebhookDelivery[]): Promise<void> => {
    if (rows.length === 0) return;
    await db.batch(
      rows.map((row) => ({
        sql:
          "INSERT INTO webhook_delivery " +
          "(id, workspace_id, webhook_id, event, payload_json, attempt_count, next_attempt_at, last_status, last_error, delivered_at, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params: [
          newId("whd"),
          workspaceId,
          row.webhookId,
          row.event,
          db.jsonParam(row.payload),
          row.attemptCount,
          // Ready for the drain the moment it exists — Task 4 owns
          // backoff, not this write.
          row.now,
          row.lastStatus,
          row.lastError,
          null,
          row.now,
        ],
      })),
    );
  },
);
