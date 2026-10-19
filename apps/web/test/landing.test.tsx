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

const REPO = "https://github.com/SriSatyaLokesh/pariksha";
const HERO_HEADING = "Run real exams on infrastructure you own.";

// landing.css carries no rules of its own any more — the Signal rebuild
// left it importing primitives.css and signal.css only — so a test that
// wants "the effective stylesheet" has to follow the @import chain itself
// rather than reading one file.
function resolveStylesheet(entryPath: string, seen = new Set<string>()): string {
  if (seen.has(entryPath)) return "";
  seen.add(entryPath);
  const css = readFileSync(entryPath, "utf8");
  const dir = dirname(entryPath);
  const imports = [...css.matchAll(/@import\s+["']([^"']+)["'];/g)].map(
    (match) => match[1] ?? "",
  );
  const importedCss = imports
    .map((target) => resolveStylesheet(resolve(dir, target), seen))
    .join("\n");
  const ownCss = css.replace(/@import\s+["'][^"']+["'];/g, "");
  return `${importedCss}\n${ownCss}`;
}

describe("Landing", () => {
  // The h1 is the one verbatim string the Signal rebuild commits to.
  it("renders exactly one h1 with the verbatim hero heading", () => {
    render(<Landing />);
    const headings = screen.getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe(HERO_HEADING);
    expect(screen.getAllByText("Pariksha").length).toBeGreaterThan(0);
  });

  // Every external CTA (an http(s) link) points at the real repo, never a
  // product that does not exist yet; the nav's CTA is the one exception,
  // an in-page anchor to #start rather than an external link.
  it("every external CTA points at the real repo; the nav CTA is an in-page anchor", () => {
    const { container } = render(<Landing />);
    const ctaLinks = container.querySelectorAll("a.signal-btn");
    expect(ctaLinks.length).toBeGreaterThan(0);
    for (const link of ctaLinks) {
      const href = link.getAttribute("href") ?? "";
      if (href.startsWith("http")) {
        expect(href).toMatch(/^https:\/\/github\.com\/SriSatyaLokesh\/pariksha/);
      } else {
        expect(href).toBe("#start");
      }
    }
  });

  // The page's root wrapper carries the signal class the design system is
  // built on.
  it("the page carries the signal class from the design system", () => {
    const { container } = render(<Landing />);
    expect(container.querySelector(".signal")).not.toBeNull();
  });

  // tokens.css defines the signal-bg colour the page is wired to.
  it("tokens.css defines the signal-bg colour the page is wired to", () => {
    const css = readFileSync(TOKENS_CSS_PATH, "utf8");
    expect(css).toMatch(/--color-signal-bg:\s*#070b09;/);
  });

  // The hard invariant (§7, carried forward): the first .signal rule in the
  // effective stylesheet stays flat and keeps the literal declaration
  // background: var(--color-signal-bg) — never behind @supports/@layer/
  // @container, which would silently bypass the contrast guard.
  it("the effective stylesheet's first .signal rule is flat and wires the signal-bg token", () => {
    const css = resolveStylesheet(LANDING_CSS_PATH);
    const signalRule = /\.signal\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(signalRule).not.toBe("");
    expect(signalRule).toMatch(/background:\s*var\(--color-signal-bg\)/);
  });

  // T21 (#6): every font is self-hosted under /fonts/, never a third-party
  // origin.
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

  // T21 (#7) / SEO-16: British spelling is a project rule, so the public
  // landing page says so in its lang attribute. admin.html is never
  // prerendered or indexed (§9.7 leaves its lang to the implementer) and
  // keeps lang=en, unchanged.
  it("index.html declares lang=en-GB; admin.html keeps lang=en", () => {
    expect(readFileSync(INDEX_HTML_PATH, "utf8")).toMatch(
      /<html lang="en-GB">/,
    );
    expect(readFileSync(ADMIN_HTML_PATH, "utf8")).toMatch(/<html lang="en">/);
  });

  // T21 (#8): the skip link survives.
  it("provides a skip-to-content link targeting the main landmark", () => {
    render(<Landing />);
    const skip = screen.getByRole("link", { name: /skip to content/i });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).not.toBeNull();
  });

  // T21 (#9): heading order, no level skipped.
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

  // T21 (#10): zero [style] attributes anywhere in the rendered markup.
  it("has no inline style attributes anywhere in the rendered markup", () => {
    const { container } = render(<Landing />);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
  });

  // T21 (#11): zero axe violations.
  it("is free of axe violations", async () => {
    const { container } = render(<Landing />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  }, 20_000);
});
