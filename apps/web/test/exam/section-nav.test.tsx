import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionNav } from "../../src/components/exam/SectionNav";
import type { PaperSection } from "../../src/lib/paper";

const sampleSections: PaperSection[] = [
  {
    id: "sec_1",
    title: "General Knowledge",
    instructions: "Answer all 5 questions. No negative marking.",
    timeLimitMinutes: null,
    questions: [
      { id: "q1", type: "single", prompt: "Capital of India?", points: 1 },
    ],
  },
  {
    id: "sec_2",
    title: "Mathematics",
    instructions: "Calculators permitted.",
    timeLimitMinutes: 15,
    questions: [
      { id: "q2", type: "numeric", prompt: "2 + 2 = ?", points: 2 },
    ],
  },
];

describe("SectionNav Component", () => {
  it("renders the active section title and question count", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    expect(screen.getByText("General Knowledge")).toBeInTheDocument();
    expect(screen.getByText(/1 question/i)).toBeInTheDocument();
  });

  it("permits switching sections in free navigation mode", () => {
    const onSelect = vi.fn();
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={onSelect}
      />,
    );
    const mathTab = screen.getByRole("tab", { name: /Mathematics/i });
    fireEvent.click(mathTab);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("disables future section switching in per_section mode", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="per_section"
        onSelectSection={vi.fn()}
      />,
    );
    const mathTab = screen.getByRole("tab", { name: /Mathematics/i });
    expect(mathTab).toBeDisabled();
  });

  it("locks past sections in per_section mode", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={1}
        navigation="per_section"
        onSelectSection={vi.fn()}
      />,
    );
    const gkTab = screen.getByRole("tab", { name: /General Knowledge/i });
    expect(gkTab).toBeDisabled();
  });

  it("disables section switching in linear navigation mode", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="linear"
        onSelectSection={vi.fn()}
      />,
    );
    const mathTab = screen.getByRole("tab", { name: /Mathematics/i });
    expect(mathTab).toBeDisabled();
  });

  it("toggles section instructions modal/drawer when instructions exist", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    const infoButton = screen.getByRole("button", { name: /section instructions/i });
    fireEvent.click(infoButton);
    expect(screen.getByText(/Answer all 5 questions/i)).toBeInTheDocument();

    // Drawer should have a close button to dismiss
    const closeButton = screen.getByRole("button", { name: /close instructions/i });
    fireEvent.click(closeButton);
    expect(screen.queryByText(/Answer all 5 questions/i)).not.toBeInTheDocument();
  });

  it("hides section instructions button when instructions is null", () => {
    const sectionsWithoutInstructions: PaperSection[] = [
      {
        id: "sec_none",
        title: "Section No Instructions",
        instructions: null,
        timeLimitMinutes: null,
        questions: [{ id: "q1", type: "single", prompt: "Q?", points: 1 }],
      },
    ];

    render(
      <SectionNav
        sections={sectionsWithoutInstructions}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /section instructions/i })).not.toBeInTheDocument();
  });

  it("displays section time limit when timeLimitMinutes is configured", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={1}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    expect(screen.getByText(/15 min/i)).toBeInTheDocument();
  });

  it("provides accessible tablist semantics", () => {
    render(
      <SectionNav
        sections={sampleSections}
        activeSectionIndex={0}
        navigation="free"
        onSelectSection={vi.fn()}
      />,
    );
    const tablist = screen.getByRole("tablist", { name: /exam sections/i });
    expect(tablist).toBeInTheDocument();

    const gkTab = screen.getByRole("tab", { name: /General Knowledge/i });
    const mathTab = screen.getByRole("tab", { name: /Mathematics/i });

    expect(gkTab).toHaveAttribute("aria-selected", "true");
    expect(mathTab).toHaveAttribute("aria-selected", "false");
  });
});
