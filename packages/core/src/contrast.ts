// WCAG 2.1 relative luminance and contrast ratio.
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
//
// One copy. It existed twice before Task 10 (#61, P5.8), byte-identical,
// in `apps/web/test/contrast.test.ts` and `apps/web/test/
// contrast-usage.test.ts` — both of which now import it from here, and
// must keep passing untouched otherwise, which is the proof the move was a
// move and not a rewrite.
//
// It lives in `@pariksha/core` rather than in `apps/web` because the
// *server* has to run it too: T-23's brand colour is organiser-supplied
// and reaches every candidate-facing page, so `PATCH /workspaces/:id`
// re-checks it (docs/test-format.md: every rule is re-checked on the
// server, and the browser's copy is a courtesy).
//
// No colour library for four lines of arithmetic — the controller ruling
// that stood when this was two test-file copies stands here too.

/** The candidate-facing page background (`--color-cream`). */
export const CREAM = "#fffbf5";
/** The candidate-facing body text colour (`--color-ink`). */
export const INK = "#231f1d";

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

/** The WCAG contrast ratio between two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(hexToRgb(foreground));
  const l2 = relativeLuminance(hexToRgb(background));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.1 AA for body text: 4.5:1. */
export function meetsAA(foreground: string, background: string): boolean {
  return contrastRatio(foreground, background) >= 4.5;
}

/**
 * The colour shown as the example wherever one is refused. Exported, not
 * typed out at each call site, because `apps/web/test/no-hex-colors.test.ts`
 * bans a hex literal anywhere under `apps/web/src` — strings included —
 * and because the browser's refusal and the server's must not drift into
 * suggesting two different colours.
 */
export const EXAMPLE_BRAND_COLOUR = "#b63a10";

/** `#rrggbb`, lower or upper case. The one spelling stored, so a value and
 * its contrast can never disagree about which colour they mean. */
export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;
