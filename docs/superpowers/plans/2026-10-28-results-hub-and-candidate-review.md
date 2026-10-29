# Results Hub & Candidate Results Review Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a first-class Results Hub in the left navigation rail and an interactive Candidate Results Table with inline question drill-downs, search/filtering, and seamless links to the Attempt Review canvas.

**Architecture:** Create `GET /api/v1/workspaces/:id/results/overview` and `GET /api/v1/workspaces/:id/tests/:testId/results` in `apps/api/src/routes/results.ts` using existing batched database repository methods; extend `ApiClient`, update `api-client.ts` fixtures, and add `"results"` to `OrganiserShell` and `view-url.ts`; create `ResultsHub` (`?view=results`) to display workspace tests with aggregate performance and `ResultsRoute` (`?view=results&test=<id>`) with `ResultsTable` displaying candidate attempts, rank, scores, expandable question breakdowns, and review buttons.

**Tech Stack:** TypeScript, React 19, Hono, `@pariksha/core`, `@pariksha/db`, Vitest, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md`

## Global Constraints

- 50-Subrequest Budget: The test results endpoint must fetch attempts, candidate identity, and scores in bounded, indexed batch queries.
- Multi-Dialect Parity: Query patterns must execute seamlessly across SQLite and PostgreSQL 16 without dialect divergence.
- Pure Policy & Role Enforcement: Access gated on `requires("results.export")` so Viewers, Reviewers, Admins, and Owners can view results.
- Zero Key or Rubric Leakage (`KG1`): Endpoints and components return candidate responses, awarded points, and question prompts. Never return private scoring keys, author rubrics, or explanations.
- Accessibility & Design Tokens: Numerical figures must use tabular numerals (`tabular-nums`); touch targets >= 44px; screen reader labels for pass/fail and integrity badges; color never used alone.
- Git Commit Author: Every git commit MUST use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

## Review Focus

1. **Unscored or In-Progress Attempt:** Candidate attempt in progress (`submitted_at` null, `score_json` null) renders status "In progress", score "—", rank "—", percentage "—", and empty question breakdown without crashing or calculating `NaN%`.
2. **Missing Candidate Name / Prefill:** Candidate row where `form_values_json` has no name or email; gracefully falls back to `external_id` or `candidate_id` without displaying `undefined` or blank cells.
3. **Zero Submissions Cohort:** Test with 0 registered candidates or 0 submissions displays `0` candidates, `0` submissions, `—` average score, `—` pass rate, and an informative empty table state rather than dividing by zero.
4. **Viewer Role Access:** User holding `viewer` role (holding `results.export` and `tests.view`, but not `tests.edit`) can browse Results Hub and view Candidate Results Table without receiving a 403.
5. **Question Removed from Bank:** Question breakdown for an attempt where a question was subsequently deleted from the bank displays fallback `(question removed from the bank)` and handles 0 max points without throwing.

---

### Task 1: Backend Results API Routes (`apps/api`)

**Files:**
- Create: `apps/api/src/routes/results.ts`
- Modify: `apps/api/src/app.ts:25-35, 100-110, 1000-1015, 1150-1180`
- Test: `apps/api/test/routes/results.test.ts`

**Interfaces:**
- Consumes:
  - `listAttemptsForTest(db, workspaceId, testId, opts)` from `@pariksha/db`
  - `rankedScoresForTest(db, workspaceId, testId)` from `@pariksha/db`
  - `listCandidates(db, workspaceId, testId)` from `@pariksha/db`
  - `candidateCountsByWorkspace(db, workspaceId)` from `@pariksha/db`
  - `listTests(db, workspaceId)` from `@pariksha/db`
  - `getTest(db, workspaceId, testId)` from `@pariksha/db`
  - `getPublishedVersion(db, workspaceId, testId)` / `getDraftVersion(db, workspaceId, testId)` from `@pariksha/db`
  - `workspaceQuestions(db, workspaceId)` from `@pariksha/db`
  - `requires(action)` from `../middleware/authorize.js`
- Produces:
  - `GET /api/v1/workspaces/:id/results/overview` -> `{ tests: TestResultsOverviewItem[] }`
  - `GET /api/v1/workspaces/:id/tests/:testId/results` -> `TestResultsPayload`

- [x] **Step 1: Write the failing test**

Create `apps/api/test/routes/results.test.ts` testing:
1. `GET /api/v1/workspaces/:id/results/overview`: returns test rows with candidate counts, submitted attempts, average score, and pass rate.
2. `GET /api/v1/workspaces/:id/tests/:testId/results`: returns test summary (total registered, submitted count, pass rate, average score) and results list with candidate name, score, percentage, rank, integrity flag, and question breakdown without answer keys.
3. Filters by `status` and `integrity` query parameters.
4. Handles search query parameter matching candidate name or email.
5. Returns 403 when actor does not hold `results.export`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api exec vitest run test/routes/results.test.ts`
Expected: FAIL with route not found or module not found.

- [x] **Step 3: Implement `apps/api/src/routes/results.ts` and mount in `apps/api/src/app.ts`**

1. Implement `resultsRoutes(deps: AppDeps): Hono<AppBindings>`:
   - Helper `extractCandidateName(formValues)` and `extractCandidateEmail(externalId, formValues)` matching `monitor.ts`.
   - `GET /:id/results/overview`: gated on `requires("results.export")`. Runs `listTests(deps.db, workspaceId)`, `candidateCountsByWorkspace(deps.db, workspaceId)`, and a grouped query over `attempt a JOIN test_version tv ON tv.id = a.test_version_id WHERE a.workspace_id = ? GROUP BY tv.test_id` to compute attempts count, submitted count, average score, and pass rate per test.
   - `GET /:id/tests/:testId/results`: gated on `requires("results.export")`. Checks test exists. Fetches `listAttemptsForTest`, `rankedScoresForTest`, `listCandidates`, test version settings and sections, and `workspaceQuestions`. Builds summary metrics (total registered, submitted, in progress, locked, pass rate, average score). Maps each attempt to result item with candidate identity, status, scores, rank, integrity, and question breakdown with prompt excerpts (omitting any private answer keys).
2. Mount in `apps/api/src/app.ts`:
   - Import `resultsRoutes` from `./routes/results.js`.
   - Add routes `/api/v1/workspaces/:id/results/overview` and `/api/v1/workspaces/:id/tests/:testId/results` to `app.route("/api/v1/workspaces", resultsRoutes(deps))`.
   - Declare budgets in `ROUTE_BUDGETS`: 6 for overview, 8 for results.
   - Declare actions in `ROUTE_ACTIONS`: `"results.export"` for both.
   - Declare authority in `ROUTE_AUTH`: `"workspace"` for both.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api exec vitest run test/routes/results.test.ts`
Expected: PASS

- [x] **Step 5: Run whole API test suite to verify no budget or route authority regressions**

Run: `pnpm --filter @pariksha/api exec vitest run`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add apps/api/src/routes/results.ts apps/api/src/app.ts apps/api/test/routes/results.test.ts
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(api): add results overview and test results endpoints"
```

---

### Task 2: Web Client API & Navigation Shell Wiring

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/test/fixtures/api-client.ts`
- Modify: `apps/web/src/components/OrganiserShell.tsx:19, 165-175`
- Modify: `apps/web/src/lib/view-url.ts:54-69, 76-95`
- Modify: `apps/web/src/routes/organiser.tsx:80-95, 395-420, 580-600, 630-650`
- Test: `apps/web/test/organiser-url.test.tsx`
- Test: `apps/web/test/organiser/results-nav.test.tsx`

**Interfaces:**
- Consumes: API endpoints from Task 1.
- Produces:
  - `client.resultsOverview(workspaceId): Promise<{ tests: TestResultsOverviewItem[] }>`
  - `client.testResults(workspaceId, testId, options?): Promise<TestResultsPayload>`
  - `NavKey` union containing `"results"` and `NAV` containing `{ key: "results", label: "Results" }`.
  - `readView` and `writeView` handling `?view=results` and `?view=results&test=<testId>`.
  - `OrganiserView` union carrying `{ kind: "results"; actor: Actor; workspace: Workspace; testId?: string | undefined }`.

- [x] **Step 1: Write the failing test**

Add tests to `apps/web/test/organiser-url.test.tsx`:
- Parse `?view=results` -> `{ view: "results" }`.
- Parse `?view=results&test=tst_abc` -> `{ view: "results", test: "tst_abc" }`.
- Format view `{ kind: "results", testId: "tst_abc" }` -> `?view=results&test=tst_abc`.

Create `apps/web/test/organiser/results-nav.test.tsx`:
- Verifies `OrganiserShell` renders a navigation link for "Results" with `ICONS.results`.
- Verifies clicking "Results" navigates to `{ kind: "results" }`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx`
Expected: FAIL with TypeScript / navigation errors.

- [x] **Step 3: Implement client types, API methods, fixture stubs, and navigation wiring**

1. In `apps/web/src/lib/api.ts`:
   - Define interfaces `TestResultsOverviewItem`, `TestResultAttempt`, `TestResultsSummary`, `TestResultsPayload`, `ResultsQueryOptions`.
   - Add `resultsOverview(workspaceId: string)` and `testResults(workspaceId: string, testId: string, options?: ResultsQueryOptions)` to `ApiClient` and `createApiClient`.
2. In `apps/web/test/fixtures/api-client.ts`:
   - Add `resultsOverview: notStubbed("resultsOverview")` and `testResults: notStubbed("testResults")` to `fakeClient`.
3. In `apps/web/src/components/OrganiserShell.tsx`:
   - Add `"results"` to `type NavKey = "home" | "banks" | "tests" | "results" | "teams" | "webhooks" | "keys"`.
   - Insert `{ key: "results", label: "Results" }` after `"tests"` in `NAV`. (Note: `ICONS.results` already exists).
4. In `apps/web/src/lib/view-url.ts`:
   - Add `"results"` to `ViewParams["view"]` and `VIEWS` array.
5. In `apps/web/src/routes/organiser.tsx`:
   - Add `{ kind: "results"; actor: Actor; workspace: Workspace; testId?: string | undefined }` to `OrganiserView`.
   - Update `readOrganiserView` and `writeOrganiserView` for `view === "results"`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/test/fixtures/api-client.ts apps/web/src/components/OrganiserShell.tsx apps/web/src/lib/view-url.ts apps/web/src/routes/organiser.tsx apps/web/test/organiser-url.test.tsx apps/web/test/organiser/results-nav.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): add results API client methods and shell navigation wiring"
```

---

### Task 3: Results Hub Screen (`apps/web`)

**Files:**
- Create: `apps/web/src/routes/results-hub.tsx`
- Modify: `apps/web/src/routes/organiser.tsx` (wire `view.kind === "results"` when `!view.testId`)
- Test: `apps/web/test/organiser/results-hub.test.tsx`

**Interfaces:**
- Consumes:
  - `client.resultsOverview(workspaceId)`
  - `TestStateBadge` from `./tests.js`
  - `onSelectTest: (testId: string) => void`
- Produces:
  - `<ResultsHub />` component rendering tests with registered, submitted, pass rate, average score, and "Open results" button.

- [x] **Step 1: Write the failing test**

Create `apps/web/test/organiser/results-hub.test.tsx`:
- Renders loading skeleton while fetching.
- Renders list of tests with title, state badge, candidate count, submissions count, average score, and pass rate.
- Shows empty state when no tests exist in workspace.
- Clicking "Open results" on a test triggers `onSelectTest(test.id)`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web exec vitest run test/organiser/results-hub.test.tsx`
Expected: FAIL with module not found.

- [x] **Step 3: Implement `apps/web/src/routes/results-hub.tsx`**

1. Create `ResultsHub` component:
   - Fetches `client.resultsOverview(workspaceId)` on mount.
   - Header with title "Results", subtitle "Select a test to review candidate submissions, scores, and exam integrity."
   - Table of tests with columns:
     - Test (Name & Slug)
     - State (using `TestStateBadge`)
     - Registered Candidates
     - Submissions (`submittedCount / candidateCount`)
     - Class Average (`averageScore != null ? `${averageScore}%` : "—"`)
     - Pass Rate (`passRate != null ? `${Math.round(passRate * 100)}%` : "—"`)
     - Action: "Open results" button calling `onSelectTest(test.id)`.
   - Adhere to Signal design tokens, `tabular-nums` for all scores, and minimum 44px touch targets.
2. Wire into `apps/web/src/routes/organiser.tsx`:
   - Under `case "results":`, if `!view.testId`, render `ResultsHub` wrapped in `shell("results", view.actor, view.workspace, { title: "Results", crumb: "Results" }, ...)`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web exec vitest run test/organiser/results-hub.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/routes/results-hub.tsx apps/web/src/routes/organiser.tsx apps/web/test/organiser/results-hub.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): implement Results Hub workspace test picker"
```

---

### Task 4: Candidate Results Table & Test Results Route (`apps/web`)

**Files:**
- Create: `apps/web/src/components/organiser/ResultsTable.tsx`
- Create: `apps/web/src/routes/results.tsx`
- Modify: `apps/web/src/routes/organiser.tsx` (wire `view.kind === "results"` when `view.testId` is present; update `AttemptRoute` back navigation)
- Modify: `apps/web/src/routes/test.tsx:180-220, 750-765` (add "Results" toolbar button with `canViewResults = role !== undefined && can({ role, action: "results.export" })`)
- Test: `apps/web/test/organiser/results-table.test.tsx`
- Test: `apps/web/test/organiser/results-route.test.tsx`

**Interfaces:**
- Consumes:
  - `client.testResults(workspaceId, testId, options)`
  - `client.exportPage(workspaceId, testId, "results" | "answers", cursor?)`
  - `AttemptRoute` (`attempt.tsx`)
- Produces:
  - `<ResultsTable />`: Interactive results table with search, filters, expandable questions, pagination/load more, and "Review" button.
  - `<ResultsRoute />`: Full screen with summary metric cards, table, and toolbar actions.
  - Test builder header "Results" action button.

- [x] **Step 1: Write the failing tests**

1. Create `apps/web/test/organiser/results-table.test.tsx`:
   - Renders candidate rows with Rank, Name/Email, Status, Score, Percentage, Pass/Fail badge, and Integrity badge.
   - Searching by candidate name filters visible rows.
   - Clicking expand toggle (`▼`) on a row unfolds question breakdown with question prompt excerpts, earned points, and correct/incorrect status.
   - Clicking "Review" button triggers `onReviewAttempt(attemptId)`.
   - Clicking CSV export triggers export downloads.
   - Handles `nextCursor` pagination by providing a "Load more" action.
   - Shows empty state when no attempts match filters.
2. Create `apps/web/test/organiser/results-route.test.tsx`:
   - Fetches test results on mount.
   - Renders summary metric cards: Registered, Submitted, Average Score, Pass Rate.
   - Back button calls `onBack` to return to Results Hub.
3. Test in `apps/web/test/testbuilder/test-header.test.tsx` or new test:
   - Verifies "Results" button appears in Test Builder toolbar and triggers navigation.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @pariksha/web exec vitest run test/organiser/results-table.test.tsx test/organiser/results-route.test.tsx`
Expected: FAIL with components not found.

- [x] **Step 3: Implement `ResultsTable.tsx`, `results.tsx`, and wire `test.tsx`**

1. Implement `apps/web/src/components/organiser/ResultsTable.tsx`:
   - Search input, status filter select (`all`, `submitted`, `in_progress`, `locked`), integrity filter select (`all`, `clean`, `review`, `scoring_blocked`).
   - Sticky header table with columns:
     - Expand (`▼` / `▲`)
     - Rank (`#1`, `#2`, or `—`)
     - Candidate (Name, Email / external ID)
     - Status (badge: Submitted, In progress, Locked)
     - Score (tabular format: `85 / 100`)
     - Percentage (`85.0%`)
     - Result (Pass / Fail badge with screen reader text)
     - Integrity (Clean, Review, Scoring blocked badge)
     - Submitted (formatted date or "—")
     - Actions: "Review" button linking to attempt review.
   - Expanded row:
     - Question list showing Question #, Prompt excerpt, Points earned / Max points, and Correct/Incorrect status.
   - Pagination: "Load more candidates" button when `nextCursor !== null`.
   - Export buttons: "Export Results (CSV)" and "Export Answers (CSV)" draining pages via `client.exportPage(workspaceId, testId, "results" | "answers")`.
2. Implement `apps/web/src/routes/results.tsx`:
   - Loads data via `client.testResults(workspaceId, testId)`.
   - Displays breadcrumb navigation: "Results" > Test Name.
   - Renders 4 summary metric cards (Total Candidates, Submissions, Pass Rate, Class Average).
   - Renders `ResultsTable`.
3. In `apps/web/src/routes/test.tsx`:
   - Beside "Grading queue" and "Analytics" in the test header action group, add a "Results" button calling `onOpenResults(testId)` gated on `canViewResults = role !== undefined && can({ role, action: "results.export" })`.
4. In `apps/web/src/routes/organiser.tsx`:
   - Under `case "results":`, if `view.testId`, render `ResultsRoute` inside `shell("results", view.actor, view.workspace, ...)`.
   - Wire `onOpenResults` in `case "test":` to navigate to `go({ kind: "results", actor: view.actor, workspace: view.workspace, testId })`.
   - Update `AttemptRoute` `onBack`: navigate back to `results` when `testId` is provided.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pariksha/web exec vitest run test/organiser/results-table.test.tsx test/organiser/results-route.test.tsx`
Expected: PASS

- [x] **Step 5: Run full web test suite**

Run: `pnpm --filter @pariksha/web exec vitest run`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add apps/web/src/components/organiser/ResultsTable.tsx apps/web/src/routes/results.tsx apps/web/src/routes/organiser.tsx apps/web/src/routes/test.tsx apps/web/test/organiser/results-table.test.tsx apps/web/test/organiser/results-route.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): implement test results route and candidate results table"
```

---

### Task 5: End-to-End Verification & Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md` (mark Status as "Approved / Implemented")
- Test: Full monorepo verification (`pnpm typecheck && pnpm lint && pnpm test`)

- [x] **Step 1: Run typechecks and linting across the monorepo**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS with 0 errors across all workspaces (`@pariksha/core`, `@pariksha/db`, `@pariksha/api`, `@pariksha/web`).

- [x] **Step 2: Run full test suite across the monorepo**

Run: `pnpm test`
Expected: All tests pass.

- [x] **Step 3: Update spec document status**

Update `docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md` header:
- `Status`: `Approved`

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-28-results-hub-and-candidate-review-design.md docs/superpowers/plans/2026-10-28-results-hub-and-candidate-review.md
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "docs: complete implementation plan for results hub and candidate review"
```
