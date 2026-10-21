import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { QUESTION_TYPES } from "../src/types.js";
import { sampleBank } from "../src/sample.js";
import { validateBank } from "../src/validate.js";
import type { Question } from "../src/types.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as unknown;
}

/** Pulls a schema's `properties.<name>.enum` out of the raw JSON Schema file, so assertions compare against the schema itself rather than a hand-copied list. */
function schemaEnum(schemaFile: string, property: string): string[] {
  const schema = readJson(`schemas/${schemaFile}`) as {
    properties?: Record<string, { enum?: string[] }>;
  };
  const values = schema.properties?.[property]?.enum;
  if (!values) throw new Error(`no enum found for "${property}" in ${schemaFile}`);
  return values;
}

const questionSchema = readJson("schemas/question-1.json");
const bankSchema = readJson("schemas/bank-1.json");
const bank = readJson("examples/reasoning-aptitude/questions.json") as { questions: Question[] };

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(questionSchema);
const validate = ajv.compile(bankSchema);

describe("Question and Bank types mirror the schemas", () => {
  it("the example bank satisfies the schema", () => {
    expect(validate(bank)).toBe(true);
  });

  it("every type the example bank uses is a declared type", () => {
    const used = new Set(bank.questions.map((q: Question) => q.type));
    for (const t of used) expect(QUESTION_TYPES).toContain(t);
  });

  it("QUESTION_TYPES lists exactly the 12 types the schema enumerates", () => {
    expect(new Set(QUESTION_TYPES)).toEqual(new Set(schemaEnum("question-1.json", "type")));
    expect(QUESTION_TYPES).toHaveLength(12);
  });
});

// ---------------------------------------------------------------------------
// Phase 6.5e Task 4 (`D18`): the downloadable import sample.
//
// `D18` asks for a sample "generated from schemas/question-1.json, one
// question of every type, so it cannot drift from what the importer
// accepts". The schema's twelve-member `type` enum is the coverage half and
// the per-type `allOf`/`if`-`then` blocks are the shape half; both are
// checked here, against the schema files themselves, by the same Ajv
// instance the example bank above goes through.
//
// Coverage is compared to the schema's OWN enum rather than to the number
// 12 — `AG2`: a gate must not freeze a number it has not proved. A thirteenth
// type in the schema reddens the first test below; the exhaustive
// `Record<QuestionType, …>` in src/sample.ts then refuses to compile until
// that type has an example. "One of every type" on its own would pass for
// twelve near-identical stubs, which is why the second test — the sample
// against the schema's per-type shapes — is the one that makes the first
// mean anything, and why apps/api/test/import/json.test.ts puts the same
// document through the real import route.
describe("the import sample (D18)", () => {
  it("carries one question of every type the schema enumerates", () => {
    const types = sampleBank().questions.map((q) => q.type);
    expect(new Set(types)).toEqual(new Set(schemaEnum("question-1.json", "type")));
    expect(types).toHaveLength(new Set(types).size);
  });

  it("validates against bank-1.json and question-1.json", () => {
    expect(validate(sampleBank())).toBe(true);
    expect(validate.errors ?? []).toEqual([]);
  });

  it("passes the importer's cross-field rules, which no schema can express", () => {
    expect(validateBank(sampleBank())).toEqual({ ok: true, bank: sampleBank() });
  });
});
