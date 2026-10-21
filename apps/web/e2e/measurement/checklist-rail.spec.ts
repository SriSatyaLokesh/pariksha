// `D7a` — "Hovering the strip or tabbing into it floats the full panel over
// the page, absolutely positioned: it must never reflow what is being
// edited." This file is the half of that ruling jsdom structurally cannot
// answer.
//
// WHY IT HAS TO BE HERE AND NOT IN THE UNIT FILE. The obvious assertion is
// the one the plan drafted:
//
//     const before = spineBox(); await hoverLights();
//     expect(spineBox()).toEqual(before);
//
// In jsdom that is vacuous twice over, and either reason alone is fatal.
// First, jsdom performs no layout: `getBoundingClientRect()` returns all
// zeros, so the comparison is two identical zero rects and the test passes
// before the feature exists. Second, even in a real browser it only proves
// the panel did not *reflow* the spine — and a panel clipped to nothing
// reflows nothing, so it would stay green while the feature was invisible.
//
// Clipping is the live hazard, not a hypothetical. shell.css gives
// `.shell__page > *` an `overflow-x: auto` below 719px — the rule that
// delivers `D3a`'s "the page itself never scrolls sideways" — and
// `overflow-x: auto` computes `overflow-y` to `auto` too, so at phone width
// the rail is a block formatting context AND a scroll container that clips
// anything painted outside its own box. That file's header names the fix and
// forbids the shortcut: "give the construct somewhere to paint (a portal, or
// a panel with its own padding) rather than to widen the rule." The panel
// takes the viewport as that somewhere (`position: fixed`), which is outside
// the scroll container's containing-block chain and therefore outside its
// clip. **390px is the width where that bites**, and it is measured below
// beside 1280px for exactly that reason.
//
// A bounding box alone would not catch a clip either: `boundingBox()` reports
// an element's own layout rect whether or not an ancestor paints it. So each
// width asserts three independent things — a non-zero box, whole-element
// intersection with the viewport (which applies every ancestor's clip), and a
// hit test at the panel's own centre.
//
// Placed in `measurement/` for the reason density.spec.ts's header gives:
// Playwright runs files in sorted-path order under `workers: 1`, and anything
// sorting before `e2e/first-run.spec.ts` would seed a workspace before the
// test that walks the first-run wizard — which needs an instance that has
// never been set up. `measurement/` sorts after it.
//
// AND IT SEEDS ITS OWN WORKSPACE, which is a separate rule from that one and
// matters more (fix round 1). `D13`'s density ratchet measures the lists in
// the workspace the organiser boots on, and its `BEFORE_TOP` figures sit at
// the exact measured pixel against `toBeLessThanOrEqual` — **zero slack**.
// This file used to call `seedWorkspace` with no target, which reuses
// `workspaces[0]`, and it sorts ahead of `measurement/density.spec.ts`
// ('c' < 'd') under `workers: 1`: the gate was measuring lists this spec had
// just added rows to, and stayed green only on the accident that density
// seeds second and therefore lists first. The fix is isolation and not
// ordering — a spec that is correct only while it sorts after another is the
// same trap `measurement/` exists to escape, one layer down. Everything here
// lives in a workspace the density gate never opens, so this file's position
// in the run stops mattering at all.

import { expect, test, type Page } from "@playwright/test";
import { createWorkspace, seedWorkspace, signIn } from "../seed";

/** `seedWorkspace` names its first test after its first topic. */
const TEST_NAME = "Algebra assessment 01";

/** The workspace this file seeds into — never `workspaces[0]`, which is the
 *  one `OrganiserApp` boots on and `density.spec.ts` measures. */
const WORKSPACE_NAME = "Checklist rail fixtures";

/** The two widths this file exists to separate. 390px is a phone and is where
 *  shell.css's phone-width scroll container would clip the panel; 1280px is a
 *  laptop and is where the rail is a column beside the spine. */
const WIDTHS = [
  { label: "1280px", width: 1280, height: 800 },
  { label: "390px", width: 390, height: 844 },
];

test.beforeAll(async ({ request }) => {
  const isolated = await createWorkspace(request, WORKSPACE_NAME, "checklist-rail-fixtures");
  const seed = await seedWorkspace(request, { banks: 1, questionsPerBank: 5, tests: 1 }, isolated);
  // One empty section in the open draft, so the gate raises a real blocking
  // row and the strip carries a real light. Without it a freshly published
  // test's next draft is all-clear, and this file would measure the panel in
  // its emptiest shape — the one least likely to overflow anything.
  const patched = await request.patch(
    `/api/v1/workspaces/${seed.workspaceId}/tests/${seed.testIds[0]}/draft`,
    { data: { sections: [{ id: "s1", title: "Section one", source: { kind: "fixed", questions: [] } }] } },
  );
  expect(patched.ok(), `seeding a blocking row: ${patched.status()} ${await patched.text()}`).toBe(true);
});

/** Sign in, switch to this file's own workspace, and open the seeded test's
 *  builder — the way an organiser does, through the top bar's switcher.
 *
 *  The switch is the price of the isolation above: the organiser boots on
 *  `workspaces[0]` and the fixtures are not there. It is also the control
 *  `D4` ships for exactly this, and it only exists above one membership —
 *  which this file's second workspace is what creates. */
async function openBuilder(page: Page): Promise<void> {
  await signIn(page);
  await page.getByLabel("Workspace").selectOption({ label: WORKSPACE_NAME });
  await page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: "Tests" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
  await page.getByRole("button", { name: TEST_NAME }).click();
  await expect(page.getByRole("region", { name: /publish checklist/i })).toBeVisible();
}

for (const { label, width, height } of WIDTHS) {
  test(`the floating checklist panel paints inside the viewport at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openBuilder(page);

    // Collapse to the strip of lights. This reflows on purpose — the rail
    // changed size — so the spine is measured AFTER it, not before.
    await page.getByRole("button", { name: /collapse the checklist to lights/i }).click();
    const lights = page.getByRole("list", { name: "Checklist lights" });
    await expect(lights).toBeVisible();

    // The pointer is still inside the rail from the click above, so the panel
    // is ALREADY floating. Measuring the spine here and again after
    // `lights.hover()` would compare one state with itself — the same
    // comment-backed non-assertion this file's header is written against.
    // Fix round 1: leave the rail properly first, so `before` is a genuinely
    // unfloated page.
    //
    // Both halves are needed, and the pointer alone is not enough: the click
    // left focus on the pin, and `onMouseLeave` deliberately refuses to close
    // a panel a keyboard reader is inside. Blur, then move. (The assertion
    // below is what caught that — the panel was still there after the move.)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await expect(page.locator(".checklist-rail__panel")).toHaveCount(0);

    const spine = page.locator(".section-list");
    const before = await spine.boundingBox();
    expect(before, "the section spine has no layout box").not.toBeNull();

    await lights.hover();

    const panel = page.locator(".checklist-rail__panel");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    expect(box, "the floating panel has no layout box").not.toBeNull();
    console.log(
      `CHECKLIST RAIL ${label}: panel x=${box!.x} y=${box!.y} w=${box!.width} h=${box!.height} ` +
        `(viewport ${width}x${height})`,
    );

    // 1. A box with area.
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // 2. Inside the viewport, all four edges.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);

    // 3. Whole-element intersection with the viewport. This is the assertion
    //    that sees a clip: `boundingBox()` reports a layout rect whether or
    //    not an ancestor paints it, where an intersection ratio of 1 applies
    //    every clipping ancestor on the way up.
    await expect(panel).toBeInViewport({ ratio: 1 });

    // 4. ...and the browser agrees something of this panel is actually at the
    //    point the box claims, which no amount of layout arithmetic can fake.
    const hit = await page.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        // `element` is null when the point is outside the viewport, and
        // `?.closest()` would then answer `undefined !== null` — true, for a
        // panel nobody can see. Spelt out rather than chained.
        return element !== null && element.closest(".checklist-rail__panel") !== null;
      },
      { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
    );
    expect(hit, "nothing of the floating panel is painted at its own centre").toBe(true);

    // And the ruling itself: it floats OVER the page. The spine does not move.
    expect(await spine.boundingBox()).toEqual(before);
  });
}
