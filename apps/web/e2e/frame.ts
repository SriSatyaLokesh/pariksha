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

/** `ORGANISER_VIEWS` plus the builder, the question editor and import —
 * Task 3's full target-size sweep. `view=question` and `view=import` both
 * need `&bank=<id>` the same way `view=grading`/`view=analytics` need
 * `&test=<id>`; building the full URL with whichever id applies is the
 * caller's job, the same contract `ORGANISER_VIEWS` already has. */
export const AUDITED_VIEWS = [...ORGANISER_VIEWS, "view=test", "view=question", "view=import"] as const;

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

/**
 * The spread, in px, between the greatest and least text baseline among
 * the elements `selector` matches — F3's alignment half (the section row's
 * reorder buttons, position field and summary, each on its own line
 * today). A baseline rather than a bounding-box edge, because the controls
 * being compared are different heights (a 26px button, a 44px summary, a
 * stacked label-and-input) and their boxes have no shared edge even when
 * the text inside them reads on one line.
 *
 * Measured with the DOM Range API: the first non-whitespace text node
 * inside each matched element gets a one-character range, and that
 * range's own `bottom` is the baseline proxy — the same technique a
 * layout-inspection tool uses, because `getBoundingClientRect()` on an
 * ELEMENT answers its box, not where its glyphs actually sit.
 */
export async function sharedBaseline(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    function firstTextNode(root: Node): Text | null {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if ((node.textContent ?? "").trim().length > 0) return node as Text;
      }
      return null;
    }
    const baselines: number[] = [];
    for (const el of document.querySelectorAll(sel)) {
      const text = firstTextNode(el);
      if (text === null) continue;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      baselines.push(rect.bottom);
    }
    if (baselines.length === 0) return 0;
    return Math.max(...baselines) - Math.min(...baselines);
  }, selector);
}

/**
 * Every rendered, visible, interactive element on the page whose border
 * box is under `min` CSS pixels in either axis (WCAG 2.5.8's 24x24 floor,
 * F3). Each result is a selector built from the element's own tag, id and
 * class list — not a guess at a stylesheet rule — so a reader can paste it
 * into devtools and land on the exact element this found.
 *
 * "Interactive" is buttons, links, and form controls a reader can operate
 * — the same set WCAG 2.5.8 applies to. `visible` excludes `display:none`
 * and zero-area elements, which would otherwise report a target nobody
 * can see as one that is merely too small.
 */
export async function undersizedTargets(
  page: Page,
  min = 24,
): Promise<{ sel: string; w: number; h: number }[]> {
  return page.evaluate((floor) => {
    const selector = "button, a[href], input, select, textarea, [role='button'], [role='link']";
    const describe = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const id = (el as HTMLElement).id ? `#${(el as HTMLElement).id}` : "";
      const cls = (el as HTMLElement).className;
      const classes =
        typeof cls === "string" && cls.trim().length > 0
          ? `.${cls.trim().split(/\s+/).join(".")}`
          : "";
      return `${tag}${id}${classes}`;
    };
    const out: { sel: string; w: number; h: number }[] = [];
    for (const el of document.querySelectorAll(selector)) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if ((el as HTMLButtonElement | HTMLInputElement).disabled) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.width < floor || rect.height < floor) {
        out.push({ sel: describe(el), w: Math.round(rect.width * 100) / 100, h: Math.round(rect.height * 100) / 100 });
      }
    }
    return out;
  }, min);
}
