# Phase 8g — The Watchtower Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a proctor watch a live test, act on what they see, and read one attempt's whole story afterwards — without adding a single periodic request to any candidate's browser.

**Architecture:** The monitor polls from the **organiser's** browser every 15 s against one set-based read. Proctor actions write through `appendAudit` without exception. The broadcast rides the three candidate→server responses that already exist, because free-plan Workers have no WebSocket and a poll costs 18,000 requests per test. The per-attempt review page reads evidence through presigned URLs, which cost no subrequests.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Preact/React, Playwright.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K1`, `K3`, `K4`, `K9`, `K11`, `K12`, `K13`, `K37`, `K39`, `KG1`, `KG2`, `KG3`, `KG7`, `KG10`.

**Depends on:** **8a** (`listAttemptsForTest`, `0010`'s two `attempt` columns), **8b** (`latestVerdicts`, which Task 4's review page shows), **8d** (`fireWebhooks`, for `attempt.flagged`), and **7e must be merged**. 7e writes `attempt.integrity_flag` and `observed`, adds `0009`'s `locked_at`, and creates the product's **first two organiser attempt routes** — this plan replaces their **surface** and keeps their **endpoint**.

**Goals covered:** `G1`.

**Issues:** #89 (`P8.1`), #90 (`P8.2`), #91 (`P8.3`), #87 (`C-10`).

## Global Constraints

**8a's Global Constraints apply in full and are not repeated.** These are this plan's additions.

- **`attempts.monitor` and `attempts.read_evidence` are exercised here** (`attempts.grade` was 8b's). `ROUTE_AUTH` + `ROUTE_ACTIONS` + a measured budget on every route; each 403 with its 200 (`KG2`).
- **`KG7` — no new periodic candidate request.** A source scan over `apps/web/src` asserting the candidate runtime adds no `setInterval` that issues a `fetch`. This plan is the one most tempted to break it, and the scan is what makes `K11` and `K12` survive the next phase.
- **`KG10` — the monitor joins `apps/web/e2e/density.ts`'s `SURFACES`**, which has held a fixed four entries since 6.5e. It is a 300-row scanning list, the densest screen the product will have, and `D13`/`AG1` exists for exactly it. The review page does **not** join — it is a read-once detail view.
- **`K1`** — `snapshot.face_count` is `null` for every attempt in the product. `null` means **not counted**, never zero faces. The timeline and the review page must render it as "not counted".
- **7e's `E-R2` still binds:** the lock guard lives in `assertWritable`, not `attemptContext`. A 409 in the middleware breaks `GET /api/v1/run/attempt`, the one request a locked candidate's page must still make.
- Design: Signal ground for the organiser, **voltage** for the candidate's banner; an accent may not cross grounds; **two** `SURFACE` entries per colour-setting selector. `no-hex-colors.test.ts` forbids colour **words** outside block comments. `D8`'s frozen geometry — the banner sits **over** the runtime's layout and does not reflow it.
- Record each ruling in `.superpowers/sdd/phase-8g/progress.md`.

## Review Focus

1. **A proctor action on an attempt that was submitted a second earlier.** Extend time, force submit and reset all read a row that may have changed under them. Each must be a no-op with a clear answer rather than a write that resurrects a finished attempt or double-submits one. Task 2.
2. **The monitor's 15 s poll against a 300-candidate test, left open for three hours.** 720 organiser requests is fine; 720 × a per-attempt query is not. `KG3` measures it once, and the poll must not grow the per-tick cost as the cohort grows. Task 1.
3. **A broadcast set on an attempt that never contacts the server again.** `K12`'s known cost, and `K11`'s last-contact column is the mitigation. The send UI must say the message is pending until delivered, and the monitor must show that it has not been. Task 3.
4. **A reset creating a second attempt beyond `attempts_allowed`.** `K39` mints a new attempt; `timing.attempts_allowed` bounds how many a candidate may have. A reset must either raise the ceiling for that candidate or be refused — silently exceeding it makes `countedScore` average over an attempt the organiser never authorised. Task 2.
5. **An integrity recompute clobbering `attempt.flag: "scoring_blocked"`.** 7e's own Review Focus carried this and it recurs here because the review page can trigger one. `0008`'s comment explains the separation; the test proves it. Task 4.

---

### Task 1: The live monitor

**Files:**
- Create: `apps/api/src/routes/monitor.ts`
- Create: `apps/web/src/routes/monitor.tsx`
- Create: `apps/web/src/components/organiser/MonitorTable.tsx`
- Modify: `apps/api/src/app.ts`, `apps/web/e2e/density.ts` (`SURFACES` gains one)
- Test: `apps/api/test/monitor.test.ts`, `apps/web/test/organiser/monitor.test.tsx`, `apps/web/e2e/density.spec.ts`

**Interfaces:**
- Consumes: `listAttemptsForTest` (8a Task 7) — including its derived `lastContactAt`.
- Produces: `GET /api/v1/workspaces/:id/tests/:testId/monitor` — `workspace`, `attempts.monitor`.

**`R-01`'s columns:** counts (registered, in check, in progress, submitted, auto-submitted), and per candidate: set, time left, answered count, violations, **last contact** and camera status.

**`K11`** — the column is **last contact**, not "last heartbeat": `max(response.saved_at, event.server_ts, snapshot.taken_at)`, `—` when there is none. The screen **states which profiles produce a usable signal**, so a proctor is not told forty honest readers went dark. That sentence is not decoration; it is the whole mitigation for the ruling.

**Camera status** is derived from the latest of `camera_lost` / `camera_restored` in the event log, and is "not required" when `resolved.requireCamera` is false.

The 15 s refresh is a **poll from the organiser's browser**. `KG7` forbids adding one to the candidate's.

- [ ] **Step 1: Write the failing API tests**

Review Focus item 2 is the third.

```ts
it("returns the five counts and one row per attempt", async () => {
  const body = await getJson(monitorUrl, asProctor);
  expect(body.counts).toMatchObject({ registered: 300, inProgress: 212, submitted: 80 });
  expect(body.rows).toHaveLength(300);
});

it("reports last contact as null for an attempt that has never contacted the server", async () => {
  expect((await getJson(monitorUrl, asProctor)).rows.find(byId(quietAttempt)).lastContactAt).toBeNull();
});

it("costs the same number of statements for 300 candidates as for 3", async () => {
  const three = countingDeps(deps); await monitorFor(three.deps, testIdWith3);
  const many = countingDeps(deps);  await monitorFor(many.deps, testIdWith300);
  expect(many.counts().db).toBe(three.counts().db);
});

it("reports camera status as not required when the profile does not require one", async () => {
  expect((await getJson(monitorUrlStandard, asProctor)).rows[0].camera).toBe("not_required");
});

it("filters to flagged only", async () => {
  expect((await getJson(`${monitorUrl}?flagged=1`, asProctor)).rows.every((r) => r.integrityFlag !== "clean")).toBe(true);
});

it("filters to inactive beyond two minutes", async () => {
  expect((await getJson(`${monitorUrl}?inactive=1`, asProctor)).rows.map((r) => r.attemptId))
    .toEqual([quietAttempt]);
});

it("refuses an Author, who holds tests.edit and not attempts.monitor", async () => {
  expect((await get(monitorUrl, asAuthor)).status).toBe(403);
});

it("admits a Proctor — control for the test above", async () => {
  expect((await get(monitorUrl, asProctor)).status).toBe(200);
});

it("carries no answer key — KG1", async () => {
  expect(JSON.stringify(await getJson(monitorUrl, asProctor))).not.toContain(KEY_SENTINEL);
});
```

The third test is `KG3` in its strongest form: not "under the ceiling" but "does not grow with the cohort".

- [ ] **Step 2: Write the failing UI tests**

```ts
it("refreshes every 15 seconds", async () => {
  render(<Monitor {...props} />);
  await advance(15_000);
  expect(fetchSpy).toHaveBeenCalledTimes(2);
});

it("renders an em dash for an attempt with no contact", async () => {
  render(<Monitor {...props} rows={[quietRow]} />);
  expect(await screen.findByText("—")).toBeInTheDocument();
});

it("says which profiles produce a usable last-contact signal", () => {
  render(<Monitor {...props} />);
  expect(screen.getByText(/only Strict attempts report continuously/i)).toBeInTheDocument();
});

it("renders face count as not counted, never zero", () => {
  render(<Monitor {...props} rows={[rowWithNullFaceCount]} />);
  expect(screen.getByText(/not counted/)).toBeInTheDocument();
  expect(screen.queryByText(/^0 faces$/)).toBeNull();
});
```

- [ ] **Step 3: Run both and watch them fail, then implement**

- [ ] **Step 4: Add the monitor to the density registry (`KG10`)**

`apps/web/e2e/density.ts`'s `SURFACES` gains one entry, with a Playwright seed of 300 rows. jsdom cannot answer "how many rows fit" — `getBoundingClientRect` returns zeros there — so this is a real-Chromium gate.

- [ ] **Step 5: `axe`, plus the probe that proves `axe` works**

- [ ] **Step 6: Write `KG7` with its positive control**

```ts
it("the candidate runtime adds no polling fetch", () => {
  expect(intervalsIssuingFetch("apps/web/src/components/exam")).toEqual([]);
});

it("the scan catches one when planted — control", () => {
  expect(intervalsIssuingFetch(FIXTURE_WITH_ONE)).not.toEqual([]);
});
```

- [ ] **Step 7: Run everything**

Run: `cd apps/api && npx vitest run test/monitor.test.ts`
Run: `cd apps/web && npx vitest run --no-file-parallelism`
Run: `cd apps/web && npx playwright test density.spec.ts`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/monitor.ts apps/web/src/routes/monitor.tsx apps/web/src/components/organiser/MonitorTable.tsx apps/api/src/app.ts apps/web/e2e/density.ts apps/api/test apps/web/test apps/web/e2e
git commit -m "feat(api,web): the live monitor, derived last contact, in the density registry (K11, KG7, KG10, #89)"
```

---

### Task 2: The five proctor actions

**Files:**
- Create: `apps/api/src/routes/proctor-actions.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/web/src/components/organiser/MonitorTable.tsx`
- Test: `apps/api/test/proctor-actions.test.ts`

**Interfaces:**
- Consumes: 7e's unlock (reuse its **endpoint**, replace its surface), `submitAttempt`, `createAttempt`, `appendAudit`.
- Produces: `POST /api/v1/workspaces/:id/attempts/:attemptId/action` — `workspace`, `attempts.monitor`.

```ts
export type ProctorAction =
  | { kind: "extend_time"; minutes: number }
  | { kind: "unlock" }
  | { kind: "reset" }
  | { kind: "force_submit" }
  | { kind: "message"; text: string };
```

**`R-02`** — *"Every action is audit-logged."* No exception, including a no-op; a proctor pressing a button that did nothing is itself worth a record.

**`K39`** — **reset mints a new attempt against the same candidate and the same pinned version, and keeps the old one.** It deletes nothing. The confirmation says the earlier attempt is kept and remains visible.

- [ ] **Step 1: Write the failing tests**

Review Focus items 1 and 4 are the fifth and fourth.

```ts
it("extends the deadline", async () => {
  await act({ kind: "extend_time", minutes: 10 });
  expect((await getAttempt(db, wsp, attemptId))!.deadlineAt).toBe(originalDeadline + 600_000);
});

it("reset mints a new attempt and keeps the old one intact", async () => {
  const { newAttemptId } = await act({ kind: "reset" });
  expect(newAttemptId).not.toBe(attemptId);
  expect(await listResponses(db, wsp, attemptId)).toHaveLength(ORIGINAL_ANSWER_COUNT);
});

it("reset pins the same test version", async () => {
  const { newAttemptId } = await act({ kind: "reset" });
  expect((await getAttempt(db, wsp, newAttemptId))!.testVersionId)
    .toBe((await getAttempt(db, wsp, attemptId))!.testVersionId);
});

it("reset is refused when it would exceed attempts_allowed", async () => {
  await expect(act({ kind: "reset" }, atAttemptsCeiling)).rejects.toMatchObject({ status: 409 });
});

it("force submit on an already-submitted attempt is a no-op, not a second submission", async () => {
  await act({ kind: "force_submit" });
  const before = (await getAttempt(db, wsp, attemptId))!.submittedAt;
  await act({ kind: "force_submit" });
  expect((await getAttempt(db, wsp, attemptId))!.submittedAt).toBe(before);
});

it("audits every action, including one that changed nothing", async () => {
  await act({ kind: "force_submit" });
  await act({ kind: "force_submit" });
  expect((await listAudit(db, wsp)).filter((r) => r.action === "proctor.force_submit")).toHaveLength(2);
});

it("audits with ids and never a candidate's name — KG9", async () => {
  await act({ kind: "message", text: "Please fix your camera" });
  const row = (await listAudit(db, wsp)).at(-1)!;
  expect(JSON.stringify(row.detail)).not.toContain(CANDIDATE_EMAIL);
});

it("refuses a Viewer and admits a Proctor", async () => {
  expect((await post(actionUrl, body, asViewer)).status).toBe(403);
    expect((await post(actionUrl, body, asProctor)).status).toBe(200);
});
```

- [ ] **Step 2: Run and watch them fail, then implement**

Reset: refuse at the ceiling (Review Focus 4's conservative answer) and record the ruling. The alternative — raising `attempts_allowed` for one candidate — needs a per-candidate override the schema does not have.

- [ ] **Step 3: Build the action UI, with confirmations that name the consequence**

Reset's confirmation says plainly that the earlier attempt is **kept** (`K39`).

- [ ] **Step 4: Run both api configs**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/proctor-actions.ts apps/api/src/app.ts apps/web/src/components/organiser/MonitorTable.tsx apps/api/test/proctor-actions.test.ts
git commit -m "feat(api,web): the five proctor actions, all audited, reset non-destructive (K39, R-02, #90)"
```

---

### Task 3: The broadcast

**Files:**
- Modify: `apps/api/src/routes/proctoring.ts` (the events response carries a pending message)
- Modify: `apps/api/src/run/attempt.ts` (the answer response too)
- Modify: 7d's snapshot route (the third carrier)
- Create: `apps/web/src/components/exam/ProctorBanner.tsx`
- Modify: `apps/web/src/lib/proctoring-queue.ts` (surface the message to the layer)
- Test: `apps/api/test/broadcast.test.ts`, `apps/web/test/exam/proctor-banner.test.tsx`

**Interfaces:**
- Consumes: `0010`'s `attempt.proctor_message` and `.proctor_message_at` (8a Task 1).
- Produces: `{ message: string; messageAt: number }` on three existing responses, when one is pending.

**`K12`** — **no new route, no new request, no poll.** The events route already returns `{ violations, limit, action }` and the client already consumes it; one field joins it. Riding all three carriers is what makes it work for a candidate who is answering but not violating.

**`K13`** — one slot, overwritten, cleared on delivery in the **same statement the route is already issuing**.

The banner is *"the one voltage-bordered element inside a live attempt"* (`C-10`). `D8`: it sits **over** the layout and does not reflow it.

- [ ] **Step 1: Write the failing API tests**

```ts
it("carries a pending message on the events response", async () => {
  await setMessage(db, wsp, attemptId, "Please fix your camera", now);
  expect(await postEvents(attemptCookie, [])).toMatchObject({ message: "Please fix your camera" });
});

it("carries it on the answer response too", async () => {
  await setMessage(db, wsp, attemptId, "Please fix your camera", now);
  expect(await putAnswer(attemptCookie, answer)).toMatchObject({ message: "Please fix your camera" });
});

it("clears it on delivery without an extra statement", async () => {
  await setMessage(db, wsp, attemptId, "x", now);
  const counting = countingDeps(deps);
  await postEvents(attemptCookie, [], counting.deps);
  expect(counting.counts().db).toBeLessThanOrEqual(ROUTE_BUDGETS[EVENTS_PATH]);
  expect(await postEvents(attemptCookie, [])).not.toHaveProperty("message");
});

it("replaces an undelivered message rather than queueing a second", async () => {
  await setMessage(db, wsp, attemptId, "first", now);
  await setMessage(db, wsp, attemptId, "second", now + 1);
  expect((await postEvents(attemptCookie, [])).message).toBe("second");
});

it("omits the field entirely when none is pending", async () => {
  expect(await postEvents(attemptCookie, [])).not.toHaveProperty("message");
});
```

- [ ] **Step 2: Write the failing banner tests**

```ts
it("shows the banner when a response carries a message", async () => {
  render(<ExamApp {...props} />);
  await flushWith({ message: "Please fix your camera", messageAt: 1 });
  expect(await screen.findByText("Please fix your camera")).toBeInTheDocument();
});

it("does not reshow the same message on a later flush", async () => {
  render(<ExamApp {...props} />);
  await flushWith({ message: "x", messageAt: 1 });
  await dismiss();
  await flushWith({ message: undefined });
  expect(screen.queryByText("x")).toBeNull();
});

it("shows a repeat of the same text when messageAt is newer", async () => {
  render(<ExamApp {...props} />);
  await flushWith({ message: "x", messageAt: 1 }); await dismiss();
  await flushWith({ message: "x", messageAt: 2 });
  expect(await screen.findByText("x")).toBeInTheDocument();
});

it("does not reflow the paper — D8", async () => {
  // jsdom returns zeros from getBoundingClientRect, so this claim belongs in
  // apps/web/e2e/measurement/. Add it there, not here.
});
```

The fourth is deliberately a pointer, not a test: a geometry assertion in jsdom is `0 === 0` and passes whatever the layout does.

- [ ] **Step 3: Run, implement, add the e2e geometry spec**

`apps/web/e2e/measurement/` holds five specs for exactly this.

- [ ] **Step 4: Show pending state in the monitor (Review Focus 3)**

The send UI says the message is pending until delivered; the monitor's last-contact column is how a proctor sees whether it has landed. `K12` is explicit that the two features cover each other.

- [ ] **Step 5: Keep `KG7` green**

This task is the one most likely to break it. If the banner tempts you toward a poll, re-read `K12` — the answer is a third carrier, not a timer.

- [ ] **Step 6: Run everything, then commit**

```bash
git add apps/api/src/routes/proctoring.ts apps/api/src/run/attempt.ts apps/web/src/components/exam/ProctorBanner.tsx apps/web/src/lib/proctoring-queue.ts apps/api/test/broadcast.test.ts apps/web/test apps/web/e2e/measurement
git commit -m "feat(api,web): C-10's broadcast riding three existing responses, no new request (K12, K13, #87)"
```

---

### Task 4: The per-attempt review page

**Files:**
- Create: `apps/api/src/routes/attempt-review.ts`
- Create: `apps/web/src/routes/attempt.tsx`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/attempt-review.test.ts`, `apps/web/test/organiser/attempt-review.test.tsx`

**Interfaces:**
- Consumes: `listResponses`, `listAttemptsForTest` (8a), `latestVerdicts` (8b), `fireWebhooks` (8d, for `attempt.flagged`), `StorageAdapter.signedUrl`.
- Produces: `GET /api/v1/workspaces/:id/attempts/:attemptId/review` — `workspace`, `attempts.read_evidence`.

**`R-03`** — registration data, identity photo, snapshot timeline (flagged frames marked), event log, each answer against its key, and score by section.

This is the route that answers the question 7a left open: **where `observed: false` appears beyond the attempt row.** It appears here, as a stated gap in the timeline — the periods proctoring was not watching, which is exactly what 7d's one-capture-on-return ruling exists to preserve. A timeline that fills those gaps defeats it.

**`K3`/`K4`** — snapshots are served by presigned URL (600 s), never read through the Worker. **`K1`** — `face_count` renders as "not counted".

- [ ] **Step 1: Write the failing tests**

Review Focus item 5 is the fifth.

```ts
it("returns the answers with their keys for a reader holding attempts.read_evidence", async () => {
  const body = await getJson(reviewUrl, asReviewer);
  expect(body.answers[0]).toMatchObject({ questionId: "q1", correct: true, key: expect.anything() });
});

it("refuses a Viewer, who holds results.export and not attempts.read_evidence", async () => {
  expect((await get(reviewUrl, asViewer)).status).toBe(403);
});

it("serves snapshots by presigned URL and spends no storage subrequests", async () => {
  const counting = countingDeps(deps);
  await reviewFor(counting.deps, attemptWith60Snapshots);
  expect(counting.counts().storage).toBe(0);
});

it("marks the periods proctoring was not watching rather than filling them", async () => {
  const body = await getJson(reviewUrlWithGap, asReviewer);
  expect(body.timeline.find((t) => t.kind === "unobserved")).toBeDefined();
});

it("an integrity recompute never clears scoring_blocked", async () => {
  await setFlag(db, wsp, attemptId, "scoring_blocked");
  await recomputeIntegrity(deps, attemptId);
  expect((await getAttempt(db, wsp, attemptId))!.flag).toBe("scoring_blocked");
});

it("fires attempt.flagged when a recompute raises the flag", async () => {
  await recomputeIntegrity(deps, attemptId);
  expect(await countQueuedDeliveries(db, wsp, "attempt.flagged")).toBe(1);
});

it("renders face count as not counted, never 0", async () => {
  expect((await getJson(reviewUrl, asReviewer)).timeline[0].faceCount).toBeNull();
});
```

- [ ] **Step 2: Run and watch them fail, then implement**

`attempt.flagged` is `K37`'s queued event — it writes a `webhook_delivery` row and the drain sends it. The delivery path is 8d's; this is its one caller.

- [ ] **Step 3: Build the page**

Not in the density registry (`KG10`) — a read-once detail view, not a scanning list.

- [ ] **Step 4: `axe`, plus its probe. Run everything.**

Run: `npx turbo run test --force --concurrency=1`
Then: `cd apps/api && npx vitest run -c vitest.workers.config.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/attempt-review.ts apps/web/src/routes/attempt.tsx apps/api/src/app.ts apps/api/test/attempt-review.test.ts apps/web/test/organiser/attempt-review.test.tsx
git commit -m "feat(api,web): the per-attempt review page, with unobserved gaps shown as gaps (K1, K3, #91)"
```

---

## What the owner validates by hand

- **The monitor against a real cohort.** The pilot gate is 300 candidates; `KG3` proves the query shape, and only a real test proves the screen is readable at that size.
- **A broadcast to a candidate who is reading, not typing.** `K12`'s known cost. Confirm the message arrives on their next save or event, and that the monitor showed it pending until it did.
- **A reset, end to end.** `K39` says nothing is destroyed. Confirm the earlier attempt is still readable afterwards and that `countedScore` picks the one the organiser expects.

Each result goes in the roadmap's Phase 8 row, not only in a task report.
