# Task 1 Report: Backend Results API Routes (`apps/api`)

## Summary
- **Status:** DONE
- **Commit:** `9ee72901da9ec702d235e3d834aebbd6198b255d`
- **Author:** `Satya K <srisatyalokesh2.12@gmail.com>`
- **Branch:** `feat/results-hub-and-candidate-review`

---

## Artifacts & Changes

### 1. Routes Implementation: `apps/api/src/routes/results.ts`
Created Hono route handler providing two endpoints:
- `GET /api/v1/workspaces/:id/results/overview`:
  - Gated by `requires("results.export")`.
  - Subrequest budget: 6.
  - Queries `listTests`, `headVersionsByTest`, `candidateCountsByWorkspace`, and a single batched `attempt` join over `test_version` for the workspace.
  - Computes per-test summary metrics: `candidateCount`, `attemptCount`, `submittedCount`, `averageScore` (rounded to 1 decimal place, or null if no scored submissions), and `passRate` (rounded to 2 decimal places, or null if 0 submissions).
  - Resolves `state` via `deriveState(test.status, head?.publishedTiming, deps.now())`.
- `GET /api/v1/workspaces/:id/tests/:testId/results`:
  - Gated by `requires("results.export")`.
  - Subrequest budget: 8.
  - Verifies test existence with `getTest` (throws `ApiError(404, "not_found", "No such resource.")` if absent).
  - Fetches version (published or draft fallback), `listCandidates`, `rankedScoresForTest`, `listAttemptsForTest` with keyset cursor and limit clamp (default 50, max 100), and `workspaceQuestions`.
  - Computes top-level test info (`totalPoints`, `passMark`) and class-level summary metrics (`totalRegistered`, `submittedCount`, `inProgressCount`, `lockedCount`, `averageScore`, `passRate`).
  - Maps attempts into detailed candidate rows with candidate name & email extraction, external ID, status (`submitted`, `auto_submitted`, `locked`, `in_progress`), timing, duration in seconds, scores, rank, integrity flag, violations count, and safe question breakdown.
  - Zero Key Leakage (`KG1`): Omit question key, explanation, and rubric from question breakdown (only prompt excerpt, points earned, max points, correct boolean).
  - Supports filters: `status` (`submitted`, `in_progress`, `locked`, `all`), `integrity` (`clean`, `review`, `scoring_blocked`, `all`), and case-insensitive `search` matching candidate name, email, or external ID.

### 2. App Mounting & Registry Declarations: `apps/api/src/app.ts`
- Imported and mounted `resultsRoutes(deps)` at `/api/v1/workspaces`.
- Registered route budgets in `ROUTE_BUDGETS`:
  - `/api/v1/workspaces/:id/results/overview`: 6
  - `/api/v1/workspaces/:id/tests/:testId/results`: 8
- Registered route authorization actions in `ROUTE_ACTIONS`:
  - `GET /api/v1/workspaces/:id/results/overview`: `"results.export"`
  - `GET /api/v1/workspaces/:id/tests/:testId/results`: `"results.export"`
- Registered route authorities in `ROUTE_AUTH`:
  - `GET /api/v1/workspaces/:id/results/overview`: `"workspace"`
  - `GET /api/v1/workspaces/:id/tests/:testId/results`: `"workspace"`

### 3. Tests: `apps/api/test/routes/results.test.ts`
Added 17 tests covering:
- Workspace results overview with aggregate metrics and multi-test summaries.
- Detailed test results with test info, class metrics, and attempt items.
- Status filters (`submitted`, `in_progress`, `locked`).
- Integrity filters (`clean`, `review`, `scoring_blocked`).
- Case-insensitive search on candidate name, candidate email, and external ID.
- RBAC authorization: 403 Forbidden for Author (lacks `results.export`), 200 OK for Viewer, Reviewer, and Owner.
- Edge cases: candidate with unscored in-progress attempt, candidate without name, zero-attempt test, non-existent test (404), cross-tenant isolation (404).

### 4. Zero Key Leakage Integration: `apps/api/test/export/scrub-scan.test.ts`
- Updated expected `results.export` count from 4 to 6.
- Both new routes are scanned for all `KG1` sentinel secrets and verified completely leak-free.

---

## Verification Evidence
- Strict TDD cycle executed:
  - **Red:** vitest run on `test/routes/results.test.ts` failed with 404 before implementation.
  - **Green:** vitest run on `test/routes/results.test.ts` passed (17/17 tests).
  - **Full Suite Check:** `pnpm --filter @pariksha/api exec vitest run` executed with 93 test files and 1396 tests passing with 0 failures.
