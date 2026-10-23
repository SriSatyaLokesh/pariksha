// Pre-publish warnings (#64, P5.11) — Screen 11, `UX-17`.
//
// No @testing-library/user-event in this workspace — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note.
//
// The reachability half (Publish opens the checklist at all, from the app's
// own entry point) lives in lifecycle.test.tsx; this file is the checklist's
// own behaviour, driven through the real builder so the wiring — which rows it
// is given, what Go to does, what Re-run re-reads — is the real one.
//
// Phase 6.5d `D7` moved the construct and not the behaviour: the checklist is
// no longer a modal dialog opened by Publish but a right rail present from the
// first paint (`checklist-rail.test.tsx` is the rail's own file). Every
// assertion below is the one it was — the same words, the same rows, the same
// Go to, the same confirm — asked of a `region` instead of a `dialog`. The one
// guarantee that genuinely retired with the dialog is Escape-to-close: there
// is nothing to close any more, and what replaced it is asserted instead —
// Publish still takes the reader to the checklist.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import type {
  ApiClient,
  Actor,
  ChecklistRow,
  TestSummary,
  TestVersionRow,
  Workspace,
} from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "admin", grants: [] }],
};

const TEST_ROW: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
  state: "draft",
  currentVersion: 1,
  draftVersion: 2,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

const DRAFT: TestVersionRow = {
  id: "ver_2",
  testId: "tst_1",
  version: 2,
  body: {
    settings: {},
    sections: [
      { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } },
      { id: "reasoning", title: "Logical reasoning", source: { kind: "fixed", questions: [] } },
    ],
  },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

const ROWS: ChecklistRow[] = [
  {
    id: "section_empty",
    severity: "blocking",
    message: 'section "Quantitative aptitude" has no questions',
    field: "section.source",
    sectionId: "quant",
  },
  {
    id: "pool_short",
    severity: "advisory",
    message: "pool needs 10, bank has 7",
    field: "source.count",
    sectionId: "reasoning",
  },
];

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    createBank: async () => {
      throw new Error("not used");
    },
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: async () => {
      throw new Error("not used");
    },
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: async () => {
      throw new Error("not used");
    },
    updateGroup: async () => {
      throw new Error("not used");
    },
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: async () => {
      throw new Error("not used");
    },
    tests: async () => [TEST_ROW],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => TEST_ROW,
    updateTest: async () => TEST_ROW,
    draft: async () => DRAFT,
    patchDraft: async () => DRAFT,
    publishTest: async () => TEST_ROW,
    closeTest: async () => TEST_ROW,
    archiveTest: async () => TEST_ROW,
    versions: async () => [],
    checklist: async () => ROWS,
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: async () => {
      throw new Error("not used");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used");
    },
    uploadMedia: async () => {
      throw new Error("not used");
    },
    candidates: async () => [],
    lockedAttempts: async () => [],
    unlockAttempt: async () => {
      throw new Error("not used");
    },
    importCandidates: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

// D14: Home -> Tests -> the builder -> Publish. `TestBuilder` used to be
// rendered here with six props, two of which Phase 6.5c Task 1 deleted with
// `OrganiserHeader`; the walk is the same one `lifecycle.test.tsx` already
// uses.
async function openChecklist(client: ApiClient): Promise<HTMLElement> {
  const { container } = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  // The rail's rows come from the screen's own load, so they are waited for
  // rather than fetched by the click below — `D7`: present from the first
  // paint, not behind the button.
  await screen.findByRole("region", { name: /publish checklist/i });
  const opener = screen.getByRole("button", { name: /^publish$/i });
  opener.focus();
  fireEvent.click(opener);
  // Publish re-reads the rows and takes focus to the rail; waited for here
  // once rather than in each test that depends on it having settled.
  await waitFor(() => expect(document.activeElement).toBe(checklistRail()));
  // The container, and nothing else. `opener` used to come back with it for
  // the Escape test's `focus returns to the opener`, which retired with the
  // dialog; the `opener.focus()` above stays, because it is what makes the
  // click below a real one from a focused control. Fix round 1.
  return container;
}

/** The rail, by its landmark. A `region` and not a `dialog`: it is on the
 *  page the whole time, and calling an always-present construct a dialog is
 *  a claim an assistive technology would act on. */
function checklistRail(): HTMLElement {
  return screen.getByRole("region", { name: /publish checklist/i });
}

describe("the publish checklist", () => {
  it("distinguishes blocking from advisory in words, not only by colour or icon", async () => {
    await openChecklist(fakeClient());
    // Scoped to the list of rows: the readiness figure above it also counts
    // the blocking ones in words ("1 must fix"), which is the same guarantee
    // stated about the whole rather than about this row.
    const rows = within(checklistRail()).getByRole("list");
    expect(within(rows).getByText(/must fix/i)).toBeVisible();
    expect(within(rows).getByText(/worth checking/i)).toBeVisible();
  });

  it("each row states the measured fact, in the server's own words", async () => {
    await openChecklist(fakeClient());
    expect(screen.getByText("pool needs 10, bank has 7")).toBeVisible();
    expect(screen.getByText('section "Quantitative aptitude" has no questions')).toBeVisible();
  });

  it("every row links to the exact section, and the rail retracts to its lights rather than disappearing", async () => {
    await openChecklist(fakeClient());

    fireEvent.click(within(checklistRail()).getByRole("button", { name: /go to Quantitative aptitude/i }));

    // `?section=` is how the builder names the open section, so this is the
    // real navigation rather than a spy on a prop.
    expect(new URLSearchParams(window.location.search).get("section")).toBe("quant");
    // Still on the page, and still the gate's own rows: opening a section
    // retracts the rail to its strip of lights (`D7a`) rather than taking the
    // checklist away, and the panel is one hover or one Tab from the reader.
    expect(checklistRail()).toBeVisible();
    expect(checklistRail()).toHaveAttribute("data-state", "lights");
  });

  it("Publish takes focus to the checklist, and docks it if it was collapsed", async () => {
    await openChecklist(fakeClient());
    expect(document.activeElement).toBe(checklistRail());

    // Collapse it the way editing does, then ask to publish again: the rail
    // comes back docked and takes the reader with it. The dialog's old
    // Escape-to-close has no successor — there is nothing to close — and this
    // is the half of it that survives: a control whose whole effect is
    // elsewhere on the page moves focus there.
    fireEvent.click(screen.getByRole("button", { name: /collapse the checklist to lights/i }));
    expect(checklistRail()).toHaveAttribute("data-state", "lights");
    document.body.focus();

    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
    expect(checklistRail()).toHaveAttribute("data-state", "docked");
    expect(document.activeElement).toBe(checklistRail());
  });

  it("re-running the checks does not rebuild the list under the reader's cursor", async () => {
    const checklist = vi.fn(async () => ROWS.map((row) => ({ ...row })));
    await openChecklist(fakeClient({ checklist }));

    const first = within(checklistRail()).getAllByRole("listitem")[0];
    fireEvent.click(screen.getByRole("button", { name: /re-run the checks/i }));
    // Three, not two: the screen's own load reads the rows (`D7` — the rail
    // is there before anyone asks), `openChecklist`'s Publish re-read them,
    // and this click is the third.
    await waitFor(() => expect(checklist).toHaveBeenCalledTimes(3));

    // A fresh array of fresh objects every time — but keyed by row id,
    // section and message, so React reuses the node rather than replacing
    // whatever the reader had focused or was reading.
    expect(within(checklistRail()).getAllByRole("listitem")[0]).toBe(first);
  });

  it("a blocking row disables the confirm", async () => {
    await openChecklist(fakeClient());
    expect(screen.getByRole("button", { name: /publish version 2/i })).toBeDisabled();
  });

  // T-11's split, on the screen: the builder *warns* on an advisory row and
  // publishing stays available, exactly as the server's own gate behaves.
  it("advisory rows alone leave the confirm enabled", async () => {
    const advisoryOnly = ROWS.filter((row) => row.severity === "advisory");
    await openChecklist(fakeClient({ checklist: async () => advisoryOnly }));
    expect(screen.getByText(/worth checking/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /publish version 2/i })).toBeEnabled();
  });

  it("an all-green checklist still asks for a confirmation and states that publishing freezes the version", async () => {
    const publishTest = vi.fn(async () => TEST_ROW);
    await openChecklist(fakeClient({ checklist: async () => [], publishTest }));

    expect(screen.getByText(/everything checks out/i)).toBeVisible();
    expect(screen.getByText(/publishing freezes version 2/i)).toBeVisible();

    const confirm = screen.getByRole("button", { name: /publish version 2/i });
    expect(confirm).toBeEnabled();
    expect(publishTest).not.toHaveBeenCalled();

    fireEvent.click(confirm);
    await waitFor(() => expect(publishTest).toHaveBeenCalledWith("wsp_1", "tst_1"));
  });

  it("the checklist has no axe violations", async () => {
    const container = await openChecklist(fakeClient());
    expect(await axe(container)).toHaveNoViolations();
  });
});
