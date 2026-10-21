# Phase 7d — The Eye Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The camera: the Strict start gate, the identity photo, interval and violation snapshots into private storage, the blocking overlay a lost camera raises — and the microphone that monitors level and records nothing.

**Architecture:** The browser POSTs each 320×240 JPEG to one `attempt`-authority route that calls the `StorageAdapter.put()` already in `packages/storage` (`Q4` — presigned PUT was costed and refused). The capture timer lives in `ProctoringLayer` from 7c and pushes failures through the same queue. A camera lost mid-attempt raises 7c's `ProctoringOverlay` and keeps it up **indefinitely** — the phase's one deliberate `AG1` exception. The microphone computes RMS in an `AudioWorklet` and emits one event on a threshold crossing; no audio is retained anywhere, enforced by a source-level scan rather than by intention.

**Tech Stack:** Hono + TypeScript (strict), Preact/React, Vitest + Testing Library, Playwright with a fake media stream, `@pariksha/storage`.

**Spec:** [`docs/superpowers/specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md) — `Q2`, `Q4`, `Q4a`–`Q4f`, `Q11a`, `Q11b`, `Q12`, `Q12a`, `Q12b`, `Q3` (pre-cut), `AG2`, `AG3`.

**Depends on:** **7a** for `ResolvedProctoring` and the event vocabulary; **7c** for the queue, the layer and `ProctoringOverlay`.

**Goals covered:** `G2` (the camera half) and `G3` (snapshot objects in private storage).

## Global Constraints

Copied from the spec's §16 and §17. Every task's requirements implicitly include this section.

- **`AG1`** — a proctoring stack failure never blocks answering. **`Q2`'s camera requirement is the single stated exception, and this plan is where it lives.** An upload failure, a worklet that will not load and a denied microphone are all failures: they degrade. A camera that is *required and absent* blocks.
- **`AG2`** — **no video and no audio is ever recorded or stored.** Not a guideline: a code path that could persist either is a defect whether or not it is reachable. No `MediaRecorder` anywhere in the tree.
- **`AG3`** — no biometric template. No embedding, landmark set, descriptor or voiceprint, in a table, in storage, in `localStorage`, or in an event's detail JSON.
- **`AG4`** — proctoring code must not be able to crash the runner. **`AG5`** — never make a gate green by moving a bar.
- **`Q3` is pre-cut** — `face_check` resolves false, `snapshot.faceCount` stays `null`, and nothing here loads a model or widens a CSP. The only CSP change in the phase is the `blob:` on `img-src` that `security.ts` already promises.
- **`D1`** — the candidate's overlays take voltage; every new colour-setting selector takes `SURFACE` entries. **`D8`** — frozen geometry; nothing moves that a hand is on.
- Every mounted route needs a **measured** `ROUTE_BUDGETS` entry and a `ROUTE_AUTH` declaration. **An R2 binding operation is a subrequest** (`instrument.ts:38-40`).
- `pnpm build` needs `SITE_URL`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-7d/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **An upload that succeeds after the row write fails, or a row that names an object never written** — `Q4f` orders them for a reason: Phase 8's review timeline cannot explain a row with no object, while an orphan object is sweepable by prefix. Task 1.
2. **A body larger than one JPEG, or a body that is not a JPEG** — `Q4b` and `AG2`. The POST path is the only one that *can* bound this (`Q4`'s own argument for existing), so it must actually do it: a content-type allowlist and a byte ceiling at the trust boundary, not downstream. Task 1.
3. **A camera that goes black rather than ending its track** — `P-05` names "stops, is unplugged or goes black". A track that stays `live` while every frame is empty is the case a `track.onended` listener alone misses, and it is the realistic failure for a covered lens. Task 3.
4. **A tab backgrounded for twenty minutes with an interval timer running** — browsers throttle timers in hidden tabs, so a naive `setInterval` under-counts and `AC-20`'s 55–65 window fails for an honest candidate who switched windows once. The capture schedule must be computed from wall-clock, not from tick count. Task 4.
5. **A microphone permission denied, or an `AudioWorklet` that will not load** — unlike the camera, this is a **failure** and must not block (`Q12`'s own ruling). The attempt proceeds, flagged, and the candidate sees nothing. Task 5.

---

### Task 1: the snapshot route

**Files:**
- Modify: `apps/api/src/routes/proctoring.ts` (7c created it)
- Modify: `apps/api/src/app.ts` (`ROUTE_AUTH`, `ROUTE_BUDGETS`)
- Modify: `packages/db/src/repo/attempts.ts`
- Test: `apps/api/test/run/snapshot.test.ts`, `apps/api/test/run/scrub-scan.test.ts`, `apps/api/test/storage/content-type-scan.test.ts`

**Interfaces:**
- Consumes: `StorageAdapter.put(key, body, { contentType })` and `assertKey` from `packages/storage`; `readBodyWithLimit` from `apps/api/src/routes/media.ts`; `scoped()` from `packages/db`.
- Produces:

```ts
// POST /api/v1/run/attempt/snapshot — `attempt` authority
// Body: the JPEG bytes. Query: ?reason=interval|violation|identity
type SnapshotResponse = { stored: true };

export type SnapshotReason = "interval" | "violation" | "identity";

export const recordSnapshot: Scoped<(input: {
  attemptId: string; storageKey: string; takenAt: number; reason: SnapshotReason;
}) => Promise<void>>;
```

**`Q4`** — the browser POSTs the JPEG; the Worker calls `put()`. No presigned PUT, no new credential, no CORS, no `connect-src` widening.

**`Q4a`** — the key is minted server-side from the attempt the cookie names and **carries no workspace id**: `snapshot/<attemptId>/<takenAt>-<reason>.jpg`. `scrub-scan`'s `INTERNAL` list refuses `wsp_` in any candidate-reachable response, and workspace scoping for Phase 8's retention job comes from the `snapshot` row's own `workspaceId` column.

**`Q4b`** — `image/jpeg` only, enforced. **`Q4e`** — the budget is **measured**: attempt join, `put`, row.

**`Q4f`** — write the row **after** the put succeeds.

- [ ] **Step 1: Write the failing tests**

```ts
it("stores a JPEG and writes the row, in that order", async () => {
  const res = await postBytes("/api/v1/run/attempt/snapshot?reason=interval", jpegFixture, attemptCookie);
  expect(res.status).toBe(200);
  const rows = await listSnapshots(attemptId);
  expect(rows).toHaveLength(1);
  expect(await storage.get(rows[0].storageKey)).not.toBeNull();
  expect(rows[0].faceCount).toBeNull();        // Q3 pre-cut
});

// Review Focus 1 — no row for an object that was never written.
it("writes no row when the put fails", async () => {
  storage.put = vi.fn().mockRejectedValue(new Error("R2 down"));
  const res = await postBytes("/api/v1/run/attempt/snapshot?reason=interval", jpegFixture, attemptCookie);
  expect(res.status).toBeGreaterThanOrEqual(500);
  expect(await listSnapshots(attemptId)).toHaveLength(0);
});

// Review Focus 2 — AG2 and Q4b, at the trust boundary.
it("refuses a non-JPEG content type", async () => {
  const res = await postBytes("/api/v1/run/attempt/snapshot?reason=interval", webmFixture, attemptCookie, "video/webm");
  expect(res.status).toBe(415);
});

it("refuses a body past the ceiling", async () => {
  const res = await postBytes("/api/v1/run/attempt/snapshot?reason=interval", new Uint8Array(300_000), attemptCookie);
  expect(res.status).toBe(413);
});

it("refuses bytes whose first three are not FF D8 FF", async () => {
  const res = await postBytes("/api/v1/run/attempt/snapshot?reason=interval", new Uint8Array([0, 1, 2, 3]), attemptCookie);
  expect(res.status).toBe(415);
});

// Q4a — the key never carries a workspace id, and the response carries no key at all.
it("mints a key with no workspace id and returns none", async () => {
  const res = await postBytes("/api/v1/run/attempt/snapshot?reason=interval", jpegFixture, attemptCookie);
  expect(JSON.stringify(await res.json())).not.toMatch(/wsp_|snapshot\//);
  expect((await listSnapshots(attemptId))[0].storageKey).not.toMatch(/wsp_/);
});

it("answers 401 without an attempt cookie", async () => {
  expect((await postBytes("/api/v1/run/attempt/snapshot?reason=interval", jpegFixture)).status).toBe(401);
});
```

```ts
// apps/api/test/storage/content-type-scan.test.ts — Q4c, mechanical.
it("every storage write reachable from the runtime declares an image content type", () => {
  for (const site of enumeratePutCallSites("apps/api/src")) {
    expect(site.contentType, `${site.file}:${site.line}`).toMatch(/^image\//);
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/test/run/snapshot.test.ts apps/api/test/storage/content-type-scan.test.ts`
Expected: FAIL — 404, and no scan exists.

- [ ] **Step 3: Implement the route, `recordSnapshot`, and the content-type scan**

`readBodyWithLimit` at a 256 KB ceiling — ten times the 25 KB `Tail.tsx` states, which is slack for a weak encoder and nowhere near a video. Declare both tables. Bump `scrub-scan`'s pinned count 16 → 17 deliberately.

- [ ] **Step 4: Run the snapshot, scan, budget and scrub suites**

Run: `npx vitest run apps/api/test/run/snapshot.test.ts apps/api/test/storage/content-type-scan.test.ts apps/api/test/budget.test.ts apps/api/test/run/scrub-scan.test.ts`
Expected: PASS

- [ ] **Step 5: Probe the guards (`Q10a`), then commit**

Break the content-type allowlist on purpose, confirm `content-type-scan.test.ts` fails, restore it, and record the probe in the ledger.

```bash
git add apps/api/src packages/db/src/repo/attempts.ts apps/api/test
git commit -m "feat(api): snapshots POST through the Worker into private storage"
```

---

### Task 2: the camera, the start gate and the identity photo

**Files:**
- Create: `apps/web/src/lib/camera.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`, `apps/web/src/routes/exam.tsx`
- Test: `apps/web/test/exam/camera-gate.test.tsx`

**Interfaces:**
- Produces:

```ts
export function acquireCamera(): Promise<
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: "denied" | "absent" | "failed" }
>;
export function captureJpeg(stream: MediaStream): Promise<Blob | null>;  // 320×240, ~25 KB
```

**`P-05` / `Q2a`** — in Strict the attempt **cannot start** without camera permission and a live frame. This is a start gate, not an answering gate: it fires before an attempt row exists, so no candidate is stranded mid-paper by it. **`Q1b`** already warned them on the start page.

**`P-06` / `Q11a`** — 320×240, about 25 KB, the figures `Tail.tsx:125` states publicly. Measured here, not assumed.

**Identity photo** — one capture at start, `?reason=identity`, before the first question.

- [ ] **Step 1: Write the failing tests**

```tsx
it("refuses to start a Strict attempt when the camera is denied", async () => {
  withCamera({ denied: true }, async () => {
    await openCandidateStart({ proctoring: { profile: "strict", requirements: ["A working camera…"] } });
    await user.click(screen.getByRole("button", { name: /Start/ }));
    expect(await screen.findByText(/This test needs a working camera/i)).toBeVisible();
    expect(screen.queryByRole("radio", { name: /Option A/ })).toBeNull();
  });
});

it("starts without a camera when it is not required", async () => {
  withCamera({ denied: true }, async () => {
    await openCandidateStart({ proctoring: { profile: "off", requirements: [] } });
    await user.click(screen.getByRole("button", { name: /Start/ }));
    expect(await screen.findByRole("radio", { name: /Option A/ })).toBeVisible();
  });
});

it("captures one identity photo before the first question", async () => {
  const uploads = captureUploads();
  withCamera({ frames: true }, async () => {
    await startStrictAttempt({ identityPhoto: true });
    await waitFor(() => expect(uploads()).toContainEqual(expect.objectContaining({ reason: "identity" })));
  });
});

it("encodes at 320×240 and under 60 KB", async () => {
  const blob = await captureJpeg(fakeStream({ width: 1280, height: 720 }));
  expect(blob!.type).toBe("image/jpeg");
  expect(blob!.size).toBeLessThan(60_000);
  expect(await dimensionsOf(blob!)).toEqual({ width: 320, height: 240 });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/camera-gate.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement `acquireCamera`, `captureJpeg` and the start gate**

`captureJpeg` draws the track onto a 320×240 canvas and calls `toBlob("image/jpeg", q)`; the quality that lands nearest 25 KB is **measured in this task and recorded in the ledger**, not guessed.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/exam/camera-gate.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/camera.ts apps/web/src/components/exam apps/web/src/routes/exam.tsx apps/web/test/exam/camera-gate.test.tsx
git commit -m "feat(web): the camera start gate and the identity photo"
```

---

### Task 3: a lost camera blocks, indefinitely

**Files:**
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Modify: `apps/web/src/lib/camera.ts`
- Test: `apps/web/test/exam/camera-loss.test.tsx`

**Interfaces:**
- Consumes: `ProctoringOverlay` (7c Task 4), the queue (7c Task 2).

**`P-05` / `AC-19` / `Q2`** — a camera that stops, is unplugged or goes black raises the overlay **within 5 s** and keeps it up until the camera is back. **Indefinitely.** A candidate whose webcam dies at minute 40 is blocked with the timer running, and their only recourse is 7e's unlock.

**This is the phase's one deliberate `AG1` exception.** The ruling, its cost and its three mitigations are in the spec's `Q2`; the implementer does not get to soften it, and `Q6` counts the outage so the organiser can see exactly what happened.

- [ ] **Step 1: Write the failing tests**

```tsx
it("raises the overlay within 5 s of the track ending, and keeps it up", async () => {
  await startStrictAttempt({});
  endCameraTrack();
  expect(await screen.findByRole("alertdialog", {}, { timeout: 5000 })).toHaveAccessibleName(/camera/i);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(screen.getByRole("alertdialog")).toBeVisible();
});

// Review Focus 3 — a covered lens, not an ended track.
it("raises the overlay when frames go black while the track stays live", async () => {
  await startStrictAttempt({});
  blackenCameraFrames();
  expect(await screen.findByRole("alertdialog", {}, { timeout: 5000 })).toBeVisible();
});

it("clears the overlay when the camera returns", async () => {
  await startStrictAttempt({});
  endCameraTrack();
  await screen.findByRole("alertdialog");
  restoreCamera();
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

// Q2a — the answer and the clock survive.
it("keeps the typed answer and lets the timer run behind the block", async () => {
  await startStrictAttempt({});
  await user.click(screen.getByRole("radio", { name: /Option A/ }));
  endCameraTrack();
  await screen.findByRole("alertdialog");
  restoreCamera();
  await waitFor(() => expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked());
});

it("records camera_lost and camera_restored with the outage duration", async () => {
  const sent = captureEvents();
  await startStrictAttempt({});
  endCameraTrack();
  await vi.advanceTimersByTimeAsync(30_000);
  restoreCamera();
  await waitFor(() => expect(sent()).toEqual(expect.arrayContaining(["camera_lost", "camera_restored"])));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/camera-loss.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the liveness check**

Two signals, because one is not enough (Review Focus 3): `track.onended`/`track.muted` for the unplug, and a periodic luminance sample of the captured frame for the covered lens. The sample rides the capture the timer already takes in Task 4 where one is due, and takes its own at most every 5 s where snapshots are off.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/exam/camera-loss.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam apps/web/src/lib/camera.ts apps/web/test/exam/camera-loss.test.tsx
git commit -m "feat(web): a lost camera blocks the paper, as P-05 requires"
```

---

### Task 4: the capture schedule

**Files:**
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Test: `apps/web/test/exam/snapshot-schedule.test.tsx`

**Interfaces:**
- Consumes: `captureJpeg` (Task 2), the queue (7c).

**`AC-20`** — a 60-minute Strict attempt stores **55–65** interval snapshots plus one per violation. **`Q11b`** — `snapshotIntervalSeconds: 0` means no capture timer at all: no uploads, no rows, not a capture whose upload is skipped.

**`Q4d`** — an upload failure is a stack failure: no snapshot, one `snapshot_failed` event, paper unaffected.

- [ ] **Step 1: Write the failing tests**

```tsx
it("stores 55-65 interval snapshots across a 60-minute attempt", async () => {
  const uploads = captureUploads();
  await startStrictAttempt({ snapshotIntervalSeconds: 60 });
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  const intervals = uploads().filter((u) => u.reason === "interval");
  expect(intervals.length).toBeGreaterThanOrEqual(55);
  expect(intervals.length).toBeLessThanOrEqual(65);
});

// Review Focus 4 — a throttled hidden tab must not under-count.
it("keeps the count inside the window when the tab is hidden for twenty minutes", async () => {
  const uploads = captureUploads();
  await startStrictAttempt({ snapshotIntervalSeconds: 60 });
  await hideTabFor(20 * 60 * 1000);          // timers throttled, wall clock advances
  await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
  expect(uploads().filter((u) => u.reason === "interval").length).toBeGreaterThanOrEqual(55);
});

// Q11b — off means no timer.
it("takes no snapshot at all when the interval is 0", async () => {
  const uploads = captureUploads();
  await startStrictAttempt({ snapshotIntervalSeconds: 0, identityPhoto: false });
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(uploads()).toHaveLength(0);
});

it("takes one extra snapshot per violation", async () => {
  const uploads = captureUploads();
  await startStrictAttempt({ snapshotIntervalSeconds: 60 });
  fireEvent(window, new Event("blur"));
  await waitFor(() => expect(uploads().filter((u) => u.reason === "violation")).toHaveLength(1));
});

// Q4d — a failing upload is silent.
it("records snapshot_failed and leaves the paper answerable when the upload 500s", async () => {
  failUploads();
  const sent = captureEvents();
  await startStrictAttempt({ snapshotIntervalSeconds: 60 });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sent()).toContain("snapshot_failed");
  await user.click(screen.getByRole("radio", { name: /Option A/ }));
  expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/snapshot-schedule.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implement the schedule from wall-clock**

Each tick compares `Date.now()` against the last capture's timestamp rather than counting ticks, so a throttled hidden tab catches up instead of under-counting. **One capture per due interval, never a backlog burst** — a tab hidden for twenty minutes takes one snapshot on return, not twenty.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/web/test/exam/snapshot-schedule.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/ProctoringLayer.tsx apps/web/test/exam/snapshot-schedule.test.tsx
git commit -m "feat(web): the snapshot schedule, from wall-clock rather than ticks"
```

---

### Task 5: the microphone monitors level, and the guards that prove it

**Files:**
- Create: `apps/web/src/lib/noise.ts`, `apps/web/public/noise-worklet.js`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Test: `apps/web/test/exam/microphone.test.tsx`, `apps/web/test/exam/no-recording.test.ts`

**Interfaces:**
- Produces:

```ts
export function monitorNoise(stream: MediaStream, opts: {
  thresholdDb: number; windowMs: number; onCrossing: (durationMs: number) => void;
}): { stop(): void } | null;   // null when AudioWorklet is unavailable — a failure, not a block
```

**`Q12`** — the permission lights the browser's own recording indicator for the whole attempt; the worklet computes RMS; the only thing kept is `noise_above_threshold` with a duration. The candidate is told the truth: *"Your microphone is on. Noise level is monitored; no audio is recorded or stored."*

**`Q12a`** — `AG2` and `AG3` bind this hardest. No `MediaRecorder`, no retained `AudioBuffer`, no voiceprint, no transcription, no raw samples in detail JSON.

**`Q12b`** — cheap or off: an `AudioWorklet` over a window, never an analyser polled on a frame loop.

**7a's ruling** — `noise_above_threshold` is neither a violation nor a failure. It never counts toward a limit or a flag.

- [ ] **Step 1: Write the failing tests**

```ts
// AG2, mechanical and permanent.
it("constructs no MediaRecorder anywhere in the web source", () => {
  expect(grepSource("apps/web/src", /\bMediaRecorder\b/)).toEqual([]);
});

it("persists no audio sample or buffer in any proctoring path", () => {
  expect(grepSource("apps/web/src", /AudioBuffer|getChannelData|\.wav|audio\//)).toEqual([]);
});

// AG3 / Q3b — the biometric guard ships now, against a field nothing can fill yet,
// so it is already in place when Phase 8 turns face counting on.
it("persists no biometric template anywhere", () => {
  expect(grepSource("apps/web/src", /landmark|embedding|descriptor|faceprint|voiceprint/i)).toEqual([]);
  expect(grepSource("apps/api/src", /landmark|embedding|descriptor|faceprint|voiceprint/i)).toEqual([]);
});
```

```tsx
it("emits one event with a duration when noise crosses the threshold", async () => {
  const sent = captureEvents();
  await startStrictAttempt({ requireMicrophone: true });
  await emitNoise({ db: -10, ms: 14_000 });
  await waitFor(() => expect(sent()).toContain("noise_above_threshold"));
  expect(lastDetail(sent, "noise_above_threshold")).toMatchObject({ durationMs: expect.any(Number) });
});

it("puts no samples in the event detail", async () => {
  const sent = captureEvents();
  await startStrictAttempt({ requireMicrophone: true });
  await emitNoise({ db: -10, ms: 14_000 });
  expect(JSON.stringify(lastDetail(sent, "noise_above_threshold"))).toMatch(/^\{"durationMs":\d+\}$/);
});

it("does not count noise toward the violation warning", async () => {
  await startStrictAttempt({ requireMicrophone: true, violationLimit: 2 });
  await emitNoise({ db: -10, ms: 14_000 });
  await emitNoise({ db: -10, ms: 14_000 });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

// Review Focus 5 — a denied mic is a failure, not a block.
it("starts and stays answerable when the microphone is denied", async () => {
  withMicrophone({ denied: true }, async () => {
    const sent = captureEvents();
    await startStrictAttempt({ requireMicrophone: true });
    expect(await screen.findByRole("radio", { name: /Option A/ })).toBeVisible();
    expect(sent()).toContain("proctoring_unavailable");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

it("stays answerable when AudioWorklet is unavailable", async () => {
  withoutAudioWorklet(async () => {
    await startStrictAttempt({ requireMicrophone: true });
    expect(await screen.findByRole("radio", { name: /Option A/ })).toBeVisible();
  });
});

it("tells the candidate exactly what the microphone does", async () => {
  await openCandidateStart({ proctoring: { profile: "strict", requirements: [
    "Your microphone is on. Noise level is monitored; no audio is recorded or stored.",
  ] } });
  expect(await screen.findByText(/no audio is recorded or stored/)).toBeVisible();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/web/test/exam/microphone.test.tsx apps/web/test/exam/no-recording.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the worklet, `monitorNoise`, and `P-06`'s reworded copy**

The worklet posts one RMS figure per window; the main thread holds a threshold-crossing state machine and emits on the **falling** edge with the duration. `monitorNoise` returns `null` rather than throwing where `AudioWorklet` is absent.

Reword `P-06` in `docs/PRD.md` from "no audio is ever recorded" to "no audio is ever recorded **or stored**", and write the ADR `Q12` requires — capture-without-retention is a different claim from no-capture, and the landing page's public promise must stay true.

- [ ] **Step 4: Run the microphone suite and the two `AG2` scans**

Run: `npx vitest run apps/web/test/exam/microphone.test.tsx apps/web/test/exam/no-recording.test.ts apps/api/test/storage/content-type-scan.test.ts`
Expected: PASS

- [ ] **Step 5: Probe both `AG2` guards (`Q10a`), then commit**

Add a `MediaRecorder` reference on purpose, confirm `no-recording.test.ts` fails, remove it; do the same for a stored `descriptor` against the biometric scan and for an `audio/` content type against the storage scan. Record all three probes in the ledger.

```bash
git add apps/web/src/lib/noise.ts apps/web/public/noise-worklet.js apps/web/src/components/exam apps/web/test/exam docs/PRD.md docs/adr
git commit -m "feat(web): the microphone monitors level and records nothing, provably"
```

---

## Done when

Strict refuses to start without a camera and blocks the paper when one is lost; snapshots reach private storage through the Worker with their content type and size enforced at the boundary; the schedule holds 55–65 across an hour even through a throttled tab; `snapshot_interval_seconds: 0` takes no picture at all; the microphone monitors level, says so truthfully, and is proved by two scans to record nothing; and every guard added here has been broken on purpose once.
