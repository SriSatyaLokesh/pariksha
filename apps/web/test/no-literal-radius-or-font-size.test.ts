import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Phase 8h, F6 ("three screens, three rounding systems") / G1-05 / G5-15:
// `signal.css` hand-wrote `border-radius: 14px` four times — a value no
// `--rounded-*` token names (the nearest is `--rounded-lg`, 8px) — and
// `analytics.css` hand-wrote `font-size: 10px` over the `--type-mono-sm-size`
// (12px) its own `th` rule otherwise uses throughout. Neither literal is an
// exact duplicate of a token's own value: F6's own finding is that the
// TOKENS already cover every radius and size this product needs (3/4/6/8/9999
// and the dozen `--type-*-size`s) and the drift is screens reaching for a
// hand-typed number instead of one of them. So the guard below bans every
// literal `border-radius`/`font-size` in px outright, not only ones that
// happen to equal a token exactly — a hand-typed value could always have
// been one of the existing tokens misspelled as a number, and the fix is the
// same either way: reach for the var().
//
// A bare unitless `0` is exempted: it is the one idiomatic way to write "no
// radius" and nobody tokenises it.
//
// SCOPED TO THIS LANE'S OWN STYLESHEETS (Phase 8h's lane split,
// docs/superpowers/specs/2026-10-24-phase-8h-the-frame-design.md). The same
// drift exists in files other lanes own — measured at the time this guard
// was written, exam.css alone has two `border-radius: 6px` and one
// `font-size: 20px` — and this lane may not edit exam.css. Widening
// SCANNED_FILES to the rest of apps/web/src/styles is each lane's own call
// to make as it clears its own debt.
//
// KNOWN_DEBT is signal.css's OWN remaining literals, left alone this wave
// deliberately: none equals a token value, each would need a real design
// decision about which size it becomes, and signal.css is a marketing page
// this lane cannot verify without a browser (Playwright is held this wave —
// see the lane's own report). Grandfathered by exact value so the guard
// still reddens the moment a NEW literal appears, or an old one changes to a
// different un-reviewed number, rather than exempting the whole file.
const STYLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/styles",
);

const SCANNED_FILES = [
  "primitives.css",
  "registration.css",
  "question.css",
  "analytics.css",
  "grading.css",
  "base.css",
  "signal.css",
];

const KNOWN_DEBT = new Set([
  "signal.css:font-size:19",
  "signal.css:font-size:13.5",
  "signal.css:font-size:10.5",
  "signal.css:font-size:15.5",
  "signal.css:font-size:12.5",
  "signal.css:font-size:14.5",
  "signal.css:font-size:11",
  "signal.css:font-size:10",
]);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

// A literal `border-radius`/`font-size` declaration in px, never `var(...)`,
// and never a bare unitless `0`.
const LITERAL_RE = /(border-radius|font-size)\s*:\s*([\d.]+)px\b/g;

describe("no literal border-radius or font-size (F6) outside KNOWN_DEBT", () => {
  for (const file of SCANNED_FILES) {
    it(`${file} writes no un-grandfathered literal px border-radius/font-size`, () => {
      const css = stripComments(readFileSync(resolve(STYLES_DIR, file), "utf8"));
      const offenders: string[] = [];
      css.split("\n").forEach((line, i) => {
        for (const match of line.matchAll(LITERAL_RE)) {
          const [, property, value] = match;
          if (!property || !value) continue;
          if (KNOWN_DEBT.has(`${file}:${property}:${value}`)) continue;
          offenders.push(`${file}:${i + 1}: ${property}: ${value}px`);
        }
      });
      expect(offenders).toEqual([]);
    });
  }

  // KNOWN_DEBT only grandfathers what is actually still there — an entry
  // nothing in the file matches any more is debt this suite forgot to shrink.
  it("KNOWN_DEBT names no value that has already been fixed", () => {
    const present = new Set<string>();
    for (const file of SCANNED_FILES) {
      const css = stripComments(readFileSync(resolve(STYLES_DIR, file), "utf8"));
      for (const match of css.matchAll(LITERAL_RE)) {
        const [, property, value] = match;
        if (property && value) present.add(`${file}:${property}:${value}`);
      }
    }
    expect([...KNOWN_DEBT].filter((key) => !present.has(key))).toEqual([]);
  });
});
