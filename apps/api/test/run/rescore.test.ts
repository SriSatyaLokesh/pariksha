// `rescoreAttempt` (`K5`, Phase 8 Task 2): the one scoring path submission,
// grading and regrade (8b) all call through. `submit.test.ts` proves the
// extraction out of `submit.ts` changed nothing through the route; this
// file is the unit-level proof of the function itself, including the two
// capabilities `submit.ts` never exercised (a real `awards` map) and the
// two correctness traps the extraction could have introduced.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeClient, createBank, upsertQuestions } from "@pariksha/db";
import type { Question } from "@pariksha/core";
import type { AppDeps } from "../../src/app.js";
import type { PinnedLayout } from "../../src/run/attempt.js";
import { rescoreAttempt } from "../../src/run/rescore.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedWorkspace } from "./fixtures.js";

let deps: AppDeps;
let workspaceId: string;
/** Auto-graded, worth 2, key "a". */
let q1 = "";
/** `fill_blank`, worth 2, carrying the same catastrophically-backtracking
 *  pattern `paper-fixtures.ts`'s `BLK-001` does — `assertSafeRegex` refuses
 *  it, so `blockedQuestions` finds it every time, present or not. */
let q2 = "";
/** `short_answer`, worth 4, with one rubric level ("thorough") a reviewer
 *  can award. */
let q3 = "";
/** `multi_matching` with no `key` at all — the shape `gradeStructured`
 *  does not survive (`Object.values(q.key)` throws), reached the same way
 *  `paper-fixtures.ts`'s `MAL-001` is. */
let qThrows = "";

/** `q1` + `q2` + `q3`'s points — what `score.max` must equal whenever all
 *  three are on the paper, blocked or not. */
const THREE_QUESTION_MAX = 2 + 2 + 4;

/** `scoring.mode: "negative"` throughout: the mode under which a graded-
 *  wrong question actually loses points, so "never hands a blocked
 *  question to the grader" and "a deleted question is never graded" are
 *  falsifiable rather than vacuously true the way they'd be under the
 *  default mode, where a wrong answer and a nulled one both score 0. */
const settings = { scoring: { default_mode: "negative" as const, negative_fraction: 1 } };

const layoutOf = (questionIds: string[]): PinnedLayout => ({
  sections: [{ sectionId: "sec", questionIds, optionOrder: {} }],
  media: [],
  paper: [],
});

beforeAll(async () => {
  ({ deps } = await testDeps());
  workspaceId = await seedWorkspace(deps);
  const bankId = await createBank(deps.db, workspaceId, { name: "Rescore fixtures", now: FIXED_NOW });
  const docs: Question[] = [
    {
      id: "q1",
      type: "single",
      prompt: "Pick a",
      options: [
        { id: "a", text: "A" },
        { id: "b", text: "B" },
      ],
      key: "a",
      scoring: { points: 2 },
    },
    {
      id: "q2",
      type: "fill_blank",
      prompt: "Type anything",
      blanks: [{ id: "b1", accepted: ["(a|a)+$"], match: "regex" }],
      scoring: { points: 2 },
    },
    {
      id: "q3",
      type: "short_answer",
      prompt: "Summarise",
      rubric: [{ level: "thorough", points: 4 }],
      scoring: { points: 4 },
    },
  ];
  const malformed = {
    id: "qThrows",
    type: "multi_matching",
    prompt: "Match several",
    left: ["L1"],
    right: ["R1"],
    scoring: { points: 2 },
  } as unknown as Question;

  const { ids } = await upsertQuestions(deps.db, workspaceId, bankId, [...docs, malformed], FIXED_NOW);
  [q1, q2, q3, qThrows] = ids as [string, string, string, string];
});

afterAll(() => closeClient(deps.db));

/** `q1` answered correctly, `q2` answered (whatever is typed, it must
 *  never reach the grader), `q3` left blank. */
function withBlocked(): Parameters<typeof rescoreAttempt>[1] {
  return {
    workspaceId,
    layout: layoutOf([q1, q2, q3]),
    settings,
    responses: {
      [q1]: { kind: "option", option: "a" },
      [q2]: { kind: "blanks", values: { b1: "aaaa" } },
      [q3]: null,
    },
    awards: {},
  };
}

function withThrowingQuestion(): Parameters<typeof rescoreAttempt>[1] {
  return {
    workspaceId,
    layout: layoutOf([q1, qThrows]),
    settings,
    responses: { [q1]: { kind: "option", option: "a" }, [qThrows]: null },
    awards: {},
  };
}

describe("rescoreAttempt", () => {
  it("never hands a blocked question to the grader", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked());
    // Negative mode would take 2 points off a graded-wrong q2; nulled, it
    // scores a blank's 0 instead — the only way to tell the two apart.
    expect(score?.perQuestion[q2]?.points).toBe(0);
  });

  it("keeps a blocked question's points in max", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked());
    expect(score?.max).toBe(THREE_QUESTION_MAX);
  });

  it("lists a blocked question as pending", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked());
    expect(score?.pending).toContain(q2);
  });

  it("returns score null and a '*' blocked entry when the engine throws", async () => {
    const { score, blocked } = await rescoreAttempt(deps, withThrowingQuestion());
    expect(score).toBeNull();
    expect(blocked).toContainEqual({ questionId: "*", reason: expect.stringContaining("threw") });
  });

  it("applies a rubric award to a manual question and drops it from pending", async () => {
    // `RubricAward` is `{ levels: string[] }` — level names from the
    // question's own `rubric` array, never a raw points number. `q3`'s
    // only level ("thorough") is worth 4.
    const input = withBlocked();
    const { score } = await rescoreAttempt(deps, { ...input, awards: { [q3]: { levels: ["thorough"] } } });
    expect(score?.perQuestion[q3]?.points).toBe(4);
    expect(score?.pending).not.toContain(q3);
  });

  it("leaves an ungraded manual question pending", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked());
    expect(score?.pending).toContain(q3);
  });

  // --- Trap 1: an attempt already flagged `scoring_blocked` ---------------
  //
  // `rescoreAttempt` never reads or writes `flag` (or `integrity_flag` —
  // two separate columns, `0008_attempt_integrity.sql`'s own comment says
  // why): the caller decides whether to stamp `flag`, and every caller in
  // this codebase only spreads `{ flag: BLOCKED }` in when `blocked.length
  // > 0` (`submit.ts`). So the one thing that must hold for an existing
  // `scoring_blocked` to survive an unrelated rescore is that a clean
  // rescore reports **no** blocked questions at all — never an empty-ish
  // placeholder a careless caller might still spread in.
  it("reports no blocked questions when nothing on the paper is blocked, so a caller that only sets flag on blocked.length > 0 has no reason to touch an existing scoring_blocked", async () => {
    const { blocked } = await rescoreAttempt(deps, {
      workspaceId,
      layout: layoutOf([q1, q3]),
      settings,
      responses: { [q1]: { kind: "option", option: "a" }, [q3]: null },
      awards: {},
    });
    expect(blocked).toEqual([]);
    // Positive control: the same shape of call, with a blocked question
    // actually on the paper, does report one — "blocked" is a real signal,
    // not a check that always passes.
    const { blocked: withOne } = await rescoreAttempt(deps, withBlocked());
    expect(withOne.length).toBeGreaterThan(0);
  });

  // --- Trap 2: a question deleted since submission ------------------------
  //
  // Not in the bank at all (`byId.get(id) === undefined`): `blockedQuestions`
  // reports it, and `questionsBySection` (built off the same live `byId`)
  // omits it outright, so it is never handed to `scoreAttempt` under any
  // mode — the deletion can only shrink `max`, never subtract a negative
  // penalty for a question that no longer exists. `pending` still carries
  // it, which is the one place a reviewer finds out.
  it("drops a deleted question out of scoring entirely, but still reports it pending", async () => {
    const ghostId = "ghost-question-id";
    const { score, blocked } = await rescoreAttempt(deps, {
      workspaceId,
      layout: layoutOf([q1, q3, ghostId]),
      settings,
      responses: { [q1]: { kind: "option", option: "a" }, [q3]: null, [ghostId]: { kind: "option", option: "x" } },
      awards: {},
    });
    expect(blocked).toContainEqual({ questionId: ghostId, reason: "the bank no longer holds this question" });
    expect(score?.pending).toContain(ghostId);
    // `max` is q1 (2) + q3 (4) only — the ghost contributes nothing,
    // negative or otherwise.
    expect(score?.max).toBe(6);
    // Positive control: a question that *is* on the bank always gets a
    // `perQuestion` entry; the ghost — never graded at all — gets none.
    expect(score?.perQuestion[q1]).toBeDefined();
    expect(score?.perQuestion[ghostId]).toBeUndefined();
  });
});
