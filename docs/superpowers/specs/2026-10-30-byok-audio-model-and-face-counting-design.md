# BYOK Audio Model, Native Face Counting & README Gap Closure Design Spec

- **Date:** 2026-10-30
- **Status:** Approved
- **Authors:** Senior Architect & Senior Fullstack Engineer

---

## 1. Context & Motivation

In the repository roadmap and [`README.md`](../../README.md#what-is-still-to-come), several capabilities were marked as either unbuilt, partially delivered, or constrained:
1. **Microphone AI Model with BYOK:**
   - [Phase 8.5 (PR #266)](https://github.com/SriSatyaLokesh/pariksha/pull/266) delivered real-time circular RMS audio energy monitoring (`noise-worklet.js`, zero audio recording, zero retention under ADR 0012).
   - However, decibel monitoring alone cannot detect *what* sounds occur (e.g. whispered communication, multiple voices, or question reading).
   - Running speech recognition or multimodal audio LLMs on Cloudflare Workers violates the $0 hosting cost model.
   - **The Solution:** Leverage the Phase 12 BYOK (Bring Your Own Key) architecture. If an organiser supplies an OpenAI or Gemini API key, ephemeral audio clips captured during sustained noise bursts can be evaluated via OpenAI Whisper (`whisper-1`) or Google Gemini Multimodal Audio (`gemini-2.5-flash`).
2. **Browser-Native Free Speech Recognition ($0 Cost):**
   - In modern browsers supporting the **Web Speech API** (`window.SpeechRecognition` / `webkitSpeechRecognition`), speech transcription is available **free of charge**, directly on-device, requiring **zero keys**, zero npm packages, and zero CSP adjustments.
3. **Native On-Device Face Counting (Closing Issue #264):**
   - MediaPipe was previously cut due to CSP constraints (`'wasm-unsafe-eval'`).
   - The native **Shape Detection API** (`window.FaceDetector`) is built directly into Chromium desktop browsers, providing C++-speed face counting with zero WASM, zero external scripts, and zero CSP changes.
   - For browsers without native `FaceDetector`, it adheres to the `AG1` fail-open invariant.
4. **README & Roadmap Gaps:**
   - The Watchtower live monitor (Phase 8.5) and section-grouped palette (Phase 9) are already fully operational in code, but `README.md` still displayed stale "Not built yet" rows.

---

## 2. Architecture & Data Flow

### 2.1 Multi-Tier Microphone Model (Ponytail Reflex)

```
[Candidate Audio Stream]
        │
        ├──> [AudioWorklet: noise-worklet.js] ──> RMS Decibel Monitor ($0 / Always Active)
        │
        ├──> [Browser Web Speech API] ──> Native Speech Recognition ($0 Free, No Keys)
        │                                  └─> Emits: "speech_detected" ({ transcript, confidence })
        │
        └──> [BYOK Cloud AI Audio Check] (Optional, Organiser-Funded)
                 ├─> Triggered on sustained falling-edge noise burst (>1.5s)
                 ├─> Candidate client sends 3s WebM/Opus audio slice to:
                 │   `POST /api/v1/run/:workspaceSlug/:testSlug/attempt/audio-check`
                 └─> Server decrypts workspace BYOK credential (OpenAI Whisper or Gemini Audio)
                     └─> Returns: { speechDetected: boolean, transcript?: string }
                     └─> Audio is immediately destroyed (Zero Retention Guarantee)
```

### 2.2 Native Face Counting (`face_check`)

- **Sampler:** On each interval snapshot (or camera capture), the client invokes `detectFaces(canvas)`.
- If `typeof window.FaceDetector !== "undefined"`:
  ```ts
  const detector = new window.FaceDetector({ maxDetectedFaces: 5, fastMode: true });
  const faces = await detector.detect(canvas);
  snapshot.faceCount = faces.length;
  ```
- **Integrity Signals:**
  - `faceCount === 0` -> Emits `face_absent` proctoring event.
  - `faceCount > 1` -> Emits `multiple_faces` proctoring event.
  - `faceCount === 1` -> Normal.
- **Fail-Open Fallback:** If `window.FaceDetector` is undefined, `snapshot.faceCount` is set to `null` and no false-positive violation is generated.

### 2.3 BYOK Audio Backend Router

- Endpoint: `POST /api/v1/run/:workspaceSlug/:testSlug/attempt/audio-check`
- Rate-limited and scoped to active candidate attempt token.
- Uses `apps/api/src/byok/`:
  - `openai`: `POST https://api.openai.com/v1/audio/transcriptions` with model `whisper-1`.
  - `gemini`: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` with inline audio base64 part.

---

## 3. UI & Test Builder Configuration

1. **`ProctoringPanel.tsx`:**
   - Enable `face_check` checkbox: "Count faces in each image (Native on-device)".
   - Update helper text: "Uses native on-device face detection. Zero external scripts or server uploads."
   - Under Microphone proctoring:
     - Add `ai_audio_check` checkbox: "AI speech detection on noise bursts".
     - Badge indicates: "Uses Free Browser Web Speech API by default, or Cloud BYOK (OpenAI/Gemini) if configured."
2. **`MonitorTable.tsx` & `AttemptReview.tsx`:**
   - Display `speech_detected` and `multiple_faces` events with transcript snippets in timeline.

---

## 4. Verification Invariants

- Monorepo typecheck: `pnpm typecheck` must pass 8/8 tasks.
- Monorepo lint: `pnpm lint` must pass 0 errors.
- Monorepo test: `pnpm --filter @pariksha/web test` and `pnpm --filter @pariksha/api test` must pass all tests.
- CSP Invariant: `apps/web/test/hosting.test.ts` must pass without `'wasm-unsafe-eval'` or non-self origins.
- Prerender Invariant: `apps/web/test/prerender.test.ts` must pass.
