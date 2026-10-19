import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  tokens,
  type ColorName,
  type TypographyName,
} from "../src/styles/tokens";

// The Signal rebuild replaced landing.css's own rules with two imports —
// primitives.css (shared with admin.css; five selectors still used by the
// organiser screens, no longer by the landing page) and signal.css (the
// landing page's entire own palette, a dark ground with one green accent)
// — so the SURFACE map is rewritten wholesale rather than patched. Every
// key names the background its selector really renders on, checked against
// the rendered markup in src/sections/signal/ and verified against the
// built page's own computed style (not assumed from the class name): where
// a selector's declared colour is itself overridden on some of its
// elements by a more specific, separately-keyed selector (.signal-chip vs.
// .signal-chip[aria-pressed="true"]; .signal-btn vs. .signal-btn--ghost),
// only the surface(s) where THIS selector's own colour actually wins the
// cascade are listed here.
//
// IMPORTANT (carried over from round 2 of the original file): fg, font-size
// and font-weight are parsed out of each selector's own declarations, never
// hand-typed as a claim that could drift from the CSS. Only the background —
// the one fact CSS cannot state without a cascade engine, which this file
// doesn't implement — lives in a map, and SURFACE can name more than one
// background for a selector that genuinely renders on different surfaces in
// different places. Every surface listed for a selector gets its own WCAG
// assertion.
//
// Record for the gate's limits: axe-core under jsdom cannot evaluate
// contrast at all (jsdom has no layout engine and no canvas backend), so
// the landing.test.tsx axe pass gives zero contrast coverage. This file is
// the only place contrast-by-usage is actually checked (A1).

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = resolve(__dirname, "../src/styles");
const LANDING_CSS_PATH = resolve(STYLES_DIR, "landing.css");
const ADMIN_CSS_PATH = resolve(STYLES_DIR, "admin.css");
const BASE_CSS_PATH = resolve(STYLES_DIR, "base.css");

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
//
// base.css is not folded into the generic sweep below: it carries selectors
// this parser was never built for (`a { color: inherit }`, `:focus-visible`'s
// non-token `outline-color`) that would need their own special-casing for no
// real gain. But A1's point is coverage, not which file a selector lives in
// — base.css declares `color:` on exactly two selectors that paint visible
// text, `body` and `.skip-link`, and both are checked directly, by the same
// WCAG formula, in the "base.css" describe block below. That closes the gap
// a plain exclusion comment would otherwise leave undocumented.
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
  // ---- signal.css: ambient type ------------------------------------------
  // The whole page sits on --color-signal-bg; every surface panel, card or
  // frame sets its own --color-signal-surface, and the cost section's four
  // metric cells are the one place --color-signal-bg-2 shows.
  ".signal": "signal-bg",
  ":where(.signal) p": "signal-bg",
  ":where(.signal) strong": ["signal-bg", "signal-surface"],
  ":where(.signal) code": ["signal-bg", "signal-surface"],
  ":where(.signal) a": "signal-bg",

  // ---- signal.css: fine print, eyebrows, the accent spans and icons ------
  ".signal-fine": ["signal-bg", "signal-surface"],
  ".signal-eyebrow": "signal-bg",
  // The h1's accent word and the bullet ticks (not-a-form) sit on signal-bg;
  // the type-rail cards' svg icons (same class, A3-style reuse) sit on each
  // card's own signal-surface fill.
  ".signal-accent-word": ["signal-bg", "signal-surface"],

  // ---- signal.css: actions -------------------------------------------------
  // .signal-btn sets its own background (signal-accent); .signal-btn--ghost
  // sets background: none, so the ghost CTA (hero, close) renders on the
  // ambient signal-bg behind it.
  ".signal-btn": "signal-accent",
  ".signal-btn--ghost": "signal-bg",

  // ---- signal.css: nav ----------------------------------------------------
  ".signal-wordmark__sub": "signal-bg",
  ".signal-nav__links a": "signal-bg",
  ".signal-nav__links a:hover": "signal-bg",

  // ---- signal.css: hero trust list and the frame (what stands in for a
  // screenshot) --------------------------------------------------------------
  ".signal-trust li": "signal-bg",
  ".signal-trust li b": "signal-bg",
  ".signal-frame__url": "signal-surface",

  // ---- signal.css: chips. The hero's tag filter and the status toggle
  // both reuse this class — one on signal-surface (inside .signal-frame),
  // the other directly on the section's signal-bg. The pressed state sets
  // its own background (signal-accent) regardless of which. ----------------
  ".signal-chip": ["signal-bg", "signal-surface"],
  ".signal-chip:hover": ["signal-bg", "signal-surface"],
  '.signal-chip[aria-pressed="true"]': "signal-accent",

  // ---- signal.css: the draw (hero frame and the not-a-form panel both
  // reuse .signal-row — both are signal-surface) ---------------------------
  ".signal-row b": "signal-surface",
  ".signal-row span": "signal-surface",
  ".signal-row em": "signal-surface",
  ".signal-ghost-btn": "signal-surface",
  ".signal-ghost-btn:hover": "signal-surface",

  // ---- signal.css: cards (the type rail) ---------------------------------
  ".signal-card p": "signal-surface",

  // ---- signal.css: the FAQ accordion, ambient on signal-bg ---------------
  // <details name="faq"> items sit directly on the page ground; nothing
  // between them and .signal paints a surface of its own.
  ".signal-faq__q h3": "signal-bg",
  '.signal-faq__q:hover h3, .signal-faq__item[open] > .signal-faq__q h3':
    "signal-bg",
  ".signal-faq__a": "signal-bg",

  // ---- signal.css: not-a-form's bullet list, ambient on signal-bg --------
  ".signal-bullets li": "signal-bg",
  ".signal-bullets b": "signal-bg",

  // ---- signal.css: panels and data (the not-a-form panel and the
  // integrity results table both sit in a .signal-panel, signal-surface) ---
  ".signal-panel__head": "signal-surface",
  ".signal-panel__head b": "signal-surface",
  ".signal-table th": "signal-surface",
  ".signal-table td": "signal-surface",
  ".signal-table .signal-td-name": "signal-surface",
  ".signal-table .signal-td-num": "signal-surface",
  // flag-review/flag-risk are tuned for admin.css's light canvas and can't
  // also clear 4.5:1 on this dark surface (no single hex clears both a
  // near-white and a near-black background) — these two signal-native
  // tokens complete the pattern .signal-pill--clean already set with
  // signal-accent instead of flag-clean.
  ".signal-pill--clean": "signal-surface",
  ".signal-pill--review": "signal-surface",
  ".signal-pill--risk": "signal-surface",

  // ---- signal.css: cost section's metric cells (signal-bg-2) -------------
  ".signal-metric b": "signal-bg-2",
  ".signal-metric span": "signal-bg-2",

  // ---- signal.css: the comparison table, directly on the section
  // (signal-bg, no panel wraps it) ------------------------------------------
  ".signal-cmp th": "signal-bg",
  ".signal-cmp th:last-child": "signal-bg",
  ".signal-cmp td": "signal-bg",
  ".signal-cmp td:first-child": "signal-bg",
  ".signal-cmp td:last-child": "signal-bg",

  // ---- signal.css: status. The live/next lists sit in the left column,
  // directly on signal-bg; "what you can do today" is its own
  // signal-surface card. ----------------------------------------------------
  ".signal-list li": "signal-bg",
  // Never actually rendered in the current markup (no <b> inside either
  // <ul class="signal-list">) — kept at the list's own surface so the rule
  // has a real assertion if a future list item adds one.
  ".signal-list b": "signal-bg",
  ".signal-today li": "signal-surface",
  ".signal-today li b": "signal-surface",

  // ---- signal.css: footer, directly on signal-bg (no panel wraps it) -----
  ".signal-footer__grid h2, .signal-footer__grid h3": "signal-bg",
  ".signal-footer__grid p": "signal-bg",

  // ---- primitives.css: shared by landing.css and admin.css (P3.9) --------
  // No longer used by the landing page itself — confirmed absent from
  // src/sections/signal/ and src/routes/landing.tsx — only the organiser
  // screens still render these, via ButtonPrimary/ButtonSecondary (routes/
  // dashboard.tsx, setup.tsx, signin.tsx), so they keep exactly their
  // original classification.
  ".mono-caption": "cream",
  ".button-primary": "cream",
  ".button-primary:hover, .button-primary:focus-visible": "voltage-deep",
  ".button-primary--surface": "voltage-deep",
  ".button-secondary": "canvas",

  // ---- admin.css: the organiser screens (P3.9) ---------------------------
  // The page is the body's cream; every panel is a CardHairline, which sets
  // its own canvas fill, so the form trio and the empty state render on
  // canvas. docs/design.md's screen-inventory note — "cream and ink
  // surfaces, hairline rules" — is the whole palette here; voltage survives
  // only on the primary action (.button-primary--surface, already above)
  // and the focus ring (base.css).
  ".organiser__title": "cream",
  ".organiser__lead": "cream",
  ".organiser-bar__mark": "canvas",
  ".organiser__notice": "canvas",
  ".organiser__status": "canvas",
  ".organiser-empty__title": "canvas",
  ".organiser-empty__body": "canvas",
  ".field-label": "canvas",
  ".field-help": "canvas",
  ".field-error": "canvas",
  ".text-input": "canvas",

  // ---- authoring.css: the prompt editor and preview pane (P4.5) ---------
  // Same palette and the same reasoning: the editor and the preview are
  // panels on the body's cream, each filling itself with canvas, so every
  // colour authoring.css sets is read on canvas.
  ".rendered--stem": "canvas",
  ".prompt-editor__tool": "canvas",
  ".prompt-editor__source": "canvas",
  ".preview__heading": "canvas",
  ".preview__toggle": "canvas",
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
  // ---- primitives.css (unchanged by the Signal rework) --------------------
  // Same element as .button-primary; only the colour/background changes.
  ".button-primary:hover, .button-primary:focus-visible": {
    px: 16,
    weight: 500,
  },
  // Same element as .button-primary (the surface variant adds a class, it
  // doesn't replace one).
  ".button-primary--surface": { px: 16, weight: 500 },

  // ---- signal.css ----------------------------------------------------------
  // Ambient p: no font-size of its own, inherits .signal's own body size.
  ":where(.signal) p": { px: 17, weight: 400 },
  // No font-size of its own; the smallest context it renders in is a
  // .signal-fine paragraph (13.5px). Weight resolves from its own
  // declaration (600) regardless.
  ":where(.signal) strong": { px: 13.5, weight: 600 },
  // 0.86em of its own, which this parser cannot resolve (no fixed ancestor
  // size): the smallest real ancestor is a FAQ card's .signal-card p
  // (12.5px), so 0.86 * 12.5 = 10.75px is the conservative case.
  ":where(.signal) code": { px: 10.75, weight: 400 },
  // No font-size of its own; both real usages (the footer links, the
  // status "Read the roadmap" link) sit in a 13.5px .signal-fine paragraph.
  ":where(.signal) a": { px: 13.5, weight: 400 },
  // The ghost variant adds a class to the same <a> as .signal-btn; it
  // doesn't replace one, so the size/weight stay .signal-btn's own.
  ".signal-btn--ghost": { px: 15.5, weight: 600 },
  // Same element as .signal-nav__links a; only the colour changes.
  ".signal-nav__links a:hover": { px: 14.5, weight: 400 },
  // Same <h3> as .signal-faq__q h3; the open/hover rules change only the
  // colour, so size and weight stay that selector's own.
  '.signal-faq__q:hover h3, .signal-faq__item[open] > .signal-faq__q h3': {
    px: 17,
    weight: 600,
  },
  // The FAQ answer declares no size of its own; it inherits .signal's body
  // size, like every other ambient paragraph on the page.
  ".signal-faq__a": { px: 17, weight: 400 },
  // Size comes from .signal-trust li (11px); weight resolves from its own
  // declaration (600) regardless.
  ".signal-trust li b": { px: 11, weight: 600 },
  // Same element as .signal-chip; only the colour changes.
  ".signal-chip:hover": { px: 10.5, weight: 500 },
  // Same element as .signal-chip (the attribute selector adds a state, it
  // doesn't replace the base class).
  '.signal-chip[aria-pressed="true"]': { px: 10.5, weight: 500 },
  // <em> nested inside a .signal-row span; size/weight come from that span.
  ".signal-row em": { px: 12.5, weight: 400 },
  // Same element as .signal-ghost-btn; only the colour changes.
  ".signal-ghost-btn:hover": { px: 11, weight: 500 },
  // Size comes from .signal-bullets li (15.5px); weight resolves from its
  // own declaration (600) regardless.
  ".signal-bullets b": { px: 15.5, weight: 600 },
  // Size comes from .signal-panel__head (10.5px); weight resolves from its
  // own declaration (600) regardless.
  ".signal-panel__head b": { px: 10.5, weight: 600 },
  // No font-size of its own; inherits .signal-table's own 14px.
  ".signal-table td": { px: 14, weight: 400 },
  // Size comes from .signal-table (14px); weight resolves from its own
  // declaration (500) regardless.
  ".signal-table .signal-td-name": { px: 14, weight: 500 },
  // Neither size nor weight of its own; both come from .signal-table (td)
  // and the CSS initial weight.
  ".signal-table .signal-td-num": { px: 14, weight: 400 },
  // Each sets colour only; size/weight come from the shared .signal-pill
  // base rule (11px/500).
  ".signal-pill--clean": { px: 11, weight: 500 },
  ".signal-pill--review": { px: 11, weight: 500 },
  ".signal-pill--risk": { px: 11, weight: 500 },
  // Neither size nor weight of its own; both come from .signal-cmp th
  // (10px/500).
  ".signal-cmp th:last-child": { px: 10, weight: 500 },
  // No font-size of its own; inherits .signal-cmp's own 14.5px.
  ".signal-cmp td": { px: 14.5, weight: 400 },
  ".signal-cmp td:first-child": { px: 14.5, weight: 400 },
  // Size comes from .signal-cmp (14.5px); weight resolves from its own
  // declaration (500) regardless.
  ".signal-cmp td:last-child": { px: 14.5, weight: 500 },
  // Size comes from .signal-list li (15px); weight resolves from its own
  // declaration (600) regardless. Never actually rendered today (no <b>
  // inside either live/next list) — see the SURFACE comment.
  ".signal-list b": { px: 15, weight: 600 },
  // No font-weight of its own (real computed weight is UA-bold, 700, but
  // at 14.5px that never changes the threshold either way); size comes
  // from .signal-today li (14.5px).
  ".signal-today li b": { px: 14.5, weight: 400 },
  // Colour only; used on the h1's accent word and the not-a-form bullet
  // ticks (big/inherited text, comfortably >=24px) and on the type rail's
  // svg icons (no font-size of their own) — 16px is the smallest real icon
  // (the bullet ticks), the conservative case.
  ".signal-accent-word": { px: 16, weight: 400 },
};

// Pure wrapper selectors: every piece of text under them is an element with
// its own `color` declaration (already covered), so the wrapper's colour
// never paints anything.
const WRAPPER_SELECTORS_WITH_NO_OWN_TEXT = new Set([
  ".card-hairline", // every usage wraps only child elements, never bare text
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
// a contrast threshold, per the review ruling. signal.css's own type isn't
// drawn from the shared typography token set (only signal-display-xl/-lg/
// -body are) — it's literal px, read directly once the token/clamp forms
// don't match.
function parseFontSizePx(body: string): number | null {
  const value = findDeclaration(body, "font-size");
  if (!value) return null;
  const clampMatch = /^clamp\(\s*([^,]+),/i.exec(value);
  if (clampMatch?.[1]) {
    return lengthToPx(clampMatch[1]);
  }
  const varMatch = TYPE_SIZE_VAR_RE.exec(value);
  if (varMatch?.[1]) return typographyPx(varMatch[1]);
  return lengthToPx(value);
}

function parseFontWeight(body: string): number | null {
  const value = findDeclaration(body, "font-weight");
  if (!value) return null;
  const varMatch = TYPE_WEIGHT_VAR_RE.exec(value);
  if (varMatch?.[1]) return typographyWeight(varMatch[1]);
  // A literal numeric weight (signal.css's own, same reasoning as above).
  return /^\d+$/.test(value) ? Number(value) : null;
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
  // P3.9: the organiser screens are a second real stylesheet entry
  // (admin.css, loaded only by src/admin-main.tsx) and every colour it
  // declares has to clear the same bar. One shared `seen` set so
  // primitives.css — imported by both entries — is read exactly once.
  const seen = new Set<string>();
  const css = `${readResolvedCss(LANDING_CSS_PATH, seen)}
${readResolvedCss(
    ADMIN_CSS_PATH,
    seen,
  )}`;
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

// A1, extended per the file-level comment above: base.css's two
// colour-bearing selectors, checked directly with the same parsing and the
// same WCAG formula as the generic sweep, rather than left to an exclusion
// comment with nothing behind it.
describe("base.css: the two colour-bearing selectors outside landing.css's own import chain (A1)", () => {
  const baseCss = readResolvedCss(BASE_CSS_PATH);
  const baseRules = parseRuleBodies(baseCss);
  const baseBodies = new Map<string, string>();
  for (const rule of baseRules) {
    const existing = baseBodies.get(rule.selector);
    baseBodies.set(
      rule.selector,
      existing ? `${existing};${rule.body}` : rule.body,
    );
  }

  function backgroundOf(selector: string): ColorName {
    const body = baseBodies.get(selector) ?? "";
    const value = findDeclaration(body, "background");
    const match = value ? COLOR_VAR_RE.exec(value) : null;
    const name = match?.[1];
    if (!name || !(name in tokens.colors)) {
      throw new Error(`${selector}: cannot parse a var(--color-*) background`);
    }
    return name as ColorName;
  }

  for (const selector of ["body", ".skip-link"]) {
    it(`${selector} clears its real WCAG threshold`, () => {
      const body = baseBodies.get(selector);
      expect(body, `${selector} not found in base.css`).toBeDefined();
      if (!body) return;
      const fg = parseColor(body);
      expect(
        fg,
        `${selector}: cannot parse a var(--color-*) foreground`,
      ).not.toBeNull();
      if (!fg) return;
      const bg = backgroundOf(selector);
      // Neither declares its own font-size: `body` sets the page's base
      // body-md text directly, and `.skip-link` inherits it — 16px/400
      // either way, the same fallback INHERITED_SIZE_WEIGHT uses above.
      const px = parseFontSizePx(body) ?? 16;
      const weight = parseFontWeight(body) ?? 400;
      const threshold = px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5;
      const ratio = contrastRatio(tokens.colors[fg], tokens.colors[bg]);
      expect(
        ratio,
        `${selector} on ${bg}: ${fg} on ${bg} at ${px}px/${weight} is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
      ).toBeGreaterThanOrEqual(threshold);
    });
  }
});
