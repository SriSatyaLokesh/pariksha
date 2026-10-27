# 0012. The microphone monitors a level and retains nothing

- **Status:** Accepted
- **Date:** 2026-10-27

## Context

Exam proctoring environments need to detect suspicious ambient audio — such as
whispering, verbal assistance, or collaboration with a second person in the room
— without invading candidate privacy or hoarding sensitive recordings.

Conventional proctoring tools record raw audio streams, upload large audio/video
files to vendor clouds, or run opaque proprietary speech recognition models.
These approaches introduce severe privacy and compliance liabilities (FERPA,
GDPR, wiretapping laws), fail on low-bandwidth networks, and create immense
storage costs for self-hosted deployments.

Pariksha is committed to zero-cost, self-hosted deployment on Cloudflare and
small servers, with a foundational guarantee that candidate privacy is respected
by design. The question this record answers is how to provide ambient acoustic
integrity signals while maintaining absolute candidate privacy and zero audio
retention.

## Decision

**The microphone monitors ambient sound levels on-device and retains nothing.**
Raw audio is never recorded, never stored in memory or disk, and never
transmitted over the network.

### 1. In-browser AudioWorklet running circular RMS math in $O(1)$

Audio processing runs client-side on the browser's dedicated audio rendering
thread via an `AudioWorkletProcessor` (`NoiseLevelProcessor` in
[`apps/web/public/noise-worklet.js`](../../apps/web/public/noise-worklet.js)):

- A circular buffer of $N$ float samples is allocated at initialization, where
  $N = \text{round}(\text{windowMs} \times \text{sampleRate} / 1000)$ (default
  window of $200\,\text{ms}$).
- For each incoming audio sample $x$, the running sum of squared amplitudes is
  updated in $O(1)$ time by subtracting the outgoing sample's square and adding
  the incoming sample's square:
  $$\text{sumSquares} \leftarrow \text{sumSquares} + x^2 - x_{\text{outgoing}}^2$$
- The root-mean-square (RMS) energy is computed as:
  $$\text{RMS} = \sqrt{\frac{\max(0, \text{sumSquares})}{N}}$$
  and converted to decibels relative to full scale:
  $$\text{dBFS} = 20 \log_{10}(\text{RMS})$$
- The worklet posts a lightweight message `{ level: number }` to the main thread
  at most once per window (every $200\,\text{ms}$), preventing main-thread event
  flooding and ensuring no PCM sample data ever leaves the worklet.

### 2. Falling-edge crossing detector on the main thread

In [`apps/web/src/lib/noise.ts`](../../apps/web/src/lib/noise.ts) (`monitorNoise`),
the candidate runtime receives throttled dB levels:

- When $\text{level} \ge \text{thresholdDb}$ (default $-40\,\text{dBFS}$), the
  timestamp `aboveSince` is recorded.
- When $\text{level}$ drops back below $\text{thresholdDb}$, a single
  `noise_above_threshold` event is emitted on the **falling edge**, reporting
  `durationMs = Date.now() - aboveSince`.
- If the test ends or monitoring is stopped while an event is ongoing, the
  unclosed crossing is discarded without emitting.

### 3. Strict zero-retention invariant (`AG2`, `AG3`, `P-06`)

- **No `MediaRecorder`:** The client never instantiates a `MediaRecorder`.
- **No `AudioBuffer` retention:** The client never retains an `AudioBuffer` or
  calls `getChannelData()`.
- **Minimal event detail:** The event payload sent to the API and stored in the
  attempt log carries only the duration:
  ```ts
  export interface NoiseAboveThresholdDetail {
    durationMs: number;
  }
  ```
  No sample, no waveform, no decibel level, and no spectral data is transmitted
  or recorded.
- **Non-punitive classification:** `noise_above_threshold` is neither in
  `VIOLATION_EVENTS` nor `FAILURE_EVENTS`. It is logged on the attempt timeline
  for human review, but never triggers auto-lock or auto-submission.
- **Permanent automated scans:** Mechanically enforced by tests in
  [`apps/web/test/exam/no-recording.test.ts`](../../apps/web/test/exam/no-recording.test.ts),
  which scan all web and public scripts (`apps/web/src/` and `apps/web/public/`)
  for recording primitives or biometric indicators.
- **PRD update:** `P-06` in [`docs/PRD.md`](../PRD.md) is updated to state:
  *"No video and no audio is ever recorded or stored."* Candidate disclosure
  prominently explains: *"Your microphone is on. Noise level is monitored; no
  audio is recorded or stored."*

### 4. Fail-open failure policy (`AG1`)

Proctoring stack failure never blocks answering:

- A denied, absent, or disconnected microphone never prevents a candidate from
  starting, continuing, or submitting an exam.
- Unified media acquisition ([`apps/web/src/lib/media.ts`](../../apps/web/src/lib/media.ts))
  requests video and audio together, but automatically falls back to video-only
  if microphone access is denied or unavailable.
- Mid-attempt microphone disconnection (e.g. unplugging a USB headset) triggers
  the track `ended` event and cleanly shuts down audio nodes without throwing or
  interrupting the candidate.

## Consequences

**Easier.** Candidate privacy is preserved unconditionally. Candidates and
institutions do not need to trust that audio recordings are safely deleted or
anonymized, because no audio recording exists to be leaked, subpoenaed, or
misused. Bandwidth and storage overhead is near zero, fitting Cloudflare free-tier
constraints comfortably.

**Harder.** Organisers cannot listen back to flagged incidents. Reviewers must
correlate `noise_above_threshold` duration markers with other proctoring signals
(e.g., lens covered, multiple faces, window departure) during post-test review.

**To watch.**
- **Acoustic threshold calibration:** Microphones and ambient room conditions
  vary across candidate hardware. The $-40\,\text{dBFS}$ default catches clear
  vocal speech in quiet environments; false positives from ambient street noise
  must be kept non-punitive.
- **Permissions-Policy headers:** HTTP responses must allow
  `Permissions-Policy: microphone=(self)` so browsers allow `getUserMedia({ audio: true })`
  on the application origin without relaxing strict CSP rules (no `'wasm-unsafe-eval'`).
