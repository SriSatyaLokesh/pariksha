// Phase 8b Task 4 (`K17`/`K18`): regrade after a key change.
//
// `enqueueRegrade`/`regradeJob` are exercised directly (no HTTP), the same
// way `packages/db/test/repo/review.test.ts` exercises `recordVerdict`
// directly — this file is the mechanism end to end: the audit-log queue,
// the bounded batch, the submitted-only guard, and the one completion row.
// `describe("POST .../questions/:qid/regrade")` at the bottom is the one
// route this task mounts, including the 403/200 pair `KG2` asks for.
//
// `REGRADE_BATCH_SIZE` (30, `apps/api/src/grade/regrade.ts`) means a
// 300-attempt version takes **ten ticks** to drain, not one — `K18`'s whole
// point, and the reason a plain "brief" rescue in a single `regradeJob.run`
// call cannot also prove the 300-attempt scale: the two would contradict
// each other. Tests that need the full run drive the tick in a loop; tests
// that only need "did this tick stay under budget" or "did this attempt get
// picked up" use a fixture sized so one tick is the whole story.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  listAudit,
  newId,
  publishDraftVersion,
  upsertQuestion,
  upsertQuestions,
  upsertResponse,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import type { AppDeps } from "../../src/app.js";
import type { PinnedLayout } from "../../src/run/attempt.js";
import { enqueueRegrade, regradeJob, REGRADE_BATCH_SIZE } from "../../src/grade/regrade.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedWorkspace } from "../run/fixtures.js";

const NOW = FIXED_NOW;

let deps: AppDeps;
let workspaceId: string;

async function setFlag(attemptId: string, flag: string): Promise<void> {
  await deps.db.run("UPDATE attempt SET flag = ? WHERE workspace_id = ? AND id = ?", [flag, workspaceId, attemptId]);
}

/**
 * A fresh bank, question, published test version and `total` submitted
 * attempts against it — each its own test/bank/question so fixtures never
 * collide across `it()` blocks or interfere with each other's regrade
 * cycles. `points` of the `total` answer the question's *current* key
 * ("a"); the rest answer an option ("c") no key this test ever sets will
 * match, so changing the key only ever moves the first group's score.
 */
async function seedVersion(opts: { total: number; points: number }): Promise<{
  bankId: string;
  questionId: string;
  testVersionId: string;
  attemptIds: string[];
  doc: Question;
}> {
  const bankId = await createBank(deps.db, workspaceId, { name: `Regrade bank ${newId("bnk")}`, now: NOW });
  const doc: Question = {
    id: "q1",
    type: "single",
    prompt: "Pick",
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ],
    key: "a",
    scoring: { points: 2 },
  };
  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, [doc], NOW);
  const [questionId] = ids as [string];

  const test = await createTest(deps.db, workspaceId, {
    name: `Regrade test ${newId("tst")}`,
    slug: `regrade-${newId("tst")}`,
    now: NOW,
    body: {
      settings: {},
      sections: [{ id: "sec", title: "Section", source: { kind: "fixed", questions: [questionId] } }],
    },
  });
  const draft = await getDraftVersion(deps.db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");
  const testVersionId = draft.id;
  await publishDraftVersion(deps.db, workspaceId, test.id, NOW);

  const layout: PinnedLayout = {
    sections: [{ sectionId: "sec", questionIds: [questionId], optionOrder: {} }],
    media: [],
    paper: [],
  };

  const attemptIds: string[] = [];
  for (let i = 0; i < opts.total; i += 1) {
    const correct = i < opts.points;
    const candidateId = await createCandidate(deps.db, workspaceId, {
      testId: test.id,
      formValues: {},
      consentVersion: "1",
      now: NOW,
    });
    const attemptId = newId("att");
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
      questionId,
      value: correct ? "a" : "c",
      clientSeq: 1,
      savedAt: NOW,
    });
    const total = correct ? 2 : 0;
    await finishAttempt(deps.db, workspaceId, {
      attemptId,
      submittedAt: NOW,
      reason: "candidate",
      score: { total, max: 2, percent: (total / 2) * 100, passed: null, pending: [] },
    });
    attemptIds.push(attemptId);
  }

  return { bankId, questionId, testVersionId, attemptIds, doc };
}

/** The organiser's key edit: flips `q1`'s key from "a" to "b". Nobody in
 *  `seedVersion`'s fixture ever answers "b", so every attempt that scored
 *  on the old key now scores 0 — the one thing this file changes to make a
 *  regrade matter. */
async function changeKeyToB(bankId: string, doc: Question): Promise<void> {
  await upsertQuestion(deps.db, workspaceId, bankId, { ...doc, key: "b" }, NOW);
}

async function drainFully(): Promise<void> {
  let summary = "";
  do {
    ({ summary } = await regradeJob.run(deps));
  } while (!summary.includes("done") && summary !== "no regrades pending");
}

beforeAll(async () => {
  // A ticking clock, not the fixed one `testDeps()` defaults to:
  // `resolvePendingRegrades` orders and resolves audit rows by `at`, and a
  // frozen clock would stamp every enqueue, every batch tick and every
  // completion with the identical timestamp — the same reason
  // `review.test.ts` ticks for `latestVerdicts`.
  let tick = FIXED_NOW;
  ({ deps } = await testDeps({ now: () => tick++ }));
  workspaceId = await seedWorkspace(deps);
});

afterAll(() => closeClient(deps.db));

describe("enqueueRegrade / regradeJob", () => {
  it("rescores every submitted attempt of the version", async () => {
    const { bankId, testVersionId, attemptIds, doc } = await seedVersion({ total: 3, points: 1 });
    await changeKeyToB(bankId, doc);

    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await regradeJob.run(deps); // 3 attempts, one tick is the whole run

    const changedAttemptId = attemptIds[0]!;
    expect((await getAttempt(deps.db, workspaceId, changedAttemptId))!.scoreJson).toMatchObject({ total: 0 });
  });

  it("writes exactly one audit entry for the whole run", async () => {
    // `K17`/`AC-08`: 300 attempts, 12 of which answered under the key this
    // test is about to change — exactly the shape the brief's own fixture
    // size names. `REGRADE_BATCH_SIZE` (30) means this takes ten ticks,
    // which is `K18`'s whole point (see this file's header) — `drainFully`
    // drives them, and the assertion below is unchanged by how many ticks
    // it took.
    const { bankId, testVersionId, doc } = await seedVersion({ total: 300, points: 12 });
    await changeKeyToB(bankId, doc);

    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await drainFully();

    const rows = (await listAudit(deps.db, workspaceId, { limit: 1000 })).filter(
      (r) => r.action === "regrade" && r.target === testVersionId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ rescored: 300, changed: 12 });
  });

  it("skips an attempt that has not been submitted", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 2, points: 1 });

    // A live, unsubmitted attempt on the same version — `writeScores`'
    // guard (`K18`'s header, Task 1's CRITICAL) must leave it alone.
    const candidateId = await createCandidate(deps.db, workspaceId, {
      testId: newId("tst"), // not read back; only the attempt row matters here
      formValues: {},
      consentVersion: "1",
      now: NOW,
    });
    const liveAttemptId = newId("att");
    await createAttempt(deps.db, workspaceId, {
      id: liveAttemptId,
      candidateId,
      testVersionId,
      setNo: 1,
      layout: { sections: [], media: [], paper: [] },
      startedAt: NOW,
      deadlineAt: NOW + 3_600_000,
      tokenHash: newId("tok"),
    });

    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await regradeJob.run(deps);

    expect((await getAttempt(deps.db, workspaceId, liveAttemptId))!.scoreJson).toBeNull();
  });

  it("never clears scoring_blocked", async () => {
    const { bankId, testVersionId, attemptIds, doc } = await seedVersion({ total: 2, points: 1 });
    const attemptId = attemptIds[0]!;
    await setFlag(attemptId, "scoring_blocked");

    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await regradeJob.run(deps);

    expect((await getAttempt(deps.db, workspaceId, attemptId))!.flag).toBe("scoring_blocked");
  });

  it("rescores a bounded batch per tick and resumes on the next", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 300, points: 12 });
    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId: testVersionId, requestedBy: "usr_1", now: deps.now() });

    const first = await regradeJob.run(deps);
    expect(first.summary).toMatch(/\d+ of 300/);
    expect(first.summary).not.toContain("done"); // one tick never finishes 300 at a batch of 30

    // The progress cursor itself (`"regrade.batch"`'s own `rescoredSoFar`),
    // not a count derived from score content: which 12 of the 300 attempts
    // actually carry the changed total depends on where `id` ordering
    // happens to put them, so a content-based proxy can land in the first
    // batch, the last, or not move the visible total at all between two
    // ticks by chance. The cursor is unambiguous and is exactly what `K18`
    // claims resumes.
    async function progress(): Promise<number> {
      const rows = (await listAudit(deps.db, workspaceId, { limit: 1000 })).filter(
        (r) => r.action === "regrade.batch" && r.target === testVersionId,
      );
      const latest = rows[0]; // listAudit is newest-first
      return (latest?.detail as { rescoredSoFar?: number } | undefined)?.rescoredSoFar ?? 0;
    }

    const afterFirst = await progress();
    expect(afterFirst).toBe(REGRADE_BATCH_SIZE);

    await regradeJob.run(deps);

    const afterSecond = await progress();
    expect(afterSecond).toBe(REGRADE_BATCH_SIZE * 2);
    expect(afterSecond).toBeLessThan(300);
  });

  it("stays inside the subrequest ceiling on one tick", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 300, points: 12 });
    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });

    const counting = countingDeps(deps);
    await regradeJob.run(counting.deps);
    // `K18`'s whole reason, as an assertion: a tick over a 300-attempt
    // version — six times `REGRADE_BATCH_SIZE` — never approaches the
    // platform's 50-subrequest ceiling. Measured at 37 against this
    // fixture (`apps/api/src/grade/regrade.ts`'s own header does the
    // arithmetic).
    expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
  });
});

describe("POST /api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade", () => {
  let asReviewer = "";
  let asAuthor = "";
  let bankId = "";
  let questionId = "";

  beforeAll(async () => {
    const { bankId: b, questionId: q, doc } = await seedVersion({ total: 1, points: 0 });
    bankId = b;
    questionId = q;
    void doc;

    const reviewerId = await createUser(deps.db, { email: "reviewer@alpha.test", authProvider: "magic_link", now: NOW });
    await addMembership(deps.db, workspaceId, { userId: reviewerId, role: "reviewer", now: NOW });
    asReviewer = await sessionCookie(deps, (await issueSession(deps, reviewerId)).token);

    const authorId = await createUser(deps.db, { email: "author@alpha.test", authProvider: "magic_link", now: NOW });
    await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: NOW });
    asAuthor = await sessionCookie(deps, (await issueSession(deps, authorId)).token);
  });

  const url = () => `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}/regrade`;
  const post = (cookie: string, instance = createApp(deps)) =>
    instance.request(url(), { method: "POST", headers: { cookie } });

  it("admits a Reviewer, who holds attempts.grade — narrowest role, KG2", async () => {
    const res = await post(asReviewer);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { queued: number; versions: number };
    expect(body.versions).toBe(1);
    expect(body.queued).toBe(1);
  });

  it("refuses an Author, who holds banks.edit (the permission that saved the key) and not attempts.grade", async () => {
    const res = await post(asAuthor);
    expect(res.status).toBe(403);
  });

  it("every mounted endpoint declares its authority and action", () => {
    const path = "/api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade";
    expect(ROUTE_AUTH[`POST ${path}`]).toBe("workspace");
    expect(ROUTE_ACTIONS[`POST ${path}`]).toBe("attempts.grade");
  });

  it("measures the real subrequest cost of the route, against one matching published version", async () => {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(url(), { method: "POST", headers: { cookie: asReviewer } });
    expect(res.status, await res.clone().text()).toBe(200);
    // auth (2) + publishedVersionsForQuestion (1) + enqueueRegrade's own
    // count and audit write (2) = 5.
    expect(counting.counts().total).toBe(5);
    expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade"]).toBe(5);
  });
});

// `REGRADE_BATCH_SIZE` itself, pinned so a change to it is a reviewed diff
// rather than a number silently drifting out of the comment that explains
// it (`apps/api/src/grade/regrade.ts`'s own header).
it("REGRADE_BATCH_SIZE leaves real headroom under the subrequest ceiling", () => {
  expect(REGRADE_BATCH_SIZE).toBeLessThan(SUBREQUEST_LIMIT - 10);
});
