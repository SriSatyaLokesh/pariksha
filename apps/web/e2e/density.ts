// Counting what an organiser can actually read, for D13.
//
// AG3 — behaviour over text. `apps/web`'s own suite is jsdom, where
// `getBoundingClientRect()` returns zeros and `component-dimensions.test.ts`
// can only parse CSS text, so nothing there can answer "how many rows fit".
// Everything below asks a real Chromium for real geometry.
//
// A row counts only when its **whole height** is visible: inside the
// viewport *and* inside every vertically scrolling ancestor. The second
// half is not pedantry — `.picker-drawer__list` is a height-constrained
// `overflow-y: auto` box, so a drawer row scrolled out of its own list
// still has a bounding box inside the viewport, and counting it would
// report rows nobody can read.
//
// 6.5e Task 5 (`D18`) changed where that constraint COMES FROM and nothing
// else about it: the list was `max-height: 16rem` and is now `flex: 1;
// min-height: 0` inside a docked column the viewport bounds
// (`.section-list > .picker-drawer`, testbuilder.css). Still one clipping
// ancestor, still no border — the column itself keeps `overflow: visible`,
// so `clipOf` below skips it, which is correct because the list absorbs
// the column's height rather than overflowing it.
//
// Vertical only, which is D13's own wording ("a row counts only if its
// full height is within the viewport"). The test list's table is wider
// than its panel and scrolls sideways, so every one of its rows is
// partly off to the right; that is a different defect from "fewer rows
// visible" and this gate must not silently report zero rows because of
// it.

import { expect, type Locator, type Page } from "@playwright/test";
import { signIn } from "./seed";

/** The four scanning surfaces D12 puts inside the gate. The builder, the
 *  question editor, the wizard and sign-in are editing surfaces and are
 *  deliberately outside it. */
export const SURFACES = ["testList", "bankList", "bankBrowser", "questionPicker", "monitor"] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * The "primary row" of each surface: the repeating element an organiser
 * scans down, one per record. Each is the list's own structural element —
 * a `<tr>` in a `<tbody>`, an `<li>` in its list — rather than a presentational
 * class, so a restyle that changes padding, colour or type keeps the
 * selector and a restyle that replaces the table with something else is
 * supposed to break it loudly.
 */
export const PRIMARY_ROW: Record<Surface, string> = {
  // Scoped to the test list's own container. `table.testbuilder-list` is not
  // unique: `VersionHistory` (components/testbuilder/VersionBanner.tsx) uses
  // the same class on the single-test builder. Different routes today, so the
  // figure is right either way — but if a later screen ever puts version
  // history on a list, an unscoped selector would inflate the count and drop
  // the median height, and **both of those failures are silently permissive**.
  // Descendant, not child: a restyle that wraps the table in a panel `<div>`
  // is an ordinary design-pass move and must not cost 6.5c/d a false red.
  testList: "main#main-content table.testbuilder-list tbody tr",
  bankList: "ul.bank-list > li",
  bankBrowser: "table.bank-browser__table tbody tr",
  questionPicker: "ul.picker-drawer__list > li",
  monitor: "table.monitor-table tbody tr",
};

/** How many primary rows are wholly visible on `surface`, right now, at
 *  whatever viewport the page is using. No scrolling first: the figure is
 *  "what an organiser sees when the screen opens". */
export async function countPrimaryRows(page: Page, surface: Surface): Promise<number> {
  return page.locator(PRIMARY_ROW[surface]).evaluateAll((rows) => {
    // THE PADDING BOX, NOT THE BORDER BOX, and the difference is a row.
    //
    // `getBoundingClientRect()` is the BORDER box: it includes the element's
    // borders AND the strip a horizontal scrollbar occupies along the bottom.
    // A scroll container that is scrolling sideways paints nothing readable in
    // that strip — roughly 15px of it — so clipping on the border box counts a
    // row an organiser cannot read. The error runs in the PERMISSIVE
    // direction, which is the one `AG2` cares about: it reports more rows than
    // are there, so a density regression could hide behind it.
    //
    // `clientTop` is the top border's width and `clientHeight` is the padding
    // box's height with the scrollbar strip already taken off, so the two
    // together are exactly the PADDING BOX — padding included, borders and
    // scrollbar excluded. That is the right box and not merely a tighter one:
    // the padding box is where overflow clipping actually happens, so it is
    // the edge a reader asking "can this row be seen" has to use.
    //
    // ONE ROUNDING CAVEAT, named because `bankBrowser`'s count already moves
    // by one between runs and nobody should spend an hour on the wrong
    // suspect. `clientTop` and `clientHeight` are integer-rounded where
    // `getBoundingClientRect()` is fractional, so a sub-pixel border could
    // shift either edge by less than a pixel. No container in this gate's
    // path has a border at all, and the quantity this guards against is a
    // ~15px strip, so the rounding is bounded and irrelevant here — but it is
    // not zero, and it is not the cause of that jitter (see the note beside
    // `BEFORE.bankBrowser`, which is a wrapped prompt and a free row order).
    //
    // 6.5e Task 2 added the first scroll containers to sit between a row and
    // the viewport (`.table-scroll`, `D21a`), which is what made this
    // reachable at all. LATENT WHEN IT WAS FIXED, measured twice over, and no
    // figure in `density.spec.ts` moved:
    //
    //   1. Neither table overflows at 1440x900 with the real 40-row fixture
    //      (`scrollWidth === clientWidth` on both wrappers), so there is no
    //      scrollbar strip to mis-count.
    //   2. Structurally, a wrapper with AUTO height cannot be caught by this
    //      at all: its content edge sits exactly at its table's bottom, so no
    //      row can extend past it, and the strip is painted below the last
    //      row rather than across one. The bad count needs a container that
    //      is BOTH height-constrained — so rows really do run past its
    //      content edge — and taller in its border box than its content box.
    //      `.picker-drawer__list` is the one height-constrained container
    //      here (`flex: 1; min-height: 0` in a viewport-bounded column since
    //      6.5e Task 5; `max-height: 16rem` before it) and it has no border
    //      and no horizontal scrollbar, so its two boxes coincide.
    //
    // It goes live the day a `.table-scroll` grows a `max-height`, or any
    // clipping ancestor grows a border. The probe that proved the change:
    // `max-height: 400px` plus a 60px bottom border on `.table-scroll` makes
    // the old reader count 5 rows and this one 4.
    //
    // NOT PROVABLE FROM THE SCROLLBAR SIDE IN THIS HARNESS. Playwright
    // launches Chromium with `--hide-scrollbars`, so the strip measures 0px
    // even with `overflow-x: scroll` and an explicit
    // `::-webkit-scrollbar { height: 15px }`. The border above is the same
    // quantity from the other source, which is why the probe uses it.
    const clipOf = (element: Element): { top: number; bottom: number } => {
      const clip = { top: 0, bottom: window.innerHeight };
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        if (getComputedStyle(node).overflowY === "visible") continue;
        const top = node.getBoundingClientRect().top + node.clientTop;
        clip.top = Math.max(clip.top, top);
        clip.bottom = Math.min(clip.bottom, top + node.clientHeight);
      }
      return clip;
    };

    return rows.filter((row) => {
      const box = row.getBoundingClientRect();
      if (box.height === 0 || box.width === 0) return false;
      const clip = clipOf(row);
      return box.top >= clip.top && box.bottom <= clip.bottom;
    }).length;
  });
}

/**
 * The height of `surface`'s primary row, in CSS pixels — the median over
 * **every** matched row, not only the ones on screen, so one odd row (a
 * wrapped prompt, a longer name) does not stand for the list. Measuring all
 * of them deliberately: a median taken from the handful above the fold would
 * move with the viewport and with whatever chrome sits above the list, which
 * is the count's job, not this one's.
 *
 * Row height is the density variable that actually bites. It is what made
 * the test list fit zero rows: 182px of QR code, slug field and buttons per
 * row. A count alone cannot catch a restyle that makes rows taller on a
 * surface whose count is already zero, and it is the only one of the two
 * numbers that has teeth on every surface today.
 */
export async function primaryRowHeight(page: Page, surface: Surface): Promise<number> {
  return page.locator(PRIMARY_ROW[surface]).evaluateAll((rows) => {
    const heights = rows
      .map((row) => row.getBoundingClientRect().height)
      .filter((height) => height > 0)
      .sort((a, b) => a - b);
    const middle = heights[Math.floor(heights.length / 2)] ?? 0;
    // Two decimals: sub-pixel layout jitter is not a density change.
    return Math.round(middle * 100) / 100;
  });
}

/**
 * How far down the viewport `surface`'s first primary row starts, in CSS
 * pixels — the chrome above the list, measured.
 *
 * Height alone cannot see this. A restyle that leaves rows at 182px and adds
 * 300px of sidebar and top bar above the table is invisible to both the count
 * (already 0 on the test list) and the height, and chrome growth above a list
 * is precisely what the shell plan does next.
 */
export async function primaryRowTop(page: Page, surface: Surface): Promise<number> {
  return page.locator(PRIMARY_ROW[surface]).evaluateAll((rows) => {
    const first = rows[0];
    // No rows at all is not "0px of chrome" — it is a broken selector, and
    // it has to fail the assertion rather than sail under it.
    if (first === undefined) return Number.POSITIVE_INFINITY;
    return Math.round(first.getBoundingClientRect().top * 100) / 100;
  });
}

/** A destination in the shell's rail (`D3`). 6.5c replaced the dashboard's
 *  two entry buttons — "Question banks" and "Create your first test" — with
 *  one persistent nav, and the second of those now appears only on an empty
 *  workspace, which a seeded one never is. Scoped to the nav so a "Tests"
 *  or "Banks" control elsewhere on a screen cannot be clicked by accident.
 *  Navigation only: nothing here changes what is counted or how. */
function rail(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: label });
}

/** Sign in and navigate to `surface`, leaving the page scrolled to the top
 *  and its rows loaded. The caller seeds first. */
export async function openSurface(page: Page, surface: Surface): Promise<void> {
  await signIn(page);

  if (surface === "bankList" || surface === "bankBrowser") {
    await rail(page, "Banks").click();
    await expect(page.getByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
    if (surface === "bankList") return settle(page, page.locator(PRIMARY_ROW.bankList));

    await page.locator(".bank-list__item").first().click();
    return settle(page, page.locator(PRIMARY_ROW.bankBrowser));
  }

  await rail(page, "Tests").click();
  await expect(page.getByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
  if (surface === "testList") return settle(page, page.locator(PRIMARY_ROW.testList));

  if (surface === "monitor") {
    await page.locator(`${PRIMARY_ROW.testList} .button-link`).first().click();
    await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
    await page.getByRole("button", { name: "Live monitor" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Live monitor" })).toBeVisible();
    return settle(page, page.locator(PRIMARY_ROW.monitor));
  }

  // The picker is a drawer over the builder. It is reached the only way an
  // organiser reaches it: open a test, open a section, ask to add questions,
  // and — because a `fixed` source names no bank of its own — choose one.
  await page.locator(`${PRIMARY_ROW.testList} .button-link`).first().click();
  await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
  await page.locator(".section-row__summary").first().click();
  await page.getByRole("button", { name: "Add questions" }).first().click();

  const bank = page.getByLabel("Bank");
  await expect(bank).toBeVisible();
  await bank.selectOption({ index: 1 });
  await expect(page.locator(PRIMARY_ROW.questionPicker).first()).toBeAttached();
  // Not scrolled to the top: the drawer opens part-way down a long builder
  // page and takes focus, so the top of the document is not where the
  // organiser who just clicked "Add questions" is looking. Measuring the
  // picker from there would report zero rows for a drawer that is on
  // screen. This is the same scroll the browser performs on focus.
  await page.locator(".picker-drawer").scrollIntoViewIfNeeded();
}

/** Rows arrive from a fetch, so wait for the first one, then put the page
 *  back at the top — a `.click()` on a control may have scrolled it. */
async function settle(page: Page, rows: Locator): Promise<void> {
  await expect(rows.first()).toBeAttached();
  await page.evaluate(() => window.scrollTo(0, 0));
}
