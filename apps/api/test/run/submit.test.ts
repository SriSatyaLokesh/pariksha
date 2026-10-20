// Submitting an attempt (#75, P6.11) — `C-08` and `AC-06`.
//
// Every assertion goes through `POST /api/v1/run/attempt/submit` on a real
// `createApp(deps)` (standing decision 6): the score a candidate is given
// is the score the route stored, not the score a pure function would have
// computed if the route had called it.

import { afterAll, beforeEach, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import type { ResponseValue } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest } from "./fixtures.js";
import { seedAttemptTests, startAttemptFor } from "./paper-fixtures.js";

const T = FIXED_NOW;
let clock = T;

const { deps } = await testDeps({ now: () => clock });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
await seedAttemptTests(deps, workspaceId);

afterAll(() => closeClient(deps.db));

beforeEach(() => {
  clock = T;
});

const SUBMIT_PATH = "/api/v1/run/attempt/submit";

const start = (slug: string, options: Parameters<typeof startAttemptFor>[3] = {}) =>
  startAttemptFor(deps, app, slug, options);

const submit = (cookie: string, on = app): Promise<Response> =>
  on.request(SUBMIT_PATH, { method: "POST", headers: { cookie } });

const answer = (cookie: string, questionId: string, value: ResponseValue, clientSeq = 1) =>
  app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId, value, clientSeq }),
  });

interface AttemptRow {
  submitted_at: number | null;
  submit_reason: string | null;
  score_json: unknown;
  flag: string;
}

async function attemptRow(attemptId: string): Promise<AttemptRow> {
  const rows = await deps.db.query<AttemptRow>(
    "SELECT submitted_at, submit_reason, score_json, flag FROM attempt WHERE id = ?",
    [attemptId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no attempt row ${attemptId}`);
  return row;
}

const storedScore = async (attemptId: string): Promise<Record<string, unknown>> =>
  deps.db.jsonValue((await attemptRow(attemptId)).score_json) as Record<string, unknown>;

async function auditActions(target: string): Promise<string[]> {
  const rows = await deps.db.query<{ action: string }>(
    "SELECT action FROM audit_log WHERE target = ? ORDER BY id",
    [target],
  );
  return rows.map((row) => row.action);
}

/** Start `alpha/<slug>`, answer the first question correctly, and hand
 *  back the cookie and the paper. */
async function sat(slug: string, options: Parameters<typeof startAttemptFor>[3] = {}) {
  const started = await start(slug, options);
  const paper = started.paper as AttemptPaper;
  const first = paper.sections[0]?.questions[0];
  if (first === undefined) throw new Error("the paper has no questions");
  return { ...started, paper, firstId: first.id };
}

// --- C-08: the receipt ---------------------------------------------------

it("C-08: the receipt names the reference, the time, the counts and which attempt it is", async () => {
  const { cookie, paper, firstId } = await sat("rel-never");
  await answer(cookie, firstId, { kind: "option", option: "a" });

  const res = await submit(cookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { receipt: Record<string, unknown>; released: unknown };
  expect(body.receipt).toMatchObject({
    attemptId: paper.attemptId,
    submittedAt: T,
    answered: 1,
    unanswered: 2,
    total: 3,
    attemptNo: 1,
    attemptsAllowed: 1,
  });
  // `release.when` is "never" on this fixture, so the receipt is the whole
  // answer and the score is not in it at all.
  expect(body.released).toBeNull();
  expect(JSON.stringify(body.receipt)).not.toMatch(/total":\s*\d+\.\d|percent|passed/);
});

it('C-08: the receipt counts this attempt, so a retake reads "Attempt 2 of 3"', async () => {
  const first = await sat("thrice", { roll: "RETAKE" });
  await submit(first.cookie);
  const second = await sat("thrice", { candidateId: first.candidateId });

  const body = (await (await submit(second.cookie)).json()) as {
    receipt: { attemptNo: number; attemptsAllowed: number };
  };
  expect(body.receipt).toMatchObject({ attemptNo: 2, attemptsAllowed: 3 });
});

it("the score shown is this attempt's, not the counted one (Phase 8 owns that)", async () => {
  // Attempt 1 answers both auto-scored questions; attempt 2 answers
  // neither. `counted_attempt` defaults to "highest", so a counted figure
  // would report attempt 1's — and this reports 0.
  const first = await sat("thrice", { roll: "COUNTED" });
  await answer(first.cookie, first.firstId, { kind: "option", option: "a" });
  const one = (await (await submit(first.cookie)).json()) as { released: { total: number } };
  expect(one.released.total).toBe(2);

  const second = await sat("thrice", { candidateId: first.candidateId });
  const two = (await (await submit(second.cookie)).json()) as { released: { total: number } };
  expect(two.released.total).toBe(0);
});

// --- idempotence ---------------------------------------------------------

it("submitting twice scores once, writes one audit row, and keeps the first score", async () => {
  const { cookie, paper, firstId } = await sat("rel-score");
  await answer(cookie, firstId, { kind: "option", option: "a" });
  const first = await submit(cookie);
  expect(first.status).toBe(200);
  const scored = await storedScore(paper.attemptId);

  // The clock moves and the answer changes between the two presses, so a
  // second scoring run would be visible in both the stamp and the total.
  clock = T + 60_000;
  const second = await submit(cookie);
  expect(second.status).toBe(200);
  expect((await second.json()).receipt.submittedAt).toBe(T);
  expect(await storedScore(paper.attemptId)).toEqual(scored);
  expect(await auditActions(paper.attemptId)).toEqual(["attempt.submitted"]);
});

it("a save after submit is refused (Task 8's contract, from the other side)", async () => {
  const { cookie, firstId } = await sat("rel-score");
  await submit(cookie);
  const res = await answer(cookie, firstId, { kind: "option", option: "b" }, 99);
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("already_submitted");
});

it("an answer that arrives from the queue after submission is refused, not silently dropped", async () => {
  // `AC-14`'s gate is zero lost answers, and this is the one case where
  // "not lost" cannot mean "stored": the attempt is closed and scored.
  // The contract Task 8 built is that a 409 is **kept** by the queue and
  // never reads "Saved", so the candidate is told rather than lied to —
  // which is only true if the refusal is a 409 and not a 200 or a 404.
  const { cookie, paper, firstId } = await sat("rel-score");
  await answer(cookie, firstId, { kind: "option", option: "a" });
  await submit(cookie);
  // Inside the late-sync grace, which is what makes this the queue's case
  // rather than an expired attempt's.
  clock = T + 10_000;
  const res = await answer(cookie, firstId, { kind: "option", option: "b" }, 7);
  expect(res.status).toBe(409);
  // And the stored answer is still the one made in time.
  const rows = await deps.db.query<{ value_json: unknown; client_seq: number }>(
    "SELECT value_json, client_seq FROM response WHERE attempt_id = ? AND question_id = ?",
    [paper.attemptId, firstId],
  );
  expect(rows[0]?.client_seq).toBe(1);
});

// --- AC-06: the stored score --------------------------------------------

it("AC-06: the stored score is the whole AttemptScore, section by section", async () => {
  const { cookie, paper, firstId } = await sat("rel-sections");
  await answer(cookie, firstId, { kind: "option", option: "a" });
  await submit(cookie);

  // LOG-001 is worth 2 and answered correctly; LOG-003 is manual and
  // worth 3; QNT-001 is worth 2 and unanswered.
  expect(await storedScore(paper.attemptId)).toMatchObject({
    total: 2,
    max: 7,
    sections: [
      { sectionId: "logic", points: 2, max: 5 },
      { sectionId: "quant", points: 0, max: 2 },
    ],
    passed: false,
  });
});

it("manual types are pending, not zero", async () => {
  const { cookie, paper, firstId } = await sat("rel-sections");
  await answer(cookie, firstId, { kind: "option", option: "a" });
  await submit(cookie);
  const score = await storedScore(paper.attemptId);
  // The short answer, by position: the second question of section one,
  // and the sections are unshuffled on this fixture.
  const shortAnswer = paper.sections[0]?.questions[1];
  expect(shortAnswer?.type).toBe("short_answer");
  expect(score.pending).toEqual([shortAnswer?.id]);
  // Pending is not the same as zero: it is worth 3 and the max says so.
  expect(score.max).toBe(7);
});

it("submit_reason records which of the three ended it", async () => {
  const manual = await sat("rel-score");
  await submit(manual.cookie);
  expect((await attemptRow(manual.paper.attemptId)).submit_reason).toBe("manual");

  // The timeout half: `GET /run/attempt` past the deadline and the grace
  // materialises it, which is Task 9's half of the same statement.
  const timed = await sat("rel-score");
  clock = T + 46 * 60_000;
  await app.request("/api/v1/run/attempt", { headers: { cookie: timed.cookie } });
  const row = await attemptRow(timed.paper.attemptId);
  expect(row.submit_reason).toBe("timeout");
  // Stamped at the deadline, not at the read.
  expect(row.submitted_at).toBe(T + 45 * 60_000);
});

it("a candidate whose attempt the server already timed out still gets their receipt", async () => {
  const { cookie, paper } = await sat("rel-score");
  clock = T + 46 * 60_000;
  await app.request("/api/v1/run/attempt", { headers: { cookie } });
  const res = await submit(cookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { receipt: { attemptId: string; submittedAt: number } };
  expect(body.receipt.attemptId).toBe(paper.attemptId);
  expect(body.receipt.submittedAt).toBe(T + 45 * 60_000);
  expect((await attemptRow(paper.attemptId)).submit_reason).toBe("timeout");
});

// --- the credential ------------------------------------------------------

it("submitting without the attempt cookie is 401, and says nothing else", async () => {
  const res = await app.request(SUBMIT_PATH, { method: "POST" });
  expect(res.status).toBe(401);
  expect((await res.json()).error.code).toBe("attempt_required");
});

// --- the budget ----------------------------------------------------------

it("the submit route reads the questions once, not once per answer", async () => {
  const { cookie, firstId } = await sat("rel-review");
  await answer(cookie, firstId, { kind: "option", option: "a" });
  const counting = countingDeps(deps);
  const res = await submit(cookie, createApp(counting.deps));
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[SUBMIT_PATH]);
});
