// The gate (AC-23). Everything above this file describes permissions; this
// is where they are refused.
//
// Three answers, and the order they are decided in is the whole of it:
//
//   1. **401 when nobody is asking.** Collapsing this into 403 tells an
//      unauthenticated caller that the resource exists.
//   2. **404 when the actor holds no membership in the workspace named by
//      the path** (S-09). Not 403: a 403 confirms that `wsp_…` is a real
//      workspace to someone who cannot see it, which is a disclosure rather
//      than a cosmetic difference. The body is byte-identical to the
//      application's own 404, so the two cannot be told apart from outside.
//   3. **403 when the membership exists and the matrix says no.**
//
// Reversing 2 and 3 is the likely defect here, and it is silent: every test
// that only checks "refused" passes either way. `authorization.test.ts`
// checks which refusal.
//
// Nothing here reads the database. The actor arrived on `c.var` with its
// memberships and grants already loaded, so the gate costs no subrequest and
// can therefore be put in front of every workspace route without thought.

import type { Context, MiddlewareHandler, Next } from "hono";
import { can, type Action } from "@pariksha/core";
import type { AppBindings } from "../app.js";
import type { Actor } from "../auth/session.js";
import { ApiError } from "../errors.js";

type Membership = Actor["memberships"][number];

/**
 * Which action each guard middleware enforces, keyed by the middleware
 * itself. `instrument.ts` reads it back off Hono's live route table, so the
 * `ROUTE_ACTIONS` declaration in `app.ts` is checked against the middleware
 * actually mounted rather than against itself. `null` is a guard that
 * requires membership and no particular action.
 */
const GUARDS = new WeakMap<object, { action: Action | null }>();

export function guardOf(
  handler: unknown,
): { action: Action | null } | undefined {
  return typeof handler === "function" ? GUARDS.get(handler) : undefined;
}

/** Membership in the workspace the path names, and nothing more. */
export function requireMember(): MiddlewareHandler<AppBindings> {
  return guard(null, () => undefined);
}

/**
 * Signed in, and nothing else — the mirror of `requireMember()` for the five
 * routes `ROUTE_AUTH` declares `"actor"`: no `:id`, so no membership for
 * `guard()` to check and no action for a key's scopes to be checked against
 * either.
 *
 * CRITICAL (whole-branch review): a key is a workspace-scoped credential by
 * construction (`K25`) — `resolveApiKey` names exactly one workspace. A
 * route that names none has nothing for `requires()`'s scope check to run
 * against, and before this function existed nothing ran at all: a key
 * scoped to one read-only action could `POST /workspaces` (writing an
 * orphan `membership` row with `user_id` set to the key's own id, since
 * migration `0000` declares no foreign keys), read `GET /me` under a
 * fabricated `role: "viewer"`, list `GET /workspaces`, and revoke every
 * session on `POST /auth/signout-everywhere` — none of it bounded by any
 * scope, because none of those handlers ever asked.
 */
export function actorOnly(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (actorOr401(c).apiKeyScopes !== undefined) {
      throw new ApiError(403, "forbidden", "A key cannot act outside a workspace.");
    }
    await next();
  };
}

export function requires(action: Action): MiddlewareHandler<AppBindings> {
  return guard(action, (c, membership) => {
    // Phase 8d Task 2 (`K25`): a key-authenticated actor carries its own
    // scopes instead of a role `can()` would answer for. Checked first and
    // decided entirely on its own — never combined with the role below —
    // because a key's scopes are the whole of what it is allowed, not an
    // addition to it.
    //
    // MAJOR-4 (whole-branch review): routed through `can()` itself, not a
    // second, parallel `.includes()` this function used to carry — one
    // decision function for both principals, so a rule added to `can()`
    // later applies to a key the same way it applies to a session, instead
    // of silently applying to sessions only.
    const keyScopes = actorOr401(c).apiKeyScopes;
    if (keyScopes !== undefined) {
      if (can({ actions: keyScopes, action })) return undefined;
      throw new ApiError(403, "forbidden", `This key does not hold ${action}.`);
    }

    // A grant raises the role for one test and never lowers the workspace
    // role, so it is passed through rather than substituted. No route takes
    // a `:testId` yet; wiring it here means the first one that does inherits
    // S-08 instead of having to remember it.
    const testId = c.req.param("testId");
    if (
      can({
        role: membership.role,
        action,
        ...(testId === undefined ? {} : { testId, grants: membership.grants }),
      })
    ) {
      return undefined;
    }
    throw new ApiError(
      403,
      "forbidden",
      `A ${membership.role} may not ${action} in this workspace.`,
    );
  });
}

/** The signed-in actor, or 401. For routes that need no workspace. */
export function actorOr401(c: Context<AppBindings>): Actor {
  const actor = c.get("actor");
  if (!actor) {
    throw new ApiError(401, "unauthenticated", "Sign in to continue.");
  }
  return actor;
}

/**
 * The actor's membership in `workspaceId`, or the application's own 404.
 * Exported because a handler that resolves a workspace from somewhere other
 * than `:id` still owes S-09 the same answer.
 */
export function membershipOr404(
  actor: Actor,
  workspaceId: string,
): Membership {
  const membership = actor.memberships.find(
    (m) => m.workspaceId === workspaceId,
  );
  if (!membership) throw new ApiError(404, "not_found", "No such resource.");
  return membership;
}

function guard(
  action: Action | null,
  check: (c: Context<AppBindings>, membership: Membership) => void,
): MiddlewareHandler<AppBindings> {
  const handler = async (c: Context<AppBindings>, next: Next) => {
    const actor = actorOr401(c);
    // CRITICAL (whole-branch review): `requireMember()` names no action —
    // "membership, and nothing more" — which for a session actor is exactly
    // one step above `actorOnly()`. For a key it is not: a key's scopes are
    // *all* it is allowed, and a route with no action names nothing for
    // them to be checked against, so a key must never reach one at all.
    // `requires(action)`'s own scope check (below, in the closure `guard`
    // wraps) only runs for a non-null action — this is the line that keeps
    // `requireMember()` from being the one hole that check doesn't cover.
    if (action === null && actor.apiKeyScopes !== undefined) {
      throw new ApiError(403, "forbidden", "A key must name the action it holds.");
    }
    const workspaceId = c.req.param("id");
    if (workspaceId === undefined) {
      // A guard on a route with no `:id` would silently authorize nothing,
      // which is worse than failing to boot.
      throw new Error(
        `${c.req.routePath} is guarded but names no :id workspace parameter`,
      );
    }
    check(c, membershipOr404(actor, workspaceId));
    await next();
  };

  GUARDS.set(handler, { action });
  return handler;
}
