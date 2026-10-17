import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "../src/routes/landing";

// docs/superpowers/specs/2026-10-17-landing-page-v2-design.md §8, Wave 4.
// T22-T26b and T32. Every assertion below cites the test id it covers.

// Sections that carry their own id. S1 (hero) and S11 (closing) are
// handled separately below — §3.0's spine table gives them no id ("—").
const SECTIONS: { id: string; heading: string }[] = [
  { id: "what-it-is", heading: "What is Pariksha?" },
  {
    id: "how-it-works",
    heading: "How does running an exam on Pariksha actually work?",
  },
  {
    id: "comparison",
    heading: "Why not a form tool, and why not a paid assessment platform?",
  },
  { id: "features", heading: "What does Pariksha do?" },
  { id: "no-code", heading: "Does an organiser ever have to write JSON?" },
  { id: "cost", heading: "What does it cost to run an exam on Pariksha?" },
  { id: "not-for", heading: "Who is Pariksha not for?" },
  { id: "status", heading: "What is built today, and what is not?" },
  { id: "faq", heading: "Questions and answers" },
  { id: "docs", heading: "Footer" },
];

const H2_ALLOW_LIST = [
  "Questions and answers",
  "Read one real test, end to end.",
  "Footer",
];

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

// The blunt, mechanical proxy T23 asks for: split on sentence-ending
// punctuation, then — because a paragraph may open with a sentence too
// short to carry a subject on its own (S6's "No.") — fold anything under
// four words into the sentence after it before checking for "Pariksha".
function firstSentence(text: string): string {
  const sentences = text.trim().split(/(?<=[.?!])\s+/);
  let first = sentences[0] ?? "";
  let i = 1;
  while (words(first).length < 4 && i < sentences.length) {
    first = `${first} ${sentences[i]}`;
    i++;
  }
  return first;
}

// The first <p> that follows a given heading in document order — immune to
// an eyebrow <p> rendered *before* the h2 (sections-s1-s3.css's S2 band),
// since that paragraph precedes the heading rather than following it.
function firstParagraphAfter(
  heading: Element,
  all: Element[],
): Element | undefined {
  const index = all.indexOf(heading);
  return all.slice(index + 1).find((el) => el.tagName === "P");
}

describe("landing content — Wave 4 (§8)", () => {
  // T22: one assertion per section S1-S12: the section exists with its
  // stated id, and its heading text is exactly the verbatim copy in §3.
  describe("T22 — every section exists with its stated id and verbatim heading", () => {
    it("S1 — the hero's h1 is exact", () => {
      const { container } = render(<Landing />);
      const hero = container.querySelector(
        ".hero-section:not(.hero-section--display-lg)",
      );
      expect(hero).not.toBeNull();
      const h1 = within(hero as HTMLElement).getByRole("heading", {
        level: 1,
      });
      expect(h1).toHaveTextContent(
        "Pariksha — run real exams you host yourself.",
      );
    });

    for (const section of SECTIONS) {
      it(`#${section.id} — "${section.heading}"`, () => {
        render(<Landing />);
        const el = document.getElementById(section.id);
        expect(el, `#${section.id} does not exist`).not.toBeNull();
        const heading = within(el as HTMLElement).getByRole("heading", {
          level: 2,
        });
        expect(heading).toHaveTextContent(section.heading);
      });
    }

    it("S11 — the closing band's h2 is exact", () => {
      const { container } = render(<Landing />);
      const closing = container.querySelector(".hero-section--display-lg");
      expect(closing).not.toBeNull();
      const h2 = within(closing as HTMLElement).getByRole("heading", {
        level: 2,
      });
      expect(h2).toHaveTextContent("Read one real test, end to end.");
    });
  });

  // T23: every h2 ends in "?" or is allow-listed; the first following <p>
  // is 40-60 words; that paragraph's first sentence contains "Pariksha".
  it("T23 — every h2 is question-shaped (or allow-listed), answer-first, and names Pariksha", () => {
    const { container } = render(<Landing />);
    const all = [...container.querySelectorAll("h2, p")];
    const h2s = all.filter((el) => el.tagName === "H2");
    expect(h2s.length).toBeGreaterThan(0);

    for (const h2 of h2s) {
      const text = h2.textContent ?? "";
      expect(
        text.endsWith("?") || H2_ALLOW_LIST.includes(text),
        `"${text}" is neither question-shaped nor allow-listed`,
      ).toBe(true);

      const paragraph = firstParagraphAfter(h2, all);
      expect(paragraph, `no <p> follows h2 "${text}"`).toBeDefined();
      const paragraphText = paragraph?.textContent ?? "";
      const wordCount = words(paragraphText).length;
      expect(
        wordCount,
        `the paragraph after "${text}" is ${wordCount} words: "${paragraphText}"`,
      ).toBeGreaterThanOrEqual(40);
      expect(wordCount).toBeLessThanOrEqual(60);
      expect(
        firstSentence(paragraphText),
        `the paragraph after "${text}" does not name Pariksha in its first sentence`,
      ).toContain("Pariksha");
    }
  });

  // T23b: every h3 inside #faq is followed by a <p> whose first sentence
  // contains "Pariksha" — S10 is the densest extraction band, and a lifted
  // answer with no subject can be attributed to anything.
  it("T23b — every FAQ answer's first sentence names Pariksha", () => {
    render(<Landing />);
    const faq = document.getElementById("faq") as HTMLElement;
    expect(faq).not.toBeNull();
    const all = [...faq.querySelectorAll("h3, p")];
    const h3s = all.filter((el) => el.tagName === "H3");
    expect(h3s.length).toBeGreaterThan(0);

    for (const h3 of h3s) {
      const paragraph = firstParagraphAfter(h3, all);
      expect(paragraph, `no <p> follows "${h3.textContent}"`).toBeDefined();
      expect(firstSentence(paragraph?.textContent ?? "")).toContain(
        "Pariksha",
      );
    }
  });

  // T24: S4 renders a real <table> with a <caption>, scope on every header
  // cell, four columns, seven body rows, and a non-empty corner cell.
  it("T24 — the comparison table is a real table with caption, scope and seven rows", () => {
    render(<Landing />);
    const comparison = document.getElementById("comparison") as HTMLElement;
    const table = within(comparison).getByRole("table");
    const caption = table.querySelector("caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent?.trim().length ?? 0).toBeGreaterThan(0);

    const headerCells = within(table).getAllByRole("columnheader");
    expect(headerCells).toHaveLength(4);
    for (const cell of headerCells) {
      expect(cell).toHaveAttribute("scope", "col");
    }
    expect(headerCells[0]?.textContent?.trim().length ?? 0).toBeGreaterThan(
      0,
    );

    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(7);
    for (const cell of rowHeaders) {
      expect(cell).toHaveAttribute("scope", "row");
    }
    expect(table.querySelectorAll("tbody tr")).toHaveLength(7);
  });

  // T24b: S4's two prose strings are present verbatim — the dated
  // category-not-product footnote, and the credibility hinge.
  it("T24b — the comparison's dated footnote and credibility hinge are verbatim", () => {
    render(<Landing />);
    expect(
      screen.getByText(
        "Compared against product categories, not named products, as of 17 October 2026.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /^A paid platform you can buy today will do more than Pariksha does today/,
      ),
    ).toBeInTheDocument();
  });

  // T25: every code block renders inside a role="region" with a non-empty
  // accessible name and tabindex 0; every ProductMock renders
  // aria-hidden="true" with a sibling visually-hidden paragraph of >=10
  // words.
  it("T25 — every code block is a labelled, keyboard-reachable region; every mock is hidden and described", () => {
    const { container } = render(<Landing />);

    const codeBlocks = container.querySelectorAll(".code-block");
    expect(codeBlocks.length).toBeGreaterThan(0);
    for (const block of codeBlocks) {
      const region = block.querySelector('[role="region"]');
      expect(region, "code block has no role=region child").not.toBeNull();
      expect(region).toHaveAttribute("tabIndex", "0");
      expect(region?.getAttribute("aria-labelledby")).toBeTruthy();
      const captionId = region?.getAttribute("aria-labelledby") ?? "";
      const caption = container.querySelector(`#${CSS.escape(captionId)}`);
      expect(caption?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }

    const mocks = container.querySelectorAll('[aria-hidden="true"]');
    const mockClasses = ["runner-mock", "editor-mock"];
    const productMocks = [...mocks].filter((el) =>
      mockClasses.some((cls) => el.classList.contains(cls)),
    );
    expect(productMocks).toHaveLength(2);
    for (const mock of productMocks) {
      const description = mock.nextElementSibling;
      expect(description).not.toBeNull();
      expect(description).toHaveClass("visually-hidden");
      expect(
        words(description?.textContent ?? "").length,
      ).toBeGreaterThanOrEqual(10);
    }
  });

  // T26: the forbidden AI phrases appear nowhere; the BYOK block names
  // Phase 9 and says "not built".
  it("T26 — no unqualified AI-generation phrase appears; BYOK is labelled Phase 9, not built", () => {
    const { container } = render(<Landing />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("AI-powered");
    expect(text).not.toContain("AI question generation");
    expect(text).not.toContain("generate a test with AI");

    const byok = container.querySelector(".status-byok");
    expect(byok).not.toBeNull();
    expect(byok?.textContent ?? "").toContain("Phase 9");
    expect(byok?.textContent ?? "").toContain("not built");
  });

  // T26b: every occurrence of "500", "zero hosting cost" and
  // "12 question types" falls within 200 characters of a qualifier —
  // catches a number lifted out of its qualifier by a later edit.
  it("T26b — every unqualified-sounding number sits within 200 characters of its qualifier", () => {
    const { container } = render(<Landing />);
    const text = container.textContent ?? "";
    const qualifiers =
      /estimate|target|specified|v0\.1|v0\.3|pre-alpha/i;

    for (const needle of ["500", "zero hosting cost", "12 question types"]) {
      let from = 0;
      let index: number;
      while ((index = text.indexOf(needle, from)) !== -1) {
        const windowText = text.slice(
          Math.max(0, index - 200),
          index + needle.length + 200,
        );
        expect(
          qualifiers.test(windowText),
          `"${needle}" at index ${index} has no qualifier within 200 characters: "${windowText}"`,
        ).toBe(true);
        from = index + needle.length;
      }
    }
  });

  // T32: the byte index of S2's definitional sentence, divided by the
  // document's byte length, is under 0.30 — the first-30%-of-document band
  // R3 makes a design driver, verified rather than assumed given S1's mock
  // is ~60 elements of markup sitting ahead of it. Uses the component's own
  // SSR markup (react-dom/server, already a dependency) as the document: a
  // full dist/index.html also carries a small, roughly constant-size head
  // block ahead of <body>, which only pulls the ratio further down.
  it("T32 — S2's definitional sentence lands within the first 30% of the document", () => {
    const html = renderToStaticMarkup(<Landing />);
    const bytes = Buffer.byteLength(html, "utf8");
    const needle = "Pariksha is a free, open-source exam platform";
    const index = html.indexOf(needle);
    expect(index).toBeGreaterThan(-1);
    const byteIndex = Buffer.byteLength(html.slice(0, index), "utf8");
    expect(byteIndex / bytes).toBeLessThan(0.3);
  });
});
