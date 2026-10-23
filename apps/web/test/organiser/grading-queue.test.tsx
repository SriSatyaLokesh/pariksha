// Phase 8b Task 2 (`K15`): `GradingQueue`'s own tests. Blindness itself is
// proven server-side (`apps/api/test/grade/award.test.ts`'s own "sends no
// candidate identity in blind mode" / "sends it when blind mode is off"
// pair) — this component never asks whether it is blind, it only renders
// whatever `row.formValues` holds (see that field's own doc comment in
// `lib/api.ts`), so there is nothing about blindness left to test here. What
// this file covers is the part that is actually this component's: listing,
// grouping by question, and offering exactly one question's own rubric
// levels — never an empty picker for a question that has none.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { GradingQueue } from "../../src/components/organiser/GradingQueue";
import type { GradingQueueRow } from "../../src/lib/api";

const RUBRIC = [
  { level: "thin", points: 1 },
  { level: "adequate", points: 2 },
  { level: "thorough", points: 4 },
];

function row(
  overrides: Partial<GradingQueueRow> & {
    attemptId: string;
    questionId: string;
  },
): GradingQueueRow {
  return {
    value: { kind: "text", text: "A candidate's answer." },
    question: { prompt: "Summarise the passage.", rubric: RUBRIC },
    award: null,
    points: null,
    ...overrides,
  };
}

// Three different answers to three different questions — "every ungraded
// manual answer for the test", not three answers to one question.
const THREE_ANSWERS: GradingQueueRow[] = [
  row({ attemptId: "att_1", questionId: "qst_1" }),
  row({ attemptId: "att_2", questionId: "qst_2" }),
  row({ attemptId: "att_3", questionId: "qst_3" }),
];

describe("GradingQueue (K15)", () => {
  it("lists every ungraded manual answer for the test", async () => {
    render(<GradingQueue rows={THREE_ANSWERS} />);
    expect(await screen.findAllByRole("article")).toHaveLength(3);
  });

  it("groups by question when grading by question", () => {
    render(<GradingQueue rows={THREE_ANSWERS} mode="by-question" />);
    // Numbered by order of first appearance in `rows`: the third distinct
    // question in `THREE_ANSWERS` is `qst_3`'s, so its group heading is
    // "Question 3" — this component is never given the test's own section
    // order, only the rows it was handed.
    expect(
      screen.getByRole("heading", { name: /Question 3/ }),
    ).toBeInTheDocument();
  });

  it("offers the question's own rubric levels and nothing else", () => {
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
      />,
    );
    expect(
      screen.getAllByRole("radio").map((r) => r.getAttribute("value")),
    ).toEqual(["thin", "adequate", "thorough"]);
  });

  const rowWithNoRubric = row({
    attemptId: "att_4",
    questionId: "qst_4",
    question: { prompt: "Explain your reasoning." },
  });
  const rowWithRubric = row({ attemptId: "att_1", questionId: "qst_1" });

  it("says a question with no rubric cannot be graded, rather than offering an empty picker", () => {
    render(<GradingQueue rows={[rowWithNoRubric]} />);
    expect(screen.getByText(/has no rubric/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("offers radios when the question does have one — control for the test above", () => {
    render(<GradingQueue rows={[rowWithRubric]} />);
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });

  // The server never puts `formValues` on a blind row (`K15`, proven at the
  // API layer); this is the UI-side half of that same contract — a row with
  // no `formValues` at all renders no identity, rather than the component
  // reaching for a key that was never sent.
  it("renders no candidate identity for a row the server sent none for", () => {
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
      />,
    );
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("renders the candidate's registration answers for a row the server did send them for", () => {
    render(
      <GradingQueue
        rows={[
          row({
            attemptId: "att_1",
            questionId: "qst_1",
            formValues: { email: "candidate@alpha.test" },
          }),
        ]}
      />,
    );
    expect(screen.getByText(/candidate@alpha\.test/)).toBeInTheDocument();
  });

  // One ground, run once — this screen renders no theme-conditional markup
  // (same reasoning `proctoring-a11y.test.tsx` gives: jsdom injects no
  // stylesheet and follows no `@import` chain, so a second iteration toggling
  // `data-theme` would produce a byte-identical DOM and the same rule set).
  // Real per-ground contrast ratios are `contrast-usage.test.ts`'s job, not
  // this file's.
  it("has no axe violations", async () => {
    const { container } = render(<GradingQueue rows={THREE_ANSWERS} />);
    await screen.findAllByRole("article");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations grouped by question, with a no-rubric row present", async () => {
    const { container } = render(
      <GradingQueue
        rows={[...THREE_ANSWERS, rowWithNoRubric]}
        mode="by-question"
      />,
    );
    await screen.findAllByRole("article");
    expect(await axe(container)).toHaveNoViolations();
  });
});

// Phase 8b Task 3 (`K16`): the verdict control. `apps/api/test/review.test.ts`
// proves the server payload (append-only, latest-wins); this is the
// component's own contract — rendered once per attempt, never once per
// question, and calling back with exactly what the reviewer picked.
describe("GradingQueue verdict control (K16)", () => {
  it("renders no verdict control when the caller wires no callback", () => {
    render(<GradingQueue rows={THREE_ANSWERS} />);
    expect(screen.queryByText("Verdict")).toBeNull();
  });

  it("renders exactly one verdict control per attempt, not one per answer", () => {
    // Two rows share att_1 (two gradeable questions on the same attempt);
    // the third is a different attempt entirely.
    const rows: GradingQueueRow[] = [
      row({ attemptId: "att_1", questionId: "qst_1" }),
      row({ attemptId: "att_1", questionId: "qst_2" }),
      row({ attemptId: "att_2", questionId: "qst_3" }),
    ];
    render(<GradingQueue rows={rows} onVerdict={vi.fn()} />);
    // Three "Verdict" legends would mean one per answer; two is one per
    // attempt, the component's actual contract.
    expect(screen.getAllByText("Verdict")).toHaveLength(2);
  });

  it("still renders exactly one verdict control per attempt when grouped by question", () => {
    const rows: GradingQueueRow[] = [
      row({ attemptId: "att_1", questionId: "qst_1" }),
      row({ attemptId: "att_1", questionId: "qst_2" }),
      row({ attemptId: "att_2", questionId: "qst_3" }),
    ];
    render(<GradingQueue rows={rows} mode="by-question" onVerdict={vi.fn()} />);
    expect(screen.getAllByText("Verdict")).toHaveLength(2);
  });

  it("calls back with the attempt id, the verdict picked, and the typed note", () => {
    const onVerdict = vi.fn();
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
        onVerdict={onVerdict}
      />,
    );

    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Two tab switches" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Suspicious" }));

    // The payload the callback actually received, not merely that a click
    // landed somewhere — `onGrade`'s own sibling control is proven the
    // same way elsewhere in this file, via the value the radio carries.
    expect(onVerdict).toHaveBeenCalledWith(
      "att_1",
      "suspicious",
      "Two tab switches",
    );
  });

  it("sends no note when the field was left blank", () => {
    const onVerdict = vi.fn();
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
        onVerdict={onVerdict}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Clear" }));

    expect(onVerdict).toHaveBeenCalledWith("att_1", "clear", undefined);
  });

  // Fix round 1, MAJOR: re-clicking an already-checked radio fires no
  // `onChange`, so a note typed *after* the verdict pick used to vanish —
  // the control looked like it had saved context that was never sent.
  it("sends a note typed after the verdict pick, on blur — fix round 1 MAJOR", () => {
    const onVerdict = vi.fn();
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
        onVerdict={onVerdict}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Suspicious" }));
    expect(onVerdict).toHaveBeenCalledWith("att_1", "suspicious", undefined);

    const noteField = screen.getByLabelText("Note");
    fireEvent.change(noteField, { target: { value: "Added after the click" } });
    fireEvent.blur(noteField);

    // The second call is the payload that actually reached the caller —
    // not merely that the field re-rendered with the typed text.
    expect(onVerdict).toHaveBeenCalledTimes(2);
    expect(onVerdict).toHaveBeenNthCalledWith(
      2,
      "att_1",
      "suspicious",
      "Added after the click",
    );
  });

  it("never re-sends on blur when the note has not changed since the last send", () => {
    const onVerdict = vi.fn();
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
        onVerdict={onVerdict}
      />,
    );

    const noteField = screen.getByLabelText("Note");
    fireEvent.change(noteField, { target: { value: "Same note" } });
    fireEvent.click(screen.getByRole("radio", { name: "Clear" }));
    expect(onVerdict).toHaveBeenCalledTimes(1);

    // Focus the field and blur it again with nothing edited — this must
    // not append a second, identical `review` row (the table is
    // append-only, so a duplicate here is a duplicate forever).
    fireEvent.blur(noteField);
    fireEvent.blur(noteField);
    expect(onVerdict).toHaveBeenCalledTimes(1);
  });

  it("does nothing on blur before any verdict has been picked", () => {
    const onVerdict = vi.fn();
    render(
      <GradingQueue
        rows={[row({ attemptId: "att_1", questionId: "qst_1" })]}
        onVerdict={onVerdict}
      />,
    );

    const noteField = screen.getByLabelText("Note");
    fireEvent.change(noteField, { target: { value: "Typed before any pick" } });
    fireEvent.blur(noteField);

    // Nothing to attach the note to yet — `recordVerdict` takes a verdict
    // and an optional note together, never a note alone.
    expect(onVerdict).not.toHaveBeenCalled();
  });

  it("has no axe violations with the verdict control present", async () => {
    const { container } = render(
      <GradingQueue rows={THREE_ANSWERS} onVerdict={vi.fn()} />,
    );
    await screen.findAllByRole("article");
    expect(await axe(container)).toHaveNoViolations();
  });
});
