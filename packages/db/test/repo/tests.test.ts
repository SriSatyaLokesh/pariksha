// Test CRUD, IDs, slugs, short links (#54, P5.1).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Question } from "@pariksha/core";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import * as repo from "../../src/repo/index.js";
import { resolveShortCode } from "../../src/repo/shortlink.js";
import { deriveState } from "../../src/repo/test-document.js";

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

/** Task 11's real transition, as a fixture: write the draft head, then
 * stamp it in place. `publishTestVersion`'s "INSERT a row at version 2"
 * is gone — `createTest` already seeded version 1 and `(test_id, version)`
 * is unique, so that INSERT could only ever work by mis-numbering the
 * first published version of every test in the product. */
async function publishWith(
  ws: string,
  testId: string,
  sections: unknown[] = [],
  settings: Record<string, unknown> = {},
  now = T,
): Promise<{ version: number }> {
  const head = await repo.getDraftVersion(db, ws, testId);
  if (!head) throw new Error("publishWith: no draft head");
  await repo.putDraftVersion(db, ws, head, { settings, sections } as never, now);
  return repo.publishDraftVersion(db, ws, testId, now);
}

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

    const heads = await repo.headVersionsByTest(db, ws, row.id);
    expect(heads.get(row.id)).toEqual({ draftVersion: 1, publishedTiming: undefined });
  });
});

describe("publishDraftVersion", () => {
  // Review Focus 2: `publishTestVersion` used to write `status = "open"`
  // unconditionally, a value that is not even in `TestStatus`. Publishing
  // writes "published"; Scheduled and Open are `deriveState`'s answer
  // against `timing` and the clock.
  it("sets the test's status to 'published', not the old unconditional 'open'", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w12", name: "W12" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a12" });

    await publishWith(ws, created.id);

    const row = await repo.getTest(db, ws, created.id);
    expect(row?.status).toBe("published");
    expect(row?.status).not.toBe("open");
    expect(row?.currentVersion).toBe(1);
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

    // Publishing stamps the version-1 draft `createTest` already wrote,
    // which is what sets `current_version` and locks the slug.
    await publishWith(ws, created.id);

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
    await publishWith(ws, test.id, [
      { id: "s1", title: "Section 1", source: { kind: "fixed", questions: [questionId] } },
    ]);

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

// Task 3 (#55, P5.2): the draft itself.
describe("getDraftVersion / putDraftVersion", () => {
  it("getDraftVersion reads the version 1 row createTest already seeded", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w13", name: "W13" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a13" });

    const draft = await repo.getDraftVersion(db, ws, created.id);
    expect(draft).toMatchObject({ version: 1, publishedAt: null, body: { settings: {}, sections: [] } });
  });

  it("putDraftVersion replaces the stored body wholesale and keeps the same row", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w14", name: "W14" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a14" });
    const before = await repo.getDraftVersion(db, ws, created.id);

    const body = { settings: { access: { mode: "link_code" as const, access_code: "X" } }, sections: [] };
    const after = await repo.putDraftVersion(db, ws, before!, body, T);

    expect(after.id).toBe(before?.id);
    expect(after.version).toBe(1);
    expect(after.body).toEqual(body);
    expect((await repo.getDraftVersion(db, ws, created.id))?.body).toEqual(body);
  });

  it("fix round (task 3 review, I5): bumps test.updated_at, the field listTests sorts on", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w14b", name: "W14B" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a14b", now: T });
    expect(created.updatedAt).toBe(T);
    const existing = await repo.getDraftVersion(db, ws, created.id);

    await repo.putDraftVersion(db, ws, existing!, { settings: {}, sections: [] }, T + 1000);

    const row = await repo.getTest(db, ws, created.id);
    expect(row?.updatedAt).toBe(T + 1000);
  });

  // Fix round (task 3 review, I7/I8 — the missing-draft contract, decided):
  // putDraftVersion refuses to create a draft; Task 11's publish lifecycle
  // owns starting the next one explicitly (UX-18). Replaces the old
  // "starts a fresh numbered draft" test, which exercised exactly the
  // silent-creation behaviour this decision removes.
  it("refuses to update a draft that is no longer open — Task 11's lifecycle starts the next one, not this function", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w15", name: "W15" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a15" });
    const existing = await repo.getDraftVersion(db, ws, created.id);
    await publishWith(ws, created.id);
    // Clearing the draft row itself is Task 11's lifecycle feature, not this
    // one — stood in for here with a raw delete, the same way Task 2's own
    // `draftNaming` helper (top of this file) stands in for Task 3's own
    // feature elsewhere in this suite.
    await db.run("DELETE FROM test_version WHERE workspace_id = ? AND test_id = ? AND published_at IS NULL", [
      ws,
      created.id,
    ]);
    expect(await repo.getDraftVersion(db, ws, created.id)).toBeNull();

    await expect(repo.putDraftVersion(db, ws, existing!, { settings: {}, sections: [] }, T + 1)).rejects.toThrow(
      /no open draft/i,
    );
  });
});

describe("existingRowIds / workspaceQuestionSummaries", () => {
  it("existingRowIds answers which ids are this workspace's own, of both kinds, in one call", async () => {
    const ws = newId("wsp");
    const other = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w16", name: "W16" });
    await repo.createWorkspace(db, other, { slug: "w16b", name: "W16B" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const foreignBank = await repo.createBank(db, other, { name: "Foreign bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);

    const result = await repo.existingRowIds(db, ws, {
      questionIds: [questionId, "qst_doesnotexist00"],
      bankIds: [bank, foreignBank],
    });

    expect(result.questionIds).toEqual(new Set([questionId]));
    expect(result.bankIds).toEqual(new Set([bank]));
  });

  it("existingRowIds costs nothing when neither list names anything", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w17", name: "W17" });
    expect(await repo.existingRowIds(db, ws, { questionIds: [], bankIds: [] })).toEqual({
      questionIds: new Set(),
      bankIds: new Set(),
    });
  });

  it("workspaceQuestionSummaries lists every question in the workspace with the draw/points columns", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w18", name: "W18" });
    const bank = await repo.createBank(db, ws, { name: "Bank" });
    const { id: questionId } = await repo.upsertQuestion(db, ws, bank, singleFixture, T);

    const summaries = await repo.workspaceQuestionSummaries(db, ws);
    expect(summaries).toContainEqual({
      id: questionId,
      bankId: bank,
      points: 1,
      difficulty: "easy",
      tags: ["demo"],
      type: "single",
    });
  });
});

// --- Task 11 (#62, P5.9): the lifecycle ---------------------------------

describe("publishDraftVersion", () => {
  it("T-04: publishing freezes the draft head as version 1 and points current_version at it", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w20", name: "W20" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a20" });

    // The whole bug this function exists to fix: the first publish of a
    // brand-new test used to raise `UNIQUE constraint failed:
    // test_version.test_id, test_version.version`, because `createTest` had
    // already seeded the draft as version 1 and the old transition INSERTed
    // a row alongside it.
    expect(await repo.publishDraftVersion(db, ws, created.id, T)).toEqual({ version: 1 });

    const row = await repo.getTest(db, ws, created.id);
    expect(row?.status).toBe("published");
    expect(row?.currentVersion).toBe(1);
    expect((await repo.getPublishedVersion(db, ws, created.id))?.version).toBe(1);
  });

  it("UX-18: it opens version 2 as the next draft, carrying the published body", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w21", name: "W21" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a21" });
    const sections = [{ id: "s1", title: "One", source: { kind: "fixed", questions: [] } }];
    await publishWith(ws, created.id, sections, { timing: { duration_minutes: 30 } });

    const next = await repo.getDraftVersion(db, ws, created.id);
    expect(next?.version).toBe(2);
    expect(next?.publishedAt).toBeNull();
    expect(next?.body).toEqual({ settings: { timing: { duration_minutes: 30 } }, sections });
  });

  it("AC-03: editing after a publish writes version 2 and leaves version 1 frozen", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w22", name: "W22" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a22" });
    const original = [{ id: "s1", title: "One", source: { kind: "fixed", questions: [] } }];
    await publishWith(ws, created.id, original);

    const head = await repo.getDraftVersion(db, ws, created.id);
    const edited = { settings: {}, sections: [{ id: "s1", title: "Renamed", source: { kind: "fixed", questions: [] } }] };
    await repo.putDraftVersion(db, ws, head!, edited as never, T + 1);

    expect((await repo.getDraftVersion(db, ws, created.id))?.version).toBe(2);
    expect((await repo.getPublishedVersion(db, ws, created.id, 1))?.body.sections).toEqual(original);
    expect((await repo.getTest(db, ws, created.id))?.currentVersion).toBe(1);
  });

  it("Review Focus 2: no row ever stores the status 'open'", async () => {
    const rows = await db.query<{ status: string }>("SELECT DISTINCT status FROM test");
    expect(rows.map((r) => r.status)).not.toContain("open");
    expect(rows.map((r) => r.status)).not.toContain("scheduled");
  });

  it("refuses a test with no open draft rather than inventing one", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w23", name: "W23" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a23" });
    await db.run("DELETE FROM test_version WHERE workspace_id = ? AND test_id = ?", [ws, created.id]);

    await expect(repo.publishDraftVersion(db, ws, created.id, T)).rejects.toThrow(/no open draft/i);
  });
});

describe("listVersions / setTestStatus", () => {
  it("reports each version's published time and how many attempts are pinned to it", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w24", name: "W24" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a24" });
    await publishWith(ws, created.id);
    const published = await repo.getPublishedVersion(db, ws, created.id);

    const candidate = await repo.createCandidate(db, ws, { testId: created.id, formValues: {} });
    for (const n of [1, 2]) {
      await repo.createAttempt(db, ws, {
        candidateId: candidate,
        testVersionId: published!.id,
        setNo: n,
        layout: [],
        startedAt: T,
        deadlineAt: T + 1000,
        tokenHash: `h${n}`,
      });
    }

    expect(await repo.listVersions(db, ws, created.id)).toEqual([
      { version: 2, publishedAt: null, attemptCount: 0 },
      { version: 1, publishedAt: T, attemptCount: 2 },
    ]);
  });

  it("close and archive are writes of the stored status, and report a missing test", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w25", name: "W25" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a25" });

    expect(await repo.setTestStatus(db, ws, created.id, "closed", T + 5)).toBe(true);
    expect((await repo.getTest(db, ws, created.id))?.status).toBe("closed");
    expect((await repo.getTest(db, ws, created.id))?.updatedAt).toBe(T + 5);
    expect(await repo.setTestStatus(db, ws, newId("tst"), "closed", T)).toBe(false);
  });
});

describe("deriveState", () => {
  const NOW = T;
  const past = new Date(NOW - 86_400_000).toISOString();
  const future = new Date(NOW + 86_400_000).toISOString();
  const later = new Date(NOW + 172_800_000).toISOString();

  it.each([
    ["draft", {}, "draft"],
    ["published", { opens_at: future, closes_at: later }, "scheduled"],
    ["published", { opens_at: past, closes_at: future }, "open"],
    ["published", { opens_at: past, closes_at: past }, "closed"],
    ["published", {}, "open"],
    ["published", { opens_at: "not a date" }, "open"],
    ["closed", { opens_at: past, closes_at: future }, "closed"],
    ["archived", { opens_at: past, closes_at: future }, "archived"],
  ] as const)("deriveState(%s, %o) is %s", (status, timing, state) => {
    expect(deriveState(status, { duration_minutes: 60, ...timing }, NOW)).toBe(state);
  });

  it("a published test with no timing block at all is Open", () => {
    expect(deriveState("published", undefined, NOW)).toBe("open");
  });
});

describe("headVersionsByTest", () => {
  it("names the open draft and the *current* published version's window, two rows per test at most", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "w26", name: "W26" });
    const created = await repo.createTest(db, ws, { name: "A", slug: "a26" });
    const timing = { duration_minutes: 45, opens_at: "2026-11-14T09:00:00+05:30" };

    await publishWith(ws, created.id, [], { timing });
    // A second publish, so there are two frozen versions and the join has
    // something to narrow: only `current_version` may come back.
    await publishWith(ws, created.id, [], { timing: { ...timing, duration_minutes: 50 } });

    const heads = await repo.headVersionsByTest(db, ws);
    expect(heads.get(created.id)).toEqual({
      draftVersion: 3,
      publishedTiming: { ...timing, duration_minutes: 50 },
    });
  });
});
