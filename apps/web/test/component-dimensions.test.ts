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

// P3.9: `.button-primary`, `.button-secondary`, `.card-hairline` and
// `.mono-caption` moved into primitives.css so the organiser entry
// (admin.css) can reuse them without dragging the landing page's hero,
// section and island CSS along. Same rules, one file further up the
// @import chain — landing.css still imports it, so the rendered landing
// stylesheet is byte-for-byte the same set of declarations.
const primitivesCss = readCss("primitives.css");
// Phase 6 Task 6 (#70): `.text-input` and the field trio moved out of
// admin.css into registration.css, which both the organiser entry and the
// candidate entry import — the candidate registration screen renders the
// same form. Same rules, same assertions, read from where they now live.
const registrationCss = readCss("registration.css");
// P6.6 (#70): the candidate runtime's own stylesheet, and the one
// DESIGN.md component this phase builds — `palette-square`, which
// `DESIGN.md:344-350` already pins at 36px / `{rounded.sm}`. T30 exists
// because `.top-nav__inner` drifted from DESIGN.md with nothing to catch
// it; hand-writing 36px beside the guard built to measure it is the same
// drift one commit earlier.
const examCss = readCss("exam.css");

describe("component dimensions match tokens.components (T30)", () => {
  it('.button-primary height matches tokens.components["button-primary"].height', () => {
    const body = ruleBody(primitivesCss, ".button-primary ");
    const height = resolveSpacing(declaration(body, "height"));
    expect(height).toBe(tokens.components["button-primary"].height);
  });

  it('.button-secondary padding-inline matches tokens.components["button-secondary"].padding\'s inline value', () => {
    const body = ruleBody(primitivesCss, ".button-secondary ");
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
    const body = ruleBody(primitivesCss, ".button-secondary ");
    expect(tryDeclaration(body, "height")).toBeNull();
    expect(tryDeclaration(body, "min-height")).toBeNull();
  });

  it(".button-secondary's effective box (padding-block + border + line-height) is 44px", () => {
    const body = ruleBody(primitivesCss, ".button-secondary ");
    expect(effectiveBoxHeight(body)).toBe(44);
  });

  // A10 groups nav links with ButtonSecondary as the two hit-area cases
  // reached through block padding alone; .nav-link already does this
  // (no height/min-height of its own), so this is the same effective-box
  // assertion rather than a CSS change.
  // `.nav-link` and `.top-nav__inner` were the old landing page's TopNav,
  // deleted with it. DESIGN.md still specifies both — like most of its
  // component table, which describes screens that are not built yet — so
  // the spec stays and the guard returns when something implements it.

  // P3.9: the one component the organiser screens had to add. DESIGN.md
  // gives `text-input` a height AND a padding; with the global
  // `box-sizing: border-box` those two are consistent rather than D5's
  // conflicting pair, so both are asserted against the token and no
  // `line-height` is declared that would push the content box past the
  // stated 44px — which is also the A10 hit-area floor.
  it('.text-input height matches tokens.components["text-input"].height', () => {
    const body = ruleBody(registrationCss, ".text-input ");
    expect(resolveSpacing(declaration(body, "height"))).toBe(
      tokens.components["text-input"].height,
    );
  });

  it('.text-input padding matches tokens.components["text-input"].padding', () => {
    const body = ruleBody(registrationCss, ".text-input ");
    expect(resolveSpacing(declaration(body, "padding"))).toBe(
      tokens.components["text-input"].padding,
    );
  });

  it('.text-input border-radius matches tokens.components["text-input"].rounded', () => {
    const body = ruleBody(registrationCss, ".text-input ");
    expect(declaration(body, "border-radius")).toBe("var(--rounded-xs)");
    expect(tokens.rounded.xs).toBe(tokens.components["text-input"].rounded);
  });

  it(".text-input declares no line-height that would break its stated 44px box", () => {
    const body = ruleBody(registrationCss, ".text-input ");
    expect(tryDeclaration(body, "line-height")).toBeNull();
  });

  // ---- palette-square (P6.6, #70) ---------------------------------------

  it('.palette-square height matches tokens.components["palette-square"].height', () => {
    const body = ruleBody(examCss, ".palette-square ");
    expect(resolveSpacing(declaration(body, "height"))).toBe(
      tokens.components["palette-square"].height,
    );
  });

  it(".palette-square is square: its width equals its stated height", () => {
    const body = ruleBody(examCss, ".palette-square ");
    expect(resolveSpacing(declaration(body, "width"))).toBe(
      tokens.components["palette-square"].height,
    );
  });

  it('.palette-square border-radius matches tokens.components["palette-square"].rounded', () => {
    const body = ruleBody(examCss, ".palette-square ");
    expect(declaration(body, "border-radius")).toBe("var(--rounded-sm)");
    expect(tokens.rounded.sm).toBe(tokens.components["palette-square"].rounded);
  });

  it('.palette-square font-size matches tokens.components["palette-square"].typography', () => {
    const body = ruleBody(examCss, ".palette-square ");
    expect(declaration(body, "font-size")).toBe("var(--type-mono-sm-size)");
    expect(tokens.typography["mono-sm"].fontSize).toBe(
      tokens.components["palette-square"].typography.fontSize,
    );
  });

  // DESIGN.md gives each variant the same 36px box, so none of them may
  // redeclare a height of its own — the thing D5 caught on
  // `.button-secondary`, where two declarations disagreed and neither was
  // what rendered.
  it("no palette-square variant redeclares a height that could drift from the base rule", () => {
    for (const variant of ["is-filled", "has-notch", "has-ring", "has-lock"]) {
      const body = ruleBody(examCss, `.palette-square.${variant}`);
      expect(tryDeclaration(body, "height"), variant).toBeNull();
      expect(tryDeclaration(body, "width"), variant).toBeNull();
    }
    // The three DESIGN.md names behind those classes carry the same box.
    for (const name of [
      "palette-square-answered",
      "palette-square-marked",
      "palette-square-current",
    ] as const) {
      expect(tokens.components[name].height).toBe(
        tokens.components["palette-square"].height,
      );
    }
  });

  // ---- option-row (P6.7, #71) -------------------------------------------
  //
  // DESIGN.md: "White, 1px hairline-strong, 6px radius, 14x16px padding.
  // The entire row is the hit target, not just the radio or checkbox.
  // Minimum height 48px." Four of those five facts are in
  // tokens.components; the 48px floor is prose only, so it is asserted
  // against the literal DESIGN.md states.

  it('.exam-option-row padding matches tokens.components["option-row"].padding', () => {
    const body = ruleBody(examCss, ".exam-option-row ");
    expect(resolveSpacing(declaration(body, "padding"))).toBe(
      tokens.components["option-row"].padding,
    );
  });

  it('.exam-option-row border-radius matches tokens.components["option-row"].rounded', () => {
    const body = ruleBody(examCss, ".exam-option-row ");
    expect(declaration(body, "border-radius")).toBe("var(--rounded-md)");
    expect(tokens.rounded.md).toBe(tokens.components["option-row"].rounded);
  });

  it('.exam-option-row typography matches tokens.components["option-row"]', () => {
    const body = ruleBody(examCss, ".exam-option-row ");
    const typography = tokens.components["option-row"].typography;
    expect(declaration(body, "font-size")).toBe("var(--type-option-label-size)");
    expect(declaration(body, "line-height")).toBe("var(--type-option-label-line-height)");
    expect(tokens.typography["option-label"].fontSize).toBe(typography.fontSize);
    expect(tokens.typography["option-label"].lineHeight).toBe(typography.lineHeight);
  });

  it(".exam-option-row clears DESIGN.md's 48px minimum hit target", () => {
    const body = ruleBody(examCss, ".exam-option-row ");
    expect(toPx(declaration(body, "min-height"))).toBeGreaterThanOrEqual(48);
    // The whole row, not the control: a flex row with the padding above
    // is the hit target only because the element itself is the label.
    expect(declaration(body, "display")).toBe("flex");
  });

  // The selected variant is a different FILL and a different EDGE, never
  // a different box — D5's failure mode, and the reason a candidate's
  // layout must not shift when they answer ("a layout that shifts between
  // questions reads as the page reloading").
  it("the selected and disabled variants redeclare no box of their own", () => {
    for (const selector of [
      ".exam-option-row.is-selected",
      ".exam-option-row:has(input:disabled)",
    ]) {
      const body = ruleBody(examCss, selector);
      expect(tryDeclaration(body, "min-height"), selector).toBeNull();
      expect(tryDeclaration(body, "height"), selector).toBeNull();
      expect(tryDeclaration(body, "padding"), selector).toBeNull();
    }
    // The selected row's 2px border is DESIGN.md's own, and it is drawn
    // inside the same box because the base rule already reserves an edge.
    expect(
      declaration(ruleBody(examCss, ".exam-option-row.is-selected"), "border-width"),
    ).toBe("2px");
    expect(tokens.components["option-row-selected"].padding).toBe(
      tokens.components["option-row"].padding,
    );
  });
});
