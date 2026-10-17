import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tokens, type ColorName } from "../src/styles/tokens";

// IMPORTANT (review finding): the contrast test in contrast.test.ts only
// checks that tokens.ts's stated ratios are arithmetically true — it says
// nothing about *where* a colour pair is actually used in landing.css.
// This file closes that gap: it maps every text-bearing selector in
// landing.css to the surface it renders on and the size/weight it renders
// at, then asserts the real WCAG threshold for that size. It is also
// self-maintaining — it parses landing.css itself and fails if a new
// selector sets `color` without being added to COLOR_USAGE.
//
// Record for the gate's limits: axe-core under jsdom cannot evaluate
// contrast at all (jsdom has no layout engine and no canvas backend), so
// the landing.test.tsx axe pass gives zero contrast coverage. This file is
// the only place contrast-by-usage is actually checked.

const __dirname = dirname(fileURLToPath(import.meta.url));
const LANDING_CSS_PATH = resolve(__dirname, "../src/styles/landing.css");

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

interface Usage {
  fg: ColorName;
  bg: ColorName;
  px: number;
  weight: number;
}

// Every text-bearing selector in landing.css that sets a `color:` property,
// mapped to the surface it is actually painted on (the worst-case surface,
// where a class is reused over more than one background) and the font
// size/weight it renders at (the smallest size, where a class is reused at
// more than one size via a responsive clamp()).
const COLOR_USAGE: Record<string, Usage> = {
  ".wordmark__name": { fg: "ink", bg: "canvas", px: 22, weight: 500 },
  ".wordmark__sub": { fg: "muted", bg: "canvas", px: 12, weight: 400 },
  ".nav-link": { fg: "muted", bg: "canvas", px: 16, weight: 500 },
  ".nav-link:hover, .nav-link:focus-visible": {
    fg: "ink",
    bg: "cream",
    px: 16,
    weight: 500,
  },
  // Hero headline: clamp(2rem, 1.2rem + 4vw, 56px) — 2rem (32px) is the
  // smallest it ever renders.
  ".hero-heading": { fg: "cream", bg: "voltage", px: 32, weight: 500 },
  ".hero-lead": { fg: "cream", bg: "voltage", px: 24, weight: 400 },
  ".button-primary": { fg: "ink", bg: "cream", px: 16, weight: 500 },
  ".button-primary:hover, .button-primary:focus-visible": {
    fg: "cream",
    bg: "voltage-deep",
    px: 16,
    weight: 500,
  },
  ".button-secondary": { fg: "ink", bg: "canvas", px: 16, weight: 500 },
  // Used on cream (the hero-status-band) and on canvas (inside
  // card-hairline, and the footer); cream is the lower-contrast surface.
  ".mono-caption": { fg: "muted", bg: "cream", px: 12, weight: 400 },
  // clamp(1.75rem, 1.3rem + 2.5vw, 56px) — 1.75rem (28px) is the floor.
  ".section-heading": { fg: "ink", bg: "cream", px: 28, weight: 500 },
  ".feature-cell__label": { fg: "muted", bg: "canvas", px: 12, weight: 400 },
  ".feature-cell__title": { fg: "ink", bg: "canvas", px: 18, weight: 500 },
  ".feature-cell__body": { fg: "ink", bg: "canvas", px: 16, weight: 400 },
  // clamp(1.75rem, 1.3rem + 2.5vw, 44px) — 1.75rem (28px) is the floor.
  ".card-voltage__heading": { fg: "cream", bg: "voltage", px: 28, weight: 500 },
  ".budget-note": { fg: "ink", bg: "canvas", px: 16, weight: 400 },
  // budget-table sits inside a card-hairline (canvas); comparison-table
  // sits directly on the page (cream) — cream is the lower-contrast one.
  ".budget-table, .comparison-table": {
    fg: "ink",
    bg: "cream",
    px: 14,
    weight: 400,
  },
  ".privacy-grid p": { fg: "ink", bg: "cream", px: 16, weight: 400 },
  ".hosting-card__title": { fg: "ink", bg: "canvas", px: 18, weight: 500 },
  ".hosting-card__body": { fg: "ink", bg: "canvas", px: 16, weight: 400 },
  ".hosting-card__stats": { fg: "muted", bg: "canvas", px: 12, weight: 400 },
  ".hosting-note": { fg: "muted", bg: "cream", px: 16, weight: 400 },
  ".status-band__lead": { fg: "ink", bg: "canvas", px: 22, weight: 500 },
  ".status-band__body": { fg: "ink", bg: "canvas", px: 16, weight: 400 },
  ".status-band__links a": {
    fg: "voltage-deep",
    bg: "canvas",
    px: 16,
    weight: 500,
  },
  ".footer-col__heading": { fg: "ink", bg: "canvas", px: 18, weight: 500 },
  ".footer-col a": { fg: "muted", bg: "canvas", px: 14, weight: 400 },
  ".footer-col a:hover, .footer-col a:focus-visible": {
    fg: "ink",
    bg: "canvas",
    px: 14,
    weight: 400,
  },
  ".footer-col p": { fg: "muted", bg: "canvas", px: 14, weight: 400 },
};

// These selectors set `color` but are pure wrapper elements: every actual
// piece of text under them is an element with its own `color` declaration
// (already covered above), so the wrapper's own colour is never used to
// paint anything. Excluded per the review's allowance for selectors that
// "set color on something with no text content."
const WRAPPER_SELECTORS_WITH_NO_OWN_TEXT = new Set([
  ".feature-cell", // children: .feature-cell__label/__title/__body, each coloured
  ".card-hairline", // every usage wraps only child elements, never bare text
  ".card-voltage", // its only child, .card-voltage__heading, sets its own color
]);

function parseRuleBodies(
  css: string,
): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  let i = 0;
  while (i < css.length) {
    const openIdx = css.indexOf("{", i);
    if (openIdx === -1) break;
    const selector = css.slice(i, openIdx).replace(/\s+/g, " ").trim();
    let depth = 1;
    let j = openIdx + 1;
    while (depth > 0 && j < css.length) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(openIdx + 1, j - 1);
    if (selector.startsWith("@media")) {
      rules.push(...parseRuleBodies(body));
    } else if (selector) {
      rules.push({ selector, body });
    }
    i = j;
  }
  return rules;
}

function declaresColor(body: string): boolean {
  return body
    .split(";")
    .map((decl) => decl.trim())
    .some((decl) => /^color\s*:/i.test(decl));
}

let colorSelectors: string[];

beforeAll(() => {
  const css = readFileSync(LANDING_CSS_PATH, "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const rules = parseRuleBodies(css);
  colorSelectors = rules
    .filter((rule) => declaresColor(rule.body))
    .map((rule) => rule.selector);
});

describe("every colour-setting selector in landing.css is accounted for", () => {
  it("has no selector missing from COLOR_USAGE or the documented wrapper exclusions", () => {
    const unaccounted = colorSelectors.filter(
      (selector) =>
        !(selector in COLOR_USAGE) &&
        !WRAPPER_SELECTORS_WITH_NO_OWN_TEXT.has(selector),
    );
    expect(unaccounted).toEqual([]);
  });

  it("has no stale entry in COLOR_USAGE for a selector no longer in landing.css", () => {
    const stale = Object.keys(COLOR_USAGE).filter(
      (selector) => !colorSelectors.includes(selector),
    );
    expect(stale).toEqual([]);
  });
});

describe("every colour-on-surface usage clears its real WCAG threshold", () => {
  for (const [selector, usage] of Object.entries(COLOR_USAGE)) {
    const threshold =
      usage.px >= 24 || (usage.px >= 18.66 && usage.weight >= 700) ? 3 : 4.5;
    it(`${selector} (${usage.fg} on ${usage.bg}, ${usage.px}px/${usage.weight}) clears ${threshold}:1`, () => {
      const ratio = contrastRatio(
        tokens.colors[usage.fg],
        tokens.colors[usage.bg],
      );
      expect(ratio).toBeGreaterThanOrEqual(threshold);
    });
  }
});
