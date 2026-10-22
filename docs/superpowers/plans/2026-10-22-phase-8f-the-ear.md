# Phase 8f — The Ear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the microphone on — a noise-level monitor that records nothing — and re-point the face-counting control at a future that can actually deliver it.

**Architecture:** An `AudioWorklet` computes RMS over a window; a threshold-crossing state machine on the main thread emits one event on the **falling** edge carrying a duration and nothing else. `require_microphone` stops resolving a hardcoded `false`. The public claim in `P-06` is reworded **in the same commit** that first opens an audio stream, because capture-without-retention is a different claim from no-capture.

**Tech Stack:** TypeScript (strict), Vitest + jsdom, Web Audio (`AudioWorklet`), Preact/React.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K1`, `K34`. The **acceptance criteria are [#209](https://github.com/SriSatyaLokesh/pariksha/issues/209)'s**, in full; this plan adds nothing to them. Phase 7's spec `Q12`, `Q12a`, `Q12b`, `AG1`, `AG2`, `AG3` still bind.

**Depends on:** **8a**, and **7d must be merged**. `#209` re-enables a control and deletes a hardcoded `false` that **7d ships** — against a tree without 7d there is nothing here to re-enable, and the `AG2`/`AG3` source scans this plan must keep green do not exist yet. **Starts only once 7d merges** (`K43`).

**Goals covered:** the microphone half of Phase 7's `G2`/`G3`.

**Issues:** #209, #84.

## Global Constraints

**8a's Global Constraints apply in full and are not repeated.** These are this plan's additions, and most are traps Phase 7 already paid for.

- **`AG1`** — a proctoring stack failure never blocks answering. The microphone is **not** the camera's exception: `Q2`'s required camera is the phase's only one. No `AudioWorklet`, or permission denied, means the attempt starts, stays answerable, emits `proctoring_unavailable`, and **the candidate sees nothing**.
- **`AG2`/`AG3`** — no `MediaRecorder` anywhere in `apps/web/src`; no retained audio (`AudioBuffer`, `getChannelData`); no biometric template in either app. 7d shipped these scans; they must still pass, and each is broken on purpose once (`Q10a`).
- **`AG5`** — never make a gate green by moving a bar.
- **jsdom has no `AudioWorklet`, no `getUserMedia` and no `MediaStream`.** Install them with `Object.defineProperty`; `vi.spyOn` on a property that does not exist cannot work. Precedents: `apps/web/test/exam/camera-gate.test.tsx`, `proctoring-failopen.test.tsx`.
- **A Strict attempt cannot start in jsdom without a desktop stub.** 7c's device gate decides at mount and Strict resolves `desktopOnly: true`. Use `stubDesktop()` from `camera-gate.test.tsx` — **`device-gate.test.tsx` replaces `navigator` wholesale**, which would take `navigator.mediaDevices` down with it.
- **`no-hex-colors.test.ts` forbids CSS named-colour *words*** — `black`, `green`, `blue` — anywhere outside a **block** comment, not only `#rrggbb`. 7d Task 3 had to rename a whole concept late. **Pick colour-free vocabulary up front.**
- **Every negative assertion needs a positive control.** `expect(grepSource(...)).toEqual([])` is exactly the shape, and its control is the `Q10a` probe.
- Record each ruling in `.superpowers/sdd/phase-8f/progress.md`.

## Review Focus

1. **A browser that grants microphone permission and then has the track end** — the user unplugs a USB headset mid-attempt. The camera has `camera_lost`/`camera_restored` for this; the microphone has **no paired event** and `K34` adds none. A dead worklet must degrade silently under `AG1`, not throw into the attempt. Task 1.
2. **A noise crossing that is still open when the candidate submits.** The event fires on the **falling** edge, so a crossing that never falls is never sent. One event lost is correct — but it must not block or delay submission, and the queue's unload buffer must not resend it forever. Task 1.
3. **A worklet that cannot be made free on a weak machine.** `#209`'s own criterion: *"If it cannot be made free on a weak machine, cut it again — the permission and its browser recording indicator survive, only the event goes."* Measure before shipping. Task 1.
4. **`require_microphone: true` imported from a document written while the control was disabled.** Those documents exist — the field has validated, imported and exported since 7a while resolving `false`. Turning the resolution on changes what an already-stored document means. Task 2.
5. **The `P-06` reword shipping in a different commit from the first audio stream.** This is the one failure `K34` exists to prevent and it is a credibility failure, not a technical one. Task 3 is written to make it impossible to land one without the other.

---

### Task 1: `monitorNoise`

**Files:**
- Create: `apps/web/src/lib/noise.ts`
- Create: `apps/web/public/noise-worklet.js`
- Test: `apps/web/test/exam/noise.test.ts`

**Interfaces:**
- Produces, exactly as `#209` specifies it:

```ts
export function monitorNoise(stream: MediaStream, opts: {
  thresholdDb: number; windowMs: number; onCrossing: (durationMs: number) => void;
}): { stop(): void } | null;   // null when AudioWorklet is unavailable — a failure, not a block
```

The threshold is a **constant**, not a sixteenth organiser control. 7d settled that and nobody has asked since.

**`Q12b`** — an `AudioWorklet` over a window, **never an analyser polled on a frame loop**. The whole ruling is "cheap or off".

- [ ] **Step 1: Write the failing tests**

Review Focus items 1 and 2 are the fourth and fifth.

```ts
it("emits once per crossing, on the falling edge, with a duration", () => {
  const onCrossing = vi.fn();
  const m = monitorNoise(stubStream(), { thresholdDb: -40, windowMs: 200, onCrossing })!;
  rise(); advance(900); fall();
  expect(onCrossing).toHaveBeenCalledTimes(1);
  expect(onCrossing).toHaveBeenCalledWith(expect.numberCloseTo(900, -2));
  m.stop();
});

it("emits nothing while the level is still above the threshold", () => {
  const onCrossing = vi.fn();
  monitorNoise(stubStream(), { thresholdDb: -40, windowMs: 200, onCrossing });
  rise(); advance(5_000);
  expect(onCrossing).not.toHaveBeenCalled();
});

it("returns null when AudioWorklet is unavailable", () => {
  withoutAudioWorklet(() => {
    expect(monitorNoise(stubStream(), { thresholdDb: -40, windowMs: 200, onCrossing: vi.fn() })).toBeNull();
  });
});

it("does not throw when the track ends mid-attempt", () => {
  const m = monitorNoise(stubStream(), { thresholdDb: -40, windowMs: 200, onCrossing: vi.fn() })!;
  expect(() => endTrack()).not.toThrow();
  expect(() => m.stop()).not.toThrow();
});

it("sends nothing for a crossing still open at stop", () => {
  const onCrossing = vi.fn();
  const m = monitorNoise(stubStream(), { thresholdDb: -40, windowMs: 200, onCrossing })!;
  rise(); advance(900); m.stop();
  expect(onCrossing).not.toHaveBeenCalled();
});
```

jsdom has no `AudioWorklet`, no `MediaStream` and no `getUserMedia` — install all three with `Object.defineProperty`.

- [ ] **Step 2: Run and watch them fail**

Run: `cd apps/web && npx vitest run test/exam/noise.test.ts --no-file-parallelism`

- [ ] **Step 3: Write the worklet and the state machine**

The worklet computes RMS over `windowMs` and posts a level. The crossing state machine lives on the **main thread**, which is what makes it testable without a real audio graph.

- [ ] **Step 4: Pin the `detail` shape exactly**

`#209`: *"The event's `detail` contains **only** a duration — no samples, no levels, no derived audio features. Pinned by a test asserting the serialised shape exactly."*

```ts
it("serialises a detail carrying only a duration", () => {
  expect(JSON.parse(JSON.stringify(detailFor(900)))).toEqual({ durationMs: 900 });
});
```

Declare the shape in `packages/core/src/proctoring.ts` beside the four 7c declared and the five 7d did — the emitter declares its own shape, and this is the emitter (`Q7b`).

- [ ] **Step 5: Measure the cost on a weak machine**

Review Focus 3 and `#209`'s own cut criterion. Record the figure in the ledger. **If it is not free, cut the event and keep the permission** — that is the pre-authorised cut, and taking it is not a third cut.

- [ ] **Step 6: Run, and keep the `AG2`/`AG3` scans green**

Run: `cd apps/web && npx vitest run --no-file-parallelism`
The scans 7d shipped must still pass with an audio stream now open. If one fails, that is the guard working — read it before changing it (`AG5`).

- [ ] **Step 7: Probe each scan once (`Q10a`)**

Plant a `MediaRecorder`, run, record the verbatim failure, remove. Same for `AudioBuffer`. **No probe appears in a commit.**

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/noise.ts apps/web/public/noise-worklet.js packages/core/src/proctoring.ts apps/web/test/exam/noise.test.ts
git commit -m "feat(web,core): monitorNoise — a falling-edge crossing carrying only a duration (#209)"
```

---

### Task 2: Turn the control on

**Files:**
- Modify: `packages/core/src/proctoring.ts` (delete the hardcoded `requireMicrophone: false`)
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx` (re-enable the control)
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx` (acquire the stream, wire the queue)
- Test: `packages/core/test/proctoring.test.ts`, `apps/web/test/exam/proctoring-mic.test.tsx`

**Interfaces:**
- Consumes: `monitorNoise` (Task 1), `createProctoringQueue` (7c).
- Produces: `require_microphone` resolving honestly; the candidate sentence appearing.

**`#209`'s criteria:**
- `require_microphone` stops resolving hardcoded `false`, and its organiser control is re-enabled.
- The candidate sentence appears and is true: *"Your microphone is on. Noise level is monitored; no audio is recorded or stored."*
- Noise never counts toward the violation limit or the integrity flag (7a's ruling — `noise_above_threshold` is in neither `VIOLATION_EVENTS` nor `FAILURE_EVENTS`).

**Note the trap this creates:** 7d shipped tests pinning the cut — *"`require_microphone: true` resolves `false`, and `proctoringRequirements` emits no microphone sentence for it."* **Those tests are meant to break.** Invert them deliberately; do not delete them.

- [ ] **Step 1: Invert the cut tests, and write the new ones**

Review Focus item 4 is the third.

```ts
it("resolves require_microphone: true as true", () => {
  expect(resolveProctoring({ profile: "off", overrides: { require_microphone: true } }).requireMicrophone)
    .toBe(true);
});

it("emits the microphone sentence, exactly", () => {
  expect(proctoringRequirements(resolveProctoring({ overrides: { require_microphone: true } })))
    .toContain("Your microphone is on. Noise level is monitored; no audio is recorded or stored.");
});

it("honours a document stored while the control was disabled", () => {
  // These documents exist: the field has validated and round-tripped since 7a
  // while resolving false. Turning resolution on changes what they mean.
  expect(resolveProctoring(documentStoredDuringTheCut).requireMicrophone).toBe(true);
});

it("keeps noise out of the violation count and the integrity flag", () => {
  expect(VIOLATION_EVENTS).not.toContain("noise_above_threshold");
  expect(FAILURE_EVENTS).not.toContain("noise_above_threshold");
  expect(isViolation("noise_above_threshold")).toBe(false);
});

it("still resolves faceCheck false — K1 did not re-enable that one", () => {
  expect(resolveProctoring({ overrides: { face_check: true } }).faceCheck).toBe(false);
});
```

The last keeps the two cuts distinct: this plan turns one on and leaves the other off.

- [ ] **Step 2: Write the fail-open test**

```ts
it("starts the attempt and stays answerable when the microphone is denied", async () => {
  stubDesktop();
  denyMicrophone();
  render(<ExamApp {...strictProps} />);
  expect(await screen.findByRole("button", { name: /Start/ })).toBeEnabled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("blocks on a denied camera — control, showing the mic is not the exception", async () => {
  stubDesktop();
  denyCamera();
  render(<ExamApp {...strictProps} />);
  expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
});
```

The second is what proves the first means something: `AG1` is a real distinction, not an absence of behaviour.

- [ ] **Step 3: Run and watch them fail, then implement**

- [ ] **Step 4: Run `apps/web` and the core coverage gate**

Run: `cd packages/core && npx vitest run --coverage --coverage.thresholds.functions=100 --coverage.thresholds.statements=98`
Run: `cd apps/web && npx vitest run --no-file-parallelism`

The landing fixtures in `apps/api/test/run/landing.test.ts` and `apps/web/test/exam/landing.test.tsx` carry the real sentences **copied verbatim so the two cannot drift**. Adding a sentence breaks both deliberately. Extend both and keep them identical.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proctoring.ts apps/web/src/components/testbuilder/ProctoringPanel.tsx apps/web/src/components/exam/ProctoringLayer.tsx packages/core/test apps/web/test apps/api/test/run/landing.test.ts
git commit -m "feat(core,web): require_microphone resolves honestly and the control is re-enabled (#209)"
```

---

### Task 3: The public claim, and re-cutting the face check

**Files:**
- Modify: `docs/PRD.md` (`P-06`)
- Create: `docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md`
- Modify: `packages/core/src/proctoring.ts` (the `faceCheck` comment re-points)
- Modify: `apps/web/src/components/testbuilder/ProctoringPanel.tsx` (the `face_check` control's copy)
- Test: `apps/web/test/testbuilder/proctoring-panel.test.tsx`

**`K34`** — the reword and the ADR land **in the same change that first opens an audio stream**. Task 1 opened it; this task must be in the same branch and must not be dropped from it.

`P-06` goes from *"no audio is ever recorded"* to *"no audio is ever recorded **or stored**"*. The existing wording was true while nothing captured audio; it is too weak the moment a worklet is listening, which is `#209`'s own argument.

**`K1`** — the `face_check` control's copy currently names **Phase 8**. Phase 8 is not delivering it: MediaPipe still needs `'wasm-unsafe-eval'` and `hosting.test.ts`'s comment still reads *"A design that needed a CSP change would be the wrong design."* Re-point it at a fresh issue, and file that issue.

- [ ] **Step 1: Write the failing copy tests**

```ts
it("the face_check control no longer names Phase 8", () => {
  render(<ProctoringPanel {...props} />);
  expect(screen.getByLabelText(/face/i)).toBeDisabled();
  expect(screen.queryByText(/Phase 8/)).toBeNull();
});

it("it names the issue that now owns it — control for the assertion above", () => {
  render(<ProctoringPanel {...props} />);
  expect(screen.getByText(/#\d+/)).toBeInTheDocument();
});

it("the PRD no longer claims only that audio is not recorded", () => {
  expect(readFileSync("docs/PRD.md", "utf8")).toContain("no audio is ever recorded or stored");
});
```

The third is a documentation assertion in a test file on purpose: it is the mechanical half of `K34`, and it fails if Task 1 lands without this task.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: File the face-counting issue, write the ADR, reword `P-06`, re-point the control**

The ADR records what `Q12` asks for: a microphone that monitors a level and retains nothing, why capture-without-retention needed the stronger claim, and the `AG2`/`AG3` scans that keep it true.

- [ ] **Step 4: Run the whole branch**

Run: `npx turbo run test --force --concurrency=1`

- [ ] **Step 5: Commit — with Task 1's audio stream, never after it**

```bash
git add docs/PRD.md docs/adr/0012-the-microphone-monitors-a-level-and-retains-nothing.md packages/core/src/proctoring.ts apps/web/src/components/testbuilder/ProctoringPanel.tsx apps/web/test/testbuilder/proctoring-panel.test.tsx
git commit -m "docs(prd,adr): P-06 says 'or stored', and face_check re-points off Phase 8 (K1, K34, #209, #84)"
```

---

## What the owner validates by hand

The microphone cannot be proved in CI any more than the camera could.

- **A real microphone, granted and then denied.** Granted: the browser's recording indicator appears and the candidate sees the sentence. Denied: the attempt **starts anyway** and the candidate sees nothing — that is `AG1`, and it is the opposite of the camera's behaviour on the same page.
- **A real unplug mid-attempt.** Review Focus 1. The paper stays answerable.
- **The cost on a weak machine.** `#209`'s cut criterion. If it is not free, cut the event and keep the permission.

Each result goes in the roadmap's Phase 8 row, not only in a task report.
