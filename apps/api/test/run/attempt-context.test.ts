// The attempt cookie as a request authority, and the resume it carries
// (#69, P6.5).
//
// `GET /api/v1/run/attempt` is the whole of Task 5's read side, and the
// property it exists to hold is that a resume is a read of one column.
// The tests below mutate the bank underneath a live attempt — edit a
// prompt, delete an option, delete a selected question outright — and
// require the paper to come back byte for byte. A resume test that only
// moves the clock proves nothing about that: the bank staying still for
// forty-five minutes is something nobody promised.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createBank,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
  upsertQuestion,
  upsertQuestions,
  upsertResponse,
} from "@pariksha/db";
import type { Question } from "@pariksha/core";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest, seedWorkspace, seedTest, DAY, iso } from "./fixtures.js";
import { seedAttemptTests, seedBank, PAPER_FORM } from "./paper-fixtures.js";

const T = FIXED_NOW;
const MINUTE = 60_000;
let clock = T;

const { deps } = await testDeps({ now: () => clock });
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
await seedAttemptTests(deps, workspaceId);

// A second tenant with a paper of its own, so "a candidate's cookie
// reaches only their own attempt's workspace" has somewhere else to be
// wrong about.
const otherWorkspaceId = await seedWorkspace(deps, "omega", "Omega Corp");
const otherQ = await seedBank(deps, otherWorkspaceId);
await seedTest(deps, otherWorkspaceId, {
  name: "Paper",
  slug: "paper",
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
    },
    sections: [
      { id: "logic", title: "Logic", source: { kind: "fixed", questions: [otherQ["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers -----------------------------------------------------------

let serial = 1;

async function startOn(
  workspace: string,
  slug: string,
): Promise<{ res: Response; cookie: string; paper: AttemptPaper }> {
  const test = await resolvePublishedTest(deps.db, workspace, slug, clock);
  if (!test) throw new Error(`no published test at ${workspace}/${slug}`);
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: clock,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: clock,
    expiresAt: clock + REGISTRATION_TTL_MS,
  });
  const res = await app.request(`/api/v1/run/${workspace}/${slug}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  return { res, cookie, paper: (await res.json()) as AttemptPaper };
}

const start = (slug = "paper") => startOn("alpha", slug);

const resume = (cookie?: string, on = app): Promise<Response> =>
  on.request("/api/v1/run/attempt", cookie === undefined ? {} : { headers: { cookie } });

const paperOf = async (res: Response): Promise<AttemptPaper> => (await res.json()) as AttemptPaper;

beforeEach(async () => {
  clock = T;
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM auth_token", []);
});

// --- the 401 ------------------------------------------------------------

it("no cookie, a junk cookie and a cookie for a deleted attempt are all the same 401", async () => {
  const { cookie } = await start();
  await deps.db.run("DELETE FROM attempt", []);

  const answers = await Promise.all(
    [undefined, "pk_attempt=junk", cookie].map(async (c) => {
      const res = await resume(c);
      return `${String(res.status)} ${await res.text()}`;
    }),
  );
  expect(new Set(answers).size).toBe(1);
  expect(answers[0]).toContain("401");
  expect(answers[0]).toContain("attempt_required");
});

it("a cookie whose token is almost right is the same 401 — the lookup is on the digest", async () => {
  const { cookie } = await start();
  const nearly = `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`;
  expect((await resume(nearly)).status).toBe(401);
  expect((await resume(cookie)).status).toBe(200);
});

it("a candidate's cookie reaches only their own attempt's workspace", async () => {
  const mine = await start();
  const theirs = await startOn("omega", "paper");

  expect((await paperOf(await resume(theirs.cookie))).sections[0]?.questions[0]?.id).toBe(
    otherQ["LOG-001"],
  );
  // Different workspaces, different banks, different questions — and
  // neither cookie reaches the other's row.
  expect((await paperOf(await resume(mine.cookie))).attemptId).toBe(mine.paper.attemptId);
  expect(theirs.paper.attemptId).not.toBe(mine.paper.attemptId);
});

// --- the resume ---------------------------------------------------------

it("C-06: a browser restart resumes the same questions, answers and remaining time", async () => {
  const { cookie, paper } = await start();
  const questionId = paper.sections[0]?.questions[0]?.id as string;
  const answer = { kind: "choice", ids: ["a"] };
  await upsertResponse(deps.db, workspaceId, {
    attemptId: paper.attemptId,
    questionId,
    value: answer,
    clientSeq: 1,
    savedAt: T + MINUTE,
  });

  clock = T + 10 * MINUTE;
  // A fresh client: nothing but the cookie travels.
  const resumed = await paperOf(await resume(cookie, createApp(deps)));

  expect(resumed.sections).toEqual(paper.sections);
  expect(resumed.responses[questionId]).toEqual(answer);
  expect(resumed.remainingMs).toBe(35 * MINUTE);
  expect(resumed.serverNow).toBe(T + 10 * MINUTE);
});

/** A bank and a published test of their own, so the mutations below
 *  cannot reach any other fixture in this file. */
async function mutableTest(slug: string): Promise<string[]> {
  const bankId = await createBank(deps.db, workspaceId, { name: slug, now: T });
  const docs: Question[] = [1, 2, 3].map((n) => ({
    id: `${slug.toUpperCase()}-${String(n)}`,
    type: "single",
    prompt: `Question ${String(n)}`,
    options: [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ],
    key: "a",
    scoring: { points: 1 },
  }));
  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, docs, T);
  await seedTest(deps, workspaceId, {
    name: slug,
    slug,
    body: {
      settings: {
        timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
        access: { mode: "link_code", access_code: "OPENSESAME" },
      },
      sections: [{ id: "logic", title: "Logic", source: { kind: "fixed", questions: ids } }],
    },
  });
  return ids;
}

it("AC-14: the paper survives the bank changing underneath it, byte for byte", async () => {
  const ids = await mutableTest("mutable");
  const { cookie, paper } = await start("mutable");

  // Three edits an author can really make mid-window, each of which
  // would change or break a paper that was rebuilt on every read: a
  // rewritten prompt, an option removed, and a different points value.
  await upsertQuestion(
    deps.db,
    workspaceId,
    (await deps.db.query<{ bank_id: string }>("SELECT bank_id FROM question WHERE id = ?", [ids[0]]))[0]!
      .bank_id,
    {
      id: "MUTABLE-1",
      type: "single",
      prompt: "A completely different prompt.",
      options: [{ id: "b", text: "Only one option left" }],
      key: "b",
      scoring: { points: 7 },
    } as Question,
    T + MINUTE,
  );
  // And one of the selected questions deleted outright, which under a
  // re-read is a thrown `Error` and a 500 on the candidate's screen.
  await deps.db.run("DELETE FROM question WHERE id = ?", [ids[1]]);

  clock = T + 2 * MINUTE;
  const res = await resume(cookie);
  expect(res.status).toBe(200);
  const resumed = await paperOf(res);
  expect(JSON.stringify(resumed.sections)).toBe(JSON.stringify(paper.sections));
  expect(resumed.sections[0]?.questions).toHaveLength(3);

  // The edits really did land, so what held above is the pin and not a
  // bank that never moved.
  const live = await deps.db.query<{ prompt_md: string }>("SELECT prompt_md FROM question WHERE id = ?", [
    ids[0],
  ]);
  expect(live[0]?.prompt_md).toBe("A completely different prompt.");
  expect(await deps.db.query("SELECT id FROM question WHERE id = ?", [ids[1]])).toHaveLength(0);
  // And a candidate starting now is refused, which is the state the
  // resumed attempt was carried through.
  await expect(start("mutable")).rejects.toThrow("409");
});

it("a submitted attempt still resumes, carrying the time it was submitted", async () => {
  const { cookie, paper } = await start();
  await deps.db.run("UPDATE attempt SET submitted_at = ?, submit_reason = ? WHERE id = ?", [
    T + 5 * MINUTE,
    "candidate",
    paper.attemptId,
  ]);

  clock = T + 50 * MINUTE;
  const res = await resume(cookie);
  expect(res.status).toBe(200);
  const resumed = await paperOf(res);
  expect(resumed.submittedAt).toBe(T + 5 * MINUTE);
  // Past the deadline, the clock reads zero rather than a negative.
  expect(resumed.remainingMs).toBe(0);
});

it("the resumed paper carries the attempt's own progress, not a fresh one", async () => {
  const { cookie, paper } = await start();
  await deps.db.run("UPDATE attempt SET max_index = ?, section_started_at = ? WHERE id = ?", [
    6,
    T + 12 * MINUTE,
    paper.attemptId,
  ]);

  clock = T + 13 * MINUTE;
  const resumed = await paperOf(await resume(cookie));
  expect(resumed.maxIndex).toBe(6);
  // Index 6 is in `quant`, which carries no time limit of its own, so
  // the section clock is off even though one is stamped on the row.
  expect(resumed.sectionRemainingMs).toBeNull();
});

it("a per-section clock runs from section_started_at once the candidate has entered one", async () => {
  const { cookie, paper } = await start();
  // Index 0 is still in `logic`, which is capped at fifteen minutes.
  await deps.db.run("UPDATE attempt SET section_started_at = ? WHERE id = ?", [
    T + 5 * MINUTE,
    paper.attemptId,
  ]);
  clock = T + 10 * MINUTE;
  expect((await paperOf(await resume(cookie))).sectionRemainingMs).toBe(10 * MINUTE);
});

// --- budget --------------------------------------------------------------

it("the resume spends its declared budget: the one join and the answers", async () => {
  const { cookie, paper } = await start();
  for (const [index, question] of (paper.sections[0]?.questions ?? []).entries()) {
    await upsertResponse(deps.db, workspaceId, {
      attemptId: paper.attemptId,
      questionId: question.id,
      value: { kind: "choice", ids: ["a"] },
      clientSeq: index + 1,
      savedAt: T,
    });
  }

  const counting = countingDeps(deps);
  const res = await resume(cookie, createApp(counting.deps));

  expect(res.status).toBe(200);
  expect(Object.keys((await paperOf(res)).responses).length).toBeGreaterThan(1);
  // Flat in the number of answers, which is what the number is for.
  //
  // **2, not the declared 3.** Task 9 (#73) raised the declared number
  // because the first read past `deadline_at + late_sync_grace_seconds`
  // materialises the timeout submission (`C-07`), and a budget names the
  // most expensive path through its route. An ordinary resume inside the
  // window — this one — still spends the join and `listResponses` and
  // nothing else; the 3 is pinned on the path that really costs it, in
  // `test/run/clock.test.ts`.
  expect(counting.counts().total).toBe(2);
  expect(counting.counts().total).toBeLessThanOrEqual(
    ROUTE_BUDGETS["/api/v1/run/attempt"] as number,
  );
});

it("a 401 resume spends at most the lookup", async () => {
  const counting = countingDeps(deps);
  const res = await resume("pk_attempt=junk", createApp(counting.deps));
  expect(res.status).toBe(401);
  expect(counting.counts().total).toBe(1);
  // And with no cookie at all it spends nothing.
  const none = countingDeps(deps);
  expect((await resume(undefined, createApp(none.deps))).status).toBe(401);
  expect(none.counts().total).toBe(0);
});
