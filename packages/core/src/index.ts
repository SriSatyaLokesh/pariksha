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
// it. `selectForSection` stays internal: later packages only need the
// whole-attempt `layoutForAttempt`, which already calls it per section.
// `matchesFilter` is public (Phase 5 Task 3, #55): the test builder's live
// "N drawn from M matching" (UX-15) counts a pool with the very arithmetic
// that will later draw from it, the same reason `validate.ts` (inside this
// package) already needed it — apps/api is just a second consumer of the
// same guarantee.
export type { AttemptLayout } from "./select.js";
export { PoolTooSmallError, assignSet, layoutForAttempt, matchesFilter } from "./select.js";

// Cross-field import validation, for a bank and for a test document.
export * from "./validate.js";

// WCAG contrast, for T-23's brand colour (Task 10, #61, P5.8). Public
// because three callers need the identical number: the colour picker, the
// server that re-checks the write, and the two apps/web test files that
// used to carry their own copy of this arithmetic.
export * from "./contrast.js";

// The repo's one regex-safety gate. Public since Task 5 (#57, P5.4): the
// registration form's `validation.pattern` is organiser-supplied and is
// compiled in the *builder's* browser to preview the candidate's own error
// message, so the preview must refuse exactly the patterns the server
// refuses rather than hand-roll a second, weaker check one package over.
// `compilePattern` stays internal — grading is the only caller that needs
// a compiled regex back.
export { assertSafeRegex, MAX_REGEX_LENGTH } from "./grade/text.js";

// The per-workspace permission matrix (docs/PRD.md, "Roles and permissions")
// and the pure `can()` that the API's route guard and the web interface both
// answer with, so neither can drift from the table.
export * from "./permissions.js";
