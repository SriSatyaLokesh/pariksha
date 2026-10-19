import { describe, it, expect } from "vitest";
import { contrastRatio } from "@pariksha/core";
import { contrastPairs } from "../src/styles/tokens";

// Task 10 (#61, P5.8): `contrastRatio` used to be defined here, and
// byte-identically in the sibling file. It is `@pariksha/core`'s now — the
// server re-checks T-23's brand colour with it, so there can be only one
// copy. Nothing else in this file changed, which is the proof the move was
// a move.

describe("every stated contrast pair in DESIGN.md matches its computed ratio", () => {
  // This is not an AA gate: some pairs (voltage, voltage-hover) are
  // deliberately below 4.5:1 and are documented as such. The job here is
  // only that DESIGN.md's stated numbers are true.
  for (const pair of contrastPairs) {
    it(`${pair.token} (${pair.fg} on ${pair.bg}) computes to ${pair.stated}`, () => {
      const ratio = contrastRatio(pair.fg, pair.bg);
      const rounded = Math.round(ratio * 100) / 100;
      expect(Math.abs(rounded - pair.stated)).toBeLessThanOrEqual(0.01);
    });
  }
});
