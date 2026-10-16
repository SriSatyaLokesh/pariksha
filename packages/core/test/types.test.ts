import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { QUESTION_TYPES } from "../src/types.js";
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
