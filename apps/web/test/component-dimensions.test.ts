import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tokens, type SpacingName } from "../src/styles/tokens";

// Design contract §8 T30 (issue 137's deferred dimension-guard finding,
// constraints.md §3): no previous guard compared a component's actually
// rendered box against DESIGN.md's own component table — `tokens.components`,
// already exported and already resolved by scripts/tokens.mjs — which is
// exactly how `.top-nav__inner` drifted to `padding-block: var(--space-sm)`
// against DESIGN.md's stated "12px 32px" with nothing to catch it.

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
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`).exec(
    `${body};`,
  );
  const group = match?.[1];
  if (group === undefined) {
    throw new Error(`no "${property}" declaration in: ${body}`);
  }
  return group.trim();
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

const componentsCss = readCss("components.css");
const landingCss = readCss("landing.css");

describe("component dimensions match tokens.components (T30)", () => {
  it('.button-primary height matches tokens.components["button-primary"].height', () => {
    const body = ruleBody(componentsCss, ".button-primary ");
    const height = resolveSpacing(declaration(body, "height"));
    expect(height).toBe(tokens.components["button-primary"].height);
  });

  it('.button-secondary padding matches tokens.components["button-secondary"].padding', () => {
    const body = ruleBody(landingCss, ".button-secondary ");
    const padding = resolveSpacing(declaration(body, "padding"));
    expect(padding).toBe(tokens.components["button-secondary"].padding);
  });

  it('.button-secondary height matches tokens.components["button-secondary"].height', () => {
    const body = ruleBody(landingCss, ".button-secondary ");
    const height = resolveSpacing(declaration(body, "height"));
    expect(height).toBe(tokens.components["button-secondary"].height);
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
