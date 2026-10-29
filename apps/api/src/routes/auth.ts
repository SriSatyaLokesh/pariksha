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
import {
  anyWorkspaceExists,
  appendAudit,
  createPasswordUser,
  getUserCredentialsByEmail,
  getUserCredentialsById,
  setUserPassword,
  setUserTotp,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import type { Actor } from "../auth/session.js";
import { consumeMagicLink, requestMagicLink } from "../auth/magicLink.js";
import { authorizationUrl, handleCallback, safeReturnTo } from "../auth/oidc.js";
import {
  generateTotpSecret,
  getTotpUri,
  hashPassword,
  verifyPassword,
  verifyTotp,
} from "../auth/password.js";
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
import { normaliseEmail } from "@pariksha/core";
import { sha256Hex } from "../auth/tokens.js";
import { limitOrThrow, limitMisses, assertNotRateLimited } from "../run/limit.js";

/** The provider id `auth/identity.ts` gives the email flow. */
const MAGIC_LINK = "magic-link";

const magicLinkRequest = z.object({ email: z.string().min(3).max(320) });

const passwordSignInRequest = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(1000),
  totpCode: z.string().optional(),
  returnTo: z.string().optional(),
});

const passwordRegisterRequest = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  returnTo: z.string().optional(),
});

const totpVerifyRequest = z.object({
  code: z.string().trim().min(6).max(8),
});

const totpDisableRequest = z.object({
  password: z.string().min(1),
});

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
    const emailKey = await sha256Hex(normaliseEmail(body.data.email));
    await limitOrThrow(deps, "auth_magic_link_address", emailKey);
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

  // Phase 10: Docker self-host password authentication (S-01, S-02).
  routes.post("/password/signin", async (c) => {
    if (deps.env.target !== "node") {
      throw new ApiError(
        400,
        "password_not_supported",
        "Password authentication is only supported on Docker/Node deployments.",
      );
    }
    const body = passwordSignInRequest.safeParse(await json(c.req.raw));
    if (!body.success) {
      throw new ApiError(400, "invalid_request", "Email and password are required.");
    }
    const emailKey = await sha256Hex(normaliseEmail(body.data.email));
    await assertNotRateLimited(deps, "auth_password_signin_address", emailKey);
    return await limitMisses(deps, "auth_password_signin_address", emailKey, async () => {
      const creds = await getUserCredentialsByEmail(deps.db, body.data.email);
      if (!creds || !creds.passwordHash) {
        throw new ApiError(401, "invalid_credentials", "Invalid email or password.");
      }
      const valid = await verifyPassword(creds.passwordHash, body.data.password);
      if (!valid) {
        throw new ApiError(401, "invalid_credentials", "Invalid email or password.");
      }
      if (creds.totpEnabled) {
        if (!body.data.totpCode) {
          return c.json({ status: "totp_required" }, 200);
        }
        if (!creds.totpSecret || !verifyTotp(body.data.totpCode, creds.totpSecret, 1, deps.now())) {
          throw new ApiError(400, "invalid_totp", "Invalid two-factor authentication code.");
        }
      }
      const { token } = await issueSession(deps, creds.id);
      await setSessionCookie(c, deps, token);
      await audit(deps, await readSession(deps, token), "auth.signin", {
        provider: "password",
      });
      return c.json({ status: "signed_in", returnTo: safeReturnTo(body.data.returnTo) }, 200);
    });
  });

  routes.post("/password/register", async (c) => {
    if (deps.env.target !== "node") {
      throw new ApiError(
        400,
        "password_not_supported",
        "Password authentication is only supported on Docker/Node deployments.",
      );
    }
    const body = passwordRegisterRequest.safeParse(await json(c.req.raw));
    if (!body.success) {
      throw new ApiError(400, "invalid_request", body.error.issues[0]?.message ?? "Invalid request.");
    }
    const firstRun = !(await anyWorkspaceExists(deps.db));
    const actor = c.get("actor");
    if (!firstRun && !actor) {
      throw new ApiError(403, "forbidden", "Registration is closed. Please sign in or contact your administrator.");
    }

    const existing = await getUserCredentialsByEmail(deps.db, body.data.email);
    const passwordHash = await hashPassword(body.data.password);
    let userId = existing?.id;

    if (existing) {
      if (existing.passwordHash) {
        throw new ApiError(409, "user_exists", "An account with this email already exists.");
      }
      await setUserPassword(deps.db, existing.id, passwordHash);
    } else {
      userId = await createPasswordUser(deps.db, {
        email: body.data.email,
        passwordHash,
        now: deps.now(),
      });
    }

    const { token } = await issueSession(deps, userId!);
    await setSessionCookie(c, deps, token);
    await audit(deps, await readSession(deps, token), "auth.register", {
      provider: "password",
    });
    return c.json({ status: "registered", returnTo: safeReturnTo(body.data.returnTo) }, 201);
  });

  routes.post("/password/totp/setup", actorOnly(), async (c) => {
    const actor = actorOr401(c);
    const secret = generateTotpSecret();
    await setUserTotp(deps.db, actor.userId, secret, false);
    const uri = getTotpUri(actor.email, secret);
    return c.json({ secret, uri }, 200);
  });

  routes.post("/password/totp/verify", actorOnly(), async (c) => {
    const actor = actorOr401(c);
    const body = totpVerifyRequest.safeParse(await json(c.req.raw));
    if (!body.success) {
      throw new ApiError(400, "invalid_request", "A 6-digit verification code is required.");
    }
    const creds = await getUserCredentialsById(deps.db, actor.userId);
    if (!creds?.totpSecret) {
      throw new ApiError(400, "totp_not_setup", "Two-factor authentication has not been initiated.");
    }
    await assertNotRateLimited(deps, "auth_totp_verify_user", actor.userId);
    return await limitMisses(deps, "auth_totp_verify_user", actor.userId, async () => {
      if (!verifyTotp(body.data.code, creds.totpSecret, 1, deps.now())) {
        throw new ApiError(400, "invalid_totp", "The verification code is incorrect.");
      }
      await setUserTotp(deps.db, actor.userId, creds.totpSecret, true);
      await audit(deps, actor, "auth.totp_enabled", {});
      return c.json({ status: "enabled" }, 200);
    });
  });

  routes.post("/password/totp/disable", actorOnly(), async (c) => {
    const actor = actorOr401(c);
    const body = totpDisableRequest.safeParse(await json(c.req.raw));
    if (!body.success) {
      throw new ApiError(400, "invalid_request", "Your current password is required.");
    }
    const creds = await getUserCredentialsById(deps.db, actor.userId);
    if (!creds?.passwordHash || !(await verifyPassword(creds.passwordHash, body.data.password))) {
      throw new ApiError(401, "invalid_credentials", "Incorrect password.");
    }
    await setUserTotp(deps.db, actor.userId, null, false);
    await audit(deps, actor, "auth.totp_disabled", {});
    return c.json({ status: "disabled" }, 200);
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
