import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { S4Comparison } from "../src/sections/s4-s6/S4Comparison";

// landing-page-v3-interactive.md §4 (amending v2 §3/§6/§7/§8) — S4 only.
// S5 (features) and S6 (no-code) are deleted from this file: they are
// absorbed into HowItWorks as h3s (test/sections-s1-s3.test.tsx) and a test
// asserting a band that no longer exists is removed, not skipped.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../src/styles/sections-s4-s6.css");
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const HEADING = "Why not a form tool, and why not a paid assessment platform?";

function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text.trim());
  return match ? match[0] : text.trim();
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

describe("comparison", () => {
  // T22: the section exists with its stated id, and its h2 text content is
  // exactly the verbatim heading in §3.
  it("renders with its stated id and the exact verbatim h2", () => {
    const { container } = render(<S4Comparison />);
    const section = container.querySelector("#comparison");
    expect(section).not.toBeNull();
    expect(section?.tagName).toBe("SECTION");
    const h2 = within(section as HTMLElement).getByRole("heading", {
      level: 2,
    });
    expect(h2.textContent).toBe(HEADING);
  });

  // A5: every <section> is labelled by its heading via aria-labelledby.
  it("is labelled by its own heading", () => {
    const { container } = render(<S4Comparison />);
    const section = container.querySelector("#comparison") as HTMLElement;
    const labelledBy = section.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = container.querySelector(`#${labelledBy}`);
    expect(heading).not.toBeNull();
    expect(heading?.tagName).toBe("H2");
  });

  // T23: the heading ends in "?"; the first <p> after it is 40–60 words;
  // that paragraph's first sentence names Pariksha.
  it("satisfies the answer-first heading contract (T23)", () => {
    expect(HEADING.endsWith("?")).toBe(true);
    const { container } = render(<S4Comparison />);
    const section = container.querySelector("#comparison") as HTMLElement;
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

  it("carries the eyebrow (every band, including 96px chapter openings — v3-interactive.md §4)", () => {
    const { container } = render(<S4Comparison />);
    expect(container.querySelector(".section-eyebrow")?.textContent).toBe(
      "COMPARISON",
    );
  });

  // A13: no emoji anywhere in rendered text.
  it("carries no emoji", () => {
    render(<S4Comparison />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  // T26: no AI-marketing phrases anywhere.
  it("makes no AI claims", () => {
    render(<S4Comparison />);
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("AI-powered");
    expect(text).not.toContain("AI question generation");
    expect(text).not.toContain("generate a test with AI");
  });

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

  it("has no inline style attribute", () => {
    const source = readFileSync(
      resolve(__dirname, "../src/sections/s4-s6/S4Comparison.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/\sstyle=\{/);
  });

  it("the stylesheet has no hex colour literal, and every colour function reads from a token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const colorFunctionCalls =
      css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/g) ?? [];
    for (const call of colorFunctionCalls) {
      const index = css.indexOf(call);
      const slice = css.slice(index, index + 80);
      expect(slice).toMatch(/\(from var\(--color-[a-z0-9-]+\)/);
    }
  });
});
