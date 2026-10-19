// toStoredBody / toTestDocument (#55, P5.2): the pure mapping between a
// `pariksha/test@1` document and the row-id-named shape `test_version`
// stores. No database in the loop — see the header of
// `src/repo/test-document.ts` for why.

import { describe, expect, it } from "vitest";
import type { SourceSets, Test } from "@pariksha/core";
import { toStoredBody, toTestDocument, type IdRefs } from "../../src/repo/test-document.js";
import type { TestRow } from "../../src/repo/tests.js";

// Phase 5 builds no editor for these three blocks (the Architecture
// paragraph's own words); `Test` does not model them, so a fixture that
// carries them for the round-trip test needs its own type rather than
// widening the shared one for a value nothing reads.
type ExtraTest = Test & { proctoring: unknown; consent: unknown; retention: unknown };

function invert(map: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...map.entries()].map(([key, value]) => [value, key]));
}

const questionIdByRef = new Map([
  ["LOG-001", "qst_000000000001"],
  ["LOG-002", "qst_000000000002"],
  ["LOG-003", "qst_000000000003"],
  ["LOG-004", "qst_000000000004"],
  ["LOG-005", "qst_000000000005"],
  ["LOG-006", "qst_000000000006"],
  ["LOG-007", "qst_000000000007"],
  ["LOG-008", "qst_000000000008"],
  ["DIN-001", "qst_000000000009"],
  ["DIN-002", "qst_00000000000a"],
]);
const bankIdByFile = new Map([["questions.json", "bnk_000000000001"]]);

const refs: IdRefs = {
  questionIdByRef,
  refByQuestionId: invert(questionIdByRef),
  bankIdByFile,
  fileByBankId: invert(bankIdByFile),
};

const testRow: TestRow = {
  id: "tst_000000000001",
  slug: "reasoning-aptitude",
  name: "Reasoning and Aptitude Screening",
  description: null,
  shortCode: "abc123",
  status: "draft",
  currentVersion: null,
  reviewRequested: false,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
};

// Mirrors examples/reasoning-aptitude/test.json's sections exactly — a pool,
// a sets and a fixed source, the same fixture the plan's own test bodies
// quote questions from — trimmed to what this file checks and built with a
// bare cast (not a `Test`-typed literal) so `proctoring`/`consent`/
// `retention` do not need a type that was never asked to carry them.
const exampleTest = {
  format: "pariksha/test@1",
  name: testRow.name,
  slug: testRow.slug,
  sections: [
    {
      id: "quant",
      title: "Quantitative aptitude",
      source: { kind: "pool", bank: "questions.json", count: 4, filter: { tags: ["quantitative"] } },
    },
    {
      id: "reasoning",
      title: "Logical reasoning",
      source: {
        kind: "sets",
        assignment: "round_robin",
        sets: [
          { set: "A", questions: ["LOG-001", "LOG-003", "LOG-005", "LOG-007"] },
          { set: "B", questions: ["LOG-002", "LOG-004", "LOG-006", "LOG-008"] },
        ],
      },
    },
    {
      id: "written",
      title: "Data interpretation and written reasoning",
      source: { kind: "fixed", questions: ["DIN-001", "DIN-002"] },
    },
  ],
  proctoring: { profile: "standard" },
  consent: { version: "1", text: "We record your answers and the time you spend on each one." },
  retention: { personal_data_days: 365 },
} as unknown as ExtraTest;

describe("toStoredBody / toTestDocument", () => {
  it("a test document round-trips through the stored body for all three source kinds", () => {
    expect(toTestDocument(testRow, toStoredBody(exampleTest, refs), refs)).toEqual(exampleTest);
  });

  it("sections name qst_ and bnk_ row ids in storage and the bank file's own ids in the document", () => {
    const body = toStoredBody(exampleTest, refs);
    expect(JSON.stringify(body.sections)).toContain("qst_");
    expect(JSON.stringify(body.sections)).not.toContain("LOG-001");
    expect(JSON.stringify(body.sections)).toContain("bnk_");
    expect(JSON.stringify(body.sections)).not.toContain("questions.json");

    const restored = toTestDocument(testRow, body, refs);
    const source = restored.sections[1]?.source as SourceSets;
    expect(source.sets[0]?.questions).toEqual(["LOG-001", "LOG-003", "LOG-005", "LOG-007"]);
  });

  it("a block Phase 5 has no editor for survives the round trip untouched", () => {
    const restored = toTestDocument(testRow, toStoredBody(exampleTest, refs), refs) as ExtraTest;
    expect(restored.proctoring).toEqual(exampleTest.proctoring);
    expect(restored.consent).toEqual(exampleTest.consent);
    expect(restored.retention).toEqual(exampleTest.retention);
  });

  it("a question id with no known row throws rather than storing a silent wrong id", () => {
    expect(() => toStoredBody(exampleTest, { ...refs, questionIdByRef: new Map() })).toThrow(/LOG-001/);
  });
});
