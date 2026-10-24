# Phase 8h — the frame: measured layout defects on the organiser surfaces

A design spec written from measurement, not from reading CSS. Every number
below was taken from the running application at a stated viewport, with the
app seeded through its own HTTP API and signed in through the stub IdP.

Companion register: `docs/UI_UX_AUDIT_REPORT.md` — a separate, code-read
audit of 14 screens and 42 components, committed on
`audit/ui-ux-design-review`. The two do not overlap: that register contains
no mention of the dead scroll, the content-width ratio, the `checklist-rail`,
WCAG 2.5.8 target sizes, or `#grading-blind`. **This spec covers the frame —
page geometry and cross-screen token consistency. That register's 55
findings are a separate body of work and are out of scope here**, except
where a finding is the same defect reached from the other direction, which
is called out by ID.

Binding design language: `docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`
(Signal dark). Where craft advice and that spec disagree, the spec wins.

## How these numbers were taken

Three processes on IPv4 — stub IdP on 9797, the API's Node entry on 8787,
`vite preview` on a port **outside the Windows reserved range**. The
harness's own 4273 sits inside the excluded range `4198–4297`
(`netsh interface ipv4 show excludedportrange protocol=tcp`), which is why
the e2e webServer fails to bind locally with `listen EACCES ::1:4273`. That
was fixed on the audit branch as `WEB_PORT = Number(process.env.WEB_PORT || 4373)`.

Measurement used `uicheck.py` from the `ui-ux-audit` skill, patched locally
to accept a Playwright `--storage-state` so authenticated screens could be
read, plus direct `page.evaluate` geometry reads.

**One tool result was a false positive and is not a finding.** `uicheck.py`
reported six contrast failures at ratio 1.0 on `button.button-secondary`
("Duplicate", "Export"). Computed styles are `rgb(11,26,19)` on
`rgb(255,255,255)` — roughly 16:1. Do not act on it.

## F1 — the builder scrolls 568px past the end of its own content

At 1440×900 on `?view=test&test=<id>`: `document.scrollHeight` is **1958px**;
the last content pixel is at **1390**. `main.organiser--wide.shell__page`
renders **1902px** tall for 1334px of content.

Cause, located: `apps/web/src/styles/testbuilder.css` places the rail at
`grid-row: 1 / span 40`. The page has **6** column-one children, so rows
7–40 are empty implicit rows. `.organiser` (`apps/web/src/styles/admin.css`)
declares `gap: var(--space-lg)`; the `:has(> .checklist-rail)` rule
overrides only `column-gap`, so **row-gap stays 16px** and every empty row
still pays it. ~34 × 16px ≈ 544px of the 568px.

The comment above that rule states the opposite — *"therefore zero-height,
so the span costs nothing"*. Zero-height rows pay their gap. The comment is
wrong and must go with the fix.

**Required behaviour:** on every organiser screen, at every tested viewport,
`document.scrollHeight` must not exceed the last content pixel by more than
one page inset (`--space-xl`, 24px).

## F2 — the editing surface gets 47% of the viewport

At 1440: nav ends at x=236, content starts at **x=330** (a 94px gutter),
runs to 1002 (**672px wide**), then a 320px rail at x=1026. The rail is
**321px tall against a 1390px column**, leaving ~990px of empty right
column.

Cause: `.organiser--wide { max-width: 1080px }` (`admin.css`) caps the whole
two-column page, so the editor and the rail share 1080px however wide the
screen is. `.organiser--full` already exists as `D18`'s opt-out and is the
precedent.

**Required behaviour:** above a stated breakpoint the builder's editing
column grows with the viewport rather than holding at 672px. The rail keeps
its width; the column takes the slack.

### F2 addendum — fix round (`M1`): docked nav still falls short of 0.6 below ~1280px

F2's own fix (`.organiser--wide:has(> .checklist-rail) { max-width: none }`,
made unconditional rather than gated behind a borrowed `@media (min-width:
1200px)`) is correct on its own terms — nothing is reapplying the clamp.
Measured anyway, because the review that caught the old fixed breakpoint
asked for the actual crossover, and the crossover depends on which of the
organiser's two rails is docked:

`editorWidthRatio` at `?view=test&test=<id>`, nav rail **docked** (236px,
the default a reader lands on):

| viewport | ratio |
| --- | --- |
| 1100 | 0.528 |
| 1150 | 0.554 |
| 1199 | 0.576 |
| 1200 | 0.577 |
| 1250 | 0.598 |
| 1280 | 0.609 |
| 1366 | 0.639 |

Ratio clears 0.6 only somewhere between 1250px and 1280px. Cause: the
opt-out's own condition is the shell's second grid track (viewport minus
whichever rail is docked) passing 1080px — with the nav docked that track
only exceeds 1080px once the viewport passes **1316px**, so below that the
editor is working with under 1080px of track regardless of the clamp. This
is fixed structural chrome overhead, not a residual defect in the clamp fix
itself — a CSS `@media (min-width: …)` breakpoint cannot key off a runtime
value (which rail is docked), only off viewport width, so no single
breakpoint is correct for both rail states; the existing regression test
(`e2e/measurement/frame.spec.ts`, "the opt-out releases as soon as the track
actually exceeds 1080px…") covers the nav-collapsed crossover instead, where
the band in question (1136-1200px) is a real laptop width rather than one
nobody ships the builder at with the nav docked and sub-1080px of track.

**Not fixed in this round** — the fix is either a lower accepted ratio floor
on common widths with the nav docked, or keying `.organiser--wide`'s own
clamp off the rail's actual rendered width (a container-query-shaped change
to `admin.css`, cross-cutting beyond this lane's `testbuilder.css`/
`SectionList.tsx` scope). Recorded here so the gap is carried forward rather
than lost in a fix-round report.

## F3 — the section row has three baselines and a hard WCAG failure

In the section row: `↑`/`↓` at 36×26, the label *"Position of section
Section one"* above a **64×21** number input, then a summary string and a
`QUESTIONS SHUFFLED` chip on a third line. Nothing shares a line.

The 21px input fails **WCAG 2.5.8** (24×24 minimum). Same class elsewhere:
grading's `#grading-blind` at **17×17**, and `button.shell__mark` at
**64×24** beside `shell__icon-button` at 44px on every screen.

Register items of the same class: `G2-05` (17px checkbox in `ApiKeyPanel`),
`G2-07` (`UsagePanel` button, `padding: 0`), `G5-13` (17px checkbox in
`MultiMatching`).

**Required behaviour:** no interactive control renders below 24×24 CSS
pixels on any audited screen, and the rule is enforced by a gate rather than
by review.

## F4 — settings read as text, and two destinations are filed under Results

`Timing — 60 minutes · no opening time…` renders as grey text with no
affordance that the row opens a panel. Separately, "Grading queue" and
"Analytics" are full-width buttons between the Results and Branding rows, so
two destinations look like they belong to Results. Same as register `G3-08`.

## F5 — a dead control above the fold

"Order of the sections themselves" is a checkbox followed by a paragraph
saying it does not work (*"Not supported today"*), sitting above Settings.

## F6 — three screens, three rounding systems

Measured `border-radius` census per screen: builder `3/4/6/9999`, tests
`3/6/8/9999`, banks `3/4/8/9999`. Tokens for all four exist already
(`--rounded-xs/sm/md/lg/full` = 3/4/6/8/9999px in `tokens.css`), so the
drift is in which token each screen reaches for, not in missing tokens.

The builder also renders **7 font sizes and 3 families**. Register items of
the same class: `G1-05` (hand-written `14px` radius in `signal.css`),
`G1-07` (subpixel font sizes), `G5-15` (10px analytics headers).

## F7 — the tests list's action column is ragged

"Copy short link" wraps to two lines at **97×68** beside 44px siblings.
Six `widows` reported on that screen (control labels wrapping).

Not a finding: measured row height is **182px**, which matches the pinned
`density.spec.ts` baseline. That is intentional. Register `G2-08` proposes
changing it; **changing it moves a pinned baseline and is out of scope
here.**

## F8 — the home dashboard's card rows do not share a line

`span.home__row-time` is **22px off a shared line** across two cards in
`section.home__pane`.

## F9 — nothing guards any of this

`jsdom` has no layout engine, so none of the 2500 `apps/web` unit tests can
observe spacing, alignment, overflow or control size. The one gate that
measures a real browser, `apps/web/e2e/measurement/density.spec.ts`, pins
**row heights on four list surfaces only** — `testList`, `bankList`,
`bankBrowser`, `questionPicker` — and its own source says the builder, the
question editor and the wizard are "editing surfaces and are deliberately
outside it".

This is why F1 shipped, why the analytics screen shipped a 64px gap that
survived two review rounds, and why a fix round that wrapped an empty flex
item in another empty flex item read as correct.

**Required behaviour:** every defect class in this spec is pinned by a
browser-measured assertion, and each gate is proven able to fail.

---

# Owner walkthrough, 2026-10-24

Dictated by the owner while using the running application. Recorded close to
their words, grouped by surface. These are **reports of what a person saw**,
not diagnoses — the cause named against each is this document's, and several
still need locating.

Priority the owner stated: **the test builder, the home screen, and banks**
are where attention is wanted.

Two items here are **functional bugs, not design**, and are called out as
such: `O-17` (focus leaves the field while typing) and `O-28` (a v3 draft
nobody created). They do not belong in a design plan.

## Sign-in

- **O-01** — The sign-in screen was expected to have a left-side pane and a
  green ground; it reads as "kind of off". Buttons and structure could
  improve. Owner rated this low priority.

## The shell, on every screen

- **O-02** — The left navigation should be **collapsed by default and
  expand on hover**, showing titles only while expanded. If it is not
  expanded, the titles should not be there at all.
- **O-03** — If hover-expand ships, **remove the collapse/expand button** —
  it becomes redundant.
- **O-04** — The nav is too tall. Reducing its height buys room for test
  creation.
- **O-05** — The masthead reads **"Pariksha | Pariksha"** — the product name
  twice. Acceptable only if the second is the workspace name; today it is
  not obviously that.
- **O-06** — The signed-in email sits top-right as bare text. It should be a
  **profile control**: open it for the email, a sign-out button, and room
  for more. This is the hook RBAC will need.
- **O-07** — The light/dark toggle stays exactly as it is.

## Home

- **O-08** — "workspace · owner" is bare text with no role or affordance.
- **O-09** — "Check free-plan usage" is a hyperlink where it should be a
  proper button. (Register `G2-07` measures the same control failing WCAG
  2.5.8 at `padding: 0`.)
- **O-10** — In "Needs you / this week", a row **does not read as a test
  until hovered** and its Open button is invisible until then. Until you
  hover you cannot tell the row is a test at all. (Register `G1-01` names
  the cause: `opacity: 0` until `:hover`, which on touch is unreachable.)

## The test builder

- **O-11** — Version history lists v1, v2, v3, but there appears to be **no
  way back to an earlier version**; the screen only states that attempts in
  progress stay on their version.
- **O-12** — "View version N" is a hyperlink where a button belongs.
- **O-13** — The test name, the "Open" status, **Publish and Close are
  jammed together with no spacing** — they read as one run of text.
- **O-14** — The builder divides a test into sections, but **the candidate's
  exam screen is not divided at all** — it renders as one undifferentiated
  run. Each section must be separated on the candidate screen. This is a
  **feature gap, not styling**.
- **O-15** — Settings rows read as text. "Timing" and its siblings must look
  like something that expands or can be edited. (Same as `F4` and register
  `G3-08`.)
- **O-16** — Opening a settings panel reveals a surface that is "very stale,
  very simple" — close to unstyled.
- **O-17** — **FUNCTIONAL BUG. Focus leaves the field while typing.** Editing
  a field — attempts allowed, the sync/grade fields, anything in Branding,
  in Registration, in Access, and when editing questions — moves the cursor
  out of the field being edited, repeatedly, mid-edit. The owner reports it
  on several surfaces, so the cause is likely shared: a remount or a key
  change on each keystroke. **Belongs in systematic debugging, not a design
  plan.**
- **O-18** — On Add questions, the sections column is **compressed to the
  left** while the Add-questions panel takes the right, and the section
  summary wraps to roughly one word per line. The "questions filled" control
  is pushed out of its section. See the attached screenshot: "Technical
  Skills · fixed · 7 questions · 15 points · 10 min" renders down a ~75px
  column.
- **O-19** — The cause the owner identifies: the **"Position of section" label
  plus the section name** take the row's width, leaving the summary nothing.
  (This is `F3` reached from the other direction, and the screenshot
  confirms it.)
- **O-20** — Position and section controls "look like very basic HTML with no
  CSS at all".
- **O-21** — While selecting questions, **everything compresses and becomes
  hard to read**. The owner calls this a major problem that blocks adding
  questions comfortably.
- **O-22** — **Delete section: the confirm buttons are below the fold** —
  you must scroll to reach them — **and they carry no distinguishing
  colour**, so an irreversible action looks like any other. (Register
  `G3-02` and `G3-03` name the same defect: no modal scrim, and
  `.button-primary` on a destructive action.)
- **O-23** — The candidate-list "choose a file" control is unstyled HTML.

## Banks

- **O-24** — **Buttons have no spacing between them.** "New question" is
  joined to "Import"; "Edit" is joined to "Delete".
- **O-25** — A question's Edit / Export / Delete controls **only appear on
  hover**. They should be visible — icons, with the label clarified on
  hover.
- **O-26** — Dropdowns and most other controls here are unstyled HTML.

## The tests list

- **O-27** — Search, Status and Sort **sit at three different vertical
  levels**, because Search carries a "By name" subtext the selects do not.
  (Register `G2-03`.)
- **O-28** — **FUNCTIONAL BUG, to confirm.** The row reads "v1 live · v3
  draft" when the owner never started a v3 draft — they published v3 and the
  draft appeared by itself. Needs reproducing before it is planned against.
- **O-29** — The test name is a hyperlink with no View button beside it.
- **O-30** — "Open", "All clear" and the state column "don't load well".
- **O-31** — **"Slug" appears twice** — as a column heading above the table
  and again as a label inside every row.
- **O-32** — The "Copy short link" button is poor and its alignment is off.
  (Measured: 97×68, wrapping to two lines beside 44px siblings — `F7`.)
- **O-33** — Duplicate and Export are **hover-only**, same as `O-25`.

## Webhooks and API keys

- **O-34** — Both screens are "very bad" — everything on one straight line,
  effectively unstyled.

## What this changes about the plan

The dictation is wider than page geometry, and three themes run through it
that the original nine tasks do not cover:

1. **Hover-only is used as a layout strategy** (`O-10`, `O-25`, `O-33`), and
   it hides primary actions. On touch it hides them permanently.
2. **Controls do not look like controls** (`O-09`, `O-12`, `O-15`, `O-20`,
   `O-23`, `O-26`, `O-29`, `O-34`) — links where buttons belong, text where
   expanders belong, native elements left unstyled.
3. **Adjacent controls have no spacing** (`O-13`, `O-24`), which is a
   missing shared row primitive rather than N separate fixes.
