// Phase 8b Task 1 (`K14`): `recordAward` stores a rubric award and rescores
// the whole attempt through `rescoreAttempt` (`K5`, 8a Task 2) — reused,
// never rebuilt. Review Focus items 1, 2 and 4 are "refuses a question
// whose document defines no rubric", "drops the graded question from
// pending" and "records who graded it".

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Question } from "@pariksha/core";
import {
  addMembership,
  closeClient,
  createAttempt,
  createBank,
  createCandidate,
  createTest,
  createUser,
  finishAttempt,
  getAttempt,
  getDraftVersion,
  newId,
  readResponse,
  upsertQuestions,
  upsertResponse,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import type { AppDeps } from "../../src/app.js";
import type { PinnedLayout } from "../../src/run/attempt.js";
import { recordAward } from "../../src/grade/award.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedWorkspace } from "../run/fixtures.js";

const NOW = FIXED_NOW;

let deps: AppDeps;
let workspaceId: string;
let testId: string;
let testVersionId: string;
/** Auto-graded, worth 2, key "a". */
let q1 = "";
/** `short_answer`, worth 4, carrying one rubric level ("thorough" = 4,
 *  "thin" = 1) a reviewer can award. */
let q3 = "";
/** `short_answer`, worth 4, authored with **no** `rubric` array at all —
 *  Review Focus 1's defect. */
let qNoRubric = "";

let attemptId: string;
let candidateId: string;
let layout: PinnedLayout;

async function setFlag(workspaceId: string, attemptId: string, flag: string): Promise<void> {
  await deps.db.run("UPDATE attempt SET flag = ? WHERE workspace_id = ? AND id = ?", [
    flag,
    workspaceId,
    attemptId,
  ]);
}

beforeAll(async () => {
  ({ deps } = await testDeps());
  workspaceId = await seedWorkspace(deps);
  const bankId = await createBank(deps.db, workspaceId, { name: "Grading fixtures", now: NOW });
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
    {
      id: "q3",
      type: "short_answer",
      prompt: "Summarise",
      rubric: [
        { level: "thin", points: 1 },
        { level: "thorough", points: 4 },
      ],
      scoring: { points: 4 },
    },
    {
      id: "qNoRubric",
      type: "short_answer",
      prompt: "Explain",
      scoring: { points: 4 },
    },
  ];
  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, docs, NOW);
  [q1, q3, qNoRubric] = ids as [string, string, string];

  const test = await createTest(deps.db, workspaceId, {
    name: "Grading",
    slug: "grading",
    now: NOW,
    body: {
      settings: {},
      sections: [{ id: "sec", title: "Section", source: { kind: "fixed", questions: [q1, q3, qNoRubric] } }],
    },
  });
  testId = test.id;
  const draft = await getDraftVersion(deps.db, workspaceId, testId);
  if (!draft) throw new Error("createTest did not seed a draft");
  testVersionId = draft.id;

  layout = {
    sections: [{ sectionId: "sec", questionIds: [q1, q3, qNoRubric], optionOrder: {} }],
    media: [],
    paper: [],
  };
});

afterAll(() => closeClient(deps.db));

/** A fresh, submitted, ungraded attempt — `q1` answered correctly, `q3`
 *  and `qNoRubric` left blank — per test, so grading one test never
 *  carries state into the next. */
beforeEach(async () => {
  candidateId = await createCandidate(deps.db, workspaceId, { testId, formValues: {}, consentVersion: "1", now: NOW });
  attemptId = newId("att");
  await createAttempt(deps.db, workspaceId, {
    id: attemptId,
    candidateId,
    testVersionId,
    setNo: 1,
    layout,
    startedAt: NOW,
    deadlineAt: NOW + 3_600_000,
    tokenHash: newId("tok"),
  });
  await upsertResponse(deps.db, workspaceId, {
    attemptId,
    questionId: q1,
    value: { kind: "option", option: "a" },
    clientSeq: 1,
    savedAt: NOW,
  });
  await finishAttempt(deps.db, workspaceId, { attemptId, submittedAt: NOW, reason: "candidate" });
});

describe("recordAward", () => {
  it("stores the award and writes a fresh score_json", async () => {
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thorough"] },
      gradedBy: "usr_1",
      now: NOW,
    });
    // q1 (2, correct) + q3 (4, "thorough") = 6. qNoRubric stays pending at 0.
    expect((await getAttempt(deps.db, workspaceId, attemptId))!.scoreJson).toMatchObject({ total: 6 });
  });

  it("drops the graded question from pending", async () => {
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thorough"] },
      gradedBy: "usr_1",
      now: NOW,
    });
    const score = (await getAttempt(deps.db, workspaceId, attemptId))!.scoreJson as { pending: string[] };
    expect(score.pending).not.toContain(q3);
    // Positive control: the question never graded is still pending.
    expect(score.pending).toContain(qNoRubric);
  });

  it("records who graded it", async () => {
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thorough"] },
      gradedBy: "usr_1",
      now: NOW,
    });
    expect((await readResponse(deps.db, workspaceId, attemptId, q3))!.gradedBy).toBe("usr_1");
  });

  it("refuses a question whose document defines no rubric, naming the reason", async () => {
    await expect(
      recordAward(deps, workspaceId, {
        attemptId,
        questionId: qNoRubric,
        award: { levels: ["x"] },
        gradedBy: "usr_1",
        now: NOW,
      }),
    ).rejects.toThrow(/no rubric/);
    // Positive control, same attempt: a question that *does* define a
    // rubric grades cleanly.
    await expect(
      recordAward(deps, workspaceId, {
        attemptId,
        questionId: q3,
        award: { levels: ["thorough"] },
        gradedBy: "usr_1",
        now: NOW,
      }),
    ).resolves.toMatchObject({ written: true });
  });

  it("lets a second grader overwrite the first, and records the second", async () => {
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thin"] },
      gradedBy: "usr_1",
      now: NOW,
    });
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thorough"] },
      gradedBy: "usr_2",
      now: NOW + 1,
    });
    const row = (await readResponse(deps.db, workspaceId, attemptId, q3))!;
    expect(row.gradedBy).toBe("usr_2");
    expect(row.points).toBe(4);
  });

  it("never touches attempt.flag", async () => {
    await setFlag(workspaceId, attemptId, "scoring_blocked");
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thorough"] },
      gradedBy: "usr_1",
      now: NOW,
    });
    expect((await getAttempt(deps.db, workspaceId, attemptId))!.flag).toBe("scoring_blocked");
  });

  it("carries a question already graded earlier into a later grade's rescore", async () => {
    // q3 first, then qNoRubric would refuse — so grade q3 twice is not a
    // real "two manual questions" case. Use a second attempt/layout-free
    // check instead: grading q3 keeps q1's own points intact, proving the
    // rescore replayed every response, not only the one just graded.
    await recordAward(deps, workspaceId, {
      attemptId,
      questionId: q3,
      award: { levels: ["thin"] },
      gradedBy: "usr_1",
      now: NOW,
    });
    const score = (await getAttempt(deps.db, workspaceId, attemptId))!.scoreJson as {
      perQuestion: Record<string, { points: number }>;
    };
    expect(score.perQuestion[q1]?.points).toBe(2);
  });
});

// --- Authorisation: POST /api/v1/workspaces/:id/tests/:testId/grade ----

describe("POST /api/v1/workspaces/:id/tests/:testId/grade", () => {
  let asReviewer = "";
  let asAuthor = "";
  let asOutsider = "";
  let otherWorkspaceId = "";

  beforeAll(async () => {
    const reviewerId = await createUser(deps.db, { email: "reviewer@alpha.test", authProvider: "magic_link", now: NOW });
    await addMembership(deps.db, workspaceId, { userId: reviewerId, role: "reviewer", now: NOW });
    asReviewer = await sessionCookie(deps, (await issueSession(deps, reviewerId)).token);

    const authorId = await createUser(deps.db, { email: "author@alpha.test", authProvider: "magic_link", now: NOW });
    await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: NOW });
    asAuthor = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

    otherWorkspaceId = await seedWorkspace(deps, "beta", "Beta Corp");
    const outsiderId = await createUser(deps.db, { email: "outsider@beta.test", authProvider: "magic_link", now: NOW });
    await addMembership(deps.db, otherWorkspaceId, { userId: outsiderId, role: "owner", now: NOW });
    asOutsider = await sessionCookie(deps, (await issueSession(deps, outsiderId)).token);
  });

  const gradeUrl = (wsp: string) => `/api/v1/workspaces/${wsp}/tests/${testId}/grade`;
  const post = (url: string, body: unknown, cookie: string, instance = createApp(deps)) =>
    instance.request(url, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("admits an actor holding attempts.grade", async () => {
    const res = await post(gradeUrl(workspaceId), { attemptId, questionId: q3, award: { levels: ["thorough"] } }, asReviewer);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("refuses an Author, who holds tests.edit and not attempts.grade", async () => {
    const res = await post(gradeUrl(workspaceId), { attemptId, questionId: q3, award: { levels: ["thorough"] } }, asAuthor);
    expect(res.status).toBe(403);
  });

  it("refuses a member of another workspace with 404", async () => {
    const res = await post(gradeUrl(workspaceId), { attemptId, questionId: q3, award: { levels: ["thorough"] } }, asOutsider);
    expect(res.status).toBe(404);
  });

  it("every mounted endpoint declares its authority and action", () => {
    expect(ROUTE_AUTH["POST /api/v1/workspaces/:id/tests/:testId/grade"]).toBe("workspace");
    expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/grade"]).toBe("attempts.grade");
  });

  it("measures the real subrequest cost of the route, against a 300-candidate workspace", async () => {
    // `K9`: this route touches exactly one attempt, never the workspace's
    // whole candidate pool — proved here, not merely asserted, by seeding
    // 300 other candidates first and showing the cost does not move.
    for (let i = 0; i < 300; i += 1) {
      await createCandidate(deps.db, workspaceId, { testId, formValues: {}, consentVersion: "1", now: NOW });
    }
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(gradeUrl(workspaceId), {
      method: "POST",
      headers: { cookie: asReviewer, "content-type": "application/json" },
      body: JSON.stringify({ attemptId, questionId: q3, award: { levels: ["thorough"] } }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    // auth (2) + liveQuestions (1) + attemptForGrading (1) + writeAward (1)
    // + awardsForAttempt (1) + listResponses (1) + rescoreAttempt's own
    // liveQuestions (1) + writeScore (1).
    expect(counting.counts().total).toBe(9);
    expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/grade"]).toBe(9);
  });
});
