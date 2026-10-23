import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Question, TrueFalseQuestion, PassageGroup } from "@pariksha/core";

import type { ApiClient } from "../../src/lib/api";
import { QuestionEditor } from "../../src/components/authoring/QuestionEditor";
import { GroupEditor } from "../../src/components/authoring/GroupEditor";

const noop = () => undefined;

type GroupSummary = PassageGroup & { questionCount: number };

const ORDERS_TABLE: GroupSummary = {
  id: "orders-table",
  title: "Orders",
  passage: "| a |\n| - |",
  questionCount: 1,
};

const LIBRARY_LOANS: GroupSummary = {
  id: "library-loans",
  title: "Library loans",
  passage: "Some loans data.",
  questionCount: 0,
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => null,
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
    saveQuestion: async (_workspaceId, bankId, doc) => ({
      id: "qst_1",
      bankId,
      refId: doc.id,
      document: doc,
      points: 1,
      usedInTests: 0,
      updatedAt: 0,
    }),
    listTags: async () => [],
    listGroups: async () => [ORDERS_TABLE, LIBRARY_LOANS],
    createGroup: async (_workspaceId, _bankId, input) => ({ ...input, questionCount: 0 }),
    // Mirrors the real route's own normalisation (apps/api/src/routes/
    // banks.ts's PATCH handler, fix round 1 finding 6): an explicit empty
    // `title` clears it rather than being stored as `""`.
    updateGroup: async (_workspaceId, _bankId, groupId, patch) => ({
      id: groupId,
      passage: patch.passage ?? "",
      questionCount: 0,
      ...(patch.title !== undefined && patch.title !== "" && { title: patch.title }),
    }),
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: async () => {
      throw new Error("not used");
    },
    tests: async () => [],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => {
      throw new Error("not used");
    },
    updateTest: async () => {
      throw new Error("not used");
    },
    draft: async () => {
      throw new Error("not used");
    },
    patchDraft: async () => {
      throw new Error("not used");
    },
    publishTest: async () => {
      throw new Error("not used by this test file");
    },
    closeTest: async () => {
      throw new Error("not used by this test file");
    },
    archiveTest: async () => {
      throw new Error("not used by this test file");
    },
    versions: async () => [],
    checklist: async () => [],
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    // Task 6 (#58, P5.5): present only to satisfy `ApiClient`'s shape --
    // nothing in this file reaches T-19's link check.
    checkUrl: async () => {
      throw new Error("not used by this test file");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used by this test file");
    },
    uploadMedia: async () => {
      throw new Error("not used by this test file");
    },
    candidates: async () => [],
    lockedAttempts: async () => [],
    unlockAttempt: async () => {
      throw new Error("not used by this test file");
    },
    importCandidates: async () => {
      throw new Error("not used by this test file");
    },
    gradingQueue: async () => {
      throw new Error("not used by this test file");
    },
    grade: async () => {
      throw new Error("not used by this test file");
    },
    recordVerdict: async () => {
      throw new Error("not used by this test file");
    },
    exportCandidateData: async () => {
      throw new Error("not used by this test file");
    },
    deleteCandidateData: async () => {
      throw new Error("not used by this test file");
    },
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

function optionValues(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options).map((option) => option.value);
}

function previewOrder(preview: HTMLElement): string[] {
  return Array.from(preview.querySelectorAll<HTMLElement>("[data-preview-section]")).map(
    (el) => el.dataset.previewSection ?? "",
  );
}

const QUESTION_IN_GROUP: TrueFalseQuestion = {
  id: "DIN-001",
  type: "true_false",
  prompt: "Row 1 of the table is an order.",
  key: true,
  group: "orders-table",
};

describe("passage groups in the question editor", () => {
  it("the group's passage renders above each question in its group in the preview", async () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={QUESTION_IN_GROUP}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const preview = await screen.findByRole("region", { name: /preview/i });
    await waitFor(() => expect(within(preview).getByRole("table")).toBeVisible());
    expect(previewOrder(preview)).toEqual(["passage", "prompt"]);
  });

  it("the meta block offers the bank's groups and 'no group'", async () => {
    render(
      <QuestionEditor bankId="bnk_1" workspaceId="wsp_1" initial={QUESTION_IN_GROUP} client={fakeClient()} onSaved={noop} />,
    );
    await screen.findByLabelText("Passage group");
    expect(optionValues("Passage group")).toEqual(["", "orders-table", "library-loans"]);
  });

  it("picking a group sets the question's group field and clearing it unsets it", async () => {
    const saved: Question[] = [];
    const client = fakeClient({
      saveQuestion: async (_workspaceId, bankId, doc) => {
        saved.push(doc);
        return { id: "qst_1", bankId, refId: doc.id, document: doc, points: 1, usedInTests: 0, updatedAt: 0 };
      },
    });
    const noGroup: TrueFalseQuestion = { id: "Q1", type: "true_false", prompt: "P", key: true };
    render(<QuestionEditor bankId="bnk_1" workspaceId="wsp_1" initial={noGroup} client={client} onSaved={noop} />);

    const select = await screen.findByLabelText("Passage group");
    fireEvent.change(select, { target: { value: "orders-table" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.group).toBe("orders-table");

    // Fix round 1, finding 5: the test's own name promised this half too —
    // clearing the selection back to "No group" must unset `group` rather
    // than leaving the last-picked one behind.
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(saved[1]?.group).toBeUndefined();
    expect(Object.keys(saved[1] ?? {})).not.toContain("group");
  });
});

describe("GroupEditor", () => {
  it("creates a new group with an id, title and Markdown passage", async () => {
    const created: unknown[] = [];
    const client = fakeClient({
      createGroup: async (_workspaceId, _bankId, input) => {
        created.push(input);
        return { ...input, questionCount: 0 };
      },
    });
    const onSaved = vi.fn();
    render(<GroupEditor bankId="bnk_1" workspaceId="wsp_1" client={client} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText("Group ID"), { target: { value: "orders-table" } });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Orders" } });
    fireEvent.change(screen.getByLabelText("Passage"), { target: { value: "| a |\n| - |" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(created).toEqual([{ id: "orders-table", title: "Orders", passage: "| a |\n| - |" }]);
  });

  it("an existing group's ID cannot be edited", () => {
    render(
      <GroupEditor bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} group={ORDERS_TABLE} onSaved={noop} />,
    );
    const idField = screen.getByLabelText("Group ID") as HTMLInputElement;
    expect(idField).toBeDisabled();
    expect(idField.value).toBe("orders-table");
  });

  it("updates an existing group's title and passage", async () => {
    const updates: unknown[] = [];
    const client = fakeClient({
      updateGroup: async (_workspaceId, _bankId, groupId, patch) => {
        updates.push([groupId, patch]);
        return {
          id: groupId,
          passage: patch.passage ?? "",
          questionCount: 1,
          ...(patch.title !== undefined && patch.title !== "" && { title: patch.title }),
        };
      },
    });
    const onSaved = vi.fn();
    render(
      <GroupEditor bankId="bnk_1" workspaceId="wsp_1" client={client} group={ORDERS_TABLE} onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Orders v2" } });
    fireEvent.change(screen.getByLabelText("Passage"), { target: { value: "new passage" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updates).toEqual([["orders-table", { title: "Orders v2", passage: "new passage" }]]);
  });

  // Fix round 1, finding 6: `onSave`'s update branch used to send `title`
  // only when non-empty, so clearing the field silently resent the old
  // title (and the test above, unmodified, would have kept asserting that
  // resend rather than ever exercising a clear). Verifies the field reaches
  // the client as an explicit `""` and the saved group comes back with no
  // title at all — the same normalisation the real route performs.
  it("clears an existing group's title", async () => {
    const updates: unknown[] = [];
    const client = fakeClient({
      updateGroup: async (_workspaceId, _bankId, groupId, patch) => {
        updates.push(patch);
        return {
          id: groupId,
          passage: patch.passage ?? "",
          questionCount: 1,
          ...(patch.title !== undefined && patch.title !== "" && { title: patch.title }),
        };
      },
    });
    const onSaved = vi.fn();
    render(
      <GroupEditor bankId="bnk_1" workspaceId="wsp_1" client={client} group={ORDERS_TABLE} onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updates).toEqual([{ title: "", passage: "| a |\n| - |" }]);
    expect(onSaved.mock.calls[0]?.[0]).not.toHaveProperty("title");
  });

  it("the group editor has no axe violations", async () => {
    const { container } = render(
      <GroupEditor bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} onSaved={noop} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
