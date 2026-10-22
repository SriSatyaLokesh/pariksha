# Phase 8e — The Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make data die on a schedule, let an owner erase one named candidate completely, and let an organiser see what a test will cost before they run it.

**Architecture:** Three jobs register on 8a's empty `scheduled` registry. Retention deletes in batches bounded by the subrequest ceiling and resumes, because the first run after a 300-candidate pilot has a lot of rows. Candidate deletion blanks the `candidate` row rather than removing it — a hard delete orphans the `attempt` rows `S-14` explicitly allows to survive, and it would miss `candidate_unique`, which holds a SHA-256 of the candidate's email.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Preact/React.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K27`, `K28`, `K29`, `K30`, `K31`, `K35`, `K36`, `KG4`, `KG5`, `KG8`, `KG9`.

**Depends on:** **8a** — `TestRetention` and `resolveRetention`, `estimateCost`, the `SCHEDULED_JOBS` registry, `toCsv`. **Starts only once 7d merges** (`K43`).

**Goals covered:** `G5` and `G6`.

**Issues:** #101 (`P8.13`), #102 (`P8.14`), plus Phase 6's deferred `rate_limit` row expiry.

## Global Constraints

**8a's Global Constraints apply in full and are not repeated.** These are this plan's additions.

- **`candidates.delete` gets its first production caller here**, and it is **Owner-only** in the matrix. `ROUTE_AUTH` + `ROUTE_ACTIONS` + a measured budget on every route; each 403 test with a 200 beside it (`KG2`).
- **`K30`** — every job processes a **bounded batch** and resumes. No job attempts "everything expired" in one invocation.
- **`StorageAdapter.delete(keys[])` is batched** — *"one call for many keys, never one call per key."* Snapshot expiry is one subrequest however many objects it removes. Never loop.
- **`K36`** — the whole free-tier dashboard renders only when `env.target === "workers"`. The API **omits** the field on `node`; it does not send a null.
- Deletion is **irreversible**. It is in the "stop and ask" list only when run outside a test — inside this plan it is the deliverable, so build it, test it hard, and never run it against anything but a fixture.
- Record each ruling in `.superpowers/sdd/phase-8e/progress.md`.

## Review Focus

1. **A candidate deleted while they are still sitting the test.** `S-14` says nothing about timing, and an attempt in flight has a live cookie resolving to a row this job is blanking. The deletion must either refuse an in-progress attempt or leave the attempt resolvable — a candidate getting a 500 mid-exam because an administrator pressed a button is the worst outcome in this plan. Task 2.
2. **A `snapshot` row whose R2 object is already gone, and an R2 object with no row.** `Q4f` ruled the row exists if and only if the object does, but retention deletes both and can be interrupted between them. Sweeping must be idempotent in both directions, and 8c's manifest reads these rows. Task 1.
3. **An `audit_log` row naming a candidate who has since been erased.** `KG4` exempts `audit_log` because `S-13` requires deletions to be logged — `KG9` is what keeps the exemption safe, by proving no call site ever put a name or an email in `detail_json`. Both tests are in this plan. Task 2.
4. **A test whose `retention` is unset.** `resolveRetention` applies 90 days and 12 months; a job reading `undefined` as "zero days" would delete everything on its first run. The defaults test is the cheapest insurance in the phase. Task 1.
5. **The free-tier estimate for a workspace with no attempts at all.** Division by zero, or a reassuring "0% of limit" on a workspace about to run its first 300-candidate Strict test. The projection must be forward-looking from the *configured* test, not only backward from rows that exist. Task 3.

---

### Task 1: The retention job

**Files:**
- Create: `apps/api/src/retention/sweep.ts`
- Modify: `apps/api/src/scheduled.ts` (register two jobs — retention and the rate-limit sweep — and its `toEqual([])` test)
- Test: `apps/api/test/retention/sweep.test.ts`

**Interfaces:**
- Consumes: `resolveRetention` (8a), `sweepRateLimits` (**already exists**, `packages/db/src/repo/rate-limit.ts:70`), `StorageAdapter.delete`.
- Produces:

```ts
export const retentionJob: ScheduledJob;     // "17 3 * * *"
export const rateLimitJob: ScheduledJob;     // "17 3 * * *"
export const RETENTION_BATCH = 500;          // bounded by K30, measured not guessed
```

**`K30`** — bounded batch, resumes, logs what it did. **`AC-24`** asks that expired data is deleted and logged, not that it happens in one tick.

**The rate-limit sweep is one line of new code.** `sweepRateLimits(db, before)` was written in Phase 6 and has never had a caller — the roadmap's Phase 6 row records *"no `rate_limit` row expiry until Phase 8's retention job."* This is that caller. Do not write a second sweep.

- [ ] **Step 1: Write the failing tests**

Review Focus items 2 and 4 are the fourth and first.

```ts
it("applies S-13's defaults to a test with no retention block", async () => {
  await retentionJob.run(depsAt(day(400)));
  expect(await countSnapshots(db, wsp, attemptAged(100))).toBe(0);     // 90-day default
  expect(await countResponses(db, wsp, attemptAged(100))).toBeGreaterThan(0);  // 365-day default
});

it("deletes nothing before the window", async () => {
  await retentionJob.run(depsAt(day(30)));
  expect(await countSnapshots(db, wsp, attemptAged(30))).toBeGreaterThan(0);
});

it("removes the R2 objects in one batched call, not one per key", async () => {
  const counting = countingDeps(depsAt(day(400)));
  await retentionJob.run(counting.deps);
  expect(counting.counts().storage).toBeLessThanOrEqual(2);
});

it("is idempotent when a row's object is already gone", async () => {
  await deleteObjectOnly(snapshotId);
  await expect(retentionJob.run(depsAt(day(400)))).resolves.toBeDefined();
  expect(await countSnapshots(db, wsp, attemptAged(100))).toBe(0);
});

it("processes a bounded batch and resumes on the next tick", async () => {
  await seedExpiredSnapshots(1200);
  const first = await retentionJob.run(depsAt(day(400)));
  expect(first.summary).toMatch(new RegExp(String(RETENTION_BATCH)));
  await retentionJob.run(depsAt(day(400)));
  expect(await countExpiredSnapshots(db, wsp)).toBeLessThan(1200);
});

it("stays inside the subrequest ceiling on one tick", async () => {
  const counting = countingDeps(depsWithManyExpired);
  await retentionJob.run(counting.deps);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});

it("writes one audit row per run naming what it deleted", async () => {
  await retentionJob.run(depsAt(day(400)));
  expect((await listAudit(db, wsp)).filter((r) => r.action === "retention.sweep")).toHaveLength(1);
});

it("expires rate_limit rows through the function Phase 6 already wrote", async () => {
  await rateLimitJob.run(depsAt(day(2)));
  expect(await countRateLimitRows(db)).toBe(0);
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/api && npx vitest run test/retention/sweep.test.ts`

- [ ] **Step 3: Implement both jobs and register them**

Order within a sweep: delete the R2 objects **first**, then the rows. The reverse leaves an object with no row, which nothing can ever find again; this order leaves a row with no object, which the next tick cleans up and which Review Focus 2's idempotence test covers.

Registering changes 8a Task 6's `toEqual([])` test — update it to name both jobs.

- [ ] **Step 4: Run both api configs**

- [ ] **Step 5: Probe — prove the batched-delete assertion can fail**

Loop `delete([key])` per key. Run the storage-count test. Record the verbatim failure. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/retention/sweep.ts apps/api/src/scheduled.ts apps/api/test/retention apps/api/test/scheduled.test.ts
git commit -m "feat(api): the nightly retention sweep and the rate_limit expiry Phase 6 deferred (K30, AC-24, #101)"
```

---

### Task 2: Candidate export and deletion (`S-14`)

**Files:**
- Create: `apps/api/src/retention/candidate.ts`
- Modify: `apps/api/src/app.ts`
- Create: `apps/web/src/components/organiser/CandidateDataPanel.tsx`
- Test: `apps/api/test/retention/candidate.test.ts`

**Interfaces:**
- Consumes: `toCsv` (8a), `StorageAdapter.delete`.
- Produces:

```ts
/** Everything the product holds about one candidate, as a download. */
export const exportCandidate: Scoped<(candidateId: string)
  => Promise<{ json: string; filename: string }>>;

/** K29. Blanks rather than removing. `keepAnonymisedScore` keeps the
 *  attempt rows and their score_json; false removes those too. */
export const deleteCandidate: Scoped<(input: {
  candidateId: string; keepAnonymisedScore: boolean; actor: string; now: number;
}) => Promise<{ tablesTouched: string[] }>>;
```

Routes: `GET`/`DELETE /api/v1/workspaces/:id/candidates/:candidateId/data` — `workspace`, `candidates.delete` (Owner-only).

**`K29`** — overwrite `form_values_json` to `{}`, null `external_id`, delete `candidate_unique` rows, delete `response` values, `event` rows, `snapshot` rows **and their R2 objects**, keep `attempt` with `score_json` when chosen. One `audit_log` row.

**Why not a hard delete:** it orphans every `attempt` row `S-14` allows to survive, and **`candidate_unique` holds a SHA-256 of the candidate's email** (`columns.ts:337`) that a `candidate` delete does not touch — the exact leak `S-14` is written against.

- [ ] **Step 1: Write `KG4`, the completeness guard, first**

It is the most valuable test in the plan and it must be written from `TABLE_MANIFEST` rather than from a hand-list, so a table added in a later phase fails it.

```ts
const EXEMPT = ["audit_log"];   // K29/KG4: S-13 requires the deletion itself be logged

it("empties every table holding candidate data", async () => {
  await deleteCandidate(db, wsp, { candidateId, keepAnonymisedScore: false, actor: "usr_1", now });
  for (const table of TABLE_MANIFEST.filter((t) => holdsCandidateData(t) && !EXEMPT.includes(t.name))) {
    expect(await rowsMentioning(db, table.name, candidateId)).toEqual([]);
  }
});

it("finds rows before the deletion — control for the sweep above", async () => {
  const found = TABLE_MANIFEST.filter((t) => holdsCandidateData(t) && !EXEMPT.includes(t.name));
  expect(found.length).toBeGreaterThan(3);
  for (const table of found) {
    expect(await rowsMentioning(db, table.name, candidateId)).not.toEqual([]);
  }
});
```

Without the second test the first passes for free if `holdsCandidateData` returns nothing.

- [ ] **Step 2: Write `KG9`, which pays for the exemption**

Review Focus item 3.

```ts
it("no appendAudit call site passes a name, an email or a form value", () => {
  expect(auditCallSitesPassingPersonalData("apps/api/src")).toEqual([]);
});

it("the scan catches one when planted — control", () => {
  expect(auditCallSitesPassingPersonalData(FIXTURE_WITH_ONE)).not.toEqual([]);
});
```

- [ ] **Step 3: Write the behaviour tests**

Review Focus item 1 is the fifth.

```ts
it("blanks the candidate row rather than removing it", async () => {
  await deleteCandidate(db, wsp, { candidateId, keepAnonymisedScore: true, actor: "usr_1", now });
  const row = (await getCandidateById(db, wsp, candidateId))!;
  expect(row.externalId).toBeNull();
  expect(row.formValues).toEqual({});
});

it("deletes the candidate_unique email hash", async () => {
  await deleteCandidate(db, wsp, { candidateId, keepAnonymisedScore: true, actor: "usr_1", now });
  expect(await countUniqueClaims(db, wsp, candidateId)).toBe(0);
});

it("keeps the anonymised score row when chosen", async () => {
  await deleteCandidate(db, wsp, { candidateId, keepAnonymisedScore: true, actor: "usr_1", now });
  expect((await getAttempt(db, wsp, attemptId))!.scoreJson).not.toBeNull();
});

it("removes the attempt entirely when not chosen", async () => {
  await deleteCandidate(db, wsp, { candidateId, keepAnonymisedScore: false, actor: "usr_1", now });
  expect(await getAttempt(db, wsp, attemptId)).toBeNull();
});

it("refuses while the candidate has an attempt in progress", async () => {
  await expect(deleteCandidate(db, wsp, { candidateId: sittingNow, keepAnonymisedScore: true, actor: "usr_1", now }))
    .rejects.toThrow(/in progress/);
});

it("exports everything the product holds before it is deleted", async () => {
  const { json } = await exportCandidate(db, wsp, candidateId);
  expect(JSON.parse(json)).toMatchObject({ candidate: {}, attempts: [], events: [], snapshots: [] });
});

it("logs the deletion", async () => {
  await deleteCandidate(db, wsp, { candidateId, keepAnonymisedScore: true, actor: "usr_1", now });
  expect((await listAudit(db, wsp)).filter((r) => r.action === "candidate.delete")).toHaveLength(1);
});

it("refuses an Admin, who does not hold candidates.delete", async () => {
  expect((await del(dataUrl, asAdmin)).status).toBe(403);
});

it("admits an Owner — control for the test above", async () => {
  expect((await del(dataUrl, asOwner)).status).toBe(200);
});
```

The Admin/Owner pair is the real boundary: `candidates.delete` is in `owner: ACTIONS` and in no other role.

- [ ] **Step 4: Run and watch them fail, then implement**

Refusing an in-progress attempt is the conservative answer to Review Focus 1 and is this task's ruling to record. The panel says so, and tells the owner to force-submit or wait.

- [ ] **Step 5: Build the panel, with a typed confirmation**

Irreversible, Owner-only, and it names exactly what will go and what will stay.

- [ ] **Step 6: Run both api configs and the whole branch**

- [ ] **Step 7: Probe — prove `KG4` can fail**

Skip `candidate_unique` in the deletion. Run `KG4`. Record the verbatim failure — this is the probe that proves the guard protects the thing `S-14` is actually about. Restore.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/retention/candidate.ts apps/api/src/app.ts apps/web/src/components/organiser/CandidateDataPanel.tsx apps/api/test/retention
git commit -m "feat(api,web): S-14 candidate export and erasure, swept from the manifest (K29, KG4, KG9, AC-25, #101)"
```

---

### Task 3: The free-tier meter

**Files:**
- Create: `apps/api/src/usage/project.ts`
- Create: `apps/web/src/components/organiser/UsagePanel.tsx`
- Modify: `apps/api/src/app.ts`, `apps/web/src/routes/home.tsx`
- Test: `apps/api/test/usage/project.test.ts`, `apps/web/test/organiser/usage.test.tsx`

**Interfaces:**
- Consumes: `estimateCost` (8a), `ROUTE_BUDGETS`.
- Produces:

```ts
export const FREE_PLAN_REQUESTS_PER_DAY = 100_000;
export const WARN_AT = 0.7;

export interface UsageProjection {
  /** Backward: what rows we already hold imply was spent today. */
  spentToday: number;
  /** Forward: what the workspace's configured open tests will spend. */
  projected: number;
  limit: number;
  warn: boolean;
  /** Always true. The surface renders this as a label. */
  estimated: true;
}

/** Returns null on the node target (`K36`). */
export function projectUsage(input: {
  target: "workers" | "node"; counts: UsageCounts; openTests: TestCostInput[];
}): UsageProjection | null;
```

**`K31`** — projected from rows we own. No Cloudflare API token, no outbound call, no per-request counter. **Labelled an estimate on the surface.**

**`K36`** — `null` on `node`, and the route **omits the field** rather than sending it.

**This is the phase's first cut** (`K40`'s cut order). Cutting it does **not** cut the cost surface: `K35`'s per-control estimates live with their controls in 8a and 8d.

- [ ] **Step 1: Write the failing tests**

Review Focus item 5 is the third.

```ts
it("projects from attempts, snapshots and events", () => {
  expect(projectUsage({ target: "workers", counts, openTests: [] })!.spentToday).toBe(12_400);
});

it("warns at 70 per cent", () => {
  expect(projectUsage({ target: "workers", counts: at(0.71), openTests: [] })!.warn).toBe(true);
  expect(projectUsage({ target: "workers", counts: at(0.69), openTests: [] })!.warn).toBe(false);
});

it("projects forward for a configured test with no attempts yet", () => {
  const p = projectUsage({ target: "workers", counts: ZERO, openTests: [strict300] })!;
  expect(p.spentToday).toBe(0);
  expect(p.projected).toBeGreaterThan(0);
  expect(p.warn).toBe(true);
});

it("returns null on the node target", () => {
  expect(projectUsage({ target: "node", counts, openTests: [strict300] })).toBeNull();
});

it("always marks itself an estimate", () => {
  expect(projectUsage({ target: "workers", counts, openTests: [] })!.estimated).toBe(true);
});
```

The third is the whole point of the feature: an organiser about to run a 300-candidate Strict test sees the projection **before** they run it.

- [ ] **Step 2: Write `KG8` — nothing reaches a `node` deployment**

With its positive control in the same file, because a missing-field assertion passes for free when the field was never named right.

```ts
it("omits the usage field entirely under node", async () => {
  const body = await getJson(homeUrl, asOwner, { target: "node" });
  expect(body).not.toHaveProperty("usage");
});

it("includes it under workers — control for the test above", async () => {
  const body = await getJson(homeUrl, asOwner, { target: "workers" });
  expect(body.usage).toBeDefined();
});

it("renders no usage element when the payload carries none", () => {
  render(<Home {...props} usage={undefined} />);
  expect(screen.queryByText(/of your daily limit/)).toBeNull();
});

it("renders one when it does — control", () => {
  render(<Home {...props} usage={projection} />);
  expect(screen.getByText(/of your daily limit/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run and watch them fail, then implement**

- [ ] **Step 4: Build the panel, labelled as an estimate**

The word "estimated" is on the surface, not only in a tooltip. `K31`'s honesty is the feature.

- [ ] **Step 5: `axe`, one honest pass**

- [ ] **Step 6: Probe — prove `KG8` can fail**

Render the usage element unconditionally. Run the `node` test. Record the verbatim failure. Restore.

- [ ] **Step 7: Run the whole branch**

Run: `npx turbo run test --force --concurrency=1`
Then: `cd apps/api && npx vitest run -c vitest.workers.config.ts`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/usage apps/web/src/components/organiser/UsagePanel.tsx apps/api/src/app.ts apps/web/src/routes/home.tsx apps/api/test/usage apps/web/test/organiser/usage.test.tsx
git commit -m "feat(api,web): the free-tier projection, forward-looking and workers-only (K31, K36, KG8, #102)"
```
