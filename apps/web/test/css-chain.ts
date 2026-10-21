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
  // Added in fix round 1, before 6.5c starts: 6.5c needs a pressed fill for
  // the primary button, both generated tokens already exist, and adding a
  // contract name after a consuming plan has started is a change to three
  // plans rather than a line in a list.
  "--accent-deep",
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
  // Added in fix round 4. base.css paints `:focus-visible` with the cream
  // world's voltage, which is correct for the candidate runtime and wrong on
  // a Signal surface the moment 6.5c re-grounds one — and 6.5c's own top-bar
  // control is focusable, so it lands on its first screen. The name exists
  // now so that override is a one-line change there rather than a contract
  // change across three plans.
  "--focus",
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

const ADMIN_MAIN_PATH = resolve(TEST_DIR, "../src/admin-main.tsx");
const STYLE_IMPORT_RE = /^import\s+["']\.\/styles\/([a-zA-Z0-9_-]+\.css)["'];?$/gm;

/**
 * Every stylesheet the organiser entry loads, read out of `admin-main.tsx`
 * rather than listed by hand.
 *
 * Fix round 4, finding 3. Both guard files used to hardcode this list, and
 * commit d58d85b exists precisely because `testbuilder.css` was missing from
 * it — a hole that reopens silently the next time an entry grows a
 * stylesheet. Deriving it means the guards widen with the entry.
 */
export function organiserStylesheets(): string[] {
  const source = readFileSync(ADMIN_MAIN_PATH, "utf8");
  const files = [...source.matchAll(STYLE_IMPORT_RE)].flatMap((m) =>
    m[1] === undefined ? [] : [resolve(TEST_DIR, "../src/styles", m[1])],
  );
  // A guard that silently read nothing would be worse than the hardcoded
  // list it replaces.
  if (files.length === 0) {
    throw new Error(`no "./styles/*.css" imports found in ${ADMIN_MAIN_PATH}`);
  }
  return files;
}

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

// ---------------------------------------------------------------------------
// Reading a stylesheet the way the cascade reads it.
//
// `vitest.config.ts` sets `css: false`, so jsdom loads no stylesheet and
// `getComputedStyle` knows nothing. Rather than scan a file for a string,
// these ask the DOM — through `Element.matches()` — which of a resolved
// chain's rules actually select a rendered element, and resolve the winner by
// specificity. A rule whose selector stops matching the markup is then as red
// as a rule whose declaration is deleted, which a text scan would not catch.
//
// Added in 6.5d Task 5 for the field-row guards and moved here in fix round 2,
// when `test/exam/controls.test.tsx` needed the same reader for a different
// entry chain. One copy, for the same reason the `@import` resolver above is
// one copy.

/**
 * A selector's specificity as one comparable number.
 *
 * Needed, not decorative: `primitives.css` declares `.field-row > .field {
 * display: grid }` and `registration.css`, which admin.css imports AFTER it,
 * declares `.field { display: flex }`. Source order says flex and the cascade
 * says grid (0,2,0 beats 0,1,0). A reader that took the last declaration
 * would have reported the opposite of what a browser paints — it did, on the
 * first green run, which is what this function exists because of.
 *
 * The functional pseudo-classes are handled the way CSS handles them rather
 * than counted as plain pseudo-classes, because `primitives.css`'s own
 * fallback uses one: `.field-row:has(.field-help) > .field` is (0,3,0), and
 * scoring `:has` as an extra class on top of its argument would make it
 * (0,4,0). Today `parseRuleBodies` never surfaces an `@supports` rule to this
 * reader, so nothing would have noticed — which is exactly why it is fixed
 * rather than left: a specificity helper that is quietly wrong is worse than
 * no helper at all (fix round 1, finding 5).
 *
 * `:where()` contributes nothing; `:not()`, `:is()` and `:has()` contribute
 * their argument's specificity and nothing of their own. A comma-separated
 * argument — where CSS takes the most specific branch — needs a recursive
 * reader, does not occur in this repo's stylesheets, and throws rather than
 * being scored wrong. Pseudo-ELEMENTS (`::before`) are not counted in the
 * element column: jsdom's `matches()` rejects them, so no rule carrying one
 * ever reaches this function.
 */
export function specificity(selector: string): number {
  const peeled = selector
    .replace(/:where\([^()]*\)/g, " ")
    .replace(/:(?:not|is|has)\(([^()]*)\)/g, (_whole, argument: string) => {
      if (argument.includes(",")) {
        throw new Error(`specificity(): comma-separated argument in ${selector}`);
      }
      return ` ${argument} `;
    });
  const ids = (peeled.match(/#[\w-]+/g) ?? []).length;
  const classes = (peeled.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const elements = (peeled.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10_000 + classes * 100 + elements;
}

/**
 * Every value `property` is given by a rule in `css` that really selects
 * `element`, weakest-first — so the last one is the one that paints.
 *
 * `parseRuleBodies` skips `@supports` blocks whole (it recurses into `@media`
 * only), which is what keeps this function reading the DEFAULT branch and
 * `supportsBody()` below reading the fallback. They cannot be confused.
 */
export function declaredFor(element: Element, property: string, css: string): string[] {
  const found: { weight: number; order: number; value: string }[] = [];
  let order = 0;
  for (const rule of parseRuleBodies(css)) {
    order += 1;
    const weights = rule.selector
      .split(",")
      .map((part) => part.trim())
      .filter((part) => {
        try {
          return element.matches(part);
        } catch {
          // A selector jsdom's engine cannot parse is not a match it can
          // confirm; it must not read as one either.
          return false;
        }
      })
      .map(specificity);
    if (weights.length === 0) continue;
    const weight = Math.max(...weights);
    for (const decl of declarations(rule.body)) {
      const colon = decl.indexOf(":");
      if (colon !== -1 && decl.slice(0, colon).trim() === property) {
        found.push({ weight, order, value: decl.slice(colon + 1).trim() });
      }
    }
  }
  return found
    .sort((a, b) => a.weight - b.weight || a.order - b.order)
    .map((hit) => hit.value);
}

/** The value `property` really paints on `element` under `css`, or `undefined`. */
export function paintsIn(element: Element, property: string, css: string): string | undefined {
  return declaredFor(element, property, css).at(-1);
}
