// Navigation modes, enforced server-side (#74, P6.10) — `AC-15`.
//
// **The attack is a candidate scripting `PUT /run/attempt/answer`.** The
// whole paper is in their browser before the network drops — `AC-14`
// requires it — so withholding later questions was never available, and
// `T-13` never asked for it: `linear` is "no going back", `per_section` is
// "free inside a section, locked once left". Both forbid *returning*, and
// returning is a write.
//
// So every assertion here drives the **route** with a hand-built body,
// never `assertReachable` on its own: a rule enforced only in the
// component that draws the Previous button is not enforced at all, which
// is exactly what `AC-15`'s "either through the interface or through the
// API" is about.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import type { ResponseValue } from "@pariksha/core";
import { createApp, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest } from "./fixtures.js";
import { seedAttemptTests } from "./paper-fixtures.js";

const T = FIXED_NOW;

/** Injected, so the one test that needs time to have run can move it
 *  without a second database. */
let clock = T;

const { deps } = await testDeps({ now: () => clock });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
const q = await seedAttemptTests(deps, workspaceId);

/** A real question, in this workspace and this bank, on **no** pinned
 *  paper of the tests below. */
const NOT_MINE = q["SET-E1"] as string;

const chose = (option: string): ResponseValue => ({ kind: "option", option });

afterAll(() => closeClient(deps.db));

// --- helpers -------------------------------------------------------------

let serial = 1;

interface Sat {
  cookie: string;
  paper: AttemptPaper;
  /** Every question id in presentation order — the order `max_index`
   *  counts in, taken off the paper the server actually answered with. */
  flat: string[];
}

async function start(slug: string): Promise<Sat> {
  const test = await resolvePublishedTest(deps.db, "alpha", slug, T);
  if (!test) throw new Error(`no published test at alpha/${slug}`);
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await app.request(`/api/v1/run/alpha/${slug}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  const paper = (await res.json()) as AttemptPaper;
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    paper,
    flat: paper.sections.flatMap((section) => section.questions.map((one) => one.id)),
  };
}

function putOn(
  sat: Sat,
  body: { questionId: string; clientSeq: number; value?: ResponseValue | null },
  on = app,
): Promise<Response> {
  return on.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie: sat.cookie, "content-type": "application/json" },
    body: JSON.stringify({ value: chose("a"), ...body }),
  });
}

const errorOf = async (res: Response): Promise<{ code: string; message: string }> =>
  ((await res.json()) as { error: { code: string; message: string } }).error;

const resume = async (sat: Sat): Promise<AttemptPaper> =>
  (await (
    await app.request("/api/v1/run/attempt", { headers: { cookie: sat.cookie } })
  ).json()) as AttemptPaper;

async function maxIndexOf(attemptId: string): Promise<number> {
  const rows = await deps.db.query<{ max_index: number }>(
    "SELECT max_index FROM attempt WHERE id = ?",
    [attemptId],
  );
  return Number(rows[0]?.max_index);
}

async function storedFor(attemptId: string, questionId: string): Promise<unknown> {
  const rows = await deps.db.query<{ value_json: unknown }>(
    "SELECT value_json FROM response WHERE attempt_id = ? AND question_id = ?",
    [attemptId, questionId],
  );
  return rows[0] === undefined ? null : deps.db.jsonValue(rows[0].value_json);
}

let linear: Sat;

beforeEach(async () => {
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM auth_token", []);
  clock = T;
  // `alpha/paper` is the `linear` fixture: five fixed questions then a
  // pool of ten, fifteen in all.
  linear = await start("paper");
});

// --- AC-15: linear --------------------------------------------------------

it("AC-15: linear — the API refuses a write to an earlier question, with the rule named", async () => {
  expect((await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 })).status).toBe(200);

  const back = await putOn(linear, { questionId: linear.flat[1] as string, clientSeq: 2 });
  expect(back.status).toBe(403);
  expect(await errorOf(back)).toMatchObject({
    code: "navigation_locked",
    message: expect.stringMatching(/going back/i) as unknown as string,
  });
});

it("AC-15: linear — the refused write stores nothing", async () => {
  await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 });
  await putOn(linear, { questionId: linear.flat[1] as string, value: chose("c"), clientSeq: 2 });

  expect(await storedFor(linear.paper.attemptId, linear.flat[1] as string)).toBeNull();
});

it("linear allows re-editing the question the candidate is on, and moving forward", async () => {
  await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 });
  expect(
    (await putOn(linear, { questionId: linear.flat[3] as string, value: chose("b"), clientSeq: 3 }))
      .status,
  ).toBe(200);
  expect((await putOn(linear, { questionId: linear.flat[9] as string, clientSeq: 4 })).status).toBe(200);
});

it("AC-15: the lock survives a browser restart — a resume reports it and still refuses", async () => {
  await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 });

  // A new browser carries only the cookie; everything else it knows comes
  // from this payload. `max_index` is on the row, not in the tab.
  const resumed = await resume(linear);
  expect(resumed.maxIndex).toBe(await maxIndexOf(linear.paper.attemptId));
  expect(resumed.maxIndex).toBe(3);
  expect(resumed.navigation).toBe("linear");

  expect((await putOn(linear, { questionId: linear.flat[0] as string, clientSeq: 10 })).status).toBe(403);
});

it("max_index never falls, so a resume cannot reopen a locked question", async () => {
  await putOn(linear, { questionId: linear.flat[6] as string, clientSeq: 1 });
  const before = await maxIndexOf(linear.paper.attemptId);

  // A save at the question the candidate is already on: allowed, and it
  // must not drag the lock backwards.
  await putOn(linear, { questionId: linear.flat[before] as string, clientSeq: 9 });
  expect(await maxIndexOf(linear.paper.attemptId)).toBe(before);
});

// --- per_section ----------------------------------------------------------

it("per_section: free inside the current section, refused for a section already left", async () => {
  // `alpha/per-section` is three questions then three more, **both
  // timed** — which is also what pins `assertSectionOpen`'s earlier-section
  // rule to `free` alone. Dropping that gate makes this write a 409
  // `section_over` instead of the 403 the candidate was told about on the
  // landing page, and this assertion is what says so.
  const sat = await start("per-section");
  const [, , lastOfSectionOne, firstOfSectionTwo, secondOfSectionTwo] = sat.flat as string[];

  expect((await putOn(sat, { questionId: firstOfSectionTwo as string, clientSeq: 5 })).status).toBe(200);
  // Backwards *inside* the new section is fine — per_section is free
  // inside the section you are in, which is the half `linear` does not
  // have.
  expect((await putOn(sat, { questionId: secondOfSectionTwo as string, clientSeq: 6 })).status).toBe(200);
  expect((await putOn(sat, { questionId: firstOfSectionTwo as string, clientSeq: 7 })).status).toBe(200);

  const back = await putOn(sat, { questionId: lastOfSectionOne as string, clientSeq: 8 });
  expect(back.status).toBe(403);
  expect((await errorOf(back)).message).toMatch(/section you have already left/i);
});

it("per_section: every question of the section the candidate is in stays writable", async () => {
  const sat = await start("per-section");
  for (const [at, questionId] of sat.flat.slice(0, 3).entries()) {
    expect((await putOn(sat, { questionId, clientSeq: at + 1 })).status).toBe(200);
  }
  // Even after reaching the last of the three, the first is still open.
  expect((await putOn(sat, { questionId: sat.flat[0] as string, clientSeq: 9 })).status).toBe(200);
});

// --- free -----------------------------------------------------------------

it("free allows any order", async () => {
  const sat = await start("free-nav");
  for (const [at, questionId] of [sat.flat[5], sat.flat[0], sat.flat[4]].entries()) {
    expect((await putOn(sat, { questionId: questionId as string, clientSeq: at + 1 })).status).toBe(200);
  }
  expect(await storedFor(sat.paper.attemptId, sat.flat[0] as string)).not.toBeNull();
});

it("free still tracks max_index, because the section clock is derived from it", async () => {
  const sat = await start("free-nav");
  await putOn(sat, { questionId: sat.flat[5] as string, clientSeq: 1 });
  expect(await maxIndexOf(sat.paper.attemptId)).toBe(5);
  await putOn(sat, { questionId: sat.flat[0] as string, clientSeq: 2 });
  expect(await maxIndexOf(sat.paper.attemptId)).toBe(5);
});

// --- the two refusals are deliberately different -------------------------

it("a question outside the pinned layout is 404, never 403 — existence is not disclosed", async () => {
  await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 });

  const theirs = await putOn(linear, { questionId: NOT_MINE, clientSeq: 2 });
  const mine = await putOn(linear, { questionId: linear.flat[1] as string, clientSeq: 3 });

  expect(theirs.status).toBe(404);
  expect(mine.status).toBe(403); // the two are distinguishable, deliberately
  // `S-10`: the 404 names nothing at all.
  expect(await theirs.text()).not.toMatch(/paper|layout|question|bank|section/i);
  // And the question it refused really is a question, in this workspace.
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM question WHERE id = ? AND workspace_id = ?",
    [NOT_MINE, workspaceId],
  );
  expect(Number(rows[0]?.n)).toBe(1);
});

it("time outranks navigation: an expired attempt says so rather than complaining about order", async () => {
  // Both rules refuse this write — it is behind the lock AND past the
  // deadline. The candidate must be told the one that matters, which is
  // why the route checks time first.
  await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 });
  clock = T + 46 * 60_000;

  const refused = await putOn(linear, { questionId: linear.flat[0] as string, clientSeq: 2 });
  expect(refused.status).toBe(409);
  expect((await errorOf(refused)).code).toBe("time_up");
});

it("and the navigation refusal is a 403, which the queue keeps exactly as it keeps a 409", async () => {
  // Review Focus 3: Task 8's queue classifies 403 and 409 alike as
  // `refused` — kept, surfaced, and never shown as Saved. A navigation
  // refusal that arrived as anything else would be dropped as a save
  // that never happened.
  await putOn(linear, { questionId: linear.flat[3] as string, clientSeq: 1 });
  const back = await putOn(linear, { questionId: linear.flat[0] as string, clientSeq: 2 });

  expect(back.status).toBe(403);
  // The three lines that used to follow — `>= 400`, `< 500`, `not 404` —
  // are tautologies after the assertion above. They could not fail and
  // made the test read as broader coverage than it has.
});

// --- the budget -----------------------------------------------------------

it("max_index rises inside the same batch, so the save's budget does not move", async () => {
  const counting = countingDeps(deps);
  const res = await putOn(
    linear,
    { questionId: linear.flat[6] as string, clientSeq: 8 },
    createApp(counting.deps),
  );

  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[ANSWER_PATH]);
  expect(counting.counts().db).toBe(2);
  expect(counting.counts().storage).toBe(0);
  expect(await maxIndexOf(linear.paper.attemptId)).toBe(6);
});

it("the re-edit path costs the same two and writes no progress statement", async () => {
  await putOn(linear, { questionId: linear.flat[6] as string, clientSeq: 1 });
  const counting = countingDeps(deps);
  await putOn(
    linear,
    { questionId: linear.flat[6] as string, value: chose("b"), clientSeq: 2 },
    createApp(counting.deps),
  );
  expect(counting.counts().db).toBe(2);
});

it("the budget is still declared at exactly 2, and the authority is still the attempt", () => {
  expect(ROUTE_BUDGETS[ANSWER_PATH]).toBe(2);
  expect(ROUTE_AUTH[`PUT ${ANSWER_PATH}`]).toBe("attempt");
});
