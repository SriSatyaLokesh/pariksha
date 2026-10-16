import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validateBank } from "../src/validate.js";
import type { Bank } from "../src/types.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(
    readFileSync(join(repoRoot, relativePath), "utf8"),
  ) as unknown;
}

const badBank = readJson("packages/core/test/fixtures/bad-bank.json");
const exampleBank = readJson("examples/reasoning-aptitude/questions.json");

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
});
