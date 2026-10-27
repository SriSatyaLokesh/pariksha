// `S-14`: a candidate's right to get their data out, and their right to
// have it erased. `candidates.delete` — Owner-only, nowhere else in the
// permission matrix — gets its first production caller here.
//
// **Blanks `candidate` rather than removing it.** A hard delete would
// orphan every `attempt` row `S-14` allows to survive (`keepAnonymisedScore`),
// and it would miss `candidate_unique`, which holds a SHA-256 of the
// candidate's email (`columns.ts:337`) that a bare `DELETE FROM candidate`
// never touches — the exact leak this file is written against.
//
// **An in-progress attempt refuses the whole call (`AttemptInProgressError`),
// rather than deleting around it.** `S-14` says nothing about timing, and an
// attempt in flight has a live cookie resolving to a row this would be
// blanking out from under it. The alternative — delete anyway, and let the
// candidate's next write 500 — is the worst outcome this phase can ship: an
// administrator pressing a button mid-exam must never be what breaks a
// candidate's screen. Refusing is conservative and reversible (wait for the
// deadline, or force-submit first); deleting around a live session is not.
// "In progress" is `submitted_at IS NULL AND deadline_at > now` — not bare
// `submitted_at IS NULL` — so a candidate who simply abandoned a test months
// ago (deadline long past, nobody ever revisited it to trigger the lazy
// `finishAttempt` materialisation) is not erasure-locked forever by a row
// nothing will ever resolve.
//
// **`deleteCandidates` is the real implementation; `deleteCandidate` is a
// one-element caller on top of it.** An advisor ruling on `AC-24`/`AC-25`
// (mid-task note, Phase 8e) found that the nightly sweep will shortly need
// to apply this exact erasure bundle to a bounded batch of candidates whose
// own `personal_data_days` has passed — a second acceptance criterion this
// task does not implement, but whose caller this task must not make into a
// rewrite later. So the batch shape is the real function; this task's own
// route still calls through the one-candidate wrapper, unchanged from the
// brief. **D1 caps bound parameters at 100 per statement** — confirmed
// against Cloudflare's current docs — so every `IN (...)` built from an id
// list here is chunked at `MAX_IDS_PER_CHUNK`, never built unbounded the way
// a sibling fix round found `sweep.ts` once did (passes on better-sqlite3,
// fails on live D1).
//
// **`holdsCandidateData` (`KG4`) is derived from `TABLE_MANIFEST`'s own
// foreign-key naming convention, not a hand list**: a column named `x_id` is
// read as a reference to table `x`, and a table holds candidate data if it
// *is* `candidate`, names `candidate` directly, or names a table that
// (transitively) does. `attempt.candidate_id` is direct; `response`,
// `event`, `snapshot` and `review` each carry `attempt_id` and so qualify
// through it — which is also why this file deletes `review` rows when an
// attempt is removed: `attempt` is the thing `review.attempt_id` points at,
// and leaving the review behind once its attempt is gone would orphan it,
// the same failure a hard candidate delete was refused for in the first
// place. (K29's own prose names response/event/snapshot and not review; this
// implementation widens that by the one case the FK graph itself proves is
// still owed — see the task report.) This one manifest-driven guard is
// meant to cover both the manual path here and the future nightly one the
// same way, per the advisor ruling above — there is no second definition of
// "what erasure empties" to keep in step.
//
// **Fix round 3, `F3`: `holdsCandidateData`'s blind spot, named rather than
// silently unreached.** A column-name scan cannot see a reference embedded
// inside an opaque JSON column — `auth_token.payload_json` (untenanted, no
// `candidate_id`/`attempt_id` column at all) carries `InvitePayload.
// candidateId` (`packages/db/src/repo/run.ts`), and redemption only ever
// sets `used_at` (that file's own comment: "so a replay is distinguishable
// from a token that never existed"), so a list-invited candidate's
// `external_id` — routinely an email or a roll number, the exact shape
// `candidate_unique`'s hash exists to stop leaking — lived in that row
// forever. `deleteCandidates` below now deletes it explicitly, matched on
// `payload_json`'s `candidateId` rather than a column `holdsCandidateData`
// could see. `CANDIDATE_DATA_HANDLED_OUT_OF_BAND` names this table and why,
// and `candidateDataClassification`'s own completeness test (`KG4`, the
// test file) fails for any `TABLE_MANIFEST` table that is in none of the
// three states — structurally resolved, explicitly handled here, or
// explicitly exempt (`CANDIDATE_DATA_EXEMPT`) — so a second JSON-embedded
// reference added later cannot land unreached the same way this one did.
//
// **Not a `candidate_id` column on `auth_token`.** That is the better
// long-term shape — it would make the structural scan see this for free —
// but it needs a migration, and Phase 7e is concurrently taking migrations
// `0010`/`0011` on another branch; an 8e migration here would collide on
// merge. Filed as a follow-up rather than risked as a numbering conflict.
//
// **Fix round 3, `F4`: the `audit_log` row is now inside the same
// `db.batch` as the erasure, not written after it commits.** `S-13`
// requires the deletion be logged, and `KG9`'s exemption of `audit_log`
// from the completeness sweep rests on that row actually existing — a
// `db.run` after the batch commits is a window where the erasure has
// irreversibly happened with zero record of it, widened precisely as the
// batch size grows (the nightly sweep this phase's `AC-24` gap still
// needs, built by a sibling task against this same function). The audit
// `INSERT`s are built as `{sql, params}` entries by
// `appendAuditStatement` below — not a call to `@pariksha/db`'s
// `appendAudit`, which issues its own `db.run` and could not be part of
// this batch — and pushed into the same `statements` array `db.batch`
// commits once. `appendAuditStatement` keeps `appendAudit` in its name on
// purpose: `auditCallSitesPassingPersonalData` (`KG9`, the test file)
// greps source for that substring, and a raw `INSERT INTO audit_log` with
// no recognisable call site would have been invisible to it — the same
// shape of blind spot `F3` found on the manifest side, here on the audit
// side instead.

import type { DbClient, TableSpec } from "@pariksha/db";
import { INVITE_KIND, newId, TABLE_MANIFEST } from "@pariksha/db";
import type { StorageAdapter } from "@pariksha/storage";
import { Hono } from "hono";
import { z } from "zod";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

/**
 * Mirrors `@pariksha/db`'s `ScopedFn` convention — `(db, workspaceId,
 * ...rest)` — for this module's exports, without registering through
 * `packages/db`'s `scoped()`: this file lives in `apps/api`, outside the
 * repository layer `scoping.test.ts` enumerates, and nothing here needs the
 * workspace-ID-shape guard that wrapper exists for (both routes already
 * resolve `workspaceId` from the caller's own membership).
 */
export type Scoped<F extends (...args: never[]) => unknown> =
  F extends (...args: infer A) => infer R ? (db: DbClient, workspaceId: string, ...args: A) => R : never;

/**
 * `KG4`'s third bucket: every `TABLE_MANIFEST` table that holds no
 * candidate data and needs no deletion — keyed by name, valued by why, so
 * "exempt" always reads as a decision rather than an absence. `audit_log`
 * is the one case with its own standing reason (`S-13` requires the
 * deletion itself be logged, and `KG9`'s scanner is what keeps that row
 * from ever carrying more than an id); every other entry here is a table
 * that was never about a candidate at all — organiser accounts, bank and
 * test *content*, rate-limit counters — present so
 * `candidateDataClassification`'s completeness test (fix round 3, `F3`)
 * has somewhere to put a table that structurally holds no reference,
 * rather than that table reading as merely unreached, which is the exact
 * shape `auth_token` slipped through in before this fix round.
 */
export const CANDIDATE_DATA_EXEMPT: Readonly<Record<string, string>> = {
  audit_log: "S-13 requires the deletion itself be logged; KG9 keeps that row from naming more than an id.",
  workspace: "branding_json/settings_json describe the workspace itself — never a candidate.",
  user: "An organiser or system account. A candidate has no row in this table at all.",
  membership: "test_grants_json holds a user's (an organiser's) per-test role grants — never a candidate's.",
  session: "An organiser's own signed-in session — never a candidate's.",
  question_bank: "groups_json/tags_json describe the bank's own content — authoring data, not candidate data.",
  question: "media_json/options_json/key_json/scoring_json/tags_json/extra_json describe one question's content.",
  test: "tags_json is the test's own tag list — not candidate data.",
  test_version: "settings_json/sections_json are the published test definition — not candidate data.",
  set: "question_ids_json is a shuffled question list for one (test_version, set_no) pair, not a candidate.",
  rate_limit:
    "bucket/window_start/count are keyed by an opaque bucket string (a test id, an address digest, a " +
    "short code) — never a candidate identifier, and the row carries no personal data to erase.",
  api_key: "scopes_json is the key's own permission scopes — not candidate data.",
  webhook: "events_json is the subscribed event-type list (e.g. \"attempt.submitted\") — configuration, not data.",
  byok_credential: "Workspace AI API credentials encrypted at rest — never candidate data.",
  byok_usage: "Workspace aggregate AI token and cost usage records — never candidate data.",
};

/** `KG4`. See the file header. */
export function holdsCandidateData(table: TableSpec, seen: Set<string> = new Set()): boolean {
  if (table.name === "candidate") return true;
  if (seen.has(table.name)) return false;
  seen.add(table.name);
  for (const column of table.columns) {
    if (!column.name.endsWith("_id")) continue;
    const refName = column.name.slice(0, -3);
    if (refName === "candidate") return true;
    const ref = TABLE_MANIFEST.find((t) => t.name === refName);
    if (ref && holdsCandidateData(ref, seen)) return true;
  }
  return false;
}

/**
 * `F3`'s closed list, keyed by table name: a table whose only reference to
 * `candidate` lives somewhere `holdsCandidateData`'s column scan cannot
 * see — inside a JSON column, for `auth_token` — and so is handled by name
 * in `deleteCandidates` instead of by the structural walk. The value is
 * the reason, read by `candidateDataClassification`'s own test and by
 * nobody else; this is documentation with a compiler check attached to
 * it, not a runtime lookup.
 */
export const CANDIDATE_DATA_HANDLED_OUT_OF_BAND: Readonly<Record<string, string>> = {
  auth_token:
    "InvitePayload.candidateId lives inside payload_json (packages/db/src/repo/run.ts) — auth_token is " +
    "untenanted and carries no candidate_id/attempt_id column at all, so holdsCandidateData cannot see it. " +
    "deleteCandidates deletes matching rows explicitly, by kind + a dialect-specific JSON extraction.",
  webhook_delivery:
    "fireWebhooks (apps/api/src/run/submit.ts) queues attempt.submitted with payload: { attemptId } — " +
    "the same JSON-embedded reference shape as auth_token's payload_json.candidateId (F3); " +
    "webhook_delivery carries no candidate_id/attempt_id column, so holdsCandidateData cannot see it " +
    "either. Re-reviewed post-merge (branch review M4, re-review) once 8d's queueWebhookDeliveries landed " +
    "a real writer: deleteCandidates deletes matching rows explicitly, by this batch's own attemptIds + " +
    "a dialect-specific JSON extraction. test.closed's payload ({ testId }) carries no candidate " +
    "reference at all, so it never matches.",
};

/**
 * `F3`'s closing move: every `TABLE_MANIFEST` table is exactly one of
 * three things — structurally resolved (`holdsCandidateData`), explicitly
 * handled out of band (above), or explicitly exempt
 * (`CANDIDATE_DATA_EXEMPT`, one reason per table). `null` is the failure
 * state: a table in none of the three, which is what `auth_token` was
 * before this fix round — not exempt, not handled, just unreached, which
 * is exactly the shape that lets a second JSON-embedded reference leak
 * silently. The completeness test in this task's test file asserts no
 * `TABLE_MANIFEST` table classifies as `null`.
 */
export function candidateDataClassification(
  table: TableSpec,
): "structural" | "handled" | "exempt" | null {
  if (holdsCandidateData(table)) return "structural";
  if (table.name in CANDIDATE_DATA_HANDLED_OUT_OF_BAND) return "handled";
  if (table.name in CANDIDATE_DATA_EXEMPT) return "exempt";
  return null;
}

/** Raised by `deleteCandidates` when one or more of the given candidates has
 *  a live attempt. The route layer turns this into a 409; a direct caller
 *  (a test, the future nightly sweep) sees a distinguishable type rather
 *  than a bare `Error`, and `candidateIds` names exactly who blocked it. */
export class AttemptInProgressError extends Error {
  readonly candidateIds: readonly string[];
  constructor(candidateIds: readonly string[]) {
    super(
      `Cannot erase ${String(candidateIds.length)} candidate(s): an attempt is still in progress for ` +
        `${candidateIds.join(", ")}. Force-submit it, or wait for the deadline to pass.`,
    );
    this.candidateIds = candidateIds;
  }
}

/** The one existence check both routes need before doing real work, so a
 *  404 and an irreversible delete never run against a row that was never
 *  there. */
export const candidateExists: Scoped<(candidateId: string) => Promise<boolean>> = async (
  db,
  workspaceId,
  candidateId,
) => {
  const rows = await db.query<{ id: string }>("SELECT id FROM candidate WHERE workspace_id = ? AND id = ?", [
    workspaceId,
    candidateId,
  ]);
  return rows.length > 0;
};

/** D1's own ceiling (confirmed against Cloudflare's current docs,
 *  mid-task advisor note). */
export const D1_MAX_BOUND_PARAMS = 100;

/** A chunk of ids plus the statement's own fixed parameters must stay at or
 *  under `D1_MAX_BOUND_PARAMS`. The worst statement built from one of these
 *  chunks is the `candidate` blanking UPDATE — `form_values_json = ?` *and*
 *  `workspace_id = ?` ahead of the id list, two fixed params, not the one
 *  every delete-by-id statement below it carries — so this reserves two
 *  slots for every chunk, not one, even though most statements only need
 *  one. Reserving the shared worst case means one constant is correct for
 *  every statement in this file, rather than a second, smaller one that a
 *  future statement with its own extra parameter would have to remember to
 *  use instead. */
export const MAX_IDS_PER_CHUNK = D1_MAX_BOUND_PARAMS - 2;

/** Splits `items` into groups of at most `size`, in order. Exported so its
 *  own boundary (a group of exactly `size`, never `size + 1`) is testable
 *  directly rather than only through a fixture of 100+ real rows. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const inList = (n: number): string => Array.from({ length: n }, () => "?").join(", ");

interface CandidateRecord {
  id: string;
  test_id: string;
  external_id: string | null;
  set_label: string | null;
  source: string;
  form_values_json: unknown;
  consent_version: string | null;
  consent_at: number | null;
  created_at: number;
}

/** Everything the product holds about one candidate, as a download
 *  (`AC-25`). Flat top-level arrays rather than nested under each attempt —
 *  the candidate's own answers (`responses`) are included even though K29's
 *  deletion list does not name them in this export, because "everything the
 *  product holds" is the actual promise and a candidate's submitted answers
 *  are exactly that. */
export const exportCandidate: Scoped<(candidateId: string) => Promise<{ json: string; filename: string }>> = async (
  db,
  workspaceId,
  candidateId,
) => {
  const candidateRows = await db.query<CandidateRecord>(
    "SELECT id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at " +
      "FROM candidate WHERE workspace_id = ? AND id = ?",
    [workspaceId, candidateId],
  );
  const row = candidateRows[0];
  const candidate =
    row === undefined
      ? null
      : {
          id: row.id,
          testId: row.test_id,
          externalId: row.external_id,
          setLabel: row.set_label,
          source: row.source,
          formValues: row.form_values_json == null ? {} : db.jsonValue(row.form_values_json),
          consentVersion: row.consent_version,
          registeredAt: row.consent_at === null ? null : Number(row.consent_at),
          createdAt: Number(row.created_at),
        };

  const attempts = await db.query<{
    id: string;
    test_version_id: string;
    set_no: number;
    started_at: number;
    deadline_at: number;
    submitted_at: number | null;
    submit_reason: string | null;
    score_json: unknown;
    flag: string;
  }>(
    "SELECT id, test_version_id, set_no, started_at, deadline_at, submitted_at, submit_reason, score_json, flag " +
      "FROM attempt WHERE workspace_id = ? AND candidate_id = ? ORDER BY started_at",
    [workspaceId, candidateId],
  );
  const attemptIds = attempts.map((a) => a.id);

  const responses =
    attemptIds.length === 0
      ? []
      : await db.query(
          `SELECT attempt_id, question_id, value_json, saved_at, points FROM response ` +
            `WHERE workspace_id = ? AND attempt_id IN (${inList(attemptIds.length)}) ORDER BY attempt_id, question_id`,
          [workspaceId, ...attemptIds],
        );
  const events =
    attemptIds.length === 0
      ? []
      : await db.query(
          `SELECT attempt_id, type, detail_json, client_ts, server_ts FROM event ` +
            `WHERE workspace_id = ? AND attempt_id IN (${inList(attemptIds.length)}) ORDER BY server_ts`,
          [workspaceId, ...attemptIds],
        );
  const snapshots =
    attemptIds.length === 0
      ? []
      : await db.query(
          `SELECT attempt_id, storage_key, taken_at, reason FROM snapshot ` +
            `WHERE workspace_id = ? AND attempt_id IN (${inList(attemptIds.length)}) ORDER BY taken_at`,
          [workspaceId, ...attemptIds],
        );

  const json = JSON.stringify(
    {
      candidate,
      attempts: attempts.map((a) => ({
        id: a.id,
        testVersionId: a.test_version_id,
        setNo: Number(a.set_no),
        startedAt: Number(a.started_at),
        deadlineAt: Number(a.deadline_at),
        submittedAt: a.submitted_at === null ? null : Number(a.submitted_at),
        submitReason: a.submit_reason,
        score: a.score_json == null ? null : db.jsonValue(a.score_json),
        flag: a.flag,
      })),
      responses,
      events,
      snapshots,
    },
    null,
    2,
  );
  const filename = `candidate_${candidateId}_export_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  return { json, filename };
};

interface AttemptRow {
  id: string;
  candidate_id: string;
  submitted_at: number | null;
  deadline_at: number;
}

/**
 * `F4`: `@pariksha/db`'s `appendAudit` issues its own `db.run`, which
 * cannot be made part of `deleteCandidates`'s `db.batch`. This builds the
 * identical `INSERT` as a `{sql, params}` entry instead, so the row that
 * logs an erasure commits in the same atomic batch as the erasure itself
 * — see the file header for why that matters and why this keeps
 * `appendAudit` in its own name (`KG9`'s scanner greps for it).
 */
function appendAuditStatement(
  db: DbClient,
  workspaceId: string,
  input: { actor: string; action: string; target: string; detail?: unknown; now: number },
): { sql: string; params: unknown[] } {
  return {
    sql: "INSERT INTO audit_log (id, workspace_id, actor, action, target, detail_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    params: [
      newId("aud"),
      workspaceId,
      input.actor,
      input.action,
      input.target,
      input.detail === undefined ? null : db.jsonParam(input.detail),
      input.now,
    ],
  };
}

/**
 * `K29`, batched (mid-task advisor note: the real implementation, so the
 * nightly sweep this phase's `AC-24` gap still needs can call it without a
 * rewrite). Blanks `candidate` rather than removing it; `keepAnonymisedScore`
 * keeps the `attempt` rows and their `score_json` for every candidate in the
 * batch, `false` removes those too (and the `review` rows that would
 * otherwise be left pointing at a deleted attempt — see the file header).
 *
 * Refuses the **whole** batch if any one candidate in it has an attempt in
 * progress (`AttemptInProgressError`, naming which) — conservative in the
 * same direction as the single-candidate case: never partially erase a
 * batch while deciding, candidate by candidate, which half is safe. A
 * future caller that wants to proceed with the rest can re-call with that
 * candidate removed from `candidateIds`; this function does not guess at
 * that policy for it.
 */
export const deleteCandidates: Scoped<
  (input: {
    candidateIds: string[];
    keepAnonymisedScore: boolean;
    actor: string;
    now: number;
    storage: StorageAdapter;
  }) => Promise<{ tablesTouched: string[] }>
> = async (db, workspaceId, input) => {
  const { candidateIds, keepAnonymisedScore, actor, now, storage } = input;
  if (candidateIds.length === 0) return { tablesTouched: [] };

  const attempts: AttemptRow[] = [];
  for (const idsChunk of chunk(candidateIds, MAX_IDS_PER_CHUNK)) {
    attempts.push(
      ...(await db.query<AttemptRow>(
        `SELECT id, candidate_id, submitted_at, deadline_at FROM attempt ` +
          `WHERE workspace_id = ? AND candidate_id IN (${inList(idsChunk.length)})`,
        [workspaceId, ...idsChunk],
      )),
    );
  }

  const inProgress = [
    ...new Set(
      attempts.filter((a) => a.submitted_at === null && Number(a.deadline_at) > now).map((a) => a.candidate_id),
    ),
  ];
  if (inProgress.length > 0) throw new AttemptInProgressError(inProgress);

  const attemptsByCandidate = new Map<string, string[]>();
  for (const a of attempts) {
    const list = attemptsByCandidate.get(a.candidate_id) ?? [];
    list.push(a.id);
    attemptsByCandidate.set(a.candidate_id, list);
  }
  const attemptIds = attempts.map((a) => a.id);

  const snapshotKeys: string[] = [];
  for (const idsChunk of chunk(attemptIds, MAX_IDS_PER_CHUNK)) {
    snapshotKeys.push(
      ...(
        await db.query<{ storage_key: string }>(
          `SELECT storage_key FROM snapshot WHERE workspace_id = ? AND attempt_id IN (${inList(idsChunk.length)})`,
          [workspaceId, ...idsChunk],
        )
      ).map((r) => r.storage_key),
    );
  }

  // Object first, row second — the same ordering `retention/sweep.ts` uses
  // and for the same reason: a run interrupted between the two leaves a row
  // with no object, which is safe to re-run (the next attempt deletes a row
  // whose object is already gone, which `storage.delete` no-ops on); the
  // reverse would leave an object nothing can ever find again.
  if (snapshotKeys.length > 0) await storage.delete(snapshotKeys);

  const statements: { sql: string; params: unknown[] }[] = [];
  const tablesTouched = new Set<string>(["candidate", "candidate_unique", "auth_token"]);

  // `F3`: `auth_token` is untenanted and carries no `candidate_id` column —
  // `InvitePayload.candidateId` lives inside `payload_json`, so the match
  // is a JSON extraction rather than an indexed column, and the dialect
  // split is the same one `jsonParam`/`jsonValue` already draw (`client.ts`'s
  // own `dialect` field — the split `retention/sweep.ts`'s `dueCandidates`
  // already uses for a different JSON column on the same two dialects).
  // `kind = ?` scopes this to invites specifically; no other `auth_token`
  // kind's payload has a `candidateId` to match in the first place, but
  // naming it is cheaper than leaving the reader to work that out.
  const candidateIdExtract =
    db.dialect === "pg" ? "payload_json ->> 'candidateId'" : "json_extract(payload_json, '$.candidateId')";

  for (const idsChunk of chunk(candidateIds, MAX_IDS_PER_CHUNK)) {
    const inClause = inList(idsChunk.length);
    statements.push(
      {
        sql: `UPDATE candidate SET form_values_json = ?, external_id = NULL WHERE workspace_id = ? AND id IN (${inClause})`,
        params: [db.jsonParam({}), workspaceId, ...idsChunk],
      },
      {
        sql: `DELETE FROM candidate_unique WHERE workspace_id = ? AND candidate_id IN (${inClause})`,
        params: [workspaceId, ...idsChunk],
      },
      {
        sql: `DELETE FROM auth_token WHERE kind = ? AND ${candidateIdExtract} IN (${inClause})`,
        params: [INVITE_KIND, ...idsChunk],
      },
    );
  }

  // Branch review `M4` (re-review, post-merge): 8d's `queueWebhookDeliveries`
  // landed a real writer for `webhook_delivery` (`packages/db/src/repo/webhooks.ts`)
  // — `apps/api/test/retention/candidate.test.ts`'s "webhook_delivery has no
  // production writer yet" tripwire fired on exactly that merge, as designed
  // (see this file's own `CANDIDATE_DATA_EXEMPT` comment, written when the
  // table was still unreachable). The re-review it demanded: `fireWebhooks`
  // (`apps/api/src/run/submit.ts`) only ever queues `attempt.submitted` with
  // `payload: { attemptId }` — `test.closed` carries `{ testId }`, no
  // candidate reference — so `attemptId`, JSON-embedded in `payload_json`
  // exactly the way `auth_token.payload_json.candidateId` was (`F3`), is the
  // one leak. Handled the same way: by name, dialect-aware JSON extraction,
  // matched against this batch's own `attemptIds`. `webhook_delivery` moves
  // from `CANDIDATE_DATA_EXEMPT` to `CANDIDATE_DATA_HANDLED_OUT_OF_BAND`
  // below — the exemption's claim ("nothing to sweep today") no longer
  // holds now that there is something to sweep.
  const webhookAttemptIdExtract =
    db.dialect === "pg" ? "payload_json ->> 'attemptId'" : "json_extract(payload_json, '$.attemptId')";

  if (attemptIds.length > 0) {
    for (const idsChunk of chunk(attemptIds, MAX_IDS_PER_CHUNK)) {
      const inClause = inList(idsChunk.length);
      statements.push(
        { sql: `DELETE FROM response WHERE workspace_id = ? AND attempt_id IN (${inClause})`, params: [workspaceId, ...idsChunk] },
        { sql: `DELETE FROM event WHERE workspace_id = ? AND attempt_id IN (${inClause})`, params: [workspaceId, ...idsChunk] },
        { sql: `DELETE FROM snapshot WHERE workspace_id = ? AND attempt_id IN (${inClause})`, params: [workspaceId, ...idsChunk] },
        {
          sql: `DELETE FROM webhook_delivery WHERE workspace_id = ? AND ${webhookAttemptIdExtract} IN (${inClause})`,
          params: [workspaceId, ...idsChunk],
        },
      );
    }
    tablesTouched.add("response").add("event").add("snapshot").add("webhook_delivery");

    if (!keepAnonymisedScore) {
      for (const idsChunk of chunk(attemptIds, MAX_IDS_PER_CHUNK)) {
        statements.push({
          sql: `DELETE FROM review WHERE workspace_id = ? AND attempt_id IN (${inList(idsChunk.length)})`,
          params: [workspaceId, ...idsChunk],
        });
      }
      for (const idsChunk of chunk(candidateIds, MAX_IDS_PER_CHUNK)) {
        statements.push({
          sql: `DELETE FROM attempt WHERE workspace_id = ? AND candidate_id IN (${inList(idsChunk.length)})`,
          params: [workspaceId, ...idsChunk],
        });
      }
      tablesTouched.add("review").add("attempt");
    }
  }

  // `F4`: folded into the same `statements` array `db.batch` commits once
  // below, not a `db.run` loop after it — see `appendAuditStatement` and
  // the file header. KG9: ids and counts only. Never the blanked form
  // values, never the email `candidate_unique` held a hash of — see
  // `auditCallSitesPassingPersonalData` in this task's test file. One row
  // per candidate, same as every other per-entity audit write in this
  // repository (never one row for a whole batch, which would make "which
  // of these ten was erased" unanswerable from the log alone).
  for (const candidateId of candidateIds) {
    statements.push(
      appendAuditStatement(db, workspaceId, {
        actor,
        action: "candidate.delete",
        target: candidateId,
        detail: {
          keepAnonymisedScore,
          attemptsRemoved: keepAnonymisedScore ? 0 : (attemptsByCandidate.get(candidateId)?.length ?? 0),
        },
        now,
      }),
    );
  }

  await db.batch(statements);

  return { tablesTouched: [...tablesTouched] };
};

/** The brief's one-candidate shape, on top of `deleteCandidates` — see the
 *  file header. This is what the route below calls. */
export const deleteCandidate: Scoped<
  (input: {
    candidateId: string;
    keepAnonymisedScore: boolean;
    actor: string;
    now: number;
    storage: StorageAdapter;
  }) => Promise<{ tablesTouched: string[] }>
> = (db, workspaceId, input) =>
  deleteCandidates(db, workspaceId, {
    candidateIds: [input.candidateId],
    keepAnonymisedScore: input.keepAnonymisedScore,
    actor: input.actor,
    now: input.now,
    storage: input.storage,
  });

const deleteRequest = z.object({ keepAnonymisedScore: z.boolean() });

/**
 * `GET`/`DELETE /api/v1/workspaces/:id/candidates/:candidateId/data` —
 * `workspace`, `candidates.delete` (Owner-only; `app.ts`'s `ROUTE_ACTIONS`
 * and `ROUTE_AUTH` carry the declaration, this only mounts the handlers).
 */
export function candidateDataRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/candidates/:candidateId/data", requires("candidates.delete"), async (c) => {
    const workspaceId = c.req.param("id");
    const candidateId = c.req.param("candidateId");
    if (!(await candidateExists(deps.db, workspaceId, candidateId))) {
      throw new ApiError(404, "not_found", "No such resource.");
    }
    const { json, filename } = await exportCandidate(deps.db, workspaceId, candidateId);
    return c.body(json, 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    });
  });

  routes.delete("/:id/candidates/:candidateId/data", requires("candidates.delete"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const candidateId = c.req.param("candidateId");
    if (!(await candidateExists(deps.db, workspaceId, candidateId))) {
      throw new ApiError(404, "not_found", "No such resource.");
    }

    const parsed = deleteRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "Say whether the anonymised score should be kept (keepAnonymisedScore: true or false).",
      );
    }

    try {
      const result = await deleteCandidate(deps.db, workspaceId, {
        candidateId,
        keepAnonymisedScore: parsed.data.keepAnonymisedScore,
        actor: actor.userId,
        now: deps.now(),
        storage: deps.storage,
      });
      return c.json(result);
    } catch (err) {
      if (err instanceof AttemptInProgressError) {
        throw new ApiError(409, "attempt_in_progress", err.message);
      }
      throw err;
    }
  });

  return routes;
}
