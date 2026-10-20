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
import type { ResponseValue } from "@pariksha/core";
import type { EmailMessage } from "../../src/email/adapter.js";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
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
const RESULT_PATH = "/api/v1/run/attempt/result";
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
  // The same attempt, a day later, through the result route — nothing was
  // written in between, so the gate is the clock and not a column.
  clock = T + DAY + 1;
  const res = await app.request(RESULT_PATH, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ show: "score_only", total: 2 });
});

it("an on_date release with no date at all stays shut rather than opening immediately", async () => {
  // `Date.parse(undefined)` is NaN and every comparison against NaN is
  // false, so a naive `now < at` would release this on submit.
  const { cookie, released } = await sit("rel-undated");
  expect(released).toBeNull();
  // And still shut four hundred days later, which is what a naive
  // `now < at` would have opened on the very first read.
  clock = T + 400 * DAY;
  expect(await (await app.request(RESULT_PATH, { headers: { cookie } })).json()).toBeNull();
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

// --- GET /attempt/result -------------------------------------------------

it("the result route answers the same gate the finish page was given", async () => {
  const { cookie, released } = await sit("rel-sections");
  const again = (await (await app.request(RESULT_PATH, { headers: { cookie } })).json()) as Released;
  expect(again).toEqual(released);
});

it("the result of an attempt that has not been submitted is refused, not invented", async () => {
  const started = await startAttemptFor(deps, app, "rel-score");
  const res = await app.request(RESULT_PATH, { headers: { cookie: started.cookie } });
  expect(res.status).toBe(409);
  expect((await res.json()).error.code).toBe("not_submitted");
});

it("the result route needs the attempt cookie", async () => {
  expect((await app.request(RESULT_PATH)).status).toBe(401);
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

// --- the budgets ---------------------------------------------------------

it("every Task 11 route spends exactly its declared budget", async () => {
  const review = await sit("rel-review", { roll: "BUDGET" });
  const counting = countingDeps(deps);
  const counted = createApp(counting.deps);
  expect((await counted.request(RESULT_PATH, { headers: { cookie: review.cookie } })).status).toBe(200);
  expect(counting.counts().total, RESULT_PATH).toBe(ROUTE_BUDGETS[RESULT_PATH]);

  // A fresh address: `email_code_address` allows five codes per inbox per
  // ten minutes, and the C-09 tests above have spent `EMAIL`'s.
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
  expect(verifyCount.counts().total, VERIFY_PATH).toBe(ROUTE_BUDGETS[VERIFY_PATH]);
});
