import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokens } from "../src/styles/tokens";
import {
  CHAINS,
  GROUNDS,
  type Ground,
  SEMANTIC_NAMES,
  THEME_SELECTOR,
  chainOf,
  entryStylesheets,
  organiserStylesheets,
  declarations,
  parseRuleBodies,
  readResolvedCss,
  readThemeMap,
  resolvedChain,
  sourceFiles,
  srcRelative,
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
const THEME_CSS_PATH = resolve(STYLES_DIR, "theme.css");

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

// The UA's own chrome is part of the ground, and it is the half no palette
// map can carry: scrollbars, the <select> picker and its disclosure
// triangle, and every native form control are painted by the browser from
// `color-scheme`, not from a custom property.
//
// `base.css:11` says `html { color-scheme: light }` unconditionally, which
// was invisible while 6.5b shipped the attribute and changed no screen.
// 6.5c put `data-theme="dark"` on a page with native chrome on it and three
// constructs went light-scheme on a near-black ground — Home's two scrolling
// panes, the rail, and the workspace <select>'s picker (whole-branch review,
// Important 1).
//
// jsdom paints no scrollbar, so this is the invariant rather than the
// behaviour (`AG3`); it was measured in Chrome, computed `color-scheme` on
// <html>, `.home__scroll`, `.shell__rail` and `.shell__switcher-select`
// reading `light`/`light` on both grounds before and `dark`/`light` after.
// What this guard holds is that the declaration exists on BOTH blocks and
// nowhere else in the organiser bundle, which is the thing that drifted.
describe("the UA's own chrome follows the ground (D20)", () => {
  it("declares color-scheme on both theme blocks", () => {
    const rules = parseRuleBodies(readResolvedCss(THEME_CSS_PATH));
    const schemeOf = (selector: string) =>
      declarations(rules.find((rule) => rule.selector === selector)?.body ?? "")
        .find((decl) => /^color-scheme\s*:/.test(decl))
        ?.split(":")[1]
        ?.trim();

    expect(schemeOf(":root")).toBe("dark");
    expect(schemeOf(':root[data-theme="light"]')).toBe("light");
  });

  it("leaves no stylesheet in the organiser bundle overriding it at the root", () => {
    // base.css's `html { color-scheme: light }` is (0,0,1) and loses to
    // `:root` at (0,1,0), so it may stay. A SECOND `:root` rule setting it
    // would not lose, and is what this forbids.
    const roots = parseRuleBodies(organiserCss).filter(
      (rule) =>
        /^:root(?!\[data-theme="light"\])/.test(rule.selector) &&
        declarations(rule.body).some((decl) => /^color-scheme\s*:/.test(decl)),
    );
    expect(roots.map((rule) => rule.selector)).toEqual([":root"]);
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
        // base.css's two are both in the global `:focus-visible` ring
        // (:86-91), and they STAY: base.css is in the candidate's chain too,
        // and 6.5c already overrides `:focus-visible` with `--focus` on the
        // organiser root. So this list is `D1`'s end state as of 6.5e Task
        // 1b, not a pending one.
        "base.css",
        //
        // --- Deleted by 6.5e Task 1b, named rather than counted. ---
        // authoring.css: the preview toggle's and the tag chip's checked
        // borders. testbuilder.css: `.button-link`, the flat button that
        // reads as a test's name. primitives.css: `.button-primary:hover,
        // :focus-visible`, `.button-primary--surface` AND
        // `.button-secondary:hover, :focus-visible` — two components, not
        // one, which is the distinction this comment exists to keep. All
        // five are `var(--accent)` or `var(--accent-deep)` now.
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

// ---------------------------------------------------------------------------
// THE CHAIN SEAM: a semantic name is only defined where theme.css is loaded.
//
// `landing.css:9` imports `primitives.css` and does NOT import `theme.css`,
// so `var(--ink)` written into `primitives.css` is UNDEFINED on the landing
// page. `exam.css` imports neither. This is the seam that produced issue 200
// and #201, and 6.5e Task 1b reached for it a third time: the four shared
// component rules — MonoCaption, ButtonPrimary, ButtonSecondary, CardHairline
// — had to leave the cream palette with the rest of the organiser.
//
// It is safe only while the ungrounded chains render NONE of the constructs
// those rules paint, and the corrected question is "does that page render
// THIS construct", never "does it render a table": the landing page renders
// two tables, and a first version of this ruling claimed it rendered none.
//
// So both halves are derived off disk. The class list comes out of the
// stylesheets themselves — every selector that reads a semantic name, in a
// chain that defines none — and the source set out of `CHAINS`, which
// `controls.test.tsx` already watches for completeness against the pages on
// disk. A landing component that starts rendering `.card-hairline`, or a new
// rule in `primitives.css` that paints something the landing page does
// render, is then a red test naming the file.
describe("no chain reads a theme.css name its own chain never defines (D1, issue 200, #201)", () => {
  /** Every class a selector names: `.a:hover, .b > .c` -> a, b, c. */
  function classesIn(selector: string): string[] {
    return [...selector.matchAll(/\.([A-Za-z_][\w-]*)/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
  }

  const chains = CHAINS.map((chain) => {
    const css = resolvedChain(chain.page);
    return {
      ...chain,
      css,
      // Not "does this chain's file list contain theme.css" — that is the
      // mechanism. A chain is grounded when something in it really ASSIGNS
      // the names, which is the property every rule below depends on.
      grounded: selectorsAssigning(SEMANTIC_NAMES, css).length > 0,
    };
  });

  const UNGROUNDED = chains.filter((chain) => !chain.grounded);

  /** Every class painted by a rule in `css` that READS a semantic name. */
  function classesPaintedBySemanticNames(css: string): string[] {
    const wanted = new Set<string>(SEMANTIC_NAMES);
    const hits = new Set<string>();
    for (const rule of parseRuleBodies(css)) {
      const reads = declarations(rule.body).some((decl) =>
        referencedTokens(decl).some((token) => wanted.has(token)),
      );
      if (!reads) continue;
      for (const name of classesIn(rule.selector)) hits.add(name);
    }
    return [...hits].sort();
  }

  it("has an ungrounded chain and a grounded one, so neither loop is empty", () => {
    // Both halves named. An empty UNGROUNDED list would make every assertion
    // below vacuously true, and a theme.css that had reached every chain
    // would mean this guard had quietly stopped guarding anything.
    expect(
      chains.filter((chain) => chain.grounded).map((chain) => chain.page),
    ).toEqual(["admin.html"]);
    expect(UNGROUNDED.map((chain) => chain.page).sort()).toEqual([
      "exam.html",
      "index.html",
    ]);
  });

  it("really finds the shared rules that read one, so the scan is not vacuous", () => {
    // `primitives.css` is the file in two chains and these are the four
    // components it shares. If a rename emptied this list, the assertions
    // below would pass by finding nothing to check.
    const shared = classesPaintedBySemanticNames(resolvedChain("index.html"));
    expect(shared).toContain("mono-caption");
    expect(shared).toContain("button-primary");
    expect(shared).toContain("button-secondary");
    expect(shared).toContain("card-hairline");
  });

  for (const chain of UNGROUNDED) {
    it(`${chain.page} renders none of the constructs its own chain paints with an undefined name`, () => {
      // A chain that paints NOTHING with a semantic name is the strongest
      // state this guard can report, and `exam.html` is in it — its chain
      // imports neither `theme.css` nor `primitives.css`. So an empty list
      // here is an answer rather than a broken scan, and the vacuity check
      // is the one above, which proves the scan finds the four shared
      // components in the chain that really does share them.
      const painted = classesPaintedBySemanticNames(chain.css);

      // Every source file this page dresses, against every class those rules
      // paint. `className="a b"`, `className={"a"}` and a template literal
      // all put the bare class name in the source, so one scan covers them;
      // a class assembled from fragments would not be found, which is the
      // same bounded limit `controls.test.tsx` names for its own scan and
      // why the four shared components are checked by name above.
      const offenders: string[] = [];
      for (const file of sourceFiles()) {
        const relativePath = srcRelative(file);
        if (chainOf(relativePath)?.page !== chain.page) continue;
        const source = readFileSync(file, "utf8");
        for (const name of painted) {
          if (new RegExp("[\"'`\\s{]" + name + "[\"'`\\s}]").test(source)) {
            offenders.push(
              `${relativePath} renders .${name}, which ${chain.page}'s chain paints with a theme.css name it never defines`,
            );
          }
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// The other direction: an organiser-only stylesheet may not read a CREAM
// token, because `D1` moved the organiser off that palette altogether.
//
// Derived rather than listed, on both axes. The file set is every stylesheet
// the organiser entry resolves to MINUS every stylesheet another entry also
// resolves to — so `base.css`, `tokens.css`, `primitives.css` (the landing
// page too) and `registration.css` / `question.css` (the candidate runtime
// too) fall out on their own, which is right: each of those still dresses a
// cream surface somewhere and must keep the palette that paints it. The
// token set is every generated colour that is not `signal-*`.
describe("no organiser-only stylesheet reads the cream palette (D1, G5)", () => {
  /** Every source stylesheet `page`'s chain resolves to, by file name. */
  function chainFiles(page: string): Set<string> {
    const files = new Set<string>();
    const seen = new Set<string>();
    for (const path of entryStylesheets(page)) {
      const before = new Set(seen);
      readResolvedCss(path, seen);
      for (const reached of seen) {
        if (!before.has(reached)) files.add(basename(reached));
      }
    }
    return files;
  }

  const organiserOnly = (() => {
    const organiser = chainFiles("admin.html");
    for (const page of ["index.html", "exam.html"]) {
      for (const shared of chainFiles(page)) organiser.delete(shared);
    }
    return [...organiser].sort();
  })();

  /** The cream palette: every generated colour that is not a Signal one. */
  const CREAM_TOKENS = Object.keys(tokens.colors)
    .filter((name) => !name.startsWith("signal-"))
    .map((name) => `--color-${name}`);

  // `theme.css` is the MAPPING and reads the Signal families by definition.
  // It is swept like the rest rather than excluded, because it reads no
  // cream token and the sweep proving that is worth more than an exclusion
  // comment claiming it.
  const EXEMPT: Record<string, { tokens: string[]; why: string }> = {
    "testbuilder.css": {
      tokens: ["--color-cream", "--color-ink", "--color-muted"],
      why: "`.branding-panel__preview` is a MINIATURE OF THE CANDIDATE'S START PAGE as the branding settings will paint it, so its WHOLE SUBTREE is the runtime's palette and not only its fill: the cream background, the `var(--brand-primary, var(--color-ink))` heading fallback, the ink that paints the three previews' bare <p> messages, and the muted tone on the footer and the preview's own fact line. Re-grounding any of them would make the preview lie about the page it previews — and a SEMANTIC name over a fixed cream fill is worse than either, because it resolves to one palette on one ground and the other on the other: `--ink` measures 1.11:1 on cream dark and 17.39:1 light (fix round 1, C1).",
    },
  };

  it("finds the organiser's own stylesheets, so the sweep is not empty", () => {
    // Named rather than counted: these were the six files `D1` moved, plus
    // `grading.css` (Phase 8b Task 2, `K15`) and `analytics.css` (Phase 8c
    // Task 1, `R-06`) — a rename that silently emptied the list would make
    // every assertion below pass by checking nothing.
    expect(organiserOnly).toEqual([
      "admin.css",
      "analytics.css",
      "authoring.css",
      "grading.css",
      "home.css",
      "shell.css",
      "testbuilder.css",
      "theme.css",
    ]);
  });

  it("has a cream token to look for, so the pattern is not broken", () => {
    expect(CREAM_TOKENS).toContain("--color-ink");
    expect(CREAM_TOKENS).toContain("--color-cream");
    expect(CREAM_TOKENS).not.toContain("--color-signal-accent");
  });

  for (const file of organiserOnly) {
    it(`${file} paints in theme.css's names alone`, () => {
      const css = stripCssComments(
        readFileSync(resolve(STYLES_DIR, file), "utf8"),
      );
      const allowed = new Set(EXEMPT[file]?.tokens ?? []);
      const found = CREAM_TOKENS.filter(
        (token) =>
          !allowed.has(token) &&
          new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(css),
      );
      expect(
        found,
        `${file} reads ${found.join(", ")} — the organiser left the cream palette in D1. An exemption belongs in EXEMPT above with a reason, never as a deletion here.`,
      ).toEqual([]);
    });
  }

  it("the one exemption is still load-bearing, not a stale entry", () => {
    // The other half of any allowlist: an exemption nothing uses is a hole
    // left open, so each exempted token must really be read by the file that
    // claims it.
    for (const [file, entry] of Object.entries(EXEMPT)) {
      const css = stripCssComments(
        readFileSync(resolve(STYLES_DIR, file), "utf8"),
      );
      for (const token of entry.tokens) {
        expect(
          new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(css),
          `${file} no longer reads ${token}: delete the exemption. ${entry.why}`,
        ).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// NOTHING IN THE ORGANISER MAY BEAT base.css ON SOURCE ORDER.
//
// Found in a browser during 6.5e Task 1b, and invisible to every other guard
// in this repo. `admin.css` re-grounded the page with a bare
// `body { background: var(--ground) }`. That is (0,0,1), exactly what
// base.css's own `body { background: var(--color-cream) }` is, so the winner
// is whichever stylesheet the browser reads last — and the two orders
// disagree:
//
//   `admin-main.tsx` imports base.css FIRST, then admin.css.
//   `dist/admin.html` links `admin-*.css` FIRST, then `base-*.css`.
//
// Vite emits them as separate chunks and orders the links its own way, so
// the built page is the one that counts and the cream won. The four screens
// that render outside the shell — `loading`, `error`, `signin`, `setup` —
// shipped near-white ink on a cream page, with the whole suite green: every
// jsdom reader here resolves `organiserStylesheets()` in IMPORT order, which
// is precisely the order the browser does not use.
//
// So the fix is not a better reader — a test that models one chunk order is
// a test that is wrong on the other. It is the INVARIANT that makes order
// irrelevant: an organiser rule that overrides base.css must win on
// SPECIFICITY. Two rules with the same selector string cannot, by
// definition, so that is what this forbids. `:root[data-theme] body` and
// `:root[data-theme] :focus-visible` are how the two real cases are written.
describe("no organiser stylesheet ties with base.css on a selector (D1)", () => {
  const BASE_CSS_PATH = resolve(STYLES_DIR, "base.css");

  /** Every selector a stylesheet declares, each comma branch on its own. */
  function selectorsOf(css: string): string[] {
    return parseRuleBodies(css).flatMap((rule) =>
      rule.selector.split(",").map((part) => part.replace(/\s+/g, " ").trim()),
    );
  }

  // base.css ALONE, not its resolved chain: `tokens.css` and `fonts.css`
  // come in through it and declare `:root` / `@font-face`, which every
  // theme block legitimately also names.
  const baseSelectors = new Set(
    selectorsOf(stripCssComments(readFileSync(BASE_CSS_PATH, "utf8"))),
  );

  it("reads base.css's own selectors, so the comparison is not empty", () => {
    expect(baseSelectors.has("body")).toBe(true);
    expect(baseSelectors.has(":focus-visible")).toBe(true);
    // ...and not its imports', which would make `:root` a false positive on
    // theme.css, the one file that MUST declare it.
    expect(baseSelectors.has(":root")).toBe(false);
  });

  // Every SOURCE stylesheet the organiser entry resolves to, except
  // base.css itself — each read on its own so a tie names the one file that
  // declares it rather than the chain that reached it. Not "organiser-only"
  // either: `primitives.css` and `registration.css` are shared with another
  // entry and would hit the same tie on the same page.
  const organiserSheets = (() => {
    const seen = new Set<string>();
    for (const path of organiserStylesheets()) readResolvedCss(path, seen);
    return [...seen].filter((path) => path !== BASE_CSS_PATH).sort();
  })();

  it("reads the organiser's other stylesheets, so the sweep is not empty", () => {
    // Named rather than counted: the entry's own three minus base.css, plus
    // everything admin.css imports. A resolver that silently returned less
    // would make the assertion below pass by checking almost nothing.
    expect(organiserSheets.map((path) => basename(path))).toContain("admin.css");
    expect(organiserSheets.map((path) => basename(path))).toContain("shell.css");
    expect(organiserSheets.map((path) => basename(path))).toContain("testbuilder.css");
    expect(organiserSheets.length).toBeGreaterThan(5);
  });

  for (const path of organiserSheets) {
    it(`${basename(path)} declares no selector base.css also declares`, () => {
      const css = stripCssComments(readFileSync(path, "utf8"));
      const ties = [...new Set(selectorsOf(css))].filter((selector) =>
        baseSelectors.has(selector),
      );
      expect(
        ties,
        `${basename(path)} declares ${ties.map((tie) => `\`${tie}\``).join(", ")}, which base.css also declares. Equal specificity means the BUILT chunk order decides, and it is NOT the import order — raise the specificity (\`:root[data-theme] <selector>\`) rather than relying on which file comes last.`,
      ).toEqual([]);
    });
  }
});
