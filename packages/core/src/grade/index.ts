// Dispatches any of the 12 question types to its grader. A `switch` with no
// `default` branch: adding a 13th type without touching this file becomes a
// compile error (every branch of `Question` must be matched), not a
// runtime surprise. Do not add a `default` case to silence that error —
// handle the new type instead.

import type { Question, ResponseValue } from "../types.js";
import type { GradeResult, ScoringDefaults } from "./result.js";
import { gradeChoice } from "./choice.js";
import { gradeStructured } from "./structured.js";
import { gradeText } from "./text.js";
import { gradeManual } from "./manual.js";

/**
 * Grades one question against a candidate's response.
 *
 * `short_answer` and `long_answer` are manually scored against a reviewer's
 * `RubricAward`, not against the candidate's response — and a
 * `RubricAward` is deliberately not a `ResponseValue` kind, so this
 * function has no channel to receive one. For those two types it always
 * reports "awaiting a reviewer" (`correct: null`, 0 points); `scoreAttempt`
 * (score.ts) calls `gradeManual` directly with the real award instead of
 * going through this dispatcher.
 */
export function gradeQuestion(q: Question, r: ResponseValue | null, d: ScoringDefaults): GradeResult {
  switch (q.type) {
    case "single":
    case "multiple":
    case "select_k":
    case "true_false":
    case "assertion_reason":
      return gradeChoice(q, r, d);
    case "matching":
    case "multi_matching":
    case "ordering":
      return gradeStructured(q, r, d);
    case "fill_blank":
    case "numeric":
      return gradeText(q, r, d);
    case "short_answer":
    case "long_answer":
      return gradeManual(q, null, d);
  }
}
