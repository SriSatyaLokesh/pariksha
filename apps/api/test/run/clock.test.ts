// The server's clock (#73, P6.9) — `AC-13`'s first half and `C-07`.
//
// Everything here is asserted **through the route**, never against
// `clockOf` on its own (standing decision 6): the browser's countdown is a
// display and the server's reading is the rule, so a test that called the
// pure function would prove the arithmetic and nothing about whether the
// rule is mounted.
//
// Four separate deadlines are in play and the tests below exist mostly to
// keep them apart:
//
//  * `deadline_at + late_sync_grace_seconds` — the only one a *write* is
//    judged by. 29 s late is in, 31 s late is out, and the 30 comes off
//    the published version rather than off a constant.
//  * the **section** deadline, which gets the same grace, because an
//    answer queued offline across a section boundary must not be refused
//    for ever.
//  * `latest_start_at` — `/start`'s rule, and nobody else's.
//  * `deriveState(...) === "open"` — **entry only.** A test whose window
//    has shut must still take the late answers `AC-14` promised, and the
//    test that proves it is the one that would otherwise never be written.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import type { ResponseValue } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest } from "./fixtures.js";
import { seedAttemptTests } from "./paper-fixtures.js";

const T = FIXED_NOW;
const MINUTE = 60_000;

/** The injected clock. Every test that moves time moves this. */
let clock = T;

const { deps } = await testDeps({ now: () => clock });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
const q = await seedAttemptTests(deps, workspaceId);

const LOG1 = q["LOG-001"] as string;

const chose = (option: string): ResponseValue => ({ kind: "option", option });

afterAll(() => closeClient(deps.db));

// --- helpers -------------------------------------------------------------

let serial = 1;

async function start(slug = "paper"): Promise<{ cookie: string; paper: AttemptPaper }> {
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
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    paper: (await res.json()) as AttemptPaper,
  };
}

interface Save {
  questionId?: string;
  value?: ResponseValue | null;
  clientSeq?: number;
  /** A lying client. The handler must never read it; it is here so that
   *  "the server ignores the client clock" is an assertion and not a
   *  statement about code nobody sent anything to. */
  clientNow?: number;
}

function put(body: Save = {}, cookie = mine.cookie, on = app): Promise<Response> {
  return on.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId: LOG1, value: chose("a"), clientSeq: 1, ...body }),
  });
}

const resumeOn = async (cookie: string, on = app): Promise<Response> =>
  on.request("/api/v1/run/attempt", { headers: { cookie } });

const resume = async (cookie = mine.cookie): Promise<AttemptPaper> =>
  (await (await resumeOn(cookie)).json()) as AttemptPaper;

const errorOf = async (res: Response): Promise<{ code: string; message: string; details?: unknown }> =>
  ((await res.json()) as { error: { code: string; message: string; details?: unknown } }).error;

interface AttemptRow {
  submitted_at: number | null;
  submit_reason: string | null;
  section_started_at: number | null;
  max_index: number;
}

async function attemptRow(attemptId: string): Promise<AttemptRow> {
  const rows = await deps.db.query<AttemptRow>(
    "SELECT submitted_at, submit_reason, section_started_at, max_index FROM attempt WHERE id = ?",
    [attemptId],
  );
  return rows[0] as AttemptRow;
}

let mine: { cookie: string; paper: AttemptPaper };

beforeEach(async () => {
  clock = T;
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM auth_token", []);
  mine = await start();
});

/** `alpha/paper` runs for 45 minutes from `FIXED_NOW`. */
const deadlineAt = T + 45 * MINUTE;

/**
 * Move the candidate into the second section and hand back a question in
 * it.
 *
 * `alpha/paper`'s first section is capped at fifteen minutes and its
 * second is not capped at all, so a candidate still sitting on question
 * one at the 45-minute deadline is refused on the **section** clock long
 * before the paper's own — which is correct, and makes question one the
 * wrong place to prove anything about `late_sync_grace_seconds`. A real
 * candidate at the deadline is where this puts them.
 */
async function inSectionTwo(): Promise<string> {
  const questionId = mine.paper.sections[1]?.questions[0]?.id as string;
  const res = await put({ questionId, clientSeq: 1 });
  if (res.status !== 200) throw new Error(`reaching section two answered ${String(res.status)}`);
  return questionId;
}

// --- AC-13: the deadline is the server's -------------------------------

it("AC-13: the server timer ignores the client clock entirely", async () => {
  const res = await put({ clientSeq: 1, clientNow: T - 3_600_000 });
  expect(((await res.json()) as { remainingMs: number }).remainingMs).toBe(45 * MINUTE);
});

it("AC-13: the countdown on every save is the server's own reading, not the start's", async () => {
  clock = T + 5 * MINUTE;
  const res = await put({ clientSeq: 1 });
  expect(((await res.json()) as { remainingMs: number }).remainingMs).toBe(40 * MINUTE);
});

it("AC-13: an answer 29 s after the deadline is accepted and 31 s is rejected", async () => {
  const questionId = await inSectionTwo();

  clock = deadlineAt + 29_000;
  expect((await put({ questionId, value: chose("b"), clientSeq: 2 })).status).toBe(200);

  clock = deadlineAt + 31_000;
  const late = await put({ questionId, value: chose("c"), clientSeq: 3 });
  expect(late.status).toBe(409);
  expect((await errorOf(late)).code).toBe("time_up");
});

it("exactly at the grace boundary the answer is still taken — the refusal is strictly past it", async () => {
  const questionId = await inSectionTwo();
  clock = deadlineAt + 30_000;
  expect((await put({ questionId, clientSeq: 2 })).status).toBe(200);
});

it("a rejected late answer leaves the stored response untouched", async () => {
  const questionId = await inSectionTwo();

  clock = deadlineAt + 29_000;
  await put({ questionId, value: chose("b"), clientSeq: 2 });
  clock = deadlineAt + 31_000;
  await put({ questionId, value: chose("c"), clientSeq: 3 });

  // Read back before the deadline, so the resume is not itself a timeout.
  clock = T;
  expect((await resume()).responses[questionId]).toEqual(chose("b"));
});

it("the grace comes from the version's late_sync_grace_seconds, not a constant", async () => {
  const sixty = await start("grace60");
  const questionId = await inSectionTwo();
  clock = deadlineAt + 45_000;

  // 45 s is past `alpha/paper`'s 30 and inside `alpha/grace60`'s 60. No
  // hard-coded number can make both of these pass.
  const refused = await put({ questionId, clientSeq: 2 }, mine.cookie);
  expect(refused.status).toBe(409);
  expect((await errorOf(refused)).code).toBe("time_up");

  const theirs = sixty.paper.sections[0]?.questions[0]?.id as string;
  expect((await put({ questionId: theirs, clientSeq: 1 }, sixty.cookie)).status).toBe(200);
  expect(sixty.paper.lateSyncGraceSeconds).toBe(60);
});

it("a test with no timing block at all still carries the server's own defaults", async () => {
  const bare = await start("bare");
  expect(bare.paper.lateSyncGraceSeconds).toBe(30);
  expect(bare.paper.warnAtMinutes).toEqual([10, 2]);
  expect(bare.paper.navigation).toBe("free");
});

// --- the deadline a write is judged by is NOT the test's window ---------

it("deriveState gates entry only: a save after the test's window has shut is still stored", async () => {
  // `alpha/late` shuts ten minutes after `FIXED_NOW` and runs for
  // forty-five, so twenty minutes in is comfortably outside the window and
  // comfortably inside the attempt. A route that re-checked
  // `deriveState(...) === "open"` here would refuse exactly the late
  // offline saves AC-14 exists to deliver.
  const late = await start("late");
  const only = late.paper.sections[0]?.questions[0]?.id as string;
  clock = T + 20 * MINUTE;

  const res = await put({ questionId: only, clientSeq: 1 }, late.cookie);
  expect(res.status).toBe(200);
  expect(((await res.json()) as { outcome: string }).outcome).toBe("accepted");
});

// --- C-07: the section clock --------------------------------------------

it("the paper reports the current section's remaining time, and null where there is no limit", async () => {
  // `alpha/paper`'s first section is limited to fifteen minutes; its
  // second is not limited at all.
  expect(mine.paper.sectionRemainingMs).toBe(15 * MINUTE);
  const free = await start("sets5");
  expect(free.paper.sectionRemainingMs).toBeNull();
});

it("C-07: a write to a section whose time has ended is refused and names the next section", async () => {
  clock = T + 15 * MINUTE + 31_000;
  const refused = await put({ clientSeq: 4 });

  expect(refused.status).toBe(409);
  expect(await errorOf(refused)).toMatchObject({
    code: "section_over",
    details: { nextSection: "quant" },
  });
});

it("a section deadline gets the grace too, so an answer queued across the boundary still lands", async () => {
  clock = T + 15 * MINUTE + 20_000;
  expect((await put({ clientSeq: 4 })).status).toBe(200);
});

it("C-07: moving on is how a candidate leaves an expired section — the next one is not refused", async () => {
  const ahead = mine.paper.sections[1]?.questions[0]?.id as string;
  clock = T + 15 * MINUTE + 31_000;
  expect((await put({ questionId: ahead, clientSeq: 5 })).status).toBe(200);
});

it("entering a later section stamps section_started_at exactly once", async () => {
  const sectioned = await start("per-section");
  const flat = sectioned.paper.sections.flatMap((section) => section.questions.map((one) => one.id));

  clock = T + 60_000;
  await put({ questionId: flat[3] as string, clientSeq: 5 }, sectioned.cookie);
  const stamped = (await attemptRow(sectioned.paper.attemptId)).section_started_at;
  expect(stamped).toBe(T + 60_000);

  clock = T + 120_000;
  await put({ questionId: flat[4] as string, clientSeq: 6 }, sectioned.cookie);
  expect((await attemptRow(sectioned.paper.attemptId)).section_started_at).toBe(stamped);
});

it("the second section's clock runs from its own stamp, not from the start of the paper", async () => {
  const sectioned = await start("per-section");
  const flat = sectioned.paper.sections.flatMap((section) => section.questions.map((one) => one.id));

  // Ten minutes into a fifteen-minute first section, then into a
  // ten-minute second one. Measured from `started_at` the second section
  // would already be over; measured from its own stamp the candidate has
  // the whole ten minutes, which is what `time_limit_minutes` promises.
  clock = T + 10 * MINUTE;
  await put({ questionId: flat[3] as string, clientSeq: 1 }, sectioned.cookie);
  expect((await resume(sectioned.cookie)).sectionRemainingMs).toBe(10 * MINUTE);

  clock = T + 16 * MINUTE;
  expect((await resume(sectioned.cookie)).sectionRemainingMs).toBe(4 * MINUTE);
});

// --- C-07: the timeout submission ---------------------------------------

it("C-07: the first request past the deadline submits the attempt with reason timeout", async () => {
  clock = deadlineAt + 60_000;
  const paper = await resume();

  expect(await attemptRow(mine.paper.attemptId)).toMatchObject({
    submitted_at: deadlineAt,
    submit_reason: "timeout",
  });
  // And the payload says so in the same breath, so the finish screen does
  // not need a second round trip to find out.
  expect(paper.submittedAt).toBe(deadlineAt);
});

it("a resume inside the grace does NOT materialise the timeout — the queue has not drained yet", async () => {
  // The ordering bug this guards: a resume at `deadline + 20 s` that
  // submitted the attempt would make every answer the queue is holding —
  // each of them made in time — take a 409 on its way out.
  const questionId = await inSectionTwo();
  clock = deadlineAt + 20_000;
  await resume();

  expect((await attemptRow(mine.paper.attemptId)).submitted_at).toBeNull();
  expect((await put({ questionId, clientSeq: 2 })).status).toBe(200);
});

it("the timeout is stamped once: a second read does not move it, and a real reason survives", async () => {
  await deps.db.run("UPDATE attempt SET submitted_at = ?, submit_reason = ? WHERE id = ?", [
    T + MINUTE,
    "candidate",
    mine.paper.attemptId,
  ]);
  clock = deadlineAt + 60_000;
  await resume();

  expect(await attemptRow(mine.paper.attemptId)).toMatchObject({
    submitted_at: T + MINUTE,
    submit_reason: "candidate",
  });
});

it("after the timeout a save is refused as already submitted, and nothing is stored", async () => {
  clock = deadlineAt + 60_000;
  await resume();

  const refused = await put({ clientSeq: 2 });
  expect(refused.status).toBe(409);
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM response WHERE attempt_id = ?",
    [mine.paper.attemptId],
  );
  expect(Number(rows[0]?.n)).toBe(0);
});

// --- the budgets, re-measured with the clock on the routes --------------

it("GET /attempt costs 2 inside the window and 3 on the read that materialises the timeout", async () => {
  const inside = countingDeps(deps);
  await resumeOn(mine.cookie, createApp(inside.deps));
  expect(inside.counts().total).toBe(2);

  clock = deadlineAt + 60_000;
  const expired = countingDeps(deps);
  await resumeOn(mine.cookie, createApp(expired.deps));
  expect(expired.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/attempt"]);
  expect(expired.counts().db).toBe(3);
  expect(expired.counts().storage).toBe(0);

  // And the write happens once, ever: the next read is back to 2.
  const again = countingDeps(deps);
  await resumeOn(mine.cookie, createApp(again.deps));
  expect(again.counts().total).toBe(2);
});

it("the declared budget for GET /attempt is exactly 3", () => {
  expect(ROUTE_BUDGETS["/api/v1/run/attempt"]).toBe(3);
});

it("a save that also moves the clock's section is still one read and one write", async () => {
  const sectioned = await start("per-section");
  const flat = sectioned.paper.sections.flatMap((section) => section.questions.map((one) => one.id));
  const counting = countingDeps(deps);

  // The most expensive save there is: it stores the answer, raises
  // `max_index` and stamps `section_started_at`, all in one batch.
  const res = await put(
    { questionId: flat[3] as string, clientSeq: 1 },
    sectioned.cookie,
    createApp(counting.deps),
  );

  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[ANSWER_PATH]);
  expect(counting.counts().db).toBe(2);
  expect(counting.counts().storage).toBe(0);
  // …and the batch still tells the two outcomes apart, which is what the
  // whole `{ changes }` return on `DbClient.batch` exists for.
  expect(((await res.json()) as { outcome: string }).outcome).toBe("accepted");
});

it("a superseded save that also moves max_index is reported as superseded, not accepted", async () => {
  // Review Focus 3, inside the batch. This is the interleaving two tabs
  // produce: both read `max_index = 0`, both target the same question
  // ahead of it, the higher sequence commits first and the lower one
  // arrives to find a row it must not regress — while its own progress
  // bump still rides the same batch. Reproduced by putting `max_index`
  // back, because two real requests would race nondeterministically.
  const sectioned = await start("per-section");
  const flat = sectioned.paper.sections.flatMap((section) => section.questions.map((one) => one.id));

  await put({ questionId: flat[3] as string, value: chose("b"), clientSeq: 9 }, sectioned.cookie);
  await deps.db.run("UPDATE attempt SET max_index = 0 WHERE id = ?", [sectioned.paper.attemptId]);

  const late = await put(
    { questionId: flat[3] as string, value: chose("a"), clientSeq: 4 },
    sectioned.cookie,
  );

  expect(late.status).toBe(200);
  expect(((await late.json()) as { outcome: string }).outcome).toBe("superseded");
  expect((await resume(sectioned.cookie)).responses[flat[3] as string]).toEqual(chose("b"));
});
