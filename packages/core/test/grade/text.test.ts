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

  // Each of these was, in turn, a live bypass of an earlier approach.
  // Round 1 caught (a+)+ and the explicit-alternation shapes with a
  // blacklist. Round 2 replaced it with a whitelist — "no quantifier or
  // alternation inside an unbounded group; no adjacent unbounded
  // quantifiers" — and closed ((a|a))+, (a?a?)+ and a*a*a*a*b, but each
  // check was a single non-recursive scan: containment only fired directly
  // under an unbounded-quantified group, and adjacency ran once over the
  // whole pattern treating every group as opaque. Round 3 (the last five:
  // (a*a*a*a*b) through (a*a*a*b){1,2}) wraps the round-2-safe shape in a
  // plain, unquantified or bounded pair of parens, which both scans missed
  // for different reasons. The fix is structural, not another rule: the
  // pattern is now parsed into its nesting tree and both predicates are
  // evaluated at EVERY node of that tree, so a shape can't hide behind one
  // more pair of parentheses.
  it.each([
    ["(a+)+", /unsafe/i],
    ["(a|a)+", /alternation|quantifier/i],
    ["(a|ab|b)+", /alternation|quantifier/i],
    ["((a|a))+", /alternation|quantifier/i], // alternation nested two levels deep inside the quantified group
    ["(x(a|a))+", /alternation|quantifier/i], // alternation nested inside a quantified group alongside a literal
    ["(a?a?)+", /alternation|quantifier/i], // only bounded `?` quantifiers inside — no `*`/`+` at all
    ["a*a*a*a*b", /unbounded repeat/i], // no groups at all — polynomial blowup from adjacent unbounded quantifiers
    // Round 3: the a*a*a*b shape wrapped in parentheses that carry no
    // quantifier of their own (or a bounded one) — round 2's containment
    // check never applied (the wrapper isn't unbounded-quantified) and its
    // adjacency scan never looked inside a group at all.
    ["(a*a*a*a*b)", /unbounded repeat/i], // wrapped in an unquantified group
    ["(a*a*a*a*a*a*b)", /unbounded repeat/i], // more repeats, same unquantified-wrapper shape — measured ~87s unguarded
    ["((a*a*a*b))", /unbounded repeat/i], // wrapped two unquantified groups deep
    ["(x(a*a*a*b))", /unbounded repeat/i], // nested inside a group alongside a literal
    ["(a*a*a*b){1,2}", /unbounded repeat/i], // wrapper has a BOUNDED quantifier — adjacency still applies inside regardless
    // Round 4: adjacent unbounded Unicode property escapes — the scanner
    // treated `\p{L}` as `\p` (one atom) plus a separate `{L}` (another
    // quantifier-looking atom) until \p{...} was taught as a single atom,
    // so three of them in a row read as six atoms instead of three
    // quantified ones and the a*a*a* shape went unrecognised.
    [String.raw`(\p{L}*\p{L}*\p{L}*b)`, /unbounded repeat/i],
    // Round 5: quantifierAt never consumed a trailing lazy `?`, so
    // `parseAtom` read it as its own literal atom sitting BETWEEN the two
    // unbounded atoms — `a*?a*?b` passed the adjacency check even though
    // it is exactly the a*a*b polynomial-blowup shape with laziness
    // sprinkled on top (measured well over 100s unguarded at the 100-char
    // input cap). Also closes the same hole for \p{...} atoms and for an
    // unbounded quantifier on a group.
    ["a*?a*?b", /unbounded repeat/i],
    ["a*?a*?a*?a*?a*?a*?a*?a*?b", /unbounded repeat/i],
    [String.raw`\p{L}*?\p{L}*?b`, /unbounded repeat/i],
    ["(a)*?(a)*?b", /unbounded repeat/i],
  ])("rejects %s", (pattern, messagePattern) => {
    expect(() => assertSafeRegex(pattern)).toThrow(/unsafe/i);
    expect(() => assertSafeRegex(pattern)).toThrow(messagePattern);
  });

  it.each([
    "\\d{1,5}",
    "[a-z]+",
    "(abc)+",
    "(\\d\\d)+",
    "(cat|dog){1,5}",
    "cat|dog",
    "^(yes|no)$",
    "[0-9]{4}-[0-9]{2}",
    // Realistic fill_blank patterns an author might actually write —
    // re-verified accepted after the round-3 restructure specifically so a
    // tightened rule couldn't silently start refusing them.
    "\\d{3}[- ]?\\d{3}[- ]?\\d{4}", // phone number with optional separators
    "\\d+(\\.\\d+)?", // a number with an optional decimal part
    "(https?://)?example\\.com", // an optional URL scheme
    // Round 4: a single quantified Unicode property escape is fine — only
    // ADJACENT unbounded ones are the danger. Pariksha's whole premise is
    // tests in Telugu and Devanagari, so property escapes must stay usable.
    String.raw`\p{L}+`,
    String.raw`\p{Script=Devanagari}+`,
    String.raw`\p{Script=Telugu}+`,
    // Round 5: a single lazy quantifier is exactly as safe as its greedy
    // form — laziness changes backtracking order, not the adjacency shape
    // that makes a*a*b dangerous. Only ADJACENT unbounded quantifiers
    // (lazy or greedy) are the danger.
    "a*?",
    "(abc)+?",
  ])("accepts %s", (pattern) => {
    expect(() => assertSafeRegex(pattern)).not.toThrow();
  });

  // Round 4, critical: assertSafeRegex judges SAFETY, but never checked
  // VALIDITY — an author's typo passed straight through every structural
  // check (none of them parse regex grammar, only judge the grammar
  // they're given) and then threw a SyntaxError out of matchBlank on every
  // attempt that touched the question.
  it.each([
    "(unclosed", // unterminated group
    "[z-a]", // character class range out of order
    String.raw`\p{Nope}`, // not a real Unicode property name
    "*leading", // quantifier with nothing to quantify
  ])("rejects invalid regex syntax: %s", (pattern) => {
    expect(() => assertSafeRegex(pattern)).toThrow(/invalid|not a valid/i);
  });

  it.each(["(unclosed", "[z-a]", String.raw`\p{Nope}`, "*leading"])(
    "matchBlank never throws on invalid regex syntax, scoring a non-match instead: %s",
    (pattern) => {
      expect(() => matchBlank("abc", { id: "b1", accepted: [pattern], match: "regex" })).not.toThrow();
      expect(matchBlank("abc", { id: "b1", accepted: [pattern], match: "regex" })).toBe(false);
    },
  );

  it("names the construct and the way out in every rejection message", () => {
    // Every rejection should point the author at a fix: bound the repeat,
    // or list the forms in `accepted`.
    for (const pattern of ["(a+)+", "(a|a)+", "(a?a?)+", "a*a*a*a*b", "(a*a*a*a*b)", "a*?a*?b"]) {
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

  // `(`, `?` and `=` as literal members of a character class are not a
  // lookahead: inside `[...]` they are three ordinary characters. The rest
  // of the scanner is already inClass-aware; this check was not.
  it("does not ban (?= , (?! , (?<= or (?<! inside a character class", () => {
    expect(() => assertSafeRegex("[(?=]")).not.toThrow();
    expect(() => assertSafeRegex("[(?!]")).not.toThrow();
    expect(() => assertSafeRegex("x[(?<=]y")).not.toThrow();
    // an escaped `]` inside the class must not end it early
    expect(() => assertSafeRegex("[\\](?=]")).not.toThrow();
  });

  it("still bans a lookaround that follows a character class", () => {
    expect(() => assertSafeRegex("[abc](?=x)")).toThrow(/lookahead|lookbehind/i);
    expect(() => assertSafeRegex("[abc](?<=a)")).toThrow(/lookahead|lookbehind/i);
  });

  // There was a test here asserting that `(a|a)+` — the round-1 bypass — is
  // *slow* when run unguarded, to show the rejection matters. It asserted a
  // lower bound on elapsed time, which measures the machine rather than this
  // code: it took 47ms on a CI runner against a 50ms threshold and failed.
  // A lower-bound timing assertion cannot be made reliable, and it guarded
  // nothing — the rejection itself is asserted above (and in the permitted-
  // subset table), and the danger of the pattern is a fact about V8's
  // backtracking, not about Pariksha. The upper-bound assertion over the
  // accepted set below is the one that protects us, and it is safe because
  // its ceiling sits three orders of magnitude above the real cost.
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
    // A wrapped group (a safe pattern wrapped in an extra, unquantified
    // pair of parens): the round-3 bug class was exactly a group acting as
    // a blind spot, so the regression guard needs a wrapped case of its
    // own, not only the round-3 rejection tests.
    { pattern: "((abc)+)", attack: "abc".repeat(Math.floor(n / 3)) + "x" },
    // Round 5: a lazy quantifier (previously able to hide an adjacent-
    // unbounded shape from the adjacency scan — see the "rejects" cases
    // above) must be exactly as fast as its greedy form once fixed.
    { pattern: "(abc)*?", attack: "abc".repeat(Math.floor((n - 1) / 3)) + "x" },
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

  // A regex blank whose pattern puts `(`, `?` and `=` inside a character
  // class — three literal members, not a lookahead. Four fixtures: correct,
  // partial, wrong, blank.
  it("grades a fill_blank whose regex uses (?= as literal character-class members", () => {
    const q: Question = {
      id: "PUNCT-001",
      type: "fill_blank",
      prompt: "Type any one of ( ? = in {{b1}}, and the answer to 6 x 7 in {{b2}}.",
      blanks: [
        { id: "b1", accepted: ["[(?=]"], match: "regex" },
        { id: "b2", accepted: ["42"], match: "exact" },
      ],
      scoring: { mode: "partial", points: 2 },
    };

    // correct: both blanks right.
    expect(gradeText(q, { kind: "blanks", values: { b1: "?", b2: "42" } }, DEFAULTS).points).toBe(2);

    // partial: the regex blank right, the other left empty.
    const partial = gradeText(q, { kind: "blanks", values: { b1: "(", b2: "" } }, DEFAULTS);
    expect(partial.parts).toEqual({ correct: 1, wrong: 0, total: 2 });
    expect(partial.points).toBe(1);

    // wrong: a character that is not a member of the class.
    const wrong = gradeText(q, { kind: "blanks", values: { b1: "x", b2: "42" } }, DEFAULTS);
    expect(wrong.parts).toEqual({ correct: 1, wrong: 1, total: 2 });
    expect(wrong.points).toBe(0);

    // blank: no response at all.
    expect(gradeText(q, null, DEFAULTS).points).toBe(0);
  });

  it("a blank response scores 0 and never loses points, even under negative mode", () => {
    const negativeDefaults = { mode: "negative" as const, negativeFraction: 0.25 };
    expect(gradeText(QNT_001, null, negativeDefaults).points).toBe(0);
    expect(gradeText(QNT_005, null, negativeDefaults).points).toBe(0);
  });
});
