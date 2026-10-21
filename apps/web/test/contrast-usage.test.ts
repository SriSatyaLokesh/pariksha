import { describe, it, expect, beforeAll } from "vitest";
// Phase 5 moved contrastRatio into core so the brand-colour gate on the two
// write paths and this stylesheet audit cannot disagree (Task 10, 240aa68).
import { contrastRatio } from "@pariksha/core";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  tokens,
  type ColorName,
  type TypographyName,
} from "../src/styles/tokens";
// Fix round 1: one `@import` resolver for the suite — this file had
// the only correct one, and Task 7's no-animation gate grew a
// narrower copy. Both call `test/css-chain.ts` now. Phase 6.5b Task 3:
// `parseRuleBodies`/`declarations` moved there for the same reason, so
// theme.test.ts could read theme.css with this file's parser rather than a
// second one.
import {
  declarations,
  parseRuleBodies,
  readResolvedCss,
  readThemeMap,
  organiserStylesheets,
  SEMANTIC_NAMES,
  GROUNDS,
  type Ground,
} from "./css-chain";

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
// Phase 6 Task 1 (#65): the candidate runtime is a third stylesheet entry
// (exam.css, loaded only by src/exam-main.tsx) and every colour it declares
// clears the same bar — in the phase where it matters most, because a
// candidate under a clock cannot switch tools or come back tomorrow.
const EXAM_CSS_PATH = resolve(STYLES_DIR, "exam.css");
// Phase 6.5b Task 3: the SURFACE sweep below still reads only the three
// stylesheet entries it always has — testbuilder.css's selectors have never
// been in it, which is a gap this task does not close — but the standing
// guards at the foot of this file are file scans, not SURFACE walks, and
// they read every stylesheet admin-main.tsx loads, derived from that file by
// `organiserStylesheets()` rather than listed here (fix round 4, finding 3).

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
// A selector's declared colour can render on more than one real background
// (the four syntax-colour roles and the code block they live in, A3's
// explicit requirement) — SURFACE may name one background or several, and
// every one gets its own WCAG assertion below.
//
// Phase 6.5b Task 3 (D20): the organiser ships on two grounds and a control
// in the top bar switches them, so a background is a fact about a selector
// AND a ground. Every entry now names one per ground. This plan re-grounds
// no screen — 6.5c, 6.5d and 6.5e do, one screen at a time — so today every
// entry carries the same colour on both, written `both(...)`; differentiating
// one is a matter of replacing that call with an explicit `{ dark, light }`.
interface SurfaceEntry {
  dark: ColorName | ColorName[];
  light: ColorName | ColorName[];
}

/** A selector whose background is the same colour whichever ground is on. */
function both(first: ColorName, ...rest: ColorName[]): SurfaceEntry {
  const value = rest.length === 0 ? first : [first, ...rest];
  return { dark: value, light: value };
}

const SURFACE: Record<string, SurfaceEntry> = {
  // ---- signal.css: ambient type ------------------------------------------
  // The whole page sits on --color-signal-bg; every surface panel, card or
  // frame sets its own --color-signal-surface, and the cost section's four
  // metric cells are the one place --color-signal-bg-2 shows.
  ".signal": both("signal-bg"),
  ":where(.signal) p": both("signal-bg"),
  ":where(.signal) strong": both("signal-bg", "signal-surface"),
  ":where(.signal) code": both("signal-bg", "signal-surface"),
  ":where(.signal) a": both("signal-bg"),

  // ---- signal.css: fine print, eyebrows, the accent spans and icons ------
  ".signal-fine": both("signal-bg", "signal-surface"),
  ".signal-eyebrow": both("signal-bg"),
  // The h1's accent word and the bullet ticks (not-a-form) sit on signal-bg;
  // the type-rail cards' svg icons (same class, A3-style reuse) sit on each
  // card's own signal-surface fill.
  ".signal-accent-word": both("signal-bg", "signal-surface"),

  // ---- signal.css: actions -------------------------------------------------
  // .signal-btn sets its own background (signal-accent); .signal-btn--ghost
  // sets background: none, so the ghost CTA (hero, close) renders on the
  // ambient signal-bg behind it.
  ".signal-btn": both("signal-accent"),
  ".signal-btn--ghost": both("signal-bg"),

  // ---- signal.css: nav ----------------------------------------------------
  ".signal-wordmark__sub": both("signal-bg"),
  ".signal-nav__links a": both("signal-bg"),
  ".signal-nav__links a:hover": both("signal-bg"),

  // ---- signal.css: hero trust list and the frame (what stands in for a
  // screenshot) --------------------------------------------------------------
  ".signal-trust li": both("signal-bg"),
  ".signal-trust li b": both("signal-bg"),
  ".signal-frame__url": both("signal-surface"),

  // ---- signal.css: chips. The hero's tag filter and the status toggle
  // both reuse this class — one on signal-surface (inside .signal-frame),
  // the other directly on the section's signal-bg. The pressed state sets
  // its own background (signal-accent) regardless of which. ----------------
  ".signal-chip": both("signal-bg", "signal-surface"),
  ".signal-chip:hover": both("signal-bg", "signal-surface"),
  '.signal-chip[aria-pressed="true"]': both("signal-accent"),

  // ---- signal.css: the draw (hero frame and the not-a-form panel both
  // reuse .signal-row — both are signal-surface) ---------------------------
  ".signal-row b": both("signal-surface"),
  ".signal-row span": both("signal-surface"),
  ".signal-row em": both("signal-surface"),
  ".signal-ghost-btn": both("signal-surface"),
  ".signal-ghost-btn:hover": both("signal-surface"),

  // ---- signal.css: cards (the type rail) ---------------------------------
  ".signal-card p": both("signal-surface"),

  // ---- signal.css: the FAQ accordion, ambient on signal-bg ---------------
  // <details name="faq"> items sit directly on the page ground; nothing
  // between them and .signal paints a surface of its own.
  ".signal-faq__q h3": both("signal-bg"),
  '.signal-faq__q:hover h3, .signal-faq__item[open] > .signal-faq__q h3':
    both("signal-bg"),
  ".signal-faq__a": both("signal-bg"),

  // ---- signal.css: not-a-form's bullet list, ambient on signal-bg --------
  ".signal-bullets li": both("signal-bg"),
  ".signal-bullets b": both("signal-bg"),

  // ---- signal.css: panels and data (the not-a-form panel and the
  // integrity results table both sit in a .signal-panel, signal-surface) ---
  ".signal-panel__head": both("signal-surface"),
  ".signal-panel__head b": both("signal-surface"),
  ".signal-table th": both("signal-surface"),
  ".signal-table td": both("signal-surface"),
  ".signal-table .signal-td-name": both("signal-surface"),
  ".signal-table .signal-td-num": both("signal-surface"),
  // flag-review/flag-risk are tuned for admin.css's light canvas and can't
  // also clear 4.5:1 on this dark surface (no single hex clears both a
  // near-white and a near-black background) — these two signal-native
  // tokens complete the pattern .signal-pill--clean already set with
  // signal-accent instead of flag-clean.
  ".signal-pill--clean": both("signal-surface"),
  ".signal-pill--review": both("signal-surface"),
  ".signal-pill--risk": both("signal-surface"),

  // ---- signal.css: cost section's metric cells (signal-bg-2) -------------
  ".signal-metric b": both("signal-bg-2"),
  ".signal-metric span": both("signal-bg-2"),

  // ---- signal.css: the comparison table, directly on the section
  // (signal-bg, no panel wraps it) ------------------------------------------
  ".signal-cmp th": both("signal-bg"),
  ".signal-cmp th:last-child": both("signal-bg"),
  ".signal-cmp td": both("signal-bg"),
  ".signal-cmp td:first-child": both("signal-bg"),
  ".signal-cmp td:last-child": both("signal-bg"),

  // ---- signal.css: status. The live/next lists sit in the left column,
  // directly on signal-bg; "what you can do today" is its own
  // signal-surface card. ----------------------------------------------------
  ".signal-list li": both("signal-bg"),
  // Never actually rendered in the current markup (no <b> inside either
  // <ul class="signal-list">) — kept at the list's own surface so the rule
  // has a real assertion if a future list item adds one.
  ".signal-list b": both("signal-bg"),
  ".signal-today li": both("signal-surface"),
  ".signal-today li b": both("signal-surface"),

  // ---- signal.css: footer, directly on signal-bg (no panel wraps it) -----
  ".signal-footer__grid h2, .signal-footer__grid h3": both("signal-bg"),
  ".signal-footer__grid p": both("signal-bg"),

  // ---- primitives.css: shared by landing.css and admin.css (P3.9) --------
  // Re-grounded by 6.5e Task 1b, which is only safe because the landing page
  // renders NONE of these constructs — asserted off disk by theme.test.ts,
  // not assumed. Every consumer is an organiser route or component, so the
  // ground they read on is the organiser's.
  //
  // Each button's fill is its own, so each is scored against what it paints
  // rather than against what is behind it.
  ".mono-caption": { dark: "signal-surface", light: "signal-l-surface" },
  ".button-primary": { dark: "signal-accent", light: "signal-l-accent" },
  ".button-primary:hover, .button-primary:focus-visible": {
    dark: "signal-accent-deep",
    light: "signal-l-accent-deep",
  },
  ".button-primary--surface": {
    dark: "signal-accent",
    light: "signal-l-accent",
  },
  ".button-secondary": { dark: "signal-surface", light: "signal-l-surface" },
  // Phase 6.5d Task 5 (`D16`, content): a unit affix sits INSIDE its control,
  // absolutely positioned over `.text-input`'s own fill — so the background
  // it really renders on is the input's fill, not the panel or the page.
  // Organiser-only in practice (the landing page renders no field row), but
  // the rule lives here because the field-row rule it belongs to is shared.
  ".field-affix__unit": { dark: "signal-surface", light: "signal-l-surface" },

  // ---- admin.css: the organiser screens (P3.9, re-grounded by 6.5e T1b) --
  // `D1`: the organiser left the cream palette. `admin.css` now paints
  // `body` with `--ground` — the four arms that render OUTSIDE the shell
  // (`loading`, `error`, `signin`, `setup`) are a bare `<main
  // class="organiser">` on it — and every panel is a CardHairline, which
  // fills itself with `--surface`. So the page's own type reads on the
  // ground and a panel's type reads on the surface, which is the same
  // two-level split the cream/canvas pair carried.
  ":root[data-theme] body": { dark: "signal-bg", light: "signal-l-bg" },
  ".organiser__title": { dark: "signal-bg", light: "signal-l-bg" },
  ".organiser__lead": { dark: "signal-bg", light: "signal-l-bg" },
  ".organiser__notice": { dark: "signal-surface", light: "signal-l-surface" },
  ".organiser__status": { dark: "signal-surface", light: "signal-l-surface" },
  ".organiser-empty__title": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ".organiser-empty__body": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  // registration.css, which admin.css and exam.css both import (Phase 6
  // Task 6, #70): one renderer, so one stylesheet, read on canvas in both
  // places — the candidate's `.exam-register-panel` fills itself with
  // canvas, and so did the organiser's CardHairline panel until 6.5e.
  //
  // THESE SIX STAY ON CREAM AND THAT IS NOT AN OVERSIGHT. The rules are
  // shared with the candidate runtime and are left exactly as they were;
  // the organiser repaints them from `admin.css` under `:root[data-theme]`,
  // which is a SEPARATE selector with its own entries below. Both pairs are
  // scored — rewriting the shared rule would have scored one and silently
  // dropped the other.
  ".field-label": both("canvas"),
  ".field-help": both("canvas"),
  ".field-error": both("canvas"),
  ".text-input": both("canvas"),
  ".registration-form__help, .registration-form__legend": both("canvas"),
  ".registration-form__error": both("canvas"),

  // ---- admin.css: the organiser's repaint of the two SHARED sheets ------
  // registration.css's form trio and question.css's rendered prompt, on the
  // Signal ground. `.field-label`'s cream `--color-ink` measures 1.09:1 on
  // `--surface`: without these the organiser would ship invisible form
  // labels on every screen that holds a field.
  ":root[data-theme] .field-label": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ":root[data-theme] .field-help": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ":root[data-theme] .field-error": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  // The input fills itself, so its own text reads on its own fill.
  ":root[data-theme] .text-input": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ":root[data-theme] .registration-form__help, :root[data-theme] .registration-form__legend":
    { dark: "signal-surface", light: "signal-l-surface" },
  ":root[data-theme] .registration-form__error": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  // The stem renders on a panel in the editor and directly on the page in
  // the builder's preview, so both grounds are named and both are scored.
  ":root[data-theme] .rendered--stem": {
    dark: ["signal-surface", "signal-bg"],
    light: ["signal-l-surface", "signal-l-bg"],
  },
  ":root[data-theme] .prompt-editor__tool": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },

  // ---- shell.css: the organiser's chrome (Phase 6.5c Task 1, D3) --------
  // The first rules in the organiser bundle to read theme.css's semantic
  // names, so the first entries here that differ by ground. The bar is
  // --surface and the rail is --ground-2; the page between them is still
  // the cream canvas admin.css gives it, which is why every screen's own
  // selectors above are unchanged — 6.5d and 6.5e move those.
  ".shell__mark": { dark: "signal-surface", light: "signal-l-surface" },
  ".shell__workspace": { dark: "signal-surface", light: "signal-l-surface" },
  ".shell__email": { dark: "signal-surface", light: "signal-l-surface" },
  ".shell__icon-button": { dark: "signal-surface", light: "signal-l-surface" },
  ".shell__signout": { dark: "signal-surface", light: "signal-l-surface" },
  // Phase 6.5c Task 4 (D4/D4b): the switcher, above one membership. Both
  // sit on the bar, which is --surface, exactly like the name they replace.
  // The <select>'s own options are painted by the platform's picker, not by
  // this stylesheet, so there is nothing further to score.
  ".shell__switcher-label": { dark: "signal-surface", light: "signal-l-surface" },
  ".shell__switcher-select": { dark: "signal-surface", light: "signal-l-surface" },
  ".shell__nav-item": { dark: "signal-bg-2", light: "signal-l-bg-2" },
  // The current item's fill is --accent-wash, 12% accent over the rail's
  // own --ground-2. A 12% wash does not move the ratio enough to score
  // against, and the ground beneath it is the honest worst case.
  '.shell__nav-item[aria-current="page"]': {
    dark: "signal-bg-2",
    light: "signal-l-bg-2",
  },

  // ---- home.css: the agenda and its strip (Phase 6.5c Task 3, D6/D21) ---
  // The first SCREEN on the Signal ground rather than the first chrome:
  // Home is built in this plan, so it is built on the ground D1 gives the
  // organiser instead of on the cream canvas 6.5e retires. Two backgrounds
  // only — the page itself is --ground, and every pane and the strip at the
  // foot fill themselves with --surface.
  //
  // Nothing here is scored against a recession: the audit reads a
  // selector's declared colour, and D21's `opacity: 0.8` on an unmatched
  // row is checked separately, by its own describe block below, because
  // opacity is a fact about a STATE and not about a colour.
  ".home__crumb": { dark: "signal-bg", light: "signal-l-bg" },
  ".home__title": { dark: "signal-bg", light: "signal-l-bg" },
  ".home__lead": { dark: "signal-bg", light: "signal-l-bg" },
  ".home__figure": { dark: "signal-bg", light: "signal-l-bg" },
  ".home__sep": { dark: "signal-bg", light: "signal-l-bg" },

  ".home__pane-title": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__group-name, .home__group-count": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ".home__row-time": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__row-subject": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__row-reason": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__row-action": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__empty, .home__more": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__empty-action": { dark: "signal-surface", light: "signal-l-surface" },

  ".home__pill": { dark: "signal-surface", light: "signal-l-surface" },
  // Pressed fills with --wash, 6% ink over the strip's own --surface. A 6%
  // wash does not move the ratio enough to score against, and the surface
  // beneath it is the honest worst case — the same reading the rail's
  // current item takes above.
  '.home__pill[aria-pressed="true"]': {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ".home__pill:disabled": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__pill-count": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__pill:disabled .home__pill-count": {
    dark: "signal-surface",
    light: "signal-l-surface",
  },
  ".home__clear": { dark: "signal-surface", light: "signal-l-surface" },
  ".home__clear:disabled": { dark: "signal-surface", light: "signal-l-surface" },

  // ---- question.css: shared with the candidate runtime -------------------
  // `.rendered--stem` and `.prompt-editor__tool` are question.css's, which
  // authoring.css imports and exam.css imports too. They KEEP the cream
  // pair for the same reason registration.css's six do, and the organiser's
  // repaint of them is scored separately above.
  // Phase 6 Task 7 (#71): the candidate runtime renders every prompt
  // through the same component, and the runner's ground is the page's own
  // cream rather than a card's canvas.
  ".rendered--stem": both("canvas", "cream"),
  ".prompt-editor__tool": both("canvas"),

  // ---- authoring.css: the prompt editor and preview pane (P4.5) ---------
  // Re-grounded by 6.5e Task 1b. The editor and the preview are panels on
  // the page's own --ground, each filling itself with --surface, so every
  // colour authoring.css sets is read on the surface — the same one-level
  // step the canvas-on-cream pair made.
  ".prompt-editor__source": { dark: "signal-surface", light: "signal-l-surface" },
  ".preview__heading": { dark: "signal-surface", light: "signal-l-surface" },
  ".preview__toggle": { dark: "signal-surface", light: "signal-l-surface" },

  // ---- authoring.css: the type picker's cards (6.5e Task 3, D18) --------
  // The card FILLS ITSELF with --surface and sits on the question editor's
  // own page ground, so its label and its note both read on --surface and
  // not on the --ground one step out. Traced to the declaration rather
  // than copied from a sibling: `.bank-browser__group-label` below is
  // --ground precisely because that element sets no background of its own,
  // and a card that does is the other case.
  //
  // The picked card fills with --accent-wash instead — 12% accent OVER
  // that same --surface. A 12% wash does not move the ratio enough to
  // score against, and the surface beneath it is the honest worst case:
  // the reading `.shell__nav-item[aria-current="page"]` and
  // `.home__pill[aria-pressed="true"]` already take. `aria-pressed` sets no
  // `color` of its own, so there is no second entry to make.
  //
  // Nothing else the picker adds declares `color`: every part of all twelve
  // drawn miniatures is a border, a fill or a gradient, which is why twelve
  // drawings arrive here as two entries.
  ".type-card": { dark: "signal-surface", light: "signal-l-surface" },
  ".type-card__note": { dark: "signal-surface", light: "signal-l-surface" },

  // ---- authoring.css: the bank list and bank browser (P4.2) --------------
  // `.bank-list__item` and `.bank-browser__tag-chip` are the only two
  // elements here that fill themselves (the same "card on the page" pattern
  // CardHairline uses), so everything else reads on the page's own ground.
  ".bank-list__item": { dark: "signal-surface", light: "signal-l-surface" },
  ".bank-list__count": { dark: "signal-surface", light: "signal-l-surface" },
  ".bank-browser__group-label": { dark: "signal-bg", light: "signal-l-bg" },
  ".bank-browser__tag-chip": { dark: "signal-surface", light: "signal-l-surface" },
  ".bank-browser__notice": { dark: "signal-bg", light: "signal-l-bg" },
  ".bank-browser__empty": { dark: "signal-bg", light: "signal-l-bg" },

  // ---- testbuilder.css: the builder (P5, swept from 6.5e Task 1b) -------
  // `admin-main.tsx` loads this stylesheet BESIDE admin.css rather than
  // through it, so for two phases its 26 colour-setting selectors were in
  // the organiser's bundle and outside this sweep. The sweep is derived
  // from that module now, so these arrived with it.
  //
  // Almost every one reads on the page's own --ground: the builder's
  // panels (`.setting-row`, `.timing-panel__group`, `.form-builder__field`,
  // `.picker-drawer`, each preview) are BORDERED BOXES WITH NO FILL, so
  // what shows through them is the page. The three exceptions carry their
  // own note.
  ".test-badge": { dark: "signal-bg", light: "signal-l-bg" },
  ".qr-code": { dark: "signal-bg", light: "signal-l-bg" },
  ".button-link": { dark: "signal-bg", light: "signal-l-bg" },
  ".section-row__summary": { dark: "signal-bg", light: "signal-l-bg" },
  ".section-row__draw": { dark: "signal-bg", light: "signal-l-bg" },
  ".section-row__flag-risk": { dark: "signal-bg", light: "signal-l-bg" },
  ".picker-drawer__points": { dark: "signal-bg", light: "signal-l-bg" },
  ".sets-panel__consequence, .shuffle-group__fact": { dark: "signal-bg", light: "signal-l-bg" },
  ".form-builder__fact": { dark: "signal-bg", light: "signal-l-bg" },
  ".form-builder__risk": { dark: "signal-bg", light: "signal-l-bg" },
  ".timing-panel__fact": { dark: "signal-bg", light: "signal-l-bg" },
  ".timing-panel__risk": { dark: "signal-bg", light: "signal-l-bg" },
  ".access-panel__fact, .access-panel__summary": { dark: "signal-bg", light: "signal-l-bg" },
  ".access-panel__risk": { dark: "signal-bg", light: "signal-l-bg" },
  ".access-panel__issues caption": { dark: "signal-bg", light: "signal-l-bg" },
  // `.release-panel__fact` renders on the page five times over and
  // `.branding-panel__fact` five times beside it, so this pair is the
  // page's own ground. The sixth `.branding-panel__fact` and every
  // `.branding-panel__footer` render INSIDE a preview, on its cream, and
  // are split out below (fix round 1, C2).
  ".release-panel__fact, .branding-panel__fact": {
    dark: "signal-bg",
    light: "signal-l-bg",
  },
  ".release-panel__risk, .branding-panel__risk": { dark: "signal-bg", light: "signal-l-bg" },
  ".version-banner, .review-note": { dark: "signal-bg", light: "signal-l-bg" },
  ".setting-row__button": { dark: "signal-bg", light: "signal-l-bg" },
  ".setting-row__icon": { dark: "signal-bg", light: "signal-l-bg" },
  ".setting-row__summary": { dark: "signal-bg", light: "signal-l-bg" },
  ".checklist-rail__count": { dark: "signal-bg", light: "signal-l-bg" },
  ".checklist-rail__pin": { dark: "signal-bg", light: "signal-l-bg" },

  // The branding preview is a MINIATURE OF THE CANDIDATE'S START PAGE, so
  // its WHOLE SUBTREE is the cream world, not only its fill — which is the
  // half the first version of this got wrong. `both(...)` and not a pair:
  // the fill is `var(--color-cream)` on either ground, so a semantic name
  // in here would be scored against a fixed cream and pass on one ground
  // only. That is exactly how #1.11:1 shipped green (fix round 1, C1/C2).
  //
  // The <h4> carries the brand colour, with the runtime's own ink as its
  // fallback; `.branding-panel__preview` itself paints the three previews'
  // bare <p> messages, which declare no colour of their own.
  ".branding-panel__preview h4": both("cream"),
  ".branding-panel__preview": both("cream"),
  ".branding-panel__preview .branding-panel__fact, .branding-panel__footer":
    both("cream"),

  // The checklist renders in the docked rail, which has no fill, AND inside
  // the floating panel the collapsed strip opens, which fills itself with
  // --surface. Both are real, so both are named and both are scored.
  ".publish-checklist__severity": {
    dark: ["signal-bg", "signal-surface"],
    light: ["signal-l-bg", "signal-l-surface"],
  },
  ".publish-checklist__field": {
    dark: ["signal-bg", "signal-surface"],
    light: ["signal-l-bg", "signal-l-surface"],
  },

  // ---- exam.css: the candidate runtime (Phase 6 Task 1, #65) -------------
  // DESIGN.md's two canvases. The landing hero is the full-bleed voltage
  // field; everything below it is the cream-and-ink page `base.css` sets on
  // `body`, because `.exam-landing-body` fills nothing of its own.
  //
  // Cream on voltage is 3.86:1 — it clears the 3:1 large-text bar at the
  // hero's 56px and fails the 4.5:1 bar at any reading size, which is why
  // the hero carries the headline and nothing else and why the `color` is
  // declared on the <h1> (beside its own font-size) rather than on the
  // container, where a later paragraph would inherit it silently. This
  // entry is what stops that from being a comment nobody enforces.
  ".exam-landing-hero h1": both("voltage"),
  ".exam-facts dt": both("cream"),
  ".exam-section-count, .exam-section-limit": both("cream"),
  // The pill CTA fills itself with voltage-deep (5.66:1 against cream),
  // not voltage — a button label is body text and gets the 4.5:1 bar.
  ".exam-landing-actions .exam-start": both("voltage-deep"),
  // The disabled state fills itself with the page's own canvas in both
  // themes (fix round 1, C1 — it used to fill itself with `hairline`,
  // which the high-contrast block swaps to `ink`).
  ".exam-landing-actions button:disabled": both("canvas"),
  // The device report sits on the page's own cream, like everything else
  // in `.exam-landing-body`.
  '.exam-device-report li[data-ok="false"] .exam-finding-mark': both("cream"),
  '.exam-device-report li[data-ok="true"] .exam-finding-mark': both("cream"),
  ".exam-landing-footer": both("cream"),

  // ---- exam.css: registration (C-02/C-03, Task 6). The alert sits on the
  // page's own cream, above the panel; everything inside the panel is on
  // the canvas it fills itself with, which is the same ground the same
  // renderer is read on in the organiser app. -----------------------------
  ".exam-register-notice": both("cream"),
  ".exam-register-status": both("canvas"),
  ".exam-register-submit": both("voltage-deep"),
  ".exam-register-submit:disabled, .exam-register-secondary:disabled": both("canvas"),

  // ---- exam.css: the test runner (Phase 6 Task 6, #70) -------------------
  // DESIGN.md, "The clock kills the canvas": the runner is cream and ink.
  // The page's own ground is the cream base.css paints on <body>; a
  // control that fills itself (every button, the palette squares, the
  // calculator) reads on its own fill instead, and that fill is what is
  // named here.
  //
  // The high-contrast swap in the same file redefines five of these
  // tokens on `:root[data-contrast="high"]`, and every one of those swaps
  // RAISES the ratio (hairlines to ink, cream to white, muted to
  // ink-soft). The default theme audited below is therefore the floor,
  // not an average.
  ".exam-skip": both("canvas"),
  ".exam-font-scale legend, .exam-view-choice": both("cream"),
  ".exam-contrast-switch, .exam-calc-open, .exam-button, .exam-clear": both("canvas"),
  '.exam-contrast-switch[aria-checked="true"]': both("cream"),
  '.exam-button[aria-pressed="true"]': both("canvas"),
  ".exam-button:disabled": both("canvas"),
  ".exam-clear": both("canvas"),
  ".exam-question-stem": both("cream"),
  // The save banner (Task 8). Four state selectors, each setting its own
  // colour next to its own size and weight, on the runner bar — which
  // fills nothing, so the ground is the page's cream. The mono mark
  // inside inherits each of these and renders at 12px/700, below the
  // large-text floor, so it is held to the same 4.5:1 these are.
  '.exam-save-banner[data-state="saving"]': both("cream"),
  '.exam-save-banner[data-state="saved"]': both("cream"),
  '.exam-save-banner[data-state="offline"]': both("cream"),
  '.exam-save-banner[data-state="refused"]': both("cream"),
  // The countdown (Task 9). `.exam-timer` fills itself with cream
  // (DESIGN.md's `timer-chip`), so every colour inside it renders on
  // cream — including the urgent swap, the one colour change DESIGN.md
  // allows a timer to make. `.exam-clock-announce` sits on the runner
  // bar, which fills nothing, so it is on the page's cream too. The mark
  // renders at 12px/700, below the large-text floor, and is held to the
  // same 4.5:1 as everything else here.
  ".exam-timer-label": both("cream"),
  ".exam-timer-value": both("cream"),
  ".exam-timer-mark": both("cream"),
  ".exam-timer.timer-chip-urgent .exam-timer-value": both("cream"),
  ".exam-clock-announce": both("cream"),
  ".exam-confirm": both("canvas"),
  ".exam-confirm-danger": both("canvas"),

  // ---- exam.css: submitting, and the finish page (Task 11, #75) ---------
  // The one primary action in the runner fills itself with voltage-deep
  // and writes in cream; disabled it falls back to the bar's own cream
  // ground. The refusal sentence sits in the bar beside it.
  ".exam-submit": both("voltage-deep"),
  ".exam-submit:disabled": both("canvas"),
  ".exam-submit-error": both("cream"),
  // The result, on the finish page's cream body. The verdict chip and
  // every review card paint their own canvas first; the table and the
  // pending note sit directly on cream.
  ".exam-verdict": both("canvas"),
  ".exam-verdict[data-passed=\"false\"]": both("canvas"),
  ".exam-result-pending": both("cream"),
  ".exam-result-table caption": both("cream"),
  ".exam-result-table thead th": both("cream"),
  ".exam-review-number": both("canvas"),
  // DESIGN.md's `palette-square` family. Each variant fills itself from
  // its own state token and writes the number in cream; the default and
  // the "you are here" ring sit on the square's own canvas.
  ".palette-square": both("canvas"),
  ".palette-square.is-filled": both("state-answered"),
  ".palette-square.has-notch": both("state-marked"),
  ".palette-square.has-ring": both("canvas"),
  ".palette-square.has-lock": both("state-locked"),
  // Why the locked squares are locked (Task 10). Under the rail, on the
  // page's own cream.
  ".exam-palette-reason": both("cream"),
  ".exam-calc-display": both("canvas"),
  ".exam-calc-key, .exam-calc-close": both("canvas"),

  // ---- exam.css: the answer block (Phase 6 Task 7, #71) ------------------
  // The runner's own ground is the cream base.css paints on <body>; every
  // control that fills itself (option rows, selects, text fields, the
  // inline blanks) reads on its own canvas fill, and that fill is what is
  // named here. Both grounds are re-audited under the high-contrast swap
  // by the block at the foot of this file.
  ".exam-assertion-reason dt": both("cream"),
  ".exam-options-legend": both("cream"),
  ".exam-answer-status": both("cream"),
  ".exam-option-row": both("canvas"),
  // DESIGN.md's option-row-selected fills itself with cream.
  ".exam-option-row.is-selected": both("cream"),
  // Disabled fills itself with the page's own canvas in BOTH themes, with
  // a dashed edge carrying the de-emphasis — the fix round 1 C1 rule.
  ".exam-option-row:has(input:disabled)": both("canvas"),
  ".exam-match-left": both("canvas"),
  ".exam-match-caption": both("cream"),
  ".exam-select, .exam-text-input, .exam-text-area": both("canvas"),
  ".exam-select:disabled, .exam-text-input:disabled, .exam-text-area:disabled": both("canvas"),
  ".exam-field-label": both("cream"),
  ".exam-unit": both("cream"),
  // The blanks are interleaved into the prompt, which sits on the page.
  ".exam-blanks": both("cream"),
  ".exam-blank-input": both("canvas"),
  ".exam-blank-input:disabled": both("canvas"),
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
  // ---- admin.css (Phase 6.5e Task 1b) -------------------------------------
  // The organiser's own ground and default ink. base.css gives `body` the
  // body-md scale and admin.css re-colours it without restating the type,
  // so the size comes from there.
  ":root[data-theme] body": { px: 16, weight: 400 },
  // The repaint rules for the two SHARED stylesheets change nothing but a
  // colour, so each one's size and weight are its own rule's, over in
  // registration.css and question.css.
  ":root[data-theme] .field-label": { px: 18, weight: 500 },
  ":root[data-theme] .field-help": { px: 14, weight: 400 },
  ":root[data-theme] .field-error": { px: 14, weight: 400 },
  ":root[data-theme] .text-input": { px: 16, weight: 400 },
  ":root[data-theme] .registration-form__help, :root[data-theme] .registration-form__legend":
    { px: 14, weight: 400 },
  ":root[data-theme] .registration-form__error": { px: 14, weight: 400 },
  ":root[data-theme] .rendered--stem": { px: 18, weight: 400 },
  ":root[data-theme] .prompt-editor__tool": { px: 12, weight: 400 },

  // ---- testbuilder.css (Phase 6.5e Task 1b) -------------------------------
  // The builder's facts, consequences and summaries are <p> elements that
  // declare no type of their own and inherit the body scale; the three
  // buttons here declare `font: inherit`, which is the same 16px/400 by a
  // different route. `.qr-code` and `.setting-row__icon` set a colour for an
  // svg's `currentColor` rather than for text, and take the inherited scale
  // for the same reason every wrapper above does.
  ".qr-code": { px: 16, weight: 400 },
  ".button-link": { px: 16, weight: 400 },
  ".section-row__summary": { px: 16, weight: 400 },
  ".picker-drawer__points": { px: 16, weight: 400 },
  ".sets-panel__consequence, .shuffle-group__fact": { px: 16, weight: 400 },
  ".form-builder__fact": { px: 16, weight: 400 },
  ".form-builder__risk": { px: 16, weight: 400 },
  ".timing-panel__fact": { px: 16, weight: 400 },
  ".timing-panel__risk": { px: 16, weight: 400 },
  ".access-panel__fact, .access-panel__summary": { px: 16, weight: 400 },
  ".access-panel__risk": { px: 16, weight: 400 },
  ".access-panel__issues caption": { px: 16, weight: 400 },
  ".release-panel__fact, .branding-panel__fact": { px: 16, weight: 400 },
  ".branding-panel__preview .branding-panel__fact, .branding-panel__footer": {
    px: 16,
    weight: 400,
  },
  // The preview's own colour paints its bare <p> messages, which inherit
  // the body scale like every other <p> in this file.
  ".branding-panel__preview": { px: 16, weight: 400 },
  ".release-panel__risk, .branding-panel__risk": { px: 16, weight: 400 },
  ".version-banner, .review-note": { px: 16, weight: 400 },
  ".setting-row__button": { px: 16, weight: 400 },
  ".setting-row__icon": { px: 16, weight: 400 },
  ".setting-row__summary": { px: 16, weight: 400 },
  ".checklist-rail__count": { px: 16, weight: 400 },
  ".checklist-rail__pin": { px: 16, weight: 400 },
  // An <h4> with no type of its own: the UA's own 1em bold.
  ".branding-panel__preview h4": { px: 16, weight: 700 },

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

  // ---- exam.css (Phase 6, the candidate runtime) --------------------------
  // The pill CTA and its disabled state are the same <button> as
  // `.exam-landing-actions button`, whose `font: inherit` resolves to the
  // body text base.css sets (type-body-md, 16px/400). `font: inherit` is a
  // shorthand this parser cannot read, so the size is supplied here.
  ".exam-landing-actions .exam-start": { px: 16, weight: 400 },
  ".exam-landing-actions button:disabled": { px: 16, weight: 400 },
  // The two device-report marks set colour only; size and weight both come
  // from the shared `.exam-finding-mark` base rule (type-mono-sm, 12px,
  // weight 700). 12px bold is still below the 18.66px large-text floor, so
  // both are held to 4.5:1 — which is the point of auditing them.
  '.exam-device-report li[data-ok="false"] .exam-finding-mark': { px: 12, weight: 700 },
  '.exam-device-report li[data-ok="true"] .exam-finding-mark': { px: 12, weight: 700 },

  // The registration pill and its disabled state set colour only; size and
  // weight come from the `.exam-register-submit, .exam-register-secondary`
  // rule on the same element (type-button-md, 16px, weight 500).
  ".exam-register-submit": { px: 16, weight: 500 },
  ".exam-register-submit:disabled, .exam-register-secondary:disabled": { px: 16, weight: 500 },

  // The urgent countdown sets colour only; size and weight come from
  // `.exam-timer-value`'s own rule on the same element (type-timer-numeric,
  // 20px, weight 500). 20px clears the 18.66px large-text floor, so it is
  // held to 3:1 — the same floor the duplicated declarations resolved to.
  ".exam-timer.timer-chip-urgent .exam-timer-value": { px: 20, weight: 500 },

  // ---- exam.css, Task 11 (#75): submitting and the finish page -----------
  // The disabled Submit button is the same <button> as `.exam-submit`,
  // whose own rule sets type-button-md (16px, weight 500).
  ".exam-submit:disabled": { px: 16, weight: 500 },
  // The refusal sentence and the pending note are bare <p> elements with
  // no size of their own, so they render at the runner's own body size —
  // type-body-md, 16px, weight 400. The runner's `--exam-font-scale` only
  // ever makes that larger, so 16px is the conservative case.
  ".exam-submit-error": { px: 16, weight: 400 },
  ".exam-result-pending": { px: 16, weight: 400 },
  // The verdict chip declares its own weight (600) and no size: it sits in
  // the finish page's body text, 16px.
  ".exam-verdict": { px: 16, weight: 600 },
  // The failing variant is the same element; only the colour changes.
  ".exam-verdict[data-passed=\"false\"]": { px: 16, weight: 600 },
};

// Pure wrapper selectors: every piece of text under them is an element with
// its own `color` declaration (already covered), so the wrapper's colour
// never paints anything.
const WRAPPER_SELECTORS_WITH_NO_OWN_TEXT = new Set([
  ".card-hairline", // every usage wraps only child elements, never bare text
]);

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

// Phase 6.5b Task 3. theme.css maps a semantic name — `--ink`, `--accent` —
// to a different palette token on each ground, so a rule that reads one
// resolves to a different colour per ground and has to be scored twice.
// Nothing in the bundle reads a semantic name yet (6.5c/d/e are what put
// them there); this is the hook that makes the doubled sweep load-bearing
// the day the first rule lands, instead of a second pass over this file.
const THEME = readThemeMap();
const SEMANTIC_VAR_RE = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;
// Phase 6.5e Task 1b. `var(--brand-primary, var(--color-ink))` — a property
// set from an effect, with a token fallback — entered the sweep with
// testbuilder.css. The FALLBACK is what this file can score and what it
// must: the custom property is a workspace's own brand colour, chosen at
// runtime and gated on the write path by `@pariksha/core`'s own
// `contrastRatio` (the gate this file shares), while the fallback is what
// the stylesheet guarantees before any colour is chosen. Reading the
// fallback is therefore the stylesheet's own worst case, not a shortcut.
const VAR_FALLBACK_RE = /^var\(\s*--[a-z0-9-]+\s*,\s*(.+)\)$/i;

/** `value` as a token name on `ground`, through theme.css where it applies. */
function colorNameOf(value: string, ground: Ground): ColorName | null {
  const fallback = VAR_FALLBACK_RE.exec(value)?.[1];
  if (fallback !== undefined) return colorNameOf(fallback.trim(), ground);
  const semantic = SEMANTIC_VAR_RE.exec(value)?.[1];
  const mapped = semantic === undefined ? undefined : THEME[ground][semantic];
  const name = COLOR_VAR_RE.exec(mapped ?? value)?.[1];
  if (!name || !(name in tokens.colors)) return null;
  return name as ColorName;
}

function parseColorProperty(
  body: string,
  property: string,
  ground: Ground,
): ColorName | null {
  const value = findDeclaration(body, property);
  if (!value) return null;
  return colorNameOf(value, ground);
}

function parseColor(body: string, ground: Ground): ColorName | null {
  return parseColorProperty(body, "color", ground);
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

function surfacesOf(selector: string, ground: Ground): ColorName[] {
  const entry = SURFACE[selector];
  // Still thrown, and still the point: a selector whose colour is set on one
  // ground and inherited on the other has no entry here, and must fail loudly
  // rather than be silently skipped.
  if (entry === undefined) {
    throw new Error(`no SURFACE entry for ${selector}`);
  }
  const value = entry[ground];
  return Array.isArray(value) ? value : [value];
}

let colorSelectors: string[];
let ruleBodies: Map<string, string>;
let resolutionErrors: string[];
let resolved: Record<Ground, Map<string, Resolved>>;

beforeAll(() => {
  // P3.9: the organiser screens are a second real stylesheet entry
  // (admin.css, loaded only by src/admin-main.tsx) and every colour it
  // declares has to clear the same bar. One shared `seen` set so
  // primitives.css — imported by both entries — is read exactly once.
  // P6.1 (#65): exam.css is a third entry, loaded only by
  // src/exam-main.tsx, and joins the same sweep. It imports nothing, so the
  // shared `seen` set is unaffected by it.
  const seen = new Set<string>();
  // Phase 6.5e Task 1b: the organiser side is READ OFF `admin-main.tsx`
  // rather than named as `admin.css`. `admin-main.tsx` loads
  // `testbuilder.css` BESIDE `admin.css` rather than through it, so for two
  // phases the builder's 26 colour-setting selectors were in the bundle and
  // outside this sweep — the file's own header at the top recorded the gap.
  // Deriving the list means the sweep widens with the entry rather than the
  // next time someone notices.
  //
  // base.css is dropped from it, and that exclusion is the one this file
  // already documents at the top: it carries selectors this parser was never
  // built for (`a { color: inherit }`, `:focus-visible`'s non-token
  // `outline-color`), and the two it has that paint visible text — `body`
  // and `.skip-link` — are checked directly in the "base.css" describe block
  // below, by the same WCAG formula. admin.css's OWN `body` rule, which is
  // the organiser's ground, is in the sweep and has its own entry.
  const organiserCss = organiserStylesheets()
    .filter((path) => !path.endsWith("base.css"))
    .map((path) => readResolvedCss(path, seen))
    .join("\n");
  const css = `${readResolvedCss(LANDING_CSS_PATH, seen)}
${organiserCss}
${readResolvedCss(EXAM_CSS_PATH, seen)}`;
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
  resolved = { dark: new Map(), light: new Map() };
  for (const selector of colorSelectors) {
    if (WRAPPER_SELECTORS_WITH_NO_OWN_TEXT.has(selector)) continue;
    const body = ruleBodies.get(selector) ?? "";

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

    for (const ground of GROUNDS) {
      const fg = parseColor(body, ground);
      if (!fg) {
        resolutionErrors.push(
          `${selector} (${ground}): cannot parse a var(--color-*) foreground from its own color declaration`,
        );
        continue;
      }
      resolved[ground].set(selector, { fg, px, weight });
    }
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

// ---------------------------------------------------------------------------
// The high-contrast cascade (Phase 6 Task 6, fix round 1, C1)
//
// `exam.css` carries a `:root[data-contrast="high"]` block that redefines
// five `--color-*` tokens, and `ViewControls` sets that attribute on
// <html>. Everything above audits the DEFAULT cascade only, so for a while
// the report claimed the default was "the floor, not an average" on the
// grounds that every swap raises contrast. That is true of a swapped
// FOREGROUND against a fixed ground and false of a swapped BACKGROUND:
// `hairline` -> `ink` under an `ink-soft` label measured 1.47:1, on the
// `Previous` button that is disabled on question 1 of every paper.
//
// So the swap is read out of the stylesheet itself — never hand-typed,
// which would drift — and every exam.css usage is audited a second time
// with both halves of the pair mapped through it. The attribute is
// document-global and survives the runner unmounting, so the landing
// selectors in the same file are in scope too.
const examRules = parseRuleBodies(readResolvedCss(EXAM_CSS_PATH));
const EXAM_SELECTORS = new Set(examRules.map((rule) => rule.selector));
const HIGH_CONTRAST_SELECTOR = ':root[data-contrast="high"]';
const CUSTOM_COLOR_PROPERTY_RE = /^--color-([a-z0-9-]+)$/i;

function parseHighContrastSwap(): Partial<Record<ColorName, ColorName>> {
  const body = examRules.find(
    (rule) => rule.selector === HIGH_CONTRAST_SELECTOR,
  )?.body;
  if (body === undefined) {
    throw new Error(`exam.css declares no ${HIGH_CONTRAST_SELECTOR} rule`);
  }
  const swap: Partial<Record<ColorName, ColorName>> = {};
  for (const decl of declarations(body)) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const property = CUSTOM_COLOR_PROPERTY_RE.exec(decl.slice(0, colon).trim());
    const from = property?.[1];
    if (!from) continue; // --exam-edge / --exam-ring, not colours
    const to = COLOR_VAR_RE.exec(decl.slice(colon + 1).trim())?.[1];
    if (!from || !to || !(from in tokens.colors) || !(to in tokens.colors)) {
      throw new Error(
        `${HIGH_CONTRAST_SELECTOR} maps --color-${String(from)} to something that is not a token var(--color-*)`,
      );
    }
    swap[from as ColorName] = to as ColorName;
  }
  return swap;
}

const HIGH_CONTRAST = parseHighContrastSwap();

function underHighContrast(name: ColorName): ColorName {
  return HIGH_CONTRAST[name] ?? name;
}

describe('exam.css with data-contrast="high" clears the same bar (C1)', () => {
  it("reads a real swap out of the stylesheet, so the sweep below is not vacuous", () => {
    expect(Object.keys(HIGH_CONTRAST).length).toBeGreaterThanOrEqual(5);
    expect(HIGH_CONTRAST.hairline).toBe("ink");
    expect(HIGH_CONTRAST["hairline-strong"]).toBe("ink");
  });

  it("swaps at least one token exam.css uses as a BACKGROUND, which is the whole point", () => {
    // A swapped foreground can only raise the ratio against a fixed
    // ground; only a swapped ground can invert a pair. If no exam.css
    // surface is ever swapped, every assertion below duplicates one
    // already made and this file would be auditing nothing new.
    const swappedGrounds = [
      ...new Set(
        Object.keys(SURFACE)
          .filter((selector) => EXAM_SELECTORS.has(selector))
          .flatMap((selector) => surfacesOf(selector, "dark")),
      ),
    ].filter((bg) => bg in HIGH_CONTRAST);
    expect(swappedGrounds.length).toBeGreaterThan(0);
  });

  it("exam.css resolves identically on both grounds, so reading one is enough", () => {
    // The sweep below reads the `dark` ground only. That is not a shortcut:
    // the candidate runtime carries no `data-theme` switch — D20's two
    // grounds are the organiser's — and exam.css reads no semantic name, so
    // every entry it owns resolves the same either way. Asserted rather than
    // claimed, because the day a candidate screen does read one, this is
    // what says so.
    const differing = [...EXAM_SELECTORS].filter((selector) => {
      const entry = SURFACE[selector];
      if (entry === undefined) return false;
      return (
        JSON.stringify(entry.dark) !== JSON.stringify(entry.light) ||
        resolved.dark.get(selector)?.fg !== resolved.light.get(selector)?.fg
      );
    });
    expect(differing).toEqual([]);
  });

  for (const selector of Object.keys(SURFACE)) {
    if (!EXAM_SELECTORS.has(selector)) continue;
    for (const bg of surfacesOf(selector, "dark")) {
      it(`${selector} on ${bg} clears its WCAG threshold in high contrast`, () => {
        const usage = resolved.dark.get(selector);
        expect(usage, `${selector} did not resolve`).toBeDefined();
        if (!usage) return;
        const fg = underHighContrast(usage.fg);
        const ground = underHighContrast(bg);
        const threshold =
          usage.px >= 24 || (usage.px >= 18.66 && usage.weight >= 700)
            ? 3
            : 4.5;
        const ratio = contrastRatio(tokens.colors[fg], tokens.colors[ground]);
        expect(
          ratio,
          `${selector} in high contrast: ${fg} on ${ground} at ${usage.px}px/${usage.weight} is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
        ).toBeGreaterThanOrEqual(threshold);
      });
    }
  }
});

describe("every colour-on-surface usage clears its real WCAG threshold", () => {
  it("resolved at least one usage on each ground (sanity: not vacuous)", () => {
    for (const ground of GROUNDS) {
      expect(resolved[ground].size, ground).toBeGreaterThan(0);
    }
  });

  for (const ground of GROUNDS) {
    for (const selector of Object.keys(SURFACE)) {
      for (const bg of surfacesOf(selector, ground)) {
        it(`[${ground}] ${selector} on ${bg} clears its WCAG threshold`, () => {
          const usage = resolved[ground].get(selector);
          // Only reachable if the resolution-errors test above is already
          // failing; asserting here too gives a usage-level failure message.
          expect(usage, `${selector} did not resolve`).toBeDefined();
          if (!usage) return;
          const threshold =
            usage.px >= 24 || (usage.px >= 18.66 && usage.weight >= 700)
              ? 3
              : 4.5;
          const ratio = contrastRatio(
            tokens.colors[usage.fg],
            tokens.colors[bg],
          );
          expect(
            ratio,
            `${selector} on ${bg} (${ground}): ${usage.fg} on ${bg} at ${usage.px}px/${usage.weight} is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
          ).toBeGreaterThanOrEqual(threshold);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// theme.css's own mapping, scored on each ground (Phase 6.5b Task 3).
//
// This plan re-grounds no screen, so every SURFACE entry above carries the
// same colour on both grounds and the doubled sweep computes the same number
// twice. True, and proof of nothing — exactly the AG3 shape the spec forbids.
// What the second ground is FOR is the mapping itself: the ink, accent and
// edge roles theme.css hands 6.5c, 6.5d and 6.5e, each scored against the
// ground it will actually be read on.
//
// D1's mistake is a mapping mistake. `signal-accent #19e68c` is 1.60:1 on
// cream — illegal as text and as a border — so a light block that reached for
// the dark accent would hand three later plans an illegal pair and every
// screen built on it would be wrong. This is where that is caught, before the
// stylesheets that would make it exist.
const THEME_INK_ROLES = ["--ink", "--ink-2", "--ink-3", "--accent", "--warn", "--risk"];
const THEME_GROUNDS = ["--ground", "--ground-2", "--surface", "--surface-2"];

/** Body-text pairs (4.5:1) and non-text pairs (3:1), as semantic names. */
const THEME_PAIRS: Array<{ fg: string; bg: string; threshold: number }> = [
  ...THEME_INK_ROLES.flatMap((fg) =>
    THEME_GROUNDS.map((bg) => ({ fg, bg, threshold: 4.5 })),
  ),
  // A button label on the accent fill, resting and pressed. --accent-deep
  // joined this list in fix round 2: at its original #0a8f57 the light pair
  // measured 4.13:1 and the token was LIGHTER than the resting accent it
  // deepens. DESIGN.md now carries #065f3c — darker than resting, 7.75:1
  // under white — so the pair is scored like any other instead of carrying
  // an excuse in the ledger below.
  { fg: "--accent-ink", bg: "--accent", threshold: 4.5 },
  { fg: "--accent-ink", bg: "--accent-deep", threshold: 4.5 },
  // An input outline or a table rule is non-text: 3:1. --edge and --edge-2
  // are decoration — --edge 1.31:1 on the dark ground, --edge-2 1.67:1 on
  // the same ground and 1.54:1 on its surface — and are deliberately NOT
  // asserted here; D1 added --edge-strong precisely because neither can
  // carry a boundary that has to be seen.
  ...THEME_GROUNDS.map((bg) => ({ fg: "--edge-strong", bg, threshold: 3 })),
  // Finding 4: the focus ring is a non-text indicator, so 3:1, read against
  // every ground a focused control can sit on. base.css still paints the
  // ring with voltage; theme.css's header names the 6.5c override.
  ...THEME_GROUNDS.map((bg) => ({ fg: "--focus", bg, threshold: 3 })),
];

// Every contract name THEME_PAIRS does not score, and why. The test below
// requires each one to be in exactly one of the two lists, so a name added
// to the contract later cannot arrive unaudited and unnoticed — it fails
// here until someone either scores it or writes down why it is not scored.
const UNSCORED_BY_DESIGN: Record<string, string> = {
  // The four grounds are NOT here: they are scored above, as the `bg` of
  // every pair, so they are already in `scored` and an excuse beside that
  // would be the exact contradiction the third assertion now forbids. They
  // did sit here until fix round 3 added it, and it found them on its first
  // run — which is the whole argument for writing the assertion rather than
  // trusting the ledger.
  //
  // D1: decoration. Recomputed in fix round 4, because the figures here had
  // been one token against two grounds read as two tokens against one.
  // --edge is 1.31:1 on the dark ground and 1.21:1 on its surface, 1.19 and
  // 1.26 on the light; --edge-2 is 1.67 / 1.54 dark and 1.43 / 1.52 light.
  // --edge-strong exists precisely because neither can carry a boundary that
  // has to be seen, and IS scored, at 3:1.
  "--edge": "decoration only; a visible boundary takes --edge-strong",
  "--edge-2": "decoration only; a visible boundary takes --edge-strong",
  // Translucent composites: they have no fixed resolved colour until they
  // are composited over whatever is behind them, which this file has no
  // cascade engine to determine. The screen that lays one down owns its
  // pair, and 6.5c/d/e's own SURFACE entries are where that is caught.
  "--accent-wash": "translucent; resolves only once composited",
  "--warn-wash": "translucent; resolves only once composited",
  "--risk-wash": "translucent; resolves only once composited",
  "--wash": "translucent; resolves only once composited",
  "--wash-2": "translucent; resolves only once composited",
  "--glow": "translucent, and D20a lets it vanish on light",
  "--glow-strong": "translucent, and D20a lets it vanish on light",
  // --accent-deep was here, with light --accent-ink on it at 4.13:1 and a
  // note that the fix was a palette change rather than anything this file
  // could do. That change landed (DESIGN.md, #0a8f57 -> #065f3c), so the
  // pair is scored above now. The ledger is one entry shorter and keeps its
  // guard: this is what an entry leaving looks like, rather than a threshold
  // being lowered to let it stay.
};

describe("theme.css's semantic mapping clears its thresholds on both grounds (D1, D20)", () => {
  it("accounts for every contract name, scored or deliberately not", () => {
    const scored = new Set(THEME_PAIRS.flatMap(({ fg, bg }) => [fg, bg]));
    const unaccounted = SEMANTIC_NAMES.filter(
      (name) => !scored.has(name) && !(name in UNSCORED_BY_DESIGN),
    );
    expect(unaccounted).toEqual([]);
    // And nothing in the ledger that is no longer a contract name.
    const stale = Object.keys(UNSCORED_BY_DESIGN).filter(
      (name) => !(SEMANTIC_NAMES as readonly string[]).includes(name),
    );
    expect(stale).toEqual([]);
    // Fix round 3, finding 2. The two assertions above both pass for a name
    // that is in the ledger AND scored: `unaccounted` is empty because it is
    // scored, `stale` is empty because it is still a contract name. So a
    // fixed pair could keep its excuse sitting beside it and this suite would
    // stay green — the exact failure the ledger is advertised against. The
    // earlier report claimed the removal of --accent-deep was forced; it was
    // manual, and that claim was wrong. This is the assertion that makes it
    // true: a name is scored or excused, never both.
    const excused = Object.keys(UNSCORED_BY_DESIGN).filter((name) =>
      scored.has(name),
    );
    expect(excused).toEqual([]);
  });

  for (const ground of GROUNDS) {
    for (const { fg, bg, threshold } of THEME_PAIRS) {
      it(`[${ground}] ${fg} on ${bg} clears ${threshold}:1`, () => {
        const fgName = colorNameOf(THEME[ground][fg] ?? "", ground);
        const bgName = colorNameOf(THEME[ground][bg] ?? "", ground);
        expect(fgName, `${ground} ${fg} is not a palette token`).not.toBeNull();
        expect(bgName, `${ground} ${bg} is not a palette token`).not.toBeNull();
        if (!fgName || !bgName) return;
        const ratio = contrastRatio(
          tokens.colors[fgName],
          tokens.colors[bgName],
        );
        expect(
          ratio,
          `${ground}: ${fg} (${fgName}) on ${bg} (${bgName}) is ${ratio.toFixed(2)}:1, needs ${threshold}:1`,
        ).toBeGreaterThanOrEqual(threshold);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// The two standing guards (Phase 6.5b Task 3, Steps 5).
//
// admin-main.tsx loads admin.css and testbuilder.css; both are organiser-only
// (test/bundle.test.ts), and both are scanned here.
//
// Fix round 3, finding 3: theme.css is excluded BY SOURCE FILE, not by
// selector text. Skipping every rule whose selector reads `:root` would also
// skip a future `:root { --panel-accent: var(--color-signal-accent) }` in
// admin.css — and because usagesOf resolves one level of indirection, that
// one line would hide every downstream use of the dark accent from the guard
// this whole phase exists to provide. Pre-seeding `seen` with theme.css is
// what readResolvedCss's cycle guard already does for a file it has read, so
// the file is simply absent from the text below.
//
// tokens.css is excluded for the same reason no-hex-colors.test.ts excludes
// it: it IS DESIGN.md's output, so a literal there is not a colour declared
// outside DESIGN.md. It reaches here only through base.css's own chain.
const ORGANISER_CSS = ((seen) =>
  organiserStylesheets()
    .map((path) => readResolvedCss(path, seen))
    .join("\n"))(
  new Set<string>([
    resolve(STYLES_DIR, "theme.css"),
    resolve(STYLES_DIR, "tokens.css"),
  ]),
);
const VAR_REF_RE = /var\(\s*(--[a-z0-9-]+)\s*\)/gi;

/**
 * Selectors in `css` that paint `token` once every `var()` they read is
 * resolved on `ground`. theme.css is not in `css` at all: declaring a
 * mapping is not using it.
 */
function usagesOf(token: ColorName, ground: Ground, css = ORGANISER_CSS): string[] {
  const hits: string[] = [];
  for (const rule of parseRuleBodies(css)) {
    for (const decl of declarations(rule.body)) {
      for (const [, ref] of decl.matchAll(VAR_REF_RE)) {
        if (colorNameOf(`var(${ref})`, ground) !== token) continue;
        if (!hits.includes(rule.selector)) hits.push(rule.selector);
      }
    }
  }
  return hits;
}

// rgb()/rgba()/hsl()/hsla()/color()/lab()/lch()/oklch()/oklab() with literal
// channel values. `color-mix(...)` does not match this pattern at all (the
// hyphen stops the `color(` alternative), and a composite over a generated
// token — `rgb(from var(--color-ink) r g b / .1)`, `rgb(var(--x))` — is
// permitted by the `var(--color-*)` test below: a composite over a token is
// not a new colour, it is a mapping. What this catches is a palette decision
// taken in a stylesheet instead of in DESIGN.md's front matter.
const COLOUR_FUNCTION_RE =
  /\b(?:rgba?|hsla?|color|lab|lch|oklch|oklab)\(((?:[^()]|\([^()]*\))*)\)/gi;

function nonTokenColourLiterals(css: string): string[] {
  return [...css.matchAll(COLOUR_FUNCTION_RE)]
    .filter((match) => !/var\(\s*--color-[a-z0-9-]+\s*\)/i.test(match[1] ?? ""))
    .map((match) => match[0]);
}

// Phase 6.5c Task 3 (`D21`). The audit above reads a selector's declared
// colour; it has no opinion about opacity, because opacity is a fact about a
// STATE. `D21` creates exactly one such state — an unmatched row recedes to
// `opacity: 0.8` "and no further: past that, secondary text drops under the
// 3:1 DESIGN.md requires" — so the number is scored here, against the
// stylesheet rather than against this file's memory of it.
describe("the receded rows stay legal on both grounds (D21)", () => {
  const HOME_CSS_PATH = resolve(STYLES_DIR, "home.css");

  /** The recession as `home.css` really declares it. */
  function recession(): number {
    const body = parseRuleBodies(readResolvedCss(HOME_CSS_PATH)).find(
      (rule) => rule.selector === '.home__row[data-marked="off"]',
    )?.body;
    const value = body === undefined ? null : findDeclaration(body, "opacity");
    if (value === null) {
      throw new Error('no opacity declared for .home__row[data-marked="off"]');
    }
    return Number(value);
  }

  /** `fg` at `alpha` over `bg`, as a browser composites it. */
  function over(fg: ColorName, bg: ColorName, alpha: number): string {
    const channels = (hex: string): number[] =>
      [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    const [fr, fgc, fb] = channels(tokens.colors[fg]);
    const [br, bgc, bb] = channels(tokens.colors[bg]);
    const mix = (a: number, b: number): string =>
      Math.round(a * alpha + b * (1 - alpha))
        .toString(16)
        .padStart(2, "0");
    return `#${mix(fr ?? 0, br ?? 0)}${mix(fgc ?? 0, bgc ?? 0)}${mix(fb ?? 0, bb ?? 0)}`;
  }

  // Everything a receding row paints, and the floor each is held to: the
  // two text colours at DESIGN.md's 4.5:1 body bar, the three urgency dots
  // at the 3:1 a non-text graphic is held to.
  const IN_A_ROW: { name: string; fg: Record<Ground, ColorName>; floor: number }[] = [
    {
      name: "the subject and its action (--ink)",
      fg: { dark: "signal-text", light: "signal-l-text" },
      floor: 4.5,
    },
    {
      name: "the time and the reason (--ink-2)",
      fg: { dark: "signal-text-2", light: "signal-l-text-2" },
      floor: 4.5,
    },
    {
      name: "a neutral dot (--ink-3)",
      fg: { dark: "signal-text-3", light: "signal-l-text-3" },
      floor: 3,
    },
    {
      name: "a risk dot (--risk)",
      fg: { dark: "signal-flag-risk", light: "signal-l-flag-risk" },
      floor: 3,
    },
    {
      name: "a review dot (--warn)",
      fg: { dark: "signal-flag-review", light: "signal-l-flag-review" },
      floor: 3,
    },
    {
      name: "a changed dot (--accent)",
      fg: { dark: "signal-accent", light: "signal-l-accent" },
      floor: 3,
    },
  ];

  const PANE: Record<Ground, ColorName> = {
    dark: "signal-surface",
    light: "signal-l-surface",
  };

  it("recedes to 0.8 and no further", () => {
    expect(recession()).toBe(0.8);
  });

  for (const ground of GROUNDS) {
    for (const part of IN_A_ROW) {
      it(`[${ground}] ${part.name} is still legal at the recession`, () => {
        const alpha = recession();
        const faded = over(part.fg[ground], PANE[ground], alpha);
        const ratio = contrastRatio(faded, tokens.colors[PANE[ground]]);
        expect(
          ratio,
          `${part.fg[ground]} at ${alpha} on ${PANE[ground]} is ${ratio.toFixed(2)}:1, needs ${part.floor}:1`,
        ).toBeGreaterThanOrEqual(part.floor);
      });
    }
  }
});

describe("the organiser's standing colour guards (D1, §12)", () => {
  // Fix round 4, finding 2. The accent guard below catches a rule reaching
  // for the dark green and catches nothing if one reaches for
  // --color-signal-surface, --color-signal-text or --color-signal-line-strong
  // instead. Those are illegal by GROUND, not by contrast: a panel painted
  // signal-surface stays near-black when the viewer picks light, which is the
  // "two designs, not one design on two grounds" failure theme.css's header
  // promises to prevent. It is also the likeliest mistake on this branch — a
  // 6.5c implementer with signal.css open beside them copies
  // `background: var(--color-signal-surface)` and every test here stays green.
  //
  // So: the stricter, simpler form. An organiser stylesheet reads NO palette
  // token of either Signal family. Every colour it paints comes through a
  // semantic name, which is the entire mechanism D20 rests on. theme.css is
  // excluded by source file (it is the mapping), and base.css's voltage focus
  // ring is untouched by this because voltage is not a signal-* token — the
  // ring is named as a 6.5c handoff in theme.css's header instead.
  const SIGNAL_TOKEN_RE = /var\(\s*(--color-signal-[a-z0-9-]+)\s*\)/gi;

  function signalTokensIn(css: string): string[] {
    const hits: string[] = [];
    for (const rule of parseRuleBodies(css)) {
      for (const decl of declarations(rule.body)) {
        for (const [, token] of decl.matchAll(SIGNAL_TOKEN_RE)) {
          if (token !== undefined) hits.push(`${rule.selector} { ${token} }`);
        }
      }
    }
    return hits;
  }

  it("reads no Signal palette token directly, on either ground", () => {
    expect(signalTokensIn(ORGANISER_CSS)).toEqual([]);
  });

  it("finds the landing page's palette tokens, so the guard above is not vacuous", () => {
    // signal.css is a dark-only page and names these tokens legitimately.
    // Without this control, the empty result above would hold for a scanner
    // that matched nothing at all.
    expect(
      signalTokensIn(readResolvedCss(LANDING_CSS_PATH)).length,
    ).toBeGreaterThan(0);
  });

  it("never puts signal-accent on a light surface", () => {
    // #19e68c is 1.60:1 on cream — illegal as text and as a border. A rule
    // that reaches past --accent to the dark palette token keeps the green
    // when the viewer switches ground; --accent does not.
    expect(usagesOf("signal-accent", "light")).toEqual([]);
  });

  it("sees a :root rule in an organiser stylesheet, not just a class rule", () => {
    // The blind spot fix round 3 closed. usagesOf used to skip every rule
    // whose selector read `:root`, to avoid flagging theme.css's own
    // mapping — which also made a `:root` block in admin.css invisible, and
    // since usagesOf resolves one level of indirection, that one line would
    // have hidden every downstream use of the dark accent from this guard.
    // theme.css is excluded by SOURCE FILE now, so this is seen.
    expect(
      usagesOf(
        "signal-accent",
        "light",
        ":root { --panel-accent: var(--color-signal-accent); }",
      ),
    ).toEqual([":root"]);
  });

  it("excludes theme.css by source file, and still reads everything else", () => {
    // Both halves: the mapping's own blocks are absent (declaring is not
    // using), and the exclusion did not empty the scan along with them.
    const selectors = parseRuleBodies(ORGANISER_CSS).map((rule) => rule.selector);
    expect(selectors).not.toContain(':root[data-theme="light"]');
    expect(selectors).toContain(".organiser__title");
  });

  it("finds the landing page's own accent, so the guard above is not vacuous", () => {
    // The positive control. signal.css is a dark-only page and uses the
    // token legitimately; if the finder could not see it there, the empty
    // result above would mean nothing.
    expect(
      usagesOf("signal-accent", "dark", readResolvedCss(LANDING_CSS_PATH))
        .length,
    ).toBeGreaterThan(0);
  });

  it("declares no colour outside DESIGN.md", () => {
    // no-hex-colors.test.ts catches a raw hex and a named keyword; this
    // catches an rgb()/hsl()/color() literal in the organiser's bundle.
    expect(nonTokenColourLiterals(ORGANISER_CSS)).toEqual([]);
  });

  it("catches a literal channel value and permits a composite over a token", () => {
    // The positive control for the guard above, which would otherwise be
    // green for a detector that matched nothing at all.
    expect(nonTokenColourLiterals("a { color: rgb(255 0 0); }")).toEqual([
      "rgb(255 0 0)",
    ]);
    expect(
      nonTokenColourLiterals("a { color: hsl(120deg 50% 40%); }"),
    ).toEqual(["hsl(120deg 50% 40%)"]);
    expect(
      nonTokenColourLiterals(
        "a { box-shadow: 0 0 1px rgb(from var(--color-ink) r g b / 0.1); }",
      ),
    ).toEqual([]);
    expect(
      nonTokenColourLiterals(
        "a { background: color-mix(in srgb, var(--color-signal-accent) 12%, transparent); }",
      ),
    ).toEqual([]);
  });
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
      // base.css is the shared root both grounds sit under and reads no
      // semantic name, so the ground it is resolved on does not change it.
      const fg = parseColor(body, "dark");
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

// ---------------------------------------------------------------------------
// The publish checklist's indicator lights (Phase 6.5e Task 1b, D1/D7a).
//
// WHY THESE NEED THEIR OWN BLOCK. Every assertion above audits a
// FOREGROUND — `colorSelectors` is built from rules that declare `color` —
// and a light declares only a `background-color`. So the three colours this
// task's headline ruling rests on had no gate at all: 6.5d chose the cream
// flag trio over `theme.css`'s names on a measurement, and nothing would
// have reddened when 6.5e moved them.
//
// 6.5d's measurement was 2.68 / 2.08 / 1.60:1 and it was right about the
// page it was taken on — the lights were still on cream, where `D1` says in
// as many words that the Signal accent is illegal. It was a fact about that
// page and not about the tokens. This block is what makes the replacement
// claim checkable instead of inherited: the severities, the names and the
// dimming are all READ OUT OF the stylesheet, so a value edited there is
// scored rather than described.
//
// Scored against all four of theme.css's background tokens rather than only
// the --ground the rail renders on today. The rail is a construct that
// moves — docked, a 52px strip, and a band across the page below 719px —
// and the worst of four is both cheaper to state and stricter than the one.
describe("the publish checklist's lights clear 3:1 on both grounds (D1)", () => {
  const TESTBUILDER_CSS = resolve(STYLES_DIR, "testbuilder.css");
  const lightRules = parseRuleBodies(readResolvedCss(TESTBUILDER_CSS)).filter(
    (rule) => /^\.checklist-rail__light\[data-severity=/.test(rule.selector),
  );
  const GROUND_NAMES = ["--ground", "--ground-2", "--surface", "--surface-2"];

  /** `fg` at `alpha` over `bg`, as a hex — the colour a dimmed light really
   *  composites to. Both are opaque tokens, so one lerp per channel is the
   *  whole of it. */
  function composite(fg: string, alpha: number, bg: string): string {
    const channel = (at: number): string => {
      const mix =
        parseInt(fg.slice(at, at + 2), 16) * alpha +
        parseInt(bg.slice(at, at + 2), 16) * (1 - alpha);
      return Math.round(mix).toString(16).padStart(2, "0");
    };
    return `#${channel(1)}${channel(3)}${channel(5)}`;
  }

  it("finds all three severities, so the sweep below is not an empty loop", () => {
    // The whole rail is three lights; a renamed attribute or a deleted rule
    // would otherwise make every assertion below vacuously true.
    expect(lightRules.map((rule) => rule.selector).sort()).toEqual([
      '.checklist-rail__light[data-severity="advisory"]',
      '.checklist-rail__light[data-severity="blocking"]',
      '.checklist-rail__light[data-severity="passing"]',
    ]);
  });

  it("paints every light from theme.css, never from the cream palette", () => {
    // The other half of `D1`: a light reaching past `--risk` to
    // `var(--color-flag-risk)` would be the cream world on the Signal
    // ground, which is the move the ratios below only measure the cost of.
    for (const rule of lightRules) {
      const value = findDeclaration(rule.body, "background-color");
      expect(value, `${rule.selector} sets no background-color`).not.toBeNull();
      expect(
        SEMANTIC_VAR_RE.test(value ?? ""),
        `${rule.selector} paints with ${String(value)}, not a theme.css name`,
      ).toBe(true);
      expect(SEMANTIC_NAMES).toContain(
        SEMANTIC_VAR_RE.exec(value ?? "")?.[1] ?? "",
      );
    }
  });

  for (const ground of GROUNDS) {
    for (const name of GROUND_NAMES) {
      it(`[${ground}] every light clears 3:1 on ${name}`, () => {
        const behind = colorNameOf(`var(${name})`, ground);
        expect(behind, `theme.css maps no ${name} on ${ground}`).not.toBeNull();
        if (!behind) return;

        for (const rule of lightRules) {
          const fg = parseColorProperty(rule.body, "background-color", ground);
          expect(fg, `${rule.selector}: unresolvable fill`).not.toBeNull();
          if (!fg) return;
          // The dimming is the stylesheet's, read rather than assumed: a
          // passing light is dimmed because it is there to be counted, not
          // looked at, and a number hand-typed here would stop tracking it.
          const opacity = Number(findDeclaration(rule.body, "opacity") ?? "1");
          const painted = composite(
            tokens.colors[fg],
            opacity,
            tokens.colors[behind],
          );
          const ratio = contrastRatio(painted, tokens.colors[behind]);
          expect(
            ratio,
            `${rule.selector} on ${name} (${ground}): ${fg} at ${opacity} over ${behind} is ${ratio.toFixed(2)}:1, needs 3:1 (WCAG 1.4.11)`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
});
