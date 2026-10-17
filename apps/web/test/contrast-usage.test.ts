import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  tokens,
  type ColorName,
  type TypographyName,
} from "../src/styles/tokens";

// IMPORTANT (review finding, round 2): round 1 of this file kept fg/px/weight
// as hand-typed *claims* in a map, so a selector's actual `color:` could
// drift from what the map said and the test would still pass. Fixed: fg,
// font-size and font-weight are now parsed out of each selector's own
// declarations in landing.css. Only the background a selector renders on
// stays in a map — CSS cannot tell you that without a cascade engine, which
// is the one thing this file doesn't implement.
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

// The one thing CSS cannot tell you without a cascade engine: which surface
// a selector's text actually sits on. Every other property below is parsed
// from landing.css itself.
const SURFACE: Record<string, ColorName> = {
  ".wordmark__name": "canvas",
  ".wordmark__sub": "canvas",
  ".nav-link": "canvas",
  ".nav-link:hover, .nav-link:focus-visible": "cream",
  ".hero-heading": "voltage",
  ".hero-lead": "voltage",
  ".button-primary": "cream",
  ".button-primary:hover, .button-primary:focus-visible": "voltage-deep",
  ".button-secondary": "canvas",
  // Used on cream (the hero-status-band) and on canvas (card-hairline,
  // footer); cream is the lower-contrast surface.
  ".mono-caption": "cream",
  ".section-heading": "cream",
  ".feature-cell__label": "canvas",
  ".feature-cell__title": "canvas",
  ".feature-cell__body": "canvas",
  ".card-voltage__heading": "voltage",
  ".budget-note": "canvas",
  // budget-table sits inside a card-hairline (canvas); comparison-table
  // sits directly on the page (cream) — cream is the lower-contrast one.
  ".budget-table, .comparison-table": "cream",
  ".privacy-grid p": "cream",
  ".hosting-card__title": "canvas",
  ".hosting-card__body": "canvas",
  ".hosting-card__stats": "canvas",
  ".hosting-note": "cream",
  ".status-band__lead": "canvas",
  ".status-band__body": "canvas",
  ".status-band__links a": "canvas",
  ".footer-col__heading": "canvas",
  ".footer-col a": "canvas",
  ".footer-col a:hover, .footer-col a:focus-visible": "canvas",
  ".footer-col p": "canvas",
};

// Selectors whose rendered size and/or weight landing.css does not state on
// the selector itself — only because the value instead comes from another
// rule for the *same element* (a pseudo-class variant that overrides only
// colour/background) or from outside landing.css entirely (an ancestor's
// base style). Per the review ruling, the map may supply exactly this and
// nothing else — foreground and surface are still resolved independently.
const INHERITED_SIZE_WEIGHT: Record<string, { px: number; weight: number }> = {
  // Same element as .nav-link; only colour/background change on hover.
  ".nav-link:hover, .nav-link:focus-visible": { px: 16, weight: 500 },
  // Same element as .button-primary; only colour/background change.
  ".button-primary:hover, .button-primary:focus-visible": {
    px: 16,
    weight: 500,
  },
  // Same element as .footer-col a; only colour changes.
  ".footer-col a:hover, .footer-col a:focus-visible": {
    px: 14,
    weight: 400,
  },
  // No ancestor in landing.css sets a font-size; this inherits the page's
  // base body-md size (16px) from base.css.
  ".status-band__links a": { px: 16, weight: 400 },
};

// Pure wrapper selectors: every piece of text under them is an element with
// its own `color` declaration (already covered), so the wrapper's colour
// never paints anything.
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

function declarations(body: string): string[] {
  return body
    .split(";")
    .map((decl) => decl.trim())
    .filter(Boolean);
}

function findDeclaration(body: string, property: string): string | null {
  const decl = declarations(body).find((d) =>
    new RegExp(`^${property}\\s*:`, "i").test(d),
  );
  if (!decl) return null;
  return decl.slice(decl.indexOf(":") + 1).trim();
}

const COLOR_VAR_RE = /^var\(--color-([a-z0-9-]+)\)$/i;
const TYPE_SIZE_VAR_RE = /var\(--type-([a-z0-9-]+)-size\)/i;
const TYPE_WEIGHT_VAR_RE = /var\(--type-([a-z0-9-]+)-weight\)/i;

function parseColor(body: string): ColorName | null {
  const value = findDeclaration(body, "color");
  if (!value) return null;
  const match = COLOR_VAR_RE.exec(value);
  const name = match?.[1];
  if (!name || !(name in tokens.colors)) return null;
  return name as ColorName;
}

function lengthToPx(literal: string): number | null {
  const match = /^(-?[\d.]+)(px|rem)$/.exec(literal.trim());
  if (!match) return null;
  const [, num, unit] = match;
  const value = Number(num);
  return unit === "rem" ? value * 16 : value;
}

function typographyPx(name: string): number | null {
  const entry = tokens.typography[name as TypographyName] as
    { fontSize: string } | undefined;
  if (!entry) return null;
  return lengthToPx(entry.fontSize);
}

function typographyWeight(name: string): number | null {
  const entry = tokens.typography[name as TypographyName] as
    { fontWeight: number } | undefined;
  return entry?.fontWeight ?? null;
}

// Smallest size a `font-size` declaration ever renders at: for a plain
// `var(--type-X-size)` that's the token's own size; for
// `clamp(MIN, PREFERRED, var(--type-X-size))` it's MIN — the worst case for
// a contrast threshold, per the review ruling.
function parseFontSizePx(body: string): number | null {
  const value = findDeclaration(body, "font-size");
  if (!value) return null;
  const clampMatch = /^clamp\(\s*([^,]+),/i.exec(value);
  if (clampMatch?.[1]) {
    return lengthToPx(clampMatch[1]);
  }
  const varMatch = TYPE_SIZE_VAR_RE.exec(value);
  return varMatch?.[1] ? typographyPx(varMatch[1]) : null;
}

function parseFontWeight(body: string): number | null {
  const value = findDeclaration(body, "font-weight");
  if (!value) return null;
  const varMatch = TYPE_WEIGHT_VAR_RE.exec(value);
  return varMatch?.[1] ? typographyWeight(varMatch[1]) : null;
}

interface Resolved {
  fg: ColorName;
  bg: ColorName;
  px: number;
  weight: number;
}

let colorSelectors: string[];
let ruleBodies: Map<string, string>;
let resolutionErrors: string[];
let resolved: Map<string, Resolved>;

beforeAll(() => {
  const css = readFileSync(LANDING_CSS_PATH, "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const rules = parseRuleBodies(css);
  // A selector can appear more than once (e.g. a base rule plus its
  // declarations re-opened inside a @media block for reduced-motion
  // transitions) — merge bodies rather than letting a later, unrelated
  // rule for the same selector silently overwrite an earlier one.
  ruleBodies = new Map();
  for (const rule of rules) {
    const existing = ruleBodies.get(rule.selector);
    ruleBodies.set(
      rule.selector,
      existing ? `${existing};${rule.body}` : rule.body,
    );
  }
  colorSelectors = rules
    .filter((rule) => findDeclaration(rule.body, "color") !== null)
    .map((rule) => rule.selector);

  resolutionErrors = [];
  resolved = new Map();
  for (const selector of colorSelectors) {
    if (WRAPPER_SELECTORS_WITH_NO_OWN_TEXT.has(selector)) continue;
    const body = ruleBodies.get(selector) ?? "";

    const fg = parseColor(body);
    if (!fg) {
      resolutionErrors.push(
        `${selector}: cannot parse a var(--color-*) foreground from its own color declaration`,
      );
      continue;
    }

    const bg = SURFACE[selector];
    if (!bg) {
      resolutionErrors.push(`${selector}: missing a SURFACE entry`);
      continue;
    }

    const fallback = INHERITED_SIZE_WEIGHT[selector];
    const px = parseFontSizePx(body) ?? fallback?.px ?? null;
    if (px === null) {
      resolutionErrors.push(
        `${selector}: cannot resolve a font-size (not declared on the selector, and no INHERITED_SIZE_WEIGHT fallback)`,
      );
      continue;
    }

    // font-weight's CSS initial value is 400; a selector that declares no
    // font-weight of its own and has no sibling-rule fallback really does
    // render at 400 unless some ancestor says otherwise (checked by hand
    // for every selector below — none do).
    const weight = parseFontWeight(body) ?? fallback?.weight ?? 400;

    resolved.set(selector, { fg, bg, px, weight });
  }
});

describe("every colour-setting selector in landing.css is accounted for", () => {
  it("has no selector missing from SURFACE or the documented wrapper exclusions", () => {
    const unaccounted = colorSelectors.filter(
      (selector) =>
        !(selector in SURFACE) &&
        !WRAPPER_SELECTORS_WITH_NO_OWN_TEXT.has(selector),
    );
    expect(unaccounted).toEqual([]);
  });

  it("has no stale entry in SURFACE for a selector no longer in landing.css", () => {
    const stale = Object.keys(SURFACE).filter(
      (selector) => !colorSelectors.includes(selector),
    );
    expect(stale).toEqual([]);
  });
});

describe("every selector's fg/size/weight resolves cleanly from landing.css", () => {
  it("has no selector that fails to resolve (fails loudly, never skips)", () => {
    expect(resolutionErrors).toEqual([]);
  });
});

describe("every colour-on-surface usage clears its real WCAG threshold", () => {
  it("resolved at least one usage (sanity: the suite above isn't vacuous)", () => {
    expect(resolved.size).toBeGreaterThan(0);
  });

  for (const selector of Object.keys(SURFACE)) {
    it(`${selector} clears its WCAG threshold`, () => {
      const usage = resolved.get(selector);
      // Only reachable if the resolution-errors test above is already
      // failing; asserting here too gives a usage-level failure message.
      expect(usage, `${selector} did not resolve`).toBeDefined();
      if (!usage) return;
      const threshold =
        usage.px >= 24 || (usage.px >= 18.66 && usage.weight >= 700) ? 3 : 4.5;
      const ratio = contrastRatio(
        tokens.colors[usage.fg],
        tokens.colors[usage.bg],
      );
      expect(
        ratio,
        `${selector}: ${usage.fg} on ${usage.bg} at ${usage.px}px/${usage.weight} is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
      ).toBeGreaterThanOrEqual(threshold);
    });
  }
});
