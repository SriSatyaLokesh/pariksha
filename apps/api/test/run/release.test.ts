// The release gate (#75, P6.11) — `AC-16` and `C-09`.
//
// **Asserted on what the response contains, never on what a browser does
// with it.** A payload that carries an answer key the candidate may not
// see is the vulnerability; a browser that renders less than it was given
// is a UI bug. So every assertion here is `not.toHaveProperty` or a
// substring scan over the serialised body — the shape of the thing that
// crossed the wire.

import { afterAll, beforeEach, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import type {
  AttemptScore,
  CountedAttempt,
  Question,
  ReleaseShow,
  ResponseValue,
  TestRelease,
} from "@pariksha/core";
import type { EmailMessage } from "../../src/email/adapter.js";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import { releasedResult, servedShow } from "../../src/run/release.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, seedPublishedTest } from "./fixtures.js";
import { seedAttemptTests, startAttemptFor } from "./paper-fixtures.js";

const T = FIXED_NOW;
let clock = T;

const { deps } = await testDeps({ now: () => clock });
let sent: EmailMessage[] = [];
deps.email = {
  send: async (message) => {
    sent.push(message);
    await Promise.resolve();
  },
};
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
await seedAttemptTests(deps, workspaceId);

afterAll(() => closeClient(deps.db));

beforeEach(() => {
  clock = T;
  sent = [];
});

const SUBMIT_PATH = "/api/v1/run/attempt/submit";
const CODE_PATH = "/api/v1/run/result/code";
const VERIFY_PATH = "/api/v1/run/result/verify";

const post = (path: string, body: unknown): Promise<Response> =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

interface Released {
  show: string;
  total: number;
  max: number;
  percent: number;
  passed: boolean | null;
  pending: string[];
  sections?: { sectionId: string; title: string; points: number; max: number }[];
  review?: { questionId: string; correct: unknown; explanation: string | null }[];
}

/** Start `alpha/<slug>`, answer its first question correctly, submit, and
 *  hand back the whole answer plus the cookie the result route rides. */
async function sit(
  slug: string,
  options: Parameters<typeof startAttemptFor>[3] = {},
): Promise<{ cookie: string; paper: AttemptPaper; released: Released | null }> {
  const started = await startAttemptFor(deps, app, slug, options);
  const paper = started.paper as AttemptPaper;
  const first = paper.sections[0]?.questions[0];
  if (first === undefined) throw new Error("the paper has no questions");
  const value: ResponseValue = { kind: "option", option: "a" };
  await app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie: started.cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId: first.id, value, clientSeq: 1 }),
  });
  const body = (await (
    await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie: started.cookie } })
  ).json()) as { released: Released | null };
  return { cookie: started.cookie, paper, released: body.released };
}

/** The release gate, read again on an attempt that is already submitted.
 *  `POST /attempt/submit` is idempotent and its answer is a superset of
 *  what `GET /attempt/result` used to return, so it is the one way back
 *  in — which is why that route was deleted rather than kept for this
 *  (final review, drift Important). */
const readAgain = async (cookie: string): Promise<Released | null> =>
  ((await (
    await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie } })
  ).json()) as { released: Released | null }).released;

// --- AC-16: the four levels ---------------------------------------------

it("AC-16: when=never carries nothing but the receipt", async () => {
  expect((await sit("rel-never")).released).toBeNull();
});

it("AC-16: score_only carries no sections key at all", async () => {
  const released = (await sit("rel-score")).released!;
  expect(released).toMatchObject({ show: "score_only", total: 2, max: 7, percent: 28.57 });
  expect(released).not.toHaveProperty("sections");
  expect(released).not.toHaveProperty("review");
});

it("AC-16: score_and_sections carries sections and no review key", async () => {
  const released = (await sit("rel-sections")).released!;
  expect(released.show).toBe("score_and_sections");
  expect(released.sections).toEqual([
    { sectionId: "logic", title: "Logic", points: 2, max: 5 },
    { sectionId: "quant", title: "Quant", points: 0, max: 2 },
  ]);
  expect(released).not.toHaveProperty("review");
});

it("AC-16: full_review carries the correct answer and the explanation, because that is what it means", async () => {
  const released = (await sit("rel-review")).released!;
  expect(released.show).toBe("full_review");
  expect(released.review?.[0]).toMatchObject({
    correct: "a",
    explanation: expect.stringContaining("Because"),
  });
  // Every question on the paper, not only the answered one.
  expect(released.review).toHaveLength(3);
});

it("S-10: a score_and_sections release carries no key, explanation or rubric anywhere in it", async () => {
  const text = JSON.stringify((await sit("rel-sections")).released);
  for (const leak of ["explanation", "correct", "rubric", "model_answer", "Because"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("AC-16: on_date shows nothing before `at`, and the result after it", async () => {
  const { cookie, released } = await sit("rel-later");
  expect(released).toBeNull();
  // The same attempt, a day later, read again — nothing was written in
  // between, so the gate is the clock and not a column.
  clock = T + DAY + 1;
  expect(await readAgain(cookie)).toMatchObject({ show: "score_only", total: 2 });
});

it("an on_date release with no date at all stays shut rather than opening immediately", async () => {
  // `Date.parse(undefined)` is NaN and every comparison against NaN is
  // false, so a naive `now < at` would release this on submit.
  const { cookie, released } = await sit("rel-undated");
  expect(released).toBeNull();
  // And still shut four hundred days later, which is what a naive
  // `now < at` would have opened on the very first read.
  clock = T + 400 * DAY;
  expect(await readAgain(cookie)).toBeNull();
});

// --- the gate is an allowlist -------------------------------------------
//
// `attempt.settings` is an unvalidated `unknown` cast of `settings_json`,
// so the publish schema is the only thing between a stored value and the
// two ladders in `release.ts`. These two assert the ladders directly
// rather than through the route: an off-enum value cannot be published,
// which is exactly why nothing above this line can reach the branch it
// would otherwise take.

const SCORE: AttemptScore = {
  perQuestion: { q1: { points: 2, max: 2, correct: true } },
  sections: [{ sectionId: "logic", points: 2, max: 2 }],
  total: 2,
  max: 2,
  percent: 100,
  passed: true,
  pending: [],
};

const KEYED: Question[] = [
  {
    id: "q1",
    type: "single",
    prompt: "Which?",
    options: [{ id: "a", text: "A" }],
    key: "a",
    scoring: { points: 2 },
    explanation: "Because the fixture says so.",
  },
];

/** A `release` block carrying a value the schema never minted. */
const odd = (block: Record<string, string>): TestRelease => block as unknown as TestRelease;

it("AC-16: a `show` the schema never minted carries no answer key", () => {
  // Before the allowlist this fell through to the `full_review` branch —
  // the one branch that carries `correct` and `explanation`.
  const released = releasedResult(
    odd({ when: "on_submit", show: "everything" }),
    SCORE,
    KEYED,
    {},
    T,
    0,
    { logic: "Logic" },
  );
  expect(released).not.toBeNull();
  expect(released).not.toHaveProperty("review");
  expect(JSON.stringify(released)).not.toContain("Because");
});

it("AC-16: a `when` the schema never minted releases nothing at all", () => {
  // Before the allowlist only `never` and `on_date` were stopped, so an
  // unrecognised `when` released on submit at whatever `show` asked for.
  expect(servedShow(odd({ when: "whenever", show: "full_review" }), 0, T)).toBeNull();
  expect(
    releasedResult(odd({ when: "whenever", show: "full_review" }), SCORE, KEYED, {}, T, 0),
  ).toBeNull();
});

// --- K6/K7: the counted figure ------------------------------------------
//
// `releasedResult`'s `counted` parameter is supplied by the caller (ruling
// 2) — there is no route to exercise here, only the gate's own decision of
// whether to disclose what the caller handed it. Called directly, exactly
// as the two allowlist tests above already do.

/** Two attempts: this one (72%) and a later, higher one (81%) — enough to
 *  tell `"highest"` from `"latest"` apart and to give the suppression test
 *  below something a real reader would actually see once it stops being
 *  suppressed (its own positive control, `E-R5`). */
const COUNTED_ATTEMPTS = [
  { attemptId: "att_1", percent: 72, submittedAt: T },
  { attemptId: "att_2", percent: 81, submittedAt: T + 60_000 },
];

function releasedResultFor(options: {
  attemptsRemaining: number;
  countedAttempt?: CountedAttempt;
  show?: ReleaseShow;
}): ReturnType<typeof releasedResult> {
  const release: TestRelease = { when: "on_submit", show: options.show ?? "score_only" };
  return releasedResult(
    release,
    SCORE,
    KEYED,
    {},
    T,
    options.attemptsRemaining,
    { logic: "Logic" },
    options.countedAttempt === undefined
      ? undefined
      : { mode: options.countedAttempt, attempts: COUNTED_ATTEMPTS },
  );
}

it("omits the counted figure while attempts remain", () => {
  const body = releasedResultFor({ attemptsRemaining: 1, countedAttempt: "highest" });
  expect(body).not.toHaveProperty("counted");
});

it("includes it on the last attempt — the control for the assertion above", () => {
  const body = releasedResultFor({ attemptsRemaining: 0, countedAttempt: "highest" });
  expect(body?.counted).toEqual({ percent: 81, attemptId: "att_2", of: 2 });
});

it("omits it when nothing is released at all, even on the last attempt", () => {
  // `release.when: "never"` carries nothing but the receipt — not even a
  // `show`, so there is no level for the counted figure to be "governed
  // by the same show as" (ruling 2). The whole body is null, which is a
  // stronger omission than a missing key.
  const body = releasedResult(
    { when: "never" },
    SCORE,
    KEYED,
    {},
    T,
    0,
    { logic: "Logic" },
    { mode: "highest", attempts: COUNTED_ATTEMPTS },
  );
  expect(body).toBeNull();
});

it("omits it under counted_attempt: latest, where it equals this attempt", () => {
  const body = releasedResultFor({ attemptsRemaining: 0, countedAttempt: "latest" });
  expect(body).not.toHaveProperty("counted");
});

it("omits it when no caller has supplied prior attempts at all", () => {
  // A test with no `counted_attempt` set (`submit.ts`'s `countedFor`
  // passes `undefined` in exactly this case) — `releasedResult` must still
  // answer with a complete, counted-free payload rather than throw.
  const body = releasedResultFor({ attemptsRemaining: 0 });
  expect(body).not.toHaveProperty("counted");
});

// --- K6/K7, live: the route itself reads prior attempts, only once -------
//
// The tests above prove `releasedResult` when handed data; they would not
// notice `apps/api/src/run/submit.ts` never actually reading any. This
// drives the real `/submit` route across two real attempts and checks the
// figure that comes back is a real prior attempt's, read through
// `attemptFiguresForCandidate` (`packages/db`) — not a stub, and not an
// echo of this attempt's own score.

it("K7, live: absent on attempt 1 of 2, and correct — naming the PRIOR attempt — on attempt 2", async () => {
  // The first attempt scores higher (both questions right); the second,
  // deliberately lower (one). If `counted` on the second response ever
  // matched *that* response's own `percent` instead of the first
  // attempt's, this would still pass by accident — scoring them apart is
  // what makes the assertion below mean "read a prior attempt" rather
  // than "echoed this one".
  const started = await startAttemptFor(deps, app, "rel-counted", { roll: "CTD" });
  const firstPaper = started.paper as AttemptPaper;
  const logicId = firstPaper.sections[0]!.questions[0]!.id;
  const quantId = firstPaper.sections[1]!.questions[0]!.id;
  const answerRight = (cookie: string, questionId: string) =>
    app.request(ANSWER_PATH, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        questionId,
        value: { kind: "option", option: "a" },
        clientSeq: 1,
      }),
    });

  await answerRight(started.cookie, logicId);
  await answerRight(started.cookie, quantId);
  const firstBody = (await (
    await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie: started.cookie } })
  ).json()) as { released: Released | null };
  expect(firstBody.released).not.toHaveProperty("counted");
  expect(firstBody.released?.percent).toBeCloseTo(57.14, 2);

  const second = await startAttemptFor(deps, app, "rel-counted", {
    candidateId: started.candidateId,
  });
  await answerRight(second.cookie, logicId);
  const secondBody = (await (
    await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie: second.cookie } })
  ).json()) as { released: Released | null };

  expect(secondBody.released?.percent).toBeCloseTo(28.57, 2);
  expect(secondBody.released?.counted).toEqual({
    percent: firstBody.released!.percent,
    attemptId: firstPaper.attemptId,
    of: 2,
  });
  // The exact subrequest cost is `submit.test.ts`'s own budget tests' job,
  // not this behavioural one's — see "the worst case — a counted_attempt
  // test's last attempt at full_review" below, and its submit.test.ts twin.
});

// --- the degrade ruling --------------------------------------------------

it("full_review degrades to score_and_sections while an attempt remains", async () => {
  const released = (await sit("rel-review-3", { roll: "DEGRADE" })).released!;
  expect(released).toMatchObject({ show: "score_and_sections" });
  expect(released.sections).toHaveLength(2);
  expect(released).not.toHaveProperty("review");
});

it("the degraded payload carries no key or explanation at all, not a hidden one", async () => {
  const text = JSON.stringify((await sit("rel-review-3", { roll: "DEGRADE-2" })).released);
  for (const leak of ["Because", "correct", "explanation", "review"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("full_review opens on the last attempt, and only then", async () => {
  const first = await sit("rel-review-3", { roll: "LAST" });
  expect(first.released).toMatchObject({ show: "score_and_sections" });
  const second = await sit("rel-review-3", { candidateId: await candidateOf(first.paper) });
  expect(second.released).toMatchObject({ show: "score_and_sections" });
  const third = await sit("rel-review-3", { candidateId: await candidateOf(first.paper) });
  expect(third.released).toMatchObject({ show: "full_review" });
  expect(third.released?.review).toHaveLength(3);
});

async function candidateOf(paper: AttemptPaper): Promise<string> {
  const rows = await deps.db.query<{ candidate_id: string }>(
    "SELECT candidate_id FROM attempt WHERE id = ?",
    [paper.attemptId],
  );
  return rows[0]!.candidate_id;
}

// --- the second read -----------------------------------------------------

it("the release gate answers a second read the same way it answered the first", async () => {
  // What `GET /attempt/result` was for. It returned a strict subset of
  // this answer behind a second copy of the release-gate read, for no
  // client — `exam.tsx` reloads through the idempotent submit because
  // the attempt number and the answered counts live on the receipt
  // alone.
  const { cookie, released: first } = await sit("rel-sections");
  expect(await readAgain(cookie)).toEqual(first);
});

it("the second read needs the attempt cookie", async () => {
  expect((await app.request(SUBMIT_PATH, { method: "POST" })).status).toBe(401);
});

// --- C-09: the return visit ---------------------------------------------

const EMAIL = "ananya@vce.ac.in";

/** A submitted attempt whose candidate carries `EMAIL` in their
 *  registration answers, which is what the code is checked against. */
async function sitWithEmail(slug = "rel-sections", email = EMAIL): Promise<string> {
  const roll = `MAIL${String(++mails)}`;
  const { paper } = await sit(slug, { roll });
  const rows = await deps.db.query<{ candidate_id: string }>(
    "SELECT candidate_id FROM attempt WHERE id = ?",
    [paper.attemptId],
  );
  await deps.db.run("UPDATE candidate SET form_values_json = ? WHERE id = ?", [
    deps.db.jsonParam({ roll, email }),
    rows[0]!.candidate_id,
  ]);
  return paper.attemptId;
}
let mails = 0;

const codeFrom = (): string => /\b(\d{6})\b/.exec(sent.at(-1)?.text ?? "")?.[1] ?? "";

it("C-09: a result code is emailed, is single-use, and answers the same gate", async () => {
  const ref = await sitWithEmail();
  expect((await post(CODE_PATH, { attemptRef: ref, email: EMAIL })).status).toBe(202);
  const code = codeFrom();
  expect(code).toMatch(/^\d{6}$/);

  const first = await post(VERIFY_PATH, { attemptRef: ref, email: EMAIL, code });
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ show: "score_and_sections", total: 2 });

  // Spent. A second use is refused even with the right code.
  expect((await post(VERIFY_PATH, { attemptRef: ref, email: EMAIL, code })).status).toBe(410);
});

it("C-09: the code expires in ten minutes", async () => {
  const ref = await sitWithEmail();
  await post(CODE_PATH, { attemptRef: ref, email: EMAIL });
  const code = codeFrom();
  clock = T + 10 * 60_000 + 1;
  expect((await post(VERIFY_PATH, { attemptRef: ref, email: EMAIL, code })).status).toBe(410);
});

it("C-09: a wrong email and an unknown reference answer identically, and send nothing", async () => {
  const ref = await sitWithEmail();
  const wrongEmail = await post(CODE_PATH, { attemptRef: ref, email: "stranger@vce.ac.in" });
  const wrongRef = await post(CODE_PATH, { attemptRef: "att_000000000000", email: EMAIL });
  expect(wrongEmail.status).toBe(wrongRef.status);
  expect(await wrongEmail.text()).toBe(await wrongRef.text());
  expect(sent).toHaveLength(0);
});

it("C-09: a code minted for one attempt does not open another", async () => {
  const mine = await sitWithEmail();
  const theirs = await sitWithEmail();
  await post(CODE_PATH, { attemptRef: mine, email: EMAIL });
  const code = codeFrom();
  expect((await post(VERIFY_PATH, { attemptRef: theirs, email: EMAIL, code })).status).toBe(410);
});

it("C-09: a never-released test answers the code route the same way and releases nothing", async () => {
  const ref = await sitWithEmail("rel-never");
  expect((await post(CODE_PATH, { attemptRef: ref, email: EMAIL })).status).toBe(202);
  const res = await post(VERIFY_PATH, { attemptRef: ref, email: EMAIL, code: codeFrom() });
  expect(res.status).toBe(200);
  expect(await res.json()).toBeNull();
});

it("S-07: the guess limiter is keyed on the attempt the reference resolved to", async () => {
  const ref = await sitWithEmail();
  await post(CODE_PATH, { attemptRef: ref, email: EMAIL });

  // A sweep of references never repeats one, so a bucket per *typed*
  // string counted to one forever while writing a permanent row per
  // request. An unknown reference now writes no row at all.
  await post(VERIFY_PATH, { attemptRef: "att_000000000000", email: EMAIL, code: "000000" });
  const buckets = async (): Promise<string[]> =>
    (await deps.db.query<{ bucket: string }>("SELECT bucket FROM rate_limit", [])).map(
      (row) => row.bucket,
    );
  expect(await buckets()).not.toContain("result_code:att_000000000000");

  // And guessing the six digits against a real one is bounded.
  for (let i = 0; i < 20; i++) {
    expect((await post(VERIFY_PATH, { attemptRef: ref, email: EMAIL, code: "000000" })).status).toBe(
      410,
    );
  }
  expect((await post(VERIFY_PATH, { attemptRef: ref, email: EMAIL, code: "000000" })).status).toBe(
    429,
  );
  expect(await buckets()).toContain(`result_code:${ref}`);
});

// --- the budgets ---------------------------------------------------------

it("every Task 11 route spends exactly its declared budget — the common case", async () => {
  // `rel-review`: `full_review`, no `counted_attempt` set. `/code` never
  // calls `resultFor` and costs the same regardless; `/verify` does, and
  // `countedFor` (`submit.ts`) spends nothing when `counted_attempt` is
  // unset, so its common-case cost stays at **6**, a literal rather than
  // `ROUTE_BUDGETS[VERIFY_PATH]` (7 — the worst case below) — so a
  // redundant read landing on this far more common path is still caught
  // even if the declared ceiling moves again.
  const budgetEmail = "budget@vce.ac.in";
  const ref = await sitWithEmail("rel-review", budgetEmail);
  const codeCount = countingDeps(deps);
  const codeApp = createApp({ ...codeCount.deps, email: deps.email });
  expect(
    (
      await codeApp.request(CODE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptRef: ref, email: budgetEmail }),
      })
    ).status,
  ).toBe(202);
  expect(codeCount.counts().total, CODE_PATH).toBe(ROUTE_BUDGETS[CODE_PATH]);

  const code = codeFrom();
  const verifyCount = countingDeps(deps);
  const verifyApp = createApp(verifyCount.deps);
  expect(
    (
      await verifyApp.request(VERIFY_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptRef: ref, email: budgetEmail, code }),
      })
    ).status,
  ).toBe(200);
  expect(verifyCount.counts().total, VERIFY_PATH).toBe(6);
});

it("every Task 11 route spends exactly its declared budget — the worst case", async () => {
  // `/verify` goes through `resultFor`, same as the finish page — so its
  // worst case is `rel-counted`'s **last** attempt (`full_review`, two
  // attempts, `counted_attempt: "highest"`), not `rel-review`'s only one.
  // `/code` does not call `resultFor` and costs the same either way.
  const budgetEmail = "worst-budget@vce.ac.in";
  const first = await sit("rel-counted", { roll: "BUDGET1" });
  const candidateId = await candidateOf(first.paper);
  await deps.db.run("UPDATE candidate SET form_values_json = ? WHERE id = ?", [
    deps.db.jsonParam({ roll: "BUDGET1", email: budgetEmail }),
    candidateId,
  ]);
  const second = await sit("rel-counted", { candidateId });
  const ref = second.paper.attemptId;

  const codeCount = countingDeps(deps);
  const codeApp = createApp({ ...codeCount.deps, email: deps.email });
  expect(
    (
      await codeApp.request(CODE_PATH, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptRef: ref, email: budgetEmail }),
      })
    ).status,
  ).toBe(202);
  expect(codeCount.counts().total, CODE_PATH).toBe(ROUTE_BUDGETS[CODE_PATH]);

  const code = codeFrom();
  const verifyCount = countingDeps(deps);
  const verifyApp = createApp(verifyCount.deps);
  const verifyRes = await verifyApp.request(VERIFY_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attemptRef: ref, email: budgetEmail, code }),
  });
  expect(verifyRes.status).toBe(200);
  // The worst case is real, not assumed: this is also the last attempt of
  // a `counted_attempt` test, so the body it actually paid 7 for carries
  // the figure.
  expect((await verifyRes.json()) as { counted?: unknown }).toHaveProperty("counted");
  expect(verifyCount.counts().total, VERIFY_PATH).toBe(ROUTE_BUDGETS[VERIFY_PATH]);
});
