// Phase 8b Task 3 (`K16`): the reviewer's verdict, append-only and
// latest-wins. `apps/api/test/review.test.ts` covers the route and its
// authorisation end to end; this file is the direct proof of the two
// repository functions, including the deterministic tiebreaker and the
// one-query promise `latestVerdicts` makes to 8c.

import { afterAll, beforeAll, expect, it } from "vitest";
import {
  closeClient,
  createAttempt,
  createBank,
  createCandidate,
  createTest,
  createWorkspace,
  getDraftVersion,
  latestVerdicts,
  migrate,
  newId,
  recordVerdict,
  sqliteClient,
  upsertQuestions,
  type DbClient,
  type PinnedLayout,
} from "../../src/index.js";
import type { Question } from "@pariksha/core";

const NOW = 1_780_000_000_000;

const db: DbClient = sqliteClient(":memory:");
await migrate(db);
afterAll(() => closeClient(db));

let workspaceId: string;
let attemptId: string;

beforeAll(async () => {
  workspaceId = newId("wsp");
  await createWorkspace(db, workspaceId, {
    slug: "review",
    name: "Review",
    now: NOW,
  });
  const bankId = await createBank(db, workspaceId, { name: "Bank", now: NOW });
  const docs: Question[] = [
    {
      id: "q1",
      type: "single",
      prompt: "Pick a",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      key: "a",
      scoring: { points: 2 },
    },
  ];
  const { ids } = await upsertQuestions(db, workspaceId, bankId, docs, NOW);
  const [q1] = ids as [string];

  const test = await createTest(db, workspaceId, {
    name: "Review",
    slug: "review",
    now: NOW,
    body: {
      settings: {},
      sections: [
        {
          id: "sec",
          title: "Section",
          source: { kind: "fixed", questions: [q1] },
        },
      ],
    },
  });
  const draft = await getDraftVersion(db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");

  const layout: PinnedLayout = {
    sections: [{ sectionId: "sec", questionIds: [q1], optionOrder: {} }],
    media: [],
    paper: [],
  };
  const candidateId = await createCandidate(db, workspaceId, {
    testId: test.id,
    formValues: {},
    consentVersion: "1",
    now: NOW,
  });
  attemptId = newId("att");
  await createAttempt(db, workspaceId, {
    id: attemptId,
    candidateId,
    testVersionId: draft.id,
    setNo: 1,
    layout,
    startedAt: NOW,
    deadlineAt: NOW + 3_600_000,
    tokenHash: newId("tok"),
  });
});

it("appends rather than replacing", async () => {
  await recordVerdict(db, workspaceId, {
    attemptId,
    reviewer: "usr_1",
    verdict: "suspicious",
    now: 1,
  });
  await recordVerdict(db, workspaceId, {
    attemptId,
    reviewer: "usr_2",
    verdict: "clear",
    now: 2,
  });
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM review WHERE workspace_id = ? AND attempt_id = ?",
    [workspaceId, attemptId],
  );
  expect(Number(rows[0]!.n)).toBe(2);
});

it("reads back the latest", async () => {
  // Both verdicts above are already written: usr_1/suspicious at t=1,
  // usr_2/clear at t=2.
  const verdicts = await latestVerdicts(db, workspaceId, [attemptId]);
  expect(verdicts.get(attemptId)).toMatchObject({
    verdict: "clear",
    reviewer: "usr_2",
  });
});

it("carries the note through, and null when none was given", async () => {
  const other = newId("att");
  // A second, independent attempt — not `attemptId` above, which already
  // carries two prior verdicts — so this is a clean read of exactly one
  // row's `note`.
  await recordVerdict(db, workspaceId, {
    attemptId: other,
    reviewer: "usr_3",
    verdict: "disqualified",
    note: "Screenshare dropped twice",
    now: 10,
  });
  const verdicts = await latestVerdicts(db, workspaceId, [other]);
  expect(verdicts.get(other)).toMatchObject({
    verdict: "disqualified",
    note: "Screenshare dropped twice",
  });

  const noNote = newId("att");
  await recordVerdict(db, workspaceId, {
    attemptId: noNote,
    reviewer: "usr_3",
    verdict: "clear",
    now: 11,
  });
  expect(
    (await latestVerdicts(db, workspaceId, [noNote])).get(noNote),
  ).toMatchObject({ note: null });
});

it("is deterministic for two verdicts at the same millisecond", async () => {
  const sameMillis = newId("att");
  const a = await recordVerdict(db, workspaceId, {
    attemptId: sameMillis,
    reviewer: "usr_1",
    verdict: "suspicious",
    now: 5,
  });
  const b = await recordVerdict(db, workspaceId, {
    attemptId: sameMillis,
    reviewer: "usr_2",
    verdict: "clear",
    now: 5,
  });
  const winner = (await latestVerdicts(db, workspaceId, [sameMillis])).get(
    sameMillis,
  );
  const again = (await latestVerdicts(db, workspaceId, [sameMillis])).get(
    sameMillis,
  );
  expect(winner).toEqual(again);
  // `ORDER BY (at, id)`: at tied, the row with the lexicographically later
  // id wins. Crockford IDs from `newId` are not time-ordered, so which of
  // `a`/`b` that is has to be read off the ids themselves, not assumed.
  const expectedWinnerId = a.reviewId > b.reviewId ? a.reviewId : b.reviewId;
  const expectedReviewer = expectedWinnerId === a.reviewId ? "usr_1" : "usr_2";
  expect(winner).toMatchObject({ reviewer: expectedReviewer });
});

it("reads many attempts in one query", async () => {
  const ids: string[] = [];
  for (let i = 0; i < 300; i += 1) {
    const id = newId("att");
    ids.push(id);
    await recordVerdict(db, workspaceId, {
      attemptId: id,
      reviewer: "usr_1",
      verdict: "clear",
      now: 100 + i,
    });
  }
  let queries = 0;
  const counted: DbClient = {
    ...db,
    query: (sql: string, params?: unknown[]) => {
      queries += 1;
      return db.query(sql, params);
    },
  };
  const verdicts = await latestVerdicts(counted, workspaceId, ids);
  expect(queries).toBe(1);
  expect(verdicts.size).toBe(300);
});

it("never reads a verdict recorded in another workspace", async () => {
  const other = newId("wsp");
  await createWorkspace(db, other, {
    slug: "elsewhere",
    name: "Elsewhere",
    now: NOW,
  });
  expect((await latestVerdicts(db, other, [attemptId])).size).toBe(0);
});

it("returns an empty map, and runs no query, for an empty attempt list", async () => {
  let queries = 0;
  const counted: DbClient = {
    ...db,
    query: (sql: string, params?: unknown[]) => {
      queries += 1;
      return db.query(sql, params);
    },
  };
  expect(await latestVerdicts(counted, workspaceId, [])).toEqual(new Map());
  expect(queries).toBe(0);
});

it("refuses a non-workspace id, the same structural guard every repo function carries", async () => {
  await expect(
    recordVerdict(db, newId("tst"), {
      attemptId,
      reviewer: "usr_1",
      verdict: "clear",
      now: 1,
    }),
  ).rejects.toThrow(/workspace/i);
  await expect(latestVerdicts(db, "", [attemptId])).rejects.toThrow(
    /workspace/i,
  );
});
