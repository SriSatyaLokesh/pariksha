import { describe, it, expect } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GROUNDS,
  type Ground,
  SEMANTIC_NAMES,
  THEME_SELECTOR,
  declarations,
  parseRuleBodies,
  readResolvedCss,
  readThemeMap,
} from "./css-chain";

// Phase 6.5b Task 3 (D20, D20a). `theme.css` gives the two organiser
// palettes — the dark `--color-signal-*` family and the light
// `--color-signal-l-*` one — a single set of semantic names. Plans 6.5c,
// 6.5d and 6.5e write their rules against those names and never against a
// palette token, which is what makes one attribute flip re-ground nine
// screens.
//
// The mistake this whole phase exists to prevent is D1's: an accent cannot
// cross grounds. `signal-accent #19e68c` is 1.60:1 on cream. A rule that
// reaches past `--accent` to `var(--color-signal-accent)`, or a light block
// that names a dark-family token, puts it there. The family test below is
// the guard against the second; contrast-usage.test.ts's `usagesOf` guard is
// the one against the first.

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES_DIR = resolve(__dirname, "../src/styles");
const ADMIN_CSS_PATH = resolve(STYLES_DIR, "admin.css");
const LANDING_CSS_PATH = resolve(STYLES_DIR, "landing.css");
const EXAM_CSS_PATH = resolve(STYLES_DIR, "exam.css");

const theme = readThemeMap();
const organiserCss = readResolvedCss(ADMIN_CSS_PATH);

/** Every selector in `css` that assigns one of `names`. */
function selectorsAssigning(names: readonly string[], css: string): string[] {
  const wanted = new Set(names);
  const hits: string[] = [];
  for (const rule of parseRuleBodies(css)) {
    const assigns = declarations(rule.body).some((decl) => {
      const colon = decl.indexOf(":");
      return colon !== -1 && wanted.has(decl.slice(0, colon).trim());
    });
    if (assigns && !hits.includes(rule.selector)) hits.push(rule.selector);
  }
  return hits;
}

/** The custom properties a raw value reads, e.g. `--color-signal-accent`. */
function referencedTokens(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/** What `theme.css` gives `name` on `ground`; "" if it gives it nothing. */
function valueOf(ground: Ground, name: string): string {
  return theme[ground][name] ?? "";
}

/** The one mix percentage in a `color-mix()` value, or null. */
function mixPercent(value: string): number | null {
  const match = /(\d+(?:\.\d+)?)%/.exec(value);
  return match?.[1] === undefined ? null : Number(match[1]);
}

describe("theme.css names both grounds (D20)", () => {
  it("defines every semantic name on both grounds", () => {
    for (const name of SEMANTIC_NAMES) {
      expect(theme.dark, `dark is missing ${name}`).toHaveProperty(name);
      expect(theme.light, `light is missing ${name}`).toHaveProperty(name);
    }
  });

  it("declares no semantic name the contract does not list", () => {
    // The other half of the contract: a seventeenth name invented here is a
    // name 6.5c/d/e do not know about, and a palette decision taken outside
    // DESIGN.md's front matter.
    const allowed = new Set<string>(SEMANTIC_NAMES);
    for (const ground of GROUNDS) {
      expect(
        Object.keys(theme[ground]).filter((name) => !allowed.has(name)),
        ground,
      ).toEqual([]);
    }
  });

  it("sets the semantic names nowhere but the two theme blocks", () => {
    expect(selectorsAssigning(SEMANTIC_NAMES, organiserCss)).toEqual([
      THEME_SELECTOR.dark,
      THEME_SELECTOR.light,
    ]);
  });

  it("maps every semantic name to a generated token, never to a literal", () => {
    for (const ground of GROUNDS) {
      for (const [name, value] of Object.entries(theme[ground])) {
        expect(value, `${ground} ${name}`).toMatch(
          /^var\(--color-|^color-mix\(|^rgb\(var\(/,
        );
      }
    }
  });
});

describe("neither ground can reach into the other's palette (D1)", () => {
  // D1: "An accent cannot cross grounds." Mechanically, that is this — the
  // dark block may name only `--color-signal-*` and the light block only
  // `--color-signal-l-*`. It is also what stops the wash mapping being
  // copy-pasted between the blocks: a wash is alpha over the ground's own
  // ink, so the dark wash is light and the light wash is dark, and a light
  // wash on a light ground is invisible.
  const familyOf = (token: string): "dark" | "light" | "other" =>
    token.startsWith("--color-signal-l-")
      ? "light"
      : token.startsWith("--color-signal-")
        ? "dark"
        : "other";

  for (const ground of GROUNDS) {
    it(`the ${ground} block names only the ${ground} family`, () => {
      const wrong: string[] = [];
      for (const [name, value] of Object.entries(theme[ground])) {
        for (const token of referencedTokens(value)) {
          if (familyOf(token) !== ground) wrong.push(`${name}: ${token}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  it("reads a real mapping, so the two assertions above are not vacuous", () => {
    expect(SEMANTIC_NAMES.length).toBeGreaterThan(0);
    expect(referencedTokens(valueOf("dark", "--accent"))).toEqual([
      "--color-signal-accent",
    ]);
    expect(referencedTokens(valueOf("light", "--accent"))).toEqual([
      "--color-signal-l-accent",
    ]);
  });
});

describe("the field is a dark-ground device and is allowed to disappear (D20a)", () => {
  // A green bloom on cream is the same illegal-adjacent move D1 refused, and
  // inventing a light-mode ornament to replace it would make the two grounds
  // two designs. So: on dark the glow is louder than the ambient wash; on
  // light it is no louder.
  it("the glow outweighs the ambient wash on dark", () => {
    expect(mixPercent(valueOf("dark", "--glow")) ?? 0).toBeGreaterThan(
      mixPercent(valueOf("dark", "--wash")) ?? 0,
    );
    expect(mixPercent(valueOf("dark", "--glow-strong")) ?? 0).toBeGreaterThan(
      mixPercent(valueOf("dark", "--glow")) ?? 0,
    );
  });

  it("the glow is no louder than the ambient wash on light", () => {
    for (const name of ["--glow", "--glow-strong"]) {
      expect(mixPercent(valueOf("light", name)) ?? Infinity, name).toBeLessThanOrEqual(
        mixPercent(valueOf("light", "--wash")) ?? 0,
      );
    }
  });
});

describe("the semantic names reach the organiser and nothing else (D1)", () => {
  it("the organiser bundle carries both theme blocks", () => {
    // Without the @import, every rule 6.5c/d/e writes resolves to nothing
    // and every screen renders unstyled — silently, because an undefined
    // custom property is not an error.
    const selectors = parseRuleBodies(organiserCss).map((r) => r.selector);
    expect(selectors).toContain(THEME_SELECTOR.dark);
    expect(selectors).toContain(THEME_SELECTOR.light);
  });

  for (const [name, path] of [
    ["landing", LANDING_CSS_PATH],
    ["exam", EXAM_CSS_PATH],
  ] as const) {
    it(`the ${name} bundle does not`, () => {
      expect(selectorsAssigning(SEMANTIC_NAMES, readResolvedCss(path))).toEqual(
        [],
      );
    });
  }
});
