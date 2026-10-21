// `D21a`'s pixel claim: "a row action can never be clipped, in any table."
// This file is the half of that ruling jsdom structurally cannot answer.
//
// WHY IT HAS TO BE HERE AND NOT IN THE UNIT FILE. jsdom performs no layout:
// `getBoundingClientRect()` returns all zeros, so the brief's own sketch —
//
//     const before = columnWidths(); await hoverRow(0);
//     expect(columnWidths()).toEqual(before);
//
// is two sets of zeros compared with each other there, and passes before the
// rule exists and after it is deleted. Worse, jsdom's selector engine parses
// `tr:hover` and never matches it, so a HOVER reveal asserted in jsdom reads
// as "no rule applies" whatever the stylesheet says. `test/tables.test.tsx`
// therefore holds the declarations and the `:focus-within` reveal (which
// jsdom does evaluate), and everything measured in CSS pixels is here.
//
// AND IT CARRIES ITS OWN PROOF, which is not decoration (`AG3`). "The action
// is not clipped" is true of any table that FITS, so a measurement taken on a
// table narrower than its scrollport cannot tell the sticky gutter from its
// absence. Each test therefore measures the same row twice: once as shipped,
// and once with `position: static` forced back on — the pre-rule shape, the
// one that let an action button be "cut off at a bank row's edge". The broken
// pass must be clipped or the test fails, which is what makes the shipped
// pass's zero mean something. The width test proves its instrument the same
// way, by forcing a reveal that really does widen the cell.
//
// TWO WIDTHS, because there are two different scrollports and the rule has to
// hold against both. At 1440px nothing between the table and the viewport
// scrolls, so a table wider than the page makes the DOCUMENT the scrollport
// and `position: sticky` resolves against it. At 390px shell.css gives
// `.shell__page > *` its own `overflow-x: auto` — `D3a`'s "the page itself
// never scrolls sideways" — so each panel is the scrollport instead, and it
// also CLIPS, which is the shape that produced the reported defect. A rule
// that works against one and not the other would pass a single-width test.
//
// WHY `measurement/` AT ALL, and why not inside `density.spec.ts`. Playwright
// collects `testDir` recursively and runs files in sorted-path order under
// `workers: 1`. Anything sorting before `e2e/first-run.spec.ts` seeds a
// workspace before the test that walks the first-run wizard, which needs an
// instance that has never been set up; `measurement/` sorts after it, which is
// the whole reason the directory exists. And `density.spec.ts` is `AG1`'s
// density gate — one question (how many rows are visible) against three
// ratcheted figures per surface. A clipping assertion inside it would muddy
// what a red there means. A sibling spec keeps the two questions apart, the
// same way `field-rows.spec.ts` does.
//
// AND IT SEEDS ITS OWN WORKSPACE, which is a separate rule and matters more.
// `D13`'s ratchet measures the lists in the workspace the organiser boots on
// (`workspaces[0]`), and its `BEFORE_TOP` figures sit at the exact measured
// pixel against `toBeLessThanOrEqual` — zero slack on `testList` and
// `bankList`. A fixture row added there turns that gate red and reads as a
// design regression when it is a fixture. `createWorkspace` + `into` puts
// everything here somewhere that gate never opens, so this file's position
// relative to `density.spec.ts` does not matter.
//
// One dependency remains, stated rather than implied — the same one
// `checklist-rail.spec.ts` and `field-rows.spec.ts` document: this file
// reaches its workspace through the top bar's switcher, and `OrganiserShell`
// renders that control only when `workspaces.length > 1`. So it needs
// `workspaces[0]` to already exist, which `first-run.spec.ts` creates against
// a DB that is fresh every run. Under a filtered run of `measurement/` alone,
// `createWorkspace` would make the only workspace, no switcher would render,
// and `getByLabel("Workspace")` would throw. Loud rather than silently green,
// but not "correct at every position in the run".
//
// WHAT THIS FILE DELIBERATELY DOES NOT ASSERT: that the page does not scroll
// sideways. That is `D21a`'s SECOND cause ("the table was wider than the
// page"), and the spec assigns its fix to the table itself — "fold the id
// under the name, let one column wrap" — not to the gutter. Asserting it here
// would be a red this task cannot honestly turn green, and turning it green by
// weakening it is exactly what `AG2` forbids. The gutter's own claim is that
// the action survives a table that does not fit, and that is what is measured.

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createWorkspace, seedWorkspace, signIn } from "../seed";
import { PRIMARY_ROW } from "../density";

/** This file's own workspace — never `workspaces[0]`. */
const WORKSPACE_NAME = "Row action fixtures";

/** The two scrollports, as viewports. 1440x900 is `D13`'s own, so a figure
 *  here is comparable with the density gate's; 390x844 is a phone, and is
 *  where shell.css's per-panel scroll container both scrolls AND clips. */
const WIDTHS = [
  { label: "1440px", width: 1440, height: 900 },
  { label: "390px", width: 390, height: 844 },
];

/**
 * THE PRECONDITION THE DEFECT NEEDS, as a stylesheet: a table wider than its
 * scrollport.
 *
 * `D21a` names two causes at once — "the action cell had no reserved width,
 * and the table was wider than the page" — and a gutter can only be clipped
 * by a table that does not fit. The seeded fixture here is one test and three
 * questions, and at 1440px both of its tables FIT, so the first draft of this
 * file measured zero clipping with the rule shipped AND zero with the rule
 * forced off. Its own proof caught that, which is the whole reason the proof
 * exists (`AG3`): a measurement that cannot tell the rule from its absence is
 * a test that cannot fail.
 *
 * So the state the rule exists for is CONSTRUCTED rather than hoped for, and
 * applied to BOTH passes — shipped and broken alike, so the only thing that
 * differs between them is the rule. This is not a loosened bar: nothing
 * asserted moves, and the production lists really are this shape (the test
 * list is wider than its panel with 40 real rows, which is why
 * `e2e/density.ts`'s own header says the gate must stay vertical-only).
 */
const TOO_WIDE = `
  table[data-wide] {
    min-width: 200%;
  }
`;

/**
 * The shape `D21a` replaced, as a stylesheet: an action cell with no sticky
 * position and no reserved width, which is what let a button be cut off at a
 * row's edge when the table was wider than the page.
 *
 * Injected rather than achieved by deleting the rule, because the thing being
 * proved is that the measurement below can SEE a clipped action at all. The
 * same row is measured shipped and then broken.
 */
const PRE_RULE_SHAPE = `
  table[data-proof="broken"] .acts {
    position: static;
    width: auto;
  }
`;

/**
 * A reveal that really does widen the cell — the thing `D21a`'s "revealing an
 * action must never widen a row" forbids. Used only to prove the width
 * instrument; nothing ships it.
 */
const WIDENING_REVEAL = `
  table[data-proof="widens"] tr:hover > .acts {
    padding-inline-start: 48px;
  }
`;

test.beforeAll(async ({ request }) => {
  const isolated = await createWorkspace(request, WORKSPACE_NAME, "row-action-fixtures");

  // Seeded ONCE per run, the same idempotence `createWorkspace` itself
  // documents and for the same reason. A failed test restarts the worker and
  // this hook runs again; `seedWorkspace`'s slug counter restarts with it, so
  // the second call 409s on `assessment-01-01` and every later test in this
  // file dies reporting a seeding error that is not the bug. That cost two
  // runs of this file before it was written down.
  const listed = await request.get(`/api/v1/workspaces/${isolated}/tests`);
  expect(listed.ok(), `tests: ${listed.status()} ${await listed.text()}`).toBe(true);
  const already = ((await listed.json()).tests ?? []) as unknown[];
  if (already.length > 0) return;

  // One bank with questions for the bank browser, and one published test for
  // the test list. Both tables carry row actions; neither needs volume, since
  // every claim here is about one row.
  await seedWorkspace(request, { banks: 1, questionsPerBank: 3, tests: 1 }, isolated);
});

/** Sign in and switch to this file's own workspace. */
async function enterWorkspace(page: Page): Promise<void> {
  await signIn(page);
  await page.getByLabel("Workspace").selectOption({ label: WORKSPACE_NAME });
}

function rail(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: label });
}

/** The two tables that carry row actions, and how an organiser reaches each.
 *  The row selectors are `density.ts`'s own, imported rather than retyped:
 *  two copies that drift would leave this file measuring a selector nobody
 *  else uses. */
const TABLES = {
  testList: {
    rows: PRIMARY_ROW.testList,
    async open(page: Page): Promise<void> {
      await enterWorkspace(page);
      await rail(page, "Tests").click();
      await expect(page.getByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
    },
  },
  bankBrowser: {
    rows: PRIMARY_ROW.bankBrowser,
    async open(page: Page): Promise<void> {
      await enterWorkspace(page);
      await rail(page, "Banks").click();
      await expect(page.getByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
      await page.locator(".bank-list__item").first().click();
    },
  },
} as const;

type TableName = keyof typeof TABLES;

/**
 * How many CSS pixels of `element` lie outside everything that clips it —
 * the viewport and every scrolling ancestor — along the inline axis.
 *
 * Zero is "wholly readable". Anything above zero is the reported defect: an
 * action cut off at the row's edge. A zero-width element answers Infinity
 * rather than zero: an element with no box is not an unclipped one, and it
 * must fail the assertion rather than sail under it.
 */
async function clippedPixels(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return Number.POSITIVE_INFINITY;
    let left = 0;
    let right = window.innerWidth;
    for (let parent = node.parentElement; parent !== null; parent = parent.parentElement) {
      if (getComputedStyle(parent).overflowX === "visible") continue;
      const clip = parent.getBoundingClientRect();
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    const outside = Math.max(0, left - box.left) + Math.max(0, box.right - right);
    return Math.round(outside * 100) / 100;
  });
}

/** Every cell width in `row`, in CSS pixels, left to right. */
async function cellWidths(row: Locator): Promise<number[]> {
  return row.locator(":scope > td").evaluateAll((cells) => {
    // No cells is not "all widths equal" — it is a broken selector.
    if (cells.length === 0) return [Number.NaN];
    return cells.map((cell) => Math.round(cell.getBoundingClientRect().width * 100) / 100);
  });
}

/**
 * Hover `row` the way a mouse arrives at it — over its FIRST cell, not its
 * centre and not the gutter itself. The centre of a row wider than the
 * viewport is off screen, and the gutter is the one cell the widening proof
 * below moves under the pointer. The left-hand cell is in view at every
 * width and is stable under both.
 */
async function hoverRow(row: Locator): Promise<void> {
  await row.locator("td").first().hover();
}

/** The first row of `table`, with its action cell present. */
async function firstRow(page: Page, table: TableName): Promise<Locator> {
  const row = page.locator(TABLES[table].rows).first();
  await expect(row).toBeAttached();
  // The premise of every measurement below. Without it, a renamed class would
  // make `.acts` match nothing and `clippedPixels` would measure the row.
  await expect(row.locator("td.acts")).toHaveCount(1);
  return row;
}

/** Mark `row`'s table with `attribute`, so one of the stylesheets above
 *  reaches it. */
async function mark(row: Locator, attribute: string): Promise<void> {
  await row.evaluate((node, name) => {
    const table = node.closest("table");
    if (table === null) throw new Error("the measured row is not inside a table");
    table.setAttribute(name, "");
  }, attribute);
}

/** ...and the same, with a value. */
async function proof(row: Locator, value: string): Promise<void> {
  await row.evaluate((node, broken) => {
    const table = node.closest("table");
    if (table === null) throw new Error("the measured row is not inside a table");
    table.setAttribute("data-proof", broken);
  }, value);
}

for (const { label, width, height } of WIDTHS) {
  for (const table of Object.keys(TABLES) as TableName[]) {
    test(`${table} keeps its row actions wholly inside the scrollport at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await TABLES[table].open(page);
      await page.addStyleTag({ content: TOO_WIDE + PRE_RULE_SHAPE });

      const row = await firstRow(page, table);
      // The precondition, applied before either pass: a table that does not
      // fit. Without it both passes measure a table that does, and a zero
      // means nothing.
      await mark(row, "data-wide");
      await hoverRow(row);

      const buttons = row.locator("td.acts button");
      const count = await buttons.count();
      // A gutter with no controls in it cannot be clipped, and a zero here
      // would make every assertion below vacuous.
      expect(count, "the action cell holds no control to measure").toBeGreaterThan(0);

      const shipped: number[] = [];
      for (let i = 0; i < count; i += 1) shipped.push(await clippedPixels(buttons.nth(i)));
      expect(shipped, `a row action is cut off at ${label}`).toEqual(shipped.map(() => 0));

      // ...and the same buttons, with the pre-rule shape forced back on. If
      // this stays at zero the table simply fits at this width and the zeros
      // above are a fact about the fixture, not about the rule.
      await proof(row, "broken");
      await hoverRow(row);
      const broken: number[] = [];
      for (let i = 0; i < count; i += 1) broken.push(await clippedPixels(buttons.nth(i)));
      expect(
        Math.max(...broken),
        "without the gutter rule nothing was clipped either, so this measurement cannot tell the rule from its absence",
      ).toBeGreaterThan(0);
    });

    test(`${table} does not widen a row when its actions are revealed at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await TABLES[table].open(page);
      await page.addStyleTag({ content: WIDENING_REVEAL });

      const row = await firstRow(page, table);
      // Nothing hovered: the opening clicks left the pointer on the rail or
      // the bank list, but "wherever the last click was" is not a premise a
      // resting measurement may rest on.
      await page.mouse.move(0, 0);

      // Resting. Nothing is hovered: the mouse starts outside the page.
      const resting = await cellWidths(row);
      expect(resting.length, "the row rendered no cells").toBeGreaterThan(1);
      // The gutter is RESERVED, not collapsed — "width always reserved" is
      // the half of `D21a` that a width comparison alone cannot see, since
      // 0 === 0 would satisfy it.
      const gutter = await row.locator("td.acts").evaluate((cell) => cell.getBoundingClientRect().width);
      expect(gutter, "the action column reserves no width at rest").toBeGreaterThan(0);

      await hoverRow(row);
      expect(await cellWidths(row), "revealing the actions moved a column").toEqual(resting);

      // The instrument's own proof: a reveal that DOES widen the cell has to
      // be visible to the same comparison, or an unchanged list above would
      // mean nothing.
      await proof(row, "widens");
      await hoverRow(row);
      expect(
        await cellWidths(row),
        "a reveal that adds 48px of padding was invisible to this measurement",
      ).not.toEqual(resting);
    });
  }
}
