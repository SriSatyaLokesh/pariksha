import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("S1 — Hero", () => {
  it("renders exactly one h1 with the verbatim, budgeted headline (T19)", () => {
    render(<Hero />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(H1_TEXT);
    expect(H1_TEXT.length).toBeLessThanOrEqual(45);
  });

  it("carries the pre-alpha / Apache-2.0 chip", () => {
    render(<Hero />);
    expect(screen.getByText(/PRE-ALPHA/)).toHaveTextContent(
      "PRE-ALPHA · APACHE-2.0",
    );
  });

  it("the first link has the worked-example accessible name and href (T20a)", () => {
    const { container } = render(<Hero />);
    const links = container.querySelectorAll("a");
    expect(links.length).toBeGreaterThan(0);
    // no arrow in the accessible name — it is inside <span aria-hidden> (T20a)
    expect(links[0]).toHaveAccessibleName("Start with the worked example");
    expect(links[0]).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude",
    );
  });

  it("every CTA-shaped link points at the pariksha repository (T20b)", () => {
    const { container } = render(<Hero />);
    const links = [...container.querySelectorAll("a")];
    for (const link of links) {
      expect(link.getAttribute("href")).toMatch(
        /^https:\/\/github\.com\/SriSatyaLokesh\/pariksha/,
      );
    }
  });

  it("the product mock is aria-hidden with a real sibling description of 10+ words (T25, A8)", () => {
    const { container } = render(<Hero />);
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    const description = container.querySelector("p.visually-hidden");
    expect(description).not.toBeNull();
    expect(wordCount(description!.textContent ?? "")).toBeGreaterThanOrEqual(
      10,
    );
  });

  it("carries no name-shaped candidate string and no emoji in the mock (A13)", () => {
    const { container } = render(<Hero />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Candidate\s*(?:·|·)\s*21CS0147/);
    expect(text).not.toMatch(/Ananya Rao/);
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
    expect(document.getElementById(headingId!)).toHaveTextContent(
      S2_HEADING,
    );
  });

  it("the h2 text is exactly the verbatim heading (T22)", () => {
    render(<WhatIsPariksha />);
    expect(
      screen.getByRole("heading", { level: 2, name: S2_HEADING }),
    ).toHaveTextContent(S2_HEADING);
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
});

describe("S3 — How running an exam works", () => {
  it("has its stated id and is labelled by its heading (T22, A5)", () => {
    const { container } = render(<HowItWorks />);
    const section = container.querySelector("#how-it-works");
    expect(section).not.toBeNull();
    const headingId = section!.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(document.getElementById(headingId!)).toHaveTextContent(
      S3_HEADING,
    );
  });

  it("the h2 text is exactly the verbatim, question-shaped heading (T22)", () => {
    render(<HowItWorks />);
    expect(
      screen.getByRole("heading", { level: 2, name: S3_HEADING }),
    ).toHaveTextContent(S3_HEADING);
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

  it("renders exactly three StepRows as h3s, in order 01/02/03", () => {
    render(<HowItWorks />);
    const h3s = screen.getAllByRole("heading", { level: 3 });
    expect(h3s).toHaveLength(3);
    expect(h3s[0]).toHaveTextContent("Write the questions");
    expect(h3s[1]).toHaveTextContent("Assemble the test into sections");
    expect(h3s[2]).toHaveTextContent("They sit it; you download the results");
  });

  it("every code block is a labelled, keyboard-reachable region (T25, A7)", () => {
    const { container } = render(<HowItWorks />);
    const regions = container.querySelectorAll('[role="region"]');
    expect(regions.length).toBeGreaterThanOrEqual(3);
    for (const region of regions) {
      expect(region).toHaveAttribute("tabindex", "0");
      expect(region.getAttribute("aria-labelledby")).toBeTruthy();
    }
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
    // the word carries the status, never colour alone (A11)
    expect(screen.getByText("clean")).toHaveClass("integrity-badge-clean");
    expect(screen.getByText("review")).toHaveClass("integrity-badge-review");
    expect(screen.getByText("high risk")).toHaveClass("integrity-badge-risk");
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
