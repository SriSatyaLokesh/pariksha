import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type {
  MatchingQuestion,
  MultiMatchingQuestion,
  OrderingQuestion,
  Question,
} from "@pariksha/core";
import { APPLICABLE_MODES, validateBank } from "@pariksha/core";

import type { ApiClient } from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { QuestionEditor } from "../../src/components/authoring/QuestionEditor";

const noop = () => undefined;

// No @testing-library/user-event in this workspace (see reorder.test.tsx) —
// fireEvent on the real controls is the house pattern every other authoring
// test file uses.
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

function optionValues(label: string): string[] {
  const select = screen.getByLabelText(label) as HTMLSelectElement;
  return Array.from(select.options)
    .map((option) => option.value)
    .filter((value) => value !== "");
}

/** Renders the editor, performs `interact`, saves, and returns the document
 * the editor actually emitted — the only way to prove the UI's state
 * updates land in what gets saved, not just what's on screen. */
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

const ORDERING_FIXTURE: OrderingQuestion = {
  id: "QO1",
  type: "ordering",
  prompt: "Put the steps in order.",
  items: ["Mix", "Bake", "Cool"],
};

const MATCHING_FIXTURE: MatchingQuestion = {
  id: "QM1",
  type: "matching",
  prompt: "Match the join type to its description.",
  left: ["INNER JOIN", "LEFT JOIN"],
  right: ["Only matching rows", "All left rows plus matches"],
  key: {},
};

const MATCHING_WITH_KEY_FIXTURE: MatchingQuestion = {
  id: "QM2",
  type: "matching",
  prompt: "p",
  left: ["A"],
  right: ["X", "Y"],
  key: { A: "X" },
};

const MULTI_MATCHING_FIXTURE: MultiMatchingQuestion = {
  id: "QMM1",
  type: "multi_matching",
  prompt: "Match each letter to every number it pairs with.",
  left: ["A", "B"],
  right: ["X", "Y"],
  key: {},
};

const EMPTY_MATCHING_FIXTURE: MatchingQuestion = {
  id: "QM3",
  type: "matching",
  prompt: "p",
  left: [],
  right: [],
  key: {},
};

describe("StructuredAnswer (UX-07/UX-08)", () => {
  it("UX-08: the ordering editor states that candidates see a shuffled list", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ORDERING_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByText(/candidates see these shuffled/i)).toBeVisible();
  });

  it("UX-08: the written order is the key — there is no separate key control", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ORDERING_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.queryByLabelText(/correct order/i)).toBeNull();
    expect(screen.getByRole("group", { name: /items/i })).toBeVisible();
  });

  it("ordering offers all_or_nothing and position, and not partial", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ORDERING_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(optionValues("Scoring mode")).toEqual([...APPLICABLE_MODES.ordering]);
    expect(optionValues("Scoring mode")).toContain("position");
    expect(optionValues("Scoring mode")).not.toContain("partial");
  });

  it("matching: the key grid is single-select per left item and a used right item cannot be used twice", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={MATCHING_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /INNER JOIN matches Only matching rows/i }));
    expect(screen.getByRole("radio", { name: /LEFT JOIN matches Only matching rows/i })).toBeDisabled();
    // The left item's own radio for a different right item stays enabled —
    // the exclusivity is about the right item being reused, not the row.
    expect(screen.getByRole("radio", { name: /INNER JOIN matches All left rows plus matches/i })).not.toBeDisabled();
  });

  it("AC-07: multi_matching accepts several right items per left item", async () => {
    const saved = await renderAndSave(MULTI_MATCHING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /A matches X/i }));
      fireEvent.click(screen.getByRole("checkbox", { name: /A matches Y/i }));
    });
    expect((saved as MultiMatchingQuestion).key).toEqual({ A: ["X", "Y"] });
  });

  it("deleting a right item clears every key entry that named it", async () => {
    const saved = await renderAndSave(MATCHING_WITH_KEY_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /remove right item X/i }));
    });
    expect(JSON.stringify((saved as MatchingQuestion).key)).not.toContain("X");
  });

  it("a key built in the editor passes validateBank", async () => {
    const saved = await renderAndSave(MULTI_MATCHING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /A matches X/i }));
    });
    expect(validateBank({ format: "pariksha/bank@1", name: "t", questions: [saved] }).ok).toBe(true);
  });

  it("the three structured editors have no axe violations", async () => {
    for (const fixture of [ORDERING_FIXTURE, MATCHING_FIXTURE, MULTI_MATCHING_FIXTURE]) {
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

  // Round 1, finding 1 + 2: renaming an item used to change its
  // ReorderableList identity (the text itself was the key), so committing a
  // rename unmounted the row — dropping focus and swallowing the key
  // rewrite's own correctness check along with it. One test covers both:
  // focus must stay on the very same field, and the rename must still carry
  // the key along with it.
  it("renaming an item commits on Enter, keeps focus on the same field, and the saved key follows the new name", async () => {
    const saved = await renderAndSave(MATCHING_WITH_KEY_FIXTURE, () => {
      const field = screen.getByRole("textbox", { name: /left item 1 text/i });
      field.focus();
      fireEvent.change(field, { target: { value: "Z" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(document.activeElement).toBe(field);
    });
    expect((saved as MatchingQuestion).key).toEqual({ Z: "X" });
  });

  // Round 1, finding 3: the UX-08 note must be the list's accessible
  // description, not merely text that happens to sit after it in the DOM.
  it("UX-08: the shuffled-candidates note is the items list's accessible description", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={ORDERING_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    const group = screen.getByRole("group", { name: /items/i });
    const note = screen.getByText(/candidates see these shuffled/i);
    expect(group).toHaveAccessibleDescription(note.textContent ?? "");
  });

  // Round 1, finding 4: a radio grid can't be unchecked by clicking it
  // again, so without a "no match" option a mis-click is permanent.
  it("matching: a 'No match' option lets the author undo a mis-click", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={MATCHING_WITH_KEY_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByRole("radio", { name: /A matches X/i })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /no match for A/i }));
    expect(screen.getByRole("radio", { name: /A matches X/i })).not.toBeChecked();
  });

  // Round 1, finding 5: `reordered()` and each type's own `onReorder` wiring
  // had no coverage — a `moveLeft` that spliced the wrong array, or an
  // off-by-one, would have passed every other test in this file.
  it("moving a left item down in matching reorders only the left column", async () => {
    const saved = await renderAndSave(MATCHING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /move INNER JOIN down/i }));
    });
    expect((saved as MatchingQuestion).left).toEqual(["LEFT JOIN", "INNER JOIN"]);
    expect((saved as MatchingQuestion).right).toEqual(MATCHING_FIXTURE.right);
  });

  it("moving a right item down in matching reorders only the right column", async () => {
    const saved = await renderAndSave(MATCHING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /move Only matching rows down/i }));
    });
    expect((saved as MatchingQuestion).right).toEqual(["All left rows plus matches", "Only matching rows"]);
    expect((saved as MatchingQuestion).left).toEqual(MATCHING_FIXTURE.left);
  });

  it("moving a left item down in multi_matching reorders only the left column", async () => {
    const saved = await renderAndSave(MULTI_MATCHING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /move A down/i }));
    });
    expect((saved as MultiMatchingQuestion).left).toEqual(["B", "A"]);
    expect((saved as MultiMatchingQuestion).right).toEqual(MULTI_MATCHING_FIXTURE.right);
  });

  it("moving a right item down in multi_matching reorders only the right column", async () => {
    const saved = await renderAndSave(MULTI_MATCHING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /move X down/i }));
    });
    expect((saved as MultiMatchingQuestion).right).toEqual(["Y", "X"]);
    expect((saved as MultiMatchingQuestion).left).toEqual(MULTI_MATCHING_FIXTURE.left);
  });

  it("moving an ordering item down changes the saved order", async () => {
    const saved = await renderAndSave(ORDERING_FIXTURE, () => {
      fireEvent.click(screen.getByRole("button", { name: /move Mix down/i }));
    });
    expect((saved as OrderingQuestion).items).toEqual(["Bake", "Mix", "Cool"]);
  });

  // Round 1, finding 7: the empty-columns prompt is the first thing an
  // author sees after switching a question to `matching`, and until now the
  // only coverage of it was the axe test passing vacuously over it.
  it("matching shows a prompt instead of an empty grid until both columns have an item", () => {
    render(
      <QuestionEditor
        bankId="bnk_1"
        workspaceId="wsp_1"
        initial={EMPTY_MATCHING_FIXTURE}
        client={fakeClient()}
        onSaved={noop}
      />,
    );
    expect(screen.getByText(/add at least one left item and one right item/i)).toBeVisible();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
