# Density before-figures — D13 / AG1

**Captured:** 2026-10-21
**Measured at:** `0e0cfcd` on `phase-6-5a/defects-and-measurement`
**Against `main`:** `1a7ed66` (`origin/main`). The branch's only `apps/web/src`
changes from that commit are `components/exam/Receipt.tsx` and `lib/run.ts` —
the candidate receipt, in the exam runtime. **No scanning surface differs from
`main`**, so these figures are `main`'s UI, captured before the first
restyling commit exists, which is what D13 requires of them.
**Viewport:** 1440 × 900, Chromium (Playwright's `Desktop Chrome`), no zoom.
**Spec:** `apps/web/e2e/measurement/density.spec.ts`, helpers in
`apps/web/e2e/density.ts` and `apps/web/e2e/seed.ts`.

## The figures

| surface | primary row | fully visible | present | 
| --- | --- | --- | --- |
| test list | `table.testbuilder-list tbody tr` | **0** | 40 |
| bank list | `ul.bank-list > li` | **8** | 40 |
| bank browser | `table.bank-browser__table tbody tr` | **5** | 40 |
| question picker | `ul.picker-drawer__list > li` | **8** | 40 |

Stable: identical across repeated runs of the whole suite. No range to record.

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

## The test list's zero is a measurement, not a blank

This is the headline finding and it contradicts §11's own premise.

§11 says the test list and the bank list "both run 56px rows … so 11 rows are
visible at 1440×900". The shipped test list does not. Each row carries a 64px
QR code, an editable slug `<input>` with its own label and help line, and two
buttons: **182px of row**. The create form and the filter bar above the table
put the first row's top at **y = 847** of a 900px viewport. Not one whole row
is readable without scrolling.

So `BEFORE.testList = 0` is a real measurement of a real screen — but the gate
it sets can never fail. **6.5e must re-measure the test list after the restyle
and raise the figure in `BEFORE`**, or the test list keeps a floor of nothing
for the life of the project. The other three figures are live gates today.

The 56px claim in §11 is also worth re-deriving before anything is built on
it: on this evidence it describes neither the test list nor the bank list as
shipped.

## The fixture, and how it biases the numbers

`seedWorkspace(request, { banks: 40, questionsPerBank: 40, tests: 40 })`,
created entirely over the HTTP API the organiser itself calls — never by
writing rows. 40 is comfortably more than any plausible redesign fits in
900px, so the count measures the viewport and not the fixture. The spec
asserts `present > visible` on every surface for exactly that reason: a count
equal to the rows present would mean the geometry was never consulted.

Two fixture choices move the numbers and should be kept in mind when
comparing a later measurement:

- **Every seeded test is published.** Task 1 of 6.5a made a draft with no
  duration unpublishable, so the seed sets `duration_minutes: 60` and
  publishes. A published test's slug field is locked and gains a "Locked
  because this test has been published." help line, which makes the row
  *taller* than a draft's. The test-list figure is 0 either way, but a future
  seed that stops publishing is not comparing like with like.
- **Questions are `true_false` with one tag and a difficulty.** Prompt length
  decides whether a bank-browser row wraps to two lines. The seeded prompt is
  one line at 1440px.

## What would make these figures invalid

- Measuring at any viewport other than 1440×900.
- Measuring after a restyling commit, which is the one thing D13 forbids: the
  figure would then be the new design compared against itself.
- Changing `seedWorkspace`'s row counts downward until `present` stops
  exceeding what fits — the spec's own `present > visible` assertion is the
  guard against this.
- Changing the counting rule in `apps/web/e2e/density.ts` (adding a width
  check, allowing partial rows, scrolling the list to the top of the viewport
  before counting). Any of those is a different metric and the numbers above
  do not transfer to it.
- Raising `BEFORE` without re-measuring, or lowering it to make a restyle
  pass. AG2: never make a gate green by moving a bar.

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
