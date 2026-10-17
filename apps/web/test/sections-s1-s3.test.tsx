import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { Hero } from "../src/sections/s1-s3/Hero";
import { WhatIsPariksha } from "../src/sections/s1-s3/WhatIsPariksha";
import { HowItWorks } from "../src/sections/s1-s3/HowItWorks";

// design contract §3: verbatim headings this assignment owns.
const S2_HEADING = "What is Pariksha?";
const S3_HEADING = "How does running an exam on Pariksha actually work?";
const H1_TEXT = "Pariksha — run real exams you host yourself.";

/** T23's mechanical proxy: word count of a paragraph's text content. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** First sentence up to the first ., ? or !. */
function firstSentence(text: string): string {
  const match = /^[^.?!]*[.?!]/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

/**
 * T23's "the first following <p>" — the first <p> that comes after the
 * section's h2 in document order. SectionHeading's own eyebrow is also a
 * <p> and precedes the h2, so a bare querySelector("p") would find that
 * instead on a "band"-scale section.
 */
function firstParagraphAfterHeading(container: HTMLElement): Element {
  const heading = container.querySelector("h1, h2");
  const paragraphs = [...container.querySelectorAll("p")];
  const match = paragraphs.find(
    (p) =>
      heading !== null &&
      (heading.compareDocumentPosition(p) &
        Node.DOCUMENT_POSITION_FOLLOWING) !==
        0,
  );
  if (!match) throw new Error("no <p> found after the heading");
  return match;
}

// Hero.tsx itself is owned by the interactive-demo assignment, not this
// one (v3-interactive.md §3). These tests are kept only because this shared
// test file is this assignment's to maintain; updated to the real v3
// contract (demo in the hero, CTA moved to the closing band — §3.1) so the
// file does not carry assertions against the deleted static mock.
describe("S1 — Hero", () => {
  it("renders exactly one h1 with the verbatim, budgeted headline (T19)", () => {
    render(<Hero />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(H1_TEXT);
    expect(H1_TEXT.length).toBeLessThanOrEqual(45);
  });

  it("carries the pre-alpha / Apache-2.0 chip", () => {
    render(<Hero />);
    expect(screen.getByText(/PRE-ALPHA/)).toHaveTextContent(
      "PRE-ALPHA · APACHE-2.0",
    );
  });

  // §3.1: the primary CTA leaves the hero for the closing band — above the
  // fold there is no filled button, only the demo's own Finish control and
  // two secondary text links.
  it("carries no primary CTA; the two secondary text links point where documented", () => {
    const { container } = render(<Hero />);
    expect(container.querySelector(".button-primary")).toBeNull();
    const links = within(container).getAllByRole("link", {
      name: /Read the code on GitHub|What is built today/,
    });
    expect(links).toHaveLength(2);
    expect(
      within(container).getByRole("link", { name: "Read the code on GitHub" }),
    ).toHaveAttribute("href", "https://github.com/SriSatyaLokesh/pariksha");
    expect(
      within(container).getByRole("link", { name: "What is built today" }),
    ).toHaveAttribute("href", "#status");
  });

  // §3.2/§2.8: the demo is prerendered as real HTML — one visible question,
  // two more present but hidden — with the no-JavaScript sentence and its
  // fallback link, never a score or verdict in the markup D5 forbids.
  it("prerenders the demo with one visible question, two hidden, and the no-JS sentence", () => {
    const { container } = render(<Hero />);
    const demo = container.querySelector("[data-demo]");
    expect(demo).not.toBeNull();
    const questions = container.querySelectorAll("[data-demo-q]");
    expect(questions).toHaveLength(3);
    expect(questions[0]).not.toHaveAttribute("hidden");
    expect(questions[1]).toHaveAttribute("hidden");
    expect(questions[2]).toHaveAttribute("hidden");
    expect(
      screen.getByText("Scoring, and questions 2 and 3, need JavaScript."),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-demo-result]")).toHaveAttribute(
      "hidden",
    );
    expect(container.textContent).not.toMatch(/You scored/);
  });

  // §3.8: the bridge band carries CB-1a and the key-never-reaches-the-
  // browser honesty prose, prerendered and always visible.
  it("carries the bridge band's CB-1a excerpt and honesty prose", () => {
    const { container } = render(<Hero />);
    expect(
      screen.getByText("The three questions above are this file."),
    ).toBeInTheDocument();
    expect(container.textContent).toMatch(/LOG-001/);
    expect(container.textContent).toMatch(/there is nothing to call/);
  });

  it("carries no emoji anywhere (A13)", () => {
    render(<Hero />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it("has no inline style attributes", () => {
    const { container } = render(<Hero />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("is free of axe violations", async () => {
    const { container } = render(<Hero />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});

describe("S2 — What is Pariksha?", () => {
  it("has its stated id and is labelled by its heading (T22, A5)", () => {
    const { container } = render(<WhatIsPariksha />);
    const section = container.querySelector("#what-it-is");
    expect(section).not.toBeNull();
    const headingId = section!.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId!)?.textContent).toBe(
      S2_HEADING,
    );
  });

  it("the h2 text is exactly the verbatim heading (T22)", () => {
    render(<WhatIsPariksha />);
    expect(
      screen.getByRole("heading", { level: 2, name: S2_HEADING }).textContent,
    ).toBe(S2_HEADING);
  });

  it("the first following <p> is 40-60 words and its first sentence names Pariksha (T23)", () => {
    const { container } = render(<WhatIsPariksha />);
    const firstParagraph = firstParagraphAfterHeading(container);
    const text = firstParagraph.textContent ?? "";
    const words = wordCount(text);
    expect(words).toBeGreaterThanOrEqual(40);
    expect(words).toBeLessThanOrEqual(60);
    expect(firstSentence(text)).toMatch(/Pariksha/);
  });

  it("carries the numeral row's measured-and-specified figures with their date (T26b)", () => {
    const { container } = render(<WhatIsPariksha />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/12/);
    expect(text).toMatch(/QUESTION TYPES/);
    expect(text).toMatch(/SPECIFIED/);
    expect(text).toMatch(/pre-alpha, October 2026/);
    // the literal phrase "12 question types" never appears unqualified
    expect(text.toLowerCase()).not.toMatch(/12 question types/);
  });

  it("is free of axe violations", async () => {
    const { container } = render(<WhatIsPariksha />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);

  // v3-interactive.md §4.2: the verification strip replaces the slot a
  // product with no users cannot fill with three artefacts a reader can
  // open, and never a coverage tuple or an adoption figure.
  it("carries the three-item verification strip, and no coverage tuple or adoption figure", () => {
    const { container } = render(<WhatIsPariksha />);
    const items = container.querySelectorAll(".verification-strip li");
    expect(items).toHaveLength(3);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Apache-2\.0/);
    expect(text).toMatch(/seventeen questions/);
    expect(text).toMatch(/JSON Schemas/);
    expect(text).not.toMatch(/97\/93\/100\/98/);
    expect(text).not.toMatch(/star|fork|download|contributor count|trusted by/i);
  });
});

describe("S3 — How running an exam works", () => {
  it("has its stated id and is labelled by its heading (T22, A5)", () => {
    const { container } = render(<HowItWorks />);
    const section = container.querySelector("#how-it-works");
    expect(section).not.toBeNull();
    const headingId = section!.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId!)?.textContent).toBe(
      S3_HEADING,
    );
  });

  it("the h2 text is exactly the verbatim, question-shaped heading (T22)", () => {
    render(<HowItWorks />);
    expect(
      screen.getByRole("heading", { level: 2, name: S3_HEADING }).textContent,
    ).toBe(S3_HEADING);
    expect(S3_HEADING.endsWith("?")).toBe(true);
  });

  it("the answer-first paragraph is 40-60 words and names Pariksha first (T23)", () => {
    const { container } = render(<HowItWorks />);
    const firstParagraph = firstParagraphAfterHeading(container);
    const text = firstParagraph.textContent ?? "";
    const words = wordCount(text);
    expect(words).toBeGreaterThanOrEqual(40);
    expect(words).toBeLessThanOrEqual(60);
    expect(firstSentence(text)).toMatch(/Pariksha/);
  });

  it("renders exactly five h3s: three StepRows in order 01/02/03, then the two absorbed headings", () => {
    render(<HowItWorks />);
    const h3s = screen.getAllByRole("heading", { level: 3 });
    expect(h3s).toHaveLength(5);
    expect(h3s[0]).toHaveTextContent("Write the questions");
    expect(h3s[1]).toHaveTextContent("Assemble the test into sections");
    expect(h3s[2]).toHaveTextContent("They sit it; you download the results");
    expect(h3s[3]).toHaveTextContent("What does Pariksha do?");
    expect(h3s[3]).toHaveAttribute("id", "features");
    expect(h3s[4]).toHaveTextContent(
      "Does an organiser ever have to write JSON?",
    );
    expect(h3s[4]).toHaveAttribute("id", "no-code");
  });

  // v3-interactive.md §4.3 item 5: the new answer paragraph replaces S5's
  // deleted six-cell description — must not say "six" or "the cells below",
  // and must name the four surviving problems.
  it("#features carries a fresh 40-60 word answer naming Pariksha first, never the deleted six-cell language", () => {
    const { container } = render(<HowItWorks />);
    const heading = container.querySelector("#features")!;
    const p = heading.nextElementSibling as HTMLElement;
    expect(p.tagName).toBe("P");
    const words = wordCount(p.textContent ?? "");
    expect(words).toBeGreaterThanOrEqual(40);
    expect(words).toBeLessThanOrEqual(60);
    expect(firstSentence(p.textContent ?? "")).toContain("Pariksha");
    expect(p.textContent).not.toMatch(/\bsix\b/i);
    expect(p.textContent).not.toMatch(/the cells below/i);
  });

  // S5's binding shipped/specified lead line survives verbatim; the twelve
  // type names are a real <ul>, not prose (the "how many question types"
  // query ranks on the list, not the sentence).
  it("carries the binding feature-status lead line and the twelve type names as a real list", () => {
    const { container } = render(<HowItWorks />);
    expect(
      screen.getByText(
        "The scoring and selection engines are built and tested; everything else on this page is specified. All twelve question types, the test builder and the candidate runtime land with v0.1; proctoring and results follow in v0.2.",
      ),
    ).toBeInTheDocument();
    const types = container.querySelectorAll(".type-list li");
    expect(types).toHaveLength(12);
    expect(types[0]).toHaveTextContent("Single choice");
  });

  // S6's binding paragraph and pull quote survive verbatim under its
  // absorbed heading; M-2 (the editor mock) and its FeatureCell siblings
  // are gone outright — no fictional screen beside the working demo (D5).
  it("#no-code carries the binding paragraph and pull quote, with no editor mock or FeatureCell surviving", () => {
    const { container } = render(<HowItWorks />);
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          "No, organisers build questions and tests in a Pariksha UI: one editing screen for all twelve types, a type picker, a drag-to-reorder section list, live pool counts and a publish checklist. The JSON exists so that you can hand-author, script, diff or export a test if you want to — and so that nothing you build is locked into Pariksha.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You will never have to write this. It is here so that you can — and so that nothing you build is trapped.",
      ),
    ).toBeInTheDocument();
    expect(container.textContent).toContain(
      "the authoring interface itself is designed and not yet built",
    );
    expect(container.querySelector(".editor-mock")).toBeNull();
    expect(container.querySelector(".feature-cell")).toBeNull();
  });

  it("every code block is a labelled, keyboard-reachable region (T25, A7)", () => {
    const { container } = render(<HowItWorks />);
    const regions = container.querySelectorAll('[role="region"]');
    expect(regions.length).toBeGreaterThanOrEqual(2);
    for (const region of regions) {
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region.getAttribute("aria-labelledby")).toBeTruthy();
    }
  });

  // v3-cull.md §2: CB-3 (the results CSV code block) is deleted as a
  // duplicate of M-3 — only CB-1 and CB-2 remain as code blocks.
  it("renders exactly two code blocks (CB-3 deleted as a duplicate of M-3)", () => {
    const { container } = render(<HowItWorks />);
    expect(container.querySelectorAll(".code-block")).toHaveLength(2);
  });

  it("CB-1 is the verbatim question, captioned by its source file", () => {
    const { container } = render(<HowItWorks />);
    expect(container.textContent).toMatch(/LOG-001/);
    expect(container.textContent).toMatch(
      /examples\/reasoning-aptitude\/questions\.json/,
    );
  });

  it("CB-2 is the verbatim pool section, captioned by its source file", () => {
    const { container } = render(<HowItWorks />);
    expect(container.textContent).toMatch(/"kind": "pool"/);
    expect(container.textContent).toMatch(
      /examples\/reasoning-aptitude\/test\.json/,
    );
  });

  it("renders a real results table with a caption and an integrity-badge pill per row (T24-adjacent, A8, A11)", () => {
    const { container } = render(<HowItWorks />);
    const table = container.querySelector("table.results-table");
    expect(table).not.toBeNull();
    expect(table!.querySelector("caption")).not.toBeNull();
    const headerCells = table!.querySelectorAll('th[scope="col"]');
    expect(headerCells.length).toBeGreaterThan(0);
    // the word carries the status, never colour alone (A11) — scoped to the
    // table, since the absorbed #features list also names "clean" in prose.
    expect(
      within(table as HTMLElement).getByText("clean"),
    ).toHaveClass("integrity-badge-clean");
    expect(
      within(table as HTMLElement).getByText("review"),
    ).toHaveClass("integrity-badge-review");
    expect(
      within(table as HTMLElement).getByText("high risk"),
    ).toHaveClass("integrity-badge-risk");
  });

  it("carries the Divya caption, near-verbatim and sourced", () => {
    render(<HowItWorks />);
    expect(
      screen.getByText(/Divya's row is the whole design in one line/),
    ).toBeInTheDocument();
  });

  it("has no inline style attributes", () => {
    const { container } = render(<HowItWorks />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("is free of axe violations", async () => {
    const { container } = render(<HowItWorks />);
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000);
});
