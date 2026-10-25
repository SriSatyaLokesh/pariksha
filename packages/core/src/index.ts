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

// The downloadable import sample (`D18`): one question of every type, for
// the organiser's import page. `apps/api/test/import/json.test.ts` puts it
// through the real import route, which is what makes "it cannot drift from
// what the importer accepts" a guard rather than a hope.
export { sampleBank, SAMPLE_BANK_FILENAME } from "./sample.js";

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

// T-17 / AC-12's registration rules (Phase 6 Task 3, #67). The one copy:
// the builder's preview, the candidate's own form and the server's 422 all
// call `validateRegistration`, so the sentence a candidate reads in the
// browser is the sentence the server would have answered with. The regex
// matcher is injected because a bounded one needs a host this pure package
// does not have (#129).
export * from "./registration.js";

// Phase 7a Task 1 (`Q1`): `resolveProctoring()` turns a `profile` and its
// overrides into one fully-populated `ResolvedProctoring`, and
// `proctoringRequirements` (`Q1b`) turns that into the start page's plain
// sentences. Every later Phase 7 reader — the editor, the candidate-side
// gates, the camera, the consequences — resolves through this instead of
// branching on `profile` itself.
export * from "./proctoring.js";

// Phase 7e Task 1 (`P-09`, issue #213): `violationOutcome()` is the one
// place `violations >= limit` turns into a decision — warn, flag,
// auto-submit or lock. `apps/api/src/routes/proctoring.ts` is the only
// caller today; Tasks 2 and 3 of this plan branch on its `kind` to act.
export * from "./proctoring-outcome.js";

// Phase 7e Task 5 (`Q6`, `P7E-R9`): `integrityFor()` is the one place the
// events, the snapshots and the resolved proctoring settings turn into the
// flag an organiser reads — `clean` / `review` / `high_risk` — plus whether
// anyone was watching. `apps/api/src/routes/proctoring.ts` and
// `apps/api/src/run/submit.ts` are the two callers.
export * from "./integrity.js";

// Phase 8a Task 3 (`K6`): `countedScore()` turns a candidate's attempt
// scores and `timing.counted_attempt` into the one counted figure —
// `CountedAttempt` itself is already public off `types.js`, above. The
// candidate's own result page (`apps/api/src/run/release.ts`, `K7`), the
// organiser's results CSV and the analytics screen (8c) all call this
// rather than growing three readings of "best"/"latest"/"average".
export * from "./counted.js";

// Phase 8a Task 4 (`K8`): `toCsv()` is the one CSV serialiser every export
// route builds its file through, `csvFilename()` is R-10's exact filename
// shape, and `CsvPage` is the one page-of-an-export shape 8c and 8e's
// paginated routes return (`K38`: a route that reached its bound always
// returns a cursor).
export * from "./csv.js";

// Phase 8a Task 5 (`K28`, `K35`): `resolveRetention` applies S-13's deletion
// defaults over `Test.retention` (`types.js`), and `estimateCost` composes
// `snapshotCost` (above) into the one per-candidate request/byte estimate
// the Results panel, the webhook panel (8d), the free-tier dashboard (8e)
// and the publish checklist all read.
export * from "./cost.js";

// Phase 8c Task 2 (`R-07`, `K19`, `K20`): `itemAnalysis()` turns one fetch
// of a test's attempts and responses into a per-question share-correct,
// discrimination index and option pick-rate breakdown, in a single pass.
// `packages/db/src/repo/analytics.ts` and the analytics screen are its
// consumers.
export * from "./item-analysis.js";

// Phase 11 Task 1 (O-06): Extensibility plugin interface and registry.
export * from "./plugins/index.js";

// Phase 11 Task 2 (T-24): Internationalization and RTL translation.
export * from "./i18n/index.js";
