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
// FIVE TESTS, and what each is for. 1 and 2 are CALIBRATION: the two mixed
// rows of the question editor's Meta section measure 0px and their own proof
// row measures 23px, which proves the instrument can see a misalignment. 3
// ISOLATES `subgrid` — a forced label wrap is the case where the shared track
// is load-bearing, and deleting `grid-template-rows: subgrid` reddens this
// one and only this one. 4 measures `D16`'s COLLAPSE claim on a help-free
// row, against a row on the same screen that really does spend the line. 5
// forces the `@supports not (subgrid)` branch on and re-measures, which `D16`
// says was done and which nothing in a browser checked until fix round 1.
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

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/**
 * `primitives.css`'s `@supports not (grid-template-rows: subgrid)` branch,
 * lifted out of the shipped file and restated unconditionally — which is how
 * an engine without `subgrid` sees the page.
 *
 * `D16` and the brief both say that branch "was forced on and re-measured:
 * still 0px on every live row", and until fix round 1 nothing in a browser
 * checked it: the fallback was proved only against the resolved CSS in jsdom
 * (finding 3). Chromium supports `subgrid`, and a feature query cannot be
 * turned off from a stylesheet, so the only way to put a browser on that path
 * is to restate the branch at a specificity that wins.
 *
 * READ OFF THE FILE rather than retyped, which is the difference between a
 * measurement and a fixture: a copy here would keep passing after the shipped
 * branch changed, and the one thing this test exists to say is what the
 * SHIPPED fallback does in a real engine. Deleting the reserve from
 * `primitives.css` reddens this test (fix round 1, probe 11).
 */
const FORCED_FALLBACK = ((): string => {
  const css = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/styles/primitives.css"),
    "utf8",
  );
  const at = css.indexOf("@supports not (grid-template-rows: subgrid)");
  if (at === -1) throw new Error("primitives.css has no @supports not (subgrid) branch to force on");
  const open = css.indexOf("{", at);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  const body = css.slice(open + 1, i - 1);
  // A branch that parsed to nothing would silently make the test below a
  // second measurement of the subgrid path.
  if (!/grid-template-rows/.test(body)) {
    throw new Error("the @supports branch read out of primitives.css declares no row tracks");
  }
  return body;
})();

/** `seedWorkspace`'s own name for the first test it publishes. */
const TEST_NAME = "Algebra assessment 01";

test.beforeAll(async ({ request }) => {
  const isolated = await createWorkspace(request, WORKSPACE_NAME, "field-row-fixtures");
  // One bank with questions for the question editor's two MIXED rows, and one
  // test for the registration form builder's HELP-FREE one — the row `D16`
  // says collapses its reserved help track rather than spending a line on it.
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

/** Open the question editor the way an organiser does: the rail, a bank, then
 *  Edit on a row. Its Meta section is where `D16`'s two mixed rows live. */
async function openQuestionEditor(page: Page): Promise<void> {
  await enterWorkspace(page);
  await rail(page, "Banks").click();
  await expect(page.getByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
  await page.locator(".bank-list__item").first().click();
  await page.getByRole("button", { name: /^Edit question:/ }).first().click();
  await expect(page.getByRole("heading", { name: "Meta" })).toBeVisible();
  await page.addStyleTag({ content: PRE_RULE_SHAPE });
}

/** Open the registration form builder and add one short-text field, which is
 *  the field type that renders the help-free "Minimum length / Maximum
 *  length" row — two fields, a unit inside each control, help on neither. */
async function openLengthRow(page: Page): Promise<Locator> {
  await enterWorkspace(page);
  await rail(page, "Tests").click();
  await expect(page.getByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
  await page.getByRole("button", { name: TEST_NAME }).click();
  await page.getByRole("button", { name: /^Registration —/ }).click();
  await page.getByLabel("Field type").selectOption({ label: "Short text" });
  await page.getByRole("button", { name: "Add field" }).click();

  const row = rowOf(page, "Minimum length");
  await expect(row).toHaveCount(1);
  // The premise: no field in this row carries help, so there is nothing for
  // the reserve to reserve.
  await expect(row.locator(".field-help")).toHaveCount(0);
  return row;
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

/**
 * How many CSS pixels of `row` sit BELOW its lowest control — which is what
 * the help track costs the row, measured rather than inferred.
 *
 * A row whose fields all lack help must spend nothing here: `D16`'s "the
 * reserved track collapses rather than costing an empty line". A row that
 * carries help anywhere must spend something, or the measurement means
 * nothing.
 */
async function helpTrackCost(row: Locator): Promise<number> {
  return row.evaluate((element) => {
    const controls = [...element.querySelectorAll(".text-input, select")];
    // No controls is not "costs nothing" — it is a broken selector.
    if (controls.length === 0) return Number.POSITIVE_INFINITY;
    const lowest = Math.max(...controls.map((control) => control.getBoundingClientRect().bottom));
    return Math.round((element.getBoundingClientRect().bottom - lowest) * 100) / 100;
  });
}

/** What Chromium reports for a row's own track sizes. Diagnostic only — see
 *  the collapse test for why nothing asserts on it. */
async function rowTracks(row: Locator): Promise<string[]> {
  return row.evaluate((element) => getComputedStyle(element).gridTemplateRows.trim().split(/\s+/));
}

/** Both of `D16`'s spreads for a row, as it stands right now. */
async function spreadsOf(row: Locator): Promise<{ label: number; control: number }> {
  return {
    label: await topSpread(row, ".field-label"),
    control: await topSpread(row, ".text-input, select"),
  };
}

/**
 * The row really is two columns side by side.
 *
 * Every vertical measurement in this file rests on it: a spread of 0 down one
 * stacked column is true of any markup at all, so a reflow that collapsed the
 * row would turn each 0px below into a meaningless pass. Lifted out of
 * `measureAgainstItsOwnProof` in fix round 1 (finding 6) so every path
 * carries it rather than two of three.
 */
async function expectTwoColumns(row: Locator): Promise<void> {
  const columns = await row
    .locator(":scope > .field")
    .evaluateAll(
      (fields) => new Set(fields.map((field) => Math.round(field.getBoundingClientRect().left))).size,
    );
  expect(columns, "the row collapsed to one column, so a 0px spread proves nothing").toBe(2);
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
  await expectTwoColumns(row);

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
  await expectTwoColumns(row);

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

test("a row where no field has help collapses its reserved help track", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  const helpFree = await openLengthRow(page);
  await expectTwoColumns(helpFree);

  // `D16`: "A help-free row resolves its tracks to `15px 36px 0px` — the
  // reserved track collapses rather than costing an empty line." Until fix
  // round 1 nothing measured that (finding 2): the unit file only re-read the
  // same `@supports` declaration the test before it reads, which is an
  // inference about the collapse rather than the collapse.
  //
  // NOT read off `getComputedStyle(row).gridTemplateRows`, which is what the
  // review asked for and what this first tried. Chromium does not report
  // usable row tracks for a grid whose rows are entirely consumed by
  // `subgrid` children: this row measures `20px 20px 20px` where the real
  // tracks are a 24px label, a 44px control and an empty third — an even
  // split whose TOTAL (60px) is right and whose three figures are not. The
  // columns on the same element report correctly (`310.938px 310.938px 0px`),
  // and a subgrid child reports the literal `subgrid`, so there is no
  // element to read the tracks off. The figure is reported below as a
  // diagnostic and asserted on by nothing.
  //
  // So the collapse is measured as the thing the ruling is actually about:
  // how much of the row sits BELOW its controls. Zero is "no empty line".
  const [collapsed, tracks] = await Promise.all([helpTrackCost(helpFree), rowTracks(helpFree)]);

  // ...and against a row on the same screen that really does spend that line.
  // "Visible label / Column name" is the mixed row of the same panel: one
  // field states a consequence in the help track and the other states
  // nothing. Without this arm a zero would be true of any row at all.
  const mixed = rowOf(page, "Column name");
  await expect(mixed).toHaveCount(1);
  await expect(mixed.locator(".field-help")).toHaveCount(1);
  const spent = await helpTrackCost(mixed);

  console.log(
    `FIELD ROW help track ${VIEWPORT.width}x${VIEWPORT.height}: ` +
      `help-free row costs ${collapsed}px below its controls, mixed row costs ${spent}px ` +
      `(Chromium reports the help-free row's tracks as ${tracks.join(" ")}, which is an even ` +
      `split of the right total and not the real sizes)`,
  );

  expect(collapsed, "a row with no help in it still spends a line on the help track").toBe(0);
  expect(
    spent,
    "the mixed row spends nothing on help either, so the zero above proves nothing",
  ).toBeGreaterThan(0);

  // AND ON THE FALLBACK PATH, which is the path every engine without
  // `subgrid` takes and the only one where a reserve exists at all.
  //
  // WHAT THIS PAIR OF ASSERTIONS IS AND IS NOT. It is an invariant, not an
  // isolation, and the difference was established by probing rather than
  // assumed. On the `subgrid` branch the row's third track is content-sized
  // from its subgrid children and the parent's own sizing function for it is
  // not what a browser renders: forcing it to `21px`, and to
  // `minmax(21px, auto)`, changed nothing measurable, and dropping the
  // fallback reserve's `:has(.field-help)` condition changed nothing either
  // (fix round 1, probes 12, 12b, 11b — all three reported as NOT reddening).
  // So no shipped declaration can be broken to turn the four zeros here red.
  //
  // What they do hold is the claim itself — that a row with no help in it
  // spends no line on one, on BOTH paths — against a proof arm on the same
  // screen that really does spend 46px of it. Breaking the help track so the
  // mixed row stops spending it reddens the arm (probe 12c), which is what
  // keeps these from being four zeros read off nothing.
  await page.addStyleTag({ content: FORCED_FALLBACK });
  const underFallback = await helpTrackCost(helpFree);
  const spentUnderFallback = await helpTrackCost(mixed);
  console.log(
    `FIELD ROW help track under the forced fallback: ` +
      `help-free row costs ${underFallback}px, mixed row costs ${spentUnderFallback}px`,
  );
  expect(
    underFallback,
    "the fallback reserves a help line on a row that has no help in it",
  ).toBe(0);
  expect(
    spentUnderFallback,
    "the fallback is not in force, so the zero beside it proves nothing",
  ).toBeGreaterThan(0);

  // And the units really are inside the controls on this row, which is what
  // makes it the help-free row rather than one whose help was simply dropped.
  await expect(helpFree.locator(".field-affix__unit")).toHaveCount(2);
  await expect(helpFree.locator(".field-help")).toHaveCount(0);
});

test("the @supports fallback, forced on, still puts every control on one line", async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await openQuestionEditor(page);
  await page.addStyleTag({ content: FORCED_FALLBACK });

  // `D16`'s own record: "The `@supports not (subgrid)` path was forced on and
  // re-measured: still 0px on every live row." Until fix round 1 that was
  // proved only against the resolved stylesheet in jsdom (finding 3) — and
  // the fallback is the path every non-supporting engine actually takes.
  //
  // What this holds is the invariant, not an isolation: on these rows the
  // reserve is not what delivers the zero (single-line labels put every
  // second track at the same offset either way, which is the finding the
  // first draft of this file was rewritten over). It would go red if the
  // fallback branch introduced a misalignment the subgrid branch does not
  // have, which is the thing a fallback is most likely to do.
  await measureAgainstItsOwnProof(rowOf(page, "Question ID"), "forced fallback");

  // The reserve really is in force here and really does cost a line, so the
  // zero above is measured under the fallback's own geometry and not under a
  // stylesheet the injection failed to apply.
  const reserved = await rowOf(page, "Question ID")
    .locator(":scope > .field")
    .last()
    .evaluate((element) => getComputedStyle(element).gridTemplateRows.trim().split(/\s+/));
  console.log(`FIELD ROW forced-fallback help-free field tracks: ${reserved.join(" ")}`);
  expect(reserved, "a field under the fallback does not have three tracks").toHaveLength(3);
  expect(
    Number.parseFloat(reserved[2]!),
    "the help-free field reserved nothing, so the fallback is not in force",
  ).toBeGreaterThan(0);
});
