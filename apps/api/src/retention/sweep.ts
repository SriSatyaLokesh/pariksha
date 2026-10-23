// K27's nightly cron, S-13 / AC-24: two independent jobs.
//
// `retentionJob` expires `snapshot` rows (and their R2 objects) past each
// test's `snapshots_days`, and `response` rows past each test's
// `personal_data_days` — both resolved per test through `resolveRetention`
// (8a), which is also where the K28 defaults (90 / 365 days) live, so a test
// with no `retention` block never reads as "zero days" here.
//
// `rateLimitJob` is the scheduled caller `sweepRateLimits` (Phase 6,
// packages/db/src/repo/rate-limit.ts) never had — `limitOrThrow` already
// calls it opportunistically on `email_code_address` hits, but that only
// sweeps when that one bucket is used; this is the guarantee that runs
// regardless of traffic.

import { resolveRetention, type TestRetention } from "@pariksha/core";
import { appendAudit, sweepRateLimits, type DbClient } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import type { ScheduledJob } from "../scheduled.js";
import { MAX_WINDOW_MS } from "../run/limit.js";

const DAY_MS = 86_400_000;
const CRON = "17 3 * * *";

/**
 * K30: bounded, not "everything expired" in one tick. The fetch stays one
 * SELECT regardless of size — one bound parameter (`LIMIT ?`), not one per
 * row — so 500 is sized to keep a D1 statement's own row budget
 * comfortable, not the Worker's 50-subrequest ceiling. The deletes derived
 * from it are a different constraint; see `DELETE_CHUNK`.
 */
export const RETENTION_BATCH = 500;

/**
 * Fix round 2, F3: Cloudflare's documented D1 limit is **100 bound
 * parameters per query**. A `DELETE … WHERE id IN (…)` binds one parameter
 * per id, so a `RETENTION_BATCH`-sized batch (500) overflows it — green on
 * `better-sqlite3`, which has no such cap, and red on the only database
 * that matters. `deleteChunked` below splits the id list into groups of at
 * most this many instead.
 *
 * **Deliberately not the same number as `RETENTION_BATCH`, and must stay
 * that way**: the two are different constraints on different statements
 * (one bound parameter for the fetch's `LIMIT`, one bound parameter per id
 * for a delete's `IN (…)`) that happen to both be sized in the hundreds.
 * Folding them into one constant would make a future reader's "simplify
 * this" correct-looking and wrong.
 */
export const DELETE_CHUNK = 100;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** Deletes `ids` from `table` in groups of `DELETE_CHUNK`, each its own
 *  statement — one `db.run` per chunk, so a 500-row batch costs up to 5
 *  subrequests here, not 1 and not 500. `table` is always one of this
 *  module's own two literals, never request input, so the interpolation
 *  below binds no value a candidate or an organiser ever supplied. */
async function deleteChunked(db: DbClient, table: "snapshot" | "response", ids: string[]): Promise<void> {
  for (const group of chunk(ids, DELETE_CHUNK)) {
    const placeholders = group.map(() => "?").join(", ");
    await db.run(`DELETE FROM ${table} WHERE id IN (${placeholders})`, group);
  }
}

interface Candidate {
  id: string;
  workspace_id: string;
  at: number;
  settings_json: unknown;
}

/** Reads each row's own test settings and keeps only the ones past
 *  `days`'s verdict — the per-row cutoff `resolveRetention` decides, never
 *  a single global one, because a test's override can be shorter *or*
 *  longer than the default in either direction. */
function expired<T extends Candidate>(
  db: DbClient,
  rows: T[],
  now: number,
  days: (resolved: ReturnType<typeof resolveRetention>) => number,
): T[] {
  return rows.filter((row) => {
    const settings = db.jsonValue<{ retention?: TestRetention }>(row.settings_json);
    return Number(row.at) <= now - days(resolveRetention(settings.retention)) * DAY_MS;
  });
}

/** Tallies a batch by workspace, for one audit row per workspace below. */
function tally(rows: Candidate[]): Map<string, number> {
  const byWorkspace = new Map<string, number>();
  for (const row of rows) {
    byWorkspace.set(row.workspace_id, (byWorkspace.get(row.workspace_id) ?? 0) + 1);
  }
  return byWorkspace;
}

interface SnapshotCandidate extends Candidate {
  storage_key: string;
}

/**
 * Deletes the object before the row (plan Step 3): the reverse leaves an
 * object nothing can ever find again, where this order only ever leaves a
 * row with no object — which the next tick's `storage.delete` no-ops on
 * (every adapter's `delete` is silent on an already-missing key) and then
 * cleans up by deleting the row anyway. That is what makes a run
 * interrupted between the two calls safe to just run again.
 *
 * ponytail: a test whose own override is longer than every other test's
 * lets its oldest-but-not-yet-expired rows occupy the front of this
 * `ORDER BY` and spend batch slots doing nothing, run after run. No
 * fixture here has that shape; if one in production ever does, the fix is
 * a per-row cutoff computed in SQL (or a covering index on the resolved
 * cutoff) rather than a filter applied after the fetch.
 */
async function sweepSnapshots(deps: AppDeps): Promise<{ deleted: number; byWorkspace: Map<string, number> }> {
  const rows = await deps.db.query<SnapshotCandidate>(
    "SELECT sn.id AS id, sn.workspace_id AS workspace_id, sn.taken_at AS at, sn.storage_key AS storage_key, " +
      "tv.settings_json AS settings_json " +
      "FROM snapshot sn " +
      "JOIN attempt a ON a.id = sn.attempt_id " +
      "JOIN test_version tv ON tv.id = a.test_version_id " +
      "ORDER BY sn.taken_at ASC LIMIT ?",
    [RETENTION_BATCH],
  );
  const due = expired(deps.db, rows, deps.now(), (r) => r.snapshotsDays);
  if (due.length === 0) return { deleted: 0, byWorkspace: new Map() };

  // Object first, row second — see the function above this one.
  await deps.storage.delete(due.map((row) => row.storage_key));

  await deleteChunked(deps.db, "snapshot", due.map((row) => row.id));

  return { deleted: due.length, byWorkspace: tally(due) };
}

async function sweepResponses(deps: AppDeps): Promise<{ deleted: number; byWorkspace: Map<string, number> }> {
  const rows = await deps.db.query<Candidate>(
    "SELECT r.id AS id, r.workspace_id AS workspace_id, r.saved_at AS at, tv.settings_json AS settings_json " +
      "FROM response r " +
      "JOIN attempt a ON a.id = r.attempt_id " +
      "JOIN test_version tv ON tv.id = a.test_version_id " +
      "ORDER BY r.saved_at ASC LIMIT ?",
    [RETENTION_BATCH],
  );
  const due = expired(deps.db, rows, deps.now(), (r) => r.personalDataDays);
  if (due.length === 0) return { deleted: 0, byWorkspace: new Map() };

  await deleteChunked(deps.db, "response", due.map((row) => row.id));

  return { deleted: due.length, byWorkspace: tally(due) };
}

export const retentionJob: ScheduledJob = {
  name: "retention.sweep",
  cron: CRON,
  run: async (deps) => {
    const snapshots = await sweepSnapshots(deps);
    const responses = await sweepResponses(deps);

    // One audit row per workspace this run actually touched (K30: "logs
    // what it did"), not one per deletion and not one unconditionally —
    // a run that found nothing expired has nothing to attribute a row to,
    // since `audit_log.workspace_id` is never null.
    const workspaces = new Set([...snapshots.byWorkspace.keys(), ...responses.byWorkspace.keys()]);
    for (const workspaceId of workspaces) {
      await appendAudit(deps.db, workspaceId, {
        actor: "system",
        action: "retention.sweep",
        target: "retention",
        detail: {
          snapshotsDeleted: snapshots.byWorkspace.get(workspaceId) ?? 0,
          responsesDeleted: responses.byWorkspace.get(workspaceId) ?? 0,
        },
        now: deps.now(),
      });
    }

    return {
      summary:
        `retention.sweep: deleted ${snapshots.deleted} snapshot(s) and ${responses.deleted} response(s) ` +
        `across ${workspaces.size} workspace(s), batch ${RETENTION_BATCH}`,
    };
  },
};

export const rateLimitJob: ScheduledJob = {
  name: "rate_limit.sweep",
  cron: CRON,
  run: async (deps) => {
    // `MAX_WINDOW_MS` (`run/limit.ts`): `before` must be older than every
    // kind's window, not just one, because one `DELETE` sees every bucket.
    const deleted = await sweepRateLimits(deps.db, deps.now() - MAX_WINDOW_MS);
    return { summary: `rate_limit.sweep: deleted ${deleted} row(s)` };
  },
};
