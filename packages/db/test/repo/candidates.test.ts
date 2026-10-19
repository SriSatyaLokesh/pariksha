// The candidate list (Task 9, #60 / #56, P5.7b).

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import {
  countCandidates,
  createTest,
  createWorkspace,
  getCandidateByExternalId,
  listCandidates,
  replaceCandidateList,
  type NewCandidate,
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
});

const listed = (externalId: string, setLabel: string | null): NewCandidate => ({
  externalId,
  setLabel,
  formValues: { full_name: externalId },
});

/**
 * A row a candidate wrote for themselves. Phase 5 writes no
 * `source: "registration"` row — Phase 6 does, when a candidate registers
 * — so this inserts one directly, which is the one place in this phase a
 * test may bypass a production path: the production path is a phase away,
 * and this is exactly what a re-upload must not destroy.
 */
async function insertRegisteredRow(externalId: string): Promise<void> {
  await db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, " +
      "form_values_json, consent_version, created_at) VALUES (?, ?, ?, ?, NULL, 'registration', ?, '1.0', ?)",
    [newId("cnd"), ws, testId, externalId, db.jsonParam({}), T - 1],
  );
}

it("replaceCandidateList replaces only the rows it owns", async () => {
  await replaceCandidateList(db, ws, testId, [listed("21CS0147", "A"), listed("21CS0162", "B")], T);
  await insertRegisteredRow("21ME0088");

  await replaceCandidateList(db, ws, testId, [listed("21EC0211", "A")], T + 1);

  expect((await listCandidates(db, ws, testId)).map((r) => [r.externalId, r.source])).toEqual([
    ["21ME0088", "registration"],
    ["21EC0211", "list"],
  ]);
});

it("a re-upload of the same file is idempotent rather than a duplicate-key failure", async () => {
  const rows = [listed("21CS0147", "A"), listed("21CS0162", "B")];
  await replaceCandidateList(db, ws, testId, rows, T);
  await expect(replaceCandidateList(db, ws, testId, rows, T + 1)).resolves.toEqual({ imported: 2 });
  expect(await listCandidates(db, ws, testId)).toHaveLength(2);
});

it("a listed candidate carries their prefill, their set and no consent version", async () => {
  await replaceCandidateList(db, ws, testId, [listed("21CS0147", "A")], T);

  expect((await listCandidates(db, ws, testId))[0]).toMatchObject({
    externalId: "21CS0147",
    setLabel: "A",
    source: "list",
    formValues: { full_name: "21CS0147" },
    // Listed, not yet registered. The column was NOT NULL until this task.
    consentVersion: null,
    createdAt: T,
  });
});

it("countCandidates reports the total and how many have no set, in one query", async () => {
  await replaceCandidateList(
    db,
    ws,
    testId,
    [listed("21CS0147", "A"), listed("21CS0162", "B"), listed("21EC0211", null)],
    T,
  );
  expect(await countCandidates(db, ws, testId)).toEqual({ total: 3, withoutSet: 1 });
});

it("countCandidates answers zero for a test with no list at all", async () => {
  expect(await countCandidates(db, ws, testId)).toEqual({ total: 0, withoutSet: 0 });
});

it("getCandidateByExternalId is the lookup Phase 6's invite_only gate uses", async () => {
  await replaceCandidateList(db, ws, testId, [listed("21CS0147", "A")], T);

  expect(await getCandidateByExternalId(db, ws, testId, "21CS0147")).toMatchObject({ setLabel: "A" });
  expect(await getCandidateByExternalId(db, ws, testId, "21CS9999")).toBeNull();
});

it("listCandidates filters by source, which is how a re-upload knows what it owns", async () => {
  await replaceCandidateList(db, ws, testId, [listed("21CS0147", "A")], T);
  await insertRegisteredRow("21ME0088");

  expect((await listCandidates(db, ws, testId, { source: "list" })).map((r) => r.externalId)).toEqual(["21CS0147"]);
  expect((await listCandidates(db, ws, testId, { source: "registration" })).map((r) => r.externalId)).toEqual([
    "21ME0088",
  ]);
});

it("S-09: a candidate list in another workspace is not found", async () => {
  await replaceCandidateList(db, ws, testId, [listed("21CS0147", "A")], T);

  const other = newId("wsp");
  await createWorkspace(db, other, { slug: `o-${other.slice(4)}`, name: "O" });

  expect(await listCandidates(db, other, testId)).toEqual([]);
  expect(await countCandidates(db, other, testId)).toEqual({ total: 0, withoutSet: 0 });
  expect(await getCandidateByExternalId(db, other, testId, "21CS0147")).toBeNull();
});

it("S-09: a replace from another workspace deletes nothing and writes nothing readable here", async () => {
  await replaceCandidateList(db, ws, testId, [listed("21CS0147", "A")], T);

  const other = newId("wsp");
  await createWorkspace(db, other, { slug: `o2-${other.slice(4)}`, name: "O2" });
  await replaceCandidateList(db, other, testId, [], T + 1);

  expect((await listCandidates(db, ws, testId)).map((r) => r.externalId)).toEqual(["21CS0147"]);
});
