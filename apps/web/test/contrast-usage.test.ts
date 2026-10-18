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

  // The hero's two secondary text links (v3 §3.1); the primary CTA left
  // the hero for B8. Each sets its own cream plane — nothing at 14px can
  // clear 4.5:1 on voltage in any colour (see components.css).
  ".hero-text-link": "cream",

  // ---- components.css: the v4 three-card hero (A1) ----------------------
  // The masthead is cream type straight on the hero's voltage fill — it is
  // the wordmark at 44px and up, so the 24px+ rule DESIGN.md sets for
  // cream-on-voltage is met with room to spare.
  ".hero-masthead": "voltage",

  // Each card is its own cream plane on the voltage field, so everything
  // inside one renders on cream — except the option rows and the matching
  // selects, which set their own canvas fill.
  ".exam-card": "cream",
  ".exam-card__bar": "cream",
  ".exam-card__points": "cream",
  ".exam-card__match-key": "cream",
  ".exam-card__match-row select": "canvas",

  // The control bar sits on voltage. Its small type is cream, which cannot
  // reach 4.5:1 there at mono-sm — so every value it carries is also
  // announced through a live region and drawn by a control that repeats it
  // (the pips, the button label). The pip's filled state inverts to a cream
  // plane, which is where its own small type is legible.
  ".exam-demo__bar": "cream",
  ".exam-demo__pip": "cream",
  ".exam-demo__pip[data-on=\"1\"]": "voltage-deep",
  ".exam-demo__count, .exam-demo__score, .exam-demo__nojs": "cream",
  ".exam-demo__nojs": "cream",
  ".exam-demo__button": "voltage-deep",
  ".exam-demo__button[disabled]": "canvas",

  // ---- components.css: the hero demo and its bridge band (v3 §3) ---------
  // The demo is a cream card on the voltage field, so everything in the
  // panel — the prerendered half and everything the island builds into it
  // — renders on cream. .runner-mock__title is shared with the bridge
  // band's h3, which is cream too.
  ".runner-mock__title": "cream",
  ".runner-mock__fallback": "cream",
  ".runner-mock__note": "cream",
  // Created at runtime by src/island/exam-demo.ts. The island sets no
  // colour of its own (I-7), so these rules are the whole of its palette.
  ".runner-mock__control": "cream",
  ".runner-mock__control--primary": "voltage-deep",
  ".runner-mock__hint": "cream",
  ".runner-mock__result-type": "cream",
  ".runner-mock__result-points": "cream",
  ".runner-mock__result-verdict": "cream",
  ".runner-mock__result-summary, .runner-mock__result-explanation, .runner-mock__result-prose, .runner-mock__result-link":
    "cream",
  ".runner-mock__result-link a": "cream",

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

  // ---- sections-s1-s3.css: B2 and B3 (both cream, v3 §4) ------------------
  ".verification-strip": "cream",
  ".absorbed-heading": "cream",
  ".type-list": "cream",
  ".capability-list": "cream",

  // ---- sections-s4-s6.css: S4 (ambient #comparison = canvas) --------------
  ".comparison-intro": "canvas",
  ".comparison-conclusion p": "canvas",

  // ---- sections-s4-s6.css: S5/S6, now absorbed into B3 as h3s (v3 §4.1).
  // Both bands are gone; what survives of them renders on B3's cream.
  ".feature-lead": "cream",
  ".no-code-pull-quote": "cream",

  // ---- sections-s7-s9.css: S7 (ambient #cost = cream) ---------------------
  // The budget note/table and the two deploy card selectors sit inside a
  // CardHairline, which sets its own canvas background; the architecture and
  // risk paragraphs sit directly on the section (cream).
  ".cost-budget-note": "canvas",
  ".cost-budget-table th, .cost-budget-table td": "canvas",
  '.cost-budget-table th[scope="col"]': "canvas",
  ".cost-architecture, .cost-risk": "cream",

  // ---- sections-s7-s9.css: S8 (ambient #not-for = cream) ------------------
  ".not-for-list p": "cream",

  // ---- sections-s7-s9.css: S9 (ambient #status = canvas) ------------------
  ".status-group__heading": "canvas",
  ".status-group__lead, .status-group__links, .status-byok-note": "canvas",
  ".status-list": "canvas",

  // ---- sections-s10-s12.css: S10 (ambient #faq = cream) -------------------
  ".faq-item__question": "cream",
  ".faq-item__answer": "cream",

  // ---- sections-s10-s12.css: S11 (the hero's own cream mock plane) --------

  // ---- sections-s10-s12.css: S12 (.site-footer sets its own canvas) ------
  // ---- sections-s7-s9.css: B5's deploy lines and interop strip (cream),
  //      B6's absorbed #status heading (canvas) -----------------------------
  ".cost-deploy-line": "cream",
  ".interop-strip": "cream",
  ".status-heading": "canvas",

  // ---- sections-s10-s12.css: B8, the ask — a voltage band (v3 §4.7).
  //      Both elements set their own cream plane, for the same reason the
  //      hero's links do. ---------------------------------------------------
  ".closing-watch-link": "cream",
  ".closing-honesty": "cream",

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
  // ---- the v4 three-card hero (A1) --------------------------------------
  // Wrappers that set a colour for their subtree but no size of their own.
  // Each entry names the SMALLEST type that colour actually paints, which
  // is the conservative case for the threshold this test applies.
  //
  // .hero-masthead: cream for the whole block. Its smallest text is the
  // stats row (mono-sm, 12px) — which is why the stats are hidden below
  // 860px, where the masthead keeps only the 34px+ wordmark.
  ".hero-masthead": { px: 44, weight: 700 },
  // .exam-card: ink on the card's own cream fill. Its smallest text is the
  // card bar's mono-sm label.
  ".exam-card": { px: 12, weight: 400 },
  // Same element as .exam-card__bar; only the colour changes.
  ".exam-card__points": { px: 12, weight: 400 },
  // .exam-demo__bar: cream on voltage, wrapping the pips and the count.
  ".exam-demo__bar": { px: 12, weight: 400 },
  ".exam-demo__pip": { px: 12, weight: 400 },
  // The pip's filled state inverts to a cream plane; the digit is mono-sm.
  '.exam-demo__pip[data-on="1"]': { px: 12, weight: 400 },
  // Same element as .exam-demo__button; the disabled state changes colour
  // and background only.
  ".exam-demo__button[disabled]": { px: 16, weight: 500 },
  ".exam-demo__nojs": { px: 12, weight: 400 },
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
  // The three surviving syntax-colour spans set colour only; size/weight
  // come from their ancestor .code-block__pre (mono-md, 15px/400).
  ".tok-key": { px: 15, weight: 400 },
  ".tok-string": { px: 15, weight: 400 },
  ".tok-number": { px: 15, weight: 400 },
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
  // No ancestor in the bundle sets a font-size; these inherit the page's
  // base body-md size (16px/400) from base.css.
  ".comparison-intro": { px: 16, weight: 400 },
  ".comparison-conclusion p": { px: 16, weight: 400 },
  ".feature-lead": { px: 16, weight: 400 },
  ".footer-col a": { px: 16, weight: 400 },
  ".footer-col p": { px: 16, weight: 400 },
  // Sets colour only; size and weight come from the shared
  // .runner-mock__control base rule (button-md, 16px/500).
  ".runner-mock__control--primary": { px: 16, weight: 500 },
  // Sets colour only; size and weight come from the shared body-sm rule
  // for the paragraph this anchor sits in (14px/400).
  ".runner-mock__result-link a": { px: 14, weight: 400 },
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
