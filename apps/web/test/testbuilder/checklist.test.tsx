// Pre-publish warnings (#64, P5.11) — Screen 11, `UX-17`.
//
// No @testing-library/user-event in this workspace — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note.
//
// The reachability half (Publish opens this dialog at all, from the app's
// own entry point) lives in lifecycle.test.tsx; this file is the dialog's
// own behaviour, driven through `TestBuilder` so the wiring — which rows it
// is given, what Go to does, what Re-run re-reads — is the real one.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import type { ApiClient, Actor, ChecklistRow, TestSummary, TestVersionRow } from "../../src/lib/api";
import { TestBuilder } from "../../src/routes/test";

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
    workspaces: async () => [],
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
    importCandidates: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

function noop(): void {
  /* no-op */
}

async function openChecklist(client: ApiClient): Promise<{ container: HTMLElement; opener: HTMLElement }> {
  const { container } = render(
    <TestBuilder
      workspaceId="wsp_1"
      testId="tst_1"
      client={client}
      actor={ACTOR}
      onSignOut={noop}
      onBack={noop}
    />,
  );
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  const opener = screen.getByRole("button", { name: /^publish$/i });
  opener.focus();
  fireEvent.click(opener);
  await screen.findByRole("dialog", { name: /publish checklist/i });
  return { container, opener };
}

describe("the publish checklist", () => {
  it("distinguishes blocking from advisory in words, not only by colour or icon", async () => {
    await openChecklist(fakeClient());
    const dialog = screen.getByRole("dialog", { name: /publish checklist/i });
    expect(within(dialog).getByText(/must fix/i)).toBeVisible();
    expect(within(dialog).getByText(/worth checking/i)).toBeVisible();
  });

  it("each row states the measured fact, in the server's own words", async () => {
    await openChecklist(fakeClient());
    expect(screen.getByText("pool needs 10, bank has 7")).toBeVisible();
    expect(screen.getByText('section "Quantitative aptitude" has no questions')).toBeVisible();
  });

  it("every row links to the exact section, and returning keeps the checklist open", async () => {
    await openChecklist(fakeClient());
    const dialog = screen.getByRole("dialog", { name: /publish checklist/i });

    fireEvent.click(within(dialog).getByRole("button", { name: /go to quant/i }));

    // `?section=` is how the builder names the open section, so this is the
    // real navigation rather than a spy on a prop.
    expect(new URLSearchParams(window.location.search).get("section")).toBe("quant");
    expect(screen.getByRole("dialog", { name: /publish checklist/i })).toBeVisible();
  });

  it("the checklist takes focus when it opens, and closing returns focus to the opener", async () => {
    const { opener } = await openChecklist(fakeClient());
    const dialog = screen.getByRole("dialog", { name: /publish checklist/i });
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /publish checklist/i })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("re-running the checks does not rebuild the list under the reader's cursor", async () => {
    const checklist = vi.fn(async () => ROWS.map((row) => ({ ...row })));
    await openChecklist(fakeClient({ checklist }));

    const first = screen.getAllByRole("listitem")[0];
    fireEvent.click(screen.getByRole("button", { name: /re-run the checks/i }));
    await waitFor(() => expect(checklist).toHaveBeenCalledTimes(2));

    // A fresh array of fresh objects every time — but keyed by row id,
    // section and message, so React reuses the node rather than replacing
    // whatever the reader had focused or was reading.
    expect(screen.getAllByRole("listitem")[0]).toBe(first);
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
    const { container } = await openChecklist(fakeClient());
    expect(await axe(container)).toHaveNoViolations();
  });
});
