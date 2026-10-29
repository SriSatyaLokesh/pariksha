# Task 1 Brief: Backend Results API Routes (`apps/api`)

## Files
- Create: `apps/api/src/routes/results.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/routes/results.test.ts`

## Global Constraints & Style
- **Ponytail Style:** Apply `ponytail` — shortest working diff, standard library and existing repo functions first (`listAttemptsForTest`, `rankedScoresForTest`, `listCandidates`, `candidateCountsByWorkspace`, `workspaceQuestions`), no unnecessary abstractions or boilerplate.
- **Git Author:** Every git commit MUST use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
- **Zero Key Leakage (`KG1`):** Never include private scoring keys, author rubrics, or explanations in result payloads.
- **Subrequest Budget:** Overview budget is 6, results budget is 8. Keep database operations batched.

## Requirements

### 1. `apps/api/src/routes/results.ts`
Implement `resultsRoutes(deps: AppDeps): Hono<AppBindings>`:
- Helper functions:
  ```ts
  function extractCandidateName(formValues: Record<string, unknown>): string | undefined {
    const name =
      formValues.name ??
      formValues.fullName ??
      formValues.full_name ??
      formValues.candidateName ??
      formValues["Name"] ??
      formValues["Full Name"];
    return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
  }

  function extractCandidateEmail(
    externalId: string | null,
    formValues: Record<string, unknown>,
  ): string | undefined {
    const email =
      formValues.email ??
      formValues.emailAddress ??
      formValues.candidateEmail ??
      formValues["Email"] ??
      formValues["Email Address"];
    if (typeof email === "string" && email.trim() !== "") return email.trim();
    if (externalId && externalId.includes("@")) return externalId.trim();
    return undefined;
  }
  ```

- **Route 1: `GET /:id/results/overview`**
  - Gated by `requires("results.export")`.
  - Param `:id` is `workspaceId`.
  - Fetches:
    - `tests = await listTests(deps.db, workspaceId);`
    - `heads = await headVersionsByTest(deps.db, workspaceId);`
    - `candCounts = await candidateCountsByWorkspace(deps.db, workspaceId);`
    - Aggregate attempts query over workspace:
      ```sql
      SELECT tv.test_id,
             COUNT(*) AS total_attempts,
             SUM(CASE WHEN a.submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted_count,
             AVG(CASE WHEN a.submitted_at IS NOT NULL AND a.score_json IS NOT NULL THEN CAST(json_extract(a.score_json, '$.percent') AS REAL) ELSE NULL END) AS avg_percent,
             SUM(CASE WHEN a.submitted_at IS NOT NULL AND a.score_json IS NOT NULL AND json_extract(a.score_json, '$.passed') = 1 THEN 1 ELSE 0 END) AS pass_count
      FROM attempt a
      JOIN test_version tv ON tv.workspace_id = a.workspace_id AND tv.id = a.test_version_id
      WHERE a.workspace_id = ?
      GROUP BY tv.test_id
      ```
      *(Note on multi-dialect: or fetch attempt summaries via existing repo functions, or handle SQLite/Postgres cleanly. In Pariksha, `score_json` can also be parsed in JS across attempts or via simple grouped counts: e.g. querying `a.submitted_at, a.score_json, tv.test_id` or grouped by `tv.test_id`).*
    - Computes per-test summary:
      - `id`: test.id
      - `name`: test.name
      - `slug`: test.slug
      - `state`: derived state from `test.status` and version head timing
      - `candidateCount`: total from `candCounts.get(test.id)?.total ?? 0`
      - `attemptCount`: total attempts
      - `submittedCount`: total submitted
      - `averageScore`: average percentage rounded to 1 decimal place (or `null` if 0 submissions)
      - `passRate`: `passCount / submittedCount` rounded to 2 decimal places (or `null` if 0 submissions)
  - Returns `c.json({ tests: overviewItems })`.

- **Route 2: `GET /:id/tests/:testId/results`**
  - Gated by `requires("results.export")`.
  - Checks `test = await getTest(deps.db, workspaceId, testId)`. If not found, throws `new ApiError(404, "not_found", "No such resource.")`.
  - Query parameters:
    - `status`: optional filter (`"submitted" | "in_progress" | "locked" | "all"`)
    - `integrity`: optional filter (`"clean" | "review" | "scoring_blocked" | "all"`)
    - `search`: optional string
    - `limit`: number (default 50, max 100)
    - `cursor`: string keyset cursor
  - Fetches:
    - Version: `(await getPublishedVersion(deps.db, workspaceId, testId)) ?? (await getDraftVersion(deps.db, workspaceId, testId))`
    - `candList = await listCandidates(deps.db, workspaceId, testId)`
    - `ranks = await rankedScoresForTest(deps.db, workspaceId, testId)`
    - `attemptsPage = await listAttemptsForTest(deps.db, workspaceId, testId, { limit, cursor })`
    - `rawQuestions = await workspaceQuestions(deps.db, workspaceId)`
  - Maps questions to `promptExcerpt` (e.g. prompt string sliced to 120 chars) and max points.
  - Computes test-level `summary`:
    - `totalRegistered`: `candList.length`
    - `submittedCount`: count of attempts with `submittedAt !== null`
    - `inProgressCount`: count of attempts where `submittedAt === null && lockedAt === null`
    - `lockedCount`: count of attempts where `lockedAt !== null && submittedAt === null`
    - `averageScore`: class average percent of submitted attempts (or null)
    - `passRate`: pass rate of submitted attempts (or null)
  - Maps `attemptsPage.rows` into result items:
    - `attemptId`: row.attemptId
    - `candidateId`: row.candidateId
    - `candidateName`: extracted from candidate formValues (or externalId fallback)
    - `candidateEmail`: extracted from candidate formValues or externalId
    - `externalId`: candidate.externalId
    - `status`:
      - if `row.lockedAt !== null && row.submittedAt === null`: `"locked"`
      - else if `row.submittedAt !== null`:
        - if `row.submitReason === "limit" || row.submitReason === "timeout"`: `"auto_submitted"`
        - else: `"submitted"`
      - else: `"in_progress"`
    - `startedAt`: row.startedAt
    - `submittedAt`: row.submittedAt
    - `durationSeconds`: `submittedAt ? Math.round((submittedAt - startedAt) / 1000) : null`
    - `score`: `scoreJson?.total ?? null`
    - `maxScore`: `scoreJson?.max ?? null`
    - `percentage`: `scoreJson?.percent ?? null`
    - `passed`: `scoreJson?.passed ?? null`
    - `rank`: `ranks.get(row.attemptId) ?? null`
    - `integrityFlag`: `row.flag === "scoring_blocked" ? "scoring_blocked" : row.integrityFlag === "review" || row.integrityFlag === "high_risk" ? "review" : "clean"`
    - `violations`: row.violations
    - `questionBreakdown`: for each question scored in `scoreJson.perQuestion`:
      ```ts
      {
        questionId: qId,
        promptExcerpt: questionsMap.get(qId)?.prompt?.slice(0, 120) ?? "(question removed from the bank)",
        pointsEarned: scoredQ.points ?? 0,
        maxPoints: scoredQ.max ?? 1,
        correct: scoredQ.correct ?? null,
      }
      ```
  - Filters by `status`, `integrity`, `search` (on name/email/externalId).
  - Returns `c.json({ test: { id, title: test.name, totalPoints, passMark }, summary, results, nextCursor: attemptsPage.nextCursor })`.

### 2. `apps/api/src/app.ts` Mounting
- Import `resultsRoutes` from `./routes/results.js`.
- Mount under `/api/v1/workspaces`:
  `app.route("/api/v1/workspaces", resultsRoutes(deps));`
- Declare in `ROUTE_BUDGETS`:
  `"/api/v1/workspaces/:id/results/overview": 6,`
  `"/api/v1/workspaces/:id/tests/:testId/results": 8,`
- Declare in `ROUTE_ACTIONS`:
  `"GET /api/v1/workspaces/:id/results/overview": "results.export",`
  `"GET /api/v1/workspaces/:id/tests/:testId/results": "results.export",`
- Declare in `ROUTE_AUTH`:
  `"GET /api/v1/workspaces/:id/results/overview": "workspace",`
  `"GET /api/v1/workspaces/:id/tests/:testId/results": "workspace",`

### 3. Tests `apps/api/test/routes/results.test.ts`
Write comprehensive tests:
- Tests `overview` returns tests list with aggregate stats.
- Tests `results` returns test info, summary metrics, and candidate attempt items.
- Tests filters for `status` and `integrity`.
- Tests `search` by candidate name or email.
- Tests 403 Forbidden when caller lacks `results.export` (e.g. Author role).
- Tests 200 OK when caller has Viewer or Reviewer role.
- Tests edge cases: candidate with unscored in-progress attempt, candidate without name, test with zero attempts.

## Verification Command
`pnpm --filter @pariksha/api exec vitest run test/routes/results.test.ts`
And whole suite check:
`pnpm --filter @pariksha/api exec vitest run`
