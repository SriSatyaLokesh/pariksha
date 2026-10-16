import { describe, it, expect } from "vitest";
import type { Question } from "../../src/types.js";
import {
  gradeText,
  matchBlank,
  withinTolerance,
  assertSafeRegex,
  MAX_REGEX_LENGTH,
  MAX_BLANK_INPUT_LENGTH,
} from "../../src/grade/text.js";

// Real questions from examples/reasoning-aptitude/questions.json, by ID:
// QNT-001: numeric, value 72, tolerance 0 absolute, all_or_nothing, 2 points.
// QNT-002: numeric, value 7.2, tolerance 0.05 absolute, all_or_nothing, 2 points.
// QNT-005: fill_blank, two blanks (b1 -> "56" exact, b2 -> "224" exact), partial, 2 points.

const QNT_001: Question = {
  id: "QNT-001",
  type: "numeric",
  prompt: "A train 180 metres long passes a pole in 9 seconds. What is the speed of the train in kilometres per hour?",
  unit: "km/h",
  key: { value: 72, tolerance: 0, tolerance_type: "absolute" },
  scoring: { mode: "all_or_nothing", points: 2 },
};

const QNT_002: Question = {
  id: "QNT-002",
  type: "numeric",
  prompt: "Asha finishes a job in 12 days and Bhanu finishes the same job in 18 days. Working together, how many days?",
  unit: "days",
  key: { value: 7.2, tolerance: 0.05, tolerance_type: "absolute" },
  scoring: { mode: "all_or_nothing", points: 2 },
};

const QNT_005: Question = {
  id: "QNT-005",
  type: "fill_blank",
  prompt: "Complete the series: 7, 14, 28, {{b1}}, 112, {{b2}}.",
  blanks: [
    { id: "b1", accepted: ["56"], match: "exact" },
    { id: "b2", accepted: ["224"], match: "exact" },
  ],
  scoring: { mode: "partial", points: 2 },
};

const DEFAULTS = { mode: "all_or_nothing" as const, negativeFraction: 0 };

describe("withinTolerance", () => {
  it("grades QNT-001 (numeric, tolerance 0) exactly", () => {
    expect(withinTolerance(72, { value: 72, tolerance: 0, tolerance_type: "absolute" })).toBe(true);
    expect(withinTolerance(72.1, { value: 72, tolerance: 0, tolerance_type: "absolute" })).toBe(false);
  });

  it("grades QNT-002 (numeric, absolute tolerance 0.05) at both edges", () => {
    expect(withinTolerance(7.25, { value: 7.2, tolerance: 0.05, tolerance_type: "absolute" })).toBe(true);
    expect(withinTolerance(7.26, { value: 7.2, tolerance: 0.05, tolerance_type: "absolute" })).toBe(false);
  });

  it("a percent tolerance around a key value of zero accepts only zero and never yields NaN", () => {
    expect(withinTolerance(0, { value: 0, tolerance: 5, tolerance_type: "percent" })).toBe(true);
    expect(withinTolerance(0.1, { value: 0, tolerance: 5, tolerance_type: "percent" })).toBe(false);
  });

  it("computes percent tolerance by multiplication, not division by the key value", () => {
    // 10% of 50 = 5, so 55 is inside and 56 is outside.
    expect(withinTolerance(55, { value: 50, tolerance: 10, tolerance_type: "percent" })).toBe(true);
    expect(withinTolerance(56, { value: 50, tolerance: 10, tolerance_type: "percent" })).toBe(false);
  });
});

describe("matchBlank", () => {
  it("case_insensitive matching folds case locale-independently and normalises to NFC", () => {
    expect(matchBlank("İstanbul", { id: "b1", accepted: ["istanbul"], match: "case_insensitive" })).toBe(false);
    expect(
      matchBlank("పరీక్ష".normalize("NFD"), { id: "b1", accepted: ["పరీక్ష"], match: "case_insensitive" }),
    ).toBe(true);
  });

  it("exact match is case-sensitive and still trims/normalises", () => {
    expect(matchBlank("  56  ", { id: "b1", accepted: ["56"], match: "exact" })).toBe(true);
    expect(matchBlank("Paris", { id: "b1", accepted: ["paris"], match: "exact" })).toBe(false);
  });

  it("regex blanks are anchored, so a substring match is not accepted", () => {
    expect(matchBlank("xx42xx", { id: "b1", accepted: ["\\d+"], match: "regex" })).toBe(false);
    expect(matchBlank("42", { id: "b1", accepted: ["\\d+"], match: "regex" })).toBe(true);
  });

  it("defaults to case_insensitive when match is omitted", () => {
    expect(matchBlank("BLUE", { id: "b1", accepted: ["blue"] })).toBe(true);
  });
});

describe("assertSafeRegex — permitted subset", () => {
  it("rejects a pattern over MAX_REGEX_LENGTH", () => {
    expect(() => assertSafeRegex("a".repeat(MAX_REGEX_LENGTH + 1))).toThrow(/too long/i);
  });

  // Each of these was, in turn, a live bypass of an earlier blacklist-style
  // check (round 1 caught (a+)+ and the explicit-alternation shapes; round 2
  // closed ((a|a))+, (a?a?)+ and a*a*a*a*b after they were found to slip
  // through). The permitted-subset rule is a single grammar check, so all
  // of these are rejected by the SAME code path (the "unbounded-quantified
  // group contains another quantifier/alternation at any depth" rule, or
  // the "adjacent unbounded quantifiers" rule for the last one) rather than
  // by one bespoke rule per shape.
  it.each([
    ["(a+)+", /unsafe/i],
    ["(a|a)+", /alternation|quantifier/i],
    ["(a|ab|b)+", /alternation|quantifier/i],
    ["((a|a))+", /alternation|quantifier/i], // alternation nested two levels deep inside the quantified group
    ["(x(a|a))+", /alternation|quantifier/i], // alternation nested inside a quantified group alongside a literal
    ["(a?a?)+", /alternation|quantifier/i], // only bounded `?` quantifiers inside — no `*`/`+` at all
    ["a*a*a*a*b", /unbounded repeat/i], // no groups at all — polynomial blowup from adjacent unbounded quantifiers
  ])("rejects %s", (pattern, messagePattern) => {
    expect(() => assertSafeRegex(pattern)).toThrow(/unsafe/i);
    expect(() => assertSafeRegex(pattern)).toThrow(messagePattern);
  });

  it.each(["\\d{1,5}", "[a-z]+", "(abc)+", "(\\d\\d)+", "(cat|dog){1,5}", "cat|dog", "^(yes|no)$"])(
    "accepts %s",
    (pattern) => {
      expect(() => assertSafeRegex(pattern)).not.toThrow();
    },
  );

  it("names the construct and the way out in every rejection message", () => {
    // Every rejection should point the author at a fix: bound the repeat,
    // or list the forms in `accepted`.
    for (const pattern of ["(a+)+", "(a|a)+", "(a?a?)+", "a*a*a*a*b"]) {
      expect(() => assertSafeRegex(pattern)).toThrow(/bound|accepted/i);
    }
  });

  it("bans backreferences outright", () => {
    expect(() => assertSafeRegex("(a+)\\1+")).toThrow(/backreference/i);
    expect(() => assertSafeRegex("(?<year>\\d{4})-\\k<year>")).toThrow(/backreference/i);
  });

  it("bans lookahead and lookbehind outright", () => {
    expect(() => assertSafeRegex("foo(?=bar)")).toThrow(/lookahead|lookbehind/i);
    expect(() => assertSafeRegex("(?<=foo)bar")).toThrow(/lookahead|lookbehind/i);
  });

  it("does not ban an ordinary named capture group (not lookbehind)", () => {
    expect(() => assertSafeRegex("(?<year>\\d{4})")).not.toThrow();
  });

  it("a catastrophically backtracking pattern previously accepted is genuinely slow when run unguarded, confirming the rejection matters", () => {
    // (a|a)+ — the round-1 bypass — run unguarded at a small, suite-safe
    // input size. Not asserting a specific duration (flaky across
    // machines), just that it is not instantaneous like every pattern in
    // the accepted set below.
    const re = new RegExp("^(?:(a|a)+)$", "u");
    const input = "a".repeat(20) + "!";
    const start = Date.now();
    re.test(input);
    expect(Date.now() - start).toBeGreaterThan(50);
  });
});

describe("matchBlank regex input-length cap", () => {
  it("refuses to regex-match a candidate over MAX_BLANK_INPUT_LENGTH (101 chars), scoring it as a non-match rather than throwing", () => {
    expect(MAX_BLANK_INPUT_LENGTH).toBe(100);
    const tooLong = "a".repeat(MAX_BLANK_INPUT_LENGTH + 1);
    expect(() => matchBlank(tooLong, { id: "b1", accepted: ["a+"], match: "regex" })).not.toThrow();
    expect(matchBlank(tooLong, { id: "b1", accepted: ["a+"], match: "regex" })).toBe(false);
  });

  it("still matches a candidate at exactly the cap (100 chars)", () => {
    const atCap = "a".repeat(MAX_BLANK_INPUT_LENGTH);
    expect(atCap).toHaveLength(100);
    expect(matchBlank(atCap, { id: "b1", accepted: ["a+"], match: "regex" })).toBe(true);
  });
});

describe("assertSafeRegex — accepted set is fast at the input cap (regression guard)", () => {
  // Every pattern the whitelist admits, matched against an adversarial
  // (non-matching, so the engine must exhaust its options) input at
  // exactly MAX_BLANK_INPUT_LENGTH. If a future change to the grammar
  // check ever readmits a pattern that can blow up, this is the test that
  // should catch it by timing out rather than by a human noticing.
  const n = MAX_BLANK_INPUT_LENGTH;
  const cases: Array<{ pattern: string; attack: string }> = [
    { pattern: "\\d{1,5}", attack: "1".repeat(n) },
    { pattern: "[a-z]+", attack: "a".repeat(n - 1) + "1" },
    { pattern: "(abc)+", attack: "abc".repeat(Math.floor(n / 3)) + "x" },
    { pattern: "(\\d\\d)+", attack: "1".repeat(n - 1) + "x" },
    { pattern: "(cat|dog){1,5}", attack: "cat".repeat(Math.floor(n / 3)) + "x" },
    { pattern: "cat|dog", attack: "c".repeat(n) },
  ];

  it("every accepted pattern matches or fails in a few milliseconds, even against a worst-case-shaped input at the cap", () => {
    let worstElapsed = 0;
    for (const { pattern, attack } of cases) {
      expect(() => assertSafeRegex(pattern)).not.toThrow();
      expect(attack.length).toBeLessThanOrEqual(n);
      const re = new RegExp(`^(?:${pattern})$`, "u");
      const start = Date.now();
      re.test(attack);
      const elapsed = Date.now() - start;
      worstElapsed = Math.max(worstElapsed, elapsed);
      // Generous relative to the sub-millisecond reality, but tight enough
      // that an exponential or polynomial blowup pattern would fail this
      // long before it got anywhere near MAX_BLANK_INPUT_LENGTH.
      expect(elapsed).toBeLessThan(200);
    }
    expect(worstElapsed).toBeLessThan(200);
  });
});

describe("gradeText", () => {
  it("grades QNT-001 (numeric, tolerance 0) exactly", () => {
    expect(gradeText(QNT_001, { kind: "number", value: 72 }, DEFAULTS).points).toBe(2);
    expect(gradeText(QNT_001, { kind: "number", value: 72.1 }, DEFAULTS).points).toBe(0);
    expect(gradeText(QNT_001, null, DEFAULTS).points).toBe(0);
  });

  it("grades QNT-002 (numeric, absolute tolerance 0.05) at both edges", () => {
    expect(gradeText(QNT_002, { kind: "number", value: 7.25 }, DEFAULTS).points).toBe(2);
    expect(gradeText(QNT_002, { kind: "number", value: 7.26 }, DEFAULTS).points).toBe(0);
  });

  it("grades QNT-005 (fill_blank, two blanks) with partial credit", () => {
    // 1 of 2 blanks right, the other left empty: an unattempted blank
    // scores as not-correct without counting as wrong.
    const omitted = gradeText(QNT_005, { kind: "blanks", values: { b1: "56" } }, DEFAULTS);
    expect(omitted.points).toBe(1);
    expect(omitted.correct).toBe(false);

    // 1 of 2 blanks right, the other actively wrong: the wrong answer
    // cancels the right one under the partial formula.
    const wrong = gradeText(QNT_005, { kind: "blanks", values: { b1: "56", b2: "000" } }, DEFAULTS);
    expect(wrong.points).toBe(0);
    expect(wrong.correct).toBe(false);

    // Both blanks right: full points.
    expect(gradeText(QNT_005, { kind: "blanks", values: { b1: "56", b2: "224" } }, DEFAULTS).points).toBe(2);

    // A null response is blank: scores 0, never negative.
    expect(gradeText(QNT_005, null, DEFAULTS).points).toBe(0);
  });

  it("a blank response scores 0 and never loses points, even under negative mode", () => {
    const negativeDefaults = { mode: "negative" as const, negativeFraction: 0.25 };
    expect(gradeText(QNT_001, null, negativeDefaults).points).toBe(0);
    expect(gradeText(QNT_005, null, negativeDefaults).points).toBe(0);
  });
});
