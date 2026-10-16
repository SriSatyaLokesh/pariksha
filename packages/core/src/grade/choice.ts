// Grades the five choice-family types: single, multiple, select_k,
// true_false and assertion_reason. Each type reduces to a correct/wrong/total
// part count; applyMode (grade/result.ts) does all mode arithmetic and
// rounding — this file never reimplements it.

import type {
  AssertionReasonQuestion,
  MultipleQuestion,
  ResponseValue,
  SelectKQuestion,
  SingleQuestion,
  TrueFalseQuestion,
} from "../types.js";
import type { GradeResult, ScoringDefaults } from "./result.js";
import { applyMode, resolveScoring } from "./result.js";

export type ChoiceQuestion =
  | SingleQuestion
  | MultipleQuestion
  | SelectKQuestion
  | TrueFalseQuestion
  | AssertionReasonQuestion;

type Parts = { correct: number; wrong: number; total: number };

export function gradeChoice(q: ChoiceQuestion, r: ResponseValue | null, d: ScoringDefaults): GradeResult {
  const { mode, points, negativeFraction } = resolveScoring(q, d);
  // A response whose `kind` doesn't match this question type's expected
  // shape (e.g. a `number` response to a `single` question) is not an
  // answer to this question, the same way structured.ts and text.ts treat
  // it — not a wrong, penalty-bearing guess. Without this, the fallback
  // paths in countParts below (oneOfKind's `r.kind !== kind`,
  // countKeyedOptions' `r.kind !== "options"`) score it as answered and
  // all-wrong, which costs a negative-marking penalty a blank response
  // never would.
  const answered = r !== null && r.kind === expectedKind(q);
  const parts = answered ? countParts(q, r) : { correct: 0, wrong: 0, total: totalParts(q) };
  return applyMode({ mode, points, negativeFraction, parts, answered });
}

function expectedKind(q: ChoiceQuestion): ResponseValue["kind"] {
  switch (q.type) {
    case "single":
    case "assertion_reason":
      return "option";
    case "true_false":
      return "boolean";
    case "multiple":
    case "select_k":
      return "options";
  }
}

function totalParts(q: ChoiceQuestion): number {
  return q.type === "multiple" || q.type === "select_k" ? q.key.length : 1;
}

function countParts(q: ChoiceQuestion, r: ResponseValue): Parts {
  switch (q.type) {
    case "single":
    case "assertion_reason":
      return oneOfKind(r, "option", (v) => v.option === q.key);
    case "true_false":
      return oneOfKind(r, "boolean", (v) => v.value === q.key);
    case "multiple":
      return countKeyedOptions(r, q.key);
    case "select_k":
      return countKeyedOptions(r, q.key, q.k);
  }
}

/** A single-part comparison: one part, correct when `isMatch` holds. */
function oneOfKind<K extends ResponseValue["kind"]>(
  r: ResponseValue,
  kind: K,
  isMatch: (r: Extract<ResponseValue, { kind: K }>) => boolean,
): Parts {
  const correct = r.kind === kind && isMatch(r as Extract<ResponseValue, { kind: K }>);
  return correct ? { correct: 1, wrong: 0, total: 1 } : { correct: 0, wrong: 1, total: 1 };
}

/**
 * Counts chosen key options as correct and chosen non-key options as wrong,
 * ignoring order and duplicates (order never matters; compare as sets).
 * When `k` is given (select_k) and more than `k` distinct options were
 * chosen, every part is wrong instead of silently truncating the response.
 */
function countKeyedOptions(r: ResponseValue, key: string[], k?: number): Parts {
  const total = key.length;
  if (r.kind !== "options") return { correct: 0, wrong: total, total };

  const chosen = new Set(r.options);
  if (k !== undefined && chosen.size > k) return { correct: 0, wrong: total, total };

  const keySet = new Set(key);
  let correct = 0;
  let wrong = 0;
  for (const option of chosen) {
    if (keySet.has(option)) correct += 1;
    else wrong += 1;
  }
  return { correct, wrong, total };
}
