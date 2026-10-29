# Design Specification: Human-Readable Answer & Key Display in Attempt Review

**Issue**: [#274](https://github.com/SriSatyaLokesh/pariksha/issues/274)  
**Date**: 2026-10-29  
**Status**: Pending Review  

## 1. Intent & The Why

In the Attempt Review screen (`AttemptReview.tsx`), candidate responses and scoring keys are currently rendered using a generic `formatValue()` fallback that defaults to `JSON.stringify(val)` in monospace code boxes (e.g., `{"kind":"options","options":["e","b"]}`, `{"value":25,"tolerance":0.5,"tolerance_type":"absolute"}`). Furthermore, question prompts and stems are completely missing, so reviewers only see "Question 1", "Question 2" without any question text.

Organisers and evaluators require a clear, human-readable view where:
1. The question stem/prompt is immediately visible.
2. Candidate answers and expected scoring keys are rendered using semantic badges, formatted numbers with tolerances, and comparison tables.
3. Verdicts and point values are immediately scannable.

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- **Prompts on Review Cards**: Display `ans.prompt` prominently beneath the question header.
- **Human-Readable Answer Formats**:
  - Choice options (`option`, `options`, `select_k`, `true_false`): Render uppercase badge pills (e.g. `[B]`, `[E]`), indicating correctness when compared against the key.
  - Numeric responses: Render bare formatted numbers with explicit tolerance callouts (e.g., `23` vs `25 (± 0.5)`).
  - Matching / Map responses: Render clean key-value pair rows or a side-by-side comparison table (`Prompt Item ➔ Matched Option`).
  - Fill-in Blanks: Render clean labeled chips for each blank (e.g. `Blank 1: 52`, `Blank 2: 67`).
  - Text responses: Render cleanly formatted text paragraphs without JSON quotes or object syntax.
  - Graceful fallback: If an unrecognized or null answer is provided, show `—` or empty state.
- **Backend Enrichment**: Pass `prompt`, `questionType`, and optional `title` in the answers array of `GET /api/v1/workspaces/:id/attempts/:attemptId/review`.
- **Accessibility & Contrast**: Strict compliance with `@pariksha/web` design tokens and `contrast-usage.test.ts`.

### Non-Goals
- Enumerating all possible distractors/unselected options for every question (the user specifically stated: "at least questions has to be visible, no need of all options, so that they can clearly read as a human").
- Live candidate-side changes. This change applies exclusively to the organiser attempt review page (`attempts.read_evidence`).

### Anti-Goals
- Introducing external formatting or diffing libraries (`ponytail` adherence: vanilla React components and native CSS).
- Leaking question scoring keys to candidate endpoints (K-gate / KG1 compliance preserved).

## 3. Constraints

- **Security & Authorization**: The review route remains guarded by `attempts.read_evidence`.
- **Theme Variables**: All styles must use `theme.css` tokens (`--ground`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--accent`, `--risk`, `--warn`, `--edge`).
- **Contrast Audit**: Any CSS selector setting `color:` must be registered in `apps/web/test/contrast-usage.test.ts`.
- **Backward Compatibility**: If legacy attempt responses or malformed objects are loaded, the renderers must not crash and gracefully fall back to formatted string representations.

## 4. Approaches

### Approach A: Structured Side-by-Side Comparison Box (Selected)
- Inside each question card:
  - Header: Question Number, Points Awarded / Max Points, Verdict Badge (`Correct`, `Incorrect`, `Pending`).
  - Body: Question prompt text.
  - Comparison Container: Two-column grid (`Candidate Answer` vs `Expected Key`).
  - Formatters: Dedicated components/renderers for `OptionBadges`, `NumericComparison`, `MatchingTable`, `BlankChips`, and `TextResponse`.
- *Pros*: Clear, predictable scanning for organisers; consistent layout across all 12 question types.
- *Cons*: Slightly taller cards compared to raw text.

### Approach B: Unified Inline Annotation (Considered & Rejected)
- Candidate answers displayed inline under the stem with inline status icons; expected key shown only when incorrect.
- *Reason for Rejection*: Inconsistent height and layout across question types (e.g., matching tables vs single numbers), making systematic review jarring.

## 5. Architectural Changes

### 5.1 Backend: `apps/api/src/routes/attempt-review.ts`
Update `answers` mapping in `attemptReviewRoutes`:
```ts
const qDoc = questionsMap.get(qId);
answers.push({
  questionId: qId,
  sectionId: section.sectionId,
  prompt: qDoc?.prompt ?? null,
  questionType: qDoc?.type ?? null,
  answer: answerVal,
  key: keyVal,
  pointsAwarded,
  maxPoints,
  correct,
  ...(verdict !== undefined && { verdict }),
});
```
Update `AttemptReviewPayload["answers"]` and web `AttemptReviewData["answers"]` types.

### 5.2 Frontend: `apps/web/src/components/organiser/AttemptReview.tsx`
1. **Helper Renderers**:
   - `renderCandidateAnswer(answer: unknown, key: unknown)`: Inspects `kind` or raw value:
     - `kind === "option"`: Single choice badge.
     - `kind === "options"`: Multiple choice badges, with cross/check status based on `key`.
     - `kind === "number"`: Numeric formatted value.
     - `kind === "map"`: Key-value matching list.
     - `kind === "blanks"`: Blank pills (`Blank 1: ...`).
     - `kind === "text"` / string: Clean paragraph.
   - `renderCorrectKey(key: unknown)`: Formats array, string, `NumericKey` (`{ value, tolerance, tolerance_type }`), or matching dictionary into matching visual presentation.
2. **Card Markup**:
   - Display `ans.prompt` inside `.attempt-review__question-prompt`.
   - Replace raw `.attempt-review__code-box` with semantic `.attempt-review__answer-comparison` containing `.attempt-review__answer-col`.
   - Update header verdict with styled badge classes (`status-badge status-badge--success` / `status-badge status-badge--blocked`).

### 5.3 Styles: `apps/web/src/styles/admin.css`
- Add styling for prompt, comparison columns, choice badges, match tables, and tolerance callouts using existing CSS variables.
- Register any newly added text selectors into `apps/web/test/contrast-usage.test.ts`.

## 6. Verification Plan
1. **Unit Tests**:
   - API: Update `apps/api/test/attempt-review.test.ts` to assert `prompt` and `questionType` are returned in `answers`.
   - Web: Update `apps/web/test/organiser/attempt-review.test.tsx` with fixtures for multiple-choice, numeric with tolerance, matching pairs, and blanks. Verify human-readable strings and badges are rendered without raw JSON braces (`{"kind":...}`).
2. **Quality Gates**:
   - `pnpm --filter @pariksha/api test`
   - `pnpm --filter @pariksha/web test`
   - `pnpm --filter @pariksha/web exec vitest run test/contrast-usage.test.ts test/theme.test.ts`
   - `pnpm typecheck`
   - `pnpm lint`
