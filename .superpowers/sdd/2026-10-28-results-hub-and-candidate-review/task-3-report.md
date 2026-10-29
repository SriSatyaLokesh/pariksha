# Task 3 Progress Report: Results Hub Workspace Test Picker (`apps/web`)

## Status: DONE

## Commit
- Hash: `c5484088f8d917705276701a4ea757a5a245ca5a`
- Author: `Satya K <srisatyalokesh2.12@gmail.com>`
- Message: `feat(web): implement Results Hub workspace test picker`

## Files Modified / Created
1. `apps/web/src/routes/results-hub.tsx` (created):
   - Implemented `ResultsHub` component with props `{ client, workspaceId, onSelectTest }`.
   - Fetches `client.resultsOverview(workspaceId)` on mount with cancellation and error handling.
   - Header with `<h1>Results</h1>` and page lead paragraph.
   - Graceful loading state (`<p className="organiser__status" role="status">Loading…</p>`).
   - Clean error alert (`<p className="organiser__notice" role="alert">`).
   - Empty state using `<CardHairline className="organiser-empty">` when 0 tests exist.
   - Accessible table with sticky header wrapper (`role="region"`, `aria-label="Tests results overview"`, `<th scope="col">`), displaying:
     - Test name and slug
     - State badge (`<TestStateBadge state={test.state} />`)
     - Candidate count (`tabular-nums`)
     - Submissions count `${test.submittedCount} / ${test.candidateCount}` (`tabular-nums`)
     - Class average score with percentage or "—" if unscored (`tabular-nums`)
     - Pass rate percentage or "—" if unscored (`tabular-nums`)
     - "Open results" button with accessible `aria-label` calling `onSelectTest(test.id)`
2. `apps/web/src/routes/organiser.tsx` (modified):
   - Imported `ResultsHub` from `./results-hub`.
   - Wired `case "results":` branch:
     - When `!view.testId`, renders `ResultsHub` in `shell("results", ...)` and navigates to `{ kind: "results", actor, workspace, testId }` on test selection.
     - When `view.testId` is present, renders placeholder `<div data-testid="test-results-view">Test Results {view.testId}</div>` pending Task 4.
3. `apps/web/test/organiser/results-hub.test.tsx` (created):
   - Strict TDD suite testing:
     - Loading state while API call is pending.
     - Full test list rendering with test title, slug, state badge, candidate count, submissions count, class average, pass rate, and table column headers.
     - Empty state when workspace has 0 tests.
     - Zero submissions / unscored test (`averageScore: null`, `passRate: null`) displaying "—".
     - Action button "Open results" calling `onSelectTest(test.id)`.
     - Error state handling when API fails.

## Verification
- Unit test suite:
  - `pnpm --filter @pariksha/web exec vitest run test/organiser/results-hub.test.tsx`: 6/6 passed.
- Regression & navigation verification:
  - `pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx`: 23/23 passed.
  - `pnpm --filter @pariksha/web exec vitest run test/organiser/`: 128/128 passed (10 test files).
- Typecheck:
  - `pnpm --filter @pariksha/web typecheck`: 0 errors.
