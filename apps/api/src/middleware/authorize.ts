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

export function requires(action: Action): MiddlewareHandler<AppBindings> {
  return guard(action, (c, membership) => {
    // Phase 8d Task 2 (`K25`): a key-authenticated actor carries its own
    // scopes instead of a role `can()` would answer for. Checked first and
    // decided entirely on its own — never combined with the role below —
    // because a key's scopes are the whole of what it is allowed, not an
    // addition to it.
    const keyScopes = actorOr401(c).apiKeyScopes;
    if (keyScopes !== undefined) {
      if (keyScopes.includes(action)) return undefined;
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
