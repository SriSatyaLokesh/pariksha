import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Faq } from "../src/sections/s10-s12/Faq";
import { Closing } from "../src/sections/s10-s12/Closing";
import { Footer } from "../src/sections/s10-s12/Footer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../src/styles/sections-s10-s12.css");
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// --- shared helpers, mirroring the mechanical proxies §8 (T23/T23b/T26b) specify ---

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// A sentence ends at '.', '!' or '?' followed by whitespace or end-of-string —
// so "Apache-2.0," and "v0.1" don't get mistaken for a sentence boundary.
function firstSentence(text: string): string {
  const match = /^.*?[.!?](?=\s|$)/.exec(text.trim());
  return match ? match[0] : text.trim();
}

const QUALIFIERS = [
  "estimate",
  "target",
  "specified",
  "v0.1",
  "v0.3",
  "pre-alpha",
];

function assertQualifiedNearby(text: string, needle: string | RegExp) {
  const re =
    typeof needle === "string"
      ? new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")
      : needle;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const windowStart = Math.max(0, match.index - 200);
    const windowEnd = Math.min(text.length, match.index + match[0].length + 200);
    const window = text.slice(windowStart, windowEnd).toLowerCase();
    const hasQualifier = QUALIFIERS.some((q) => window.includes(q));
    expect(hasQualifier, `"${match[0]}" at ${match.index} has no qualifier within 200 chars`).toBe(
      true,
    );
  }
}

// --- S10 — Questions and answers ---------------------------------------

describe("S10 Faq", () => {
  it("renders #faq, aria-labelledby its own heading, with the verbatim h2 text", () => {
    const { container } = render(<Faq />);
    const section = container.querySelector("section#faq");
    expect(section).not.toBeNull();
    expect(section).toHaveAttribute("aria-labelledby", "faq-heading");
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Questions and answers");
    expect(heading.id).toBe("faq-heading");
  });

  // v3-interactive.md §4.6: cut from thirteen to nine pairs — Q3, Q4, Q9
  // and Q15 are deleted outright.
  it("has exactly nine question-shaped h3s", () => {
    render(<Faq />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(9);
    for (const h of headings) {
      expect(h.textContent?.trim().endsWith("?")).toBe(true);
    }
  });

  it("deletes Q3, Q4, Q9 and Q15 outright", () => {
    render(<Faq />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/What does "Pariksha" mean\?/);
    expect(text).not.toMatch(/How much does it cost to run\?/);
    expect(text).not.toMatch(/Can browser proctoring actually prevent cheating\?/);
    expect(text).not.toMatch(
      /What licence is it under, and can I sell a service built on it\?/,
    );
  });

  it("T23b: every h3 is immediately followed by a <p> whose first sentence contains Pariksha", () => {
    const { container } = render(<Faq />);
    const headings = Array.from(container.querySelectorAll("h3"));
    expect(headings.length).toBeGreaterThan(0);
    for (const h of headings) {
      const p = h.nextElementSibling;
      expect(p?.tagName).toBe("P");
      const sentence = firstSentence(p?.textContent ?? "");
      expect(sentence).toContain("Pariksha");
    }
  });

  it("T23: the first <p> after the h2 is 40-60 words and its first sentence names Pariksha (heading is allow-listed)", () => {
    const { container } = render(<Faq />);
    const heading = container.querySelector("h2");
    let node: Element | null = heading;
    let firstP: Element | null = null;
    while (node) {
      node = node.nextElementSibling;
      if (!node) break;
      firstP = node.querySelector("p");
      if (firstP) break;
    }
    expect(firstP).not.toBeNull();
    const text = firstP?.textContent ?? "";
    const words = wordCount(text);
    expect(words).toBeGreaterThanOrEqual(40);
    expect(words).toBeLessThanOrEqual(60);
    expect(firstSentence(text)).toContain("Pariksha");
  });

  it("every answer paragraph is between 40 and 60 words", () => {
    const { container } = render(<Faq />);
    const paragraphs = Array.from(container.querySelectorAll("h3 + p"));
    expect(paragraphs).toHaveLength(9);
    for (const p of paragraphs) {
      const words = wordCount(p.textContent ?? "");
      expect(words).toBeGreaterThanOrEqual(40);
      expect(words).toBeLessThanOrEqual(60);
    }
  });

  it("names Mettl, HackerEarth and Testlify once each (Q11) and Google Forms plus Microsoft Forms (Q10)", () => {
    render(<Faq />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Mettl");
    expect(text).toContain("HackerEarth");
    expect(text).toContain("Testlify");
    expect(text).toContain("Google Forms");
    expect(text).toContain("Microsoft Forms");
  });

  it("declines accordions, tabs and <details> — everything stays visible to a crawler", () => {
    const { container } = render(<Faq />);
    expect(container.querySelector("details")).toBeNull();
    expect(container.querySelector("[role='tablist']")).toBeNull();
    expect(container.querySelectorAll("[hidden]")).toHaveLength(0);
  });

  it("T26: the banned AI-hype phrases never appear", () => {
    render(<Faq />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/AI-powered/);
    expect(text).not.toMatch(/AI question generation/);
    expect(text).not.toMatch(/generate a test with AI/);
  });

  it("T26b: every 500 / zero hosting cost / 12 question types sits within 200 chars of a qualifier", () => {
    render(<Faq />);
    const text = document.body.textContent ?? "";
    assertQualifiedNearby(text, /\b500\b/g);
    assertQualifiedNearby(text, /zero hosting cost/gi);
    assertQualifiedNearby(text, /12 question types/gi);
  });

  it("A13: no emoji anywhere in the rendered text", () => {
    render(<Faq />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("has zero axe violations", async () => {
    const { container } = render(
      <main>
        <Faq />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

// --- B8 — the ask (formerly S11 Closing) -----------------------------------

// v3-interactive.md §4.7: four elements and nothing else — a declarative
// heading, one filled button, one secondary text link ("watch the
// repository for v0.1"), and one mono honesty line last. M-4 (the five-file
// listing) is deleted outright — no artefact in the closing band.
describe("B8 Closing — the ask", () => {
  it("is the HeroSection's display-lg variant with the verbatim heading", () => {
    const { container } = render(<Closing />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Read one real test, end to end.");
    const section = container.querySelector(".hero-section");
    expect(section).toHaveClass("hero-section--display-lg");
    expect(section).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("the primary CTA points at the worked example on github.com/SriSatyaLokesh/pariksha", () => {
    render(<Closing />);
    const link = screen.getByRole("link", {
      name: "Start with the worked example",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude",
    );
  });

  it("carries one secondary text link watching the repository for v0.1", () => {
    render(<Closing />);
    const link = screen.getByRole("link", {
      name: /Watch the repository for v0\.1/,
    });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha",
    );
  });

  // §4.7: no artefact — M-4's file listing is gone outright.
  it("renders no file listing and no code block (M-4 deleted)", () => {
    const { container } = render(<Closing />);
    expect(container.querySelector(".closing-files")).toBeNull();
    expect(container.querySelector(".code-block")).toBeNull();
  });

  it("carries one mono honesty line as the last element, naming pre-alpha and v0.1", () => {
    const { container } = render(<Closing />);
    const honesty = container.querySelector(".closing-honesty");
    expect(honesty).not.toBeNull();
    expect(honesty?.textContent).toContain("Pre-alpha");
    expect(honesty?.textContent).toContain("v0.1");
  });

  it("A13: no emoji anywhere", () => {
    render(<Closing />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("has zero axe violations", async () => {
    const { container } = render(
      <main>
        <Closing />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

// --- S12 — Footer -----------------------------------------------------------

describe("S12 Footer", () => {
  it("renders #docs with a visually-hidden h2 reading exactly Footer", () => {
    const { container } = render(<Footer />);
    const footer = container.querySelector("footer#docs");
    expect(footer).not.toBeNull();
    const heading = footer?.querySelector("h2");
    expect(heading).toHaveClass("visually-hidden");
    expect(heading?.textContent).toBe("Footer");
  });

  // T23 exempts the three allow-listed headings entirely (contract §8, D4),
  // so the footer carries no paragraph to assert on.

  it("has three columns — Documentation (with schemas and roadmap), Project, Licence", () => {
    render(<Footer />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    const names = headings.map((h) => h.textContent);
    expect(names).toEqual(["Documentation", "Project", "Licence"]);
    expect(
      screen.getByRole("link", { name: "Schemas" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/tree/main/schemas",
    );
    expect(
      screen.getByRole("link", { name: "Roadmap" }),
    ).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/ROADMAP.md",
    );
  });

  // v3-interactive.md §4.6: mitigates FAQ Q15's deletion — the explicit
  // patent grant and commercial-use strings survive here.
  it("carries the Q15-mitigating licence sentence (patent grant, commercial use)", () => {
    const { container } = render(<Footer />);
    const text = container.textContent ?? "";
    expect(text).toContain("explicit patent grant");
    expect(text).toMatch(/sell a service built on it/);
    expect(text).toContain("is not licensed with the code");
  });

  it("carries the Telugu and Devanagari closing gloss with lang attributes", () => {
    const { container } = render(<Footer />);
    const te = container.querySelector("[lang='te']");
    const hi = container.querySelector("[lang='hi']");
    expect(te).toHaveTextContent("పరీక్ష");
    expect(hi).toHaveTextContent("परीक्षा");
  });

  it("A13: no emoji anywhere", () => {
    render(<Footer />);
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("has zero axe violations", async () => {
    const { container } = render(<Footer />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// --- The hard invariants, scoped to this file's own stylesheet and components ---

describe("sections-s10-s12.css and components keep the page's hard invariants", () => {
  it("has no hex colour literal, and every colour function reads from a token", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const colorFunctionCalls = css.match(/\b(?:rgb|rgba|hsl|hsla|oklch|lab)\(/g) ?? [];
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

  it("has no inline style attribute in any of the three new section components", () => {
    const files = [
      "../src/sections/s10-s12/Faq.tsx",
      "../src/sections/s10-s12/Closing.tsx",
      "../src/sections/s10-s12/Footer.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source).not.toMatch(/\sstyle=\{/);
    }
  });
});
