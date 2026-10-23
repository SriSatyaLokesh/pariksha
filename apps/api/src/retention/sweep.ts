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

import { resolveRetention, RETENTION_DEFAULTS, type TestRetention } from "@pariksha/core";
import { appendAudit, sweepRateLimits, type DbClient } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import type { ScheduledJob } from "../scheduled.js";
import { MAX_WINDOW_MS } from "../run/limit.js";
import { deleteCandidates } from "./candidate.js";

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

/**
 * AC-24: how many due candidates one tick erases. Far smaller than
 * `RETENTION_BATCH`, and deliberately so — `sweepSnapshots`'s (and the
 * retired `sweepResponses`'s) audit cost is one row per *workspace*
 * touched, so a 500-row batch spread over any number of workspaces still
 * costs a handful of subrequests. `deleteCandidates` (Task 2, K29/KG9)
 * writes one `candidate.delete` audit row per *candidate* — "which of
 * these was erased" has to be answerable from the log alone — so that
 * cost is **per row**, and the adversarial case (one due candidate per
 * workspace, each with an attempt and a surviving snapshot) is also one
 * full `deleteCandidates` call — attempt select, snapshot select,
 * `storage.delete`, one `db.batch`, one audit row — per candidate. See
 * "stays inside the subrequest ceiling" below for the measured number
 * this constant is sized against.
 */
export const CANDIDATE_BATCH = 8;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/** Deletes `ids` from `table` in groups of `DELETE_CHUNK`, each its own
 *  statement — one `db.run` per chunk, so a 500-row batch costs up to 5
 *  subrequests here, not 1 and not 500. `table` is always this module's
 *  own literal, never request input, so the interpolation below binds no
 *  value a candidate or an organiser ever supplied. The retired
 *  `sweepResponses` was this function's other caller, with `"response"`;
 *  AC-24's candidate pass subsumes it (see `sweepCandidates`), so
 *  `"snapshot"` is the only table left to delete this way. */
async function deleteChunked(db: DbClient, table: "snapshot", ids: string[]): Promise<void> {
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

/**
 * AC-24's clock anchor, in SQL: `COALESCE(MAX(attempt.deadline_at),
 * candidate.created_at)` — a live attempt's deadline is in the future, so
 * a candidate mid-exam is never due (the one thing this task must not get
 * wrong); a candidate uploaded but never registered has no attempt at all,
 * so upload time is the only clock it has; several attempts in one test
 * fold through `MAX`.
 *
 * Both the cutoff and the "already erased" check live in this query's
 * `WHERE`, not a JS filter applied after the fetch — #226 is exactly a
 * global `ORDER BY ... LIMIT` with no `WHERE`, which lets one workspace's
 * long-override, not-yet-due rows occupy every batch and starve every
 * other workspace. Pushing the cutoff into SQL means `LIMIT` only ever
 * spends `CANDIDATE_BATCH` on rows that are actually due, from any
 * workspace. "Already erased" is read off `deleteCandidates`'s own
 * blanked shape (`form_values_json = '{}'` and `external_id IS NULL`
 * together — neither alone is safe, since a self-registered candidate's
 * `external_id` is NULL from creation, never set — see
 * `packages/db/src/repo/attempts.ts`), or every tick reprocesses the same
 * rows forever.
 *
 * Settings resolve through `test.current_version`, `LEFT JOIN`ed so a
 * never-published test's uploaded list still falls through to
 * `RETENTION_DEFAULTS` instead of vanishing from the sweep.
 *
 * sqlite/d1 store JSON as text (`json_extract`); Postgres as `jsonb`
 * (`#>>`, cast to `numeric`) — `db.dialect` (client.ts:78-80) is the one
 * branch point, the same split `jsonParam`/`jsonValue` already draw.
 */
async function dueCandidates(deps: AppDeps): Promise<Candidate[]> {
  const pg = deps.db.dialect === "pg";
  const alreadyBlanked = pg
    ? "c.form_values_json = '{}'::jsonb AND c.external_id IS NULL"
    : "c.form_values_json = '{}' AND c.external_id IS NULL";
  const daysExtract = pg
    ? "(sub.settings_json #>> '{retention,personal_data_days}')::numeric"
    : "json_extract(sub.settings_json, '$.retention.personal_data_days')";

  return deps.db.query<Candidate>(
    `SELECT sub.* FROM (
       SELECT c.id AS id, c.workspace_id AS workspace_id,
         COALESCE((SELECT MAX(att.deadline_at) FROM attempt att WHERE att.candidate_id = c.id), c.created_at) AS at,
         tv.settings_json AS settings_json
       FROM candidate c
       JOIN test t ON t.id = c.test_id
       LEFT JOIN test_version tv ON tv.test_id = t.id AND tv.version = t.current_version
       WHERE NOT (${alreadyBlanked})
     ) sub
     WHERE sub.at <= ? - COALESCE(${daysExtract}, ?) * ${DAY_MS}
     ORDER BY sub.at ASC
     LIMIT ?`,
    [deps.now(), RETENTION_DEFAULTS.personalDataDays, CANDIDATE_BATCH],
  );
}

/**
 * AC-24's missing half of S-13/S-14: applies Task 2's `deleteCandidates`
 * (never a second erasure path — `TABLE_MANIFEST`/`KG4` guard this and the
 * manual route with one test) to a bounded batch of due candidates,
 * `keepAnonymisedScore: true` per K29's blanked-row shape so results
 * analytics keep reading an anonymised `score_json`. `deleteCandidates` is
 * workspace-scoped, so a batch spanning several workspaces calls it once
 * per workspace, grouped from the one SQL fetch above.
 */
async function sweepCandidates(deps: AppDeps): Promise<{ deleted: number; byWorkspace: Map<string, number> }> {
  const due = await dueCandidates(deps);
  if (due.length === 0) return { deleted: 0, byWorkspace: new Map() };

  const byWorkspace = new Map<string, string[]>();
  for (const row of due) {
    const list = byWorkspace.get(row.workspace_id) ?? [];
    list.push(row.id);
    byWorkspace.set(row.workspace_id, list);
  }

  for (const [workspaceId, candidateIds] of byWorkspace) {
    await deleteCandidates(deps.db, workspaceId, {
      candidateIds,
      keepAnonymisedScore: true,
      actor: "system",
      now: deps.now(),
      storage: deps.storage,
    });
  }

  return { deleted: due.length, byWorkspace: tally(due) };
}

export const retentionJob: ScheduledJob = {
  name: "retention.sweep",
  cron: CRON,
  run: async (deps) => {
    const snapshots = await sweepSnapshots(deps);
    const candidates = await sweepCandidates(deps);

    // One audit row per workspace this run actually touched (K30: "logs
    // what it did"), not one per deletion and not one unconditionally —
    // a run that found nothing expired has nothing to attribute a row to,
    // since `audit_log.workspace_id` is never null. `candidatesDeleted`
    // replaces `responsesDeleted`: AC-24's response pass is retired, not
    // kept beside the candidate one — `response.saved_at` is always at or
    // before the deadline anchor `dueCandidates` uses, so the candidate
    // pass already subsumes it; running both would delete the same rows
    // on two different clocks.
    const workspaces = new Set([...snapshots.byWorkspace.keys(), ...candidates.byWorkspace.keys()]);
    for (const workspaceId of workspaces) {
      await appendAudit(deps.db, workspaceId, {
        actor: "system",
        action: "retention.sweep",
        target: "retention",
        detail: {
          snapshotsDeleted: snapshots.byWorkspace.get(workspaceId) ?? 0,
          candidatesDeleted: candidates.byWorkspace.get(workspaceId) ?? 0,
        },
        now: deps.now(),
      });
    }

    return {
      summary:
        `retention.sweep: deleted ${snapshots.deleted} snapshot(s) and ${candidates.deleted} candidate(s) ` +
        `across ${workspaces.size} workspace(s), batch ${RETENTION_BATCH}/${CANDIDATE_BATCH}`,
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
