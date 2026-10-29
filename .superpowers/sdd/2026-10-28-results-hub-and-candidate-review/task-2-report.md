# Task 2 Report: Web Client API & Navigation Shell Wiring (`apps/web`)

## Summary
- **Status:** DONE
- **Commit:** `02e618751015cf4fd04eb1b9323212bc9ec11508`
- **Author:** `Satya K <srisatyalokesh2.12@gmail.com>`
- **Branch:** `feat/results-hub-and-candidate-review`

---

## Artifacts & Changes

### 1. Web Client API: `apps/web/src/lib/api.ts`
- Exported TypeScript interfaces matching backend response and query contract:
  - `TestResultsOverviewItem`
  - `TestResultAttempt`
  - `TestResultsSummary`
  - `TestResultsPayload`
  - `ResultsQueryOptions`
- Added methods to `ApiClient` interface:
  - `resultsOverview(workspaceId: string): Promise<{ tests: TestResultsOverviewItem[] }>`
  - `testResults(workspaceId: string, testId: string, options?: ResultsQueryOptions): Promise<TestResultsPayload>`
- Implemented both methods in `createApiClient()`:
  - `resultsOverview` calls `/workspaces/${workspaceId}/results/overview`.
  - `testResults` encodes optional query parameters (`status`, `integrity`, `search`, `limit`, `cursor`) and queries `/workspaces/${workspaceId}/tests/${testId}/results`.

### 2. Test Fixture Stubs: `apps/web/test/fixtures/api-client.ts`
- Added `resultsOverview: notStubbed("resultsOverview")` and `testResults: notStubbed("testResults")` to `fakeClient`.
- Preserves the single fixture contract and ensures zero test breakage across the broader test suite.

### 3. Organiser Shell Navigation: `apps/web/src/components/OrganiserShell.tsx`
- Extended `NavKey` union to include `"results"`:
  `export type NavKey = "home" | "banks" | "tests" | "results" | "teams" | "webhooks" | "keys";`
- Added `{ key: "results", label: "Results" }` after `"tests"` in `NAV` array (using the pre-existing `ICONS.results` SVG icon).

### 4. Query String Routing: `apps/web/src/lib/view-url.ts`
- Added `"results"` to `VIEWS` constant array, enabling `readView()` to recognize `?view=results` and `writeView()` to serialize it.

### 5. Organiser Route Wiring: `apps/web/src/routes/organiser.tsx`
- Added `results` view variant to `View` union:
  `| { kind: "results"; actor: Actor; workspace: Workspace; testId?: string | undefined }`
- Added `case "results"` handling to `fromUrl`:
  Maps `params.view === "results"` to the results view object, preserving optional `testId` from query params.
- Added `case "results"` handling to `paramsOf`:
  Serializes results view to `{ view: "results", ...(view.testId !== undefined && { test: view.testId }) }`.
- Added `case "results"` arm to `OrganiserApp`'s switch statement:
  Renders `OrganiserShell` with `current="results"`, title `"Results"`, crumb `"Results"`, and placeholder `<div data-testid="results-view">Results</div>`.

### 6. Tests: `apps/web/test/organiser-url.test.tsx` & `apps/web/test/organiser/results-nav.test.tsx`
- `apps/web/test/organiser-url.test.tsx`:
  - Verified parsing `?view=results` -> `{ view: "results" }`.
  - Verified parsing `?view=results&test=tst_abc` -> `{ view: "results", test: "tst_abc" }`.
  - Verified writing `{ view: "results" }` -> `?view=results`.
  - Verified writing `{ view: "results", test: "tst_abc" }` -> `?view=results&test=tst_abc`.
  - Verified reload at `?view=results` mounts `results-view`.
- `apps/web/test/organiser/results-nav.test.tsx`:
  - Verified `OrganiserShell` renders a navigation button for "Results" and invokes `onNavigate("results")`.
  - Verified `OrganiserShell` sets `aria-current="page"` on "Results" when `current="results"`.
  - Verified `OrganiserApp` clicking "Results" updates the URL query string to `?view=results` and displays `results-view`.
- `apps/web/test/organiser.test.tsx`:
  - Updated `omits Results and Grading entirely` to `omits Grading from the top nav` to reflect that Results is now an active destination in `NAV`.

---

## Verification Evidence
- **Strict TDD Red Step:**
  - Ran `pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx`
  - Output: 2 test files failed, 5 tests failed (unable to parse results view, unable to find results button).
- **Strict TDD Green Step:**
  - Ran `pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx`
  - Output: 2 test files passed, 23 tests passed.
- **Full Shell Tests:**
  - Ran `pnpm --filter @pariksha/web exec vitest run test/organiser.test.tsx`
  - Output: 1 test file passed, 82 tests passed.
- **Typecheck:**
  - Ran `pnpm --filter @pariksha/web typecheck`
  - Output: 0 TypeScript errors.
