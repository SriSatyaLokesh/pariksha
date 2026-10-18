import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type {
  AssertionReasonQuestion,
  Question,
  QuestionType,
  SelectKQuestion,
  SingleQuestion,
  TrueFalseQuestion,
} from "@pariksha/core";
import { APPLICABLE_MODES } from "@pariksha/core";

import type { ApiClient, QuestionSummary } from "../../src/lib/api";
import { QuestionEditor } from "../../src/components/authoring/QuestionEditor";
import { ScoringRow } from "../../src/components/authoring/ScoringRow";

const noop = () => undefined;

// Button names TypePicker renders (src/components/authoring/TypePicker.tsx's
// TYPE_LABELS) — kept here rather than imported so this file exercises the
// same public surface a user clicks through, not an internal constant.
const TYPE_BUTTON_NAME: Record<QuestionType, RegExp> = {
  single: /^single choice$/i,
  multiple: /^multiple choice$/i,
  select_k: /^select k$/i,
  true_false: /true \/ false/i,
  assertion_reason: /assertion-reason/i,
  matching: /^matching$/i,
  multi_matching: /multi matching/i,
  ordering: /^ordering$/i,
  fill_blank: /fill in the blank/i,
  numeric: /^numeric$/i,
  short_answer: /short answer/i,
  long_answer: /long answer/i,
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
    getBank: async () => {
      throw new Error("not used");
    },
    updateBank: async () => {
      throw new Error("not used");
    },
    deleteBank: async () => undefined,
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
    ...overrides,
  };
}

function headingOrder(): string[] {
  return screen.getAllByRole("heading").map((heading) => heading.textContent ?? "");
}

function optionValues(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options)
    .map((option) => option.value)
    .filter((value) => value !== "");
}

const SINGLE_FIXTURE: SingleQuestion = {
  id: "Q1",
  type: "single",
  prompt: "Which HTTP method is idempotent?",
  options: [
    { id: "a", text: "GET" },
    { id: "b", text: "POST" },
  ],
  key: "a",
};

const MULTIPLE_FIXTURE: Question = {
  id: "Q2",
  type: "multiple",
  prompt: "Which are true?",
  options: [
    { id: "a", text: "One" },
    { id: "b", text: "Two" },
  ],
  key: ["a"],
};

const SELECT_K_FIXTURE: SelectKQuestion = {
  id: "Q3",
  type: "select_k",
  prompt: "Pick two.",
  options: [
    { id: "a", text: "Alpha" },
    { id: "b", text: "Beta" },
    { id: "c", text: "Gamma" },
  ],
  k: 2,
  key: [],
};

const TRUE_FALSE_FIXTURE: TrueFalseQuestion = {
  id: "Q4",
  type: "true_false",
  prompt: "TCP is connectionless.",
  key: false,
};

const ASSERTION_REASON_FIXTURE: AssertionReasonQuestion = {
  id: "Q5",
  type: "assertion_reason",
  prompt: "Assess the assertion and the reason.",
  assertion: "The sky is blue.",
  reason: "Air scatters blue light more than red.",
  key: "both_true_explains",
};

const FIXTURE_OF: Record<string, Question> = {
  single: SINGLE_FIXTURE,
  multiple: MULTIPLE_FIXTURE,
  select_k: SELECT_K_FIXTURE,
  true_false: TRUE_FALSE_FIXTURE,
  assertion_reason: ASSERTION_REASON_FIXTURE,
};

function fixtureOf(type: string): Question {
  const fixture = FIXTURE_OF[type];
  if (!fixture) throw new Error(`no fixture for ${type}`);
  return fixture;
}

describe("QuestionEditor (UX-07)", () => {
  it("the five blocks appear in order for every choice type", () => {
    for (const type of ["single", "multiple", "select_k", "true_false", "assertion_reason"] as const) {
      render(
        <QuestionEditor
          bankId="bnk_1"
          workspaceId="wsp_1"
          initial={fixtureOf(type)}
          client={fakeClient()}
          onSaved={noop}
        />,
      );
      expect(headingOrder()).toEqual(["Prompt", "Answer", "Key and scoring", "Meta", "Preview"]);
      cleanup();
    }
  });

  it("the scoring row offers only the modes the type supports", () => {
    render(<ScoringRow type="single" value={{}} onChange={noop} />);
    expect(optionValues("Scoring mode")).toEqual([...APPLICABLE_MODES.single]);
    cleanup();
    render(<ScoringRow type="multiple" value={{}} onChange={noop} />);
    expect(optionValues("Scoring mode")).toContain("partial");
  });

  it("AC-07: select_k disables further choices once k options are marked correct", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /option a is correct/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /option b is correct/i }));
    expect(screen.getByRole("checkbox", { name: /option c is correct/i })).toBeDisabled();
  });

  it("an option marked pinned never moves (shuffle_options)", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /pin option b/i }));
    expect(screen.getByRole("button", { name: /move option b up/i })).toBeDisabled();
  });

  it("UX-06: changing the type names exactly what will be lost before it drops it", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change type/i }));
    fireEvent.click(screen.getByRole("button", { name: TYPE_BUTTON_NAME.true_false }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/options.*key.*k/is);
    expect(dialog).not.toHaveTextContent(/prompt|tags|difficulty|explanation/i);
  });

  it("Review Focus 2: a type changed away and back carries no stale field", async () => {
    const saved = await changeType(await changeType(SELECT_K_FIXTURE, "single"), "select_k");
    expect(saved).not.toHaveProperty("k");
  });

  it("the editor has no axe violations and every control has a label", async () => {
    const { container } = render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

/**
 * Drives one type change through the real UI (Change type -> pick type ->
 * confirm the data-loss dialog if one appears -> Save) and returns the
 * document the editor actually saved — the only way to prove the save path
 * emits just the new type's fields rather than the old ones merged in.
 */
async function changeType(initial: Question, nextType: QuestionType): Promise<Question> {
  let saved: Question | undefined;
  render(
    <QuestionEditor
      bankId="bnk_1"
      workspaceId="wsp_1"
      initial={initial}
      client={fakeClient()}
      onSaved={(question) => {
        saved = question;
      }}
    />,
  );

  if (nextType !== initial.type) {
    fireEvent.click(screen.getByRole("button", { name: /change type/i }));
    fireEvent.click(screen.getByRole("button", { name: TYPE_BUTTON_NAME[nextType] }));
    const dialog = screen.queryByRole("dialog");
    if (dialog) {
      fireEvent.click(within(dialog).getByRole("button", { name: /^confirm$/i }));
    }
  }

  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(saved).toBeDefined());
  cleanup();
  return saved as Question;
}
