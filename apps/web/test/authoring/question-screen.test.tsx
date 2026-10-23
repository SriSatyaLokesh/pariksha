import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SingleQuestion } from "@pariksha/core";

import type { Actor, ApiClient, Bank, Workspace } from "../../src/lib/api";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "author@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const BANK: Bank = {
  id: "bnk_1",
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount: 1,
  createdAt: 0,
  updatedAt: 0,
};

const SINGLE: SingleQuestion = {
  id: "Q1",
  type: "single",
  prompt: "Which HTTP method is idempotent?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    createBank: async () => {
      throw new Error("not used");
    },
    listQuestions: async () => ({
      questions: [
        {
          id: "qst_1",
          bankId: "bnk_1",
          refId: SINGLE.id,
          document: SINGLE,
          points: 1,
          usedInTests: 0,
          updatedAt: 0,
        },
      ],
    }),
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
    ...overrides,
  };
}

// Fix round (whole-branch review, M4): `justSaved` used to be set `true` on
// save and never reset — "Saved." stayed on screen, asserting the opposite
// of the truth, through every later edit.

// D14: Home -> Banks -> the bank -> the editor, the only route an Author
// has. This file rendered `QuestionScreen` with eight props, three of which
// Phase 6.5c Task 1 deleted; rendering it alone could never have shown that
// the editor is reachable at all.
async function openEditor(client: ApiClient = fakeClient()) {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
  fireEvent.click(await screen.findByRole("button", { name: /SQL basics/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^edit question:/i }));
  await screen.findByRole("heading", { level: 1, name: "Edit question" });
  return view;
}

describe("QuestionScreen's 'Saved.' status", () => {
  it("appears after a save and clears on the next edit", async () => {
    await openEditor(fakeClient());

    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    expect(await screen.findByText("Saved.")).toBeVisible();

    fireEvent.change(screen.getByLabelText("Prompt"), {
      target: { value: "Which HTTP method is safe?" },
    });
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("does not clear on its own just because the editor re-rendered after the save", async () => {
    await openEditor(fakeClient());

    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));
    const saved = await screen.findByText("Saved.");

    // A moment with no further edit — the status must still read "Saved.",
    // not flip back on a re-render the save itself causes.
    await waitFor(() => expect(saved).toBeVisible());
    expect(screen.getByText("Saved.")).toBeVisible();
  });
});
