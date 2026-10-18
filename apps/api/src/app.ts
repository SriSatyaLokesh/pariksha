// The whole application, built from injected dependencies and nothing else.
// There is no module-level database, clock or bucket here, which is why every
// route is testable over in-memory adapters with no network and no fake
// timers — and why the Workers and Node entry points are binding code only.

import { Hono } from "hono";
import { requestId, type RequestIdVariables } from "hono/request-id";
import type { DbClient } from "@pariksha/db";
import type { StorageAdapter } from "@pariksha/storage";
import type { Action } from "@pariksha/core";
import type { AppEnv } from "./env.js";
import type { Actor } from "./auth/session.js";
import { securityHeaders } from "./middleware/security.js";
import { logging } from "./middleware/logging.js";
import { errorEnvelope, notFoundEnvelope } from "./middleware/errorEnvelope.js";
import { authenticate } from "./middleware/authenticate.js";
import { health } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { me } from "./routes/me.js";
import { setupRoutes } from "./routes/setup.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { bankRoutes } from "./routes/banks.js";
import { questionRoutes } from "./routes/questions.js";
import { mediaRoutes } from "./routes/media.js";

export interface AppDeps {
  db: DbClient;
  storage: StorageAdapter;
  /**
   * Injected for the same reason it is in storage: the server timer (AC-13)
   * and every expiry check read one clock, and a test moves it without
   * faking a global.
   */
  now: () => number;
  env: AppEnv;
  /**
   * Injected only so the OIDC routes reach a provider a test controls. Left
   * unset everywhere else, where `globalThis.fetch` is the right answer on
   * both targets.
   */
  http?: typeof globalThis.fetch;
}

export type AppBindings = {
  Variables: RequestIdVariables & { actor: Actor | null };
};

/**
 * The most subrequests each route may spend on one invocation, against the
 * platform's 50 (ADR 0002). It lives here, next to the mounting, because
 * `budget.test.ts` requires the two to agree: mounting a route without
 * declaring its budget fails the suite, which is how the guard reaches
 * phases nobody has written yet.
 */
export const ROUTE_BUDGETS: Record<string, number> = {
  "/api/v1/health": 1,
  // Two for authentication on every authenticated route — the session join
  // and the idle-window write — and then what the route itself spends.
  "/api/v1/auth/magic-link": 4,
  "/api/v1/auth/:provider/start": 3,
  // The three sign-in and sign-out routes carry the same open-ended cost:
  // S-18 wants the event recorded in each of the actor's workspaces, and the
  // audit table is workspace-scoped, so the row count is the membership
  // count.
  //
  // ponytail: an organiser belongs to one or two workspaces, so these sit
  // well under the ceiling in practice and the headroom here is what bounds
  // them. If an instance ever grows an account in a dozen workspaces, the
  // move is a multi-row insert in `appendAudit`, not a larger number here.
  "/api/v1/auth/:provider/callback": 12,
  "/api/v1/auth/signout": 12,
  "/api/v1/auth/signout-everywhere": 12,
  "/api/v1/me": 2,
  // `status` is one statement and costs no authentication: it answers an
  // unauthenticated sign-in screen. `complete` is authentication, the claim
  // read, the claiming insert and the owner membership.
  "/api/v1/setup/status": 1,
  "/api/v1/setup/complete": 6,
  // Authentication, then one statement: the list, or the create plus the
  // owner membership.
  "/api/v1/workspaces": 6,
  "/api/v1/workspaces/:id": 5,
  // The heaviest: resolve the invitee, list the members, write the change,
  // revoke the member's sessions, append the audit row.
  "/api/v1/workspaces/:id/members": 10,

  // Phase 4 Task 2: banks, questions and media. These numbers are measured
  // (apps/api/test/banks.test.ts's and media.test.ts's "measures the real
  // subrequest cost" tests, via `countingDeps` — the same technique
  // `budget.test.ts` uses for `/health`), not estimated: a first pass here
  // guessed roughly half these values before `bankOr404`'s existence check
  // and each write's audit row were accounted for, and fixture review
  // caught that the declared numbers and the real cost had drifted apart.
  // Each is the most expensive method sharing that path — authentication
  // alone costs 2 (the session join and the idle-window write), so even the
  // cheapest GET here never reads for less than 3.
  "/api/v1/workspaces/:id/banks": 5,
  "/api/v1/workspaces/:id/banks/:bankId": 7,
  "/api/v1/workspaces/:id/tags": 3,
  // Phase 4 Task 6: passage groups. `assertValid` adds one `listGroups` call
  // (itself one or two statements, depending on whether the bank has any
  // groups yet) to every question write, which is why these two numbers grew
  // from Task 2's.
  "/api/v1/workspaces/:id/banks/:bankId/questions": 9,
  "/api/v1/workspaces/:id/banks/:bankId/questions/:qid": 10,
  "/api/v1/workspaces/:id/banks/:bankId/media": 4,
  "/api/v1/workspaces/:id/media/:key": 3,
  // Fix round 1, finding 1: measured against a bank that already has a
  // group, not an empty one — `listGroups` costs one statement on an empty
  // bank (`rawGroups.length === 0` short-circuits) and two once there is a
  // group to count, which is the common case after the first write.
  "/api/v1/workspaces/:id/banks/:bankId/groups": 8,
  // Fix round 1, finding 8: PATCH costs 8 (bankOr404, listGroups at 2,
  // upsertGroup at 2, appendAudit); DELETE dropped from 9 to 7 once it
  // stopped re-fetching `listGroups` only to check existence — `deleteGroup`
  // already answers that itself (finding 8's other half). The higher of the
  // two, not the old padded number.
  "/api/v1/workspaces/:id/banks/:bankId/groups/:groupId": 8,
};

/**
 * The `Action` each guarded route enforces, or `null` where membership in
 * the workspace is the whole check. `authorization.test.ts` compares this
 * against the guards actually mounted on the live Hono instance, in both
 * directions — so a route mounted without a guard, a guard without a line
 * here, and a line naming the wrong action are each a failing test rather
 * than an unguarded endpoint.
 */
export const ROUTE_ACTIONS: Record<string, Action | null> = {
  "GET /api/v1/workspaces/:id": null,
  "PATCH /api/v1/workspaces/:id": "workspace.settings",
  "GET /api/v1/workspaces/:id/members": "members.manage",
  "POST /api/v1/workspaces/:id/members": "members.manage",
  "DELETE /api/v1/workspaces/:id/members": "members.manage",

  // Phase 4 Task 2. There is no `banks.view` (docs/design.md's permission
  // matrix has only `banks.edit`), so the read routes are guarded by it too
  // — a Viewer is 403 on all of these, not just the writes.
  "GET /api/v1/workspaces/:id/banks": "banks.edit",
  "POST /api/v1/workspaces/:id/banks": "banks.edit",
  "GET /api/v1/workspaces/:id/banks/:bankId": "banks.edit",
  "PATCH /api/v1/workspaces/:id/banks/:bankId": "banks.edit",
  "DELETE /api/v1/workspaces/:id/banks/:bankId": "banks.edit",
  "GET /api/v1/workspaces/:id/tags": "banks.edit",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions": "banks.edit",
  "POST /api/v1/workspaces/:id/banks/:bankId/questions": "banks.edit",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions/:qid": "banks.edit",
  "PATCH /api/v1/workspaces/:id/banks/:bankId/questions/:qid": "banks.edit",
  "DELETE /api/v1/workspaces/:id/banks/:bankId/questions/:qid": "banks.edit",
  "POST /api/v1/workspaces/:id/banks/:bankId/media": "banks.edit",
  "GET /api/v1/workspaces/:id/media/:key": "banks.edit",

  // Phase 4 Task 6.
  "GET /api/v1/workspaces/:id/banks/:bankId/groups": "banks.edit",
  "POST /api/v1/workspaces/:id/banks/:bankId/groups": "banks.edit",
  "PATCH /api/v1/workspaces/:id/banks/:bankId/groups/:groupId": "banks.edit",
  "DELETE /api/v1/workspaces/:id/banks/:bankId/groups/:groupId": "banks.edit",
};

export function createApp(deps: AppDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // Order matters: the ID exists before anything can log it, and the security
  // headers are set before a handler runs so they are on error responses too.
  app.use(requestId());
  app.use(securityHeaders);
  app.use(logging(deps.now));
  // Before every route rather than per route: a route that needs an actor
  // and did not ask for one is the failure mode worth designing out, and
  // the cost is the same two statements either way.
  app.use(authenticate(deps));

  app.notFound(notFoundEnvelope);
  app.onError(errorEnvelope);

  app.get("/api/v1/health", health(deps));
  app.route("/api/v1/auth", authRoutes(deps));
  app.get("/api/v1/me", me());
  // Not in ROUTE_ACTIONS: neither route names a workspace, so there is no
  // membership to guard on. `complete` takes the actor from the session
  // through `actorOr401`, the way `/me` and `/workspaces` do.
  app.route("/api/v1/setup", setupRoutes(deps));
  app.route("/api/v1/workspaces", workspaceRoutes(deps));
  app.route("/api/v1/workspaces", bankRoutes(deps));
  app.route("/api/v1/workspaces", questionRoutes(deps));
  app.route("/api/v1/workspaces", mediaRoutes(deps));

  return app;
}
