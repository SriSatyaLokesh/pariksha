// `registerCandidate` (Phase 6 Task 3, #67) — the belt clauses the route
// above it normally makes unreachable.
//
// `apps/api/test/run/registration.test.ts` proves the behaviour a
// candidate meets. This file proves the two guards that only a race can
// reach, because a guard nothing can reach is a guard nobody notices
// losing.

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import {
  createTest,
  createWorkspace,
  getCandidateByExternalId,
  listCandidates,
  registerCandidate,
  replaceCandidateList,
  type RegisterCandidateInput,
} from "../../src/repo/index.js";

const T = 1_700_000_000_000;

let db: DbClient;
let ws = "";
let testId = "";

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
});

afterAll(() => closeClient(db));

beforeEach(async () => {
  ws = newId("wsp");
  await createWorkspace(db, ws, { slug: `w-${ws.slice(4)}`, name: "W" });
  testId = (await createTest(db, ws, { name: "Midterm", slug: "midterm" })).id;
  await replaceCandidateList(
    db,
    ws,
    testId,
    [{ externalId: "21CS0147", setLabel: "A", formValues: { full_name: "Ananya" } }],
    T,
  );
});

const input = (over: Partial<RegisterCandidateInput> = {}): RegisterCandidateInput => ({
  testId,
  candidateId: newId("cnd"),
  listRef: null,
  // Not the fixture's listed identity: a self-registration that reused
  // it would collide with the list row, which through the route cannot
  // happen (the gate binds such a candidate to that row and sets
  // `listRef`).
  externalId: "21EC0211",
  formValues: { full_name: "Ananya" },
  consentVersion: "2026-10-01",
  consentAt: T + 10,
  claims: [{ fieldId: "roll", valueHash: "a".repeat(64) }],
  entryTokenHash: newId("cnd"),
  entryKind: "run_entry",
  registration: {
    tokenHash: newId("cnd"),
    kind: "run_registration",
    payload: {},
    expiresAt: T + 60_000,
  },
  now: T + 10,
  ...over,
});

const listRow = async (): Promise<NonNullable<Awaited<ReturnType<typeof getCandidateByExternalId>>>> => {
  const row = await getCandidateByExternalId(db, ws, testId, "21CS0147");
  if (!row) throw new Error("the fixture list row is missing");
  return row;
};

it("fills the matched list row in place, leaving source and set_label alone", async () => {
  const row = await listRow();
  const result = await registerCandidate(
    db,
    ws,
    input({ candidateId: row.id, listRef: row.id, externalId: null }),
  );
  expect(result).toEqual({ candidateId: row.id });

  const filled = await listRow();
  expect(filled).toMatchObject({
    id: row.id,
    source: "list",
    setLabel: "A",
    consentVersion: "2026-10-01",
    registeredAt: T + 10,
  });
  expect(await listCandidates(db, ws, testId)).toHaveLength(1);
});

it("the in-place fill cannot rewrite a row that has already registered", async () => {
  const row = await listRow();
  await registerCandidate(
    db,
    ws,
    input({
      candidateId: row.id,
      listRef: row.id,
      externalId: null,
      formValues: { full_name: "Ananya", email: "ananya@vce.ac.in" },
    }),
  );
  const first = await listRow();

  // The route answers re-entry before reaching here, so this is the
  // race: two registrations for one listed identity arriving together.
  // Without `AND consent_at IS NULL` the loser overwrites the winner's
  // typed answers on the row their attempt already points at.
  await registerCandidate(
    db,
    ws,
    input({
      candidateId: row.id,
      listRef: row.id,
      externalId: null,
      formValues: { full_name: "Impostor", email: "impostor@vce.ac.in" },
      consentVersion: "9.9",
      consentAt: T + 99,
      claims: [{ fieldId: "roll", valueHash: "b".repeat(64) }],
    }),
  );

  expect(await listRow()).toEqual(first);
});

it("a duplicate claim writes nothing at all — no candidate, no second claim", async () => {
  const taken = { fieldId: "email", valueHash: "c".repeat(64) };
  const first = input({ claims: [taken] });
  expect(await registerCandidate(db, ws, first)).toEqual({ candidateId: first.candidateId });

  const second = input({ externalId: "21ME0088", claims: [taken] });
  expect(await registerCandidate(db, ws, second)).toEqual({
    taken: [{ fieldId: "email", candidateId: first.candidateId }],
  });

  // The whole batch rolled back: no row, no registration token, and the
  // entry token it would have spent is still live.
  expect(await getCandidateByExternalId(db, ws, testId, "21ME0088")).toBeNull();
  expect(
    await db.query("SELECT token_hash FROM auth_token WHERE token_hash = ?", [
      second.registration.tokenHash,
    ]),
  ).toEqual([]);
});

it("the entry token is spent in the same batch as the write", async () => {
  const one = input();
  await db.run(
    "INSERT INTO auth_token (token_hash, kind, payload_json, created_at, expires_at, used_at) " +
      "VALUES (?, 'run_entry', '{}', ?, ?, NULL)",
    [one.entryTokenHash, T, T + 60_000],
  );
  await registerCandidate(db, ws, one);
  const rows = await db.query<{ used_at: number | null }>(
    "SELECT used_at FROM auth_token WHERE token_hash = ?",
    [one.entryTokenHash],
  );
  expect(rows[0]?.used_at).toBe(T + 10);
});

it("a failure with no duplicate behind it is re-thrown rather than dressed as one", async () => {
  // A 409 invented for an error that was not a duplicate would tell a
  // candidate to change an answer that was fine.
  await expect(
    registerCandidate(db, ws, input({ claims: [], registration: { ...input().registration, kind: null as unknown as string } })),
  ).rejects.toThrow();
});
