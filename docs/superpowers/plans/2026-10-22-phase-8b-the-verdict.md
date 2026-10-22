# Phase 8b — The Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human grade the manual questions a machine cannot, blind or by question, record a reviewer's verdict on an attempt, and recompute every score when a key changes — all through the one scoring path 8a built.

**Architecture:** A grading award is stored on the `response` row (`points`, `graded_by`) and the attempt is rescored immediately through `rescoreAttempt`. Blind grading omits identity from the **payload**, never hides it in CSS. A verdict is an append-only row in the `review` table that has existed since `0000`, latest-wins. Regrade enqueues and the cron drains it, because 300 attempts in one request is six times the subrequest ceiling.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Preact/React.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K5`, `K14`, `K15`, `K16`, `K17`, `K18`, `K27`, `K42`, `KG1`, `KG2`.

**Depends on:** **8a.** Consumes `rescoreAttempt` (Task 2), `listAttemptsForTest` (Task 7), the `SCHEDULED_JOBS` registry (Task 6) and `0009`'s `response(workspace_id, question_id)` index (Task 1). **Starts only once 7d merges** (`K43`).

**Goals covered:** `G2` — a manual question can be graded, blind or by question, and the score it produces is the same arithmetic the automatic path uses.

**Issues:** #92 (`P8.4`), #93 (`P8.5`), #96 (`P8.8`).

## Global Constraints

Every task's requirements implicitly include this section. **8a's Global Constraints apply in full and are not repeated** — read that plan's section first. These are this plan's additions.

- **`attempts.grade` and `attempts.read_evidence` get their first production callers here.** Both have had zero outside `permissions.test.ts`. Every new route needs a `ROUTE_AUTH` entry **and** a `ROUTE_ACTIONS` entry; `route-authority.test.ts` asserts the `workspace` key set is exactly `Object.keys(ROUTE_ACTIONS)`.
- **`KG2`** — every 403 test needs a **200 beside it in the same file**. A typo in the URL makes a bare 403 pass for free; this shipped vacuous three times in 7c.
- **`KG1`** — nothing this plan serves may carry a key, explanation, rubric *answer*, model answer or accepted pattern to anyone below `attempts.read_evidence`. The grading UI is the one place a rubric is legitimately shown — to a grader who holds `attempts.grade`.
- **A `RubricAward` is `{ levels: readonly string[] }`** — level names from the question's own `rubric` array, never a raw points number. `gradeManual` resolves the points. **A level the question does not define is worth nothing**, so a question authored with no rubric sums to 0 whatever a grader picks.
- Record each ruling in `.superpowers/sdd/phase-8b/progress.md`.

## Review Focus

1. **A `long_answer` question authored with no `rubric` array at all.** `gradeManual`'s own doc comment: *"a question authored without a rubric sums to 0 whatever a reviewer picks."* A grading UI that offers an empty picker lets a grader believe they awarded marks that are structurally impossible. Task 1 must refuse to present it as gradeable and say why. This is the sharpest trap in the plan.
2. **Two graders awarding the same question at the same time.** `response` has `unique(attempt_id, question_id)` and the existing upsert is guarded by `excluded.client_seq > client_seq` — a *candidate* concept with no meaning for a grader. Last write wins is acceptable; silently losing one grader's award with no record is not. Task 1.
3. **A regrade running while a candidate is still sitting the test.** `R-10` makes results available during the test, so an in-flight attempt is reachable. A rescore of an unsubmitted attempt must be skipped, not scored against a partial paper. Task 4.
4. **An integrity recompute or a grading rescore clobbering `attempt.flag: "scoring_blocked"`.** `submit.ts` writes it on a `bounded.ts` refusal and `0008`'s own comment explains the separation. Grading must not erase it. Tasks 1 and 4.
5. **A verdict read on an attempt reviewed twice in the same millisecond.** `K16` is latest-wins and `review` has no unique constraint. Ordering by `at` alone is non-deterministic; `(at, id)` is not. Task 3.

---

### Task 1: Award a grade, and rescore

**Files:**
- Create: `apps/api/src/grade/award.ts`
- Create: `packages/db/src/repo/grading.ts`
- Modify: `apps/api/src/app.ts` (`ROUTE_BUDGETS`, `ROUTE_ACTIONS`, `ROUTE_AUTH`, the mount)
- Test: `apps/api/test/grade/award.test.ts`

**Interfaces:**
- Consumes: `rescoreAttempt` (8a Task 2), `RubricAward`, `gradeManual` (`@pariksha/core`).
- Produces:

```ts
/** Stores the award and rescores in one call. `K14`. */
export const recordAward: Scoped<(input: {
  attemptId: string;
  questionId: string;
  award: RubricAward;
  gradedBy: string;
  now: number;
}) => Promise<{ points: number; written: boolean }>>;

/** Manual questions awaiting a human, across one test. ONE query. */
export const listPendingAwards: Scoped<(
  testId: string,
  opts?: { questionId?: string; limit?: number; cursor?: string },
) => Promise<{ rows: PendingAward[]; nextCursor: string | null }>>;

export interface PendingAward {
  attemptId: string;
  questionId: string;
  /** The candidate's answer. Never the model answer (`KG1`). */
  value: unknown;
  /** Present only when a grader already awarded one. */
  award: RubricAward | null;
  points: number | null;
}
```

Route: `POST /api/v1/workspaces/:id/tests/:testId/grade` — `workspace` authority, `attempts.grade`.

**`K14`** — the award is stored on the response row and the attempt is rescored immediately. There is no separate awards store and no deferred rescore.

- [ ] **Step 1: Write the failing tests**

Review Focus items 1, 2 and 4 are tests 4, 5 and 6.

```ts
it("stores the award and writes a fresh score_json", async () => {
  await recordAward(db, wsp, { attemptId, questionId: "q3", award: { levels: ["thorough"] }, gradedBy: "usr_1", now });
  expect((await getAttempt(db, wsp, attemptId))!.scoreJson).toMatchObject({ total: 14 });
});

it("drops the graded question from pending", async () => {
  await recordAward(db, wsp, { attemptId, questionId: "q3", award: { levels: ["thorough"] }, gradedBy: "usr_1", now });
  expect((await getAttempt(db, wsp, attemptId))!.scoreJson).toMatchObject({ pending: [] });
});

it("records who graded it", async () => {
  await recordAward(db, wsp, { attemptId, questionId: "q3", award: { levels: ["thorough"] }, gradedBy: "usr_1", now });
  expect((await readResponse(db, wsp, attemptId, "q3"))!.gradedBy).toBe("usr_1");
});

it("refuses a question whose document defines no rubric, naming the reason", async () => {
  await expect(recordAward(db, wsp, { attemptId, questionId: "qNoRubric", award: { levels: ["x"] }, gradedBy: "usr_1", now }))
    .rejects.toThrow(/no rubric/);
});

it("lets a second grader overwrite the first, and records the second", async () => {
  await recordAward(db, wsp, { attemptId, questionId: "q3", award: { levels: ["thin"] }, gradedBy: "usr_1", now });
  await recordAward(db, wsp, { attemptId, questionId: "q3", award: { levels: ["thorough"] }, gradedBy: "usr_2", now: now + 1 });
  const row = (await readResponse(db, wsp, attemptId, "q3"))!;
  expect(row.gradedBy).toBe("usr_2");
});

it("never touches attempt.flag", async () => {
  await setFlag(db, wsp, attemptId, "scoring_blocked");
  await recordAward(db, wsp, { attemptId, questionId: "q3", award: { levels: ["thorough"] }, gradedBy: "usr_1", now });
  expect((await getAttempt(db, wsp, attemptId))!.flag).toBe("scoring_blocked");
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/api && npx vitest run test/grade/award.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `recordAward` and `listPendingAwards`**

`recordAward` writes the response row and calls `rescoreAttempt` with every stored award for that attempt — not only the new one — because the score is of the whole paper. Refuse a question whose document carries no `rubric`: `gradeManual` would resolve 0 for any level, and letting a grader award into that is the defect Review Focus 1 names.

`listPendingAwards` is **one query** for the whole test, filtered by `question_id` when grading by question — the path `0009`'s index exists for (`K42`).

- [ ] **Step 4: Mount the route with all three declarations**

`ROUTE_BUDGETS` measured with `countingDeps`, `ROUTE_ACTIONS: "attempts.grade"`, `ROUTE_AUTH: "workspace"`.

- [ ] **Step 5: Write the authorisation tests — 403 and 200 together**

```ts
it("admits an actor holding attempts.grade", async () => {
  expect((await post(gradeUrl, body, asReviewer)).status).toBe(200);
});

it("refuses an Author, who holds tests.edit and not attempts.grade", async () => {
  expect((await post(gradeUrl, body, asAuthor)).status).toBe(403);
});

it("refuses a member of another workspace with 404", async () => {
  expect((await post(gradeUrl, body, asOutsider)).status).toBe(404);
});
```

The first is the control for the other two (`KG2`).

- [ ] **Step 6: Run, including the workers config**

Run: `cd apps/api && npx vitest run test/grade && npx vitest run -c vitest.workers.config.ts`

- [ ] **Step 7: Probe — prove the 403 test can fail**

Grant `attempts.grade` to `author` in the matrix, rebuild `@pariksha/core`, run, record the verbatim line, restore and rebuild. A probe that does not rebuild tests the old build and proves nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/grade packages/db/src/repo/grading.ts apps/api/src/app.ts apps/api/test/grade
git commit -m "feat(api,db): record a rubric award and rescore through the one path (K14, #92)"
```

---

### Task 2: The grading queue, blind and by question

**Files:**
- Create: `apps/web/src/routes/grading.tsx`
- Create: `apps/web/src/components/organiser/GradingQueue.tsx`
- Modify: `apps/web/src/components/OrganiserShell.tsx` (nothing — reached from a test, not the top nav)
- Modify: `apps/web/src/styles/` (the chain `CHAINS` names for this component)
- Test: `apps/web/test/organiser/grading-queue.test.tsx`

**Interfaces:**
- Consumes: `listPendingAwards`'s payload shape (Task 1).
- Produces: nothing other tasks consume.

**`K15`** — blind grading omits every candidate-identifying field **from the payload**. The browser is never sent a name it is trusted not to render.

Design constraints that bind here:
- The organiser's surfaces paint on the **Signal** ground. An accent may not cross grounds. Every colour-setting selector needs a `SURFACE` entry in `contrast-usage.test.ts` — **two**, one per ground.
- `DESIGN.md` is the only place a colour is declared. `no-hex-colors.test.ts` forbids a raw hex **and CSS named-colour words** (`black`, `green`, `blue`) anywhere outside a **block** comment. 7d had to rename a whole concept late for this. **Pick colour-free vocabulary up front.**
- `css-chain.ts` is the one `@import` resolver and strips comments, so a rule named only in prose cannot satisfy a scan. `CHAINS` decides which stylesheet this component's rules live in.
- `axe` on the new surface; `component-dimensions.test.ts` pins sizing for anything new.
- This screen does **not** join `apps/web/e2e/density.ts`'s `SURFACES` — `KG10` adds the monitor only, in 8g.

- [ ] **Step 1: Write the failing payload test — blindness is server-side**

```ts
it("sends no candidate identity in blind mode", async () => {
  const body = await getJson(`${queueUrl}?blind=1`, asReviewer);
  expect(JSON.stringify(body)).not.toContain(CANDIDATE_EMAIL);
  expect(body.rows[0]).not.toHaveProperty("formValues");
});

it("sends it when blind mode is off — the control for the assertion above", async () => {
  const body = await getJson(queueUrl, asReviewer);
  expect(JSON.stringify(body)).toContain(CANDIDATE_EMAIL);
});
```

Without the second test the first passes for free the moment the field is renamed.

- [ ] **Step 2: Write the failing UI tests**

```ts
it("lists every ungraded manual answer for the test", async () => {
  render(<GradingQueue {...props} />);
  expect(await screen.findAllByRole("article")).toHaveLength(3);
});

it("groups by question when grading by question", async () => {
  render(<GradingQueue {...props} mode="by-question" />);
  expect(screen.getByRole("heading", { name: /Question 3/ })).toBeInTheDocument();
});

it("offers the question's own rubric levels and nothing else", async () => {
  render(<GradingQueue {...props} />);
  expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value")))
    .toEqual(["thin", "adequate", "thorough"]);
});

it("says a question with no rubric cannot be graded, rather than offering an empty picker", async () => {
  render(<GradingQueue {...props} rows={[rowWithNoRubric]} />);
  expect(screen.getByText(/has no rubric/)).toBeInTheDocument();
  expect(screen.queryByRole("radio")).toBeNull();
});

it("offers radios when the question does have one — control for the test above", async () => {
  render(<GradingQueue {...props} rows={[rowWithRubric]} />);
  expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd apps/web && npx vitest run test/organiser/grading-queue.test.tsx --no-file-parallelism`

- [ ] **Step 4: Build the route and the component**

- [ ] **Step 5: Add the `axe` pass**

One honest pass, with a comment pointing at `contrast-usage.test.ts` for real per-ground ratios. Toggling `data-theme` in jsdom injects no stylesheet, so two iterations produce an identical DOM and rule set.

- [ ] **Step 6: Probe — prove `axe` catches something**

Break a label association, then use a **role-based** query to bypass RTL's own throw, and confirm `axe` reports `"Form elements must have labels (label)"`. Breaking a label and watching `getByLabelText` throw proves RTL works, not that `axe` caught anything.

- [ ] **Step 7: Run the web suite**

Run: `cd apps/web && npx vitest run --no-file-parallelism`

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/grading.tsx apps/web/src/components/organiser/GradingQueue.tsx apps/web/src/styles apps/web/test/organiser
git commit -m "feat(web): the grading queue, blind by payload and groupable by question (K15, #92)"
```

---

### Task 3: Reviewer verdicts

**Files:**
- Create: `packages/db/src/repo/review.ts`
- Modify: `apps/api/src/app.ts` (three declarations and the mount)
- Modify: `apps/web/src/components/organiser/GradingQueue.tsx` (the verdict control)
- Test: `packages/db/test/repo/review.test.ts`, `apps/api/test/review.test.ts`

**Interfaces:**
- Produces:

```ts
export type Verdict = "clear" | "suspicious" | "disqualified";

export const recordVerdict: Scoped<(input: {
  attemptId: string; reviewer: string; verdict: Verdict;
  note?: string; now: number;
}) => Promise<{ reviewId: string }>>;

/** Latest-wins, ordered by (at, id) so a same-millisecond pair is
 *  deterministic (`K16`). One query for many attempts. */
export const latestVerdicts: Scoped<(
  attemptIds: readonly string[],
) => Promise<Map<string, { verdict: Verdict; note: string | null; reviewer: string; at: number }>>>;
```

Consumed by **8c** — the results CSV carries the verdict and the note.

**`K16`** — a verdict is an append-only row. The `review` table has existed since `0000` with exactly these columns and **needs no migration**.

Route: `POST /api/v1/workspaces/:id/attempts/:attemptId/verdict` — `workspace`, `attempts.grade`.

- [ ] **Step 1: Write the failing tests**

Review Focus item 5 is the third.

```ts
it("appends rather than replacing", async () => {
  await recordVerdict(db, wsp, { attemptId, reviewer: "usr_1", verdict: "suspicious", now: 1 });
  await recordVerdict(db, wsp, { attemptId, reviewer: "usr_2", verdict: "clear", now: 2 });
  expect(await countReviews(db, wsp, attemptId)).toBe(2);
});

it("reads back the latest", async () => {
  // ...both written as above
  expect((await latestVerdicts(db, wsp, [attemptId])).get(attemptId)).toMatchObject({ verdict: "clear" });
});

it("is deterministic for two verdicts at the same millisecond", async () => {
  const a = await recordVerdict(db, wsp, { attemptId, reviewer: "usr_1", verdict: "suspicious", now: 5 });
  const b = await recordVerdict(db, wsp, { attemptId, reviewer: "usr_2", verdict: "clear", now: 5 });
  const winner = (await latestVerdicts(db, wsp, [attemptId])).get(attemptId);
  const again = (await latestVerdicts(db, wsp, [attemptId])).get(attemptId);
  expect(winner).toEqual(again);
  expect([a.reviewId, b.reviewId]).toContain(/* the id ordering picked */ winner!.reviewer === "usr_2" ? b.reviewId : a.reviewId);
});

it("reads many attempts in one query", async () => {
  const counting = countingDeps(deps);
  await latestVerdicts(counting.deps.db, wsp, threeHundredAttemptIds);
  expect(counting.counts().db).toBe(1);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/db && npx vitest run test/repo/review.test.ts`

- [ ] **Step 3: Implement, mount, and add the verdict control**

Order by `(at, id)`. `latestVerdicts` takes a list and returns a map — one query, because 8c calls it once for a whole test.

- [ ] **Step 4: Authorisation tests, 403 with its 200**

- [ ] **Step 5: Run**

Run: `cd packages/db && npx vitest run --no-file-parallelism && cd ../../apps/api && npx vitest run test/review.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repo/review.ts apps/api/src/app.ts apps/web/src/components/organiser/GradingQueue.tsx packages/db/test/repo/review.test.ts apps/api/test/review.test.ts
git commit -m "feat(db,api,web): reviewer verdicts, append-only and latest-wins (K16, #93)"
```

---

### Task 4: Regrade after a key change

**Files:**
- Create: `apps/api/src/grade/regrade.ts`
- Modify: `apps/api/src/scheduled.ts` (register one job — and the registry's `toEqual([])` test)
- Modify: `apps/api/src/app.ts` (three declarations and the mount)
- Modify: `apps/web/src/routes/question.tsx` (the Regrade offer after a key change)
- Test: `apps/api/test/grade/regrade.test.ts`

**Interfaces:**
- Consumes: `rescoreAttempt` (8a Task 2), `SCHEDULED_JOBS` (8a Task 6), `listAttemptsForTest` (8a Task 7).
- Produces:

```ts
/** Enqueues. Returns how many attempts will be rescored. `K18`. */
export const enqueueRegrade: Scoped<(input: {
  testVersionId: string; requestedBy: string; now: number;
}) => Promise<{ queued: number }>>;

export const regradeJob: ScheduledJob;   // registered under the */5 cron
```

**`K17`** — scoped to a test **version**, one audit entry naming the version, the count rescored and the count whose total changed. **`K18`** — the cron drains it; 300 attempts in one request is six times the ceiling and far past 10 ms of grading arithmetic.

**There is no regrade queue table, and there must not be one.** `K10` makes `0009` the phase's only migration, and `0009` does not carry one.

**Ruling, taken here so the implementer does not have to invent it: the queue is the audit log.** `enqueueRegrade` writes an `audit_log` row with `action: "regrade.requested"` and a `detail` naming the `testVersionId`; the job finds, for each version, the latest such row with no matching `"regrade.completed"` row, and rescores the submitted attempts of that version whose `score_json` was last written before it. `audit_log` is already workspace-scoped, already indexed on `["workspace_id", "at"]`, and `S-13` already requires a regrade to be logged — so the row has to exist anyway and a second table would store the same fact twice.

*Why not a `test_version.regrade_requested_at` column:* it is schema, and schema in this plan means a second migration under a branch running in parallel with 8d and 8e — the exact renumbering `K10` exists to prevent.

*Cost if wrong:* "has this version been regraded since" is a query over `audit_log` rather than a column read. If that proves too slow at 300 attempts, the fix is an index, not a table — and **stop and ask** before adding either.

This also satisfies `K17` naturally: the completion row **is** the one audit entry `AC-08` asks for.

- [ ] **Step 1: Write the failing tests**

Review Focus items 3 and 4 are the third and fourth.

```ts
it("rescores every submitted attempt of the version", async () => {
  await enqueueRegrade(db, wsp, { testVersionId, requestedBy: "usr_1", now });
  await regradeJob.run(deps);
  expect((await getAttempt(db, wsp, attemptId))!.scoreJson).toMatchObject({ total: NEW_TOTAL });
});

it("writes exactly one audit entry for the whole run", async () => {
  await enqueueRegrade(db, wsp, { testVersionId, requestedBy: "usr_1", now });
  await regradeJob.run(deps);
  const rows = (await listAudit(db, wsp)).filter((r) => r.action === "regrade");
  expect(rows).toHaveLength(1);
  expect(rows[0].detail).toMatchObject({ rescored: 300, changed: 12 });
});

it("skips an attempt that has not been submitted", async () => {
  await enqueueRegrade(db, wsp, { testVersionId, requestedBy: "usr_1", now });
  await regradeJob.run(deps);
  expect((await getAttempt(db, wsp, liveAttemptId))!.scoreJson).toBeNull();
});

it("never clears scoring_blocked", async () => {
  await setFlag(db, wsp, attemptId, "scoring_blocked");
  await enqueueRegrade(db, wsp, { testVersionId, requestedBy: "usr_1", now });
  await regradeJob.run(deps);
  expect((await getAttempt(db, wsp, attemptId))!.flag).toBe("scoring_blocked");
});

it("rescores a bounded batch per tick and resumes on the next", async () => {
  await enqueueRegrade(db, wsp, { testVersionId: versionWith300, requestedBy: "usr_1", now });
  const first = await regradeJob.run(deps);
  expect(first.summary).toMatch(/\d+ of 300/);
  await regradeJob.run(deps);
  expect(await countUnrescored(db, wsp, versionWith300)).toBeLessThan(300);
});

it("stays inside the subrequest ceiling on one tick", async () => {
  const counting = countingDeps(deps);
  await regradeJob.run(counting.deps);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});
```

The last is `K18`'s whole reason, as an assertion.

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/api && npx vitest run test/grade/regrade.test.ts`

- [ ] **Step 3: Implement the enqueue, the job, and register it**

Registering the job changes 8a Task 6's `expect(SCHEDULED_JOBS).toEqual([])` test. That test is deliberately brittle — update it to name this job rather than making it dynamic.

- [ ] **Step 4: Offer Regrade after a key change in the question editor**

`AC-08`: *"Changing a key and running Regrade updates every affected attempt's score and writes one audit entry."* The offer appears after a key edit on a question any published version uses. It says the rescore is queued and how many attempts it covers (`K18` — the screen states the batch size).

- [ ] **Step 5: Authorisation tests, 403 with its 200**

`attempts.grade`. An Author holding `tests.edit` can change a key and **cannot** regrade — test both halves.

- [ ] **Step 6: Run both api configs**

Run: `cd apps/api && npx vitest run && npx vitest run -c vitest.workers.config.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/grade/regrade.ts apps/api/src/scheduled.ts apps/api/src/app.ts apps/web/src/routes/question.tsx apps/api/test/grade/regrade.test.ts apps/api/test/scheduled.test.ts
git commit -m "feat(api,web): regrade a test version on the cron, one audit entry (K17, K18, #96)"
```
