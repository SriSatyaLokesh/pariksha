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
export const listInvitedEntryIds = scoped(
  "listInvitedEntryIds",
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
        typeof payload.candidateId === "string"
      ) {
        ids.push(payload.candidateId);
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
