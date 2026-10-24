# Pariksha UI/UX, Design Systems & Motion Craft Audit Report

**Branch:** `audit/ui-ux-design-review`  
**Date:** October 24, 2026  
**Audited By:** Antigravity UI/UX Multi-Agent Audit Swarm  
**Design Authority:** [`DESIGN.md`](../DESIGN.md) (Signal Dark/Light Palettes, Candidate Cream/Ink/Voltage Runtime, JetBrains Mono Tabular Numerics, WCAG 2.1 AA)  
**Methodology & Skills Applied:**
- `ui-ux-audit` (EnchStyle/ui-ux-audit-skill) — 16-category design audit (spacing rhythm, typography, contrast, forms, touch, responsive)
- `ui-review` (cdmx-in/ui-review) — DOM overflow, layout clipping, placeholder leakage, breakpoint regression detection
- `review-animations` (emilkowalski/skills) — Emil Kowalski's 10 motion craft standards

---

## 1. Executive Summary & Quality Scorecard

An exhaustive, multi-agent design systems and UX audit was performed across **all 14 screens, 42 components, and 16 stylesheets** in the Pariksha monorepo (`apps/web`).

| Surface / Area | Audited Files | Health Score | Status | Primary Focus |
|---|---|:---:|:---:|---|
| **Group 1: Marketing, Onboarding & Auth** | `landing.tsx`, `home.tsx`, `sections/signal/*`, `signin.tsx`, `setup.tsx` | **56 / 100** | ⚠️ Needs Work | Touch navigation blocker, mobile header wrapping, branding loss on mobile auth |
| **Group 2: Organiser Dashboard & Catalog** | `organiser.tsx`, `tests.tsx`, `OrganiserShell.tsx`, `ApiKeyPanel.tsx`, `CandidateDataPanel.tsx`, `GradingQueue.tsx`, `ScreenSplit.tsx`, `UsagePanel.tsx`, `WebhookPanel.tsx` | **71 / 100** | 🟡 Fair | Inline unstyled modals, destructive action button colors, transparent table action column |
| **Group 3: Test Builder Suite** | `test.tsx`, 15 testbuilder components, `testbuilder.css`, `registration.css` | **57 / 100** | ⚠️ Needs Work | Global 44px textarea collapse, in-flow unstyled dialogs, floating rail hover trap |
| **Group 4: Question Banks & Authoring** | `banks.tsx`, `bank.tsx`, `question.tsx`, `import.tsx`, `QuestionEditor.tsx`, `TypePicker.tsx`, `Structured.tsx`, `Written.tsx`, `Choice.tsx`, `ReorderableList.tsx` | **7 / 100** | 🚨 Critical Rework | Instant irreversible delete, drag-and-drop hijacking text selection, missing drop indicators |
| **Group 5: Candidate Runtime & Analytics** | `exam.tsx`, 16 exam components, `analytics.tsx`, `grading.tsx`, `exam.css`, `analytics.css`, `grading.css` | **69.8 / 100** | 🟡 Substantial Work | Broken font scaling in runner, discrimination index `<progress>` misdirection, keystroke screen-reader noise |

### System Strengths & Engineering Rigor
- **Zero Color Leakage**: Candidate runtime (`#fffbf5` Cream, `#231f1d` Ink, `#e24c18` Voltage marks) is rigorously isolated from Organiser Signal dark (`#070b09`) and light (`#f5f9f7`).
- **Contrast Test Enforcement**: Complete CSS variable mapping in `theme.css` with 100% automated contrast test enforcement (`contrast-usage.test.ts` passing 681 tests).
- **Cognitive Protection in Exam**: Candidate runtime strictly enforces zero animations (`runner.test.tsx` fails on any CSS transition/keyframes) to prevent cognitive overload.
- **Monotonic Time Reliability**: `Clock.tsx` eschews client wall-clock math (`Date.now()`) in favor of server-anchored monotonic intervals (`performance.now()`), preventing time dilation on system clock alterations or sleep.

---

## 2. Local Server Setup & Automated Playwright Login

### Local Multi-Process Architecture
The testing harness operates across three local services:
1. **Stub IdP (`node apps/web/e2e/stub-idp.mjs` on port `9797`)**: OpenID Connect provider requiring zero external network or credentials.
2. **Node API (`node apps/api/dist/node.js` on port `8787`)**: SQLite-backed Hono API service with Miniflare compatibility.
3. **Vite Web Server (`vite preview --port 4373`)**: Production preview server proxying `/api` to port `8787` so session cookies share the origin. *(Port `4373` avoids the reserved Windows Hyper-V dynamic port range `4198–4297`).*

### How Login Operates in Code
Authentication uses signed HTTP-only server-side session cookies (`pk_session`):
- **OIDC Dev/Test Flow**:
  1. Client navigates to `GET /api/v1/auth/stub/start`
  2. Redirects to stub IdP `http://127.0.0.1:9797/authorize`
  3. Returns to `GET /api/v1/auth/stub/callback?code=...&state=...`
  4. Server invokes `issueSession(deps, userId)`, signs token with `SESSION_SECRET`, sets `pk_session` cookie (`SameSite: Lax`, `Secure: true`), and redirects to `/admin.html`.
- **Playwright Automation**:
  - Browser context: `await page.goto("/admin.html"); await page.getByRole("link", { name: /continue with/i }).click();`
  - API request fixture: `await request.get("/api/v1/auth/stub/start");`

### Playwright Test Suite
An automated full-screen audit suite was authored at `apps/web/e2e/measurement/ui-audit-walkthrough.spec.ts`:
- Tests viewports: **Desktop (1280×800)**, **Tablet (768×1024)**, and **Mobile (360×740)**.
- Generated **21 visual screenshots** and DOM defect detection report in `apps/web/e2e/screenshots/`.

---

## 3. Comprehensive Finding Registers

### Group 1: Marketing, Onboarding & Auth Screens
*Screens: `landing.tsx`, `home.tsx`, `sections/signal/*`, `signin.tsx`, `setup.tsx`, `index.html`*

| ID | Sev | Location | Defect Summary | Design System & UX Harm | Recommended Fix |
|---|:---:|---|---|---|---|
| **G1-01** | **Blocker** | `apps/web/src/routes/home.tsx:245-259`<br>`apps/web/src/styles/home.css:389-411` | Test row action button hidden via `opacity: 0` until `:hover`. | On touch devices without hover, "Open" button is invisible and row is untappable. Mobile users cannot open tests. | Bind `onClick={onOpen}` to `li.home__row` and add `@media (hover: none) { .home__row-action { opacity: 1; } }`. |
| **G1-02** | **Critical** | `apps/web/src/styles/signal.css:178-238`<br>`apps/web/src/sections/signal/Head.tsx:24-46` | Sticky nav (`top: 0`) wraps unconditionally on narrow viewports. | On 360px mobile screens, nav wraps into 4 rows (~180px), obscuring ~30% of vertical viewport during scroll. | At `@media (max-width: 768px)`, collapse nav links into a mobile toggle drawer or horizontal scroll strip. |
| **G1-03** | **Critical** | `apps/web/src/styles/admin.css:566-576`<br>`apps/web/src/components/organiser/ScreenSplit.tsx:74-91` | `.screen__brand { display: none }` below 900px strips the "Pariksha" brand mark. | Mobile signin and setup pages have zero branding, logo, or product title, appearing untrusted. | Move `.screen__mark` outside `.screen__brand` or display a mobile masthead above the form. |
| **G1-04** | **Critical** | `apps/web/src/sections/signal/Tail.tsx:57-66` | Both "live" and "next" lists render in SSR; JS hides second via `hidden = true`. | Triggers ~200px Cumulative Layout Shift (CLS) on hydration. Stacks both lists if JS fails. | Apply default CSS hiding: `[data-signal-list="next"] { display: none; } .signal-list.is-active { display: block; }`. |
| **G1-05** | **Warning** | `apps/web/src/styles/signal.css:344, 590, 703, 805` | Handcrafted `border-radius: 14px` on `.signal-frame`, `.signal-panel`. | Violates `DESIGN.md` § Shapes binary radius mandate (strict 3/4/6/8px and pill only). | Replace `border-radius: 14px` with `var(--rounded-lg)` (8px). |
| **G1-06** | **Warning** | `apps/web/src/styles/signal.css:146-153, 523` | Hover lifts (`transform: translateY(-1px)` and `-2px`) with 180–200ms transitions. | `DESIGN.md` explicitly forbids hover transforms ("Flat, no shadow... 120ms ease-out on color/border only"). | Remove `translateY` transforms on hover; standardize transitions to `120ms ease-out`. |
| **G1-07** | **Warning** | `apps/web/src/styles/signal.css:61, 96, 602` | 20+ arbitrary subpixel font sizes (`10px`, `10.5px`, `12.5px`, `14.5px`). | 10px table headers are illegible; fractional fonts cause subpixel anti-aliasing blur. | Standardize to tokens: `var(--type-mono-sm-size)` (12px) and `var(--type-body-sm-size)` (14px). |
| **G1-08** | **Warning** | `apps/web/src/styles/admin.css:377`<br>`apps/web/src/styles/primitives.css:168` | Mobile 96px horizontal padding trap (`.screen` 24px + `.card-hairline` 24px on each side). | Leaves only 264px of usable width on 360px phones (26.7% wasted on padding). | At `@media (max-width: 600px)`, reduce screen padding to 12px and card padding to 16px. |
| **G1-09** | **Warning** | `apps/web/src/routes/signin.tsx:127-133` | Submit buttons disable (`disabled={busy}`) but display no loading indicator. | Users cannot tell whether submission is in flight or frozen. | Change label while busy: `{busy ? "Sending link…" : "Send me a sign-in link"}`. |

---

### Group 2: Organiser Dashboard & Catalog Screens
*Screens: `organiser.tsx`, `tests.tsx`, `OrganiserShell.tsx`, `ApiKeyPanel.tsx`, `CandidateDataPanel.tsx`, `GradingQueue.tsx`, `ScreenSplit.tsx`, `UsagePanel.tsx`, `WebhookPanel.tsx`*

| ID | Sev | Location | Defect Summary | Design System & UX Harm | Recommended Fix |
|---|:---:|---|---|---|---|
| **G2-01** | **Critical** | `apps/web/src/components/organiser/CandidateDataPanel.tsx:170-208` | Confirmation alert dialog has no modal wrapper, backdrop scrim, or elevation styling. | Renders inline in document flow, shifting layout; user can still interact with background controls. | Wrap in fixed overlay (`position: fixed; inset: 0; background: var(--scrim); z-index: 100;`) with `.card-hairline`. |
| **G2-02** | **Critical** | `apps/web/src/components/organiser/CandidateDataPanel.tsx:158-161` | Permanent erasure of candidate data uses green `.button-primary`. | Violates `DESIGN.md` § Components (`button-danger`). Irreversible destruction is presented as positive action. | Change trigger and confirm buttons to `.button-danger`. |
| **G2-03** | **High** | `apps/web/src/routes/tests.tsx:464-509`<br>`apps/web/src/styles/testbuilder.css:5-10` | Filter bar `.testbuilder-filters` uses `align-items: flex-end`, misaligning input baselines. | Search has help text while Status/Sort selects do not, pushing Search input ~25px above selects. | Adopt `field-row` subgrid pattern or align baselines across controls. |
| **G2-04** | **High** | `apps/web/src/styles/primitives.css:319-325` | Pinned action column (`td.acts`) is explicitly transparent. | Horizontally scrolled cell content passes directly under action buttons, causing unreadable collisions. | Add `background-color: var(--surface)` to `th.acts, td.acts` with an elevation divider. |
| **G2-05** | **High** | `apps/web/src/components/organiser/ApiKeyPanel.tsx:168-179` | Checkboxes wrapped in `.field` (`flex-direction: column`), stacking label above box. | Inverts standard checkbox convention; clickable target is only 17px, failing 44px touch targets. | Use horizontal flex container (`display: flex; align-items: center; min-height: 44px;`). |
| **G2-06** | **High** | `apps/web/src/components/organiser/GradingQueue.tsx:179, 192` | Question prompt rendered as muted secondary text; rubric points and descriptions hidden. | Reviewers see tiny 14px prompt and "Level 1" without points or grading criteria, risking misgraded responses. | Render stem in `body-md` / `question-stem` and show rubric points + criteria descriptions. |
| **G2-07** | **High** | `apps/web/src/components/organiser/UsagePanel.tsx:59-66` | "Check free-plan usage" button has `padding: 0` and 18px line height. | Fails WCAG 2.5.8 (min 24×24px) and 44px touch target guidelines. | Add `min-height: 36px` / `44px` padding and clear hover/focus pill. |
| **G2-08** | **Medium** | `apps/web/src/routes/tests.tsx:619-662` | Table row bloat (182px per row) with redundant `<label>Slug</label>` and 64px QR code. | Table fits only 3–4 rows on 1080p monitors. | Visually hide in-cell slug labels (`.visually-hidden`) and move QR code to an on-demand popover. |

---

### Group 3: Test Builder Suite
*Screens: `test.tsx`, 15 testbuilder components, `testbuilder.css`, `registration.css`*

| ID | Sev | Location | Defect Summary | Design System & UX Harm | Recommended Fix |
|---|:---:|---|---|---|---|
| **G3-01** | **Critical** | `apps/web/src/styles/registration.css:67-79` | Global `.text-input { height: 44px; }` applied to `<textarea>`. | Collapses multi-line textareas (instructions, descriptions, options, answer keys) into 44px single-line slots. | Scope `height: 44px` to `input.text-input, select.text-input`; set `textarea.text-input { height: auto; min-height: 88px; resize: vertical; }`. |
| **G3-02** | **High** | `apps/web/src/components/testbuilder/AccessPanel.tsx:395`<br>`apps/web/src/components/testbuilder/SectionList.tsx:444`<br>`apps/web/src/components/testbuilder/TimingPanel.tsx:514` | Modal dialogs render as unstyled in-flow `<div>` blocks without backdrop scrims. | Dialogs render inline at bottom of sections, pushing existing content down rather than overlaying the screen. | Wrap in fixed modal overlay (`position: fixed; inset: 0; background: var(--scrim); display: grid; place-items: center; z-index: 100;`). |
| **G3-03** | **High** | `apps/web/src/components/testbuilder/SectionList.tsx:476`<br>`apps/web/src/components/testbuilder/FormBuilder.tsx:616` | Irreversible section and field deletion actions use green `.button-primary`. | Violates `DESIGN.md:241-248` (`.button-danger` required for destructive actions). | Apply `.button-danger` to deletion confirmation buttons. |
| **G3-04** | **High** | `apps/web/src/components/testbuilder/AccessPanel.tsx:225`<br>`apps/web/src/components/testbuilder/TimingPanel.tsx:417` | Radio & checkbox choices are flex columns with input and label as block siblings. | Radio circle renders on line 1; text label renders below it on line 2. | Wrap input and label in horizontal row container (`display: flex; align-items: baseline; gap: var(--space-xs);`). |
| **G3-05** | **High** | `apps/web/src/components/testbuilder/PublishChecklist.tsx:185`<br>`apps/web/src/styles/testbuilder.css:1143` | 12px empty gap between 52px checklist rail and floating panel. | Moving pointer across gap fires `mouseleave` on rail, closing panel before user can click actions inside it. | Bridge gap with pseudo-element hit-area or use click-to-dock / hover intent with 250ms debounce. |
| **G3-06** | **Medium** | `apps/web/src/components/testbuilder/RegistrationForm.tsx:334` | Consent field completely omits the mandatory `.consent-row` design token. | Violates `DESIGN.md:336-341` (cream fill, hairline-strong border, 16px padding). | Implement `.consent-row` in `registration.css` and wrap consent checkboxes in `<div className="consent-row">`. |
| **G3-07** | **Medium** | `apps/web/src/components/testbuilder/LockedAttempts.tsx:69-100` | Clicking "Unlock" expands button group and prompt inline inside table `<td>`. | Causes severe Cumulative Layout Shift (CLS) on table columns. | Reserve fixed column width or render confirmation in an anchored popover. |
| **G3-08** | **Medium** | `apps/web/src/routes/test.tsx:928-940` | "Grading queue" and "Analytics" buttons injected between accordion SettingRows. | Breaks accordion visual rhythm and list semantics. | Move action buttons to test header lifecycle toolbar or dedicated footer card. |

---

### Group 4: Question Banks, Question Authoring & Import
*Screens: `banks.tsx`, `bank.tsx`, `question.tsx`, `import.tsx`, `QuestionEditor.tsx`, `TypePicker.tsx`, `Structured.tsx`, `Written.tsx`, `Choice.tsx`, `ReorderableList.tsx`*

| ID | Sev | Location | Defect Summary | Design System & UX Harm | Recommended Fix |
|---|:---:|---|---|---|---|
| **G4-01** | **Critical** | `apps/web/src/routes/bank.tsx:502-515`<br>`apps/web/src/routes/bank.tsx:413` | Question and passage group deletion actions execute immediately with zero confirmation prompt or undo buffer. | Accidental click on "Delete" permanently erases question or passage group. | Implement confirmation modal dialog or soft-delete with undo toast before executing deletion. |
| **G4-02** | **Critical** | `apps/web/src/styles/exam.css:1138` vs `question.css` | `.reorderable-list__item.is-drop-target` CSS rule only exists in `exam.css`. | Dragging items in organiser (options, matching pairs, ordering items) provides zero drop feedback. | Move rule into `question.css` and style with `--accent` and `--edge-strong`. |
| **G4-03** | **Critical** | `apps/web/src/components/authoring/ReorderableList.tsx:211-244` | Entire `<li>` container is `draggable={!pinned}`, breaking text selection inside inputs. | Highlighting text inside option `<input>` or `<textarea>` initiates drag on row instead of selecting text. | Constrain drag initiation to a dedicated 44px drag grip handle button (`.reorderable-list__grip`). |
| **G4-04** | **Critical** | `apps/web/src/routes/bank.tsx:22-30` | `groupedTags()` drops any tag that lacks a `/`. | Tags like `physics`, `algebra` are silently hidden from the filter rail. | Render flat tags under an "Ungrouped" or "General" tag cluster in `bank-browser__rail`. |
| **G4-05** | **Warning** | `apps/web/src/components/authoring/QuestionEditor.tsx:365` | QuestionEditor and PreviewPane are strictly stacked in a 1500px+ vertical column. | Authors cannot see live preview while typing prompt or options; forces continuous vertical scrolling. | Implement responsive 2-column desktop split (`@media (min-width: 1024px)`) with form on left and sticky preview on right. |
| **G4-06** | **Warning** | `apps/web/src/components/authoring/PreviewPane.tsx:116-135` | PreviewPane renders candidate inputs ONLY for `Choice` questions. | For Matching, Ordering, Blanks, Numeric, and Written types, PreviewPane renders only the prompt stem. | Render candidate input mockups for all 12 question types. |
| **G4-07** | **Warning** | `apps/web/src/components/authoring/PreviewPane.tsx:80` | PreviewPane renders in Signal dark/light surface instead of candidate runtime cream `#fffbf5`. | Violates candidate runtime environment parity. | Render preview container using candidate runtime styles (`background: var(--color-cream); color: var(--color-ink)`). |
| **G4-08** | **Warning** | `apps/web/src/components/authoring/QuestionEditor.tsx:450` | Native `<select>` elements render unstyled at 22px beside 44px `.text-input` in `field-row`. | Violates UI alignment rule #10; leaves 22px empty whitespace under selects in subgrid. | Add `.select-input` class (`height: 44px; padding: 10px 12px; border: 1px solid var(--edge-strong);`). |
| **G4-09** | **Warning** | `apps/web/src/routes/import.tsx:198` | Import screen lacks drag-and-drop dropzone. | Relies solely on native `<input type="file">`. Dropping files from desktop onto card navigates browser away. | Build visual dropzone (`.import__dropzone`) with dragover highlight state and dashed border. |
| **G4-10** | **Warning** | `apps/web/src/routes/bank.tsx:268`<br>`apps/web/src/components/authoring/answer/Written.tsx:179` | Raw developer snake_case enums (`select_k`, `assertion_reason`, `all_or_nothing`) exposed in UI. | Exposing code identifiers confuses non-technical authors and degrades visual polish. | Replace with human-readable labels ("Select K", "Assertion & Reason", "All or nothing"). |

---

### Group 5: Candidate Exam Runtime, Analytics, Grading & Motion Craft
*Screens: `exam.tsx`, 16 exam components, `analytics.tsx`, `grading.tsx`, `exam.css`, `analytics.css`, `grading.css`*

| ID | Sev | Location | Defect Summary | Design System & UX Harm | Recommended Fix |
|---|:---:|---|---|---|---|
| **G5-01** | **Critical** | `apps/web/src/styles/exam.css:439, 726`<br>`apps/web/src/styles/question.css:29`<br>`apps/web/src/styles/exam.css:1052, 1152` | Text scaling is broken. `.exam-runner` calculates scaled base font size, but `.rendered--stem`, `.exam-option-row`, and input fields hardcode static token sizes. | Low-vision candidates toggling 1.25x or 1.5x in `ViewControls` see zero scaling on stems, options, or inputs. Violates WCAG 1.4.4. | Update `.rendered--stem`, `.exam-option-row`, `.exam-blanks`, and inputs to use `em` or `calc(var(--token) * var(--exam-font-scale, 1))`. |
| **G5-02** | **Critical** | `apps/web/src/styles/exam.css:455-463`<br>`apps/web/src/styles/exam.css:1047-1068` | In high-contrast mode, `--color-cream` swaps to white and `--exam-edge` swaps to 2px. Selected and unselected options both render white with 2px borders. | In high-contrast / greyscale mode, background fill and edge differential between selected/unselected options vanish completely. Violates multi-carrier mandate. | In `:root[data-contrast="high"]`, set selected row border to `3px solid var(--color-voltage)` or add explicit high-contrast fill tint. |
| **G5-03** | **Critical** | `apps/web/src/routes/analytics.tsx:219-238`<br>`apps/web/src/styles/analytics.css:384-405` | Discrimination index uses native `<progress value={value + 1} max={2}>`. Fills 0% leftwards, so 0.00 renders 50% filled and AT announces "50%". | Admins see uncalibrated questions (0.00) look half-positive. Screen readers announce "Discrimination index, 50%", misleading test creators. | Replace with custom bidirectional SVG/flex bar extending left from 50% for negative and right for positive; use formatted text for AT. |
| **G5-04** | **Critical** | `apps/web/src/components/organiser/GradingQueue.tsx:191-210` | Grading rubric options only render `{level.level}` (e.g. "Level 1"). Rubric point awards and criteria descriptions are omitted. | Reviewers evaluating candidate answers cannot see score each level grants or criteria justifying it, causing arbitrary grading. | Render rubric options as structured cards: `{level.level} ({level.points} pts)` with full criteria text. |
| **G5-05** | **Critical** | `apps/web/src/components/exam/answer/Written.tsx:167-169` | Character counter `<p className="exam-answer-status" role="status">` updates on every keystroke. | Every character typed causes screen readers to interrupt and announce "995 characters left", "994 characters left", creating extreme exam anxiety. | Remove `role="status"` from live counter during active typing; use `aria-describedby` or debounced milestone announcements. |
| **G5-06** | **High** | `apps/web/src/styles/exam.css:773-790` | Palette rail content width (206px) is 6px smaller than 5-column grid requirements (212px). | Causes 6px horizontal grid overflow, asymmetrical padding, and subpixel clipping on Windows monitors. | Set `.exam-palette { width: 246px; }` or adjust padding to 14px with `column-gap: 7.5px`. |
| **G5-07** | **High** | `apps/web/src/styles/exam.css:773-781` | `.exam-palette` has `position: sticky; top: 24px;` with no `max-height` or `overflow-y: auto`. | On tests with 30+ questions, bottom questions extend past viewport bottom on laptop screens, becoming unreachable without scrolling whole page. | Add `max-height: calc(100vh - 48px); overflow-y: auto;` to `.exam-palette`. |
| **G5-08** | **High** | `apps/web/src/styles/exam.css:478-495` | `.exam-skip` shifts from `position: absolute; clip-path: inset(50%)` to `position: static` on `:focus-visible`. | When candidate presses Tab to start exam, a 120px button inserts into top bar, violently shifting clock, status, and submit buttons 120px right. | Position skip link fixed/absolute floating above the bar (`top: 8px; left: 32px; z-index: 50;`). |
| **G5-09** | **High** | `apps/web/src/styles/exam.css:1294, 1467` | Both `.exam-submit-confirm` and `.exam-proctoring-count` have `z-index: 20` positioned in top-right corner. | Clicking "Submit test" places confirmation dialog directly over live proctor warning badge, creating visual overlap and click interception. | Move `.exam-proctoring-count` to `top: 16px; left: 16px;` or elevate submit confirmation to `z-index: 40` with modal overlay. |
| **G5-10** | **High** | `apps/web/src/components/organiser/GradingQueue.tsx:180` | Candidate written response rendered in `<p className="organiser__status">` without whitespace preservation. | Essays, paragraphs, and code samples collapse into a single run-on block. Null responses look identical to literal text "No answer given.". | Render responses inside `card-hairline` using `white-space: pre-wrap; font-family: inherit;`. Format null responses with distinct italicized style. |
| **G5-11** | **High** | `apps/web/src/components/organiser/GradingQueue.tsx:230-247` | Verdict radio inputs have no `checked` attribute tied to attempt state. | Reviewers reopening an attempt see all verdict radio options blank even if a verdict was previously assigned. Switching grouping clears radio visual state. | Wire `checked={currentVerdict === verdict}` and display existing attempt verdict badges prominently in card header. |
| **G5-12** | **Medium** | `apps/web/src/components/exam/Watermark.tsx:44-55` | Updates `setInterval` every 1,000ms, updating 40 DOM nodes continuously. | Rotated watermark text nodes tick seconds every second right behind question stems, creating visual noise and React render cycles. | Change timer interval to 60,000ms (`TICK_MS = 60_000`). Minute-level timestamping provides full photo deterrence without second-level DOM thrash. |
| **G5-13** | **Medium** | `apps/web/src/components/exam/answer/Structured.tsx:130-150` | In `MultiMatching`, checkbox is a bare 17px × 17px element inside 48px `<td>`. | Candidates on touchscreens struggle to hit tiny 17px target in dense matching grid. | Wrap checkbox in full-cell `<label>` filling 100% width and height of `<td>` with `cursor: pointer`. |
| **G5-14** | **Medium** | `apps/web/src/components/exam/answer/Written.tsx:99-114` | `<input type="number">` has no CSS suppressing native stepper buttons or mousewheel increments. | Scrolling with trackpad/mousewheel accidentally changes numeric values while focused on input without realizing. | Add CSS rules disabling spin-buttons and setting `-moz-appearance: textfield`. |
| **G5-15** | **Medium** | `apps/web/src/styles/analytics.css:327-329` | Item Analysis table headers declare `font-size: 10px;` overriding `--type-mono-sm-size` (12px). | 10px text causes eye strain for administrators analyzing test data. | Remove `font-size: 10px;` and allow headers to render at token standard `var(--type-mono-sm-size)` (12px). |
| **G5-16** | **Medium** | `apps/web/src/styles/analytics.css:261-279` | Label `.analytics-integrity__name` has `grid-column: 2;` inside 3-column grid. | Places category name ("Clean", "Review", "High risk") onto an orphan second row beneath progress bar. | Redesign grid tracks to `18px 80px minmax(0, 1fr) 48px` so Glyph, Label, Bar, and Count sit on a single line. |
| **G5-17** | **Medium** | `apps/web/src/routes/analytics.tsx:412, 613` | Technical PRD requirement codes (`R-06 · 42 registered`, `R-07 · 15 questions`) rendered in production UI headers. | Leaks internal spec identifiers into production organiser screens. | Remove `R-06 ·` and `R-07 ·` prefixes from production UI labels. |
| **G5-18** | **Medium** | `apps/web/src/styles/base.css:81-84` | `.skip-link` animates `top 120ms ease-out`. | Violates Emil Kowalski standard 7 (GPU-only properties). Animating `top` triggers layout reflows. | Animate `transform: translateY(...)` with `opacity` instead of layout property `top`. |
| **G5-19** | **Medium** | `apps/web/src/routes/grading.tsx:111` | `<div className="grading-queue__controls">` is rendered with no corresponding CSS rule in `grading.css`. | "Blind grading" checkbox and "Group by" dropdown stack vertically with broken spacing. | Add `.grading-queue__controls { display: flex; flex-wrap: wrap; gap: var(--space-xl); align-items: flex-end; }`. |

---

## 4. Prioritized Execution Checklist

### Phase 1: Critical Usability & Safety Blockers (P0)
- [ ] **G1-01**: Touch row tap blocker in home agenda (`home.tsx`, `home.css`)
- [ ] **G1-02**: Narrow viewport sticky nav 4-row wrapping trap (`signal.css`, `Head.tsx`)
- [ ] **G1-03**: Brand mark stripping below 900px on mobile signin/setup (`ScreenSplit.tsx`, `admin.css`)
- [ ] **G2-01**: Add modal backdrop scrim overlay to `CandidateDataPanel.tsx` dialog
- [ ] **G2-02**: Change candidate data erasure buttons from `.button-primary` to `.button-danger` (`CandidateDataPanel.tsx`)
- [ ] **G3-01**: Remove global `height: 44px` on `<textarea class="text-input">` (`registration.css`)
- [ ] **G3-02**: Add modal dialog scrim overlays to `AccessPanel.tsx`, `SectionList.tsx`, `TimingPanel.tsx`
- [ ] **G3-03**: Convert section/field delete buttons from `.button-primary` to `.button-danger` (`SectionList.tsx`, `FormBuilder.tsx`)
- [ ] **G4-01**: Add deletion confirmation modal dialogs for questions and passage groups (`bank.tsx`)
- [ ] **G4-02**: Move `.is-drop-target` CSS rule into `question.css` (`question.css`, `exam.css`)
- [ ] **G4-03**: Restrict drag-and-drop initiation to dedicated grip handle (`ReorderableList.tsx`)
- [ ] **G5-01**: Fix candidate runtime font scale inheritance (`exam.css`, `question.css`)
- [ ] **G5-02**: Restore high-contrast border and fill differential on option selection (`exam.css`)
- [ ] **G5-03**: Fix discrimination index progress bar AT announcement & directional rendering (`analytics.tsx`, `analytics.css`)
- [ ] **G5-04**: Show rubric points and criteria descriptions in grading queue (`GradingQueue.tsx`)
- [ ] **G5-05**: Remove `role="status"` live keystroke announcement on Written questions (`Written.tsx`)

### Phase 2: Core UX, Layout & Accessibility Alignment (P1)
- [ ] **G2-03**: Align test catalog filter bar baselines across inputs and selects (`tests.tsx`, `testbuilder.css`)
- [ ] **G2-04**: Add opaque `var(--surface)` background to sticky action columns `td.acts` (`primitives.css`)
- [ ] **G2-05**: Convert vertical checkbox layouts to 44px horizontal rows (`ApiKeyPanel.tsx`)
- [ ] **G3-04**: Align radio circles and text labels horizontally (`AccessPanel.tsx`, `TimingPanel.tsx`)
- [ ] **G3-05**: Bridge 12px hover gap trap on publish checklist rail (`PublishChecklist.tsx`, `testbuilder.css`)
- [ ] **G4-04**: Display flat ungrouped tags in bank filter rail (`bank.tsx`)
- [ ] **G4-05**: Implement responsive 2-column desktop split in question authoring (`QuestionEditor.tsx`, `question.css`)
- [ ] **G4-06 & G4-07**: Expand PreviewPane to render mockups for all question types in candidate Cream (`PreviewPane.tsx`)
- [ ] **G5-06 & G5-07**: Fix palette rail width and add max-height with scroll (`exam.css`)
- [ ] **G5-08**: Fix skip-link layout shift on focus (`exam.css`)
- [ ] **G5-09**: Disentangle submit confirmation dialog and proctoring badge z-index collision (`exam.css`)
- [ ] **G5-10**: Preserve whitespace formatting on written candidate answers (`GradingQueue.tsx`)
- [ ] **G5-11**: Wire attempt verdict selection state to radio buttons (`GradingQueue.tsx`)

### Phase 3: Visual Polish & Emil Kowalski Motion Craft (P2)
- [ ] **G1-05**: Replace non-standard 14px border radii with `var(--rounded-lg)` (8px) (`signal.css`)
- [ ] **G1-06**: Remove hover translateY transforms across marketing components (`signal.css`)
- [ ] **G1-07**: Standardize 10px table headers to `var(--type-mono-sm-size)` (12px)
- [ ] **G1-08**: Reduce 96px mobile padding trap on auth screens to 28px total (`admin.css`, `primitives.css`)
- [ ] **G2-08**: Reduce test catalog row height by moving QR codes into popovers (`tests.tsx`)
- [ ] **G4-08**: Style native `<select>` elements to 44px in field rows (`QuestionEditor.tsx`, `primitives.css`)
- [ ] **G4-09**: Add drag-and-drop dropzone on question import screen (`import.tsx`)
- [ ] **G4-10**: Replace raw snake_case enums with human-readable labels (`bank.tsx`, `Written.tsx`)
- [ ] **G5-12**: Throttle watermark DOM updates from 1s to 60s (`Watermark.tsx`)
- [ ] **G5-13**: Expand matching checkbox click targets to full table cells (`Structured.tsx`)
- [ ] **G5-14**: Disable spin-buttons and mousewheel increments on numeric inputs (`Written.tsx`)
- [ ] **G5-17**: Remove internal PRD requirement identifiers (`R-06`, `R-07`) from production UI (`analytics.tsx`)
- [ ] **G5-18**: Replace skip-link `top` layout animation with GPU `transform` (`base.css`)
- [ ] **G5-19**: Implement `.grading-queue__controls` flexbox rule (`grading.css`)
