import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { unsatisfiableValidation, validateBank, validateTest } from "../src/validate.js";
import type {
  Bank,
  FormField,
  FormFieldType,
  Question,
  ScoringConfig,
  ScoringMode,
  Section,
  Test,
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
});
