# Phase 8c — The Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell an organiser whether their test was any good, and let the results leave the product as files that open in Excel and never silently drop a row.

**Architecture:** Every figure is a `GROUP BY` aggregate or one pass over one fetched set — never per question, never per candidate. Exports page with a cursor and the browser assembles; a route that reaches its bound always returns a cursor, so there is no shape where a full-looking 200 is a partial file. The snapshot export is a manifest of presigned URLs, because `signedUrl` is the one storage call the subrequest counter deliberately does not count.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Preact/React.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K2`, `K3`, `K4`, `K6`, `K8`, `K9`, `K19`, `K20`, `K21`, `K38`, `K42`, `KG1`, `KG2`, `KG3`, `KG6`.

**Base:** `main` at `992f928`. Branch `phase-8c/the-numbers` in `pariksha-wt1`.

**Goals covered:** `G3` and `G4`.

**Issues:** #94 (`P8.6`), #95 (`P8.7`), #97 (`P8.9`), #98 (`P8.10`), #228 (Task 0), plus `D7c`'s readiness aggregate.

---

## What changed since the 2026-10-22 draft

This plan supersedes [`2026-10-22-phase-8c-the-numbers.md`](2026-10-22-phase-8c-the-numbers.md). Everything 8c depended on is now on `main`, and **five of that draft's stated facts are no longer true.** They are corrected inline below; they are listed here so a reader of the old file knows not to trust it.

| The old draft said | What is true on `992f928` |
| --- | --- |
| *"Starts only once 7d merges"* | 7d, 8a, 8b, 8d-1, 8d-2, 8e **and 7e** are all merged. Nothing blocks this. |
| *"`K43` put 7e out of scope … `setIntegrity` has no production caller, so `integrity_flag` holds its `'clean'` default everywhere"* | **Reversed.** 7e shipped as #239. `setIntegrity` and `listIntegrityCounts` are called from `apps/api/src/run/submit.ts:268` and `apps/api/src/routes/proctoring.ts`. `integrity_flag` carries real `clean` / `review` / `high_risk` values. Task 1 must count them, not explain them away. |
| nothing about the lock | 7e's `0011` added **`attempt.locked_at`**. A locked attempt has `submitted_at IS NULL`, so the old draft's four counts would file it under *in progress* forever. New Review Focus 1. |
| `TestSummary` as Task 1's new type | **Name collision.** `TestSummary` already exists at `apps/web/src/lib/api.ts:114` and is imported by nine files. Task 1's type is **`TestAnalytics`**. |
| `scrub-scan.test.ts` (path unstated) | It is at **`apps/api/test/run/scrub-scan.test.ts`**. |
| a new `…/export/test.json` route | `GET /api/v1/workspaces/:id/tests/:testId/export` **already exists** (`apps/api/src/export/test.ts`, action `tests.edit`, budget 7) and already returns the `pariksha/test@1` document. Task 4 mounts an alias at the `results.export` action rather than writing a second serialiser. |

Two more facts worth carrying:

- **8e's retention sweep is live.** `apps/api/src/retention/candidate.ts:344` deletes `snapshot` objects. Review Focus 5 is a thing that happens now, not a hypothetical.
- **8d-2 shipped scoped API keys.** `results.export` is reachable by a key as well as a session, so each new route's authority test has a key dimension it did not have in the draft.

---

## Global Constraints

**8a's Global Constraints apply in full and are not repeated.** These are this plan's additions.

- **`results.export` gets its first production caller here.** Every route needs a `ROUTE_AUTH` entry, a `ROUTE_ACTIONS` entry and a **measured** `ROUTE_BUDGETS` entry (`apps/api/src/app.ts:88`, `:845`, `:985`), each 403 test with a 200 beside it (`KG2`).
- **`KG1`** — no key, explanation, rubric, model answer or accepted pattern in any CSV or manifest. The per-answer CSV carries `correct` as a **boolean**, never the correct answer. Test this in the shape of `apps/api/test/run/scrub-scan.test.ts`: enumerate the export routes **from the route table**, replay a sentinel fixture, assert the sentinel never appears.
- **`KG3`** — every figure and every export is measured against a **300-candidate × 60-question** fixture. At ten rows a per-item query passes.
- **10 ms CPU per invocation.** A discrimination index is a sort and two means — cheap once, sixty times if written per question.
- **`K2`** — item analysis ships **share correct, discrimination index and option pick rates**. No time column anywhere, and the omission is stated **on the surface**, not only in a document.
- **`K8`** — every CSV goes through `toCsv`/`csvFilename` (`packages/core/src/csv.ts`). There is no second serialiser.
- Record each ruling in `.superpowers/sdd/phase-8c/progress.md`.

## Review Focus

1. **A locked attempt, in every count and every export.** 7e's `0011` added `attempt.locked_at` and a locked attempt never gets a `submitted_at`. A `submitted_at IS NULL` test files it under *in progress* permanently, so a test whose candidates were locked out reports a completion rate that can never reach 1 and an in-progress count that never drains. The organiser's headline number is then wrong in exactly the situation they are most likely to be looking at it. Tasks 1 and 3.
2. **An export whose rows exceed one invocation's bound.** The per-answer CSV is 300 × 60 ≈ 18,000 rows; the events CSV is unbounded. This phase's anti-goal is that *"an export that quietly drops rows is a lost-answers bug wearing a results hat"*, on the phase gated by zero lost answers. The test is a row-count equality against the database, not a smoke test. Task 3.
3. **A cohort of six candidates reaching the discrimination index.** Top and bottom 27% of six is two against two. `K20` withholds it below ten and names the cohort size. Task 2.
4. **A question every candidate answered correctly, or none did.** Discrimination is `0/0` for a question with no variance; option pick rates over a question nobody reached divide by zero. Both must produce a stated "no variance" rather than `NaN` in a CSV cell. Task 2.
5. **A presigned manifest for an attempt whose R2 objects retention already swept.** `apps/api/src/retention/candidate.ts:344` deletes snapshot objects on a schedule and the `snapshot` row can outlive its object. A URL to a missing object 404s silently inside a download loop. Task 4.

*(Duplicate registration-field labels are a sixth, and Task 3 carries its test; it is below the line here only because an organiser has to write the same label twice to reach it.)*

---

### Task 0: One shared `ApiClient` test fixture (#228)

**Why first:** 26 files under `apps/web/test` hand-roll a `fakeClient`. One interface change breaks all of them, and it did so **four times in one session** on 2026-10-23 — a merge conflict, a CI type-check failure, a clean merge that did not compile, and a cross-branch break. Git shows a conflict where two branches edit the same line, never where one branch adds a member another branch's hand-rolled fixture must also carry. This task adds **six** methods to `ApiClient`. Doing it after is paying the tax six more times.

**Files:**
- Create: `apps/web/test/fixtures/api-client.ts`
- Modify: every `apps/web/test` file that declares its own `fakeClient`
- Test: the existing suite is the test — it must stay green with no behaviour change.

**Interfaces:**
- Produces:

```ts
/** Every member throws "not stubbed: <name>" unless overridden, so a test
 *  that reaches an unexpected call fails loudly instead of on `undefined`. */
export function fakeClient(overrides?: Partial<ApiClient>): ApiClient;
```

- [ ] **Step 1: Write the fixture**

Build the object by reflecting over nothing — write the members out, each defaulting to a thrower, then spread `overrides` last. A `Proxy` would be shorter and would also silently satisfy a member that no longer exists on the interface, which is the failure mode this task exists to end.

- [ ] **Step 2: Replace one file's fixture and run it**

Run: `cd apps/web && npx vitest run test/organiser/webhook-panel.test.tsx`
Expected: PASS, unchanged.

- [ ] **Step 3: Replace the rest**

Mechanical. A test that stubs three methods keeps stubbing three methods; only the surrounding boilerplate goes.

- [ ] **Step 4: Run the web suite**

Run: `cd apps/web && npx vitest run`
Expected: the same count as before this task — no test added, none removed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/test
git commit -m "refactor(web): one shared fakeClient fixture for ApiClient (#228)"
```

---

### Task 1: Test analytics (`R-06`)

**Files:**
- Create: `packages/db/src/repo/analytics.ts`
- Modify: `packages/db/src/repo/index.ts`
- Create: `apps/web/src/routes/analytics.tsx`
- Modify: `apps/api/src/app.ts`, `apps/web/src/lib/api.ts`
- Test: `packages/db/test/repo/analytics.test.ts`, `apps/web/test/organiser/analytics.test.tsx`

**Interfaces:**
- Consumes: `listAttemptsForTest`, `countedScore` (8a); `fakeClient` (Task 0).
- Produces:

```ts
export interface TestAnalytics {
  counts: {
    registered: number;
    inProgress: number;
    submitted: number;
    autoSubmitted: number;
    /** 7e's `0011`. Neither in progress nor submitted — its own count. */
    locked: number;
  };
  /** Fixed 10-bucket histogram over percent, 0-10, 10-20, … */
  distribution: number[];
  mean: number | null;
  median: number | null;
  passRate: number | null;       // null when the test sets no pass mark
  completionRate: number;
  averageSeconds: number | null;
  integrity: { clean: number; review: number; high_risk: number };
  /** One entry per set, so an organiser can see whether sets were equally hard. */
  perSet: { setNo: number; n: number; mean: number | null }[];
}

export const testAnalytics: Scoped<(testId: string) => Promise<TestAnalytics>>;
```

**Not `TestSummary`** — that name is taken by `apps/web/src/lib/api.ts:114` and imported in nine files.

**`K19`** — `GROUP BY` aggregates, or one pass over one fetch. Never per candidate.

**`integrity` counts real values now.** 7e merged as #239: `setIntegrity` is called from `apps/api/src/run/submit.ts` and `attempt.integrity_flag` carries `clean`, `review` and `high_risk`. The 2026-10-22 draft told the implementer to expect all-`clean` and keep the field honest about having no source; that instruction is dead. Count the column.

**`completionRate` excludes locked attempts from its denominator**, because a locked candidate was prevented from completing. Review Focus 1.

Route: `GET /api/v1/workspaces/:id/tests/:testId/analytics` — `workspace`, `results.export`.

- [ ] **Step 1: Write the failing tests**

Review Focus 1 is the fourth and fifth.

```ts
it("computes the counts, mean, median and completion rate", async () => {
  const s = await testAnalytics(db, wsp, testId);
  expect(s).toMatchObject({ mean: 64.2, median: 66, completionRate: 0.9 });
});

it("reports passRate null when the test sets no pass mark", async () => {
  expect((await testAnalytics(db, wsp, testIdNoPassMark)).passRate).toBeNull();
});

it("buckets the distribution into ten", async () => {
  expect((await testAnalytics(db, wsp, testId)).distribution).toHaveLength(10);
});

it("counts a locked attempt as locked, not as in progress", async () => {
  const s = await testAnalytics(db, wsp, testIdWithLock);
  expect(s.counts.locked).toBe(1);
  expect(s.counts.inProgress).toBe(0);
});

it("keeps a locked attempt out of the completion rate's denominator", async () => {
  // 9 submitted, 1 locked, 0 in progress — not 0.9.
  expect((await testAnalytics(db, wsp, testIdWithLock)).completionRate).toBe(1);
});

it("counts the integrity flags 7e writes", async () => {
  expect((await testAnalytics(db, wsp, testIdFlagged)).integrity)
    .toEqual({ clean: 8, review: 1, high_risk: 1 });
});

it("compares sets", async () => {
  expect((await testAnalytics(db, wsp, testIdTwoSets)).perSet)
    .toEqual([{ setNo: 1, n: 150, mean: 61.0 }, { setNo: 2, n: 150, mean: 67.4 }]);
});

it("stays inside the subrequest ceiling for 300 candidates", async () => {
  const counting = countingDeps(deps);
  await testAnalytics(counting.deps.db, wsp, testIdWith300);
  expect(counting.counts().db).toBeLessThanOrEqual(4);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/db && npx vitest run test/repo/analytics.test.ts`

- [ ] **Step 3: Implement as aggregates**

- [ ] **Step 4: Build the screen, mount the route, declare all three**

Declare `ROUTE_AUTH`, `ROUTE_ACTIONS` and a measured `ROUTE_BUDGETS` entry — measured, not guessed: run `countingDeps` against the 300-candidate fixture and write the number it reports.

The organiser's surfaces paint on the **Signal** ground; an accent may not cross grounds; every colour-setting selector needs **two** `SURFACE` entries in `contrast-usage.test.ts`. `no-hex-colors.test.ts` forbids colour **words** as well as hex outside a block comment — pick colour-free vocabulary for anything you name here (a distribution chart is where this bites).

- [ ] **Step 5: `axe`, plus the probe that proves `axe` works**

Break a label association, query by **role** to bypass RTL's throw, confirm `axe` reports `"Form elements must have labels (label)"`. Restore.

- [ ] **Step 6: Run both suites**

Run: `cd packages/db && npx vitest run` then `cd apps/web && npx vitest run`

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repo/analytics.ts packages/db/src/repo/index.ts apps/web/src/routes/analytics.tsx apps/web/src/lib/api.ts apps/api/src/app.ts packages/db/test apps/web/test
git commit -m "feat(db,web,api): test analytics as aggregates, locked counted apart (K19, #94)"
```

---

### Task 2: Item analysis (`R-07`)

**Files:**
- Create: `packages/core/src/item-analysis.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/db/src/repo/analytics.ts` (the one fetch this computes over)
- Modify: `apps/web/src/routes/analytics.tsx`
- Test: `packages/core/test/item-analysis.test.ts`

**Interfaces:**
- Consumes: Task 1's one fetch.
- Produces:

```ts
/** K20's floor: below this the index is withheld and the cell says why. */
export const DISCRIMINATION_MIN_N = 10;

export interface ItemStat {
  questionId: string;
  /** 0-1. */
  shareCorrect: number;
  /** null below DISCRIMINATION_MIN_N, and null for a question with no
   *  variance (everyone right or everyone wrong) — never NaN. */
  discrimination: number | null;
  /** Why it is null, for the surface to render. */
  discriminationWithheld: "too_few_attempts" | "no_variance" | null;
  /** optionId -> share. Empty for a non-choice question. */
  optionPickRates: Record<string, number>;
  n: number;
}

/** ONE pass over the whole response set. `K19`. */
export function itemAnalysis(input: {
  attempts: readonly { attemptId: string; percent: number }[];
  responses: readonly { attemptId: string; questionId: string; correct: boolean | null; value: unknown }[];
}): ItemStat[];
```

**`K20`** — the index is withheld below ten and the cohort size is named beside it.

**`K2`** — **no time figure.** The surface says so: a line reading that time per question is not recorded, linking the issue 8a filed.

- [ ] **Step 1: Write the failing tests**

Review Focus 3 and 4 are the third and fourth.

```ts
it("computes share correct per question", () => {
  expect(itemAnalysis(cohortOf(20)).find((s) => s.questionId === "q1")!.shareCorrect).toBe(0.6);
});

it("discriminates top from bottom 27%", () => {
  expect(itemAnalysis(cohortOf(100)).find((s) => s.questionId === "q1")!.discrimination)
    .toBeCloseTo(0.42, 2);
});

it("withholds the index below ten attempts and says why", () => {
  const s = itemAnalysis(cohortOf(6))[0];
  expect(s.discrimination).toBeNull();
  expect(s.discriminationWithheld).toBe("too_few_attempts");
  expect(s.n).toBe(6);
});

it("withholds it for a question everybody got right, rather than returning NaN", () => {
  const s = itemAnalysis(cohortWhereAllCorrect("q1")).find((x) => x.questionId === "q1")!;
  expect(s.discrimination).toBeNull();
  expect(s.discriminationWithheld).toBe("no_variance");
});

it("gives option pick rates summing to one over answered responses", () => {
  const s = itemAnalysis(cohortOf(20)).find((x) => x.questionId === "q1")!;
  expect(Object.values(s.optionPickRates).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
});

it("returns an empty pick-rate map for a question nobody reached, never a division by zero", () => {
  expect(itemAnalysis(cohortOf(20)).find((x) => x.questionId === "qUnreached")!.optionPickRates)
    .toEqual({});
});

it("makes one pass — 300 x 60 does not call per question", () => {
  const spy = vi.fn();
  itemAnalysis(instrumentedCohort(300, 60, spy));
  expect(spy.mock.calls.length).toBeLessThanOrEqual(300 * 60);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/core && npx vitest run test/item-analysis.test.ts`

- [ ] **Step 3: Implement as one pass**

Sort attempts by percent once; take the top and bottom 27% once; then walk the response set accumulating per question. Not a sort per question.

- [ ] **Step 4: Render it, with the missing-time line**

- [ ] **Step 5: Run the core coverage gate**

Run: `cd packages/core && npx vitest run --coverage --coverage.thresholds.functions=100 --coverage.thresholds.statements=98`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/item-analysis.ts packages/core/src/index.ts packages/core/test/item-analysis.test.ts packages/db/src/repo/analytics.ts apps/web/src/routes/analytics.tsx
git commit -m "feat(core,web): item analysis, index withheld below n=10 and with no variance (K19, K20, #95)"
```

---

### Task 3: The results CSV and the per-answer CSV

**Files:**
- Create: `apps/api/src/export/results.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/routes/analytics.tsx` (the download buttons), `apps/web/src/lib/api.ts`
- Test: `apps/api/test/export/results.test.ts`

**Interfaces:**
- Consumes: `toCsv`, `csvFilename`, `CsvPage` (`packages/core/src/csv.ts`), `countedScore`, `listAttemptsForTest` (`packages/db/src/repo/results.ts:106`).
- Consumes: `latestVerdicts` (`packages/db/src/repo/review.ts:91`) —

```ts
latestVerdicts(db, workspaceId, attemptIds: readonly string[]):
  Promise<Map<string, { verdict: Verdict; note: string | null; reviewer: string; at: number }>>
```

  **It scans the whole workspace's `review` table in one statement.** Call it **once per page**, handing it that page's attempt ids. Once per row is 300 full scans.
- Produces: `GET …/tests/:testId/export/results.csv` and `…/answers.csv`, both `workspace` + `results.export`, both taking `?cursor=`.

**`R-08`'s columns, in order** — every registration-form field by its label, set, start and submit times, time taken, submit reason, total, max, percent, rank, pass/fail, one column per section score, integrity counts and flag, verdict and note, and a review link. Plus `K7`'s two figures as **separate columns**.

**Two columns the 2026-10-22 draft did not have**, both from 7e: **`Locked at`** and **`Integrity flag`**. `listAttemptsForTest` already selects `integrity_flag` and `observed`; `locked_at` needs adding to its projection or a second scoped read — prefer the projection, it is the same row.

**`R-10`** — UTF-8 with BOM, `<slug>_results_<YYYYMMDD-HHMM>.csv`, **available during the test** for partial results.

**`K38`** — paging. A route that reached its bound **always** returns a cursor.

- [ ] **Step 1: Write the failing tests**

Review Focus 2 is the first; Review Focus 1 is the fourth; the duplicate-label case is the third.

```ts
it("exports every row of a 300-candidate test across pages, losing none", async () => {
  const csv = await drainExport(`${base}/export/results.csv`);
  expect(readDelimited(csv.replace(/^﻿/, "")).length - 1)
    .toBe(await countAttempts(db, wsp, testIdWith300));
});

it("always returns a cursor when it filled a page", async () => {
  const page = await getJson(`${base}/export/results.csv?limit=100`, asViewer);
  expect(page.nextCursor).not.toBeNull();
});

it("disambiguates two registration fields sharing a label", async () => {
  const csv = await drainExport(`${baseDupLabels}/export/results.csv`);
  const header = readDelimited(csv.replace(/^﻿/, ""))[0];
  expect(new Set(header).size).toBe(header.length);
});

it("carries the lock and the integrity flag 7e writes", async () => {
  const header = await headerOf(`${base}/export/results.csv`);
  expect(header).toEqual(expect.arrayContaining(["Locked at", "Integrity flag"]));
  expect(await rowFor(lockedAttemptId, `${base}/export/results.csv`)).toContain("high_risk");
});

it("carries the verdict and note from the review table", async () => {
  const row = await firstDataRow(`${base}/export/results.csv`);
  expect(row).toContain("suspicious");
});

it("reads the review table once per page, not once per row", async () => {
  const counting = countingDeps(deps);
  await exportResultsPage(counting.deps, { testId: testIdWith300, limit: 300 });
  expect(counting.counts().db).toBeLessThanOrEqual(5);
});

it("carries this attempt's percent and the counted percent as separate columns", async () => {
  const header = await headerOf(`${base}/export/results.csv`);
  expect(header).toEqual(expect.arrayContaining(["Percent", "Counted percent"]));
});

it("is available while the test is still open", async () => {
  expect((await get(`${baseOpenTest}/export/results.csv`, asViewer)).status).toBe(200);
});

it("carries no answer key — KG1", async () => {
  const csv = await drainExport(`${baseWithSentinel}/export/answers.csv`);
  expect(csv).not.toContain(KEY_SENTINEL);
});

it("carries `correct` as a boolean, not the correct answer", async () => {
  const row = await firstDataRow(`${base}/export/answers.csv`);
  expect(row).toContain("true");
  expect(row).not.toContain(MODEL_ANSWER_TEXT);
});

it("stays inside the ceiling on one page of 300", async () => {
  const counting = countingDeps(deps);
  await exportResultsPage(counting.deps, { testId: testIdWith300, limit: 300 });
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});
```

The first test is the one that catches a silent truncation and the reason the fixture is 300.

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/api && npx vitest run test/export/results.test.ts`

- [ ] **Step 3: Implement both exports**

Duplicate labels get a disambiguating suffix; decide the exact form and record it as a ruling in `.superpowers/sdd/phase-8c/progress.md`. Rank is computed over the page-independent ordering, so it must come from one ordered query rather than from each page's own position — a rank that restarts at 1 on page two is the subtle version of Review Focus 2.

- [ ] **Step 4: Add the `KG1` sentinel scan**

In the shape of `apps/api/test/run/scrub-scan.test.ts`: derive the export endpoint list **from the route table** rather than hand-writing it, so a route added later is covered without anyone remembering.

- [ ] **Step 5: Authorisation tests, each 403 with its 200**

Three dimensions now, not two: a session without `results.export`, a session with it, and an **API key** scoped to `results.export` (8d-2 shipped scoped keys; this is their second production scope).

- [ ] **Step 6: Probe — prove the row-count test catches a truncation**

Cap the export at 100 rows and drop the cursor. Run. Record the verbatim failure in the progress ledger. Restore.

- [ ] **Step 7: Run both api configs**

Run: `cd apps/api && npx vitest run` then `npx vitest run -c vitest.workers.config.ts`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/export/results.ts apps/api/src/app.ts apps/web/src/routes/analytics.tsx apps/web/src/lib/api.ts apps/api/test/export
git commit -m "feat(api,web): the results and per-answer CSVs, paged and never truncating (K8, K38, #97)"
```

---

### Task 4: The events CSV, the snapshot manifest, and the test-definition alias

**Files:**
- Create: `apps/api/src/export/evidence.ts`
- Modify: `apps/api/src/app.ts`
- Create: `docs/exports.md`
- Test: `apps/api/test/export/evidence.test.ts`

**Interfaces:**
- Consumes: `toCsv`, `csvFilename`; `StorageAdapter.signedUrl` and `StorageAdapter.list` (`packages/storage/src/adapter.ts`); `SIGNED_URL_TTL_SECONDS` (600).
- Consumes: the existing `exportTest` in `apps/api/src/export/test.ts`.
- Produces: `…/export/events.csv` and `…/export/snapshots.csv` — both `workspace` + `attempts.read_evidence` — and `…/export/test.json`, `workspace` + `results.export`.

**`…/export/test.json` is an alias, not a serialiser.** `GET /api/v1/workspaces/:id/tests/:testId/export` already returns the `pariksha/test@1` document, but its action is `tests.edit`, so a Viewer who may export results may not fetch the definition that explains the columns. Mount the existing handler at the new path under `results.export` and leave the old route alone. A second serialiser would violate the same instinct `K8` applies to CSV.

**`K3`** — the snapshot export is a **manifest**, one row per snapshot carrying attempt, candidate, `taken_at`, `reason`, `face_count` and a presigned URL, plus a documented one-liner for pulling them down. Not a ZIP: one R2 `get` is one subrequest and a single Strict attempt holds ~60 images.

**`K4`** — the existing `SIGNED_URL_TTL_SECONDS` (600). The manifest **states its expiry** in a header comment row.

**`K1`** — `face_count` is written `null` for every snapshot in the product today (`packages/db/src/repo/attempts.ts:769`) and `null` means **not counted**, never zero faces. The manifest must render it as `not counted`, never `0`.

- [ ] **Step 1: Write the failing tests**

Review Focus 5 is the fourth.

```ts
it("mints one presigned URL per snapshot and spends no storage subrequests", async () => {
  const counting = countingDeps(deps);
  await snapshotManifest(counting.deps, { testId, attemptIds: sixtyAttempts });
  expect(counting.counts().storage).toBe(0);   // signedUrl is not counted, by design
});

it("renders a null face_count as 'not counted', never 0", async () => {
  const csv = await drainExport(`${base}/export/snapshots.csv`);
  expect(csv).toContain("not counted");
  expect(csv).not.toMatch(/,0,/);
});

it("states the URL expiry in the file", async () => {
  expect(await drainExport(`${base}/export/snapshots.csv`)).toMatch(/expire/i);
});

it("marks a row whose object retention already swept, rather than handing out a dead URL", async () => {
  await sweepObjectFor(snapshotId);          // apps/api/src/retention/candidate.ts
  const csv = await drainExport(`${base}/export/snapshots.csv`);
  expect(csv).toMatch(/deleted|unavailable/i);
});

it("checks existence with one list per prefix, not one get per key", async () => {
  const counting = countingDeps(deps);
  await snapshotManifest(counting.deps, { testId, attemptIds: sixtyAttempts });
  expect(counting.counts().storage).toBeLessThanOrEqual(sixtyAttempts.length);
});

it("exports every event for 300 candidates across pages", async () => {
  const csv = await drainExport(`${base}/export/events.csv`);
  expect(readDelimited(csv.replace(/^﻿/, "")).length - 1)
    .toBe(await countEvents(db, wsp, testIdWith300));
});

it("refuses a Viewer, who holds results.export and not attempts.read_evidence", async () => {
  expect((await get(`${base}/export/events.csv`, asViewer)).status).toBe(403);
});

it("admits a Reviewer, who holds both — control for the test above", async () => {
  expect((await get(`${base}/export/events.csv`, asReviewer)).status).toBe(200);
});

it("serves the test definition to a Viewer, who cannot reach the tests.edit route", async () => {
  expect((await get(`${base}/export/test.json`, asViewer)).status).toBe(200);
  expect((await get(`${base}/export`, asViewer)).status).toBe(403);
});
```

The Viewer/Reviewer pair is the real permission boundary in this task: a Viewer may export results and may **not** read evidence.

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/api && npx vitest run test/export/evidence.test.ts`

- [ ] **Step 3: Implement all three**

Checking whether each object still exists costs one `list` per prefix — one subrequest for many keys, not one per key. Use `StorageAdapter.list`, not `get`, and record the ruling.

- [ ] **Step 4: Document the downloader one-liner**

In `docs/exports.md`, referenced from the manifest's own header row. `K3` promises it.

- [ ] **Step 5: Run, then extend the `KG1` scan over these three too**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/export/evidence.ts apps/api/src/app.ts apps/api/test/export/evidence.test.ts docs/exports.md
git commit -m "feat(api): events CSV, the snapshot manifest instead of a ZIP, test.json for a Viewer (K3, K4, #98)"
```

---

### Task 5: `D7c`'s readiness aggregate

**Files:**
- Create: `apps/api/src/publish/readiness.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/routes/tests.tsx` (the meter, and the comment at `versionSummary`'s docblock that forbade it)
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/api/test/publish/readiness.test.ts`, `apps/web/test/testbuilder/test-list.test.tsx`

**Interfaces:**
- Consumes: `apps/api/src/publish/checklist.ts`.
- Produces: `GET /api/v1/workspaces/:id/tests/readiness` → `{ [testId]: { ready: number; total: number } }` — **one** response for every test in the workspace.

**`K21`** — one route, one call. **Not** one `GET …/checklist` per row. `apps/web/src/routes/tests.tsx` carries the comment that forbids the per-row version (*"NO READINESS METER, deliberately (`D7c`) … The meter lives in the builder until Phase 8 adds an aggregate, and `test-list.test.tsx` guards both the absence and the call budget"*) and that guard is a contract with this plan. This task is what releases it.

**The guard test lives at `apps/web/test/testbuilder/test-list.test.tsx`**, not `apps/web/test/organiser/`.

**This is the phase's second cut** (`K40`'s cut order). If it goes, it goes whole: the comment stays and the guard stays.

- [ ] **Step 1: Write the failing tests**

```ts
it("answers for every test in one response", async () => {
  const body = await getJson(readinessUrl, asAuthor);
  expect(Object.keys(body)).toHaveLength(12);
});

it("costs a bounded number of statements for twelve tests", async () => {
  const counting = countingDeps(deps);
  await readinessFor(counting.deps, wsp);
  expect(counting.counts().db).toBeLessThanOrEqual(4);
});

it("renders the meter in the test list from one call", async () => {
  render(<Tests {...props} />);
  expect(await screen.findByText("5 / 7")).toBeInTheDocument();
  expect(fetchSpy.mock.calls.filter(isChecklistCall)).toHaveLength(0);
});
```

The third test is the existing guard, inverted: it asserted the meter's **absence** and the call budget; it now asserts the meter's presence and the same call budget.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement, mount, render, and rewrite the `tests.tsx` comment**

That comment says the meter *"lives in the builder until Phase 8 adds an aggregate."* Replace it with what is now true. A comment left contradicting the code is the defect `K33` corrected in the PRD.

- [ ] **Step 4: Run both suites**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/publish/readiness.ts apps/api/src/app.ts apps/web/src/routes/tests.tsx apps/web/src/lib/api.ts apps/api/test/publish apps/web/test/testbuilder/test-list.test.tsx
git commit -m "feat(api,web): the readiness aggregate, one call for the whole test list (K21, D7c)"
```

---

## Before the branch review

1. Full suite, **alone**, with the correct incantation — note the bare `--`, and read the output, never the exit status:

```
npx turbo run test --concurrency=1 -- --no-file-parallelism
```

2. `SITE_URL=https://pariksha.example pnpm build` — the prerenderer refuses a non-`https` origin, and three separate "the web build is broken" reports in one session were only that.
3. **No migration in this phase.** `GET /api/v1/health` must still answer `{"migrations":12}` after the merge; if a task finds it needs a column, that is a scope question for the owner, not a `0012`.
