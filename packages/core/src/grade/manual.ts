// Grades the two manually-scored types: short_answer and long_answer. A
// reviewer's rubric selection is not a candidate response — it is produced
// after the fact by a human reading the answer, not chosen by the candidate
// — so it travels as its own argument rather than through the `parts` /
// `answered` machinery `applyMode` (grade/result.ts) gives the auto-graders.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import type { LongAnswerQuestion, Question, ShortAnswerQuestion } from "../types.js";
import type { GradeResult, ScoringDefaults } from "./result.js";
import { resolveScoring, round2 } from "./result.js";

export type ManualQuestion = ShortAnswerQuestion | LongAnswerQuestion;

export function isManualQuestion(q: Question): q is ManualQuestion {
  return q.type === "short_answer" || q.type === "long_answer";
}

/**
 * A reviewer's rubric selection for one question: the `rubric[].level`
 * names they picked, by their `level` field. This is deliberately not a
 * `ResponseValue` kind — a candidate never gets to choose which rubric
 * level they receive, so it is not part of what a candidate submits.
 */
export interface RubricAward {
  levels: readonly string[];
}

/**
 * Grades one manually-scored question against a reviewer's `RubricAward`.
 *
 * `award === null` means no reviewer has graded it yet: 0 points, `correct:
 * null` (awaiting review), and its `max` still counts — the caller
 * (`scoreAttempt`) is what turns this into a `pending` entry, since only it
 * knows whether the candidate even answered.
 *
 * Both manual types may carry an authored `rubric` array (see
 * `docs/question-format.md`), and an award names levels from it by their
 * `level` field. A level the question does not define is worth nothing, so a
 * question authored without a rubric sums to 0 whatever a reviewer picks —
 * in practice a reviewer UI would not offer a picker with no levels in it.
 */
export function gradeManual(q: ManualQuestion, award: RubricAward | null, d: ScoringDefaults): GradeResult {
  const { points } = resolveScoring(q, d);
  const max = round2(points);

  if (award === null) {
    return { points: 0, max, correct: null };
  }

  const pointsByLevel = new Map((q.rubric ?? []).map((l) => [l.level, l.points]));
  const sum = award.levels.reduce((total, level) => total + (pointsByLevel.get(level) ?? 0), 0);
  return { points: round2(sum), max, correct: null };
}

/**
 * Reconstructs a `RubricAward` from a graded response's stored `points`,
 * matched against the question's **current** rubric — the replay a caller
 * needs wherever only `points` was persisted and the original `levels` a
 * reviewer picked were not (`K14`: grading writes `response.points`/
 * `graded_by` and nothing else, so this is how "what was this question
 * awarded" is answered back out, by both `packages/db`'s `listPendingAwards`
 * and `apps/api`'s `recordAward` rescore replay — one definition, because a
 * second one is exactly how the two would drift).
 *
 * Returns `null`, not `{ levels: [] }`, when the stored points cannot be
 * reproduced from the current rubric — `{ levels: [] }` is a real, different
 * state ("awarded zero"). A caller that inserted a zero-scoring award here
 * would silently erase a candidate's credit the moment an organiser edited
 * the rubric level that had earned it; `null` is "not reconstructable",
 * which a caller must treat as still pending a human, never as zero.
 *
 * 0 points is the one amount that never needs a rubric at all — `{ levels:
 * [] }` sums to 0 under any rubric, so it round-trips exactly always.
 */
export function deriveAward(q: Question | undefined, points: number): RubricAward | null {
  if (points === 0) return { levels: [] };
  if (q === undefined || !isManualQuestion(q)) return null;
  const level = (q.rubric ?? []).find((l) => l.points === points);
  return level ? { levels: [level.level] } : null;
}
