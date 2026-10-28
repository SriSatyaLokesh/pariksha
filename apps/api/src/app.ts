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
import type { AttemptContextVar } from "./middleware/attemptContext.js";
import { securityHeaders } from "./middleware/security.js";
import { logging } from "./middleware/logging.js";
import { errorEnvelope, notFoundEnvelope } from "./middleware/errorEnvelope.js";
import { authenticate } from "./middleware/authenticate.js";
import { actorOnly } from "./middleware/authorize.js";
import { health } from "./routes/health.js";
import { generateOpenApiSpec } from "./openapi.js";
import { authRoutes } from "./routes/auth.js";
import { me } from "./routes/me.js";
import { setupRoutes } from "./routes/setup.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { bankRoutes } from "./routes/banks.js";
import { questionRoutes } from "./routes/questions.js";
import { mediaRoutes } from "./routes/media.js";
import { testRoutes } from "./routes/tests.js";
import { resultsExportRoutes } from "./export/results.js";
import { evidenceExportRoutes } from "./export/evidence.js";
import { readinessRoutes } from "./publish/readiness.js";
import { attemptsRoutes } from "./routes/attempts.js";
import { monitorRoutes } from "./routes/monitor.js";
import { proctorActionsRoutes } from "./routes/proctor-actions.js";
import { shortlinkRoute } from "./routes/shortlink.js";
import { runRoutes } from "./routes/run.js";
import { proctoringRoutes } from "./routes/proctoring.js";
import { inviteRoutes } from "./routes/invites.js";
import { gradeRoutes } from "./grade/award.js";
import { verdictRoutes } from "./grade/verdict.js";
import { regradeRoutes } from "./grade/regrade.js";
import { candidateDataRoutes } from "./retention/candidate.js";
import { usageRoute } from "./usage/project.js";
import { requireMember } from "./middleware/authorize.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { keyRoutes } from "./routes/keys.js";
import { attemptReviewRoutes } from "./routes/attempt-review.js";
import { byokRoutes } from "./routes/byok.js";
import { demoRoutes } from "./routes/demo.js";
import { teamRoutes } from "./routes/teams.js";
import type { EmailSender } from "./email/adapter.js";

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
  /**
   * Injected only so a test can read what was sent. Left unset everywhere
   * else, where `emailSender(env)` is the right answer — the same shape
   * `http` has, and for the same reason: the access gate's six-digit code
   * exists nowhere but in the message, so a route test that could not see
   * the message could not assert on it.
   */
  email?: EmailSender;
}

export type AppBindings = {
  Variables: RequestIdVariables & {
    actor: Actor | null;
    /**
     * Phase 6 Task 5 (#69): the attempt the candidate's cookie names,
     * set by `attemptContext`. Present only on routes that mount it —
     * which is exactly the `attempt` authority in `ROUTE_AUTH`.
     */
    attempt: AttemptContextVar;
    db?: DbClient;
  };
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
  "/api/v1/openapi.json": 0,
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
  // Phase 10: Docker self-host password authentication & TOTP (S-01, S-02).
  "/api/v1/auth/password/signin": 12,
  "/api/v1/auth/password/register": 12,
  "/api/v1/auth/password/totp/setup": 6,
  "/api/v1/auth/password/totp/verify": 6,
  "/api/v1/auth/password/totp/disable": 6,
  "/api/v1/me": 2,
  // `status` is one statement and costs no authentication: it answers an
  // unauthenticated sign-in screen. `complete` is authentication, the claim
  // read, the claiming insert and the owner membership.
  "/api/v1/setup/status": 1,
  "/api/v1/setup/complete": 6,
  // Phase 9 Task 4: Ephemeral demo workspace provisioning. Rate token (1) +
  // seedDemoWorkspace batch (1) + session insert (1) = 3 subrequests.
  // Declared budget is 6 (well under the 12 subrequests ceiling).
  "/api/v1/demo/provision": 6,
  // Authentication, then one statement: the list, or the create plus the
  // owner membership.
  "/api/v1/workspaces": 6,
  "/api/v1/workspaces/:id": 5,
  // The heaviest: resolve the invitee, list the members, write the change,
  // revoke the member's sessions, append the audit row.
  "/api/v1/workspaces/:id/members": 10,
  "/api/v1/workspaces/:id/members/:userId": 10,

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
  // GET costs 4 (auth 2 + `listTests`/`getTest` 1 + `headVersionsByTest`
  // 1); POST costs 5 (auth 2 + `createTest`'s one batch 1 + the read-back
  // `getTest` does to hand the route a full row 1 + `appendAudit` 1); PATCH
  // costs 6 (auth 2 + `updateTest`'s read-then-write 2 + `headVersionsByTest`
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
  // A URL `checkReachable` refuses costs 3: the refusal happens before the
  // first fetch. A server that rejects `HEAD` with 405 costs **5** — the
  // one `GET` retry (`net/reachable.ts:131-133`) is a second subrequest,
  // and the declared 4 counted only the single-fetch path (whole-branch
  // security review, L4). The higher of the three, same rule every other
  // budget here follows. The timeout ceiling is 10 s for the same reason:
  // each call carries its own `AbortSignal.timeout(REACH_TIMEOUT_MS)`.
  "/api/v1/workspaces/:id/tests/:testId/check-url": 5,
  // Task 9 (#60 / #56, P5.7b): the candidate list. Measured
  // (`apps/api/test/candidate-list.test.ts`'s own "measures the real
  // subrequest cost" test), not estimated. GET costs 3: auth (2) +
  // `listCandidates` (1) — no separate existence check, the same call
  // `GET .../draft` declines to make and for the same reason. POST costs
  // 5: auth (2) + `getDraftVersion` (1, the registration form and the set
  // labels, and the route's 404) + `replaceCandidateList`'s single
  // `db.batch` (1) + `appendAudit` (1) — and **flat in row count**, which
  // is the whole point of the batch: 500 rows costs the same 5 as three,
  // pinned against exactly that. A dry run costs two less (no batch, no
  // audit); the higher of the two, same rule every other budget here
  // follows. The two paths differ, so they carry two lines.
  "/api/v1/workspaces/:id/tests/:testId/candidates": 3,
  "/api/v1/workspaces/:id/tests/:testId/candidates/import": 5,
  // Task 11 (#62, P5.9) and Task 13 (#64, P5.11): the lifecycle. Measured
  // (`apps/api/test/lifecycle.test.ts`'s own "measures the real subrequest
  // cost" test), not estimated. Publish costs 9: auth (2) + `getTest` (1)
  // + `getDraftVersion` (1, the body the checklist judges and the route's
  // 409) + the checklist's own two reads, `workspaceQuestions` (1, every
  // question the sections can draw, one statement for the whole workspace)
  // and `countCandidates` (1, one aggregate for both candidate rows) +
  // `publishDraftVersion`'s own `getDraftVersion` (1) and its single
  // `db.batch` (1) + `appendAudit` (1). A refused publish costs 6 — it
  // stops at the checklist — and the higher of the two is what is pinned,
  // the same rule every number above follows. The plan estimated 8,
  // against a gate that had no candidate rows in it yet; the measurement
  // wins. The response is built from what was just written rather than
  // re-read, which is what keeps it off a tenth.
  "/api/v1/workspaces/:id/tests/:testId/publish": 9,
  // Close and archive are the same handler twice: auth (2) + `getTest` (1,
  // the 404 *and* the legal-transition check) + `setTestStatus` (1) +
  // `appendAudit` (1) + `headVersionsByTest` (1, so the response carries
  // the same `TestWire` every other test route returns rather than a
  // second, smaller shape for the screens to special-case). The plan
  // estimated 5 against a response that did not exist yet; the
  // measurement wins.
  //
  // Phase 8d Task 3 (`K23`): close alone grows to **7** —
  // `listActiveWebhooksForEvent`'s one read for `test.closed`, paid even
  // with no webhook registered. Never tried inline (it is an organiser
  // action, not a candidate hot path), so no `http` line: the event is
  // only ever queued — and, fix round 1 (F1), queued through one
  // `db.batch()` call regardless of how many hooks subscribed, so this
  // number is a bound here too, not a one-hook measurement. Archive stays
  // at 6 — it fires no event.
  "/api/v1/workspaces/:id/tests/:testId/close": 7,
  "/api/v1/workspaces/:id/tests/:testId/archive": 6,
  // Auth (2) + `listVersions` (1, one correlated subquery for the attempt
  // counts, never one query per version). No separate existence check —
  // the same call `GET .../draft` and `GET .../candidates` both decline to
  // make. The plan estimated 4.
  "/api/v1/workspaces/:id/tests/:testId/versions": 3,
  // Task 13 (#64, P5.11): the checklist, rendered. Auth (2) + `getTest`
  // (1) + `getDraftVersion` (1) + `workspaceQuestions` (1) +
  // `countCandidates` (1, one aggregate for both candidate rows — never
  // one query per candidate) = 6, and flat in section, question and
  // candidate count alike. The same five reads publish makes before it
  // decides, which is the point: one function, two callers.
  "/api/v1/workspaces/:id/tests/:testId/checklist": 6,
  // Phase 8c Task 5 (`D7c`, `K21`): the readiness aggregate. Measured
  // (`apps/api/test/publish/readiness.test.ts`'s own "measures the real
  // subrequest cost" test), not estimated. Auth (2) + `listTests` (1) +
  // `draftVersionsByWorkspace` (1, every open draft in one set read) +
  // `workspaceQuestions` (1, shared by every test, not re-fetched per row)
  // + `candidateCountsByWorkspace` (1, one `GROUP BY test_id`) = 6, flat in
  // how many tests the workspace holds — twelve tests costs the same 6 as
  // one, which is the whole point.
  "/api/v1/workspaces/:id/tests/readiness": 6,
  // Task 12 (#63, P5.10): clone, export and import. Measured
  // (`apps/api/test/clone.test.ts` and `test/export/test-round-trip.test.ts`),
  // not estimated. Clone costs 8: auth (2) + `getTest` (1, the 404 *and*
  // the name and slug the copy is built from) + `cloneTest`'s own head
  // read (1) and one query for every slug already taken in the
  // `<slug>-copy` family (1) + `createTest`'s single `db.batch` (1) and
  // its read-back (1) + `appendAudit` (1). The plan estimated 7, against a
  // clone that did not yet have to find which `-copy-N` was free; the
  // measurement wins.
  "/api/v1/workspaces/:id/tests/:testId/clone": 8,
  // Export costs 7: auth (2) + `getTest` (1) + `getPublishedVersion` (1) +
  // `getDraftVersion` (1, only on a test with nothing published — the
  // worst case, which is what is pinned) + `workspaceQuestions` (1) +
  // `listBanks` (1). The refuse-what-we-would-not-take-back check runs
  // inside `exportTest`, over the questions it has already read, rather
  // than in the route over a second copy of them. **Flat in question
  // count**: a test naming 200 questions costs the same as one naming
  // three.
  "/api/v1/workspaces/:id/tests/:testId/export": 7,
  // Import costs 7: auth (2) + `workspaceQuestions` (1) + `listBanks` (1)
  // + `createTest`'s batch (1) and read-back (1) + `appendAudit` (1) — and
  // flat in section and question count, because the whole document is one
  // batch. A dry run costs 4 (no write, no audit) and so does a refused
  // import. The plan estimated 8.
  "/api/v1/workspaces/:id/tests/import": 7,
  // Phase 8c Task 3 (`R-08`, `K38`): the results CSV. Measured
  // (`apps/api/test/export/results.test.ts`'s "measures the real
  // subrequest cost" test), not estimated. Auth (2) + `getTest` (1) +
  // `getPublishedVersion` (1) + `listAttemptsForTest` (1, one page) +
  // `latestVerdicts` (1, once per page, not once per row) +
  // `listCandidates` (1, the whole test's registration rows) +
  // `countedFiguresForTest` (1) + `rankedScoresForTest` (1) = 9, flat in
  // how many attempts the page holds — 300 costs the same 9 as one.
  "/api/v1/workspaces/:id/tests/:testId/export/results.csv": 9,
  // The per-answer CSV. Auth (2) + `getTest` (1) + `listAttemptsForTest`
  // (1, one page — clamped to `ANSWERS_PAGE_LIMIT_MAX` so the next read's
  // `IN (...)` stays under D1's 100-bound-parameter cap) +
  // `responsesForAttempts` (1, once per page) = 5, flat in how many
  // responses a page's attempts actually carry.
  "/api/v1/workspaces/:id/tests/:testId/export/answers.csv": 5,
  // Phase 8c Task 4 (`#98`): the events CSV. Measured
  // (`apps/api/test/export/evidence.test.ts`'s own "measures the real
  // subrequest cost" test). Auth (2) + `getTest` (1) + `listEventsForTest`
  // (1, one page) = 4, flat in how many events a page holds.
  "/api/v1/workspaces/:id/tests/:testId/export/events.csv": 4,
  // The snapshot manifest. Measured, not flat — `K3`'s own existence check
  // spends up to `MAX_LIST_PAGES_PER_ATTEMPT` (2, fix round 1 `I2`)
  // `StorageAdapter.list` calls per **attempt** in the page, never per
  // snapshot (a Strict attempt's ~60 images still cost at most two `list`
  // calls, not one per image), so the worst case is auth (2) + `getTest`
  // (1) + `listAttemptsForTest` (1) + `listSnapshotsForAttempts` (1) + (up
  // to 2 `list` calls × `SNAPSHOTS_PAGE_LIMIT_MAX` attempts in the page,
  // lowered to 10 by `I2` when the per-attempt cost doubled — see that
  // constant's own comment) = 25, half the ceiling rather than five
  // subrequests under it. `signedUrl` costs nothing (`instrument.ts`'s own
  // ruling, `K4`).
  "/api/v1/workspaces/:id/tests/:testId/export/snapshots.csv": 25,
  // `test.json`: the same cost as `/export` above, because it calls the same
  // `exportTest` — a second door onto one function, not a second budget
  // line that could drift from the original's.
  "/api/v1/workspaces/:id/tests/:testId/export/test.json": 7,
  // Public, unguarded (Review Focus 5 / ADR 0006's precedent): one read,
  // `resolveShortCode`, and no authentication cost at all — a request that
  // carries no session cookie never reaches `readSession` in the first
  // place (`apps/api/src/middleware/authenticate.ts`).
  // Phase 6 Task 4 (#68, P6.4): **2 on the expensive path**, which is a
  // miss — `resolveShortCode` (1) plus the one `takeRateToken` statement
  // the `short_link` bucket costs (1). A code that resolves still spends
  // exactly 1, because the limiter counts misses only.
  "/t/:code": 2,

  // Phase 6 Task 1 (#65, P6.1): the candidate landing page. Measured
  // (`test/run/landing.test.ts`'s own "measures the real subrequest cost"
  // test), not estimated: one statement, `resolvePublishedTest`, joining
  // the workspace, the test and the version it points at. **The
  // authentication floor of 2 does not apply to a candidate route** —
  // `authenticate` calls `readSession` only when a signed session cookie is
  // present and a candidate carries none, so the floor here is 0 and the
  // whole cost is the route's own read. Flat in section and question count:
  // the counts come from `sections_json` and the bank is never touched,
  // which is also what keeps a question's ID out of the payload (S-10).
  "/api/v1/run/:workspaceSlug/:testSlug": 1,

  // Phase 6 Task 2 (#66, P6.2): the access gate. Measured
  // (`test/run/access.test.ts`'s own budget tests), not estimated, and
  // each is the most expensive path through its route.
  //
  // `/access`: `resolvePublishedTest`, the candidate-list read, the mode's
  // own single-use consume, and the entry-token insert. Only `email_code`
  // behind a candidate list pays all four, which is what the measurement
  // drives. The authentication floor of 2 does not apply here — a
  // candidate sends no session cookie, so `authenticate` never reads one.
  "/api/v1/run/:workspaceSlug/:testSlug/access": 4,
  // Resolve, the two `S-07` rate tokens (per test version and per
  // address digest), the sweep that the address bucket pays for, and one
  // insert — **5** since the final review's Important 2; it was 4 since
  // Task 4's fix round (#68, C-1) and 2 while the route was unlimited.
  // Sending the message is still not a D1, R2 or `deps.http` call. A
  // refusal costs 2 to 4, because the limiters are charged before the
  // write.
  "/api/v1/run/:workspaceSlug/:testSlug/email-code": 5,
  // Resolve and the state insert, plus discovery and JWKS on a cold
  // isolate (`oidc.ts` caches both for the isolate's lifetime, so a warm
  // one spends 2).
  "/api/v1/run/:workspaceSlug/:testSlug/sso/start": 4,
  // Resolve, consume the state, exchange the code, read the candidate
  // list, insert the entry token — plus the same cold pair.
  "/api/v1/run/:workspaceSlug/:testSlug/sso/callback": 7,

  // Phase 6 Task 3 (#67, P6.3): consent and registration. Measured in
  // `test/run/registration.test.ts`, each on the path that pays the most.
  //
  // `/form`: resolve, read the entry token, read the list row the gate
  // bound it to. A candidate already registered pays one more for the
  // replacement registration token, which is the number declared.
  "/api/v1/run/:workspaceSlug/:testSlug/form": 4,
  // `/register`: resolve, read the entry token, the `test_register`
  // limiter, the list-row read, and **one** batch carrying the entry
  // token's consume, the candidate write, every unique claim and the
  // registration token — flat in the number of unique fields, which is
  // what the batch is for. Two paths pay a sixth and no path pays a
  // seventh: a refusal reads `candidate_unique` once to name the field
  // that was taken, and `T-14` re-entry reissues a registration token
  // instead of reading it. The two never coincide, because re-entry on a
  // listed test is answered at `/form` before the batch is built.
  "/api/v1/run/:workspaceSlug/:testSlug/register": 6,

  // Phase 6 Task 4 (#68, P6.4): the proof-of-work challenge (ADR 0009).
  // Measured at **2** — `openTest` (1) and the entry-token read (1) — and
  // the challenge itself costs nothing at all, because it is a digest of
  // the token the caller already presented rather than a row this route
  // mints. That is the whole reason the challenge is derived from the
  // entry token instead of stored: 500 candidates asking for one cost 500
  // reads of a token they already hold, and no writes.
  "/api/v1/run/:workspaceSlug/:testSlug/challenge": 2,

  // Phase 6 Task 5 (#69, P6.5): minting the attempt, and resuming it.
  // Both measured in `test/run/start.test.ts` and
  // `test/run/attempt-context.test.ts`.
  //
  // `/start` on its most expensive path — a test whose `sets` section
  // draws `from_candidate_list` with a null label, so the candidate row
  // is read *and* the round-robin index is, and whose paper carries a
  // passage group: `openTest` (1), the registration token's single-use
  // consume (1), `countAttemptsForCandidate` (1), the candidate row (1),
  // `countAttemptsForVersion` (1), `workspaceQuestions` (1),
  // `workspaceGroups` (1) and the insert (1). The bank is read **once**,
  // never once per question, which is the number this budget exists to
  // pin. A stale-version refusal costs less and writes one audit row.
  "/api/v1/run/:workspaceSlug/:testSlug/start": 8,
  // `GET /attempt`: the one join `readAttemptByTokenHash` is, plus
  // `listResponses`. The paper is not rebuilt — it is the column
  // `/start` pinned — so this number is flat in the size of the paper.
  //
  // Phase 6 Task 9 (#73, P6.9) moved it from 2 to 3, exactly as this line
  // warned it would. There is no sweeper in this phase, so the first read
  // past `deadline_at + late_sync_grace_seconds` is what materialises the
  // timeout submission (`C-07`), and that is one `finishAttempt` write. An
  // ordinary resume inside the window still costs 2, and so does every
  // later read of the attempt it closed — the write happens once, ever
  // (`WHERE submitted_at IS NULL`).
  //
  // Phase 7c Task 1 moved it from 3 to **4**: `Q7a`'s authoritative
  // violation count (`countViolations`) is one more read, on every path,
  // because a candidate's "Warning 2 of 5" has to be right whether or not
  // this read also happens to be the one that closes the attempt. 4 is
  // the ceiling, measured on the timeout-materialising path in
  // `test/run/clock.test.ts`, under the same "pin the most expensive
  // path" rule every number above follows.
  "/api/v1/run/attempt": 4,
  // Phase 6 Task 8 (#72, P6.8): saving one answer — the hot path, and the
  // one route in this product a candidate calls hundreds of times.
  // Measured at **2** in `test/run/answer.test.ts`: the attempt join the
  // cookie resolves through (one read) and `upsertResponse` (one write).
  // That is exactly the PRD's non-functional row — one D1 write plus at
  // most one R2 call — so it is pinned with `toBe` rather than bounded,
  // and the membership check that refuses a question outside the pinned
  // paper costs nothing, because `layout.sections` is already in memory
  // on the row that join returned.
  //
  // **Still 2 with Tasks 9 and 10 on it**, re-measured with both in place
  // (`test/run/clock.test.ts` and `test/run/navigation.test.ts` each pin
  // it again, on the path that moves `max_index` *and* stamps
  // `section_started_at`). `assertWritable`, `assertSectionOpen` and
  // `assertReachable` are pure over the row the join already returned, and
  // the progress bump rides the **same** `db.batch` as the upsert, which
  // D1 and `countingDeps` both count as one subrequest. That batch is also
  // why `DbClient.batch` reports `{ changes }` per statement: without it
  // the conditional upsert could not still say whether the row moved, and
  // `accepted` and `superseded` would collapse into each other.
  "/api/v1/run/attempt/answer": 2,
  // Phase 6 Task 7 (#71, P6.7): one image off the candidate's own paper.
  // Measured at **2** in `test/run/media.test.ts` — the attempt join the
  // cookie resolves through, and the one object read. The authorisation
  // itself costs nothing: it is an `includes` over `layout.media`,
  // already in memory on the row that join returned. A number above 2
  // here would mean the route had gone looking at the workspace
  // instead, which is precisely the reading it exists not to take.
  "/api/v1/run/attempt/media/:key": 2,
  // Phase 6 Task 11 (#75, P6.11): ending the attempt. Measured at **6**
  // in `test/run/submit.test.ts`, on the common first-press path that
  // actually scores: the attempt join the cookie resolves through, the
  // answers, the candidate's attempt count (which is what prints "Attempt
  // 2 of 3" and what the `full_review` degrade is judged by), the
  // workspace's bank read **once** for the whole paper, the one
  // `finishAttempt` write, the audit row.
  //
  // Phase 7e Task 5 (`Q6a`): `recomputeIntegrity` adds exactly **3** more
  // to every first press that actually writes — `listIntegrityCounts`,
  // `listSnapshotFaceCounts`, `setIntegrity` — so the common path moves
  // from 6 to **9**, and the worst case below moves the same +3. The
  // already-submitted second press (below) is unaffected: it returns
  // before the `submitted` branch `recomputeIntegrity` lives in, so it
  // never pays this.
  //
  // The worst case: — Phase 8a Task 3 (`K6`/`K7`) —
  // `attemptFiguresForCandidate`'s one read of this candidate's own prior
  // attempts, paid only on the last attempt of a test whose
  // `counted_attempt` is set to anything but `"latest"` **and** whose
  // release actually discloses something (`show !== null`, M-1 — a
  // `release.when: "never"` test on the same last-attempt shape stays at
  // the common path's 9 (10 with the webhook check below), measured by
  // `"rel-never-counted"`'s own test in `submit.test.ts`, with
  // `"rel-counted"` below as its released twin)
  // (`apps/api/test/run/release.test.ts`'s "K7, live" test exercises this
  // combination, uncounted there). The old 7 was the pre-Task-5 worst case
  // (6 + the counted read); Task 5's +3 moves it the same way it moves the
  // common path.
  //
  // A second press writes nothing — the row the cookie resolved already
  // carries the score and the stamp, and `recomputeIntegrity` never runs
  // for it either, and nor does `fireWebhooks` below (both live inside the
  // `submitted` branch) — but it is not free: it still pays the join, the
  // answers and the attempt count, so **3**, and **4** at `full_review`
  // where the bank is read again for the key (neither fixture that
  // measures those two numbers sets `counted_attempt`, so the counted
  // read adds nothing to them). Both measured in `test/run/submit.test.ts`
  // and both unchanged by Task 5 or Phase 8d.
  //
  // Phase 8d Task 3 (`K23`): `fireWebhooks` adds a variable amount on top
  // of whichever of the two paths above actually writes —
  // `listActiveWebhooksForEvent`'s one read, unconditional, plus one
  // `http` for every active `attempt.submitted` hook this request actually
  // reaches inline, plus one `db.batch()` write for every hook that did not
  // deliver (queued, including everything past `INLINE_FANOUT_LIMIT`).
  //
  // **Branch-review M6: both `app.ts` comments on this route used to claim
  // "+1", and that is only true with zero active hooks — a no-op path that
  // pays the read and nothing else.** `webhooks/deliver.test.ts:388`
  // measures `fireWebhooks`'s own real worst case directly:
  // `{ db: 2, http: INLINE_FANOUT_LIMIT, total: 5 }` — the read,
  // `INLINE_FANOUT_LIMIT` (3, at the time of writing) hooks that all fail
  // inline, and one batched write queuing all of them. Raising
  // `INLINE_FANOUT_LIMIT` raises this number with it — see that constant's
  // own comment for the arithmetic before changing either. One delivering
  // hook costs **+2** (the read plus the one `http`; a success is never
  // queued, so no write) — `test/webhooks/deliver.test.ts`'s "keeps the
  // submit route inside its declared budget with a webhook firing" exercises
  // exactly that shape.
  //
  // The declared ceiling is the worst case combining **both** deltas that
  // were previously measured only apart: the counted read (+1, Task5's 9 to
  // 10) **and** `fireWebhooks`'s own worst case (+5, not +1) —
  // `test/run/combined-budgets.test.ts`'s "the submit route's real worst
  // case is 15" is the fixture neither `submit.test.ts` (counted read, zero
  // hooks) nor `deliver.test.ts` (one delivering hook, no counted read)
  // combines on its own: 9 + 1 + 5 = **15**. No functional change — 15 is
  // still far under the 50-subrequest ceiling — only the declared number and
  // the comments claiming a flat "+1" were wrong.
  //
  // A number above 15 means the bank, the counted read, the integrity
  // recompute or the webhook fan-out is being spent more than its own
  // measured worst case — the failure this line exists to catch on a
  // 50-subrequest ceiling.
  "/api/v1/run/attempt/submit": 15,
  // Phase 7c Task 1 (`Q7`/`Q7c`): the proctoring event ingest. The base
  // cost — a batch with no `VIOLATION_EVENTS`/`FAILURE_EVENTS` type in it,
  // restores and lifecycle markers only — is **4**, measured in
  // `test/run/events.test.ts`'s own counting test: the attempt join the
  // cookie resolves through, the `attempt_events` rate token,
  // `appendEvents`'s one batched insert (capped at 10 rows a request, so
  // this number is flat in how many events the request actually carries),
  // and `countViolations`'s one read for the response's authoritative count.
  // "ten events as one batched insert" (all `fullscreen_restore`) is this
  // base case. Phase 7e Task 1's fix round (F2, Major): `claimViolationLimit`
  // (`packages/db/src/repo/attempts.ts`) is paid only when `violations >=
  // limit` — below it, no read or write of its own happens at all, which is
  // one cheaper than the `violationLimitAlreadyReached` read this route used
  // to spend on every request regardless.
  //
  // Branch re-review (post-M1): a batch that *does* carry a violation or
  // failure type costs the base 4 plus `recomputeIntegrity`'s own +3
  // (`listIntegrityCounts`, `listSnapshotFaceCounts`, `setIntegrity`) —
  // **7**, measured in `test/run/events.test.ts`'s own counting test — on
  // every such batch, not only the one that first crosses the limit. M1 had
  // narrowed this to `atLimit && !alreadyActioned` (at most once per
  // attempt) because `listIntegrityEvents` then projected the attempt's
  // *whole* matching history on every call — quadratic rows read across a
  // session on `warn_then_flag`, the default action, which never locks or
  // auto-submits to stop the growth (M1: "roughly 2M rows for one bad
  // session against a 5M/day allowance"). That gate also silently broke
  // `Q6`'s "review on any violation" for a live attempt
  // (`test/run/integrity.test.ts`'s "recomputes on every violation, not
  // only on submit") — `listIntegrityCounts` is the M1 fix applied to the
  // side M1 left alone, flat in the attempt's history the same way
  // `listSnapshotFaceCounts` already was, so there is no cost reason left
  // to gate this to one firing per attempt and the gate is gone: every
  // integrity-bearing batch costs the same flat **+3**, never more, however
  // many of them a session has.
  //
  // A batch that reaches the limit costs one more on top of the base 4:
  // `claimViolationLimit`'s own atomic insert, which both decides and marks
  // "has this fired before" in the one statement — 5 — plus the same +3
  // recompute (a limit-reaching batch always carries a violation) —
  // **8** (`test/run/violation-limit.test.ts`). Every later batch past the
  // limit costs the same **8**: `claimViolationLimit` is still attempted
  // (and loses, `alreadyActioned: true`) and the recompute still runs —
  // there is no longer a cheaper "already actioned" case at the ingest
  // side, only `violationOutcome`'s own decision (`{kind:"none"}` past a
  // `warn_then_flag` firing) changes.
  //
  // The first batch that reaches the limit under `auto_submit` costs the 5
  // above, plus `submitAttempt`'s own common-case cost, which Task 5 moved
  // from 5 to 8 (`listResponses`, `countAttemptsForCandidate`,
  // `rescoreAttempt`'s one bank read, `finishAttempt`'s write,
  // `appendAudit`'s write, `recomputeIntegrity`'s own +3) — **13**,
  // measured in `test/run/auto-submit.test.ts`'s own counting test on an
  // uncounted attempt with no webhook registered. This route's own
  // `recomputeIntegrity` call is skipped when `submitAttempt` already fired
  // one this request (the `!submitted` guard in `routes/proctoring.ts`) —
  // paying it twice would be two writes for one answer. An empty `events`
  // array costs one less than the base common path — `appendEvents` is a
  // no-op on it, and an empty batch carries no integrity signal either.
  //
  // **Branch-review M6: the declared ceiling used to add a flat "+1" for
  // `fireWebhooks`'s unconditional read and never combined it with the
  // counted-attempt delta** — the same error as `/attempt/submit`'s own
  // comment, inherited because `fireWebhooks` lives inside `submitAttempt`,
  // which this route reaches the same way `/attempt/submit` does, on the
  // `auto_submit` branch. `test/run/combined-budgets.test.ts`'s "the events
  // route's real worst case is 19" is the fixture that combines both: the
  // 13 above, on a *last, counted* attempt (`countedFor`'s own +1 read,
  // `/attempt/submit`'s identical delta) and `fireWebhooks`'s own worst
  // case of **5**, not 1 (`deliver.test.ts:388`,
  // `{ db: 2, http: INLINE_FANOUT_LIMIT, total: 5 }`) — 13 + 1 + 5 = **19**.
  // `fireWebhooks` is guarded the same way `recomputeIntegrity` is, inside
  // `submitAttempt` itself, so it cannot double-fire even though both
  // `/attempt/submit` and the `auto_submit` branch here can reach it.
  //
  // A number above 19 means the ingest base, the claim, the counted read,
  // the integrity recompute or the webhook fan-out is being spent more than
  // its own measured worst case — the failure this line exists to catch on
  // a 50-subrequest ceiling.
  //
  // Phase 7e Task 3: the first batch that first locks under `lock` costs
  // **10** (the 5 above, plus `lockAttempt`'s own write and one more
  // `appendEvents` call for the `attempt_locked` marker — 7 — plus the +3
  // recompute, since locking never submits and so never skips it) —
  // measured in `test/run/lock.test.ts`'s own counting test, cheaper than
  // `auto_submit`'s 19 and so no reason to move the ceiling this already
  // declares. Locking never calls `submitAttempt`, so it never pays the
  // webhook check either.
  "/api/v1/run/attempt/events": 19,
  // Phase 7d Task 1 (`Q4e`), `B3` follow-up: the snapshot route. Measured
  // at **4** in `test/run/snapshot.test.ts`'s own counting test: the
  // attempt join the cookie resolves through, `attempt_snapshot`'s rate
  // token (`B3`), the one `put`, and `recordSnapshot`'s one insert — in
  // that order (`Q4f`). The reason, rate-limit and magic-byte refusals all
  // happen before the write pair, so a refused snapshot costs strictly
  // less, never more.
  "/api/v1/run/attempt/snapshot": 4,
  // `C-09`, the return visit. `/code` is **4**: the address limiter, its
  // sweep, the attempt lookup and the token insert — plus the message
  // itself, which is not a subrequest in this count unless `deps.http`
  // is wired. The reference is no longer a bucket of its own (final
  // review, Important 2), so the count is what it was. `/verify` goes
  // through the same `resultFor` the finish page re-reads through, so it
  // inherits the same `K7` read: **7**, the lookup, the limiter on the
  // attempt it resolved, the single-use consume, the candidate's attempt
  // count, and — at `full_review` only — the bank, the candidate's own
  // answers, and `attemptFiguresForCandidate` on the last attempt of a
  // `counted_attempt` test. A `score_only` verification, or one off the
  // last attempt, costs less; 4 is the floor this phase's fixtures reach.
  "/api/v1/run/result/code": 4,
  "/api/v1/run/result/verify": 7,

  // The one organiser route of this phase: authentication (2), the test
  // and its slugs (1), the candidate list (1), the already-invited set
  // (1), one `batch` however long the list is (1), and the audit row (1).
  // Flat in the list's size, which `test/invites.test.ts` measures at 200.
  "/api/v1/workspaces/:id/tests/:testId/invites": 7,

  // Phase 7e Task 4 (`Q5a`): the minimal pair — a locked-attempts read and
  // the unlock. Measured (`apps/api/test/attempts/unlock.test.ts`'s own
  // "measures the real subrequest cost" tests), not estimated.
  //
  // The list: auth (2) + `getTest` (1, the existence check) +
  // `listLockedAttempts` (1, one statement whatever the row count — the
  // violation count rides a correlated subquery rather than a second
  // round trip per row). Flat in how many attempts are locked.
  //
  // Branch-review m2: flat in SUBREQUESTS, not in ROWS READ — there is no
  // index on `attempt.locked_at` (`packages/db/src/schema/sqlite.ts`'s
  // `attempt` table lists `workspace_id`, `candidate_id`,
  // `test_version_id`), so the planner reads every attempt on this test
  // (plus the correlated subquery's own per-row violation scan) to find the
  // locked ones — unbounded in a test's candidate history, not in how many
  // rows this route happens to return. Not blocking: this is the organiser's
  // own page-load frequency, not the candidate hot path, and the fix wants
  // `CREATE INDEX attempt_locked_idx ON attempt (workspace_id, locked_at)
  // WHERE locked_at IS NOT NULL` — a migration this branch's own pin
  // (`worker.test.ts`'s `migrations: 12`) should not grow for. Add it in
  // whichever later phase already carries one.
  "/api/v1/workspaces/:id/tests/:testId/attempts": 4,
  // Phase 8g Task 1: the live monitor. Measured (apps/api/test/monitor.test.ts):
  // auth (2) + getTest (1) + getPublishedVersion (1) + candidate count (1) + listMonitorAttempts (1) = 6.
  // Flat in cohort size (KG3).
  "/api/v1/workspaces/:id/tests/:testId/monitor": 6,
  // Phase 8g Task 2: the five proctor actions.
  "/api/v1/workspaces/:id/attempts/:attemptId/action": 20,
  // The unlock: auth (2) + `getAttemptLockState` (1, the existence-and-
  // scope read that is this route's own 404) + `unlockAttempt` (1, the
  // write) + `appendEvents` (1, the `attempt_unlocked` marker) +
  // `appendAudit` (1).
  "/api/v1/workspaces/:id/tests/:testId/attempts/:attemptId/unlock": 6,
  // Phase 8b Task 1 (`K14`): recording a rubric award. Measured
  // (`apps/api/test/grade/award.test.ts`'s own "measures the real
  // subrequest cost" test, against a 300-candidate workspace), not
  // estimated: auth (2) + `liveQuestions` (1, the rubric check and the
  // question map every stored award is matched against) +
  // `attemptForGrading` (1) + `writeAward` (1) + `listResponses` (1 — also
  // where every other stored award is reconstructed from, so it is read
  // only once) + `rescoreAttempt`'s own `liveQuestions` (1 — it cannot
  // share this route's, `rescoreAttempt` is reused as-is) + `writeScore`
  // (1) = 8. Flat in how many candidates the workspace holds — this route
  // touches exactly one attempt.
  "/api/v1/workspaces/:id/tests/:testId/grade": 8,

  // Phase 8b Task 2 (`K15`): the grading queue, `listPendingAwards`'s first
  // production caller. Measured (`apps/api/test/grade/award.test.ts`'s own
  // "measures the real subrequest cost" test for this route, against a
  // 300-candidate workspace), on the non-blind path — the more expensive
  // of the two and the one a shared bare-path budget has to cover: auth
  // (2) + `listPendingAwards` (2 — `workspaceQuestions`, then its own
  // paginated select) + `identityForAttempts` (1, one batched query over
  // every distinct attempt on the page, never one per row or per
  // candidate) = 5. The blind path (`?blind=1`) skips the identity read
  // entirely and spends less, never more. Flat in how many candidates the
  // workspace holds.
  "/api/v1/workspaces/:id/tests/:testId/grading-queue": 5,

  // Phase 8b Task 3 (`K16`): the reviewer's verdict. Measured
  // (`apps/api/test/review.test.ts`'s own "measures the real subrequest
  // cost" test, against a 300-candidate workspace), not estimated: auth
  // (2) + `getAttempt` (1, the 404 check) + `recordVerdict`'s one insert
  // (1) = 4. Flat in cohort size — this route touches exactly one attempt,
  // same as `.../grade` above.
  "/api/v1/workspaces/:id/attempts/:attemptId/verdict": 4,

  // Phase 8b Task 4 (`K17`/`K18`): the regrade offer. Measured
  // (`apps/api/test/grade/regrade.test.ts`'s own "measures the real
  // subrequest cost" test): auth (2) + `publishedVersionsForQuestion` (1) +
  // `countSubmittedAttemptsForVersions`'s one grouped count (1) +
  // `appendAuditBatch`'s one batched write (1) = 5.
  //
  // **Flat in how many published versions matched** (branch review M5(a) —
  // this budget line used to be measured against exactly one match and
  // declared itself flat while the route looped `enqueueRegrade` once per
  // version at 2 subrequests each; past ~24 matches it would have hit the
  // 50-subrequest ceiling the budget table exists to catch). The grouped
  // count is chunked at 99 ids (D1's 100-bound-parameter cap,
  // `packages/db/src/repo/regrade.ts`'s own comment) — a question matched
  // by more published versions than that pays one more subrequest per 99,
  // which this product has never approached.
  "/api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade": 5,

  // Phase 8e Task 2 (`S-14`, #101): the candidate's own data, and its
  // erasure. `candidates.delete` gets its first production caller here.
  // Measured (`apps/api/test/retention/candidate.test.ts`'s own "measures
  // the real subrequest cost" test), not estimated. GET costs 8: auth (2) +
  // `candidateExists` (1) + `exportCandidate`'s five reads — the candidate
  // row, `attempt`, `response`, `event` and `snapshot`, one query each (1
  // apiece) — on a candidate with at least one attempt, which is the worst
  // case; a never-attempted candidate costs 4 less (no attempt-scoped reads
  // at all). DELETE costs 8 too, on its own worst path: auth (2) +
  // `candidateExists` (1) + the in-progress check, one `attempt` read (1) +
  // the snapshot key read (1) + `storage.delete`'s one batched call when
  // there is a snapshot to remove (1) + the one batched `db.batch` (1, flat
  // in row count up to `MAX_IDS_PER_CHUNK`) + the audit row (1, per
  // candidate — flat here at one). Both methods land on the same number by
  // coincidence, not because they share work — same rule every other
  // budget above follows: the higher of the two, measured.
  "/api/v1/workspaces/:id/candidates/:candidateId/data": 8,

  // Phase 8e Task 3 (`K31`, `K36`, `KG8`, #102): the free-tier meter.
  // Measured (`apps/api/test/usage/project.test.ts`'s own "measures the
  // real subrequest cost" test), not estimated. Branch review `C2`
  // (CRITICAL) deleted the backward-looking `countsToday` half (see
  // `usage/project.ts`'s own header), which drops this from 6 to **5** on
  // the `workers` target: auth (2) + the workspace's published-test
  // settings (1, flat in test count — one JOIN pinned to each test's
  // `current_version`) + candidate counts grouped across every test (1,
  // flat in candidate count) + the workspace's active webhook count (1,
  // workspace-scoped, not per-test — `webhook` carries no `test_id`
  // column). On `node` it is **2**: auth only (`requireMember()` reads the
  // membership already on the session, no further query) — `usageRoute`
  // returns `{}` before issuing a single query of its own, because
  // nothing a self-hosted container needs is projected against a plan it
  // is not on (`K36`). 5 is the ceiling either way, which is what is
  // declared.
  "/api/v1/workspaces/:id/usage": 5,
  // Phase 8d Task 1: webhook CRUD. Measured
  // (`test/webhooks.test.ts`'s own "measures the real subrequest cost"
  // test), not estimated. GET costs 3: auth (2) + `listWebhooks` (1) —
  // `costPerCandidate` is `estimateCost`'s own pure arithmetic, no
  // subrequest. POST costs 4: auth (2) + `createWebhook`'s one insert (1)
  // + `appendAudit` (1) — `urlRefusal` runs in memory, no subrequest
  // either. PATCH and DELETE each cost 4: auth (2) + the one write (1,
  // `setWebhookActive`/`deleteWebhook`) + `appendAudit` (1). The higher of
  // the methods sharing each path, same rule every budget above follows.
  "/api/v1/workspaces/:id/webhooks": 4,
  "/api/v1/workspaces/:id/webhooks/:webhookId": 4,

  // Phase 8d Task 2 (K25, K26): scoped API keys. Measured
  // (`test/keys.test.ts`'s own "measures the real subrequest cost" test),
  // not estimated, the same way every number above is. GET costs 3: auth
  // (2) + `listApiKeys` (1). POST costs 4: auth (2) + `createApiKey`'s one
  // insert (1) + `appendAudit` (1) — the creator's-own-scope check runs in
  // memory over the membership authentication already loaded, no
  // subrequest of its own. DELETE costs 4: auth (2) + `revokeApiKey`'s one
  // write (1) + `appendAudit` (1).
  "/api/v1/workspaces/:id/keys": 4,
  "/api/v1/workspaces/:id/keys/:keyId": 4,
  // Phase 12: BYOK encrypted API keys and AI question drafting (S-15).
  "/api/v1/workspaces/:id/byok": 4,
  "/api/v1/workspaces/:id/byok/:provider": 4,
  "/api/v1/workspaces/:id/byok/models": 4,
  "/api/v1/workspaces/:id/banks/:bankId/draft-ai": 10,
  "/api/v1/workspaces/:id/banks/:bankId/draft-ai/commit": 10,

  // Phase 8c Task 1/2 (`R-06`/`R-07`, #94/#95): test and item analytics,
  // one screen. Measured (`apps/api/test/analytics.test.ts`'s own
  // "measures the real subrequest cost" test against a 300-candidate
  // fixture), not estimated — the brief's own guess (`<= 4`, written
  // before this route also carried item analysis) is superseded by this
  // number, and superseded again by fix round 1's own Important 2 (the
  // stem join). Auth (2) + `getTest`'s existence check (1) + `testAnalytics`
  // (2: one page of `listAttemptsForTest` and the registered-candidate
  // `COUNT` — a 300-row fixture is one page) + `testItemAnalysis` (2: its
  // own page of `listAttemptsForTest` — a second repository function, not
  // a shared fetch, `routes/analytics.ts`'s own header — and the response
  // join) + `workspaceQuestions` (1, the stem join) = 8. A cohort past 500
  // attempts costs one more statement per extra page, per function
  // (`fetchAllAttempts`'s own pagination, fix round 1's Important 1) — at
  // the hard page cap (`MAX_ATTEMPT_PAGES`, `packages/db/src/repo/
  // analytics.ts`) that is **26**, measured by an executed test
  // (`apps/api/test/analytics.test.ts`'s "stays under the subrequest
  // ceiling at the hard page cap", fix round 2) rather than left as
  // arithmetic in a comment — still nowhere near `SUBREQUEST_LIMIT` (50).
  // `ROUTE_BUDGETS` itself stays at the common-case number (8): the cap is
  // a declared, tested ceiling this route is proven to survive, not the
  // number every request is expected to cost.
  "/api/v1/workspaces/:id/tests/:testId/analytics": 8,
  // Phase 8g Task 4 (`#91`, `R-03`): the per-attempt review endpoint.
  // Auth (2) + attempt (1) + candidate (1) + test_version (1) + snapshots (1)
  // + events (1) + responses (1) + questions (1) = 9. Presigning snapshots
  // spends 0 storage subrequests (K3/K4).
  "/api/v1/workspaces/:id/attempts/:attemptId/review": 9,
  // Phase 13 Task 4: Teams, members, and grants.
  "/api/v1/workspaces/:id/teams": 6,
  "/api/v1/workspaces/:id/teams/:teamId": 8,
  "/api/v1/workspaces/:id/teams/:teamId/members": 8,
  "/api/v1/workspaces/:id/teams/:teamId/members/:userId": 6,
  "/api/v1/workspaces/:id/teams/:teamId/grants": 8,
  "/api/v1/workspaces/:id/teams/:teamId/grants/:grantId": 6,
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
  "DELETE /api/v1/workspaces/:id/members/:userId": "members.manage",
  "PATCH /api/v1/workspaces/:id/members/:userId": "members.manage",

  // Phase 4 Task 2.
  "GET /api/v1/workspaces/:id/banks": "banks.view",
  "POST /api/v1/workspaces/:id/banks": "banks.edit",
  "GET /api/v1/workspaces/:id/banks/:bankId": "banks.view",
  "PATCH /api/v1/workspaces/:id/banks/:bankId": "banks.edit",
  "DELETE /api/v1/workspaces/:id/banks/:bankId": "banks.edit",
  "GET /api/v1/workspaces/:id/tags": "banks.edit",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions": "banks.view",
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
  "GET /api/v1/workspaces/:id/banks/:bankId/questions/:qid/export":
    "banks.edit",

  // Phase 5 Task 2.
  "GET /api/v1/workspaces/:id/tests": "tests.view",
  "POST /api/v1/workspaces/:id/tests": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId": "tests.view",
  "PATCH /api/v1/workspaces/:id/tests/:testId": "tests.edit",
  // Task 3 (#55, P5.2).
  "GET /api/v1/workspaces/:id/tests/:testId/draft": "tests.view",
  "PATCH /api/v1/workspaces/:id/tests/:testId/draft": "tests.edit",
  // Task 6 (#58, P5.5).
  "POST /api/v1/workspaces/:id/tests/:testId/check-url": "tests.edit",
  // Task 9 (#60 / #56, P5.7b). The application's first `candidates.manage`
  // routes: an Author holds `tests.edit` and is 403 on both of these.
  // Task 11 (#62, P5.9): `tests.publish` is the Admin half of UX-11's
  // split — an Author holds `tests.edit` and is 403 on these three.
  "POST /api/v1/workspaces/:id/tests/:testId/publish": "tests.publish",
  "POST /api/v1/workspaces/:id/tests/:testId/close": "tests.publish",
  "POST /api/v1/workspaces/:id/tests/:testId/archive": "tests.publish",
  // Reading the version history is not publishing it (UX-18), and nor is
  // reading the checklist — an Author who cannot publish is exactly who
  // needs to see what is still wrong (UX-11).
  "GET /api/v1/workspaces/:id/tests/:testId/versions": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId/checklist": "tests.edit",
  // Phase 8c Task 5 (`D7c`): the readiness aggregate is the same reading
  // the single-test checklist is — `tests.edit`, for the same reason.
  "GET /api/v1/workspaces/:id/tests/readiness": "tests.edit",
  // Task 12 (#63, P5.10): clone, export and import are all `tests.edit` —
  // an Author builds tests, and none of these publishes one.
  "POST /api/v1/workspaces/:id/tests/:testId/clone": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId/export": "tests.edit",
  "POST /api/v1/workspaces/:id/tests/import": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId/candidates": "candidates.manage",
  "POST /api/v1/workspaces/:id/tests/:testId/candidates/import":
    "candidates.manage",

  // Phase 8c Task 3 (`R-08`, `R-09`): the results and per-answer CSVs.
  // `results.export` — held by Reviewer, Admin, Viewer and Owner
  // (`permissions.ts`), and by a key scoped to it (`K25`).
  "GET /api/v1/workspaces/:id/tests/:testId/export/results.csv": "results.export",
  "GET /api/v1/workspaces/:id/tests/:testId/export/answers.csv": "results.export",

  // Phase 8c Task 4 (`#98`): the events CSV and the snapshot manifest carry
  // proctoring evidence, not results — gated on `attempts.read_evidence`,
  // which a Viewer does not hold even though they hold `results.export`.
  // `test.json` is the opposite case: the same `exportTest` the `tests.edit`
  // route above already calls, reached from `results.export` instead so a
  // Viewer can fetch the definition that explains their CSV's columns.
  "GET /api/v1/workspaces/:id/tests/:testId/export/events.csv": "attempts.read_evidence",
  "GET /api/v1/workspaces/:id/tests/:testId/export/snapshots.csv": "attempts.read_evidence",
  "GET /api/v1/workspaces/:id/tests/:testId/export/test.json": "results.export",

  // Phase 6 Task 2 (#66, P6.2). The invite is a credential for a row on
  // the candidate list, so it is the same permission that uploaded the
  // list — an Author who built the test holds `tests.edit` and not this.
  "POST /api/v1/workspaces/:id/tests/:testId/invites": "candidates.manage",

  // Phase 8d Task 1, fix round 1 (`F1`): `docs/PRD.md:106`'s "Create API
  // keys and webhooks" row is Owner+Admin — the same row `keys.manage`
  // exists for — not `workspace.settings`, which the matrix gives to Owner
  // alone. The Phase 8 spec names `keys.manage` as one of the five
  // permissions this phase wires for the first time; `workspace.settings`
  // is not in that list.
  "GET /api/v1/workspaces/:id/webhooks": "keys.manage",
  "POST /api/v1/workspaces/:id/webhooks": "keys.manage",
  "PATCH /api/v1/workspaces/:id/webhooks/:webhookId": "keys.manage",
  "DELETE /api/v1/workspaces/:id/webhooks/:webhookId": "keys.manage",

  // Phase 8d Task 2 (K25, K26): scoped API keys. `keys.manage`, the same
  // action webhooks are guarded by — one organiser permission for both
  // halves of `docs/PRD.md:106`'s "Create API keys and webhooks" row.
  "GET /api/v1/workspaces/:id/keys": "keys.manage",
  "POST /api/v1/workspaces/:id/keys": "keys.manage",
  "DELETE /api/v1/workspaces/:id/keys/:keyId": "keys.manage",
  // Phase 12: BYOK credentials and AI drafting
  "GET /api/v1/workspaces/:id/byok": "keys.manage",
  "GET /api/v1/workspaces/:id/byok/models": "banks.edit",
  "PUT /api/v1/workspaces/:id/byok/:provider": "keys.manage",
  "DELETE /api/v1/workspaces/:id/byok/:provider": "keys.manage",
  "POST /api/v1/workspaces/:id/banks/:bankId/draft-ai": "banks.edit",
  "POST /api/v1/workspaces/:id/banks/:bankId/draft-ai/commit": "banks.edit",
  // `GET /t/:code` carries no entry here at all: it is the one route this
  // phase mounts outside the workspace guard (Review Focus 5, ADR 0006).

  // Phase 7e Task 4 (`Q5a`): the minimal pair. `attempts.monitor` is the
  // matrix's own permission for this — the `proctor` role holds it and
  // nothing wider than it needs to.
  "GET /api/v1/workspaces/:id/tests/:testId/attempts": "attempts.monitor",
  "POST /api/v1/workspaces/:id/tests/:testId/attempts/:attemptId/unlock": "attempts.monitor",
  "GET /api/v1/workspaces/:id/tests/:testId/monitor": "attempts.monitor",
  "POST /api/v1/workspaces/:id/attempts/:attemptId/action": "attempts.monitor",
  // Phase 8b Task 1 (`K14`): `attempts.grade`'s first production caller —
  // zero routes named this action before this line (only
  // `permissions.test.ts` did). A Reviewer or Admin holds it; an Author
  // (`tests.edit`) does not.
  "POST /api/v1/workspaces/:id/tests/:testId/grade": "attempts.grade",
  // Phase 8b Task 2 (`K15`): reading the queue is part of grading, the same
  // action the POST above requires — a Reviewer or Admin holds it, an
  // Author (`tests.edit`) does not.
  "GET /api/v1/workspaces/:id/tests/:testId/grading-queue": "attempts.grade",
  // Phase 8b Task 3 (`K16`): the verdict. Same action as grading itself —
  // a verdict is part of the review a Reviewer or Admin performs, and an
  // Author (`tests.edit`) holds neither.
  "POST /api/v1/workspaces/:id/attempts/:attemptId/verdict": "attempts.grade",
  // Phase 8b Task 4 (`K17`/`K18`): the regrade offer. Same action as
  // grading and the verdict — a Reviewer or Admin holds it, an Author
  // (`banks.edit`, the permission that saved the key change this route
  // reacts to) does not.
  "POST /api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade": "attempts.grade",

  // Phase 8e Task 2 (`S-14`, #101): `candidates.delete` is Owner-only in the
  // matrix — `owner: ACTIONS` and nobody else — which is what makes an
  // Admin's 403 here the real boundary, not a looser `candidates.manage`.
  "GET /api/v1/workspaces/:id/candidates/:candidateId/data": "candidates.delete",
  "DELETE /api/v1/workspaces/:id/candidates/:candidateId/data": "candidates.delete",

  // Phase 8e Task 3 (`K31`, #102). `null`, same as `GET /:id`: membership is
  // the whole check, nothing finer-grained — every role already sees its
  // own workspace's scale figures on Home, and this is one more.
  "GET /api/v1/workspaces/:id/usage": null,

  // Phase 8c Task 1 (`R-06`, #94): `results.export`'s first production
  // caller (fix round 1, Minor 4: Task 4 later added `test.json` beside
  // it — this route is no longer the only one, just the first). A Viewer
  // holds it and nothing wider; an Author (`tests.edit`) does not hold it
  // at all.
  "GET /api/v1/workspaces/:id/tests/:testId/analytics": "results.export",
  // Phase 8g Task 4 (`#91`, `R-03`): per-attempt review evidence.
  // Guarded by attempts.read_evidence — Reviewers and Proctors see evidence,
  // Viewers (results.export) receive 403.
  "GET /api/v1/workspaces/:id/attempts/:attemptId/review": "attempts.read_evidence",

  // Phase 13 Task 4: Teams and team grants.
  "GET /api/v1/workspaces/:id/teams": null,
  "POST /api/v1/workspaces/:id/teams": "members.manage",
  "GET /api/v1/workspaces/:id/teams/:teamId": null,
  "PATCH /api/v1/workspaces/:id/teams/:teamId": "members.manage",
  "DELETE /api/v1/workspaces/:id/teams/:teamId": "members.manage",
  "GET /api/v1/workspaces/:id/teams/:teamId/members": null,
  "POST /api/v1/workspaces/:id/teams/:teamId/members": "members.manage",
  "DELETE /api/v1/workspaces/:id/teams/:teamId/members/:userId": "members.manage",
  "GET /api/v1/workspaces/:id/teams/:teamId/grants": null,
  "POST /api/v1/workspaces/:id/teams/:teamId/grants": "members.manage",
  "DELETE /api/v1/workspaces/:id/teams/:teamId/grants/:grantId": "members.manage",
};

/**
 * Which authority admits a caller to each mounted endpoint — the third
 * registry beside `ROUTE_BUDGETS` and `ROUTE_ACTIONS`, and the one Phase 6
 * exists to add (ADR 0008, Review Focus 1).
 *
 * `GUARDS` says *which action*, this says *which authority*, and
 * `ROUTE_BUDGETS` says *what it may spend*. The gap this closes is that
 * `routeGuards(app)` is built from the `GUARDS` WeakMap, so a route mounted
 * with **no** guard at all contributes nothing to it and asserts nothing:
 * before Phase 6 that was visible by reading `createApp`, and after Phase 6
 * — which mounts a dozen deliberately unguarded candidate routes — it is
 * not. Here a missing endpoint is a missing key, and a missing key fails
 * `test/route-authority.test.ts`.
 *
 * The four values, each a real distinction in who is admitted:
 *
 * - **`workspace`** — `requires()` or `requireMember()`: a signed-in actor
 *   with a membership in the workspace `:id` names. Exactly the key set of
 *   `ROUTE_ACTIONS`, asserted as such.
 * - **`attempt`** — the candidate's 256-bit attempt token (`S-06`), read
 *   back off the live table through the `attemptContext` middleware the
 *   routes below register.
 * - **`entry`** — the single-use `run_entry` token the access gate mints,
 *   presented as `Authorization: Bearer`. A fifth value rather than
 *   `public`, because these routes answer **401** to a caller who sends
 *   nothing and `public` is asserted by a probe that forbids exactly
 *   that. Calling them public would have been the registry lying in the
 *   one place it exists to tell the truth. Like `actor` it carries no
 *   middleware to read back — the check is `entryClaim` inside the
 *   handler — so it is held to a literal allowlist *and* a probe that
 *   asserts the 401 is real.
 * - **`actor`** — a signed-in user and nothing more. These name no
 *   workspace in the path, so there is no membership for `guard()` to read
 *   (it throws when `:id` is absent); `actorOr401` is the whole gate.
 * - **`public`** — no credential of any kind. Asserted **by literal value**
 *   in the test, so widening the set is a diff a human reviewer sees rather
 *   than a line that blends into a table of forty.
 *
 * Every task that mounts a route adds its line here in the same commit.
 */
export type RouteAuthority =
  "workspace" | "attempt" | "entry" | "actor" | "public";

export const ROUTE_AUTH: Record<string, RouteAuthority> = {
  // --- public: no credential at all ------------------------------------
  "GET /api/v1/health": "public",
  "GET /api/v1/openapi.json": "public",
  // Sign-in's own front door. `magic-link` answers identically for a known
  // and an unknown address by design (`authorization.test.ts`), and the two
  // OIDC legs are redirects a provider drives.
  "POST /api/v1/auth/magic-link": "public",
  "GET /api/v1/auth/:provider/start": "public",
  "GET /api/v1/auth/:provider/callback": "public",
  // Signing out requires nothing: the handler clears the cookie and revokes
  // whatever session the cookie named, and answers 204 to a caller who has
  // none (`routes/auth.ts`, no `actorOr401`). Its sibling
  // `signout-everywhere` *does* need an actor, which is why they differ
  // here despite sharing a prefix — read the guard, not the path.
  "POST /api/v1/auth/signout": "public",
  // Phase 10: Docker self-host password auth (S-01, S-02).
  "POST /api/v1/auth/password/signin": "public",
  "POST /api/v1/auth/password/register": "public",
  // Phase 9 Task 4: public demo provisioning endpoint.
  "POST /api/v1/demo/provision": "public",
  // The first-run wizard asks this before any workspace or account exists.
  "GET /api/v1/setup/status": "public",
  // Phase 5 Task 2 (#54): T-02's short link. Refuses a draft, so the
  // (workspace slug, test slug) pair of an unpublished test is not
  // disclosed. Not in the plan's original six-entry literal because it was
  // mounted after that literal was written.
  "GET /t/:code": "public",
  // Phase 6 Task 1 (#65, P6.1): the candidate landing page. The first
  // deliberately public route of the candidate runtime; the access gate
  // that follows it is Task 2's.
  "GET /api/v1/run/:workspaceSlug/:testSlug": "public",
  // Phase 6 Task 2 (#66, P6.2): the access gate. Public by necessity —
  // passing it is how a candidate obtains their first credential, so
  // requiring one would be circular. What stands in for a guard is the
  // gate itself: the four modes, the three allowlists checked ahead of
  // them, and Task 3's rate limiter.
  "POST /api/v1/run/:workspaceSlug/:testSlug/access": "public",
  "POST /api/v1/run/:workspaceSlug/:testSlug/email-code": "public",
  "GET /api/v1/run/:workspaceSlug/:testSlug/sso/start": "public",
  "GET /api/v1/run/:workspaceSlug/:testSlug/sso/callback": "public",
  // Phase 6 Task 11 (#75, P6.11): `C-09`'s return visit. Public by
  // necessity — the attempt cookie is an hour past the deadline and the
  // candidate is back a week later, so there is no credential left to
  // require. What stands in for one is the emailed code: both routes
  // answer the same bytes whatever is behind them, so neither
  // enumerates attempts, and both are rate-limited by the reference and
  // by the address before they read anything.
  "POST /api/v1/run/result/code": "public",
  "POST /api/v1/run/result/verify": "public",

  // --- entry: the single-use run_entry token, as a Bearer header --------
  // Phase 6 Task 3 (#67, P6.3). Not `public`: both answer 401 without a
  // token, which is the one thing a `public` route may never do.
  "GET /api/v1/run/:workspaceSlug/:testSlug/form": "entry",
  "POST /api/v1/run/:workspaceSlug/:testSlug/register": "entry",
  // Phase 6 Task 4 (#68, P6.4). `entry` for the same reason and with
  // more force than its two neighbours: the challenge **is** a digest of
  // the entry token, so a caller with no token has nothing to be issued.
  "GET /api/v1/run/:workspaceSlug/:testSlug/challenge": "entry",

  // Phase 6 Task 5 (#69, P6.5). `/start` is the last `entry`-shaped
  // route of the runtime: it answers 401 to a caller with no
  // `Authorization: Bearer`, and what it takes is the single-use
  // `run_registration` token `POST .../register` answered with.
  "POST /api/v1/run/:workspaceSlug/:testSlug/start": "entry",

  // --- attempt: the 256-bit attempt token, as an HttpOnly cookie --------
  // Phase 6 Task 5 (#69, P6.5). The only authority with middleware of
  // its own besides `workspace`, so `routeAuthorities()` reads this back
  // off the live route table: declaring it over a route that mounts no
  // `attemptContext` fails, and mounting one without declaring it fails
  // too.
  "GET /api/v1/run/attempt": "attempt",
  // Phase 6 Task 8 (#72, P6.8): saving one answer. `attempt` is the scope
  // as well as the credential — the question must be on the paper
  // `/start` pinned on this very row, so a candidate cannot write an
  // answer against a question they were never given even inside their
  // own workspace.
  "PUT /api/v1/run/attempt/answer": "attempt",
  // Phase 6 Task 7 (#71, P6.7): the images on the candidate's own paper.
  // `attempt` is not merely the credential here, it is the *scope*: what
  // the route serves is bounded by `layout.media` on the very row the
  // cookie resolved, not by the workspace that row names. Its organiser
  // sibling `GET /api/v1/workspaces/:id/media/:key` keeps `banks.edit`
  // and is untouched (standing decision 4).
  "GET /api/v1/run/attempt/media/:key": "attempt",
  // Phase 6 Task 11 (#75, P6.11): ending the attempt and reading its
  // result. `attempt` is the scope as well as the credential — both are
  // bounded by the one row the cookie resolved, and neither takes an
  // identifier of any kind in its body.
  "POST /api/v1/run/attempt/submit": "attempt",
  // Phase 7c Task 1 (`Q7`): the proctoring event ingest. `attempt` for the
  // same reason `/answer` is — the only thing a candidate's browser holds
  // past `/start` is the attempt cookie, and the row it writes is scoped
  // to the attempt that cookie names.
  "POST /api/v1/run/attempt/events": "attempt",
  // Phase 7d Task 1 (`Q4`): the snapshot route. `attempt` for the same
  // reason `/events` is — the only credential a candidate's browser holds
  // past `/start` is the attempt cookie, and the row and object this
  // route writes are both scoped to the attempt that cookie names.
  "POST /api/v1/run/attempt/snapshot": "attempt",

  // --- actor: signed in, but naming no workspace ------------------------
  "POST /api/v1/auth/signout-everywhere": "actor",
  // Phase 10: Docker self-host TOTP settings (S-02).
  "POST /api/v1/auth/password/totp/setup": "actor",
  "POST /api/v1/auth/password/totp/verify": "actor",
  "POST /api/v1/auth/password/totp/disable": "actor",
  "GET /api/v1/me": "actor",
  "POST /api/v1/setup/complete": "actor",
  // The actor's own workspaces: a list scoped to the caller cannot name
  // another tenant's, and a create has no workspace to belong to yet.
  "GET /api/v1/workspaces": "actor",
  "POST /api/v1/workspaces": "actor",

  // --- workspace: membership in the workspace `:id` names ---------------
  // Exactly `Object.keys(ROUTE_ACTIONS)`, which the suite asserts rather
  // than trusting this comment. Kept as its own listing instead of being
  // spread from that object, because a spread would make the two agree by
  // construction and assert nothing.
  "GET /api/v1/workspaces/:id": "workspace",
  "PATCH /api/v1/workspaces/:id": "workspace",
  "GET /api/v1/workspaces/:id/members": "workspace",
  "POST /api/v1/workspaces/:id/members": "workspace",
  "DELETE /api/v1/workspaces/:id/members": "workspace",
  "DELETE /api/v1/workspaces/:id/members/:userId": "workspace",
  "PATCH /api/v1/workspaces/:id/members/:userId": "workspace",
  "GET /api/v1/workspaces/:id/banks": "workspace",
  "POST /api/v1/workspaces/:id/banks": "workspace",
  "GET /api/v1/workspaces/:id/banks/:bankId": "workspace",
  "PATCH /api/v1/workspaces/:id/banks/:bankId": "workspace",
  "DELETE /api/v1/workspaces/:id/banks/:bankId": "workspace",
  "GET /api/v1/workspaces/:id/tags": "workspace",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions": "workspace",
  "POST /api/v1/workspaces/:id/banks/:bankId/questions": "workspace",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions/:qid": "workspace",
  "PATCH /api/v1/workspaces/:id/banks/:bankId/questions/:qid": "workspace",
  "DELETE /api/v1/workspaces/:id/banks/:bankId/questions/:qid": "workspace",
  "POST /api/v1/workspaces/:id/banks/:bankId/media": "workspace",
  // Standing decision 4: this keeps `banks.edit` and is **not** relaxed for
  // a candidate. Task 7 mounts a separate attempt-authority media route
  // whose authorisation is membership in the attempt's pinned
  // `layout_json.media`, not the attempt's workspace.
  "GET /api/v1/workspaces/:id/media/:key": "workspace",
  "GET /api/v1/workspaces/:id/banks/:bankId/groups": "workspace",
  "POST /api/v1/workspaces/:id/banks/:bankId/groups": "workspace",
  "PATCH /api/v1/workspaces/:id/banks/:bankId/groups/:groupId": "workspace",
  "DELETE /api/v1/workspaces/:id/banks/:bankId/groups/:groupId": "workspace",
  "POST /api/v1/workspaces/:id/banks/:bankId/import": "workspace",
  "GET /api/v1/workspaces/:id/banks/:bankId/export": "workspace",
  "GET /api/v1/workspaces/:id/banks/:bankId/questions/:qid/export": "workspace",
  "GET /api/v1/workspaces/:id/tests": "workspace",
  "POST /api/v1/workspaces/:id/tests": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId": "workspace",
  "PATCH /api/v1/workspaces/:id/tests/:testId": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/draft": "workspace",
  "PATCH /api/v1/workspaces/:id/tests/:testId/draft": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/check-url": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/publish": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/close": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/archive": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/versions": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/checklist": "workspace",
  "GET /api/v1/workspaces/:id/tests/readiness": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/clone": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export": "workspace",
  "POST /api/v1/workspaces/:id/tests/import": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/candidates": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/candidates/import": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export/results.csv": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export/answers.csv": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export/events.csv": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export/snapshots.csv": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export/test.json": "workspace",
  // Phase 6 Task 2 (#66, P6.2): this phase's only guarded route.
  "POST /api/v1/workspaces/:id/tests/:testId/invites": "workspace",
  // Phase 7e Task 4 (`Q5a`): the minimal pair.
  "GET /api/v1/workspaces/:id/tests/:testId/attempts": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/attempts/:attemptId/unlock": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/monitor": "workspace",
  "POST /api/v1/workspaces/:id/attempts/:attemptId/action": "workspace",
  // Phase 8b Task 1 (`K14`): recording a rubric award.
  "POST /api/v1/workspaces/:id/tests/:testId/grade": "workspace",
  // Phase 8b Task 2 (`K15`): the grading queue.
  "GET /api/v1/workspaces/:id/tests/:testId/grading-queue": "workspace",
  // Phase 8b Task 3 (`K16`): the verdict.
  "POST /api/v1/workspaces/:id/attempts/:attemptId/verdict": "workspace",
  // Phase 8b Task 4 (`K17`/`K18`): the regrade offer.
  "POST /api/v1/workspaces/:id/banks/:bankId/questions/:qid/regrade": "workspace",
  // Phase 8e Task 2 (`S-14`, #101).
  "GET /api/v1/workspaces/:id/candidates/:candidateId/data": "workspace",
  "DELETE /api/v1/workspaces/:id/candidates/:candidateId/data": "workspace",
  // Phase 8e Task 3 (`K31`, #102).
  "GET /api/v1/workspaces/:id/usage": "workspace",
  // Phase 8d Task 1: webhooks.
  "GET /api/v1/workspaces/:id/webhooks": "workspace",
  "POST /api/v1/workspaces/:id/webhooks": "workspace",
  "PATCH /api/v1/workspaces/:id/webhooks/:webhookId": "workspace",
  "DELETE /api/v1/workspaces/:id/webhooks/:webhookId": "workspace",
  // Phase 8d Task 2 (K25, K26): scoped API keys. `workspace`, exactly like
  // every other `requires()`-guarded route — a key satisfies this same
  // authority rather than introducing a sixth (`route-authority.test.ts`'s
  // own "adds no sixth authority" assertion).
  "GET /api/v1/workspaces/:id/keys": "workspace",
  "POST /api/v1/workspaces/:id/keys": "workspace",
  "DELETE /api/v1/workspaces/:id/keys/:keyId": "workspace",
  // Phase 12: BYOK credentials and AI drafting
  "GET /api/v1/workspaces/:id/byok": "workspace",
  "GET /api/v1/workspaces/:id/byok/models": "workspace",
  "PUT /api/v1/workspaces/:id/byok/:provider": "workspace",
  "DELETE /api/v1/workspaces/:id/byok/:provider": "workspace",
  "POST /api/v1/workspaces/:id/banks/:bankId/draft-ai": "workspace",
  "POST /api/v1/workspaces/:id/banks/:bankId/draft-ai/commit": "workspace",
  // Phase 8c Task 1 (`R-06`, #94): test analytics.
  "GET /api/v1/workspaces/:id/tests/:testId/analytics": "workspace",
  // Phase 8g Task 4 (`#91`, `R-03`): attempt review.
  "GET /api/v1/workspaces/:id/attempts/:attemptId/review": "workspace",

  // Phase 13 Task 4: Teams and team grants.
  "GET /api/v1/workspaces/:id/teams": "workspace",
  "POST /api/v1/workspaces/:id/teams": "workspace",
  "GET /api/v1/workspaces/:id/teams/:teamId": "workspace",
  "PATCH /api/v1/workspaces/:id/teams/:teamId": "workspace",
  "DELETE /api/v1/workspaces/:id/teams/:teamId": "workspace",
  "GET /api/v1/workspaces/:id/teams/:teamId/members": "workspace",
  "POST /api/v1/workspaces/:id/teams/:teamId/members": "workspace",
  "DELETE /api/v1/workspaces/:id/teams/:teamId/members/:userId": "workspace",
  "GET /api/v1/workspaces/:id/teams/:teamId/grants": "workspace",
  "POST /api/v1/workspaces/:id/teams/:teamId/grants": "workspace",
  "DELETE /api/v1/workspaces/:id/teams/:teamId/grants/:grantId": "workspace",
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
  app.get("/api/v1/openapi.json", (c) => c.json(generateOpenApiSpec()));
  app.route("/api/v1/auth", authRoutes(deps));
  // `actorOnly()` (whole-branch review, CRITICAL): `/me` names no
  // workspace, so a key had no action for `requires()`'s scope check to run
  // against and nothing else stood in front of it — a key of any scope
  // could read this and get back a fabricated `role: "viewer"` membership
  // for a role it was never granted.
  app.get("/api/v1/me", actorOnly(), me());
  // Not in ROUTE_ACTIONS: neither route names a workspace, so there is no
  // membership to guard on. `complete` takes the actor from the session
  // through `actorOr401`, the way `/me` and `/workspaces` do.
  app.route("/api/v1/setup", setupRoutes(deps));
  app.route("/api/v1/demo", demoRoutes(deps));
  app.route("/api/v1/workspaces", workspaceRoutes(deps));
  app.route("/api/v1/workspaces", bankRoutes(deps));
  app.route("/api/v1/workspaces", questionRoutes(deps));
  app.route("/api/v1/workspaces", mediaRoutes(deps));
  // Phase 8c Task 5 (`D7c`, `K21`): mounted BEFORE `testRoutes`, and that is
  // load-bearing, not locality — `readinessRoutes`'s `/:id/tests/readiness`
  // and `testRoutes`'s `/:id/tests/:testId` are both two segments past the
  // prefix, and Hono answers whichever matches first in registration order
  // (`runRoutes`'s own documented trap, `apps/api/src/routes/run.ts:361`).
  // Swapping this pair would let `:testId` capture `"readiness"` and answer
  // with a 404 instead.
  app.route("/api/v1/workspaces", readinessRoutes(deps));
  app.route("/api/v1/workspaces", testRoutes(deps));
  app.route("/api/v1/workspaces", resultsExportRoutes(deps));
  app.route("/api/v1/workspaces", evidenceExportRoutes(deps));
  // Phase 7e Task 4: the minimal pair — locality with `testRoutes` rather
  // than necessity, the same reason `proctoringRoutes`' own position below
  // is.
  app.route("/api/v1/workspaces", attemptsRoutes(deps));
  app.route("/api/v1/workspaces", monitorRoutes(deps));
  app.route("/api/v1/workspaces", proctorActionsRoutes(deps));
  // The one route outside `/api/v1/workspaces/:id/...` this phase mounts —
  // deliberately public and unguarded (Review Focus 5, ADR 0006's
  // precedent). `apps/api/src/index.ts` has its own matching change so this
  // path reaches the Worker instead of the asset router.
  app.get("/t/:code", shortlinkRoute(deps));
  // Phase 6: the candidate runtime, the third request authority. Mounted
  // after every `/api/v1/workspaces` route and before nothing — its prefix
  // cannot collide with theirs — and deliberately carrying no guard. What
  // says so out loud is `ROUTE_AUTH` above, not this comment (ADR 0008).
  app.route("/api/v1/workspaces", inviteRoutes(deps));
  // Phase 8b Task 1 (`K14`): manual grading. Same `/api/v1/workspaces`
  // prefix as every other organiser route, mounted here for locality with
  // `inviteRoutes` rather than out of necessity.
  app.route("/api/v1/workspaces", gradeRoutes(deps));
  // Phase 8b Task 3 (`K16`): the verdict. Same prefix, mounted next to
  // `gradeRoutes` for the same locality reason.
  app.route("/api/v1/workspaces", verdictRoutes(deps));
  // Phase 8b Task 4 (`K17`/`K18`): the regrade offer. Same prefix, mounted
  // next to `gradeRoutes`/`verdictRoutes` for the same locality reason.
  app.route("/api/v1/workspaces", regradeRoutes(deps));
  // Phase 8e Task 2 (`S-14`, #101): a candidate's export and erasure.
  app.route("/api/v1/workspaces", candidateDataRoutes(deps));
  // Phase 8e Task 3 (`K31`, #102): the free-tier meter. Mounted directly,
  // like `/api/v1/me`, rather than folded into `workspaceRoutes` — one
  // route, no sub-router of its own to justify.
  app.get("/api/v1/workspaces/:id/usage", requireMember(), usageRoute(deps));
  // Phase 8d Task 1: webhooks, mounted after the candidate-runtime invite
  // route for locality with the rest of `/api/v1/workspaces/:id/...`
  // rather than out of necessity — no prefix below collides.
  app.route("/api/v1/workspaces", webhookRoutes(deps));
  // Phase 8c Task 1 (`R-06`, #94): test analytics, mounted beside webhooks
  // for the same locality reason — no prefix below collides.
  app.route("/api/v1/workspaces", analyticsRoutes(deps));
  // Phase 8d Task 2: scoped API keys, mounted beside webhooks for the same
  // locality reason — no prefix below collides.
  app.route("/api/v1/workspaces", keyRoutes(deps));
  // Phase 8g Task 4 (`#91`, `R-03`): per-attempt review endpoint.
  app.route("/api/v1/workspaces", attemptReviewRoutes(deps));
  // Phase 12: BYOK credentials and AI drafting
  app.route("/api/v1/workspaces", byokRoutes(deps));
  // Phase 13 Task 4: Teams and team grants
  app.route("/api/v1/workspaces/:id/teams", teamRoutes(deps));
  // Phase 7c Task 1: mounted before `runRoutes`, for locality with the
  // other `/api/v1/run/attempt/*` routes rather than out of necessity —
  // `POST /attempt/events` is a different HTTP method from the landing
  // catch-all (`GET /:workspaceSlug/:testSlug`), so the two never collide
  // in Hono's route table regardless of registration order. Unlike
  // `attemptRoutes`' position inside `runRoutes` (see that file's
  // header), swapping this pair would not break anything.
  app.route("/api/v1/run", proctoringRoutes(deps));
  app.route("/api/v1/run", runRoutes(deps));

  return app;
}
