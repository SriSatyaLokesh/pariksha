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
// see the lane's own report).
//
// Review finding M1 (Phase 8h Lane C PR review): a bare `Set<"file:prop:value">`
// grandfathers EVERY occurrence of that value in that file, not just the
// ones that existed when the entry was written — so a brand-new `11px`
// dropped anywhere else in signal.css passed silently, and fixing one of
// several occurrences of a value left the entry still "present" so the
// rot-check below never caught the partial clear. KNOWN_DEBT is therefore a
// count, not a membership test: it names exactly how many sites are
// grandfathered, so the (N+1)th occurrence of an allowlisted value is an
// offence like any other value, and the rot-check fires the moment the
// present count stops matching the declared one in EITHER direction —
// fixing one of four sites, not only all four.
//
// Round 3 residual of the same finding: counting in file order and allowing
// only the first N occurrences means the one that trips the limit is always
// whichever comes LAST in the file — which for an insertion ABOVE the
// existing sites is one of the pre-existing, legitimately grandfathered
// ones, not the new offender. Reporting that single line sends the reader
// to an innocent, already-known declaration. The per-file test below now
// reports every occurrence of an over-count key together, so the reader
// sees the whole group and can spot the unfamiliar one, rather than being
// pointed at one arbitrary (and usually wrong) line.
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

const KNOWN_DEBT: Record<string, number> = {
  "signal.css:font-size:19": 2,
  "signal.css:font-size:13.5": 3,
  "signal.css:font-size:10.5": 4,
  "signal.css:font-size:15.5": 2,
  "signal.css:font-size:12.5": 3,
  "signal.css:font-size:14.5": 4,
  "signal.css:font-size:11": 4,
  "signal.css:font-size:10": 2,
};

// Review finding M2: replacing a `/* ... */` comment with "" deletes the
// newlines inside it too, so every offender line number reported below was
// off by however many comment lines preceded it (signal.css:601's real
// `border-radius: 14px` was reported as :578 — the 23 comment lines above
// it). Blanking everything but the newlines keeps the stripped text the
// same length in lines as the original, so a reported line number always
// points at the real declaration.
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""));
}

// Review finding M6: the property alternation named only `border-radius`,
// missing its four logical-corner longhands (`border-start-start-radius`
// etc.) — added below, zero-risk since it only widens which property names
// are looked at.
//
// Two gaps named rather than guessed at: a shorthand with more than one
// literal (`border-radius: 0 0 14px 14px`) still only has its first value
// checked — a naive "grab every px number in the value" was tried and
// reverted, because it also flagged `clamp(22px, 2.4vw, 30px)`, a
// deliberate fluid-type pattern already in signal.css, as a banned literal.
// Telling "a second literal in a shorthand" apart from "a literal inside a
// clamp()/calc()/min()/max()" needs a real value parser, not a regex widen.
// And a `rem`/`em` radius or font-size escapes this guard entirely. Neither
// exists in the seven scanned files as of 2026-10-24, but F6's whole premise
// is that drift finds the next shape the guard doesn't cover — close these
// properly (a small CSS value tokenizer) the day either one does.
//
// A third gap, recorded rather than fixed (round 3 review): counting by
// value rather than by site means an allowlisted literal can MOVE for free.
// Delete one of signal.css's four grandfathered `11px` sites and add a new
// `11px` somewhere else in the file, and the count stays at 4 — nothing
// reddens, because this guard cannot tell "the same four sites" from "four
// sites, one of them new" without naming each site's location. That is
// inherent to counting instead of siting, and still strictly better than
// the old Set (which let a FIFTH site through for free, not just a moved
// one) — but it is a real gap, not a closed one.
const LITERAL_RE =
  /(border-radius|border-start-start-radius|border-start-end-radius|border-end-start-radius|border-end-end-radius|font-size)\s*:\s*([\d.]+)px\b/g;

function findOffenders(css: string): { line: number; property: string; value: string }[] {
  const offenders: { line: number; property: string; value: string }[] = [];
  css.split("\n").forEach((line, i) => {
    for (const match of line.matchAll(LITERAL_RE)) {
      const [, property, value] = match;
      if (!property || !value) continue;
      offenders.push({ line: i + 1, property, value });
    }
  });
  return offenders;
}

describe("no literal border-radius or font-size (F6) outside KNOWN_DEBT", () => {
  for (const file of SCANNED_FILES) {
    it(`${file} writes no un-grandfathered literal px border-radius/font-size`, () => {
      const css = stripComments(readFileSync(resolve(STYLES_DIR, file), "utf8"));
      // Group by key first — never report a single line in isolation. The
      // occurrence that pushes a key over its allowance is whichever one
      // falls last in file order, which is frequently one of the
      // pre-existing grandfathered sites rather than the new offender (round
      // 3 review). Naming the whole group lets the reader compare it against
      // KNOWN_DEBT's count and spot the unfamiliar line themselves.
      const byKey = new Map<string, { property: string; value: string; lines: number[] }>();
      for (const { line, property, value } of findOffenders(css)) {
        const key = `${file}:${property}:${value}`;
        const entry = byKey.get(key) ?? { property, value, lines: [] };
        entry.lines.push(line);
        byKey.set(key, entry);
      }
      const reported: string[] = [];
      for (const { property, value, lines } of byKey.values()) {
        const key = `${file}:${property}:${value}`;
        const allowed = KNOWN_DEBT[key] ?? 0;
        if (lines.length <= allowed) continue;
        reported.push(
          `${file}: ${property}: ${value}px — ${lines.length} occurrences at lines ${lines.join(", ")}, ` +
            `only ${allowed} grandfathered in KNOWN_DEBT (one of these lines is the new one)`,
        );
      }
      expect(reported).toEqual([]);
    });
  }

  // KNOWN_DEBT names exactly how many sites are grandfathered. If the
  // present count at a key ever stops matching the declared one — one of
  // four sites fixed, or all of them — this suite must be told, rather than
  // silently keep passing (full clear) or silently keep allowing a site
  // that no longer needs it (partial clear, the gap the old Set-based
  // membership test could not see at all).
  it("KNOWN_DEBT's declared counts match what is actually still in the files", () => {
    const present: Record<string, number> = {};
    for (const file of SCANNED_FILES) {
      const css = stripComments(readFileSync(resolve(STYLES_DIR, file), "utf8"));
      for (const { property, value } of findOffenders(css)) {
        const key = `${file}:${property}:${value}`;
        present[key] = (present[key] ?? 0) + 1;
      }
    }
    const mismatches = Object.entries(KNOWN_DEBT)
      .filter(([key, expected]) => (present[key] ?? 0) !== expected)
      .map(([key, expected]) => `${key}: declared ${expected}, found ${present[key] ?? 0}`);
    expect(mismatches).toEqual([]);
  });
});
