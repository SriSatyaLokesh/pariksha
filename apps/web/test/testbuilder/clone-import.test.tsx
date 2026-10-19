// Clone, whole-test export and import (#63, P5.10) — the screen half.
//
// No @testing-library/user-event in this workspace — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note.
//
// Everything starts at `OrganiserApp` and clicks its way to the test list,
// because a test that renders `TestList` directly cannot see whether the
// running app ever mounts these controls.

import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import { ApiError, type ApiClient, type Actor, type TestSummary } from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE = { id: "wsp_1", name: "Placement cell" };
const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const MIDTERM: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "reasoning-aptitude-2026",
  description: null,
  shortCode: "ab12cd",
  state: "draft",
  currentVersion: null,
  draftVersion: 1,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

const COPY: TestSummary = {
  ...MIDTERM,
  id: "tst_2",
  name: "Midterm (copy)",
  slug: "reasoning-aptitude-2026-copy",
  shortCode: "ef34gh",
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
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
    tests: async () => [MIDTERM],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => MIDTERM,
    updateTest: async () => MIDTERM,
    draft: async () => {
      throw new Error("not used");
    },
    patchDraft: async () => {
      throw new Error("not used");
    },
    publishTest: async () => MIDTERM,
    closeTest: async () => MIDTERM,
    archiveTest: async () => MIDTERM,
    versions: async () => [],
    checklist: async () => [],
    cloneTest: async () => COPY,
    exportTest: async () => ({ format: "pariksha/test@1", name: "Midterm", slug: MIDTERM.slug, sections: [] }) as never,
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
    importCandidates: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

async function openList(client: ApiClient): Promise<{ container: HTMLElement }> {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: /create your first test/i }));
  await screen.findByRole("heading", { level: 1, name: "Tests" });
  await screen.findByText("Midterm");
  return { container: view.container };
}

/** A `File` whose `.text()` resolves — jsdom's own `File` does not always
 * implement it under this environment, so the one method `ImportDialog`
 * calls is provided outright. */
function jsonFile(name: string, doc: unknown): File {
  const file = new File([JSON.stringify(doc)], name, { type: "application/json" });
  Object.defineProperty(file, "text", { value: async () => JSON.stringify(doc) });
  return file;
}

describe("clone", () => {
  it("AC-04: a clone opens with its new name, id and slug visible and states what it did not copy", async () => {
    let listed: TestSummary[] = [MIDTERM];
    const cloneTest = vi.fn(async () => {
      listed = [MIDTERM, COPY];
      return COPY;
    });
    await openList(fakeClient({ tests: async () => listed, cloneTest }));

    fireEvent.click(screen.getAllByRole("button", { name: /duplicate/i })[0] as HTMLElement);
    await waitFor(() => expect(cloneTest).toHaveBeenCalledWith("wsp_1", "tst_1"));

    const row = (await screen.findByText("Midterm (copy)")).closest("tr") as HTMLElement;
    expect(within(row).getByText("tst_2")).toBeVisible();
    expect(within(row).getByDisplayValue("reasoning-aptitude-2026-copy")).toBeVisible();

    const announcement = await screen.findByText(/version history and the review flag were not copied/i);
    expect(announcement).toHaveTextContent("tst_2");
    expect(announcement).toHaveTextContent("Midterm (copy)");
  });

  it("the clone's own field takes focus, so renaming it is the next keystroke", async () => {
    let listed: TestSummary[] = [MIDTERM];
    await openList(
      fakeClient({
        tests: async () => listed,
        cloneTest: async () => {
          listed = [MIDTERM, COPY];
          return COPY;
        },
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /duplicate/i })[0] as HTMLElement);
    await screen.findByText("Midterm (copy)");

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByDisplayValue("reasoning-aptitude-2026-copy")),
    );
  });

  it("a refused clone says so instead of silently doing nothing", async () => {
    await openList(
      fakeClient({
        cloneTest: async () => {
          throw new ApiError(409, "slug_taken", "A test with that address already exists in this workspace.");
        },
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /duplicate/i })[0] as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  });
});

describe("export", () => {
  it("export reports started and finished with the file name", async () => {
    // jsdom has no download: the click on the generated link is a no-op,
    // so what is asserted is the thing a person actually perceives — the
    // announcement — and that `exportTest` was the call that produced it.
    const exportTest = vi.fn(
      async () => ({ format: "pariksha/test@1", name: "Midterm", slug: MIDTERM.slug, sections: [] }) as never,
    );
    await openList(fakeClient({ exportTest }));

    fireEvent.click(screen.getAllByRole("button", { name: /^export$/i })[0] as HTMLElement);
    await waitFor(() => expect(exportTest).toHaveBeenCalledWith("wsp_1", "tst_1"));
    expect(await screen.findByText(/saved reasoning-aptitude-2026\.json/i)).toBeVisible();
  });

  it("a test too unfinished to export says why rather than downloading nothing", async () => {
    await openList(
      fakeClient({
        exportTest: async () => {
          throw new ApiError(422, "not_exportable", "This test is not complete enough to export.", { issues: [] });
        },
      }),
    );

    fireEvent.click(screen.getAllByRole("button", { name: /^export$/i })[0] as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent(/not complete enough to export/i);
  });
});

describe("import", () => {
  const DOC = { format: "pariksha/test@1", name: "Midterm", slug: "midterm", sections: [] };

  async function openImport(client: ApiClient): Promise<HTMLElement> {
    await openList(client);
    fireEvent.click(screen.getByRole("button", { name: /import a test/i }));
    return screen.getByRole("dialog", { name: /import a test/i });
  }

  it("import reports what landed and what was skipped in the #51 error-summary pattern", async () => {
    const importTest = vi.fn(async () => ({
      testId: null,
      imported: false,
      issues: [
        { questionId: "NOPE-001", index: 1, field: "source.sets", message: 'question "NOPE-001" is not in any bank' },
      ],
      rebound: [],
    }));
    const dialog = await openImport(fakeClient({ importTest }));

    fireEvent.change(within(dialog).getByLabelText(/test file/i), { target: { files: [jsonFile("test.json", DOC)] } });
    await waitFor(() => expect(importTest).toHaveBeenCalled());

    expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
    expect(screen.getAllByRole("row", { name: /NOPE-001/ })).toHaveLength(1);
  });

  it("import says plainly when questions resolved to a different bank", async () => {
    const importTest = vi.fn(async () => ({
      testId: null,
      imported: false,
      issues: [],
      rebound: [{ questionId: "LOG-001", bankName: "Aptitude" }],
    }));
    const dialog = await openImport(fakeClient({ importTest }));

    fireEvent.change(within(dialog).getByLabelText(/test file/i), { target: { files: [jsonFile("test.json", DOC)] } });
    await waitFor(() => expect(importTest).toHaveBeenCalled());

    expect(await screen.findByText(/LOG-001 resolved to bank “Aptitude”/i)).toBeVisible();
  });

  it("the dry run is what the dialog shows first — nothing is written until Import", async () => {
    const importTest = vi.fn(async () => ({ testId: null, imported: false, issues: [], rebound: [] }));
    const dialog = await openImport(fakeClient({ importTest }));

    fireEvent.change(within(dialog).getByLabelText(/test file/i), { target: { files: [jsonFile("test.json", DOC)] } });
    await waitFor(() => expect(importTest).toHaveBeenCalledWith("wsp_1", DOC, { dryRun: true }));

    fireEvent.click(within(dialog).getByRole("button", { name: /^import$/i }));
    await waitFor(() => expect(importTest).toHaveBeenCalledWith("wsp_1", DOC, { dryRun: false }));
  });

  it("only a .json file is offered, because there is no CSV shape for a whole test", async () => {
    const dialog = await openImport(fakeClient());
    fireEvent.change(within(dialog).getByLabelText(/test file/i), {
      target: { files: [new File(["x"], "test.csv", { type: "text/csv" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/choose a \.json file/i);
  });

  it("the dialog takes Escape, starts focused, and gives focus back to the control that opened it", async () => {
    // Task 7 declared `role="dialog"` here and handled none of the three.
    // Driven through `OrganiserApp` and a real `keyDown`, not by rendering
    // `ImportDialog` directly: what is under test is the wiring — that the
    // route passes an `onClose` that actually unmounts the dialog — and a
    // direct render would pass with either route still broken.
    await openList(fakeClient());
    const trigger = screen.getByRole("button", { name: /import a test/i });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: /import a test/i });
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The same element, whose label has flipped back from "Cancel import".
    expect(trigger).toHaveFocus();
  });

  it("the test list and its import dialog have no axe violations", async () => {
    const { container } = await openList(fakeClient());
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole("button", { name: /import a test/i }));
    await screen.findByRole("dialog", { name: /import a test/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
