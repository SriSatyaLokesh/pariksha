import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ResponseValue } from "@pariksha/core";
import { AnswerInput } from "../../src/components/exam/answer";
import type { CandidateQuestion } from "../../src/lib/paper";
import { jumpTo, startFromRoot } from "./answer-fixtures";
import { paintsIn, resolvedChain } from "../css-chain";

const EXAM = resolvedChain("exam.html");

// Task 7 (#71, P6.7), the structured family: matching, multi_matching and
// ordering. The third closes AC-07's drag half, deferred by Phase 4 — see
// test/authoring/reorder.test.tsx for the control's own coverage; here it
// is proven through the candidate's ordering input, which is what AC-07
// actually names.

const matching: CandidateQuestion = {
  id: "q1",
  type: "matching",
  prompt: "Match each join to what it returns.",
  points: 2,
  left: ["INNER JOIN", "LEFT JOIN"],
  right: ["Only matching rows", "All left rows"],
};

const multiMatching: CandidateQuestion = {
  id: "q2",
  type: "multi_matching",
  prompt: "Match every pair that holds.",
  points: 2,
  left: ["A", "B"],
  right: ["X", "Y"],
};

/** The server shuffles `items` before pinning them (UX-08), so the order
 * here is deliberately not alphabetical: it is what the candidate was
 * dealt, and the component must not re-sort it. */
const pinnedShuffledOrder = ["C", "A", "B"];

const ordering: CandidateQuestion = {
  id: "q3",
  type: "ordering",
  prompt: "Put these in order.",
  points: 3,
  items: pinnedShuffledOrder,
};

function Harness({
  question,
  onChange,
  disabled = false,
}: {
  question: CandidateQuestion;
  onChange?: (next: ResponseValue | null) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<ResponseValue | null>(null);
  return (
    <AnswerInput
      question={question}
      value={value}
      disabled={disabled}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function activate(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

function itemTexts(): string[] {
  return [...document.querySelectorAll(".reorderable-list__content")].map((el) => el.textContent ?? "");
}

function rowFor(item: string): HTMLElement {
  const content = [...document.querySelectorAll<HTMLElement>(".reorderable-list__content")].find(
    (el) => el.textContent === item,
  );
  const row = content?.closest<HTMLElement>(".reorderable-list__item");
  if (!row) throw new Error(`no ordering row for ${item}`);
  return row;
}

/* G4-03/C2: `draggable` and `dragstart` live on the grip alone now, not the
 * row — this is the candidate ground `ReorderableList` also renders onto,
 * and `test/authoring/reorder.test.tsx`'s own `gripFor` does the same
 * lookup for the organiser side of the same component. `dragover`/`drop`
 * stay on the row, which is still the drop target, so only dragStart below
 * needs this. */
function gripFor(item: string): HTMLElement {
  const grip = rowFor(item).querySelector<HTMLElement>(".reorderable-list__grip");
  if (!grip) throw new Error(`no grip for ${item}`);
  return grip;
}

describe("matching", () => {
  it("matching: each left item takes one right item, and a used right item cannot be reused", () => {
    render(<Harness question={matching} />);
    fireEvent.change(screen.getByLabelText(/INNER JOIN/), { target: { value: "Only matching rows" } });
    expect(
      within(screen.getByLabelText(/LEFT JOIN/)).getByRole("option", { name: "Only matching rows" }),
    ).toBeDisabled();
    // The one that took it is still selectable on its own row, or the
    // choice could not be changed.
    expect(
      within(screen.getByLabelText(/INNER JOIN/)).getByRole("option", { name: "Only matching rows" }),
    ).toBeEnabled();
  });

  it("matching answers with a map of left text to right text", () => {
    const spy = vi.fn();
    render(<Harness question={matching} onChange={spy} />);
    fireEvent.change(screen.getByLabelText(/INNER JOIN/), { target: { value: "Only matching rows" } });
    expect(spy).toHaveBeenLastCalledWith({ kind: "map", pairs: { "INNER JOIN": "Only matching rows" } });
  });

  it("choosing the empty option clears that row, and clearing the last row answers null", () => {
    const spy = vi.fn();
    render(<Harness question={matching} onChange={spy} />);
    const select = screen.getByLabelText(/INNER JOIN/);
    fireEvent.change(select, { target: { value: "Only matching rows" } });
    fireEvent.change(select, { target: { value: "" } });
    expect(spy).toHaveBeenLastCalledWith(null);
  });
});

describe("multi_matching", () => {
  it("multi_matching accepts several right items per left item", () => {
    const spy = vi.fn();
    render(<Harness question={multiMatching} onChange={spy} />);
    activate(screen.getByRole("checkbox", { name: "A matches X" }));
    activate(screen.getByRole("checkbox", { name: "A matches Y" }));
    expect(spy).toHaveBeenLastCalledWith({ kind: "multimap", pairs: { A: ["X", "Y"] } });
  });

  it("unchecking a left item's last pair drops that left item, not just its value", () => {
    const spy = vi.fn();
    render(<Harness question={multiMatching} onChange={spy} />);
    activate(screen.getByRole("checkbox", { name: "A matches X" }));
    activate(screen.getByRole("checkbox", { name: "B matches Y" }));
    activate(screen.getByRole("checkbox", { name: "A matches X" }));
    expect(spy).toHaveBeenLastCalledWith({ kind: "multimap", pairs: { B: ["Y"] } });
  });

  it("nothing is ever locked here — a right item may serve several left items", () => {
    render(<Harness question={multiMatching} />);
    activate(screen.getByRole("checkbox", { name: "A matches X" }));
    expect(screen.getByRole("checkbox", { name: "B matches X" })).toBeEnabled();
  });
});

describe("ordering (UX-08, AC-07)", () => {
  it("UX-08: ordering shows the shuffled order, and the candidate's order is the answer", () => {
    const spy = vi.fn();
    render(<Harness question={ordering} onChange={spy} />);
    expect(itemTexts()).toEqual(pinnedShuffledOrder);
    activate(screen.getByRole("button", { name: /move item C down/i }));
    expect(spy).toHaveBeenLastCalledWith({ kind: "order", items: ["A", "C", "B"] });
  });

  it("AC-07 (Phase 4 deferral): ordering reorders by keyboard AND by pointer drag", () => {
    render(<Harness question={ordering} />);
    const down = screen.getByRole("button", { name: /move item A down/i });
    down.focus();
    // A focused native button's Enter is a click; Phase 4's focus rule is
    // that focus follows the item to its new position.
    fireEvent.click(down);
    expect(itemTexts()[2]).toBe("A");
    // Phase 4's focus rule holds: focus stays on the moved item's own
    // controls. This particular move lands A last, which disables the
    // down button it was pressed on, so it is the up button on the same
    // row that takes focus — see reorder.test.tsx, where that fallback
    // is pinned exactly.
    expect(document.activeElement).toHaveAccessibleName(/move item A/i);
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.dragStart(gripFor("A"));
    fireEvent.dragOver(rowFor("C"));
    fireEvent.drop(rowFor("C"));
    expect(itemTexts()[0]).toBe("A");
  });

  it("a drag that never started moves nothing (a stray drop is not a reorder)", () => {
    const spy = vi.fn();
    render(<Harness question={ordering} onChange={spy} />);
    fireEvent.drop(rowFor("A"));
    expect(itemTexts()).toEqual(pinnedShuffledOrder);
    expect(spy).not.toHaveBeenCalled();
  });

  it("dragOver must be prevented, or the browser never fires a drop at all", () => {
    render(<Harness question={ordering} />);
    fireEvent.dragStart(gripFor("C"));
    // fireEvent returns false when a handler called preventDefault.
    expect(fireEvent.dragOver(rowFor("B"))).toBe(false);
  });

  it("dropping an item on itself is not a move, and does not announce one", () => {
    const spy = vi.fn();
    render(<Harness question={ordering} onChange={spy} />);
    fireEvent.dragStart(gripFor("C"));
    fireEvent.dragOver(rowFor("C"));
    fireEvent.drop(rowFor("C"));
    expect(itemTexts()).toEqual(pinnedShuffledOrder);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a drag announces its move in the same live region the buttons use", () => {
    render(<Harness question={ordering} />);
    fireEvent.dragStart(gripFor("C"));
    fireEvent.dragOver(rowFor("B"));
    fireEvent.drop(rowFor("B"));
    expect(screen.getByRole("status")).toHaveTextContent("item C moved to position 3 of 3");
  });

  it("drag is an enhancement: with no pointer events at all, every reorder is still reachable", async () => {
    const { container } = render(<Harness question={ordering} />);
    expect(screen.getAllByRole("button", { name: /move .*(up|down)/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("spinbutton", { name: /position of/i }).length).toBe(3);
    expect(await axe(container)).toHaveNoViolations();
  });

  // C2: the grip's CSS used to live in authoring.css, which only admin.css
  // imports — unreachable from exam.html's own chain, so on the candidate
  // ground this rendered as an unstyled, zero-size <span>. It moved to
  // question.css, which both chains import. This reads the EXAM chain
  // specifically (not the organiser's, which test/authoring/reorder.test.tsx
  // already covers) against the grip this harness actually rendered, so a
  // rule that exists on disk but never reaches this ground still reddens it.
  it("C2: the grip is styled on the exam ground, not just the organiser's", () => {
    render(<Harness question={ordering} />);
    const grip = gripFor("A");
    expect(paintsIn(grip, "width", EXAM)).toBe("44px");
    expect(paintsIn(grip, "height", EXAM)).toBe("44px");
    // The bars are what make a 44px hit area visible at all (a 44px
    // invisible grip is the hover-gate this phase exists to remove, in a
    // different shape) — painted via a pseudo-element `paintsIn` cannot
    // address directly, so this confirms the base rule reaches the real
    // element and leaves the ::before body itself to the probe below.
    expect(paintsIn(grip, "display", EXAM)).toBe("inline-flex");
  });
});

// Fix round 1, C1. The read-only sweep used to name
// `input,select,button,textarea` and conclude "fully disabled" — true of
// every selector it looked at and false of the one control this task
// added, because a `draggable` <li> is not a form control and
// `<fieldset disabled>` never reaches it. A submitted attempt was
// reorderable by mouse. This names every interactive affordance instead.
const AFFORDANCES =
  "input,select,textarea,button,a[href],[draggable='true'],[contenteditable='true'],[tabindex]:not([tabindex='-1'])";

describe("S-10, read-only and axe", () => {
  it.each([matching, multiMatching, ordering])("$type leaks no key into the DOM", (question) => {
    const { container } = render(<Harness question={question} />);
    expect(container.innerHTML).not.toMatch(/correct|is-key|data-answer/i);
    expect(container.innerHTML).toMatch(/exam-answer/);
  });

  it.each([matching, multiMatching, ordering])("$type has no axe violations", async (question) => {
    const { container } = render(<Harness question={question} />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each([matching, multiMatching, ordering])("$type is fully disabled when read-only", (question) => {
    const { container } = render(<Harness question={question} disabled />);
    for (const control of container.querySelectorAll<HTMLElement>(AFFORDANCES)) {
      // `toBeDisabled` is false for anything that is not a form control,
      // so a surviving draggable row fails here instead of being
      // silently skipped the way the old four-selector sweep skipped it.
      expect(control, control.outerHTML.slice(0, 80)).toBeDisabled();
    }
    expect(container.querySelectorAll("[draggable='true']")).toHaveLength(0);
  });

  // The positive control: without it the sweep above would hold for a
  // component that rendered no affordance in EITHER state.
  it.each([matching, multiMatching, ordering])(
    "$type has affordances to disable in the first place",
    (question) => {
      const { container } = render(<Harness question={question} />);
      expect(container.querySelectorAll(AFFORDANCES).length).toBeGreaterThan(0);
    },
  );

  it("a read-only ordering answer cannot be dragged, and still shows the order", () => {
    const spy = vi.fn();
    const { container } = render(<Harness question={ordering} onChange={spy} disabled />);
    expect(container.querySelectorAll("[draggable]")).toHaveLength(0);
    expect(container.querySelectorAll(".reorderable-list__item")).toHaveLength(0);
    expect(
      [...container.querySelectorAll(".exam-ordering-list li")].map((el) => el.textContent),
    ).toEqual(pinnedShuffledOrder);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a read-only ordering answer has no axe violations either", async () => {
    const { container } = render(<Harness question={ordering} disabled />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("no axe violations at 200% zoom", async () => {
    const { container } = render(<Harness question={ordering} />);
    document.documentElement.style.fontSize = "32px";
    expect(await axe(container)).toHaveNoViolations();
    document.documentElement.style.fontSize = "";
  });
});

describe("reachability: the candidate app's own root, clicked to", () => {
  it("the matching question is reachable from the palette and answerable there", async () => {
    await startFromRoot();
    jumpTo(6);
    fireEvent.change(await screen.findByLabelText(/INNER JOIN/), {
      target: { value: "Only matching rows" },
    });
    expect(screen.getByRole("button", { name: /^question 6 /i })).toHaveClass("is-filled");
  });

  it("the ordering question is reachable, and a move there fills its square", async () => {
    await startFromRoot();
    jumpTo(8);
    activate(await screen.findByRole("button", { name: /move item C down/i }));
    expect(screen.getByRole("button", { name: /^question 8 /i })).toHaveClass("is-filled");
  });
});
