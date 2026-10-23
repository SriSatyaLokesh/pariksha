// The attempt row: how it is written, how a cookie finds it again, and the
// three numbers `attempts_allowed` and `cooldown_minutes` are judged
// against (Phase 6 Task 5, #69, P6.5).
//
// Every assertion here is about storage. The route-level rules — which
// refusal, which status, which sentence — are `apps/api/test/run/*`'s, per
// the phase's standing decision that only the server copy counts and it is
// the route that has to be proved.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  attemptFiguresForCandidate,
  closeClient,
  countAttemptsForCandidate,
  countAttemptsForVersion,
  createAttempt,
  createTest,
  createWorkspace,
  getAttempt,
  getDraftVersion,
  listSnapshotFaceCounts,
  migrate,
  newId,
  publishDraftVersion,
  putDraftVersion,
  readAttemptByTokenHash,
  recordSnapshot,
  setIntegrity,
  sqliteClient,
  type DbClient,
  type TestDocumentBody,
} from "../../src/index.js";

const NOW = 1_760_000_000_000;
const MINUTE = 60_000;

const db: DbClient = sqliteClient(":memory:");
await migrate(db);
afterAll(() => closeClient(db));

/** One call per raw operation, the way `countingDeps` counts them in the
 *  API. Local rather than shared, the way `candidate-entry.test.ts` keeps
 *  its own: six lines, one caller. */
function countingClient(inner: DbClient): { db: DbClient; count: () => number } {
  let calls = 0;
  const bump = <T>(run: () => T): T => {
    calls += 1;
    return run();
  };
  return {
    db: {
      ...inner,
      exec: (sql) => bump(() => inner.exec(sql)),
      all: <T>(sql: string) => bump(() => inner.all<T>(sql)),
      query: <T>(sql: string, params?: unknown[]) => bump(() => inner.query<T>(sql, params)),
      run: (sql, params) => bump(() => inner.run(sql, params)),
      batch: (statements) => bump(() => inner.batch(statements)),
    },
    count: () => calls,
  };
}

const body: TestDocumentBody = {
  settings: { timing: { duration_minutes: 45, navigation: "linear", late_sync_grace_seconds: 30 } },
  sections: [{ id: "s1", title: "Logic", source: { kind: "fixed", questions: ["qst_1"] } }],
};

async function publish(slug: string): Promise<{ workspaceId: string; testId: string; versionId: string }> {
  const workspaceId = newId("wsp");
  await createWorkspace(db, workspaceId, { slug, name: slug, branding: {}, now: NOW });
  const test = await createTest(db, workspaceId, { name: slug, slug, now: NOW });
  const draft = await getDraftVersion(db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");
  await putDraftVersion(db, workspaceId, draft, body, NOW);
  await publishDraftVersion(db, workspaceId, test.id, NOW);
  const version = await getDraftVersion(db, workspaceId, test.id);
  void version;
  const rows = await db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
    [test.id],
  );
  return { workspaceId, testId: test.id, versionId: rows[0]!.id };
}

const alpha = await publish("alpha");
const beta = await publish("beta");

const candidateIn = async (ws: { workspaceId: string; testId: string }): Promise<string> => {
  const id = newId("cnd");
  await db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, NULL, NULL, 'registration', '{}', NULL, NULL, ?)",
    [id, ws.workspaceId, ws.testId, NOW],
  );
  return id;
};

interface AttemptInput {
  candidateId: string;
  startedAt?: number;
  deadlineAt?: number;
  submittedAt?: number | null;
  lockedAt?: number | null;
  tokenHash?: string;
  setNo?: number;
}

async function attempt(
  ws: { workspaceId: string; versionId: string },
  input: AttemptInput,
): Promise<string> {
  const id = newId("att");
  await createAttempt(db, ws.workspaceId, {
    id,
    candidateId: input.candidateId,
    testVersionId: ws.versionId,
    setNo: input.setNo ?? 0,
    layout: { sections: [], media: [], paper: [] },
    startedAt: input.startedAt ?? NOW,
    deadlineAt: input.deadlineAt ?? NOW + 45 * MINUTE,
    tokenHash: input.tokenHash ?? `hash-${id}`,
  });
  if (input.submittedAt != null) {
    await db.run("UPDATE attempt SET submitted_at = ? WHERE id = ?", [input.submittedAt, id]);
  }
  if (input.lockedAt != null) {
    await db.run("UPDATE attempt SET locked_at = ? WHERE id = ?", [input.lockedAt, id]);
  }
  return id;
}

beforeEach(async () => {
  await db.run("DELETE FROM attempt", []);
});

// --- createAttempt -----------------------------------------------------

it("createAttempt writes the id it was handed, so the layout seed is reproducible from the row", async () => {
  const candidateId = await candidateIn(alpha);
  const id = newId("att");
  const returned = await createAttempt(db, alpha.workspaceId, {
    id,
    candidateId,
    testVersionId: alpha.versionId,
    setNo: 2,
    layout: { sections: [], media: ["a.png"], paper: [] },
    startedAt: NOW,
    deadlineAt: NOW + 45 * MINUTE,
    tokenHash: "seeded",
  });
  expect(returned).toBe(id);
  const rows = await db.query<{ id: string }>("SELECT id FROM attempt", []);
  expect(rows.map((r) => r.id)).toEqual([id]);
});

it("a fresh attempt starts at index 0 with no section clock running", async () => {
  const candidateId = await candidateIn(alpha);
  const id = await attempt(alpha, { candidateId });
  const rows = await db.query<{ max_index: number; section_started_at: number | null }>(
    "SELECT max_index, section_started_at FROM attempt WHERE id = ?",
    [id],
  );
  expect(rows[0]).toMatchObject({ max_index: 0, section_started_at: null });
});

// --- readAttemptByTokenHash --------------------------------------------

it("the context read is one statement — the attempt and its version settings together", async () => {
  const candidateId = await candidateIn(alpha);
  await attempt(alpha, { candidateId, tokenHash: "one-statement" });

  const counting = countingClient(db);
  const record = await readAttemptByTokenHash(counting.db, "one-statement");

  expect(counting.count()).toBe(1);
  expect(record).toMatchObject({
    workspaceId: alpha.workspaceId,
    candidateId,
    testId: alpha.testId,
    testVersionId: alpha.versionId,
    version: 1,
    maxIndex: 0,
    sectionStartedAt: null,
    submittedAt: null,
    flag: "clean",
  });
  // The joined half: the timer and the navigation rule arrive with the
  // attempt, which is the whole reason this is a join and not two reads.
  expect((record!.settings as { timing: { duration_minutes: number; navigation: string } }).timing)
    .toMatchObject({ duration_minutes: 45, navigation: "linear" });
  expect((record!.sections as { id: string }[])[0]!.id).toBe("s1");
});

it("an unknown token hash is null, not a throw", async () => {
  expect(await readAttemptByTokenHash(db, "nothing-hashes-to-this")).toBeNull();
});

it("a submitted attempt still resolves, because the receipt is read through the same cookie", async () => {
  const candidateId = await candidateIn(alpha);
  await attempt(alpha, { candidateId, tokenHash: "submitted", submittedAt: NOW + MINUTE });
  const record = await readAttemptByTokenHash(db, "submitted");
  expect(record).not.toBeNull();
  expect(record!.submittedAt).toBe(NOW + MINUTE);
});

it("a candidate's token reaches only their own attempt's workspace", async () => {
  const inAlpha = await candidateIn(alpha);
  const inBeta = await candidateIn(beta);
  await attempt(alpha, { candidateId: inAlpha, tokenHash: "in-alpha" });
  await attempt(beta, { candidateId: inBeta, tokenHash: "in-beta" });

  expect((await readAttemptByTokenHash(db, "in-beta"))!.workspaceId).toBe(beta.workspaceId);
  expect((await readAttemptByTokenHash(db, "in-alpha"))!.workspaceId).toBe(alpha.workspaceId);
});

// --- countAttemptsForCandidate -----------------------------------------

it("every row counts, submitted or not — an abandoned attempt was an attempt", async () => {
  const candidateId = await candidateIn(alpha);
  await attempt(alpha, { candidateId, deadlineAt: NOW - MINUTE, tokenHash: "abandoned" });
  await attempt(alpha, { candidateId, deadlineAt: NOW - MINUTE, submittedAt: NOW - 2 * MINUTE, tokenHash: "done" });

  expect(await countAttemptsForCandidate(db, alpha.workspaceId, candidateId, NOW)).toMatchObject({
    count: 2,
  });
});

it("the cooldown runs from the attempt's end, not its start", async () => {
  const candidateId = await candidateIn(alpha);
  // Abandoned: never submitted, so the end is the deadline it ran to.
  await attempt(alpha, { candidateId, startedAt: NOW - 90 * MINUTE, deadlineAt: NOW - 45 * MINUTE });

  const { lastEndedAt } = await countAttemptsForCandidate(db, alpha.workspaceId, candidateId, NOW);
  expect(lastEndedAt).toBe(NOW - 45 * MINUTE);
  // Measured from `started_at` this would read 90 minutes ago and a
  // 60-minute cooldown would already be served.
  expect(lastEndedAt).not.toBe(NOW - 90 * MINUTE);
});

it("a submitted attempt ends when it was submitted, even though its deadline is later", async () => {
  const candidateId = await candidateIn(alpha);
  await attempt(alpha, {
    candidateId,
    startedAt: NOW - 30 * MINUTE,
    deadlineAt: NOW + 15 * MINUTE,
    submittedAt: NOW - 20 * MINUTE,
  });
  expect((await countAttemptsForCandidate(db, alpha.workspaceId, candidateId, NOW)).lastEndedAt).toBe(
    NOW - 20 * MINUTE,
  );
});

it("an unsubmitted attempt whose deadline has not passed is live; one past its deadline is not", async () => {
  const live = await candidateIn(alpha);
  const over = await candidateIn(alpha);
  await attempt(alpha, { candidateId: live, deadlineAt: NOW + MINUTE, tokenHash: "live" });
  await attempt(alpha, { candidateId: over, deadlineAt: NOW - MINUTE, tokenHash: "over" });

  expect((await countAttemptsForCandidate(db, alpha.workspaceId, live, NOW)).liveDeadlineAt).toBe(NOW + MINUTE);
  expect((await countAttemptsForCandidate(db, alpha.workspaceId, over, NOW)).liveDeadlineAt).toBeNull();
});

it("a submitted attempt is never live, however far away its deadline is", async () => {
  const candidateId = await candidateIn(alpha);
  await attempt(alpha, { candidateId, deadlineAt: NOW + 45 * MINUTE, submittedAt: NOW });
  expect((await countAttemptsForCandidate(db, alpha.workspaceId, candidateId, NOW)).liveDeadlineAt).toBeNull();
});

it("a candidate with no attempts reads zero, null and null rather than throwing", async () => {
  const candidateId = await candidateIn(alpha);
  expect(await countAttemptsForCandidate(db, alpha.workspaceId, candidateId, NOW)).toEqual({
    count: 0,
    lastEndedAt: null,
    liveDeadlineAt: null,
    lockedCount: 0,
  });
});

it("M2: a locked attempt whose own deadline has passed still counts as locked, even though it is no longer live", async () => {
  const candidateId = await candidateIn(alpha);
  await attempt(alpha, { candidateId, deadlineAt: NOW - MINUTE, tokenHash: "locked-and-expired", lockedAt: NOW - 30 * MINUTE });

  const attempts = await countAttemptsForCandidate(db, alpha.workspaceId, candidateId, NOW);
  expect(attempts.liveDeadlineAt).toBeNull();
  expect(attempts.lockedCount).toBe(1);
});

it("another candidate's attempts are not counted against this one", async () => {
  const mine = await candidateIn(alpha);
  const theirs = await candidateIn(alpha);
  await attempt(alpha, { candidateId: theirs, tokenHash: "theirs" });
  expect((await countAttemptsForCandidate(db, alpha.workspaceId, mine, NOW)).count).toBe(0);
});

// --- attemptFiguresForCandidate (K6/K7) ---------------------------------

/** Stamps a submitted attempt's score — `attempt()` writes `submitted_at`
 *  but never a score, and `K6`'s figures need one to read. */
async function score(id: string, percent: number): Promise<void> {
  await db.run("UPDATE attempt SET score_json = ? WHERE id = ?", [
    db.jsonParam({ percent, total: percent, max: 100, passed: null, pending: [], perQuestion: {}, sections: [] }),
    id,
  ]);
}

it("one statement returns every submitted, scored attempt as a figure", async () => {
  const candidateId = await candidateIn(alpha);
  const first = await attempt(alpha, {
    candidateId,
    tokenHash: "fig-1",
    submittedAt: NOW - 2 * MINUTE,
  });
  await score(first, 72);
  const second = await attempt(alpha, { candidateId, tokenHash: "fig-2", submittedAt: NOW - MINUTE });
  await score(second, 81);

  const counting = countingClient(db);
  const figures = await attemptFiguresForCandidate(counting.db, alpha.workspaceId, candidateId);

  expect(counting.count()).toBe(1);
  expect(figures).toEqual(
    expect.arrayContaining([
      { attemptId: first, percent: 72, submittedAt: NOW - 2 * MINUTE },
      { attemptId: second, percent: 81, submittedAt: NOW - MINUTE },
    ]),
  );
  expect(figures).toHaveLength(2);
});

it("excludes an attempt that has not been submitted", async () => {
  const candidateId = await candidateIn(alpha);
  const live = await attempt(alpha, { candidateId, tokenHash: "live-one" });
  // Positive control: a submitted, scored sibling attempt for the same
  // candidate is read back, so the negative below is the join excluding
  // `live` specifically, not the statement returning nothing at all.
  const scored = await attempt(alpha, { candidateId, tokenHash: "live-one-scored", submittedAt: NOW });
  await score(scored, 60);

  const figures = await attemptFiguresForCandidate(db, alpha.workspaceId, candidateId);
  expect(figures.map((f) => f.attemptId)).toEqual([scored]);
  expect(figures.map((f) => f.attemptId)).not.toContain(live);
});

it("excludes a submitted attempt the engine never scored", async () => {
  const candidateId = await candidateIn(alpha);
  // Submitted (`finishAttempt` ran) but `score` stayed null — the
  // ungradeable-engine case `submit.ts` documents.
  const unscored = await attempt(alpha, { candidateId, tokenHash: "unscored", submittedAt: NOW });
  // Positive control beside it: a submitted attempt the engine did score.
  const scored = await attempt(alpha, { candidateId, tokenHash: "unscored-sibling-scored", submittedAt: NOW });
  await score(scored, 60);

  const figures = await attemptFiguresForCandidate(db, alpha.workspaceId, candidateId);
  expect(figures.map((f) => f.attemptId)).toEqual([scored]);
  expect(figures.map((f) => f.attemptId)).not.toContain(unscored);
});

it("another candidate's attempts are not read against this one", async () => {
  const mine = await candidateIn(alpha);
  const theirs = await candidateIn(alpha);
  const theirAttempt = await attempt(alpha, { candidateId: theirs, tokenHash: "theirs-scored", submittedAt: NOW });
  await score(theirAttempt, 90);
  // Positive control: my own scored attempt is read back through the same
  // call, so the negative below is the candidate boundary, not an empty
  // table.
  const myAttempt = await attempt(alpha, { candidateId: mine, tokenHash: "mine-scored", submittedAt: NOW });
  await score(myAttempt, 55);

  const figures = await attemptFiguresForCandidate(db, alpha.workspaceId, mine);
  expect(figures.map((f) => f.attemptId)).toEqual([myAttempt]);
  expect(figures.map((f) => f.attemptId)).not.toContain(theirAttempt);
});

// --- integrity_flag / observed (Phase 7a Task 3, Q6) --------------------
//
// A different axis from grading: `flag` already carries a grading verdict
// (`submit.ts:357` writes "scoring_blocked" when a bound refuses scoring),
// and `setIntegrity` must never touch it.

it("keeps a scoring_blocked flag through an integrity update", async () => {
  const candidateId = await candidateIn(alpha);
  const id = await attempt(alpha, { candidateId, tokenHash: "integrity-blocked" });
  await db.run("UPDATE attempt SET flag = ? WHERE id = ?", ["scoring_blocked", id]);

  const result = await setIntegrity(db, alpha.workspaceId, {
    attemptId: id,
    integrityFlag: "high_risk",
    observed: false,
  });
  expect(result).toEqual({ updated: true });

  const row = await getAttempt(db, alpha.workspaceId, id);
  expect(row?.flag).toBe("scoring_blocked");
  expect(row?.integrityFlag).toBe("high_risk");
  // Not merely falsy: SQLite stores this as 0, and `toBe(false)` would pass
  // on a raw 0 just as readily as on a real boolean.
  expect(row?.observed).toBe(false);
});

// Task 7 (whole-branch review): a later plan's recompute needs to tell a
// written verdict from a no-op against an attempt that no longer exists —
// `DbClient.run`'s `changes` already says this for every other writer in
// this file, and `setIntegrity` was the one that discarded it.
it("setIntegrity reports no update against an attempt that does not exist", async () => {
  const result = await setIntegrity(db, alpha.workspaceId, {
    attemptId: "att_does_not_exist",
    integrityFlag: "review",
    observed: true,
  });
  expect(result).toEqual({ updated: false });
});

it("defaults a fresh attempt to clean and observed", async () => {
  const candidateId = await candidateIn(alpha);
  const id = await attempt(alpha, { candidateId, tokenHash: "integrity-default" });
  const row = await getAttempt(db, alpha.workspaceId, id);
  expect(row?.integrityFlag).toBe("clean");
  expect(row?.observed).toBe(true);
});

// --- countAttemptsForVersion -------------------------------------------

it("the round-robin index is the number of attempts already minted on the version", async () => {
  const one = await candidateIn(alpha);
  const two = await candidateIn(alpha);
  expect(await countAttemptsForVersion(db, alpha.workspaceId, alpha.versionId)).toBe(0);
  await attempt(alpha, { candidateId: one, tokenHash: "rr-1" });
  await attempt(alpha, { candidateId: two, tokenHash: "rr-2" });
  expect(await countAttemptsForVersion(db, alpha.workspaceId, alpha.versionId)).toBe(2);
  // Another test's attempts do not move this one's index.
  const elsewhere = await candidateIn(beta);
  await attempt(beta, { candidateId: elsewhere, tokenHash: "rr-beta" });
  expect(await countAttemptsForVersion(db, alpha.workspaceId, alpha.versionId)).toBe(2);
});

// --- listSnapshotFaceCounts (M1) ----------------------------------------

it("M1: reports the aggregate count and multi-face count, not one row per snapshot", async () => {
  const candidateId = await candidateIn(alpha);
  const id = await attempt(alpha, { candidateId, tokenHash: "snapshot-agg" });

  expect(await listSnapshotFaceCounts(db, alpha.workspaceId, id)).toEqual({ count: 0, multiFaceCount: 0 });

  await recordSnapshot(db, alpha.workspaceId, { attemptId: id, storageKey: "k1", takenAt: NOW, reason: "interval" });
  await recordSnapshot(db, alpha.workspaceId, { attemptId: id, storageKey: "k2", takenAt: NOW, reason: "interval" });
  await recordSnapshot(db, alpha.workspaceId, { attemptId: id, storageKey: "k3", takenAt: NOW, reason: "interval" });
  // `recordSnapshot` always writes `face_count: null` (`Q3`: pre-cut) — one
  // row is bumped by hand, the only way today to exercise the `> 1` branch.
  await db.run("UPDATE snapshot SET face_count = 2 WHERE storage_key = 'k2'", []);

  expect(await listSnapshotFaceCounts(db, alpha.workspaceId, id)).toEqual({ count: 3, multiFaceCount: 1 });
});

it("M1: another attempt's snapshots are not counted against this one", async () => {
  const candidateId = await candidateIn(alpha);
  const mine = await attempt(alpha, { candidateId, tokenHash: "snapshot-mine" });
  const theirCandidate = await candidateIn(alpha);
  const theirs = await attempt(alpha, { candidateId: theirCandidate, tokenHash: "snapshot-theirs" });

  await recordSnapshot(db, alpha.workspaceId, { attemptId: theirs, storageKey: "k4", takenAt: NOW, reason: "interval" });
  expect(await listSnapshotFaceCounts(db, alpha.workspaceId, mine)).toEqual({ count: 0, multiFaceCount: 0 });
});
