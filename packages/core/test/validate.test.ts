import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateBank, validateTest } from "../src/validate.js";
import type {
  Bank,
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
});
