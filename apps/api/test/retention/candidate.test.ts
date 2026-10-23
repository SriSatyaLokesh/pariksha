// `S-14` (#101): a candidate's right to get their data out
// (`exportCandidate`), and their right to have it erased (`deleteCandidate`,
// `K29`). `KG4` is the completeness guard — every table `holdsCandidateData`
// names, minus `audit_log` — and `KG9` is what pays for that exemption: no
// `appendAudit`-shaped call site in `apps/api/src` may carry a candidate's
// name, email or form values. `KG2`: the Owner/Admin pair over the real
// routes.
//
// Fix round 3: `F3` found `auth_token.payload_json` as a second,
// JSON-embedded reference to a candidate that `holdsCandidateData`'s
// column-name scan cannot see — `candidateDataClassification`'s own test
// below is the closing guard, asserting every `TABLE_MANIFEST` table is
// exactly one of structurally resolved / explicitly handled out of band /
// explicitly exempt, so a second one cannot land unreached silently
// again. `F4` folded the `audit_log` row into the same `db.batch` as the
// erasure.
//
// Each `it` builds its own workspace off a shared in-memory database — a
// fresh database per test would mean re-running every migration, which
// `sweep.test.ts` already does and this file does not need to repeat;
// `candidate-list.test.ts` and `invites.test.ts` share one database the
// same way.

import { afterAll, afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  addMembership,
  appendEvents,
  closeClient,
  createAttempt,
  createCandidate,
  createUser,
  getPublishedVersion,
  listAudit,
  newId,
  recordSnapshot,
  upsertResponse,
  INVITE_KIND,
  TABLE_MANIFEST,
  type DbClient,
  type InvitePayload,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import {
  AttemptInProgressError,
  CANDIDATE_DATA_EXEMPT,
  CANDIDATE_DATA_HANDLED_OUT_OF_BAND,
  candidateDataClassification,
  chunk,
  deleteCandidate,
  deleteCandidates,
  exportCandidate,
  holdsCandidateData,
  MAX_IDS_PER_CHUNK,
} from "../../src/retention/candidate.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { seedTest, seedWorkspace } from "../run/fixtures.js";
import type { AppDeps } from "../../src/app.js";

const DAY = 86_400_000;

/**
 * One published test, one candidate, one attempt with a response, an event,
 * a snapshot, a `candidate_unique` claim and a `review` row — every table
 * `holdsCandidateData` names, populated through the real writers where one
 * exists (`candidate_unique` and `review` have none yet, so those two rows
 * are inserted directly, the same way `sweep.test.ts` seeds `rate_limit`).
 *
 * `deadlineAt`/`submittedAt` are the in-progress knobs: the default is a
 * finished attempt well in the past, so most tests delete a candidate who
 * is not mid-exam without having to say so.
 */
async function seedCandidate(
  deps: AppDeps,
  opts: { submittedAt?: number | null; deadlineAt?: number } = {},
): Promise<{ wsp: string; testId: string; candidateId: string; attemptId: string }> {
  const wsp = await seedWorkspace(deps, `w${newId("tst").slice(4, 10)}`, "Alpha Corp");
  const testId = await seedTest(deps, wsp, {
    name: "Candidate Data",
    slug: `cd-${newId("tst").slice(4, 10)}`,
    body: { settings: {}, sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 1 } }] },
  });
  const version = await getPublishedVersion(deps.db, wsp, testId);
  if (!version) throw new Error("fixture: seedTest did not publish a version");

  const candidateId = await createCandidate(deps.db, wsp, {
    testId,
    formValues: { full_name: "Jamie Rivera", email: "jamie@example.test" },
    consentVersion: "v1",
    now: FIXED_NOW,
  });

  const attemptId = newId("att");
  const submittedAt = opts.submittedAt === undefined ? FIXED_NOW - DAY : opts.submittedAt;
  await createAttempt(deps.db, wsp, {
    id: attemptId,
    candidateId,
    testVersionId: version.id,
    setNo: 1,
    layout: {},
    startedAt: FIXED_NOW - 2 * DAY,
    deadlineAt: opts.deadlineAt ?? FIXED_NOW - DAY,
    tokenHash: `hash-${attemptId}`,
  });
  if (submittedAt !== null) {
    await deps.db.run(
      "UPDATE attempt SET submitted_at = ?, score_json = ? WHERE workspace_id = ? AND id = ?",
      [submittedAt, deps.db.jsonParam({ total: 1 }), wsp, attemptId],
    );
  }

  await upsertResponse(deps.db, wsp, {
    attemptId,
    questionId: "qst_1",
    value: { choice: "a" },
    clientSeq: 1,
    savedAt: FIXED_NOW - 2 * DAY,
  });
  await appendEvents(deps.db, wsp, {
    attemptId,
    events: [{ type: "tab_blur", clientTs: FIXED_NOW - 2 * DAY, detail: {} }],
    serverTs: FIXED_NOW - 2 * DAY,
  });
  const snapshotKey = `snap/${attemptId}/1.jpg`;
  await deps.storage.put(snapshotKey, new Uint8Array([1]), { contentType: "image/jpeg" });
  await recordSnapshot(deps.db, wsp, {
    attemptId,
    storageKey: snapshotKey,
    takenAt: FIXED_NOW - 2 * DAY,
    reason: "interval",
  });
  await deps.db.run(
    "INSERT INTO candidate_unique (id, workspace_id, test_id, candidate_id, field_id, value_hash, created_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [newId("cuq"), wsp, testId, candidateId, "email", "deadbeef", FIXED_NOW],
  );
  await deps.db.run(
    "INSERT INTO review (id, workspace_id, attempt_id, reviewer, verdict, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [newId("rev"), wsp, attemptId, "usr_reviewer", "clean", "Looked fine.", FIXED_NOW],
  );
  // F3: a list invite minted for this candidate — `auth_token` is
  // untenanted and carries no `candidate_id`/`attempt_id` column, so this
  // row is invisible to `holdsCandidateData`'s structural walk. Its
  // `externalId` is the exact leak this fix round closed: a real
  // email/roll-number value, surviving redemption (`run.ts` only ever
  // sets `used_at`) unless `deleteCandidates` deletes it explicitly.
  const invitePayload: InvitePayload = {
    workspaceId: wsp,
    testId,
    candidateId,
    externalId: "jamie@example.test",
  };
  await deps.db.run(
    "INSERT INTO auth_token (token_hash, kind, payload_json, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?, NULL)",
    [`hash-invite-${candidateId}`, INVITE_KIND, deps.db.jsonParam(invitePayload), FIXED_NOW, FIXED_NOW + 90 * DAY],
  );

  return { wsp, testId, candidateId, attemptId };
}

/** The table-agnostic read `KG4`'s two tests share: whatever rows this
 *  candidate has in `table`, found through the one foreign key the schema
 *  actually carries for it (`candidate.id` itself, a direct `candidate_id`,
 *  or an `attempt_id` resolved through the candidate's own attempts) —
 *  never a literal id substring scan, which `review`'s own columns (no
 *  candidate-shaped text anywhere in them) would never match. */
async function rowsMentioning(db: DbClient, table: string, candidateId: string): Promise<unknown[]> {
  const spec = TABLE_MANIFEST.find((t) => t.name === table);
  if (!spec) throw new Error(`no such table in TABLE_MANIFEST: ${table}`);
  if (table === "candidate") {
    // `candidate` is blanked, never removed (K29) — the row with this id
    // stays forever, so "mentions the candidate" has to mean "still carries
    // their data" here, not "a row exists". Before deletion `form_values_json`
    // is real; after, it is `{}` and `external_id` is null, which is what
    // `holdsCandidateData`'s own completeness test is actually checking.
    return db.query("SELECT * FROM candidate WHERE id = ? AND (external_id IS NOT NULL OR form_values_json != ?)", [
      candidateId,
      db.jsonParam({}),
    ]);
  }
  if (spec.columns.some((c) => c.name === "candidate_id")) {
    return db.query(`SELECT * FROM ${table} WHERE candidate_id = ?`, [candidateId]);
  }
  if (spec.columns.some((c) => c.name === "attempt_id")) {
    return db.query(
      `SELECT * FROM ${table} WHERE attempt_id IN (SELECT id FROM attempt WHERE candidate_id = ?)`,
      [candidateId],
    );
  }
  return [];
}

async function countUniqueClaims(db: DbClient, wsp: string, candidateId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM candidate_unique WHERE workspace_id = ? AND candidate_id = ?",
    [wsp, candidateId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** F3: `auth_token` carries no `workspace_id` or `candidate_id` column —
 *  the only way to find a candidate's own invite row is the same
 *  `json_extract` `deleteCandidates` itself uses (sqlite/d1 shape; these
 *  tests run on the sqlite dialect, same as every other fixture in this
 *  file). */
async function countAuthTokensFor(db: DbClient, candidateId: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM auth_token WHERE json_extract(payload_json, '$.candidateId') = ?",
    [candidateId],
  );
  return Number(rows[0]?.n ?? 0);
}

// --- KG9: the source scanner ----------------------------------------------

/** `KG9`'s denylist: the three categories Review Focus item 3 names — a
 *  name, an email, a form value — plus the candidate's own list identity
 *  (`external_id` can itself BE the email or roll number `S-14` is written
 *  against, `columns.ts:337`'s own comment). Deliberately NOT a bare
 *  "name": `bank.create` and `test.create` already audit
 *  `detail: { name: ... }` for a bank's or a test's own name, which is
 *  workspace metadata, not a candidate's personal data, and banning the
 *  word would make the "real codebase" assertion below fail on call sites
 *  this guard has no business flagging. */
const PERSONAL_DATA_TOKENS = [
  "email",
  "formValues",
  "form_values",
  "fullName",
  "full_name",
  "phone",
  "externalId",
  "external_id",
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Every `appendAudit(...)`-shaped call's own argument text, found by
 *  counting parentheses from the call site rather than a regex over the
 *  whole call — it commonly spans many lines and nests object and array
 *  literals of its own.
 *
 *  Fix round 3 (`F4`): the start pattern is `\bappendAudit\w*\(`, not the
 *  literal string `"appendAudit("` — `retention/candidate.ts`'s
 *  `appendAuditStatement` (built to fold the audit `INSERT` into
 *  `deleteCandidates`'s own `db.batch`, since `@pariksha/db`'s
 *  `appendAudit` issues its own `db.run` and cannot be) would otherwise be
 *  a raw `INSERT INTO audit_log` with no call site this scanner could see
 *  — the exact shape of blind spot `F3` found on the `TABLE_MANIFEST`
 *  side, here on the audit side instead. Keeping `appendAudit` as a
 *  substring of the wrapper's own name is what keeps it caught. */
function appendAuditCallBodies(text: string): string[] {
  const calls: string[] = [];
  const callStart = /\bappendAudit\w*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callStart.exec(text)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    const start = i;
    do {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      i++;
    } while (depth > 0 && i < text.length);
    calls.push(text.slice(start, i));
    callStart.lastIndex = i;
  }
  return calls;
}

/** `KG9`. Every `appendAudit` call site under `dir` whose argument text
 *  carries one of `PERSONAL_DATA_TOKENS`, as `"<file>: <token>"`. */
function auditCallSitesPassingPersonalData(dir: string): string[] {
  const hits: string[] = [];
  for (const file of listTsFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const call of appendAuditCallBodies(text)) {
      const lower = call.toLowerCase();
      const token = PERSONAL_DATA_TOKENS.find((t) => lower.includes(t.toLowerCase()));
      if (token) hits.push(`${file}: ${token}`);
    }
  }
  return hits;
}

const apiSrcDir = fileURLToPath(new URL("../../src", import.meta.url));

it("no appendAudit call site in apps/api/src passes a name, an email or a form value", () => {
  expect(auditCallSitesPassingPersonalData(apiSrcDir)).toEqual([]);
});

const plantedFixtures: string[] = [];
afterEach(() => {
  for (const dir of plantedFixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("the scan catches one when planted — control for the test above", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-scan-"));
  plantedFixtures.push(dir);
  writeFileSync(
    join(dir, "planted.ts"),
    [
      'import { appendAudit } from "@pariksha/db";',
      "export async function bad(db: unknown, workspaceId: string, candidate: { email: string }) {",
      "  await appendAudit(db as never, workspaceId, {",
      '    actor: "usr_1",',
      '    action: "candidate.delete",',
      "    target: candidate.email,",
      '    detail: { email: candidate.email },',
      "    now: 0,",
      "  });",
      "}",
      "",
    ].join("\n"),
  );
  expect(auditCallSitesPassingPersonalData(dir)).not.toEqual([]);
});

// --- KG4: the completeness guard -------------------------------------------

it("empties every table holding candidate data, except the audit row that logged it", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: false,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const tables = TABLE_MANIFEST.filter((t) => holdsCandidateData(t) && !(t.name in CANDIDATE_DATA_EXEMPT));
  for (const table of tables) {
    expect(await rowsMentioning(deps.db, table.name, candidateId), table.name).toEqual([]);
  }
  await closeClient(deps.db);
});

// Branch review `M3` (MAJOR): the sweep above runs only with
// `keepAnonymisedScore: false`. The nightly `AC-24` path — this branch's
// entire subject — calls `deleteCandidates` with `keepAnonymisedScore:
// **true**` (`sweep.ts:317`), where `review` and `attempt` survive by
// design (`K29`). A guard that never exercises that mode cannot catch a
// table later moved into the `!keepAnonymisedScore` branch shipping
// unguarded on the one path that matters most. Survivors are named
// explicitly, not just "whatever is left" — a fourth survivor (a table
// that should have been swept but was not) has to fail this test, not
// pass it silently.
it("empties every table holding candidate data except attempt and review, in nightly (keepAnonymisedScore: true) mode", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const SURVIVORS = new Set(["attempt", "review"]);
  const tables = TABLE_MANIFEST.filter((t) => holdsCandidateData(t) && !(t.name in CANDIDATE_DATA_EXEMPT));
  // Sanity: both named survivors are real tables this manifest actually
  // covers, so the assertion below is not vacuously skipping them.
  expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining([...SURVIVORS]));

  for (const table of tables) {
    const rows = await rowsMentioning(deps.db, table.name, candidateId);
    if (SURVIVORS.has(table.name)) {
      expect(rows, table.name).not.toEqual([]);
    } else {
      expect(rows, table.name).toEqual([]);
    }
  }
  await closeClient(deps.db);
});

it("finds rows before the deletion — control for the sweep above", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);
  void wsp;

  const tables = TABLE_MANIFEST.filter((t) => holdsCandidateData(t) && !(t.name in CANDIDATE_DATA_EXEMPT));
  // Without this, the test above passes for free if `holdsCandidateData`
  // returned nothing at all.
  expect(tables.length).toBeGreaterThan(3);
  for (const table of tables) {
    expect(await rowsMentioning(deps.db, table.name, candidateId), table.name).not.toEqual([]);
  }
  await closeClient(deps.db);
});

// --- F3: the manifest-blind-spot guard, and the auth_token leak it found ----

it("every TABLE_MANIFEST table is structurally resolved, explicitly handled out of band, or explicitly exempt", () => {
  // The failure state this guard exists to catch: `auth_token` before this
  // fix round classified as none of the three — not exempt, not handled,
  // just unreached, which is exactly how its `payload_json.candidateId`
  // leak survived a structural scan undetected.
  const unclassified = TABLE_MANIFEST.filter((t) => candidateDataClassification(t) === null).map((t) => t.name);
  expect(unclassified).toEqual([]);
});

// Branch review `M4` (MAJOR, then re-review post-merge): the tripwire that
// used to live here ("webhook_delivery has no production writer yet")
// sprang exactly as designed when Phase 8d's `queueWebhookDeliveries`
// (`packages/db/src/repo/webhooks.ts`) merged into this branch — a real
// `INSERT INTO webhook_delivery` landed, the thing `CANDIDATE_DATA_EXEMPT
// .webhook_delivery`'s own reason said to re-review for. That re-review:
// `fireWebhooks` only ever queues `attempt.submitted` with
// `payload: { attemptId }` (`test.closed`'s `{ testId }` carries no
// candidate reference), the same JSON-embedded shape `auth_token`'s F3
// leak was. `webhook_delivery` now lives in
// `CANDIDATE_DATA_HANDLED_OUT_OF_BAND`, not `CANDIDATE_DATA_EXEMPT` — the
// tests below are its `auth_token`-shaped parity checks, not the tripwire
// (which cannot be re-armed: the writer it watched for is permanent now).
it("webhook_delivery is named as explicitly handled, not silently exempt", () => {
  const webhookDelivery = TABLE_MANIFEST.find((t) => t.name === "webhook_delivery");
  expect(webhookDelivery).toBeDefined();
  expect(holdsCandidateData(webhookDelivery!)).toBe(false);
  expect(candidateDataClassification(webhookDelivery!)).toBe("handled");
  expect(CANDIDATE_DATA_HANDLED_OUT_OF_BAND.webhook_delivery).toBeTruthy();
  expect(CANDIDATE_DATA_EXEMPT.webhook_delivery).toBeUndefined();
});

it("deletes the queued attempt.submitted webhook_delivery row — payload_json.attemptId, invisible to the structural scan", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId, attemptId } = await seedCandidate(deps);

  // A delivery for this candidate's own attempt, and a `test.closed`
  // delivery beside it that must survive — its payload names no
  // candidate at all, so it is not this candidate's data to begin with.
  await deps.db.run(
    "INSERT INTO webhook_delivery (id, workspace_id, webhook_id, event, payload_json, attempt_count, " +
      "next_attempt_at, last_status, last_error, delivered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      newId("whd"),
      wsp,
      "wbh_fake",
      "attempt.submitted",
      deps.db.jsonParam({ attemptId }),
      1,
      FIXED_NOW,
      200,
      null,
      FIXED_NOW,
      FIXED_NOW,
    ],
  );
  const survivorId = newId("whd");
  await deps.db.run(
    "INSERT INTO webhook_delivery (id, workspace_id, webhook_id, event, payload_json, attempt_count, " +
      "next_attempt_at, last_status, last_error, delivered_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [survivorId, wsp, "wbh_fake", "test.closed", deps.db.jsonParam({ testId: "tst_other" }), 0, FIXED_NOW, null, null, null, FIXED_NOW],
  );

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  expect(
    await deps.db.query("SELECT * FROM webhook_delivery WHERE workspace_id = ? AND id = ?", [wsp, survivorId]),
  ).not.toEqual([]);
  expect(
    await deps.db.query("SELECT * FROM webhook_delivery WHERE workspace_id = ? AND json_extract(payload_json, '$.attemptId') = ?", [
      wsp,
      attemptId,
    ]),
  ).toEqual([]);
  await closeClient(deps.db);
});

it("auth_token is named as explicitly handled, not silently exempt", () => {
  // `holdsCandidateData(auth_token)` really is `false` (no `candidate_id`/
  // `attempt_id` column) — this table is only safe because
  // `deleteCandidates` deletes it by name, not because the structural walk
  // found it.
  const authToken = TABLE_MANIFEST.find((t) => t.name === "auth_token");
  expect(authToken).toBeDefined();
  expect(holdsCandidateData(authToken!)).toBe(false);
  expect(candidateDataClassification(authToken!)).toBe("handled");
  expect(CANDIDATE_DATA_HANDLED_OUT_OF_BAND.auth_token).toBeTruthy();
});

it("deletes the invite's auth_token row — payload_json.candidateId, invisible to the structural scan", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);
  expect(await countAuthTokensFor(deps.db, candidateId)).toBeGreaterThan(0);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  expect(await countAuthTokensFor(deps.db, candidateId)).toBe(0);
  await closeClient(deps.db);
});

// Branch review `m5` (MINOR): `candidateIdExtract`'s `pg` branch
// (`payload_json ->> 'candidateId'`) has never executed anywhere — #229
// records no Postgres test infrastructure at all, so no fixture here can
// prove Postgres itself accepts or correctly evaluates it. What this CAN
// prove cheaply, without a real Postgres: that `deleteCandidates` really
// does select the `pg`-shaped expression (not the sqlite one) when
// `db.dialect === "pg"`, and that the expression itself is exactly the
// one the file header documents — so a future edit that mistypes the
// operator, drops the dialect check, or silently falls back to the
// sqlite branch on `pg` fails here. **What remains genuinely unprovable
// without #229: whether Postgres actually matches a real
// `payload_json ->> 'candidateId'` value this way** — that is a semantic
// claim about Postgres's own `jsonb` operators, not a fact this file's
// fake can know.
it("builds the pg-dialect auth_token DELETE with the documented ->> operator, not the sqlite json_extract", async () => {
  const statements: { sql: string; params: unknown[] }[] = [];
  const fakePg: DbClient = {
    dialect: "pg",
    drizzle: undefined as never,
    exec: async () => undefined,
    all: async () => [],
    // Only the attempt-select path is reached before the batch (no
    // attempts seeded), so every `query` call here answers empty.
    query: async () => [],
    run: async () => ({ changes: 0 }),
    batch: async (stmts) => {
      statements.push(...stmts);
      return stmts.map(() => ({ changes: 0 }));
    },
    jsonParam: (value) => JSON.stringify(value),
    jsonValue: (raw) => (typeof raw === "string" ? (JSON.parse(raw) as never) : (raw as never)),
    close: async () => undefined,
  };

  await deleteCandidates(fakePg, "wsp_fake", {
    candidateIds: ["cnd_fake"],
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: { put: async () => undefined, get: async () => null, delete: async () => undefined, signedUrl: () => "" },
  });

  const authTokenDelete = statements.find((s) => s.sql.includes("DELETE FROM auth_token"));
  expect(authTokenDelete?.sql).toContain("payload_json ->> 'candidateId'");
  expect(authTokenDelete?.sql).not.toContain("json_extract");
});

// --- behaviour --------------------------------------------------------------

it("blanks the candidate row rather than removing it", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const rows = await deps.db.query<{ external_id: string | null; form_values_json: unknown }>(
    "SELECT external_id, form_values_json FROM candidate WHERE workspace_id = ? AND id = ?",
    [wsp, candidateId],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.external_id).toBeNull();
  expect(deps.db.jsonValue(rows[0]?.form_values_json)).toEqual({});
  await closeClient(deps.db);
});

it("deletes the candidate_unique email hash", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);
  expect(await countUniqueClaims(deps.db, wsp, candidateId)).toBeGreaterThan(0);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  expect(await countUniqueClaims(deps.db, wsp, candidateId)).toBe(0);
  await closeClient(deps.db);
});

it("keeps the attempt and its score_json when keepAnonymisedScore is chosen", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId, attemptId } = await seedCandidate(deps);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const rows = await deps.db.query<{ score_json: unknown }>(
    "SELECT score_json FROM attempt WHERE workspace_id = ? AND id = ?",
    [wsp, attemptId],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]?.score_json).not.toBeNull();
  await closeClient(deps.db);
});

it("removes the attempt entirely when keepAnonymisedScore is false", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId, attemptId } = await seedCandidate(deps);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: false,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const rows = await deps.db.query("SELECT id FROM attempt WHERE workspace_id = ? AND id = ?", [wsp, attemptId]);
  expect(rows).toHaveLength(0);
  await closeClient(deps.db);
});

it("removes the R2 object its snapshot named", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId, attemptId } = await seedCandidate(deps);
  const key = `snap/${attemptId}/1.jpg`;
  expect(await deps.storage.get(key)).not.toBeNull();

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  expect(await deps.storage.get(key)).toBeNull();
  await closeClient(deps.db);
});

// --- Review Focus 1: the candidate still sitting the test -------------------

it("refuses while the candidate has an attempt in progress", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps, { submittedAt: null, deadlineAt: FIXED_NOW + DAY });

  await expect(
    deleteCandidate(deps.db, wsp, {
      candidateId,
      keepAnonymisedScore: true,
      actor: "usr_1",
      now: FIXED_NOW,
      storage: deps.storage,
    }),
  ).rejects.toThrow(/in progress/);
  await expect(
    deleteCandidate(deps.db, wsp, {
      candidateId,
      keepAnonymisedScore: true,
      actor: "usr_1",
      now: FIXED_NOW,
      storage: deps.storage,
    }),
  ).rejects.toBeInstanceOf(AttemptInProgressError);
  await closeClient(deps.db);
});

it("admits the deletion once the deadline has passed, even though submitted_at is still null", async () => {
  // The abandoned-candidate case the file header names: nobody ever
  // revisited the attempt to trigger the lazy `finishAttempt`
  // materialisation, so `submitted_at` stays null forever — and that must
  // not lock erasure out forever too.
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps, { submittedAt: null, deadlineAt: FIXED_NOW - DAY });

  await expect(
    deleteCandidate(deps.db, wsp, {
      candidateId,
      keepAnonymisedScore: true,
      actor: "usr_1",
      now: FIXED_NOW,
      storage: deps.storage,
    }),
  ).resolves.toBeDefined();
  await closeClient(deps.db);
});

// --- export ------------------------------------------------------------------

it("exports everything the product holds before it is deleted", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);

  const { json, filename } = await exportCandidate(deps.db, wsp, candidateId);
  expect(filename).toMatch(/^candidate_.*\.json$/);

  const parsed = JSON.parse(json) as {
    candidate: { id: string; formValues: Record<string, unknown> };
    attempts: { id: string; score: unknown }[];
    responses: { question_id: string }[];
    events: { type: string }[];
    snapshots: { storage_key: string }[];
  };
  expect(parsed.candidate.id).toBe(candidateId);
  expect(parsed.candidate.formValues).toMatchObject({ full_name: "Jamie Rivera" });
  expect(parsed.attempts).toHaveLength(1);
  expect(parsed.attempts[0]?.score).not.toBeNull();
  expect(parsed.responses).toHaveLength(1);
  expect(parsed.events).toHaveLength(1);
  expect(parsed.snapshots).toHaveLength(1);
  await closeClient(deps.db);
});

it("exports a null candidate for an id this workspace never had", async () => {
  const { deps } = await testDeps();
  const { wsp } = await seedCandidate(deps);

  const { json } = await exportCandidate(deps.db, wsp, "cnd_does_not_exist");
  expect((JSON.parse(json) as { candidate: unknown }).candidate).toBeNull();
  await closeClient(deps.db);
});

// --- the audit trail ----------------------------------------------------------

it("logs the deletion with ids and counts, never personal data", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);

  await deleteCandidate(deps.db, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const rows = (await listAudit(deps.db, wsp)).filter((r) => r.action === "candidate.delete");
  expect(rows).toHaveLength(1);
  expect(rows[0]?.target).toBe(candidateId);
  expect(rows[0]?.detail).toMatchObject({ keepAnonymisedScore: true });
  expect(JSON.stringify(rows[0]?.detail)).not.toMatch(/Jamie|jamie@example/);
  await closeClient(deps.db);
});

it("F4: the audit row is inside the same db.batch as the erasure, never a separate db.run after it", async () => {
  const { deps } = await testDeps();
  const { wsp, candidateId } = await seedCandidate(deps);

  const batchCalls: { sql: string; params: unknown[] }[][] = [];
  const runCalls: string[] = [];
  const spied: DbClient = {
    ...deps.db,
    batch: (statements) => {
      batchCalls.push([...statements]);
      return deps.db.batch(statements);
    },
    run: (sql, params) => {
      runCalls.push(sql);
      return deps.db.run(sql, params);
    },
  };

  await deleteCandidate(spied, wsp, {
    candidateId,
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  // The whole erasure is ONE db.batch call, and the audit INSERT rides
  // inside it — not a toEqual([]) on `runCalls` (candidateExists and the
  // in-progress/snapshot-key reads are real `db.query` calls, not `run`,
  // so this file's other fixtures still issue some `db.run` elsewhere;
  // the property that matters is that no `db.run` ever carries the audit
  // INSERT once `db.batch` has already committed).
  expect(batchCalls).toHaveLength(1);
  expect(batchCalls[0]?.some((s) => /INSERT INTO audit_log/i.test(s.sql))).toBe(true);
  expect(runCalls.some((sql) => /INSERT INTO audit_log/i.test(sql))).toBe(false);
  await closeClient(deps.db);
});

// --- deleteCandidates: the batched real implementation -----------------------

it("chunks an id list at MAX_IDS_PER_CHUNK, never one group over it (D1's 100-bound-param ceiling)", () => {
  const ids = Array.from({ length: MAX_IDS_PER_CHUNK * 2 + 5 }, (_, i) => `id${String(i)}`);
  const groups = chunk(ids, MAX_IDS_PER_CHUNK);
  expect(groups).toHaveLength(3);
  expect(groups[0]).toHaveLength(MAX_IDS_PER_CHUNK);
  expect(groups[1]).toHaveLength(MAX_IDS_PER_CHUNK);
  expect(groups[2]).toHaveLength(5);
  expect(groups.flat()).toEqual(ids);
});

it("erases a batch of candidates in one call, one audit row each", async () => {
  const { deps } = await testDeps();
  const a = await seedCandidate(deps);
  // `seedCandidate` makes its own workspace, so the second candidate is
  // added directly into that same workspace through the real writer — one
  // `deleteCandidates` call then covers both.
  const { wsp, candidateId: c1 } = a;
  const c2 = await createCandidate(deps.db, wsp, {
    testId: a.testId,
    formValues: { full_name: "Riley Chen" },
    consentVersion: "v1",
    now: FIXED_NOW,
  });

  await deleteCandidates(deps.db, wsp, {
    candidateIds: [c1, c2],
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  });

  const rows = await deps.db.query<{ external_id: string | null }>(
    "SELECT external_id FROM candidate WHERE workspace_id = ? AND id IN (?, ?)",
    [wsp, c1, c2],
  );
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(row.external_id).toBeNull();

  const audit = (await listAudit(deps.db, wsp)).filter((r) => r.action === "candidate.delete");
  expect(audit.map((r) => r.target).sort()).toEqual([c1, c2].sort());
  await closeClient(deps.db);
});

it("refuses the whole batch when any one candidate in it is mid-attempt", async () => {
  const { deps } = await testDeps();
  const live = await seedCandidate(deps, { submittedAt: null, deadlineAt: FIXED_NOW + DAY });
  const { wsp, candidateId: c1 } = live;
  const c2 = await createCandidate(deps.db, wsp, {
    testId: live.testId,
    formValues: { full_name: "Not In Progress" },
    consentVersion: "v1",
    now: FIXED_NOW,
  });

  const err = await deleteCandidates(deps.db, wsp, {
    candidateIds: [c2, c1],
    keepAnonymisedScore: true,
    actor: "usr_1",
    now: FIXED_NOW,
    storage: deps.storage,
  }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(AttemptInProgressError);
  expect((err as AttemptInProgressError).candidateIds).toEqual([c1]);

  // Refused wholesale: c2, which had no live attempt, is untouched too —
  // its form values are still real, not blanked to `{}`.
  const rows = await deps.db.query<{ form_values_json: unknown }>(
    "SELECT form_values_json FROM candidate WHERE workspace_id = ? AND id = ?",
    [wsp, c2],
  );
  expect(deps.db.jsonValue(rows[0]?.form_values_json)).not.toEqual({});
  await closeClient(deps.db);
});

// --- the route: KG2, the Owner/Admin pair ------------------------------------

async function withApp(): Promise<{ deps: AppDeps; app: ReturnType<typeof createApp> }> {
  const { deps } = await testDeps({ env: { APP_URL: "https://pariksha.test" } });
  return { deps, app: createApp(deps) };
}

async function cookieFor(deps: AppDeps, workspaceId: string, role: "owner" | "admin"): Promise<string> {
  const userId = await createUser(deps.db, {
    email: `${role}-${newId("usr").slice(4, 10)}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

it("refuses an Admin, who does not hold candidates.delete", async () => {
  const { deps, app } = await withApp();
  const { wsp, candidateId } = await seedCandidate(deps);
  const adminCookie = await cookieFor(deps, wsp, "admin");

  const res = await app.request(`/api/v1/workspaces/${wsp}/candidates/${candidateId}/data`, {
    method: "DELETE",
    headers: { cookie: adminCookie, "content-type": "application/json" },
    body: JSON.stringify({ keepAnonymisedScore: true }),
  });
  expect(res.status).toBe(403);
  await closeClient(deps.db);
});

it("admits an Owner — control for the test above", async () => {
  const { deps, app } = await withApp();
  const { wsp, candidateId } = await seedCandidate(deps);
  const ownerCookie = await cookieFor(deps, wsp, "owner");

  const res = await app.request(`/api/v1/workspaces/${wsp}/candidates/${candidateId}/data`, {
    method: "DELETE",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ keepAnonymisedScore: true }),
  });
  expect(res.status, await res.text()).toBe(200);
  await closeClient(deps.db);
});

it("answers 404 for a candidate id this workspace never had", async () => {
  const { deps, app } = await withApp();
  const { wsp } = await seedCandidate(deps);
  const ownerCookie = await cookieFor(deps, wsp, "owner");

  const res = await app.request(`/api/v1/workspaces/${wsp}/candidates/cnd_nope/data`, {
    headers: { cookie: ownerCookie },
  });
  expect(res.status).toBe(404);
  await closeClient(deps.db);
});

it("serves the export as a named download", async () => {
  const { deps, app } = await withApp();
  const { wsp, candidateId } = await seedCandidate(deps);
  const ownerCookie = await cookieFor(deps, wsp, "owner");

  const res = await app.request(`/api/v1/workspaces/${wsp}/candidates/${candidateId}/data`, {
    headers: { cookie: ownerCookie },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="candidate_/);
  const body = JSON.parse(await res.text()) as { candidate: { id: string } };
  expect(body.candidate.id).toBe(candidateId);
  await closeClient(deps.db);
});

it("answers 409 when the candidate has an attempt in progress", async () => {
  const { deps, app } = await withApp();
  const { wsp, candidateId } = await seedCandidate(deps, { submittedAt: null, deadlineAt: FIXED_NOW + DAY });
  const ownerCookie = await cookieFor(deps, wsp, "owner");

  const res = await app.request(`/api/v1/workspaces/${wsp}/candidates/${candidateId}/data`, {
    method: "DELETE",
    headers: { cookie: ownerCookie, "content-type": "application/json" },
    body: JSON.stringify({ keepAnonymisedScore: true }),
  });
  expect(res.status).toBe(409);
  await closeClient(deps.db);
});

it("the matrix table carries both methods against the real routes", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/candidates/:candidateId/data"]).toBe("candidates.delete");
  expect(ROUTE_ACTIONS["DELETE /api/v1/workspaces/:id/candidates/:candidateId/data"]).toBe("candidates.delete");
  expect(ROUTE_AUTH["GET /api/v1/workspaces/:id/candidates/:candidateId/data"]).toBe("workspace");
  expect(ROUTE_AUTH["DELETE /api/v1/workspaces/:id/candidates/:candidateId/data"]).toBe("workspace");
});

// --- the measured budget ------------------------------------------------------

it("measures the real subrequest cost of both methods", async () => {
  const { deps } = await withApp();
  const { wsp, candidateId } = await seedCandidate(deps);
  const ownerCookie = await cookieFor(deps, wsp, "owner");

  const getCounting = countingDeps(deps);
  const getRes = await createApp(getCounting.deps).request(
    `/api/v1/workspaces/${wsp}/candidates/${candidateId}/data`,
    { headers: { cookie: ownerCookie } },
  );
  expect(getRes.status).toBe(200);
  expect(getCounting.counts().total).toBeLessThanOrEqual(
    ROUTE_BUDGETS["/api/v1/workspaces/:id/candidates/:candidateId/data"]!,
  );

  const { deps: deps2 } = await withApp().then(async (w) => {
    await closeClient(w.deps.db);
    return withApp();
  });
  const { wsp: wsp2, candidateId: candidateId2 } = await seedCandidate(deps2);
  const ownerCookie2 = await cookieFor(deps2, wsp2, "owner");
  const delCounting = countingDeps(deps2);
  const delRes = await createApp(delCounting.deps).request(
    `/api/v1/workspaces/${wsp2}/candidates/${candidateId2}/data`,
    {
      method: "DELETE",
      headers: { cookie: ownerCookie2, "content-type": "application/json" },
      body: JSON.stringify({ keepAnonymisedScore: true }),
    },
  );
  expect(delRes.status, await delRes.clone().text()).toBe(200);
  expect(delCounting.counts().total).toBeLessThanOrEqual(
    ROUTE_BUDGETS["/api/v1/workspaces/:id/candidates/:candidateId/data"]!,
  );
  await closeClient(deps.db);
  await closeClient(deps2.db);
});

afterAll(() => {
  for (const dir of plantedFixtures) rmSync(dir, { recursive: true, force: true });
});
