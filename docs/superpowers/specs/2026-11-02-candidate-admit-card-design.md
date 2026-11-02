# Candidate Path: Admit Card Landing, Split Gate, One-Bar Runner

**Date:** 2026-11-02
**Platform:** Pariksha candidate runtime (`apps/web`), with one field added to the landing payload (`apps/api`, `packages/db`)
**Methodology:** Hallmark (fast mode, three dealt directions, one chosen), `DESIGN.md` cream runtime, WCAG 2.1 AA
**Status:** Implemented on `feature/candidate-anti-slop-ui`, after the typography pass in `2026-11-02-candidate-ui-anti-slop-design.md`

---

## 1. The problem, in the owner's words

After the typography pass the candidate screens were correct and still read as "HTML with basic or no CSS at all". The specific asks:

1. The organiser's test should carry **proper branding on top**: whose test this is, before what it is.
2. Nothing needs to be shouted. The test name does not need a vermilion wall and 56px; requirements can be small.
3. **Start has to be enabled**, not greyed out behind a device check a candidate has not understood.
4. There should be a proper landing, with an explanation that this runs on Pariksha.
5. The access-code screen should not be a lone form on a blank page: **form on the right, branding on the left**.
6. The runner should get the same care.

## 2. Pre-flight

- `DESIGN.md` is a locked system. Cream `#fffbf5`, ink, Voltage `#e24c18` as marks only, Anek Latin 500 display, JetBrains Mono for ids, counts and timers. The start page's full-bleed Voltage block was the one component the ask contradicts; it is superseded on the start page and kept on the finish page (recorded against `hero-section` in `DESIGN.md`).
- The landing payload already carries `branding.logo`, `primaryColour`, `footerText` and `startMessage`. It did not carry the organiser's name. The candidate-entry query already joins `workspace`, so `w.name` is one more column.
- `brandColourIssue` (`@pariksha/core`) refuses any `primary_colour` that is not `#rrggbb` or fails 4.5:1 on cream, so cream text on the organiser's colour is AA by construction.
- `apps/web/test/no-hex-colors.test.ts` bans `style={}` in any `.tsx` under `src`. `BrandingPanel.tsx` already paints a brand colour as a custom property from an effect; the candidate path does the same.
- Captures of the screens before the change are in `.prototypes/candidate/current/` (gitignored).

## 3. Three directions, built as HTML prototypes

All three share one token set from `DESIGN.md`; the organiser's colour is the only variable a test brings. Files in `.prototypes/candidate/` (gitignored), each stacking landing, gate and runner.

| | A. Admit card | B. Programme | C. Paper |
|---|---|---|---|
| Landing | Organiser masthead, test name as display heading on cream, sticky ticket on the right with facts, device standing and Start | Short brand band with the title in it, four-figure strip, numbered programme, Start pinned to a bottom bar | Ink on cream, ruled; Start beside the title; facts as a table |
| Gate | Brand colour left with test name, facts and three steps; form right | Half and half, test name set huge | The invitation as a card on the left, form right |
| Runner | One bar: identity, clocks, tools, Submit; palette right | Palette left, question centre, clocks right | One reading column, palette as a bottom strip |

Sloplint on the prototypes: 0 FAIL after the sweep. The owner chose **A**.

## 4. Decisions

### 4.1 Landing
- **Masthead** (`ExamMast`): a 4px line in `--color-brand`, then the organiser's name left and "Conducted on Pariksha" right, on canvas. The logo stays unrendered until the candidate media route exists.
- **Head**: test name at `display-lg` in ink, description as the lead, opens and latest start as a small definition list on the right.
- **Left column**: the organiser's `startMessage` framed as a note with "A note from {organiser}", Sections as a ruled table (index, title, questions, minutes), Rules, and the proctoring requirements as a small ruled list under "Before you begin".
- **Right column, the admit card** (sticky): "Your sitting", Duration, Questions, Closes; the device's standing as rows (Screen, Pointer, Browser) present from first render; then Check my device, Start, See my result.
- **Start**: enabled whenever the test is open and the device is not refused. The refusal reason stays under the button. The device list is the mount-time report, replaced by the fresh one when Check my device runs, so there is never a disabled button without a visible reason.
- **DOM order**: the card is first in the DOM and painted on the right by the grid, so the actions precede the requirements in document order and the tab order reads check, start, result, as the landing test pins.
- **Footer**: `footerText` when set, and "Conducted on Pariksha, an open-source exam platform".

### 4.2 Gate (registration)
- Same masthead. Below it a two-column split: `exam-gate-brand` in `--color-brand` with the organiser, the test name (h1, labelled "Register for {name}" for the ear), Duration and Questions, the three steps with `aria-current="step"`, and the plaque; `exam-gate-form` on cream with the alert and the canvas panel.
- Each access mode gets a title (`GATE_TITLE`) over the existing help sentence (`GATE_HELP`), and the first step's wording (`GATE_STEP`). The link-code mode adds "No code? Ask your invigilator or {organiser}".
- The consent card, the registration form and every id, label and server sentence are unchanged.

### 4.3 Runner
- **One bar**, three parts: test name and attempt reference (organiser, attempt id in mono) left; clocks centre; save status, Calculator, a **View** disclosure (native `<details>`) holding text size and contrast, and Submit right. The clock's spoken warning sentence is clipped for the eye; the chips already say it.
- Section tabs become an underlined tab row that scrolls rather than stacks. The palette is a canvas card with a hairline.
- The bar names the test from the landing payload, which `ExamApp` now keeps on the attempt view. A **resumed** attempt never asks for the landing page (C-06, pinned by `autosave.test.tsx`), so the bar carries the attempt reference alone on resume until the paper itself names the test.

### 4.4 Data
- `PublishedTest.workspaceName` (`packages/db`, from `w.name` in the existing query), `LandingPayload.organiser` (`apps/api`, required; `apps/web`, optional for cached payloads).

## 5. Verification
- Web suite alone: 127 files, 3152 tests pass. API suite alone: 1420 of 1421; the one AC-12 registration failure passes with its file run alone (load). db `candidate-entry` and API `landing` tests pass. Typecheck clean for web, api and db. ESLint clean on the changed files.
- `contrast-usage.test.ts` audits every new colour-setting selector; the brand half is measured on its voltage-deep fallback and the organiser's own colour is AA by `brandColourIssue`.
- Hallmark static lint on the ported files: 0 FAIL.
- Rendered captures of the port: `.prototypes/candidate/port/`.

## 6. Deferred
- Organiser logo on the masthead: needs the attempt-scoped media route.
- Test name on a resumed attempt's bar: put it on `AttemptPaper` from the API.
- Demo banner's middle-dot meta string.
- Pre-flight camera panel, submit sheet and receipt: untouched by this slice.
