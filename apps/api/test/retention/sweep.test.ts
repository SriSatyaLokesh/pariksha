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
} from "@pariksha/db";
import type { TestRetention } from "@pariksha/core";
import { testDeps, FIXED_NOW } from "../deps.js";
import { seedWorkspace, seedTest } from "../run/fixtures.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import {
  CANDIDATE_BATCH,
  DELETE_CHUNK,
  rateLimitJob,
  retentionJob,
  RETENTION_BATCH,
} from "../../src/retention/sweep.js";
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

  // Exact, not just under the ceiling: 1 snapshot SELECT + the chunked
  // DELETEs a full RETENTION_BATCH needs (Fix round 2, F3) + 1 batched
  // storage.delete + 1 (empty) response SELECT + 1 audit row for the one
  // workspace this run touched.
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
  // 1 snapshot SELECT + the chunked DELETEs + 1 batched storage.delete +
  // 1 (empty) response SELECT + one audit row per workspace touched.
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

it("processes a bounded CANDIDATE_BATCH and resumes on the next tick", async () => {
  const { deps } = await testDeps();
  const { wsp, testId } = await seedCandidateTest(deps);
  const total = CANDIDATE_BATCH + 7;
  for (let i = 0; i < total; i++) {
    await addCandidateOnly(deps, wsp, testId, FIXED_NOW - 400 * DAY, { slot: i });
  }

  const first = await retentionJob.run(deps);
  expect(first.summary).toMatch(new RegExp(`${String(CANDIDATE_BATCH)} candidate`));
  expect(await countUnblankedCandidates(deps, wsp)).toBe(total - CANDIDATE_BATCH);

  const second = await retentionJob.run(deps);
  expect(second.summary).toMatch(/deleted 0 snapshot\(s\) and 7 candidate\(s\)/);
  expect(await countUnblankedCandidates(deps, wsp)).toBe(0);
});

/** The worst case `CANDIDATE_BATCH` has to survive: unlike snapshots, a
 *  `deleteCandidates` call's cost (attempt select, snapshot select,
 *  `storage.delete`, one `db.batch`) and the per-workspace `retention.sweep`
 *  audit row are both paid **per workspace**, not per row — so one due
 *  candidate per workspace, each with a surviving attempt and snapshot, is
 *  strictly more expensive than the same count in one workspace. Both
 *  subrequest-ceiling tests below seed that shape. */
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

it("stays inside the subrequest ceiling on one tick (candidates, one workspace)", async () => {
  const { deps } = await testDeps();
  const { wsp, testId, versionId } = await seedCandidateTest(deps, { retention: SURVIVING_SNAPSHOT });
  if (!versionId) throw new Error("fixture: expected a published version");
  for (let i = 0; i < CANDIDATE_BATCH; i++) {
    await addDueCandidateWithSnapshot(deps, wsp, testId, versionId);
  }

  const counting = countingDeps(deps);
  await retentionJob.run(counting.deps);

  // 1 `dueCandidates` select + 1 attempt select + 1 snapshot select +
  // 1 `storage.delete` + 1 `db.batch` (candidate/candidate_unique/
  // response/event/snapshot/audit, one round trip) + 1 `sweepSnapshots`
  // select (0 due here, its own clock overridden past the fixture) +
  // 1 `retention.sweep` audit row for the one workspace touched.
  expect(counting.counts().total).toBe(7);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});

it("stays inside the subrequest ceiling when due candidates are spread one-per-workspace", async () => {
  // The adversarial shape: `CANDIDATE_BATCH` due candidates, no two in the
  // same workspace, is the worst case `dueCandidates`'s own `LIMIT` can
  // hand `sweepCandidates` — every workspace pays its own `deleteCandidates`
  // overhead AND its own `retention.sweep` audit row.
  const { deps } = await testDeps();
  for (let i = 0; i < CANDIDATE_BATCH; i++) {
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
  // `CANDIDATE_BATCH` workspaces, each paying its own `deleteCandidates`
  // (attempt select + snapshot select + `storage.delete` + `db.batch` = 4)
  // plus its own `retention.sweep` audit row (5 per workspace) — the
  // measured worst case this constant is sized against.
  expect(counting.counts().total).toBe(2 + 5 * CANDIDATE_BATCH);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
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
