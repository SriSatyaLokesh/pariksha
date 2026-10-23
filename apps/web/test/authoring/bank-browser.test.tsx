import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Question } from "@pariksha/core";

import {
  ApiError,
  type Actor,
  type ApiClient,
  type Bank,
  type PassageGroupSummary,
  type QuestionSummary,
  type Workspace,
} from "../../src/lib/api";
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
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

const DOCUMENT: Question = {
  id: "Q1",
  type: "single",
  prompt: "Which HTTP method is idempotent?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
  difficulty: "medium",
  tags: ["sdlc/agile", "exam/midterm"],
};

const QUESTION: QuestionSummary = {
  id: "qst_1",
  bankId: "bnk_1",
  refId: "Q1",
  document: DOCUMENT,
  points: 2,
  usedInTests: 0,
  updatedAt: 1_700_000_000_000,
};

const QUESTION_2: QuestionSummary = {
  id: "qst_2",
  bankId: "bnk_1",
  refId: "Q2",
  document: { id: "Q2", type: "true_false", prompt: "TCP is connectionless.", key: false },
  points: 1,
  usedInTests: 0,
  updatedAt: 1_700_000_000_000,
};

// One typed object literal implementing ApiClient, same convention as
// apps/web/test/organiser.test.tsx's `fakeClient` — no MSW, no fetch mock.
function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    createBank: async () => ({ ...BANK }),
    listQuestions: async () => ({ questions: [QUESTION] }),
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
    listTags: async () => ["sdlc/agile", "exam/midterm"],
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


// D14 (owner's ruling): every assertion starts at `OrganiserApp` and clicks
// its way here. This file rendered `BankBrowser` directly thirteen times,
// which is exactly the shape the ruling names — a test that cannot see
// whether anything in the running app mounts the screen it asserts on.
// Phase 6.5c Task 1 deleted the props those renders passed, so they had to
// be touched anyway.

/** Home -> Banks, the only route an organiser has. */
async function openBankList(client: ApiClient = fakeClient()) {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
  await screen.findByRole("heading", { level: 1, name: "Banks" });
  return view;
}

/** ...and on into the browser for one bank. */
async function openBrowser(client: ApiClient = fakeClient()) {
  const view = await openBankList(client);
  fireEvent.click(await screen.findByRole("button", { name: /SQL basics/ }));
  return view;
}

describe("BankBrowser", () => {
  it("UX-04: the browser is a table with prompt, type, difficulty, tags, points, last edited and used-in", async () => {
    await openBrowser(fakeClient());
    // The headers are static JSX and render before `load()`'s promise
    // settles, but awaiting a `findBy` here (rather than asserting
    // synchronously) lets that promise's state update land inside an
    // RTL-managed act() scope instead of after the test body returns — the
    // "Also" note in fixture review's act() warning, caught by pasting the
    // raw run into the fix report rather than trusting a green summary line.
    await screen.findByText(DOCUMENT.prompt);
    for (const h of ["Prompt", "Type", "Difficulty", "Tags", "Points", "Last edited", "Used in"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h, "i") })).toBeVisible();
    }
  });

  it("UX-03: a tag with a slash renders as a breadcrumb chip and groups the left rail", async () => {
    await openBrowser(fakeClient());
    const rail = screen.getByRole("navigation", { name: /filters/i });
    expect(await within(rail).findByText("sdlc")).toBeVisible();
    expect(screen.getByRole("button", { name: "sdlc / agile" })).toBeVisible();
  });

  it("UX-04: rows select with a checkbox and the bulk bar reports the count", async () => {
    await openBrowser(fakeClient());
    const checkboxes = await screen.findAllByRole("checkbox", { name: /select question/i });
    fireEvent.click(checkboxes[0]!);
    expect(screen.getByText(/1 selected/)).toBeVisible();
  });

  it("UX-05: a refused delete names the tests holding the question", async () => {
    const client = fakeClient({
      deleteQuestion: async () => {
        throw new ApiError(409, "question_in_use", "blocked", { blockedBy: ["Midterm"] });
      },
    });
    await openBrowser(client);
    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    expect(await screen.findByText(/Midterm/)).toBeVisible();
  });

  // Fix round (whole-branch review, M3): `exportBank`'s single-question
  // sibling had a route and five API tests but no caller anywhere in this
  // app — this is the only control that reaches it.
  it("M3: a row's Export button downloads that question alone", async () => {
    const exportQuestion = vi.fn(async () => DOCUMENT);
    const client = fakeClient({ exportQuestion });
    await openBrowser(client);

    fireEvent.click(await screen.findByRole("button", { name: /^export question:/i }));
    await waitFor(() => expect(exportQuestion).toHaveBeenCalledWith("wsp_1", "bnk_1", QUESTION.id));
  });

  it("finding 10: each row's delete button has a distinct accessible name", async () => {
    const client = fakeClient({ listQuestions: async () => ({ questions: [QUESTION, QUESTION_2] }) });
    await openBrowser(client);

    const deleteButtons = await screen.findAllByRole("button", { name: /^delete question:/i });
    expect(deleteButtons).toHaveLength(2);
    const names = deleteButtons.map((button) => button.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  it("finding 12: changing a filter clears the selection", async () => {
    const client = fakeClient({ listQuestions: async () => ({ questions: [QUESTION, QUESTION_2] }) });
    await openBrowser(client);

    const checkboxes = await screen.findAllByRole("checkbox", { name: /select question/i });
    fireEvent.click(checkboxes[0]!);
    expect(screen.getByText(/1 selected/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "sdlc / agile" }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("the bank list and the browser have no axe violations", async () => {
    const list = await openBankList(fakeClient());
    expect(await list.findByText("SQL basics")).toBeVisible();
    expect(await axe(list.container)).toHaveNoViolations();
    list.unmount();

    const browser = await openBrowser(fakeClient());
    expect(await browser.findByText("Which HTTP method is idempotent?")).toBeVisible();
    expect(await axe(browser.container)).toHaveNoViolations();
  });

  // Fix round 1, finding 12: the axe pass above ran with an empty
  // `listGroups`, so the panel's actual rows — the Edit/Delete buttons
  // among them — were never scanned. A non-empty one here.
  it("the browser with passage groups listed has no axe violations", async () => {
    const group: PassageGroupSummary = { id: "orders-table", title: "Orders", passage: "x", questionCount: 2 };
    const client = fakeClient({ listGroups: async () => [group] });
    const browser = await openBrowser(client);
    expect(await browser.findByText("Orders (2 questions)")).toBeVisible();
    expect(await axe(browser.container)).toHaveNoViolations();
  });

  // Phase 4 Task 6 (#50, P4.6).
  it("lists the bank's passage groups and opens a new-group form", async () => {
    const group: PassageGroupSummary = { id: "orders-table", title: "Orders", passage: "x", questionCount: 2 };
    const client = fakeClient({ listGroups: async () => [group] });
    await openBrowser(client);

    expect(await screen.findByText("Orders (2 questions)")).toBeVisible();
    expect(screen.queryByLabelText("Group ID")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New group" }));
    expect(screen.getByLabelText("Group ID")).toBeVisible();
  });

  // Task 9 (#53, P4.9).
  it("exports the whole bank when nothing is selected, and only the selected refIds when something is", async () => {
    const exportBank = vi.fn(async () => ({ format: "pariksha/bank@1" as const, name: "Exported", questions: [] }));
    const client = fakeClient({
      listQuestions: async () => ({ questions: [QUESTION, QUESTION_2] }),
      exportBank,
    });
    await openBrowser(client);

    const exportButton = await screen.findByRole("button", { name: /^export bank$/i });
    fireEvent.click(exportButton);
    await waitFor(() => expect(exportBank).toHaveBeenCalledWith("wsp_1", "bnk_1", undefined));

    const checkboxes = await screen.findAllByRole("checkbox", { name: /select question/i });
    fireEvent.click(checkboxes[0]!);
    // Fix round 1, finding 3 (Label in Name): the accessible name is the
    // visible "Export selected" *plus* a count, never a replacement of it —
    // "Export selected (1 question)", not "Export the 1 selected question".
    fireEvent.click(screen.getByRole("button", { name: /^export selected \(1 question\)$/i }));
    await waitFor(() => expect(exportBank).toHaveBeenCalledWith("wsp_1", "bnk_1", ["Q1"]));
  });

  it("the export control is keyboard reachable and shows a notice when export fails", async () => {
    const client = fakeClient({
      exportBank: async () => {
        throw new ApiError(500, "unexpected_response", "The bank could not be reached.");
      },
    });
    await openBrowser(client);

    const exportButton = await screen.findByRole("button", { name: /^export bank$/i });
    exportButton.focus();
    expect(exportButton).toHaveFocus();
    fireEvent.click(exportButton);
    expect(await screen.findByText("The bank could not be reached.")).toBeVisible();
  });

  // Fix round (whole-branch review, I1): a 422 `not_exportable` carries
  // `details.issues`, each naming the offending `questionId` — this used to
  // be dropped on the floor (only `cause.message` rendered), leaving an
  // Author with no way to tell which of many questions to deselect.
  it("names the offending question when export refuses a draft-holding bank", async () => {
    const client = fakeClient({
      exportBank: async () => {
        throw new ApiError(
          422,
          "not_exportable",
          "This cannot be exported: the document would fail its own import.",
          {
            issues: [
              { questionId: "Q37", index: 36, field: "key", message: 'key uses "c", which is not in options' },
            ],
          },
        );
      },
    });
    await openBrowser(client);

    fireEvent.click(await screen.findByRole("button", { name: /^export bank$/i }));

    expect(await screen.findByText(/this cannot be exported/i)).toBeVisible();
    expect(screen.getByText("Q37")).toBeVisible();
    expect(screen.getByText(/not in options/)).toBeVisible();
  });

  // Fix round 1, finding 3: WCAG 2.1 SC 2.5.3, Label in Name — the
  // accessible name must contain the visible label verbatim (as a
  // case-insensitive substring), both with and without a selection, or
  // speech input ("click Export selected") cannot match the control.
  // `jest-axe`'s default ruleset does not include `label-content-name-
  // mismatch` (experimental), so this is checked directly rather than
  // relying on the axe passes elsewhere in this file to catch it.
  it("the export control's accessible name contains its visible label", async () => {
    const client = fakeClient({ listQuestions: async () => ({ questions: [QUESTION, QUESTION_2] }) });
    await openBrowser(client);

    function labelInName(button: HTMLElement): void {
      const visible = button.textContent!.trim().toLowerCase();
      const accessibleName = (button.getAttribute("aria-label") ?? button.textContent ?? "").toLowerCase();
      expect(accessibleName).toContain(visible);
    }

    labelInName(await screen.findByRole("button", { name: /^export bank$/i }));

    const checkboxes = await screen.findAllByRole("checkbox", { name: /select question/i });
    fireEvent.click(checkboxes[0]!);
    labelInName(screen.getByRole("button", { name: /export selected/i }));
  });

  it("a refused group delete names the questions holding it", async () => {
    const group: PassageGroupSummary = { id: "orders-table", title: "Orders", passage: "x", questionCount: 2 };
    const client = fakeClient({
      listGroups: async () => [group],
      deleteGroup: async () => {
        throw new ApiError(409, "group_in_use", "blocked", { blockedBy: ["DIN-001", "DIN-002"] });
      },
    });
    await openBrowser(client);

    fireEvent.click(await screen.findByRole("button", { name: "Delete passage group: Orders" }));
    expect(await screen.findByText(/DIN-001, DIN-002/)).toBeVisible();
  });
});
