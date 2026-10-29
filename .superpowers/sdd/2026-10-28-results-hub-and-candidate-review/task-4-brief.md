# Task 4 Brief: Candidate Results Table & Test Results Route (`apps/web`)

## Files
- Create: `apps/web/src/components/organiser/ResultsTable.tsx`
- Create: `apps/web/src/routes/results.tsx`
- Modify: `apps/web/src/routes/organiser.tsx`
- Modify: `apps/web/src/routes/test.tsx`
- Test: `apps/web/test/organiser/results-table.test.tsx`
- Test: `apps/web/test/organiser/results-route.test.tsx`

## Global Constraints & Style
- **Ponytail Style:** Laziest, cleanest code. Minimum diffs, standard React state, no redundant abstractions.
- **Senior Fullstack Style:**
  - Accessible tables (`<th scope="col">`, `<caption className="sr-only">`, `aria-expanded` on accordion toggles).
  - All numerical scores, ranks, and percentages in `tabular-nums`.
  - Badges: Pass (green ink/border), Fail (red/danger), Clean (neutral/clean), Review (amber/warning), Scoring blocked (purple/blocked). Include `.sr-only` text for assistive tech.
  - Expandable row accordion with clear toggle button (`▼` / `▲`).
  - Search input with debounce or direct filter, status select filter (`all`, `submitted`, `in_progress`, `locked`), integrity select filter (`all`, `clean`, `review`, `scoring_blocked`).
  - Minimum 44px touch targets.
  - CSV export draining via `client.exportPage`.
- **Git Author:** Every git commit MUST use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
- **Zero Key Leakage (`KG1`):** The question breakdown only displays `promptExcerpt`, `pointsEarned`, `maxPoints`, and `correct`. Never display or expect answer keys.

## Requirements

### 1. `apps/web/src/components/organiser/ResultsTable.tsx`
Props:
```tsx
export interface ResultsTableProps {
  testId: string;
  workspaceId: string;
  client: ApiClient;
  results: TestResultAttempt[];
  totalPoints: number;
  passMark: number | null;
  nextCursor?: string | null | undefined;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onReviewAttempt: (attemptId: string) => void;
  onFilterChange?: (filters: { status: string; integrity: string; search: string }) => void;
}
```
Features:
- Filter toolbar:
  - Search input (placeholder: "Search by candidate name or email…")
  - Status filter dropdown (`All statuses`, `Submitted`, `In progress`, `Locked`)
  - Integrity filter dropdown (`All integrity`, `Clean`, `Review required`, `Scoring blocked`)
  - Export buttons: "Export Results (CSV)" and "Export Answers (CSV)" which use `client.exportPage(workspaceId, testId, "results" | "answers")` to drain and trigger download.
- Table columns:
  1. **Expand**: Accordion toggle button (`aria-expanded={isExpanded}`, `▼` / `▲`).
  2. **Rank**: `#1`, `#2`, or `—` for unscored.
  3. **Candidate**: Candidate name in bold, email/external ID below in muted text.
  4. **Status**: Badge (`Submitted`, `Auto-submitted`, `In progress`, `Locked`).
  5. **Score**: `${score} / ${maxScore ?? totalPoints}` (in `tabular-nums`, or `—` if unscored).
  6. **Percentage**: `${percentage.toFixed(1)}%` (in `tabular-nums`, or `—` if unscored).
  7. **Result**: Badge (`Pass` / `Fail`, or `—` if unscored).
  8. **Integrity**: Badge (`Clean`, `Review`, `Blocked`).
  9. **Submitted**: Formatted relative or short date, or `—` if in progress.
  10. **Action**: "Review" button calling `onReviewAttempt(attempt.attemptId)`.
- Expanded accordion detail row:
  - Spans all columns.
  - Displays a clean nested list or table of questions:
    - Question index (`Q1`, `Q2`, etc.)
    - Question prompt excerpt
    - Points: `${pointsEarned} / ${maxPoints}`
    - Status: `✓ Correct` / `✗ Incorrect` / `Pending`
- Pagination:
  - When `nextCursor` exists, display a "Load more candidates" button.
- Empty states:
  - When no results exist matching filters, show a helpful message.

### 2. `apps/web/src/routes/results.tsx`
Props:
```tsx
export interface ResultsRouteProps {
  client: ApiClient;
  workspaceId: string;
  testId: string;
  onBack: () => void;
  onReviewAttempt: (attemptId: string) => void;
}
```
Features:
- Loads test results from `client.testResults(workspaceId, testId, queryOptions)` on mount and when filters change.
- Top navigation bar:
  - Back button (e.g. `← Back to Results Hub` calling `onBack`).
  - Test title and badge.
- Metric summary cards (4 cards in a responsive grid):
  1. **Registered Candidates**: `summary.totalRegistered`
  2. **Submitted**: `summary.submittedCount` (with in-progress and locked subtext)
  3. **Class Average**: `summary.averageScore !== null ? `${summary.averageScore}%` : "—"`
  4. **Pass Rate**: `summary.passRate !== null ? `${Math.round(summary.passRate * 100)}%` : "—"` (with pass mark if available)
- Renders `<ResultsTable />`.

### 3. `apps/web/src/routes/organiser.tsx`
- In `case "results":`:
  ```tsx
  if (view.testId) {
    return shell(
      "results",
      view.actor,
      view.workspace,
      { title: "Test Results", crumb: "Results" },
      <ResultsRoute
        client={client}
        workspaceId={view.workspace.id}
        testId={view.testId}
        onBack={() => go({ kind: "results", actor: view.actor, workspace: view.workspace })}
        onReviewAttempt={(attemptId) =>
          go({ kind: "attempt", actor: view.actor, workspace: view.workspace, attemptId, testId: view.testId })
        }
      />,
    );
  }
  ```
- In `case "attempt":`:
  Ensure `onBack` in `AttemptRoute` returns to `{ kind: "results", actor: view.actor, workspace: view.workspace, testId: view.testId }` when `view.testId` is defined!

### 4. `apps/web/src/routes/test.tsx`
- Add `canViewResults = role !== undefined && can({ role, action: "results.export" });`
- Add `onOpenResults?: (testId: string) => void;` to `TestProps`.
- In header lifecycle actions (next to `Grading queue` and `Analytics`):
  ```tsx
  {canViewResults && (
    <button type="button" className="button-secondary" onClick={() => onOpenResults?.(testId)}>
      Results
    </button>
  )}
  ```
- Wire `onOpenResults` in `apps/web/src/routes/organiser.tsx` when rendering `<TestRoute />`.

### 5. Tests
- `apps/web/test/organiser/results-table.test.tsx`:
  - Renders rows with candidate details, scores, badges, and review button.
  - Expand/collapse accordion displays question breakdown.
  - Search filter updates visible candidate rows.
  - Status and integrity dropdowns filter rows.
  - Review button invokes `onReviewAttempt`.
  - Empty filter state.
- `apps/web/test/organiser/results-route.test.tsx`:
  - Renders metric cards (Registered, Submitted, Class Average, Pass Rate).
  - Back button calls `onBack`.
  - Loads results on mount and handles pagination.

## Verification Commands
```bash
pnpm --filter @pariksha/web exec vitest run test/organiser/results-table.test.tsx test/organiser/results-route.test.tsx
```

## Commit Message
```bash
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): add candidate results table and test results view"
```
