// UI/UX audit, Group 5 (docs/UI_UX_AUDIT_REPORT.md, epic #246) — the
// findings this file can pin as DECLARED CSS TEXT rather than as a
// behaviour a component test can render. `vitest.config.ts` sets
// `css: false`, so jsdom never applies a stylesheet and cannot see real
// geometry (an actual max-height in pixels, a real overflow clip, a real
// pixel-overlap between two fixed elements, a real sideways shove when
// the skip link gets focus). What IS checkable without a browser is that
// the stylesheet text itself still says what this plan's fix made it
// say — the same kind of guard `watermark.test.tsx`'s own `paintsIn`
// calls exist for, one step more direct: reading the declaration
// straight off the resolved cascade rather than resolving it against an
// element first, since several of these selectors (`:focus-visible`, the
// high-contrast override) describe states jsdom cannot really put an
// element into.
//
// G5-01, G5-06 and G5-07 are named explicitly in the task brief as needing
// real browser measurement — this file does not claim to close them, only
// to pin the one fact each fix rests on so a later edit cannot silently
// regress it unnoticed before anyone opens a browser at all.

import { describe, expect, it } from "vitest";
import {
  declarations,
  parseRuleBodies,
  resolvedChain,
} from "../css-chain";

const EXAM_CSS = resolvedChain("exam.html");
const RULES = parseRuleBodies(EXAM_CSS);

/** The body of the rule whose selector is EXACTLY `selector` once CSS
 *  comments are stripped and whitespace is collapsed — never a substring
 *  search, so a later rule that merely CONTAINS this selector's text
 *  (`:root[data-contrast="high"] .foo` containing `.foo`) cannot be
 *  mistaken for it. Throws rather than returning undefined: a selector
 *  this file renamed out from under a test must fail loudly. */
function ruleBody(selector: string): string {
  const rule = RULES.find((candidate) => candidate.selector === selector);
  if (!rule) {
    throw new Error(`no rule found for exact selector: ${selector}`);
  }
  return rule.body;
}

function declared(body: string, property: string): string | undefined {
  const prefix = `${property}:`;
  const hit = declarations(body).find((decl) => decl.replace(/\s+/g, "").startsWith(`${prefix.replace(/\s+/g, "")}`));
  return hit?.slice(hit.indexOf(":") + 1).trim();
}

describe("G5-01: the font-scale control reaches the stem, the options, the blanks and the fields", () => {
  it("`.exam-answer` rescales the three tokens those elements actually read, scoped below the two selectors that already scale their OWN font-size", () => {
    const body = ruleBody(".exam-answer");
    for (const token of [
      "--type-question-stem-size",
      "--type-option-label-size",
      "--type-body-md-size",
    ]) {
      const value = declared(body, token);
      expect(value, `${token} not redeclared on .exam-answer`).toBe(
        `calc(var(${token}) * var(--exam-font-scale, 1))`,
      );
    }
  });

  it("is not also redeclared on `.exam-runner` or `.exam-question`, which would double it (both already use these tokens for their OWN font-size)", () => {
    for (const selector of [".exam-runner", ".exam-question"]) {
      const body = ruleBody(selector);
      for (const token of ["--type-question-stem-size", "--type-option-label-size", "--type-body-md-size"]) {
        expect(declared(body, token), `${selector} redeclares ${token}`).toBeUndefined();
      }
    }
  });

  // Still needs a browser: that `.rendered--stem` (question.css, Lane C's)
  // actually renders at the scaled size at 1.25x/1.5x, and that nothing
  // downstream clips or wraps badly at the larger size.
});

describe("G5-02: a selected option survives high contrast by more than its border colour", () => {
  it("the base rule keeps its literal 2px (component-dimensions.test.ts pins this; a calc() here would break that unrelated guard)", () => {
    expect(declared(ruleBody(".exam-option-row.is-selected"), "border-width")).toBe("2px");
  });

  it("the high-contrast override doubles the unselected row's own edge instead", () => {
    const body = ruleBody(':root[data-contrast="high"] .exam-option-row.is-selected');
    expect(declared(body, "border-width")).toBe("calc(var(--exam-edge, 1px) * 2)");
  });

  // Still needs a browser: that 4px against 2px actually reads as
  // different at a glance, not just in the CSS text.
});

describe("G5-06 and G5-07: the palette rail fits its own grid and scrolls on its own", () => {
  it("padding moved off a bare 16px onto --space-md, clearing the grid's 212px content width", () => {
    const body = ruleBody(".exam-palette");
    expect(declared(body, "padding")).toBe("var(--space-md)");
  });

  it("gained its own scrollbar instead of relying on the whole page's", () => {
    const body = ruleBody(".exam-palette");
    expect(declared(body, "max-height")).toBe("calc(100vh - 48px)");
    expect(declared(body, "overflow-y")).toBe("auto");
  });

  // Still needs a browser: that 240 - 2*12 - 2*1 = 214px really clears the
  // grid's 5*36 + 4*8 = 212px with no subpixel clipping at real zoom
  // levels and real fonts, and that the rail actually scrolls past 24+
  // questions instead of merely being ASKED to.
});

describe("G5-08: the skip link does not shove the bar when it gets focus", () => {
  it("floats out of flow on focus instead of re-entering it", () => {
    const body = ruleBody(".exam-skip:focus-visible");
    expect(declared(body, "position")).toBe("fixed");
    expect(declared(body, "z-index")).toBe("40");
  });

  // Still needs a browser: that the clock, the save banner and Submit
  // really hold still when Tab lands here, which is a layout fact jsdom
  // cannot see at all.
});

describe("G5-09: the submit confirmation and the proctoring warning no longer share a corner", () => {
  it("the dialog now has an explicit top clearing the warning's own height, and a higher z-index", () => {
    const confirm = ruleBody(".exam-submit-confirm");
    expect(declared(confirm, "top")).toBe("64px");
    expect(declared(confirm, "z-index")).toBe("21");
  });

  it("the proctoring warning keeps its own, lower z-index — the two are ordered, not tied", () => {
    expect(declared(ruleBody(".exam-proctoring-count"), "z-index")).toBe("20");
  });

  // Still needs a browser: that 64px really clears the warning badge's
  // rendered height at every font size the font-scale control allows.
});

describe("G5-14: scrolling over the numeric field cannot silently change the answer", () => {
  it("the native spin buttons are suppressed in both engines", () => {
    const webkit = ruleBody(
      '.exam-text-input[type="number"]::-webkit-outer-spin-button, .exam-text-input[type="number"]::-webkit-inner-spin-button',
    );
    expect(declared(webkit, "appearance")).toBe("none");
    expect(declared(webkit, "-webkit-appearance")).toBe("none");
    const firefox = ruleBody('.exam-text-input[type="number"]');
    expect(declared(firefox, "-moz-appearance")).toBe("textfield");
  });

  // The actual guard against a changed VALUE is `Numeric`'s own `onWheel`
  // handler (`answer-written.test.tsx`), proved by firing a wheel event and
  // checking the field loses focus — jsdom does not implement the
  // browser's own wheel-over-a-focused-number-input default action, so
  // "the value never moves during a real scroll" still needs a browser.
});
