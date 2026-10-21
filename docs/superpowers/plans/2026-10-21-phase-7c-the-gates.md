# Phase 7c — The Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The controls that need no camera: device and browser gating, fullscreen, window-leave detection, copy/paste/right-click blocking, the watermark and extra-monitor detection — all reporting through one event ingest that the server counts.

**Architecture:** A `ProctoringLayer` wraps the runner inside `ExamApp`, subscribes to the browser events each control needs, and pushes into one buffer that flushes to `POST /api/v1/run/attempt/events`. The server calls the `appendEvents()` that has existed in `packages/db` since Phase 2 and answers with the authoritative violation count. Every path is written to degrade rather than throw (`AG1`), with an error boundary as the backstop. `deviceReport()` already exists in `exam.tsx` and is **extended** to refuse rather than joined by a second checker.

**Tech Stack:** Hono + TypeScript (strict), Preact/React, Vitest + Testing Library, Playwright, `axe`.

**Spec:** [`docs/superpowers/specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md) — `Q2`, `Q2a`, `Q2b`, `Q2c`, `Q7`, `Q7a`, `Q7b`, `Q7c`, `Q9`, `Q9b`, `Q9c`, `Q1a`.

**Depends on:** **7a** for `ResolvedProctoring`, `PROCTORING_EVENTS`, `VIOLATION_EVENTS` and `isViolation`. Independent of 7b.

**Rebased onto 6.5e (#203).** `exam.css` and `components/exam/` are **untouched** by the whole design pass after 6.5f, so every assumption here about the runtime still holds. `D8`'s frozen geometry is therefore frozen against the same bytes this plan was written against.

**Goals covered:** `G2` (the no-camera half) and `G3` (event ingest and violation counting).

## Global Constraints

Copied from the spec's §16 and §17. Every task's requirements implicitly include this section.

- **`AG1`** — a proctoring stack failure never blocks answering. Every signal path is `try`, and on anything at all, degrade. **No `throw` escapes a signal path into the runner.**
- **`AG4`** — proctoring code must not be able to crash the runner.
- **`AG5`** — never make a gate green by moving a bar.
- **`D1`'s accent rule** — the candidate's overlays, warnings and watermark take **voltage**, the runtime's accent. An accent may not cross grounds. Every new colour-setting selector takes a `SURFACE` entry in `contrast-usage.test.ts`.
- **`apps/web/test/css-chain.ts` is the one `@import` resolver**, shared by `theme.test.ts`, `contrast-usage.test.ts` and `signal-boundary.test.ts` (6.5b/6.5e). It **strips comments**, so a rule named only in prose cannot satisfy a scan.
- **A component's chain decides which stylesheet its rules live in** (`CHAINS` in `css-chain.ts`): `components/exam/` and `routes/exam.tsx` are the **candidate runtime** (`exam.css`); `components/testbuilder/`, `components/authoring/` and `components/organiser/` are the **organiser** (`admin.css` and its imports). Putting a shared control's rule in `primitives.css` is what caused **#201** — it reaches `admin.css` and `landing.css` and **not** `exam.css`.
- **The two grounds are selectors, not a guess**: dark is `:root`, light is `:root[data-theme="light"]` (`THEME_SELECTOR`). They are the **only** two selectors permitted to assign a semantic name, and `theme.test.ts` enforces it.
- **`SEMANTIC_NAMES` is a contract list.** Use the names that exist; adding one after a consuming plan has started is a change to three stylesheets and a gate, and 6.5b's own note says so.
- **`D8`'s frozen geometry** — nothing moves that a candidate's hand is already on. Overlays and the watermark sit **over** the paper; they do not reflow it.
- Every mounted route needs a **measured** `ROUTE_BUDGETS` entry and a `ROUTE_AUTH` declaration. `budget.test.ts` and `routeAuthorities()` read the live route table; `scrub-scan.test.ts` derives its endpoint list from `ROUTE_AUTH` and its count must be bumped deliberately.
- **An R2 binding operation is a subrequest** (`instrument.ts:38-40`). Budgets are **measured**, not assumed.
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- `no-hex-colors.test.ts` strips only `/* */` comments — issue references in CSS go in block comments.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-7c/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **The ingest route returning 500, or the network dropping, mid-attempt** — `AG1`'s central case. The buffer must not grow without bound, the runner must not re-render on every failure, and the candidate must see nothing. One `proctoring_unavailable` event is owed when the ingest comes back. Task 2.
2. **More than ten events in one flush** — `appendEvents()` caps at ten per request and documents the write budget it protects. Eleven events must become two requests, not one silently-truncated one. Task 1.
3. **A reload mid-attempt resetting the violation count** — `Q7a` exists because of this. The count the candidate sees comes from the server's response, and a fresh page must show the accumulated count, not 0. Task 2.
4. **`desktop_only` false on a phone** (`Q1a`) — fullscreen has no `requestFullscreen` on most iOS elements and `visibilitychange` fires on an incoming call. Every control must degrade to *not firing* rather than to a false violation, or an organiser who allowed phones auto-submits honest candidates. Task 4.
5. **The blocking overlay and a screen reader** — `Q2b`: announced, focus-trapped, and **not** escapable. `axe` does not test Escape, so the trap and the absent Escape handler each need a behavioural assertion. Task 4.

---

### Task 1: the event ingest

**Files:**
- Create: `apps/api/src/routes/proctoring.ts`
- Modify: `apps/api/src/app.ts` (mount, `ROUTE_AUTH`, `ROUTE_BUDGETS`)
- Modify: `apps/api/src/run/attempt.ts` (the `GET /api/v1/run/attempt` payload)
- Test: `apps/api/test/run/events.test.ts`, `apps/api/test/run/scrub-scan.test.ts`, `apps/api/test/budget.test.ts`

**Interfaces:**
- Consumes: `appendEvents(db, workspaceId, { attemptId, events, serverTs })` from `packages/db/src/repo/attempts.ts:356`, **unchanged**; `PROCTORING_EVENTS`, `isViolation` (7a).
- Produces:

```ts
// POST /api/v1/run/attempt/events — `attempt` authority
type EventsRequest = { events: { type: ProctoringEventType; detail?: unknown; clientTs: number }[] };
type EventsResponse = { violations: number; limit: number; action: ViolationAction };
```

and `GET /api/v1/run/attempt` gains `proctoring: ResolvedProctoring` and `violations: number`.

**`Q7`** — one route, taking an array, calling the writer that already exists. **Ten per request**, the cap `appendEvents` already documents. Ids are minted server-side as `evt_`; **no client id and no idempotency key** (`Q7`'s own ruling — an event is evidence, not an answer).

**`Q7a`** — the server counts. The violation count the candidate sees comes back in the response, because a client-side counter resets on reload.

**`Q7c`** — rate-limited through Phase 6 Task 4's limiter, and a **measured** budget.

- [ ] **Step 1: Write the failing tests**

```ts
it("writes events and answers with the authoritative count", async () => {
  const res = await post("/api/v1/run/attempt/events", {
    events: [{ type: "window_blur", detail: { durationMs: 4200 }, clientTs: 1 }],
  }, attemptCookie);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ violations: 1, limit: 5, action: "warn_then_flag" });
});

it("counts only violation types toward the figure", async () => {
  await post("/api/v1/run/attempt/events", { events: [
    { type: "fullscreen_exit", clientTs: 1 },
    { type: "fullscreen_restore", clientTs: 2 },
    { type: "snapshot_failed", clientTs: 3 },
  ] }, attemptCookie);
  const res = await get("/api/v1/run/attempt", attemptCookie);
  expect((await res.json()).violations).toBe(1);
});

// Review Focus 2 — the cap is real, not advisory.
it("refuses more than ten events in one request", async () => {
  const events = Array.from({ length: 11 }, (_, i) => ({ type: "window_blur" as const, clientTs: i }));
  const res = await post("/api/v1/run/attempt/events", { events }, attemptCookie);
  expect(res.status).toBe(400);
});

it("rejects an event type outside the closed set", async () => {
  const res = await post("/api/v1/run/attempt/events",
    { events: [{ type: "keylogger", clientTs: 1 }] }, attemptCookie);
  expect(res.status).toBe(400);
});

it("answers 401 without an attempt cookie", async () => {
  expect((await post("/api/v1/run/attempt/events", { events: [] })).status).toBe(401);
});

it("ships the resolved proctoring object on the attempt", async () => {
  const body = await (await get("/api/v1/run/attempt", attemptCookie)).json();
  expect(body.proctoring).toMatchObject({ requireFullscreen: true, faceCheck: false });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/test/run/events.test.ts`
Expected: FAIL — 404, the route is not mounted.

- [ ] **Step 3: Implement the route, and declare it in both tables**

`ROUTE_AUTH`: `"POST /api/v1/run/attempt/events": "attempt"`, with a comment naming the phase and task as the neighbouring entries do. `ROUTE_BUDGETS`: the **measured** figure — the attempt join plus the one batched insert. Validate `type` against `PROCTORING_EVENTS` and the array length against 10 before touching the database.

- [ ] **Step 4: Run the ingest, budget and scan suites**

Run: `npx vitest run apps/api/test/run/events.test.ts apps/api/test/budget.test.ts apps/api/test/run/scrub-scan.test.ts`
Expected: PASS. The scan's pinned endpoint count goes 15 → 16, changed deliberately with the new route named in the diff.

- [ ] **Step 5: Probe the guards (`Q10a`), then commit**

Three guards reach this route, and each is broken on purpose once to prove it can fail: declare the route in `ROUTE_AUTH` with no `ROUTE_BUDGETS` entry (expect `budget.test.ts` to fail), mount it without the `ROUTE_AUTH` line (expect `routeAuthorities()` to fail), and leave the scrub count at 15 (expect `scrub-scan.test.ts` to fail). Restore each and record all three probes in the ledger.

```bash
git add apps/api/src/routes/proctoring.ts apps/api/src/app.ts apps/api/src/run/attempt.ts apps/api/test
git commit -m "feat(api): one event ingest, counted server-side"
```

---

### Task 2: the signal layer that cannot break the runner

**Files:**
- Create: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Create: `apps/web/src/lib/proctoring-queue.ts`
- Modify: `apps/web/src/routes/exam.tsx`
- Test: `apps/web/test/exam/proctoring-queue.test.ts`, `apps/web/test/exam/proctoring-failopen.test.tsx`

**Interfaces:**
- Consumes: `EventsResponse` (Task 1), `ResolvedProctoring` (7a).
- Produces:

```ts
export function createProctoringQueue(opts: {
  send: (events: QueuedEvent[]) => Promise<EventsResponse>;
  onCount: (violations: number, limit: number, action: ViolationAction) => void;
  flushMs: number;
}): {
  push(type: ProctoringEventType, detail?: unknown): void;
  /** Violations that trigger an action flush now, not on the interval. */
  pushImmediate(type: ProctoringEventType, detail?: unknown): Promise<void>;
  stop(): void;
};
```

**`Q2`** — try, and on anything at all, degrade. **`Q2c`** — an error boundary around the layer is the backstop, not the plan.

**Ruling — the buffer is bounded and drops oldest.** A candidate with a dead network for twenty minutes must not accumulate an unbounded array; the queue holds at most 100 events and discards the oldest, recording one `proctoring_unavailable` when it next reaches the server. *Cost if wrong:* a long outage loses the middle of its own evidence. Keeping everything risks the tab, and `AG1` outranks completeness of evidence.

- [ ] **Step 1: Write the failing tests**

```ts
// Review Focus 2 — eleven events is two requests.
it("splits a flush larger than ten into separate requests", async () => {
  const send = vi.fn().mockResolvedValue({ violations: 0, limit: 5, action: "warn_only" });
  const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
  for (let i = 0; i < 11; i++) q.push("window_blur");
  await vi.advanceTimersByTimeAsync(20);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[0][0]).toHaveLength(10);
});

// Review Focus 1 — a failing ingest is silent and bounded.
it("keeps accepting pushes while every send rejects, and never exceeds 100 buffered", async () => {
  const send = vi.fn().mockRejectedValue(new Error("500"));
  const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
  for (let i = 0; i < 500; i++) q.push("window_blur");
  await vi.advanceTimersByTimeAsync(100);
  expect(q.buffered()).toBeLessThanOrEqual(100);
});

it("owes one proctoring_unavailable after an outage recovers", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("500"))
    .mockResolvedValue({ violations: 0, limit: 5, action: "warn_only" });
  const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
  q.push("window_blur");
  await vi.advanceTimersByTimeAsync(40);
  const types = send.mock.calls.at(-1)![0].map((e: QueuedEvent) => e.type);
  expect(types).toContain("proctoring_unavailable");
});
```

```tsx
// AG4 — the runner survives a signal path that throws.
it("keeps the paper answerable when the proctoring layer throws on mount", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(() => { throw new Error("boom"); });
  await openAttempt({ proctoring: strictResolved });
  await user.click(await screen.findByRole("radio", { name: /Option A/ }));
  expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked();
});

// Review Focus 3 — the count survives a reload.
it("shows the server's accumulated count after a remount", async () => {
  await openAttempt({ proctoring: strictResolved, violations: 3 });
  expect(await screen.findByText(/Warning 3 of 5/)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/proctoring-queue.test.ts apps/web/test/exam/proctoring-failopen.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the queue and mount the layer inside an error boundary**

The layer mounts **inside** `ExamApp`, wrapping the runner, so an error boundary around it cannot take the paper with it. `stop()` on unmount; no state update after unmount.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/exam/proctoring-queue.test.ts apps/web/test/exam/proctoring-failopen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/ProctoringLayer.tsx apps/web/src/lib/proctoring-queue.ts apps/web/src/routes/exam.tsx apps/web/test/exam
git commit -m "feat(web): the proctoring signal layer, bounded and fail-open"
```

---

### Task 3: the device and browser gate

**Files:**
- Modify: `apps/web/src/routes/exam.tsx:73-110`
- Modify: `apps/web/src/sections/signal/` (the hand-written Devices line, `Q9c`)
- Test: `apps/web/test/exam/device-gate.test.tsx`

**Interfaces:**
- Produces: `deviceReport()` extended to

```ts
export function deviceReport(resolved: ResolvedProctoring): {
  ok: boolean;
  refused: boolean;          // desktop_only is on AND this device fails it
  findings: DeviceFinding[];
};
```

**`Q9b`** — `exam.tsx:73` already ships a checker whose comment says Phase 7 refuses. This task extends **that** function rather than writing a second one over a different input set, which is the drift `Q1` exists to prevent.

**`Q9c`** — the landing page hand-writes "A laptop or desktop, with a mouse or trackpad" and `deviceReport` says "Touch-only devices are not supported." Under `Q1`'s supported configuration both are false. They read from the resolved object or they go.

**`AC-17`** is proved by a table test here, **both ways**, plus the owner's one-time real-device run (`Q10`).

- [ ] **Step 1: Write the failing tests**

```tsx
const SIGNATURES = [
  { name: "Android phone", width: 412, pointerFine: false, touchPoints: 5, ua: "…Android…Mobile…", mobile: true },
  { name: "iPhone", width: 390, pointerFine: false, touchPoints: 5, ua: "…iPhone…", mobile: true },
  { name: "iPad in desktop-mode Safari", width: 1024, pointerFine: false, touchPoints: 5, ua: "…Macintosh…", mobile: false },
  { name: "laptop", width: 1440, pointerFine: true, touchPoints: 0, ua: "…Macintosh…", mobile: false },
  { name: "touchscreen laptop", width: 1920, pointerFine: true, touchPoints: 10, ua: "…Windows NT…", mobile: false },
];

it.each(SIGNATURES)("refuses $name when desktop_only is on, except a real desktop", (sig) => {
  withDevice(sig, () => {
    const r = deviceReport({ ...offResolved, desktopOnly: true });
    expect(r.refused).toBe(!sig.name.includes("laptop"));
  });
});

// Review Focus 4 / Q1a — allowed means allowed, on every one of them.
it.each(SIGNATURES)("admits $name when desktop_only is off", (sig) => {
  withDevice(sig, () => {
    expect(deviceReport({ ...offResolved, desktopOnly: false }).refused).toBe(false);
  });
});

it("blocks the start button and explains, rather than failing silently", async () => {
  await openCandidateLanding({ proctoring: { profile: "strict", requirements: ["A laptop or desktop computer."] } }, { device: SIGNATURES[0] });
  expect(await screen.findByText(/This test needs a laptop or desktop computer\./)).toBeVisible();
  expect(screen.getByRole("button", { name: /Start/ })).toBeDisabled();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/device-gate.test.tsx`
Expected: FAIL — `deviceReport` takes no argument.

- [ ] **Step 3: Extend `deviceReport` and the browser check**

The desktop-mode iPad is caught by touch points on a wide viewport with no fine pointer — the case a user-agent string alone misses. `P-02`'s browser floor refuses with a message listing the supported browsers.

- [ ] **Step 4: Run to verify they pass, and the landing suite with them**

Run: `npx turbo run test --filter=@pariksha/web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/src/sections/signal apps/web/test/exam/device-gate.test.tsx
git commit -m "feat(web): the device gate refuses, and the copy stops promising otherwise"
```

---

### Task 4: fullscreen, window-leave, and the overlay

**Files:**
- Create: `apps/web/src/components/exam/ProctoringOverlay.tsx`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Modify: `apps/web/src/styles/exam.css`
- Test: `apps/web/test/exam/fullscreen.test.tsx`, `apps/web/e2e/proctoring.spec.ts`

**Interfaces:**
- Consumes: the queue's `push`/`pushImmediate` (Task 2).
- Produces: `ProctoringOverlay`, used again by 7d's camera block and 7e's lock.

**`P-03`** — the test starts only from a click that enters fullscreen; on exit an overlay hides the questions until it is restored, and **the timer keeps running**. **`P-04`** — `visibilitychange` and `blur` record when the candidate left and for how long; on return a modal shows "Leaving the test window is not allowed. Warning 2 of 5."

**`Q2a`** — the overlay hides questions and nothing else: the runner stays mounted, a typed answer is saved, the offline queue keeps working.

**`Q2b`** — `role="alertdialog"`, `aria-modal="true"`, focus moved and trapped, an accessible name stating the condition and the remedy, and **no Escape handler**.

- [ ] **Step 1: Write the failing tests**

```tsx
it("hides the questions on fullscreen exit and restores them", async () => {
  await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true } });
  fireEvent(document, new Event("fullscreenchange"));   // now out
  expect(await screen.findByRole("alertdialog")).toBeVisible();
  expect(screen.queryByRole("radio", { name: /Option A/ })).not.toBeVisible();
  await enterFullscreen();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByRole("radio", { name: /Option A/ })).toBeVisible();
});

// Q2a — the answer survives the overlay.
it("keeps a typed answer and the save queue alive behind the overlay", async () => {
  await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true } });
  await user.click(screen.getByRole("radio", { name: /Option A/ }));
  fireEvent(document, new Event("fullscreenchange"));
  await enterFullscreen();
  expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked();
});

it("names the count from the server on a window-leave warning", async () => {
  await openAttempt({ proctoring: strictResolved, violations: 1 });
  fireEvent(window, new Event("blur"));
  fireEvent(window, new Event("focus"));
  expect(await screen.findByText(/Leaving the test window is not allowed\. Warning 2 of 5\./)).toBeVisible();
});

// Review Focus 5 — announced, trapped, and not escapable.
it("traps focus in the overlay and ignores Escape", async () => {
  await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true } });
  fireEvent(document, new Event("fullscreenchange"));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAccessibleName(/fullscreen/i);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("alertdialog")).toBeVisible();
  await user.tab();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

// Review Focus 4 / Q1a — a phone must not manufacture violations.
it("does not fire a fullscreen violation where requestFullscreen is unavailable", async () => {
  withoutFullscreenApi(async () => {
    await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true }, desktopOnly: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/fullscreen.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the overlay and the two listeners**

`blur`/`focus` and `visibilitychange` record a duration; the warning text comes from the ingest response, never a local counter. Where `requestFullscreen` is absent, the control reports unavailable once and never fires (`Q1a`).

- [ ] **Step 4: Write the Playwright spec for `AC-18` and run both**

`apps/web/e2e/proctoring.spec.ts` drives real `fullscreenchange`, `visibilitychange` and `blur` and asserts the warning, the count and one event row with a duration.

Run: `npx vitest run apps/web/test/exam/fullscreen.test.tsx && npx playwright test apps/web/e2e/proctoring.spec.ts`
Expected: PASS

- [ ] **Step 5: Probe the focus trap (`Q10a`), then commit**

`axe` cannot see Escape or a trap. Remove the trap on purpose and confirm the behavioural assertion fails; add an Escape handler on purpose and confirm the other fails. Restore both and record the probes.

```bash
git add apps/web/src/components/exam apps/web/src/styles/exam.css apps/web/test/exam/fullscreen.test.tsx apps/web/e2e/proctoring.spec.ts
git commit -m "feat(web): fullscreen and window-leave, behind one overlay that cannot be dismissed"
```

---

### Task 5: copy, paste, right-click, the watermark and extra monitors

**Files:**
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Create: `apps/web/src/components/exam/Watermark.tsx`
- Modify: `apps/web/src/styles/exam.css`, `apps/web/test/contrast-usage.test.ts`
- Test: `apps/web/test/exam/watermark.test.tsx`, `apps/web/test/exam/blocking.test.tsx`

**Interfaces:**
- Consumes: the queue (Task 2), `ResolvedProctoring` (7a).

**`Q9`** — the watermark carries identity and the current time over the paper, `pointer-events: none`, **excluded from the accessibility tree**, never part of the copy buffer. It deters the photograph; it does not survive a DOM inspector, and nothing pretends otherwise. Copy/paste/right-click blocking is the same honesty: `preventDefault()` on three events and a recorded event.

**`P-08`** — extra monitors "where the browser exposes it". **Ruling — read, never prompt.** The Window Management permission prompt mid-exam is a `Q2` hazard and `P-08`'s wording does not require it; the check reads `window.screen.isExtended` where present and reports nothing where absent. *Cost if wrong:* a candidate who never granted the permission is not checked, and the organiser sees no event rather than a false negative they might read as a pass.

**`D8`** — the watermark sits over the paper and does not reflow it. **`D1`** — it takes voltage, and needs `SURFACE` entries.

- [ ] **Step 1: Write the failing tests**

```tsx
it("blocks copy, paste and the context menu, and records each", async () => {
  const sent = captureEvents();
  await openAttempt({ proctoring: { ...strictResolved, blockCopyPaste: true } });
  for (const [type, expected] of [["copy", "copy_blocked"], ["paste", "paste_blocked"], ["contextmenu", "contextmenu_blocked"]] as const) {
    const ev = new Event(type, { cancelable: true, bubbles: true });
    fireEvent(screen.getByRole("radio", { name: /Option A/ }), ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(sent()).toContain(expected);
  }
});

it("paints the watermark over the paper without reflowing it", async () => {
  const before = screen.getByRole("radio", { name: /Option A/ }).getBoundingClientRect();
  await openAttempt({ proctoring: { ...strictResolved, watermark: true } });
  const after = screen.getByRole("radio", { name: /Option A/ }).getBoundingClientRect();
  expect(after.top).toBe(before.top);
});

it("keeps the watermark out of the accessibility tree and out of the copy buffer", async () => {
  await openAttempt({ proctoring: { ...strictResolved, watermark: true } });
  const mark = document.querySelector("[data-watermark]")!;
  expect(mark).toHaveAttribute("aria-hidden", "true");
  expect(getComputedStyle(mark).pointerEvents).toBe("none");
  expect(getComputedStyle(mark).userSelect).toBe("none");
});

it("reports an extra monitor without ever requesting a permission", async () => {
  const getScreens = vi.fn();
  withScreens({ isExtended: true, getScreens }, async () => {
    const sent = captureEvents();
    await openAttempt({ proctoring: { ...strictResolved, extraMonitorCheck: true } });
    expect(sent()).toContain("extra_monitor");
    expect(getScreens).not.toHaveBeenCalled();
  });
});

it("reports nothing where the browser does not expose screens", async () => {
  withScreens(undefined, async () => {
    const sent = captureEvents();
    await openAttempt({ proctoring: { ...strictResolved, extraMonitorCheck: true } });
    expect(sent()).not.toContain("extra_monitor");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/watermark.test.tsx apps/web/test/exam/blocking.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the three blockers, the watermark and the monitor read**

- [ ] **Step 4: Run the full web suite with the contrast and axe gates**

Run: `npx turbo run test --filter=@pariksha/web`
Expected: PASS — including `contrast-usage.test.ts` with the watermark's entries on the runtime's grounds, and all 35 `axe` files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam apps/web/src/styles/exam.css apps/web/test
git commit -m "feat(web): copy blocking, the watermark and a monitor check that never prompts"
```

---

## Done when

Every no-camera control honours its resolved setting; one ingest carries them all and the server counts; a dead ingest is invisible to the candidate and bounded in memory; the overlay is announced, trapped and undismissable; a phone with `desktop_only` off manufactures no violations; and `budget`, `scrub-scan`, `contrast-usage` and the 35 `axe` files are green with no bar moved.
