// `D19`: shuffling — surface the half that exists, disable the half that
// does not.
//
// Three facts, verified in the code rather than assumed:
//   - questions within a section (`shuffle_questions`, schemas/test-1.json,
//     default `true`) is supported and built; the redesign surfaces it as a
//     chip on each section row;
//   - options within a question (`shuffle_options`) is supported and lives
//     in the question editor, not here;
//   - the order of the sections themselves is NOT supported. There is no
//     `shuffle_sections` field in `pariksha/test@1`. It needs one, a format
//     bump and a ruling on per-section time limits — a feature and an ADR,
//     not a design control. So the control renders DISABLED, saying exactly
//     that, and must stay inert.
//
// `D14`: every assertion starts at `OrganiserApp` and clicks its way to the
// builder, so the chip is asserted where an organiser actually meets it.
//
// Every negative here carries a POSITIVE CONTROL on the same mount. "No
// `shuffle_sections` in the patch" passes trivially against code that has
// no such field anywhere, and "the draft was not written on render" passes
// trivially against a wait too short to have seen a write. Each one is
// paired with an arm proving the same assertion, over the same window, can
// see the thing it claims is absent.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";

import {
  type Actor,
  type ApiClient,
  type DraftPatch,
  type StoredSection,
  type TestSummary,
  type TestVersionRow,
  type Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

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

/** The two cases the chip has to tell apart. `Quant` names no
 *  `shuffle_questions` at all — the schema's `default: true` is the whole
 *  reason a chip is risky, because a chip that WRITES what it renders
 *  silently flips every draft that was relying on the default. `Verbal`
 *  turns it off explicitly, so a chip printing a constant fails here. */
const QUANT: StoredSection = {
  id: "quant",
  title: "Quant",
  source: { kind: "fixed", questions: ["qst_1"] },
};

const VERBAL: StoredSection = {
  id: "verbal",
  title: "Verbal",
  shuffle_questions: false,
  source: { kind: "fixed", questions: ["qst_2"] },
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
    listBanks: async () => [],
    createBank: notUsed,
    listQuestions: async () => ({ questions: [] }),
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
    draft: async () => draftWith([QUANT, VERBAL]),
    patchDraft: async () => draftWith([QUANT, VERBAL]),
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
    recordVerdict: notUsed,
    exportCandidateData: notUsed,
    deleteCandidateData: notUsed,
    usage: async () => undefined,
    listWebhooks: async () => {
      throw new Error("not used by this test file");
    },
    createWebhook: async () => {
      throw new Error("not used by this test file");
    },
    setWebhookActive: async () => {
      throw new Error("not used by this test file");
    },
    deleteWebhook: async () => {
      throw new Error("not used by this test file");
    },
    listApiKeys: async () => ({ keys: [] }),
    createApiKey: async () => {
      throw new Error("not used by this test file");
    },
    revokeApiKey: async () => {
      throw new Error("not used by this test file");
    },
    ...overrides,
  };
}

/** Clicks from the app's entry point to the builder (`D14`). */
async function openBuilder(client: ApiClient) {
  const result = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  await screen.findByRole("heading", { name: "Sections" });
  return result;
}

/** One section's own collapsed row, found by the UX-12 sentence that is its
 *  summary button's accessible name. Scoped rather than global on purpose:
 *  two sections put two chips on the screen, a bare `getByText` would be
 *  ambiguous between them, and an index would pass whichever row it landed
 *  on — including the wrong one. */
function rowFor(title: string): HTMLElement {
  const row = screen
    .getByRole("button", { name: new RegExp(`^${title} ·`) })
    .closest(".section-row");
  if (row === null) throw new Error(`no section row for ${title}`);
  return row as HTMLElement;
}

/** Longer than the shell's 250 ms save debounce (apps/web/src/routes/test.tsx),
 *  so a write that was going to happen has happened by the time it returns.
 *  Not a timeout being relaxed (`AG2`): it is the window the negatives below
 *  claim is empty, and each one proves the same window non-empty on its
 *  positive arm before trusting the silence. */
const AFTER_DEBOUNCE = 400;
function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, AFTER_DEBOUNCE));
}

describe("D19: shuffling is surfaced where it exists and disabled where it does not", () => {
  it("shows each section's shuffle state as a chip", async () => {
    await openBuilder(fakeClient());

    // Quant names no `shuffle_questions`; the schema's default is `true`,
    // so its chip says so. Verbal says `false` and its chip says that. A
    // chip printing a constant — or reading the wrong section — fails on
    // one of these two.
    expect(within(rowFor("Quant")).getByText(/questions shuffled/i)).toBeVisible();
    expect(within(rowFor("Verbal")).getByText(/questions in order/i)).toBeVisible();
  });

  it("does not change the default when surfacing it", async () => {
    const patchDraft = vi.fn<ApiClient["patchDraft"]>(async () => draftWith([QUANT, VERBAL]));
    await openBuilder(fakeClient({ patchDraft }));

    // The chip really rendered, so the silence below is about the chip and
    // not about a screen that never got here.
    expect(within(rowFor("Quant")).getByText(/questions shuffled/i)).toBeVisible();

    await settled();
    expect(patchDraft).not.toHaveBeenCalled();

    // POSITIVE CONTROL, same mount, same window: once something really
    // changes, this wait does see the write. So "not called" above is a
    // fact about rendering a chip, not about a wait that is too short.
    fireEvent.click(screen.getByRole("button", { name: /^Quant ·/ }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /shuffle questions within this section/i }),
    );
    await settled();
    expect(patchDraft).toHaveBeenCalledTimes(1);
    expect(patchDraft.mock.calls[0]![2].sections![0]!.shuffle_questions).toBe(false);
  });

  it("renders the section-order control disabled and says why", async () => {
    await openBuilder(fakeClient());

    // Role AND accessible name AND disabled: a control that is missing
    // throws here rather than reading as a pass, and a paragraph dressed up
    // as a label has no checkbox role to find.
    const control = screen.getByRole("checkbox", { name: /Order of the sections themselves/ });
    expect(control).toBeDisabled();
    expect(control).not.toBeChecked();
    expect(screen.getByText(/Not supported today/)).toBeVisible();
    // Fix round 1, M1: visible AND announced. A disabled control owes its
    // reason to a screen reader too, and a sentence merely placed beside one
    // is read by a reader sweeping the page in document order and by nobody
    // tabbing the form. `toBeVisible` above cannot tell those two cases
    // apart; the accessible description can.
    expect(control).toHaveAccessibleDescription(/Not supported today/);
  });

  it("sends no shuffle_sections field", async () => {
    const patchDraft = vi.fn<ApiClient["patchDraft"]>(async () => draftWith([QUANT, VERBAL]));
    await openBuilder(fakeClient({ patchDraft }));

    // Write something real first, so there is a patch to look inside.
    fireEvent.click(screen.getByRole("button", { name: /^Quant ·/ }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: /shuffle questions within this section/i }),
    );
    await waitFor(() => expect(patchDraft).toHaveBeenCalled());

    const patch: DraftPatch = patchDraft.mock.calls[0]![2];
    const body = JSON.stringify(patch);
    // POSITIVE CONTROL: this assertion can see a shuffle field at all, so
    // the negative beside it is not passing on an empty string.
    expect(body).toContain("shuffle_questions");
    expect(body).not.toContain("shuffle_sections");

    // And the disabled control is inert: clicking it writes nothing.
    //
    // Fix round 1, M2: this arm was challenged as possibly unfalsifiable,
    // since React dispatches no handler from a disabled input. It is not.
    // `fireEvent.click` still BUBBLES out of a disabled input, so a handler
    // on any ancestor — the row, the fieldset, a wrapper added by a later
    // task — fires on this click while the control itself stays disabled.
    // That is a defect the `toBeDisabled()` test above cannot see, and the
    // probe for it reddens this line and only this line. The duplicate
    // string assertion that used to follow was deleted in the same round:
    // it re-stringified the very object already asserted four lines up.
    fireEvent.click(screen.getByRole("checkbox", { name: /Order of the sections themselves/ }));
    await settled();
    expect(patchDraft).toHaveBeenCalledTimes(1);
  });

  it("the chip and the disabled control have no axe violations", async () => {
    const { container } = await openBuilder(fakeClient());
    const list = container.querySelector(".section-list");
    expect(list).not.toBeNull();
    expect(await axe(list as HTMLElement)).toHaveNoViolations();
  });
});
