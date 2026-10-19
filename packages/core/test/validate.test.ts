import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  allowlistIssues,
  brandColourIssue,
  describeAllowlists,
  invalidCidr,
  invalidDomainGlob,
  timingIssues,
  unsatisfiableValidation,
  validateBank,
  validateTest,
} from "../src/validate.js";
import { NAVIGATION_CONSEQUENCE } from "../src/types.js";
import { EXAMPLE_BRAND_COLOUR } from "../src/contrast.js";
import type {
  Bank,
  FormField,
  FormFieldType,
  Question,
  ScoringConfig,
  ScoringMode,
  Section,
  Test,
  TestTiming,
} from "../src/types.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(join(repoRoot, relativePath), "utf8"),
  ) as unknown;
}

const badBank = readJson("packages/core/test/fixtures/bad-bank.json");
const exampleBank = readJson("examples/reasoning-aptitude/questions.json");
const exampleTest = readJson("examples/reasoning-aptitude/test.json");

describe("validateBank", () => {
  it("AC-05: a bank with one bad key imports nothing and names the question and the reason", () => {
    const oneBadKey: Bank = {
      format: "pariksha/bank@1",
      name: "One bad key",
      questions: [
        { id: "OK-001", type: "true_false", prompt: "True?", key: true },
        { id: "OK-002", type: "true_false", prompt: "True?", key: true },
        { id: "OK-003", type: "true_false", prompt: "True?", key: true },
        { id: "OK-004", type: "true_false", prompt: "True?", key: true },
        { id: "OK-005", type: "true_false", prompt: "True?", key: true },
        {
          id: "LOG-001",
          type: "single",
          prompt: "Pick one.",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          key: "f",
        },
      ],
    };

    const r = validateBank(oneBadKey);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: "LOG-001",
        index: 5,
        field: "key",
        message: expect.stringContaining("not among the options"),
      },
    ]);
  });

  it("reports every issue in the file, not only the first", () => {
    const r = validateBank(badBank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues.length).toBe(12);
  });

  it("rejects a key option ID that is not among the options", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-001",
        field: "key",
        message: expect.stringContaining("not among the options"),
      }),
    );
  });

  it("rejects a select_k whose key length is not k", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({ questionId: "BAD-002", field: "key" }),
    );
  });

  it("rejects a select_k whose k is not less than the number of options", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({ questionId: "BAD-003", field: "k" }),
    );
  });

  it("rejects a matching key using a left item that does not exist", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-004",
        field: "key",
        message: expect.stringContaining("Lx"),
      }),
    );
  });

  it("rejects a matching key using a right item that does not exist", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-005",
        field: "key",
        message: expect.stringContaining("Rx"),
      }),
    );
  });

  it("rejects a matching key reusing one right item twice", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-006",
        field: "key",
        message: expect.stringContaining("used 2 times"),
      }),
    );
  });

  it("rejects a fill_blank placeholder with no blank, and a blank with no placeholder", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-007",
        field: "blanks",
        message: expect.stringContaining("no matching {{b1}}"),
      }),
    );
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-008",
        field: "prompt",
        message: expect.stringContaining("b2"),
      }),
    );
  });

  it("rejects a duplicate question ID and a group reference that does not exist", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "DUP-ID",
        index: 9,
        field: "id",
        message: expect.stringContaining("duplicate"),
      }),
    );
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-010",
        field: "group",
        message: expect.stringContaining("missing-group"),
      }),
    );
  });

  it("rejects a regex blank that assertSafeRegex refuses, quoting its message", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    const issue = r.issues.find((i) => i.questionId === "BAD-011");
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/unsafe regex/i);
    expect(issue?.message).toMatch(/nested|unbounded/i);
  });

  it("rejects a scoring mode that does not apply to the question's type", () => {
    const r = validateBank(badBank);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BAD-012",
        field: "scoring.mode",
        message: expect.stringContaining("ordering"),
      }),
    );
  });

  it("accepts the example bank unchanged", () => {
    const r = validateBank(exampleBank);
    expect(r.ok).toBe(true);
  });

  // Task 9 (#53) review finding, carried over from Task 8: CSV and GIFT use
  // an option's own text as its identity (there is no separate id column in
  // either format — docs/question-format.md, apps/api/src/import/csv.ts's
  // own header comment). Two options sharing text in a `pariksha/bank@1`
  // document — ids distinct, so nothing else here catches it — round-trips
  // through CSV/GIFT with the key silently rebound to whichever option that
  // text's first occurrence lands on. Caught here, in the one place every
  // import format (JSON, CSV, GIFT) already converges on, rather than in a
  // CSV/GIFT *export* mapper: refusing at the gate every format already
  // passes through keeps a colliding bank from ever reaching storage, which
  // closes the hole for every current and future export path at once,
  // instead of re-deriving the same check per converter.
  it("rejects two options sharing text within one question — text is CSV/GIFT's option identity", () => {
    const bank: Bank = {
      format: "pariksha/bank@1",
      name: "Colliding option text",
      questions: [
        {
          id: "COL-001",
          type: "single",
          prompt: "Pick one.",
          options: [
            { id: "o1", text: "X" },
            { id: "o2", text: "X" },
          ],
          key: "o2",
        },
      ],
    };

    const r = validateBank(bank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "COL-001",
        field: "options",
        code: "duplicate_option_text",
        message: expect.stringContaining('"X"'),
      }),
    );
  });

  it("does not reject options with distinct text that merely share a substring", () => {
    const r = validateBank({
      format: "pariksha/bank@1",
      name: "x",
      questions: [
        {
          id: "OK-001",
          type: "single",
          prompt: "Pick one.",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "AB" },
          ],
          key: "a",
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it("does not crash on malformed, non-bank input", () => {
    expect(validateBank(null).ok).toBe(false);
    expect(validateBank({}).ok).toBe(false);
    expect(validateBank("not a bank").ok).toBe(false);
  });

  it("does not crash on a malformed element in questions, and names its index", () => {
    const bank = { format: "pariksha/bank@1", name: "x", questions: [null] };
    expect(() => validateBank(bank)).not.toThrow();
    const r = validateBank(bank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: null,
        index: 0,
        field: "questions",
      }),
    );
  });

  it("does not crash on a malformed element in groups, and names its index", () => {
    const bank = {
      format: "pariksha/bank@1",
      name: "x",
      groups: [null],
      questions: [{ id: "Q1", type: "true_false", prompt: "True?", key: true }],
    };
    expect(() => validateBank(bank)).not.toThrow();
    const r = validateBank(bank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({ questionId: null, index: 0, field: "groups" }),
    );
  });

  it("does not crash on a non-object, non-null element (a string or a number)", () => {
    expect(() =>
      validateBank({
        format: "pariksha/bank@1",
        name: "x",
        questions: ["nope"],
      }),
    ).not.toThrow();
    expect(
      validateBank({
        format: "pariksha/bank@1",
        name: "x",
        questions: ["nope"],
      }).ok,
    ).toBe(false);
    expect(() =>
      validateBank({ format: "pariksha/bank@1", name: "x", questions: [42] }),
    ).not.toThrow();
    expect(
      validateBank({ format: "pariksha/bank@1", name: "x", questions: [42] })
        .ok,
    ).toBe(false);
  });

  it("a well-formed bank still validates clean after the element guard", () => {
    const bank: Bank = {
      format: "pariksha/bank@1",
      name: "x",
      questions: [{ id: "Q1", type: "true_false", prompt: "True?", key: true }],
    };
    expect(validateBank(bank).ok).toBe(true);
  });

  it("an array element in questions does not pass isRecord and does not falsely validate", () => {
    const bank = { format: "pariksha/bank@1", name: "x", questions: [[]] };
    expect(() => validateBank(bank)).not.toThrow();
    const r = validateBank(bank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: null,
        index: 0,
        field: "questions",
      }),
    );
  });

  it("an array element in groups does not pass isRecord and does not falsely validate", () => {
    const bank = {
      format: "pariksha/bank@1",
      name: "x",
      groups: [[]],
      questions: [{ id: "Q1", type: "true_false", prompt: "True?", key: true }],
    };
    expect(() => validateBank(bank)).not.toThrow();
    const r = validateBank(bank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({ questionId: null, index: 0, field: "groups" }),
    );
  });

  it("a null element in options or blanks is reported, not dereferenced", () => {
    const withBadOption = {
      format: "pariksha/bank@1",
      name: "x",
      questions: [
        {
          id: "Q1",
          type: "single",
          prompt: "Pick one.",
          options: [{ id: "a", text: "A" }, null],
          key: "a",
        },
      ],
    };
    expect(() => validateBank(withBadOption)).not.toThrow();
    const r1 = validateBank(withBadOption);
    expect(r1.ok).toBe(false);
    if (r1.ok) throw new Error("expected failure");
    expect(r1.issues).toContainEqual(
      expect.objectContaining({
        questionId: "Q1",
        field: "options",
        message: expect.stringContaining("position 1"),
      }),
    );

    const withBadBlank = {
      format: "pariksha/bank@1",
      name: "x",
      questions: [
        {
          id: "Q2",
          type: "fill_blank",
          prompt: "Answer: {{b1}}.",
          blanks: [{ id: "b1", accepted: ["foo"] }, null],
        },
      ],
    };
    expect(() => validateBank(withBadBlank)).not.toThrow();
    const r2 = validateBank(withBadBlank);
    expect(r2.ok).toBe(false);
    if (r2.ok) throw new Error("expected failure");
    expect(r2.issues).toContainEqual(
      expect.objectContaining({
        questionId: "Q2",
        field: "blanks",
        message: expect.stringContaining("position 1"),
      }),
    );
  });

  it("a null element in matching's left, or select_k's key, is handled without throwing", () => {
    const matchingBank = {
      format: "pariksha/bank@1",
      name: "x",
      questions: [
        {
          id: "Q1",
          type: "matching",
          prompt: "Match.",
          left: ["L1", null],
          right: ["R1", "R2"],
          key: { L1: "R1" },
        },
      ],
    };
    // A stray null in `left` is not dereferenced (it just never matches a
    // `key` entry), so this may or may not raise an issue of its own — the
    // only hard requirement is that it never throws.
    expect(() => validateBank(matchingBank)).not.toThrow();

    const selectKBank = {
      format: "pariksha/bank@1",
      name: "x",
      questions: [
        {
          id: "Q2",
          type: "select_k",
          prompt: "Pick two.",
          k: 2,
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
            { id: "c", text: "C" },
          ],
          key: ["a", null],
        },
      ],
    };
    expect(() => validateBank(selectKBank)).not.toThrow();
    expect(validateBank(selectKBank).ok).toBe(false);
  });

  it("a question that trips the structural backstop still leaves the other questions' issues reported", () => {
    const bank = {
      format: "pariksha/bank@1",
      name: "x",
      questions: [
        // options is not an array at all: bypasses the options/blanks
        // element guards entirely and throws inside the "single" case
        // (`.some` on null), which only the try/catch backstop can catch.
        {
          id: "BACKSTOP",
          type: "single",
          prompt: "Pick one.",
          options: null,
          key: "a",
        },
        // An ordinary, independent rule violation on a second question.
        {
          id: "ALSO-BAD",
          type: "single",
          prompt: "Pick one.",
          options: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          key: "z",
        },
      ],
    };
    expect(() => validateBank(bank)).not.toThrow();
    const r = validateBank(bank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "BACKSTOP",
        index: 0,
        field: "question",
      }),
    );
    expect(r.issues).toContainEqual(
      expect.objectContaining({
        questionId: "ALSO-BAD",
        index: 1,
        field: "key",
      }),
    );
  });

  it("the real example bank still validates clean, and bad-bank.json still reports exactly 12", () => {
    expect(validateBank(exampleBank).ok).toBe(true);
    const r = validateBank(badBank);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues.length).toBe(12);
  });
});

// --- validateTest -------------------------------------------------------

function ordering(id: string, points: number, mode?: ScoringMode): Question {
  const scoring: ScoringConfig =
    mode === undefined ? { points } : { mode, points };
  return {
    id,
    type: "ordering",
    prompt: "Put these in order.",
    items: ["a", "b", "c"],
    scoring,
  };
}

function trueFalse(id: string, points: number, tags?: string[]): Question {
  const base = {
    id,
    type: "true_false" as const,
    prompt: "True?",
    key: true,
    scoring: { points },
  };
  return tags === undefined ? base : { ...base, tags };
}

function doc(over: Partial<Test>): Test {
  return {
    format: "pariksha/test@1",
    name: "A test",
    slug: "a-test",
    sections: [],
    ...over,
  };
}

function fixedSection(id: string, questions: string[]): Section {
  return { id, title: id, source: { kind: "fixed", questions } };
}

describe("validateTest", () => {
  it("rejects a test whose scoring.default_mode does not apply to a type a section draws", () => {
    const bank = [ordering("ORD-001", 2), ordering("ORD-002", 2)];
    const r = validateTest(
      doc({
        scoring: { default_mode: "partial" },
        sections: [fixedSection("s1", ["ORD-001", "ORD-002"])],
      }),
      bank,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: "ORD-001",
        index: 0,
        field: "scoring.default_mode",
        message: expect.stringContaining("does not apply"),
      },
      {
        questionId: "ORD-002",
        index: 0,
        field: "scoring.default_mode",
        message: expect.stringContaining("does not apply"),
      },
    ]);
  });

  it("ignores the test default for a question that sets its own scoring.mode", () => {
    const bank = [ordering("ORD-001", 2, "position")];
    const r = validateTest(
      doc({
        scoring: { default_mode: "partial" },
        sections: [fixedSection("s1", ["ORD-001"])],
      }),
      bank,
    );
    expect(r.ok).toBe(true);
  });

  it("checks the default against every type a pool section can draw, not only the fixed ones", () => {
    const bank = [ordering("ORD-001", 2), ordering("ORD-002", 2)];
    const r = validateTest(
      doc({
        scoring: { default_mode: "partial" },
        sections: [
          { id: "s1", title: "Pool", source: { kind: "pool", count: 1 } },
        ],
      }),
      bank,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual(
      expect.objectContaining({ field: "scoring.default_mode" }),
    );
  });

  it("reports a pool whose filter matches fewer questions than count", () => {
    const bank = [trueFalse("TF-001", 1, ["quant"]), trueFalse("TF-002", 1)];
    const r = validateTest(
      doc({
        sections: [
          {
            id: "s1",
            title: "Pool",
            source: { kind: "pool", count: 3, filter: { tags: ["quant"] } },
          },
        ],
      }),
      bank,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: null,
        index: 0,
        field: "source.count",
        message: expect.stringContaining("1"),
      },
    ]);
  });

  it("reports sets whose total points differ", () => {
    const bank = [
      trueFalse("TF-001", 2),
      trueFalse("TF-002", 2),
      trueFalse("TF-003", 1),
      trueFalse("TF-004", 2),
    ];
    const r = validateTest(
      doc({
        sections: [
          {
            id: "s1",
            title: "Sets",
            source: {
              kind: "sets",
              sets: [
                { set: "A", questions: ["TF-001", "TF-002"] },
                { set: "B", questions: ["TF-003", "TF-004"] },
              ],
            },
          },
        ],
      }),
      bank,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: null,
        index: 0,
        field: "source.sets",
        message: expect.stringContaining("total points"),
      },
    ]);
  });

  it("tolerates set-points drift up to setPointsTolerance", () => {
    const bank = [
      trueFalse("TF-001", 2),
      trueFalse("TF-002", 2),
      trueFalse("TF-003", 1),
      trueFalse("TF-004", 2),
    ];
    const test = doc({
      sections: [
        {
          id: "s1",
          title: "Sets",
          source: {
            kind: "sets",
            sets: [
              { set: "A", questions: ["TF-001", "TF-002"] },
              { set: "B", questions: ["TF-003", "TF-004"] },
            ],
          },
        },
      ],
    });
    expect(validateTest(test, bank, { setPointsTolerance: 1 }).ok).toBe(true);
    expect(validateTest(test, bank, { setPointsTolerance: 0.5 }).ok).toBe(false);
  });

  // Task 4 (#56, P5.3): the tolerance has a home in the document itself
  // (`scoring.set_points_tolerance`), so an organiser who accepted some
  // drift still has it accepted when the file is exported and imported
  // somewhere else. The caller's own option still wins where it is given —
  // the publish gate may be stricter than the file asks for.
  it("reads the tolerance from the document's own scoring.set_points_tolerance", () => {
    const bank = [
      trueFalse("TF-001", 2),
      trueFalse("TF-002", 2),
      trueFalse("TF-003", 1),
      trueFalse("TF-004", 2),
    ];
    const sections = [
      {
        id: "s1",
        title: "Sets",
        source: {
          kind: "sets" as const,
          sets: [
            { set: "A", questions: ["TF-001", "TF-002"] },
            { set: "B", questions: ["TF-003", "TF-004"] },
          ],
        },
      },
    ];

    // The document asks for a tolerance of 1, and the 1-point drift passes.
    expect(validateTest(doc({ scoring: { set_points_tolerance: 1 }, sections }), bank).ok).toBe(true);
    // The same document without the field keeps the strict default of 0.
    expect(validateTest(doc({ sections }), bank).ok).toBe(false);
    // An explicit option still overrides the document, in both directions.
    expect(
      validateTest(doc({ scoring: { set_points_tolerance: 1 }, sections }), bank, { setPointsTolerance: 0 }).ok,
    ).toBe(false);
    expect(validateTest(doc({ sections }), bank, { setPointsTolerance: 1 }).ok).toBe(true);
  });

  it('reports release.when "on_date" with no at', () => {
    const r = validateTest(doc({ release: { when: "on_date" } }), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: null,
        index: -1,
        field: "release.at",
        message: expect.stringContaining("on_date"),
      },
    ]);
  });

  it('reports access mode "link_code" with no access_code', () => {
    const r = validateTest(doc({ access: { mode: "link_code" } }), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: null,
        index: -1,
        field: "access.access_code",
        message: expect.stringContaining("link_code"),
      },
    ]);
  });

  it("reports a question ID a section names that is not in the banks", () => {
    const r = validateTest(doc({ sections: [fixedSection("s1", ["NOPE"])] }), [
      trueFalse("TF-001", 1),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: "NOPE",
        index: 0,
        field: "source.questions",
        message: expect.stringContaining("not in the bank"),
      },
    ]);
  });

  it("reports every issue in the test, not only the first", () => {
    const bank = [ordering("ORD-001", 2)];
    const r = validateTest(
      doc({
        access: { mode: "link_code" },
        release: { when: "on_date" },
        scoring: { default_mode: "partial" },
        sections: [
          fixedSection("s1", ["ORD-001"]),
          { id: "s2", title: "Pool", source: { kind: "pool", count: 9 } },
        ],
      }),
      bank,
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues.map((i) => i.field).sort()).toEqual([
      "access.access_code",
      "release.at",
      "scoring.default_mode",
      "scoring.default_mode",
      "source.count",
    ]);
  });

  it("degrades safely when sections is not an array", () => {
    expect(() => validateTest({ format: "pariksha/test@1" }, [])).not.toThrow();
    const r = validateTest({ format: "pariksha/test@1" }, []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toEqual([
      {
        questionId: null,
        index: -1,
        field: "sections",
        message: "test.sections must be an array",
      },
    ]);
  });

  it("the worked example test validates clean against its own bank", () => {
    const r = validateTest(exampleTest, (exampleBank as Bank).questions);
    if (!r.ok) throw new Error(JSON.stringify(r.issues, null, 2));
    expect(r.ok).toBe(true);
  });

  // --- Task 5 (#57, P5.4): the registration form ------------------------

  function field(over: Partial<FormField> & { id: string; type: FormFieldType }): FormField {
    return { label: over.label ?? "A field", ...over };
  }

  function withForm(fields: FormField[]): Test {
    return doc({ registration_form: { fields } });
  }

  it("duplicate form field ids are reported with the field named", () => {
    const r = validateTest(
      withForm([
        field({ id: "email", type: "email" }),
        field({ id: "phone", type: "phone" }),
        field({ id: "email", type: "short_text" }),
      ]),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({
      field: "registration_form.fields",
      index: -1,
      message: expect.stringMatching(/"email".*more than once/),
    });
    // Reported once, however many times the id repeats — three `email`
    // fields is one defect, not two.
    expect(r.issues.filter((i) => /more than once/.test(i.message))).toHaveLength(1);
  });

  it("duplicate section ids are reported", () => {
    const r = validateTest(
      doc({ sections: [fixedSection("quant", []), fixedSection("quant", [])] }),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues).toContainEqual({
      questionId: null,
      index: -1,
      field: "sections",
      message: 'section id "quant" is used more than once',
    });
  });

  it("an options list on a short_text field is reported", () => {
    const r = validateTest(
      withForm([field({ id: "name", type: "short_text", options: ["a", "b"] })]),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({
      field: "registration_form.fields",
      message: expect.stringMatching(/"name".*short_text.*cannot carry an options list/),
    });
  });

  it("a dropdown with fewer than two options is reported", () => {
    // The other half of the rule above, and the publish-time replacement
    // for the schema floor `draftSchema()` drops so a choice field can be
    // saved while its options are still being typed.
    const r = validateTest(withForm([field({ id: "degree", type: "dropdown", options: ["B.Tech"] })]), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({
      field: "registration_form.fields",
      message: expect.stringMatching(/"degree".*at least two options/),
    });
  });

  it("min above max is reported, with the field id in the message", () => {
    const r = validateTest(
      withForm([field({ id: "cgpa", type: "number", validation: { min: 10, max: 5 } })]),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({
      field: "registration_form",
      message: expect.stringMatching(/"cgpa".*minimum 10 is above maximum 5/),
    });
  });

  it("max_length below min_length is reported", () => {
    const r = validateTest(
      withForm([field({ id: "name", type: "short_text", validation: { min_length: 10, max_length: 5 } })]),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]?.message).toMatch(/minimum length 10 is above maximum length 5/);
  });

  it("a number min against a date-shaped max is not compared", () => {
    // `min`/`max` are `number | string` in the schema; comparing 5 against
    // "2010-12-31" would report a defect that is not one.
    expect(
      validateTest(withForm([field({ id: "x", type: "number", validation: { min: 5, max: "2010-12-31" } })]), []).ok,
    ).toBe(true);
  });

  it("a date max below its min is reported, comparing the ISO strings", () => {
    const r = validateTest(
      withForm([field({ id: "dob", type: "date", validation: { min: "2010-01-01", max: "2000-01-01" } })]),
      [],
    );
    expect(r.ok).toBe(false);
  });

  it("unsatisfiableValidation is the one copy of the rule the builder also shows", () => {
    expect(unsatisfiableValidation({ id: "a", type: "number", label: "A", validation: { min: 10, max: 5 } })).toMatch(
      /minimum 10 is above maximum 5 — lower the minimum/,
    );
    expect(unsatisfiableValidation({ id: "a", type: "number", label: "A", validation: { min: 1, max: 5 } })).toBeNull();
    expect(unsatisfiableValidation({ id: "a", type: "number", label: "A" })).toBeNull();
  });

  // task 5/6 review, M3: #57's acceptance row names two unsatisfiable
  // shapes — "min above max, a regex matching nothing allowed" — and only
  // the first had shipped. `assertSafeRegex` was exported from this package
  // for the second and nothing acted on what it threw.
  it("an unsafe or unparseable pattern is unsatisfiable too, in the builder's own words", () => {
    const pattern = (p: string): string | null =>
      unsatisfiableValidation({ id: "roll", type: "short_text", label: "R", validation: { pattern: p } });

    expect(pattern("([a-z]+)+$")).toMatch(
      /^pattern "\(\[a-z\]\+\)\+\$" cannot be used — a group with an unbounded repeat/,
    );
    // The lesser variant: an unparseable pattern makes the field's format
    // rule silently inert rather than slow.
    expect(pattern("(unclosed")).toMatch(/is not a valid regular expression/);
    // A pattern the renderer will actually run is not reported.
    expect(pattern("^[0-9]{2}[A-Z]{2}[0-9]{4}$")).toBeNull();
    // And the sentence never offers `accepted` — that is a grading list of
    // whole answers, and a registration field has none to put it in.
    expect(pattern("(a)\\1")).toMatch(/backreferences/);
    expect(pattern("(a)\\1")).not.toMatch(/accepted/);
  });

  it("an unsafe pattern is refused at publish, with the field id in the message", () => {
    const r = validateTest(
      withForm([field({ id: "roll_number", type: "short_text", validation: { pattern: "([a-z]+)+$" } })]),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({
      field: "registration_form",
      message: expect.stringMatching(/"roll_number": pattern .* cannot be used/),
    });
  });

  // --- Task 7 (#59, P5.6): timing -------------------------------------

  const WINDOW: TestTiming = {
    timezone: "Asia/Kolkata",
    opens_at: "2026-11-14T09:00:00+05:30",
    closes_at: "2026-11-14T13:00:00+05:30",
    duration_minutes: 60,
  };

  /** Sections carrying only `time_limit_minutes`, which is all the
   * duration rule reads; an empty `fixed` source keeps every other rule
   * silent so a failure here can only be the timing one. */
  function timed(...minutes: (number | undefined)[]): Section[] {
    return minutes.map((m, i) => ({
      id: `s${i + 1}`,
      title: `Section ${i + 1}`,
      source: { kind: "fixed" as const, questions: [] },
      ...(m === undefined ? {} : { time_limit_minutes: m }),
    }));
  }

  it("a window that ends before it opens is reported on closes_at", () => {
    const r = validateTest(
      doc({ timing: { ...WINDOW, opens_at: "2026-11-14T13:00:00+05:30", closes_at: "2026-11-14T09:00:00+05:30" } }),
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({ field: "timing.closes_at", index: -1, questionId: null });
  });

  it("a window that closes at the instant it opens is reported too — after, not at", () => {
    const at = "2026-11-14T09:00:00+05:30";
    expect(validateTest(doc({ timing: { ...WINDOW, opens_at: at, closes_at: at } }), []).ok).toBe(false);
  });

  it("a latest_start_at outside the window is reported, on either side", () => {
    const early = validateTest(doc({ timing: { ...WINDOW, latest_start_at: "2026-11-14T08:00:00+05:30" } }), []);
    expect(early.ok).toBe(false);
    if (early.ok) throw new Error("expected failure");
    expect(early.issues[0]).toMatchObject({ field: "timing.latest_start_at" });
    expect(early.issues[0]?.message).toMatch(/before the window opens/);

    const late = validateTest(doc({ timing: { ...WINDOW, latest_start_at: "2026-11-14T18:00:00+05:30" } }), []);
    expect(late.ok).toBe(false);
    if (late.ok) throw new Error("expected failure");
    expect(late.issues[0]?.message).toMatch(/after the window closes/);
  });

  it("a latest_start_at inside the window is clean", () => {
    expect(validateTest(doc({ timing: { ...WINDOW, latest_start_at: "2026-11-14T12:00:00+05:30" } }), []).ok).toBe(
      true,
    );
  });

  it("per-section durations summing above the overall duration are reported with both numbers", () => {
    const r = validateTest(doc({ timing: { duration_minutes: 60 }, sections: timed(40, 30) }), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({
      field: "timing.duration_minutes",
      message: expect.stringMatching(/sections total 70 minutes against an overall 60/),
    });
    expect(r.issues[0]?.message).toMatch(/raise the duration or shorten a section/);
  });

  it("sections with no time limit do not count toward the sum", () => {
    expect(validateTest(doc({ timing: { duration_minutes: 60 }, sections: timed(45, undefined) }), []).ok).toBe(true);
  });

  it("a per-section sum equal to the overall duration is allowed", () => {
    expect(validateTest(doc({ timing: { duration_minutes: 60 }, sections: timed(30, 30) }), []).ok).toBe(true);
  });

  it("an unparseable timestamp is its own issue, never compared as NaN", () => {
    const r = validateTest(doc({ timing: { ...WINDOW, closes_at: "next Tuesday" } }), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    // One issue, not two: the window comparison is withheld rather than
    // silently passing, because every comparison against NaN is false.
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ field: "timing.closes_at" });
    expect(r.issues[0]?.message).toMatch(/is not a date and time/);
  });

  it("a half-set window is not an issue — publish-time means the draft stays savable", () => {
    expect(validateTest(doc({ timing: { duration_minutes: 60, opens_at: "2026-11-14T09:00:00+05:30" } }), []).ok).toBe(
      true,
    );
    expect(validateTest(doc({}), []).ok).toBe(true);
  });

  it("timingIssues is the one copy of the rules the builder also shows", () => {
    expect(timingIssues(undefined, [])).toEqual([]);
    expect(timingIssues({ duration_minutes: 30 }, timed(45))).toEqual([
      {
        field: "timing.duration_minutes",
        message: "sections total 45 minutes against an overall 30 — raise the duration or shorten a section",
      },
    ]);
  });

  it("NAVIGATION_CONSEQUENCE states a consequence for each of the three modes", () => {
    expect(Object.keys(NAVIGATION_CONSEQUENCE)).toEqual(["free", "linear", "per_section"]);
    expect(NAVIGATION_CONSEQUENCE.linear).toBe("A candidate cannot go back to an earlier question.");
  });

  it("the worked example still validates clean, timing and all", () => {
    expect(validateTest(exampleTest, (exampleBank as Bank).questions).ok).toBe(true);
  });
  // --- Task 8 (#60, P5.7): access modes and allowlists ------------------

  it.each([
    "10.0.0.0/24",
    "0.0.0.0/8",
    "192.168.1.0/32",
    "10.0.0.1/24",
    "2001:db8::/32",
    // Uppercase hex is the same address. The RFC's own documentation
    // prefix is written this way, and so is most ISP allocation paperwork.
    "2001:DB8::/32",
    "FE80::/10",
    "::/128",
    "fd00:0:0:0:0:0:0:1/128",
  ])("accepts the CIDR range %s", (range) => {
    expect(invalidCidr(range)).toBeNull();
  });

  it.each([
    ["10.0.0.0/64", /prefix length above 32/],
    ["2001:db8::/129", /prefix length above 128/],
    // `/0` is the CIDR spelling of `*`: a restriction on the screen that
    // restricts nothing. The third is the one that actually happens — a
    // typo for `/8`.
    ["0.0.0.0/0", /matches every address, which is not an allowlist/],
    ["::/0", /matches every address, which is not an allowlist/],
    ["10.0.0.0/0", /matches every address, which is not an allowlist/],
    ["10.0.0.0", /has no prefix length/],
    ["10.0.0.0/24/8", /has no prefix length/],
    ["10.0.0.0/", /not a plain number/],
    ["10.0.0.0/+8", /not a plain number/],
    ["10.0.0.0/0x8", /not a plain number/],
    ["10.0.0.256/24", /not an IPv4 address/],
    ["010.0.0.1/24", /no leading zeros/],
    ["10.0.0/24", /not an IPv4 address/],
    ["10.0.0.0.0/24", /not an IPv4 address/],
    ["not-an-address/24", /not an IPv4 address/],
    ["2001:db8:::1/32", /not an IPv6 address/],
    // Two `::` runs: the address is ambiguous, and this one has exactly
    // eight groups, so only the "at most one run" rule refuses it.
    ["1:2::3:4::5:6:7:8/64", /not an IPv6 address/],
    ["1:2:3:4:5:6:7/64", /not an IPv6 address/],
    ["1:2:3:4:5:6:7:8:9/64", /not an IPv6 address/],
    ["2001:dg8::/32", /not an IPv6 address/],
    ["fe80::1%eth0/64", /not an IPv6 address/],
    ["::ffff:10.0.0.1/96", /not an IPv6 address/],
    [" 10.0.0.0/24", /not a network range/],
    ["", /not a network range/],
  ])("refuses the CIDR range %s, saying what a correct one looks like", (range, why) => {
    const message = invalidCidr(range);
    expect(message).toMatch(why);
    expect(message).toMatch(/for example 10\.0\.0\.0\/24/);
  });

  it.each(["ac.in", "*.ac.in", "iitb.ac.in", "*.co.uk", "XN--P1AI.ru", "Example.COM"])(
    "accepts the email domain %s",
    (glob) => {
      expect(invalidDomainGlob(glob)).toBeNull();
    },
  );

  it.each([
    ["*", /matches every domain, which is not an allowlist/],
    ["*.*", /matches every domain, which is not an allowlist/],
    ["*.in", /every domain under one top level/],
    ["*.com", /every domain under one top level/],
    ["in", /single label, not a domain/],
    ["ac.*.in", /somewhere other than the front/],
    ["*ac.in", /somewhere other than the front/],
    [".ac.in", /is not a domain/],
    ["ac.in.", /is not a domain/],
    ["-ac.in", /is not a domain/],
    ["ac-.in", /is not a domain/],
    ["ac .in", /is not a domain/],
    ["ac.भारत", /is not a domain/],
    ["user@ac.in", /is not a domain/],
    [" ac.in", /is not a domain/],
    ["", /is not a domain/],
  ])("refuses the email domain %s, saying what a correct one looks like", (glob, why) => {
    const message = invalidDomainGlob(glob);
    expect(message).toMatch(why);
    expect(message).toMatch(/for example ac\.in or \*\.ac\.in/);
  });

  it("allowlistIssues names the field each bad entry sits in, and reports every one", () => {
    expect(
      allowlistIssues({ mode: "sso", allow_ip_ranges: ["10.0.0.0/64", "10.0.0.0/24"], allow_email_domains: ["*"] }),
    ).toEqual([
      { field: "access.allow_ip_ranges", message: expect.stringContaining("10.0.0.0/64") },
      { field: "access.allow_email_domains", message: expect.stringContaining("every domain") },
    ]);
    expect(allowlistIssues(undefined)).toEqual([]);
    expect(allowlistIssues({ mode: "sso" })).toEqual([]);
  });

  it("a malformed allowlist entry is an issue on the whole document", () => {
    const r = validateTest(doc({ access: { mode: "sso", allow_ip_ranges: ["10.0.0.0/64"] } }), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({ field: "access.allow_ip_ranges", index: -1, questionId: null });
  });

  // --- Task 10 (#61, P5.8), task 7/8/10 review M7 ----------------------

  it("an unreadable brand colour is an issue on the whole document, not only on the two PATCH routes", () => {
    const r = validateTest(doc({ branding: { primary_colour: "#f59a6e" } }), []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("expected failure");
    expect(r.issues[0]).toMatchObject({ field: "branding.primary_colour", index: -1, questionId: null });
    // The number the two routes report, so import and publish cannot word
    // the same refusal differently.
    expect(r.issues[0]?.message).toBe(
      "#f59a6e reaches only 2.09:1 against cream, and candidate text in the brand colour needs at least 4.5:1.",
    );
  });

  it("brandColourIssue refuses a non-colour with an example, and passes a readable one", () => {
    expect(brandColourIssue({ primary_colour: "rebeccapurple" })).toEqual({
      field: "branding.primary_colour",
      message: "rebeccapurple is not a colour; use a hex value like #b63a10.",
    });
    expect(brandColourIssue({ primary_colour: EXAMPLE_BRAND_COLOUR })).toBeNull();
    expect(brandColourIssue({ footer_text: "x" })).toBeNull();
    expect(brandColourIssue(undefined)).toBeNull();
  });

  it("describeAllowlists states the combined effect in plain words", () => {
    expect(
      describeAllowlists({ mode: "sso", allow_email_domains: ["*.ac.in"], allow_ip_ranges: ["10.0.0.0/24"] }),
    ).toBe("Only addresses matching *.ac.in, and only from 10.0.0.0/24.");
    expect(describeAllowlists({ mode: "link_code", access_code: "X" })).toBe("Anyone with the link and the code.");
    expect(describeAllowlists({ mode: "sso", allow_email_domains: ["*.ac.in", "*.edu.in"] })).toBe(
      "Only addresses matching *.ac.in or *.edu.in.",
    );
    expect(describeAllowlists({ mode: "invite_only", allow_ip_ranges: ["10.0.0.0/24"] })).toBe(
      "Only from 10.0.0.0/24.",
    );
  });

  it("describeAllowlists never answers with a blank for an unrestricted mode", () => {
    for (const mode of ["link_code", "invite_only", "email_code", "sso"] as const) {
      expect(describeAllowlists({ mode })).toMatch(/^Anyone .+\.$/);
    }
  });

  // Task 5/6 review, M4. `draftSchema()` strips every `minLength` by
  // keyword, which took `$defs/access.access_code`'s `minLength: 4` — a
  // floor that bounds a *value*, not emptiness-while-typing — and nothing
  // replaced it, so a one-character code was publishable.
  it("an access_code shorter than four characters is reported at publish, not only an absent one", () => {
    const short = validateTest(doc({ access: { mode: "link_code", access_code: "X" } }), []);
    expect(short.ok).toBe(false);
    if (short.ok) throw new Error("expected failure");
    expect(short.issues[0]).toMatchObject({ field: "access.access_code" });
    expect(short.issues[0]?.message).toMatch(/at least 4 characters; "X" is 1/);

    expect(validateTest(doc({ access: { mode: "link_code", access_code: "   " } }), []).ok).toBe(false);
    expect(validateTest(doc({ access: { mode: "link_code", access_code: "APTI-2026" } }), []).ok).toBe(true);
    // Only under link_code: the code means nothing under the other three.
    expect(validateTest(doc({ access: { mode: "sso", access_code: "X" } }), []).ok).toBe(true);
  });
});
