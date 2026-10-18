// Users and sessions: the part of the repository layer that has no workspace
// to be scoped to, and cannot be given one.
//
// A session is looked up *before* any workspace is known — the lookup is what
// tells the request which workspaces the actor may see at all — so these
// functions take no workspace ID and so cannot go through `scoped()`. Rather
// than add an exemption list to `guard.ts` that later phases would quietly
// grow, this module is simply not re-exported from `repo/index.ts`: that
// barrel keeps its rule intact, "every function here is scoped", with no "…
// except" clause. `identity.test.ts` asserts the separation holds in both
// directions, so neither half can drift into the other by accident.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";

/**
 * One row of the join behind `readSession`. A user with no membership still
 * produces a row, with the membership columns null — an invited organiser who
 * has not been added to a workspace yet is a real actor.
 */
export interface SessionActorRow {
  userId: string;
  email: string;
  workspaceId: string | null;
  role: string | null;
  testGrants: unknown;
}

export async function createUser(
  db: DbClient,
  input: { email: string; authProvider: string; now: number },
): Promise<string> {
  const id = newId("usr");
  // `user` is a reserved word in Postgres, so the identifier is quoted in
  // every dialect rather than only where it has to be.
  await db.run(
    'INSERT INTO "user" (id, email, auth_provider, created_at) VALUES (?, ?, ?, ?)',
    [id, input.email, input.authProvider, input.now],
  );
  return id;
}

export async function insertSession(
  db: DbClient,
  input: {
    tokenHash: string;
    userId: string;
    now: number;
    expiresAt: number;
  },
): Promise<void> {
  await db.run(
    "INSERT INTO session (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [input.tokenHash, input.userId, input.now, input.now, input.expiresAt],
  );
}

/**
 * The authenticated request's one read: session, user and every membership
 * with its grants, in a single statement. One query per membership here would
 * be multiplied by every authenticated request against the 50-subrequest
 * budget a Workers invocation gets.
 *
 * Expiry is part of the WHERE clause, not a check on the result, so an
 * expired row can never be mistaken for a live one by a caller that forgets.
 */
export async function readSessionActor(
  db: DbClient,
  tokenHash: string,
  now: number,
): Promise<SessionActorRow[]> {
  const rows = await db.query<{
    user_id: string;
    email: string;
    workspace_id: string | null;
    role: string | null;
    test_grants_json: unknown;
  }>(
    "SELECT u.id AS user_id, u.email AS email, m.workspace_id AS workspace_id, " +
      "m.role AS role, m.test_grants_json AS test_grants_json " +
      'FROM session s JOIN "user" u ON u.id = s.user_id ' +
      "LEFT JOIN membership m ON m.user_id = u.id " +
      "WHERE s.token_hash = ? AND s.expires_at > ? " +
      "ORDER BY m.created_at",
    [tokenHash, now],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    workspaceId: row.workspace_id,
    role: row.role,
    testGrants:
      row.test_grants_json == null ? null : db.jsonValue(row.test_grants_json),
  }));
}

/** Slides the idle window forward. */
export async function touchSession(
  db: DbClient,
  tokenHash: string,
  lastUsedAt: number,
  expiresAt: number,
): Promise<void> {
  await db.run(
    "UPDATE session SET last_used_at = ?, expires_at = ? WHERE token_hash = ?",
    [lastUsedAt, expiresAt, tokenHash],
  );
}

export async function deleteSession(
  db: DbClient,
  tokenHash: string,
): Promise<void> {
  await db.run("DELETE FROM session WHERE token_hash = ?", [tokenHash]);
}

/** "Sign out everywhere" (S-03), and what a revoked account needs too. */
export async function deleteUserSessions(
  db: DbClient,
  userId: string,
): Promise<void> {
  await db.run("DELETE FROM session WHERE user_id = ?", [userId]);
}
