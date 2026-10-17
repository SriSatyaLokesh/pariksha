import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPO_ROOT,
  DESIGN_MD_PATH,
  CSS_OUTPUT_PATH,
  TS_OUTPUT_PATH,
  parseDesignTokens,
  parseContrastPairs,
  toCss,
  toTs,
  filesWithHexLiterals,
} from "./tokens.mjs";

const markdown = readFileSync(DESIGN_MD_PATH, "utf8");
const tokens = parseDesignTokens(markdown);

describe("parseDesignTokens", () => {
  it("reads every colour from DESIGN.md's front matter", () => {
    expect(tokens.colors.voltage).toBe("#e24c18");
    expect(tokens.colors.cream).toBe("#fffbf5");
    expect(Object.keys(tokens.colors).length).toBeGreaterThanOrEqual(20);
  });

  it("resolves component token references to concrete values", () => {
    expect(tokens.components["hero-section"].backgroundColor).toBe("#e24c18");
    expect(tokens.components["hero-section"].typography).toEqual(
      tokens.typography["display-xl"],
    );
    expect(tokens.components["button-primary"].rounded).toBe(
      tokens.rounded.full,
    );
  });
});

describe("toCss", () => {
  it("emits a CSS custom property per colour and per typography token", async () => {
    const css = await toCss(tokens);
    expect(css).toContain("--color-voltage: #e24c18;");
    expect(css).toContain("--type-display-xl-size: 56px;");
    expect(css).toContain("--rounded-full: 9999px;");
    expect(css).toContain("--space-xl: 24px;");
  });
});

describe("parseContrastPairs", () => {
  const pairs = parseContrastPairs(markdown, tokens.colors);

  it("parses every stated ratio from the colour tables", () => {
    expect(pairs).toContainEqual({
      token: "voltage",
      fg: "#e24c18",
      bg: "#fffbf5",
      stated: 3.86,
    });
    expect(pairs.length).toBeGreaterThanOrEqual(13);
  });

  it("skips rows with no stated ratio and uses cream as bg", () => {
    expect(pairs.every((p) => p.bg === "#fffbf5")).toBe(true);
    expect(pairs.find((p) => p.token === "voltage-soft")).toBeUndefined();
    expect(pairs.find((p) => p.token === "data-blue")).toEqual({
      token: "data-blue",
      fg: "#0a6fd4",
      bg: "#fffbf5",
      stated: 4.81,
    });
  });
});

describe("generated files", () => {
  it("the committed token files match what the generator produces", async () => {
    expect(readFileSync(CSS_OUTPUT_PATH, "utf8")).toBe(await toCss(tokens));
    const pairs = parseContrastPairs(markdown, tokens.colors);
    expect(readFileSync(TS_OUTPUT_PATH, "utf8")).toBe(
      await toTs(tokens, pairs),
    );
  });
});

describe("no hex literals outside generated tokens", () => {
  it("finds none under apps/web/src", () => {
    const srcDir = join(REPO_ROOT, "apps/web/src");
    expect(
      filesWithHexLiterals(srcDir, {
        except: ["styles/tokens.ts", "styles/tokens.css"],
      }),
    ).toEqual([]);
  });

  it("treats a missing apps/web/src tree as zero offending files", () => {
    expect(
      filesWithHexLiterals(join(REPO_ROOT, "apps/web/does-not-exist")),
    ).toEqual([]);
  });
});
