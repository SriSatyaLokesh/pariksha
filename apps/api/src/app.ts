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
import { testRoutes } from "./routes/tests.js";
import { shortlinkRoute } from "./routes/shortlink.js";

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
  // Task 7 (#51, P4.7): whole-bank import. Review Focus item 3's whole
  // point — authentication (2, every authenticated route) + bankOr404 (1) +
  // the one `listQuestionRefIds` duplicate-check query (1) +
  // `writeImportedBank`'s one `batch()` (1, groups and questions together)
  // + appendAudit (1) is 6, flat in question count: `bankOf(200)` costs
  // exactly this. A bank that declares any passage group (fix round 1,
  // findings 1+2 — `writeImportedBank`'s own comment) adds exactly one more
  // read, to merge the imported groups into the bank's existing
  // `groups_json` before the same batch writes it — 7, flat in *group*
  // count too: ten groups costs this one read, not ten. Measured (not
  // estimated — finding 5) against `apps/api/test/import/json.test.ts`'s
  // `exampleBank` fixture (12 questions, one passage group): 7, which is
  // the number here.
  "/api/v1/workspaces/:id/banks/:bankId/import": 7,
  // Task 9 (#53, P4.9): export. `allQuestions` (apps/api/src/routes/
  // banks.ts) pages `listQuestions` at 200 a time, so this route's cost is
  // NOT flat in bank size the way the comment here used to claim — it was
  // measured only against examples/reasoning-aptitude/questions.json (17
  // questions, one group), which is one page. `?ids=` costs the same as an
  // unfiltered export regardless of selection size (filtered in memory
  // after the same fetch), but an unfiltered export of a large bank is not
  // the same cost as a small one.
  //
  // Fix round (whole-branch review, I5): the real ceiling is bounded, not
  // unbounded — `import/json.ts`'s `IMPORT_MAX_QUESTIONS` caps a *bank* at
  // 500 questions (not just one import request), so the worst case is a
  // 500-question bank with a passage group: auth (2) + bankOr404 (1) +
  // listGroups (2, this bank has a group) + `allQuestions` (3, ceil(500 /
  // 200) pages) = 8. Measured against exactly that
  // (round-trip.test.ts's "measures the real worst-case subrequest cost of
  // exporting a bank at the question-count ceiling"), pinned with `toBe`,
  // not guessed — and still nowhere near the 50-subrequest ceiling. The
  // 17-question fixture above costs only 6; the declared number here is the
  // bound every bank size up to the cap must stay under, not the common
  // case.
  "/api/v1/workspaces/:id/banks/:bankId/export": 8,
  // The single-question sibling: auth (2) + `getQuestion` (1, already one
  // query with its own correlated "used in tests" subquery) + `listGroups`
  // (2, only fetched when the question names a group — a question that
  // does not costs 3, not 5: `exportIssues` would otherwise have to check a
  // group reference against an empty `groups` array it was never given, and
  // falsely refuse an otherwise-valid, group-referencing question). Fix
  // round 1, finding 2: pinned against the worst case — "DIN-001"
  // (examples/reasoning-aptitude/questions.json), which names
  // "library-loans" — not the cheapest realistic question, the same "measure
  // the heavy case" rule every other budget here already follows. The brief
  // named 1, which the authentication floor alone already rules out; 5 is
  // the measured ceiling.
  "/api/v1/workspaces/:id/banks/:bankId/questions/:qid/export": 5,

  // Phase 5 Task 2 (#54): test CRUD, short links and QR codes. Measured
  // (apps/api/test/tests.test.ts's "measures the real subrequest cost of
  // every route this task mounts"), not estimated, like every number above.
  // GET costs 4 (auth 2 + `listTests`/`getTest` 1 + `draftVersionsByTest`
  // 1); POST costs 5 (auth 2 + `createTest`'s one batch 1 + the read-back
  // `getTest` does to hand the route a full row 1 + `appendAudit` 1); PATCH
  // costs 6 (auth 2 + `updateTest`'s read-then-write 2 + `draftVersionsByTest`
  // 1 + `appendAudit` 1). The higher of the two methods sharing each path,
  // same rule Phase 4's banks routes already follow.
  "/api/v1/workspaces/:id/tests": 5,
  "/api/v1/workspaces/:id/tests/:testId": 6,
  // Task 3 (#55, P5.2): the draft. Measured, not estimated
  // (`draft.test.ts`'s own "measures the real subrequest cost" test). GET
  // costs 4: auth (2) + `getDraftVersion` (1) + `workspaceQuestionSummaries`
  // (1) — no separate `getTest` existence check; a test that does not exist
  // and one that (not reachable before Task 11's lifecycle) currently has no
  // draft both answer the same 404 `getDraftVersion` alone already gives.
  // PATCH costs 6 when the patch names no `sections` (auth 2 +
  // `getDraftVersion` 1, the merge base + `putDraftVersion`'s own
  // read-then-write 2 + `appendAudit` 1 — no `existingRowIds` call at all: a
  // settings-only patch names no row) and 7 once it does (one more
  // statement, `existingRowIds`'s single `UNION ALL`, flat regardless of how
  // many ids the patch names). The higher of the two methods sharing this
  // path, same rule every other budget here follows.
  //
  // ponytail: `getDraftVersion` runs twice on a PATCH that touches
  // `sections` or not — once in the route (the merge base) and once again
  // inside `putDraftVersion` (to find the row to update) — because
  // `putDraftVersion`'s contract takes a whole `TestDocumentBody`, not a
  // patch, so it cannot reuse what the route already read. Two single-row
  // reads of an indexed lookup, nowhere near the 50-subrequest ceiling;
  // collapsing them would mean `putDraftVersion` trusting a caller-supplied
  // row it never checked, which is the wrong end to save a query at.
  "/api/v1/workspaces/:id/tests/:testId/draft": 7,
  // Task 6 (#58, P5.5): T-19's reachability check. Measured
  // (`apps/api/test/reachable.test.ts`'s own "measures the real subrequest
  // cost" test), not estimated: auth (2) + `getTest`'s existence check (1)
  // + **one outbound `fetch`** (1). That last one is a subrequest on
  // Workers exactly as a D1 query is, which is why `countingDeps`
  // (apps/api/src/instrument.ts) wraps `deps.http` too — otherwise the one
  // call this route exists to make is the one call the budget cannot see.
  // A URL `checkReachable` refuses costs 3, not 4: the refusal happens
  // before the first fetch. The higher of the two, same rule every other
  // budget here follows.
  "/api/v1/workspaces/:id/tests/:testId/check-url": 4,
  // Public, unguarded (Review Focus 5 / ADR 0006's precedent): one read,
  // `resolveShortCode`, and no authentication cost at all — a request that
  // carries no session cookie never reaches `readSession` in the first
  // place (`apps/api/src/middleware/authenticate.ts`).
  "/t/:code": 1,
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

  // Task 7.
  "POST /api/v1/workspaces/:id/banks/:bankId/import": "banks.edit",

  // Task 9.
  "GET /api/v1/workspaces/:id/banks/:bankId/export": "banks.edit",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions/:qid/export": "banks.edit",

  // Phase 5 Task 2. There is no `tests.view` either — reads are guarded the
  // same way banks' reads are, by the one action there is.
  "GET /api/v1/workspaces/:id/tests": "tests.edit",
  "POST /api/v1/workspaces/:id/tests": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId": "tests.edit",
  "PATCH /api/v1/workspaces/:id/tests/:testId": "tests.edit",
  // Task 3 (#55, P5.2).
  "GET /api/v1/workspaces/:id/tests/:testId/draft": "tests.edit",
  "PATCH /api/v1/workspaces/:id/tests/:testId/draft": "tests.edit",
  // Task 6 (#58, P5.5).
  "POST /api/v1/workspaces/:id/tests/:testId/check-url": "tests.edit",
  // `GET /t/:code` carries no entry here at all: it is the one route this
  // phase mounts outside the workspace guard (Review Focus 5, ADR 0006).
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
  app.route("/api/v1/workspaces", testRoutes(deps));
  // The one route outside `/api/v1/workspaces/:id/...` this phase mounts —
  // deliberately public and unguarded (Review Focus 5, ADR 0006's
  // precedent). `apps/api/src/index.ts` has its own matching change so this
  // path reaches the Worker instead of the asset router.
  app.get("/t/:code", shortlinkRoute(deps));

  return app;
}
