# Candidate Experience Anti-AI-Slop UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the candidate examination runtime into a calm, authoritative, anti-AI-slop interface compliant with Hallmark standards, fixing 13 FAILs, 20 REFLEXes, and 6 WARNs while preserving 100% of existing exam engine wiring and passing all existing tests.

**Architecture:** Refactor CSS token consumption in `exam.css` and `registration.css` to eliminate uppercase tracking and monospace voice leakage; refine `ExamLanding`, `Registration`, `Runner`, `Palette`, `SubmitDialog`, and `Receipt` components to deliver high-clarity pre-flight diagnostics, tactile answer inputs, pre-submission audit manifests, and authoritative submission credentials.

**Tech Stack:** TypeScript, React, CSS custom properties, Vitest, `@pariksha/core`, Hallmark Sloplint (`nutlope/hallmark`).

**Spec:** `docs/superpowers/specs/2026-11-02-candidate-ui-anti-slop-design.md`

## Global Constraints

- **Design System Invariants:** All colors and measurements must strictly consume tokens from `DESIGN.md` and `tokens.css`; zero hardcoded hex colors (`no-hex-colors.test.ts` must pass).
- **Hallmark Floor Rules:** Stamp at line 1 of CSS; no `transition: all`; no uppercase tracked labels (Rule 67); no monospace voice leakage on UI controls (Rule 64); strict 4px/8px modular spacing rhythm (Rule 24b).
- **Exam Runtime Invariants:** Candidate bundle budget $\le$ 300 KB gzipped; zero router library additions; preserve all existing data hooks, event listeners, proctoring lifecycle hooks, and testids.
- **Commit Format:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).

## Review Focus

1. **Accessibility & Contrast:** Label and heading text must achieve $\ge$ 4.5:1 contrast against cream background (`#fffbf5`); focus-visible rings must achieve $\ge$ 3:1 contrast.
2. **Device Gating Invariants:** Laptop/desktop $\ge 1024$px screen gate, pointer detection, and camera/mic gates must continue to correctly refuse/admit candidates without false negatives.
3. **Timer & Auto-Submit Integrity:** Tabular numeric countdown in `Clock.tsx` and autosave queue in `SaveBanner.tsx` must never be delayed, blocked, or visually displaced by layout shifts.
4. **Keyboard & Screen Reader Trapping:** `SubmitDialog` and modal panels must trap tab key navigation and return focus on close.
5. **No Visual Regressions in Existing Suites:** All 350+ tests in `apps/web/test/` must pass cleanly after each atomic commit.

---

### Task 1: CSS Typography, Token Hygiene, and Hallmark Stamp

**Files:**
- Modify: `apps/web/src/styles/exam.css:1-50`
- Modify: `apps/web/src/styles/exam.css` (throughout)
- Create: `apps/web/test/exam/exam-typography-anti-slop.test.ts`

**Interfaces:**
- Consumes: `DESIGN.md` typography tokens (`--font-display`, `--font-body`, `--font-mono`).
- Produces: Anti-slop typography rules in `exam.css` free of uppercase tracking and monospace leaks.

- [ ] **Step 1: Write failing test in `apps/web/test/exam/exam-typography-anti-slop.test.ts`**
  - Verify that `exam.css` starts with Hallmark stamp header.
  - Verify that `.exam-facts dt`, `.exam-options-legend`, `.exam-calc-title`, `.exam-result-table thead th`, and `.exam-proctor-banner-tag` do not have `text-transform: uppercase` or tracked `letter-spacing > 0.04em`.
  - Verify that `.exam-font-scale legend`, `.exam-view-choice`, and `.exam-field-label` do not declare `font-family: var(--font-mono)`.
  - Run: `pnpm --filter web test exam-typography-anti-slop` -> Expected: FAIL.

- [ ] **Step 2: Add Hallmark stamp at line 1 of `apps/web/src/styles/exam.css`**
  - Add:
    ```css
    /* Hallmark · v2.0.0 · modern-minimal · candidate runtime */
    ```

- [ ] **Step 3: Fix Rule 67 & Rule 64 typography violations in `apps/web/src/styles/exam.css`**
  - In `.exam-facts dt`: replace uppercase and letter-spacing with body face, sentence-case, untracked (`text-transform: none; letter-spacing: normal; font-family: var(--font-body);`).
  - In `.exam-calc-title`, `.exam-calc-grip`: replace uppercase/tracked styles with standard label typography.
  - In `.exam-options-legend`, `.exam-match-caption`, `.exam-field-label`: remove uppercase and monospace voice; use body face (`var(--font-body)`).
  - In `.exam-result-table caption`, `.exam-result-table thead th`, `.exam-review-number`: remove uppercase tracking and monospace font.
  - In `.exam-proctor-banner-tag`: replace uppercase tracked styling with clean, subtle badge styling.
  - In `.exam-font-scale legend`, `.exam-view-choice`: use `font-family: var(--font-body)`.

- [ ] **Step 4: Run typography test and sloplint**
  - Run: `pnpm --filter web test exam-typography-anti-slop` -> Expected: PASS.
  - Run: `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/exam.css --genre modern-minimal --scope app` -> Expected: 0 FAIL 67, 0 REFLEX 64.

- [ ] **Step 5: Run existing CSS regression tests**
  - Run: `pnpm --filter web test exam-css-fixes` -> Expected: PASS.
  - Run: `pnpm --filter web test no-hex-colors` -> Expected: PASS.

- [ ] **Step 6: Commit changes**
  - Command:
    ```bash
    git add apps/web/src/styles/exam.css apps/web/test/exam/exam-typography-anti-slop.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "style(web): add hallmark stamp and resolve rule 67 and 64 typography anti-patterns in candidate css"
    ```

---

### Task 2: 4px Spacing Rhythm & Geometry Invariants (Rule 24b, Rule 34, Rule F3)

**Files:**
- Modify: `apps/web/src/styles/exam.css`
- Modify: `apps/web/test/exam/exam-css-fixes.test.ts`

**Interfaces:**
- Consumes: `--space-*` tokens from `tokens.css`.
- Produces: Strict 4px modular rhythm and overflow-safe modal geometry.

- [ ] **Step 1: Write failing test in `apps/web/test/exam/exam-css-fixes.test.ts`**
  - Add test asserting `.exam-submit-confirm` declares `width: 100%` and `max-width: 440px` (without `100vw` or min-calc overflow).
  - Add test asserting `.exam-landing-hero h1` declares `text-wrap: balance`.
  - Add test asserting `.exam-timer` padding adheres to the 4px scale (`var(--space-base) var(--space-md)` or `8px 12px`).
  - Run: `pnpm --filter web test exam-css-fixes` -> Expected: FAIL.

- [ ] **Step 2: Fix Rule 34 overflow on `.exam-submit-confirm`**
  - In `apps/web/src/styles/exam.css`: replace `width: min(420px, calc(100vw - 64px))` with `width: 100%; max-width: 440px; box-sizing: border-box;`.

- [ ] **Step 3: Fix Rule 24b spacing rhythms in `exam.css`**
  - Replace `padding: 6px 12px` on `.exam-timer` and `.exam-font-scale` with `padding: var(--space-base) var(--space-md)` (8px 12px).
  - Replace `gap: 6px` on `.exam-view-choice` with `gap: var(--space-base)` (8px).
  - Replace `margin-bottom: 10px` on `.exam-calc-handle` with `margin-bottom: var(--space-md)` (12px).
  - Replace `padding: 14px 16px` on `.exam-option-row` with `padding: var(--space-md) var(--space-lg)` (12px 16px).
  - Replace `gap: 10px` on `.demo-banner-actions` and `gap: 6px` on `.demo-banner-badge` with 8px / 12px tokens.

- [ ] **Step 4: Add `text-wrap: balance` to display heads (Rule F3)**
  - In `.exam-landing-hero h1` and `.exam-submit-heading`: add `text-wrap: balance`.

- [ ] **Step 5: Run tests and sloplint**
  - Run: `pnpm --filter web test exam-css-fixes` -> Expected: PASS.
  - Run: `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/exam.css --genre modern-minimal --scope app` -> Expected: 0 FAIL 34, 0 REFLEX 24b.

- [ ] **Step 6: Commit changes**
  - Command:
    ```bash
    git add apps/web/src/styles/exam.css apps/web/test/exam/exam-css-fixes.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "style(web): enforce 4px spacing rhythms, balance display headings, and eliminate modal overflow"
    ```

---

### Task 3: Candidate Landing & Pre-Flight Diagnostics UI Refinement

**Files:**
- Modify: `apps/web/src/routes/exam.tsx:220-330` (CameraPreview & MicMeter)
- Modify: `apps/web/src/routes/exam.tsx:440-655` (ExamLanding)
- Modify: `apps/web/src/styles/exam.css`
- Modify: `apps/web/test/exam/exam-landing.test.tsx`

**Interfaces:**
- Consumes: `LandingPayload`, `deviceReport`, `acquireMedia`.
- Produces: Calm editorial masthead, video poster fallback, and unified pre-flight diagnostics board.

- [ ] **Step 1: Update tests in `apps/web/test/exam/exam-landing.test.tsx`**
  - Assert that `CameraPreview` renders video with `poster` attribute or SVG standby frame.
  - Assert that pre-flight readiness findings display accessible status indicators.
  - Run: `pnpm --filter web test exam-landing` -> Expected: FAIL (if checking poster).

- [ ] **Step 2: Add video poster fallback (Rule 28b) in `CameraPreview`**
  - In `apps/web/src/routes/exam.tsx`: add `poster="data:image/svg+xml,...` or subtle neutral fallback poster on the `<video>` element.

- [ ] **Step 3: Redesign Landing Masthead & Manifest**
  - In `apps/web/src/routes/exam.tsx` (`ExamLanding`):
    - Replace raw solid card header with an editorial masthead (`.exam-landing-masthead`) showing test name, organizer/institution tag, and state pill.
    - Style the facts grid (`.exam-facts`) into a clean 2x2 or 4-column manifest card with readable sentence-case labels.
  - In `apps/web/src/styles/exam.css`:
    - Add styles for `.exam-landing-masthead`, `.exam-manifest-card`, and refined `.exam-facts`.
    - Ensure unified button hierarchy (Rule F4): single solid primary "Start" / "Enter assessment", quiet secondary "Check device".

- [ ] **Step 4: Refine Pre-Flight Diagnostics Board**
  - Enhance `.exam-device-test-panel` with clean video framing, smooth rounded radius, and high-fidelity VU meter bar.

- [ ] **Step 5: Run tests and sloplint**
  - Run: `pnpm --filter web test exam-landing` -> Expected: PASS.
  - Run: `pnpm --filter web test blocking` -> Expected: PASS.
  - Run: `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/routes/exam.tsx apps/web/src/styles/exam.css --genre modern-minimal --scope app` -> Expected: 0 FAIL.

- [ ] **Step 6: Commit changes**
  - Command:
    ```bash
    git add apps/web/src/routes/exam.tsx apps/web/src/styles/exam.css apps/web/test/exam/exam-landing.test.tsx
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): elevate candidate landing and pre-flight diagnostics with editorial masthead and video poster"
    ```

---

### Task 4: Code Verification & Access Gate UI Upgrades

**Files:**
- Modify: `apps/web/src/components/exam/Registration.tsx`
- Modify: `apps/web/src/styles/registration.css`
- Modify: `apps/web/test/exam/registration.test.tsx`

**Interfaces:**
- Consumes: `LandingPayload["accessMode"]`, `client.register`.
- Produces: High-tactility access gate with segmented digit styling, 4px spacing, and dignified consent affirmation card.

- [ ] **Step 1: Check existing registration tests**
  - Run: `pnpm --filter web test registration.test.tsx` -> Confirm baseline pass.

- [ ] **Step 2: Fix Rule 24b spacing in `registration.css`**
  - Replace `padding: 10px var(--space-md)` on `input.text-input`, `select.text-input`, and `textarea.text-input` with `padding: var(--space-md)` (12px 16px).

- [ ] **Step 3: Enhance Access Gate & Code Verification styling**
  - In `apps/web/src/components/exam/Registration.tsx`:
    - Add segmented styling class (`.exam-access-code-input`) for access codes and OTP inputs with letter-spacing for easy scanning (`letter-spacing: 0.15em; font-family: var(--font-mono); font-size: 1.25rem; text-align: center;`).
    - Upgrade the consent checkbox container into an `.exam-consent-card` with an informative academic integrity notice.
  - In `apps/web/src/styles/registration.css`:
    - Add styles for `.exam-access-code-input` and `.exam-consent-card`.

- [ ] **Step 4: Run registration and sloplint tests**
  - Run: `pnpm --filter web test registration.test.tsx` -> Expected: PASS.
  - Run: `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/registration.css --genre modern-minimal --scope app` -> Expected: 0 REFLEX.

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/web/src/components/exam/Registration.tsx apps/web/src/styles/registration.css
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): polish access code verification and consent card in candidate registration"
    ```

---

### Task 5: Exam Runner Workspace, Low-Anxiety Clock & Palette Ergonomics

**Files:**
- Modify: `apps/web/src/styles/exam.css`
- Modify: `apps/web/src/components/exam/Clock.tsx`
- Modify: `apps/web/src/components/exam/Runner.tsx`
- Modify: `apps/web/test/exam/runner.test.tsx`
- Modify: `apps/web/test/exam/clock.test.tsx`

**Interfaces:**
- Consumes: `AttemptPaper`, `paletteStates`, `ClockAnchor`.
- Produces: Distraction-free question workspace, tactile option rows, and low-anxiety timer transitions.

- [ ] **Step 1: Run runner and clock test baselines**
  - Run: `pnpm --filter web test runner.test.tsx clock.test.tsx` -> Confirm baseline pass.

- [ ] **Step 2: Refine Option Row Ergonomics**
  - In `apps/web/src/styles/exam.css`:
    - Ensure `.exam-option-row` has minimum height 48px, 12px 16px padding, subtle border radius (`var(--radius-md)`), and clear hover state (`background: var(--color-hairline)`).
    - Ensure radio/checkbox markers have 20px dimension with 2px borders and distinct `:focus-visible` ring (`outline: 2px solid var(--color-voltage)`).

- [ ] **Step 3: Low-Anxiety Clock Styling**
  - In `apps/web/src/components/exam/Clock.tsx` and `exam.css`:
    - Maintain tabular numbers (`font-variant-numeric: tabular-nums`).
    - Ensure countdown at $> 10m$ is neutral; at $< 10m$ displays warm amber badge; at $< 2m$ displays controlled high-contrast highlight without abrupt flashing.

- [ ] **Step 4: Palette Grouping & State Clarity**
  - In `apps/web/src/styles/exam.css`:
    - Enhance palette squares: distinct 36px geometry, high-contrast answered state (green fill with white text), marked state (violet outline/fill), current state (voltage outline).

- [ ] **Step 5: Run tests**
  - Run: `pnpm --filter web test runner.test.tsx clock.test.tsx controls.test.tsx` -> Expected: PASS.

- [ ] **Step 6: Commit changes**
  - Command:
    ```bash
    git add apps/web/src/styles/exam.css apps/web/src/components/exam/Clock.tsx apps/web/src/components/exam/Runner.tsx
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): refine exam runner ergonomics, tactile option rows, and low-anxiety timer"
    ```

---

### Task 6: Pre-Submit Audit Manifest & Official Submission Credential (Receipt)

**Files:**
- Modify: `apps/web/src/components/exam/SubmitDialog.tsx`
- Modify: `apps/web/src/components/exam/Receipt.tsx`
- Modify: `apps/web/src/styles/exam.css`
- Modify: `apps/web/test/exam/submit.test.tsx`
- Modify: `apps/web/test/exam/receipt.test.tsx`

**Interfaces:**
- Consumes: `ReceiptPayload`, `SubmitDialog` props (`unanswered`, `marked`, `total`).
- Produces: Informative pre-submission manifest sheet and official credential submission receipt.

- [ ] **Step 1: Check baseline submit and receipt tests**
  - Run: `pnpm --filter web test submit.test.tsx receipt.test.tsx` -> Confirm baseline pass.

- [ ] **Step 2: Pre-Submission Audit Manifest in `SubmitDialog.tsx`**
  - In `SubmitDialog.tsx`:
    - Add structured breakdown cards for answered vs unanswered vs marked questions.
    - Keep primary and cancel buttons clearly labeled ("Submit and finish" vs "Keep working") with accessible `aria-modal="true"` tab trap.
  - In `exam.css`:
    - Style `.exam-submit-stats-grid` with clean hairline cards.

- [ ] **Step 3: Submission Certificate in `Receipt.tsx`**
  - In `Receipt.tsx`:
    - Add a "Copy Reference" button beside the Attempt ID code that triggers `navigator.clipboard.writeText` with transient feedback.
    - Format receipt header as an official submission confirmation card with timestamp in local time.
  - In `exam.css`:
    - Add styles for `.exam-receipt-card` and copy button.

- [ ] **Step 4: Run tests**
  - Run: `pnpm --filter web test submit.test.tsx receipt.test.tsx` -> Expected: PASS.

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/web/src/components/exam/SubmitDialog.tsx apps/web/src/components/exam/Receipt.tsx apps/web/src/styles/exam.css
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(web): upgrade submit dialog to pre-submission audit sheet and receipt to official credential"
    ```

---

### Task 7: Full Test Suite, Hallmark Sloplint & A11y Verification

**Files:**
- Review: Entire candidate surface diff (`git diff HEAD~6`)
- Verify: Full test suite

- [ ] **Step 1: Run Hallmark Sloplint on all modified files**
  - Run: `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/exam.css apps/web/src/styles/registration.css apps/web/src/routes/exam.tsx --genre modern-minimal --scope app`
  - Expected: 0 FAILs, 0 un-waived REFLEXes.

- [ ] **Step 2: Run design system token & contrast suites**
  - Run: `pnpm --filter web test no-hex-colors` -> Expected: PASS.
  - Run: `pnpm --filter web test no-literal-radius-or-font-size` -> Expected: PASS.
  - Run: `pnpm --filter web test contrast` -> Expected: PASS.

- [ ] **Step 3: Run entire exam test suite**
  - Run: `pnpm --filter web test exam` -> Expected: All tests pass.

- [ ] **Step 4: Final branch review & commit**
  - Command:
    ```bash
    git commit --allow-empty -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "chore(web): complete candidate anti-slop ui redesign verification"
    ```
