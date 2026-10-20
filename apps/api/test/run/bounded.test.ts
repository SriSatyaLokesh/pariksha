// The server's regex bound (#129), both policies.
//
// `matchStrict` is the bound itself and says out loud when it refuses;
// `matchBounded` is the registration policy over it — never throws, and a
// refusal passes the candidate, because an author's bad pattern must not
// become a stranger's refusal at the door (Task 3's ruling, and the
// reversal recorded in `run/bounded.ts`'s header).
//
// Grading takes the other policy, and that half is asserted below through
// the submit route: a question whose pattern the bound refuses is
// **pending and flagged**, never a zero the candidate owns.

import { afterAll, expect, it } from "vitest";
import { closeClient } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import {
  MatchBudgetExceeded,
  MAX_MATCH_INPUT,
  matchBounded,
  matchStrict,
} from "../../src/run/bounded.js";
import { testDeps } from "../deps.js";
import { seedPublishedTest } from "./fixtures.js";
import { seedAttemptTests, startAttemptFor } from "./paper-fixtures.js";

it("#129: matchStrict caps input length before it runs the pattern", () => {
  expect(() => matchStrict("^a*$", "a".repeat(MAX_MATCH_INPUT + 1))).toThrow(MatchBudgetExceeded);
  // One character under the cap is an ordinary match, so the throw above
  // is the cap and not the pattern.
  expect(matchStrict("^a*$", "a".repeat(MAX_MATCH_INPUT))).toBe(true);
});

it("#129: matchStrict re-checks the pattern at execution time, not only at authoring time", () => {
  expect(() => matchStrict("(a+)+$", "aaaa")).toThrow(MatchBudgetExceeded);
  expect(() => matchStrict("(a|a)+$", "aaaa")).toThrow(MatchBudgetExceeded);
});

it("#129: an unparseable pattern is refused, not thrown as a SyntaxError", () => {
  expect(() => matchStrict("([a-", "aaaa")).toThrow(MatchBudgetExceeded);
});

it("the refusal names the pattern, because the organiser is the one who can fix it", () => {
  try {
    matchStrict("(a+)+$", "aaaa");
    expect.unreachable("matchStrict did not refuse");
  } catch (error) {
    expect(error).toBeInstanceOf(MatchBudgetExceeded);
    expect((error as MatchBudgetExceeded).pattern).toBe("(a+)+$");
  }
});

it("an ordinary pattern still matches, under both policies", () => {
  expect(matchStrict("^\\d{2}[A-Z]{2}\\d{4}$", "21CS0147")).toBe(true);
  expect(matchBounded("^\\d{2}[A-Z]{2}\\d{4}$", "21CS0147")).toBe(true);
  expect(matchStrict("^\\d{2}[A-Z]{2}\\d{4}$", "nope")).toBe(false);
  expect(matchBounded("^\\d{2}[A-Z]{2}\\d{4}$", "nope")).toBe(false);
});

it("matchBounded never throws, and a refusal passes the candidate", () => {
  expect(matchBounded("(a+)+$", "aaaa")).toBe(true);
  expect(matchBounded("([a-", "aaaa")).toBe(true);
  expect(matchBounded("^a*$", "a".repeat(MAX_MATCH_INPUT + 1))).toBe(true);
});

// --- the grading surface, through the route ------------------------------
//
// #129's acceptance criteria: a catastrophic pattern an organiser typed
// must not block answering, saving or submitting, and the question it sits
// on must be **flagged for the organiser** rather than silently scored
// zero against a candidate who did not write it.

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedPublishedTest(deps);
await seedAttemptTests(deps, workspaceId);

afterAll(() => closeClient(deps.db));

it("#129: a catastrophic pattern does not block answering, saving or submitting", async () => {
  const started = await startAttemptFor(deps, app, "badregex");
  expect(started.status).toBe(201);
  const paper = started.paper as AttemptPaper;
  const blank = paper.sections[0]?.questions[0];
  expect(blank?.type).toBe("fill_blank");

  // Thirty characters against `(a|a)+$` is 2^30 backtracks if it ever
  // runs. The save, and then the submission, both answer in time.
  const save = await app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie: started.cookie, "content-type": "application/json" },
    body: JSON.stringify({
      questionId: blank?.id,
      value: { kind: "blanks", values: { b1: "a".repeat(30) } },
      clientSeq: 1,
    }),
  });
  expect(save.status).toBe(200);

  const res = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: started.cookie },
  });
  expect(res.status).toBe(200);
  expect((await res.json()).receipt.attemptId).toBe(paper.attemptId);
});

it("#129: the affected question is flagged for the organiser, not silently scored zero", async () => {
  const started = await startAttemptFor(deps, app, "badregex");
  const paper = started.paper as AttemptPaper;
  const blank = paper.sections[0]?.questions[0];
  await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: started.cookie },
  });

  const rows = await deps.db.query<{ score_json: unknown; flag: string }>(
    "SELECT score_json, flag FROM attempt WHERE id = ?",
    [paper.attemptId],
  );
  const score = deps.db.jsonValue(rows[0]?.score_json) as { pending: string[] };
  expect(score.pending).toContain(blank?.id);
  expect(rows[0]?.flag).toBe("scoring_blocked");

  const audit = await deps.db.query<{ action: string; detail_json: unknown }>(
    "SELECT action, detail_json FROM audit_log WHERE target = ? ORDER BY id",
    [paper.attemptId],
  );
  expect(audit.map((row) => row.action)).toContain("attempt.scoring_blocked");
  // The pattern is named on the audit row, because the organiser is the
  // only person who can fix it — and it is in their workspace, not in the
  // candidate's response body (`S-10`).
  const blocked = audit.find((row) => row.action === "attempt.scoring_blocked");
  expect(JSON.stringify(deps.db.jsonValue(blocked?.detail_json))).toContain("(a|a)+$");
});

it("#129: the sound question on the same paper still scores", async () => {
  const started = await startAttemptFor(deps, app, "badregex");
  const paper = started.paper as AttemptPaper;
  const choice = paper.sections[0]?.questions[1];
  await app.request(ANSWER_PATH, {
    method: "PUT",
    headers: { cookie: started.cookie, "content-type": "application/json" },
    body: JSON.stringify({ questionId: choice?.id, value: { kind: "option", option: "a" }, clientSeq: 1 }),
  });
  const body = (await (
    await app.request("/api/v1/run/attempt/submit", {
      method: "POST",
      headers: { cookie: started.cookie },
    })
  ).json()) as { released: { total: number; max: number } };
  // The choice question is worth 2 and is right; the blank is worth 2 and
  // is pending, so it costs its points but still counts towards `max`.
  expect(body.released).toMatchObject({ total: 2, max: 4 });
});

it("#129: under negative marking the blocked question costs nothing extra", async () => {
  // The zero ruling above is one half; this is the other. `badregex-neg`
  // marks `negative` at fraction 1, so a question graded *wrong* takes
  // its full points off. The blank is pending — nobody can grade it — so
  // it must not move the total in either direction, and the choice
  // question beside it is what makes the difference visible: the
  // candidate earns 2, and a penalty on the blank would clamp the section
  // back to 0.
  const started = await startAttemptFor(deps, app, "badregex-neg");
  const paper = started.paper as AttemptPaper;
  const blank = paper.sections[0]?.questions[0];
  const choice = paper.sections[0]?.questions[1];
  expect(blank?.type).toBe("fill_blank");

  for (const [id, value] of [
    [blank?.id, { kind: "blanks", values: { b1: "anything" } }],
    [choice?.id, { kind: "option", option: "a" }],
  ] as const) {
    await app.request(ANSWER_PATH, {
      method: "PUT",
      headers: { cookie: started.cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId: id, value, clientSeq: 1 }),
    });
  }

  const body = (await (
    await app.request("/api/v1/run/attempt/submit", {
      method: "POST",
      headers: { cookie: started.cookie },
    })
  ).json()) as { released: { total: number; max: number; pending: string[] } };
  expect(body.released).toMatchObject({ total: 2, max: 4 });
  expect(body.released.pending).toContain(blank?.id);
});

it("a grading engine that throws still ends the attempt, with a receipt and a flag", async () => {
  // The case the pre-scan cannot see: a stored `multi_matching` with no
  // `key`, which `/start` serves happily and `gradeStructured` throws on.
  // Without a catch this is a 500 with `finishAttempt` never reached — no
  // stamp, no receipt, and a retry that fails identically, so the
  // candidate cannot submit at all.
  const started = await startAttemptFor(deps, app, "ungradeable");
  const paper = started.paper as AttemptPaper;

  const res = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: started.cookie },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { receipt: { attemptId: string }; released: unknown };
  expect(body.receipt.attemptId).toBe(paper.attemptId);
  // No score was computed, so nothing is released — the receipt is the
  // whole answer, exactly as it is for a `when: "never"` test.
  expect(body.released).toBeNull();

  const rows = await deps.db.query<{ submitted_at: number | null; score_json: unknown; flag: string }>(
    "SELECT submitted_at, score_json, flag FROM attempt WHERE id = ?",
    [paper.attemptId],
  );
  expect(rows[0]?.submitted_at).not.toBeNull();
  expect(rows[0]?.score_json ?? null).toBeNull();
  expect(rows[0]?.flag).toBe("scoring_blocked");

  // And the organiser is told what threw, in their workspace.
  const audit = await deps.db.query<{ action: string; detail_json: unknown }>(
    "SELECT action, detail_json FROM audit_log WHERE target = ? ORDER BY id",
    [paper.attemptId],
  );
  expect(audit.map((row) => row.action).sort()).toEqual([
    "attempt.scoring_blocked",
    "attempt.submitted",
  ]);
  const flagged = audit.find((row) => row.action === "attempt.scoring_blocked");
  expect(JSON.stringify(deps.db.jsonValue(flagged?.detail_json))).toContain(
    "the grading engine threw",
  );
});

it("#129's second surface is unchanged: a registration pattern still lets the candidate through", async () => {
  // The other policy over the same bound (`run/bounded.ts`'s header): an
  // author's unsafe pattern must never become a stranger's refusal at the
  // door. Asserted here so a future change to `matchStrict` that leaked
  // into `matchBounded` fails in the file that owns the bound.
  expect(matchBounded("(a+)+$", "a".repeat(40))).toBe(true);
});
