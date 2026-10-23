// The organiser's first attempt read (Phase 8a Task 7, K9/KG3). Every
// assertion here is about the statement budget and the tenant boundary —
// the two things nothing in this codebase proved before this file existed.

import { afterAll, expect, it } from "vitest";
import {
  closeClient,
  countedFiguresForTest,
  createTest,
  createWorkspace,
  getDraftVersion,
  listAttemptsForTest,
  migrate,
  newId,
  publishDraftVersion,
  putDraftVersion,
  sqliteClient,
  type DbClient,
  type TestDocumentBody,
} from "../../src/index.js";

const NOW = 1_770_000_000_000;
const MINUTE = 60_000;

const db: DbClient = sqliteClient(":memory:");
await migrate(db);
afterAll(() => closeClient(db));

/** One call per raw operation — the same shape `attempt.test.ts` and
 *  `candidate-entry.test.ts` each keep locally. */
function countingClient(inner: DbClient): { db: DbClient; count: () => number } {
  let calls = 0;
  const bump = <T>(run: () => T): T => {
    calls += 1;
    return run();
  };
  return {
    db: {
      ...inner,
      exec: (sql) => bump(() => inner.exec(sql)),
      all: <T>(sql: string) => bump(() => inner.all<T>(sql)),
      query: <T>(sql: string, params?: unknown[]) => bump(() => inner.query<T>(sql, params)),
      run: (sql, params) => bump(() => inner.run(sql, params)),
      batch: (statements) => bump(() => inner.batch(statements)),
    },
    count: () => calls,
  };
}

const body: TestDocumentBody = {
  settings: { timing: { duration_minutes: 45, navigation: "linear", late_sync_grace_seconds: 30 } },
  sections: [{ id: "s1", title: "Logic", source: { kind: "fixed", questions: ["qst_1"] } }],
};

/** A workspace with one published test, version 1. */
async function publish(slug: string): Promise<{ workspaceId: string; testId: string; versionId: string }> {
  const workspaceId = newId("wsp");
  await createWorkspace(db, workspaceId, { slug, name: slug, now: NOW });
  const test = await createTest(db, workspaceId, { name: slug, slug, now: NOW });
  const draft = await getDraftVersion(db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");
  await putDraftVersion(db, workspaceId, draft, body, NOW);
  await publishDraftVersion(db, workspaceId, test.id, NOW);
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
    [test.id],
  );
  return { workspaceId, testId: test.id, versionId: rows[0]!.id };
}

/** Publishes the open draft that followed the last publish, so the test now
 *  has two published versions. Returns the new one's id. */
async function publishAgain(ws: { workspaceId: string; testId: string; versionId: string }): Promise<string> {
  const draft = await getDraftVersion(db, ws.workspaceId, ws.testId);
  if (!draft) throw new Error("no open draft to publish again");
  await putDraftVersion(db, ws.workspaceId, draft, body, NOW);
  await publishDraftVersion(db, ws.workspaceId, ws.testId, NOW);
  const latest = await db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL AND id != ?",
    [ws.testId, ws.versionId],
  );
  return latest[0]!.id;
}

async function candidateIn(ws: { workspaceId: string; testId: string }): Promise<string> {
  const id = newId("cnd");
  await db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, NULL, NULL, 'registration', '{}', NULL, NULL, ?)",
    [id, ws.workspaceId, ws.testId, NOW],
  );
  return id;
}

interface AttemptSeed {
  workspaceId: string;
  candidateId: string;
  testVersionId: string;
  setNo?: number;
  startedAt?: number;
  deadlineAt?: number;
  submittedAt?: number | null;
  flag?: string;
  answered?: number;
  violations?: number;
}

/** Writes one attempt row directly — faster than `createAttempt` for a
 *  300-row fixture, and matches `attempt.test.ts`'s own convention of
 *  dropping to raw SQL for fixture setup. */
async function seedAttempt(seed: AttemptSeed): Promise<string> {
  const id = newId("att");
  await db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      seed.workspaceId,
      seed.candidateId,
      seed.testVersionId,
      seed.setNo ?? 1,
      "{}",
      seed.startedAt ?? NOW,
      seed.deadlineAt ?? NOW + 45 * MINUTE,
      seed.submittedAt ?? null,
      seed.submittedAt == null ? null : "candidate",
      null,
      seed.flag ?? "clean",
      `hash-${id}`,
      0,
      null,
      "clean",
      0,
    ],
  );
  for (let q = 0; q < (seed.answered ?? 0); q += 1) {
    await db.run(
      "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [newId("rsp"), seed.workspaceId, id, `qst_${q}`, "1", NOW, 1, null, null],
    );
  }
  for (let v = 0; v < (seed.violations ?? 0); v += 1) {
    await db.run(
      "INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) " +
        "VALUES (?, ?, ?, 'fullscreen_exit', NULL, ?, ?)",
      [newId("evt"), seed.workspaceId, id, NOW, NOW],
    );
  }
  return id;
}

async function score(id: string, percent: number): Promise<void> {
  await db.run("UPDATE attempt SET score_json = ? WHERE id = ?", [
    JSON.stringify({ percent, total: percent, max: 100, passed: null, pending: [], perQuestion: {}, sections: [] }),
    id,
  ]);
}

const alpha = await publish("alpha-results");
const beta = await publish("beta-results");

// --- listAttemptsForTest -------------------------------------------------

it("returns one row per attempt with its score, flag and counts", async () => {
  const candidateId = await candidateIn(alpha);
  const attemptId = await seedAttempt({
    workspaceId: alpha.workspaceId,
    candidateId,
    testVersionId: alpha.versionId,
    setNo: 1,
    answered: 12,
    violations: 0,
  });
  await score(attemptId, 64);

  const { rows } = await listAttemptsForTest(db, alpha.workspaceId, alpha.testId);
  const row = rows.find((r) => r.attemptId === attemptId);
  expect(row).toMatchObject({
    candidateId,
    setNo: 1,
    flag: "clean",
    answered: 12,
    violations: 0,
  });
  expect((row!.scoreJson as { percent: number }).percent).toBe(64);
});

it("counts violations and answered independently, not as the same number", async () => {
  const candidateId = await candidateIn(alpha);
  const attemptId = await seedAttempt({
    workspaceId: alpha.workspaceId,
    candidateId,
    testVersionId: alpha.versionId,
    answered: 3,
    violations: 2,
  });
  const { rows } = await listAttemptsForTest(db, alpha.workspaceId, alpha.testId);
  expect(rows.find((r) => r.attemptId === attemptId)).toMatchObject({ answered: 3, violations: 2 });
});

it("joins through test_version — an attempt of another version of the same test is included", async () => {
  const versionTwo = await publishAgain(alpha);
  const candidateId = await candidateIn(alpha);
  // Seeded against version 1's id, after version 2 is already the open/published one.
  const attemptOnV1 = await seedAttempt({
    workspaceId: alpha.workspaceId,
    candidateId,
    testVersionId: alpha.versionId,
    setNo: 9,
  });
  const onV2 = await seedAttempt({
    workspaceId: alpha.workspaceId,
    candidateId: await candidateIn(alpha),
    testVersionId: versionTwo,
    setNo: 9,
  });

  const { rows } = await listAttemptsForTest(db, alpha.workspaceId, alpha.testId, { limit: 500 });
  const ids = rows.map((r) => r.attemptId);
  expect(ids).toContain(attemptOnV1);
  expect(ids).toContain(onV2);
});

it("refuses a workspace it was not scoped to, and sees its own rows through the same call", async () => {
  const candidateId = await candidateIn(beta);
  const betaAttempt = await seedAttempt({
    workspaceId: beta.workspaceId,
    candidateId,
    testVersionId: beta.versionId,
  });

  // Positive control: beta's own workspace sees the row it just wrote.
  const own = await listAttemptsForTest(db, beta.workspaceId, beta.testId);
  expect(own.rows.map((r) => r.attemptId)).toContain(betaAttempt);

  // Negative: alpha's workspace ID against beta's test ID sees nothing —
  // the join can only ever surface rows that are alpha's own.
  const crossTenant = await listAttemptsForTest(db, alpha.workspaceId, beta.testId);
  expect(crossTenant.rows).toEqual([]);
});

it("reads 300 attempts in a bounded number of statements", async () => {
  const big = await publish("big-cohort-results");
  for (let i = 0; i < 300; i += 1) {
    const candidateId = await candidateIn(big);
    await seedAttempt({
      workspaceId: big.workspaceId,
      candidateId,
      testVersionId: big.versionId,
      startedAt: NOW + i,
    });
  }

  const counting = countingClient(db);
  await listAttemptsForTest(counting.db, big.workspaceId, big.testId);
  expect(counting.count()).toBeLessThanOrEqual(3);
});

it("returns a cursor when it reaches the limit, and null when it does not", async () => {
  const cohort = await publish("cursor-cohort-results");
  for (let i = 0; i < 300; i += 1) {
    const candidateId = await candidateIn(cohort);
    await seedAttempt({
      workspaceId: cohort.workspaceId,
      candidateId,
      testVersionId: cohort.versionId,
      startedAt: NOW + i,
    });
  }

  const firstPage = await listAttemptsForTest(db, cohort.workspaceId, cohort.testId, { limit: 100 });
  expect(firstPage.rows).toHaveLength(100);
  expect(firstPage.nextCursor).not.toBeNull();

  const wholeCohort = await listAttemptsForTest(db, cohort.workspaceId, cohort.testId, { limit: 500 });
  expect(wholeCohort.rows).toHaveLength(300);
  expect(wholeCohort.nextCursor).toBeNull();

  const secondPage = await listAttemptsForTest(db, cohort.workspaceId, cohort.testId, {
    limit: 100,
    cursor: firstPage.nextCursor!,
  });
  expect(secondPage.rows).toHaveLength(100);
  // No overlap between the two pages.
  const firstIds = new Set(firstPage.rows.map((r) => r.attemptId));
  expect(secondPage.rows.every((r) => !firstIds.has(r.attemptId))).toBe(true);
});

// --- countedFiguresForTest ------------------------------------------------

it("groups submitted, scored attempts by candidate — one statement for the whole test", async () => {
  const c1 = await candidateIn(alpha);
  const c2 = await candidateIn(alpha);
  const a1 = await seedAttempt({
    workspaceId: alpha.workspaceId,
    candidateId: c1,
    testVersionId: alpha.versionId,
    submittedAt: NOW,
  });
  await score(a1, 55);
  const a2 = await seedAttempt({
    workspaceId: alpha.workspaceId,
    candidateId: c2,
    testVersionId: alpha.versionId,
    submittedAt: NOW,
  });
  await score(a2, 70);
  // Unsubmitted — excluded, same rule `attemptFiguresForCandidate` applies.
  await seedAttempt({ workspaceId: alpha.workspaceId, candidateId: c1, testVersionId: alpha.versionId });

  const counting = countingClient(db);
  const figures = await countedFiguresForTest(counting.db, alpha.workspaceId, alpha.testId);
  expect(counting.count()).toBe(1);

  expect(figures.get(c1)).toEqual([{ attemptId: a1, percent: 55, submittedAt: NOW }]);
  expect(figures.get(c2)).toEqual([{ attemptId: a2, percent: 70, submittedAt: NOW }]);
});

it("refuses a workspace it was not scoped to, and sees its own figures through the same call", async () => {
  const candidateId = await candidateIn(beta);
  const betaAttempt = await seedAttempt({
    workspaceId: beta.workspaceId,
    candidateId,
    testVersionId: beta.versionId,
    submittedAt: NOW,
  });
  await score(betaAttempt, 42);

  // Positive control.
  const own = await countedFiguresForTest(db, beta.workspaceId, beta.testId);
  expect(own.get(candidateId)).toEqual([{ attemptId: betaAttempt, percent: 42, submittedAt: NOW }]);

  // Negative: alpha's workspace ID against beta's test ID sees nothing.
  const crossTenant = await countedFiguresForTest(db, alpha.workspaceId, beta.testId);
  expect(crossTenant.size).toBe(0);
});
