// Server-side sessions (PRD S-03).
//
// The cookie carries 32 random bytes and nothing else — no claims, no role,
// no expiry a client could edit. Everything a request needs is read from the
// row behind it, which is what makes a role change take effect on the next
// request instead of at the next token expiry; a demoted Admin keeping Admin
// for twelve hours would make the permission matrix advisory rather than
// enforced (Review Focus 4).
//
// Only the SHA-256 of the token is stored, so a database dump yields no live
// session. SHA-256 and not a password hash: the token is 256 bits of CSPRNG
// output, so there is nothing to brute-force and nothing a salt would buy,
// and the Workers free plan's 10 ms of CPU per invocation would not stretch
// to Argon2id on the hottest path in the application anyway (ADR 0002).

import {
  deleteSession,
  deleteUserSessions,
  insertSession,
  readSessionActor,
  touchSession,
} from "@pariksha/db";
import type { Action, Role } from "@pariksha/core";
import type { AppDeps } from "../app.js";
import { randomToken, sha256Hex } from "./tokens.js";

export const SESSION_COOKIE = "pk_session";
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;

export interface Actor {
  userId: string;
  email: string;
  memberships: {
    workspaceId: string;
    role: Role;
    grants: { testId: string; role: Role }[];
  }[];
  /**
   * Phase 8d Task 2 (`K25`): present only on an actor `authenticate.ts`
   * resolved from a `pk_…` API key, never from a session cookie. A key's
   * scopes are an explicit subset chosen at creation time, not a role's
   * whole grant — so `requires()` checks these directly and never asks
   * `can()` what the one synthetic membership's placeholder role would
   * allow. A key still satisfies the `workspace` authority through that
   * same membership (`route-authority.test.ts`'s own assertion, unchanged)
   * — this field narrows what it is admitted to inside it, it does not
   * add a sixth authority beside it.
   */
  apiKeyScopes?: readonly Action[];
}

export async function issueSession(
  deps: AppDeps,
  userId: string,
): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken();
  const now = deps.now();
  const expiresAt = now + SESSION_IDLE_MS;
  await insertSession(deps.db, {
    tokenHash: await sha256Hex(token),
    userId,
    now,
    expiresAt,
  });
  return { token, expiresAt };
}

/**
 * Two database calls, and two whatever the actor's membership count — the
 * join reads them all at once. This runs on every authenticated request
 * against a 50-subrequest budget, so a third call here is the one that
 * matters.
 */
export async function readSession(
  deps: AppDeps,
  token: string,
): Promise<Actor | null> {
  const now = deps.now();
  const tokenHash = await sha256Hex(token);
  const rows = await readSessionActor(deps.db, tokenHash, now);

  const first = rows[0];
  if (!first) return null;

  await touchSession(deps.db, tokenHash, now, now + SESSION_IDLE_MS);

  return {
    userId: first.userId,
    email: first.email,
    memberships: rows.flatMap((row) =>
      row.workspaceId === null || row.role === null
        ? []
        : [
            {
              workspaceId: row.workspaceId,
              role: row.role as Role,
              grants: grantsOf(row.testGrants),
            },
          ],
    ),
  };
}

/**
 * Called on sign-in and on every role change. The new row is written before
 * the old one is dropped, so a failure between the two leaves the organiser
 * signed in on a stale token rather than signed out mid-session — and the
 * stale token still expires on its own idle window.
 */
export async function rotateSession(
  deps: AppDeps,
  token: string,
): Promise<{ token: string } | null> {
  const tokenHash = await sha256Hex(token);
  const rows = await readSessionActor(deps.db, tokenHash, deps.now());

  const first = rows[0];
  if (!first) return null;

  const next = await issueSession(deps, first.userId);
  await deleteSession(deps.db, tokenHash);
  return { token: next.token };
}

export async function revokeSession(
  deps: AppDeps,
  token: string,
): Promise<void> {
  await deleteSession(deps.db, await sha256Hex(token));
}

export async function revokeAllSessions(
  deps: AppDeps,
  userId: string,
): Promise<void> {
  await deleteUserSessions(deps.db, userId);
}

/**
 * Grants are written by this server, never by a client, so the stored shape
 * is trusted; the guard is against a null column and a hand-edited row, not
 * against an attacker.
 */
function grantsOf(raw: unknown): { testId: string; role: Role }[] {
  return Array.isArray(raw) ? (raw as { testId: string; role: Role }[]) : [];
}
