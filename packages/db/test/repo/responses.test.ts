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

// --- the progress bump that rides the same batch (Phase 6 Tasks 9, 10) ---
//
// `max_index` and `section_started_at` cannot be a second statement: the
// answer route is pinned at two subrequests and a candidate calls it
// hundreds of times. So the progress update rides the same `db.batch` as
// the upsert, and the batch reports what each statement did — otherwise
// the conditional upsert could no longer say whether the row moved, and
// `accepted` and `superseded` would collapse into each other.
//
// The `AND max_index < ?` guard inside that statement is a **concurrency**
// rule, not a tidiness one: two tabs saving at once both read the same
// `max_index` off their own request's row, and without the guard the
// later-committing one can drag the lock backwards and reopen a question
// the candidate has passed. The route's own `target > maxIndex` check
// cannot see the other request, so it is tested here, against the
// function, where two interleavings can actually be written down.

const attemptRow = async (): Promise<{ max_index: number; section_started_at: number | null }> => {
  const rows = await db.query<{ max_index: number; section_started_at: number | null }>(
    "SELECT max_index, section_started_at FROM attempt WHERE id = ?",
    [attemptId],
  );
  return rows[0] as { max_index: number; section_started_at: number | null };
};

describe("upsertResponse's progress bump", () => {
  it("raises max_index in the same call, and still reports whether the row moved", async () => {
    expect(
      await repo.upsertResponse(db, WORKSPACE, { ...answer(1, "a"), advance: { maxIndex: 4 } }),
    ).toEqual({ stored: true });
    expect((await attemptRow()).max_index).toBe(4);
  });

  it("a superseded save inside the batch is still reported as superseded", async () => {
    await repo.upsertResponse(db, WORKSPACE, answer(9, "latest"));
    expect(
      await repo.upsertResponse(db, WORKSPACE, { ...answer(4, "stale"), advance: { maxIndex: 4 } }),
    ).toEqual({ stored: false });
    expect(
      await repo.readResponse(db, WORKSPACE, attemptId, QUESTION),
    ).toMatchObject({ value: "latest", clientSeq: 9 });
  });

  it("max_index never falls, even when a concurrent save asks it to", async () => {
    await repo.upsertResponse(db, WORKSPACE, { ...answer(1, "a"), advance: { maxIndex: 7 } });
    // The second tab read `max_index` before the first one's batch
    // committed, so it asks for a number that is now behind. The
    // statement's own `max_index < ?` is what refuses it.
    await repo.upsertResponse(db, WORKSPACE, { ...answer(2, "b"), advance: { maxIndex: 3 } });
    expect((await attemptRow()).max_index).toBe(7);
  });

  it("section_started_at is stamped only when it is asked for, and only on the way up", async () => {
    await repo.upsertResponse(db, WORKSPACE, {
      ...answer(1, "a"),
      advance: { maxIndex: 4, sectionStartedAt: 5_000 },
    });
    expect(await attemptRow()).toMatchObject({ max_index: 4, section_started_at: 5_000 });

    // A save further on that does not enter a section asks for no stamp.
    await repo.upsertResponse(db, WORKSPACE, { ...answer(2, "b"), advance: { maxIndex: 5 } });
    expect(await attemptRow()).toMatchObject({ max_index: 5, section_started_at: 5_000 });

    // And one that is behind changes neither, stamp included.
    await repo.upsertResponse(db, WORKSPACE, {
      ...answer(3, "c"),
      advance: { maxIndex: 2, sectionStartedAt: 9_000 },
    });
    expect(await attemptRow()).toMatchObject({ max_index: 5, section_started_at: 5_000 });
  });

  it("a save with no advance leaves the progress columns alone", async () => {
    await repo.upsertResponse(db, WORKSPACE, { ...answer(1, "a"), advance: { maxIndex: 4 } });
    await repo.upsertResponse(db, WORKSPACE, answer(2, "b"));
    expect((await attemptRow()).max_index).toBe(4);
  });
});

// --- submitAttempt (Phase 6 Task 9) -------------------------------------

describe("submitAttempt", () => {
  it("stamps the end of the attempt and says it did", async () => {
    expect(
      await repo.submitAttempt(db, WORKSPACE, {
        attemptId,
        submittedAt: 2_000,
        reason: "timeout",
      }),
    ).toEqual({ submitted: true });
    const rows = await db.query<{ submitted_at: number; submit_reason: string }>(
      "SELECT submitted_at, submit_reason FROM attempt WHERE id = ?",
      [attemptId],
    );
    expect(rows[0]).toMatchObject({ submitted_at: 2_000, submit_reason: "timeout" });
  });

  it("the first writer wins: a second submission changes nothing and says so", async () => {
    // The race this exists for: a candidate pressing Submit at the same
    // moment a read materialises the timeout. Whichever lands first is
    // the reason on the row, and the other must not rewrite it.
    await repo.submitAttempt(db, WORKSPACE, { attemptId, submittedAt: 1_900, reason: "candidate" });
    expect(
      await repo.submitAttempt(db, WORKSPACE, {
        attemptId,
        submittedAt: 2_000,
        reason: "timeout",
      }),
    ).toEqual({ submitted: false });

    const rows = await db.query<{ submitted_at: number; submit_reason: string }>(
      "SELECT submitted_at, submit_reason FROM attempt WHERE id = ?",
      [attemptId],
    );
    expect(rows[0]).toMatchObject({ submitted_at: 1_900, submit_reason: "candidate" });
  });
});
