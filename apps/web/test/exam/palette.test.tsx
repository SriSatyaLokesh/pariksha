import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import { Palette, type PaletteSectionGroup, type PaletteQuestion } from "../../src/components/exam/Palette";

const sampleGroupedSections: PaletteSectionGroup[] = [
  {
    id: "sec_1",
    title: "Section 1: Quantitative",
    questions: [
      { id: "q1", number: 1, state: "answered" },
      { id: "q2", number: 2, state: "unanswered", current: true },
    ],
  },
  {
    id: "sec_2",
    title: "Section 2: Verbal",
    questions: [
      { id: "q3", number: 3, state: "unanswered" },
      { id: "q4", number: 4, state: "marked" },
    ],
  },
];

const flatQuestions: PaletteQuestion[] = [
  { id: "q1", number: 1, state: "answered" },
  { id: "q2", number: 2, state: "unanswered", current: true },
  { id: "q3", number: 3, state: "unanswered" },
];

describe("Palette Component", () => {
  it("renders question squares grouped under section headings", () => {
    render(<Palette sections={sampleGroupedSections} onJump={vi.fn()} />);

    expect(screen.getByText("Section 1: Quantitative")).toBeInTheDocument();
    expect(screen.getByText("Section 2: Verbal")).toBeInTheDocument();
    expect(screen.getByText(/1\/2 answered/i)).toBeInTheDocument();
    expect(screen.getByText(/0\/2 answered/i)).toBeInTheDocument();

    const quantGroup = screen.getByRole("group", { name: "Section 1: Quantitative" });
    const verbalGroup = screen.getByRole("group", { name: "Section 2: Verbal" });
    expect(quantGroup).toBeInTheDocument();
    expect(verbalGroup).toBeInTheDocument();
  });

  it("supports backward compatibility when flat questions array is passed", () => {
    render(<Palette questions={flatQuestions} onJump={vi.fn()} />);

    expect(screen.getByRole("navigation", { name: /question palette/i })).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /question 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /question 2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /question 3/i })).toBeInTheDocument();
  });

  it("calls onJump with the clicked question id in grouped sections", () => {
    const onJump = vi.fn();
    render(<Palette sections={sampleGroupedSections} onJump={onJump} />);

    const q3Button = screen.getByRole("button", { name: /question 3/i });
    fireEvent.click(q3Button);
    expect(onJump).toHaveBeenCalledWith("q3");
  });

  it("prevents jumping to locked questions inside grouped sections", () => {
    const onJump = vi.fn();
    const sectionsWithLocked: PaletteSectionGroup[] = [
      {
        id: "sec_1",
        title: "Section 1: Logic",
        questions: [{ id: "q1", number: 1, state: "answered", locked: true }],
      },
    ];

    render(
      <Palette
        sections={sectionsWithLocked}
        onJump={onJump}
        lockedReason="Section is locked."
      />,
    );

    const q1Button = screen.getByRole("button", { name: /question 1/i });
    expect(q1Button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(q1Button);
    expect(onJump).not.toHaveBeenCalled();
    expect(screen.getByText("Section is locked.")).toBeInTheDocument();
  });

  it("navigates seamlessly across section boundaries via keyboard arrows", () => {
    render(<Palette sections={sampleGroupedSections} onJump={vi.fn()} />);

    const q2Button = screen.getByRole("button", { name: /question 2/i });
    q2Button.focus();

    fireEvent.keyDown(q2Button, { key: "ArrowRight" });
    const q3Button = screen.getByRole("button", { name: /question 3/i });
    expect(document.activeElement).toBe(q3Button);

    fireEvent.keyDown(q3Button, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(q2Button);
  });

  it("has no axe violations when rendering grouped sections", async () => {
    const { container } = render(<Palette sections={sampleGroupedSections} onJump={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
