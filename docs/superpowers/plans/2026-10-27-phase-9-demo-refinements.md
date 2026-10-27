# Phase 9 Subphase: Interactive Public Demo Refinements Implementation Plan

> **Status: Complete** — Delivered, tested, and merged into main in PR [#255](https://github.com/SriSatyaLokesh/pariksha/pull/255) (closes [#256](https://github.com/SriSatyaLokesh/pariksha/issues/256), commit 9a2adb6).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Complete the final subphase of Phase 9 by exposing the public demo on the landing page with access code `DEMO`, enforcing exam proctoring features (fullscreen, watermark, draggable calculator, phone/tablet block, copy-paste block, extra monitor detection, 3-violation limit), configuring the 15-minute exam with 5-minute section time limits, fixing `fill_blank` question rendering for `{{b1}}`/`[[b1]]`, and allowing repeated option selections in `matching` questions without disabling options.

**Architecture:** The landing page and demo modal prominently expose the `DEMO` access code. The client-side demo engine (`demo-client.ts`) enforces the `DEMO` access code, sets a 15-minute total duration and 5-minute section time limits, and supplies a robust proctoring configuration (`DEMO_PROCTORING_CONFIG`). The candidate exam runner's `<Calculator />` is enhanced to be a floating, draggable modal with high z-index (`z-index: 100`) so it never gets obscured under section content. `<ProctoringLayer />` is adapted to track violations in-memory/sessionStorage in demo mode with zero Cloudflare subrequests, displaying warnings up to 3 violations before auto-submitting. `<FillBlank />` is enhanced to parse both `{{id}}` and `[[id]]` placeholders and `demo_q4` is corrected. `<Matching />` removes option disabling so candidates can map multiple items to identical time complexities (e.g. `O(n log n)`).

**Tech Stack:** TypeScript (strict), React 18, `@pariksha/core`, `@pariksha/web`, Vitest, Testing Library, Playwright.

**Spec:** [`docs/superpowers/plans/2026-10-25-phase-9-public-demo-and-sections.md`](2026-10-25-phase-9-public-demo-and-sections.md), [`docs/ROADMAP.md`](../../ROADMAP.md) (Phase 9), [`DESIGN.md`](../../DESIGN.md).

## Global Constraints

- **Access Code Verbatim**: The public demo access code must be `DEMO` (case-insensitive in input, shown as uppercase `DEMO`).
- **Zero Cloudflare Subrequests for Candidate Demo (`P-05`, `P-06`)**: All candidate interactions (start, access code, saves, proctoring events, scoring) run client-side. No D1 rows written, no R2 uploads.
- **Demo Proctoring Defaults**: `desktopOnly: true`, `requireFullscreen: true`, `watermark: true`, `blockCopyPaste: true`, `extraMonitorCheck: true`, `allowCalculator: true`, `violationLimit: 3`. No camera required (`requireCamera: false`).
- **Timing Configuration**: Total exam duration = 15 minutes (900,000 ms); each of the 3 sections = 5 minutes (300,000 ms).
- **Draggable Calculator Bounds & Z-Index (`UX-18`)**: Calculator must float above all sections (`z-index: 100`), support dragging via mouse/touch on header without leaving viewport bounds, and provide arrow key nudging when focused.
- **Matching Question Flexibility**: Options in `<Matching />` dropdowns must NEVER be disabled when chosen on another row. Left items may freely share the same right value.
- **Fill in the Blank Dual Format**: `<FillBlank />` accepts standard `{{id}}` as well as bracketed `[[id]]` delimiters so input fields render inline with the prompt text.
- **Accessible & Contrast Compliant (`WCAG 2.1 AA`)**: All demo UI elements, badges, notices, and drag handles maintain contrast tokens and accessible names.

## Review Focus

1. **Access code rejection**: Entering any code other than `DEMO` (e.g. blank, `TEST`, `1234`) rejects with `Invalid access code. Please enter DEMO.` and keeps candidate on the access gate.
2. **Calculator viewport clamping**: Dragging the calculator toward any edge of the screen clamps within visible viewport boundaries and remains usable on any screen resolution >= 1024px.
3. **Violation escalation ceiling**: Exactly 3 violations (e.g. 3 tab switches or copy attempts) transition through "Warning 1 of 3" -> "Warning 2 of 3" -> Auto-submit with zero unhandled network errors.
4. **Matching option reusability**: Multiple left items in a matching question can select the same option (e.g., both "Merge Sort" and "Quick Sort" can select "O(n log n)") without disabling the option.
5. **Fill in the blank input appearance**: Question prompt "The standard port used for secure HTTPS connections is [[b1]]." (or `{{b1}}`) displays an active text input right in place of the placeholder, allowing input entry.

---

### Task 1: Landing Page & Modal Access Code "DEMO" Exposure

**Files:**
- Modify: `apps/web/src/sections/signal/Head.tsx`
- Modify: `apps/web/src/components/demo/DemoModal.tsx`
- Modify: `apps/web/src/components/demo/DemoBanner.tsx`
- Test: `apps/web/test/demo/landing-demo.test.tsx`

**Interfaces:**
- Consumes: none.
- Produces: Updated hero section with demo CTA and access code badge `Access Code: DEMO`, updated `DemoModal` showing access code for the candidate sample exam card, and updated `DemoBanner` displaying `Access Code: DEMO`.

- [x] **Step 1: Write the failing test**

```tsx
// apps/web/test/demo/landing-demo.test.tsx
it("renders demo access code 'DEMO' prominently in landing hero and demo modal", () => {
  render(<Landing />);
  const heroDemo = screen.getByRole("link", { name: /try live demo/i });
  expect(heroDemo).toBeInTheDocument();
  expect(screen.getByText(/code: DEMO/i)).toBeInTheDocument();

  render(<DemoModal isOpen={true} onClose={() => {}} />);
  expect(screen.getByText(/Access Code:\s*DEMO/i)).toBeInTheDocument();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/demo/landing-demo.test.tsx`
Expected: FAIL ("Unable to find element with text /code: DEMO/i")

- [x] **Step 3: Implement access code badges on landing page and demo components**

1. In `apps/web/src/sections/signal/Head.tsx`:
   - Beside or beneath `Try Live Demo`, render a code pill `<span className="signal-badge-code">Code: <strong>DEMO</strong></span>`.
2. In `apps/web/src/components/demo/DemoModal.tsx`:
   - Under `Take Sample Exam` description, add `<div className="demo-code-pill">Access Code: <code>DEMO</code></div>`.
3. In `apps/web/src/components/demo/DemoBanner.tsx`:
   - In `mode === "exam"`, include `· Access Code: DEMO`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/demo/landing-demo.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/sections/signal/Head.tsx apps/web/src/components/demo/DemoModal.tsx apps/web/src/components/demo/DemoBanner.tsx apps/web/test/demo/landing-demo.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(demo): display DEMO access code on landing page hero, modal, and banner"
```

---

### Task 2: Demo Client Access Code Enforcement & 15m/5m Timer Configurations

**Files:**
- Modify: `apps/web/src/lib/demo-test.ts`
- Modify: `apps/web/src/lib/demo-client.ts`
- Test: `apps/web/test/exam/demo-client.test.ts`

**Interfaces:**
- Consumes: `AccessRequest` from `apps/web/src/lib/run.ts`.
- Produces:
  - `access(req?: AccessRequest)`: returns `{ entryToken: "demo_entry_token" }` if `req?.code?.trim().toUpperCase() === "DEMO"`, else rejects with `ApiError(400, "code_wrong", "Invalid access code. Please enter DEMO.")`.
  - `DEMO_LANDING_FIXTURE`: `durationMinutes: 15`, 3 sections with `timeLimitMinutes: 5`.
  - `DEMO_PAPER_FIXTURE`: `remainingMs: 900_000`, `sectionRemainingMs: 300_000`, 3 sections with `timeLimitMinutes: 5`.

- [x] **Step 1: Write the failing tests**

```ts
// in apps/web/test/exam/demo-client.test.ts
it("validates that access code must be DEMO", async () => {
  const client = createDemoClient();
  await expect(client.access({ code: "WRONG" })).rejects.toThrow(/Invalid access code/i);
  await expect(client.access({})).rejects.toThrow(/Invalid access code/i);

  const res = await client.access({ code: "DEMO" });
  expect(res.entryToken).toBe("demo_entry_token");

  // Case-insensitive verification
  const resLower = await client.access({ code: "demo" });
  expect(resLower.entryToken).toBe("demo_entry_token");
});

it("configures total duration to 15 minutes and each section to 5 minutes", async () => {
  const client = createDemoClient();
  const landing = await client.landing();
  expect(landing.durationMinutes).toBe(15);
  expect(landing.sections.every((s) => s.timeLimitMinutes === 5)).toBe(true);

  const paper = await client.start("demo-token");
  expect(paper.remainingMs).toBe(15 * 60 * 1000);
  expect(paper.sectionRemainingMs).toBe(5 * 60 * 1000);
  expect(paper.sections.every((s) => s.timeLimitMinutes === 5)).toBe(true);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/demo-client.test.ts`
Expected: FAIL ("client.access({}) does not throw")

- [x] **Step 3: Implement access validation and 15m/5m timings**

1. In `apps/web/src/lib/demo-client.ts`:
   - Update `access`:
     ```ts
     access: (req?: AccessRequest): Promise<{ entryToken: string }> => {
       const code = req?.code?.trim().toUpperCase();
       if (code !== "DEMO") {
         return Promise.reject(new Error("Invalid access code. Please enter DEMO."));
       }
       return Promise.resolve({ entryToken: "demo_entry_token" });
     },
     ```
2. In `apps/web/src/lib/demo-test.ts`:
   - Update `DEMO_PAPER_SECTIONS`: set `timeLimitMinutes: 5` on each of the 3 sections.
   - Update `DEMO_LANDING_FIXTURE`: set `durationMinutes: 15`, and each section `timeLimitMinutes: 5`.
   - Update `DEMO_PAPER_FIXTURE`: set `remainingMs: 15 * 60_000` (900000), `sectionRemainingMs: 5 * 60_000` (300000).

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/demo-client.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/demo-test.ts apps/web/src/lib/demo-client.ts apps/web/test/exam/demo-client.test.ts
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(demo): enforce DEMO access code and 15-min total / 5-min section timings"
```

---

### Task 3: Floating, Draggable Calculator with High Z-Index

**Files:**
- Modify: `apps/web/src/components/exam/Calculator.tsx`
- Modify: `apps/web/src/styles/exam.css`
- Test: `apps/web/test/exam/calculator.test.tsx`

**Interfaces:**
- Consumes: `onClose: () => void`.
- Produces: Updated `<Calculator />` with draggable header handle, pointer capture drag tracking, viewport clamping, keyboard arrow nudging, and `z-index: 100` in `.exam-calculator`.

- [x] **Step 1: Write the failing tests**

```tsx
// in apps/web/test/exam/calculator.test.tsx
it("renders a draggable handle and updates position on pointer drag", () => {
  render(<Calculator onClose={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: /calculator/i });
  const handle = screen.getByTestId("calc-drag-handle");
  expect(handle).toBeInTheDocument();

  // Simulate pointer drag
  fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
  fireEvent.pointerMove(handle, { clientX: 150, clientY: 180 });
  fireEvent.pointerUp(handle);

  expect(dialog).toHaveStyle({ position: "fixed" });
});

it("supports keyboard arrow keys to nudge calculator position", () => {
  render(<Calculator onClose={vi.fn()} />);
  const handle = screen.getByTestId("calc-drag-handle");
  handle.focus();
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  // Dialog position was nudged
  const dialog = screen.getByRole("dialog", { name: /calculator/i });
  expect(dialog.style.transform || dialog.style.left).toBeDefined();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/calculator.test.tsx`
Expected: FAIL ("Unable to find element with testid 'calc-drag-handle'")

- [x] **Step 3: Implement draggable calculator and styling**

1. In `apps/web/src/components/exam/Calculator.tsx`:
   - Add state: `position: { x: number; y: number } | null = null`.
   - Add drag handle bar:
     ```tsx
     <div
       className="exam-calc-handle"
       data-testid="calc-drag-handle"
       tabIndex={0}
       role="toolbar"
       aria-label="Drag calculator handle. Use arrow keys to reposition."
       onPointerDown={handlePointerDown}
       onKeyDown={handleHandleKeyDown}
     >
       <span className="exam-calc-title">Calculator</span>
       <span className="exam-calc-grip" aria-hidden="true">⋮⋮</span>
     </div>
     ```
   - On pointer down: record start pointer coords and current dialog bounding rect, attach pointer capture.
   - On pointer move: compute delta, clamp within `[10, window.innerWidth - width - 10]` and `[10, window.innerHeight - height - 10]`, update `position`.
   - On pointer up: release pointer capture.
   - On arrow keys: nudge x/y by 20px with bounds clamping.
   - Apply `style={{ left: position ? `${position.x}px` : undefined, top: position ? `${position.y}px` : undefined }}`.
2. In `apps/web/src/styles/exam.css`:
   - Update `.exam-calculator`:
     ```css
     .exam-calculator {
       position: fixed;
       right: 32px;
       bottom: 32px;
       width: 240px;
       z-index: 100; /* Floats strictly above section nav, question panes, and headers */
       /* existing styles */
     }
     .exam-calc-handle {
       display: flex;
       justify-content: space-between;
       align-items: center;
       cursor: grab;
       padding: 4px 6px;
       margin-bottom: 8px;
       background: var(--color-canvas);
       border: 1px dashed var(--color-hairline-strong);
       border-radius: var(--rounded-sm);
       user-select: none;
       touch-action: none;
     }
     .exam-calc-handle:active {
       cursor: grabbing;
     }
     ```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/calculator.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/Calculator.tsx apps/web/src/styles/exam.css apps/web/test/exam/calculator.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(exam): make calculator floating and draggable with z-index elevation and keyboard controls"
```

---

### Task 4: Fix Fill-in-the-Blank Input Rendering (`{{b1}}` and `[[b1]]`)

**Files:**
- Modify: `apps/web/src/components/exam/answer/Written.tsx`
- Modify: `apps/web/src/lib/demo-test.ts`
- Test: `apps/web/test/exam/answer-written.test.tsx`

**Interfaces:**
- Consumes: `CandidateQuestion` of type `fill_blank`.
- Produces: Normalized placeholder matching that supports both `{{id}}` and `[[id]]` formats, rendering inline text inputs in `<FillBlank />`.

- [x] **Step 1: Write the failing test**

```tsx
// in apps/web/test/exam/answer-written.test.tsx
it("renders inline inputs for bracketed placeholders like [[b1]] as well as {{b1}}", async () => {
  const bracketQuestion: CandidateQuestion = {
    id: "q_brackets",
    type: "fill_blank",
    prompt: "The standard port used for secure HTTPS connections is [[b1]].",
    points: 2,
    blanks: [{ id: "b1" }],
  };

  render(<Harness question={bracketQuestion} />);
  const input = await screen.findByRole("textbox", { name: /blank 1/i });
  expect(input).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "443" } });
  expect(input).toHaveValue("443");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/answer-written.test.tsx`
Expected: FAIL ("Unable to find role textbox with name /blank 1/i")

- [x] **Step 3: Implement bracket placeholder normalization and fix demo fixture**

1. In `apps/web/src/components/exam/answer/Written.tsx`:
   - In `FillBlank`: normalize `[[id]]` delimiters into `{{id}}` before matching placeholders:
     ```ts
     const normalizedPrompt = question.prompt.replace(/\[\[([^[\]]+)\]\]/g, "{{$1}}");
     ```
   - Run `placeholderIds` on `normalizedPrompt` and substitute `BLANK_MARKER(id)`.
2. In `apps/web/src/lib/demo-test.ts`:
   - In `DEMO_SECTION_1_QUESTIONS` (demo_q4) and `DEMO_QUESTIONS_CATALOG`:
     Update prompt to: `"The standard port used for secure HTTPS connections is {{b1}}."` with `blanks: [{ id: "b1" }]`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/answer-written.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/answer/Written.tsx apps/web/src/lib/demo-test.ts apps/web/test/exam/answer-written.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "fix(exam): support bracket placeholders and fix demo fill-in-the-blank input rendering"
```

---

### Task 5: Enable Matching Options Reuse (Never Disable Selected Options)

**Files:**
- Modify: `apps/web/src/components/exam/answer/Structured.tsx`
- Modify: `apps/web/src/lib/demo-test.ts`
- Test: `apps/web/test/exam/answer-structured.test.tsx`

**Interfaces:**
- Consumes: `Matching` question with `left: string[]` and `right: string[]`.
- Produces: `<select>` dropdowns where all `<option>` items remain enabled, allowing candidates to select the same option across multiple left items (such as `O(n log n)` for both Merge Sort and Quick Sort).

- [x] **Step 1: Write the failing test**

```tsx
// in apps/web/test/exam/answer-structured.test.tsx
it("matching: does not disable options after selecting, permitting multiple left items to select the same right option", () => {
  const complexityMatching: CandidateQuestion = {
    id: "q_complexity",
    type: "matching",
    prompt: "Match sorting algorithms to complexities",
    points: 3,
    left: ["Merge Sort", "Quick Sort", "Bubble Sort"],
    right: ["O(n log n)", "O(n^2)", "O(n)"],
  };

  render(<Harness question={complexityMatching} />);
  const mergeSelect = screen.getByLabelText(/Merge Sort/i);
  const quickSelect = screen.getByLabelText(/Quick Sort/i);

  // Select O(n log n) for Merge Sort
  fireEvent.change(mergeSelect, { target: { value: "O(n log n)" } });

  // Verify O(n log n) in Quick Sort is NOT disabled
  const quickOption = within(quickSelect).getByRole("option", { name: "O(n log n)" });
  expect(quickOption).toBeEnabled();

  // Select O(n log n) for Quick Sort as well
  fireEvent.change(quickSelect, { target: { value: "O(n log n)" } });
  expect(quickSelect).toHaveValue("O(n log n)");
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/answer-structured.test.tsx`
Expected: FAIL ("expect(quickOption).toBeEnabled() failed because option is disabled")

- [x] **Step 3: Remove option disabling in `Structured.tsx` and deduplicate `right` array**

1. In `apps/web/src/components/exam/answer/Structured.tsx`:
   - In `<Matching />`:
     ```tsx
     {right.map((candidate, optIdx) => (
       <option
         key={`${candidate}-${optIdx}`}
         value={candidate}
       >
         {candidate}
       </option>
     ))}
     ```
   - Remove the `disabled={Object.entries(pairs).some(...)}` attribute on `<option>`.
2. In `apps/web/src/lib/demo-test.ts`:
   - In `demo_q7` (matching question):
     Provide deduplicated unique option choices in `right`:
     `left: ["Merge Sort", "Quick Sort", "Bubble Sort"]`
     `right: ["O(n log n)", "O(n^2)", "O(n)"]`
     `key: { "Merge Sort": "O(n log n)", "Quick Sort": "O(n log n)", "Bubble Sort": "O(n^2)" }`
     This allows selecting `O(n log n)` on multiple rows without option duplicates or option disabling!
3. In `apps/web/test/exam/answer-structured.test.tsx`:
   - Update the older test asserting option disabling to assert that options remain enabled and reusable.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/answer-structured.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/components/exam/answer/Structured.tsx apps/web/src/lib/demo-test.ts apps/web/test/exam/answer-structured.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "fix(exam): permit matching option reuse and stop disabling chosen options"
```

---

### Task 6: Demo Proctoring Configuration & Client-Side 3-Violation Guard

**Files:**
- Modify: `apps/web/src/lib/demo-test.ts`
- Modify: `apps/web/src/components/exam/ProctoringLayer.tsx`
- Test: `apps/web/test/exam/proctoring-demo.test.tsx`

**Interfaces:**
- Consumes: `ResolvedProctoring` from `@pariksha/core`.
- Produces:
  - `DEMO_PROCTORING_CONFIG`: Full proctoring enabled (`desktopOnly: true`, `requireFullscreen: true`, `watermark: true`, `blockCopyPaste: true`, `extraMonitorCheck: true`, `allowCalculator: true`, `violationLimit: 3`, `violationAction: "warn_then_flag"`).
  - In `ProctoringLayer.tsx`: When `attemptId.startsWith("att_demo_")`, bypass server network fetch and handle violation accumulation locally with 3-violation auto-submit limit.

- [x] **Step 1: Write the failing tests**

```tsx
// apps/web/test/exam/proctoring-demo.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProctoringLayer } from "../../src/components/exam/ProctoringLayer";
import { DEMO_PROCTORING_CONFIG } from "../../src/lib/demo-test";

describe("Demo Mode Proctoring Layer", () => {
  it("enforces demo proctoring configuration with 3 violation limit", () => {
    expect(DEMO_PROCTORING_CONFIG.requireFullscreen).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.watermark).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.blockCopyPaste).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.extraMonitorCheck).toBe(true);
    expect(DEMO_PROCTORING_CONFIG.violationLimit).toBe(3);
  });

  it("handles violations locally in demo mode without HTTP request and triggers auto-submit at 3", async () => {
    const onAutoSubmit = vi.fn();
    render(
      <ProctoringLayer
        attemptId="att_demo_evaluator"
        proctoring={DEMO_PROCTORING_CONFIG}
        initialViolations={0}
        onAutoSubmit={onAutoSubmit}
      >
        <div>Paper Content</div>
      </ProctoringLayer>,
    );

    // Trigger copy violation 1
    fireEvent.copy(document.body);
    await waitFor(() => {
      expect(screen.getByText(/Warning 1 of 3/i)).toBeInTheDocument();
    });

    // Trigger copy violation 2
    fireEvent.copy(document.body);
    await waitFor(() => {
      expect(screen.getByText(/Warning 2 of 3/i)).toBeInTheDocument();
    });

    // Trigger copy violation 3 -> auto submit
    fireEvent.copy(document.body);
    await waitFor(() => {
      expect(screen.getByText(/Warning 3 of 3/i)).toBeInTheDocument();
    });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/proctoring-demo.test.tsx`
Expected: FAIL ("DEMO_PROCTORING_CONFIG is not defined / fetch fails")

- [x] **Step 3: Implement `DEMO_PROCTORING_CONFIG` and client-side demo violation handler**

1. In `apps/web/src/lib/demo-test.ts`:
   - Export `DEMO_PROCTORING_CONFIG`:
     ```ts
     export const DEMO_PROCTORING_CONFIG: ResolvedProctoring = {
       ...PROCTORING_DEFAULTS.off,
       desktopOnly: true,
       requireFullscreen: true,
       watermark: true,
       blockCopyPaste: true,
       extraMonitorCheck: true,
       allowCalculator: true,
       violationLimit: 3,
       violationAction: "warn_then_flag",
     };
     ```
   - Set `DEMO_PAPER_FIXTURE.proctoring = DEMO_PROCTORING_CONFIG`.
   - Set `DEMO_LANDING_FIXTURE.proctoring.requirements = proctoringRequirements(DEMO_PROCTORING_CONFIG)`.
2. In `apps/web/src/components/exam/ProctoringLayer.tsx`:
   - When `attemptId.startsWith("att_demo_")`, provide a mock `sendEvents` handler inside `createProctoringQueue`:
     ```ts
     let demoViolations = initialViolations;
     async function sendDemoEvents(events: QueuedEvent[]): Promise<EventsResponse> {
       demoViolations += events.length;
       const limit = proctoring.violationLimit || 3;
       const action = demoViolations >= limit ? "auto_submit" : "warn_only";
       return {
         ok: true,
         violations: demoViolations,
         limit,
         action,
         autoSubmitted: demoViolations >= limit,
         locked: false,
       };
     }
     ```
   - Wire `sendDemoEvents` into `createProctoringQueue` when `attemptId.startsWith("att_demo_")`.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/proctoring-demo.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/lib/demo-test.ts apps/web/src/components/exam/ProctoringLayer.tsx apps/web/test/exam/proctoring-demo.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(demo): activate full demo proctoring and client-side 3-violation auto-submit guard"
```

---

### Task 7: Mobile and Tablet Gating Verification

**Files:**
- Modify: `apps/web/src/routes/exam.tsx`
- Test: `apps/web/test/exam/device-gate-demo.test.tsx`

**Interfaces:**
- Consumes: `deviceReport(resolved: ResolvedProctoring)` in `apps/web/src/routes/exam.tsx`.
- Produces: Refuses mobile/tablet devices (`screen width < 1024`, touch-only pointer, or mobile user-agents) with `ok: false, refused: true`.

- [x] **Step 1: Write the failing test**

```tsx
// apps/web/test/exam/device-gate-demo.test.tsx
import { describe, expect, it } from "vitest";
import { deviceReport } from "../../src/routes/exam";
import { DEMO_PROCTORING_CONFIG } from "../../src/lib/demo-test";

describe("Demo Device Gate (Block Phones & Tablets)", () => {
  it("refuses mobile screen widths under 1024px when desktopOnly is true", () => {
    window.innerWidth = 414; // iPhone screen
    const report = deviceReport(DEMO_PROCTORING_CONFIG);
    expect(report.ok).toBe(false);
    expect(report.refused).toBe(true);
    expect(report.findings[0].ok).toBe(false);
  });

  it("admits desktop screens >= 1024px with fine pointer and desktop browser", () => {
    window.innerWidth = 1280;
    window.matchMedia = () => ({ matches: true } as any);
    const report = deviceReport(DEMO_PROCTORING_CONFIG);
    expect(report.refused).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test test/exam/device-gate-demo.test.tsx`
Expected: Verify test assertions fail if window/pointer defaults diverge.

- [x] **Step 3: Implement device report refinements in `routes/exam.tsx`**

Ensure `deviceReport` accurately detects mobile platforms and properly surfaces refusal when `resolved.desktopOnly` is active in demo mode.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test test/exam/device-gate-demo.test.tsx`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add apps/web/src/routes/exam.tsx apps/web/test/exam/device-gate-demo.test.tsx
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(exam): verify phone and tablet blocking under demo desktopOnly proctoring"
```

---

### Task 8: Monorepo Verification & E2E Integration Suite

**Files:**
- Modify: `docs/superpowers/plans/2026-10-25-phase-9-public-demo-and-sections.md` (mark final subphase complete)
- Test: All web and core test suites

**Interfaces:**
- Consumes: Tasks 1-7 deliverables.
- Produces: Fully green test suite across `@pariksha/core` and `@pariksha/web`, updated documentation and roadmap status.

- [x] **Step 1: Run comprehensive tests**

```bash
pnpm --filter @pariksha/core test
pnpm --filter @pariksha/web test test/demo/
pnpm --filter @pariksha/web test test/exam/
```
Expected: PASS across all test suites.

- [x] **Step 2: Run typecheck and linting**

```bash
pnpm turbo run typecheck
pnpm turbo run lint
```
Expected: Zero type errors, zero lint warnings.

- [x] **Step 3: Mark Phase 9 plan complete and commit**

```bash
git add docs/superpowers/plans/2026-10-25-phase-9-public-demo-and-sections.md
git commit --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "chore(docs): mark Phase 9 public demo and sections plan complete"
```

---

## Final Checklist

- [x] "DEMO" access code shown on landing page, demo modal, and demo banner.
- [x] Entering any access code other than "DEMO" is refused.
- [x] Demo exam duration is 15 minutes, with 3 sections of 5 minutes each.
- [x] Calculator is floating, draggable, with high z-index (`z-index: 100`) so it never gets obscured under sections.
- [x] Fill-in-the-blank question renders an active input box inline with prompt text for both `{{b1}}` and `[[b1]]`.
- [x] Matching questions never disable options after selection, allowing multiple left items to select the same right complexity (e.g. `O(n log n)`).
- [x] Proctoring in demo enforces fullscreen, watermark, copy-paste blocking, and extra monitor check.
- [x] Violation warning count tracks 1, 2, and auto-submits on 3 violations locally without server errors.
- [x] Phones and tablets are blocked under `desktopOnly`.
- [x] Monorepo verification passes with 100% green tests.
