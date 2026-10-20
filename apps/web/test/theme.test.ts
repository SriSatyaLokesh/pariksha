import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GROUNDS,
  type Ground,
  SEMANTIC_NAMES,
  THEME_SELECTOR,
  organiserStylesheets,
  declarations,
  parseRuleBodies,
  readResolvedCss,
  readThemeMap,
  stripCssComments,
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
const LANDING_CSS_PATH = resolve(STYLES_DIR, "landing.css");
const EXAM_CSS_PATH = resolve(STYLES_DIR, "exam.css");
const ADMIN_MAIN_PATH = resolve(__dirname, "../src/admin-main.tsx");

const theme = readThemeMap();

// EVERY stylesheet the organiser entry loads, not just admin.css's import
// chain: `admin-main.tsx` imports base.css and testbuilder.css beside it,
// and a semantic name assigned in either would be invisible to a guard that
// read only the one chain. 6.5d restyles the test builder, so that hole is
// one a later plan in this phase writes straight into. The list is READ OUT
// of admin-main.tsx (fix round 4, finding 3) rather than written here: it
// was hardcoded in two files, and d58d85b exists because testbuilder.css
// was missing from it. One shared `seen` set, so a file reached from two
// entries is read once.
const organiserCss = ((seen) =>
  organiserStylesheets()
    .map((path) => readResolvedCss(path, seen))
    .join("\n"))(new Set<string>());

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

/** The alpha of a `rgb(from … r g b / a)` composite, or null. */
function alphaOf(value: string): number | null {
  const match = /\/\s*([0-9.]+)\s*\)\s*$/.exec(value);
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
    // The other half of the contract: a name invented here and not in
    // SEMANTIC_NAMES is a name 6.5c/d/e do not know about, and a palette
    // decision taken outside DESIGN.md's front matter. The count is
    // deliberately not written down — it has moved twice already (21 at
    // first, 22 with --accent-deep, 23 with --focus) and a number in prose
    // is a thing that goes stale while the list stays right.
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
    // A plain token, or a composite over one in the repo's single alpha
    // idiom — `rgb(from var(--color-NAME) r g b / a)`, the form base.css,
    // primitives.css, signal.css and exam.css already use. `color-mix()` is
    // legal CSS and passes the colour-literal gate, but a second idiom in
    // the file three later plans read teaches the wrong pattern three times.
    for (const ground of GROUNDS) {
      for (const [name, value] of Object.entries(theme[ground])) {
        expect(value, `${ground} ${name}`).toMatch(
          /^var\(--color-|^rgb\(from var\(--color-|^rgb\(var\(/,
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

describe("every translucent name is alpha over the role it washes", () => {
  // The family test above accepts `--wash: rgb(from var(--color-signal-l-bg)
  // r g b / 0.06)` on light: right family, wrong role, and invisible —
  // precisely the mistake the light block's own comment says it exists to
  // prevent. A wash is alpha over the ground's own INK, and each of the
  // others is alpha over the role it is named for. Asserted by reading the
  // base role's own token rather than naming a token here, so this cannot
  // drift from the mapping it checks.
  const WASHES_OVER: Record<string, string> = {
    "--wash": "--ink",
    "--wash-2": "--ink",
    "--accent-wash": "--accent",
    "--warn-wash": "--warn",
    "--risk-wash": "--risk",
    "--glow": "--accent",
    "--glow-strong": "--accent",
  };

  for (const ground of GROUNDS) {
    it(`[${ground}] each one reads the same token as the role it washes`, () => {
      for (const [wash, base] of Object.entries(WASHES_OVER)) {
        expect(
          referencedTokens(valueOf(ground, wash)),
          `${ground} ${wash} should wash ${base}`,
        ).toEqual(referencedTokens(valueOf(ground, base)));
      }
    });
  }

  it("the ink roles really are the text tokens, so the above is not vacuous", () => {
    // Without this, the assertions above would hold for a mapping in which
    // --ink itself had been pointed at a ground token.
    expect(referencedTokens(valueOf("dark", "--ink"))).toEqual([
      "--color-signal-text",
    ]);
    expect(referencedTokens(valueOf("light", "--ink"))).toEqual([
      "--color-signal-l-text",
    ]);
  });
});

describe("the field is a dark-ground device and is allowed to disappear (D20a)", () => {
  // A green bloom on cream is the same illegal-adjacent move D1 refused, and
  // inventing a light-mode ornament to replace it would make the two grounds
  // two designs. So: on dark the glow is louder than the ambient wash; on
  // light it is no louder.
  it("the glow outweighs the ambient wash on dark", () => {
    expect(alphaOf(valueOf("dark", "--glow")) ?? 0).toBeGreaterThan(
      alphaOf(valueOf("dark", "--wash")) ?? 0,
    );
    expect(alphaOf(valueOf("dark", "--glow-strong")) ?? 0).toBeGreaterThan(
      alphaOf(valueOf("dark", "--glow")) ?? 0,
    );
  });

  it("the glow is no louder than the ambient wash on light", () => {
    for (const name of ["--glow", "--glow-strong"]) {
      expect(alphaOf(valueOf("light", name)) ?? Infinity, name).toBeLessThanOrEqual(
        alphaOf(valueOf("light", "--wash")) ?? 0,
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

  it("the organiser entry puts the viewer's ground on <html> before it mounts", () => {
    // The CSS half of D20's switch is above; this is the TSX half. Nothing
    // else asserts it: `readGround` has its own unit tests (ground.test.ts)
    // and `theme.css` has these, but a refactor that dropped the assignment
    // from admin-main.tsx would leave every one of them green while the
    // page flashed the wrong ground on every load. A source scan, the shape
    // fonts.test.ts and no-hex-colors.test.ts already use, rather than a
    // jsdom import that would mount the whole organiser app to read one line.
    const source = readFileSync(ADMIN_MAIN_PATH, "utf8");
    const assignment = source.indexOf("document.documentElement.dataset.theme");
    // `createRoot(` — the CALL. Anchoring on the bare name matches its
    // import on line 2 and the assertion would compare against that instead.
    const mount = source.indexOf("createRoot(");
    // Both anchors found: a renamed entry point or a switch to a different
    // mounting API must fail here rather than pass vacuously.
    expect(assignment, "no data-theme assignment in admin-main.tsx").toBeGreaterThan(-1);
    expect(mount, "no createRoot( call in admin-main.tsx").toBeGreaterThan(-1);
    expect(source.slice(assignment)).toMatch(/^document\.documentElement\.dataset\.theme\s*=\s*readGround\(\)/);
    expect(assignment, "the ground is set after mount, so the page flashes").toBeLessThan(mount);
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

// Phase 6.5f Task 1 (D1). The mirror of the guard above: that one keeps the
// organiser's semantic names off the runtime, this one keeps the runtime's
// vermilion from spreading back.
//
// D1 retires `voltage` from the organiser and leaves the candidate runtime
// the sole surface still using it — which is what makes the palette square
// and the focus ring read as singular again. But that retirement happens as
// 6.5c, 6.5d and 6.5e re-ground each screen, and NONE OF THOSE HAS MERGED.
// So this asserts the set that is true TODAY, not D1's end state: a guard
// written against the end state would be red on arrival and would be
// deleted rather than believed.
//
// What it still catches, which is the invariant worth having now: voltage
// SPREADING — a new stylesheet reaching for the vermilion, or a sheet that
// had given it up taking it back.
//
// 6.5c, 6.5d and 6.5e EACH shrink this list as they re-ground a surface —
// not 6.5e alone. primitives.css's three uses are TWO different components:
// `.button-primary:hover, .button-primary:focus-visible` (:64) and
// `.button-primary--surface` (:77), and — a separate component —
// `.button-secondary:hover, .button-secondary:focus-visible` (:120).
// base.css's two are both in the global `:focus-visible` rule (:86-91), the
// ring 6.5b added `--focus` for. 6.5d and 6.5e also modify primitives.css.
//
// Naming every component matters more than it looks: whoever re-grounds
// `.button-secondary` and hits this red test must find THEIR change named
// here, or they read "not mine" and go hunting a break that is not there.
// That is the same failure as naming a single plan, one level down.
//
// The end state is the runtime's own chain (exam.css, and registration.css
// while it stays shared with admin.css). Shrinking is the expected edit;
// growing never is.
//
// Counted per SOURCE file, not over a resolved bundle: question.css and
// registration.css are imported by both entries, so a bundle-level count
// would blame the runtime for a sheet the organiser also loads. tokens.css
// DEFINES the family rather than using it and so reads zero here, which is
// correct — it is the mapping, the same exclusion contrast-usage.test.ts
// makes.
describe("voltage stays in the candidate runtime and does not spread (D1)", () => {
  // Read off disk rather than listed by hand, so a NEW stylesheet that
  // reaches for voltage cannot be invisible to this guard — the reason
  // `organiserStylesheets()` derives its list too (d58d85b).
  const voltageUsers = readdirSync(STYLES_DIR)
    .filter((file) => file.endsWith(".css"))
    .filter((file) =>
      /var\(\s*--color-voltage/.test(
        stripCssComments(readFileSync(resolve(STYLES_DIR, file), "utf8")),
      ),
    )
    .sort();

  it("is used by exactly the stylesheets that use it today", () => {
    expect(
      voltageUsers,
      "the set of stylesheets using var(--color-voltage*) changed. SHRINKING is expected as 6.5c, 6.5d and 6.5e re-ground the organiser — delete the entry below and keep the test. GROWING means voltage spread to a new surface, which D1 forbids.",
    ).toEqual(
      [
        // The runtime's own chain — where D1 says voltage belongs.
        "exam.css",
        // Shared with admin.css today; stays once the organiser drops it.
        "registration.css",
        // --- Below: the organiser's remaining voltage. Each line is deleted
        // by whichever of 6.5c / 6.5d / 6.5e re-grounds that surface. ---
        // primitives.css: `.button-primary:hover, :focus-visible` (:64),
        // `.button-primary--surface` (:77) AND `.button-secondary:hover,
        // :focus-visible` (:120) — two components, not one. base.css: the
        // global `:focus-visible` ring (:86-91). The authoring and
        // test-builder sheets carry their own selected states.
        "authoring.css",
        "base.css",
        "primitives.css",
        "testbuilder.css",
      ].sort(),
    );
  });

  it("is really used by the runtime, so the list above is not vacuous", () => {
    // A typo in the regex, or a rename of the whole family, would empty
    // the list and make the assertion above pass only by matching [] to a
    // list that is itself wrong. exam.css is the one file D1 guarantees —
    // and the only one, so no count floor is asserted beside it: D1's end
    // state could legitimately reach a single file if registration.css
    // stops being shared, and a floor of two would red for that.
    expect(voltageUsers).toContain("exam.css");
  });

  it("the landing page gave it up and has not taken it back (D1)", () => {
    // signal.css is the surface D1 re-grounded first. It is the one file
    // here whose zero is already a finished state rather than a pending
    // one, so it gets its own assertion.
    expect(voltageUsers).not.toContain("signal.css");
    expect(voltageUsers).not.toContain("landing.css");
  });
});
