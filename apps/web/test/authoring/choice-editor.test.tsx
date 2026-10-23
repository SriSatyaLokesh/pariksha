import { describe, it, expect, vi } from "vitest";
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

import type { ApiClient } from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
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
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => null,
    workspaces: async () => [],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
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
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    tests: async () => [],
    versions: async () => [],
    checklist: async () => [],
    readiness: async () => ({}),
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    workspaceBranding: async () => ({}),
    candidates: async () => [],
    lockedAttempts: async () => [],
    usage: async () => undefined,
    listApiKeys: async () => ({ keys: [] }),
    ...overrides,
  });
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
  "$schema": "https://pariksha.local/schemas/question-1.json",
  type: "select_k",
  prompt: "Pick two.",
  options: [
    { id: "a", text: "Alpha" },
    { id: "b", text: "Beta" },
    { id: "c", text: "Gamma" },
  ],
  k: 2,
  key: [],
  shuffle_options: true,
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
    // Finding 1: shuffle_options and $schema are QuestionBase fields, not
    // type-specific ones — carried forward silently, so neither they nor
    // the other genuinely shared fields should ever be named as a loss.
    expect(dialog).not.toHaveTextContent(/prompt|tags|difficulty|explanation|shuffle|schema/i);
  });

  it("Finding 2: the dialog takes focus on open and returns it to Change type on Escape", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const changeTypeButton = screen.getByRole("button", { name: /change type/i });
    fireEvent.click(changeTypeButton);
    fireEvent.click(screen.getByRole("button", { name: TYPE_BUTTON_NAME.true_false }));
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(changeTypeButton);
  });

  it("Finding 2: Confirm applies the change and returns focus to Change type too", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const changeTypeButton = screen.getByRole("button", { name: /change type/i });
    fireEvent.click(changeTypeButton);
    fireEvent.click(screen.getByRole("button", { name: TYPE_BUTTON_NAME.true_false }));
    fireEvent.click(screen.getByRole("button", { name: /^confirm$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(changeTypeButton);
  });

  it("Finding 2: the dialog itself has no axe violations while open", async () => {
    const { container } = render(
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
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("Finding 3: a scoring mode the new type doesn't support is cleared, not carried forward invisibly", async () => {
    const fixture: Question = { ...MULTIPLE_FIXTURE, scoring: { mode: "partial", points: 2 } };
    const saved = await changeType(fixture, "single");
    expect(saved.scoring?.mode).toBeUndefined();
    expect(saved.scoring?.points).toBe(2);
  });

  it("Finding 1: shuffle_options and $schema survive a type change instead of being dropped as if type-specific", async () => {
    const saved = await changeType(SELECT_K_FIXTURE, "single");
    expect(saved).toHaveProperty("shuffle_options", true);
    expect(saved).toHaveProperty("$schema", "https://pariksha.local/schemas/question-1.json");
  });

  it("Finding 5: an option can be added and removed, guarded at the schema's two-option minimum", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SINGLE_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^add option$/i }));
    expect(screen.getByRole("textbox", { name: /option c text/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /remove option c/i }));
    expect(screen.queryByRole("textbox", { name: /option c text/i })).toBeNull();

    // Back at 2 options — schemas/question-1.json's minItems: 2 — further
    // removal is refused, not silently ignored.
    expect(screen.getByRole("button", { name: /remove option a/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /remove option b/i })).toBeDisabled();
  });

  it("Finding 5: a brand new question gets a real, editable ID instead of an empty string", () => {
    render(<QuestionEditor bankId="bnk_1" workspaceId="wsp_1" client={fakeClient()} onSaved={noop} />);
    const idField = screen.getByLabelText("Question ID") as HTMLInputElement;
    // A route matching rows on (bankId, doc.id) can't do anything useful
    // with "" — a fresh question starts with a real id, not a blank one
    // left for the author to notice is missing.
    expect(idField.value).not.toBe("");
    expect(idField.value).toMatch(/^[A-Za-z0-9_.-]{1,64}$/);

    fireEvent.change(idField, { target: { value: "my-question-1" } });
    expect(idField.value).toBe("my-question-1");

    // Clearing it back out regenerates on blur rather than saving blank.
    fireEvent.change(idField, { target: { value: "" } });
    fireEvent.blur(idField);
    expect(idField.value).not.toBe("");
  });

  it("Finding 5: select_k's k is an editable field that governs how many options can be marked correct", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={SELECT_K_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: /how many options are correct/i }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /option a is correct/i }));
    expect(screen.getByRole("checkbox", { name: /option b is correct/i })).toBeDisabled();
  });

  it("Finding 6: option letters wrap past Z instead of producing punctuation", () => {
    const manyOptions = Array.from({ length: 27 }, (_, i) => ({ id: `o${i}`, text: `Text ${i}` }));
    const manyFixture: Question = {
      id: "QMANY",
      type: "multiple",
      prompt: "Pick many.",
      options: manyOptions,
      key: [],
    };
    render(
      <QuestionEditor bankId="bnk_1" workspaceId="wsp_1" initial={manyFixture} client={fakeClient()} onSaved={noop} />,
    );
    expect(screen.getByRole("checkbox", { name: /option aa is correct/i })).toBeInTheDocument();
  });

  it("Finding 7: two editors on the same page don't collide on option-text or correctness-radio ids", () => {
    const first = render(
      <QuestionEditor bankId="bnk_1" workspaceId="wsp_1" initial={SINGLE_FIXTURE} client={fakeClient()} onSaved={noop} />,
    );
    const second = render(
      <QuestionEditor bankId="bnk_1" workspaceId="wsp_1" initial={SINGLE_FIXTURE} client={fakeClient()} onSaved={noop} />,
    );
    const [firstInput, secondInput] = screen.getAllByRole("textbox", { name: /option a text/i });
    expect(firstInput!.id).not.toBe(secondInput!.id);
    first.unmount();
    second.unmount();
  });

  it("Finding 9: ScoringRow ignores an unparseable points value instead of writing NaN", () => {
    // jsdom's own <input type="number"> setter is stricter than a real
    // browser's: it accepts only a complete valid number or "", resetting
    // anything else (even a syntactically-valid-so-far "1e" or "-") to ""
    // before React ever sees a change event — so the NaN this guards
    // against can't be produced by assigning `target.value` in a test.
    // Overriding the DOM property directly (the same workaround
    // render.test.tsx uses for `<input type="file">`'s `.files`) is what
    // gets an in-progress value past jsdom's own sanitizing setter, the
    // way a real browser would hand one to React mid-keystroke.
    const onChange = vi.fn();
    render(<ScoringRow type="single" value={{ points: 2 }} onChange={onChange} />);
    const input = screen.getByLabelText("Points") as HTMLInputElement;
    Object.defineProperty(input, "value", { value: "1e", configurable: true, writable: true });
    fireEvent.change(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Finding 11: true_false answers by selecting True or False", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={TRUE_FALSE_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const trueRadio = screen.getByRole("radio", { name: "True" });
    const falseRadio = screen.getByRole("radio", { name: "False" });
    expect(falseRadio).toBeChecked();
    fireEvent.click(trueRadio);
    expect(trueRadio).toBeChecked();
    expect(falseRadio).not.toBeChecked();
  });

  it("Finding 11: assertion_reason edits the assertion/reason text and the correct-answer choice", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ASSERTION_REASON_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const assertionField = screen.getByLabelText("Assertion") as HTMLTextAreaElement;
    fireEvent.change(assertionField, { target: { value: "Updated assertion text." } });
    expect(assertionField.value).toBe("Updated assertion text.");

    const chosen = screen.getByRole("radio", { name: /the assertion is true and the reason is false/i });
    const original = screen.getByRole("radio", { name: /both true, and the reason explains the assertion/i });
    expect(original).toBeChecked();
    fireEvent.click(chosen);
    expect(chosen).toBeChecked();
    expect(original).not.toBeChecked();
  });

  it("Review Focus 2: a type changed away carries no stale field (select_k -> single keeps no k)", async () => {
    // The brief's own example of the bug this guards: a merge-based save
    // would let a select_k question's `k` survive onto a `single` document
    // that has no such field. A select_k document always needs its own `k`
    // (it's required by the type, re-added fresh by `defaultExtra` on any
    // change back), so the round trip this item is really about is checked
    // the other way: `single` must come out clean, not that `select_k`
    // comes back without a field it structurally cannot do without.
    const saved = await changeType(SELECT_K_FIXTURE, "single");
    expect(saved).not.toHaveProperty("k");
    expect(saved).not.toHaveProperty("options", SELECT_K_FIXTURE.options);
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
