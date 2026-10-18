import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Bank, Question } from "@pariksha/core";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import * as repo from "../../src/repo/index.js";
import { toQuestionDocument, toQuestionRow } from "../../src/repo/question-document.js";

// The example bank "doubles as a worked reference" for all twelve question
// types (its own description says so), which is exactly what the round-trip
// test below needs and packages/core/test/validate.test.ts already leans on
// the same way. Four levels up from this file is the repo root.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const exampleBank = JSON.parse(
  readFileSync(join(repoRoot, "examples/reasoning-aptitude/questions.json"), "utf8"),
) as Bank;

const T = 1_700_000_000_000;

const singleFixture: Question = {
  id: "Q-SINGLE",
  type: "single",
  prompt: "Pick one.",
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  key: "a",
  difficulty: "easy",
  tags: ["demo"],
};

let db: DbClient;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
});

afterAll(() => closeClient(db));

describe("upsertQuestion / getQuestion", () => {
  it("upsertQuestion stores the Markdown document and nothing derived from it", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w1", name: "W1" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });

    const { id } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);
    const row = await repo.getQuestion(db, ws, bank, id);

    expect(row!.document).toEqual(singleFixture);
    expect(Object.keys(row!)).not.toContain("promptHtml");
  });
});

describe("toQuestionDocument / toQuestionRow", () => {
  it("a question document survives the round trip through the row shape, for all 12 types", () => {
    expect(exampleBank.questions.length).toBeGreaterThanOrEqual(12);
    for (const q of exampleBank.questions) {
      expect(toQuestionDocument(toQuestionRow(q))).toEqual(q);
    }
  });

  it("toQuestionRow replaces extra_json rather than merging it", () => {
    const base = { id: "Q1", prompt: "Pick one.", difficulty: "easy" as const, tags: ["t"] };
    const options = [
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ];
    const asSelectK = { ...base, type: "select_k", k: 3, options, key: ["a", "b", "c"] } as Question;
    const asSingle = { ...base, type: "single", options, key: "a" } as Question;

    // Both constructed so a sloppy "merge with the previous row" bug would
    // leak select_k's `k` into single's extra_json — it must not. `single`
    // carries nothing outside the known fields, so its extra_json is empty.
    expect(toQuestionRow(asSelectK).extra_json).toMatchObject({ k: 3 });
    expect(toQuestionRow(asSingle).extra_json).toBeNull();
  });
});

describe("UX-05: deleting a question a published version references", () => {
  it("is refused and names the tests", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w2", name: "W2" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);

    const testId = await repo.createTest(db, ws, { slug: "midterm", name: "Midterm" });
    await repo.publishTestVersion(db, ws, {
      testId,
      version: 1,
      settings: {},
      sections: [
        { id: "s1", title: "Section 1", source: { kind: "fixed", questions: [questionId] } },
      ],
      now: T,
    });

    expect(await repo.deleteQuestion(db, ws, bank, questionId)).toEqual({
      deleted: false,
      blockedBy: ["Midterm"],
    });
  });
});

describe("S-09: workspace isolation", () => {
  it("a bank in another workspace is not found", async () => {
    const wsA = newId("wsp");
    const wsB = newId("wsp");
    await repo.createWorkspace(db, wsA, { slug: "wa", name: "WA" });
    await repo.createWorkspace(db, wsB, { slug: "wb", name: "WB" });
    const bankInB = await repo.createBank(db, wsB, { name: "B's bank" });

    expect(await repo.getBank(db, wsA, bankInB)).toBeNull();
  });
});
