# Task 3 Brief: Results Hub Workspace Test Picker (`apps/web`)

## Files
- Create: `apps/web/src/routes/results-hub.tsx`
- Modify: `apps/web/src/routes/organiser.tsx`
- Test: `apps/web/test/organiser/results-hub.test.tsx`

## Global Constraints & Style
- **Ponytail Style:** Laziest, cleanest solution. Keep diffs minimal, use existing HTML/CSS classes and design tokens (`admin.css`, `tabular-nums`), standard React hooks (`useState`, `useEffect`).
- **Senior Fullstack Style:** Accessible table markup (`role="region"`, `aria-label`, `<th scope="col">`), minimum 44px touch targets for buttons, graceful empty and loading states.
- **Git Author:** Every git commit MUST use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

## Requirements

### 1. `apps/web/src/routes/results-hub.tsx`
Export component:
```tsx
export interface ResultsHubProps {
  client: ApiClient;
  workspaceId: string;
  onSelectTest: (testId: string) => void;
}

export function ResultsHub({ client, workspaceId, onSelectTest }: ResultsHubProps)
```

Implementation details:
- On mount, fetches `client.resultsOverview(workspaceId)`.
- Handles `loading` and `error` states cleanly.
- Header:
  - Heading `<h1>Results</h1>`
  - Subtitle `<p className="page-lead">Select a test to review candidate submissions, scores, and exam integrity.</p>`
- Empty state when `tests.length === 0`:
  - An empty state card with message that no tests exist yet in this workspace.
- Table of tests when `tests.length > 0`:
  - Table container with sticky header styling.
  - Columns:
    1. **Test**: Test name in bold and slug in secondary text.
    2. **State**: `<TestStateBadge state={test.state} />` (imported from `./tests.js` or `./tests`).
    3. **Candidates**: `test.candidateCount` in `tabular-nums`.
    4. **Submissions**: `${test.submittedCount} / ${test.candidateCount}` in `tabular-nums`.
    5. **Class Average**: `test.averageScore !== null ? `${test.averageScore}%` : "—"` in `tabular-nums`.
    6. **Pass Rate**: `test.passRate !== null ? `${Math.round(test.passRate * 100)}%` : "—"` in `tabular-nums`.
    7. **Action**: Button "Open results" (with `aria-label={`Open results for ${test.name}`}`) calling `onSelectTest(test.id)`.

### 2. `apps/web/src/routes/organiser.tsx`
- Import `ResultsHub` from `./results-hub.js` (or `./results-hub`).
- Under `case "results":`, if `!view.testId`:
  Render `ResultsHub` wrapped in `shell`:
  ```tsx
  return shell(
    "results",
    view.actor,
    view.workspace,
    { title: "Results", crumb: "Results" },
    <ResultsHub
      client={client}
      workspaceId={view.workspace.id}
      onSelectTest={(testId) =>
        go({ kind: "results", actor: view.actor, workspace: view.workspace, testId })
      }
    />,
  );
  ```
  If `view.testId` is present, render placeholder `<div data-testid="test-results-view">Test Results {view.testId}</div>` until Task 4.

### 3. Tests: `apps/web/test/organiser/results-hub.test.tsx`
Write comprehensive tests using `@testing-library/react` and `fakeClient`:
- Renders loading state while waiting for API.
- Renders test list with title, state badge, candidate count, submissions count, class average, and pass rate.
- Displays empty state when workspace has 0 tests.
- Handles zero submissions / unscored test (`averageScore: null`, `passRate: null`) displaying "—".
- Clicking "Open results" button calls `onSelectTest` with `test.id`.

## Verification Commands
```bash
pnpm --filter @pariksha/web exec vitest run test/organiser/results-hub.test.tsx
```

## Commit Message
```bash
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): implement Results Hub workspace test picker"
```
