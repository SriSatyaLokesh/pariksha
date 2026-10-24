// Phase 8h — the frame. Shared Playwright helpers for the organiser's page
// geometry: the dead-scroll gate (F1), the editing column's width (F2), the
// 24px target-size floor (F3) and the token census (F6). One module, the
// same precedent `e2e/density.ts` set for D13, because every gate here reads
// a real Chromium the way that one does — `jsdom` has no layout engine and
// cannot see any of this.

import { expect, type Page } from "@playwright/test";
import { ORGANISER } from "./seed";

/** The view query strings for the organiser screens that carry no
 * `checklist-rail` — used both to prove Task 1's fix does not disturb them
 * (Review Focus 5) and as the base of Task 3's wider `AUDITED_VIEWS`. */
export const ORGANISER_VIEWS = ["view=tests", "view=banks", "view=analytics", "view=grading"] as const;

/** Opens the builder for `testId`, waiting for the sections heading so
 * callers never measure a page still on "Loading…". Signing in and picking
 * a workspace are the CALLER's job — this file's own fixtures live outside
 * `workspaces[0]`, so every spec using this already has to sign in and
 * switch before it can reach anything, and a second `signIn` here would
 * `goto` the organiser root while already authenticated, where there is no
 * "continue with…" link to click and the call hangs to its timeout. */
export async function openBuilder(page: Page, testId: string): Promise<void> {
  await page.goto(`${ORGANISER}?view=test&test=${testId}`);
  await expect(page.getByRole("heading", { name: "Sections" })).toBeVisible();
}

/**
 * `document.documentElement.scrollHeight` minus the lowest content pixel
 * actually painted inside `<main>` — F1's own definition. A page with no
 * dead scroll answers 0 (modulo sub-pixel rounding); a grid with empty rows
 * paying `row-gap` answers however many pixels of gap exist below the last
 * real row.
 *
 * Rounded to the nearest CSS pixel, the same call `density.ts`'s
 * `primaryRowHeight` makes ("sub-pixel layout jitter is not a density
 * change") — compounding fractional heights across a page this long
 * otherwise fail a `<= 24` assertion by a fraction nobody could see, on a
 * page whose only "dead" space is `.shell__page`'s own intentional
 * bottom inset.
 */
export async function deadScrollPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (main === null) return 0;
    let lowest = 0;
    for (const element of main.querySelectorAll("*")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      lowest = Math.max(lowest, rect.bottom + window.scrollY);
    }
    return Math.round(Math.max(0, document.documentElement.scrollHeight - lowest));
  });
}

/**
 * `.testbuilder-main`'s width divided by the shell's own SECOND grid
 * TRACK — `.shell`'s `grid-template-columns: var(--shell-rail)
 * minmax(0, 1fr)`, read off `.shell` itself rather than off
 * `.shell__page`. That distinction is the whole of F2: `.shell__page` is
 * `.organiser--wide`'s own 1080px clamp, centred WITHIN that track, so a
 * ratio taken against `.shell__page`'s own (already-clamped) width would
 * read high no matter how much of the viewport the clamp wastes — the
 * editor always fills most of its own, already-too-narrow, parent. The
 * track is what the page actually has to work with before any clamp
 * narrows it.
 */
export async function editorWidthRatio(page: Page): Promise<number> {
  const main = await page.locator(".testbuilder-main").evaluate((el) => el.getBoundingClientRect().width);
  const track = await page.locator(".shell").evaluate((el) => {
    const columns = getComputedStyle(el).gridTemplateColumns.split(" ").map(parseFloat);
    return columns[1]!;
  });
  return main / track;
}

/**
 * Collapses the checklist rail to its 52px `data-state="lights"` strip
 * through the pin button itself — Review Focus 2, "the collapsed state is
 * the other half of" F2's width calculation, and going through the real
 * control (rather than setting the attribute) is what makes this exercise
 * the actual path a reader uses.
 */
export async function collapseRail(page: Page): Promise<void> {
  await page.getByRole("button", { name: /collapse the checklist to lights/i }).click();
  await expect(page.locator('.checklist-rail[data-state="lights"]')).toBeVisible();
}
