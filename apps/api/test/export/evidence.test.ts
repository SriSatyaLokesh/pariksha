// Phase 8c Task 4 (`R-09`, `K1`, `K3`, `K4`, `#98`): the events CSV, the
// snapshot manifest, and `test.json` reached from a second, more permissive
// door — over the real routes, in the shape `export/results.test.ts`
// already established for the sibling CSVs.
//
// This file did not exist when `1dacfd9` (the killed implementer's commit)
// landed — the resume plan's first missing item. Everything here is new,
// written against the audited (and, in two places, corrected) draft in
// `src/export/evidence.ts` rather than trusting it.

import { afterAll, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createBank,
  createUser,
  newId,
  recordSnapshot,
  upsertQuestions,
  type TestDocumentBody,
} from "@pariksha/db";
import type { Question } from "@pariksha/core";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { exportEventsPage, exportSnapshotsPage, snapshotManifest } from "../../src/export/evidence.js";
import type { ExportPage, ExportPageOptions } from "../../src/export/results.js";
import { readDelimited } from "../../src/import/rows.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "../run/fixtures.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

// --- generic test plumbing (the shape `export/results.test.ts` uses) -------

const get = (cookie: string): RequestInit => ({ method: "GET", headers: { cookie } });

async function member(role: "viewer" | "reviewer", tag: string): Promise<string> {
  const userId = await createUser(deps.db, { email: `${role}-${tag}@evidence.test`, authProvider: "magic_link", now: FIXED_NOW });
  await addMembership(deps.db, workspaceId, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

const readCsv = (csv: string): string[][] => readDelimited(csv.replace(/^(\uFEFF)/, ""));

function headerAndRows(csv: string): { header: string[]; rows: string[][] } {
  const [header, ...rows] = readCsv(csv);
  if (!header) throw new Error("empty csv");
  return { header, rows };
}

/** The manifest carries one extra line above the ordinary header row —
 *  `K4`'s expiry comment (`evidence.ts`'s own `MANIFEST_HEADER_COMMENT`).
 *  Strip it (after the BOM) before `readDelimited` sees the real header, the
 *  same skip `docs/exports.md` documents for a real downloader. */
function manifestHeaderAndRows(csv: string): { header: string[]; rows: string[][] } {
  const withoutBom = csv.replace(/^(\uFEFF)/, "");
  const withoutComment = withoutBom.startsWith("#") ? withoutBom.slice(withoutBom.indexOf("\r\n") + 2) : withoutBom;
  return headerAndRows(withoutComment);
}

function cell(header: string[], row: string[], name: string): string {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`no "${name}" column (header: ${header.join(", ")})`);
  return row[idx] ?? "";
}

/** Pages through every `nextCursor` a page function hands back, concatenating
 *  the raw `csv` text — `export/results.test.ts`'s own `drain`, copied
 *  rather than imported (it is not exported, and a four-line helper is
 *  cheaper to repeat than to couple two test files over). */
async function drain(pageFn: (opts: ExportPageOptions) => Promise<ExportPage>, limit?: number): Promise<string> {
  let cursor: string | undefined;
  let csv = "";
  for (;;) {
    const page = await pageFn({ ...(limit !== undefined && { limit }), ...(cursor !== undefined && { cursor }) });
    csv += page.csv;
    if (page.nextCursor === null) return csv;
    cursor = page.nextCursor;
  }
}

/** Pages through a real route's `nextCursor`, the same way, but over HTTP —
 *  used by the permission and budget tests below, where the route's own
 *  guard and request parsing are what is under test, not the bare function. */
async function drainRoute(path: string, cookie: string): Promise<string> {
  const join = path.includes("?") ? "&" : "?";
  let cursor: string | undefined;
  let csv = "";
  for (;;) {
    const url = cursor === undefined ? path : `${path}${join}cursor=${encodeURIComponent(cursor)}`;
    const res = await app.request(url, get(cookie));
    expect(res.status, `${url} -> ${res.status}`).toBe(200);
    const page = (await res.json()) as ExportPage;
    csv += page.csv;
    if (page.nextCursor === null) return csv;
    cursor = page.nextCursor;
  }
}

async function dbEventCount(testId: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM event e " +
      "JOIN attempt a ON a.id = e.attempt_id " +
      "JOIN test_version tv ON tv.id = a.test_version_id " +
      "WHERE e.workspace_id = ? AND tv.test_id = ?",
    [workspaceId, testId],
  );
  return Number(rows[0]?.n ?? 0);
}

// --- fixtures ----------------------------------------------------------------

const workspaceId = await seedWorkspace(deps, "evidence", "Evidence Co");

const ownerId = await createUser(deps.db, { email: "owner@evidence.test", authProvider: "magic_link", now: FIXED_NOW });
const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
await addMembership(deps.db, workspaceId, { userId: ownerId, role: "owner", now: FIXED_NOW });
// `results.export` and not `attempts.read_evidence` (`permissions.ts`) — the
// real boundary this task's permission pair exercises.
const viewerCookie = await member("viewer", "v");
// Both `results.export` and `attempts.read_evidence` — the control beside
// every 403 below.
const reviewerCookie = await member("reviewer", "r");

// One real question, so `test.json`'s `exportTest` has something to resolve
// (`schemas/test-1.json` requires `sections.minItems: 1`, and a `fixed`
// section's question ids must resolve through `workspaceQuestions` or
// `toTestDocument` throws) — `export/results.test.ts`'s own fixtures never
// needed this because neither CSV route it covers ever reads a question row.
const bankId = await createBank(deps.db, workspaceId, { name: "Evidence bank", now: FIXED_NOW });
const questionDoc: Question = {
  id: "q1",
  type: "single",
  prompt: "Pick",
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  key: "a",
  scoring: { points: 1 },
};
const { ids: questionIds } = await upsertQuestions(deps.db, workspaceId, bankId, [questionDoc], FIXED_NOW);
const questionId = questionIds[0] as string;

const openWindow = { opens_at: iso(FIXED_NOW - DAY), closes_at: iso(FIXED_NOW + DAY) };
const smallBody: TestDocumentBody = {
  settings: {
    timing: { duration_minutes: 45, navigation: "free", ...openWindow },
    access: { mode: "link_code", access_code: "OPEN" },
    registration_form: { fields: [{ id: "roll", type: "short_text", label: "Roll", required: true }] },
  },
  sections: [{ id: "s1", title: "Section", source: { kind: "fixed", questions: [questionId] } }],
};
const smallTestId = await seedTest(deps, workspaceId, { name: "Small", slug: "small", body: smallBody });

const versionRows = await deps.db.query<{ id: string }>(
  "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
  [smallTestId],
);
const smallVersionId = versionRows[0]!.id;

async function candidateIn(testId: string, roll: string): Promise<string> {
  const id = newId("cnd");
  await deps.db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, NULL, NULL, 'registration', ?, NULL, NULL, ?)",
    [id, workspaceId, testId, JSON.stringify({ roll }), FIXED_NOW],
  );
  return id;
}

async function seedAttempt(candidateId: string, testVersionId: string, startedAt: number): Promise<string> {
  const id = newId("att");
  await deps.db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash) " +
      "VALUES (?, ?, ?, ?, 1, '{}', ?, ?, NULL, NULL, NULL, 'clean', ?)",
    [id, workspaceId, candidateId, testVersionId, startedAt, startedAt + 45 * 60_000, `hash-${id}`],
  );
  return id;
}

async function seedEvent(attemptId: string, type: string, serverTs: number, detail: unknown = null): Promise<void> {
  await deps.db.run(
    "INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [newId("evt"), workspaceId, attemptId, type, detail === null ? null : JSON.stringify(detail), serverTs, serverTs],
  );
}

/** `proctoring.ts`'s own key shape (`snapshot/<attemptId>/<takenAt>-<reason>.jpg`)
 *  — `snapshotPrefix`'s existence check only works if a test's fixture keys
 *  match production, so this is not an arbitrary test string. */
const snapshotKey = (attemptId: string, takenAt: number, reason: string): string =>
  `snapshot/${attemptId}/${String(takenAt)}-${reason}.jpg`;

/** Writes the `snapshot` row always, and the R2 object only when `live`
 *  (default true) — `live: false` models Phase 8e's retention sweep having
 *  already removed the object while the row survives (`sweep.ts`'s own
 *  "object first, row second" ordering: a crash between the two leaves
 *  exactly this state). */
async function seedSnapshot(
  attemptId: string,
  takenAt: number,
  reason: string,
  opts: { live?: boolean } = {},
): Promise<string> {
  const key = snapshotKey(attemptId, takenAt, reason);
  if (opts.live ?? true) {
    await deps.storage.put(key, new Uint8Array([1]), { contentType: "image/jpeg" });
  }
  await recordSnapshot(deps.db, workspaceId, { attemptId, storageKey: key, takenAt, reason });
  return key;
}

const c1 = await candidateIn(smallTestId, "R1");
const a1 = await seedAttempt(c1, smallVersionId, FIXED_NOW);
const c2 = await candidateIn(smallTestId, "R2");
const a2 = await seedAttempt(c2, smallVersionId, FIXED_NOW + 1);
const c3 = await candidateIn(smallTestId, "R3");
const a3 = await seedAttempt(c3, smallVersionId, FIXED_NOW + 2);

// a1's own small event cohort — enough to force more than one page at a
// small `limit`, without the 300-row scale the per-answer CSV needs (that
// scale exists to probe D1's bound-parameter cap on an `IN (...)` read;
// `listEventsForTest` has no such read — one `LIMIT` statement per page
// regardless of cohort size — so a page-boundary proof needs only enough
// rows to span more than one page).
const SMALL_EVENT_COUNT = 10;
for (let i = 0; i < SMALL_EVENT_COUNT; i += 1) {
  await seedEvent(a1, i % 2 === 0 ? "fullscreen_exit" : "tab_blur", FIXED_NOW + i, { n: i });
}

// a2: one live snapshot, `face_count` left `null` by `recordSnapshot` itself
// (`K1` — never a caller's job to fabricate a number).
const a2Key = await seedSnapshot(a2, FIXED_NOW + 10_000, "interval");
// a3: one dead snapshot — the row survives, the object does not.
const a3Key = await seedSnapshot(a3, FIXED_NOW + 20_000, "violation", { live: false });

// =============================================================================
// The events CSV (`R-09`)
// =============================================================================

it("carries attempt, candidate, type, detail and both timestamps — telemetry, nothing `KG1` governs", async () => {
  const csv = await drain((opts) => exportEventsPage(deps, workspaceId, smallTestId, opts));
  const { header, rows } = headerAndRows(csv);
  expect(header).toEqual(["Attempt", "Candidate", "Type", "Detail", "Client time", "Server time"]);
  const row = rows.find((r) => cell(header, r, "Attempt") === a1 && cell(header, r, "Detail").includes('"n":0'));
  if (!row) throw new Error("no row for a1's first event");
  expect(cell(header, row, "Candidate")).toBe(c1);
  expect(cell(header, row, "Type")).toBe("fullscreen_exit");
});

// --- the truncation probe (resume plan step 3) ------------------------------

it("a single capped page undercounts the whole test's events — the trap the cursor contract exists to prevent", async () => {
  // Cap it, drop the cursor: read exactly one page at a limit far below the
  // real total, the way a caller that ignores `nextCursor` would.
  const total = await dbEventCount(smallTestId);
  const capped = await exportEventsPage(deps, workspaceId, smallTestId, { limit: 4 });
  const { rows } = headerAndRows(capped.csv);
  expect(rows).toHaveLength(4);
  expect(rows).not.toHaveLength(total);
  // `K38`: a filled page always carries a cursor — the one signal that
  // tells a real caller there is more to read.
  expect(capped.nextCursor).not.toBeNull();
});

it("restored: draining every page recovers exactly what the probe above lost", async () => {
  const total = await dbEventCount(smallTestId);
  expect(total).toBe(SMALL_EVENT_COUNT);
  const csv = await drain((opts) => exportEventsPage(deps, workspaceId, smallTestId, opts), 4);
  expect(headerAndRows(csv).rows).toHaveLength(total);
});

it("always returns a cursor when the events route fills a page", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/events.csv?limit=4`,
    get(reviewerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(((await res.json()) as ExportPage).nextCursor).not.toBeNull();
});

it("R-10's filename shape for the events file", async () => {
  const page = await exportEventsPage(deps, workspaceId, smallTestId, {});
  expect(page.filename).toMatch(/^small_events_\d{8}-\d{4}\.csv$/);
});

// --- permission pair: Viewer (results.export only) vs Reviewer (both) ------

it("refuses a Viewer, who holds results.export and not attempts.read_evidence", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/events.csv`, get(viewerCookie));
  expect(res.status).toBe(403);
});

it("admits a Reviewer, who holds both — the 200 beside the 403 above", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/events.csv`, get(reviewerCookie));
  expect(res.status).toBe(200);
});

it("is declared with the workspace authority and the attempts.read_evidence action", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/export/events.csv"]).toBe("attempts.read_evidence");
});

it("measures the real subrequest cost of the events route, flat in event count", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/events.csv?limit=${SMALL_EVENT_COUNT}`,
    get(ownerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const path = "/api/v1/workspaces/:id/tests/:testId/export/events.csv";
  expect(counting.counts().total, path).toBe(ROUTE_BUDGETS[path]);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});

// =============================================================================
// The snapshot manifest (`K3`, `K4`, `K1`)
// =============================================================================

it("renders a null face_count as 'not counted', never 0", async () => {
  const csv = await drain((opts) => exportSnapshotsPage(deps, workspaceId, smallTestId, opts));
  expect(csv).toContain("not counted");
  expect(csv).not.toMatch(/,0,/);
});

it("states the URL expiry in the file", async () => {
  const csv = await drain((opts) => exportSnapshotsPage(deps, workspaceId, smallTestId, opts));
  expect(csv).toMatch(/expire/i);
});

it("marks a row whose object retention already swept, rather than handing out a dead URL", async () => {
  const csv = await drain((opts) => exportSnapshotsPage(deps, workspaceId, smallTestId, opts));
  const { header, rows } = manifestHeaderAndRows(csv);
  const deadRow = rows.find((r) => cell(header, r, "Attempt") === a3);
  if (!deadRow) throw new Error("no row for a3 (the dead snapshot)");
  expect(cell(header, deadRow, "Status")).toMatch(/deleted|unavailable/i);
  expect(cell(header, deadRow, "URL")).toBe("");

  const liveRow = rows.find((r) => cell(header, r, "Attempt") === a2);
  if (!liveRow) throw new Error("no row for a2 (the live snapshot)");
  expect(cell(header, liveRow, "Status")).toBe("ok");
  expect(cell(header, liveRow, "URL")).not.toBe("");
  expect(cell(header, liveRow, "Face count")).toBe("not counted");
});

it("checks existence with one list per attempt's prefix, never one get per key", async () => {
  // a2Key/a3Key: confirms the fixture itself actually wrote what the test
  // above reads, rather than trusting the seed helper silently.
  expect(a2Key).toContain(`snapshot/${a2}/`);
  expect(a3Key).toContain(`snapshot/${a3}/`);
  const counting = countingDeps(deps);
  await snapshotManifest(counting.deps, workspaceId, { attemptIds: [a1, a2, a3] });
  // `list` is the only storage call this flow makes (no snapshots on a1 at
  // all — zero rows, zero cost); one per attempt that has at least one
  // snapshot, not per snapshot.
  expect(counting.counts().storage).toBeLessThanOrEqual(3);
});

// --- the storage budget correction (resume plan's own ruling) --------------
//
// The brief's first test asserted `counts().storage` is `0`; its fifth
// asserted `<= attemptIds.length`. Both cannot hold once the existence
// check (`K3`) exists — `list` costs one storage subrequest, by
// `instrument.ts`'s own accounting. What is actually true, proved below
// instead: `signedUrl` issues no `get` (the object is never read, only
// listed), and the `list` cost is flat in how many *snapshots* an attempt
// has, not just flat in attempt count — a single attempt with five
// snapshots costs the same one `list` as an attempt with one.

// A dedicated test — not `smallTestId` — so the route's worst-case budget
// test sees exactly what `ROUTE_BUDGETS`' comment measures: a page where
// every attempt has at least one snapshot. Mixed in with `a1` (zero
// snapshots) the first page would cost one `list` less than the stated
// worst case, which is a fixture bug, not a budget regression — found by
// running this file once before splitting the cohort out (RED, see report).
const manyTestId = await seedTest(deps, workspaceId, { name: "Many", slug: "many", body: smallBody });
const manyVersionRows = await deps.db.query<{ id: string }>(
  "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
  [manyTestId],
);
const manyVersionId = manyVersionRows[0]!.id;

const MANY_SNAPSHOTS_PER_ATTEMPT = 5;
const SIXTY = 60;
const sixtyAttemptIds: string[] = [];
{
  const statements: { sql: string; params: unknown[] }[] = [];
  for (let i = 0; i < SIXTY; i += 1) {
    const candidateId = newId("cnd");
    statements.push({
      sql:
        "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
        "VALUES (?, ?, ?, NULL, NULL, 'registration', ?, NULL, NULL, ?)",
      params: [candidateId, workspaceId, manyTestId, JSON.stringify({ roll: `S${i}` }), FIXED_NOW],
    });
    const attemptId = newId("att");
    sixtyAttemptIds.push(attemptId);
    statements.push({
      sql:
        "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
        "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash) " +
        "VALUES (?, ?, ?, ?, 1, '{}', ?, ?, NULL, NULL, NULL, 'clean', ?)",
      params: [attemptId, workspaceId, candidateId, manyVersionId, FIXED_NOW + i, FIXED_NOW + i + 45 * 60_000, `hash-${attemptId}`],
    });
    for (let s = 0; s < MANY_SNAPSHOTS_PER_ATTEMPT; s += 1) {
      const takenAt = FIXED_NOW + i * 1000 + s;
      statements.push({
        sql: "INSERT INTO snapshot (id, workspace_id, attempt_id, storage_key, taken_at, reason, face_count) VALUES (?, ?, ?, ?, ?, 'interval', NULL)",
        params: [newId("snp"), workspaceId, attemptId, snapshotKey(attemptId, takenAt, "interval"), takenAt],
      });
    }
  }
  await deps.db.batch(statements);
  // The objects themselves — not batchable (`StorageAdapter` has no batch
  // op), and cheap on the in-memory adapter this suite runs against.
  for (const attemptId of sixtyAttemptIds) {
    for (let s = 0; s < MANY_SNAPSHOTS_PER_ATTEMPT; s += 1) {
      const takenAt = FIXED_NOW + sixtyAttemptIds.indexOf(attemptId) * 1000 + s;
      await deps.storage.put(snapshotKey(attemptId, takenAt, "interval"), new Uint8Array([1]), { contentType: "image/jpeg" });
    }
  }
}

it("mints a presigned URL per snapshot without ever reading the object itself", async () => {
  const counting = countingDeps(deps);
  let getCalls = 0;
  const spiedStorage = { ...counting.deps.storage, get: async (key: string) => {
    getCalls += 1;
    return counting.deps.storage.get(key);
  } };
  const rows = await snapshotManifest({ ...counting.deps, storage: spiedStorage }, workspaceId, { attemptIds: sixtyAttemptIds });
  expect(rows).toHaveLength(SIXTY * MANY_SNAPSHOTS_PER_ATTEMPT);
  expect(getCalls).toBe(0);
});

it("the list cost is flat in snapshots per attempt, not just in attempt count", async () => {
  const counting = countingDeps(deps);
  await snapshotManifest(counting.deps, workspaceId, { attemptIds: sixtyAttemptIds });
  // 60 attempts × 5 snapshots each = 300 rows, but one `list` per attempt —
  // the property `K3` exists for: checking existence never costs one
  // subrequest per *snapshot*.
  expect(counting.counts().storage).toBe(SIXTY);
});

it("stays inside the ceiling on one page of the snapshot route's worst case", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/tests/${manyTestId}/export/snapshots.csv?limit=20`,
    get(ownerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
  const path = "/api/v1/workspaces/:id/tests/:testId/export/snapshots.csv";
  expect(counting.counts().total, path).toBe(ROUTE_BUDGETS[path]);
});

it("pages over attempts without truncating a cohort larger than one page", async () => {
  const csv = await drain((opts) => exportSnapshotsPage(deps, workspaceId, manyTestId, opts), 20);
  const { rows } = manifestHeaderAndRows(csv);
  expect(rows).toHaveLength(SIXTY * MANY_SNAPSHOTS_PER_ATTEMPT);
});

it("R-10's filename shape for the snapshot manifest", async () => {
  const page = await exportSnapshotsPage(deps, workspaceId, smallTestId, {});
  expect(page.filename).toMatch(/^small_snapshots_\d{8}-\d{4}\.csv$/);
});

// --- permission pair, same boundary as events.csv ---------------------------

it("refuses a Viewer on the snapshot manifest too", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/snapshots.csv`, get(viewerCookie));
  expect(res.status).toBe(403);
});

it("admits a Reviewer on the snapshot manifest — the 200 beside the 403 above", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/snapshots.csv`, get(reviewerCookie));
  expect(res.status).toBe(200);
});

it("is declared with the workspace authority and the attempts.read_evidence action", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/export/snapshots.csv"]).toBe("attempts.read_evidence");
});

// =============================================================================
// `test.json`: the existing export, reached from `results.export`
// =============================================================================

it("serves the test definition to a Viewer, who cannot reach the tests.edit route", async () => {
  const jsonRes = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/test.json`, get(viewerCookie));
  expect(jsonRes.status, await jsonRes.clone().text()).toBe(200);
  const doc = (await jsonRes.json()) as { format: string };
  expect(doc.format).toBe("pariksha/test@1");

  const editRes = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export`, get(viewerCookie));
  expect(editRes.status).toBe(403);
});

it("is declared with the workspace authority and the results.export action", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/export/test.json"]).toBe("results.export");
});

// --- a quiet sanity check that `drainRoute` is exercised somewhere ----------
// (the helper mirrors how a real client would page the evidence routes over
// HTTP, not just through the bare function, for at least one case of each).

it("drains the events route over HTTP exactly as the bare function does", async () => {
  const overHttp = await drainRoute(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/events.csv?limit=4`, reviewerCookie);
  const overFunction = await drain((opts) => exportEventsPage(deps, workspaceId, smallTestId, opts), 4);
  expect(headerAndRows(overHttp).rows).toHaveLength(headerAndRows(overFunction).rows.length);
});
