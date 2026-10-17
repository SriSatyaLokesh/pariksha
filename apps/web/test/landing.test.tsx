import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Landing } from "../src/routes/landing";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS_PATH = resolve(__dirname, "../src/styles/tokens.css");
const LANDING_CSS_PATH = resolve(__dirname, "../src/styles/landing.css");
const FONTS_CSS_PATH = resolve(__dirname, "../src/styles/fonts.css");
const INDEX_HTML_PATH = resolve(__dirname, "../index.html");
const ADMIN_HTML_PATH = resolve(__dirname, "../admin.html");

describe("Landing", () => {
  // The brief's sketch expects the h1 itself to contain "Pariksha", but the
  // controller-authored copy (landing-content.md, which overrides the
  // brief's test sketches) puts the product name in the nav wordmark and
  // gives the h1 the hero sentence instead. This test asserts the real,
  // verbatim structure: exactly one h1 with the hero headline, and the
  // product name present elsewhere on the page.
  it("renders exactly one h1 with the hero headline, and the product name on the page", () => {
    render(<Landing />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(
      "Run real exams on the internet, for free, on infrastructure you own.",
    );
    expect(screen.getAllByText("Pariksha").length).toBeGreaterThan(0);
  });

  it("has exactly one CTA-shaped link, the hero's worked-example link", () => {
    render(<Landing />);
    const ctas = screen.getAllByRole("link", { name: /start|deploy|try/i });
    expect(ctas).toHaveLength(1);
    expect(ctas[0]).toHaveAccessibleName("Start with the worked example →");
    expect(ctas[0]).toHaveAttribute(
      "href",
      "https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude",
    );
  });

  it("the hero carries the hero-section class from the design system", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector(".hero-section")).not.toBeNull();
  });

  it("tokens.css defines the voltage colour the hero is wired to", () => {
    const css = readFileSync(TOKENS_CSS_PATH, "utf8");
    expect(css).toMatch(/--color-voltage:\s*#e24c18;/);
  });

  it("the stylesheet wires the hero background to the voltage token, not a literal", () => {
    const css = readFileSync(LANDING_CSS_PATH, "utf8");
    const heroRule = /\.hero-section\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(heroRule).not.toBe("");
    expect(heroRule).toMatch(/background:\s*var\(--color-voltage\)/);
  });

  it("every font is self-hosted under /fonts/, never a third-party origin", () => {
    const css = readFileSync(FONTS_CSS_PATH, "utf8");
    const sources = [...css.matchAll(/url\((["']?)(.*?)\1\)/g)].map(
      (match) => match[2] ?? "",
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).toEqual(
      expect.arrayContaining([expect.stringMatching(/^\/fonts\//)]),
    );
    expect(sources.some((source) => source.startsWith("http"))).toBe(false);
  });

  it("index.html and admin.html both declare lang=en", () => {
    expect(readFileSync(INDEX_HTML_PATH, "utf8")).toMatch(/<html lang="en">/);
    expect(readFileSync(ADMIN_HTML_PATH, "utf8")).toMatch(/<html lang="en">/);
  });

  it("provides a skip-to-content link targeting the main landmark", () => {
    render(<Landing />);
    const skip = screen.getByRole("link", { name: /skip to content/i });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).not.toBeNull();
  });

  it("has a sane heading order with no skipped level", () => {
    render(<Landing />);
    const headings = screen.getAllByRole("heading");
    const levels = headings.map((heading) => Number(heading.tagName[1]));
    for (let i = 1; i < levels.length; i++) {
      const previous = levels[i - 1] ?? 0;
      const current = levels[i] ?? 0;
      expect(current - previous).toBeLessThanOrEqual(1);
    }
  });

  it("has no inline style attributes anywhere in the rendered markup", () => {
    const { container } = render(<Landing />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  it("is free of axe violations", async () => {
    const { container } = render(<Landing />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
