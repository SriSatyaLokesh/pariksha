# Task 2 Brief: Web Client API & Navigation Shell Wiring (`apps/web`)

## Files
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/test/fixtures/api-client.ts`
- Modify: `apps/web/src/components/OrganiserShell.tsx`
- Modify: `apps/web/src/lib/view-url.ts`
- Modify: `apps/web/src/routes/organiser.tsx`
- Modify: `apps/web/test/organiser-url.test.tsx`
- Create: `apps/web/test/organiser/results-nav.test.tsx`

## Global Constraints & Style
- **Ponytail Style:** Laziest, cleanest solution. Keep diffs minimal, use existing imports/types, no unnecessary abstractions.
- **Git Author:** Every git commit MUST use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
- **Zero Fixture Breakage:** Adding methods to `ApiClient` requires stubbing in `apps/web/test/fixtures/api-client.ts` (`notStubbed("resultsOverview")` and `notStubbed("testResults")`) so the remaining web test suite does not break.

## Requirements

### 1. `apps/web/src/lib/api.ts`
Export interfaces matching backend shapes from `apps/api/src/routes/results.ts`:
```ts
export interface TestResultsOverviewItem {
  id: string;
  name: string;
  slug: string;
  state: TestState;
  candidateCount: number;
  attemptCount: number;
  submittedCount: number;
  averageScore: number | null;
  passRate: number | null;
}

export interface TestResultAttempt {
  attemptId: string;
  candidateId: string;
  candidateName: string | null;
  candidateEmail: string | null;
  externalId: string | null;
  status: "locked" | "submitted" | "auto_submitted" | "in_progress";
  startedAt: number;
  submittedAt: number | null;
  durationSeconds: number | null;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  rank: number | null;
  integrityFlag: "clean" | "review" | "scoring_blocked";
  violations: number;
  questionBreakdown: Array<{
    questionId: string;
    promptExcerpt: string;
    pointsEarned: number;
    maxPoints: number;
    correct: boolean | null;
  }>;
}

export interface TestResultsSummary {
  totalRegistered: number;
  submittedCount: number;
  inProgressCount: number;
  lockedCount: number;
  averageScore: number | null;
  passRate: number | null;
}

export interface TestResultsPayload {
  test: {
    id: string;
    title: string;
    totalPoints: number;
    passMark: number | null;
  };
  summary: TestResultsSummary;
  results: TestResultAttempt[];
  nextCursor?: string | null | undefined;
}

export interface ResultsQueryOptions {
  status?: "all" | "submitted" | "in_progress" | "locked";
  integrity?: "all" | "clean" | "review" | "scoring_blocked";
  search?: string;
  limit?: number;
  cursor?: string;
}
```

Add methods to `ApiClient`:
```ts
resultsOverview(workspaceId: string): Promise<{ tests: TestResultsOverviewItem[] }>;
testResults(
  workspaceId: string,
  testId: string,
  options?: ResultsQueryOptions,
): Promise<TestResultsPayload>;
```

Implement in `createApiClient`:
```ts
resultsOverview: (workspaceId) =>
  json<{ tests: TestResultsOverviewItem[] }>(`/workspaces/${workspaceId}/results/overview`),
testResults: (workspaceId, testId, options) => {
  const params = new URLSearchParams();
  if (options?.status && options.status !== "all") params.set("status", options.status);
  if (options?.integrity && options.integrity !== "all") params.set("integrity", options.integrity);
  if (options?.search && options.search.trim() !== "") params.set("search", options.search.trim());
  if (options?.limit !== undefined) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const qs = params.toString();
  return json<TestResultsPayload>(
    `/workspaces/${workspaceId}/tests/${testId}/results${qs ? `?${qs}` : ""}`,
  );
},
```

### 2. `apps/web/test/fixtures/api-client.ts`
Add stubs to `fakeClient`:
```ts
resultsOverview: notStubbed("resultsOverview"),
testResults: notStubbed("testResults"),
```

### 3. `apps/web/src/components/OrganiserShell.tsx`
- Add `"results"` to `NavKey`:
  `export type NavKey = "home" | "banks" | "tests" | "results" | "teams" | "webhooks" | "keys";`
- Add `{ key: "results", label: "Results" }` after `"tests"` in `NAV`. (Note: `ICONS.results` is already present).

### 4. `apps/web/src/lib/view-url.ts`
- Add `"results"` to the `VIEWS` array.

### 5. `apps/web/src/routes/organiser.tsx`
- In `OrganiserView` union, add:
  `| { kind: "results"; actor: Actor; workspace: Workspace; testId?: string | undefined }`
- In `fromUrl`:
  ```ts
  case "results":
    return {
      kind: "results",
      actor,
      workspace,
      ...(params.test !== undefined && { testId: params.test }),
    };
  ```
- In `paramsOf`:
  ```ts
  case "results":
    return {
      view: "results",
      ...(view.testId !== undefined && { test: view.testId }),
    };
  ```
- In `OrganiserApp` switch statement:
  ```ts
  case "results":
    return shell(
      "results",
      view.actor,
      view.workspace,
      { title: "Results", crumb: "Results" },
      <div data-testid="results-view">Results</div>,
    );
  ```

### 6. Tests:
- In `apps/web/test/organiser-url.test.tsx`:
  - Test parsing `?view=results` -> `{ view: "results" }`.
  - Test parsing `?view=results&test=tst_abc` -> `{ view: "results", test: "tst_abc" }`.
  - Test writing `{ view: "results" }` -> `?view=results`.
  - Test writing `{ view: "results", test: "tst_abc" }` -> `?view=results&test=tst_abc`.
- In `apps/web/test/organiser/results-nav.test.tsx`:
  - Test that `OrganiserShell` renders a navigation link for "Results" with `href="?view=results"`.
  - Test that clicking "Results" navigates to the results view.

## Verification Commands
```bash
pnpm --filter @pariksha/web exec vitest run test/organiser-url.test.tsx test/organiser/results-nav.test.tsx
```
And check that existing web tests still pass:
```bash
pnpm --filter @pariksha/web exec vitest run test/organiser-shell.test.tsx
```

## Commit Message
```bash
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): add results client API and navigation shell wiring"
```
