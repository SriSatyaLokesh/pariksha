// The nightly sweep (K27, K30, AC-24, S-13, #101): `retentionJob` expires
// `snapshot` and `response` rows past each test's own retention, and
// `rateLimitJob` is the scheduled caller `sweepRateLimits` (Phase 6) never
// had. Each `it` below builds its own fresh in-memory database — a shared
// one would make "which test's `now` applies to which row" a thing a
// reader has to reconstruct, and K30's bounded-batch tests want a database
// with nothing in it but what they themselves seeded.

import { expect, it } from "vitest";
import {
  createAttempt,
  createCandidate,
  getPublishedVersion,
  listAudit,
  newId,
  recordSnapshot,
  upsertResponse,
  type DbClient,
} from "@pariksha/db";
import type { TestRetention } from "@pariksha/core";
import { testDeps, FIXED_NOW } from "../deps.js";
import { seedWorkspace, seedTest } from "../run/fixtures.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import {
  CANDIDATE_WORKSPACE_LIMIT,
  DELETE_CHUNK,
  rateLimitJob,
  retentionJob,
  RETENTION_BATCH,
} from "../../src/retention/sweep.js";
import { MAX_IDS_PER_CHUNK } from "../../src/retention/candidate.js";
import type { AppDeps } from "../../src/app.js";

const DAY = 86_400_000;

/** One published test, one candidate, one attempt — everything a snapshot
 *  or a response row needs a real `test_version` to join against, built
 *  through the real writers (`seedWorkspace`/`seedTest`, the run fixtures'
 *  own helpers) rather than a hand INSERT, so a change to what a published
 *  test looks like reaches this file too. */
async function seedAttempt(
  deps: AppDeps,
  retention?: TestRetention,
  // Distinct per call only when a test actually needs more than one
  // workspace in its (fresh, per-test) database — `seedWorkspace`'s own
  // slug is unique per workspace, and every other test here seeds exactly
  // one, so the shared default is fine for them.
  slug = "retention",
): Promise<{ wsp: string; attemptId: string }> {
  const wsp = await seedWorkspace(deps, slug);
  const testId = await seedTest(deps, wsp, {
    name: "Retention",
    slug: "retention",
    body: {
      settings: retention ? { retention } : {},
      sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 1 } }],
    },
  });
  const version = await getPublishedVersion(deps.db, wsp, testId);
  if (!version) throw new Error("fixture: seedTest did not publish a version");

  const candidateId = await createCandidate(deps.db, wsp, {
    testId,
    formValues: {},
    consentVersion: "v1",
    now: FIXED_NOW,
  });
  const attemptId = newId("att");
  await createAttempt(deps.db, wsp, {
    id: attemptId,
    candidateId,
    testVersionId: version.id,
    setNo: 1,
    layout: {},
    startedAt: FIXED_NOW,
    deadlineAt: FIXED_NOW + DAY,
    tokenHash: `hash-${attemptId}`,
  });
  return { wsp, attemptId };
}

async function addSnapshot(
  deps: AppDeps,
  wsp: string,
  attemptId: string,
  takenAt: number,
  key = `snap/${attemptId}/${newId("snp")}`,
): Promise<string> {
  await deps.storage.put(key, new Uint8Array([1]), { contentType: "image/jpeg" });
  await recordSnapshot(deps.db, wsp, { attemptId, storageKey: key, takenAt, reason: "interval" });
  return key;
}

async function addResponse(
  deps: AppDeps,
  wsp: string,
  attemptId: string,
  savedAt: number,
  questionId = "qst_1",
): Promise<void> {
  await upsertResponse(deps.db, wsp, {
    attemptId,
    questionId,
    value: { choice: "a" },
    clientSeq: 1,
    savedAt,
  });
}

async function countSnapshots(deps: AppDeps, wsp: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM snapshot WHERE workspace_id = ?",
    [wsp],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countResponses(deps: AppDeps, wsp: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM response WHERE workspace_id = ?",
    [wsp],
  );
  return Number(rows[0]?.n ?? 0);
}

async function countRateLimitRows(deps: AppDeps): Promise<number> {
  const rows = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM rate_limit", []);
  return Number(rows[0]?.n ?? 0);
}

// --- AC-24: candidate fixtures -------------------------------------------

/** A workspace and a test, with no candidate yet — the sibling of
 *  `seedAttempt` for the candidate tests below, which (unlike every other
 *  test here) each need to control a candidate's own clock (`created_at`,
 *  and whether it has an attempt at all) independently of when the test
 *  itself was seeded. `publish: false` is what the "never-published test"
 *  case (test 4) needs; every other candidate test leaves it published. */
async function seedCandidateTest(
  deps: AppDeps,
  opts: { retention?: TestRetention; slug?: string; publish?: boolean } = {},
): Promise<{ wsp: string; testId: string; versionId: string | null }> {
  const slug = opts.slug ?? "retention-candidate";
  const wsp = await seedWorkspace(deps, slug);
  const testId = await seedTest(deps, wsp, {
    name: "Retention Candidate",
    slug,
    body: {
      settings: opts.retention ? { retention: opts.retention } : {},
      sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 1 } }],
    },
    publish: opts.publish,
  });
  const version = await getPublishedVersion(deps.db, wsp, testId);
  return { wsp, testId, versionId: version?.id ?? null };
}

/** A candidate row only — no attempt. `source` is always `"registration"`
 *  through `createCandidate` (`packages/db/src/repo/attempts.ts`), and
 *  `external_id` is always NULL on it, same as every self-registered
 *  candidate in production — exactly the ambiguity `dueCandidates`'s
 *  "already erased" check has to survive (see sweep.ts). */
async function addCandidateOnly(
  deps: AppDeps,
  wsp: string,
  testId: string,
  createdAt: number,
  formValues: Record<string, unknown> = { full_name: "Jamie Rivera", email: "jamie@example.test" },
): Promise<string> {
  return createCandidate(deps.db, wsp, { testId, formValues, consentVersion: "v1", now: createdAt });
}

/** A candidate plus one finished, scored attempt — `deadlineAt` is the
 *  anchor's own input, and `submittedAt` defaults to just before it so the
 *  attempt is never "in progress" by `deleteCandidates`'s own guard
 *  (`submitted_at IS NULL AND deadline_at > now`) unless a test passes
 *  `submittedAt: null` deliberately. Kept apart on purpose: the one test
 *  that needs a future deadline on an attempt that is *not* in progress
 *  (test 2, the anchor probe) must not be rescued by that separate guard
 *  instead of by `COALESCE` — see the comment on that test. */
async function addCandidateWithAttempt(
  deps: AppDeps,
  wsp: string,
  versionId: string,
  testId: string,
  opts: { createdAt: number; deadlineAt: number; submittedAt?: number | null },
): Promise<{ candidateId: string; attemptId: string }> {
  const candidateId = await addCandidateOnly(deps, wsp, testId, opts.createdAt);
  const attemptId = newId("att");
  await createAttempt(deps.db, wsp, {
    id: attemptId,
    candidateId,
    testVersionId: versionId,
    setNo: 1,
    layout: {},
    startedAt: opts.createdAt,
    deadlineAt: opts.deadlineAt,
    tokenHash: `hash-${attemptId}`,
  });
  const submittedAt = opts.submittedAt === undefined ? opts.deadlineAt - 1 : opts.submittedAt;
  if (submittedAt !== null) {
    await deps.db.run("UPDATE attempt SET submitted_at = ?, score_json = ? WHERE workspace_id = ? AND id = ?", [
      submittedAt,
      deps.db.jsonParam({ total: 1 }),
      wsp,
      attemptId,
    ]);
  }
  return { candidateId, attemptId };
}

interface CandidateRow {
  form_values_json: unknown;
  external_id: string | null;
}

async function getCandidate(deps: AppDeps, wsp: string, candidateId: string): Promise<CandidateRow | undefined> {
  const rows = await deps.db.query<CandidateRow>(
    "SELECT form_values_json, external_id FROM candidate WHERE workspace_id = ? AND id = ?",
    [wsp, candidateId],
  );
  return rows[0];
}

function isBlanked(deps: AppDeps, row: CandidateRow | undefined): boolean {
  if (!row) return false;
  return row.external_id === null && JSON.stringify(deps.db.jsonValue(row.form_values_json)) === "{}";
}

async function countAttempts(deps: AppDeps, wsp: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM attempt WHERE workspace_id = ?", [wsp]);
  return Number(rows[0]?.n ?? 0);
}

/** Candidates not (yet) blanked — the resumable-batch test's progress
 *  counter, mirroring `countSnapshots` for the K30 "bounded batch,
 *  resumes" shape but for rows a sweep edits in place rather than
 *  deletes. */
async function countUnblankedCandidates(deps: AppDeps, wsp: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM candidate WHERE workspace_id = ? AND NOT (form_values_json = '{}' AND external_id IS NULL)",
    [wsp],
  );
  return Number(rows[0]?.n ?? 0);
}

// --- retentionJob: the two K28 defaults --------------------------------

it("applies S-13's defaults to a test with no retention block", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY);

  await retentionJob.run(deps);

  // 90-day default: 100 days old is past it.
  expect(await countSnapshots(deps, wsp)).toBe(0);
});

it("deletes nothing before the window", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 30 * DAY);

  await retentionJob.run(deps);

  expect(await countSnapshots(deps, wsp)).toBeGreaterThan(0);
});

// --- a test's own override, both directions -----------------------------

it("respects a test's own snapshots_days when it is shorter than the default", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps, { snapshots_days: 5 });
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 10 * DAY);

  await retentionJob.run(deps);

  expect(await countSnapshots(deps, wsp)).toBe(0);
});

it("does not starve a workspace with short retention when another workspace has unexpired snapshots (#226)", async () => {
  const { deps } = await testDeps();
  const { wsp: wspA, attemptId: attemptA } = await seedAttempt(deps, { snapshots_days: 365 }, "wsp-a");
  for (let i = 0; i < RETENTION_BATCH; i++) {
    await addSnapshot(deps, wspA, attemptA, FIXED_NOW - 100 * DAY, `snap/${attemptA}/${i}`);
  }

  const { wsp: wspB, attemptId: attemptB } = await seedAttempt(deps, { snapshots_days: 30 }, "wsp-b");
  for (let i = 0; i < 5; i++) {
    await addSnapshot(deps, wspB, attemptB, FIXED_NOW - 40 * DAY, `snap/${attemptB}/${i}`);
  }

  await retentionJob.run(deps);

  // Workspace B's snapshots are expired (40 > 30 days) and must be deleted.
  expect(await countSnapshots(deps, wspB)).toBe(0);
  // Workspace A's snapshots are not expired (100 < 365 days) and must survive.
  expect(await countSnapshots(deps, wspA)).toBe(RETENTION_BATCH);
}, 30_000);

// --- storage: batched, never per key ------------------------------------

it("removes the R2 objects in one batched call, not one per key", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY);
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 110 * DAY);

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  // Positive control: it really did call `storage.delete`, so the ceiling
  // below is not vacuously satisfied by calling it zero times.
  //
  // `<= 1`, not `<= 2`: two snapshots and a per-key loop (the regression
  // this test exists to catch) both call `storage.delete` twice, so `<= 2`
  // passes either way — Fix round 1, F1. One call is the actual contract,
  // true for correct code at any fixture size.
  expect(counting.counts().storage).toBeGreaterThan(0);
  expect(counting.counts().storage).toBeLessThanOrEqual(1);
});

// --- idempotence: a row survives, its object does not --------------------

it("is idempotent when a row's object is already gone", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  const key = await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY);
  // Simulates a run interrupted between the two deletes in `sweepSnapshots`
  // (plan Step 3's ordering): the object is gone, the row is not yet.
  await deps.storage.delete([key]);

  await expect(retentionJob.run(deps)).resolves.toBeDefined();
  expect(await countSnapshots(deps, wsp)).toBe(0);
});

// --- K30: bounded batch, resumes -----------------------------------------

it("processes a bounded batch and resumes on the next tick", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  const total = RETENTION_BATCH + 700;
  for (let i = 0; i < total; i++) {
    await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY, `snap/${attemptId}/${i}`);
  }

  const first = await retentionJob.run(deps);
  expect(first.summary).toMatch(new RegExp(String(RETENTION_BATCH)));
  expect(await countSnapshots(deps, wsp)).toBe(total - RETENTION_BATCH);

  await retentionJob.run(deps);
  expect(await countSnapshots(deps, wsp)).toBe(total - 2 * RETENTION_BATCH);
}, 30_000);

it("stays inside the subrequest ceiling on one tick", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  for (let i = 0; i < RETENTION_BATCH + 200; i++) {
    await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY, `snap/${attemptId}/${i}`);
  }

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  // Exact, not just under the ceiling: the snapshot SELECT itself + the
  // chunked DELETEs a full RETENTION_BATCH needs (Fix round 2, F3) +
  // 1 batched storage.delete + 1 `dueCandidates` SELECT (empty — no
  // candidates seeded here) + 1 audit row for the one workspace this run
  // touched.
  const deleteChunks = Math.ceil(RETENTION_BATCH / DELETE_CHUNK);
  expect(counting.counts().total).toBe(1 + deleteChunks + 1 + 1 + 1);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
}, 30_000);

it("stays inside the subrequest ceiling when the batch spans several workspaces", async () => {
  // Fix round 2: the per-workspace audit loop (one `appendAudit` per
  // workspace a run touched) is the one piece of this job whose cost does
  // not come from `RETENTION_BATCH`/`DELETE_CHUNK` directly — it comes
  // from how many distinct workspaces the fetched batch happens to span.
  // A full batch spread over several ordinary workspaces (as opposed to
  // one workspace's own 500) is the realistic shape to prove safe.
  const { deps } = await testDeps();
  const perWorkspace = 100;
  const workspaceCount = RETENTION_BATCH / perWorkspace;
  for (let w = 0; w < workspaceCount; w++) {
    const { wsp, attemptId } = await seedAttempt(deps, undefined, `ws-${w}`);
    for (let i = 0; i < perWorkspace; i++) {
      await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY, `snap/${attemptId}/${i}`);
    }
  }

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  const deleteChunks = Math.ceil(RETENTION_BATCH / DELETE_CHUNK);
  // The snapshot SELECT + the chunked DELETEs + 1 batched
  // storage.delete + 1 `dueCandidates` SELECT (empty) + one audit row per
  // workspace touched.
  expect(counting.counts().total).toBe(1 + deleteChunks + 1 + 1 + workspaceCount);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
}, 30_000);

// --- the audit trail ------------------------------------------------------

it("writes one audit row per run naming what it deleted", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY);

  await retentionJob.run(deps);

  const rows = (await listAudit(deps.db, wsp)).filter((r) => r.action === "retention.sweep");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.detail).toMatchObject({ snapshotsDeleted: 1 });
});

// --- AC-24: the nightly candidate expiry ----------------------------------

it("blanks a candidate past personal_data_days; attempt and score_json survive", async () => {
  const { deps } = await testDeps();
  const { wsp, testId, versionId } = await seedCandidateTest(deps);
  if (!versionId) throw new Error("fixture: expected a published version");
  const { candidateId, attemptId } = await addCandidateWithAttempt(deps, wsp, versionId, testId, {
    createdAt: FIXED_NOW - 400 * DAY,
    deadlineAt: FIXED_NOW - 400 * DAY,
  });
  await addResponse(deps, wsp, attemptId, FIXED_NOW - 400 * DAY);

  await retentionJob.run(deps);

  expect(isBlanked(deps, await getCandidate(deps, wsp, candidateId))).toBe(true);
  // `keepAnonymisedScore: true` (K29): the attempt and its score survive.
  expect(await countAttempts(deps, wsp)).toBe(1);
  // The response pass is retired — `deleteCandidates` deletes `response`
  // unconditionally for an erased candidate's attempts, so the candidate
  // pass already subsumes it (sweep.ts's header comment on this).
  expect(await countResponses(deps, wsp)).toBe(0);
});

// THE MOST IMPORTANT TEST IN THIS TASK. A live attempt's deadline sits in
// the future; without `COALESCE(MAX(attempt.deadline_at),
// candidate.created_at)` in `dueCandidates`'s `WHERE`, a candidate whose
// `created_at` is 400 days old reads as overdue on its creation date alone
// and gets blanked mid-exam — the worst outcome this phase can ship.
//
// `submittedAt` is set (just before the future `deadlineAt`) so this
// attempt is NOT "in progress" by `deleteCandidates`'s own separate guard
// (`submitted_at IS NULL AND deadline_at > now`) — otherwise that guard
// would refuse the erasure anyway and this test would pass for the wrong
// reason, masking a broken anchor instead of proving a correct one. Probed
// (see task-4-report.md): replacing the `COALESCE(...)` in sweep.ts's
// `dueCandidates` with bare `c.created_at` makes this test fail with the
// row blanked, confirming it cannot pass vacuously.
it("does not touch a candidate with a live attempt, even if created long ago", async () => {
  const { deps } = await testDeps();
  const { wsp, testId, versionId } = await seedCandidateTest(deps);
  if (!versionId) throw new Error("fixture: expected a published version");
  const { candidateId } = await addCandidateWithAttempt(deps, wsp, versionId, testId, {
    createdAt: FIXED_NOW - 400 * DAY,
    deadlineAt: FIXED_NOW + 10 * DAY,
    submittedAt: FIXED_NOW - DAY,
  });

  await retentionJob.run(deps);

  expect(isBlanked(deps, await getCandidate(deps, wsp, candidateId))).toBe(false);
});

// Fix round 1, F2: the one race the anchor cannot close on its own — an
// attempt starts for a candidate *after* `dueCandidates`'s SELECT decided
// it was due, but *before* `sweepCandidates` reaches that workspace in its
// per-workspace loop, within the same tick. Simulated here by intercepting
// `deps.db.query`: the moment `dueCandidates`'s own SELECT (identified by
// its `workspace_rank` column, unique to that query) returns, a live
// attempt is inserted for one of the two due candidates it found — exactly
// the gap the real code cannot see. `deleteCandidates` then refuses that
// one workspace (`AttemptInProgressError`); the question this test asks is
// whether that takes the *other* workspace's erasure down with it.
it("skips a workspace whose due candidate gained a live attempt mid-tick, without failing the other workspace", async () => {
  const { deps } = await testDeps();
  const { wsp: raceWsp, testId: raceTestId, versionId: raceVersionId } = await seedCandidateTest(deps, {
    slug: "race-a",
  });
  if (!raceVersionId) throw new Error("fixture: expected a published version");
  const { wsp: safeWsp, testId: safeTestId } = await seedCandidateTest(deps, { slug: "race-b" });
  const raceCandidateId = await addCandidateOnly(deps, raceWsp, raceTestId, FIXED_NOW - 400 * DAY);
  const safeCandidateId = await addCandidateOnly(deps, safeWsp, safeTestId, FIXED_NOW - 400 * DAY);

  let injected = false;
  const racingDb: typeof deps.db = {
    ...deps.db,
    query: (async <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> => {
      const rows = await deps.db.query<T>(sql, params);
      if (!injected && sql.includes("workspace_rank")) {
        injected = true;
        const attemptId = newId("att");
        await deps.db.run(
          "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, " +
            "started_at, deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, " +
            "section_started_at, integrity_flag, observed) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)",
          [attemptId, raceWsp, raceCandidateId, raceVersionId, 1, "{}", FIXED_NOW, FIXED_NOW + DAY, "clean", `hash-${attemptId}`, 0, "clean", 0],
        );
      }
      return rows;
    }) as typeof deps.db.query,
  };

  const result = await retentionJob.run({ ...deps, db: racingDb });

  expect(injected).toBe(true); // the race fixture itself actually fired
  // The raced workspace survives the gap untouched -- deleteCandidates
  // refused the whole call rather than blanking around a now-live attempt.
  expect(isBlanked(deps, await getCandidate(deps, raceWsp, raceCandidateId))).toBe(false);
  // The other workspace's erasure is unaffected by its sibling's race.
  expect(isBlanked(deps, await getCandidate(deps, safeWsp, safeCandidateId))).toBe(true);
  expect(result.summary).toMatch(/deleted 0 snapshot\(s\) and 1 candidate\(s\)/);

  // Fix round 2, F1: a skip must leave readable evidence, or a workspace
  // stuck with a perpetually-extended attempt fails AC-24 silently, every
  // night, forever. The same `retention.sweep` audit row every touched
  // workspace already gets names the skip by count — ids and counts only
  // (KG9), never which candidate or why.
  const raceAudit = await listAudit(deps.db, raceWsp);
  const raceSweepRow = raceAudit.find((r) => r.action === "retention.sweep");
  expect(raceSweepRow?.detail).toMatchObject({ candidatesDeleted: 0, candidatesSkipped: 1 });
});

// Fix round 2, F2: the catch in `sweepCandidates` is narrowed to
// `instanceof AttemptInProgressError` — everything else must still come
// out. Source inspection said so; this is the break-it-and-watch-it-fail
// proof the round's own standard calls for. `deps.db.batch` is
// intercepted (not `.query`, which `dueCandidates` alone uses) to throw a
// plain `Error` the moment `deleteCandidates` tries to commit its erasure
// — a failure with no relationship at all to a live attempt, so a catch
// that swallowed it would be a bare `catch`, not the narrow one this task
// promises.
it("lets a non-AttemptInProgressError out of sweepCandidates rather than swallowing it", async () => {
  const { deps } = await testDeps();
  const { wsp, testId } = await seedCandidateTest(deps);
  await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY);

  const breakingDb: typeof deps.db = {
    ...deps.db,
    batch: (async () => {
      throw new Error("storage backend unreachable");
    }) as typeof deps.db.batch,
  };

  await expect(retentionJob.run({ ...deps, db: breakingDb })).rejects.toThrow("storage backend unreachable");
});

it("expires a candidate with no attempt at all on its own created_at", async () => {
  const { deps } = await testDeps();
  const { wsp, testId } = await seedCandidateTest(deps);
  const candidateId = await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY);

  await retentionJob.run(deps);

  expect(isBlanked(deps, await getCandidate(deps, wsp, candidateId))).toBe(true);
});

it("falls through to RETENTION_DEFAULTS for a never-published test's candidates", async () => {
  const { deps } = await testDeps();
  const { wsp, testId, versionId } = await seedCandidateTest(deps, { publish: false });
  expect(versionId).toBeNull(); // the fixture itself: no published version to join against
  const candidateId = await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY);

  await retentionJob.run(deps);

  // Not skipped by the LEFT JOIN finding no `test_version` row — 400 days
  // past the 365-day default still blanks it.
  expect(isBlanked(deps, await getCandidate(deps, wsp, candidateId))).toBe(true);
});

it("is idempotent: a second run over an already-blanked candidate deletes nothing", async () => {
  const { deps } = await testDeps();
  const { wsp, testId } = await seedCandidateTest(deps);
  await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY);

  const first = await retentionJob.run(deps);
  expect(first.summary).toMatch(/deleted 0 snapshot\(s\) and 1 candidate\(s\)/);

  const second = await retentionJob.run(deps);
  expect(second.summary).toMatch(/deleted 0 snapshot\(s\) and 0 candidate\(s\)/);
});

// Fix round 1, F1: the per-tick bound is now two-dimensional — a
// workspace's own due candidates are capped at `MAX_IDS_PER_CHUNK` (one
// `deleteCandidates` id-chunk), and the number of *distinct workspaces*
// touched is capped at `CANDIDATE_WORKSPACE_LIMIT`. Each dimension gets
// its own K30 "bounded batch, resumes" proof below.

it("caps one workspace's own cohort at MAX_IDS_PER_CHUNK and resumes on the next tick", async () => {
  const { deps } = await testDeps();
  const { wsp, testId } = await seedCandidateTest(deps);
  const total = MAX_IDS_PER_CHUNK + 7;
  for (let i = 0; i < total; i++) {
    await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY, { slot: i });
  }

  const first = await retentionJob.run(deps);
  expect(first.summary).toMatch(new RegExp(`${String(MAX_IDS_PER_CHUNK)} candidate`));
  expect(await countUnblankedCandidates(deps, wsp)).toBe(total - MAX_IDS_PER_CHUNK);

  const second = await retentionJob.run(deps);
  expect(second.summary).toMatch(/deleted 0 snapshot\(s\) and 7 candidate\(s\)/);
  expect(await countUnblankedCandidates(deps, wsp)).toBe(0);
}, 30_000);

it("caps the workspaces touched at CANDIDATE_WORKSPACE_LIMIT and resumes with the rest", async () => {
  // The other dimension: `CANDIDATE_WORKSPACE_LIMIT + 3` workspaces, one
  // due candidate each, each strictly older than the last so
  // `workspace_rank`'s tie-break never has to decide which "ties" go
  // first — the most-overdue `CANDIDATE_WORKSPACE_LIMIT` are unambiguously
  // the ones due this tick.
  const { deps } = await testDeps();
  const workspaceCount = CANDIDATE_WORKSPACE_LIMIT + 3;
  const workspaces: string[] = [];
  for (let i = 0; i < workspaceCount; i++) {
    const { wsp, testId } = await seedCandidateTest(deps, { slug: `rcw-${String(i)}` });
    workspaces.push(wsp);
    await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY - i * DAY);
  }

  const first = await retentionJob.run(deps);
  expect(first.summary).toMatch(new RegExp(`${String(CANDIDATE_WORKSPACE_LIMIT)} candidate`));
  const unblankedAfterFirst = await Promise.all(workspaces.map((wsp) => countUnblankedCandidates(deps, wsp)));
  expect(unblankedAfterFirst.filter((n) => n === 0)).toHaveLength(CANDIDATE_WORKSPACE_LIMIT);
  expect(unblankedAfterFirst.filter((n) => n === 1)).toHaveLength(3);
  // The most-overdue workspaces (largest `i`, oldest `at`) are the ones
  // cleared first — the fairness `workspace_rank`'s own `ORDER BY` exists
  // for.
  for (let i = 0; i < 3; i++) {
    expect(unblankedAfterFirst[i]).toBe(1);
  }

  const second = await retentionJob.run(deps);
  expect(second.summary).toMatch(/deleted 0 snapshot\(s\) and 3 candidate\(s\)/);
  const unblankedAfterSecond = await Promise.all(workspaces.map((wsp) => countUnblankedCandidates(deps, wsp)));
  expect(unblankedAfterSecond.every((n) => n === 0)).toBe(true);
});

it("clears a 300-candidate single-workspace cohort in ceil(300 / MAX_IDS_PER_CHUNK) nights", async () => {
  // The finding fix round 1 exists to close: a fixed row-count `LIMIT`
  // bounded on the rare "one candidate per workspace" shape and made the
  // common one — one test's whole overdue cohort, all in one workspace —
  // pay for it. Before this fix, 300 candidates at the old
  // `CANDIDATE_BATCH = 8` cleared in 300 / 8 = 38 nights; AC-24 promises
  // "the daily job deletes ... for that test", not five-plus weeks later.
  const { deps } = await testDeps();
  const { wsp, testId } = await seedCandidateTest(deps);
  const total = 300;
  for (let i = 0; i < total; i++) {
    await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY, { slot: i });
  }

  const expectedNights = Math.ceil(total / MAX_IDS_PER_CHUNK);
  let nights = 0;
  let remaining = total;
  while (remaining > 0) {
    await retentionJob.run(deps);
    remaining = await countUnblankedCandidates(deps, wsp);
    nights += 1;
  }

  expect(nights).toBe(expectedNights);
}, 30_000);

/** The worst case `CANDIDATE_WORKSPACE_LIMIT` has to survive: a
 *  `deleteCandidates` call's cost (attempt select, snapshot select,
 *  `storage.delete`, one `db.batch`) and the per-workspace `retention.sweep`
 *  audit row are both paid **per workspace**, not per row inside it — so
 *  one due candidate per workspace, each with a surviving attempt and
 *  snapshot, is strictly more expensive than the same count in one
 *  workspace. Both subrequest-ceiling tests below seed one of the two
 *  shapes. */
async function addDueCandidateWithSnapshot(
  deps: AppDeps,
  wsp: string,
  testId: string,
  versionId: string,
): Promise<void> {
  const { attemptId } = await addCandidateWithAttempt(deps, wsp, versionId, testId, {
    createdAt: FIXED_NOW - 400 * DAY,
    deadlineAt: FIXED_NOW - 400 * DAY,
  });
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 400 * DAY);
}

// `snapshots_days` is deliberately overridden far longer than
// `personal_data_days`: with both left at the defaults, `sweepSnapshots`
// (90 days) deletes the same snapshot before `sweepCandidates` (365 days)
// ever runs, so `deleteCandidates` finds nothing left to delete and the
// measurement understates its real cost. A test is free to set the two
// clocks either direction (K28), so the override is the honest worst case,
// not a contrived one.
const SURVIVING_SNAPSHOT: TestRetention = { snapshots_days: 10_000 };

it("stays inside the subrequest ceiling on one tick (candidates, one workspace at its full per-workspace cap)", async () => {
  // MAX_IDS_PER_CHUNK (98), not CANDIDATE_WORKSPACE_LIMIT: this is the
  // fix round's actual point — one workspace's own cohort costs the same
  // handful of subrequests whether it holds 8 due candidates or 98.
  const { deps } = await testDeps();
  const { wsp, testId, versionId } = await seedCandidateTest(deps, { retention: SURVIVING_SNAPSHOT });
  if (!versionId) throw new Error("fixture: expected a published version");
  for (let i = 0; i < MAX_IDS_PER_CHUNK; i++) {
    await addDueCandidateWithSnapshot(deps, wsp, testId, versionId);
  }

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  // 1 `dueCandidates` select + 1 attempt select + 1 snapshot select +
  // 1 `storage.delete` + 1 `db.batch` (candidate/candidate_unique/
  // response/event/snapshot/audit, one round trip) + 1 `sweepSnapshots`
  // select (0 due here, its own clock overridden past the fixture) +
  // 1 `retention.sweep` audit row for the one workspace touched — the same
  // 7 regardless of whether this loop runs 8 or 98 times.
  expect(counting.counts().total).toBe(7);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
}, 30_000);

it("stays inside the subrequest ceiling when due candidates are spread one-per-workspace", async () => {
  // The adversarial shape: `CANDIDATE_WORKSPACE_LIMIT` due candidates, no
  // two in the same workspace, is the worst case `dueCandidates`'s own
  // admission bound can hand `sweepCandidates` — every workspace pays its
  // own `deleteCandidates` overhead AND its own `retention.sweep` audit
  // row.
  const { deps } = await testDeps();
  for (let i = 0; i < CANDIDATE_WORKSPACE_LIMIT; i++) {
    const { wsp, testId, versionId } = await seedCandidateTest(deps, {
      slug: `rc-${String(i)}`,
      retention: SURVIVING_SNAPSHOT,
    });
    if (!versionId) throw new Error("fixture: expected a published version");
    await addDueCandidateWithSnapshot(deps, wsp, testId, versionId);
  }

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  // 1 `dueCandidates` select + 1 `sweepSnapshots` select (0 due) +
  // `CANDIDATE_WORKSPACE_LIMIT` workspaces, each paying its own
  // `deleteCandidates` (attempt select + snapshot select +
  // `storage.delete` + `db.batch` = 4) plus its own `retention.sweep`
  // audit row (5 per workspace) — the measured worst case this constant
  // is sized against, unchanged by fix round 1 (it bounds the other
  // dimension).
  expect(counting.counts().total).toBe(2 + 5 * CANDIDATE_WORKSPACE_LIMIT);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});

// Branch review `M2` (MAJOR): the two tests above each zero out the other
// half — `SURVIVING_SNAPSHOT` exists specifically so the candidate-ceiling
// tests find no due snapshots, and the snapshot-ceiling tests (above this
// pair) seed no due candidates. **Composed**, which is what one real cron
// tick actually runs, was never measured — `progress.md`'s Task 4 fix
// round recorded "42 subrequests, worst case" against the candidate half
// alone. This test loads both halves in the same tick, at each one's own
// worst-case size, and pins the exact composed total rather than bounding
// either half in isolation. `rateLimitJob` (the other job `K27`'s cron
// registers) is not included: it is `SCHEDULED_JOBS`'s other, independent
// entry (`scheduled.ts`), one `sweepRateLimits` DELETE, isolated from
// `retentionJob` by the same design that keeps either job's failure from
// touching the other — this test is `retentionJob.run`'s own ceiling, the
// one `CANDIDATE_WORKSPACE_LIMIT` is sized against.
/**
 * Like `addDueCandidateWithSnapshot` above, except the snapshot it leaves
 * behind is recent (`FIXED_NOW - 1 * DAY`) rather than 400 days old. The
 * candidate itself is still due — that clock is `COALESCE(MAX(attempt.
 * deadline_at), candidate.created_at)`, unrelated to the snapshot's own
 * `taken_at` — but `sweepSnapshots`'s global `ORDER BY taken_at ASC LIMIT
 * ?` has no per-workspace fairness of its own (`C1`'s fix bounds rows
 * *scanned*, not which workspace's rows sort first — that batch-fairness
 * gap is explicitly #226's, not this branch's). A recent snapshot sorts
 * to the *back* of that order and fails the cutoff `WHERE` outright, so it
 * cannot crowd the genuinely-due `RETENTION_BATCH` rows out of the LIMIT
 * the way a second batch of 400-day-old, long-retention snapshots would —
 * which is exactly what using the shared helper here measured by
 * accident on the first pass of this test (`deleteChunks` came back 2, not
 * 5, because 392 old-but-not-due candidate-workspace snapshots outranked
 * genuinely-due ones in the ASC sort). This test's subject is the
 * **composed subrequest cost**, not that pre-existing, deferred ordering
 * gap, so the fixture is built to not trip over it.
 */
async function addDueCandidateWithRecentSnapshot(
  deps: AppDeps,
  wsp: string,
  testId: string,
  versionId: string,
): Promise<void> {
  const { attemptId } = await addCandidateWithAttempt(deps, wsp, versionId, testId, {
    createdAt: FIXED_NOW - 400 * DAY,
    deadlineAt: FIXED_NOW - 400 * DAY,
  });
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 1 * DAY);
}

it("stays inside the subrequest ceiling with both halves loaded in the same tick", async () => {
  const { deps } = await testDeps();

  // The snapshot half, at a full RETENTION_BATCH, in its own workspace —
  // left at the default retention, so these ARE due and pay the full
  // delete-chunk cost `C1`'s cutoff query does not prune away.
  const { wsp: snapshotWsp, attemptId } = await seedAttempt(deps, undefined, "combined-snapshots");
  for (let i = 0; i < RETENTION_BATCH; i++) {
    await addSnapshot(deps, snapshotWsp, attemptId, FIXED_NOW - 100 * DAY, `snap/${attemptId}/${i}`);
  }

  // The candidate half, at its own worst case: CANDIDATE_WORKSPACE_LIMIT
  // distinct workspaces, each at its own full MAX_IDS_PER_CHUNK cap —
  // `SURVIVING_SNAPSHOT` keeps each one's own attempt snapshot out of the
  // snapshot half's scan on retention grounds; `addDueCandidateWithRecentSnapshot`
  // (above) also keeps it out of the snapshot half's *ordering*, so the two
  // halves' costs stay separable and additive rather than one masking the
  // other.
  for (let w = 0; w < CANDIDATE_WORKSPACE_LIMIT; w++) {
    const { wsp, testId, versionId } = await seedCandidateTest(deps, {
      slug: `combined-candidates-${String(w)}`,
      retention: SURVIVING_SNAPSHOT,
    });
    if (!versionId) throw new Error("fixture: expected a published version");
    for (let i = 0; i < MAX_IDS_PER_CHUNK; i++) {
      await addDueCandidateWithRecentSnapshot(deps, wsp, testId, versionId);
    }
  }

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  // The snapshot select (1) + its chunked DELETEs
  // (`ceil(RETENTION_BATCH / DELETE_CHUNK)`) + 1 batched `storage.delete` +
  // 1 `dueCandidates` select (shared across every candidate workspace) +
  // `CANDIDATE_WORKSPACE_LIMIT` workspaces each paying `deleteCandidates`'s
  // own 4 (attempt select + snapshot select + `storage.delete` +
  // `db.batch`) + one `retention.sweep` audit row per workspace touched
  // (the one snapshot workspace plus the `CANDIDATE_WORKSPACE_LIMIT`
  // candidate ones).
  const deleteChunks = Math.ceil(RETENTION_BATCH / DELETE_CHUNK);
  const expected =
    1 + // sweepSnapshots select
    deleteChunks +
    1 + // storage.delete (snapshots)
    1 + // dueCandidates select
    4 * CANDIDATE_WORKSPACE_LIMIT + // deleteCandidates, per workspace
    (1 + CANDIDATE_WORKSPACE_LIMIT); // audit rows: 1 snapshot workspace + N candidate workspaces
  expect(counting.counts().total).toBe(expected);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
}, 30_000);

// Branch review `m5` (MINOR): `sweep.ts`'s two `pg`-dialect branches
// (`alreadyBlanked`, `daysExtract` inside `dueCandidates`) have never
// executed anywhere — #229 records no Postgres test infrastructure at
// all. What this test CAN prove cheaply, without a real Postgres: that
// `dueCandidates` really does build the `pg`-shaped SQL (not the sqlite
// one) when `db.dialect === "pg"`, matching the file header's own
// documented text exactly — so a future edit that mistypes an operator or
// drops the dialect check fails here. **What remains genuinely
// unprovable without #229: whether Postgres accepts and correctly
// evaluates `'{}'::jsonb` and `#>> '{retention,personal_data_days}'`
// against this schema's real `jsonb` columns** — that is a fact about
// Postgres's own engine, not one a fake `DbClient` can know. `daysExtract`
// fails *safe* if wrong (a bad cast throws, nothing is erased);
// `alreadyBlanked` fails *stuck but harmless* if wrong (idempotent,
// reprocesses forever); the one that would matter if this ever diverges
// silently is `candidateIdExtract`, covered the same way in
// `candidate.test.ts`.
it("builds the pg-dialect dueCandidates SQL with the documented jsonb operators, not the sqlite ones", async () => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const fakePg: DbClient = {
    dialect: "pg",
    drizzle: undefined as never,
    exec: async () => undefined,
    all: async () => [],
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      return [];
    },
    run: async () => ({ changes: 0 }),
    batch: async (stmts) => stmts.map(() => ({ changes: 0 })),
    jsonParam: (value) => JSON.stringify(value),
    jsonValue: (raw) => (typeof raw === "string" ? (JSON.parse(raw) as never) : (raw as never)),
    close: async () => undefined,
  };
  const fakeStorage = {
    put: async () => undefined,
    get: async () => null,
    delete: async () => undefined,
    signedUrl: () => "",
  };

  await retentionJob.run({
    db: fakePg,
    storage: fakeStorage,
    now: () => FIXED_NOW,
    env: { target: "workers", sessionSecret: "s" },
  });

  const dueCandidatesQuery = queries.find((q) => q.sql.includes("FROM candidate c"));
  expect(dueCandidatesQuery?.sql).toContain("c.form_values_json = '{}'::jsonb");
  expect(dueCandidatesQuery?.sql).toContain("(raw.settings_json #>> '{retention,personal_data_days}')::numeric");
  expect(dueCandidatesQuery?.sql).not.toContain("json_extract");

  const sweepSnapshotsQuery = queries.find((q) => q.sql.includes("FROM snapshot sn"));
  expect(sweepSnapshotsQuery?.sql).toContain("(tv.settings_json #>> '{retention,snapshots_days}')::numeric");
  expect(sweepSnapshotsQuery?.sql).not.toContain("json_extract");
});

// --- rateLimitJob: Phase 6's sweepRateLimits, finally scheduled -----------

it("expires rate_limit rows through the function Phase 6 already wrote", async () => {
  const { deps } = await testDeps();
  await deps.db.run("INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, ?)", [
    "test_access:ver_old",
    FIXED_NOW - 2 * DAY,
    5,
  ]);

  await rateLimitJob.run(deps);

  expect(await countRateLimitRows(deps)).toBe(0);
});
