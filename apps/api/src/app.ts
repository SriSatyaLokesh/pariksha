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
import { runRoutes } from "./routes/run.js";
import { proctoringRoutes } from "./routes/proctoring.js";
import { inviteRoutes } from "./routes/invites.js";
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
  "/api/v1/workspaces/:id/tests/:testId/close": 6,
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
  // Phase 6 Task 11 (#75, P6.11): ending the attempt. Measured at **7**
  // in `test/run/submit.test.ts`, on the path that actually scores: the
  // attempt join the cookie resolves through, the answers, the
  // candidate's attempt count (which is what prints "Attempt 2 of 3" and
  // what the `full_review` degrade is judged by), the workspace's bank
  // read **once** for the whole paper, the one `finishAttempt` write, the
  // audit row, and — Phase 8a Task 3 (`K6`/`K7`) — `attemptFiguresForCandidate`'s
  // one read of this candidate's own prior attempts, paid only on the last
  // attempt of a test whose `counted_attempt` is set to anything but
  // `"latest"` **and** whose release actually discloses something (`show
  // !== null`, M-1 — a `release.when: "never"` test on the same
  // last-attempt shape stays at the common path's 6, measured by
  // `"rel-never-counted"`'s own test in `submit.test.ts`, with
  // `"rel-counted"` below as its released, 7-paying twin)
  // (`apps/api/test/run/release.test.ts`'s "K7, live" test
  // measures this exact combination). A second press writes nothing — the
  // row the cookie resolved already carries the score and the stamp — but
  // it is not free: it still pays the join, the answers and the attempt
  // count, so **3**, and **4** at `full_review` where the bank is read
  // again for the key (neither fixture that measures those two numbers
  // sets `counted_attempt`, so the counted read adds nothing to them).
  // Both measured in `test/run/submit.test.ts`.
  //
  // A number above 7 means the bank, or the counted read, is being spent
  // more than once a request — the failure this line exists to catch on a
  // 50-subrequest ceiling.
  "/api/v1/run/attempt/submit": 7,
  // Phase 7c Task 1 (`Q7`/`Q7c`): the proctoring event ingest. The common
  // path — no attempt reaches its violation limit this batch — is **5**,
  // measured in `test/run/events.test.ts`'s own counting test: the attempt
  // join the cookie resolves through, the `attempt_events` rate token,
  // `appendEvents`'s one batched insert (capped at 10 rows a request, so
  // this number is flat in how many events the request actually carries),
  // `countViolations`'s one read for the response's authoritative count,
  // and `violationLimitAlreadyReached`'s one read (Phase 7e Task 1, `Q7a`).
  // The declared ceiling is **6**, the worst case paid only the first time
  // an attempt reaches its limit: one more `appendEvents` call writing the
  // single `violation_limit_reached` marker (`test/run/violation-limit.
  // test.ts`). An empty `events` array costs one less than the common
  // path — `appendEvents` is a no-op on it.
  "/api/v1/run/attempt/events": 6,
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
  // Task 12 (#63, P5.10): clone, export and import are all `tests.edit` —
  // an Author builds tests, and none of these publishes one.
  "POST /api/v1/workspaces/:id/tests/:testId/clone": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId/export": "tests.edit",
  "POST /api/v1/workspaces/:id/tests/import": "tests.edit",
  "GET /api/v1/workspaces/:id/tests/:testId/candidates": "candidates.manage",
  "POST /api/v1/workspaces/:id/tests/:testId/candidates/import": "candidates.manage",

  // Phase 6 Task 2 (#66, P6.2). The invite is a credential for a row on
  // the candidate list, so it is the same permission that uploaded the
  // list — an Author who built the test holds `tests.edit` and not this.
  "POST /api/v1/workspaces/:id/tests/:testId/invites": "candidates.manage",
  // `GET /t/:code` carries no entry here at all: it is the one route this
  // phase mounts outside the workspace guard (Review Focus 5, ADR 0006).
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
export type RouteAuthority = "workspace" | "attempt" | "entry" | "actor" | "public";

export const ROUTE_AUTH: Record<string, RouteAuthority> = {
  // --- public: no credential at all ------------------------------------
  "GET /api/v1/health": "public",
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
  "POST /api/v1/workspaces/:id/tests/:testId/clone": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/export": "workspace",
  "POST /api/v1/workspaces/:id/tests/import": "workspace",
  "GET /api/v1/workspaces/:id/tests/:testId/candidates": "workspace",
  "POST /api/v1/workspaces/:id/tests/:testId/candidates/import": "workspace",
  // Phase 6 Task 2 (#66, P6.2): this phase's only guarded route.
  "POST /api/v1/workspaces/:id/tests/:testId/invites": "workspace",
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
  // Phase 6: the candidate runtime, the third request authority. Mounted
  // after every `/api/v1/workspaces` route and before nothing — its prefix
  // cannot collide with theirs — and deliberately carrying no guard. What
  // says so out loud is `ROUTE_AUTH` above, not this comment (ADR 0008).
  app.route("/api/v1/workspaces", inviteRoutes(deps));
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
