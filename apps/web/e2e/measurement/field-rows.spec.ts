// `D16`'s pixel claim: "a mixed row misaligns by 20.4px without the rule and
// 0px with it." This file is the half of that ruling jsdom structurally
// cannot answer.
//
// WHY IT HAS TO BE HERE AND NOT IN THE UNIT FILE. jsdom performs no layout:
// `getBoundingClientRect()` returns all zeros, so
//
//     expect(labelTops).toEqual(controlTops)
//
// there is two sets of zeros compared with each other, and it passes before
// the rule exists. `test/testbuilder/field-rows.test.tsx` therefore asserts
// the grid DECLARATIONS and the `subgrid` / `@supports not` branches — read
// off admin.css's resolved import chain and matched against the rendered
// markup through `Element.matches()` — and the spread in CSS pixels is
// measured here, in a real Chromium at 1440x900.
//
// WHY NOT IN `measurement/density.spec.ts`. That file is `AG1`'s density
// gate, and `D12` puts the builder, the question editor, the wizard and
// sign-in deliberately OUTSIDE it: they are editing surfaces, not scanning
// ones. Measuring an editing surface inside that gate would muddy what the
// gate asserts. A sibling spec keeps the two questions apart.
//
// WHY `measurement/` AT ALL. Playwright collects `testDir` recursively and
// runs files in sorted-path order, and under `workers: 1` that order is the
// run order. Anything sorting before `e2e/first-run.spec.ts` seeds a
// workspace before the test that walks the first-run wizard, which needs an
// instance that has never been set up. `measurement/` sorts after it
// ('f' < 'm'), which is the whole reason for the directory.
//
// AND IT SEEDS ITS OWN WORKSPACE, which is a separate rule and matters more.
// `D13`'s density ratchet measures the lists in the workspace the organiser
// boots on (`workspaces[0]`), and its `BEFORE_TOP` figures sit at the exact
// measured pixel against `toBeLessThanOrEqual` — zero slack on `testList` and
// `bankList`. A fixture row added there turns that gate red and reads as a
// design regression when it is a fixture. `createWorkspace` + `into` puts
// everything here somewhere that gate never opens, so this file's position
// relative to `density.spec.ts` does not matter.
//
// One dependency remains, stated rather than implied — the same one
// `checklist-rail.spec.ts` documents: this file reaches its workspace through
// the top bar's switcher, and `OrganiserShell` renders that control only when
// `workspaces.length > 1`. So it needs `workspaces[0]` to already exist,
// which `first-run.spec.ts` creates against a DB that is fresh every run.
// Under a filtered run of `measurement/` alone, `createWorkspace` would make
// the only workspace, no switcher would render, and `getByLabel("Workspace")`
// would throw. Loud rather than silently green, but not "correct at every
// position in the run".

import { expect, test, type Locator, type Page } from "@playwright/test";
import { createWorkspace, seedWorkspace, signIn } from "../seed";

/** This file's own workspace — never `workspaces[0]`. */
const WORKSPACE_NAME = "Field row fixtures";

/** `D13`'s own viewport, so the figure is comparable with the gate's. */
const VIEWPORT = { width: 1440, height: 900 };

test.beforeAll(async ({ request }) => {
  const isolated = await createWorkspace(request, WORKSPACE_NAME, "field-row-fixtures");
  // One bank with questions: the question editor is reached by editing one,
  // and `D16`'s two mixed rows live in that editor's Meta section. No tests —
  // nothing here opens the builder.
  await seedWorkspace(request, { banks: 1, questionsPerBank: 3, tests: 0 }, isolated);
});

/** Sign in, switch to this file's own workspace, and open the question editor
 *  the way an organiser does: the rail, a bank, then Edit on a row. */
async function openQuestionEditor(page: Page): Promise<void> {
  await signIn(page);
  await page.getByLabel("Workspace").selectOption({ label: WORKSPACE_NAME });
  await page.getByRole("navigation", { name: "Organiser" }).getByRole("button", { name: "Banks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
  await page.locator(".bank-list__item").first().click();
  await page.getByRole("button", { name: /^Edit question:/ }).first().click();
  await expect(page.getByRole("heading", { name: "Meta" })).toBeVisible();
}

/** The `.field-row` holding the control labelled `label`. */
function rowOf(page: Page, label: string): Locator {
  return page.locator(".field-row").filter({ has: page.getByLabel(label, { exact: true }) });
}

/** The spread — largest top minus smallest top, in CSS pixels — of the
 *  elements `selector` matches inside `row`. Rounded to two decimals, the way
 *  `density.ts` rounds: sub-pixel jitter is not a misalignment. */
async function topSpread(row: Locator, selector: string): Promise<number> {
  return row.locator(selector).evaluateAll((elements) => {
    // No elements is not "perfectly aligned" — it is a broken selector, and
    // it has to fail the assertion rather than sail under it as a zero.
    if (elements.length < 2) return Number.POSITIVE_INFINITY;
    const tops = elements.map((element) => element.getBoundingClientRect().top);
    return Math.round((Math.max(...tops) - Math.min(...tops)) * 100) / 100;
  });
}

test("a mixed field row puts every label on one line and every control on one line", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);
  await openQuestionEditor(page);

  // The MIXED row is the one the rule exists for: "Question ID" spends a line
  // of the help track on a constraint and "Passage group" spends none. With
  // each field its own grid, the second control stretched into the space the
  // first spent on that sentence and the two landed 20.4px apart.
  const row = rowOf(page, "Question ID");
  await expect(row).toHaveCount(1);

  // The row really is mixed, so the measurement below is of the hard case.
  await expect(row.locator(".field")).toHaveCount(2);
  await expect(row.locator(".field-help")).toHaveCount(1);

  // Side by side, not stacked: at 1440x900 the row has two columns, and a
  // spread of 0 down a single column would be true of any stack at all.
  const columns = await row.locator(":scope > .field").evaluateAll((fields) =>
    new Set(fields.map((field) => Math.round(field.getBoundingClientRect().left))).size,
  );
  expect(columns, "the row collapsed to one column, so a 0px spread proves nothing").toBe(2);

  const labelSpread = await topSpread(row, ".field-label");
  const controlSpread = await topSpread(row, ".text-input, select");
  console.log(`FIELD ROW ${VIEWPORT.width}x${VIEWPORT.height}: label spread=${labelSpread}px control spread=${controlSpread}px`);

  expect(labelSpread).toBe(0);
  expect(controlSpread).toBe(0);
});

test("the second mixed row aligns too, so the first is the rule and not a coincidence", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);
  await openQuestionEditor(page);

  // "Difficulty" has no help, "Tags" does — the mirror of the row above, with
  // the help on the other side. A rule that happened to work only when the
  // helped field came first would be green on one row and red here.
  const row = rowOf(page, "Difficulty");
  await expect(row).toHaveCount(1);
  await expect(row.locator(".field-help")).toHaveCount(1);

  expect(await topSpread(row, ".field-label")).toBe(0);
  expect(await topSpread(row, ".text-input, select")).toBe(0);
});
