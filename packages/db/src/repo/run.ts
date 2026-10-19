// The candidate runtime's own workspace-scoped reads and writes.
//
// `repo/candidate-entry.ts` holds the one read a candidate makes *before*
// any workspace is known; everything after it has a workspace ID, so it is
// an ordinary `scoped()` function and lives here. Phase 6 Tasks 2 to 11
// each add to this file.
//
// Created by Task 2 (#66, P6.2): six tasks list it under `Files: Modify`
// and none of them under `Create`, which is the plan defect the pre-flight
// scan recorded as A-2.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import type { RegistrationFormSpec } from "@pariksha/core";
import { scoped } from "./guard.js";
import type { TestSettings } from "./test-document.js";

/** The kind every invite row carries. In `consumeAuthToken`'s WHERE
 *  clause, so an entry token cannot be redeemed as an invite or vice
 *  versa. */
export const INVITE_KIND = "run_invite";

/** What `auth_token.payload_json` holds for a `run_invite`. The table is
 *  untenanted (no `workspace_id` column), so the payload is where the
 *  tenancy lives and every reader checks it. */
export interface InvitePayload {
  workspaceId: string;
  testId: string;
  /** The `candidate` row the invite was minted for — `source = "list"`. */
  candidateId: string;
  externalId: string;
  /** Resolved at mint time out of `form_values_json`, so the gate does not
   *  re-read the list row to put it in the entry claim. */
  email: string | null;
}

/**
 * Which of a test's candidate-list entries already hold a live, unused
 * invite — so minting twice for one entry does not issue a second link
 * that would both work.
 *
 * **By `external_id`, not by the row id** (Phase 6 Task 3, #67). A list
 * re-upload deletes and re-inserts every *unregistered* row, so a `cnd_`
 * id is an artefact of the last upload while `external_id` is the
 * identity the organiser chose — keying on the id meant an organiser who
 * fixed one typo and re-uploaded re-minted a second live link for every
 * candidate who already had one.
 *
 * The `WHERE` prunes spent and expired rows in the statement; the tenancy
 * filter is in JavaScript because `auth_token` carries no `workspace_id`
 * and the payload is JSON, whose extraction syntax differs between D1 and
 * Postgres. One statement either way, which is what the budget counts.
 *
 * ponytail: a scan of every live invite on the instance. Fine at the scale
 * a `(test, list)` pair implies — minting is an organiser action, not a
 * request path — and the upgrade when it is not is a `test_id` column on
 * `auth_token`, which is a migration rather than a rewrite.
 */
export const listInvitedExternalIds = scoped(
  "listInvitedExternalIds",
  async (
    db: DbClient,
    workspaceId: string,
    input: { testId: string; now: number },
  ): Promise<string[]> => {
    const rows = await db.query<{ payload_json: unknown }>(
      "SELECT payload_json FROM auth_token WHERE kind = ? AND used_at IS NULL AND expires_at > ?",
      [INVITE_KIND, input.now],
    );
    const ids: string[] = [];
    for (const row of rows) {
      const payload = db.jsonValue<Partial<InvitePayload>>(row.payload_json);
      if (
        payload.workspaceId === workspaceId &&
        payload.testId === input.testId &&
        typeof payload.externalId === "string"
      ) {
        ids.push(payload.externalId);
      }
    }
    return ids;
  },
);

/** Everything the invite route needs that is not on the `candidate` row:
 *  the two slugs the link is built from, and the registration form the
 *  entries' prefill is keyed by. */
export interface InviteTarget {
  workspaceSlug: string;
  testSlug: string;
  registrationForm: RegistrationFormSpec | undefined;
}

/**
 * One statement, and the route's existence check in the same breath: a
 * test in another workspace simply is not found, so the route answers 404
 * and never 403 (`S-09`).
 *
 * The *draft* version, not the published one — the draft is where the
 * registration form an organiser is working against lives, and it is the
 * same row the candidate-list import read the identity column from
 * (`apps/api/src/routes/tests.ts`). A test with no draft still resolves,
 * with no form: an invite is a token, not a registration.
 */
export const inviteTarget = scoped(
  "inviteTarget",
  async (db: DbClient, workspaceId: string, testId: string): Promise<InviteTarget | null> => {
    const rows = await db.query<{
      workspace_slug: string;
      test_slug: string;
      settings_json: unknown;
    }>(
      "SELECT w.slug AS workspace_slug, t.slug AS test_slug, v.settings_json AS settings_json " +
        "FROM test t JOIN workspace w ON w.id = t.workspace_id " +
        "LEFT JOIN test_version v ON v.workspace_id = t.workspace_id AND v.test_id = t.id " +
        "AND v.published_at IS NULL " +
        "WHERE t.workspace_id = ? AND t.id = ?",
      [workspaceId, testId],
    );
    const row = rows[0];
    if (!row) return null;
    const settings =
      row.settings_json == null ? undefined : db.jsonValue<TestSettings>(row.settings_json);
    return {
      workspaceSlug: row.workspace_slug,
      testSlug: row.test_slug,
      registrationForm: settings?.registration_form,
    };
  },
);

// --- Task 3 (#67, P6.3): the registration write ------------------------

/** One `unique: true` field's claim on a value, as a digest. The value
 *  itself never reaches that table (`S-15`). */
export interface UniqueClaim {
  fieldId: string;
  valueHash: string;
}

export interface RegisterCandidateInput {
  testId: string;
  /** Minted by the caller, not here, so the `run_registration` token
   *  written in the same batch can already name the candidate it belongs
   *  to. Equal to `listRef` when there is one. */
  candidateId: string;
  /** The `source = "list"` row the access gate already bound this entry
   *  to, or `null` for a candidate who matched no list row. When it is
   *  set the row is filled **in place**: `(test_id, external_id)` is
   *  unique, so a second row is impossible, and `set_label` must survive
   *  or `assignSet` loses the `listValue` it draws a set from. */
  listRef: string | null;
  /** The normalised value of the form's first `unique: true` field
   *  (`normaliseUniqueValue`, @pariksha/core), written on a
   *  self-registration too — it is what makes `(test_id, external_id)` a
   *  real race backstop on a public test rather than a column only
   *  uploads ever fill. */
  externalId: string | null;
  formValues: unknown;
  consentVersion: string;
  consentAt: number;
  claims: readonly UniqueClaim[];
  /** The `run_entry` token's digest. Spent in the same batch as the write,
   *  so a refused registration does not burn it and send the candidate
   *  back through the access gate to fix a typo. */
  entryTokenHash: string;
  entryKind: string;
  /** The `run_registration` token `/start` will spend, written in the same
   *  batch so a duplicate rolls it back with everything else. */
  registration: { tokenHash: string; kind: string; payload: unknown; expiresAt: number };
  now: number;
}

/** `{ taken }` names the fields whose value is already claimed **and the
 *  candidate holding each**, because the route's answer differs: every
 *  unique value belonging to one existing candidate is that candidate
 *  coming back (`T-14`), and a value belonging to someone else is the
 *  409. */
export type RegisterResult =
  | { candidateId: string }
  | { taken: { fieldId: string; candidateId: string }[] };

/**
 * One candidate, their unique claims, the entry token they spend and the
 * registration token they leave with — in **one** `db.batch`, so a
 * `UNIQUE` violation rolls the whole thing back and `AC-12`'s refusal has
 * no half-written candidate behind it.
 *
 * The in-place fill carries `AND consent_at IS NULL`. Without it a second
 * person typing a *registered* roll number would overwrite the sitting
 * candidate's typed answers and consent, on the row their attempt points
 * at — unrecoverable, and the one row where it matters most. The route
 * reads that row first and answers re-entry or 409 before ever reaching
 * here; this clause is what makes the read a message rather than the only
 * defence.
 *
 * Which `UNIQUE` fired is worked out by reading, not by parsing a driver's
 * error string — those differ across all three dialects. Only
 * `candidate_unique` is read, and that is enough for both constraints:
 * `external_id` is the normalised value of the form's *first* unique
 * field, so a row that collides on `(test_id, external_id)` collides on
 * that field's claim as well, and the claim read finds it. A failure with
 * no claim behind it is therefore not a duplicate at all, and is
 * re-thrown rather than dressed up as one.
 *
 * **The accepted race.** `db.batch` cannot branch on an `UPDATE`'s row
 * count, so if the entry token was spent concurrently the consume matches
 * nothing and the rest of the batch still commits. The route's
 * `readEntryToken` closes the ordinary replay; what is left is one
 * candidate double-submitting their own registration against their own
 * gate, bounded by `test_register` and, on a listed test, by
 * `(test_id, external_id)`.
 */
export const registerCandidate = scoped(
  "registerCandidate",
  async (
    db: DbClient,
    workspaceId: string,
    input: RegisterCandidateInput,
  ): Promise<RegisterResult> => {
    const { candidateId } = input;
    const claimRows = input.claims.map((claim) => ({
      sql:
        "INSERT INTO candidate_unique (id, workspace_id, test_id, candidate_id, field_id, value_hash, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
      params: [
        newId("cuq"),
        workspaceId,
        input.testId,
        candidateId,
        claim.fieldId,
        claim.valueHash,
        input.now,
      ],
    }));

    const write =
      input.listRef === null
        ? {
            sql:
              "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, " +
              "form_values_json, consent_version, consent_at, created_at) " +
              "VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)",
            params: [
              candidateId,
              workspaceId,
              input.testId,
              input.externalId,
              "registration",
              db.jsonParam(input.formValues),
              input.consentVersion,
              input.consentAt,
              input.now,
            ],
          }
        : {
            sql:
              "UPDATE candidate SET form_values_json = ?, consent_version = ?, consent_at = ? " +
              "WHERE workspace_id = ? AND id = ? AND consent_at IS NULL",
            params: [
              db.jsonParam(input.formValues),
              input.consentVersion,
              input.consentAt,
              workspaceId,
              input.listRef,
            ],
          };

    try {
      await db.batch([
        {
          sql:
            "UPDATE auth_token SET used_at = ? WHERE token_hash = ? AND kind = ? " +
            "AND used_at IS NULL AND expires_at > ?",
          params: [input.now, input.entryTokenHash, input.entryKind, input.now],
        },
        write,
        ...claimRows,
        {
          sql:
            "INSERT INTO auth_token (token_hash, kind, payload_json, created_at, expires_at, used_at) " +
            "VALUES (?, ?, ?, ?, ?, NULL)",
          params: [
            input.registration.tokenHash,
            input.registration.kind,
            db.jsonParam(input.registration.payload),
            input.now,
            input.registration.expiresAt,
          ],
        },
      ]);
    } catch (error) {
      const taken = await takenClaims(db, workspaceId, input);
      if (taken.length > 0) return { taken };
      throw error;
    }
    return { candidateId };
  },
);

/** The failure path only: which of this registration's unique values are
 *  already claimed, and by whom. */
async function takenClaims(
  db: DbClient,
  workspaceId: string,
  input: RegisterCandidateInput,
): Promise<{ fieldId: string; candidateId: string }[]> {
  if (input.claims.length === 0) return [];
  const placeholders = input.claims.map(() => "?").join(", ");
  const rows = await db.query<{ field_id: string; candidate_id: string }>(
    "SELECT field_id, candidate_id FROM candidate_unique " +
      `WHERE workspace_id = ? AND test_id = ? AND value_hash IN (${placeholders})`,
    [workspaceId, input.testId, ...input.claims.map((claim) => claim.valueHash)],
  );
  return rows.map((row) => ({ fieldId: row.field_id, candidateId: row.candidate_id }));
}

// --- Task 5 (#69, P6.5): what `attempts_allowed` and `cooldown_minutes`
// are judged against --------------------------------------------------

export interface CandidateAttempts {
  /** Every row, submitted or not. An abandoned attempt **was** an attempt
   *  (`T-14`); a candidate who closes the tab has not earned a fresh one. */
  count: number;
  /**
   * When the most recent attempt *ended*: `COALESCE(submitted_at,
   * deadline_at)`, which is where `cooldown_minutes` is measured from.
   *
   * Not `started_at`, and that is the whole point of the column choice: a
   * 60-minute test with a 30-minute cooldown measured from the start
   * reads "cooldown served" while the candidate is still sitting it.
   */
  lastEndedAt: number | null;
  /**
   * The deadline of an attempt that has not been submitted and whose
   * deadline has not passed, or `null`. `/start` answers 409
   * `attempt_in_progress` on this rather than minting a second row —
   * rotating the token would kill the tab that is still working, and a
   * second row would orphan the first one's answers.
   */
  liveDeadlineAt: number | null;
}

/**
 * One statement for the three numbers the start gate needs.
 *
 * Keyed on the **candidate**, not the test version: a `candidate` row
 * belongs to one test (`candidate.test_id`), so every attempt that row
 * has ever made is this test's, including attempts on a version that has
 * since been superseded. An organiser who republishes mid-window has not
 * handed everyone a fresh allowance.
 */
export const countAttemptsForCandidate = scoped(
  "countAttemptsForCandidate",
  async (db: DbClient, workspaceId: string, candidateId: string, now: number): Promise<CandidateAttempts> => {
    const rows = await db.query<{ n: number; last_ended: number | null; live_deadline: number | null }>(
      "SELECT COUNT(*) AS n, MAX(COALESCE(submitted_at, deadline_at)) AS last_ended, " +
        "MAX(CASE WHEN submitted_at IS NULL AND deadline_at > ? THEN deadline_at END) AS live_deadline " +
        "FROM attempt WHERE workspace_id = ? AND candidate_id = ?",
      [now, workspaceId, candidateId],
    );
    const row = rows[0];
    return {
      count: Number(row?.n ?? 0),
      lastEndedAt: row?.last_ended == null ? null : Number(row.last_ended),
      liveDeadlineAt: row?.live_deadline == null ? null : Number(row.live_deadline),
    };
  },
);

/**
 * `assignSet`'s `registrationIndex` for the two assignments that need a
 * running counter — `round_robin` and `random`.
 *
 * The count of attempts already minted on this version, so the nth
 * candidate to press Start takes the nth set. Read only when a `sets`
 * section actually needs it, so a test without sets never pays for it.
 *
 * ponytail: two candidates starting in the same millisecond can read the
 * same count and land on the same set. `AC-09`'s "no two neighbours
 * alike" is therefore a property of sequential starts, which is what a
 * real cohort does; the upgrade if it ever matters is a counter column
 * incremented in the insert, not a lock.
 */
export const countAttemptsForVersion = scoped(
  "countAttemptsForVersion",
  async (db: DbClient, workspaceId: string, testVersionId: string): Promise<number> => {
    const rows = await db.query<{ n: number }>(
      "SELECT COUNT(*) AS n FROM attempt WHERE workspace_id = ? AND test_version_id = ?",
      [workspaceId, testVersionId],
    );
    return Number(rows[0]?.n ?? 0);
  },
);
