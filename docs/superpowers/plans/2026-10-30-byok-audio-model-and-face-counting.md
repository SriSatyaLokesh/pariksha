# BYOK Audio Model, Native Face Counting & README Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver zero-cost native browser speech recognition, on-device native face counting, BYOK audio analysis (OpenAI Whisper & Gemini), and reconcile all unbuilt gaps in `README.md`.

**Architecture:** Multi-tiered proctoring pipeline: native browser `FaceDetector` for on-device face counting; native Web Speech API (`SpeechRecognition`) for $0 client-side speech detection; and server-side BYOK audio analysis (OpenAI Whisper + Gemini Audio) for cloud-verified acoustic proctoring without server cost.

**Tech Stack:** TypeScript, React, Web Speech API, Shape Detection API (`FaceDetector`), Web Audio API, Hono, Drizzle ORM, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-byok-audio-model-and-face-counting-design.md`

## Global Constraints

- **Ponytail Ladder:** Standard platform features first, zero external dependencies, zero WASM, zero CSP changes.
- **Fail-Open Invariant (`AG1`):** A missing device or unsupported browser API never blocks a candidate from taking the exam or costs them marks.
- **Zero Audio Storage Guarantee:** Ephemeral audio evaluation only; raw audio is never retained in D1 or R2 (ADR 0012).
- **Commit Author:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).

## Review Focus

1. `FaceDetector` missing in environment: gracefully returns `null`, never throws, and logs no false violation.
2. `SpeechRecognition` missing in environment: gracefully remains inactive, audio falling back to pure RMS level detector.
3. BYOK key absent or revoked: `/attempt/audio-check` cleanly answers `{ speechDetected: false, bypassed: true }` without throwing 500.
4. Attempt authorization: `/attempt/audio-check` verifies attempt access token and rate limits.
5. Audio payload size: `/attempt/audio-check` caps payload to 500 KB to enforce Cloudflare Worker memory limits.

---

### Task 1: Native On-Device Face Counting (`FaceDetector`)

**Files:**
- Create: `apps/web/src/lib/face.ts`
- Modify: `apps/web/src/lib/camera.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Modify: `packages/core/src/proctoring.ts`
- Test: `apps/web/test/exam/face-counting.test.ts`
- Test: `apps/web/test/testbuilder/proctoring-panel.test.tsx`

**Interfaces:**
- Produces: `detectFaces(image: CanvasImageSource): Promise<number | null>`
- Produces: `face_absent` and `multiple_faces` proctoring events

- [ ] **Step 1: Write failing unit test for `detectFaces`**
  - Verify `detectFaces` counts faces when `window.FaceDetector` is present, returns `null` when absent, and handles exceptions cleanly.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/web test face-counting`
- [ ] **Step 3: Implement `detectFaces` in `apps/web/src/lib/face.ts`**
  - Use `window.FaceDetector` with `{ maxDetectedFaces: 5, fastMode: true }`.
  - Fall open if undefined or on error.
- [ ] **Step 4: Wire face counting into `ProctoringLayer.tsx` and enable `face_check` in `ProctoringPanel.tsx`**
  - Enable `resolveProctoring` to accept `face_check: true`.
  - Enable the checkbox in `ProctoringPanel.tsx` with clear label and help text.
- [ ] **Step 5: Run tests to verify they pass**
  - Run: `pnpm --filter @pariksha/web test face-counting` and `pnpm --filter @pariksha/web test proctoring-panel`
- [ ] **Step 6: Commit**
  - Commit: `feat(web): native on-device face counting via Shape Detection API (#264)`

---

### Task 2: Free Browser-Native Speech Recognition ($0 Cost)

**Files:**
- Create: `apps/web/src/lib/speech.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Test: `apps/web/test/exam/speech-recognition.test.ts`

**Interfaces:**
- Produces: `startSpeechRecognition(onSpeech: (transcript: string) => void): () => void`
- Produces: `speech_detected` proctoring event

- [ ] **Step 1: Write failing unit test for `startSpeechRecognition`**
  - Test instantiation with `SpeechRecognition` or `webkitSpeechRecognition`.
  - Test event callback when speech is transcribed.
  - Test clean teardown on abort/unmount.
  - Test fail-open when API is absent.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/web test speech-recognition`
- [ ] **Step 3: Implement `startSpeechRecognition` in `apps/web/src/lib/speech.ts`**
  - Native standard `SpeechRecognition` / `webkitSpeechRecognition`.
- [ ] **Step 4: Wire speech detection into `ProctoringLayer.tsx`**
  - Emit `speech_detected` event to queue with transcript snippet.
- [ ] **Step 5: Run test to verify it passes**
  - Run: `pnpm --filter @pariksha/web test speech-recognition`
- [ ] **Step 6: Commit**
  - Commit: `feat(web): browser-native speech detection via Web Speech API`

---

### Task 3: Server-Side BYOK Audio Model (OpenAI Whisper & Gemini Audio)

**Files:**
- Create: `apps/api/src/byok/audio.ts`
- Modify: `apps/api/src/byok/types.ts`
- Modify: `apps/api/src/routes/run.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/byok/audio.test.ts`
- Test: `apps/api/test/run/audio-check.test.ts`

**Interfaces:**
- Produces: `evaluateByokAudio(deps, workspaceId, audioBuffer, mimeType): Promise<{ hasSpeech: boolean, transcript?: string }>`
- Route: `POST /api/v1/run/:workspaceSlug/:testSlug/attempt/audio-check`

- [ ] **Step 1: Write failing unit test for `evaluateByokAudio`**
  - Test OpenAI Whisper multipart transcription call.
  - Test Gemini inline audio part generation call.
  - Test graceful fallback when no BYOK audio key is configured.
- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/api test audio`
- [ ] **Step 3: Implement `evaluateByokAudio` and audio check route**
  - Decrypt workspace BYOK key, route to OpenAI `whisper-1` or Gemini `gemini-2.5-flash`.
  - Return `{ hasSpeech: boolean, transcript: string }`.
  - Enforce max payload size (500 KB) and rate limiting.
- [ ] **Step 4: Run tests to verify they pass**
  - Run: `pnpm --filter @pariksha/api test audio` and `pnpm --filter @pariksha/api test audio-check`
- [ ] **Step 5: Commit**
  - Commit: `feat(api): BYOK audio speech evaluation endpoint for OpenAI Whisper and Gemini`

---

### Task 4: Connect Candidate Audio Check to BYOK & Proctoring UI

**Files:**
- Modify: `packages/core/src/proctoring.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx`
- Modify: `apps/web/src/components/organiser/AttemptReview.tsx`
- Test: `apps/web/test/exam/byok-audio.test.tsx`
- Test: `apps/web/test/organiser/attempt-review.test.tsx`

**Interfaces:**
- Consumes: `POST /attempt/audio-check`
- Produces: `ai_audio_check` proctoring configuration option and timeline review cards

- [ ] **Step 1: Add `ai_audio_check` to proctoring resolution and test builder**
  - Allow organisers to toggle "AI Speech Verification (BYOK / Native)".
- [ ] **Step 2: Write test for candidate audio check invocation on sustained noise**
  - Buffer audio on noise burst and submit to `audio-check`.
- [ ] **Step 3: Wire `speech_detected` and audio verification cards into `AttemptReview.tsx`**
  - Display transcript snippet and speech indicator in attempt audit timeline.
- [ ] **Step 4: Run all web tests**
  - Run: `pnpm --filter @pariksha/web test`
- [ ] **Step 5: Commit**
  - Commit: `feat(web): integrate BYOK audio proctoring in test runner and attempt review`

---

### Task 5: README & Documentation Reconciliation

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `README.md`**
  - Update "What is still to come" table: mark Watchtower, Ear/Microphone, and Face Counting as completed.
  - Remove outdated note claiming candidate palette is not grouped by section.
  - Document the multi-tier microphone model (Free Browser Web Speech + BYOK Whisper/Gemini).
- [ ] **Step 2: Update `docs/ROADMAP.md`**
  - Reconcile Phase 8.5 status and note resolution of Issue #264.
- [ ] **Step 3: Update `CHANGELOG.md`**
  - Record the new features under `[Unreleased]`.
- [ ] **Step 4: Commit**
  - Commit: `docs: reconcile completed roadmap milestones and document native face & BYOK audio proctoring`

---

### Task 6: Full Verification, Push & Open Pull Request

- [ ] **Step 1: Run full monorepo typecheck**
  - Command: `pnpm typecheck`
- [ ] **Step 2: Run full monorepo lint**
  - Command: `pnpm lint`
- [ ] **Step 3: Run full web & API test suites**
  - Command: `pnpm --filter @pariksha/web test` and `pnpm --filter @pariksha/api test`
- [ ] **Step 4: Push branch to origin**
  - Command: `git push -u origin feat/byok-audio-model-and-face-counting`
- [ ] **Step 5: Open GitHub Pull Request**
  - Command: `gh pr create --title "feat: BYOK audio model, native face counting & roadmap gap closure" --body-file scratch/pr-byok-audio-body.md --base main --head feat/byok-audio-model-and-face-counting`
