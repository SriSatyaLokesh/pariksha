# Task 4 Progress Report: Candidate Results Table & Test Results Route (`apps/web`)

## Status: DONE

## Commits
- Hash: `ac39d86e7ffac772a7228c9281a9c7658f68a83c`
  - Author: `Satya K <srisatyalokesh2.12@gmail.com>`
  - Message: `feat(web): add candidate results table and test results view`
- Hash: `bf05efb`
  - Author: `Satya K <srisatyalokesh2.12@gmail.com>`
  - Message: `fix(results): address exactOptionalPropertyTypes and lint warnings in results routes and components`

## Files Created / Modified
1. `apps/web/src/components/organiser/ResultsTable.tsx` (created):
   - Comprehensive interactive table for candidate results.
   - Filter toolbar with text search (name/email/externalId), status filter dropdown (`all`, `submitted`, `in_progress`, `locked`), and integrity dropdown (`all`, `clean`, `review`, `scoring_blocked`).
   - Export actions: "Export Results (CSV)" and "Export Answers (CSV)" draining paginated export pages via `client.exportPage` and downloading directly in-browser.
   - Expandable question accordion per attempt displaying question number, prompt excerpt, points earned vs max points, and correct/incorrect status without leaking answer keys (`KG1`).
   - Accessible table structure (`<th scope="col">`, `aria-expanded`, `.sr-only` descriptions on badges, minimum 44px touch targets).
   - All numerical values, scores, and percentages formatted in `tabular-nums`.
   - Pagination support with "Load more candidates" button when `nextCursor` exists.
   - Graceful empty states when 0 results match active filters.
2. `apps/web/src/routes/results.tsx` (created):
   - Implemented `ResultsRoute` component with props `{ client, workspaceId, testId, onBack, onReviewAttempt }`.
   - Top navigation with `← Back to Results Hub` button and test title.
   - 4 responsive metric summary cards: Registered Candidates, Submitted Count, Class Average, and Pass Rate.
   - Renders `<ResultsTable />` and handles data fetching, search/filter updates, and pagination cursor state.
3. `apps/web/src/routes/organiser.tsx` (modified):
   - Wired `ResultsRoute` in `case "results":` when `view.testId` is defined.
   - Updated `case "attempt":` navigation to return directly to `results` when `testId` is present.
   - Wired `onOpenResults` handler in `case "test":`.
4. `apps/web/src/routes/test.tsx` (modified):
   - Added `onOpenResults` prop and gated "Results" button in the test builder header next to "Grading queue" and "Analytics" using `requires("results.export")`.
5. `apps/web/src/lib/download.ts` (modified):
   - Added `downloadCsv(csv, filename)` utility.
6. `apps/web/src/styles/admin.css` & `apps/web/src/styles/base.css` (modified):
   - Added design token styles for results headers, metric summary grid, toolbar, accordion, breakdown table, and status badges.
   - Added `.sr-only` utility matching `.visually-hidden`.
7. `apps/web/test/organiser/results-table.test.tsx` (created):
   - 8 unit tests covering rendering candidate rows, scores, badges, review buttons, expand/collapse question accordions, search filtering, status/integrity dropdown filtering, empty state, and CSV exports.
8. `apps/web/test/organiser/results-route.test.tsx` (created):
   - 6 unit tests covering metric summary cards, back button navigation, API loading, error handling, review attempt navigation, and pagination.

## Verification
- Unit test suite:
  - `pnpm --filter @pariksha/web exec vitest run test/organiser/results-table.test.tsx test/organiser/results-route.test.tsx`: 14/14 passed.
  - `pnpm --filter @pariksha/web exec vitest run test/organiser/results-hub.test.tsx test/organiser/results-nav.test.tsx`: 9/9 passed.
- Typecheck:
  - `pnpm typecheck`: 8/8 successful across monorepo.
- Lint:
  - `pnpm lint`: 8/8 successful across monorepo.
