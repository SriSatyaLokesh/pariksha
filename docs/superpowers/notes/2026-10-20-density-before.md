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

**Captured:** 2026-10-21
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

| surface | primary row | fully visible | of | row height |
| --- | --- | --- | --- | --- |
| test list | `table.testbuilder-list tbody tr` | **0** | 40 | **182px** |
| bank list | `ul.bank-list > li` | **8** | 40 | **44px** |
| bank browser | `table.bank-browser__table tbody tr` | **5** | 40 | **101px** |
| question picker | `ul.picker-drawer__list > li` | **8** | 40 | **25px** |

Stable: identical across repeated runs of the whole suite. No range to record.

**Both columns are gates**, and the height column is the one with teeth today.
A count floor of 0 — which is what `main`'s test list honestly measures — passes
for every conceivable implementation, including one that renders nothing at all;
that is a guard with nothing behind it, and it sits on the most important
scanning surface in the product. Row height is the variable that *caused* the
zero, it has a real before-value on all four surfaces, and it goes red the
moment a restyle makes a row taller. Proven, not assumed: adding
`padding-block: 16px` to `.testbuilder-list td` took the row from 182px to 202px
and the gate failed — while the count assertion stayed green at 0.

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
writing rows. 40 is comfortably more than any plausible redesign fits in
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
- Raising `BEFORE`, or raising `BEFORE_HEIGHT`, without re-measuring — or
  lowering either to make a restyle pass. AG2: never make a gate green by
  moving a bar. If the height assertion goes red, that is a finding.

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
