// The single place scoring-mode arithmetic lives. Every grader (choice,
// structured, text, manual) reduces its type-specific comparison to a
// `parts` count — how many pieces of the answer were right, how many
// wrong, how many there are in all — and hands that to `applyMode`. The
// Regrade feature (a later phase) calls `applyMode` directly against
// stored responses, so this file's signatures are a contract other tasks
// are written against.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import type { Question, QuestionType, ScoringConfig, ScoringMode } from "../types.js";

export interface GradeResult {
  /** Points awarded, rounded to 2 decimal places. */
  points: number;
  /** The question's points (its `max`), rounded to 2 decimal places. */
  max: number;
  /** null for manual types (rubric mode) awaiting a reviewer. */
  correct: boolean | null;
  parts?: { correct: number; wrong: number; total: number };
}

export interface ScoringDefaults {
  mode: ScoringMode;
  negativeFraction: number;
}

/**
 * The engine's built-in points-per-question default. Neither the question
 * schema nor the test schema's scoring defaults declare a fallback for
 * `points` (unlike `mode` and `negative_fraction`, which the test's
 * `scoring.default_mode` / `scoring.negative_fraction` cover) — see
 * `schemas/question-1.json` and `schemas/test-1.json`. Every fixture in
 * practice sets `scoring.points` explicitly; this constant only guards the
 * case where it is omitted at every level.
 */
const DEFAULT_POINTS = 1;

/**
 * Resolves a question's effective scoring configuration: its own
 * `scoring` block, falling back field by field to the caller-supplied
 * defaults (typically the test's `scoring.default_mode` /
 * `negative_fraction`). `points` has no such external default, so it
 * falls back to `DEFAULT_POINTS` instead.
 */
export function resolveScoring(
  q: Question,
  d: ScoringDefaults,
): { mode: ScoringMode; points: number; negativeFraction: number } {
  const scoring: ScoringConfig | undefined = q.scoring;
  return {
    mode: scoring?.mode ?? d.mode,
    points: scoring?.points ?? DEFAULT_POINTS,
    negativeFraction: scoring?.negative_fraction ?? d.negativeFraction,
  };
}

/**
 * Rounds to 2 decimal places, half up (away from zero), correcting for
 * binary floating-point representation error.
 *
 * `Number(n.toFixed(2))` is not enough: `toFixed` rounds some exact-half
 * values the "wrong" way because it operates on the double's true binary
 * value rather than the decimal value a reader intended (famously,
 * `(1.005).toFixed(2)` is `"1.00"`, not `"1.01"`).
 *
 * The fix: convert the number through its shortest round-trip decimal
 * string representation (what `${n}` produces) and shift the decimal
 * point via exponent notation (`e2` / `e-2`) rather than via binary
 * multiplication/division. `Number("<string>e2")` re-parses the *decimal*
 * value the string names — not a value already corrupted by multiplying
 * a binary double by 100 — so the subsequent `Math.round` sees the
 * digits the author actually wrote, and rounds half away from zero
 * correctly in both directions this file is tested against:
 * `round2(0.125) === 0.13` and `round2(7.199999999999999) === 7.2`.
 */
export function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  const scaled = Number(`${abs}e2`);
  // `${abs}` is already exponential notation for a magnitude small or
  // large enough ((1e-7).toString() === "1e-7"), so appending another
  // "e2" produces a malformed string ("1e-7e2") that Number() can't
  // parse, and `scaled` is silently NaN. schemas/question-1.json only
  // requires points > 0 (exclusiveMinimum: 0), so points: 1e-7 is
  // schema-valid, and the NaN would otherwise propagate into the section
  // total, the attempt total and the percentage. A magnitude that small
  // or large is never near a decimal boundary where binary
  // floating-point error at 2 decimal places could matter, so the plain
  // multiply-then-round this file otherwise avoids is exact enough here.
  if (!Number.isFinite(scaled)) return sign * (Math.round(abs * 100) / 100);
  const rounded = Math.round(scaled);
  return sign * Number(`${rounded}e-2`);
}

export function applyMode(input: {
  mode: ScoringMode;
  points: number;
  negativeFraction: number;
  parts: { correct: number; wrong: number; total: number };
  answered: boolean;
}): GradeResult {
  const { mode, points, negativeFraction, parts, answered } = input;
  const max = round2(points);

  // rubric is graded manually: this layer never awards points for it, it
  // only reports that the question awaits a reviewer.
  if (mode === "rubric") {
    return { points: 0, max, correct: null, parts };
  }

  // A blank response scores 0 and never loses points, in every mode.
  if (!answered) {
    return { points: 0, max, correct: false, parts };
  }

  switch (mode) {
    case "all_or_nothing": {
      const correct = parts.wrong === 0 && parts.correct === parts.total;
      return { points: correct ? max : 0, max, correct, parts };
    }
    case "partial": {
      const raw = (points * (parts.correct - parts.wrong)) / parts.total;
      const correct = parts.wrong === 0 && parts.correct === parts.total;
      return { points: round2(Math.max(0, raw)), max, correct, parts };
    }
    case "negative": {
      // Same shape as all_or_nothing, plus a flat penalty the instant any
      // part is marked wrong (never below the floor the negative_fraction
      // implies — a single question may go negative; clamping to zero
      // happens at the section/attempt boundary, in a later task).
      if (parts.wrong > 0) {
        return { points: round2(-negativeFraction * points), max, correct: false, parts };
      }
      const correct = parts.correct === parts.total;
      return { points: correct ? max : 0, max, correct, parts };
    }
    case "position": {
      const raw = (points * parts.correct) / parts.total;
      const correct = parts.correct === parts.total;
      return { points: round2(raw), max, correct, parts };
    }
  }
}

/**
 * Mode-to-type applicability, mirroring the "Scoring modes" table in
 * `docs/question-format.md`: `all_or_nothing` and `negative` apply to
 * every auto-graded type; `partial` only to the five part-counted types
 * (`multiple`, `select_k`, `matching`, `multi_matching`, `fill_blank`);
 * `position` only to `ordering`; `rubric` only to the two manually-graded
 * types (`short_answer`, `long_answer`), which take no other mode.
 */
export const APPLICABLE_MODES: Readonly<Record<QuestionType, readonly ScoringMode[]>> = {
  single: ["all_or_nothing", "negative"],
  multiple: ["all_or_nothing", "partial", "negative"],
  select_k: ["all_or_nothing", "partial", "negative"],
  true_false: ["all_or_nothing", "negative"],
  assertion_reason: ["all_or_nothing", "negative"],
  matching: ["all_or_nothing", "partial", "negative"],
  multi_matching: ["all_or_nothing", "partial", "negative"],
  ordering: ["all_or_nothing", "negative", "position"],
  fill_blank: ["all_or_nothing", "partial", "negative"],
  numeric: ["all_or_nothing", "negative"],
  short_answer: ["rubric"],
  long_answer: ["rubric"],
};
