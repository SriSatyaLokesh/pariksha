import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { BANK_CONVERSION_PROMPT } from "../src/prompt.js";
import { QUESTION_TYPES } from "../src/types.js";
import { validateBank } from "../src/validate.js";
import type { Bank } from "../src/types.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as unknown;
}

const questionSchema = readJson("schemas/question-1.json");
const bankSchema = readJson("schemas/bank-1.json");

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(questionSchema);
const validate = ajv.compile(bankSchema);

describe("BANK_CONVERSION_PROMPT (#178)", () => {
  it("is non-empty and mentions all 12 question types", () => {
    expect(BANK_CONVERSION_PROMPT).toBeDefined();
    expect(typeof BANK_CONVERSION_PROMPT).toBe("string");
    expect(BANK_CONVERSION_PROMPT.length).toBeGreaterThan(100);

    for (const type of QUESTION_TYPES) {
      expect(BANK_CONVERSION_PROMPT).toContain(type);
    }
  });

  it("embeds a valid sample bank that passes schema validation and validateBank", () => {
    const exampleMarker = "Example:\n";
    const exampleIndex = BANK_CONVERSION_PROMPT.indexOf(exampleMarker);
    expect(exampleIndex).toBeGreaterThan(-1);

    const questionsMarker = "\n\nHere are my questions:";
    const questionsIndex = BANK_CONVERSION_PROMPT.indexOf(questionsMarker);
    expect(questionsIndex).toBeGreaterThan(exampleIndex);

    const jsonText = BANK_CONVERSION_PROMPT.slice(exampleIndex + exampleMarker.length, questionsIndex).trim();
    const parsed = JSON.parse(jsonText) as Bank;
    expect(validate(parsed)).toBe(true);
    expect(validate.errors ?? []).toEqual([]);

    const result = validateBank(parsed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bank.questions.length).toBe(12);
    }
  });
});
