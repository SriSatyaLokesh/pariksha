import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type {
  FillBlankQuestion,
  LongAnswerQuestion,
  NumericQuestion,
  Question,
  ShortAnswerQuestion,
} from "@pariksha/core";
import { validateBank } from "@pariksha/core";

import type { ApiClient } from "../../src/lib/api";
import { QuestionEditor } from "../../src/components/authoring/QuestionEditor";
import { placeholdersIn } from "../../src/components/authoring/answer/Written";

const noop = () => undefined;

// No @testing-library/user-event in this workspace (see reorder.test.tsx) —
// fireEvent on the real controls is the house pattern every other authoring
// test file uses.
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

function optionValues(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options)
    .map((option) => option.value)
    .filter((value) => value !== "");
}

function bankOf(question: Question) {
  return { format: "pariksha/bank@1" as const, name: "t", questions: [question] };
}

/** Renders the editor, performs `interact`, saves, and returns the document
 * the editor actually emitted — the same pattern structured-editor.test.tsx's
 * `renderAndSave` uses, so a passing test proves what got saved, not just
 * what briefly appeared on screen. */
async function renderAndSave(initial: Question, interact?: () => void): Promise<Question> {
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
  interact?.();
  fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
  await waitFor(() => expect(saved).toBeDefined());
  cleanup();
  return saved as Question;
}

const EMPTY_FILL_BLANK: FillBlankQuestion = {
  id: "QF1",
  type: "fill_blank",
  prompt: "",
  blanks: [],
};

const ONE_BLANK_FILL_BLANK: FillBlankQuestion = {
  id: "QF2",
  type: "fill_blank",
  prompt: "The capital is {{1}}.",
  blanks: [{ id: "1", accepted: ["Delhi"], match: "case_insensitive" }],
};

const NUMERIC_FIXTURE: NumericQuestion = {
  id: "QN1",
  type: "numeric",
  prompt: "What is the boiling point of water in Celsius?",
  unit: "C",
  key: { value: 100, tolerance: 0.5, tolerance_type: "absolute" },
};

const SHORT_ANSWER_FIXTURE: ShortAnswerQuestion = {
  id: "QS1",
  type: "short_answer",
  prompt: "Name the capital of France.",
};

const LONG_ANSWER_FIXTURE: LongAnswerQuestion = {
  id: "QL1",
  type: "long_answer",
  prompt: "Explain the water cycle.",
};

describe("placeholdersIn", () => {
  it("returns placeholders in prompt order, deduplicated", () => {
    expect(placeholdersIn("{{b}} then {{a}} then {{b}}")).toEqual(["b", "a"]);
  });

  it("returns an empty list for a prompt with no placeholder", () => {
    expect(placeholdersIn("No blanks here.")).toEqual([]);
  });
});

describe("WrittenAnswer: fill_blank (UX-21)", () => {
  it("typing {{1}} in the prompt grows a blank row for it", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={EMPTY_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const prompt = screen.getByLabelText(/^prompt$/i);
    fireEvent.change(prompt, { target: { value: "The capital is {{1}}." } });
    expect(screen.getByRole("group", { name: /blank 1/i })).toBeVisible();
  });

  it("deleting the placeholder deletes the row", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ONE_BLANK_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByRole("group", { name: /blank 1/i })).toBeVisible();
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "" } });
    expect(screen.queryByRole("group", { name: /blank 1/i })).toBeNull();
  });

  it("editing the prompt around a placeholder keeps that blank's accepted answers", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ONE_BLANK_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^prompt$/i), {
      target: { value: "The capital city of India is {{1}}, officially." },
    });
    expect(screen.getByRole("group", { name: /blank 1/i })).toBeVisible();
    expect(screen.getByLabelText(/accepted answers for blank 1/i)).toHaveValue("Delhi");
  });

  it("a fill_blank built in this editor always passes validateBank's placeholder rule", async () => {
    const saved = await renderAndSave(EMPTY_FILL_BLANK, () => {
      fireEvent.change(screen.getByLabelText(/^prompt$/i), {
        target: { value: "{{1}} and {{2}}" },
      });
      fireEvent.change(screen.getByLabelText(/accepted answers for blank 1/i), {
        target: { value: "Delhi" },
      });
      fireEvent.change(screen.getByLabelText(/accepted answers for blank 2/i), {
        target: { value: "Mumbai" },
      });
    });
    expect(validateBank(bankOf(saved)).ok).toBe(true);
  });

  it("a regex match mode rejects a pattern core calls unsafe, inline, before save, and disables Save", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ONE_BLANK_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/match mode for blank 1/i), {
      target: { value: "regex" },
    });
    fireEvent.change(screen.getByLabelText(/accepted answers for blank 1/i), {
      target: { value: "(a+)+$" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/unsafe/i);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    // Fixing the pattern clears the alert and re-enables Save.
    fireEvent.change(screen.getByLabelText(/accepted answers for blank 1/i), {
      target: { value: "Delhi" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });
});

describe("WrittenAnswer: numeric", () => {
  it("offers value, tolerance, tolerance type and unit, and tolerance type is absolute or percent", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={NUMERIC_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByLabelText(/^value$/i)).toHaveValue(100);
    expect(screen.getByLabelText(/^tolerance$/i)).toHaveValue(0.5);
    expect(screen.getByLabelText(/^unit$/i)).toHaveValue("C");
    expect(optionValues("Tolerance type")).toEqual(["absolute", "percent"]);
  });

  it("a key built in the editor passes validateBank", async () => {
    const saved = await renderAndSave(NUMERIC_FIXTURE, () => {
      fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: "37" } });
    });
    expect((saved as NumericQuestion).key.value).toBe(37);
    expect(validateBank(bankOf(saved)).ok).toBe(true);
  });
});

describe("WrittenAnswer: short_answer and long_answer", () => {
  it("max_length is capped at the format's ceiling for each type", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SHORT_ANSWER_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByLabelText(/maximum length/i)).toHaveAttribute("max", "500");
    cleanup();

    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={LONG_ANSWER_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByLabelText(/maximum length/i)).toHaveAttribute("max", "5000");
  });

  it("short_answer and long_answer offer rubric and nothing else", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SHORT_ANSWER_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(optionValues("Scoring mode")).toEqual(["rubric"]);
    cleanup();

    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={LONG_ANSWER_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(optionValues("Scoring mode")).toEqual(["rubric"]);
  });

  it("a manual type with no rubric warns that it will score 0, and the warning clears once one is added", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SHORT_ANSWER_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/scores 0 without a rubric/i);
    fireEvent.click(screen.getByRole("button", { name: /add rubric level/i }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/scores 0 without a rubric/i)).toBeNull();
  });

  it("a rubric level built in the editor passes validateBank", async () => {
    const saved = await renderAndSave(SHORT_ANSWER_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /add rubric level/i }));
      fireEvent.change(screen.getByLabelText(/rubric level 1 name/i), {
        target: { value: "Full credit" },
      });
      fireEvent.change(screen.getByLabelText(/rubric level 1 points/i), {
        target: { value: "5" },
      });
    });
    expect((saved as ShortAnswerQuestion).rubric).toEqual([{ level: "Full credit", points: 5 }]);
    expect(validateBank(bankOf(saved)).ok).toBe(true);
  });
});

describe("WrittenAnswer: accessibility", () => {
  it("the four written editors have no axe violations", async () => {
    for (const fixture of [ONE_BLANK_FILL_BLANK, NUMERIC_FIXTURE, SHORT_ANSWER_FIXTURE, LONG_ANSWER_FIXTURE]) {
      const { container } = render(
        <QuestionEditor
          bankId="bnk_1"
          workspaceId="wsp_1"
          initial={fixture}
          client={fakeClient()}
          onSaved={noop}
        />,
      );
      expect(await axe(container)).toHaveNoViolations();
      cleanup();
    }
  });
});
