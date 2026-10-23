// Phase 8c Task 3 (`R-08`, `R-10`, `K38`, `#97`): the results CSV, over the
// real routes.
//
// The headline property is `K38`: a route that reached its page bound
// always returns a cursor, and a cohort drained page by page must lose no
// rows — the row-count tests below compare against **this file's own
// fixture bookkeeping** (how many candidates/responses it actually wrote),
// not a second database read, because the thing under test must not also
// be the thing proving it. `BIG_COHORT` is really 300 candidates and really
// 60 questions each — asserted below, not just named that way (the trap a
// sibling task shipped this phase: a hardcoded page clamp a smaller fixture
// never reached).

import { afterAll, expect, it } from "vitest";
import { addMembership, closeClient, createUser, newId, recordVerdict, type TestDocumentBody } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { exportAnswersPage, exportResultsPage, type ExportPage, type ExportPageOptions } from "../../src/export/results.js";
import { readDelimited } from "../../src/import/rows.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "../run/fixtures.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

// --- generic test plumbing -------------------------------------------------

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const get = (cookie: string): RequestInit => send("GET", cookie);
const withKey = (secret: string): RequestInit => ({ headers: { authorization: `Bearer ${secret}` } });

async function member(workspaceId: string, role: "author" | "viewer", tag: string): Promise<string> {
  const userId = await createUser(deps.db, { email: `${role}-${tag}@numbers.test`, authProvider: "magic_link", now: FIXED_NOW });
  await addMembership(deps.db, workspaceId, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

async function createKey(workspaceId: string, ownerCookie: string, scopes: string[]): Promise<string> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/keys`,
    send("POST", ownerCookie, { name: `key-${scopes.join("-")}`, scopes }),
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { secret: string }).secret;
}

/** Strips the BOM `toCsv` stamps on a page's `bom: true` call before
 *  `readDelimited` (apps/api/src/import/rows.ts) parses it — the reader
 *  does not strip it itself, exactly as the task brief's own test
 *  snippets do by hand. */
const readCsv = (csv: string): string[][] => readDelimited(csv.replace(/^\uFEFF/, ""));

/** Pages through every `nextCursor` a page function hands back, in cursor
 *  order, concatenating the raw `csv` text — later pages carry no header or
 *  BOM of their own (`toCsv`'s own contract), so the result is one
 *  well-formed file. */
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

async function versionIdOf(testId: string): Promise<string> {
  const rows = await deps.db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
    [testId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no published version for ${testId}`);
  return row.id;
}

async function candidateIn(testId: string, formValues: Record<string, unknown> = {}): Promise<string> {
  const id = newId("cnd");
  await deps.db.run(
    "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
      "VALUES (?, ?, ?, NULL, NULL, 'registration', ?, NULL, NULL, ?)",
    [id, workspaceId, testId, JSON.stringify(formValues), FIXED_NOW],
  );
  return id;
}

interface AttemptSeed {
  candidateId: string;
  testVersionId: string;
  startedAt: number;
  submittedAt?: number | null;
  scoreJson?: unknown;
  violations?: number;
  observed?: boolean;
  flag?: string;
  integrityFlag?: string;
  lockedAt?: number | null;
}

async function seedAttempt(seed: AttemptSeed): Promise<string> {
  const id = newId("att");
  await deps.db.run(
    "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
      "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
      "integrity_flag, observed, locked_at) VALUES (?, ?, ?, ?, 1, '{}', ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)",
    [
      id,
      workspaceId,
      seed.candidateId,
      seed.testVersionId,
      seed.startedAt,
      seed.startedAt + 45 * 60_000,
      seed.submittedAt ?? null,
      seed.submittedAt == null ? null : "candidate",
      seed.scoreJson === undefined ? null : JSON.stringify(seed.scoreJson),
      seed.flag ?? "clean",
      `hash-${id}`,
      seed.integrityFlag ?? "clean",
      seed.observed ? 1 : 0,
      seed.lockedAt ?? null,
    ],
  );
  for (let v = 0; v < (seed.violations ?? 0); v += 1) {
    await deps.db.run(
      "INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) " +
        "VALUES (?, ?, ?, 'fullscreen_exit', NULL, ?, ?)",
      [newId("evt"), workspaceId, id, FIXED_NOW, FIXED_NOW],
    );
  }
  return id;
}

async function respond(attemptId: string, questionId: string, value: unknown): Promise<void> {
  await deps.db.run(
    "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL)",
    [newId("rsp"), workspaceId, attemptId, questionId, JSON.stringify(value), FIXED_NOW],
  );
}

function headerAndRows(csv: string): { header: string[]; rows: string[][] } {
  const [header, ...rows] = readCsv(csv);
  if (!header) throw new Error("empty csv");
  return { header, rows };
}

function cell(header: string[], row: string[], name: string): string {
  const idx = header.indexOf(name);
  if (idx === -1) throw new Error(`no "${name}" column (header: ${header.join(", ")})`);
  return row[idx] ?? "";
}

/** The results CSV is organised by candidate and names no attempt id
 *  explicitly (`R-08` carries no such column) — so a row is found back by
 *  its registration `Roll`, which this file gives each small-cohort
 *  candidate a distinct value for (`ATTEMPT_ROLL` below). */
const ATTEMPT_ROLL = new Map<string, string>();
function rowOf(header: string[], rows: string[][], attemptId: string): string[] {
  const roll = ATTEMPT_ROLL.get(attemptId);
  if (roll === undefined) throw new Error(`no seeded roll for ${attemptId}`);
  const row = rows.find((r) => cell(header, r, "Roll") === roll);
  if (!row) throw new Error(`no row for ${attemptId} (roll ${roll})`);
  return row;
}

// --- fixtures ---------------------------------------------------------------

const workspaceId = await seedWorkspace(deps, "numbers", "Numbers Co");

const ownerId = await createUser(deps.db, { email: "owner@numbers.test", authProvider: "magic_link", now: FIXED_NOW });
const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
// `seedWorkspace` writes the row directly, so the owner still needs a real
// membership for `requires()` to find — `createWorkspace` would have minted
// one, this path has to add it itself.
await addMembership(deps.db, workspaceId, { userId: ownerId, role: "owner", now: FIXED_NOW });
const authorCookie = await member(workspaceId, "author", "a"); // holds neither results.export nor keys.manage
const viewerCookie = await member(workspaceId, "viewer", "v"); // holds results.export (permissions.ts)

const keyWithScope = await createKey(workspaceId, ownerCookie, ["results.export"]);
const keyWithoutScope = await createKey(workspaceId, ownerCookie, ["tests.edit"]);

const openWindow = { opens_at: iso(FIXED_NOW - DAY), closes_at: iso(FIXED_NOW + DAY) };

// A small, fully hand-placed cohort for every behavioural assertion:
// duplicate labels, the 7e lock/integrity pair, a reviewer verdict, and
// rank across pages. `KG1` itself — a real sentinel question bank, scanned
// for leakage — lives in `apps/api/test/export/scrub-scan.test.ts`; this
// file's own candidates answer in plain text, never text standing in for a
// key, so there is nothing here that would make a "never contains X"
// assertion meaningful on its own.

const smallBody: TestDocumentBody = {
  settings: {
    timing: { duration_minutes: 45, navigation: "free", ...openWindow },
    access: { mode: "link_code", access_code: "OPEN1" },
    registration_form: {
      fields: [
        { id: "roll", type: "short_text", label: "Roll", required: true },
        // The duplicate-header case: two fields, one label.
        { id: "phone_personal", type: "short_text", label: "Phone" },
        { id: "phone_work", type: "short_text", label: "Phone" },
      ],
    },
  },
  sections: [
    { id: "s1", title: "Logic", source: { kind: "fixed", questions: ["qst_0", "qst_1"] } },
    { id: "s2", title: "Verbal", source: { kind: "fixed", questions: ["qst_2", "qst_3"] } },
  ],
};
const smallTestId = await seedTest(deps, workspaceId, { name: "Small", slug: "small", body: smallBody });
const smallVersionId = await versionIdOf(smallTestId);

function smallScore(percent: number, sections: { sectionId: string; points: number; max: number }[]): unknown {
  return {
    perQuestion: {
      qst_0: { points: 1, max: 1, correct: true },
      qst_1: { points: 0, max: 1, correct: false },
      qst_2: { points: 1, max: 1, correct: true },
      qst_3: { points: 1, max: 1, correct: true },
    },
    sections,
    total: (percent / 100) * 4,
    max: 4,
    percent,
    passed: percent >= 50,
    pending: [],
  };
}

const c1 = await candidateIn(smallTestId, { roll: "R1", phone_personal: "111", phone_work: "222" });
const a1 = await seedAttempt({
  candidateId: c1,
  testVersionId: smallVersionId,
  startedAt: FIXED_NOW,
  submittedAt: FIXED_NOW + 600_000,
  scoreJson: smallScore(90, [
    { sectionId: "s1", points: 2, max: 2 },
    { sectionId: "s2", points: 2, max: 2 },
  ]),
});
ATTEMPT_ROLL.set(a1, "R1");
await respond(a1, "qst_0", { kind: "option", option: "a" });
await respond(a1, "qst_1", { kind: "text", text: "my own free-text answer" });

const c2 = await candidateIn(smallTestId, { roll: "R2", phone_personal: "333", phone_work: "444" });
const a2 = await seedAttempt({
  candidateId: c2,
  testVersionId: smallVersionId,
  startedAt: FIXED_NOW + 1,
  submittedAt: FIXED_NOW + 601_000,
  scoreJson: smallScore(80, [
    { sectionId: "s1", points: 1, max: 2 },
    { sectionId: "s2", points: 2, max: 2 },
  ]),
  violations: 3,
  observed: true,
  integrityFlag: "high_risk",
  lockedAt: FIXED_NOW + 500_000,
});
ATTEMPT_ROLL.set(a2, "R2");
await recordVerdict(deps.db, workspaceId, {
  attemptId: a2,
  reviewer: ownerId,
  verdict: "suspicious",
  note: "Looked away repeatedly",
  now: FIXED_NOW + 700_000,
});

const c3 = await candidateIn(smallTestId, { roll: "R3" });
const a3 = await seedAttempt({
  candidateId: c3,
  testVersionId: smallVersionId,
  startedAt: FIXED_NOW + 2,
  submittedAt: FIXED_NOW + 602_000,
  scoreJson: smallScore(70, [
    { sectionId: "s1", points: 1, max: 2 },
    { sectionId: "s2", points: 1, max: 2 },
  ]),
});
ATTEMPT_ROLL.set(a3, "R3");
const c4 = await candidateIn(smallTestId, { roll: "R4" });
const a4 = await seedAttempt({
  candidateId: c4,
  testVersionId: smallVersionId,
  startedAt: FIXED_NOW + 3,
  submittedAt: FIXED_NOW + 603_000,
  scoreJson: smallScore(60, [
    { sectionId: "s1", points: 1, max: 2 },
    { sectionId: "s2", points: 0, max: 2 },
  ]),
});
ATTEMPT_ROLL.set(a4, "R4");
// In progress — no score yet, `R-10`'s "partial results" row.
const c5 = await candidateIn(smallTestId, { roll: "R5" });
const a5 = await seedAttempt({ candidateId: c5, testVersionId: smallVersionId, startedAt: FIXED_NOW + 4 });
ATTEMPT_ROLL.set(a5, "R5");

// The 300-candidate, 60-question-each cohort. Seeded with one `db.batch` —
// 300 attempts and 18,000 responses would be an unreasonable number of
// individual awaited statements, and the fixture itself owes no subrequest
// budget (the route under test is what is measured, not this setup).
const BIG_COHORT = 300;
const QUESTIONS_PER_ATTEMPT = 60;

const bigBody: TestDocumentBody = {
  settings: {
    timing: { duration_minutes: 90, navigation: "free", ...openWindow },
    access: { mode: "link_code", access_code: "OPEN2" },
    registration_form: { fields: [{ id: "roll", type: "short_text", label: "Roll", required: true }] },
  },
  sections: [
    { id: "s1", title: "Section One", source: { kind: "fixed", questions: Array.from({ length: 30 }, (_, i) => `qst_${i}`) } },
    { id: "s2", title: "Section Two", source: { kind: "fixed", questions: Array.from({ length: 30 }, (_, i) => `qst_${i + 30}`) } },
  ],
};
const bigTestId = await seedTest(deps, workspaceId, { name: "Big", slug: "big", body: bigBody });
const bigVersionId = await versionIdOf(bigTestId);

const bigAttemptIds: string[] = [];
{
  const statements: { sql: string; params: unknown[] }[] = [];
  const perQuestion: Record<string, { points: number; max: number; correct: boolean }> = {};
  for (let q = 0; q < QUESTIONS_PER_ATTEMPT; q += 1) perQuestion[`qst_${q}`] = { points: 1, max: 1, correct: true };
  const scoreJson = JSON.stringify({
    perQuestion,
    sections: [
      { sectionId: "s1", points: 30, max: 30 },
      { sectionId: "s2", points: 30, max: 30 },
    ],
    total: 60,
    max: 60,
    percent: 100,
    passed: true,
    pending: [],
  });

  for (let i = 0; i < BIG_COHORT; i += 1) {
    const candidateId = newId("cnd");
    statements.push({
      sql:
        "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
        "VALUES (?, ?, ?, NULL, NULL, 'registration', ?, NULL, NULL, ?)",
      params: [candidateId, workspaceId, bigTestId, JSON.stringify({ roll: `B${i}` }), FIXED_NOW],
    });
    const attemptId = newId("att");
    bigAttemptIds.push(attemptId);
    statements.push({
      sql:
        "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
        "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
        "integrity_flag, observed, locked_at) VALUES (?, ?, ?, ?, 1, '{}', ?, ?, ?, 'candidate', ?, 'clean', ?, 0, NULL, 'clean', 0, NULL)",
      params: [attemptId, workspaceId, candidateId, bigVersionId, FIXED_NOW + i, FIXED_NOW + i + 90 * 60_000, FIXED_NOW + i + 600_000, scoreJson, `hash-${attemptId}`],
    });
    for (let q = 0; q < QUESTIONS_PER_ATTEMPT; q += 1) {
      statements.push({
        sql:
          "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
          "VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL)",
        params: [newId("rsp"), workspaceId, attemptId, `qst_${q}`, "1", FIXED_NOW],
      });
    }
  }
  await deps.db.batch(statements);
}

// The fixture claims 300 candidates and 18,000 responses — prove it,
// rather than naming it and trusting the loop above. This is the guard the
// task brief calls out by name: a sibling task's fixture was smaller than
// its own stated bound and that is exactly what let a truncating clamp
// through.
async function dbAttemptCount(testId: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM attempt a JOIN test_version tv ON tv.id = a.test_version_id " +
      "WHERE a.workspace_id = ? AND tv.test_id = ?",
    [workspaceId, testId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function dbResponseCount(attemptIds: readonly string[]): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM response WHERE workspace_id = ? AND attempt_id IN (" +
      attemptIds.map(() => "?").join(",") +
      ")",
    [workspaceId, ...attemptIds],
  );
  return Number(rows[0]?.n ?? 0);
}

it("the big cohort really is 300 attempts and really is 18,000 responses", async () => {
  expect(bigAttemptIds).toHaveLength(BIG_COHORT);
  expect(await dbAttemptCount(bigTestId)).toBe(BIG_COHORT);
  expect(await dbResponseCount(bigAttemptIds)).toBe(BIG_COHORT * QUESTIONS_PER_ATTEMPT);
});

// --- K38: no truncation -----------------------------------------------------

it("exports every row of a 300-candidate test across pages, losing none", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, bigTestId, opts), 100);
  const { rows } = headerAndRows(csv);
  // The row-count equality the brief asks for: against the database
  // itself, read independently here, not against a number this file
  // merely names.
  expect(rows).toHaveLength(await dbAttemptCount(bigTestId));
  expect(rows).toHaveLength(BIG_COHORT);
});

it("always returns a cursor when it filled a page", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${bigTestId}/export/results.csv?limit=100`,
    get(viewerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as ExportPage;
  expect(body.nextCursor).not.toBeNull();
});

it("a full read of a 300-row cohort eventually answers null — K38's other half", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, bigTestId, opts), 500);
  expect(headerAndRows(csv).rows).toHaveLength(BIG_COHORT);
});

// --- Review Focus 3: duplicate registration-field labels --------------------

it("disambiguates two registration fields sharing a label", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, smallTestId, opts));
  const { header } = headerAndRows(csv);
  expect(new Set(header).size).toBe(header.length);
  expect(header).toContain("Phone (phone_personal)");
  expect(header).toContain("Phone (phone_work)");
  // The one field with no collision keeps its bare label.
  expect(header).toContain("Roll");
});

// --- 7e columns and the review table -----------------------------------------

it("carries the lock and the integrity flag 7e writes", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, smallTestId, opts));
  const { header, rows } = headerAndRows(csv);
  expect(header).toEqual(expect.arrayContaining(["Locked at", "Integrity flag"]));
  const row = rowOf(header, rows, a2);
  expect(cell(header, row, "Integrity flag")).toBe("high_risk");
  expect(cell(header, row, "Locked at")).not.toBe("");
  // The never-locked row carries a blank cell, not a fabricated timestamp.
  expect(cell(header, rowOf(header, rows, a1), "Locked at")).toBe("");
});

it("carries the verdict and note from the review table", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, smallTestId, opts));
  const { header, rows } = headerAndRows(csv);
  const row = rowOf(header, rows, a2);
  expect(cell(header, row, "Verdict")).toBe("suspicious");
  expect(cell(header, row, "Note")).toBe("Looked away repeatedly");
  // No verdict recorded for a1 — blank, not a fabricated one.
  expect(cell(header, rowOf(header, rows, a1), "Verdict")).toBe("");
});

it("reads the review table once per page, not once per row", async () => {
  const counting = countingDeps(deps);
  await exportResultsPage(counting.deps, workspaceId, bigTestId, { limit: BIG_COHORT });
  // getTest + getPublishedVersion + listAttemptsForTest + latestVerdicts +
  // listCandidates + countedFiguresForTest + rankedScoresForTest — seven
  // statements regardless of how many of the 300 rows are on the page.
  expect(counting.counts().db).toBeLessThanOrEqual(10);
});

// --- K7: two figures, two columns -------------------------------------------

it("carries this attempt's percent and the counted percent as separate columns", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, smallTestId, opts));
  const { header, rows } = headerAndRows(csv);
  expect(header).toEqual(expect.arrayContaining(["Percent", "Counted percent"]));
  const row = rowOf(header, rows, a1);
  expect(cell(header, row, "Percent")).toBe("90");
  expect(cell(header, row, "Counted percent")).toBe("90");
});

// --- Review Focus 2: rank is one page-independent ordering ------------------

it("ranks from one whole-test ordering, not from a page's own row position", async () => {
  // Paged two at a time over five attempts — three pages, so a1/a2 share a
  // page with a3/a4 split across the boundary and a5 alone on the last.
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, smallTestId, opts), 2);
  const { header, rows } = headerAndRows(csv);
  expect(rows).toHaveLength(5);
  // Percents were seeded 90/80/70/60/unscored — rank must reflect that
  // ordering regardless of which page each attempt landed on, not restart
  // at 1 on page two (a3, the second page's first row, must be 3, not 1).
  expect(cell(header, rowOf(header, rows, a1), "Rank")).toBe("1");
  expect(cell(header, rowOf(header, rows, a2), "Rank")).toBe("2");
  expect(cell(header, rowOf(header, rows, a3), "Rank")).toBe("3");
  expect(cell(header, rowOf(header, rows, a4), "Rank")).toBe("4");
  // Unsubmitted — no rank to report yet (R-10's partial-results row).
  expect(cell(header, rowOf(header, rows, a5), "Rank")).toBe("");
});

// --- R-10: available during the test -----------------------------------------

it("is available while the test is still open", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${bigTestId}/export/results.csv`, get(viewerCookie));
  expect(res.status).toBe(200);
});

it("R-10's filename shape: <slug>_results_<YYYYMMDD-HHMM>.csv, built from csvFilename", async () => {
  const page = await exportResultsPage(deps, workspaceId, smallTestId, {});
  expect(page.filename).toMatch(/^small_results_\d{8}-\d{4}\.csv$/);
});

// --- the full expected column set, as one sanity check ----------------------

it("carries every R-08 column the brief names", async () => {
  const csv = await drain((opts) => exportResultsPage(deps, workspaceId, smallTestId, opts));
  const { header } = headerAndRows(csv);
  expect(header).toEqual(
    expect.arrayContaining([
      "Roll",
      "Phone (phone_personal)",
      "Phone (phone_work)",
      "Set",
      "Start time",
      "Submit time",
      "Time taken (s)",
      "Submit reason",
      "Total",
      "Max",
      "Percent",
      "Counted percent",
      "Rank",
      "Pass/fail",
      "Logic",
      "Verbal",
      "Violations",
      "Observed",
      "Flag",
      "Locked at",
      "Integrity flag",
      "Verdict",
      "Note",
      "Review link",
    ]),
  );
});

// --- authorisation, each 403 with a 200 beside it ---------------------------

it("refuses a session without results.export", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/results.csv`, get(authorCookie));
  expect(res.status).toBe(403);
});

it("admits a session with results.export — the 200 beside the 403 above", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/results.csv`, get(viewerCookie));
  expect(res.status).toBe(200);
});

it("admits an API key scoped to results.export", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/results.csv`,
    withKey(keyWithScope),
  );
  expect(res.status).toBe(200);
});

it("refuses an API key not scoped to results.export — the 403 beside the 200 above", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/results.csv`,
    withKey(keyWithoutScope),
  );
  expect(res.status).toBe(403);
});

// --- budget ------------------------------------------------------------------

it("measures the real subrequest cost of the results route, flat in cohort size", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/tests/${bigTestId}/export/results.csv?limit=${BIG_COHORT}`,
    get(ownerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const path = "/api/v1/workspaces/:id/tests/:testId/export/results.csv";
  expect(counting.counts().total, path).toBe(ROUTE_BUDGETS[path]);
});

it("stays inside the ceiling on one page of 300", async () => {
  const counting = countingDeps(deps);
  await exportResultsPage(counting.deps, workspaceId, bigTestId, { limit: BIG_COHORT });
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});

it("is declared with the workspace authority and the results.export action", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/export/results.csv"]).toBe("results.export");
});

// =============================================================================
// The per-answer CSV (R-09)
// =============================================================================

it("exports all 18,000 answers of the 300×60 cohort, losing none", async () => {
  const csv = await drain((opts) => exportAnswersPage(deps, workspaceId, bigTestId, opts));
  // Row-count equality against the database, read independently here.
  expect(headerAndRows(csv).rows).toHaveLength(await dbResponseCount(bigAttemptIds));
  expect(headerAndRows(csv).rows).toHaveLength(BIG_COHORT * QUESTIONS_PER_ATTEMPT);
});

it("always returns a cursor when the answers route fills a page", async () => {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${bigTestId}/export/answers.csv?limit=10`,
    get(viewerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  expect(((await res.json()) as ExportPage).nextCursor).not.toBeNull();
});

it("carries `correct` as a boolean, and the response is the candidate's own answer", async () => {
  const csv = await drain((opts) => exportAnswersPage(deps, workspaceId, smallTestId, opts));
  const { header, rows } = headerAndRows(csv);
  const q0 = rows.find((r) => cell(header, r, "Question ID") === "qst_0" && r.includes(a1));
  if (!q0) throw new Error("no row for a1/qst_0");
  expect(cell(header, q0, "Correct")).toBe("true");
  const q1 = rows.find((r) => cell(header, r, "Question ID") === "qst_1" && r.includes(a1));
  if (!q1) throw new Error("no row for a1/qst_1");
  expect(cell(header, q1, "Correct")).toBe("false");
  // `KG1`: the cell carries the candidate's own stored text, never a key or
  // an explanation — this fixture has neither to leak (the real proof, over
  // a seeded sentinel bank, is scrub-scan.test.ts), so this pins the shape
  // the boolean test above depends on: a plain response, not an answer key.
  expect(cell(header, q1, "Response")).toContain("my own free-text answer");
});

it("reads responses once per page, not once per attempt in it", async () => {
  const counting = countingDeps(deps);
  await exportAnswersPage(counting.deps, workspaceId, bigTestId, { limit: 90 });
  // getTest + listAttemptsForTest + responsesForAttempts — three
  // statements, independent of how many attempts or responses the page
  // actually carries.
  expect(counting.counts().db).toBeLessThanOrEqual(6);
});

it("R-10's filename shape for the per-answer file", async () => {
  const page = await exportAnswersPage(deps, workspaceId, smallTestId, {});
  expect(page.filename).toMatch(/^small_answers_\d{8}-\d{4}\.csv$/);
});

it("refuses a session without results.export on the answers route too", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/answers.csv`, get(authorCookie));
  expect(res.status).toBe(403);
});

it("admits a session with results.export on the answers route — the 200 beside the 403 above", async () => {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${smallTestId}/export/answers.csv`, get(viewerCookie));
  expect(res.status).toBe(200);
});

it("measures the real subrequest cost of the answers route", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(
    `/api/v1/workspaces/${workspaceId}/tests/${bigTestId}/export/answers.csv?limit=90`,
    get(ownerCookie),
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const path = "/api/v1/workspaces/:id/tests/:testId/export/answers.csv";
  expect(counting.counts().total, path).toBe(ROUTE_BUDGETS[path]);
});

it("is declared with the workspace authority and the results.export action", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/export/answers.csv"]).toBe("results.export");
});
