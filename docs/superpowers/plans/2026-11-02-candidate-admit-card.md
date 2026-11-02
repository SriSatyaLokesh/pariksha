# Candidate Admit Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port direction A (admit card) of the candidate-path prototypes into `apps/web`: organiser-owned masthead and admit-card landing, split registration gate, one-bar runner, with the organiser's name on the landing payload.

**Architecture:** One shared masthead component (`components/exam/Mast.tsx`) with a `useBrandColour` hook that paints `--color-brand` as a custom property; the landing and gate renders rewritten in place; the runner bar regrouped; CSS blocks for landing, gate and runner bar replaced in `exam.css`; the contrast audit map extended for every selector that moved ground.

**Tech Stack:** TypeScript, React 19, CSS custom properties, Vitest, Playwright (captures only), Hallmark sloplint.

**Spec:** `docs/superpowers/specs/2026-11-02-candidate-admit-card-design.md`

## Global Constraints

- No `style={}` and no colour literal in `apps/web/src` (`no-hex-colors.test.ts`).
- Every colour-setting selector in `exam.css` has a `contrast-usage.test.ts` entry naming its ground.
- `.exam-facts dt` keeps body face, body-sm, untracked (`exam-typography-anti-slop.test.ts`); `.exam-font-scale` padding and `.exam-view-choice` gap keep their tokens (`exam-css-fixes.test.ts`).
- Landing: Start visible text stays "Start", `aria-label` "Start {name}"; buttons in DOM order Check my device, Start, See my result; actions precede requirements in the DOM.
- Gate: every id, label, help and server sentence unchanged; h1 accessible name "Register for {name}".
- Runner: `getByRole` must reach the text-size radios and the contrast switch (native `<details>` keeps them in the DOM).
- A resumed attempt never calls `client.landing()` (C-06).
- Commit as `Satya K <srisatyalokesh2.12@gmail.com>`, signed off, no tool attribution.

---

### Task 1: Organiser name on the landing payload

- [x] `packages/db/src/repo/candidate-entry.ts`: `w.name AS workspace_name` in the published-test query; `workspaceName` on `PublishedTest`.
- [x] `apps/api/src/routes/run.ts`: `organiser: string` on `LandingPayload`, set from `test.workspaceName`.
- [x] `apps/web/src/lib/run.ts`: `organiser?: string | null`.
- [x] Fixtures: `demo-test.ts`, `landing.test.tsx`, `registration.test.tsx`.
- [x] Verify: `packages/db` candidate-entry tests, `apps/api` landing tests.

### Task 2: Shared masthead and brand colour

- [x] `apps/web/src/components/exam/Mast.tsx`: `ExamMast({ organiser })` (brandline, organiser, Pariksha plaque) and `useBrandColour(colour)` (sets `--color-brand` on a ref in an effect, gated by `brandColourIssue`).
- [x] Verify: `no-hex-colors.test.ts`.

### Task 3: Landing as an admit card

- [x] `routes/exam.tsx` `ExamLanding`: masthead, head (h1, lead, opens and latest start), grid with the card first in the DOM; device findings list rendered from `report ?? deviceStatus`; actions in the order Check my device, Start, See my result; requirements under "Before you begin"; footer with Pariksha credit.
- [x] `styles/exam.css`: landing block replaced (`.exam-mast*`, `.exam-landing-*`, `.exam-ticket*`, `.exam-facts`, `.exam-device-report`, `.exam-landing-actions`, footer, 960px breakpoint).
- [x] `test/exam/landing.test.tsx`: the hero assertion now checks the h1 on cream, not `card-voltage`.
- [x] `test/contrast-usage.test.ts`: entries for the selectors that moved to canvas or were added.
- [x] Verify: landing, device-gate, camera-gate, mic-gate, contrast, css-fixes, typography tests.

### Task 4: Registration gate, split

- [x] `components/exam/Registration.tsx`: masthead, `exam-gate` grid, brand half (organiser, h1 with `aria-label`, facts, steps with `aria-current`, plaque), form half (alert, panel, `GATE_TITLE` over `GATE_HELP`, "No code?" aside).
- [x] `styles/exam.css`: registration block replaced.
- [x] `test/contrast-usage.test.ts`: brand-half selectors on `voltage-deep`, step disc on `cream`.
- [x] Verify: registration tests, contrast audit.

### Task 5: Runner bar

- [x] `components/exam/Runner.tsx`: `heading` prop; bar regrouped into identity, clocks, tools (banner, Calculator, `<details>` View menu with `ViewControls`, Submit).
- [x] `routes/exam.tsx`: `test` on the attempt view (from `startWith`; `null` on resume), threaded to `AttemptView` and `Runner`.
- [x] `styles/exam.css`: bar grid, identity, tools, view menu, clipped clock announcement, underlined section tabs, canvas palette.
- [x] `test/contrast-usage.test.ts`: `.exam-runner-who`, `.exam-view-menu-summary`, `.exam-section-tab`.
- [x] Verify: runner, clock, navigation, locked, submit, autosave tests.

### Task 6: Records and sweep

- [x] `DESIGN.md`: supersession note on `hero-section`.
- [x] `apps/web/src/lib/demo-test.ts`: demo footer no longer repeats the Pariksha credit.
- [x] `test/exam/exam-typography-anti-slop.test.ts`: unchecked index that failed `tsc`.
- [x] Full web suite alone, full API suite alone, typecheck (web, api, db), ESLint, Hallmark static lint.
- [x] Captures in `.prototypes/candidate/port/`.

### Deferred

- [ ] Organiser logo on the masthead once the candidate media route exists.
- [ ] Test name on `AttemptPaper` so a resumed attempt's bar can name it.
- [ ] Demo banner meta string.
