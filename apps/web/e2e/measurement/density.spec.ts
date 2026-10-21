// D13 — the AG1 density gate, with before-figures captured on main's UI.
//
// AG1: "a scanning surface becomes slower to work in — more clicks, more
// scrolling, fewer rows visible". This spec is the only thing in the repo
// that can catch the third of those. It seeds a workspace through the API,
// opens each of D12's four scanning surfaces at 1440x900 in a real browser,
// and counts the primary rows whose whole box is visible.
//
// Placed in a subdirectory, deliberately. Playwright collects `testDir`
// recursively and runs the files in sorted-path order, and with
// `workers: 1` and `fullyParallel: false` that order is the run order.
// `first-run.spec.ts` must go first: its first test is what completes
// instance setup, and `GET /setup/status` answers `needed: true` only
// while no workspace row exists. A spec at `e2e/density.spec.ts` sorts
// *before* `first-run.spec.ts` ('d' < 'f'), seeds a workspace, and the
// first-run wizard is gone before the test that walks it ever runs.
// `measurement/density.spec.ts` sorts after ('f' < 'm'), which is the
// whole reason for the directory. `playwright.config.ts` is untouched
// (AG2): its only knobs are `workers`, `retries` and timeouts, and the
// viewport this gate needs is set per-test below.

import { expect, test } from "@playwright/test";
import { seedWorkspace } from "../seed";
import {
  PRIMARY_ROW,
  SURFACES,
  countPrimaryRows,
  openSurface,
  primaryRowHeight,
  primaryRowTop,
  type Surface,
} from "../density";

/**
 * The figures captured on `main`'s UI, **ratcheted** where a later plan
 * measured better. See `docs/superpowers/notes/2026-10-20-density-before.md`
 * for the commit, the date and what makes them invalid.
 *
 * A bar only ever moves in the direction that makes the gate stricter
 * (`AG2`). 6.5c tightened `bankList` from 8 to 10 and both `BEFORE_TOP`
 * figures below, because the shell's shared 56px bar is cheaper chrome than
 * the per-screen `OrganiserHeader` plus margins it replaced. Nothing here
 * was ever relaxed to make a restyle pass; if one of these goes red, that
 * is the finding.
 */
const BEFORE: Record<Surface, number> = {
  // Measured, not a placeholder. Every test-list row carries a 64px QR
  // code, an editable slug field with its own label and help line, and two
  // buttons — 182px of row — and the create form plus the filter bar put
  // the first row's top at y=786 of a 900px viewport. So not one whole row
  // is readable without scrolling. The figure is real and the gate below
  // cannot fail on it until a restyle raises it; see the note.
  testList: 0,
  // 8 on `main`, 10 under 6.5c's shell: the same 44px row with 61px less
  // chrome above it. Tightened, never loosened.
  bankList: 10,
  // 6.5e Task 2 measured this one at 7 on two runs and 8 on two others, with
  // no code change between them, and chased it before finding the cause:
  // the seeded questions come back in an order sqlite is free to vary (they
  // share an `updatedAt`), and ONE of the forty wraps its prompt to 88px
  // against the other thirty-nine at 63px. Whether that row lands inside the
  // first eight decides whether the eighth row's bottom clears y=900, so the
  // count flips by one between runs. The row HEIGHT is a median over all
  // forty and does not move; only the count does.
  //
  // So this figure's slack is load-bearing and the console line beside it is
  // not reproducible to better than +/-1. Do not ratchet it to a figure a
  // single run printed — it would be red on the next run for no reason
  // anyone could find. Raising it needs the fixture made deterministic first.
  bankBrowser: 5,
  // 6.5e Task 5 (`D18`) docked this surface, and **this figure must not be
  // raised**, though four runs printed 11, 9, 8 and 10. It is left at 8 by
  // ruling, and the reason is the same one `bankBrowser` above spends twelve
  // lines on — now live here too.
  //
  // THE MECHANISM, probed rather than inferred. The list is no longer a fixed
  // 16rem box that cut at exactly eight rows whatever they contained; it
  // fills a viewport-bounded column, measured at a **343px window**. Of the
  // forty seeded rows **36 are 25px and 4 are 50px** — the `Thermodynamics`
  // prompts, the longest topic, which take the clamp's second line in a 544px
  // column. The seeded questions share an `updatedAt`, so sqlite is free to
  // vary their order, and which of those four land inside the window is what
  // moves the count between 8 and 11.
  //
  // **The floor is 8 in the WORST DRAW, not deterministically**, and the
  // arithmetic is why it is safe to leave here: four tall rows is the most the
  // fixture can produce, and all four inside the window costs
  // `4*50 + 3*4 = 212px`, leaving 127px — which holds four more 25px rows
  // (`4*25 + 3*4 = 112`) and not five (`141`). Exactly 8. So this cannot go
  // red on row order, and it has **zero margin**: a fifth tall row, or one
  // 29px pitch off the window, takes it red.
  //
  // Ratcheting it to 9 would manufacture the flake, and `AG2` forbids
  // freezing a number nothing has proved — 9, 10 and 11 are exactly that.
  // **Raising it needs the fixture made deterministic first.** The bar that
  // DID ratchet on this surface is `BEFORE_TOP` below, because that one is
  // mechanically stable rather than statistically lucky; its own note says
  // how.
  //
  // AND THE ROW HEIGHT IS NOW BIMODAL, which "25 -> 25, unchanged" is true
  // about but does not say. `BEFORE_HEIGHT.questionPicker` is a MEDIAN over
  // forty rows — index 20 — so it cannot move until **21** of them wrap. Four
  // do. The height bar is therefore a much weaker guard on this surface than
  // its unchanged figure suggests, which is the second half of why the count
  // must keep its floor rather than be tightened to a lucky run.
  questionPicker: 8,
};

/**
 * The height of each surface's primary row on `main`, captured in the same
 * run as the counts above. **This is the assertion with teeth.**
 *
 * A count floor of 0 — which is what `main`'s test list honestly measures —
 * passes for every conceivable implementation, including one that renders
 * nothing. Row height does not: it is the variable that made the test list
 * fit zero rows in the first place, it has a real before-value on all four
 * surfaces, and it goes red the moment a restyle makes a row taller.
 *
 * §11 is wrong about two of these. It states the test list and the bank
 * list "both run 56px rows … so 11 rows are visible at 1440x900". They run
 * 182px and 44px. See the note.
 */
const BEFORE_HEIGHT: Record<Surface, number> = {
  testList: 182,
  bankList: 44,
  bankBrowser: 101,
  questionPicker: 25,
};

/**
 * How far down the viewport each surface's first primary row starts,
 * captured in the same run as the other two.
 *
 * The count and the height between them still cannot see the most likely
 * regression of the very next plan. 6.5c is the shell: a persistent sidebar
 * and a top bar, which is chrome growth above a list, literally. A restyle
 * that leaves the test-list row at 182px and puts another 300px above the
 * table passes `0 >= 0` and `182 <= 182` and is a real density loss. This is
 * the number that sees it.
 *
 * It saw it. 6.5c moved three of these four, and in both directions:
 *
 * - **test list 846.5 -> 785.5** and **bank list 458 -> 397**, the same
 *   61px on both. The shell's bar is 56px where `OrganiserHeader` was 64px
 *   plus its own margins, and the page head it replaced each screen's with
 *   is cheaper. A ratchet may always tighten, so both are lowered.
 * - **question picker unchanged at 495.63.** The builder arm passes no
 *   `title`, so it renders no `.shell__head`, and the drawer is scrolled
 *   into view rather than measured from the top of the document.
 *   (6.5e Task 5 then lowered it to 384.81 by docking the picker — that is
 *   this list's history, not its current figures; see the entry itself.)
 * - **bank browser 312.31 -> 385.31. The one bar on this branch that was
 *   RAISED, by ruling, on evidence. Read the block over its figure below
 *   before you touch it.**
 *
 * 785.5px on the test list today — of a 900px viewport, which is the whole
 * story of why that surface fits zero rows.
 */
const BEFORE_TOP: Record<Surface, number> = {
  // ZERO SLACK, both of these: each sits at the exact value 6.5c measured,
  // against `toBeLessThanOrEqual`, so any added chrome above the table —
  // 0.01px of it — goes red. That is the ratchet working, and on the two
  // surfaces 6.5e is scheduled to rebuild it will arrive looking like a
  // regression when it is a restyle. Re-measure and rule on the number the
  // way the `bankBrowser` entry below does; never nudge it to get green
  // (`AG2`).
  testList: 785.5,
  bankList: 397,
  // **Raised from `main`'s 312.31, which is the one direction this file is
  // not allowed to move a bar in (`AG2`). It was adjudicated on measurement,
  // not nudged to get green, and the measurement is this:**
  //
  // `main` rendered the bank browser with NO page heading — its document
  // outline started at `<h2>`, which 6.5c Task 1's fix round closed by giving
  // the shell a `title` and a crumb. Two separate costs sit above the table
  // now, and only one of them is the heading:
  //
  //   88px  the heading block — 72px stacked plus the 16px gap under it.
  //         6.5c took 26px of that back by laying the head out as a single
  //         ROW on browsing surfaces (shell.css, `.organiser--full`), which
  //         is what returned the count to 5. The rest is the <h1> itself and
  //         it stays: it is an accessibility fix.
  //   11px  the shell's own chrome — 56px bar + 24px page padding = 80px
  //         before any screen content, where `main`'s per-screen
  //         `OrganiserHeader` spent 69px and this screen had no page padding
  //         at all.
  //
  // **Deleting the heading outright does not reach `main`'s figure.** Hiding
  // the whole block was measured at y=323.31 — still 11px over 312.31. So no
  // surface work inside `D15` can green the old bar; it stopped measuring a
  // regression and started measuring a property the phase chose on purpose.
  // Hence the re-baseline, and hence only this one.
  //
  // **The protective bars on this surface are the other two**, and both are
  // at `main`'s figures: `BEFORE.bankBrowser` (5 rows) and
  // `BEFORE_HEIGHT.bankBrowser` (101px). They are what still catch a density
  // regression here.
  //
  // This figure itself is a `toBeLessThanOrEqual` on the top, so it goes red
  // at **+0.01px** like the two above — it has no slack of its own (whole-
  // branch review, Minor 6: an earlier draft of this comment named the count
  // as the bar that breaks first, which is wrong and this comment is the
  // evidence for a re-baseline, so it has to be exact). The 9.69px is the
  // slack on the SECOND line of defence: the fifth row ends at y=890.31 of
  // 900, so a restyle that spends another 10px above the table takes
  // `BEFORE.bankBrowser`'s count red as well — two bars, the top one first.
  bankBrowser: 385.31,
  // **Tightened from 495.63 by 6.5e Task 5 (`D18`), which docked the picker
  // as a right-hand column.** A ratchet, in the only direction this file
  // allows, and the reason it is a proven number rather than a hopeful one is
  // MECHANICAL, not statistical:
  //
  // The column is `position: sticky` at
  // `calc(var(--shell-bar) + var(--space-xl))`, so `openSurface`'s
  // `scrollIntoViewIfNeeded` parks it at a fixed **80px** no matter where the
  // organiser had scrolled to, and the first row's top becomes a pure
  // function of the drawer's own chrome above the list — its heading and the
  // filter form. That is independent of the row order which makes the COUNT
  // above jitter, which is why this figure printed to the hundredth on four
  // separate runs where the count printed four different values. Two bars on
  // one surface, stable for different reasons, and only this one earned a
  // tighter bar.
  //
  // What it buys: the dock took 110.82px of chrome out from above this list.
  // Left at 495.63 the next task could spend all of it again unwatched, which
  // is the single regression this bar exists to catch.
  //
  // Zero slack, like every figure in this block: `toBeLessThanOrEqual`, so
  // +0.01px is red.
  questionPicker: 384.81,
};

// Comfortably more rows than any plausible redesign fits in 900px, so the
// count measures the viewport rather than the fixture. If a later design
// ever reaches these numbers the gate is saturated and they must go up.
//
// **Every seeded test is published, and that biases both tables above.** A
// published test's slug field locks and gains a "Locked because this test
// has been published." help line, so a published row is the *taller* shape.
// That is deliberate: it is stable, it is the worst case, and a draft/
// published mix would need a ratio whose value is arbitrary. 6.5e must seed
// through this same helper with these same counts, or the comparison means
// nothing.
const SEED = { banks: 40, questionsPerBank: 40, tests: 40 };

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ request }) => {
  await seedWorkspace(request, SEED);
});

test("seeds a workspace reachable in the organiser", async ({ page }) => {
  await openSurface(page, "testList");
  expect(await page.locator(PRIMARY_ROW.testList).count()).toBeGreaterThanOrEqual(SEED.tests);
});

for (const surface of SURFACES) {
  test(`shows no fewer rows than main on ${surface}`, async ({ page }) => {
    await openSurface(page, surface);

    const visible = await countPrimaryRows(page, surface);
    // The **same** selector `countPrimaryRows` measured through, deliberately.
    // If the guard read a second copy of these strings and the two ever
    // diverged — the copy still matching, the measured one not — this surface
    // would report `present: 40, visible: 0, height: 0`, and `40 > 0`,
    // `0 >= 0` and `0 <= 182` would all pass. Green forever, measuring
    // nothing. One source of truth is what stops that.
    const present = await page.locator(PRIMARY_ROW[surface]).count();

    // The gate is only worth anything if the count is a measurement and not
    // a row tally: the fixture puts far more rows on every surface than
    // 900px can hold, so a count equal to the number present would mean
    // the geometry was never consulted and the figure below is noise.
    //
    // A virtualized list would fail here even if density improved, because
    // it would render only what fits. That is deliberate: a loud false alarm
    // that makes someone come and look is the right failure mode for the one
    // line holding this gate honest. Fix it then, with the measurement in
    // front of you — not by relaxing it now.
    expect(present, `${surface} seeded too few rows to measure`).toBeGreaterThan(visible);

    const height = await primaryRowHeight(page, surface);
    const top = await primaryRowTop(page, surface);
    // This spec exists to report numbers, so it prints them.
    console.log(
      `DENSITY ${surface}: ${visible} of ${present} rows fully visible, row ${height}px, first row at y=${top}`,
    );
    // An invariant, not a bar (AG3): a row that generates no layout box is
    // dropped by `countPrimaryRows` and filtered out of `primaryRowHeight`,
    // while `locator().count()` still counts it as attached — so a test list
    // of boxless rows would report `present: 40, visible: 0, height: 0` and
    // pass `40 > 0`, `0 >= 0` and `0 <= 182`. Green forever, measuring
    // nothing. Not hypothetical: `display: contents` on `thead`/`tbody`/`tr`
    // is the standard way to restyle a semantic table into a CSS grid, and it
    // generates no box. The test list is the surface most likely to get it.
    expect(height, `${surface}'s rows generate no layout box`).toBeGreaterThan(0);

    expect(visible).toBeGreaterThanOrEqual(BEFORE[surface]);
    expect(height).toBeLessThanOrEqual(BEFORE_HEIGHT[surface]);
    expect(top).toBeLessThanOrEqual(BEFORE_TOP[surface]);
  });
}
