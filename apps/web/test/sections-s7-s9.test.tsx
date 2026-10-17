import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CostSection } from "../src/sections/s7-s9/CostSection";
import { NotForSection } from "../src/sections/s7-s9/NotForSection";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, "../src/styles/sections-s7-s9.css");
const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// Design contract §3 S7-S9 (v2), amended by
// landing-page-v3-interactive.md §4.4-§4.5 (v3-cull.md §2-§3): S9's
// StatusSection component is deleted outright — its content merges into
// NotForSection as an h3 on #status, minus the twelve-row roadmap ledger,
// so there is no longer a separate StatusSection describe block here (a
// test asserting a band that no longer exists is removed, not skipped).

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function firstSentence(text: string): string {
  return (/^[\s\S]*?[.?!]/.exec(text.trim())?.[0] ?? text).trim();
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

function assertAnswerFirstHeading(heading: HTMLElement) {
  const text = heading.textContent ?? "";
  expect(text.endsWith("?")).toBe(true);
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

// --- CostSection (S7 / B5) ------------------------------------------------

describe("CostSection (B5)", () => {
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

  it("carries the eyebrow (v3-interactive.md §4: every band, including chapter openings)", () => {
    const { container } = render(<CostSection />);
    expect(container.querySelector(".section-eyebrow")?.textContent).toBe(
      "COST",
    );
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

  it("renders CardVoltage once and CardHairline once (the budget card — §4.4 collapses the deploy cards to plain lines)", () => {
    const { container } = render(<CostSection />);
    expect(container.querySelectorAll(".card-voltage")).toHaveLength(1);
    expect(container.querySelectorAll(".card-hairline")).toHaveLength(1);
  });

  // §4.4: CB-5 (the website's own three-line deploy snippet) is deleted;
  // its binding truth survives as a clause beside the Cloudflare line.
  it("deletes CB-5 but keeps its binding truth beside the Cloudflare line", () => {
    const { container } = render(<CostSection />);
    const text = container.textContent ?? "";
    expect(text).not.toContain("pnpm --filter @pariksha/web deploy");
    expect(text).toContain(
      "This deploys the site you are reading; the exam API is Phase 2 and not built.",
    );
  });

  // §4.4: CB-4 (`npx ajv`) lands here — the only command on the page a
  // visitor can run today that does something real.
  it("renders CB-4 verbatim in a labelled, keyboard-reachable region", () => {
    const { container } = render(<CostSection />);
    const regions = Array.from(
      container.querySelectorAll(".code-block__scroll"),
    );
    const cb4 = regions.find((r) => r.textContent?.includes("ajv-cli@5.0.0"));
    expect(cb4).toBeDefined();
    expect(cb4).toHaveAttribute("tabIndex", "0");
    expect(cb4?.textContent).toContain(
      "git clone https://github.com/SriSatyaLokesh/pariksha.git",
    );
  });

  // §4.4: the interoperability strip — four text labels, no logos.
  it("carries the four-item interoperability strip with Docker labelled planned", () => {
    const { container } = render(<CostSection />);
    const items = container.querySelectorAll(".interop-strip li");
    expect(items).toHaveLength(4);
    const text = container.textContent ?? "";
    expect(text).toContain("JSON Schema in");
    expect(text).toContain("CSV out");
    expect(text).toContain("Docker (planned, Phase 11)");
    expect(container.querySelector("img")).toBeNull();
  });

  it("carries the binding adapter-seams sentence with ADR 0002 and Phase 2 not built", () => {
    const { container } = render(<CostSection />);
    const text = container.textContent ?? "";
    expect(text).toContain("three adapter seams");
    expect(text).toContain("ADR 0002");
    expect(text).toContain("Phase 2 and not built");
  });
});

// --- NotForSection (S8+S9 / B6) -------------------------------------------

describe("NotForSection (B6 — who it is not for, and what is built)", () => {
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

  // §4.5: nine sentences now, not eight — a ninth absorbs FAQ Q9's
  // substance, and the lead paragraph's own count is updated to match.
  it("states all nine reasons as plain prose rows, not cards, rules or a list, with the four disqualifying reasons first", () => {
    const { container } = render(<NotForSection />);
    expect(container.querySelector(".not-for-list ul")).toBeNull();
    expect(container.querySelector(".not-for-list ol")).toBeNull();
    const rows = container.querySelectorAll(".not-for-list p");
    // one lead paragraph + nine reasons
    expect(rows).toHaveLength(10);
    expect(rows[0]?.textContent).toContain("nine specific situations");
    expect(rows[1]?.textContent).toMatch(/run a test this week/);
    expect(rows[2]?.textContent).toMatch(/wants somebody else to host it/);
    expect(rows[3]?.textContent).toMatch(/legally contestable/);
    expect(rows[4]?.textContent).toMatch(/sit on a phone/);
  });

  it("carries the ninth sentence absorbing FAQ Q9's substance", () => {
    const { container } = render(<NotForSection />);
    expect(container.textContent).toContain(
      "Anyone who believes browser proctoring prevents cheating.",
    );
  });

  it("does not soften the list: the sharpest line is present and unhedged", () => {
    const { container } = render(<NotForSection />);
    expect(
      within(container).getByText(
        /Anyone who wants an AI to decide who cheated\./,
      ),
    ).toBeInTheDocument();
  });

  // §4.5: the merged #status h3, carrying S9 minus the roadmap ledger.
  it("carries an h3 on #status with the dated release paragraph (pre-alpha, October 2026)", () => {
    const { container } = render(<NotForSection />);
    const heading = container.querySelector("h3#status");
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe("What is built today, and what is not?");
    const p = heading!.nextElementSibling;
    expect(p?.tagName).toBe("P");
    expect(p?.textContent).toContain("pre-alpha");
    expect(p?.textContent).toContain("October 2026");
  });

  it("has four h4 subsections: Built and tested, Specified not built — no 'Roadmap' heading survives", () => {
    const { container } = render(<NotForSection />);
    expect(
      within(container).getByRole("heading", {
        level: 4,
        name: "Built and tested",
      }),
    ).toBeInTheDocument();
    expect(
      within(container).getByRole("heading", {
        level: 4,
        name: "Specified, not built",
      }),
    ).toBeInTheDocument();
    expect(
      within(container).queryByRole("heading", { name: "Roadmap" }),
    ).toBeNull();
  });

  // v3-cull.md §3: the twelve-row ledger is gone outright; one sentence and
  // a link to docs/ROADMAP.md replace it.
  it("deletes the twelve-row roadmap ledger, replacing it with one sentence and a roadmap link", () => {
    const { container } = render(<NotForSection />);
    expect(container.querySelector(".roadmap-ledger")).toBeNull();
    expect(container.querySelector("ol")).toBeNull();
    const text = container.textContent ?? "";
    expect(text).toContain(
      "Twelve build phases under four milestones; one is complete and a second part done",
    );
    expect(
      within(container).getAllByRole("link", { name: /roadmap/i })[0],
    ).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/blob/main/docs/ROADMAP.md",
    );
  });

  // §4.2/§4.5: the contributor-facing coverage tuple does not go on the
  // landing page, in the merged Built-and-tested list either.
  it("does not print the coverage tuple", () => {
    const { container } = render(<NotForSection />);
    expect(container.textContent).not.toMatch(/97\/93\/100\/98/);
  });

  it("T26: the banned AI phrases never appear, and the BYOK block names Phase 9 and not built", () => {
    const { container } = render(<NotForSection />);
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
    const { container } = render(<NotForSection />);
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
  });
});

// --- Cross-section invariants ---------------------------------------------

describe("CostSection and NotForSection together", () => {
  it("no emoji anywhere in rendered text (A13)", () => {
    const { container: a } = render(<CostSection />);
    const { container: b } = render(<NotForSection />);
    const emoji = /\p{Extended_Pictographic}/u;
    expect(emoji.test(a.textContent ?? "")).toBe(false);
    expect(emoji.test(b.textContent ?? "")).toBe(false);
  });

  it("no inline style attribute in either section component", () => {
    for (const file of [
      "../src/sections/s7-s9/CostSection.tsx",
      "../src/sections/s7-s9/NotForSection.tsx",
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
