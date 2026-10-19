// Test CRUD, IDs, slugs, short links (#54, P5.1).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Question } from "@pariksha/core";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import * as repo from "../../src/repo/index.js";
import { resolveShortCode } from "../../src/repo/shortlink.js";

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

/** Writes straight into the draft row `createTest` already minted, naming
 * `questionId` in a `fixed` section — the fixture shape Task 3's
 * `putDraftVersion` will later own, stood in for here with a raw write so
 * this task's own fix (Review Focus 1) can be driven without building that
 * task's feature. */
async function draftNaming(workspaceId: string, testId: string, questionId: string): Promise<void> {
  await db.run(
    "UPDATE test_version SET sections_json = ? WHERE workspace_id = ? AND test_id = ? AND published_at IS NULL",
    [
      db.jsonParam([{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [questionId] } }]),
      workspaceId,
      testId,
    ],
  );
}

describe("createTest", () => {
  it("T-01: a new test gets a tst_ id, a draft status and a 6-character short code", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w1", name: "W1" });

    const row = await repo.createTest(db, ws, { name: "Midterm", slug: "midterm" });
    expect(row.id).toMatch(/^tst_/);
    expect(row.status).toBe("draft");
    expect(row.currentVersion).toBeNull();
    expect(row.reviewRequested).toBe(false);
    expect(row.shortCode).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
  });

  it("AC-02: three tests get three distinct ids and three distinct short codes", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w2", name: "W2" });

    const rows = await Promise.all(
      ["a", "b", "c"].map((slug) => repo.createTest(db, ws, { name: slug, slug })),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(new Set(rows.map((r) => r.shortCode)).size).toBe(3);
  });

  it("AC-02: a duplicate slug in the same workspace is rejected", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w3", name: "W3" });
    await repo.createTest(db, ws, { name: "A", slug: "midterm" });

    await expect(repo.createTest(db, ws, { name: "B", slug: "midterm" })).rejects.toThrow(
      /unique|constraint/i,
    );
  });

  it("the same slug in another workspace is accepted", async () => {
    const wsA = newId("wsp");
    const wsB = newId("wsp");
    await repo.createWorkspace(db, wsA, { slug: "w4a", name: "W4A" });
    await repo.createWorkspace(db, wsB, { slug: "w4b", name: "W4B" });
    await repo.createTest(db, wsA, { name: "A", slug: "shared" });

    await expect(repo.createTest(db, wsB, { name: "B", slug: "shared" })).resolves.toMatchObject({
      slug: "shared",
    });
  });

  it("creates the test row and its draft version 1 together, so a test is never a row with no document", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w5", name: "W5" });
    const row = await repo.createTest(db, ws, { name: "A", slug: "a5" });

    const drafts = await repo.draftVersionsByTest(db, ws, row.id);
    expect(drafts.get(row.id)).toBe(1);
  });
});

describe("updateTest", () => {
  it("T-01: the slug is editable while current_version is null and refused once it is set", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w6", name: "W6" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a6" });

    expect(await repo.updateTest(db, ws, created.id, { slug: "renamed" }, T)).toMatchObject({
      slug: "renamed",
    });

    // Version 1 is the draft `createTest` already wrote; publishing a fresh
    // version (2) is what sets `current_version` and locks the slug.
    await repo.publishTestVersion(db, ws, {
      testId: created.id,
      version: 2,
      settings: {},
      sections: [],
      now: T,
    });

    await expect(
      repo.updateTest(db, ws, created.id, { slug: "again" }, T),
    ).rejects.toThrow(/published/i);
  });

  it("S-09: a test in another workspace is not found", async () => {
    const wsA = newId("wsp");
    const wsB = newId("wsp");
    await repo.createWorkspace(db, wsA, { slug: "w7a", name: "W7A" });
    await repo.createWorkspace(db, wsB, { slug: "w7b", name: "W7B" });
    const testInB = await repo.createTest(db, wsB, { name: "B", slug: "b7" });

    expect(await repo.getTest(db, wsA, testInB.id)).toBeNull();
  });
});

describe("resolveShortCode", () => {
  it("answers the workspace and test slug, and null for an unknown code", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w8", name: "W8" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a8" });

    expect(await resolveShortCode(db, created.shortCode)).toEqual({
      workspaceSlug: "w8",
      testSlug: "a8",
    });
    expect(await resolveShortCode(db, "zzzzzz")).toBeNull();
  });
});

// Review Focus 1: `TV_REFERENCES_Q_ROW` and its two callers
// (packages/db/src/repo/banks.ts) now filter on `published_at`, so a draft
// `test_version` — the kind `createTest` has started writing as of this
// task — never blocks a delete or hides from the "not used in any test"
// filter the way a published one still must.
describe("Review Focus 1: draft references do not block a delete", () => {
  it("a question referenced only by an unpublished draft version can still be deleted", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w9", name: "W9" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);
    const test = await repo.createTest(db, ws, { name: "Midterm", slug: "midterm9" });
    await draftNaming(ws, test.id, questionId);

    expect(await repo.deleteQuestion(db, ws, bank, questionId)).toEqual({
      deleted: true,
      blockedBy: [],
    });
  });

  it("UX-05: the same reference in a published version still refuses the delete", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w10", name: "W10" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);
    const test = await repo.createTest(db, ws, { name: "Midterm", slug: "midterm10" });
    await repo.publishTestVersion(db, ws, {
      testId: test.id,
      version: 2,
      settings: {},
      sections: [{ id: "s1", title: "Section 1", source: { kind: "fixed", questions: [questionId] } }],
      now: T,
    });

    expect(await repo.deleteQuestion(db, ws, bank, questionId)).toEqual({
      deleted: false,
      blockedBy: ["Midterm"],
    });
  });

  it("the bank browser's unused filter counts draft references as unused", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w11", name: "W11" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);
    const test = await repo.createTest(db, ws, { name: "Midterm", slug: "midterm11" });
    await draftNaming(ws, test.id, questionId);

    const unused = await repo.listQuestions(db, ws, bank, { unused: true });
    expect(unused.rows.map((r) => r.id)).toContain(questionId);
  });
});
