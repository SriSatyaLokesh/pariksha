# Density before-figures — D13 / AG1

## Read this first: §11's premise is false

The spec states, as the thing D13 was commissioned to settle:

> The test list and the bank list both run **56px rows**, of which the id line
> under the name is **16.5px**, so **11 rows** are visible at 1440×900 where
> **15** would be without it.

Measured in Chromium at 1440×900 against `main`'s UI:

| surface | §11 says | measured |
| --- | --- | --- |
| test list | 56px rows, 11 visible | **182px rows, 0 visible** |
| bank list | 56px rows, 11 visible | **44px rows, 8 visible** |

Neither number is close, and they are wrong in opposite directions. The test
list's row is **more than three times** the assumed height, because every row
carries a 64px QR code, an editable slug `<input>` with its own label and help
line, and two buttons. The create form and the filter bar above the table put
the first row's top at **y = 847** of a 900px viewport, so **not one whole row
is readable without scrolling**. The bank list's row is *smaller* than assumed,
at 44px.

**How this was measured.** A seeded workspace built entirely over the HTTP API
(40 banks, 40 questions each, 40 published tests), opened in a real Chromium at
1440×900 by `apps/web/e2e/measurement/density.spec.ts`, counting primary rows
whose whole height is inside the viewport and inside every vertically scrolling
ancestor. Three consecutive full-suite runs, identical numbers. `apps/web`'s own
suite cannot do this: it is jsdom, `getBoundingClientRect()` returns zeros, and
`component-dimensions.test.ts` parses CSS text.

**The open question §11 framed cannot be answered as posed.** It asks whether
the 16.5px id line under the name costs four rows (11 instead of 15), and rules
that "the id stays for now and the spec decides". The spec has now decided
something else: on the test list the id line is not the constraint and removing
it would change the count from 0 to 0. The constraint is the QR code, the inline
slug editor and the chrome above the table. §11's follow-on argument — that
inlining the id is "not the cheap escape it looks" because the table already
fills its panel with 0px slack — rests on the same 56px derivation and needs
re-deriving before anything is built on it.

Three later plans read this note. **Do not carry the 56px / 11-row figure
forward.**

---

**Captured:** 2026-10-21 (re-measured against 6.5c's shell on 2026-10-21; see
"Ratcheted by 6.5c" below)
**Measured at:** `db2e7f5` on `phase-6-5a/defects-and-measurement` — the sha both
columns below reproduce from. The counts were first taken at `0e0cfcd`; the
row-height column and `primaryRowHeight` arrived in `db2e7f5`, and the counts
are unchanged between the two.
**Against `main`:** `1a7ed66` (`origin/main`). The branch's only `apps/web/src`
changes from that commit are `components/exam/Receipt.tsx` and `lib/run.ts` —
the candidate receipt, in the exam runtime. **No scanning surface differs from
`main`**, so these figures are `main`'s UI, captured before the first
restyling commit exists, which is what D13 requires of them.
**Viewport:** 1440 × 900, Chromium (Playwright's `Desktop Chrome`), no zoom.
**Spec:** `apps/web/e2e/measurement/density.spec.ts`, helpers in
`apps/web/e2e/density.ts` and `apps/web/e2e/seed.ts`.

## The figures

| surface | primary row | fully visible | of | row height | first row at |
| --- | --- | --- | --- | --- | --- |
| test list | `main#main-content table.testbuilder-list tbody tr` | **0** | 40 | **182px** | **y = 846.5** |
| bank list | `ul.bank-list > li` | **8** | 40 | **44px** | **y = 458** |
| bank browser | `table.bank-browser__table tbody tr` | **5** | 40 | **101px** | **y = 312.31** |
| question picker | `ul.picker-drawer__list > li` | **8** | 40 | **25px** | **y = 495.63** |

Stable: identical across repeated runs of the whole suite. No range to record.

### Ratcheted by 6.5c — what the constants say today

6.5c (the shell) re-measured all sixteen figures. Three moved in the strict
direction and the constants in `density.spec.ts` were tightened to match; one
surface regressed and its three bars were **left at `main`'s figures**, which
is why the gate is red on it. Nothing was loosened (`AG2`).

| surface | fully visible | row height | first row at |
| --- | --- | --- | --- |
| test list | 0 (unchanged) | 182px (unchanged) | **846.5 -> 785.5** |
| bank list | **8 -> 10** | 44px (unchanged) | **458 -> 397** |
| bank browser | 5 (restored) | 101px (restored) | **312.31 -> 385.31, re-baselined** |
| question picker | 8 (unchanged) | 25px (unchanged) | 495.63 (unchanged) |

**Why the two lists improved by the same 61px.** The shell's one persistent
bar is **56px** where each screen's own `OrganiserHeader` was **64px plus its
own margins**, and the page head that replaced each screen's header block is
cheaper than what it replaced. Shared chrome turned out to be *lighter* chrome.

**Why the question picker did not move at all.** The builder arm passes no
`title` to `OrganiserShell`, so that screen renders no `.shell__head`, and the
drawer is scrolled into view rather than measured from the top of the document.

**Why the bank browser regressed, measured not guessed.** Two independent
causes, separated with a browser probe at 1440x900:

1. **Row height 101px -> 145px.** On `main` the bank browser was the one
   organiser screen rendered *outside* `.organiser--wide` — a bare
   `<div id="main-content" class="bank-browser">` at full viewport width. The
   shell wraps every arm in `<main class="organiser organiser--wide
   shell__page">`, so it is now clamped to **1080px**. Measured:
   `.bank-browser__main` **1183px -> 772px**, and the seeded prompt that fit
   one line at 1183px wraps at 772px. Forcing `max-width: none` **and**
   collapsing the shell rail restores `__main` to 1047px and the row to
   **101px**. Collapsing the rail *alone* changes nothing — the page is
   clamped at 1080 either way, so **`D18`'s "opens with the rail collapsed"
   is inert at this viewport unless the clamp is lifted too.** That is
   measured, not inferred.
2. **First row 312.31 -> 411.31.** The screen gained a page heading it never
   had. 6.5c Task 1's fix round gave the bank browser a `title` and a crumb
   because its document outline started at `<h2>`; `.shell__head` is **88px**
   directly above a scanning table. Hiding it in the probe puts the first row
   back at **323.31**.

**Cause 1 is fixed; `D18` is spec text this phase owed.** 6.5c shipped both
halves of it: `OrganiserShell` takes a `wide` flag that drops the clamp
(`.organiser--full`, beside `.organiser--wide` where that idiom already is) and
opens the rail collapsed. The row is back to **101px**, exactly `main`'s figure,
and the count went **3 -> 4**. `BEFORE_HEIGHT.bankBrowser` passes again.

**Cause 2 is not reachable by spacing, measured to the pixel after the fix:**

| band | px | owner |
| --- | --- | --- |
| `.shell__bar` | 56 | `D3`, the persistent bar |
| `.shell__page` `padding-block-start` (`--space-xl`) | 24 | `D15` page scale |
| `.shell__head` — crumb 18 + gap 8 + `<h1>` 46 | 72 | Task 1 fix round, a11y |
| `.shell__page` flex `gap` (`--space-lg`) | 16 | the heading block's bottom spacing |
| **shell chrome above `.bank-browser`** | **168** | 6.5c's |
| the screen's own chrome — bulk bar, actions, `thead` | 243.31 | 6.5e's |
| **first row at** | **411.31** | |

Rows are exactly 101.00px each, so row 5 ends at **916.31** and the count needs
**16.31px** out of that 168.

**The heading block's bottom spacing is 16.00px — deleting it outright still
leaves 0.31px.** One step down the scale (`--space-lg` -> `--space-md`) recovers
4px; taking the page's top padding one step down too (`--space-xl` ->
`--space-lg`, already off `D15`'s page scale) adds 8 more. Nothing reaches 16.31
without moving two tokens two steps each, which is the ad-hoc value `D15` exists
to forbid. The 26px that *would* clear it is the crumb, and that is a content
decision, not spacing.

**`BEFORE_TOP` is unreachable inside the shell at all**, which is the part that
settles it. Hiding the whole heading block (-88px) puts the first row at
**323.31** — still **11px over** `main`'s 312.31, because the shell spends
56 + 24 = **80px** before any screen content where `main`'s per-screen
`OrganiserHeader` spent 69 and the bank browser had no page padding at all. So
even deleting the `<h1>`, and reopening the `<h2>`-outline defect Task 1's review
closed, does not green that bar. Only taking `D15`'s page padding below its own
scale would.

**The 16.31px was found in the head's SHAPE, not its spacing.** A crumb and an
`<h1>` do not need to stack on a surface whose whole point is width:
`.organiser--full > .shell__head` lays them out in one row, with any actions
pushed to the end of it. A layout change, not a spacing one — every token is
the one the column already used, turned along the other axis, which is what
keeps it inside `D15` as a usage rule. `flex-wrap` restores the stacked shape
when the line runs out, so `D3a`'s narrow widths are untouched.

Measured: the head **72px -> 46px**, the first row **411.31 -> 385.31**, and the
count **4 -> 5**, which is `main`'s own figure. The `<h1>` stays.

**`BEFORE_TOP.bankBrowser` was then re-baselined 312.31 -> 385.31 — the one bar
on this branch raised, by ruling, with its evidence in the constant's own
comment.** The reason is the measurement above: the shell spends
56 + 24 = 80px before any screen content where `main` spent 69 and this screen
had no page padding, so hiding the whole heading block still measured 323.31,
11px over. That bar stopped measuring a regression and started measuring a
property the phase chose on purpose. The **count (5) and the height (101px)
stay at `main`'s figures and are the protective bars here**; the new offset
keeps **9.69px** of slack — the fifth row ends at y=890.31 of 900 — so another
10px above that table takes the count red, which is the failure `AG1` names.

**Do not lower `BEFORE`.** One bar moved, once, on evidence.

**All three columns are gates**, and the count is the weakest of them today.
A count floor of 0 — which is what `main`'s test list honestly measures — passes
for every conceivable implementation, including one that renders nothing at all;
that is a guard with nothing behind it, and it sits on the most important
scanning surface in the product. The other two are what give it teeth:

- **Row height** is the variable that *caused* the zero. Proven, not assumed:
  adding `padding-block: 16px` to `.testbuilder-list td` took the row from
  182px to 202px and the gate failed — while the count assertion stayed green
  at 0.
- **First row at y** is the chrome above the list, measured. Height alone
  cannot see a restyle that leaves rows at 182px and puts another 300px of
  sidebar and top bar above the table, and chrome growth above a list is
  literally what the shell plan does next. On the test list this number is
  **846.5 of a 900px viewport**, which is the whole story of why that surface
  fits zero rows.

And one invariant that is not a figure at all: **the row height must be greater
than zero**. `countPrimaryRows` drops a row with no layout box, `primaryRowHeight`
filters it out and falls back to 0, and `locator().count()` counts it anyway
because it is attached — so a test list of boxless rows would report
`present: 40, visible: 0, height: 0` and pass every bar above. `display: contents`
on `thead`/`tbody`/`tr` is the standard way to restyle a semantic table into a
CSS grid and generates no box, so this is a live risk on exactly the surface
where it would pass silently.

Height is the **median over every matched row** — all 40, not only the ones
above the fold — so one wrapped prompt or one long name does not stand for the
list, rounded to two decimals because sub-pixel layout jitter is not a density
change. Measuring all of them is deliberate: a median taken from the handful on
screen would move with the viewport and with whatever chrome sits above the
list, which is the count column's job, not this one's.

## The fixture is all-published, and that biases both columns

Every test the seed creates is published (Task 1 of 6.5a made a draft with no
duration unpublishable, so the seed sets `duration_minutes: 60` and publishes).
A published test's slug field locks and gains a "Locked because this test has
been published." help line, so **a published row is the taller shape**. The
figures above are measured against an all-published list.

This is deliberate and it stays: it is the stable shape, it is the worst case,
and a draft/published mix would need a ratio whose value is arbitrary and which
6.5e would have to match exactly. **6.5e must seed through `seedWorkspace` with
these same counts, or the comparison is meaningless.**

## What the figure means

A row counts only when its **whole height** is inside the viewport *and*
inside every vertically scrolling ancestor, with the page as the organiser
first sees it — the list screens unscrolled, the picker drawer where opening
it leaves the page. A half-visible row is not a row you can read (AG3), and a
drawer row scrolled out of `.picker-drawer__list` (`max-height: 16rem;
overflow-y: auto`) still has a bounding box inside the viewport, so clipping
by ancestors is counted, not just by the window.

Horizontal overflow is deliberately **not** counted. D13's wording is "full
height within the viewport", and the test-list table is wider than its panel
and scrolls sideways, so a width check would report zero rows on every
surface for a reason that is a different defect from "fewer rows visible".

## What 6.5e owes this note

`BEFORE.testList = 0` is a real measurement of a real screen, but the count
floor it sets can never fail. **6.5e must re-measure the test list after the
restyle and raise `BEFORE.testList`**, or the test list keeps a count floor of
nothing for the life of the project. The same applies to every
`BEFORE_HEIGHT` a restyle improves: a height that drops to 96px and is left
recorded at 182px is a gate with 86px of slack in it.

Until then, the test list is guarded by its **height** constant alone, which
is why that constant exists.

## The rest of the fixture

`seedWorkspace(request, { banks: 40, questionsPerBank: 40, tests: 40 })`,
created entirely over the HTTP API the organiser itself calls — never by
writing rows: banks one at a time, questions by whole-bank import, tests
created, drafted and published. 40 is comfortably more than any plausible redesign fits in
900px, so the count measures the viewport and not the fixture. The spec
asserts `present > visible` on every surface for exactly that reason: a count
equal to the rows present would mean the geometry was never consulted.

Besides the all-published bias above, one more fixture choice moves the
numbers: **questions are `true_false` with one tag and a difficulty**. Prompt
length decides whether a bank-browser row wraps to a second line, and the
seeded prompt is one line at 1440px.

## What would make these figures invalid

- Measuring at any viewport other than 1440×900.
- Measuring after a restyling commit, which is the one thing D13 forbids: the
  figure would then be the new design compared against itself.
- Changing `seedWorkspace`'s row counts downward until `present` stops
  exceeding what fits — the spec's own `present > visible` assertion is the
  guard against this.
- Changing the counting rule in `apps/web/e2e/density.ts` (adding a width
  check, allowing partial rows, scrolling the list to the top of the viewport
  before counting, or taking the height median over only the visible rows).
  Any of those is a different metric and the numbers above do not transfer
  to it.
- Changing a selector in `PRIMARY_ROW` without re-measuring. It is exported
  from `density.ts` and read by both the measurement and the `present >
  visible` guard that proves the measurement matched anything, on purpose: a
  second copy that drifted from it would let a surface report 40 rows
  present, 0 visible and 0px tall, and pass every assertion.
- Seeding a draft/published mix, or any other counts, without re-measuring —
  a published row is the taller shape and these figures assume every test is
  published.
- Raising `BEFORE`, or raising `BEFORE_HEIGHT` or `BEFORE_TOP`, without
  re-measuring — or lowering `BEFORE` to make a restyle pass. AG2: never make
  a gate green by moving a bar. If the height or offset assertion goes red,
  that is a finding.
- Navigating to a surface any way other than through `openSurface`. 6.5c
  retired the dashboard's two entry buttons for the shell's rail, so that
  helper now clicks "Banks" and "Tests" inside `nav[aria-label="Organiser"]`.
  Navigation is not a counting rule and the figures transfer across it — but
  a second route that reached a screen in a different state would not.
- Seeding the questions any way other than through `seedWorkspace`. It fills
  each bank with **one whole-bank import** (`POST .../banks/:bankId/import`,
  the endpoint the import dialog calls) rather than 40 per-question POSTs.
  The two write paths differ — the per-question route calls `upsertQuestion`,
  import goes through `writeImportedBank` -> `questionInsertStatements` — but
  they produce byte-identical rows, which is why the figures match, verified
  rather than assumed. 1,600 round trips through `vite preview`'s proxy made
  the harness answer 502 mid-seed on Windows; 40 do not. Note the ceiling the
  route brings: `questionsPerBank` is capped at `IMPORT_MAX_QUESTIONS` (500)
  per bank.

## One more trap, found by 6.5c

**The first failing surface hides every later one.** A failed test tears the
worker down and Playwright re-runs `test.beforeAll` in a fresh one, where
`seedCall` is back at 1 — so the second `seedWorkspace` re-uses
`assessment-01-*` and dies on `409 slug_taken`, and every surface after the
first failure reports that 409 instead of its own figures. The 409 is
**protective** and must not be "fixed" by making the slug unique: the API
process is not restarted, so a successful re-seed would double the fixture to
80 banks and 80 tests and every figure after it would be measured against a
different workspace. To read a surface behind a failing one, run it alone with
`-g`. Making `beforeAll` idempotent (skip when the workspace already holds the
fixture) is the real fix if this ever costs more than one extra run.

## One structural note for whoever edits the harness

The spec lives in `e2e/measurement/` rather than `e2e/`, and the directory is
load-bearing. Playwright collects `testDir` recursively and, at `workers: 1`
with `fullyParallel: false`, runs files in sorted-path order.
`first-run.spec.ts` must run first: its first test walks the first-run wizard,
and `GET /setup/status` answers `needed: true` only while no workspace row
exists. A spec at `e2e/density.spec.ts` sorts *before* it (`d` < `f`), seeds a
workspace, and the wizard is gone before the test that walks it ever runs.
`e2e/measurement/density.spec.ts` sorts after (`f` < `m`).

`playwright.config.ts` is untouched (AG2). The 1440×900 viewport is set
per-file with `test.use`, and nothing here changes `workers`, `retries` or a
timeout.
