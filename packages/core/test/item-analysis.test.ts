// `itemAnalysis()` (Phase 8c Task 2, `R-07`, `K19`, `K20`) — one pass over a
// test's attempts and responses, answering "was this question any good" per
// question: share correct, a discrimination index, and option pick rates.
//
// Fixtures below are hand-built so the numbers in each assertion are exact
// (or, for the discrimination index, land within `toBeCloseTo`'s 0.005
// tolerance) rather than coincidental — see the comment on `cohortOf`'s q1
// pattern for how the 0.42 is constructed.

import { describe, expect, it, vi } from "vitest";
import type { ItemStat } from "../src/item-analysis.js";
import { itemAnalysis } from "../src/item-analysis.js";

type Attempt = { attemptId: string; percent: number };
type Response = { attemptId: string; questionId: string; correct: boolean | null; value: unknown };

const OPTIONS = ["optA", "optB", "optC", "optD"];
const attemptId = (i: number) => `att${i}`;

function makeAttempts(n: number): Attempt[] {
  // Distinct, descending percents so sort order is unambiguous — index 0 is
  // always the top scorer.
  return Array.from({ length: n }, (_, i) => ({ attemptId: attemptId(i), percent: 100 - i }));
}

/**
 * q1's correctness, by rank `i` (0 = top scorer). `undefined` means the
 * candidate never answered q1 (no response row) — distinct from `correct:
 * null`, which would mean "answered but ungraded".
 *
 * For n=100 this hand-tunes the top/bottom-27% split so the discrimination
 * index lands at 0.42 (within `toBeCloseTo`'s tolerance): with both edges
 * at the same size (27), `(topCorrect - bottomCorrect) / 27` can only move
 * in steps of 1/27 ≈ 0.037 and never lands in [0.415, 0.425] — so two of
 * the top 27 are given no response at all, shrinking that edge's own
 * denominator to 25 and breaking the shared-denominator lock-step:
 * top 18/25 (0.72) minus bottom 8/27 (0.2963) ≈ 0.4237.
 */
function q1Correct(n: number, i: number): boolean | undefined {
  if (n === 100) {
    if (i < 18) return true; // top edge (0-26): 18 correct
    if (i < 25) return false; // top edge: 7 incorrect
    if (i < 27) return undefined; // top edge: 2 unanswered -> denom 25
    if (i < 73) return i % 2 === 0; // middle: irrelevant to either edge
    if (i < 81) return true; // bottom edge (73-99): 8 correct
    return false; // bottom edge: 19 incorrect
  }
  // Generic case: top 60% correct, rest wrong — gives exactly 0.6 at n=20.
  return i < Math.round(n * 0.6);
}

function q1Responses(n: number): Response[] {
  const rows: Response[] = [];
  for (let i = 0; i < n; i++) {
    const correct = q1Correct(n, i);
    if (correct === undefined) continue;
    rows.push({ attemptId: attemptId(i), questionId: "q1", correct, value: { kind: "option", option: OPTIONS[i % OPTIONS.length] } });
  }
  return rows;
}

/** A question on the paper nobody reached: every attempt has a row, but
 *  blank (no option picked, nothing graded) — distinct from a question with
 *  zero rows at all, which `itemAnalysis` would never see. */
function unreachedResponses(n: number): Response[] {
  return Array.from({ length: n }, (_, i) => ({ attemptId: attemptId(i), questionId: "qUnreached", correct: null, value: null }));
}

function cohortOf(n: number) {
  return { attempts: makeAttempts(n), responses: [...q1Responses(n), ...unreachedResponses(n)] };
}

function cohortWhereAllCorrect(questionId: string) {
  const n = 20; // >= DISCRIMINATION_MIN_N, so this exercises no_variance, not too_few_attempts.
  return {
    attempts: makeAttempts(n),
    responses: Array.from({ length: n }, (_, i) => ({
      attemptId: attemptId(i),
      questionId,
      correct: true,
      value: { kind: "option" as const, option: "optA" },
    })),
  };
}

/** `attempts * questions` responses, each with a `questionId` getter that
 *  calls `spy`. A per-question filter/sort over the whole response set
 *  would read every response's `questionId` once per question (`attempts *
 *  questions * questions` reads); one pass reads it once per response. */
function instrumentedCohort(attempts: number, questions: number, spy: () => void) {
  const made = makeAttempts(attempts);
  const responses: Response[] = [];
  for (let a = 0; a < attempts; a++) {
    for (let q = 0; q < questions; q++) {
      const row = { attemptId: attemptId(a), correct: (a + q) % 2 === 0, value: { kind: "option" as const, option: "optA" } };
      Object.defineProperty(row, "questionId", {
        enumerable: true,
        get() {
          spy();
          return `q${q}`;
        },
      });
      responses.push(row as unknown as Response);
    }
  }
  return { attempts: made, responses };
}

describe("itemAnalysis", () => {
  it("computes share correct per question", () => {
    expect(itemAnalysis(cohortOf(20)).find((s) => s.questionId === "q1")!.shareCorrect).toBe(0.6);
  });

  it("discriminates top from bottom 27%", () => {
    expect(itemAnalysis(cohortOf(100)).find((s) => s.questionId === "q1")!.discrimination).toBeCloseTo(0.42, 2);
  });

  it("withholds the index below ten attempts and says why", () => {
    const s = itemAnalysis(cohortOf(6))[0] as ItemStat;
    expect(s.discrimination).toBeNull();
    expect(s.discriminationWithheld).toBe("too_few_attempts");
    expect(s.n).toBe(6);
  });

  it("withholds it for a question everybody got right, rather than returning NaN", () => {
    const s = itemAnalysis(cohortWhereAllCorrect("q1")).find((x) => x.questionId === "q1")!;
    expect(s.discrimination).toBeNull();
    expect(s.discriminationWithheld).toBe("no_variance");
  });

  it("gives option pick rates summing to one over answered responses", () => {
    const s = itemAnalysis(cohortOf(20)).find((x) => x.questionId === "q1")!;
    expect(Object.values(s.optionPickRates).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  it("returns an empty pick-rate map for a question nobody reached, never a division by zero", () => {
    expect(itemAnalysis(cohortOf(20)).find((x) => x.questionId === "qUnreached")!.optionPickRates).toEqual({});
  });

  it("makes one pass — 300 x 60 does not call per question", () => {
    const spy = vi.fn();
    itemAnalysis(instrumentedCohort(300, 60, spy));
    expect(spy.mock.calls.length).toBeLessThanOrEqual(300 * 60);
  });
});
