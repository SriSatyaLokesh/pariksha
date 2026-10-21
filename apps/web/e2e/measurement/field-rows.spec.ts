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
// AND IT CARRIES ITS OWN PROOF ROW, which is not decoration (`AG3`). The
// first draft of this file asserted 0px on the live row and nothing else. It
// stayed green with `grid-template-rows: subgrid` deleted from
// primitives.css — because at 1440px every label in these rows is one line
// and every field's second track therefore starts at the same offset whether
// the track is shared or not. A measurement that cannot tell the rule from
// its absence is the "test that cannot fail" this phase keeps finding.
//
// So each test measures the SAME row twice: once as shipped, and once with
// the pre-rule shape forced back on through an injected stylesheet — each
// field its own grid, vertically centred inside the row, which is the shape
// that let a help-free column's control ride up against its neighbour's. The
// broken pass must be non-zero or the test fails, which is what makes the
// shipped pass's zero mean something.
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

/**
 * The shape `D16` replaced, as a stylesheet: each field its own three-row
 * grid rather than a subgrid of the row's, and the fields centred in the row
 * rather than started at its top. That is what let "a column without help
 * let its control stretch into the space its neighbours spent on text".
 *
 * Injected rather than achieved by deleting a rule, because the thing being
 * proved is that the measurement below can SEE a misalignment at all. It is
 * applied to one row by attribute, so the row measured broken is the same
 * element measured aligned a line earlier.
 */
const PRE_RULE_SHAPE = `
  .field-row[data-proof="broken"] {
    align-items: center;
  }
  .field-row[data-proof="broken"] > .field,
  .field-row[data-proof="wrap broken"] > .field {
    grid-row: auto;
    grid-template-rows: auto auto auto;
  }

  /* The case subgrid itself is load-bearing for — see the third test. */
  .field-row[data-proof~="wrap"] > .field:first-child .field-label {
    max-width: 4ch;
  }
`;

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
  await page.addStyleTag({ content: PRE_RULE_SHAPE });
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

/** Both of `D16`'s spreads for a row, as it stands right now. */
async function spreadsOf(row: Locator): Promise<{ label: number; control: number }> {
  return {
    label: await topSpread(row, ".field-label"),
    control: await topSpread(row, ".text-input, select"),
  };
}

/**
 * Assert that `row` is aligned on both axes AND that the same row misaligns
 * once the pre-rule shape is forced back on — so the zero above is a fact
 * about the rule rather than about any two boxes in a grid.
 */
async function measureAgainstItsOwnProof(row: Locator, name: string): Promise<void> {
  await expect(row).toHaveCount(1);
  // The row really is mixed — one field spends a line of the help track and
  // the other spends none — so the measurement is of the hard case.
  await expect(row.locator(".field")).toHaveCount(2);
  await expect(row.locator(".field-help")).toHaveCount(1);

  // Side by side, not stacked: a spread of 0 down a single column would be
  // true of any stack at all.
  const columns = await row
    .locator(":scope > .field")
    .evaluateAll(
      (fields) => new Set(fields.map((field) => Math.round(field.getBoundingClientRect().left))).size,
    );
  expect(columns, "the row collapsed to one column, so a 0px spread proves nothing").toBe(2);

  const shipped = await spreadsOf(row);

  await row.evaluate((element) => element.setAttribute("data-proof", "broken"));
  const broken = await spreadsOf(row);
  await row.evaluate((element) => element.removeAttribute("data-proof"));

  console.log(
    `FIELD ROW ${name} ${VIEWPORT.width}x${VIEWPORT.height}: ` +
      `shipped label=${shipped.label}px control=${shipped.control}px | ` +
      `pre-rule shape label=${broken.label}px control=${broken.control}px`,
  );

  // The ruling.
  expect(shipped.label, "labels in the row are not on one line").toBe(0);
  expect(shipped.control, "controls in the row are not on one line").toBe(0);

  // ...and the proof that the two zeros above were measured by something
  // that can see a misalignment.
  expect(
    broken.control,
    "the pre-rule shape measured aligned too, so the assertions above prove nothing",
  ).toBeGreaterThan(0);

  // The row returns to the shipped shape once the attribute is gone, so the
  // proof cannot leak into whatever is measured next.
  expect(await spreadsOf(row)).toEqual(shipped);
}

test("a mixed field row puts every label on one line and every control on one line", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);
  await openQuestionEditor(page);

  // The MIXED row this rule exists for: "Question ID" spends a line of the
  // help track on a constraint and "Passage group" spends none.
  await measureAgainstItsOwnProof(rowOf(page, "Question ID"), "Question ID / Passage group");
});

test("the second mixed row aligns too, so the first is the rule and not a coincidence", async ({
  page,
}) => {
  await page.setViewportSize(VIEWPORT);
  await openQuestionEditor(page);

  // "Difficulty" has no help, "Tags" does — the mirror of the row above, with
  // the help on the other side. A rule that happened to work only when the
  // helped field came first would be green on one row and red here.
  await measureAgainstItsOwnProof(rowOf(page, "Difficulty"), "Difficulty / Tags");
});

test("a label that wraps in one field still leaves every control on one line", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openQuestionEditor(page);

  // THE CASE `subgrid` IS LOAD-BEARING FOR, and the reason this test exists
  // beside the two above. Measured while probing them: with every label on
  // one line at 1440px, a row whose fields are each their own three-row grid
  // measures 0px too, as long as nothing centres them — the two tests above
  // would stay green with `grid-template-rows: subgrid` deleted. They prove
  // the shipped row is aligned; they do not isolate what aligns it.
  //
  // A label that wraps is what separates the two. The row's label track grows
  // for EVERY field in it under `subgrid`, so the neighbour's control drops to
  // match; with each field on its own tracks, the neighbour's control stays
  // where its own one-line label left it. `max-width: 4ch` on the first
  // field's label is how that is forced here deterministically rather than by
  // hunting a viewport width where real copy happens to wrap.
  const row = rowOf(page, "Question ID");
  await expect(row).toHaveCount(1);

  const labelHeight = (): Promise<number> =>
    row.locator(".field-label").first().evaluate((el) => el.getBoundingClientRect().height);
  const oneLine = await labelHeight();

  await row.evaluate((element) => element.setAttribute("data-proof", "wrap"));
  // The wrap really happened, or neither number below means anything. Height,
  // not top: both labels still START on the row's first line whichever shape
  // is in force — it is the control under the SHORT label that moves.
  expect(await labelHeight(), "the forced wrap did not make the label taller").toBeGreaterThan(
    oneLine,
  );

  const shipped = await spreadsOf(row);

  await row.evaluate((element) => element.setAttribute("data-proof", "wrap broken"));
  const broken = await spreadsOf(row);
  await row.evaluate((element) => element.removeAttribute("data-proof"));

  console.log(
    `FIELD ROW wrapped label ${VIEWPORT.width}x${VIEWPORT.height}: ` +
      `shipped control=${shipped.control}px | own-grid control=${broken.control}px`,
  );

  expect(shipped.control, "a wrapped label pushed its neighbour's control off the line").toBe(0);
  expect(
    broken.control,
    "the own-grid shape measured aligned too, so subgrid is not what this test holds",
  ).toBeGreaterThan(0);
});
