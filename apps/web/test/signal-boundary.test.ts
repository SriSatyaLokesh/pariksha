import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  chainOf,
  declarations,
  parseRuleBodies,
  sourceFiles,
  srcRelative,
  stripCssComments,
} from "./css-chain";

// ---------------------------------------------------------------------------
// D10 — what `signal.css` gives up, and the boundary that survives the answer.
//
// 6.5e Task 7 judged all twenty-one candidates and moved NONE of them:
// docs/superpowers/notes/2026-10-20-d10-moved-constructs.md holds the table and
// the reasoning. A verdict is not a guard, so this file is the half of it that
// can fail.
//
// WHAT IT GUARDS, AND WHY ONLY THIS. The brief sketched
// `selectorsDefinedTwice(signalCss, primitivesCss)` equals `[]`, which only
// reddens on a move that COPIED rather than moved. This is the directional
// form — not "defined twice" but "defined anywhere else at all" — so it
// catches a copy AND a move.
//
// It guards the STRUCTURE-ONLY move specifically, and that scope was measured
// rather than assumed (Task 7, probe verification):
//
//   - A construct moved out of `signal.css` CARRYING its `var(--color-signal-*)`
//     tokens already reddens `contrast-usage.test.ts`'s "reads no Signal
//     palette token directly, on either ground" (:1553), because every file
//     that matters here is in `ORGANISER_CSS`. Probe: `.signal-card` moved to
//     `primitives.css` intact -> that test red. A second guard for it was
//     written, measured as redundant, and deleted rather than kept.
//
//   - A construct moved with NO colour at all reddens nothing in the suite.
//     Probe: `.signal-scroll-x` (`overflow-x: auto`, one declaration) moved to
//     `primitives.css` -> 1 failure in 2046, this test, alone.
//
// So the colour half is already held, and this is the half that was not.
//
// The second describe closes the hole the first one leaves: a construct moved
// AND RENAMED carries no `.signal-` prefix for the scan above to find. Review
// round 1 (I3) named the inverse invariant that catches it, and it is here.

const STYLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/styles",
);

/** Every stylesheet in src/styles, comments stripped — prose cannot satisfy a
 *  scan, and `theme.css:64` does name `.signal` in its header. */
const SHEETS = readdirSync(STYLES_DIR)
  .filter((name) => name.endsWith(".css"))
  .sort()
  .map((name) => ({
    name,
    css: stripCssComments(readFileSync(resolve(STYLES_DIR, name), "utf8")),
  }));

const SIGNAL_CLASS = /\.(signal(?:-[A-Za-z0-9_-]+)?)\b/g;

/** Every `.signal`/`.signal-*` class named anywhere in `css`. */
function signalClasses(css: string): string[] {
  return [
    ...new Set(
      [...css.matchAll(SIGNAL_CLASS)].flatMap((m) =>
        m[1] === undefined ? [] : [m[1]],
      ),
    ),
  ].sort();
}

describe("D10: a .signal-* construct is declared in signal.css and nowhere else", () => {
  it("has stylesheets to scan, so the assertions below have a subject", () => {
    // A rename of the directory, or a glob that stopped matching, would make
    // the list below an empty list that agrees with an empty expectation.
    const names = SHEETS.map((sheet) => sheet.name);
    expect(names).toContain("signal.css");
    expect(names).toContain("primitives.css");
    expect(SHEETS.length).toBeGreaterThan(10);
  });

  it("declares none of them outside signal.css", () => {
    const offenders = SHEETS.filter((sheet) => sheet.name !== "signal.css")
      .flatMap((sheet) =>
        signalClasses(sheet.css).map(
          (name) => `${sheet.name} declares .${name}`,
        ),
      )
      .sort();

    expect(
      offenders,
      "a .signal-* construct is declared outside signal.css. D10 moves a " +
        "construct only when the organiser needs the same STRUCTURE, and " +
        "6.5e Task 7 measured that it needs none of them today: no organiser " +
        "route or component renders a .signal-* class. For most candidates " +
        "the reason is PURPOSE — the construct exists for a marketing band. " +
        "For .signal-btn, .signal-card and .signal-panel, which really are " +
        "structural duplicates of .button-primary and .card-hairline, the " +
        "reason is SCOPE: unifying them means the landing page renders the " +
        "organiser's construct, and #187 puts the landing page out of this " +
        "phase. That second answer is a scope answer and a later phase can " +
        "reopen it. Note that a move into primitives.css " +
        "is NOT the safe half of the seam — primitives.css is imported by " +
        "landing.css too, so the construct stays rendered by the landing " +
        "page and merely also ships to the organiser. If the answer really " +
        "changed, change the note first and this test second: the note at " +
        "docs/superpowers/notes/2026-10-20-d10-moved-constructs.md is the " +
        "deliverable and this is only its guard.",
    ).toEqual([]);
  });

  it("really finds them in signal.css, so the emptiness above is a result", () => {
    // Positive control: the same scan and the same regex, pointed at the file
    // that is supposed to be full. A pattern that found nothing anywhere would
    // make the assertion above pass by scanning nothing at all.
    const mine = signalClasses(
      SHEETS.find((sheet) => sheet.name === "signal.css")?.css ?? "",
    );

    for (const name of [
      "signal",
      "signal-btn",
      "signal-card",
      "signal-chip",
      "signal-panel",
      "signal-pill",
      "signal-scroll-x",
    ]) {
      expect(mine).toContain(name);
    }
    expect(mine.length).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------------------
// I3 (review round 1) — the inverse invariant, which closes the rename hole.
//
// The scan above finds a construct by its `.signal-` prefix, so a construct
// moved AND renamed (`.signal-scroll-x` -> `.scroll-x` in `primitives.css`,
// colour-free) is invisible to it. Task 7's report called that unguardable
// without barring a legal move. The reviewer was right that it is not, and the
// guard is this: EVERY CLASS `primitives.css` PAINTS HAS A CONSUMER THAT IS NOT
// THE LANDING PAGE. A legal D10 move brings organiser markup with it and passes;
// a speculative move, or one whose only renderer is still `sections/signal/`,
// does not.
//
// WHY "not the landing chain" RATHER THAN "an organiser source", which is how
// the review phrased it. Measured, and the weaker-sounding form is the only
// TRUE one: `.card-hairline` and `.mono-caption` are rendered ONLY by
// `src/components/CardHairline.tsx` and `src/components/MonoCaption.tsx`, and
// `CHAINS` assigns no chain to `src/components/*` — `chainOf()` returns
// undefined for both. So "rendered by an admin.html source" is FALSE today for
// two of the four components `primitives.css` exists to share, and asserting it
// would have been a red test naming a file that is doing nothing wrong.
//
// That hole is worth its own line because it is not only this test's problem:
// `theme.test.ts`'s seam guard (:527-530) skips every file whose `chainOf` does
// not match the chain under test, so an UNASSIGNED file is invisible to it too.
//
// BE PRECISE ABOUT WHAT THAT MISSES, because the first draft of this comment
// was not. The example `theme.test.ts:448` names — "a landing component that
// starts rendering `.card-hairline`" — IS caught: a landing component lives
// under `sections/`, `island/` or `routes/landing.tsx`, all of which `CHAINS`
// assigns. What escapes is an UNASSIGNED file, `src/components/*` above all.
// Benign today, and checked rather than assumed: every importer of
// `CardHairline` and `MonoCaption` is a `routes/*` module or
// `OrganiserShell.tsx`, never a landing source. Closing it means teaching
// `CHAINS` about `src/components/`, which is `css-chain.ts`'s business and
// three other plans' blast radius, so Task 7 reported it to the owner rather
// than widening its own diff.

const PRIMITIVES = "primitives.css";

/** Every class painted by a rule in `css`: `.a:hover, .b > .c` -> a, b, c.
 *
 *  `parseRuleBodies` recurses into `@media` and DROPS every other at-rule, so
 *  CEILING, so the next reader meets it here and not in a report: this swap
 *  is correct only because the scan wants SELECTORS and nothing else. The
 *  moment it cares WHICH declarations are conditional, the rewrite is wrong
 *  and the fix belongs in `css-chain.ts`'s parser rather than here.
 *
 *  an `@supports` block's rules are invisible to it — and `primitives.css` has
 *  one (`:232`), which is the only place `.field-help` is painted. Review round
 *  2 (N3) caught that as an undercount: the file paints 12 classes and this
 *  scan saw 11. Rewriting the at-rule keyword is the whole fix, because the
 *  only thing wanted from inside the block is its selectors. Done here rather
 *  than in `css-chain.ts`, whose parser three other plans share. */
function classesPaintedBy(css: string): string[] {
  const hits = new Set<string>();
  for (const rule of parseRuleBodies(css.replaceAll("@supports", "@media"))) {
    if (declarations(rule.body).length === 0) continue;
    for (const m of rule.selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
      if (m[1] !== undefined) hits.add(m[1]);
    }
  }
  return [...hits].sort();
}

/** Source files grouped by the chain they ship in, read once.
 *
 *  `src/styles/` IS EXCLUDED, AND THAT EXCLUSION IS LOAD-BEARING. `tokens.ts`
 *  is a `.ts` file under `src`, so `sourceFiles()` returns it, and it holds
 *  quoted class keys — `"mono-caption"` (:268), `"card-hairline"` (:373) —
 *  which `renders()` matches exactly as if they were markup. A token map
 *  renders nothing. Leaving it in meant a future mover could satisfy the
 *  guard below by adding a token-map entry instead of an organiser consumer,
 *  which is the hole this file exists to close, reopened one level down.
 *  (Review round 2, N2.) */
const SOURCES = sourceFiles()
  .map((file) => ({ path: srcRelative(file), file }))
  .filter(({ path }) => !path.startsWith("styles/"))
  .map(({ path, file }) => ({
    path,
    page: chainOf(path)?.page,
    text: readFileSync(file, "utf8"),
  }));

/** `className="a b"`, `className={"a"}` and a template literal all put the
 *  bare name in the source, so one scan covers them — the same bounded limit
 *  `theme.test.ts:533` names for its own scan, and the same expression. */
function renders(text: string, name: string): boolean {
  return new RegExp("[\"'`\\s{]" + name + "[\"'`\\s}]").test(text);
}

describe("D10: every construct primitives.css paints has a non-landing consumer", () => {
  const painted = classesPaintedBy(
    SHEETS.find((sheet) => sheet.name === PRIMITIVES)?.css ?? "",
  );

  it("really finds the classes primitives.css paints, so the scan is not vacuous", () => {
    // Positive control. An empty `painted` would make the assertion below pass
    // by checking nothing, and these four are the components the file's own
    // header says it exists to share.
    for (const name of [
      "mono-caption",
      "button-primary",
      "button-secondary",
      "card-hairline",
    ]) {
      expect(painted).toContain(name);
    }
    expect(painted.length).toBeGreaterThan(8);
  });

  it("has landing sources to be distinguished from, so the filter is not vacuous", () => {
    // If `chainOf` stopped resolving index.html, every class would trivially
    // have a "non-landing" consumer and the guard would assert nothing.
    expect(
      SOURCES.filter((source) => source.page === "index.html").length,
    ).toBeGreaterThan(2);
  });

  it("is rendered by something that is not a landing component", () => {
    const orphans = painted.filter(
      (name) =>
        !SOURCES.some(
          (source) =>
            source.page !== "index.html" && renders(source.text, name),
        ),
    );

    expect(
      orphans,
      "primitives.css paints a construct that no non-landing source renders. " +
        "primitives.css is imported by BOTH admin.css:32 and landing.css:9, " +
        "so a rule here that only the landing page renders is landing styling " +
        "shipped into the organiser bundle — D10's expensive direction, and " +
        "the shape a moved-and-renamed construct takes. A class nothing " +
        "renders at all is the speculative move the same ruling forbids. " +
        "Either give it its organiser consumer or leave the construct in " +
        "signal.css; see " +
        "docs/superpowers/notes/2026-10-20-d10-moved-constructs.md.",
    ).toEqual([]);
  });
});
