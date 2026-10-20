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
import { SURFACES, countPrimaryRows, openSurface, type Surface } from "../density";

/**
 * The figures captured on `main`'s UI. See
 * `docs/superpowers/notes/2026-10-20-density-before.md` for the commit,
 * the date and what makes them invalid.
 */
const BEFORE: Record<Surface, number> = {
  // Measured, not a placeholder. Every test-list row carries a 64px QR
  // code, an editable slug field with its own label and help line, and two
  // buttons — 182px of row — and the create form plus the filter bar put
  // the first row's top at y=847 of a 900px viewport. So not one whole row
  // is readable without scrolling. The figure is real and the gate below
  // cannot fail on it until a restyle raises it; see the note.
  testList: 0,
  bankList: 8,
  bankBrowser: 5,
  questionPicker: 8,
};

// Comfortably more rows than any plausible redesign fits in 900px, so the
// count measures the viewport rather than the fixture. If a later design
// ever reaches these numbers the gate is saturated and they must go up.
const SEED = { banks: 40, questionsPerBank: 40, tests: 40 };

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeAll(async ({ request }) => {
  await seedWorkspace(request, SEED);
});

test("seeds a workspace reachable in the organiser", async ({ page }) => {
  await openSurface(page, "testList");
  expect(await page.locator("table.testbuilder-list tbody tr").count()).toBeGreaterThanOrEqual(
    SEED.tests,
  );
});

for (const surface of SURFACES) {
  test(`shows no fewer rows than main on ${surface}`, async ({ page }) => {
    await openSurface(page, surface);

    const visible = await countPrimaryRows(page, surface);
    const present = await page.locator(ROW_COUNT[surface]).count();

    // The gate is only worth anything if the count is a measurement and not
    // a row tally: the fixture puts far more rows on every surface than
    // 900px can hold, so a count equal to the number present would mean
    // the geometry was never consulted and the figure below is noise.
    expect(present, `${surface} seeded too few rows to measure`).toBeGreaterThan(visible);

    // This spec exists to report a number, so it prints one.
    console.log(`DENSITY ${surface}: ${visible} of ${present} rows fully visible at 1440x900`);
    expect(visible).toBeGreaterThanOrEqual(BEFORE[surface]);
  });
}

const ROW_COUNT: Record<Surface, string> = {
  testList: "table.testbuilder-list tbody tr",
  bankList: "ul.bank-list > li",
  bankBrowser: "table.bank-browser__table tbody tr",
  questionPicker: "ul.picker-drawer__list > li",
};
