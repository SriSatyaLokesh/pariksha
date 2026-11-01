import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  declarations,
  parseRuleBodies,
  resolvedChain,
} from "../css-chain";

const EXAM_CSS_PATH = resolve(__dirname, "../../src/styles/exam.css");
const RAW_EXAM_CSS = readFileSync(EXAM_CSS_PATH, "utf8");
const EXAM_CHAIN = resolvedChain("exam.html");
const RULES = parseRuleBodies(EXAM_CHAIN);

function ruleBody(selector: string): string {
  const rule = RULES.find((candidate) => candidate.selector === selector);
  if (!rule) {
    throw new Error(`no rule found for exact selector: "${selector}"`);
  }
  return rule.body;
}

function declared(body: string, property: string): string | undefined {
  const prefix = `${property}:`;
  const hit = declarations(body).find((decl) =>
    decl.replace(/\s+/g, "").startsWith(`${prefix.replace(/\s+/g, "")}`)
  );
  return hit?.slice(hit.indexOf(":") + 1).trim();
}

describe("Task 1: Hallmark stamp and typography anti-patterns (Rule 67 & Rule 64)", () => {
  describe("Hallmark stamp header", () => {
    it("starts with the required Hallmark stamp comment on line 1 of exam.css", () => {
      const firstLine = RAW_EXAM_CSS.split("\n")[0].trim();
      expect(firstLine).toBe("/* Hallmark · v2.0.0 · modern-minimal · candidate runtime */");
    });

    it("declares typography token aliases on :root", () => {
      const rootBodies = RULES.filter((r) => r.selector === ":root").map((r) => r.body);
      const fontBody = rootBodies.map((b) => declared(b, "--font-body")).find(Boolean);
      const fontDisplay = rootBodies.map((b) => declared(b, "--font-display")).find(Boolean);
      const fontMono = rootBodies.map((b) => declared(b, "--font-mono")).find(Boolean);

      expect(fontBody).toBe("var(--type-body-md-family)");
      expect(fontDisplay).toBe("var(--type-display-xl-family)");
      expect(fontMono).toBe("var(--type-mono-sm-family)");
    });
  });

  describe("Rule 67: No uppercase tracked text in label roles", () => {
    it(".exam-facts dt is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-facts dt");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "letter-spacing")).toBe("normal");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
      expect(declared(body, "font-size")).toBe("var(--type-body-sm-size)");
    });

    it(".exam-calc-title is untracked and sentence-case", () => {
      const body = ruleBody(".exam-calc-title");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "letter-spacing")).not.toBe("0.05em");
    });

    it(".exam-calc-grip does not have excessive letter spacing tracking", () => {
      const body = ruleBody(".exam-calc-grip");
      expect(declared(body, "letter-spacing")).not.toBe("2px");
      expect(declared(body, "letter-spacing")).toBe("normal");
    });

    it(".exam-options-legend is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-options-legend");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-match-caption is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-match-caption");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-field-label is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-field-label");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-result-table caption is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-result-table caption");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
      expect(declared(body, "letter-spacing")).not.toBe("0.08em");
    });

    it(".exam-result-table thead th is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-result-table thead th");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
      expect(declared(body, "letter-spacing")).not.toBe("0.08em");
    });

    it(".exam-review-number is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-review-number");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "letter-spacing")).not.toBe("0.08em");
    });

    it(".exam-proctor-banner-tag is untracked sentence-case body face", () => {
      const body = ruleBody(".exam-proctor-banner-tag");
      expect(declared(body, "text-transform")).toBe("none");
      expect(declared(body, "letter-spacing")).not.toBe("0.05em");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });
  });

  describe("Rule 64: No monospace font on UI labels", () => {
    it(".exam-font-scale legend, .exam-view-choice uses body face rather than monospace", () => {
      const body = ruleBody(".exam-font-scale legend, .exam-view-choice");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-options-legend uses body face", () => {
      const body = ruleBody(".exam-options-legend");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-match-caption uses body face", () => {
      const body = ruleBody(".exam-match-caption");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-field-label uses body face", () => {
      const body = ruleBody(".exam-field-label");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-result-table thead th uses body face", () => {
      const body = ruleBody(".exam-result-table thead th");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });

    it(".exam-proctor-banner-tag uses body face", () => {
      const body = ruleBody(".exam-proctor-banner-tag");
      expect(declared(body, "font-family")).toBe("var(--font-body)");
    });
  });
});
