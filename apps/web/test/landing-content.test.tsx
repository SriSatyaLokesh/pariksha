import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "../src/routes/landing";

// docs/superpowers/specs/2026-10-17-landing-page-v2-design.md §8, Wave 4.
// T22-T26b and T32. Every assertion below cites the test id it covers.

// Sections that carry their own id and a top-level h2. S1 (hero) and B8
// (closing) are handled separately below — the spine table gives them no
// id ("—"). #features, #no-code and #status are no longer h2-level
// sections: v3-interactive.md §4 absorbs them as h3s inside #how-it-works
// and #not-for respectively, asserted in their own describe block below.
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
  { id: "cost", heading: "What does it cost to run an exam on Pariksha?" },
  { id: "not-for", heading: "Who is Pariksha not for?" },
  { id: "faq", heading: "Questions and answers" },
  { id: "docs", heading: "Footer" },
];

// The three absorbed h3s — v3-interactive.md §4.3/§4.5. Each anchor still
// resolves (zero link rot) even though its heading is no longer an h2.
const ABSORBED_H3_SECTIONS: { id: string; heading: string }[] = [
  { id: "features", heading: "What does Pariksha do?" },
  { id: "no-code", heading: "Does an organiser ever have to write JSON?" },
  { id: "status", heading: "What is built today, and what is not?" },
];

// T23, amended by landing-page-v3-interactive.md §5: "Try three questions"
// joins the allow-list — the hero's demo panel h2 is declarative, exists
// for A4 and the panel's accessible name, and carries no honesty load (§3.9).
const H2_ALLOW_LIST = [
  "Try three questions",
  "Questions and answers",
  "Read one real test, end to end.",
  "Footer",
];

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

// The blunt, mechanical proxy T23 asks for, literally: the text up to the
// first sentence-ending punctuation. (A previous version folded any sentence
// under four words into the one after it, which meant S6's deliberate
// one-word opening ("No.") was never actually checked — §8 says "that
// paragraph's first sentence", not "first sentence of at least four words".)
function firstSentence(text: string): string {
  const match = /^[^.?!]*[.?!]/.exec(text.trim());
  return match ? match[0] : text.trim();
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
      expect(h1.textContent).toBe(
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
        expect(heading.textContent).toBe(section.heading);
      });
    }

    it("S11 — the closing band's h2 is exact", () => {
      const { container } = render(<Landing />);
      const closing = container.querySelector(".hero-section--display-lg");
      expect(closing).not.toBeNull();
      const h2 = within(closing as HTMLElement).getByRole("heading", {
        level: 2,
      });
      expect(h2.textContent).toBe("Read one real test, end to end.");
    });

    // v3-interactive.md §4.3/§4.5: #features, #no-code and #status survive
    // as h3s with their anchors intact — zero link rot even after the band
    // that used to own them is deleted or absorbed.
    for (const section of ABSORBED_H3_SECTIONS) {
      it(`#${section.id} (absorbed h3) — "${section.heading}"`, () => {
        render(<Landing />);
        const el = document.getElementById(section.id);
        expect(el, `#${section.id} does not exist`).not.toBeNull();
        expect(el?.tagName).toBe("H3");
        expect(el?.textContent).toBe(section.heading);
      });
    }
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

      // The three allow-listed headings are exempt from the rest of T23
      // entirely: a heading that asks no question gets no manufactured
      // answer-shaped paragraph underneath it.
      if (H2_ALLOW_LIST.includes(text)) continue;

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

  // T20(a), amended: the primary CTA moved to B8 — the hero carries no
  // ButtonPrimary, and the only one on the page is the closing band's.
  it("T20(a) — the only ButtonPrimary on the page is in the closing band", () => {
    const { container } = render(<Landing />);
    const buttons = container.querySelectorAll(".button-primary");
    expect(buttons).toHaveLength(1);
    const closing = container.querySelector(".hero-section--display-lg");
    expect(closing?.contains(buttons[0] as Node)).toBe(true);
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
  // accessible name and tabindex 0. v3-interactive.md D5/D2/A8: M-1 is now
  // the real, prerendered exam demo — it may reuse the `.runner-mock`
  // visual styling, but it must not be `aria-hidden` the way the old M-1
  // mock was, since it is real, operable content now. M-2 (the editor
  // mock) is deleted outright, so no `.editor-mock` survives at all.
  it("T25 — every code block is a labelled, keyboard-reachable region; the demo is real content, not a hidden mock", () => {
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

    expect(container.querySelector(".editor-mock")).toBeNull();
    const demoMock = container.querySelector(".runner-mock");
    if (demoMock) expect(demoMock).not.toHaveAttribute("aria-hidden");
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

  // T32, amended by landing-page-v3-interactive.md §5: converted from a
  // ratio to an absolute offset. A ratio is the wrong instrument once the
  // hero necessarily grows (the demo) while the document necessarily
  // shrinks (the cull) — every later deletion would push a ratio-based
  // gate redder, which is backwards for a page being asked to get shorter.
  // The absolute figure is the hero's byte ceiling: head and nav measure
  // 6,632 and do not change, leaving 6,868 bytes for all of B1 against the
  // spine's derived 6,790 — so B2's definitional sentence must start before
  // byte 13,500 of the document (this component's own SSR markup, not
  // dist/index.html, so there is no separate head block to add back in).
  it("T32 — S2's definitional sentence starts before byte 13,500 (the hero's byte ceiling)", () => {
    const html = renderToStaticMarkup(<Landing />);
    const needle = "Pariksha is a free, open-source exam platform";
    const index = html.indexOf(needle);
    expect(index).toBeGreaterThan(-1);
    const byteIndex = Buffer.byteLength(html.slice(0, index), "utf8");
    expect(byteIndex).toBeLessThan(13_500);
  });

  // T41: the deleted things stay deleted, and only the documented four code
  // blocks remain on the whole page.
  it("T41 — the roadmap ledger and the file listing stay deleted; exactly four code blocks remain", () => {
    const { container } = render(<Landing />);
    const text = container.textContent ?? "";
    for (let phase = 4; phase <= 12; phase++) {
      expect(text).not.toMatch(new RegExp(`Phase ${phase}\\b.*not started`, "i"));
    }
    expect(container.querySelector(".roadmap-ledger")).toBeNull();
    expect(text).not.toMatch(/\.md\s*·\s*\d+\s*lines/);
    expect(text).not.toMatch(/260 lines|213 lines|451 lines/);
    expect(container.querySelectorAll(".code-block")).toHaveLength(4);
  });

  // T42: the FAQ is nine h3s, and none is one of the four deleted questions.
  it("T42 — the FAQ contains exactly nine h3s, none of them a deleted question", () => {
    render(<Landing />);
    const faq = document.getElementById("faq") as HTMLElement;
    const h3s = within(faq).getAllByRole("heading", { level: 3 });
    expect(h3s).toHaveLength(9);
    const deleted = [
      'What does "Pariksha" mean?',
      "How much does it cost to run?",
      "Can browser proctoring actually prevent cheating?",
      "What licence is it under, and can I sell a service built on it?",
    ];
    for (const h3 of h3s) {
      expect(deleted).not.toContain(h3.textContent);
    }
  });
});
