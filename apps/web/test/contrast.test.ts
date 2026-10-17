import { describe, it, expect } from "vitest";
import { contrastPairs } from "../src/styles/tokens";

// WCAG 2.1 relative luminance and contrast ratio, implemented directly
// (per the controller ruling, no colour library for four lines of
// arithmetic). https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

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
