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

function optionValues(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options)
    .map((option) => option.value)
    .filter((value) => value !== "");
}

function bankOf(question: Question) {
  return { format: "pariksha/bank@1" as const, name: "t", questions: [question] };
}

/** `AcceptedAnswersField` (Written.tsx) commits its draft on blur or Enter,
 * not on every keystroke — see its own doc comment for why a controlled
 * input bound straight to `accepted.join(", ")` fights the typist. Every
 * test that needs a *committed* value goes through this, mirroring
 * `fireEvent.change` + blur/Enter the way `structured-editor.test.tsx`
 * drives `ItemText`. */
function setAcceptedAnswers(label: RegExp, value: string): void {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
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

  // Critical fix round 1: a controlled input bound to `accepted.join(", ")`
  // that re-splits on every keystroke erases the separator the instant it's
  // typed (a trailing "Delhi," splits/trims/filters back down to "Delhi",
  // and the controlled `value` prop snaps the DOM back to it) — a second
  // accepted answer could never be typed at all. This asserts the
  // mid-typing DOM value directly (not just the eventually-saved document),
  // which is the only way to catch the regression: a test that only fires
  // one combined `fireEvent.change` with the whole final string never passes
  // through the broken intermediate state and would pass on the old code
  // too.
  it("typing a comma-separated second accepted answer is not swallowed mid-keystroke", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ONE_BLANK_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const field = screen.getByLabelText(/accepted answers for blank 1/i);
    // The separator itself survives in the field while still typing...
    fireEvent.change(field, { target: { value: "Delhi, " } });
    expect(field).toHaveValue("Delhi, ");
    // ...and the second answer can still be appended after it.
    fireEvent.change(field, { target: { value: "Delhi, Dilli" } });
    expect(field).toHaveValue("Delhi, Dilli");
  });

  it("a fill_blank built in this editor always passes validateBank's placeholder rule", async () => {
    const saved = await renderAndSave(EMPTY_FILL_BLANK, () => {
      fireEvent.change(screen.getByLabelText(/^prompt$/i), {
        target: { value: "{{1}} and {{2}}" },
      });
      setAcceptedAnswers(/accepted answers for blank 1/i, "Delhi");
      setAcceptedAnswers(/accepted answers for blank 2/i, "Mumbai");
    });
    expect((saved as FillBlankQuestion).blanks.map((blank) => blank.accepted)).toEqual([
      ["Delhi"],
      ["Mumbai"],
    ]);
    expect(validateBank(bankOf(saved)).ok).toBe(true);
  });

  // A duplicated placeholder is one row, not two — `placeholdersIn` dedupes,
  // and this drives that through the real tree (not just the pure-function
  // unit test above) so a regression in the component's own id-by-id
  // rendering, not just the helper, would be caught too.
  it("a repeated placeholder in the prompt still makes one blank row", async () => {
    const saved = await renderAndSave(EMPTY_FILL_BLANK, () => {
      fireEvent.change(screen.getByLabelText(/^prompt$/i), {
        target: { value: "{{1}} is also {{1}}." },
      });
      expect(screen.getAllByRole("group", { name: /blank 1/i })).toHaveLength(1);
      setAcceptedAnswers(/accepted answers for blank 1/i, "Delhi");
    });
    expect((saved as FillBlankQuestion).blanks).toEqual([
      { id: "1", accepted: ["Delhi"], match: "case_insensitive" },
    ]);
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
    setAcceptedAnswers(/accepted answers for blank 1/i, "(a+)+$");
    expect(screen.getByRole("alert")).toHaveTextContent(/unsafe/i);
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();

    // Fixing the pattern clears the alert and re-enables Save.
    setAcceptedAnswers(/accepted answers for blank 1/i, "Delhi");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
  });

  // Important fix round 1 (findings 2+3): `blanks` must self-heal when the
  // prompt and the stored blanks are out of sync for a reason other than a
  // keystroke in the prompt field — a type change carries the old prompt
  // forward (`sharedFieldsOf`) into a brand new `{ blanks: [] }`
  // (`defaultExtra`), and a document loaded from the API can simply already
  // be stale. Both must show (and save) the derived blank, not an empty
  // list next to a prompt that plainly has a placeholder.
  it("switching the type to fill_blank derives blanks from whatever the prompt already has", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={{
          id: "Q1",
          type: "short_answer",
          prompt: "The capital of India is {{1}}.",
        }}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /change type/i }));
    fireEvent.click(screen.getByRole("button", { name: /fill in the blank/i }));
    expect(screen.getByRole("group", { name: /blank 1/i })).toBeVisible();
    expect(screen.queryByText(/type a placeholder like/i)).toBeNull();
  });

  it("a document loaded already out of sync with its prompt self-heals on render", async () => {
    const saved = await renderAndSave({
      id: "QF3",
      type: "fill_blank",
      prompt: "The capital is {{1}}.",
      blanks: [], // stale: loaded with no blank for a placeholder that already exists
    });
    expect((saved as FillBlankQuestion).blanks.map((blank) => blank.id)).toEqual(["1"]);
    expect(validateBank(bankOf(saved)).ok).toBe(true);
  });

  // Important fix round 1 (finding 4): renumbering must not silently
  // reassign or destroy a typed accepted answer. Retyping the *same*
  // placeholder id after it transiently disappears restores it from the
  // session graveyard; a placeholder that never comes back is named in a
  // status line instead of silently vanishing from what gets saved.
  it("retyping the same placeholder id restores its accepted answers", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ONE_BLANK_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    // Clear the placeholder entirely, then retype the same id.
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "No blank here yet." } });
    expect(screen.queryByRole("group", { name: /blank 1/i })).toBeNull();
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "The capital is {{1}} again." } });
    expect(screen.getByLabelText(/accepted answers for blank 1/i)).toHaveValue("Delhi");
  });

  // The simple retype above never actually proves the graveyard is needed,
  // because nothing ever wrote to `blanks` state in between — the original
  // array just sat there untouched. Editing a *different* blank in between
  // calls `onChange` with the derived (now blank-2-free) document, which
  // really does overwrite state — this is the scenario the graveyard exists
  // for, and the one that would fail without it.
  it("retyping a dropped placeholder restores its answers even after another blank was edited", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={{
          id: "QF4",
          type: "fill_blank",
          prompt: "{{1}} and {{2}}",
          blanks: [
            { id: "1", accepted: ["Delhi"], match: "case_insensitive" },
            { id: "2", accepted: ["Mumbai"], match: "case_insensitive" },
          ],
        }}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "{{1}} only" } });
    expect(screen.queryByRole("group", { name: /blank 2/i })).toBeNull();
    // Editing blank 1 rewrites the document's `blanks` down to just what's
    // currently derived (blank 1 only) — the moment blank 2's answers would
    // be lost for good without the session graveyard.
    setAcceptedAnswers(/accepted answers for blank 1/i, "New Delhi");
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "{{1}} and {{2}} again" } });
    expect(screen.getByLabelText(/accepted answers for blank 2/i)).toHaveValue("Mumbai");
  });

  it("a placeholder dropped from the prompt is named in a status line instead of silently discarded", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ONE_BLANK_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^prompt$/i), { target: { value: "No blank here at all." } });
    expect(screen.getByRole("status")).toHaveTextContent(/blank 1/i);
    expect(screen.getByRole("status")).toHaveTextContent(/dropped/i);
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

  // Promoted-from-minor fix round 1 (finding 8): `Number("") === 0` must not
  // silently zero a required field while the author is mid-clear of it.
  it("clearing the Value field does not silently zero it", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={NUMERIC_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^value$/i), { target: { value: "" } });
    expect(screen.getByLabelText(/^value$/i)).toHaveValue(100);
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

  // Promoted-from-minor fix round 1 (finding 9): the field must not fight
  // the typist by silently clamping mid-keystroke (typing "600" snapping to
  // "500" on the third digit, with no message) — the same defect family as
  // the accepted-answers field. The value stands, and the violation is
  // named instead.
  it("typing a value over the ceiling is not silently clamped, and the violation is named", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SHORT_ANSWER_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const field = screen.getByLabelText(/maximum length/i);
    fireEvent.change(field, { target: { value: "600" } });
    expect(field).toHaveValue(600);
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot exceed 500/i);
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

  // Finding 10: the happy-path fixtures above only ever render each type's
  // initial, already-filled-in state. The zero-blank help text, a populated
  // rubric and the regex error alert are each a materially different DOM
  // shape (an empty state, an extra repeating group, a role="alert"), so
  // each gets its own axe pass rather than being assumed clean because the
  // filled-in state was.
  it("has no axe violations with no blanks yet", async () => {
    const { container } = render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={EMPTY_FILL_BLANK}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with a populated rubric", async () => {
    const { container } = render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={{
          ...SHORT_ANSWER_FIXTURE,
          rubric: [{ level: "Full credit", points: 5, description: "Names the capital correctly." }],
        }}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations while the regex-safety alert is showing", async () => {
    const { container } = render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={{
          ...ONE_BLANK_FILL_BLANK,
          blanks: [{ id: "1", accepted: ["(a+)+$"], match: "regex" }],
        }}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/unsafe/i);
    expect(await axe(container)).toHaveNoViolations();
  });
});
