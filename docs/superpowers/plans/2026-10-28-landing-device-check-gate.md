# Landing Page Device & Proctoring Check Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce proctoring device and browser requirements upfront on the candidate landing check page so candidates with unsupported browsers or missing/denied cameras are stopped immediately before the access code/registration flow, allow required camera/microphone permissions inline, and reorder the landing page layout so primary actions sit above the requirements list.

**Architecture:** Update `deviceReport` in `apps/web/src/routes/exam.tsx` to hard-block unsupported browsers (`!browserOk`) whenever proctoring is active. Reorder `ExamLanding` DOM hierarchy so `.exam-landing-actions` sit above `.exam-landing-requirements`. Gated Start click activates inline device test when camera is required, keeping the candidate on the landing page until camera is allowed. Hand the active `MediaStream` forward from landing to `startWith` to prevent duplicate browser permission prompts.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright (Chromium with synthetic media stream), Signal Design System CSS tokens.

**Spec:** [`docs/superpowers/specs/2026-10-28-landing-device-check-gate-design.md`](file:///D:/professional/code/SriSatyaLokesh/pariksha/docs/superpowers/specs/2026-10-28-landing-device-check-gate-design.md)

## Global Constraints
- `AG1`: Fail-open degradation for non-blocking proctoring (microphone noise monitoring degrades with warning; camera and desktop-only strictly block).
- `P-06`/`AG2`/`AG3`: Zero audio or continuous video recording or storage; ephemeral on-device analysis only.
- WCAG 2.5.3: Accessible names are supersets of visible button labels (`Start <TestName>`).
- Live regions mounted from first render (`role="status"`, `aria-describedby="exam-device-blocked"`).
- Git author constraint: `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

## Review Focus
1. **Unrecognized or Unsupported Browser Under Proctoring**: `deviceReport` must set `refused: true` and announce a clear browser refusal message; Start button must be disabled.
2. **Layout Order**: `.exam-landing-actions` ("Check my device", "Start", "See my result") must precede `.exam-landing-requirements` in the landing body.
3. **Unverified Camera on Start Click**: When `require_camera: true` and no active camera stream is verified, clicking "Start" must NOT transition to `/register`. It must activate device check on the landing page and keep candidate on landing until camera is allowed.
4. **Camera Denied on Device Check**: Candidate remains on landing page with `cameraNotice` and instructions; Start stays blocked.
5. **No Duplicate Prompts**: Active stream verified on landing is retained and handed to `startWith`, eliminating redundant `getUserMedia` calls.

---

### Task 1: `deviceReport` Browser Enforcement & Refusal Messaging

**Files:**
- Modify: `apps/web/src/routes/exam.tsx:128-186` (`deviceReport`), `540-545` (`exam-device-blocked`)
- Test: `apps/web/test/exam/device-gate.test.tsx`

**Interfaces:**
- Consumes: `ResolvedProctoring`, `anyProctoringControlActive`
- Produces: `deviceReport(resolved: ResolvedProctoring): { ok: boolean; refused: boolean; refusedReason?: "desktop" | "browser" | null; findings: DeviceFinding[] }`

- [x] **Step 1: Write the failing tests in `device-gate.test.tsx`**

Add tests proving that:
- When any proctoring control is active and `browserName(userAgent)` is `null`, `deviceReport(resolved).refused` is `true`.
- When proctoring is `off` and `browserName(userAgent)` is `null`, `deviceReport(resolved).refused` is `false` (honesty without refusal).
- The refusal reason distinguishes between `"desktop"` and `"browser"`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/device-gate.test.tsx`
Expected: FAIL due to unsupported browser not setting `refused: true`.

- [x] **Step 3: Implement browser refusal in `deviceReport` and `ExamLanding`**

In `apps/web/src/routes/exam.tsx`:
```ts
const anyControlActive = anyProctoringControlActive(resolved);
const screenOk = width >= MIN_WIDTH;
const pointerOk = finePointer;
const browserOk = browser !== null;

const desktopBlocked = resolved.desktopOnly && (!screenOk || !pointerOk || isMobileUA);
const browserBlocked = anyControlActive && !browserOk;
const refused = desktopBlocked || browserBlocked;
```
Update `exam-device-blocked` live text to announce:
- If `browserBlocked`: `"This test requires a fully updated Chrome, Edge, Firefox or Safari. Please open this link in a supported browser."`
- Else if `desktopBlocked`: `"This test must be taken on a desktop or laptop, not a phone or tablet. This test needs a laptop or desktop computer."`

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/device-gate.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/test/exam/device-gate.test.tsx
git commit -m "feat(web): enforce supported browser in landing deviceReport when proctoring is active" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 2: Landing Layout Reordering (Actions Above Requirements)

**Files:**
- Modify: `apps/web/src/routes/exam.tsx:470-530` (`ExamLanding`)
- Test: `apps/web/test/exam/landing.test.tsx`

**Interfaces:**
- Consumes: `LandingPayload`
- Produces: Updated JSX layout where `.exam-landing-actions` is rendered before `.exam-landing-requirements`.

- [x] **Step 1: Write the failing test in `landing.test.tsx`**

Add a test verifying DOM node ordering:
`expect(actionsElement.compareDocumentPosition(requirementsElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();`
Proves the actions container appears before the requirements container in document order.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/landing.test.tsx`
Expected: FAIL because currently requirements precede actions.

- [x] **Step 3: Reorder JSX in `ExamLanding`**

In `apps/web/src/routes/exam.tsx`, move:
```tsx
<div className="exam-landing-actions">
  ...
</div>
```
above:
```tsx
{test.proctoring.requirements.length > 0 && (
  <section className="exam-landing-requirements">
    ...
  </section>
)}
```
Keep live regions (`exam-device-blocked`, `exam-camera-blocked`, `exam-device-report`, `exam-device-test-panel`) logically organized immediately after actions.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/landing.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/test/exam/landing.test.tsx
git commit -m "style(web): position landing call to actions above proctoring requirements" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 3: Inline Device Check Gate on Start Click

**Files:**
- Modify: `apps/web/src/routes/exam.tsx:370-520` (`ExamLanding`)
- Test: `apps/web/test/exam/camera-gate.test.tsx`

**Interfaces:**
- Consumes: `requiresCamera(test)`, `acquireMedia`, `onStart(stream: MediaStream | null)`
- Produces: Inline camera validation on Start click before delegating to `onStart`.

- [x] **Step 1: Write the failing tests in `camera-gate.test.tsx`**

Add tests proving that:
- When `requiresCamera(test)` is true and camera has not been checked, clicking "Start" calls `handleCheckDevice()` and opens the device test panel instead of triggering `onStart`.
- When camera permission is denied, candidate stays on landing page, `cameraNotice` is shown, and `onStart` is not called.
- When camera permission is allowed, `deviceMediaStream` is populated and a subsequent "Start" click invokes `onStart(stream)`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/camera-gate.test.tsx`
Expected: FAIL because Start currently navigates immediately to registration without checking camera.

- [x] **Step 3: Implement inline check gate in `ExamLanding`**

In `ExamLanding`:
```tsx
const handleStartClick = async () => {
  if (refused || test.state !== "open") return;
  const needCam = requiresCamera(test);
  const needMic = requiresMicrophone(test);

  if (needCam && (!deviceMediaStream || deviceMediaStream.getVideoTracks().length === 0)) {
    // Open device check and acquire media inline
    await handleCheckDevice();
    return;
  }

  onStart(deviceMediaStream);
};
```
And wire `<button className="exam-start" onClick={handleStartClick}>`.
If `deviceMediaStream` failed acquisition, keep the device preview panel open and display `cameraNotice`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/camera-gate.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/test/exam/camera-gate.test.tsx
git commit -m "feat(web): gate Start button behind inline device check when camera is required" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 4: Stream Forwarding to Prevent Duplicate Permission Prompts

**Files:**
- Modify: `apps/web/src/routes/exam.tsx:1097-1230` (`ExamApp`, `startWith`)
- Test: `apps/web/test/exam/mic-gate.test.tsx`, `camera-gate.test.tsx`

**Interfaces:**
- Consumes: `landingMediaStream: MediaStream | null` from `ExamLanding`
- Produces: `startWith(registrationToken: string, test: LandingPayload, preAcquiredStream?: MediaStream | null)`

- [x] **Step 1: Write failing test in `camera-gate.test.tsx`**

Test that when `startWith` is called with an active `preAcquiredStream` containing valid tracks, `acquireMedia` is not invoked again and the existing stream is handed directly to the live attempt view.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/camera-gate.test.tsx`
Expected: FAIL because `startWith` currently calls `acquireMedia` unconditionally.

- [x] **Step 3: Implement stream preservation in `startWith` & `ExamApp`**

In `ExamApp`:
- Store `landingMediaStream` in state when `ExamLanding` passes it on `onStart(stream)`.
- In `startWith`:
```ts
let mediaStream = preAcquiredStream ?? landingMediaStream;
const hasValidVideo = !needCamera || (mediaStream && mediaStream.getVideoTracks().some(t => t.readyState === "live"));
const hasValidAudio = !needMicrophone || (mediaStream && mediaStream.getAudioTracks().some(t => t.readyState === "live"));

if (!hasValidVideo || !hasValidAudio) {
  const acquired = await acquireMedia({ video: needCamera, audio: needMicrophone });
  if (needCamera && !acquired.ok) {
    setCameraError(CAMERA_GATE_MESSAGE);
    setView({ kind: "landing", test });
    return;
  }
  if (acquired.ok) mediaStream = acquired.stream;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/camera-gate.test.tsx test/exam/mic-gate.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/test/exam/camera-gate.test.tsx
git commit -m "feat(web): reuse verified landing media stream across registration transition" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 5: End-to-End Browser Verification in Real Chromium

**Files:**
- Modify: `apps/web/e2e/measurement/microphone.spec.ts`
- Test: Run Playwright test suite against real Chromium with fake media devices.

**Interfaces:**
- Consumes: Full candidate journey in Playwright
- Produces: Automated e2e regression spec verifying upfront gating, layout order, and stream continuity.

- [ ] **Step 1: Update e2e tests in `microphone.spec.ts` to exercise upfront gating**

- Verify candidate landing actions are positioned above requirements.
- Verify clicking Start when camera is required triggers inline device check on landing page without navigating to `/register`.
- Verify passing check on landing page proceeds to access code and enters paper smoothly.

- [ ] **Step 2: Run Playwright tests**

Run: `$env:API_PORT="8888"; cd apps/web; npx playwright test e2e/first-run.spec.ts e2e/measurement/camera.spec.ts e2e/measurement/microphone.spec.ts`
Expected: All tests PASS in real Chromium.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/measurement/microphone.spec.ts
git commit -m "test(web): update e2e spec for landing device gate and actions reordering" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

- [ ] **Step 4: Push to PR #266 and confirm CI**

Push to `origin phase-8.5/microphone-proctoring` and verify all GitHub Actions pass.
