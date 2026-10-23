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
import { rateLimitJob, retentionJob, RETENTION_BATCH } from "../../src/retention/sweep.js";
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
): Promise<{ wsp: string; attemptId: string }> {
  const wsp = await seedWorkspace(deps);
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

// --- retentionJob: the two K28 defaults --------------------------------

it("applies S-13's defaults to a test with no retention block", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps);
  await addSnapshot(deps, wsp, attemptId, FIXED_NOW - 100 * DAY);
  await addResponse(deps, wsp, attemptId, FIXED_NOW - 100 * DAY);

  await retentionJob.run(deps);

  // 90-day default: 100 days old is past it.
  expect(await countSnapshots(deps, wsp)).toBe(0);
  // 365-day default: 100 days old is nowhere near it — the defect this
  // phase keeps shipping is `resolveRetention` read as "0 days" instead.
  expect(await countResponses(deps, wsp)).toBeGreaterThan(0);
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

it("also expires responses once a test's own personal_data_days has passed", async () => {
  const { deps } = await testDeps();
  const { wsp, attemptId } = await seedAttempt(deps, { personal_data_days: 10 });
  await addResponse(deps, wsp, attemptId, FIXED_NOW - 20 * DAY);

  await retentionJob.run(deps);

  expect(await countResponses(deps, wsp)).toBe(0);
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
  expect(counting.counts().storage).toBeGreaterThan(0);
  expect(counting.counts().storage).toBeLessThanOrEqual(2);
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
