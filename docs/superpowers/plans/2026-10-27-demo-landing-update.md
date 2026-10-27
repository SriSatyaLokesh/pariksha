# Demo Landing Update — Phase 9 Subphase

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task‑by‑task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public demo entry on the landing page, expose the fixed access code `DEMO`, and enforce demo‑mode constraints (fullscreen, watermark, floating calculator, device restrictions, violation limit, timer limits) so the demo is ready before Phase 10 starts.

**Architecture:** The landing page (`apps/web/src/pages/landing.tsx` or similar) links to the exam UI with `?demo=true`. `demo-client.ts` will expose the access code and enforce UI restrictions via a new `DemoConfig` object consumed by the exam runner.

**Tech Stack:** TypeScript (strict), React/Preact, Hono API, `@pariksha/core`, Vitest, Playwright.

**Spec:** `docs/superpowers/plans/2026-10-25-phase-9-public-demo-and-sections.md` (Phase 9 spec) – we extend it with UI‑only demo constraints.

## Global Constraints
- Access code for demo must be the literal string `DEMO` and shown prominently on the landing page.
- Demo UI must start in fullscreen mode with a semi‑transparent watermark overlay.
- Calculator component must be floating, draggable, and rendered above section panes.
- Phones, tablets, and copy‑paste must be blocked in demo mode.
- Detect and reject usage of extra monitors (multi‑screen detection).
- Demo violations limit = 3 before the demo session aborts.
- Total demo exam time = 15 min; each section = 5 min.
- All UI must comply with WCAG 2.1 AA; warnings for violations must be displayed.

## Review Focus
- Verify that the access code is never hard‑coded elsewhere besides `demo-client.ts`.
- Ensure the fullscreen and watermark implementation does not break existing routing.
- Confirm draggable calculator does not interfere with section navigation.
- Test that device‑blocking logic correctly identifies phones/tablets via user‑agent.
- Validate multi‑monitor detection works in browsers that expose `window.screen` APIs.
- Check that violation counting resets on demo exit.

---

### Task 1: Add Demo CTA to Landing Page

**Files:**
- Modify: `apps/web/src/pages/landing.tsx`
- Test: `apps/web/test/pages/landing-demo.test.tsx`

**Interfaces:**
- Consumes: none (static UI).
- Produces: a `<Link>` button labeled "Public Demo" navigating to `/exam?demo=true` and displaying the access code `DEMO`.

- [ ] **Step 1: Write the failing test**
```tsx
import { render, screen } from "@testing-library/react";
import Landing from "../../src/pages/landing";

test("shows demo CTA with access code", () => {
  render(<Landing />);
  const btn = screen.getByRole("link", { name: /public demo/i });
  expect(btn).toBeInTheDocument();
  expect(btn).toHaveAttribute("href", "/exam?demo=true");
  expect(screen.getByText(/access code: demo/i)).toBeInTheDocument();
});
```
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement CTA button and access‑code label**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

---

### Task 2: Expose Fixed Access Code in Demo Client

**Files:**
- Modify: `apps/web/src/lib/demo-client.ts`
- Test: `apps/web/test/lib/demo-client-accesscode.test.ts`

**Interfaces:**
- Consumes: existing `createDemoClient` factory.
- Produces: `access(): Promise<{ entryToken: string }>` returning `{ entryToken: "DEMO" }`.

- [ ] **Step 1: Write failing test**
```ts
import { createDemoClient } from "../src/lib/demo-client";

test("demo client returns fixed access code", async () => {
  const client = createDemoClient();
  const { entryToken } = await client.access();
  expect(entryToken).toBe("DEMO");
});
```
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Change `access` implementation to return `DEMO`**
- [ ] **Step 4: Verify test passes**
- [ ] **Step 5: Commit**

---

### Task 3: Enforce Demo‑Mode UI Constraints (Fullscreen, Watermark, Device Blocking)

**Files:**
- Create: `apps/web/src/components/demo/DemoOverlay.tsx`
- Modify: `apps/web/src/exam-main.tsx` to import and render `DemoOverlay` when `isDemo` is true.
- Test: `apps/web/test/components/demo/DemoOverlay.test.tsx`

**Interfaces:**
- Consumes: `isDemo` flag from URL search params.
- Produces: Fullscreen request (`document.documentElement.requestFullscreen()`), watermark `<div>` with class `demo-watermark`, and a hook that blocks copy/paste events and disables UI on phones/tablets (`navigator.userAgent`).

- [ ] **Step 1: Write failing test** – verify that when `isDemo` true, the `DemoOverlay` mounts, triggers fullscreen, and adds watermark element.
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Implement `DemoOverlay` with `useEffect` that requests fullscreen, injects watermark, adds `copy`, `paste` event listeners that `preventDefault()`, and checks `isMobile()` helper to hide UI controls.
- [ ] **Step 4: Run test (passes)**
- [ ] **Step 5: Commit**

---

### Task 4: Floating, Draggable Calculator Component

**Files:**
- Create: `apps/web/src/components/demo/Calculator.tsx`
- Modify: `apps/web/src/components/exam/Runner.tsx` to import and render `<Calculator />` when `isDemo`.
- Test: `apps/web/test/components/demo/Calculator.test.tsx`

**Interfaces:**
- Consumes: none beyond demo flag.
- Produces: a floating toolbar with basic arithmetic functions, draggable via `react-draggable` (or a small custom pointer‑move handler).

- [ ] **Step 1: Write failing test** – render exam in demo mode, ensure a `calculator` element exists, can be moved (simulate drag) and remains above section panes.
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Implement `Calculator` component with a minimal UI, `position: absolute`, and drag handlers.
- [ ] **Step 4: Verify drag works and test passes.
- [ ] **Step 5: Commit**

---

### Task 5: Multi‑Monitor Detection & Violation Counter

**Files:**
- Modify: `apps/web/src/lib/demo-client.ts` to add `detectExtraMonitors(): boolean` using `window.screen` dimensions.
- Create: `apps/web/src/components/demo/ViolationGuard.tsx` that tracks violations (device block, copy/paste, extra monitor) and aborts after 3.
- Test: `apps/web/test/components/demo/ViolationGuard.test.tsx`

**Interfaces:**
- Consumes: `isDemo` flag.
- Produces: a global `demoViolations` state (React context) incremented on each blocked action; when count >= 3, shows overlay “Demo session terminated due to policy violations”.

- [ ] **Step 1: Write failing test** – simulate three violations and expect termination overlay.
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Implement detection logic and violation guard.
- [ ] **Step 4: Verify test passes.
- [ ] **Step 5: Commit**

---

### Task 6: Demo Exam Timer Configuration (15 min total, 5 min per section)

**Files:**
- Modify: `apps/web/src/lib/demo-client.ts` – add `demoConfig` exposing `totalTimeMs: 15 * 60_000` and `sectionTimeMs: 5 * 60_000`.
- Adjust: `apps/web/src/components/exam/Timer.tsx` to read from `demoConfig` when `isDemo`.
- Test: `apps/web/test/components/exam/Timer.demo.test.tsx`

**Interfaces:**
- Consumes: `isDemo` flag and `demoConfig`.
- Produces: accurate countdown timers; when a section timer expires, auto‑advance to next section.

- [ ] **Step 1: Write failing test** – mount `Timer` in demo mode, fast‑forward time, ensure it switches sections after 5 min and ends after 15 min.
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Implement config and timer adjustments.
- [ ] **Step 4: Verify test passes.
- [ ] **Step 5: Commit**

---

### Task 7: End‑to‑End Demo Flow Integration Test

**Files:**
- Create: `apps/web/test/e2e/demo-flow.test.ts` (Playwright).
- No new source files; just orchestration.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: an automated E2E scenario that navigates to the landing page, clicks the demo CTA, verifies the access code is displayed, validates fullscreen, watermark, draggable calculator, and timers run correctly. Also checks that after 3 violations the session ends.

- [ ] **Step 1: Write failing Playwright test** – script the full flow.
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Run the full suite after implementing previous tasks.
- [ ] **Step 4: Verify E2E passes.
- [ ] **Step 5: Commit**

---

### Task 8: Documentation & README Update

**Files:**
- Update: `docs/README.md` – add a section “Public Demo” with the fixed access code `DEMO` and usage notes.
- Update: `apps/web/src/lib/demo-client.ts` JSDoc to describe constraints.

- [ ] **Step 1: Write failing test** – check that the README contains the string `Access code: DEMO`.
- [ ] **Step 2: Run test (fails)**
- [ ] **Step 3: Add documentation.
- [ ] **Step 4: Verify test passes.
- [ ] **Step 5: Commit**

---

## Final Checklist
- [ ] All tasks above completed, tests passing, CI green.
- [ ] Demo UI works end‑to‑end on deployed landing page.
- [ ] Phase 9 subphase marked complete; ready to start Phase 10.

