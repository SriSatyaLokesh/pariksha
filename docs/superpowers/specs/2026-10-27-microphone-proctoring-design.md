# Phase 8.5: Microphone Proctoring & Candidate Device Check Design Specification

**Date:** 2026-10-27  
**Status:** In Review  
**Milestone:** Phase 8.5 (Proctoring: The Ear & Start Gate Device Check)  
**Parent Specs & PRD:** [`docs/ROADMAP.md`](../ROADMAP.md) § Phase 8.5, [`docs/PRD.md`](../PRD.md) § `P-06`, [`docs/superpowers/specs/2026-10-21-phase-7-proctoring-design.md`](2026-10-21-phase-7-proctoring-design.md), [`docs/superpowers/specs/2026-10-22-phase-8-results-design.md`](2026-10-22-phase-8-results-design.md)  
**Issues Tracked:** #209, #84, #264  

---

## 1. Intent & The Why

Exam proctoring environments need to detect suspicious ambient audio (e.g. whispering, verbal assistance, second-person collaboration) without invading student privacy or hoarding sensitive biometric recordings.

Conventional proctoring tools record raw audio streams, upload large multimedia files to vendor clouds, or run opaque proprietary speech recognition models. These approaches introduce severe data privacy liabilities (FERPA, GDPR), fail on low-bandwidth networks, and create immense infrastructure storage costs.

**Pariksha takes a radically privacy-preserving approach:**
- **Zero Audio Storage or Transmission:** No audio is ever recorded, stored, uploaded, or sent across the network (`P-06`).
- **In-Browser AudioWorklet Level Detection:** An `AudioWorkletProcessor` running on a dedicated audio rendering thread computes root-mean-square (RMS) energy in decibels ($O(1)$ circular buffer math).
- **Duration-Only Events on Falling Edge:** The candidate runtime emits only a single `noise_above_threshold` event on the falling edge of a threshold crossing. The event detail contains **only** `{ durationMs: number }`.
- **Fail-Open Failure Contract (`AG1`):** While a camera is hard-required when configured, a missing, denied, or disconnected microphone **never blocks an exam**. If the mic is unavailable, proctoring degrades gracefully and the candidate is unhindered.
- **Granular Test Builder Preferences:** Test builders can configure their proctoring profile with only camera, only microphone, or both camera and microphone.
- **Pre-Exam Candidate Device Check:** Candidates can test their camera and microphone on the landing start gate with interactive visual feedback before starting the exam.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Core Proctoring Resolution:**
  - Remove hardcoded `requireMicrophone: false` in `packages/core/src/proctoring.ts` (`resolveProctoring`).
  - Support independent toggle and overrides for `require_microphone` across profiles (`off`, `standard`, `strict`).
  - Generate candidate-facing disclosure in `proctoringRequirements`: *"Your microphone is on. Noise level is monitored; no audio is recorded or stored."*
  - Pin the exact event detail shape for `noise_above_threshold`: `{ durationMs: number }`.
  - Maintain the rule that `noise_above_threshold` is neither a `VIOLATION_EVENTS` nor `FAILURE_EVENTS` member (it is logged on the attempt timeline, but does not count toward auto-lock or auto-submit).
- **Audio Worklet & Noise Monitor:**
  - Implement `apps/web/public/noise-worklet.js` using `AudioWorkletProcessor` with $O(1)$ circular buffer RMS dB computation and throttled level messaging.
  - Implement `apps/web/src/lib/noise.ts` (`monitorNoise`) to manage `AudioContext`, load the worklet, and track duration crossings.
  - Silent degradation on audio track disconnect (`ended`, unplugged headset) without throwing.
- **Unified Media Acquisition with Fail-Open Fallback:**
  - Build `acquireMedia(opts: { video?: boolean; audio?: boolean })` supporting all four combinations: video only, audio only, both video and audio, or neither.
  - For tests requiring both video and audio, request both simultaneously via `getUserMedia({ video: true, audio: true })`. If audio permission is denied or absent, automatically fallback to video-only so the candidate can still proceed (`AG1`).
- **Test Builder Proctoring Panel:**
  - Re-enable the `require_microphone` checkbox in `apps/web/src/components/testbuilder/ProctoringPanel.tsx` with honest helper copy.
  - Re-point the disabled `face_check` toggle away from Phase 8 to a dedicated backlog issue (Issue #264) due to CSP constraints (`'wasm-unsafe-eval'`).
- **Candidate Landing & Start Gate Device Check:**
  - Update `ExamLanding` and `deviceReport` in `apps/web/src/routes/exam.tsx` to reflect active requirements (camera, microphone, or both).
  - In "Check my device", provide visual feedback for microphone: a responsive ambient noise level meter showing sound responsiveness.
  - Start gate enforcement: if camera is required, absence/denial blocks start; if microphone is required, denial permits start with a fail-open informational note.
- **Candidate Exam Runtime (`ProctoringLayer`):**
  - Mount `monitorNoise` when `resolved.requireMicrophone && audioStream`.
  - Enqueue `noise_above_threshold` events to `proctoringQueue`.
  - Safely terminate audio context and detach listeners on unmount.
- **Documentation & Invariants:**
  - Reword `docs/PRD.md` `P-06` to *"no audio is ever recorded or stored"*.
  - Create `docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md`.
  - Ensure all `apps/web/test/exam/no-recording.test.ts` scans (`AG2`/`AG3`) remain green and forbid `MediaRecorder` or raw `AudioBuffer`.

### Non-Goals
- Audio recording or playback of candidate audio.
- Speech-to-text, natural language processing, or audio content transcription.
- Voice biometric identification or acoustic direction-of-arrival triangulation.
- Automatic exam termination or locking based on noise events.

### Anti-Goals
- **No Recorded Audio Kept Anywhere:** Never construct a `MediaRecorder`, never hold an `AudioBuffer`, never invoke `getChannelData()`, and never transmit raw audio samples to the API.
- **No Blocking Answering on Audio Faults (`AG1`):** A candidate must never be prevented from taking, continuing, or submitting a test due to a microphone permission denial, worklet initialization failure, or mid-attempt device disconnection.
- **No CSP Degradation:** Maintain strict Content Security Policy; never introduce `'unsafe-eval'` or `'wasm-unsafe-eval'`.

---

## 3. Constraints

- **Execution Safety & Ponytail Simplicity:** Use standard Web Audio API and native `AudioWorklet`. No third-party audio libraries, no external WASM binaries.
- **Permissions-Policy Header:** Update `Permissions-Policy` in `apps/web/public/_headers` and `apps/api/src/middleware/security.ts` from `microphone=()` to `microphone=(self)` so browsers permit `getUserMedia` audio capture on the application origin (and update `apps/api/test/health.test.ts`).
- **Visual Design:** Strictly follow Signal design tokens (`apps/web/src/styles/tokens.css`). No arbitrary hex colors or uncontained floating elements. Accessible contrast across dark and light grounds.
- **CI / Testing Strategy:** jsdom does not implement `AudioContext`, `AudioWorklet`, or `MediaStream`. All tests in Vitest will use explicit mock definitions installed via `Object.defineProperty`. Automated AST scans in `no-recording.test.ts` will verify no recording primitives are used in source or public worklets.
- **Git Commit Attribution:** All commits authored with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

## 4. Approaches Considered & Tradeoffs

During brainstorming, three architectural approaches were evaluated:

| Approach | Description | Tradeoffs | Verdict |
| :--- | :--- | :--- | :--- |
| **Approach 1: Decoupled `acquireMicrophone()` Primitive** | Create an independent `acquireMicrophone()` helper alongside `acquireCamera()`. Candidate landing and start gate execute separate queries. | **Pros:** Clear separation of concerns; simple unit tests.<br>**Cons:** Forces two separate browser permission dialogs on certain browsers, worsening candidate onboarding. | **Rejected** |
| **Approach 2: Single Combined `getUserMedia` Without Fallback** | Call `getUserMedia({ video, audio })` in one shot. | **Pros:** One permission prompt.<br>**Cons:** If a candidate denies microphone permission, the entire call rejects, inappropriately blocking the camera unless handled with retry logic. | **Rejected** |
| **Approach 3: Unified Media Helper with Automatic Fail-Open Fallback** | Unified `acquireMedia({ video: boolean, audio: boolean })` requesting both when required. If audio permission fails, it falls back to video-only so camera access succeeds and the exam starts unhindered (`AG1`). Supports camera-only, mic-only, both, or neither. | **Pros:** Best candidate UX (single prompt for both devices); strictly enforces `AG1` fail-open; granular support for test builder preferences.<br>**Cons:** Slightly more state handling during acquisition. | **Selected (User Choice)** |

---

## 5. Architectural Specification

```
                  ┌──────────────────────────────────────────────┐
                  │           Test Builder Preferences           │
                  │   (require_camera, require_microphone)       │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │         Candidate Landing & Start Gate        │
                  │  - Device check: Camera preview + VU Meter   │
                  │  - acquireMedia({ video, audio })            │
                  │  - Fail-Open audio fallback                  │
                  └──────────────────────┬───────────────────────┘
                                         │
                        MediaStream (Video + Audio tracks)
                                         │
                                         ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Candidate Exam Runtime (ProctoringLayer)                                               │
│                                                                                        │
│   Video Track ──────► cameraSampler (Interval Snapshots / Lens Covered Check)          │
│                                                                                        │
│   Audio Track ──────► AudioContext ──► AudioWorkletNode ("noise-level-processor")       │
│                                                   │                                    │
│                                              RMS dB Level (postMessage)                │
│                                                   ▼                                    │
│                                       monitorNoise (Main Thread)                       │
│                                                   │                                    │
│                                      Falling Edge Crossing Event                       │
│                                                   ▼                                    │
│                                  proctoringQueue.enqueue({                             │
│                                    type: "noise_above_threshold",                      │
│                                    detail: { durationMs: 1450 }                        │
│                                  })                                                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Core Proctoring Contract (`packages/core`)

1. **`resolveProctoring` and Profile Defaults:**
   `PROCTORING_DEFAULTS` retains `requireMicrophone: false` across `off`, `standard`, and `strict` profiles, allowing organizers to explicitly enable microphone proctoring via test builder preferences (`overrides.require_microphone = true`).
   Remove the hardcoded `requireMicrophone: false` override denial. Replace with:
   ```ts
   requireMicrophone: overrideOr(overrides, "require_microphone", defaults.requireMicrophone),
   ```
2. **`proctoringRequirements`:**
   When `resolved.requireMicrophone` is true, append:
   ```ts
   lines.push("Your microphone is on. Noise level is monitored; no audio is recorded or stored.");
   ```
3. **Event Schema & Non-Punitive Classification:**
   `noise_above_threshold` is emitted with detail:
   ```ts
   export interface NoiseAboveThresholdDetail {
     durationMs: number;
   }
   export function detailFor(durationMs: number): NoiseAboveThresholdDetail {
     return { durationMs };
   }
   ```
   `isViolation("noise_above_threshold")` remains `false`. It is neither in `VIOLATION_EVENTS` nor `FAILURE_EVENTS`.

### 5.2 Audio Worklet (`apps/web/public/noise-worklet.js`)

- Runs on the Web Audio rendering thread as an `AudioWorkletProcessor`.
- Computes running sum of squares $O(1)$ per sample via circular buffer of size $N = \text{round}(\text{windowMs} \times \text{sampleRate} / 1000)$.
- Calculates $\text{RMS} = \sqrt{\sum x^2 / N}$, and converts to dBFS: $\text{level} = 20 \log_{10}(\text{RMS})$.
- Posts message `{ level }` at most once per window (default $200\,\text{ms}$) to avoid main thread event flooding.
- Retains zero audio buffers across lifetimes and constructs no `MediaRecorder` (`AG2`/`AG3`).

### 5.3 Noise Monitor (`apps/web/src/lib/noise.ts`)

- `monitorNoise(stream: MediaStream, opts: { thresholdDb: number; windowMs: number; onCrossing: (durationMs: number) => void }): { stop(): void } | null`
- Default constants: `DEFAULT_NOISE_THRESHOLD_DB = -40` (configurable), `DEFAULT_NOISE_WINDOW_MS = 200`.
- Maintains state:
  - If $\text{level} \ge \text{thresholdDb}$ and `aboveSince === null`: set `aboveSince = Date.now()`.
  - If $\text{level} < \text{thresholdDb}$ and `aboveSince !== null`: calculate `durationMs = Date.now() - aboveSince`, reset `aboveSince = null`, and call `opts.onCrossing(durationMs)`.
  - If `stop()` is called while a crossing is open: discard without emitting.
- Safe lifecycle: listens for `ended` on audio tracks; cleans up on unmount or track loss; returns `null` safely if `AudioContext` or `AudioWorklet` is unavailable.

### 5.4 Media Stream Acquisition (`apps/web/src/lib/media.ts`)

Unified acquisition function:
```ts
export interface MediaAcquireOptions {
  video?: boolean;
  audio?: boolean;
}

export type MediaAcquireResult =
  | { ok: true; stream: MediaStream; audioAvailable: boolean }
  | { ok: false; reason: "denied" | "absent" | "failed" };

export async function acquireMedia(options: MediaAcquireOptions): Promise<MediaAcquireResult>;
```
- If `video: true, audio: true`:
  - Try `navigator.mediaDevices.getUserMedia({ video: true, audio: true })`.
  - If successful: return `{ ok: true, stream, audioAvailable: true }`.
  - If failed with permission denial / missing audio: retry `navigator.mediaDevices.getUserMedia({ video: true })`. If video succeeds: return `{ ok: true, stream, audioAvailable: false }` (`AG1` fail-open). If video fails: return `{ ok: false, reason }`.
- If `video: true, audio: false`: calls `getUserMedia({ video: true })`.
- If `video: false, audio: true`:
  - Calls `getUserMedia({ audio: true })`. If denied: return `{ ok: false, reason: "denied" }` for the device check report, but candidate start gate does not prevent exam entry (`AG1`).
- Preserves existing `captureJpeg` and lens covered checks.

### 5.5 Candidate Landing & Start Gate Device Check (`apps/web/src/routes/exam.tsx`)

- Landing view inspects requirement sentences:
  - `requiresCamera(test)`
  - `requiresMicrophone(test)`
- "Check my device" keeps `deviceReport()` as a pure synchronous function evaluating screen, pointer, and browser environment.
- Interactive Media Diagnostic:
  - When the candidate opens the device check, local state initiates an interactive test matching active requirements (camera preview, audio VU meter, or both).
  - Audio VU meter uses a lightweight local `AudioContext` with standard `AnalyserNode` solely to update a level meter visualization, stopping all test tracks immediately when dismissed to release hardware.
  - If candidate device lacks mic or denies permission: marks microphone as unavailable with an informational warning ("Microphone not detected. You may still take the test."), but keeps Start enabled (`AG1`).
- On Start click (`startWith`):
  - Acquires media according to test requirements via `acquireMedia({ video: requiresCamera(test), audio: requiresMicrophone(test) })`.
  - If camera is required and denied: displays `CAMERA_GATE_MESSAGE` and blocks entry.
  - If microphone is required and denied/unavailable: proceeds to paper, passing `audioStream: null` (`AG1` fail-open).
- On Attempt Reload / Resume (`boot`):
  - If resumed paper has `requireCamera` or `requireMicrophone`, `boot` invokes `acquireMedia({ video: paper.proctoring.requireCamera, audio: paper.proctoring.requireMicrophone })`.
  - If camera is required and fails: sets `cameraUnavailable: true`, triggering the camera outage recovery flow.
  - If microphone is required and fails: does NOT set `cameraUnavailable: true`. The attempt resumes smoothly with audio proctoring silently degraded under `AG1`.

### 5.6 Candidate Exam Runtime (`ProctoringLayer.tsx`)

- Receives `stream: MediaStream | null` and `resolved: ResolvedProctoring`.
- When `resolved.requireMicrophone && stream`:
  - Calls `monitorNoise(stream, { thresholdDb: -40, windowMs: 200, onCrossing: (durationMs) => enqueueEvent("noise_above_threshold", { durationMs }) })`.
- Stops noise monitoring cleanly when unmounting or upon attempt submission.

### 5.7 Organiser Test Builder (`ProctoringPanel.tsx`)

- Re-enables the `require_microphone` checkbox.
- Organiser helper text: *"Monitors ambient noise level. No audio is ever recorded or stored."*
- Updates the `face_check` toggle: changes copy to cite Issue #264 instead of Phase 8.

### 5.8 Privacy Claim & ADR

- `docs/PRD.md` `P-06`: updated from *"no audio is ever recorded"* to *"no audio is ever recorded or stored"*.
- `docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md`: records the architecture, circular RMS math, zero-retention invariant, and `AG1` fail-open policy.

---

## 6. What's Left to the Builder

- Exact visual layout coordinates of the VU meter indicator on the device check modal/panel using existing Signal CSS classes (`.exam-device-meter`, etc.).
- Internal debounce smoothing constant for VU meter visual rendering (e.g. 50ms animation frame throttle).
- Test fixture mock setup for `AudioContext` and `AudioWorkletNode` in `noise.test.ts` and `proctoring-mic.test.tsx`.
