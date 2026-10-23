// Who is asking, on every request.
//
// This is the hottest path in the application: it runs before every route,
// authenticated or not, against a 50-subrequest budget (ADR 0002). So it
// spends exactly what `readSession` spends — one read of the session, the
// user and every membership in a single join, plus the write that slides the
// idle window — and nothing per membership or per grant on top. Anything a
// route needs to decide an answer is already on `c.var.actor`.
//
// An absent, malformed or dead cookie all produce a null actor rather than a
// rejection: whether the request is allowed is the authorization layer's
// question, and answering it here would mean two places deciding what 401
// means.
//
// Phase 8d Task 2 (`K25`): a `pk_…` key, presented as `Authorization:
// Bearer`, is resolved instead of the cookie — never both, never one
// falling back to the other. `resolveApiKey` costs the same **two**
// subrequests `readSession` does (one indexed read by hash, one
// `last_used_at` write), so a key-authenticated request pays the same
// authentication floor a cookie-authenticated one already does. A
// session-cookie request is untouched: this branch is only ever taken when
// the header is present and starts with `pk_`, so it adds nothing to the
// cost of every other request in the product.

import type { MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Context } from "hono";
import { resolveApiKey } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { readSession, SESSION_COOKIE, SESSION_IDLE_MS, type Actor } from "../auth/session.js";

/**
 * Signed with `SESSION_SECRET`, which is what makes a cookie nobody issued
 * cost no database read at all — the token itself is 256 bits of CSPRNG
 * output and needs no secrecy beyond being stored hashed, so the signature
 * buys rejection of junk rather than unguessability.
 *
 * `Secure` is unconditional: an instance served over plain HTTP is one where
 * the session cookie is on the wire, and silently relaxing it for
 * convenience is how that ships.
 */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
} as const;

const BEARER_PREFIX = "Bearer ";
const API_KEY_PREFIX = "pk_";

/**
 * A `pk_…` key presented as `Authorization: Bearer`, or `null` for
 * everything else — including the `entry` authority's own single-use
 * Bearer token (`S-06`), which is a different shape entirely (a bare
 * `randomToken()`, never `pk_`-prefixed) and is read by `entryClaim`
 * (`run/registration.ts`) directly off the header, never through
 * `c.var.actor`. So this branch existing changes nothing for it: a
 * non-`pk_` Bearer header falls straight through to the cookie check
 * below, same as no `Authorization` header at all.
 */
function apiKeyFrom(header: string | undefined): string | null {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token.startsWith(API_KEY_PREFIX) ? token : null;
}

/**
 * Phase 8d Task 2 (`K25`): the key's own `Actor` shape — one membership, in
 * the key's own workspace, carrying `apiKeyScopes` so `requires()` checks
 * those instead of asking `can()` what `role` below would allow. `role` is
 * a placeholder never read while `apiKeyScopes` is set (`authorize.ts`
 * checks it first, unconditionally) — `"viewer"` only because the field is
 * not optional and nothing beneath the lowest role is meaningful to write
 * instead.
 *
 * Fails closed: an absent, malformed or revoked key all answer the same
 * `null` `resolveApiKey` does, never a session fallback.
 */
async function actorForApiKey(deps: AppDeps, presented: string): Promise<Actor | null> {
  const resolved = await resolveApiKey(deps.db, presented, deps.now());
  if (resolved === null) return null;
  return {
    userId: resolved.apiKeyId,
    email: "",
    memberships: [{ workspaceId: resolved.workspaceId, role: "viewer", grants: [] }],
    apiKeyScopes: resolved.scopes,
  };
}

export function authenticate(deps: AppDeps): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const presentedKey = apiKeyFrom(c.req.header("Authorization"));
    if (presentedKey !== null) {
      c.set("actor", await actorForApiKey(deps, presentedKey));
      await next();
      return;
    }
    const token = await getSignedCookie(c, deps.env.sessionSecret, SESSION_COOKIE);
    c.set("actor", token ? await readSession(deps, token) : null);
    await next();
  };
}

export async function setSessionCookie(
  c: Context<AppBindings>,
  deps: AppDeps,
  token: string,
): Promise<void> {
  await setSignedCookie(c, SESSION_COOKIE, token, deps.env.sessionSecret, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_IDLE_MS / 1000,
  });
}

export function clearSessionCookie(c: Context<AppBindings>): void {
  deleteCookie(c, SESSION_COOKIE, COOKIE_OPTIONS);
}
