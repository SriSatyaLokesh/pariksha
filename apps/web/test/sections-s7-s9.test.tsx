import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CostSection } from "../src/sections/s7-s9/CostSection";
import { NotForSection } from "../src/sections/s7-s9/NotForSection";
import { StatusSection } from "../src/sections/s7-s9/StatusSection";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../src/styles/sections-s7-s9.css");
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Design contract §3 S7–S9 (docs/superpowers/specs/2026-10-17-landing-page-v2-design.md),
// §8 T22/T23/T26/T26b, assignment "BUILD SECTIONS S7, S8, S9". Every query
// below is scoped to the container of its own render() call rather than the
// global `screen`, so one section's markup can never ambiguate another's.

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function firstSentence(text: string): string {
  const match = /^[\s\S]*?[.?!]/.exec(text.trim());
  return match ? match[0] : text.trim();
}

/** The first <p> in document order after `heading`, wherever it is nested. */
function firstParagraphAfter(heading: HTMLElement): HTMLElement {
  const section = heading.closest("section");
  if (!section) throw new Error("heading is not inside a <section>");
  const all = Array.from(section.querySelectorAll<HTMLElement>("*"));
  const headingIndex = all.indexOf(heading);
  const p = all.slice(headingIndex + 1).find((el) => el.tagName === "P");
  if (!p) throw new Error("no <p> found after the heading");
  return p;
}

const ALLOW_LIST = [
  "Questions and answers",
  "Read one real test, end to end.",
  "Footer",
];

function assertAnswerFirstHeading(heading: HTMLElement) {
  const text = heading.textContent ?? "";
  expect(text.endsWith("?") || ALLOW_LIST.includes(text)).toBe(true);
  const p = firstParagraphAfter(heading);
  const words = wordCount(p.textContent ?? "");
  expect(words).toBeGreaterThanOrEqual(40);
  expect(words).toBeLessThanOrEqual(60);
  expect(firstSentence(p.textContent ?? "")).toContain("Pariksha");
}

/** T26b: every occurrence of `phrase` in `text` sits within 200 characters
 * of one of the qualifier words. Returns whether `phrase` occurred at all. */
function assertQualifiedEverywhere(text: string, phrase: string): boolean {
  const qualifiers = [
    "estimate",
    "target",
    "specified",
    "v0.1",
    "v0.3",
    "pre-alpha",
  ];
  let idx = text.indexOf(phrase);
  let found = false;
  while (idx !== -1) {
    found = true;
    const windowText = text.slice(
      Math.max(0, idx - 200),
      Math.min(text.length, idx + phrase.length + 200),
    );
    const hasQualifier = qualifiers.some((q) =>
      windowText.toLowerCase().includes(q.toLowerCase()),
    );
    expect(
      hasQualifier,
      `"${phrase}" at index ${idx} has no qualifier within 200 characters`,
    ).toBe(true);
    idx = text.indexOf(phrase, idx + 1);
  }
  return found;
}

// --- CostSection (S7) ----------------------------------------------------

describe("CostSection (S7)", () => {
  it("has the stated id, is labelled by its heading, and the h2 is verbatim", () => {
    const { container } = render(<CostSection />);
    const section = container.querySelector("#cost");
    expect(section).not.toBeNull();
    const heading = within(container).getByRole("heading", {
      level: 2,
      name: "What does it cost to run an exam on Pariksha?",
    });
    expect(section).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("answer-first: the lead paragraph is 40-60 words and opens on Pariksha", () => {
    const { container } = render(<CostSection />);
    const heading = within(container).getByRole("heading", {
      level: 2,
      name: "What does it cost to run an exam on Pariksha?",
    });
    assertAnswerFirstHeading(heading);
  });

  it("every '500' and 'zero hosting cost' occurrence sits within 200 characters of a qualifier (T26b)", () => {
    const { container } = render(<CostSection />);
    const text = container.textContent ?? "";
    expect(assertQualifiedEverywhere(text, "500")).toBe(true);
    expect(assertQualifiedEverywhere(text, "zero hosting cost")).toBe(true);
  });

  it("renders CardVoltage once, CardHairline three times and ButtonSecondary twice", () => {
    const { container } = render(<CostSection />);
    expect(container.querySelectorAll(".card-voltage")).toHaveLength(1);
    expect(container.querySelectorAll(".card-hairline")).toHaveLength(3);
    expect(within(container).getAllByRole("link")).toHaveLength(3); // 2 deploy + 1 ADR link
  });

  it("CB-5's code block is a labelled, keyboard-reachable region with its binding footer line", () => {
    const { container } = render(<CostSection />);
    // The section itself is also an implicit ARIA "region" (a <section>
    // with an accessible name), so the code block's region is looked up by
    // its own name rather than by role alone.
    const region = within(container).getByRole("region", {
      name: "deploy/cloudflare/README.md",
    });
    expect(region).toHaveAttribute("tabIndex", "0");
    expect(
      within(container).getByText(
        "this deploys the site you are reading. The exam API is Phase 2.",
      ),
    ).toBeInTheDocument();
  });

  it("carries the binding adapter-seams sentence with ADR 0002 and Phase 2 not built", () => {
    const { container } = render(<CostSection />);
    const text = container.textContent ?? "";
    expect(text).toContain("three adapter seams");
    expect(text).toContain("ADR 0002");
    expect(text).toContain("Phase 2 and not built");
  });
});

// --- NotForSection (S8) ---------------------------------------------------

describe("NotForSection (S8)", () => {
  it("has the stated id, is labelled by its heading, and the h2 is verbatim", () => {
    const { container } = render(<NotForSection />);
    const section = container.querySelector("#not-for");
    expect(section).not.toBeNull();
    const heading = within(container).getByRole("heading", {
      level: 2,
      name: "Who is Pariksha not for?",
    });
    expect(section).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("answer-first: the lead paragraph is 40-60 words and opens on Pariksha", () => {
    const { container } = render(<NotForSection />);
    const heading = within(container).getByRole("heading", {
      level: 2,
      name: "Who is Pariksha not for?",
    });
    assertAnswerFirstHeading(heading);
  });

  it("states all eight reasons as plain prose rows, not cards, rules or a list", () => {
    const { container } = render(<NotForSection />);
    expect(container.querySelector(".card-hairline")).toBeNull();
    expect(container.querySelector(".card-voltage")).toBeNull();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    // one lead paragraph + eight reasons
    expect(container.querySelectorAll(".not-for-list p")).toHaveLength(9);
  });

  it("does not soften the list: the sharpest line is present and unhedged", () => {
    const { container } = render(<NotForSection />);
    expect(
      within(container).getByText(
        /Anyone who wants an AI to decide who cheated\./,
      ),
    ).toBeInTheDocument();
  });
});

// --- StatusSection (S9) ---------------------------------------------------

describe("StatusSection (S9)", () => {
  it("has the stated id, is labelled by its heading, and the h2 is verbatim", () => {
    const { container } = render(<StatusSection />);
    const section = container.querySelector("#status");
    expect(section).not.toBeNull();
    const heading = within(container).getByRole("heading", {
      level: 2,
      name: "What is built today, and what is not?",
    });
    expect(section).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("answer-first: the lead paragraph is 40-60 words, opens on Pariksha, and carries pre-alpha and the date", () => {
    const { container } = render(<StatusSection />);
    const heading = within(container).getByRole("heading", {
      level: 2,
      name: "What is built today, and what is not?",
    });
    assertAnswerFirstHeading(heading);
    const p = firstParagraphAfter(heading);
    expect(p.textContent).toContain("pre-alpha");
    expect(p.textContent).toContain("October 2026");
  });

  it("has three h3 subsections: Built and tested, Specified not built, Roadmap", () => {
    const { container } = render(<StatusSection />);
    expect(
      within(container).getByRole("heading", {
        level: 3,
        name: "Built and tested",
      }),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("heading", {
        level: 3,
        name: "Specified, not built",
      }),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("heading", { level: 3, name: "Roadmap" }),
    ).toBeInTheDocument();
  });

  it("the roadmap is one <ol> of twelve <li>s, no Timeline component, with an ordinal and a hairline rule per row", () => {
    const { container } = render(<StatusSection />);
    const lists = container.querySelectorAll("ol.roadmap-ledger");
    expect(lists).toHaveLength(1);
    const items = within(lists[0] as HTMLElement).getAllByRole("listitem");
    expect(items).toHaveLength(12);
    expect(within(container).getByText("01")).toBeInTheDocument();
    expect(within(container).getByText("12")).toBeInTheDocument();
    expect(css).toMatch(/\.roadmap-ledger__row[^}]*\{[^}]*border-top:/);
  });

  it("marks exactly one phase complete and one part-done, by weight and tone plus a real text label, never colour alone (A11)", () => {
    const { container } = render(<StatusSection />);
    expect(
      container.querySelectorAll(".roadmap-ledger__row--done"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(".roadmap-ledger__row--part"),
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(".roadmap-ledger__row--pending"),
    ).toHaveLength(10);
    expect(within(container).getByText("PART DONE")).toBeInTheDocument();
  });

  it("T26: the banned AI phrases never appear, and the BYOK block names Phase 9 and not built", () => {
    const { container } = render(<StatusSection />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("AI-powered");
    expect(text).not.toContain("AI question generation");
    expect(text).not.toContain("generate a test with AI");
    const byok = container.querySelector(".status-byok");
    expect(byok).not.toBeNull();
    expect(byok?.textContent).toContain("Phase 9");
    expect(byok?.textContent).toContain("not built");
  });

  it("lists the specified-not-built application surfaces with links to the PRD and roadmap", () => {
    const { container } = render(<StatusSection />);
    expect(within(container).getByText("The authoring UI")).toBeInTheDocument();
    expect(
      within(container).getByText("The candidate runtime"),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("link", { name: "PRD" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/PRD.md",
    );
    expect(
      within(container).getByRole("link", { name: "roadmap" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/ROADMAP.md",
    );
  });
});

// --- Cross-section invariants ---------------------------------------------

describe("All three sections together", () => {
  it("no emoji anywhere in rendered text (A13)", () => {
    const { container: a } = render(<CostSection />);
    const { container: b } = render(<NotForSection />);
    const { container: c } = render(<StatusSection />);
    const emoji = /\p{Extended_Pictographic}/u;
    expect(emoji.test(a.textContent ?? "")).toBe(false);
    expect(emoji.test(b.textContent ?? "")).toBe(false);
    expect(emoji.test(c.textContent ?? "")).toBe(false);
  });

  it("no inline style attribute in any of the three section components", () => {
    for (const file of [
      "../src/sections/s7-s9/CostSection.tsx",
      "../src/sections/s7-s9/NotForSection.tsx",
      "../src/sections/s7-s9/StatusSection.tsx",
    ]) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source).not.toMatch(/\sstyle=\{/);
    }
  });
});

describe("sections-s7-s9.css keeps the page's hard invariants", () => {
  it("has no hex colour literal, and every colour function reads from a token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const colorFunctionCalls =
      css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/g) ?? [];
    for (const call of colorFunctionCalls) {
      const index = css.indexOf(call);
      const slice = css.slice(index, index + 80);
      expect(slice).toMatch(/\(from var\(--color-[a-z0-9-]+\)/);
    }
  });

  it("never wraps a colour rule in @supports, @layer or @container", () => {
    expect(css).not.toMatch(/@supports/);
    expect(css).not.toMatch(/@layer/);
    expect(css).not.toMatch(/@container/);
  });

  it("never sets outline: none", () => {
    expect(css).not.toMatch(/outline:\s*none/);
  });
});
