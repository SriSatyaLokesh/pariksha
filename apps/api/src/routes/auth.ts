// Sign-in and sign-out. Thin wrappers: the flows themselves live in
// `auth/oidc.ts` and `auth/magicLink.ts`, and what is left here is the part
// that needs a request — the cookie, the redirect and the audit row.
//
// The sign-in audit entry (S-18) is written here and nowhere earlier because
// `appendAudit` is workspace-scoped and, at the moment a magic link or an
// OIDC callback is redeemed, nobody yet knows which workspaces the person
// belongs to. `readSession` is the call that answers that, so the row can
// only be written once the session exists.
//
// Both callbacks land on one route. A magic link arrives as a GET carrying a
// token and an OIDC callback as a GET carrying a code and a state; separate
// routes would mean writing "issue a session, set the cookie, audit,
// redirect" twice, and the second copy is where the audit entry goes missing.

import { Hono, type Context } from "hono";
import { getSignedCookie } from "hono/cookie";
import { z } from "zod";
import { appendAudit } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import type { Actor } from "../auth/session.js";
import { consumeMagicLink, requestMagicLink } from "../auth/magicLink.js";
import { authorizationUrl, handleCallback, safeReturnTo } from "../auth/oidc.js";
import {
  issueSession,
  readSession,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
} from "../auth/session.js";
import { ApiError } from "../errors.js";
import {
  clearSessionCookie,
  setSessionCookie,
} from "../middleware/authenticate.js";
import { actorOnly, actorOr401 } from "../middleware/authorize.js";

/** The provider id `auth/identity.ts` gives the email flow. */
const MAGIC_LINK = "magic-link";

const magicLinkRequest = z.object({ email: z.string().min(3).max(320) });

export function authRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // 202 and one fixed body, always. Review Focus 3: a response that differs
  // for a known and an unknown address turns the sign-in form into a
  // directory of who holds an account on this instance, and
  // `requestMagicLink` already does the same work either way so there is no
  // timing difference to read instead.
  routes.post("/magic-link", async (c) => {
    const body = magicLinkRequest.safeParse(await json(c.req.raw));
    if (!body.success) {
      throw new ApiError(
        400,
        "invalid_request",
        "An email address is required.",
      );
    }
    await requestMagicLink(deps, body.data.email);
    return c.json({ status: "sent" }, 202);
  });

  routes.get("/:provider/start", async (c) => {
    const { url } = await authorizationUrl(
      deps,
      c.req.param("provider"),
      safeReturnTo(c.req.query("returnTo")),
      deps.http,
    );
    return c.redirect(url, 302);
  });

  routes.get("/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    const signedIn =
      provider === MAGIC_LINK
        ? {
            ...(await consumeMagicLink(deps, c.req.query("token") ?? "")),
            returnTo: safeReturnTo(c.req.query("returnTo")),
          }
        : await handleCallback(
            deps,
            provider,
            {
              code: c.req.query("code") ?? "",
              state: c.req.query("state") ?? "",
            },
            deps.http,
          );

    const { token } = await issueSession(deps, signedIn.userId);
    await setSessionCookie(c, deps, token);
    // The one place the actor has to be re-read: the session was created a
    // line ago, so its memberships — which is to say, the workspaces this
    // sign-in is auditable in — are not on `c.var` yet.
    await audit(deps, await readSession(deps, token), "auth.signin", {
      provider,
    });
    return c.redirect(signedIn.returnTo, 302);
  });

  routes.post("/signout", async (c) => {
    const token = await bearerCookie(c, deps);
    await audit(deps, c.get("actor"), "auth.signout", {});
    if (token) await revokeSession(deps, token);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  // `actorOnly()` (whole-branch review, CRITICAL): before this, a key of
  // any scope could call this and revoke every session its creator holds
  // — `revokeAllSessions(deps, "key_…")` matched nothing, so the call was
  // not even functional, but it still wrote an `auth.signout_everywhere`
  // audit row attributed to the key, over a credential with no action to
  // check it against.
  routes.post("/signout-everywhere", actorOnly(), async (c) => {
    const actor = actorOr401(c);
    await audit(deps, actor, "auth.signout_everywhere", {});
    await revokeAllSessions(deps, actor.userId);
    clearSessionCookie(c);
    return c.body(null, 204);
  });

  return routes;
}

/**
 * One row per workspace the actor belongs to. An account with no membership
 * — an organiser invited but not yet added, or the very first sign-in before
 * the wizard has run — writes none: there is no workspace to scope the row
 * to, and an audit table readable across tenants is the thing `scoped()`
 * exists to prevent.
 *
 * A key actor (`apiKeyScopes` set) also writes none (whole-branch re-review,
 * CRITICAL-1): `POST /signout` is `public` so a key can call it, but a key
 * has no session to end and nothing it did here, so there is no event to
 * record — not a null actor's "nowhere to scope it", but "this did not
 * happen". Skipping here, in the one function both `/signout` and
 * `/signout-everywhere` call through, covers both rather than guarding each
 * route's own call site; `/signout-everywhere` never reaches a key actor at
 * all (`actorOnly()`), so this is a no-op there and the fix for the one
 * route that does.
 */
async function audit(
  deps: AppDeps,
  actor: Actor | null,
  action: string,
  detail: Record<string, unknown>,
): Promise<void> {
  if (!actor || actor.apiKeyScopes !== undefined) return;
  for (const membership of actor.memberships) {
    await appendAudit(deps.db, membership.workspaceId, {
      actor: actor.userId,
      action,
      target: actor.userId,
      detail,
      now: deps.now(),
    });
  }
}

function bearerCookie(
  c: Context<AppBindings>,
  deps: AppDeps,
): Promise<string | false | undefined> {
  return getSignedCookie(c, deps.env.sessionSecret, SESSION_COOKIE);
}

/** A body that is absent or not JSON is a bad request, not a 500. */
async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
