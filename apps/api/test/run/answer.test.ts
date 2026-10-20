// Saving one answer (#72, P6.8) — the hot path, and **Review Focus 3**.
//
// `upsertResponse` is already the whole write: one statement, conditional
// on `excluded.client_seq > response.client_seq`, so a late retry of
// sequence 4 after 5 is a no-op rather than a regression. Nothing here
// re-implements it. What this route adds is the wire contract the offline
// queue reads, and the three refusals it must tell apart:
//
//  * **200 `accepted`** — `{ stored: true }`. The row is this answer.
//  * **200 `superseded`** — `{ stored: false }`. The server holds newer;
//    the queue drops it, and dropping it is correct.
//  * **404** — a question outside this attempt's pinned paper. Nothing is
//    written. The queue drops it too, but it is **not** a save.
//  * **409** — the attempt is submitted (Task 9 adds the deadline here,
//    Task 10 the navigation rule). The answer is **kept**, and the banner
//    must never read "Saved".
//
// The `clientSeq` seed is the second half of Review Focus 3 and the one
// the advisor predicted: a second tab, or a wiped `localStorage`, restarts
// the browser's counter at 1, every save then comes back `superseded`, the
// queue drops it, and the candidate is shown "Saved" over answers that
// were never stored. `GET /attempt` therefore reports the highest
// `client_seq` the server holds, and the browser seeds from it.

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

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
const q = await seedAttemptTests(deps, workspaceId);

/** On the paper: the first question of the fixed `logic` section. */
const LOG1 = q["LOG-001"] as string;
const LOG3 = q["LOG-003"] as string;
/** In the same workspace and the same bank, and in **no** pinned paper of
 *  the `alpha/paper` test: the pool draws from `QNT-*` and the fixed
 *  section names five `LOG-*`/`CMP-1` ids, so a `SET-*` id is a real
 *  question this candidate was never given. */
const NOT_MINE = q["SET-A1"] as string;

const chose = (option: string): ResponseValue => ({ kind: "option", option });
const wrote = (text: string): ResponseValue => ({ kind: "text", text });

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
}

function put(body: Save | string, cookie = mine.cookie, on = app): Promise<Response> {
  return on.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body:
      typeof body === "string"
        ? body
        : JSON.stringify({
            questionId: LOG1,
            value: chose("a"),
            clientSeq: 1,
            ...body,
          }),
  });
}

const outcomeOf = async (res: Response): Promise<unknown> =>
  ((await res.json()) as { outcome: unknown }).outcome;

const resume = async (cookie = mine.cookie): Promise<AttemptPaper> =>
  (await (await app.request("/api/v1/run/attempt", { headers: { cookie } })).json()) as AttemptPaper;

async function countResponses(attemptId: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM response WHERE attempt_id = ?",
    [attemptId],
  );
  return Number(rows[0]?.n ?? 0);
}

let mine: { cookie: string; paper: AttemptPaper };

beforeEach(async () => {
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM auth_token", []);
  mine = await start();
});

// --- the hot path --------------------------------------------------------

it("a save is one read and one write, and nothing else", async () => {
  const counting = countingDeps(deps);
  const res = await put({ clientSeq: 1 }, mine.cookie, createApp(counting.deps));

  expect(res.status).toBe(200);
  // `toBe`, not `toBeLessThanOrEqual`: the PRD's hot-path row is "one D1
  // write plus at most one R2 call", and a route that drifts to three
  // reads still passes every bound.
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[ANSWER_PATH]);
  expect(counting.counts().db).toBe(2);
  expect(counting.counts().storage).toBe(0);
});

it("the budget is declared at exactly 2, and the route's authority is the attempt", () => {
  expect(ROUTE_BUDGETS[ANSWER_PATH]).toBe(2);
  expect(ROUTE_AUTH[`PUT ${ANSWER_PATH}`]).toBe("attempt");
});

it("an accepted save stores the answer and a resume reads it back", async () => {
  expect(await outcomeOf(await put({ value: chose("c"), clientSeq: 1 }))).toBe("accepted");
  expect((await resume()).responses[LOG1]).toEqual(chose("c"));
});

it("a cleared answer is a save of null, not an absent one", async () => {
  await put({ value: chose("c"), clientSeq: 1 });
  expect(await outcomeOf(await put({ value: null, clientSeq: 2 }))).toBe("accepted");
  expect((await resume()).responses[LOG1]).toBeNull();
});

// --- Review Focus 3: the three outcomes are distinct on the wire ---------

it("a late retry of sequence 4 after 5 is superseded, not a regression", async () => {
  await put({ value: chose("b"), clientSeq: 5 });
  const late = await put({ value: chose("a"), clientSeq: 4 });

  expect(late.status).toBe(200);
  expect(await outcomeOf(late)).toBe("superseded");
  // The answer the candidate actually left is still the one stored.
  expect((await resume()).responses[LOG1]).toEqual(chose("b"));
});

it("the same sequence sent twice is idempotent: one row, and the second is superseded", async () => {
  await put({ value: chose("a"), clientSeq: 7 });
  expect(await outcomeOf(await put({ value: chose("a"), clientSeq: 7 }))).toBe("superseded");
  expect(await countResponses(mine.paper.attemptId)).toBe(1);
});

it("a save for a question outside this attempt's layout is 404, not a stored row", async () => {
  const res = await put({ questionId: NOT_MINE, clientSeq: 1 });

  expect(res.status).toBe(404);
  expect(await countResponses(mine.paper.attemptId)).toBe(0);
  // S-10: the same body every other refusal in this runtime answers with,
  // so a candidate cannot use it to learn which questions exist.
  expect(await res.text()).not.toMatch(/paper|layout|question|bank/i);
});

it("the question it refuses really is a question — in this workspace, in this bank", async () => {
  // Otherwise the 404 above would prove only that a junk id is refused.
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM question WHERE id = ? AND workspace_id = ?",
    [NOT_MINE, workspaceId],
  );
  expect(Number(rows[0]?.n)).toBe(1);
  const flat = mine.paper.sections.flatMap((section) => section.questions.map((one) => one.id));
  expect(flat).not.toContain(NOT_MINE);
  expect(flat).toContain(LOG1);
});

it("a save after submission is refused and the stored answer is unchanged", async () => {
  await put({ value: chose("a"), clientSeq: 1 });
  await deps.db.run("UPDATE attempt SET submitted_at = ? WHERE id = ?", [T, mine.paper.attemptId]);

  const refused = await put({ value: chose("b"), clientSeq: 9 });
  expect(refused.status).toBe(409);
  expect((await resume()).responses[LOG1]).toEqual(chose("a"));
});

it("every save response carries the server's remainingMs so the client can re-anchor (Task 9)", async () => {
  expect(
    ((await (await put({ clientSeq: 1 })).json()) as { remainingMs: number }).remainingMs,
  ).toBe(45 * 60_000);
});

// --- the clientSeq seed: a second tab, or a wiped localStorage -----------

it("a resume reports the highest client_seq the server holds, so a fresh client cannot restart at 1", async () => {
  await put({ questionId: LOG1, value: chose("b"), clientSeq: 5 });
  await put({ questionId: LOG3, value: wrote("an answer"), clientSeq: 3 });

  // The seed is the maximum over the whole attempt, not per question: one
  // counter in the browser, and it must clear every row the server holds.
  expect((await resume()).clientSeq).toBe(5);
});

it("a fresh attempt seeds at 0", async () => {
  expect(mine.paper.clientSeq).toBe(0);
});

it("without the seed a fresh client's sequence 1 is silently superseded — which is the data loss", async () => {
  await put({ value: chose("b"), clientSeq: 5 });
  // Exactly what a second tab or a cleared `localStorage` sends.
  const fresh = await put({ value: wrote("the answer I just typed"), clientSeq: 1 });

  expect(fresh.status).toBe(200);
  expect(await outcomeOf(fresh)).toBe("superseded");
  expect((await resume()).responses[LOG1]).toEqual(chose("b"));
  // And the seed that prevents it is on the very response the client reads
  // on resume, so a client that honours it sends 6 instead of 1.
  expect((await resume()).clientSeq).toBe(5);
});

// --- the credential and the body -----------------------------------------

it("no cookie is 401 and writes nothing", async () => {
  const res = await app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ questionId: LOG1, value: chose("a"), clientSeq: 1 }),
  });
  expect(res.status).toBe(401);
  expect(await countResponses(mine.paper.attemptId)).toBe(0);
});

it("another candidate's cookie cannot write on this attempt's questions", async () => {
  const theirs = await start();
  await put({ value: chose("a"), clientSeq: 1 }, theirs.cookie);

  // Their own attempt holds it; mine holds nothing.
  expect(await countResponses(mine.paper.attemptId)).toBe(0);
  expect(await countResponses(theirs.paper.attemptId)).toBe(1);
});

it.each([
  ["no body at all", "{}"],
  ["a sequence that is not a number", JSON.stringify({ questionId: LOG1, clientSeq: "5" })],
  ["a negative sequence", JSON.stringify({ questionId: LOG1, value: null, clientSeq: -1 })],
  ["a value of a kind that is not a response", JSON.stringify({ questionId: LOG1, value: { kind: "script", src: "x" }, clientSeq: 1 })],
  ["unparseable JSON", "not json at all"],
])("%s is 400 and writes nothing", async (_name, body) => {
  expect((await put(body)).status).toBe(400);
  expect(await countResponses(mine.paper.attemptId)).toBe(0);
});

it("a text answer longer than the ceiling is refused rather than stored", async () => {
  const res = await put({ value: wrote("x".repeat(50_001)), clientSeq: 1 });
  expect(res.status).toBe(400);
  expect(await countResponses(mine.paper.attemptId)).toBe(0);
  // And one just inside it is stored, so the ceiling is a ceiling and not
  // a ban on long answers.
  expect((await put({ value: wrote("x".repeat(50_000)), clientSeq: 2 })).status).toBe(200);
});

it("every response kind the twelve answer inputs produce is accepted", async () => {
  const values: ResponseValue[] = [
    { kind: "option", option: "a" },
    { kind: "options", options: ["a", "b"] },
    { kind: "boolean", value: true },
    { kind: "map", pairs: { L1: "R1" } },
    { kind: "multimap", pairs: { L1: ["R1", "R2"] } },
    { kind: "order", items: ["one", "two"] },
    { kind: "blanks", values: { b1: "Delhi" } },
    { kind: "number", value: 42 },
    { kind: "text", text: "a sentence" },
  ];
  for (const [index, value] of values.entries()) {
    expect(await outcomeOf(await put({ value, clientSeq: index + 1 }))).toBe("accepted");
  }
  expect((await resume()).responses[LOG1]).toEqual(values[values.length - 1]);
});
