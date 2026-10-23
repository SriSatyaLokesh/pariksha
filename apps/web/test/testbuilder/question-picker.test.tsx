// `D18` — the question picker docks as a right-hand column beside the paper
// (`UX-14`), and a prompt wraps and clamps to two lines instead of running
// out of its row.
//
// `D14`: every assertion below starts at `OrganiserApp` and clicks its way
// to the builder, so the drawer is asserted where an organiser meets it —
// Tests, the test, the section, "Add questions", a bank.
//
// WHAT CAN AND CANNOT BE ASSERTED HERE. jsdom performs no layout:
// `getBoundingClientRect()` returns zeros, so "the column is 544px wide" or
// "the prompt occupies two lines" are not claims this file can make. What it
// can do is read the organiser's REAL stylesheet chain — `primitives.css`
// included, which is where the `white-space: nowrap` `D18` blames lives —
// run the cascade over the elements an actual render produced, and assert
// the declaration that wins. That is `paintsIn`, and it is the same reader
// `contrast-usage.test.ts` scores colours with. The pixel half of this task
// is `apps/web/e2e/measurement/density.spec.ts`'s job and is measured there.
//
// AND ONE MORE THING THIS READER CANNOT SEE, disclaimed rather than left for
// someone to trust by accident (fix round 1, m1): `parseRuleBodies`
// (`test/css-chain.ts`) recurses into `@media` blocks AND DISCARDS THE
// CONDITION. So every dock assertion below — `display: grid`,
// `grid-column: 2`, `position: sticky` — would pass identically if the
// breakpoint read `min-width: 12000px`, or `@media print`. **The 1200px
// value is asserted by nothing here, and nothing in the e2e gate either**:
// with no dock at 1440 the drawer simply stays in the flow,
// `scrollIntoViewIfNeeded` brings it to the top, and all three density
// figures still pass. What these assertions pin is that the declarations
// exist and win where they apply; the breakpoint itself is held by the
// measurement in the report and by review. Fixing the reader is three plans'
// blast radius and is on the owner's list, not this file's.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

import {
  type Actor,
  type ApiClient,
  type Bank,
  type QuestionSummary,
  type StoredSection,
  type TestSummary,
  type TestVersionRow,
  type Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";
import { declaredFor, organiserStylesheets, paintsIn, readResolvedCss } from "../css-chain";

/** The organiser's whole stylesheet chain, in the order `admin-main.tsx`
 *  loads it — derived from that module rather than listed, the same way
 *  `contrast-usage.test.ts` derives its sweep. primitives.css has to be in
 *  here or the nowrap assertion below would be asserting the absence of a
 *  rule it never read. */
const ORGANISER_CSS = (() => {
  const seen = new Set<string>();
  return organiserStylesheets()
    .map((path) => readResolvedCss(path, seen))
    .join("\n");
})();

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const TEST_ROW: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
  state: "draft",
  currentVersion: null,
  draftVersion: 1,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

/** A `fixed` section, because that is the source whose "Add questions"
 *  opens the picker with no bank chosen — the drawer's own first screen. */
const WRITTEN: StoredSection = {
  id: "written",
  title: "Written",
  source: { kind: "fixed", questions: [] },
};

const BANK: Bank = {
  id: "bnk_1",
  name: "Reasoning aptitude",
  description: null,
  license: null,
  tags: [],
  questionCount: 1,
  createdAt: 0,
  updatedAt: 0,
};

/** The case the plan's own Review Focus names: "a prompt long enough to
 *  overflow its cell". Short prompts cannot tell a clamped row from an
 *  unclamped one — the declaration only bites on a prompt that has more
 *  than two lines to give. */
const LONG_PROMPT =
  "A train leaves station A at 06:40 travelling at a constant 72 km/h towards station B, " +
  "which lies 468 km away along the same track, while a second train leaves B at 07:15 " +
  "travelling towards A at a constant 54 km/h; assuming neither stops, at what clock time " +
  "do the two trains pass one another, and how far from station A does that happen?";

const QUESTION: QuestionSummary = {
  id: "qst_1",
  bankId: "bnk_1",
  refId: "Q001",
  document: {
    id: "Q001",
    type: "true_false",
    prompt: LONG_PROMPT,
    key: true,
    points: 1,
    difficulty: "easy",
    tags: [],
  } as QuestionSummary["document"],
  points: 1,
  usedInTests: 0,
  updatedAt: 0,
};

function draftWith(sections: StoredSection[]): TestVersionRow {
  return {
    id: "ver_1",
    testId: "tst_1",
    version: 1,
    body: { settings: {}, sections },
    publishedAt: null,
    createdAt: 0,
    draw: {},
    setPoints: {},
    points: {},
  };
}

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const notUsed = () => {
    throw new Error("not used by this test file");
  };
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    createBank: notUsed,
    listQuestions: async () => ({ questions: [QUESTION] }),
    deleteQuestion: async () => undefined,
    saveQuestion: notUsed,
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: notUsed,
    updateGroup: notUsed,
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: notUsed,
    tests: async () => [TEST_ROW],
    createTest: notUsed,
    test: async () => TEST_ROW,
    updateTest: notUsed,
    draft: async () => draftWith([WRITTEN]),
    patchDraft: async () => draftWith([WRITTEN]),
    publishTest: notUsed,
    closeTest: notUsed,
    archiveTest: notUsed,
    versions: async () => [],
    checklist: async () => [],
    cloneTest: notUsed,
    exportTest: notUsed,
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: notUsed,
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: notUsed,
    uploadMedia: notUsed,
    candidates: async () => [],
    importCandidates: notUsed,
    gradingQueue: notUsed,
    grade: notUsed,
    ...overrides,
  };
}

/** `D14`: Home -> Tests -> the test -> the section -> "Add questions" -> a
 *  bank. The only route an organiser has to this drawer, and the same one
 *  `e2e/density.ts`'s picker arm walks in a real browser. */
async function openPicker(): Promise<HTMLElement> {
  window.history.replaceState(null, "", "/");
  render(<OrganiserApp client={fakeClient()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  fireEvent.click(await screen.findByRole("button", { name: /^Written ·/ }));
  fireEvent.click(await screen.findByRole("button", { name: /add questions/i }));

  const drawer = await screen.findByRole("dialog", { name: /add questions/i });
  fireEvent.change(within(drawer).getByLabelText(/^bank$/i), { target: { value: "bnk_1" } });
  await within(drawer).findByText(new RegExp(LONG_PROMPT.slice(0, 40)));
  return drawer;
}

/** One row's own prompt text — the element `D18`'s second half is about —
 *  and the `<label>` that holds it. `declaredFor` throws on a null element
 *  (6.5e Task 2), so a query that stopped matching cannot read as "no rule
 *  applies", but these throw first with a message that says which. */
function promptParts(drawer: HTMLElement): { label: Element; prompt: Element } {
  const label = drawer.querySelector(".picker-drawer__row label");
  if (label === null) throw new Error("no prompt label in the picker drawer");
  const prompt = label.querySelector(".picker-drawer__prompt");
  if (prompt === null) throw new Error("the picker row's label holds no .picker-drawer__prompt");
  return { label, prompt };
}

describe("D18: the question picker docks beside the paper", () => {
  it("keeps the paper visible while picking", async () => {
    const drawer = await openPicker();

    // The brief's own assertion. True today and true after — the drawer has
    // never covered the page — so on its own it is a regression guard.
    expect(screen.getByRole("heading", { name: "Sections" })).toBeVisible();

    // The half with teeth: BESIDE, not below. The drawer's own parent is the
    // section list, and while the drawer is there that list is two columns
    // with the drawer in the second, in the flow and sticky rather than
    // taken out of it. A drawer appended under the sections passes the
    // visibility assertion above and fails every one of these.
    const paper = drawer.parentElement;
    if (paper === null) throw new Error("the picker drawer has no parent");
    expect(paper).toHaveClass("section-list");
    expect(paintsIn(paper, "display", ORGANISER_CSS)).toBe("grid");
    expect(paintsIn(drawer, "grid-column", ORGANISER_CSS)).toBe("2");
    expect(paintsIn(drawer, "position", ORGANISER_CSS)).toBe("sticky");
  });

  it("wraps a long prompt and clamps it to two lines", async () => {
    const drawer = await openPicker();
    const { label, prompt } = promptParts(drawer);

    // `D18` blames `white-space: nowrap` "inherited from the table rules".
    // Read through the real chain, primitives.css included, so this is a
    // claim about the cascade rather than about one file — and asserted on
    // BOTH boxes, because an inherited property reaches the inner one
    // through the outer. (It is already cut: 6.5e Task 1 scoped that
    // declaration to `th.acts, td.acts` and the picker is not a table. This
    // half is a regression guard; the clamp below is the repair.)
    expect(paintsIn(label, "white-space", ORGANISER_CSS)).not.toBe("nowrap");
    expect(paintsIn(prompt, "white-space", ORGANISER_CSS)).not.toBe("nowrap");

    // The positive control for the line above (fix round 1, m2). A negative
    // read through `declaredFor` is also what a NON-NULL BUT WRONG element
    // returns — that function's own header says so — and `white-space` was
    // the only thing asserted against `label`. This pins a declaration that
    // must be there, and it earns the line twice: the clamped prompt is a
    // BLOCK-level box, so without `display: flex` here an inline `(N pts)`
    // after it starts a second line and every one-line prompt becomes a
    // two-line row — the density regression this whole task is measured
    // against, and nothing else asserted it.
    expect(paintsIn(label, "display", ORGANISER_CSS)).toBe("flex");

    // ...and the clamp, which is the half that did not exist. Two lines, and
    // the overflow hidden without which the clamp does nothing at all.
    expect(paintsIn(prompt, "-webkit-line-clamp", ORGANISER_CSS)).toBe("2");
    expect(paintsIn(prompt, "overflow", ORGANISER_CSS)).toBe("hidden");

    // The points are not inside the clamped box — on a prompt this long the
    // clamp would cut them off the end of line two, and the row that most
    // needs its score would be the one without one. Still inside the
    // <label>, so the checkbox is still named "<prompt> (1 pts)".
    expect(prompt.querySelector(".picker-drawer__points")).toBeNull();
    expect(label.querySelector(".picker-drawer__points")).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: /\(1 pts\)$/ })).toBeInTheDocument();
  });

  it("bounds the list's height at every width, docked or not", async () => {
    // Fix round 1, M1. Removing the list's own `max-height: 16rem` is only
    // safe where the dock supplies another bound, and the dock lives inside
    // `@media (min-width: 1200px)`. Below it the list was unbounded: forty
    // rows at full height, `overflow-y` never engaging, and the Cancel and
    // Confirm buttons — which render AFTER the <ul> — pushed ~900px down a
    // page the drawer already sat at the bottom of.
    //
    // WHAT THIS CAN AND CANNOT SEE. `declaredFor` returns every value the
    // property is given by a rule that really selects this element,
    // weakest-first, so the array below is the base bound followed by the
    // dock's release — two rules, and that is exactly the pairing M1 broke.
    // It CANNOT see which `@media` condition the release sits under
    // (`parseRuleBodies` discards it — see this file's header), so it proves
    // "a bound exists and one rule releases it", not "released only above
    // 1200px". Naming the two bodies is the strongest claim available here:
    // delete the base bound and this reads `["none"]`; delete the release and
    // it reads `["16rem"]`; move the release out of the docked scope and the
    // selector stops matching, which is the same red.
    const drawer = await openPicker();
    const list = drawer.querySelector(".picker-drawer__list");
    if (list === null) throw new Error("the picker drawer holds no .picker-drawer__list");

    expect(declaredFor(list, "max-height", ORGANISER_CSS)).toEqual(["16rem", "none"]);

    // A bound means nothing without the scroller it bounds.
    expect(paintsIn(list, "overflow-y", ORGANISER_CSS)).toBe("auto");
  });

  it("traps no focus and closes on Escape", async () => {
    const drawer = await openPicker();

    // The ruling this task had to make, pinned: a column that is summoned,
    // dismissed with Escape and hands focus back is a NON-MODAL DIALOG, and
    // it stays one after docking. The checklist rail went the other way
    // (`role="region"`) because `D7` made it ALWAYS PRESENT, and an
    // always-present dialog is a lie to assistive technology. This one is
    // not always present. No `aria-modal`, because nothing traps focus.
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(drawer).not.toHaveAttribute("aria-modal");

    // Not trapped: a control outside the drawer takes focus while it is
    // open. A `focusin` trap — the usual way one is built — bounces focus
    // back into the dialog and reddens this line.
    const outside = screen.getByRole("button", { name: /add section/i });
    outside.focus();
    expect(document.activeElement).toBe(outside);

    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /add questions/i })).not.toBeInTheDocument();
    });
  });
});
