import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  tokens,
  type SpacingName,
  type TypographyName,
} from "../src/styles/tokens";

// Design contract §8 T30 (issue 137's deferred dimension-guard finding,
// constraints.md §3): no previous guard compared a component's actually
// rendered box against DESIGN.md's own component table — `tokens.components`,
// already exported and already resolved by scripts/tokens.mjs — which is
// exactly how `.top-nav__inner` drifted to `padding-block: var(--space-sm)`
// against DESIGN.md's stated "12px 32px" with nothing to catch it.
//
// D5 (a fix-first review finding): `.button-secondary` also had a
// `min-height: 44px` silently overriding a `height: 40px` declared two
// lines above it, so a literal-declaration comparison like the one above
// would have kept passing while the rendered box matched neither value.
// `.button-secondary` and `.nav-link` are therefore asserted on their
// EFFECTIVE box — padding-block + border + the declared line-height, the
// box as it actually renders with no explicit height at all — rather than
// on a `height`/`min-height` declaration that can say one thing and render
// another.

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = resolve(__dirname, "../src/styles");

function readCss(file: string): string {
  return readFileSync(resolve(STYLES_DIR, file), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

// Pulls the body of the first `selector { ... }` rule. None of the rules
// this test reads nest another `{`, so a non-greedy match to the first `}`
// is enough — no need for the brace-depth parser contrast-usage.test.ts
// uses for a whole stylesheet.
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  const group = match?.[1];
  if (group === undefined) {
    throw new Error(`selector not found: ${selector}`);
  }
  return group;
}

function declaration(body: string, property: string): string {
  const group = tryDeclaration(body, property);
  if (group === null) {
    throw new Error(`no "${property}" declaration in: ${body}`);
  }
  return group;
}

// Same lookup as `declaration`, but returns null instead of throwing — used
// where a property's absence is itself the thing under test (D5: no
// `height`/`min-height` left on `.button-secondary` to drift out of sync
// with its padding).
function tryDeclaration(body: string, property: string): string | null {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`).exec(
    `${body};`,
  );
  return match?.[1]?.trim() ?? null;
}

const SPACE_VAR_RE = /var\(--space-([a-z0-9]+)\)/gi;

// Resolves every var(--space-X) in a value to its token's own px string; a
// literal (e.g. "46px", "0") passes through unchanged.
function resolveSpacing(value: string): string {
  return value.replace(SPACE_VAR_RE, (_whole, name: string) => {
    const px = tokens.spacing[name as SpacingName];
    if (px === undefined) {
      throw new Error(`unknown spacing token: --space-${name}`);
    }
    return px;
  });
}

function toPx(value: string): number {
  const match = /^(-?[\d.]+)px$/.exec(resolveSpacing(value).trim());
  if (!match) {
    throw new Error(`not a resolvable px length: "${value}"`);
  }
  return Number(match[1]);
}

const TYPE_LINE_HEIGHT_VAR_RE = /var\(--type-([a-z0-9-]+)-line-height\)/i;

// The box's content-area height: resolves whichever `line-height` token var
// the selector declares to that token's own px line-height.
function lineHeightPx(body: string): number {
  const value = declaration(body, "line-height");
  const match = TYPE_LINE_HEIGHT_VAR_RE.exec(value);
  const name = match?.[1] as TypographyName | undefined;
  const entry = name && tokens.typography[name];
  if (!entry) {
    throw new Error(`cannot resolve line-height: "${value}"`);
  }
  return toPx(entry.lineHeight);
}

// Vertical padding, from either a `padding-block` declaration or the first
// value of a `padding` shorthand (the vertical value always comes first in
// the 1-, 2- and 4-value forms, which is all this stylesheet uses).
function paddingBlockPx(body: string): number {
  const block = tryDeclaration(body, "padding-block");
  if (block !== null) return toPx(block);
  const shorthand = declaration(body, "padding");
  return toPx(shorthand.trim().split(/\s+/)[0]!);
}

// 0 for no border or `border: 0`; the declared width otherwise.
function borderWidthPx(body: string): number {
  const value = tryDeclaration(body, "border");
  if (value === null) return 0;
  const match = /^(-?[\d.]+)px/.exec(value.trim());
  return match ? Number(match[1]) : 0;
}

// The box's real rendered height with no explicit `height`/`min-height`
// declared: content line-height plus the padding and border it sits inside.
// This is what D5 means by "the effective box" rather than a `height`
// declaration that a `min-height` can silently override.
function effectiveBoxHeight(body: string): number {
  return paddingBlockPx(body) * 2 + borderWidthPx(body) * 2 + lineHeightPx(body);
}

const componentsCss = readCss("components.css");
const landingCss = readCss("landing.css");

describe("component dimensions match tokens.components (T30)", () => {
  it('.button-primary height matches tokens.components["button-primary"].height', () => {
    const body = ruleBody(componentsCss, ".button-primary ");
    const height = resolveSpacing(declaration(body, "height"));
    expect(height).toBe(tokens.components["button-primary"].height);
  });

  it('.button-secondary padding-inline matches tokens.components["button-secondary"].padding\'s inline value', () => {
    const body = ruleBody(landingCss, ".button-secondary ");
    const inline = resolveSpacing(declaration(body, "padding-inline"));
    const tokenInline =
      tokens.components["button-secondary"].padding.split(" ")[1];
    expect(inline).toBe(tokenInline);
  });

  // D5 (issue 137): a `min-height: 44px` was silently overriding a `height:
  // 40px` declared two lines above it, so neither was true of the rendered
  // box. There is now no height/min-height at all to drift out of sync —
  // the 44px A10 hit area is the box padding-block and border naturally
  // produce, asserted directly rather than via a declaration that could
  // again say one thing and render another.
  it(".button-secondary has no height or min-height declaration to drift out of sync with its padding", () => {
    const body = ruleBody(landingCss, ".button-secondary ");
    expect(tryDeclaration(body, "height")).toBeNull();
    expect(tryDeclaration(body, "min-height")).toBeNull();
  });

  it(".button-secondary's effective box (padding-block + border + line-height) is 44px", () => {
    const body = ruleBody(landingCss, ".button-secondary ");
    expect(effectiveBoxHeight(body)).toBe(44);
  });

  // A10 groups nav links with ButtonSecondary as the two hit-area cases
  // reached through block padding alone; .nav-link already does this
  // (no height/min-height of its own), so this is the same effective-box
  // assertion rather than a CSS change.
  it(".nav-link's effective box clears the 44px hit-area floor", () => {
    const body = ruleBody(componentsCss, ".nav-link ");
    expect(tryDeclaration(body, "height")).toBeNull();
    expect(tryDeclaration(body, "min-height")).toBeNull();
    expect(effectiveBoxHeight(body)).toBeGreaterThanOrEqual(44);
  });

  // DESIGN.md's "top-nav" component has one padding/height pair, but the
  // rendered box splits them across two selectors: `.top-nav` itself (no
  // box model of its own) and `.top-nav__inner`, which carries the real
  // `padding-inline`/`padding-block`/`min-height`. This test reads the inner
  // element, which is what a reader and an axe audit actually measure.
  it('.top-nav__inner padding matches tokens.components["top-nav"].padding (block inline)', () => {
    const body = ruleBody(componentsCss, ".top-nav__inner ");
    const block = resolveSpacing(declaration(body, "padding-block"));
    const inline = resolveSpacing(declaration(body, "padding-inline"));
    expect(`${block} ${inline}`).toBe(tokens.components["top-nav"].padding);
  });

  it('.top-nav__inner min-height matches tokens.components["top-nav"].height', () => {
    const body = ruleBody(componentsCss, ".top-nav__inner ");
    const height = resolveSpacing(declaration(body, "min-height"));
    expect(height).toBe(tokens.components["top-nav"].height);
  });
});
