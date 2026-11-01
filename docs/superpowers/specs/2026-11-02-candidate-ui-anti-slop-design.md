# Candidate Experience Anti-AI-Slop UI/UX Redesign Specification

**Date:** 2026-11-02  
**Platform:** Pariksha Candidate Runtime (`apps/web`)  
**Methodology:** Hallmark Anti-Slop Design Skill (`nutlope/hallmark`), Pariksha `DESIGN.md` Foundation, WCAG 2.1 AA  
**Status:** Design Proposal & PR Implementation Plan  

---

## Executive Summary

Pariksha's candidate runtime is the most high-stakes, anxiety-sensitive surface in the entire platform. Candidates arriving for an assessment often experience elevated cognitive load and stress. Every visual element must convey unshakeable reliability, academic authority, calm focus, and accessibility.

Currently, several candidate screens carry subtle but compounding signs of **"AI slop"**—design defaults that language models and boilerplate templates fall into:
1. **Harsh, jarring color blocks** (e.g., solid `#e24c18` vermilion flood headers abruptly colliding with pale cream canvas).
2. **Aggressive tracked uppercase labels** (e.g., `DURATION`, `QUESTIONS`, `SECTION`) mimicking generic dashboard templates.
3. **Overuse of monospace typefaces** for normal UI labels, captions, and table headings rather than preserving monospace strictly for code, tabular figures, and hashes.
4. **Generic, detached diagnostic panels** for device/camera/microphone checks that feel like afterthought developer testbenches.
5. **Clunky modal dialogs and abrupt red countdown timers** that induce unnecessary candidate panic.

This document executes a **Two-Step Review Process**:
- **Review 1 (Audit & Diagnostics):** An exhaustive static and qualitative review using Hallmark's Floor and Gates, identifying all 13 FAILs, 20 REFLEX violations, and 6 WARNs alongside core UX friction points across Candidate Landing, Code Verification/Registration, Exam Runner, Submit Dialog, and Receipt.
- **Review 2 (Adversarial Design Critique & Anti-Slop Architecture):** A second-pass critique stress-testing the proposed UI system against high-stakes exam ergonomics, typography isolation, tactile accessibility, and anxiety reduction.
- **PR Implementation Plan:** A task-by-task atomic engineering plan ready to execute as a clean pull request.

---

## 1. Step 1 Review: Comprehensive Audit of Existing Screens

### 1.1 Automated Sloplint Audit Findings (`sloplint.mjs`)
Running Hallmark's `sloplint.mjs` against `apps/web/src/styles/exam.css`, `registration.css`, and `routes/exam.tsx` produced **13 FAILs, 20 REFLEXes, and 6 WARNs**:

| Rule / Gate | Severity | Locations / Selectors | Defect & Anti-Pattern Description |
|---|---|---|---|
| **Rule 20** | **FAIL** | `exam.css:1` | Missing Hallmark CSS stamp header and critique line at line 1. |
| **Rule 34** | **FAIL** | `.exam-submit-confirm` (`exam.css:1686`) | `width: min(420px, calc(100vw - 64px))` causes viewport overflow on small screens / mobile viewports. |
| **Rule 67** | **FAIL** (x10) | `.exam-facts dt`, `.exam-calc-title`, `.exam-calc-grip`, `.exam-options-legend`, `.exam-match-caption`, `.exam-field-label`, `.exam-result-table caption`, `.exam-result-table thead th`, `.exam-review-number`, `.exam-proctor-banner-tag` | **Tracked Uppercase in Label Roles:** Uppercase tracked (0.05em–0.14em) text used across UI labels, headings, and tables. Violates Rule 67 ("Labels, captions, and table heads must be sentence or lowercase, untracked"). |
| **Rule 64** | **REFLEX** (x7) | `.exam-font-scale legend`, `.exam-view-choice`, `.exam-options-legend`, `.exam-match-caption`, `.exam-field-label`, `.exam-result-table caption`, `.exam-result-table thead th` | **Monospace Voice Leakage:** Monospace font applied to UI controls and captions instead of reserving monospace strictly for programming code and tabular digits. |
| **Rule 24b** | **REFLEX** (x8) | `.exam-timer` (6px 12px), `.exam-font-scale` (6px 12px), `.exam-view-choice` (gap 6px), `.exam-calc-handle` (margin 10px), `.exam-option-row` (padding 14px 16px), `.demo-banner-*` (10px, 6px) | **Off-Scale Spacing:** Arbitrary 6px, 10px, and 14px padding/margins deviating from the strict 4px/8px modular rhythm. |
| **Rule 47b** | **REFLEX** | `.palette-square.has-notch` | Redrawn faux chrome / decorative notch. |
| **Rule 28b** | **REFLEX** | `exam.tsx:239` (`<video>`) | Camera preview `<video>` tag rendered without poster fallback frame. |
| **Rule 3** | **WARN** (x2) | `.exam-assertion-reason`, `.reorderable-list__item.is-drop-target` | Thick decorative side-stripe border (`border-inline-start: 3px/4px`). |
| **Rule F3** | **WARN** | `.exam-landing-hero h1` | Missing `text-wrap: balance` on display headings. |
| **Rule F4** | **WARN** | `.exam-landing-actions button`, `.demo-banner-btn` | Multiple conflicting filled primary button recipes on one screen. |
| **Rule F7** | **WARN** | 17 container selectors | Uniform container recipe stamped across disparate components without role-specific hierarchy. |

---

### 1.2 Screen-by-Screen Qualitative UX & Anti-Slop Audit

#### A. Candidate Landing Screen (`ExamLanding`)
- **Visual Loudness vs Calm Tone:** The full-bleed `.card-voltage` banner (`background: #e24c18`, text: `#fffbf5`) dominates the top half of the screen. In an exam context, intense full-bleed red/orange triggers subliminal alarm rather than steady confidence.
- **The "Facts Dump":** Duration, question count, and schedule are laid out in a raw definition list `<dl>` with tracked uppercase titles (`DURATION`, `QUESTIONS`) reminiscent of generic auto-generated admin templates.
- **Detached Device Testing:** The "Check my device" flow opens an ad-hoc inline panel showing an unstyled native `<meter>` VU meter and an unadorned webcam box. It feels like an unpolished internal debug tool rather than a reassuring pre-flight cockpit.
- **Action Hierarchy Confusion:** "Check my device" and "Start" buttons compete for visual attention with identical styling until disabled states kick in.

#### B. Access Gate & Code Verification (`ExamRegistration`)
- **Disconnected Access Modes:** `link_code`, `email_code`, and `invite_only` use plain text input fields without digit grouping, formatted spacing, or autofocus ergonomics.
- **OTP Friction:** For email OTP verification, there is no segmented 6-digit pin input, no clear countdown to resend, and no smooth visual transition between entering an email and verifying the code.
- **Consent Checkbox Placement:** The proctoring/terms consent checkbox floats above the form fields as an easily overlooked generic checkbox rather than an intentional, dignified agreement card.

#### C. Exam Runner Shell (`Runner`, `Palette`, `Clock`, `AnswerInput`)
- **Cognitive Clutter in Question Palette:** The question palette currently renders 17 uniform boxes per row with small numeric glyphs. On tests with 50+ questions, the density creates visual vibration.
- **Timer Stress:** The countdown clock uses plain text styling that turns into an alarming red callout without progressive visual dampening.
- **Answer Selection Ergonomics:** Radio buttons and checkboxes in `AnswerInput` rely on traditional browser styling wrapped in generic card rows. They lack the tactile presence, clear active states, and keyboard navigation indicators expected in professional assessment software.
- **Tool Clutter:** Floating tools (scientific calculator, font sizing, contrast switcher) appear as disconnected popups rather than a unified exam utility toolbar.

#### D. Submission Dialog & Receipt (`SubmitDialog`, `Receipt`)
- **Binary Modal Shock:** Clicking "Submit test" triggers a narrow confirmation dialog (`.exam-submit-confirm`) with plain paragraph text. If a candidate accidentally missed 5 questions across 3 sections, they get a text warning rather than an interactive pre-submission audit sheet allowing them to review unanswered questions directly.
- **Receipt Presentation:** The submission receipt is rendered as a plain list of key-value pairs rather than an authoritative, archival-grade digital submission certificate with cryptographic proof.

---

## 2. Step 2 Review: Adversarial Design Critique & Anti-Slop Architecture

To establish an **anti-AI-slop** design that avoids both generic Silicon Valley corporate aesthetics (purple gradients, Inter-only, floaty rounded pills) and chaotic brutalism, the candidate experience must adopt an **Editorial Academic Modernism** direction:
- **Calm, Authoritative Surfaces:** Grounded in Pariksha's warm cream (`#fffbf5`) canvas, rich warm ink (`#231f1d`), subtle hairline structural rules (`#efebe6`), and using Voltage (`#e24c18`) strictly as an intentional precision mark (focus rings, current question indicators, critical alerts)—never as a background wallpaper.
- **Disciplined Typographic Hierarchy:**
  - *Display / Section Headings:* `Anek Latin` / `Bricolage Grotesque`, sentence case, untracked, with `text-wrap: balance`.
  - *Body / Form Elements:* `Anek Latin` (clean, humanist, multi-script support for Latin, Telugu, Devanagari) at 16px/24px line height.
  - *Metrics & Code:* `JetBrains Mono` with `font-variant-numeric: tabular-nums` strictly reserved for the countdown timer, question indices, score metrics, and code blocks.
- **Modular 4px Spatial Grid:** Strict elimination of arbitrary 6px, 10px, or 14px spacings in favor of 4px/8px/12px/16px/24px/32px scale.
- **Sensory Reassurance & Low Cognitive Load:** Pre-flight checklist replaces fragmented buttons; question runner provides clear spatial awareness without distracting animations.

---

### 2.1 The Redesigned Screen System

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CANDIDATE JOURNEY FLOW                          │
│                                                                        │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────┐  │
│  │ 1. LANDING &     │ ───► │ 2. VERIFICATION  │ ───► │ 3. EXAM      │  │
│  │    PRE-FLIGHT    │      │    & ACCESS GATE │      │    RUNNER    │  │
│  └──────────────────┘      └──────────────────┘      └──────────────┘  │
│           │                                                  │         │
│           │                                                  ▼         │
│           │                                          ┌──────────────┐  │
│           │                                          │ 4. PRE-SUBMIT│  │
│           │                                          │    AUDIT     │  │
│           │                                          └──────────────┘  │
│           │                                                  │         │
│           ▼                                                  ▼         │
│  ┌──────────────────┐                                ┌──────────────┐  │
│  │ RESULT LOOKUP    │ ◄───────────────────────────── │ 5. OFFICIAL  │  │
│  │ (POST-EXAM)      │                                │    RECEIPT   │  │
│  └──────────────────┘                                └──────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

#### Screen 1: Candidate Landing & Pre-Flight Cockpit
- **Hero:** Refined masthead replacing the solid orange flood. Features the institution / test name in balanced display type (`Anek Latin`, 44px, 500 weight), an organizer badge, and a calm status pill (`Open`, `Scheduled`).
- **Exam Manifest Card:** A structured grid showing Duration (with humanized breakdown, e.g., "90 minutes • 3 sections"), Total Questions, and Closing Window.
- **Unified Pre-Flight Diagnostics Board:**
  - Replaces the hidden "Check my device" button with an upfront, interactive **Pre-Flight Readiness Bar**:
    - **Display & Browser:** Automatically reports screen resolution and browser compatibility with green check indicators.
    - **Camera & Mic Preview:** If proctoring is enabled, shows a compact, elegant video viewport (with smooth rounded corners and poster state) and an active canvas-based audio wave indicator.
  - Once verified, the primary **"Enter Assessment"** button transitions into an active, confidence-inspiring state.

#### Screen 2: Access Gate & Code Verification
- **Segmented Digit Input:** For access codes and OTP tokens, replaces standard text inputs with an accessible, high-legibility segmented pin input (with auto-focus, paste interception, and clear keyboard navigation).
- **Contextual Help & Resend Counter:** Clear, non-technical instructions with a 30-second quiet countdown for OTP resend.
- **Affirmation Card:** Replaces the lonely checkbox with an **Agreement & Proctoring Notice** card detailing the exam integrity rules in plain language, signed off with a single explicit confirmation toggle.

#### Screen 3: Exam Runner Workspace
- **Top Utility Rail:**
  - Left: Test title, current section pill, and progress indicator (`Question 14 of 45`).
  - Center: **Low-Anxiety Countdown Timer:** Monospace tabular numbers (`01:24:30`) on a neutral chip. At `< 10m` transitions to warm amber; at `< 2m` pulses subtly with high-contrast indicator.
  - Right: Auto-save status indicator (`Saved` with subtle checkmark; `Saving…`; `Offline queue: 2 items`) + Assistive tools (Calculator, Type size adjuster).
- **Main Canvas (2-Column Desktop Grid):**
  - **Question Pane (Left 65%):**
    - Section breadcrumb and Question ID in subtle muted mono.
    - Question stem in high-contrast `Anek Latin` (18px, 1.6 line height) with LaTeX math and code formatting.
    - Option rows: Generous 48px min-height targets with clear radio/checkbox rings, distinct `:hover` background shift, and an unmistakable 2px focus ring.
    - Action footer: Previous, Clear Answer, Mark for Review (toggle with quiet purple badge), and Next / Save & Advance.
  - **Navigation Palette Rail (Right 35%):**
    - Clean visual grouping by Section.
    - 4 distinct geometric/chromatic states:
      - *Answered:* Solid `#0d7a51` (forest green) with white numeral.
      - *Marked for Review:* Crisp `#6a4ddb` (violet) with subtle flag badge.
      - *Current:* High-contrast 2px `#e24c18` (voltage) outline on cream.
      - *Unanswered:* Hairline-bordered neutral square.
      - *Locked:* Muted lock glyph for non-backtracking tests.
    - Tally Bar: Live summary (`18 Answered • 3 Marked • 4 Unanswered`).

#### Screen 4: Pre-Submission Audit Sheet (`SubmitDialog`)
- Replaces the generic small popup with a **Pre-Submission Audit Sheet**:
  - Highlights answered vs unanswered questions per section with clickable shortcut chips (`Question 4 in Section B is unanswered [Review]`).
  - Confirms remaining time.
  - Final irreversible submission confirmation requires a deliberate, double-intent click action (`Submit & Finish Assessment`).

#### Screen 5: Digital Submission Credential (`Receipt`)
- Designed as an official **Certificate of Submission**:
  - Authoritative header with confirmation stamp icon.
  - Prominently displays the cryptographic Attempt ID with a 1-click "Copy Reference Code" button.
  - Exact submission timestamp in the candidate's local timezone.
  - Summary metrics: Sections completed, total questions answered.
  - Downloadable/Printable PDF/Receipt trigger for institutional records.

---

## 3. Pull Request Implementation Plan

### PR Title:
`feat(web): anti-slop candidate UI redesign and hallmark compliance`

### Branch Name:
`feature/candidate-anti-slop-ui`

### Overview of PR Changes:
1. **CSS Token & Hygiene Fixes (`exam.css`, `registration.css`, `tokens.css`):**
   - Add Hallmark line 1 stamp and critique header.
   - Fix all Rule 67 violations: convert uppercase tracked labels (`.exam-facts dt`, table headers, legends, tags) into untracked sentence-case type in `Anek Latin`.
   - Fix all Rule 64 violations: isolate `JetBrains Mono` strictly to numeric timers, attempt reference codes, and code blocks.
   - Enforce strict 4px/8px modular spacing scale across timer, font toggles, and option rows.
   - Resolve Rule 34 modal width overflow on `.exam-submit-confirm`.
   - Add `text-wrap: balance` to all candidate display headings.
2. **Component Enhancements:**
   - **`ExamLanding` (`apps/web/src/routes/exam.tsx`):**
     - Replace full-bleed orange hero with an editorial masthead.
     - Build integrated Pre-Flight Diagnostics Board with camera preview poster and native visualizer.
     - Establish unified primary/secondary action hierarchy.
   - **`ExamRegistration` (`apps/web/src/components/exam/Registration.tsx`):**
     - Segmented code/OTP verification input.
     - Cohesive terms & proctoring consent affirmation card.
   - **`Runner` & `Palette` (`apps/web/src/components/exam/`):**
     - High-contrast tactile option selection rows.
     - Refined question palette with high-density grouping and clear accessibility labeling.
     - Ergonomic exam utility bar.
   - **`SubmitDialog` & `Receipt` (`apps/web/src/components/exam/`):**
     - Pre-submission manifest showing unanswered jump links.
     - Certificate-grade submission receipt with copyable verification token.
3. **Automated Verification:**
   - Sloplint gate: 0 FAILs, 0 un-waived REFLEXes.
   - Vitest suite: All existing 350+ unit and regression tests pass cleanly.

---

### Task Breakdown & Atomic Commit Schedule

| Step | Scope | Target Files | Key Actions | Verification Command |
|---|---|---|---|---|
| **Task 1** | CSS Typography & Hallmark Stamp | `apps/web/src/styles/exam.css`, `registration.css` | Insert Hallmark stamp; remove uppercase tracking on `.exam-facts dt`, legends, table heads; isolate monospace voice to numbers/code. | `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/exam.css --genre modern-minimal --scope app` |
| **Task 2** | Spacing Rhythm & Geometry Fixes | `apps/web/src/styles/exam.css`, `base.css` | Fix Rule 24b spacing rhythms (6px/10px -> 8px/12px); fix `.exam-submit-confirm` width to `100%` within container padding; remove side-stripes. | `pnpm --filter web test exam-css-fixes` |
| **Task 3** | Candidate Landing & Diagnostics UI | `apps/web/src/routes/exam.tsx`, `apps/web/src/styles/exam.css` | Redesign landing masthead; implement integrated Pre-Flight Readiness board with video poster and audio meter styling; balance headings. | `pnpm --filter web test test/exam/blocking.test.tsx` |
| **Task 4** | Code Verification & Access Gate UI | `apps/web/src/components/exam/Registration.tsx`, `registration.css` | Implement segmented pin input styling for OTP/access codes; redesign consent affirmation card; refine error presentation. | `pnpm --filter web test test/exam/registration.test.tsx` |
| **Task 5** | Exam Runner Ergonomics & Palette | `apps/web/src/components/exam/Runner.tsx`, `Palette.tsx`, `Clock.tsx`, `AnswerInput.tsx` | Refine question option row active/hover states; enhance palette square contrast and section grouping; style low-anxiety timer transitions. | `pnpm --filter web test test/exam/runner.test.tsx test/exam/clock.test.tsx` |
| **Task 6** | Pre-Submit Manifest & Official Receipt | `apps/web/src/components/exam/SubmitDialog.tsx`, `Receipt.tsx` | Implement section breakdown in submit dialog; upgrade receipt into credential layout with copyable reference button. | `pnpm --filter web test test/exam/submit.test.tsx test/exam/receipt.test.tsx` |
| **Task 7** | Full Suite & Accessibility Verification | Whole Candidate Surface | Run full test suite, contrast checkers, axe-core a11y tests, and final `sloplint` sweep. | `pnpm --filter web test` and `node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/exam.css apps/web/src/routes/exam.tsx --genre modern-minimal --scope app` |

---

## 4. Verification & Quality Gates

Before merging the PR, the candidate surface must pass all quality gates:
1. **Hallmark Anti-Slop Linter:**
   ```bash
   node .agents/skills/hallmark/scripts/sloplint.mjs apps/web/src/styles/exam.css apps/web/src/routes/exam.tsx --genre modern-minimal --scope app
   ```
   *Expected Result:* 0 FAILs, 0 unexpected REFLEXes, clean stamp header.
2. **Design System & Contrast Invariants:**
   ```bash
   pnpm --filter web test no-hex-colors
   pnpm --filter web test no-literal-radius-or-font-size
   pnpm --filter web test contrast
   ```
   *Expected Result:* All CSS rules consume declared tokens; contrast meets WCAG 2.1 AA (4.5:1 for body text, 3:1 for large display heads and active focus rings).
3. **Candidate Experience Unit & Regression Tests:**
   ```bash
   pnpm --filter web test test/exam/
   ```
   *Expected Result:* 100% test pass rate across all device gates, camera gates, timer anchors, question palette navigation, and submission flows.
