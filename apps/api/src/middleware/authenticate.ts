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

import type { MiddlewareHandler } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Context } from "hono";
import type { AppBindings, AppDeps } from "../app.js";
import { readSession, SESSION_COOKIE, SESSION_IDLE_MS } from "../auth/session.js";

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

export function authenticate(deps: AppDeps): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
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
