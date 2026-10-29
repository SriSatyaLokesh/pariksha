# Task 1 Review: Backend Results API Routes (`apps/api`)

**Commit:** `9ee72901da9ec702d235e3d834aebbd6198b255d`  
**Reviewer:** Reviewer Subagent  
**Status:** **APPROVED**

---

## Executive Summary

Commit `9ee72901da9ec702d235e3d834aebbd6198b255d` implements the backend API routes for the Results Hub and Candidate Review feature in accordance with the Task 1 brief, design specification, and implementation plan. The implementation adheres strictly to Ponytail simplicity guidelines, zero key leakage rules (KG1), subrequest query budgets, and tenant/RBAC boundaries.

---

## Detailed Checklist Verification

### 1. Ponytail Style & Code Quality
- [x] **Minimal, focused diff:** Added `apps/api/src/routes/results.ts` (349 lines), updated route table registries in `apps/api/src/app.ts`, updated `apps/api/test/export/scrub-scan.test.ts`, and added comprehensive route tests in `apps/api/test/routes/results.test.ts`.
- [x] **Standard library and existing repo functions:** Reused existing `@pariksha/db` helpers: `listTests`, `headVersionsByTest`, `candidateCountsByWorkspace`, `getTest`, `getPublishedVersion`, `getDraftVersion`, `listCandidates`, `rankedScoresForTest`, `listAttemptsForTest`, `workspaceQuestions`, and `deriveState`.
- [x] **No speculative bloat:** No unnecessary abstractions, middleware factories, or redundant wrappers. Simple, pure parsing helpers `extractCandidateName` and `extractCandidateEmail`.

### 2. Zero Key Leakage (`KG1`)
- [x] **Question breakdown scrubbing:** `questionBreakdown` exposes only `questionId`, `promptExcerpt` (clamped to 120 chars), `pointsEarned`, `maxPoints`, and boolean `correct`.
- [x] **No keys or rubrics:** Private keys, explanations, accepted options, and author rubrics are never included in API payloads.
- [x] **Scrub-scan automated verification:** `apps/api/test/export/scrub-scan.test.ts` passed for all endpoints, confirming neither route leaks any sentinel secrets.

### 3. Subrequest Budget & Batching
- [x] **Overview route budget:** Allocated `6`. Executes auth check (2 DB queries) + 4 queries (`listTests`, `headVersionsByTest`, `candidateCountsByWorkspace`, and a single batched `deps.db.query` for attempt scores). No per-test queries.
- [x] **Test results route budget:** Allocated `8`. Executes auth check (2 DB queries) + 6 queries (`getTest`, `getPublishedVersion`, `listCandidates`, `rankedScoresForTest`, `listAttemptsForTest`, `workspaceQuestions`). No per-attempt or per-question DB queries.
- [x] Verified via `test/budget.test.ts`.

### 4. Route Authority & Registration (`apps/api/src/app.ts`)
- [x] `ROUTE_BUDGETS`:
  - `"/api/v1/workspaces/:id/results/overview": 6`
  - `"/api/v1/workspaces/:id/tests/:testId/results": 8`
- [x] `ROUTE_ACTIONS`:
  - `"GET /api/v1/workspaces/:id/results/overview": "results.export"`
  - `"GET /api/v1/workspaces/:id/tests/:testId/results": "results.export"`
- [x] `ROUTE_AUTH`:
  - `"GET /api/v1/workspaces/:id/results/overview": "workspace"`
  - `"GET /api/v1/workspaces/:id/tests/:testId/results": "workspace"`
- [x] Route mounting: `app.route("/api/v1/workspaces", resultsRoutes(deps));`
- [x] Verified via `test/route-authority.test.ts`.

### 5. RBAC & Tenant Isolation
- [x] Actions require `"results.export"`.
- [x] `Author` role returns `403 Forbidden`.
- [x] `Viewer`, `Reviewer`, and `Owner` roles return `200 OK`.
- [x] Cross-tenant access to another workspace's test returns `404 Not Found` (protecting against resource enumeration).

### 6. Edge Cases Handled
- [x] **Zero attempts:** Returns zero counts and `null` for `averageScore` and `passRate`, with empty `results: []`.
- [x] **In-progress attempt:** Unscored attempt returns `null` for scores, percentages, duration, and rank, with empty `questionBreakdown: []`.
- [x] **Candidate identity fallback:** Handles missing candidate name/email in form values by falling back to `externalId` (or `null`).
- [x] **Integrity flags & status:** Correctly categorizes `"locked"`, `"auto_submitted"`, `"submitted"`, and `"in_progress"`, as well as integrity flags (`"clean"`, `"review"`, `"scoring_blocked"`).
- [x] **Missing resource:** Throws standard `ApiError(404, "not_found", "No such resource.")`.

---

## Test Verification Output

1. **New Route Tests:**
   `pnpm --filter @pariksha/api exec vitest run test/routes/results.test.ts`  
   *Result:* 17 passed (17 tests) in 1.42s

2. **Route Authority, Budget, and Authorization Tests:**
   `pnpm --filter @pariksha/api exec vitest run test/route-authority.test.ts test/budget.test.ts test/authorization.test.ts`  
   *Result:* 26 passed (26 tests) in 1.35s

3. **KG1 Scrub Scan:**
   `pnpm --filter @pariksha/api exec vitest run test/export/scrub-scan.test.ts`  
   *Result:* 13 passed (13 tests) in 1.28s

4. **Full API Test Suite:**
   `pnpm --filter @pariksha/api exec vitest run`  
   *Result:* 93 test files passed, 1,396 tests passed (0 failures) in 13.81s

---

## Recommendation

**APPROVED**. Task 1 is complete and ready for Task 2.
