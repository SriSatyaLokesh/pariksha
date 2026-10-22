# Phase 8c — The Numbers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell an organiser whether their test was any good, and let the results leave the product as files that open in Excel and never silently drop a row.

**Architecture:** Every figure is a `GROUP BY` aggregate or one pass over one fetched set — never per question, never per candidate. Exports page with a cursor and the browser assembles; a route that reaches its bound always returns a cursor, so there is no shape where a full-looking 200 is a partial file. The snapshot export is a manifest of presigned URLs, because `signedUrl` is the one storage call the subrequest counter deliberately does not count.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Preact/React.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K2`, `K3`, `K4`, `K6`, `K8`, `K9`, `K19`, `K20`, `K21`, `K38`, `K42`, `KG1`, `KG2`, `KG3`, `KG6`.

**Depends on:** **8a** (`toCsv`, `csvFilename`, `countedScore`, `listAttemptsForTest`, `0010`'s response index) and **8b** (`latestVerdicts` — the results CSV carries the verdict and the note).

**Goals covered:** `G3` and `G4`.

**Issues:** #94 (`P8.6`), #95 (`P8.7`), #97 (`P8.9`), #98 (`P8.10`), plus `D7c`'s readiness aggregate.

## Global Constraints

**8a's Global Constraints apply in full and are not repeated.** These are this plan's additions.

- **`results.export` gets its first production caller here.** Every route needs `ROUTE_AUTH`, `ROUTE_ACTIONS` and a measured `ROUTE_BUDGETS` entry, each 403 test with a 200 beside it (`KG2`).
- **`KG1`** — no key, explanation, rubric, model answer or accepted pattern in any CSV or manifest. The per-answer CSV carries `correct` as a **boolean**, never the correct answer. Test this in the shape of `scrub-scan.test.ts`: enumerate the export routes from the route table, replay a sentinel fixture, assert the sentinel never appears.
- **`KG3`** — every figure and every export is measured against a **300-candidate × 60-question** fixture. At ten rows a per-item query passes.
- **10 ms CPU per invocation.** A discrimination index is a sort and two means — cheap once, sixty times if written per question.
- **`K2`** — item analysis ships **share correct, discrimination index and option pick rates**. No time column anywhere, and the omission is stated **on the surface**, not only in a document.
- Record each ruling in `.superpowers/sdd/phase-8c/progress.md`.

## Review Focus

1. **An export whose rows exceed one invocation's bound.** The per-answer CSV is 300 × 60 ≈ 18,000 rows; the events CSV is unbounded. This phase's anti-goal is that *"an export that quietly drops rows is a lost-answers bug wearing a results hat"*, on the phase gated by zero lost answers. The test is a row-count equality against the database, not a smoke test. Task 3.
2. **A cohort of six candidates reaching the discrimination index.** Top and bottom 27% of six is two against two. `K20` withholds it below ten and names the cohort size. Task 2.
3. **A question every candidate answered correctly, or none did.** Discrimination is `0/0` for a question with no variance; option pick rates over a question nobody reached divide by zero. Both must produce a stated "no variance" rather than `NaN` in a CSV cell. Task 2.
4. **A results CSV for a test whose registration form has two fields with the same label.** `R-08` uses *field labels* as column names, and labels are organiser-supplied free text with no uniqueness constraint. Two identical headers make the file ambiguous in Excel and in every parser. Task 3.
5. **A presigned manifest requested for an attempt whose R2 objects were already swept by retention.** The `snapshot` row can outlive its object (8e deletes on a schedule). A URL to a missing object 404s silently inside a download loop. Task 4.

---

### Task 1: Test analytics (`R-06`)

**Files:**
- Create: `packages/db/src/repo/analytics.ts`
- Create: `apps/web/src/routes/analytics.tsx`
- Modify: `apps/api/src/app.ts`
- Test: `packages/db/test/repo/analytics.test.ts`, `apps/web/test/organiser/analytics.test.tsx`

**Interfaces:**
- Consumes: `listAttemptsForTest`, `countedScore` (8a).
- Produces:

```ts
export interface TestSummary {
  counts: { registered: number; inProgress: number; submitted: number; autoSubmitted: number };
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

export const testSummary: Scoped<(testId: string) => Promise<TestSummary>>;
```

**`K19`** — `GROUP BY` aggregates, or one pass over one fetch. Never per candidate.

Route: `GET /api/v1/workspaces/:id/tests/:testId/analytics` — `workspace`, `results.export`.

- [ ] **Step 1: Write the failing tests**

```ts
it("computes the counts, mean, median and completion rate", async () => {
  const s = await testSummary(db, wsp, testId);
  expect(s).toMatchObject({ mean: 64.2, median: 66, completionRate: 0.9 });
});

it("reports passRate null when the test sets no pass mark", async () => {
  expect((await testSummary(db, wsp, testIdNoPassMark)).passRate).toBeNull();
});

it("buckets the distribution into ten", async () => {
  expect((await testSummary(db, wsp, testId)).distribution).toHaveLength(10);
});

it("compares sets", async () => {
  expect((await testSummary(db, wsp, testIdTwoSets)).perSet)
    .toEqual([{ setNo: 1, n: 150, mean: 61.0 }, { setNo: 2, n: 150, mean: 67.4 }]);
});

it("stays inside the subrequest ceiling for 300 candidates", async () => {
  const counting = countingDeps(deps);
  await testSummary(counting.deps.db, wsp, testIdWith300);
  expect(counting.counts().db).toBeLessThanOrEqual(4);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/db && npx vitest run test/repo/analytics.test.ts`

- [ ] **Step 3: Implement as aggregates**

- [ ] **Step 4: Build the screen, mount the route, declare all three**

The organiser's surfaces paint on the **Signal** ground; an accent may not cross grounds; every colour-setting selector needs **two** `SURFACE` entries in `contrast-usage.test.ts`. `no-hex-colors.test.ts` forbids colour **words** as well as hex outside a block comment — pick colour-free vocabulary for anything you name here (a distribution chart is where this bites).

- [ ] **Step 5: `axe`, plus the probe that proves `axe` works**

Break a label association, query by **role** to bypass RTL's throw, confirm `axe` reports `"Form elements must have labels (label)"`.

- [ ] **Step 6: Run both suites**

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repo/analytics.ts apps/web/src/routes/analytics.tsx apps/api/src/app.ts packages/db/test apps/web/test
git commit -m "feat(db,web,api): test analytics as aggregates (K19, #94)"
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

Review Focus items 2 and 3 are the third and fourth.

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
- Modify: `apps/web/src/routes/analytics.tsx` (the download buttons)
- Test: `apps/api/test/export/results.test.ts`

**Interfaces:**
- Consumes: `toCsv`, `csvFilename`, `CsvPage`, `countedScore`, `listAttemptsForTest` (8a); `latestVerdicts` (8b).
- Produces: `GET …/tests/:testId/export/results.csv` and `…/answers.csv`, both `workspace` + `results.export`, both taking `?cursor=`.

**`R-08`'s columns, in order** — every registration-form field by its label, set, start and submit times, time taken, submit reason, total, max, percent, rank, pass/fail, one column per section score, integrity counts and flag, verdict and note, and a review link. Plus `K7`'s two figures as **separate columns**.

**`R-10`** — UTF-8 with BOM, `<slug>_results_<YYYYMMDD-HHMM>.csv`, **available during the test** for partial results.

**`K38`** — paging. A route that reached its bound **always** returns a cursor.

- [ ] **Step 1: Write the failing tests**

Review Focus items 1 and 4 are the first and third.

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

it("carries the verdict and note from the review table", async () => {
  const row = await firstDataRow(`${base}/export/results.csv`);
  expect(row).toContain("suspicious");
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

Duplicate labels get a disambiguating suffix; decide the exact form and record it as a ruling. Rank is computed over the page-independent ordering, so it must come from one ordered query rather than from each page's own position — a rank that restarts at 1 on page two is the subtle version of Review Focus 1.

- [ ] **Step 4: Add the `KG1` sentinel scan**

In `scrub-scan.test.ts`'s shape: derive the export endpoint list from the route table rather than hand-writing it, so a route added later is covered without anyone remembering.

- [ ] **Step 5: Authorisation tests, each 403 with its 200**

- [ ] **Step 6: Probe — prove the row-count test catches a truncation**

Cap the export at 100 rows and drop the cursor. Run. Record the verbatim failure. Restore.

- [ ] **Step 7: Run both api configs**

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/export/results.ts apps/api/src/app.ts apps/web/src/routes/analytics.tsx apps/api/test/export
git commit -m "feat(api,web): the results and per-answer CSVs, paged and never truncating (K8, K38, #97)"
```

---

### Task 4: The events CSV, the test JSON, and the snapshot manifest

**Files:**
- Create: `apps/api/src/export/evidence.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/export/evidence.test.ts`

**Interfaces:**
- Consumes: `toCsv`, `csvFilename` (8a); `StorageAdapter.signedUrl`.
- Produces: `…/export/events.csv`, `…/export/test.json`, `…/export/snapshots.csv` — all `workspace`; the first and third `attempts.read_evidence`, the JSON `results.export`.

**`K3`** — the snapshot export is a **manifest**, one row per snapshot carrying attempt, candidate, `taken_at`, `reason`, `face_count` and a presigned URL, plus a documented one-liner for pulling them down. Not a ZIP: one R2 `get` is one subrequest and a single Strict attempt holds ~60 images.

**`K4`** — the existing `SIGNED_URL_TTL_SECONDS` (600). The manifest **states its expiry** in a header comment row.

**`K1`** — `face_count` is `null` for every attempt in the product today and `null` means **not counted**, never zero faces. The manifest must render it as blank or `not counted`, never `0`.

- [ ] **Step 1: Write the failing tests**

Review Focus item 5 is the fourth.

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

it("marks a row whose object no longer exists rather than handing out a dead URL", async () => {
  await sweepObjectFor(snapshotId);
  const csv = await drainExport(`${base}/export/snapshots.csv`);
  expect(csv).toMatch(/deleted|unavailable/i);
});

it("exports every event for 300 candidates across pages", async () => {
  const csv = await drainExport(`${base}/export/events.csv`);
  expect(readDelimited(csv.replace(/^﻿/, "")).length - 1).toBe(await countEvents(db, wsp, testIdWith300));
});

it("refuses a Viewer, who holds results.export and not attempts.read_evidence", async () => {
  expect((await get(`${base}/export/events.csv`, asViewer)).status).toBe(403);
});

it("admits a Reviewer, who holds both — control for the test above", async () => {
  expect((await get(`${base}/export/events.csv`, asReviewer)).status).toBe(200);
});
```

The Viewer/Reviewer pair is the real permission boundary in this task: a Viewer may export results and may **not** read evidence.

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/api && npx vitest run test/export/evidence.test.ts`

- [ ] **Step 3: Implement all three**

Checking whether each object still exists would cost one `list` per prefix — one subrequest for many keys, not one per key. Use `list`, not `get`, and record the ruling.

- [ ] **Step 4: Document the downloader one-liner**

In `docs/` beside the export, and referenced from the manifest's own header row. `K3` promises it.

- [ ] **Step 5: Run, then the `KG1` scan over these three too**

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/export/evidence.ts apps/api/src/app.ts apps/api/test/export/evidence.test.ts docs
git commit -m "feat(api): events CSV, test JSON, and the snapshot manifest instead of a ZIP (K3, K4, #98)"
```

---

### Task 5: `D7c`'s readiness aggregate

**Files:**
- Create: `apps/api/src/publish/readiness.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/routes/tests.tsx` (the meter, and the comment that forbade it)
- Test: `apps/api/test/publish/readiness.test.ts`, `apps/web/test/organiser/test-list.test.tsx`

**Interfaces:**
- Produces: `GET /api/v1/workspaces/:id/tests/readiness` → `{ [testId]: { ready: number; total: number } }` — **one** response for every test in the workspace.

**`K21`** — one route, one call. **Not** one `GET …/checklist` per row. `tests.tsx:74` carries the comment that forbids the per-row version and `test-list.test.tsx` guards both the absence and the call budget — that guard is a contract with this plan, and this task is what releases it.

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

- [ ] **Step 3: Implement, mount, render, and rewrite `tests.tsx:74`'s comment**

That comment says the meter *"lives in the builder until Phase 8 adds an aggregate."* Replace it with what is now true. A comment left contradicting the code is the defect `K33` corrected in the PRD.

- [ ] **Step 4: Run both suites**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/publish/readiness.ts apps/api/src/app.ts apps/web/src/routes/tests.tsx apps/api/test/publish apps/web/test/organiser/test-list.test.tsx
git commit -m "feat(api,web): the readiness aggregate, one call for the whole test list (K21, D7c)"
```
