// `D18`'s breakpoint claim: "Below 900px the brand half drops and the form
// stands alone." This file is the half of that ruling jsdom structurally
// cannot answer, and the half that the `D3a` trap has twice been shipped
// past.
//
// WHY IT HAS TO BE HERE. `vitest.config.ts` sets `css: false`, so jsdom loads
// no stylesheet, evaluates no media query and performs no layout; and
// `css-chain.ts`'s `parseRuleBodies` recurses into `@media` DISCARDING THE
// CONDITION, so every rule in the organiser's stylesheet reads there as
// unconditional. `test/organiser.test.tsx`'s `D18` block therefore locates the
// narrow block by its exact condition text and asserts what is inside it — a
// rule exists, it releases the brand half, it releases nothing else. What it
// cannot say is that a browser applies that block at 880px and not at 1200px.
// That is this file, in a real Chromium, and nowhere else.
//
// AND IT ASSERTS THE TRAP DIRECTLY, which is the point. `D3a`'s failure is a
// COMPLETE DOM that paints as a blank page: with the chrome absent, a
// template that keeps a track for it leaves a zero-wide column, auto-placement
// drops the content into it, and every unit test in the repo stays green
// because every element is present in the tree. So the measurement is
// `boundingBox().width`, on the real form half, at both widths. Nothing short
// of a layout engine can see it.
//
// WHY `measurement/` AT ALL — the same reason `field-rows.spec.ts` gives:
// Playwright collects `testDir` recursively and runs files in sorted-path
// order under `workers: 1`, and anything sorting before `e2e/first-run.spec.ts`
// would seed a workspace before the test that walks the first-run wizard,
// which needs an instance that has never been set up. `measurement/` sorts
// after it.
//
// IT SEEDS NOTHING AND SIGNS IN NOWHERE. Sign-in is the screen a signed-out
// visitor gets at `/admin.html` whatever the instance's state, so this test
// needs no workspace, no switcher and no session — which is also why it is
// the arm measured. The wizard carries the same two halves (asserted in the
// unit block) but is reachable only while the instance has no owner, and
// `first-run.spec.ts` has given it one by the time this file runs.

import { expect, test } from "@playwright/test";

const ORGANISER = "/admin.html";

/** Either side of `D18`'s 900px line, at one height, so the only variable is
 *  width. 1200 is comfortably above it and 880 comfortably below; a test that
 *  measured at 900 and 901 would be measuring the rounding rule rather than
 *  the design. */
const WIDE = { width: 1200, height: 900 };
const NARROW = { width: 880, height: 900 };

test("the brand half drops below 900px and the form keeps its width (D18, D3a)", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await page.goto(ORGANISER);

  const brand = page.locator(".screen__brand");
  const form = page.locator(".screen__form");
  const heading = page.getByRole("heading", { level: 1, name: "Sign in" });

  await expect(heading).toBeVisible();

  // Wide: a split. Both halves paint, side by side, and neither is a sliver.
  const wideBrand = await brand.boundingBox();
  const wideForm = await form.boundingBox();
  expect(wideBrand, "the brand half has no box at 1200px").not.toBeNull();
  expect(wideForm, "the form half has no box at 1200px").not.toBeNull();
  expect(wideBrand!.width).toBeGreaterThan(200);
  expect(wideForm!.width).toBeGreaterThan(200);
  // Side by side rather than stacked — the two halves share a line.
  expect(wideBrand!.x + wideBrand!.width).toBeLessThanOrEqual(wideForm!.x + 1);

  // Narrow: the brand half is gone and the form is NOT a zero-wide column.
  // This is the `D3a` assertion: the form element is still in the DOM either
  // way, so only its box can tell the two outcomes apart.
  await page.setViewportSize(NARROW);
  await expect(brand).toBeHidden();
  await expect(heading).toBeVisible();

  const narrowForm = await form.boundingBox();
  expect(narrowForm, "the form half has no box at 880px").not.toBeNull();
  expect(narrowForm!.width).toBeGreaterThan(NARROW.width / 2);

  // And the page itself never scrolls sideways (`D3a`), at either width.
  for (const size of [WIDE, NARROW]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `the document scrolls sideways at ${size.width}px`).toBeLessThanOrEqual(0);
  }
});
