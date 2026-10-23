// Phase 8b Task 1 (`K14`): the data layer manual grading writes through.
// `apps/api/test/grade/award.test.ts` covers `recordAward`'s own
// orchestration end to end; this file is the direct proof of the three
// repository functions it is built from, plus `listPendingAwards` — which
// carries no caller yet (Task 2 wires its route), so this is its only
// coverage until then.

import { afterAll, beforeAll, expect, it } from "vitest";
import type { Question } from "@pariksha/core";
import {
  attemptForGrading,
  closeClient,
  createAttempt,
  createBank,
  createCandidate,
  createTest,
  createWorkspace,
  finishAttempt,
  getDraftVersion,
  listPendingAwards,
  migrate,
  newId,
  sqliteClient,
  upsertQuestions,
  upsertResponse,
  writeAward,
  writeScore,
  type DbClient,
  type PinnedLayout,
} from "../../src/index.js";

const NOW = 1_780_000_000_000;

const db: DbClient = sqliteClient(":memory:");
await migrate(db);
afterAll(() => closeClient(db));

let workspaceId: string;
let testId: string;
let testVersionId: string;
let q1 = "";
let q3 = "";
let attemptA = "";
let attemptB = "";
let attemptC = "";

beforeAll(async () => {
  workspaceId = newId("wsp");
  await createWorkspace(db, workspaceId, { slug: "grading", name: "Grading", now: NOW });
  const bankId = await createBank(db, workspaceId, { name: "Bank", now: NOW });
  const docs: Question[] = [
    {
      id: "q1",
      type: "single",
      prompt: "Pick a",
      options: [{ id: "a", text: "A" }, { id: "b", text: "B" }],
      key: "a",
      scoring: { points: 2 },
    },
    {
      id: "q3",
      type: "short_answer",
      prompt: "Summarise",
      rubric: [{ level: "thorough", points: 4 }],
      scoring: { points: 4 },
    },
  ];
  const { ids } = await upsertQuestions(db, workspaceId, bankId, docs, NOW);
  [q1, q3] = ids as [string, string];

  const test = await createTest(db, workspaceId, {
    name: "Grading",
    slug: "grading",
    now: NOW,
    body: { settings: {}, sections: [{ id: "sec", title: "Section", source: { kind: "fixed", questions: [q1, q3] } }] },
  });
  testId = test.id;
  const draft = await getDraftVersion(db, workspaceId, testId);
  if (!draft) throw new Error("createTest did not seed a draft");
  testVersionId = draft.id;

  const layout: PinnedLayout = {
    sections: [{ sectionId: "sec", questionIds: [q1, q3], optionOrder: {} }],
    media: [],
    paper: [],
  };

  async function seedAttempt(tokenHash: string): Promise<string> {
    const candidateId = await createCandidate(db, workspaceId, { testId, formValues: {}, consentVersion: "1", now: NOW });
    const attemptId = newId("att");
    await createAttempt(db, workspaceId, {
      id: attemptId,
      candidateId,
      testVersionId,
      setNo: 1,
      layout,
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash,
    });
    await upsertResponse(db, workspaceId, {
      attemptId,
      questionId: q3,
      value: { kind: "text", text: "my answer" },
      clientSeq: 1,
      savedAt: NOW,
    });
    return attemptId;
  }

  attemptA = await seedAttempt("tok-a");
  attemptB = await seedAttempt("tok-b");
  attemptC = await seedAttempt("tok-c");

  // A and B are submitted, so both are visible to `listPendingAwards`,
  // which is what makes "graded" versus "never graded" a contrast within
  // one call rather than two tests that could each pass alone. C stays in
  // progress, so `writeScore`'s guard and `listPendingAwards`'
  // `submitted_at IS NOT NULL` filter both have a negative case too.
  await finishAttempt(db, workspaceId, { attemptId: attemptA, submittedAt: NOW, reason: "candidate" });
  await finishAttempt(db, workspaceId, { attemptId: attemptB, submittedAt: NOW, reason: "candidate" });
});

it("attemptForGrading joins the pinned version's settings and layout", async () => {
  const attempt = await attemptForGrading(db, workspaceId, attemptA);
  expect(attempt).toMatchObject({ attemptId: attemptA, testId, submittedAt: NOW });
});

it("returns null for an attempt in another workspace", async () => {
  const other = newId("wsp");
  await createWorkspace(db, other, { slug: "other", name: "Other", now: NOW });
  expect(await attemptForGrading(db, other, attemptA)).toBeNull();
});

it("writeAward stores points and graded_by without touching the candidate's own answer", async () => {
  const { written } = await writeAward(db, workspaceId, {
    attemptId: attemptA,
    questionId: q3,
    points: 4,
    gradedBy: "usr_1",
    now: NOW,
  });
  expect(written).toBe(true);
  const row = await db.query<{ points: number; graded_by: string; value_json: string }>(
    "SELECT points, graded_by, value_json FROM response WHERE workspace_id = ? AND attempt_id = ? AND question_id = ?",
    [workspaceId, attemptA, q3],
  );
  expect(row[0]).toMatchObject({ points: 4, graded_by: "usr_1" });
  expect(db.jsonValue(row[0]!.value_json)).toEqual({ kind: "text", text: "my answer" });
});

it("writeScore updates a submitted attempt's score_json", async () => {
  const { updated } = await writeScore(db, workspaceId, { attemptId: attemptA, score: { total: 6 } });
  expect(updated).toBe(true);
  const row = await db.query<{ score_json: string }>(
    "SELECT score_json FROM attempt WHERE workspace_id = ? AND id = ?",
    [workspaceId, attemptA],
  );
  expect(db.jsonValue(row[0]!.score_json)).toEqual({ total: 6 });
});

it("writeScore refuses an attempt that has not been submitted", async () => {
  const { updated } = await writeScore(db, workspaceId, { attemptId: attemptC, score: { total: 99 } });
  expect(updated).toBe(false);
});

it("reports the award once graded, and null for a question nobody has graded", async () => {
  // attemptA's q3 was graded "thorough" above; attemptB's never was —
  // both rows come back from the same call, so this is a real contrast,
  // not two queries that could each pass on their own.
  const { rows } = await listPendingAwards(db, workspaceId, testId, { questionId: q3 });
  expect(rows.find((r) => r.attemptId === attemptB)).toMatchObject({
    value: { kind: "text", text: "my answer" },
    award: null,
    points: null,
  });
  expect(rows.find((r) => r.attemptId === attemptA)).toMatchObject({
    award: { levels: ["thorough"] },
    points: 4,
  });
});

it("excludes an attempt that has not been submitted", async () => {
  const { rows } = await listPendingAwards(db, workspaceId, testId, { questionId: q3 });
  expect(rows.some((r) => r.attemptId === attemptC)).toBe(false);
  // Positive control: a submitted attempt's row is there.
  expect(rows.some((r) => r.attemptId === attemptA)).toBe(true);
});

it("paginates with a cursor, one row at a time", async () => {
  const first = await listPendingAwards(db, workspaceId, testId, { limit: 1 });
  expect(first.rows).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const second = await listPendingAwards(db, workspaceId, testId, { limit: 1, cursor: first.nextCursor! });
  expect(second.rows).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect(second.rows[0]?.attemptId).not.toBe(first.rows[0]?.attemptId);
});

it("never lists a question from another test", async () => {
  const otherWorkspace = newId("wsp");
  await createWorkspace(db, otherWorkspace, { slug: "elsewhere", name: "Elsewhere", now: NOW });
  const { rows } = await listPendingAwards(db, otherWorkspace, testId);
  expect(rows).toEqual([]);
});
