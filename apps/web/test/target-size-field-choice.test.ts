import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { tokens } from "../src/styles/tokens";

// Phase 8h spec F3 / register G2-05 (also G2-07, G5-13 — other lanes' files,
// not this guard's job): "no interactive control renders below 24×24 CSS
// pixels on any audited screen, and the rule is enforced by a gate rather
// than by review." The PR this guard shipped with fixed three sites — a
// checkbox/radio's `<label>` now WRAPS its `<input>` (`.field-choice`,
// registration.css) instead of sitting beside it as two 17×17 siblings —
// but added no assertion at all, so F3 was claimed delivered with nothing
// to stop the next edit from quietly un-wrapping one of them.
//
// This is a markup-shape gate, not a measured one: jsdom does not lay out
// boxes, and Playwright is held this wave (see the lane's own report). It
// proves three things statically instead of by rendering:
//   1. the CSS actually guarantees a >=24px TALL row (via `.field-label`'s
//      own line-height token, the mechanism the fix's own comment in
//      registration.css names — not a magic number re-typed here),
//   2. the CSS actually guarantees a >=24px WIDE row too: `.field-choice`'s
//      `display: flex` is what turns the label from an inline element
//      (target box = the text run's own width, well under 24px for a short
//      label like "ID" or "Logs") into a block-level row filling `.field`.
//      Round 3 review: the first version of this gate asserted only the
//      ABSENCE of height/min-height/line-height and never asserted the
//      PRESENCE of the layout the fix's rationale actually depends on —
//      deleting `display: flex` passed with 6 green, and
//   3. the three sites this lane actually touched still wrap their input in
//      a `.field-choice` label rather than leaving it a bare sibling.
//
// This covers only the three sites Lane C fixed. The other ~20 bare
// label-above-input sites across the app (Structured.tsx, Choice.tsx,
// AccessPanel.tsx, FormBuilder.tsx, CandidateDataPanel.tsx, Registration.tsx,
// ViewControls.tsx, GradingQueue.tsx) are unconverted and belong to whichever
// lane owns each file — converting them here would mean editing files this
// lane does not own, which Lane C's other guards (e.g. signal-boundary's
// D10) exist specifically to catch.
const STYLES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/styles",
);
const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

const registrationCss = readFileSync(resolve(STYLES_DIR, "registration.css"), "utf8");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  const group = match?.[1];
  if (group === undefined) throw new Error(`selector not found: ${selector}`);
  return group;
}

describe("F3 / G2-05: checkbox and radio targets clear 24x24 (markup-shape gate)", () => {
  it("tokens.components' field-choice row relies on heading-sm's line-height, and that is >=24px", () => {
    // The fix's own comment (registration.css) says the row clears the
    // floor because `.field-label`'s line-height is already 24px, with no
    // extra min-height needed. Pin that reasoning to the token so a future
    // edit to heading-sm cannot silently drop the row under 24px.
    const lineHeight = Number.parseFloat(tokens.typography["heading-sm"].lineHeight);
    expect(lineHeight).toBeGreaterThanOrEqual(24);
  });

  it(".field-label declares line-height from --type-heading-sm-line-height", () => {
    const body = ruleBody(registrationCss, ".field-label ");
    expect(body).toMatch(/line-height:\s*var\(--type-heading-sm-line-height\)/);
  });

  it(".field-choice sets no height/min-height/line-height that would shrink the row below .field-label's", () => {
    const body = ruleBody(registrationCss, ".field-choice ");
    expect(body).not.toMatch(/\b(height|min-height|line-height)\s*:/);
  });

  // Round 3 review: without `display: flex`, `.field-label.field-choice` is
  // an inline element and its target box collapses to the width of its own
  // text run — well under 24px for a short label ("ID", "Logs") — on the
  // one axis the two tests above never look at (they only check height is
  // not shrunk). `display: flex` is what makes the label a block-level row
  // that fills `.field`'s width, which is the actual click target.
  it(".field-choice is a flex row — the width axis the height checks above don't cover", () => {
    const body = ruleBody(registrationCss, ".field-choice ");
    expect(body).toMatch(/display:\s*flex\b/);
  });

  // Markup shape: a label carrying `field-choice` must WRAP its input (the
  // G2-05 fix), not sit beside it as a separate sibling. Walks every
  // `<label ...>...</label>` block and asserts any that mention
  // `field-choice` in their class also contain an `<input` before the close.
  const SITES: { file: string; minSites: number }[] = [
    { file: "components/organiser/ApiKeyPanel.tsx", minSites: 1 },
    { file: "components/organiser/WebhookPanel.tsx", minSites: 1 },
    { file: "routes/grading.tsx", minSites: 1 },
  ];

  const LABEL_RE = /<label\b[^>]*>[\s\S]*?<\/label>/g;

  for (const { file, minSites } of SITES) {
    it(`${file}: every field-choice label wraps its own <input>`, () => {
      const tsx = readFileSync(resolve(SRC_DIR, file), "utf8");
      const labels = tsx.match(LABEL_RE) ?? [];
      const choiceLabels = labels.filter((label) => /className="[^"]*\bfield-choice\b/.test(label));
      expect(choiceLabels.length).toBeGreaterThanOrEqual(minSites);
      for (const label of choiceLabels) {
        expect(label).toMatch(/<input\b/);
      }
    });
  }
});
