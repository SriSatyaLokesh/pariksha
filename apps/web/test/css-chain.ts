import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// One `@import` resolver for the whole test suite.
//
// `contrast-usage.test.ts` has had this since P3.9; Phase 6 Task 7's
// no-animation gate grew a second, narrower copy of it (fix round 1) that
// resolved every import against the ENTRY file's directory instead of
// against the importing file's, so a nested import from a subdirectory
// would have been read from the wrong place or silently not at all — a
// resolver that quietly returns less than the stylesheet is a gate that
// quietly checks less than it claims. Both now call this.
//
// `./name.css` is the only import form this repo's stylesheets use, and
// that is deliberate: a bare-specifier or URL import would reach outside
// the bundle Vite assembles.
const IMPORT_RE = /@import\s+["']\.\/([a-zA-Z0-9_-]+\.css)["'];?/g;

export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * `path`'s CSS with every `@import` inlined — the stylesheet a browser
 * really assembles from that entry. Comments are stripped, so a rule
 * named only in prose cannot satisfy a scan.
 *
 * `seen` guards against an import cycle and lets a caller read several
 * entries that share an import without double-counting it; pass one
 * shared set for that, or omit it to resolve an entry on its own.
 */
export function readResolvedCss(path: string, seen: Set<string> = new Set()): string {
  if (seen.has(path)) return "";
  seen.add(path);
  const raw = stripCssComments(readFileSync(path, "utf8"));
  // Relative to the IMPORTING file, not to the entry — which is what the
  // narrower copy got wrong.
  return raw.replace(IMPORT_RE, (_whole, file: string) =>
    readResolvedCss(resolve(dirname(path), file), seen),
  );
}

// ---------------------------------------------------------------------------
// Rule parsing. This lived in `contrast-usage.test.ts` alone until Phase 6.5b
// Task 3 needed the same parser for `theme.css`; it moved here rather than
// being copied, for the same reason the `@import` resolver above did.

export interface CssRule {
  selector: string;
  body: string;
}

export function parseRuleBodies(css: string): CssRule[] {
  const rules: CssRule[] = [];
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

export function declarations(body: string): string[] {
  return body
    .split(";")
    .map((decl) => decl.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// theme.css: the two grounds (D20) under one set of semantic names.
//
// This list is the contract between plan 6.5b and plans 6.5c, 6.5d and 6.5e —
// those stylesheets read these names, exactly as spelled. Adding, dropping or
// renaming one here is a change to three later plans.

export const SEMANTIC_NAMES = [
  "--ground",
  "--ground-2",
  "--surface",
  "--surface-2",
  "--edge",
  "--edge-2",
  "--edge-strong",
  "--ink",
  "--ink-2",
  "--ink-3",
  "--accent",
  "--accent-ink",
  "--accent-wash",
  "--warn",
  "--warn-wash",
  "--risk",
  "--risk-wash",
  "--wash",
  "--wash-2",
  "--glow",
  "--glow-strong",
] as const;

export type SemanticName = (typeof SEMANTIC_NAMES)[number];

export type Ground = "dark" | "light";

export const GROUNDS: Ground[] = ["dark", "light"];

/** The only two selectors allowed to assign a semantic name. */
export const THEME_SELECTOR: Record<Ground, string> = {
  dark: ":root",
  light: ':root[data-theme="light"]',
};

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

export const THEME_CSS_PATH = resolve(TEST_DIR, "../src/styles/theme.css");

/**
 * `theme.css`'s two mappings — semantic name (with its `--`) to the raw CSS
 * value it is given on that ground. Raw, not resolved: a caller that wants a
 * token name reads it back out, and one that wants to know a value is a
 * `color-mix()` can see that it is.
 */
export function readThemeMap(
  path: string = THEME_CSS_PATH,
): Record<Ground, Record<string, string>> {
  const rules = parseRuleBodies(readResolvedCss(path));
  const map: Record<Ground, Record<string, string>> = { dark: {}, light: {} };
  for (const ground of GROUNDS) {
    const body = rules
      .filter((rule) => rule.selector === THEME_SELECTOR[ground])
      .map((rule) => rule.body)
      .join(";");
    for (const decl of declarations(body)) {
      const colon = decl.indexOf(":");
      if (colon === -1) continue;
      const property = decl.slice(0, colon).trim();
      if (!property.startsWith("--")) continue;
      map[ground][property] = decl.slice(colon + 1).trim();
    }
  }
  return map;
}
