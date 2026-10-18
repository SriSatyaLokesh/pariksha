import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Question } from "@pariksha/core";

import { ApiError, type ApiClient, type Bank, type QuestionSummary } from "../../src/lib/api";
import { BankBrowser } from "../../src/routes/bank";
import { BankList } from "../../src/routes/banks";

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
    me: async () => null,
    workspaces: async () => [],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
    createBank: async () => ({ ...BANK }),
    getBank: async () => ({ ...BANK }),
    updateBank: async () => ({ ...BANK }),
    deleteBank: async () => undefined,
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
    ...overrides,
  };
}

describe("BankBrowser", () => {
  it("UX-04: the browser is a table with prompt, type, difficulty, tags, points, last edited and used-in", async () => {
    render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} />);
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
    render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} />);
    const rail = screen.getByRole("navigation", { name: /filters/i });
    expect(await within(rail).findByText("sdlc")).toBeVisible();
    expect(screen.getByRole("button", { name: "sdlc / agile" })).toBeVisible();
  });

  it("UX-04: rows select with a checkbox and the bulk bar reports the count", async () => {
    render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} />);
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
    render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /delete/i }));
    expect(await screen.findByText(/Midterm/)).toBeVisible();
  });

  it("finding 10: each row's delete button has a distinct accessible name", async () => {
    const client = fakeClient({ listQuestions: async () => ({ questions: [QUESTION, QUESTION_2] }) });
    render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={client} />);

    const deleteButtons = await screen.findAllByRole("button", { name: /^delete question:/i });
    expect(deleteButtons).toHaveLength(2);
    const names = deleteButtons.map((button) => button.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  it("finding 12: changing a filter clears the selection", async () => {
    const client = fakeClient({ listQuestions: async () => ({ questions: [QUESTION, QUESTION_2] }) });
    render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={client} />);

    const checkboxes = await screen.findAllByRole("checkbox", { name: /select question/i });
    fireEvent.click(checkboxes[0]!);
    expect(screen.getByText(/1 selected/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "sdlc / agile" }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("the bank list and the browser have no axe violations", async () => {
    const list = render(<BankList workspaceId="wsp_1" client={fakeClient()} onOpenBank={() => undefined} />);
    expect(await list.findByText("SQL basics")).toBeVisible();
    expect(await axe(list.container)).toHaveNoViolations();
    list.unmount();

    const browser = render(<BankBrowser bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} />);
    expect(await browser.findByText("Which HTTP method is idempotent?")).toBeVisible();
    expect(await axe(browser.container)).toHaveNoViolations();
  });
});
