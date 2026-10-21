# Phase 7e — The Consequences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** What happens when the signals add up: the violation limit and all four of its actions, the lock and the organiser-side unlock that is its only way out, and the integrity flag computed from the evidence rather than stored as an opinion.

**Architecture:** Violation counting already happens server-side in 7c's ingest; this plan gives the count consequences. `warn_only` and `warn_then_flag` need no new mechanism. `auto_submit` collects the `SubmitReason` `"limit"` that `submit.ts:58` has had reserved for this phase since Phase 6. `lock` freezes the attempt behind 7c's overlay and needs the product's **first organiser-side attempt routes** — none exist today, though `attempts.monitor` and `attempts.read_evidence` have sat in the permission matrix since Phase 3. The integrity flag is a pure function over events and snapshots, recomputed on submit and on every violation, writing 7a's two columns.

**Tech Stack:** Hono + TypeScript (strict), Preact/React, Vitest + Testing Library, Drizzle.

**Spec:** [`docs/superpowers/specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md) — `Q5`, `Q5a`, `Q5b`, `Q5c`, `Q6`, `Q6a`, `Q6b`, `Q2`, `Q7a`, `Q3a`.

**Depends on:** **7a** (the columns, the event vocabulary, `resolveProctoring`), **7c** (the ingest, the overlay, the queue), **7d** (the camera outage this flag counts).

**Goals covered:** `G3` (violation counting, the configured action, the integrity flag) and `G5` (`AC-21`).

## Global Constraints

Copied from the spec's §16 and §17. Every task's requirements implicitly include this section.

- **`AG1`** — a proctoring stack failure never blocks answering. `Q2`'s camera requirement is the single exception, and **a lock is a consequence of a violation, not of a failure**: `FAILURE_EVENTS` must never reach the counter.
- **`AG5`** — never make a gate green by moving a bar.
- **`D1`** — the candidate's locked overlay takes voltage; the organiser's locked-attempt surface paints on the Signal ground, **both modes**. An accent may not cross grounds; every new colour-setting selector takes `SURFACE` entries on both.
- **`apps/web/test/css-chain.ts` is the one `@import` resolver**, shared by `theme.test.ts`, `contrast-usage.test.ts` and `signal-boundary.test.ts` (6.5b/6.5e). It **strips comments**, so a rule named only in prose cannot satisfy a scan.
- **A component's chain decides which stylesheet its rules live in** (`CHAINS` in `css-chain.ts`): `components/exam/` and `routes/exam.tsx` are the **candidate runtime** (`exam.css`); `components/testbuilder/`, `components/authoring/` and `components/organiser/` are the **organiser** (`admin.css` and its imports). Putting a shared control's rule in `primitives.css` is what caused **#201** — it reaches `admin.css` and `landing.css` and **not** `exam.css`.
- **The two grounds are selectors, not a guess**: dark is `:root`, light is `:root[data-theme="light"]` (`THEME_SELECTOR`). They are the **only** two selectors permitted to assign a semantic name, and `theme.test.ts` enforces it.
- **`SEMANTIC_NAMES` is a contract list.** Use the names that exist; adding one after a consuming plan has started is a change to three stylesheets and a gate, and 6.5b's own note says so.
- **`D14`** — every web assertion starts at `OrganiserApp` or `ExamApp` and clicks its way there.
- Every mounted route needs a **measured** `ROUTE_BUDGETS` entry and a `ROUTE_AUTH` declaration; the organiser routes here are `workspace` authority, not `attempt`.
- Organiser actions on a candidate's attempt write to Phase 3's **append-only audit log** and sit behind the permission matrix.
- Migrations: none in this plan — 7a carried them.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-7e/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **The limit reached twice** — a flush carrying the fifth and sixth violations together, or a retry re-sending the fifth. The action must fire **once**: two auto-submits is a double submission, and two locks is two audit rows for one event. Task 2.
2. **An attempt already submitted when the limit lands** — a late flush after the candidate finished. `auto_submit` must not submit a submitted attempt, and `lock` must not lock one; this is the shape of one of Phase 6's three Criticals (a reload returning a submitted candidate to a live paper). Task 2.
3. **A stack failure arriving while the count sits at the limit minus one** — `Q6b` and `AG1`. `snapshot_failed` must not be the event that auto-submits an honest candidate whose storage was down. Task 1.
4. **An unlock by a member of another workspace, or by a role without the permission** — the product's first organiser-side attempt routes, so the first chance to get workspace scoping wrong on one. `AC-23`'s rule holds: another workspace gets 404, a wrong role gets 403. Task 4.
5. **An integrity recompute on an attempt whose `flag` is `scoring_blocked`** — 7a separated the columns for this; this plan is where the recompute actually runs and could still clobber it. Task 5.

---

### Task 1: the count has a limit

**Files:**
- Modify: `apps/api/src/routes/proctoring.ts`
- Create: `packages/core/src/proctoring-outcome.ts`
- Test: `packages/core/test/proctoring-outcome.test.ts`, `apps/api/test/run/violation-limit.test.ts`

**Interfaces:**
- Consumes: `isViolation`, `VIOLATION_EVENTS`, `FAILURE_EVENTS`, `ResolvedProctoring` (7a).
- Produces:

```ts
export type ViolationOutcome =
  | { kind: "none" }
  | { kind: "warn"; count: number; limit: number }
  | { kind: "flag" }
  | { kind: "auto_submit" }
  | { kind: "lock" };

export function violationOutcome(input: {
  violations: number;          // the count AFTER this batch
  resolved: ResolvedProctoring;
  alreadyActioned: boolean;    // the limit has fired for this attempt before
}): ViolationOutcome;
```

**`P-09`** — a configurable count (default 5) and action. **`Q7a`** — the server counts, so the server decides.

**Review Focus 3 / `Q6b`** — `FAILURE_EVENTS` never increment the count. The ingest already classifies; this task must not re-derive the classification a second way.

- [ ] **Step 1: Write the failing tests**

```ts
it("warns below the limit", () => {
  expect(violationOutcome({ violations: 2, resolved: warnThenFlag5, alreadyActioned: false }))
    .toEqual({ kind: "warn", count: 2, limit: 5 });
});

it("fires the configured action at the limit", () => {
  expect(violationOutcome({ violations: 5, resolved: autoSubmit5, alreadyActioned: false }))
    .toEqual({ kind: "auto_submit" });
  expect(violationOutcome({ violations: 5, resolved: lock5, alreadyActioned: false }))
    .toEqual({ kind: "lock" });
});

it("flags rather than submits or locks under warn_then_flag at the limit", () => {
  expect(violationOutcome({ violations: 5, resolved: warnThenFlag5, alreadyActioned: false }))
    .toEqual({ kind: "flag" });
});

// Review Focus 1 — once, not twice.
it("does not fire the action again once it has fired", () => {
  expect(violationOutcome({ violations: 6, resolved: autoSubmit5, alreadyActioned: true }))
    .toEqual({ kind: "none" });
});

it("warn_only never escalates at the limit", () => {
  expect(violationOutcome({ violations: 9, resolved: warnOnly5, alreadyActioned: false }))
    .toEqual({ kind: "warn", count: 9, limit: 5 });
});
```

```ts
// Review Focus 3 — a failure is not a violation, at the route.
it("does not advance the count on snapshot_failed", async () => {
  await post("/api/v1/run/attempt/events", { events: Array.from({ length: 4 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  const res = await post("/api/v1/run/attempt/events",
    { events: [{ type: "snapshot_failed", clientTs: 9 }] }, attemptCookie);
  expect(await res.json()).toMatchObject({ violations: 4 });
  expect(await attemptState(attemptId)).toMatchObject({ status: "in_progress" });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/proctoring-outcome.test.ts apps/api/test/run/violation-limit.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `violationOutcome` and call it from the ingest**

`alreadyActioned` is read from the presence of a `violation_limit_reached` event on the attempt — no new column, and the event is already in 7a's vocabulary.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/core/test/proctoring-outcome.test.ts apps/api/test/run/violation-limit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proctoring-outcome.ts packages/core/test apps/api/src/routes/proctoring.ts apps/api/test/run/violation-limit.test.ts
git commit -m "feat(core): the violation limit decides once, and failures never count"
```

---

### Task 2: auto-submit at the limit

**Files:**
- Modify: `apps/api/src/routes/proctoring.ts`, `apps/api/src/run/submit.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Test: `apps/api/test/run/auto-submit.test.ts`, `apps/web/test/exam/auto-submit-limit.test.tsx`

**Interfaces:**
- Consumes: `violationOutcome` (Task 1); `SubmitReason = "manual" | "timeout" | "limit"` at `submit.ts:58` — **`"limit"` is already reserved for this phase** and is collected here rather than added.

**`AC-21`** — reaching the limit triggers the configured action. Fully automatable; no hardware.

- [ ] **Step 1: Write the failing tests**

```ts
it("submits the attempt with reason 'limit' at the limit", async () => {
  await reachLimit(attemptCookie, autoSubmit5);
  const state = await attemptState(attemptId);
  expect(state.status).toBe("submitted");
  expect(state.submitReason).toBe("limit");
});

// Review Focus 1 — one submission, whatever the flush carried.
it("submits once when the fifth and sixth violations arrive together", async () => {
  const submits = spyOnSubmit();
  await post("/api/v1/run/attempt/events", { events: Array.from({ length: 6 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  expect(submits).toHaveBeenCalledTimes(1);
});

// Review Focus 2 — a late flush after the candidate finished.
it("does not submit an already-submitted attempt", async () => {
  await submitManually(attemptCookie);
  const res = await post("/api/v1/run/attempt/events", { events: Array.from({ length: 6 },
    (_, i) => ({ type: "window_blur" as const, clientTs: i })) }, attemptCookie);
  expect(res.status).toBeLessThan(500);
  expect((await attemptState(attemptId)).submitReason).toBe("manual");
});
```

```tsx
it("takes the candidate to the receipt, saying why", async () => {
  await startStrictAttempt({ violationLimit: 1, violationAction: "auto_submit" });
  fireEvent(window, new Event("blur"));
  fireEvent(window, new Event("focus"));
  expect(await screen.findByText(/submitted because the warning limit was reached/i)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/test/run/auto-submit.test.ts apps/web/test/exam/auto-submit-limit.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the auto-submit path**

The ingest calls the existing submit path with `reason: "limit"`; the response tells the client the attempt is over so the runner navigates to the receipt rather than discovering it on the next save.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/api/test/run/auto-submit.test.ts apps/web/test/exam/auto-submit-limit.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/web/src/components/exam/ProctoringLayer.tsx apps/api/test apps/web/test
git commit -m "feat(run): auto-submit at the violation limit, collecting the reserved reason"
```

---

### Task 3: lock, and the overlay that says so

**Files:**
- Modify: `apps/api/src/routes/proctoring.ts`, `apps/api/src/middleware/attemptContext.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Test: `apps/api/test/run/lock.test.ts`, `apps/web/test/exam/locked.test.tsx`

**Interfaces:**
- Produces: an attempt status of `locked`, refused by every `attempt`-authority write route and surfaced by `GET /api/v1/run/attempt`.

**`Q5`** — `lock` freezes the attempt behind an overlay explaining what happened and what to do. **`Q5c`** — the timer is server-authoritative and **ran through the lock**; an unlock does not refund time, and this plan must not grant an extension by accident.

**`Q2b`** — the locked overlay is 7c's: announced, focus-trapped, no Escape.

- [ ] **Step 1: Write the failing tests**

```ts
it("locks the attempt at the limit and refuses further answers", async () => {
  await reachLimit(attemptCookie, lock5);
  expect((await attemptState(attemptId)).status).toBe("locked");
  const res = await put("/api/v1/run/attempt/answer", { questionId: "q1", value: "A" }, attemptCookie);
  expect(res.status).toBe(409);
});

// Review Focus 2 — a submitted attempt is not lockable.
it("does not lock an already-submitted attempt", async () => {
  await submitManually(attemptCookie);
  await reachLimit(attemptCookie, lock5);
  expect((await attemptState(attemptId)).status).toBe("submitted");
});

// Q5c — the clock does not stop and is not refunded.
it("keeps counting down through a lock", async () => {
  const before = (await attemptState(attemptId)).remainingSeconds;
  await reachLimit(attemptCookie, lock5);
  await advanceServerClock(300);
  expect((await attemptState(attemptId)).remainingSeconds).toBeLessThan(before - 290);
});
```

```tsx
it("shows a locked overlay naming what happened and what to do", async () => {
  await startStrictAttempt({ violationLimit: 1, violationAction: "lock" });
  fireEvent(window, new Event("blur"));
  fireEvent(window, new Event("focus"));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveAccessibleName(/locked/i);
  expect(within(dialog).getByText(/contact the organiser/i)).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/test/run/lock.test.ts apps/web/test/exam/locked.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the locked status and the overlay**

`attemptContext` refuses writes on a locked attempt with 409 — one guard in the middleware every write route already passes through, not a check in each route.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/api/test/run/lock.test.ts apps/web/test/exam/locked.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/web/src/components/exam/ProctoringLayer.tsx apps/api/test apps/web/test
git commit -m "feat(run): lock an attempt at the limit, and say so to the candidate"
```

---

### Task 4: the unlock, and the surface it needs

**Files:**
- Create: `apps/api/src/routes/attempts.ts`
- Modify: `apps/api/src/app.ts` (mount, `ROUTE_AUTH`, `ROUTE_BUDGETS`)
- Create: `apps/web/src/components/testbuilder/LockedAttempts.tsx`
- Test: `apps/api/test/attempts/unlock.test.ts`, `apps/web/test/testbuilder/locked-attempts.test.tsx`

**Interfaces:**
- Produces:

```ts
// GET  /api/v1/workspaces/:workspaceSlug/tests/:testId/attempts?status=locked   — `workspace`
// POST /api/v1/workspaces/:workspaceSlug/tests/:testId/attempts/:attemptId/unlock — `workspace`
type LockedAttemptRow = {
  attemptId: string; candidateLabel: string; lockedAt: number;
  violations: number; remainingSeconds: number;
};
```

**`Q5a`** — there is **no organiser-side attempt route in the product at all**; `attempts.monitor` and `attempts.read_evidence` have existed in the permission matrix since Phase 3 with nothing behind them. So the unlock is really a minimal pair: a locked-attempts read, and the unlock. Both are replaced by Phase 8's monitor; neither is designed to survive it.

**`Q5b`** — audited through Phase 3's append-only log, behind the permission matrix. **Not** a `review` row — `review` is Phase 8's verdict model and borrowing it would pre-empt a design that phase has not made.

**Ruling — the locked-attempts list does not join the density registry.** 6.5e shipped `apps/web/e2e/density.ts` with `SURFACES = ["testList", "bankList", "bankBrowser", "questionPicker"]`, a `PRIMARY_ROW` selector per surface and `countPrimaryRows`, and `AG1`'s rows-visible gate governs every surface in it. This list is a list of rows and looks like a fifth. It is not one: `D12` scopes `AG1` to **scanning** surfaces, and nobody scans a list that is empty on almost every test and holds one row on the rest. Registering it would pin a density figure for a surface Phase 8 deletes. *Cost if wrong:* if locking turns out to be common enough that an organiser really does scan this list, it joins the registry then — adding a surface to it is four lines, and the figure would be captured against a real population rather than a fixture.

- [ ] **Step 1: Write the failing tests**

```ts
it("lists locked attempts for a test", async () => {
  await lockAttempt(attemptId);
  const rows = await (await get(`/api/v1/workspaces/${slug}/tests/${testId}/attempts?status=locked`, ownerCookie)).json();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ attemptId, violations: 5 });
});

it("unlocks, and the candidate can answer again", async () => {
  await lockAttempt(attemptId);
  expect((await post(`/api/v1/workspaces/${slug}/tests/${testId}/attempts/${attemptId}/unlock`, {}, ownerCookie)).status).toBe(200);
  expect((await put("/api/v1/run/attempt/answer", { questionId: "q1", value: "A" }, attemptCookie)).status).toBe(200);
});

it("writes an audit row naming the actor and the attempt", async () => {
  await lockAttempt(attemptId);
  await post(`/api/v1/workspaces/${slug}/tests/${testId}/attempts/${attemptId}/unlock`, {}, ownerCookie);
  expect(await auditRows(workspaceId)).toContainEqual(
    expect.objectContaining({ action: "attempt.unlock", subject: attemptId }));
});

// Review Focus 4 — AC-23's rule, on the product's first organiser attempt route.
it("answers 404 to a member of another workspace", async () => {
  await lockAttempt(attemptId);
  expect((await post(`/api/v1/workspaces/${slug}/tests/${testId}/attempts/${attemptId}/unlock`, {}, otherWorkspaceCookie)).status).toBe(404);
});

it("answers 403 to a role without the permission", async () => {
  await lockAttempt(attemptId);
  expect((await post(`/api/v1/workspaces/${slug}/tests/${testId}/attempts/${attemptId}/unlock`, {}, authorCookie)).status).toBe(403);
});

// Q5c — no refund.
it("does not extend the attempt", async () => {
  await lockAttempt(attemptId);
  const before = (await attemptState(attemptId)).remainingSeconds;
  await post(`/api/v1/workspaces/${slug}/tests/${testId}/attempts/${attemptId}/unlock`, {}, ownerCookie);
  expect((await attemptState(attemptId)).remainingSeconds).toBeLessThanOrEqual(before);
});
```

```tsx
it("shows locked attempts on the test and unlocks from there", async () => {
  await openBuilderWithLockedAttempt();
  await user.click(await screen.findByRole("button", { name: /Unlock/ }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /Unlock/ })).toBeNull());
});

it("says plainly that nothing else tells the organiser a lock happened", async () => {
  await openBuilderWithLockedAttempt();
  expect(screen.getByText(/A locked attempt clears only when you unlock it here\./)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/test/attempts/unlock.test.ts apps/web/test/testbuilder/locked-attempts.test.tsx`
Expected: FAIL — 404, no such routes.

- [ ] **Step 3: Implement both routes and the panel**

`attempts.monitor` gates the read, and the unlock too — the matrix's `proctor` role has it, which is the role this action belongs to. Declare both in `ROUTE_AUTH` and `ROUTE_BUDGETS` with **measured** figures.

- [ ] **Step 4: Run the permission matrix suite with them**

Run: `npx vitest run apps/api/test/attempts/unlock.test.ts apps/api/test/authorization.test.ts apps/api/test/budget.test.ts`
Expected: PASS — `AC-23`'s sweep covers the two new routes without an exception.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src apps/web/src/components/testbuilder/LockedAttempts.tsx apps/api/test apps/web/test
git commit -m "feat(api): the product's first organiser attempt routes, for one unlock"
```

---

### Task 5: the integrity flag

**Files:**
- Create: `packages/core/src/integrity.ts`
- Modify: `apps/api/src/routes/proctoring.ts`, `apps/api/src/run/submit.ts`
- Test: `packages/core/test/integrity.test.ts`, `apps/api/test/run/integrity.test.ts`

**Interfaces:**
- Consumes: `setIntegrity` (7a Task 3), `FAILURE_EVENTS`, `VIOLATION_EVENTS` (7a Task 5).
- Produces:

```ts
export function integrityFor(input: {
  events: { type: ProctoringEventType; detail?: unknown }[];
  snapshots: { faceCount: number | null }[];
  resolved: ResolvedProctoring;
  expectedSnapshots: number;
}): { flag: "clean" | "review" | "high_risk"; observed: boolean };
```

**`Q6`** — `high_risk` when any of the three thresholds is met; `review` on any violation at all; `clean` otherwise. The thresholds are `violationLimit`, `cameraOutageSeconds` and `multiFaceSnapshots`.

**`Q6a`** — computed, never stored as the last word: recomputed on submit and whenever a violation lands.

**`Q6b`** — a stack failure is not a violation. `observed: false` is where that lives, and it is no reflection on the candidate.

**`Q3a`** — `null` and `0` are never conflated. The multi-face threshold counts snapshots whose `faceCount` is a **number greater than one**; a `null` is not evidence of anything, and every Phase 7 snapshot has `null`.

- [ ] **Step 1: Write the failing tests**

```ts
it("is clean with no events", () => {
  expect(integrityFor(base({}))).toEqual({ flag: "clean", observed: true });
});

it("is review on any violation", () => {
  expect(integrityFor(base({ events: [{ type: "window_blur" }] })).flag).toBe("review");
});

it("is high_risk at the violation limit", () => {
  expect(integrityFor(base({ events: Array(5).fill({ type: "window_blur" }) })).flag).toBe("high_risk");
});

it("is high_risk past the camera-outage threshold", () => {
  expect(integrityFor(base({ events: [
    { type: "camera_lost", detail: { outageMs: 130_000 } },
  ] })).flag).toBe("high_risk");
});

// Q3a — null is not evidence.
it("never reaches the multi-face threshold on Phase 7's null counts", () => {
  expect(integrityFor(base({ snapshots: Array(10).fill({ faceCount: null }) })).flag).toBe("clean");
});

it("reaches it on two snapshots with more than one face", () => {
  expect(integrityFor(base({
    snapshots: [{ faceCount: 2 }, { faceCount: 3 }, { faceCount: 1 }, { faceCount: null }],
  })).flag).toBe("high_risk");
});

// Q6b — a failure marks unobserved, not suspicious.
it("marks an attempt unobserved without flagging the candidate", () => {
  const r = integrityFor(base({ events: Array(20).fill({ type: "snapshot_failed" }) }));
  expect(r).toEqual({ flag: "clean", observed: false });
});

it("marks unobserved when far fewer snapshots arrived than the interval implies", () => {
  expect(integrityFor(base({ expectedSnapshots: 60, snapshots: Array(3).fill({ faceCount: null }) })).observed).toBe(false);
});
```

```ts
// Review Focus 5 — the two axes stay independent at the call site, not just in the schema.
it("leaves a scoring_blocked flag alone when integrity recomputes on submit", async () => {
  await forceScoringBlocked(attemptId);
  await submitManually(attemptCookie);
  const row = await attemptRow(attemptId);
  expect(row.flag).toBe("scoring_blocked");
  expect(row.integrityFlag).toBe("clean");
});

it("recomputes on every violation, not only on submit", async () => {
  await post("/api/v1/run/attempt/events", { events: [{ type: "window_blur", clientTs: 1 }] }, attemptCookie);
  expect((await attemptRow(attemptId)).integrityFlag).toBe("review");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/integrity.test.ts apps/api/test/run/integrity.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `integrityFor` and call it from both places**

`expectedSnapshots` comes from the resolved interval and the elapsed time, so "unobserved" means *the evidence is materially short of what was configured*, not *one upload failed*. The threshold for that shortfall is a constant in `integrity.ts` with its reasoning beside it, not a fourth organiser control (`Q6`'s ruling: three numbers, not a rule language).

- [ ] **Step 4: Run both suites and the whole API suite**

Run: `npx turbo run test --filter=@pariksha/api --filter=@pariksha/core`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/integrity.ts packages/core/test/integrity.test.ts apps/api/src apps/api/test
git commit -m "feat(core): the integrity flag, computed from the evidence and never from a failure"
```

---

## Done when

All four actions fire, each exactly once and never on a submitted attempt; a failure can never auto-submit or lock anybody; a locked candidate has an organiser-side route out that is audited, permissioned and workspace-scoped; the integrity flag is recomputed from events and snapshots without touching grading's column; and `AC-21` passes end to end with no hardware.
