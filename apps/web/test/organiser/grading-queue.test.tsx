// Phase 8b Task 2 (`K15`): `GradingQueue`'s own tests. Blindness itself is
// proven server-side (`apps/api/test/grade/award.test.ts`'s own "sends no
// candidate identity in blind mode" / "sends it when blind mode is off"
// pair) — this component never asks whether it is blind, it only renders
// whatever `row.formValues` holds (see that field's own doc comment in
// `lib/api.ts`), so there is nothing about blindness left to test here. What
// this file covers is the part that is actually this component's: listing,
// grouping by question, and offering exactly one question's own rubric
// levels — never an empty picker for a question that has none.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { GradingQueue } from "../../src/components/organiser/GradingQueue";
import type { GradingQueueRow } from "../../src/lib/api";

const RUBRIC = [
  { level: "thin", points: 1 },
  { level: "adequate", points: 2 },
  { level: "thorough", points: 4 },
];

function row(
  overrides: Partial<GradingQueueRow> & { attemptId: string; questionId: string },
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
    expect(screen.getByRole("heading", { name: /Question 3/ })).toBeInTheDocument();
  });

  it("offers the question's own rubric levels and nothing else", () => {
    render(<GradingQueue rows={[row({ attemptId: "att_1", questionId: "qst_1" })]} />);
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual([
      "thin",
      "adequate",
      "thorough",
    ]);
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
    render(<GradingQueue rows={[row({ attemptId: "att_1", questionId: "qst_1" })]} />);
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
    const { container } = render(<GradingQueue rows={[...THREE_ANSWERS, rowWithNoRubric]} mode="by-question" />);
    await screen.findAllByRole("article");
    expect(await axe(container)).toHaveNoViolations();
  });
});
