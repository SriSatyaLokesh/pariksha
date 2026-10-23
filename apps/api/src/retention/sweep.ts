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
import { AttemptInProgressError, deleteCandidates, MAX_IDS_PER_CHUNK } from "./candidate.js";

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
 * Fix round 1, F1: bounded on **distinct workspaces**, not on raw
 * candidate count. `candidate.test_id` is NOT NULL and a test belongs to
 * exactly one workspace (`packages/db/src/schema/columns.ts:302-321`), so
 * one test's whole overdue cohort sits in one workspace — the common
 * shape this product actually produces. `deleteCandidates`'s own
 * subrequest cost (attempt select, snapshot select, `storage.delete`, one
 * `db.batch`) is paid **per workspace it is called for**, not per
 * candidate inside that call, so a cohort sharing one workspace is cheap
 * regardless of its size, and the adversarial case is the rare one: many
 * *distinct* workspaces each contributing one due candidate. A fixed
 * row-count limit (the original `CANDIDATE_BATCH`) bounded on the rare
 * shape and made the common one pay for it — a 300-candidate single-test
 * cohort cleared at 8 rows a night, 37 nights, which does not meet
 * `AC-24`'s "after the retention period, the daily job deletes ... for
 * that test." See "stays inside the subrequest ceiling" below for the
 * measured number this constant is sized against.
 */
export const CANDIDATE_WORKSPACE_LIMIT = 8;

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
 * The cutoff and the "already erased" check both live in this query's
 * `WHERE`, not a JS filter applied after the fetch — #226 is exactly a
 * global `ORDER BY ... LIMIT` with no `WHERE`, which lets one workspace's
 * long-override, not-yet-due rows occupy every batch and starve every
 * other workspace. "Already erased" is read off `deleteCandidates`'s own
 * blanked shape (`form_values_json = '{}'` and `external_id IS NULL`
 * together — neither alone is safe, since a self-registered candidate's
 * `external_id` is NULL from creation, never set — see
 * `packages/db/src/repo/attempts.ts`), or every tick reprocesses the same
 * rows forever.
 *
 * **Fix round 1, F1: the admission bound is two window functions, not one
 * `LIMIT`.** `rn` (`ROW_NUMBER() OVER (PARTITION BY workspace_id ORDER BY
 * at)`) caps each workspace at `MAX_IDS_PER_CHUNK` due candidates this
 * tick — exactly one `deleteCandidates` id-chunk, which is what keeps a
 * workspace's own cost at the measured, fixed "attempt select + snapshot
 * select + storage.delete + one batch" regardless of how many of its
 * candidates are admitted. `workspace_rank` then caps the *number of
 * workspaces* touched this tick at `CANDIDATE_WORKSPACE_LIMIT`,
 * most-overdue workspace first — `DENSE_RANK() OVER (ORDER BY
 * workspace_min_at, workspace_id)`, reading each workspace's own earliest
 * `at` back from a plain column rather than nesting a window function
 * inside another one's `ORDER BY` (SQLite/D1 refuse that directly; see the
 * query's own comment on `workspace_min_at`). A fixed-row `LIMIT` (this
 * query's original shape) would let one large single-workspace cohort's
 * own rows crowd out a `LIMIT` of 8 before any other workspace got a
 * turn, or — the fix round's actual finding — cap that one cohort's own
 * nightly throughput at 8 regardless of how cheap it really is to
 * process.
 *
 * Settings resolve through `test.current_version`, `LEFT JOIN`ed so a
 * never-published test's uploaded list still falls through to
 * `RETENTION_DEFAULTS` instead of vanishing from the sweep.
 *
 * sqlite/d1 store JSON as text (`json_extract`); Postgres as `jsonb`
 * (`#>>`, cast to `numeric`) — `db.dialect` (client.ts:78-80) is the one
 * branch point, the same split `jsonParam`/`jsonValue` already draw. Window
 * functions themselves are plain ANSI SQL, supported identically by all
 * three dialects (confirmed against better-sqlite3's bundled SQLite 3.53;
 * D1 and Postgres both document the same `ROW_NUMBER`/`DENSE_RANK`).
 */
async function dueCandidates(deps: AppDeps): Promise<Candidate[]> {
  const pg = deps.db.dialect === "pg";
  const alreadyBlanked = pg
    ? "c.form_values_json = '{}'::jsonb AND c.external_id IS NULL"
    : "c.form_values_json = '{}' AND c.external_id IS NULL";
  const daysExtract = pg
    ? "(raw.settings_json #>> '{retention,personal_data_days}')::numeric"
    : "json_extract(raw.settings_json, '$.retention.personal_data_days')";

  return deps.db.query<Candidate>(
    `SELECT ranked.id AS id, ranked.workspace_id AS workspace_id, ranked.at AS at, ranked.settings_json AS settings_json
     FROM (
       SELECT withmin.*,
         ROW_NUMBER() OVER (PARTITION BY withmin.workspace_id ORDER BY withmin.at ASC) AS rn,
         DENSE_RANK() OVER (ORDER BY withmin.workspace_min_at ASC, withmin.workspace_id ASC) AS workspace_rank
       FROM (
         -- MIN(due.at) OVER (...) has to land in its own plain column
         -- here: SQLite (and D1) refuse a window-function call nested
         -- directly inside another window function's own ORDER BY
         -- ("misuse of window function"), so workspace_rank above reads
         -- this column back as an ordinary value instead of re-computing it
         -- inline.
         SELECT due.*, MIN(due.at) OVER (PARTITION BY due.workspace_id) AS workspace_min_at
         FROM (
           SELECT raw.id AS id, raw.workspace_id AS workspace_id, raw.at AS at, raw.settings_json AS settings_json
           FROM (
             SELECT c.id AS id, c.workspace_id AS workspace_id,
               COALESCE((SELECT MAX(att.deadline_at) FROM attempt att WHERE att.candidate_id = c.id), c.created_at) AS at,
               tv.settings_json AS settings_json
             FROM candidate c
             JOIN test t ON t.id = c.test_id
             LEFT JOIN test_version tv ON tv.test_id = t.id AND tv.version = t.current_version
             WHERE NOT (${alreadyBlanked})
           ) raw
           WHERE raw.at <= ? - COALESCE(${daysExtract}, ?) * ${DAY_MS}
         ) due
       ) withmin
     ) ranked
     WHERE ranked.workspace_rank <= ? AND ranked.rn <= ?
     ORDER BY ranked.at ASC`,
    [deps.now(), RETENTION_DEFAULTS.personalDataDays, CANDIDATE_WORKSPACE_LIMIT, MAX_IDS_PER_CHUNK],
  );
}

/**
 * AC-24's missing half of S-13/S-14: applies Task 2's `deleteCandidates`
 * (never a second erasure path — `TABLE_MANIFEST`/`KG4` guard this and the
 * manual route with one test) to up to `CANDIDATE_WORKSPACE_LIMIT`
 * workspaces' worth of due candidates, `keepAnonymisedScore: true` per
 * K29's blanked-row shape so results analytics keep reading an anonymised
 * `score_json`. `deleteCandidates` is workspace-scoped, so the batch —
 * already grouped and capped per workspace by `dueCandidates`'s own SQL —
 * calls it once per workspace.
 *
 * **Fix round 1, F2:** `deleteCandidates` refuses its *whole* call
 * (`AttemptInProgressError`) if any candidate in it has gained a live
 * attempt. `dueCandidates`'s anchor should make that impossible — every
 * selected row's cutoff is already in the past — but the one race it
 * cannot close is an attempt created *after* the select and *before* this
 * loop reaches that workspace, within the same tick. Caught here and
 * skipped rather than left to propagate: an uncaught throw would fail the
 * whole `retentionJob` run — and with it, every other workspace's sweep
 * this tick, snapshots included (K27's isolation only separates
 * `retentionJob` from `rateLimitJob`, not the two halves of this job from
 * each other) — for one workspace's one-tick timing accident. A skip costs
 * that one workspace one night; an uncaught throw costs every workspace
 * every night until someone notices the job failing.
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

  const succeeded = new Map<string, number>();
  for (const [workspaceId, candidateIds] of byWorkspace) {
    try {
      await deleteCandidates(deps.db, workspaceId, {
        candidateIds,
        keepAnonymisedScore: true,
        actor: "system",
        now: deps.now(),
        storage: deps.storage,
      });
      succeeded.set(workspaceId, candidateIds.length);
    } catch (err) {
      if (!(err instanceof AttemptInProgressError)) throw err;
      // Skip this workspace's batch entirely — see the function comment.
    }
  }

  let deleted = 0;
  for (const count of succeeded.values()) deleted += count;
  return { deleted, byWorkspace: succeeded };
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
        `across ${workspaces.size} workspace(s), batch ${RETENTION_BATCH}/${CANDIDATE_WORKSPACE_LIMIT}ws`,
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
