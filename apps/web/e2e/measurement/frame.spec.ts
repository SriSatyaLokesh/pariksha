// Phase 8h — the frame. Every defect in the spec is a geometry fault
// (overflow, a clamped column, an undersized target, a baseline spread, a
// rounding/type drift) that `jsdom` cannot see — F9 names this directly.
// This file is the browser-measured gate behind F1-F6, the way
// `measurement/density.spec.ts` is behind D13.
//
// SEEDS `workspaces[0]`, deliberately, unlike `checklist-rail.spec.ts` and
// `density.spec.ts`'s own fixtures. `frame.ts`'s `openBuilder` is a plain
// `page.goto("…?view=test&test=<id>")`, and a `goto` is a real browser
// navigation — it reloads the whole app, which always boots on
// `workspaces[0]` (`organiser.tsx`'s `fromUrl` takes whatever workspace that
// is). A `testId` from an isolated second workspace would 404 the instant
// this helper re-navigates to it, which is exactly the hazard
// `view-url.ts`'s own header names ("a workspace switch lands on Home with
// every id-bearing parameter gone… `?view=test&test=…` carried across a
// switch asks workspace B for a test id belonging to workspace A").
//
// Safe here and not a repeat of that trap: this file ADDS ONE TEST to
// `workspaces[0]` and asserts nothing about row counts or positions on any
// LIST surface — `density.spec.ts`'s zero-slack `BEFORE_TOP`/`BEFORE_HEIGHT`
// figures are about the test list's rows, and this file's own fixture lands
// after that gate has already measured, because `frame.spec.ts` sorts after
// `density.spec.ts` in this same directory ('d' < 'f') under `workers: 1`.
// Isolation would still be the right call for a file whose OWN assertions
// read a list row; this one reads only the builder's and the rail's own
// page, which no other spec measures.
//
// Sorted after `e2e/first-run.spec.ts` ('f' < 'm' against the parent
// directory) for the reason every file here is: that spec's first test is
// what completes instance setup.

import { expect, test } from "@playwright/test";
import { seedWorkspace, signIn } from "../seed";
import {
  AUDITED_VIEWS,
  collapseRail,
  deadScrollPx,
  editorWidthRatio,
  openBuilder,
  ORGANISER_VIEWS,
  undersizedTargets,
} from "../frame";

let testId: string;
let bankId: string;

test.beforeAll(async ({ request }) => {
  try {
    const seed = await seedWorkspace(request, { banks: 1, questionsPerBank: 5, tests: 1 });
    testId = seed.testIds[0]!;
    bankId = seed.bankIds[0]!;
  } catch {
    // Playwright restarts the worker — a fresh Node process, `seed.ts`'s
    // module-level slug counter included — after a test in this file
    // fails, and `beforeAll` runs again on it (confirmed empirically:
    // `camera.spec.ts` + `frame.spec.ts` together, two different
    // `wsp_…` ids logged across two `beforeAll` invocations for one
    // `npx playwright test` run). The restarted counter collides with the
    // slug the first, successful run already claimed
    // (`409 slug_taken`). Reusing what that first run created is simpler
    // than making `seedWorkspace` itself idempotent for every caller.
    const workspaces = (await (await request.get("/api/v1/workspaces")).json()) as {
      workspaces: { id: string }[];
    };
    const workspaceId = workspaces.workspaces[0]!.id;
    const tests = (await (await request.get(`/api/v1/workspaces/${workspaceId}/tests`)).json()) as {
      tests: { id: string }[];
    };
    testId = tests.tests[0]!.id;
    const banks = (await (await request.get(`/api/v1/workspaces/${workspaceId}/banks`)).json()) as {
      banks: { id: string }[];
    };
    bankId = banks.banks[0]!.id;
  }
});

/** Builds the full URL for one of `AUDITED_VIEWS`, attaching whichever
 * dynamic id that view needs (`ORGANISER_VIEWS`' own contract, extended to
 * `view=question`/`view=import`'s `&bank=`). */
function urlFor(view: (typeof AUDITED_VIEWS)[number]): string {
  if (view === "view=grading" || view === "view=analytics" || view === "view=test") {
    return `/admin.html?${view}&test=${testId}`;
  }
  if (view === "view=question" || view === "view=import") {
    return `/admin.html?${view}&bank=${bankId}`;
  }
  return `/admin.html?${view}`;
}

const MAX_DEAD_SCROLL = 24; // one page inset, --space-xl

test.describe("F1 — the builder does not scroll past its own content", () => {
  test("at 1280 and 1440", async ({ page }) => {
    await signIn(page);
    await openBuilder(page, testId);
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const dead = await deadScrollPx(page);
      console.log(`FRAME dead-scroll at ${width}px: ${dead}px`);
      expect(dead, `at ${width}`).toBeLessThanOrEqual(MAX_DEAD_SCROLL);
    }
  });

  test("a longer builder page does not reintroduce dead scroll", async ({ page }) => {
    // Review Focus 1: the old `grid-row: 1 / span 40` comment admitted the
    // rail's sticky slack is child-count dependent. Eight filler children
    // push well past today's six without yet reaching the old span.
    //
    // `<div>`, not `<p>`: every real paragraph-like element in this
    // codebase sets its own margin explicitly (`.organiser__title`,
    // `.review-note`, …), so a bare `<p>` never actually occurs here — and
    // Chromium's UA stylesheet gives one `margin-block: 1em` the test would
    // otherwise be measuring instead of the grid.
    await signIn(page);
    await openBuilder(page, testId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      for (let i = 0; i < 8; i++) main.appendChild(document.createElement("div")).textContent = "x";
    });
    expect(await deadScrollPx(page)).toBeLessThanOrEqual(MAX_DEAD_SCROLL);
  });

  test("the no-rail organiser screens keep their layout", async ({ page }) => {
    // Review Focus 5: `:has(> .checklist-rail)` means every other organiser
    // screen takes a different layout path than the one Task 1 touches, and
    // what this proves is that the fix does not leak onto them — not that
    // each of those screens is itself free of dead scroll, which is a
    // separate, screen-by-screen claim this plan does not make (`tests.tsx`
    // is explicitly out of scope this wave). None of them has a
    // `.checklist-rail`, so `.shell__page`'s `display` must stay the
    // `flex` `.organiser` gives it — never the `grid` the `:has()` selector
    // would apply if it ever matched a screen it should not.
    await signIn(page);
    for (const view of ORGANISER_VIEWS) {
      const needsTest = view === "view=grading" || view === "view=analytics";
      await page.goto(`/admin.html?${view}${needsTest ? `&test=${testId}` : ""}`);
      const display = await page.locator(".shell__page").evaluate((el) => getComputedStyle(el).display);
      expect(display, view).toBe("flex");
    }
  });
});

test.describe("F2 — the editing column takes the width it is given", () => {
  test("the builder's editing column grows with the viewport", async ({ page }) => {
    await signIn(page);
    await openBuilder(page, testId);
    for (const width of [1280, 1366, 1440, 1920]) {
      // 1366 is Review Focus 4: the clamp and the grid change behaviour
      // continuously between the tested breakpoints, and 1366 is the most
      // common laptop width — the gap an off-by-one breakpoint hides in.
      await page.setViewportSize({ width, height: 900 });
      const ratio = await editorWidthRatio(page);
      expect(ratio, `at ${width}`).toBeGreaterThanOrEqual(0.6);
    }
  });

  test("a collapsed rail gives its width back to the editor", async ({ page }) => {
    // Review Focus 2: the 52px `data-state="lights"` rail, not the 20rem
    // docked one — the other half of F2's width calculation.
    await signIn(page);
    await openBuilder(page, testId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await collapseRail(page);
    expect(await editorWidthRatio(page)).toBeGreaterThanOrEqual(0.75);
  });
});

test.describe("F3 — every interactive control clears WCAG 2.5.8's 24px floor", () => {
  for (const view of AUDITED_VIEWS) {
    test(`no control under 24px on ${view}`, async ({ page }) => {
      await signIn(page);
      await page.goto(urlFor(view));
      // `view=test` opens the builder, opens one section so the
      // reorder/position controls Task 3 fixed are on the page rather than
      // hidden behind a closed row, and opens the question picker drawer
      // too (O-18/O-21's own flow) so its row checkboxes are included.
      if (view === "view=test") {
        await page.getByRole("heading", { name: "Sections" }).waitFor();
        await page.locator(".section-row__summary").first().click();
        await page.getByRole("button", { name: "Add questions" }).first().click();
        const bank = page.getByLabel("Bank");
        await bank.waitFor();
        await bank.selectOption({ index: 1 });
        await page.locator("ul.picker-drawer__list > li").first().waitFor();
      }
      expect(await undersizedTargets(page)).toEqual([]);
    });
  }

  test("a one-word label on an audited control class still clears 24px", async ({ page }) => {
    // Review Focus 3: "Copy short link" is 97x68 only because it wraps —
    // measured on the tests list (F7, out of this lane's scope), using the
    // shortest realistic label on the same `button-secondary` class this
    // lane's own screens render it with.
    await signIn(page);
    await page.goto(urlFor("view=tests"));
    await page.evaluate(() => {
      document.querySelectorAll("button.button-secondary").forEach((b) => (b.textContent = "Go"));
    });
    expect(await undersizedTargets(page)).toEqual([]);
  });
});
