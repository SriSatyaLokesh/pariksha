import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import * as repo from "../../src/repo/index.js";

// A prefixed ID exists so that a value in a log, a URL or a support email
// says what it is. An ID that says `qst_` for a row in `response` is worse
// than an unprefixed one: it is confidently wrong, and it will be read by a
// person trying to find a candidate's lost answer.

const WORKSPACE = newId("wsp");

let db: DbClient;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
  await repo.createWorkspace(db, WORKSPACE, { slug: "w", name: "W" });
});

afterAll(() => closeClient(db));

const idIn = async (table: string): Promise<string> => {
  const rows = await db.query<{ id: string }>(`SELECT id FROM ${table} LIMIT 1`);
  return rows[0]?.id ?? "";
};

describe("every row is addressed by an ID that names its own table", () => {
  it("gives a test a tst_ ID and its published version a ver_ ID", async () => {
    const testId = (await repo.createTest(db, WORKSPACE, { slug: "s", name: "N" })).id;
    expect(testId.startsWith("tst_")).toBe(true);

    const versionId = await repo.publishTestVersion(db, WORKSPACE, {
      testId,
      version: 2,
      settings: {},
      sections: [],
    });
    expect(versionId.startsWith("ver_")).toBe(true);
  });

  it("gives a membership an mbr_ ID", async () => {
    const id = await repo.addMembership(db, WORKSPACE, {
      userId: newId("usr"),
      role: "admin",
    });
    expect(id.startsWith("mbr_")).toBe(true);
  });

  it("gives a candidate a cnd_ ID and an attempt an att_ ID", async () => {
    const testId = (await repo.createTest(db, WORKSPACE, { slug: "s2", name: "N" })).id;
    const candidateId = await repo.createCandidate(db, WORKSPACE, {
      testId,
      formValues: {},
      consentVersion: "1",
    });
    expect(candidateId.startsWith("cnd_")).toBe(true);

    const attemptId = await repo.createAttempt(db, WORKSPACE, {
      candidateId,
      testVersionId: newId("ver"),
      setNo: 1,
      layout: {},
      startedAt: 1,
      deadlineAt: 2,
      tokenHash: "h",
    });
    expect(attemptId.startsWith("att_")).toBe(true);

    await repo.upsertResponse(db, WORKSPACE, {
      attemptId,
      questionId: newId("qst"),
      value: "v",
      clientSeq: 1,
      savedAt: 1,
    });
    expect((await idIn("response")).startsWith("rsp_")).toBe(true);

    await repo.appendEvents(db, WORKSPACE, {
      attemptId,
      events: [{ type: "blur", clientTs: 1 }],
      serverTs: 2,
    });
    expect((await idIn("event")).startsWith("evt_")).toBe(true);
  });

  it("gives an audit entry an aud_ ID", async () => {
    const id = await repo.appendAudit(db, WORKSPACE, {
      actor: "usr_1",
      action: "test.publish",
      target: "tst_1",
    });
    expect(id.startsWith("aud_")).toBe(true);
  });
});
