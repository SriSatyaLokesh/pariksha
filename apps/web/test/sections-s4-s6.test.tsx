import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { S4Comparison } from "../src/sections/s4-s6/S4Comparison";
import { S5Features } from "../src/sections/s4-s6/S5Features";
import { S6NoCode } from "../src/sections/s4-s6/S6NoCode";

// Design contract §3/§6/§7/§8 (2026-10-17-landing-page-v2-design.md) — S4-S6.
// Each test cites the test id or acceptance line it covers.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../src/styles/sections-s4-s6.css");
const css = readFileSync(CSS_PATH, "utf8");

const SECTIONS = [
  {
    Component: S4Comparison,
    id: "comparison",
    heading: "Why not a form tool, and why not a paid assessment platform?",
  },
  {
    Component: S5Features,
    id: "features",
    heading: "What does Pariksha do?",
  },
  {
    Component: S6NoCode,
    id: "no-code",
    heading: "Does an organiser ever have to write JSON?",
  },
] as const;

const HEADING_ALLOW_LIST = [
  "Questions and answers",
  "Read one real test, end to end.",
  "Footer",
];

// T23's "first sentence" proxy. A naive split on ". " breaks S6's verbatim
// answer paragraph after its deliberate one-word opening ("No."), so a
// sentence under four words is folded into the next one before the check —
// matching T23's own note that "the design and the test agree".
function firstSentence(text: string): string {
  const parts = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let acc = "";
  for (const part of parts) {
    acc += part;
    if (acc.trim().split(/\s+/).length > 3) break;
  }
  return acc;
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe.each(SECTIONS)("$id", ({ Component, id, heading }) => {
  // T22: the section exists with its stated id, and its h2 text content is
  // exactly the verbatim heading in §3.
  it("renders with its stated id and the exact verbatim h2", () => {
    const { container } = render(<Component />);
    const section = container.querySelector(`#${id}`);
    expect(section).not.toBeNull();
    expect(section?.tagName).toBe("SECTION");
    const h2 = within(section as HTMLElement).getByRole("heading", {
      level: 2,
    });
    expect(h2.textContent).toBe(heading);
  });

  // A5: every <section> is labelled by its heading via aria-labelledby.
  it("is labelled by its own heading", () => {
    const { container } = render(<Component />);
    const section = container.querySelector(`#${id}`) as HTMLElement;
    const labelledBy = section.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = container.querySelector(`#${labelledBy}`);
    expect(heading).not.toBeNull();
    expect(heading?.tagName).toBe("H2");
  });

  // T23: the heading ends in "?" or sits in the allow-list; the first <p>
  // after it is 40–60 words; that paragraph's first sentence names Pariksha.
  it("satisfies the answer-first heading contract (T23)", () => {
    expect(
      heading.endsWith("?") || HEADING_ALLOW_LIST.includes(heading),
    ).toBe(true);

    const { container } = render(<Component />);
    const section = container.querySelector(`#${id}`) as HTMLElement;
    const h2 = within(section).getByRole("heading", { level: 2 });
    let node: Element | null = h2.nextElementSibling;
    while (node && node.tagName !== "P") node = node.nextElementSibling;
    expect(node).not.toBeNull();
    const text = node?.textContent ?? "";
    const count = wordCount(text);
    expect(count).toBeGreaterThanOrEqual(40);
    expect(count).toBeLessThanOrEqual(60);
    expect(firstSentence(text)).toContain("Pariksha");
  });

  // A13: no emoji anywhere in rendered text.
  it("carries no emoji", () => {
    render(<Component />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  // T26: no AI-marketing phrases anywhere.
  it("makes no AI claims", () => {
    render(<Component />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("AI-powered");
    expect(text).not.toContain("AI question generation");
    expect(text).not.toContain("generate a test with AI");
  });

  // T26b: every occurrence of the three bare numbers/claims sits within 200
  // characters of a qualifier.
  it("keeps every guarded number within 200 characters of a qualifier (T26b)", () => {
    render(<Component />);
    const text = document.body.textContent ?? "";
    const qualifiers = [
      "estimate",
      "target",
      "specified",
      "v0.1",
      "v0.3",
      "pre-alpha",
    ];
    for (const needle of ["500", "zero hosting cost", "12 question types"]) {
      let from = 0;
      let index: number;
      while ((index = text.indexOf(needle, from)) !== -1) {
        const windowText = text.slice(
          Math.max(0, index - 200),
          index + needle.length + 200,
        );
        expect(qualifiers.some((q) => windowText.includes(q))).toBe(true);
        from = index + needle.length;
      }
    }
  });
});

describe("S4 comparison", () => {
  // T24: a real <table> with a <caption>, scope on every header cell, four
  // columns, seven body rows, and a non-empty corner header cell.
  it("renders the comparison table with four columns and seven rows", () => {
    render(<S4Comparison />);
    const table = screen.getByRole("table");
    expect(table.querySelector("caption")).not.toBeNull();
    const headerCells = screen.getAllByRole("columnheader");
    expect(headerCells).toHaveLength(4);
    for (const cell of headerCells) expect(cell).toHaveAttribute("scope", "col");
    expect(headerCells[0]?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    const rowHeaders = screen.getAllByRole("rowheader");
    expect(rowHeaders).toHaveLength(7);
    for (const cell of rowHeaders) expect(cell).toHaveAttribute("scope", "row");
  });

  // T24b: both verbatim prose strings survive a copy edit unnoticed.
  it("carries both verbatim credibility sentences", () => {
    render(<S4Comparison />);
    expect(
      screen.getByText(
        /Compared against product categories, not named products, as of/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          "A paid platform you can buy today will do more than Pariksha does today, because the Pariksha application is not built yet. What is built is the format, the schemas and the scoring engine — and you can run those today.",
      ),
    ).toBeInTheDocument();
  });

  it("carries the Moodle sentence, correctly, with no Safe Exam Browser claim", () => {
    render(<S4Comparison />);
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          "Moodle is the nearest open-source comparison and is more capable today than Pariksha is. Pariksha is not trying to replace it — it is trying to be lighter to run and to keep the test itself in one portable JSON file.",
      ),
    ).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Safe Exam Browser");
  });

  // X4 / A11: the argument is typographic, never colour alone — a real
  // cell-label span carries the column identity at narrow widths.
  it("marks the Pariksha column with a real cell-label span, not colour alone", () => {
    render(<S4Comparison />);
    const labels = screen.getAllByText("Pariksha", { selector: "span" });
    expect(labels.length).toBeGreaterThan(0);
  });
});

describe("S5 features", () => {
  // S5: six FeatureCells, the lead line binding the shipped/specified split.
  it("renders six FeatureCells with the binding status lead line", () => {
    render(<S5Features />);
    const cells = document.querySelectorAll(".feature-cell");
    expect(cells).toHaveLength(6);
    expect(
      screen.getByText(
        "The scoring and selection engines are built and tested; everything else on this page is specified. v0.1 ships six core question types, registration forms, proctoring and CSV results; all twelve types arrive at v0.3.",
      ),
    ).toBeInTheDocument();
  });

  // The grid is asymmetric: the first cell spans two columns.
  it("spans the first feature cell across two columns", () => {
    render(<S5Features />);
    expect(css).toMatch(
      /\.feature-grid--s5\s*>\s*\.feature-cell:first-child[^{]*\{[^}]*grid-column:\s*span 2/,
    );
  });

  // T25 / A7: CB-6's code block renders inside a labelled, keyboard-reachable
  // scroll region. A section with an accessible name is itself an implicit
  // ARIA "region", so this scopes to the explicit code-block one.
  it("renders CB-6 as a labelled, keyboard-reachable code block", () => {
    const { container } = render(<S5Features />);
    const region = container.querySelector(".code-block__scroll");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("role", "region");
    expect(region).toHaveAttribute("tabIndex", "0");
    expect(region?.textContent).toContain("negative_fraction");
  });
});

describe("S6 no-code", () => {
  // The answer-first paragraph and the pull quote, both verbatim.
  it("carries the verbatim answer paragraph and pull quote", () => {
    render(<S6NoCode />);
    expect(
      screen.getByText(
        (_, node) =>
          node?.textContent ===
          "No. Organisers build questions and tests in a Pariksha UI: one editing screen for all twelve types, a type picker, a drag-to-reorder section list, live pool counts and a publish checklist. The JSON exists so that you can hand-author, script, diff or export a test if you want to — and so that nothing you build is locked into Pariksha.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "You will never have to write this. It is here so that you can — and so that nothing you build is trapped.",
      ),
    ).toBeInTheDocument();
  });

  // Honesty, binding: the authoring column says plainly it is not built.
  it("states plainly that the authoring interface is not yet built", () => {
    render(<S6NoCode />);
    const text = document.body.textContent ?? "";
    expect(text).toContain(
      "the authoring interface is designed and not yet built",
    );
  });

  // T25 / A8: the ProductMock is hidden from the accessibility tree with a
  // sibling visually-hidden description of at least ten words, which itself
  // repeats the "not yet built" honesty statement.
  it("hides the editor mock from the accessibility tree with a real description", () => {
    const { container } = render(<S6NoCode />);
    const hidden = container.querySelector('[aria-hidden="true"]');
    expect(hidden).not.toBeNull();
    const description = container.querySelector(".visually-hidden");
    expect(description).not.toBeNull();
    expect(wordCount(description?.textContent ?? "")).toBeGreaterThanOrEqual(
      10,
    );
    expect(description?.textContent).toContain("not yet built");
  });

  // CB-4: the only command on the page a visitor can run today, verbatim.
  // A section with an accessible name is itself an implicit ARIA "region",
  // so this scopes to the explicit code-block scroll regions only.
  it("renders CB-4 verbatim in a labelled, keyboard-reachable region", () => {
    const { container } = render(<S6NoCode />);
    const regions = Array.from(
      container.querySelectorAll(".code-block__scroll"),
    );
    const cb4 = regions.find((r) =>
      r.textContent?.includes("ajv-cli@5.0.0"),
    );
    expect(cb4).toBeDefined();
    expect(cb4).toHaveAttribute("tabIndex", "0");
    expect(cb4?.textContent).toContain(
      "git clone https://github.com/SriSatyaLokesh/pariksha.git",
    );
    expect(cb4?.textContent).toContain(
      '-s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"',
    );
  });
});
