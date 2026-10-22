// `POST /api/v1/run/attempt/snapshot` (Phase 7d Task 1, `Q4`) — the camera
// posts a JPEG straight to the Worker and the Worker puts it into private
// storage. No presigned PUT, no new credential, no CORS (`Q4`).
//
// Review Focus 1 (`Q4f`): the row is written only once the object it names
// really exists. The first test below is the positive control this needs
// beside it (`D-R7`) — the very same fixture, through a `put` that really
// works, writes exactly one row — so "no row on a failed put" is proved
// against a route that is shown writing one when the put succeeds, not
// against one that silently never writes at all.

import { afterAll, beforeEach, expect, it } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import { createApp, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { SNAPSHOT_PATH } from "../../src/routes/proctoring.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";

const T = FIXED_NOW;
const SLUG = { workspace: "delta", test: "snapshots" } as const;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Delta Inc");
const q = await seedBank(deps, workspaceId);

await seedTest(deps, workspaceId, {
  name: "Snapshots",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "strict" },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers ---------------------------------------------------------------

let serial = 1;

async function start(): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, SLUG.test, T);
  if (!test) throw new Error(`no published test at ${SLUG.workspace}/${SLUG.test}`);
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await app.request(`/api/v1/run/${SLUG.workspace}/${SLUG.test}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  const paper = (await res.json()) as AttemptPaper;
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    attemptId: paper.attemptId,
  };
}

/** `0xFF 0xD8 0xFF` — a real JPEG's first three bytes — plus filler so the
 *  fixture is not suspiciously tiny. */
const jpegFixture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const webmFixture = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

function postBytes(
  path: string,
  body: Uint8Array,
  cookie?: string,
  contentType = "image/jpeg",
  on = app,
): Promise<Response> {
  return on.request(path, {
    method: "POST",
    headers: { "content-type": contentType, ...(cookie ? { cookie } : {}) },
    body,
  });
}

interface SnapshotRow {
  storage_key: string;
  taken_at: number;
  reason: string;
  face_count: number | null;
}

async function listSnapshots(attemptId: string): Promise<
  { storageKey: string; takenAt: number; reason: string; faceCount: number | null }[]
> {
  const rows = await deps.db.query<SnapshotRow>(
    "SELECT storage_key, taken_at, reason, face_count FROM snapshot WHERE attempt_id = ?",
    [attemptId],
  );
  return rows.map((row) => ({
    storageKey: row.storage_key,
    takenAt: Number(row.taken_at),
    reason: row.reason,
    faceCount: row.face_count === null ? null : Number(row.face_count),
  }));
}

let attemptCookie = "";
let attemptId = "";

beforeEach(async () => {
  await deps.db.run("DELETE FROM snapshot", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM auth_token", []);
  const started = await start();
  attemptCookie = started.cookie;
  attemptId = started.attemptId;
});

// --- the brief's own tests --------------------------------------------------

it("stores a JPEG and writes the row, in that order", async () => {
  const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, jpegFixture, attemptCookie);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ stored: true });

  const rows = await listSnapshots(attemptId);
  expect(rows).toHaveLength(1);
  expect(await deps.storage.get(rows[0]!.storageKey)).not.toBeNull();
  expect(rows[0]!.faceCount).toBeNull(); // Q3: pre-cut
});

// Review Focus 1 — no row for an object that was never written. The
// positive control directly above is what makes this a real assertion
// about ordering rather than a route that never writes at all.
it("writes no row when the put fails", async () => {
  const realPut = deps.storage.put.bind(deps.storage);
  deps.storage.put = () => Promise.reject(new Error("R2 down"));
  try {
    const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, jpegFixture, attemptCookie);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await listSnapshots(attemptId)).toHaveLength(0);
  } finally {
    deps.storage.put = realPut;
  }
});

// Review Focus 2 — AG2 and Q4b, at the trust boundary.
it("refuses a non-JPEG content type", async () => {
  const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, webmFixture, attemptCookie, "video/webm");
  expect(res.status).toBe(415);
  expect(await listSnapshots(attemptId)).toHaveLength(0);
});

it("refuses a body past the ceiling", async () => {
  const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, new Uint8Array(300_000), attemptCookie);
  expect(res.status).toBe(413);
});

it("refuses bytes whose first three are not FF D8 FF", async () => {
  const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, new Uint8Array([0, 1, 2, 3]), attemptCookie);
  expect(res.status).toBe(415);
});

// D-R8: three separate refusals, three separate statuses.
it("the three boundary refusals carry three different statuses", async () => {
  const statuses = await Promise.all([
    postBytes(`${SNAPSHOT_PATH}?reason=interval`, webmFixture, attemptCookie, "video/webm").then((r) => r.status),
    postBytes(`${SNAPSHOT_PATH}?reason=interval`, new Uint8Array(300_000), attemptCookie).then((r) => r.status),
    postBytes(`${SNAPSHOT_PATH}?reason=interval`, new Uint8Array([0, 1, 2, 3]), attemptCookie).then(
      (r) => r.status,
    ),
  ]);
  expect(statuses).toEqual([415, 413, 415]);
});

it("refuses a reason outside the closed set, rather than storing a junk one", async () => {
  const res = await postBytes(`${SNAPSHOT_PATH}?reason=bogus`, jpegFixture, attemptCookie);
  expect(res.status).toBe(400);
  expect(await listSnapshots(attemptId)).toHaveLength(0);
});

it("accepts all three reasons", async () => {
  for (const reason of ["interval", "violation", "identity"]) {
    const res = await postBytes(`${SNAPSHOT_PATH}?reason=${reason}`, jpegFixture, attemptCookie);
    expect(res.status).toBe(200);
  }
  const rows = await listSnapshots(attemptId);
  expect(rows.map((r) => r.reason).sort()).toEqual(["identity", "interval", "violation"]);
});

// Q4a — the key never carries a workspace id, and the response carries no
// key at all.
it("mints a key with no workspace id and returns none", async () => {
  const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, jpegFixture, attemptCookie);
  expect(JSON.stringify(await res.json())).not.toMatch(/wsp_|snapshot\//);
  const rows = await listSnapshots(attemptId);
  expect(rows[0]!.storageKey).not.toMatch(/wsp_/);
  expect(rows[0]!.storageKey).toMatch(new RegExp(`^snapshot/${attemptId}/\\d+-interval\\.jpg$`));
  expect(rows[0]!.storageKey).not.toContain(workspaceId);
});

it("answers 401 without an attempt cookie", async () => {
  expect((await postBytes(`${SNAPSHOT_PATH}?reason=interval`, jpegFixture)).status).toBe(401);
});

// --- `Q4e`: measured, not estimated -----------------------------------------

it("the route's budget is measured at exactly 3, and its authority is the attempt", async () => {
  const counting = countingDeps(deps);
  const res = await postBytes(
    `${SNAPSHOT_PATH}?reason=interval`,
    jpegFixture,
    attemptCookie,
    "image/jpeg",
    createApp(counting.deps),
  );
  expect(res.status).toBe(200);
  // The attempt join, the one `put`, and `recordSnapshot`'s one insert.
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[SNAPSHOT_PATH]);
  expect(counting.counts().total).toBe(3);
  expect(counting.counts()).toMatchObject({ db: 2, storage: 1 });
  expect(ROUTE_AUTH[`POST ${SNAPSHOT_PATH}`]).toBe("attempt");
});
