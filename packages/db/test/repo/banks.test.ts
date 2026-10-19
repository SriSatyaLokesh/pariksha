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

// Fixture-review finding 1: a `SourcePool` section (packages/core/src/
// types.ts) carries `bank` + `count` + `filter` and no question IDs at
// all — it draws from the whole bank at grading time. A question in a bank
// a published pool section draws from must therefore be reported used and
// refused on delete, even though no section anywhere names its own ID.
describe("pool-sourced usage (fixture-review finding 1)", () => {
  it("usedInTests, the unused filter, deleteQuestion and deleteBank all see a pool-drawn question as used", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "pool-ws", name: "Pool WS" });
    const bank = await repo.createBank(db, ws, { name: "Pool bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);

    // Sanity: before anything is published, the question is unused.
    expect((await repo.getQuestion(db, ws, bank, questionId))!.usedInTests).toBe(0);
    const beforePublish = await repo.listQuestions(db, ws, bank, { unused: true });
    expect(beforePublish.rows.map((r) => r.id)).toContain(questionId);

    const testId = await repo.createTest(db, ws, { slug: "mock-exam", name: "Mock Exam" });
    await repo.publishTestVersion(db, ws, {
      testId,
      version: 1,
      settings: {},
      sections: [{ id: "s1", title: "Pool section", source: { kind: "pool", bank, count: 1 } }],
      now: T,
    });

    const afterPublish = await repo.getQuestion(db, ws, bank, questionId);
    expect(afterPublish!.usedInTests).toBe(1);

    const unusedAfter = await repo.listQuestions(db, ws, bank, { unused: true });
    expect(unusedAfter.rows.map((r) => r.id)).not.toContain(questionId);

    expect(await repo.deleteQuestion(db, ws, bank, questionId)).toEqual({
      deleted: false,
      blockedBy: ["Mock Exam"],
    });
    expect(await repo.deleteBank(db, ws, bank)).toEqual({
      deleted: false,
      blockedBy: ["Mock Exam"],
    });
  });
});

describe("deleteBank (fixture-review finding 5)", () => {
  it("is refused, naming the test, when a published fixed section names one of the bank's questions", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "bank-del-ws", name: "Bank Del WS" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);

    const testId = await repo.createTest(db, ws, { slug: "final", name: "Final" });
    await repo.publishTestVersion(db, ws, {
      testId,
      version: 1,
      settings: {},
      sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [questionId] } }],
      now: T,
    });

    expect(await repo.deleteBank(db, ws, bank)).toEqual({ deleted: false, blockedBy: ["Final"] });
  });

  it("deletes the bank and its questions clean when nothing blocks it", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "bank-del-ws-2", name: "Bank Del WS 2" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    await repo.upsertQuestion(db, ws, bank, singleFixture, T);

    expect(await repo.deleteBank(db, ws, bank)).toEqual({ deleted: true, blockedBy: [] });
    expect(await repo.getBank(db, ws, bank)).toBeNull();
  });
});

describe("toQuestionDocument / toQuestionRow — fixture-review findings 2 and 9", () => {
  it("$schema round-trips rather than being dropped (finding 2)", () => {
    const withSchema: Question = {
      "$schema": "../../schemas/question-1.json",
      ...singleFixture,
      id: "Q-SCHEMA",
    };
    expect(toQuestionDocument(toQuestionRow(withSchema))).toEqual(withSchema);
  });

  // Direct-mapper sanity check only — it does not touch `toQuestionRowView`
  // (packages/db/src/repo/banks.ts), which is what every `GET` actually
  // goes through, and round 2 of fixture review correctly called out an
  // earlier version of this test for stopping here and calling it covered.
  // The real covering test, through `upsertQuestion`/`getQuestion`/
  // `listQuestions`, is below.
  it("direct mapper: a tagless question round-trips with no `tags` key, not `tags: []`", () => {
    const tagless: Question = {
      id: "Q-TAGLESS",
      type: "true_false",
      prompt: "True?",
      key: true,
    };
    expect(tagless.tags).toBeUndefined();
    const roundTripped = toQuestionDocument(toQuestionRow(tagless));
    expect(roundTripped).toEqual(tagless);
    expect(roundTripped.tags).toBeUndefined();
  });
});

describe("a tagless question through the real read path (fixture-review finding 9, round 2)", () => {
  it("getQuestion and listQuestions both answer with no `tags` key, matching what upsertQuestion returned on write", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "tagless-ws", name: "Tagless WS" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });

    const tagless: Question = {
      id: "Q-TAGLESS-DB",
      type: "true_false",
      prompt: "True?",
      key: true,
    };
    const written = await repo.upsertQuestion(db, ws, bank, tagless, T);
    // What the write itself handed back — the baseline every read must match.
    expect(written.row.document.tags).toBeUndefined();

    const read = await repo.getQuestion(db, ws, bank, written.id);
    expect(read!.document.tags).toBeUndefined();
    expect(read!.document).toEqual(tagless);

    const { rows } = await repo.listQuestions(db, ws, bank, {});
    const listed = rows.find((r) => r.id === written.id);
    expect(listed!.document.tags).toBeUndefined();
    expect(listed!.document).toEqual(tagless);
  });
});

describe("listQuestions filters (fixture-review finding 5)", () => {
  const ws = newId("wsp");
  let bank: string;
  let single: string;
  let numeric: string;

  beforeAll(async () => {
    await repo.createWorkspace(db, ws, { slug: "filters-ws", name: "Filters WS" });
    bank = await repo.createBank(db, ws, { name: "Filters bank" });
    single = (
      await repo.upsertQuestion(
        db,
        ws,
        bank,
        {
          id: "F-SINGLE",
          type: "single",
          prompt: "Pick the prime.",
          options: [
            { id: "a", text: "4" },
            { id: "b", text: "5" },
          ],
          key: "b",
          difficulty: "easy",
          tags: ["sdlc/agile"],
        },
        T,
      )
    ).id;
    numeric = (
      await repo.upsertQuestion(
        db,
        ws,
        bank,
        {
          id: "F-NUMERIC",
          type: "numeric",
          prompt: "What is 2 + 2?",
          key: { value: 4 },
          difficulty: "hard",
          tags: ["exam/midterm"],
        },
        T + 1,
      )
    ).id;
  });

  it("filters by type", async () => {
    const { rows } = await repo.listQuestions(db, ws, bank, { type: "numeric" });
    expect(rows.map((r) => r.id)).toEqual([numeric]);
  });

  it("filters by difficulty", async () => {
    const { rows } = await repo.listQuestions(db, ws, bank, { difficulty: "easy" });
    expect(rows.map((r) => r.id)).toEqual([single]);
  });

  it("filters by tag", async () => {
    const { rows } = await repo.listQuestions(db, ws, bank, { tag: "exam/midterm" });
    expect(rows.map((r) => r.id)).toEqual([numeric]);
  });

  it("filters by a search term matched against the prompt", async () => {
    const { rows } = await repo.listQuestions(db, ws, bank, { search: "prime" });
    expect(rows.map((r) => r.id)).toEqual([single]);
  });

  it("the unused filter includes both questions when nothing is published", async () => {
    const { rows } = await repo.listQuestions(db, ws, bank, { unused: true });
    expect(rows.map((r) => r.id).sort()).toEqual([numeric, single].sort());
  });

  it("paginates with a cursor, one question at a time, in creation order", async () => {
    const first = await repo.listQuestions(db, ws, bank, { limit: 1 });
    expect(first.rows.map((r) => r.id)).toEqual([single]);
    expect(first.cursor).toBeDefined();

    const second = await repo.listQuestions(db, ws, bank, { limit: 1, cursor: first.cursor });
    expect(second.rows.map((r) => r.id)).toEqual([numeric]);
    expect(second.cursor).toBeUndefined();
  });
});

describe("listWorkspaceTags", () => {
  it("unions question tags and bank tags, deduplicated and sorted", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "tags-ws", name: "Tags WS" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    await repo.updateBank(db, ws, bank, { tags: ["zzz-bank-tag", "shared-tag"] });
    await repo.upsertQuestion(
      db,
      ws,
      bank,
      { ...singleFixture, id: "T1", tags: ["shared-tag", "aaa-question-tag"] },
      T,
    );

    expect(await repo.listWorkspaceTags(db, ws)).toEqual(["aaa-question-tag", "shared-tag", "zzz-bank-tag"]);
  });
});

// Fix round 1, findings 1+2: import used to write groups through a loop of
// `upsertGroup` calls and *then* the questions through a separate
// `upsertQuestions` batch — if the questions batch failed, every group
// already applied stayed committed. `writeImportedBank` folds both into one
// `db.batch()` call instead. No test anywhere returned after a write
// actually started; this one forces a failure mid-write (a question whose
// ref_id collides with one already in the bank — the exact race a
// concurrent import past `listQuestionRefIds`'s pre-check would hit) and
// asserts nothing landed, groups included.
describe("writeImportedBank (Fix round 1, findings 1+2: atomic across groups and questions)", () => {
  it("rolls back a groups_json merge too when a question statement in the same batch fails", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "atomic-import", name: "Atomic Import" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });

    // A pre-existing group: a wrongly-applied "groups commit regardless"
    // bug would show up as this one being silently replaced, not just as a
    // missing new group.
    await repo.upsertGroup(db, ws, bank, { id: "existing", passage: "Original passage" }, T);

    // Simulates a concurrent import landing first, after this import's own
    // `listQuestionRefIds` pre-check already ran and found nothing — the
    // one case `question_bank_ref_uq` is the real backstop for.
    await repo.upsertQuestion(db, ws, bank, { ...singleFixture, id: "DUP-01" }, T);

    await expect(
      repo.writeImportedBank(
        db,
        ws,
        bank,
        {
          groups: [{ id: "new-group", passage: "New passage" }],
          questions: [
            { ...singleFixture, id: "FRESH-01" },
            { ...singleFixture, id: "DUP-01" }, // collides with the row above
          ],
        },
        T + 1,
      ),
    ).rejects.toThrow(/unique|constraint/i);

    // Nothing from the failed batch landed: no new group, the existing one
    // untouched, and no new question — including FRESH-01, whose own INSERT
    // statement would have succeeded in isolation had the batch not rolled
    // back as a whole.
    const groups = await repo.listGroups(db, ws, bank);
    expect(groups.map((g) => g.id)).toEqual(["existing"]);
    expect(groups.find((g) => g.id === "existing")?.passage).toBe("Original passage");

    const { rows } = await repo.listQuestions(db, ws, bank);
    expect(rows.map((r) => r.refId)).toEqual(["DUP-01"]);
  });

  it("writes every group and every question in one batch when nothing collides", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "clean-import", name: "Clean Import" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    await repo.upsertGroup(db, ws, bank, { id: "existing", passage: "Kept as-is" }, T);

    const { ids } = await repo.writeImportedBank(
      db,
      ws,
      bank,
      {
        groups: [
          { id: "existing", title: "Retitled", passage: "Kept as-is" },
          { id: "new-group", passage: "New" },
        ],
        questions: [
          { ...singleFixture, id: "Q1" },
          { ...singleFixture, id: "Q2" },
        ],
      },
      T + 1,
    );

    expect(ids).toHaveLength(2);
    const groups = await repo.listGroups(db, ws, bank);
    expect(groups.map((g) => g.id).sort()).toEqual(["existing", "new-group"]);
    expect(groups.find((g) => g.id === "existing")?.title).toBe("Retitled");

    const { rows } = await repo.listQuestions(db, ws, bank);
    expect(rows.map((r) => r.refId).sort()).toEqual(["Q1", "Q2"]);
  });
});
