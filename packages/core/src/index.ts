// The public surface of @pariksha/core: everything a later package (apps/api,
// apps/web, packages/db) needs to author, grade and select questions.
// Nothing else in the workspace may import from "@pariksha/core/src/..." —
// see test/acceptance.test.ts, which asserts that.

export const CORE_VERSION = "1";

// The question, bank, test-section and response types every consumer needs
// to call anything below.
export * from "./types.js";

// Grading: the single dispatch entry point, manual (rubric) grading and its
// RubricAward input type.
export * from "./grade/index.js";
export * from "./grade/manual.js";

// `applyMode` is re-run directly by the Regrade feature (a later phase)
// against stored responses, and `APPLICABLE_MODES` is the source of truth
// import validation (and this package's own acceptance matrix) checks a
// question's `scoring.mode` against. `GradeResult` / `ScoringDefaults` are
// the parameter and return types `gradeQuestion` and `scoreAttempt` already
// expose. `round2` is public because the landing page's hero demo
// (apps/web/src/island/exam-demo.ts) sums three `GradeResult.points` and
// must round the total with this package's own arithmetic rather than its
// own — it is the only rounding that island is permitted to do.
// `resolveScoring` stays internal: no consumer outside this package needs it.
export type { GradeResult, ScoringDefaults } from "./grade/result.js";
export { applyMode, APPLICABLE_MODES, round2 } from "./grade/result.js";

// The choice-family grader on its own. The landing page's hero demo imports
// it directly rather than `gradeQuestion`, because `gradeQuestion`'s static
// reference to `grade/text.ts` pulls that file's pattern compiler into a
// bundle a choice-only demo can never reach (v3 design contract §2.5).
export { gradeChoice } from "./grade/choice.js";
export type { ChoiceQuestion } from "./grade/choice.js";

// Attempt aggregation (section and total scoring).
export * from "./score.js";

// Seeded, deterministic randomness for presentation order. `shuffle` (the
// generic Fisher-Yates helper) stays internal; `select.ts` already composes
// it into `selectForSection` / `layoutForAttempt`, and no consumer needs the
// raw primitive.
export { makeRng, shuffleOptions } from "./rng.js";

// Question selection and per-attempt layout. `PoolTooSmallError` must be a
// value export (not just a type) so callers can `catch` and `instanceof`
// it. `selectForSection` and `matchesFilter` stay internal: later packages
// only need the whole-attempt `layoutForAttempt`, which already calls
// `selectForSection` per section, and `matchesFilter` is exported from
// select.ts solely so validate.ts counts a pool with the same arithmetic
// that draws from it.
export type { AttemptLayout } from "./select.js";
export { PoolTooSmallError, assignSet, layoutForAttempt } from "./select.js";

// Cross-field import validation, for a bank and for a test document.
export * from "./validate.js";
