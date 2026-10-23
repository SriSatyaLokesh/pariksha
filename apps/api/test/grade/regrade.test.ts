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
//
// Branch review C1: the clock now advances **5 minutes per cron tick**
// (`tickCron`, below), not 1ms per `deps.now()` call. A 1ms-per-call clock
// never let a `"regrade.requested"` row's `REGRADE_LOOKBACK_MS` window
// actually expire mid-drain, which is exactly why the brief's own
// 300-attempt test could not catch C1 — ten simulated ticks took ten
// milliseconds, nowhere near the 30-minute window. With a real 5-minute
// step, draining 300 attempts spans a simulated 50 minutes (ten ticks),
// well past the six-tick window a request row alone is visible for — the
// "writes exactly one audit entry for the whole run" test below is now
// also C1's own regression test, and `resolvePendingRegrades`' two unit
// tests isolate the exact mechanism that keeps it passing.

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
  type DbClient,
  type RegradeAuditRow,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import type { AppDeps } from "../../src/app.js";
import type { PinnedLayout } from "../../src/run/attempt.js";
import {
  enqueueRegrade,
  regradeJob,
  resolvePendingRegrades,
  REGRADE_BATCH_SIZE,
  REGRADE_LOOKBACK_MS,
  REGRADE_TICK_SUBREQUESTS,
  REGRADE_TICK_SUBREQUESTS_MAX,
} from "../../src/grade/regrade.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedWorkspace } from "../run/fixtures.js";

const NOW = FIXED_NOW;
const CRON_STEP_MS = 5 * 60 * 1000;

let deps: AppDeps;
let workspaceId: string;
let clock: number;

/** Advances the clock one cron tick (5 minutes) — real production cadence,
 *  not the actual wall-clock speed of this test. See this file's header
 *  for why a frozen-per-call clock is what let C1 ship unnoticed. */
function tickCron(): void {
  clock += CRON_STEP_MS;
}

async function runTick(): Promise<{ summary: string }> {
  tickCron();
  return regradeJob.run(deps);
}

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
    ({ summary } = await runTick());
  } while (!summary.includes("done") && summary !== "no regrades pending");
}

beforeAll(async () => {
  // A ticking clock, not the fixed one `testDeps()` defaults to:
  // `resolvePendingRegrades` orders and resolves audit rows by `at`, and a
  // frozen clock would stamp every enqueue, every batch tick and every
  // completion with the identical timestamp — the same reason
  // `review.test.ts` ticks for `latestVerdicts`. `tickCron`/`runTick`
  // above are what actually move it, in 5-minute steps — see this file's
  // header.
  clock = FIXED_NOW;
  ({ deps } = await testDeps({ now: () => clock }));
  workspaceId = await seedWorkspace(deps);
});

afterAll(() => closeClient(deps.db));

describe("resolvePendingRegrades (branch review C1, pure)", () => {
  const base = { workspaceId: "wsp_1", target: "ver_1" };

  it("keeps a version pending on its own regrade.batch row once the request has aged out of the window", () => {
    // The request row is deliberately absent — `recentAuditRows` would not
    // return it once `at` falls outside the lookback window. Before the
    // fix, `resolvePendingRegrades` required a `"regrade.requested"` row
    // specifically and dropped the version here; `queued` now rides on the
    // batch row itself for exactly this case.
    const rows: RegradeAuditRow[] = [
      {
        ...base,
        action: "regrade.batch",
        at: 2000,
        detail: {
          testVersionId: "ver_1",
          cursor: "att_030",
          queued: 300,
          rescoredSoFar: 30,
          changedSoFar: 2,
          skippedSoFar: 0,
          changedAttemptIds: ["att_005"],
        },
      },
    ];
    const pending = resolvePendingRegrades(rows);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      workspaceId: "wsp_1",
      testVersionId: "ver_1",
      queued: 300,
      cursor: "att_030",
      rescoredSoFar: 30,
      changedSoFar: 2,
      changedAttemptIds: ["att_005"],
    });
  });

  it("drops a version once a regrade completion row exists at or after its anchor", () => {
    const rows: RegradeAuditRow[] = [
      {
        ...base,
        action: "regrade.batch",
        at: 2000,
        detail: { testVersionId: "ver_1", cursor: "att_030", queued: 300, rescoredSoFar: 30, changedSoFar: 2, skippedSoFar: 0, changedAttemptIds: [] },
      },
      { ...base, action: "regrade", at: 2500, detail: { testVersionId: "ver_1", rescored: 300, changed: 12, skipped: 0, staleVerdicts: 0 } },
    ];
    expect(resolvePendingRegrades(rows)).toEqual([]);
  });

  it("prefers the latest regrade.requested row over a stale batch row from an earlier, already-completed round", () => {
    const rows: RegradeAuditRow[] = [
      { ...base, action: "regrade.batch", at: 1000, detail: { testVersionId: "ver_1", cursor: "att_old", queued: 50, rescoredSoFar: 30, changedSoFar: 1, skippedSoFar: 0, changedAttemptIds: [] } },
      { ...base, action: "regrade", at: 1500, detail: { testVersionId: "ver_1", rescored: 50, changed: 1, skipped: 0, staleVerdicts: 0 } },
      { ...base, action: "regrade.requested", at: 2000, detail: { testVersionId: "ver_1", requestedBy: "usr_2", queued: 80 } },
    ];
    const pending = resolvePendingRegrades(rows);
    expect(pending).toHaveLength(1);
    // A fresh round: no cursor yet, `queued` is the new request's, not the
    // old round's stale 50.
    expect(pending[0]).toMatchObject({ queued: 80, cursor: undefined, rescoredSoFar: 0 });
  });
});

describe("enqueueRegrade / regradeJob", () => {
  it("rescores every submitted attempt of the version", async () => {
    const { bankId, testVersionId, attemptIds, doc } = await seedVersion({ total: 3, points: 1 });
    await changeKeyToB(bankId, doc);

    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await runTick(); // 3 attempts, one tick is the whole run

    const changedAttemptId = attemptIds[0]!;
    expect((await getAttempt(deps.db, workspaceId, changedAttemptId))!.scoreJson).toMatchObject({ total: 0 });
  });

  it("writes exactly one audit entry for the whole run — and is C1's own regression test", async () => {
    // `K17`/`AC-08`: 300 attempts, 12 of which answered under the key this
    // test is about to change — exactly the shape the brief's own fixture
    // size names. `REGRADE_BATCH_SIZE` (30) means this takes ten ticks,
    // which is `K18`'s whole point (see this file's header) — `drainFully`
    // drives them, each advancing the clock a real 5 minutes
    // (`tickCron`), so the full drain spans a simulated 50 minutes: past
    // the six ticks (30 minutes) a request row alone is visible for, and
    // therefore a live proof that C1's fix (a `"regrade.batch"` row
    // sustaining the version once the request ages out) actually holds —
    // not just a unit test of the mechanism in isolation.
    const { bankId, testVersionId, doc } = await seedVersion({ total: 300, points: 12 });
    await changeKeyToB(bankId, doc);

    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await drainFully();

    const rows = (await listAudit(deps.db, workspaceId, { limit: 1000 })).filter(
      (r) => r.action === "regrade" && r.target === testVersionId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ rescored: 300, changed: 12, skipped: 0 });
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
    await runTick();

    expect((await getAttempt(deps.db, workspaceId, liveAttemptId))!.scoreJson).toBeNull();
  });

  it("never clears scoring_blocked", async () => {
    const { bankId, testVersionId, attemptIds, doc } = await seedVersion({ total: 2, points: 1 });
    const attemptId = attemptIds[0]!;
    await setFlag(attemptId, "scoring_blocked");

    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    await runTick();

    expect((await getAttempt(deps.db, workspaceId, attemptId))!.flag).toBe("scoring_blocked");
  });

  it("rescores a bounded batch per tick and resumes on the next", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 300, points: 12 });
    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId: testVersionId, requestedBy: "usr_1", now: deps.now() });

    const first = await runTick();
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

    await runTick();

    const afterSecond = await progress();
    expect(afterSecond).toBe(REGRADE_BATCH_SIZE * 2);
    expect(afterSecond).toBeLessThan(300);

    // Cleanup, not assertion: this test deliberately stops two ticks into
    // a ten-tick drain. `resolvePendingRegrades` always works the oldest
    // pending version first (FIFO, by design), so an unfinished regrade
    // left behind here would silently absorb every later test's own
    // `runTick()` calls instead of their fresh fixtures.
    await drainFully();
  });

  it("stays inside the subrequest ceiling on one tick, at exactly the declared figure", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 300, points: 12 });
    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });

    const counting = countingDeps(deps);
    tickCron();
    await regradeJob.run(counting.deps);
    // Branch review MIN4: `toBeLessThanOrEqual(SUBREQUEST_LIMIT)` cannot
    // catch a regression from 7 to 49 — only from 51. Pinned to the exact
    // figure `REGRADE_TICK_SUBREQUESTS` (`apps/api/src/grade/regrade.ts`'s
    // own header arithmetic) declares, the same discipline `ROUTE_BUDGETS`
    // already holds every route to. `M6`'s fix (the bank read hoisted out
    // of the per-attempt loop) is what makes this flat regardless of batch
    // size — before it, this number was 37, not 7.
    expect(counting.counts().total).toBe(REGRADE_TICK_SUBREQUESTS);
    expect(REGRADE_TICK_SUBREQUESTS).toBeLessThanOrEqual(SUBREQUEST_LIMIT);

    // Cleanup, not assertion — see the same note in "resumes on the next".
    await drainFully();
  });

  it("stays inside the subrequest ceiling on the tick that completes a version", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 3, points: 1 });
    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });

    const counting = countingDeps(deps);
    tickCron();
    const result = await regradeJob.run(counting.deps);
    expect(result.summary).toContain("done");
    // One more than the common tick: `latestVerdicts` in place of nothing,
    // on top of the same fixed set — branch review MIN3 removed the extra
    // attempt-id re-read this used to also cost.
    expect(counting.counts().total).toBe(REGRADE_TICK_SUBREQUESTS_MAX);
  });

  it("branch review M1: folds a raced write into skipped rather than throwing or miscounting rescored", async () => {
    const { bankId, testVersionId, doc } = await seedVersion({ total: 3, points: 1 });
    await changeKeyToB(bankId, doc);
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });

    // Probes `writeScores`' asserted `{ updated }` (`regrade.ts`'s own
    // comment at the write site): a thin wrapper that lets every statement
    // run for real, then rewrites exactly one `UPDATE attempt SET
    // score_json` result to `{ changes: 0 }` — simulating a row that raced
    // out from under the batch between the read and this write, the bulk
    // shape of Task 1's CRITICAL. If the discarded-return regression ever
    // returns, `rescored` would read 3 with no `skipped` at all.
    let sabotaged = false;
    const racedDb: DbClient = {
      ...deps.db,
      batch: async (statements) => {
        const results = await deps.db.batch(statements);
        if (!sabotaged && statements.some((s) => s.sql.includes("UPDATE attempt SET score_json"))) {
          sabotaged = true;
          return results.map((r, i) => (i === 0 ? { changes: 0 } : r));
        }
        return results;
      },
    };

    tickCron();
    const result = await regradeJob.run({ ...deps, db: racedDb });
    expect(result.summary).toContain("done");
    expect(sabotaged).toBe(true);

    const rows = (await listAudit(deps.db, workspaceId, { limit: 1000 })).filter(
      (r) => r.action === "regrade" && r.target === testVersionId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ rescored: 3, skipped: 1 });
  });

  it("branch review M2: a grading-engine throw leaves the old score untouched instead of writing null", async () => {
    // Same technique `test/run/bounded.test.ts`'s "an ungradeable question
    // flags, not 500s" uses: a `multi_matching` document with no `key` at
    // all gets past authoring validation (nothing here runs it) and
    // reaches `gradeStructured`, which does `Object.values(q.key)` and
    // throws — the third case `blockedQuestions` cannot pre-scan for.
    const bankId = await createBank(deps.db, workspaceId, { name: `Ungradeable bank ${newId("bnk")}`, now: NOW });
    const malformed = {
      id: "mal-1",
      type: "multi_matching",
      prompt: "Match",
      left: ["L1"],
      right: ["R1", "R2"],
      scoring: { points: 2 },
    } as unknown as Question;
    const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, [malformed], NOW);
    const [questionId] = ids as [string];

    const test = await createTest(deps.db, workspaceId, {
      name: `Ungradeable test ${newId("tst")}`,
      slug: `ungradeable-${newId("tst")}`,
      now: NOW,
      body: { settings: {}, sections: [{ id: "sec", title: "Section", source: { kind: "fixed", questions: [questionId] } }] },
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
    const ORIGINAL_SCORE = { total: 2, max: 2, percent: 100, passed: null, pending: [] };
    await finishAttempt(deps.db, workspaceId, { attemptId, submittedAt: NOW, reason: "candidate", score: ORIGINAL_SCORE });

    // No key change needed — the question is ungradeable from the moment
    // it was authored; a regrade enqueued against it (e.g. for an
    // unrelated reason) must not wipe the candidate's existing score.
    await enqueueRegrade(deps.db, workspaceId, { testVersionId, requestedBy: "usr_1", now: deps.now() });
    tickCron();
    const result = await regradeJob.run(deps);
    expect(result.summary).toContain("done");

    // `submit.ts`'s own rule 3, matched in bulk: the old score survives.
    expect((await getAttempt(deps.db, workspaceId, attemptId))!.scoreJson).toMatchObject(ORIGINAL_SCORE);

    const rows = (await listAudit(deps.db, workspaceId, { limit: 1000 })).filter(
      (r) => r.action === "regrade" && r.target === testVersionId,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ rescored: 1, changed: 0, skipped: 1 });
  });

  it("REGRADE_LOOKBACK_MS and REGRADE_BATCH_SIZE together leave real headroom for a missed tick", () => {
    // A documentation-level guard, not a behavioural one: six ticks fit
    // inside the window with room for at least one missed tick before a
    // version with no active progress of its own would be at risk.
    expect(REGRADE_LOOKBACK_MS / CRON_STEP_MS).toBeGreaterThanOrEqual(6);
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

  it("measures the real subrequest cost of the route, flat in matched versions (branch review M5(a))", async () => {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(url(), { method: "POST", headers: { cookie: asReviewer } });
    expect(res.status, await res.clone().text()).toBe(200);
    // auth (2) + publishedVersionsForQuestion (1) +
    // countSubmittedAttemptsForVersions' one grouped count (1) +
    // appendAuditBatch's one batched write (1) = 5 — pinned exactly
    // (`MIN4`'s own discipline), and flat regardless of how many published
    // versions matched (M5(a): the old per-version loop cost 2 more per
    // match and was declared flat against a one-match fixture only).
    expect(counting.counts().total).toBe(5);
    expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade"]).toBe(5);
  });

  it("stays flat at 5 against two matching published versions, not 2 more per match", async () => {
    // A second published test drawing from the same bank via a `pool`
    // source — M5(a)'s own positive control: before the fix this would
    // have cost 7, not 5.
    const second = await createTest(deps.db, workspaceId, {
      name: `Regrade second ${newId("tst")}`,
      slug: `regrade-second-${newId("tst")}`,
      now: NOW,
      body: { settings: {}, sections: [{ id: "sec", title: "Section", source: { kind: "pool", bank: bankId, count: 1 } }] },
    });
    await publishDraftVersion(deps.db, workspaceId, second.id, NOW);

    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(url(), { method: "POST", headers: { cookie: asReviewer } });
    const body = (await res.clone().json()) as { queued: number; versions: number };
    expect(res.status, await res.text()).toBe(200);
    expect(body.versions).toBe(2);
    expect(counting.counts().total).toBe(5);
  });
});
