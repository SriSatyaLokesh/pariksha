// Counting what an organiser can actually read, for D13.
//
// AG3 — behaviour over text. `apps/web`'s own suite is jsdom, where
// `getBoundingClientRect()` returns zeros and `component-dimensions.test.ts`
// can only parse CSS text, so nothing there can answer "how many rows fit".
// Everything below asks a real Chromium for real geometry.
//
// A row counts only when its **whole height** is visible: inside the
// viewport *and* inside every vertically scrolling ancestor. The second
// half is not pedantry — `.picker-drawer__list` is `max-height: 16rem;
// overflow-y: auto`, so a drawer row scrolled out of its own list still
// has a bounding box inside the viewport, and counting it would report
// rows nobody can read.
//
// Vertical only, which is D13's own wording ("a row counts only if its
// full height is within the viewport"). The test list's table is wider
// than its panel and scrolls sideways, so every one of its rows is
// partly off to the right; that is a different defect from "fewer rows
// visible" and this gate must not silently report zero rows because of
// it.

import { expect, type Locator, type Page } from "@playwright/test";
import { ORGANISER, signIn } from "./seed";

/** The four scanning surfaces D12 puts inside the gate. The builder, the
 *  question editor, the wizard and sign-in are editing surfaces and are
 *  deliberately outside it. */
export const SURFACES = ["testList", "bankList", "bankBrowser", "questionPicker"] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * The "primary row" of each surface: the repeating element an organiser
 * scans down, one per record. Each is the list's own structural element —
 * a `<tr>` in a `<tbody>`, an `<li>` in its list — rather than a presentational
 * class, so a restyle that changes padding, colour or type keeps the
 * selector and a restyle that replaces the table with something else is
 * supposed to break it loudly.
 */
const PRIMARY_ROW: Record<Surface, string> = {
  testList: "table.testbuilder-list tbody tr",
  bankList: "ul.bank-list > li",
  bankBrowser: "table.bank-browser__table tbody tr",
  questionPicker: "ul.picker-drawer__list > li",
};

/** How many primary rows are wholly visible on `surface`, right now, at
 *  whatever viewport the page is using. No scrolling first: the figure is
 *  "what an organiser sees when the screen opens". */
export async function countPrimaryRows(page: Page, surface: Surface): Promise<number> {
  return page.locator(PRIMARY_ROW[surface]).evaluateAll((rows) => {
    const clipOf = (element: Element): { top: number; bottom: number } => {
      const clip = { top: 0, bottom: window.innerHeight };
      for (let node = element.parentElement; node !== null; node = node.parentElement) {
        if (getComputedStyle(node).overflowY === "visible") continue;
        const box = node.getBoundingClientRect();
        clip.top = Math.max(clip.top, box.top);
        clip.bottom = Math.min(clip.bottom, box.bottom);
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

/** Sign in and navigate to `surface`, leaving the page scrolled to the top
 *  and its rows loaded. The caller seeds first. */
export async function openSurface(page: Page, surface: Surface): Promise<void> {
  await signIn(page);

  if (surface === "bankList" || surface === "bankBrowser") {
    await page.getByRole("button", { name: "Question banks" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
    if (surface === "bankList") return settle(page, page.locator(PRIMARY_ROW.bankList));

    await page.locator(".bank-list__item").first().click();
    return settle(page, page.locator(PRIMARY_ROW.bankBrowser));
  }

  await page.getByRole("button", { name: "Create your first test" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
  if (surface === "testList") return settle(page, page.locator(PRIMARY_ROW.testList));

  // The picker is a drawer over the builder. It is reached the only way an
  // organiser reaches it: open a test, open a section, ask to add questions,
  // and — because a `fixed` source names no bank of its own — choose one.
  await page.locator("table.testbuilder-list tbody tr .button-link").first().click();
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

export { ORGANISER };
