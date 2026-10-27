# Phase 8.5: Microphone Proctoring & Candidate Device Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement microphone-based noise proctoring ("The Ear"), candidate start-gate device verification with audio VU feedback, and fail-open degradation without recording or retaining any audio.

**Architecture:** An `AudioWorkletProcessor` computes running RMS decibels in $O(1)$ time on the audio rendering thread; a main-thread crossing detector in `apps/web/src/lib/noise.ts` emits a `noise_above_threshold` event on the falling edge containing only `{ durationMs: number }`. A unified media acquisition helper `acquireMedia` requests video and audio together with fail-open fallback for audio (`AG1`). Candidate landing supports interactive device checking for camera preview, microphone VU meter, or both according to test builder preferences.

**Tech Stack:** TypeScript (strict), Vitest + jsdom, Web Audio API (`AudioContext`, `AudioWorkletNode`), React / Preact.

**Spec:** [`../specs/2026-10-27-microphone-proctoring-design.md`](../specs/2026-10-27-microphone-proctoring-design.md)

---

## Global Constraints

- **AG1:** Proctoring stack failure never blocks answering. Denied or disconnected microphone permits the attempt to start and finish without interruption.
- **AG2/AG3:** No `MediaRecorder`, no retained `AudioBuffer`, and no `getChannelData()` in `apps/web/src/` or `apps/web/public/`. Guarded by automated AST scans in `apps/web/test/exam/no-recording.test.ts`.
- **K34:** The privacy claim update in `docs/PRD.md` (`P-06`: *"no audio is ever recorded or stored"*) and ADR 0012 must land in the same branch that first opens candidate audio streams.
- **Signal Design System:** All UI components in `apps/web` must use semantic Signal tokens (`tokens.css`). No arbitrary hex colors or uncontained layout shifts.
- **Ponytail Simplicity:** Native Web APIs only. Zero external audio libraries, zero WASM dependencies.
- **Git Commit Attribution:** All commits must be made with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

## Review Focus

1. **Mid-Attempt Headset Disconnect:** A candidate unplugs their USB microphone while taking the exam. The audio track ends. The noise monitor must cleanly detach listeners and stop without throwing into the exam runner.
2. **Falling Edge Boundary on Exam Submit:** A loud ambient noise event is ongoing when the candidate submits their exam paper. The crossing is still open (no falling edge). The monitor must safely drop the open crossing without delaying or corrupting submission.
3. **Permissions-Policy Header Enforcement:** A real browser blocks `getUserMedia({ audio: true })` if HTTP headers say `microphone=()`. Both `_headers` and `security.ts` must allow `microphone=(self)`.
4. **Partial Permission Grant at Start Gate:** A candidate allows the camera but denies microphone permission. `acquireMedia` must fall back to camera-only, allowing the test to start unhindered under `AG1`.
5. **Reload / Resume Without Microphone:** A candidate reloads an active test where microphone was enabled, but audio permission fails on reload. `boot()` must resume the paper without setting `cameraUnavailable`.

---

### Task 1: Core Proctoring Resolution, Detail Contract & Permissions Policy

**Files:**
- Modify: `packages/core/src/proctoring.ts`
- Modify: `apps/web/public/_headers`
- Modify: `apps/api/src/middleware/security.ts`
- Test: `packages/core/test/proctoring.test.ts`
- Test: `apps/api/test/health.test.ts`
- Test: `apps/api/test/run/landing.test.ts`

**Interfaces:**
- Consumes: `resolveProctoring`, `proctoringRequirements`, `PROCTORING_DEFAULTS`, `SECURITY_HEADERS`.
- Produces:
  ```ts
  export interface NoiseAboveThresholdDetail {
    durationMs: number;
  }
  export function detailFor(durationMs: number): NoiseAboveThresholdDetail;
  ```

- [ ] **Step 1: Write failing tests for core resolution and permissions policy**

In `packages/core/test/proctoring.test.ts`:
```ts
it("resolves require_microphone: true when explicitly overridden", () => {
  const resolved = resolveProctoring({ profile: "off", overrides: { require_microphone: true } });
  expect(resolved.requireMicrophone).toBe(true);
});

it("defaults requireMicrophone to false across off, standard, and strict profiles", () => {
  expect(resolveProctoring({ profile: "off" }).requireMicrophone).toBe(false);
  expect(resolveProctoring({ profile: "standard" }).requireMicrophone).toBe(false);
  expect(resolveProctoring({ profile: "strict" }).requireMicrophone).toBe(false);
});

it("emits the exact candidate microphone disclosure sentence", () => {
  const resolved = resolveProctoring({ overrides: { require_microphone: true } });
  expect(proctoringRequirements(resolved)).toContain(
    "Your microphone is on. Noise level is monitored; no audio is recorded or stored."
  );
});

it("serialises noise_above_threshold detail carrying only durationMs", () => {
  expect(detailFor(1250)).toEqual({ durationMs: 1250 });
  expect(JSON.parse(JSON.stringify(detailFor(1250)))).toEqual({ durationMs: 1250 });
});

it("keeps noise_above_threshold non-punitive (neither violation nor failure event)", () => {
  expect(isViolation("noise_above_threshold")).toBe(false);
  expect(VIOLATION_EVENTS.has("noise_above_threshold")).toBe(false);
  expect(FAILURE_EVENTS.has("noise_above_threshold")).toBe(false);
});
```

In `apps/api/test/health.test.ts`:
```ts
it("returns permissions-policy header permitting camera and microphone for self", async () => {
  const res = await app.request("/health");
  expect(res.headers.get("permissions-policy")).toContain("microphone=(self)");
});
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm --filter @pariksha/core test`
Expected: FAIL on `require_microphone` override resolution and `detailFor`.

Run: `pnpm --filter @pariksha/api test test/health.test.ts`
Expected: FAIL on `microphone=(self)`.

- [ ] **Step 3: Implement core changes and security headers**

In `packages/core/src/proctoring.ts`:
- Delete the hardcoded refusal `requireMicrophone: false`.
- Replace with `requireMicrophone: overrideOr(overrides, "require_microphone", defaults.requireMicrophone)`.
- In `proctoringRequirements`, append `"Your microphone is on. Noise level is monitored; no audio is recorded or stored."` when `resolved.requireMicrophone` is true.
- Export `NoiseAboveThresholdDetail` and `detailFor(durationMs: number)`.

In `apps/web/public/_headers` and `apps/api/src/middleware/security.ts`:
- Change `microphone=()` to `microphone=(self)` in `Permissions-Policy`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pariksha/core test`
Run: `pnpm --filter @pariksha/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proctoring.ts packages/core/test/proctoring.test.ts apps/web/public/_headers apps/api/src/middleware/security.ts apps/api/test/health.test.ts
git commit -m "feat(core,api): enable require_microphone resolution and microphone permissions policy (#209)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 2: Audio Worklet Processor & Noise Level Monitor

**Files:**
- Create: `apps/web/public/noise-worklet.js`
- Create: `apps/web/src/lib/noise.ts`
- Test: `apps/web/test/exam/noise.test.ts`
- Test: `apps/web/test/exam/no-recording.test.ts`

**Interfaces:**
- Consumes: Web Audio API (`AudioWorkletNode`, `AudioContext`, `MediaStream`).
- Produces:
  ```ts
  export function monitorNoise(
    stream: MediaStream,
    opts: {
      thresholdDb: number;
      windowMs: number;
      onCrossing: (durationMs: number) => void;
    }
  ): { stop(): void } | null;
  ```

- [ ] **Step 1: Write failing tests for monitorNoise**

In `apps/web/test/exam/noise.test.ts`:
Mock `AudioContext`, `AudioWorkletNode`, and `MediaStream` via `Object.defineProperty`.
Test:
1. Emits once per crossing on falling edge with duration.
2. Emits nothing while level remains above threshold.
3. Returns `null` when `AudioWorklet` is unavailable.
4. Review Focus 1: Does not throw when audio track ends mid-attempt.
5. Review Focus 2: Sends nothing for a crossing still open when `stop()` is invoked.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/noise.test.ts`
Expected: FAIL with `monitorNoise` not found.

- [ ] **Step 3: Implement `noise-worklet.js` and `noise.ts`**

- In `apps/web/public/noise-worklet.js`:
  Implement `NoiseLevelProcessor extends AudioWorkletProcessor`:
  - Circular buffer of size $N = \text{round}(\text{windowMs} \times \text{sampleRate} / 1000)$.
  - $O(1)$ sum of squares update: `sumSquares += sample * sample - outgoing * outgoing`.
  - Calculate RMS and `level = 20 * Math.log10(rms)`.
  - Post message `{ level }` at most once per window.
  - Zero `AudioBuffer` or `MediaRecorder` retained.

- In `apps/web/src/lib/noise.ts`:
  Implement `monitorNoise(stream, opts)`:
  - Check `window.AudioContext` and `context.audioWorklet`; return `null` if absent.
  - Load `/noise-worklet.js` via `context.audioWorklet.addModule()`.
  - Connect `MediaStreamSource` to `AudioWorkletNode`.
  - Maintain `aboveSince: number | null`.
  - On level transition from above to below `thresholdDb`, calculate `durationMs = Date.now() - aboveSince`, reset `aboveSince = null`, and call `opts.onCrossing(durationMs)`.
  - On `stop()`, disconnect nodes, close context, and detach `ended` track listeners. Discard unclosed crossings.

- [ ] **Step 4: Run tests and verify AST no-recording scans**

Run: `pnpm --filter @pariksha/web test test/exam/noise.test.ts`
Run: `pnpm --filter @pariksha/web test test/exam/no-recording.test.ts`
Expected: PASS all tests and zero `MediaRecorder` / `AudioBuffer` AST violations.

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/noise-worklet.js apps/web/src/lib/noise.ts apps/web/test/exam/noise.test.ts
git commit -m "feat(web): AudioWorklet noise monitor with falling-edge crossing detection (#209)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 3: Unified Media Acquisition with Fail-Open Fallback

**Files:**
- Modify: `apps/web/src/lib/camera.ts`
- Test: `apps/web/test/exam/media-acquisition.test.ts`

**Interfaces:**
- Consumes: `navigator.mediaDevices.getUserMedia`.
- Produces:
  ```ts
  export interface MediaAcquireOptions {
    video?: boolean;
    audio?: boolean;
  }

  export type MediaAcquireResult =
    | { ok: true; stream: MediaStream; audioAvailable: boolean }
    | { ok: false; reason: "denied" | "absent" | "failed" };

  export async function acquireMedia(options: MediaAcquireOptions): Promise<MediaAcquireResult>;
  export async function acquireCamera(): Promise<
    | { ok: true; stream: MediaStream }
    | { ok: false; reason: "denied" | "absent" | "failed" }
  >;
  ```

- [ ] **Step 1: Write failing tests for `acquireMedia`**

In `apps/web/test/exam/media-acquisition.test.ts`:
1. Requests only video when `options = { video: true, audio: false }`.
2. Requests only audio when `options = { video: false, audio: true }`.
3. Requests both video and audio when `options = { video: true, audio: true }`.
4. Review Focus 4: If both video and audio are requested and audio fails/denied, automatically retries video-only, returning `{ ok: true, stream, audioAvailable: false }` (`AG1` fail-open).
5. Returns `{ ok: false, reason: "denied" }` if video is required and denied.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/media-acquisition.test.ts`
Expected: FAIL with `acquireMedia` not defined.

- [ ] **Step 3: Implement `acquireMedia` in `apps/web/src/lib/camera.ts`**

- Add `acquireMedia(options: MediaAcquireOptions)`:
  - If `options.video && options.audio`: attempt joint `getUserMedia({ video: true, audio: true })`. If it fails with `NotAllowedError` / `NotFoundError`, fall back to `getUserMedia({ video: true })` and return `{ ok: true, stream, audioAvailable: false }`.
  - If `options.video && !options.audio`: call `getUserMedia({ video: true })`.
  - If `!options.video && options.audio`: call `getUserMedia({ audio: true })`.
  - If `!options.video && !options.audio`: return `{ ok: true, stream: new MediaStream(), audioAvailable: false }`.
- Re-implement `acquireCamera()` as a delegate calling `acquireMedia({ video: true, audio: false })` to maintain backward compatibility.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pariksha/web test test/exam/media-acquisition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/camera.ts apps/web/test/exam/media-acquisition.test.ts
git commit -m "feat(web): unified acquireMedia helper with fail-open audio fallback (#209)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 4: Candidate Landing, Start Gate Device Check & Attempt Resume

**Files:**
- Modify: `apps/web/src/routes/exam.tsx`
- Test: `apps/web/test/exam/camera-gate.test.tsx`
- Test: `apps/web/test/exam/mic-gate.test.tsx`
- Test: `apps/web/test/exam/landing.test.tsx`

**Interfaces:**
- Consumes: `acquireMedia`, `requiresCamera`, `requiresMicrophone`, `LandingPayload`.
- Produces:
  ```ts
  export function requiresMicrophone(test: LandingPayload): boolean;
  ```
  Candidate device test with camera preview and responsive microphone VU meter.
  Fail-open audio start in `startWith` and resume in `boot()`.

- [ ] **Step 1: Write failing tests for candidate mic gate and device check**

In `apps/web/test/exam/mic-gate.test.tsx`:
1. `requiresMicrophone(test)` returns true when proctoring requirements contain microphone text.
2. When test requires camera and microphone, clicking "Start" requests media for both.
3. If microphone is denied on a test requiring microphone, the exam **starts anyway** (`AG1` fail-open).
4. Review Focus 5: Attempt resume (`boot()`) reacquires required media without setting `cameraUnavailable` if microphone fails.
5. "Check my device" renders a responsive volume/VU indicator when `requiresMicrophone` is true.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/mic-gate.test.tsx`
Expected: FAIL on `requiresMicrophone` or mic fail-open assertions.

- [ ] **Step 3: Implement candidate landing and start gate updates in `apps/web/src/routes/exam.tsx`**

- Add helper:
  ```ts
  export function requiresMicrophone(test: LandingPayload): boolean {
    return test.proctoring.requirements.some((line) => /microphone/i.test(line));
  }
  ```
- In `ExamLanding`:
  - Add interactive device test panel in "Check my device":
    - Displays camera preview if `requiresCamera(test)`.
    - Displays microphone VU meter (using standard `AnalyserNode` animation) if `requiresMicrophone(test)`.
    - Stops preview tracks cleanly upon closing the device check.
- In `ExamApp.startWith`:
  - Call `acquireMedia({ video: requiresCamera(test), audio: requiresMicrophone(test) })`.
  - If camera required and `acquired.ok === false`: set `cameraError` and block entry.
  - If microphone required and audio unavailable: proceed to start the exam paper passing `audioStream: null` (`AG1`).
- In `ExamApp.boot` (resume active attempt):
  - Call `acquireMedia({ video: resumed.proctoring?.requireCamera, audio: resumed.proctoring?.requireMicrophone })`.
  - If camera fails: set `cameraUnavailable: true`.
  - If microphone fails: do NOT set `cameraUnavailable: true`; pass available stream to `AttemptView`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pariksha/web test test/exam/mic-gate.test.tsx`
Run: `pnpm --filter @pariksha/web test test/exam/camera-gate.test.tsx`
Run: `pnpm --filter @pariksha/web test test/exam/landing.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/test/exam/mic-gate.test.tsx
git commit -m "feat(web): candidate microphone check on start gate and fail-open resume (#209)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 5: Candidate Exam Runtime (`ProctoringLayer`) & Test Builder (`ProctoringPanel`)

**Files:**
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Test: `apps/web/test/exam/proctoring-mic.test.tsx`
- Test: `apps/web/test/testbuilder/proctoring-panel.test.tsx`

**Interfaces:**
- Consumes: `monitorNoise`, `createProctoringQueue`, `ProctoringPanel`.
- Produces: active audio noise monitoring during exam, `require_microphone` checkbox enabled in test builder, `face_check` copy re-pointed off Phase 8 to Issue #264.

- [ ] **Step 1: Write failing tests for ProctoringLayer audio monitoring and ProctoringPanel**

In `apps/web/test/exam/proctoring-mic.test.tsx`:
1. Mounts `monitorNoise` when `resolved.requireMicrophone === true` and `stream` contains audio track.
2. Emits `noise_above_threshold` event into queue when crossing is observed.
3. Cleanly stops `monitorNoise` when component unmounts.

In `apps/web/test/testbuilder/proctoring-panel.test.tsx`:
1. `require_microphone` checkbox is enabled (not disabled).
2. `face_check` checkbox remains disabled and re-points to Issue #264 without naming Phase 8.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/proctoring-mic.test.tsx`
Run: `pnpm --filter @pariksha/web test test/testbuilder/proctoring-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement runtime monitoring and test builder panel updates**

In `apps/web/src/components/exam/ProctoringLayer.tsx`:
- Import `monitorNoise` from `../../lib/noise`.
- In `useEffect`, if `resolved.requireMicrophone && stream && stream.getAudioTracks().length > 0`:
  - Initialize `monitorNoise(stream, { thresholdDb: -40, windowMs: 200, onCrossing: (durationMs) => enqueueEvent("noise_above_threshold", { durationMs }) })`.
  - Clean up monitor on unmount.

In `apps/web/src/components/testbuilder/ProctoringPanel.tsx`:
- Enable `require_microphone` checkbox control with copy:
  *"Monitors ambient noise level. No audio is ever recorded or stored."*
- Update `face_check` helper copy to cite Issue #264 instead of Phase 8.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pariksha/web test test/exam/proctoring-mic.test.tsx`
Run: `pnpm --filter @pariksha/web test test/testbuilder/proctoring-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/ProctoringLayer.tsx apps/web/src/components/testbuilder/ProctoringPanel.tsx apps/web/test/exam/proctoring-mic.test.tsx apps/web/test/testbuilder/proctoring-panel.test.tsx
git commit -m "feat(web): wire noise proctoring in runner and enable test builder control (#209, #264)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 6: Privacy Claim (`P-06`), ADR 0012, and Whole-Branch Verification

**Files:**
- Modify: `docs/PRD.md`
- Create: `docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md`
- Test: whole monorepo verification (`turbo run test`, typecheck, lint)

**Interfaces:**
- Consumes: all completed components and tests.
- Produces: updated PRD and ADR 0012, passing monorepo test suite.

- [ ] **Step 1: Write failing documentation test for P-06**

In `apps/web/test/exam/no-recording.test.ts`:
Add assertion checking that `docs/PRD.md` contains `"no audio is ever recorded or stored"`.

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm --filter @pariksha/web test test/exam/no-recording.test.ts`
Expected: FAIL until PRD is updated.

- [ ] **Step 3: Update `docs/PRD.md` and create ADR 0012**

- In `docs/PRD.md` `P-06`:
  Change *"no audio is ever recorded"* to *"no audio is ever recorded or stored"*.
- In `docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md`:
  Document the architecture, circular RMS math, zero-retention invariant, and `AG1` fail-open policy.

- [ ] **Step 4: Run whole monorepo test suite**

Run: `npx turbo run test --force --concurrency=1`
Run: `pnpm run typecheck`
Run: `pnpm run lint`
Expected: All packages passing.

- [ ] **Step 5: Commit**

```bash
git add docs/PRD.md docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md apps/web/test/exam/no-recording.test.ts
git commit -m "docs(prd,adr): P-06 says 'or stored' and record ADR 0012 (K34, #209)" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```
