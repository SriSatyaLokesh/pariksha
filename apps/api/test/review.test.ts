// Phase 8b Task 3 (`K16`): `POST /api/v1/workspaces/:id/attempts/:attemptId/
// verdict`. `packages/db/test/repo/review.test.ts` covers `recordVerdict`
// and `latestVerdicts` directly; this file is the route end to end — the
// 404 across a workspace boundary, the authorisation (`attempts.grade`,
// the same action grading itself requires), and the measured subrequest
// cost.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createAttempt,
  createBank,
  createCandidate,
  createTest,
  createUser,
  finishAttempt,
  getDraftVersion,
  latestVerdicts,
  newId,
  upsertQuestions,
} from "@pariksha/db";
import type { Question } from "@pariksha/core";
import {
  createApp,
  ROUTE_ACTIONS,
  ROUTE_AUTH,
  ROUTE_BUDGETS,
} from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import type { AppDeps } from "../src/app.js";
import type { PinnedLayout } from "../src/run/attempt.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { seedWorkspace } from "./run/fixtures.js";

const NOW = FIXED_NOW;

let deps: AppDeps;
let workspaceId: string;
let testId: string;
let testVersionId: string;
let layout: PinnedLayout;
let attemptId: string;

beforeAll(async () => {
  // A ticking clock, not the fixed one `testDeps()` defaults to: this file
  // records more than one verdict for the same attempt and has to tell
  // them apart by `at`, which a clock frozen at `FIXED_NOW` never would.
  let tick = NOW;
  ({ deps } = await testDeps({ now: () => tick++ }));
  workspaceId = await seedWorkspace(deps);
  const bankId = await createBank(deps.db, workspaceId, {
    name: "Review fixtures",
    now: NOW,
  });
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
  const { ids } = await upsertQuestions(
    deps.db,
    workspaceId,
    bankId,
    docs,
    NOW,
  );
  const [q1] = ids as [string];

  const test = await createTest(deps.db, workspaceId, {
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
  testId = test.id;
  const draft = await getDraftVersion(deps.db, workspaceId, testId);
  if (!draft) throw new Error("createTest did not seed a draft");
  testVersionId = draft.id;

  layout = {
    sections: [{ sectionId: "sec", questionIds: [q1], optionOrder: {} }],
    media: [],
    paper: [],
  };

  const candidateId = await createCandidate(deps.db, workspaceId, {
    testId,
    formValues: {},
    consentVersion: "1",
    now: NOW,
  });
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
  await finishAttempt(deps.db, workspaceId, {
    attemptId,
    submittedAt: NOW,
    reason: "candidate",
  });
});

afterAll(() => closeClient(deps.db));

describe("POST /api/v1/workspaces/:id/attempts/:attemptId/verdict", () => {
  let asReviewer = "";
  let asAuthor = "";
  let asOutsider = "";
  let otherWorkspaceId = "";

  beforeAll(async () => {
    const reviewerId = await createUser(deps.db, {
      email: "reviewer@alpha.test",
      authProvider: "magic_link",
      now: NOW,
    });
    await addMembership(deps.db, workspaceId, {
      userId: reviewerId,
      role: "reviewer",
      now: NOW,
    });
    asReviewer = await sessionCookie(
      deps,
      (await issueSession(deps, reviewerId)).token,
    );

    const authorId = await createUser(deps.db, {
      email: "author@alpha.test",
      authProvider: "magic_link",
      now: NOW,
    });
    await addMembership(deps.db, workspaceId, {
      userId: authorId,
      role: "author",
      now: NOW,
    });
    asAuthor = await sessionCookie(
      deps,
      (await issueSession(deps, authorId)).token,
    );

    otherWorkspaceId = await seedWorkspace(deps, "beta", "Beta Corp");
    const outsiderId = await createUser(deps.db, {
      email: "outsider@beta.test",
      authProvider: "magic_link",
      now: NOW,
    });
    await addMembership(deps.db, otherWorkspaceId, {
      userId: outsiderId,
      role: "owner",
      now: NOW,
    });
    asOutsider = await sessionCookie(
      deps,
      (await issueSession(deps, outsiderId)).token,
    );
  });

  const verdictUrl = (wsp: string, attempt = attemptId) =>
    `/api/v1/workspaces/${wsp}/attempts/${attempt}/verdict`;
  const post = (
    url: string,
    body: unknown,
    cookie: string,
    instance = createApp(deps),
  ) =>
    instance.request(url, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("admits an actor holding attempts.grade, and the verdict reads back as the latest", async () => {
    const res = await post(
      verdictUrl(workspaceId),
      { verdict: "suspicious", note: "Two tab switches" },
      asReviewer,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { reviewId: string };
    expect(body.reviewId).toMatch(/^rev_/);
    const verdicts = await latestVerdicts(deps.db, workspaceId, [attemptId]);
    expect(verdicts.get(attemptId)).toMatchObject({
      verdict: "suspicious",
      note: "Two tab switches",
    });
  });

  it("appends a second verdict rather than replacing the first — K16", async () => {
    await post(
      verdictUrl(workspaceId),
      { verdict: "clear", note: "Reviewed the recording, false alarm" },
      asReviewer,
    );
    const rows = await deps.db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM review WHERE workspace_id = ? AND attempt_id = ?",
      [workspaceId, attemptId],
    );
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(2);
    // The latest read now reflects the newer verdict, not the first.
    expect(
      (await latestVerdicts(deps.db, workspaceId, [attemptId])).get(attemptId),
    ).toMatchObject({ verdict: "clear" });
  });

  it("refuses an Author, who holds tests.edit and not attempts.grade", async () => {
    const res = await post(
      verdictUrl(workspaceId),
      { verdict: "clear" },
      asAuthor,
    );
    expect(res.status).toBe(403);
  });

  it("refuses a member of another workspace with 404", async () => {
    const res = await post(
      verdictUrl(workspaceId),
      { verdict: "clear" },
      asOutsider,
    );
    expect(res.status).toBe(404);
  });

  it("404s an attempt id that does not exist in this workspace", async () => {
    const res = await post(
      verdictUrl(workspaceId, newId("att")),
      { verdict: "clear" },
      asReviewer,
    );
    expect(res.status).toBe(404);
  });

  it("refuses an unrecognised verdict value", async () => {
    const res = await post(
      verdictUrl(workspaceId),
      { verdict: "guilty" },
      asReviewer,
    );
    expect(res.status).toBe(400);
  });

  it("every mounted endpoint declares its authority and action", () => {
    expect(
      ROUTE_AUTH["POST /api/v1/workspaces/:id/attempts/:attemptId/verdict"],
    ).toBe("workspace");
    expect(
      ROUTE_ACTIONS["POST /api/v1/workspaces/:id/attempts/:attemptId/verdict"],
    ).toBe("attempts.grade");
  });

  it("measures the real subrequest cost of the route, against a 300-candidate workspace", async () => {
    // K9/KG3: this route touches exactly one attempt, never the
    // workspace's whole candidate pool — proved, not merely asserted, by
    // seeding 300 idle candidates first and showing the cost does not
    // move.
    for (let i = 0; i < 300; i += 1) {
      await createCandidate(deps.db, workspaceId, {
        testId,
        formValues: {},
        consentVersion: "1",
        now: NOW,
      });
    }
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(
      verdictUrl(workspaceId),
      {
        method: "POST",
        headers: { cookie: asReviewer, "content-type": "application/json" },
        body: JSON.stringify({ verdict: "clear" }),
      },
    );
    expect(res.status, await res.clone().text()).toBe(200);
    // auth (2) + getAttempt (1, the 404 check) + recordVerdict's one
    // insert (1).
    expect(counting.counts().total).toBe(4);
    expect(
      ROUTE_BUDGETS["/api/v1/workspaces/:id/attempts/:attemptId/verdict"],
    ).toBe(4);
  });
});
