import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  tokens,
  type ColorName,
  type TypographyName,
} from "../src/styles/tokens";

// Design contract §8 T27: the stylesheet was rewritten (landing.css now only
// carries page rhythm and the five untouched "reused unchanged" components,
// §6 — everything else lives in components.css, blocks.css and four
// sections-*.css partials, pulled in by landing.css's own @import chain), so
// the SURFACE map is rewritten wholesale rather than patched. Every key
// names the background its selector really renders on, checked against the
// TSX that places it — not assumed from the class name.
//
// IMPORTANT (carried over from round 2 of the original file): fg, font-size
// and font-weight are parsed out of each selector's own declarations, never
// hand-typed as a claim that could drift from the CSS. Only the background —
// the one fact CSS cannot state without a cascade engine, which this file
// doesn't implement — lives in a map, and SURFACE can name more than one
// background for a selector that genuinely renders on different surfaces in
// different places (the four syntax-colour roles, A3's explicit requirement;
// `.code-block__pre` itself, same reason). Every surface listed for a
// selector gets its own WCAG assertion.
//
// Record for the gate's limits: axe-core under jsdom cannot evaluate
// contrast at all (jsdom has no layout engine and no canvas backend), so
// the landing.test.tsx axe pass gives zero contrast coverage. This file is
// the only place contrast-by-usage is actually checked (A1).

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = resolve(__dirname, "../src/styles");
const LANDING_CSS_PATH = resolve(STYLES_DIR, "landing.css");

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

// landing.css no longer carries any component's rules itself (besides the
// five "reused unchanged" ones, §6) — it only @imports the files that do.
// Inlining those imports here is what makes "every selector in landing.css"
// still mean the whole rendered stylesheet, matching what Vite actually
// bundles. base.css and fonts.css are deliberately NOT in this chain (they
// never were, even before the split) — they're a separate top-level import
// in main.tsx, not part of landing.css's own tree.
const IMPORT_RE = /@import\s+["']\.\/([a-zA-Z0-9_-]+\.css)["'];?/g;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function readResolvedCss(path: string, seen: Set<string> = new Set()): string {
  if (seen.has(path)) return ""; // guard against an accidental import cycle
  seen.add(path);
  const raw = stripComments(readFileSync(path, "utf8"));
  return raw.replace(IMPORT_RE, (_whole, file: string) =>
    readResolvedCss(resolve(dirname(path), file), seen),
  );
}

// A selector's declared colour can render on more than one real background
// (the four syntax-colour roles and the code block they live in, A3's
// explicit requirement) — SURFACE may name one background or several, and
// every one gets its own WCAG assertion below.
const SURFACE: Record<string, ColorName | ColorName[]> = {
  // ---- components.css: top nav -----------------------------------------
  ".wordmark__name": "canvas",
  ".wordmark__sub": "canvas",
  ".nav-link": "canvas",
  ".nav-link:hover, .nav-link:focus-visible": "cream",

  // ---- components.css: hero ----------------------------------------------
  // .hero-chip sets its own background (cream); .hero-heading/.hero-lead sit
  // directly on the hero's voltage fill in both the S1 (display-xl) and S11
  // (display-lg) instance — same ambient background either way.
  ".hero-chip": "cream",
  ".hero-heading": "voltage",
  ".hero-lead": "voltage",

  // ---- components.css: section heading -----------------------------------
  // Used on both cream bands (S2, S3, S5, S6, S7, S8, S10) and canvas bands
  // (S4, S6, S9) — cream is cream's own token, strictly the lower-luminance
  // of the two (#fffbf5 vs #ffffff), so it's the binding case for any fixed
  // dark foreground: a pass on cream is a pass on canvas too.
  ".section-eyebrow": "cream",
  ".section-heading": "cream",

  // ---- components.css: button primary ------------------------------------
  // Both set their own background; ambient section never matters.
  ".button-primary": "cream",
  ".button-primary:hover, .button-primary:focus-visible": "voltage-deep",
  ".button-primary--surface": "voltage-deep",

  // ---- blocks.css: CodeBlock ----------------------------------------------
  // The caption and footer bars declare their own cream background always.
  // .code-block__pre's background comes from its ancestor .code-block__scroll
  // instead — canvas normally, cream on the voltage variant (A3) — so its
  // colour (and the four syntax-colour spans inside it, which inherit the
  // same ancestor) is checked on both.
  ".code-block__caption": "cream",
  ".code-block__pre": ["canvas", "cream"],
  ".code-block__footer": "cream",
  // The voltage variant's caption detaches above the cream plane and sits
  // directly on the hero's voltage fill instead (U §3.3) — at hero-lead
  // (24px), which is what makes cream-on-voltage legal here (A2).
  ".code-block--voltage .code-block__caption": "voltage",
  ".tok-key": ["canvas", "cream"],
  ".tok-string": ["canvas", "cream"],
  ".tok-number": ["canvas", "cream"],
  ".tok-punct": ["canvas", "cream"],

  // ---- blocks.css: StepRow (S3 only) --------------------------------------
  ".step-row__ordinal": "cream",
  ".step-row__title": "cream",
  ".step-row__body": "cream",

  // ---- blocks.css: ComparisonTable (S4, ambient #comparison = canvas) -----
  ".comparison-table thead th": "canvas",
  '.comparison-table tbody th[scope="row"]': "canvas",
  ".comparison-table tbody td": "canvas",
  // Sets its own cream background (the Pariksha column's typographic
  // highlight, A11).
  ".comparison-table__cell--highlight": "cream",
  ".comparison-table__footnote": "canvas",

  // ---- sections-s1-s3.css: S2 ---------------------------------------------
  ".numeral-row__value": "cream",

  // ---- sections-s1-s3.css: S3 (cream) -------------------------------------
  ".step-row__caption": "cream",
  ".results-table th, .results-table td": "canvas", // .results-table sets its own canvas bg
  ".results-table thead th": "canvas",
  ".integrity-badge-clean": "canvas",
  ".integrity-badge-review": "canvas",
  ".integrity-badge-risk": "canvas",

  // ---- sections-s1-s3.css: runner mock (M-1, aria-hidden, S1) -------------
  // .runner-mock itself sets background: cream (it's a card on the voltage
  // hero); individual squares/options set their own canvas where noted.
  ".runner-mock__section, .runner-mock__points, .runner-mock__saved, .runner-mock__candidate":
    "cream",
  ".runner-mock__timer": "cream",
  ".runner-mock__question-of": "cream",
  ".runner-mock__stem": "cream",
  ".runner-mock__option": "canvas",
  ".runner-mock__square": "canvas",
  ".runner-mock__square--answered": "state-answered",
  ".runner-mock__square--marked": "state-marked",
  ".runner-mock__square--current": "canvas",
  ".runner-mock__square--locked": "canvas",

  // ---- sections-s4-s6.css: S4 (ambient #comparison = canvas) --------------
  ".comparison-intro": "canvas",
  ".comparison-conclusion p": "canvas",

  // ---- sections-s4-s6.css: S5 (ambient #features = cream) -----------------
  ".feature-lead": "cream",

  // ---- sections-s4-s6.css: S6 (ambient #no-code = canvas) -----------------
  ".no-code-pull-quote": "canvas",
  ".no-code-ux-list, .no-code-format-list": "canvas",
  // The editor mock (M-2, aria-hidden): .editor-mock itself sets its own
  // canvas background; .editor-mock__input sets its own cream.
  ".editor-mock__tab": "canvas",
  ".editor-mock__tab--active": "canvas",
  ".editor-mock__field-label": "canvas",
  ".editor-mock__input": "cream",
  ".editor-mock__option": "canvas",

  // ---- sections-s7-s9.css: S7 (ambient #cost = cream) ---------------------
  // The budget note/table and the two deploy card selectors sit inside a
  // CardHairline, which sets its own canvas background; the architecture and
  // risk paragraphs sit directly on the section (cream).
  ".cost-budget-note": "canvas",
  ".cost-budget-table th, .cost-budget-table td": "canvas",
  '.cost-budget-table th[scope="col"]': "canvas",
  ".cost-deploy-card__title": "canvas",
  ".cost-deploy-card__body": "canvas",
  ".cost-architecture, .cost-risk": "cream",

  // ---- sections-s7-s9.css: S8 (ambient #not-for = cream) ------------------
  ".not-for-list p": "cream",

  // ---- sections-s7-s9.css: S9 (ambient #status = canvas) ------------------
  ".status-group__heading": "canvas",
  ".status-group__lead, .status-group__links, .status-byok-note": "canvas",
  ".status-list": "canvas",
  ".roadmap-ledger__milestone": "canvas",
  ".roadmap-ledger__row--pending .roadmap-ledger__title": "canvas",
  ".roadmap-ledger__row--done .roadmap-ledger__title, .roadmap-ledger__row--part .roadmap-ledger__title":
    "canvas",

  // ---- sections-s10-s12.css: S10 (ambient #faq = cream) -------------------
  ".faq-item__question": "cream",
  ".faq-item__answer": "cream",

  // ---- sections-s10-s12.css: S11 (the hero's own cream mock plane) --------
  ".closing-files__name": "cream",
  ".closing-files__lines": "cream",
  ".closing-files__detail": "cream",

  // ---- sections-s10-s12.css: S12 (.site-footer sets its own canvas) ------
  ".footer-col__heading": "canvas",
  ".footer-col a": "canvas",
  ".footer-col p": "canvas",

  // ---- landing.css: page rhythm + reused-unchanged (§6) -------------------
  // Used on cream (S2's numeral labels, the Apache-2.0 caption) and on
  // canvas (the comparison footnote, roadmap rows, the footer closing line)
  // — cream is the lower-luminance surface, the binding case.
  ".mono-caption": "cream",
  ".button-secondary": "canvas",
  ".feature-cell__label": "canvas",
  ".feature-cell__title": "canvas",
  ".feature-cell__body": "canvas",
  ".card-voltage__heading": "voltage",
};

// Selectors whose rendered size and/or weight landing.css's bundle does not
// state on the selector itself — only because the value instead comes from
// another rule for the *same element* (a pseudo-class or state variant that
// overrides only colour/background/border; a shared variant class always
// co-applied with a sibling base class; a literal, non-token font-size the
// size parser below cannot read) or from outside the bundle entirely (the
// page's default body text). Per the original review ruling, the map may
// supply exactly this and nothing else — foreground and surface are still
// resolved independently, from the selector's own declarations.
const INHERITED_SIZE_WEIGHT: Record<string, { px: number; weight: number }> = {
  // Same element as .nav-link; only colour/background change on hover.
  ".nav-link:hover, .nav-link:focus-visible": { px: 16, weight: 500 },
  // Same element as .button-primary; only colour/background change.
  ".button-primary:hover, .button-primary:focus-visible": {
    px: 16,
    weight: 500,
  },
  // Same element as .button-primary (the surface variant adds a class, it
  // doesn't replace one).
  ".button-primary--surface": { px: 16, weight: 500 },
  // Size lives on the co-applied `--display-xl`/`--display-lg` variant class,
  // never on `.hero-heading` itself; the smaller of the two clamp floors
  // (display-lg, 1.75rem) is the conservative case, still comfortably >=24px.
  ".hero-heading": { px: 28, weight: 500 },
  // Same story: size lives on the co-applied `--chapter`/`--band` variant.
  // The smaller of the two (band, heading-md) is the conservative case.
  ".section-heading": { px: 22, weight: 500 },
  // The four syntax-colour spans set colour only; size/weight come from
  // their ancestor .code-block__pre (mono-md, 15px/400).
  ".tok-key": { px: 15, weight: 400 },
  ".tok-string": { px: 15, weight: 400 },
  ".tok-number": { px: 15, weight: 400 },
  ".tok-punct": { px: 15, weight: 400 },
  // Each sets colour and border-colour only; size/weight come from the
  // shared group rule (mono-sm, 12px/400).
  ".integrity-badge-clean": { px: 12, weight: 400 },
  ".integrity-badge-review": { px: 12, weight: 400 },
  ".integrity-badge-risk": { px: 12, weight: 400 },
  // Each sets colour (and background/border) only; size/weight come from
  // the shared .runner-mock__square base rule (mono-sm, 12px/400).
  ".runner-mock__square--answered": { px: 12, weight: 400 },
  ".runner-mock__square--marked": { px: 12, weight: 400 },
  ".runner-mock__square--current": { px: 12, weight: 400 },
  // Its own font-size is a literal "10px", not a var(--type-*-size)
  // reference — this is the designed escape hatch for exactly that case.
  ".runner-mock__square--locked": { px: 10, weight: 400 },
  // No ancestor in the bundle sets a font-size; these inherit the page's
  // base body-md size (16px/400) from base.css.
  ".comparison-intro": { px: 16, weight: 400 },
  ".comparison-conclusion p": { px: 16, weight: 400 },
  ".feature-lead": { px: 16, weight: 400 },
  ".footer-col a": { px: 16, weight: 400 },
  ".footer-col p": { px: 16, weight: 400 },
  // No font-size on this element's own selector; size comes from the base
  // .roadmap-ledger__title rule for the same element (body-md, 16px).
  ".roadmap-ledger__row--pending .roadmap-ledger__title": {
    px: 16,
    weight: 400,
  },
  ".roadmap-ledger__row--done .roadmap-ledger__title, .roadmap-ledger__row--part .roadmap-ledger__title":
    { px: 16, weight: 400 },
  // Sets colour only; size/weight come from the shared .editor-mock__tab
  // base rule (mono-sm, 12px/400).
  ".editor-mock__tab--active": { px: 12, weight: 400 },
  // No font-size of its own; inherits the page's base body-md (16px/400).
  ".editor-mock__option": { px: 16, weight: 400 },
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
    } else if (selector && !selector.startsWith("@")) {
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
    | { fontSize: string }
    | undefined;
  if (!entry) return null;
  return lengthToPx(entry.fontSize);
}

function typographyWeight(name: string): number | null {
  const entry = tokens.typography[name as TypographyName] as
    | { fontWeight: number }
    | undefined;
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
  px: number;
  weight: number;
}

function surfacesOf(selector: string): ColorName[] {
  const value = SURFACE[selector];
  if (value === undefined) {
    throw new Error(`no SURFACE entry for ${selector}`);
  }
  return Array.isArray(value) ? value : [value];
}

let colorSelectors: string[];
let ruleBodies: Map<string, string>;
let resolutionErrors: string[];
let resolved: Map<string, Resolved>;

beforeAll(() => {
  const css = readResolvedCss(LANDING_CSS_PATH);
  const rules = parseRuleBodies(css);
  // A selector can appear more than once (e.g. a base rule plus its
  // declarations re-opened inside a @media block for a reflow or reduced-
  // motion variant) — merge bodies rather than letting a later, unrelated
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

    if (!(selector in SURFACE)) {
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

    resolved.set(selector, { fg, px, weight });
  }
});

describe("every colour-setting selector in the landing bundle is accounted for", () => {
  it("has no selector missing from SURFACE or the documented wrapper exclusions", () => {
    const unaccounted = colorSelectors.filter(
      (selector) =>
        !(selector in SURFACE) &&
        !WRAPPER_SELECTORS_WITH_NO_OWN_TEXT.has(selector),
    );
    expect(unaccounted).toEqual([]);
  });

  it("has no stale entry in SURFACE for a selector no longer in the bundle", () => {
    const stale = Object.keys(SURFACE).filter(
      (selector) => !colorSelectors.includes(selector),
    );
    expect(stale).toEqual([]);
  });
});

describe("every selector's fg/size/weight resolves cleanly from its own CSS", () => {
  it("has no selector that fails to resolve (fails loudly, never skips)", () => {
    expect(resolutionErrors).toEqual([]);
  });
});

describe("every colour-on-surface usage clears its real WCAG threshold", () => {
  it("resolved at least one usage (sanity: the suite above isn't vacuous)", () => {
    expect(resolved.size).toBeGreaterThan(0);
  });

  for (const selector of Object.keys(SURFACE)) {
    for (const bg of surfacesOf(selector)) {
      it(`${selector} on ${bg} clears its WCAG threshold`, () => {
        const usage = resolved.get(selector);
        // Only reachable if the resolution-errors test above is already
        // failing; asserting here too gives a usage-level failure message.
        expect(usage, `${selector} did not resolve`).toBeDefined();
        if (!usage) return;
        const threshold =
          usage.px >= 24 || (usage.px >= 18.66 && usage.weight >= 700)
            ? 3
            : 4.5;
        const ratio = contrastRatio(tokens.colors[usage.fg], tokens.colors[bg]);
        expect(
          ratio,
          `${selector} on ${bg}: ${usage.fg} on ${bg} at ${usage.px}px/${usage.weight} is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
        ).toBeGreaterThanOrEqual(threshold);
      });
    }
  }
});
