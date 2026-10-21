import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { stripCssComments } from "./css-chain";

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

const STYLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/styles",
);

/** Every stylesheet in src/styles, comments stripped — prose cannot satisfy a
 *  scan, and three of these files discuss `.signal-*` in their headers. */
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
        "6.5e Task 7 measured that it needs none of them: no organiser route " +
        "or component renders a .signal-* class, and every candidate already " +
        "has an organiser equivalent. Note that a move into primitives.css " +
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
