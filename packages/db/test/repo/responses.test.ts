import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import * as repo from "../../src/repo/index.js";

// "0 answers lost" is the one durability promise the PRD makes without
// qualification. The client retries on a flaky network, so a client_seq of 4
// can arrive after 5 — and last-write-wins would silently restore the older
// answer. This file is that rule.

const WORKSPACE = newId("wsp");
const QUESTION = newId("qst");

let db: DbClient;
let attemptId: string;

beforeEach(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
  await repo.createWorkspace(db, WORKSPACE, { slug: "w", name: "W" });
  attemptId = await seedAttempt(db, WORKSPACE);
});

afterEach(() => closeClient(db));

async function seedAttempt(db: DbClient, workspaceId: string) {
  const testId = (
    await repo.createTest(db, workspaceId, {
      slug: "t",
      name: "T",
    })
  ).id;
  const candidateId = await repo.createCandidate(db, workspaceId, {
    testId,
    formValues: { email: "a@example.com" },
    consentVersion: "1",
  });
  return repo.createAttempt(db, workspaceId, {
    id: newId("att"),
    candidateId,
    testVersionId: newId("tst"),
    setNo: 1,
    layout: { sections: [] },
    startedAt: 1_000,
    deadlineAt: 2_000,
    tokenHash: "hash",
  });
}

const answer = (clientSeq: number, value: unknown) => ({
  attemptId,
  questionId: QUESTION,
  value,
  clientSeq,
  savedAt: 1_000 + clientSeq,
});

describe("upsertResponse", () => {
  it("stores the first answer for a question", async () => {
    expect(await repo.upsertResponse(db, WORKSPACE, answer(1, "a"))).toEqual({
      stored: true,
    });
    expect(
      await repo.readResponse(db, WORKSPACE, attemptId, QUESTION),
    ).toMatchObject({ value: "a", clientSeq: 1 });
  });

  it("an answer with a lower client_seq never overwrites a higher one", async () => {
    await repo.upsertResponse(db, WORKSPACE, answer(5, "latest"));
    const late = await repo.upsertResponse(db, WORKSPACE, answer(4, "stale"));

    expect(late).toEqual({ stored: false });
    expect(
      await repo.readResponse(db, WORKSPACE, attemptId, QUESTION),
    ).toMatchObject({ value: "latest", clientSeq: 5 });
  });

  it("the same client_seq sent twice is idempotent and writes once", async () => {
    await repo.upsertResponse(db, WORKSPACE, answer(3, "once"));
    const retry = await repo.upsertResponse(db, WORKSPACE, answer(3, "once"));

    expect(retry).toEqual({ stored: false });
    const rows = await repo.listResponses(db, WORKSPACE, attemptId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: "once", clientSeq: 3 });
  });

  it("a higher client_seq replaces the stored answer", async () => {
    await repo.upsertResponse(db, WORKSPACE, answer(1, "first"));
    expect(await repo.upsertResponse(db, WORKSPACE, answer(2, "second"))).toEqual(
      { stored: true },
    );
    expect(
      await repo.readResponse(db, WORKSPACE, attemptId, QUESTION),
    ).toMatchObject({ value: "second", clientSeq: 2 });
  });

  it("keeps one row per question per attempt, whatever the order of arrival", async () => {
    const other = newId("qst");
    for (const seq of [3, 1, 2]) {
      await repo.upsertResponse(db, WORKSPACE, answer(seq, `v${seq}`));
      await repo.upsertResponse(db, WORKSPACE, {
        ...answer(seq, `o${seq}`),
        questionId: other,
      });
    }

    const rows = await repo.listResponses(db, WORKSPACE, attemptId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.clientSeq === 3)).toBe(true);
  });

  it("round-trips a structured answer, not just a string", async () => {
    // value_json is text on SQLite and jsonb on Postgres; a caller stores and
    // reads a value, never an encoding.
    await repo.upsertResponse(db, WORKSPACE, answer(1, { picked: ["a", "b"] }));
    expect(
      await repo.readResponse(db, WORKSPACE, attemptId, QUESTION),
    ).toMatchObject({ value: { picked: ["a", "b"] } });
  });

  it("does not read another workspace's answer", async () => {
    const other = newId("wsp");
    await repo.createWorkspace(db, other, { slug: "o", name: "O" });
    await repo.upsertResponse(db, WORKSPACE, answer(1, "mine"));

    expect(await repo.readResponse(db, other, attemptId, QUESTION)).toBeNull();
    expect(await repo.listResponses(db, other, attemptId)).toEqual([]);
  });
});
