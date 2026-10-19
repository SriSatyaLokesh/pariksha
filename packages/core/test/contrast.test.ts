import { describe, it, expect } from "vitest";
import { CREAM, HEX_COLOUR, INK, contrastRatio, meetsAA } from "../src/contrast.js";

// The function moved here from apps/web/test, where it existed twice.
// `apps/web/test/contrast.test.ts` and `contrast-usage.test.ts` still run
// every DESIGN.md pair through it, unchanged apart from the import — that
// is the proof the move was a move. What is asserted here is the
// arithmetic itself, at the boundary T-23's brand-colour gate sits on.

describe("contrastRatio", () => {
  it.each([
    ["#b3261e", CREAM, 6.34],
    ["#0d7a51", CREAM, 5.2],
    ["#0a6fd4", CREAM, 4.81],
  ])("matches the ratio DESIGN.md states for %s", (fg, bg, stated) => {
    expect(Math.round(contrastRatio(fg, bg) * 100) / 100).toBeCloseTo(stated, 2);
  });

  it("is symmetric — which colour is the text does not change the ratio", () => {
    expect(contrastRatio(INK, CREAM)).toBeCloseTo(contrastRatio(CREAM, INK), 10);
  });

  it("spans the whole 1:1 to 21:1 range", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#808080", "#808080")).toBeCloseTo(1, 10);
  });

  it("reads upper and lower case hex the same", () => {
    expect(contrastRatio("#B3261E", CREAM)).toBeCloseTo(contrastRatio("#b3261e", CREAM), 10);
  });
});

describe("meetsAA", () => {
  it("is the 4.5:1 boundary", () => {
    // 4.542:1 and 4.478:1 — the tightest pair either side of it in the
    // grey ramp, so an off-by-a-hair in the luminance curve shows here.
    expect(meetsAA("#767676", "#ffffff")).toBe(true);
    expect(meetsAA("#777777", "#ffffff")).toBe(false);
  });

  it("holds for the two grounds T-23's gate measures against", () => {
    expect(meetsAA(INK, CREAM)).toBe(true);
    // The plan's own example, and the reason the gate measures against
    // cream rather than against "cream and ink": #f59a6e is readable on
    // ink (7.57:1) and unreadable on the cream page a candidate actually
    // sees (2.09:1).
    expect(meetsAA("#f59a6e", CREAM)).toBe(false);
    expect(meetsAA("#f59a6e", INK)).toBe(true);
  });
});

describe("HEX_COLOUR", () => {
  it("accepts #rrggbb in either case and nothing else", () => {
    expect(HEX_COLOUR.test("#b63a10")).toBe(true);
    expect(HEX_COLOUR.test("#B63A10")).toBe(true);
    for (const bad of ["b63a10", "#b63a1", "#b63a100", "rgb(1,2,3)", "red", "#b63a1g", "", "#b63a10 "]) {
      expect(HEX_COLOUR.test(bad), bad).toBe(false);
    }
  });
});
