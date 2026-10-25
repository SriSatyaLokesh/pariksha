// The landing nav is one row on a phone, and the CTA is on it.
//
// WHAT WENT WRONG. `.signal-nav__inner` is `display: flex; flex-wrap: wrap`
// with no responsive rule of any kind. On a 390px screen the five links
// wrapped onto two lines of their own and pushed the CTA down to a fourth,
// so the *sticky* bar stood about 200px tall and ate a quarter of the
// viewport before the hero began. Issue 253 added a sixth link and made it
// obvious; the bug was already there at five, which is exactly why a
// reviewer reading the component found nothing wrong with it.
//
// WHY IT HAS TO BE A BROWSER. `vitest.config.ts` sets `css: false`, so jsdom
// loads no stylesheet, runs no media query and performs no layout — every
// element in the nav is present in the tree whether the bar is one row or
// four, and `landing-content.test.tsx` goes green either way. Wrapping is a
// layout fact. Only a layout engine can report it.
//
// WHAT IT ASSERTS, AND WHY NOT A RULE-SHAPED ASSERTION. Not "the links have
// `display: none`" — that would pass on a nav that hid the links and still
// wrapped for some other reason, and would fail on any future fix that
// solved the same problem a different way (a disclosure menu, a scroll
// rail). It asserts the two things a reader actually experiences: the bar is
// a single row, and the CTA is inside it. Any fix that keeps both is
// allowed; any regression that breaks either reddens.
//
// `measurement/` for the reason `split-screen.spec.ts` sets out: Playwright
// runs files in sorted-path order under `workers: 1`, and anything sorting
// before `e2e/first-run.spec.ts` would reach the instance before the test
// that walks the first-run wizard does. This file seeds nothing, signs in
// nowhere and only reads the public landing page.

import { expect, test } from "@playwright/test";

/** 390 is an iPhone 14/15; 360 is the narrowest Android still worth serving
 *  and the width `density.ts` already measures the organiser at. Both, so
 *  the assertion is about a range rather than one lucky device. */
const PHONES = [
  { label: "390px", width: 390, height: 844 },
  { label: "360px", width: 360, height: 740 },
];

for (const phone of PHONES) {
  test(`the landing nav is one row at ${phone.label}, with the CTA on it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height });
    await page.goto("/");

    const bar = page.locator(".signal-nav__inner");
    const wordmark = page.locator(".signal-wordmark");
    const cta = page.locator(".signal-nav .signal-btn");

    await expect(wordmark).toBeVisible();
    await expect(cta).toBeVisible();

    const barBox = (await bar.boundingBox())!;
    const wordmarkBox = (await wordmark.boundingBox())!;
    const ctaBox = (await cta.boundingBox())!;

    // One row: the bar is no taller than its tallest child plus the padding
    // around it. The old four-row bar measured ~200px here. The ceiling is
    // generous on purpose — it is catching a wrap, not pinning a height.
    expect(
      barBox.height,
      `the sticky nav is ${Math.round(barBox.height)}px tall at ${phone.label} — it has wrapped`,
    ).toBeLessThan(88);

    // The CTA shares the wordmark's line rather than sitting under it.
    const overlap =
      Math.min(wordmarkBox.y + wordmarkBox.height, ctaBox.y + ctaBox.height) -
      Math.max(wordmarkBox.y, ctaBox.y);
    expect(
      overlap,
      "the CTA has dropped below the wordmark instead of sharing its row",
    ).toBeGreaterThan(0);

    // And the bar does not push the hero off the first screen: the h1 has to
    // be reachable, which is the thing the four-row bar was actually costing.
    const heroBox = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(heroBox.y).toBeLessThan(phone.height);
  });
}

test("the nav links come back above the breakpoint", async ({ page }) => {
  // The other direction, so a fix that hides the links at every width — a
  // real way to pass the tests above — reddens here instead of shipping.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const links = page.locator(".signal-nav__links a");
  await expect(links.first()).toBeVisible();
  expect(await links.count()).toBeGreaterThanOrEqual(5);
});
