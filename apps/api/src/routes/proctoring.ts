// `POST /api/v1/run/attempt/events` — the one route every later gate in
// Phase 7c posts to (`Q7`). One route, `attempt` authority, taking an
// array and calling `appendEvents()` (`packages/db/src/repo/attempts.ts`)
// unchanged. **Ten events per request**, the cap that function already
// documents and the daily write budget it already protects.
//
// **Ids are minted server-side, as `evt_`.** No client-generated id and no
// idempotency key — `Q7`'s own ruling: an event is evidence, not an
// answer, and at-least-once delivery is fine for it. `appendEvents`'s own
// header explains why a duplicate row after a retry is a cosmetic defect
// rather than a correctness one.
//
// `Q7a`: **the server counts.** The response carries the authoritative
// violation count straight off the database, never a client-side tally
// that resets on reload — the same count `GET /api/v1/run/attempt` now
// reports, so the two can never disagree.
//
// `Q7c`: rate-limited through Phase 6 Task 4's limiter (`attempt_events`
// in `run/limit.ts`) and a measured `ROUTE_BUDGETS` entry — declared in
// `app.ts`, next to the route's mount and its `ROUTE_AUTH` line.
//
// `detail` stays `unknown` here, deliberately: `Q7b` wants a declared
// shape per event type, but that belongs to the plan that emits each
// event (Tasks 4 and 5), not to the route that merely stores whatever it
// is handed.

import { Hono } from "hono";
import { z } from "zod";
import {
  appendEvents,
  claimViolationLimit,
  countViolations,
  lockAttempt,
  recordSnapshot,
} from "@pariksha/db";
import {
  CANDIDATE_PROCTORING_EVENTS,
  violationOutcome,
  type ProctoringEventType,
} from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { attemptContext } from "../middleware/attemptContext.js";
import { limitOrThrow } from "../run/limit.js";
import { resolvedProctoringOf } from "../run/attempt.js";
import { submitAttempt } from "../run/submit.js";
import { readBodyWithLimit } from "./media.js";

/** `Q7`: the cap `appendEvents` already documents and the daily write
 *  budget it protects. Real, not advisory — refused before the request
 *  touches the database or the rate limiter. */
export const MAX_EVENTS_PER_REQUEST = 10;

/** `ROUTE_BUDGETS` and `ROUTE_AUTH` key on this literally; the test suite
 *  and `scrub-scan.test.ts`'s derived endpoint list import it rather than
 *  retyping it, the same way `ANSWER_PATH` keeps `/attempt/answer` in one
 *  place. */
export const EVENTS_PATH = "/api/v1/run/attempt/events";

/** Review finding 6: `detail` was unbounded at this trust boundary — every
 *  shape this phase's emitters actually produce is `Record<string, never>`
 *  or `{ awayMs: number | null }` (`@pariksha/core`'s own doc comments), so
 *  a few hundred bytes covers all of them with room to spare. Not a
 *  re-litigation of `R3` (`detail`'s shape stays `z.unknown()` here,
 *  deliberately, per that ruling) — nothing has ever bounded its size. */
const MAX_DETAIL_BYTES = 512;

// Phase 7e Task 1 fix round (F1, Critical): `PROCTORING_EVENTS` is the
// *storage* vocabulary — `appendEvents` can write any of it — but three of
// its members (`violation_limit_reached`, `attempt_locked`,
// `attempt_unlocked`) are server-synthesized and must never come from a
// candidate's own POST body. The full union here let a candidate forge
// `violation_limit_reached` at violation 0 and permanently switch their own
// attempt's consequences off (`alreadyActioned` has no origin column to
// tell a server row from a client one) — `Q7a` exactly inverted, the client
// handing the server the one fact its decision is gated on.
// `CANDIDATE_PROCTORING_EVENTS` is the closed set a candidate's browser can
// legitimately observe; the three server types are refused with a 400
// before anything is written, not merely trusted not to be sent.
const eventItem = z.object({
  type: z.enum(CANDIDATE_PROCTORING_EVENTS),
  detail: z
    .unknown()
    .optional()
    .refine((detail) => {
      if (detail === undefined) return true;
      try {
        // `TextEncoder`, not `.length`: a JS string's length is UTF-16 code
        // units and D1 stores TEXT as UTF-8, so a `detail` of non-ASCII
        // characters would land up to three times over this cap while
        // measuring as under it. The constant is named in bytes; measure
        // bytes.
        return new TextEncoder().encode(JSON.stringify(detail)).length <= MAX_DETAIL_BYTES;
      } catch {
        return false; // unserialisable (e.g. circular) is refused, not ignored
      }
    }, `detail must serialise to at most ${String(MAX_DETAIL_BYTES)} bytes`),
  clientTs: z.number(),
});

const eventsRequest = z.object({
  events: z.array(eventItem).max(MAX_EVENTS_PER_REQUEST),
});

// --- Task 1 (`Q4`): the snapshot route --------------------------------

/** `ROUTE_BUDGETS` and `ROUTE_AUTH` key on this literally, the same reason
 *  `EVENTS_PATH` exists. */
export const SNAPSHOT_PATH = "/api/v1/run/attempt/snapshot";

/**
 * `Q4b`/`D-R8`: ten times the 25 KB `SNAPSHOT_KB` `apps/api/src/publish/
 * checklist.ts` pins and `apps/web/src/sections/signal/Tail.tsx` states
 * publicly — slack for a weak encoder, nowhere near a video. `AG2` ("no
 * video or audio is ever recorded or stored") is enforced HERE, at the
 * trust boundary: `Q4` costed and refused a presigned PUT specifically
 * because this route is the only place that *can* bound what a
 * candidate's browser posts.
 */
export const SNAPSHOT_MAX_BYTES = 256 * 1024;

const SNAPSHOT_REASONS = new Set(["interval", "violation", "identity"]);
export type SnapshotReason = "interval" | "violation" | "identity";

export function proctoringRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/attempt/events", attemptContext(deps), async (c) => {
    const attempt = c.get("attempt");

    // Closed-set `type` and the ten-event cap, before anything is spent:
    // neither the rate limiter nor the database is touched by a request
    // that fails this.
    const parsed = eventsRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "That event could not be read. Try again.");
    }

    // `Q7c`: volume is the risk here, not a wrong guess, so every request
    // is charged — the way `email_code`'s bucket is and `test_access`'s
    // is not. Keyed per attempt, never per candidate or per test: one
    // attempt's flapping browser must not cost another candidate theirs.
    await limitOrThrow(deps, "attempt_events", attempt.attemptId);

    // Review finding 9: `attemptContext` deliberately resolves a submitted
    // attempt (the receipt and the result read through the same cookie),
    // but whether a *write* is still allowed is this route's question — the
    // same question `/attempt/answer` asks and refuses with a 409. This
    // route answers it differently, on purpose: a stale tab's 5-second
    // flush, or a candidate's own script, posting after submission is a
    // silent no-op that still answers the current count, not a 409.
    // `/answer` refuses loudly because the candidate must be told their
    // answer was not saved; a proctoring event never surfaces anything to
    // the candidate (`AG1`), and a 409 here would make the fail-open queue
    // retry a write that can never succeed again until its 100-item buffer
    // fills.
    if (attempt.submittedAt === null) {
      await appendEvents(deps.db, attempt.workspaceId, {
        attemptId: attempt.attemptId,
        events: parsed.data.events,
        serverTs: deps.now(),
      });
    }

    const violations = await countViolations(deps.db, attempt.workspaceId, attempt.attemptId);
    // `Q1`: `limit` and `action` come from the resolved object, never from
    // the raw overrides and never from a branch on `profile`. The same
    // `resolvedProctoringOf` helper `GET /attempt` uses — one boundary
    // cast from the stored, `unknown` settings column, not two.
    const resolved = resolvedProctoringOf(attempt.settings);

    // Phase 7e Task 1 (`P-09`, issue #213): the count has a limit, and
    // `violationOutcome` is the one place `violations >= limit` turns into
    // a decision. Guarded by the same `submittedAt === null` check as the
    // write above, for the same reason: a stale tab's flush past
    // submission must not mark an attempt that is already over as newly
    // actioned.
    //
    // `flag`/`auto_submit`/`lock` are the three kinds a first firing can
    // be; `warn` and `none` are not a firing at all, so nothing is marked.
    // The marker — a `violation_limit_reached` event — is what makes
    // `alreadyActioned` true on the next request (`Review Focus 1`: once,
    // not twice) and what `warn_then_flag`'s whole action amounts to today:
    // Task 3 of this plan is what makes `lock` actually lock, reusing this
    // same outcome.
    //
    // Phase 7e Task 1 fix round (F2, Major): `claimViolationLimit` replaces
    // a `SELECT`-then-`INSERT` that raced under concurrency — see its own
    // doc comment (`packages/db/src/repo/attempts.ts`). It is attempted
    // only at or past the limit (`atLimit`): below it, `alreadyActioned` is
    // always `false` and no write — atomic or otherwise — is needed to know
    // that, so the common case pays nothing extra here at all.
    //
    // Phase 7e Task 2: `auto_submit` is made real here, the first consumer
    // of that branch. `submitAttempt` is the same function `POST
    // /attempt/submit` calls — not re-derived — so a candidate submitted
    // this way gets the exact same idempotent, scored, audited ending a
    // manual press does, with `reason: "limit"` collecting the value
    // `SubmitReason` has reserved since Task 11 (`submit.ts`).
    //
    // `AG1`: this must not throw into, or surface anything to, the
    // candidate's own request — the same posture every other write in this
    // handler already takes. `submitAttempt` itself only ever performs
    // fast, local D1 statements (no upload, no third-party call) so there
    // is nothing here that can *stall* the response either; the `try` is
    // for the unlikely case a statement itself fails, not for a slow one.
    // A failure here leaves `alreadyActioned` true (the marker above is
    // still written) and the attempt not yet submitted — the candidate's
    // own Submit press or the exam's own timeout still ends it normally,
    // the same fallback every other proctoring failure in this phase
    // degrades to.
    let submitted = false;
    // Phase 7e Task 3 (`E-R1`/`E-R2`): `true` only on the one response
    // whose own batch locks this attempt — `ProctoringLayer`'s own
    // `initialLocked`/`locked` doc comment is the mirror of `submitted`'s.
    let locked = false;
    if (attempt.submittedAt === null) {
      const atLimit = violations >= resolved.violationLimit;
      const alreadyActioned = atLimit
        ? !(
            await claimViolationLimit(deps.db, attempt.workspaceId, {
              attemptId: attempt.attemptId,
              now: deps.now(),
            })
          ).claimed
        : false;
      const outcome = violationOutcome({ violations, resolved, alreadyActioned });
      if (outcome.kind === "auto_submit") {
        try {
          await submitAttempt(deps, attempt, "limit", deps.now());
          submitted = true;
        } catch {
          /* AG1: degrade — see the comment above. */
        }
      } else if (outcome.kind === "lock") {
        // Phase 7e Task 3: the fourth and most intrusive action, made real.
        // `claimViolationLimit` above is the one and only idempotency
        // check — `alreadyActioned` already gates this whole branch to a
        // single firing, so `lockAttempt` (`packages/db/src/repo/
        // attempts.ts`) does not re-decide anything, only writes. `AG1`:
        // same posture as `auto_submit` just above — a failure here leaves
        // `alreadyActioned` true and the attempt unlocked; nothing throws
        // into or stalls the candidate's own request.
        try {
          const result = await lockAttempt(deps.db, attempt.workspaceId, {
            attemptId: attempt.attemptId,
            now: deps.now(),
          });
          if (result.locked) {
            await appendEvents(deps.db, attempt.workspaceId, {
              attemptId: attempt.attemptId,
              events: [{ type: "attempt_locked" satisfies ProctoringEventType, clientTs: deps.now() }],
              serverTs: deps.now(),
            });
            locked = true;
          }
        } catch {
          /* AG1: degrade — see the comment above. */
        }
      }
    }

    // `submitted`/`locked` tell the browser this very request is the one
    // that ended or froze the attempt, so the runner can move itself to
    // the receipt or raise the lock overlay instead of finding out on its
    // next save (a 409) or its next reload.
    return c.json({
      violations,
      limit: resolved.violationLimit,
      action: resolved.violationAction,
      submitted,
      locked,
    });
  });

  routes.post("/attempt/snapshot", attemptContext(deps), async (c) => {
    const attempt = c.get("attempt");

    // Refused before storage or the database is touched, the same order
    // `/attempt/events`' closed-set check already keeps.
    const reason = c.req.query("reason") ?? "";
    if (!SNAPSHOT_REASONS.has(reason)) {
      throw new ApiError(400, "invalid_request", "reason must be interval, violation or identity.");
    }

    // `B3` (whole-branch review): the one candidate-reachable route that
    // writes to object storage, previously uncapped. Keyed per attempt,
    // the same posture `/attempt/events`' own `attempt_events` bucket
    // takes just above — see `LIMITS.attempt_snapshot` in `run/limit.ts`
    // for the arithmetic behind the cap.
    await limitOrThrow(deps, "attempt_snapshot", attempt.attemptId);

    // `Q4b`/`D-R8`: the declared content type, before a byte of the body is
    // read — a client can set this header to anything, so it is checked
    // again against the bytes themselves below.
    if ((c.req.header("content-type") ?? "") !== "image/jpeg") {
      throw new ApiError(415, "unsupported_media_type", "Only a JPEG snapshot is accepted.");
    }

    const body = await readBodyWithLimit(c.req.raw, SNAPSHOT_MAX_BYTES, "A snapshot");
    const bytes = new Uint8Array(body);
    // `D-R8`: a declared `image/jpeg` with a body that is not actually a
    // JPEG — the magic bytes, not the header a client fully controls.
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      throw new ApiError(415, "unsupported_media_type", "That is not a JPEG image.");
    }

    // `B2` (whole-branch review): mirrors `/attempt/events`' own guard
    // above, same reasoning — `attemptContext` deliberately resolves a
    // submitted attempt, but whether a WRITE is still allowed is this
    // route's own question. A silent no-op, not `/answer`'s 409: a
    // proctoring failure must never surface anything to the candidate
    // (`AG1`), and this route previously kept writing R2 objects and
    // `snapshot` rows against an attempt that was already over.
    //
    // Fix round 1 (MAJOR): `attempt.lockedAt !== null` added. This route
    // was never in `E-R2`'s enumerated guard list — it is neither a read
    // nor one of the two write routes `assertNotLocked` covers — so a
    // locked candidate kept driving real R2 object writes and real
    // `snapshot` inserts indefinitely against a metered live Cloudflare
    // account. Same silent-no-op shape as the `submittedAt` case
    // immediately above, for the same `AG1` reason: a proctoring failure —
    // and a lock is exactly that, from this route's point of view — must
    // never surface anything to the candidate.
    if (attempt.submittedAt !== null || attempt.lockedAt !== null) {
      return c.json({ stored: true });
    }

    const takenAt = deps.now();
    // `Q4a`: minted server-side, from the attempt the cookie names — no
    // workspace id anywhere in it.
    const storageKey = `snapshot/${attempt.attemptId}/${String(takenAt)}-${reason}.jpg`;

    // `Q4f`: the row is written only once the object it names really
    // exists. A `put` that throws (R2 down) reaches no further — no row,
    // and the thrown error becomes the 500 `errorEnvelope` answers.
    await deps.storage.put(storageKey, bytes, { contentType: "image/jpeg" });
    await recordSnapshot(deps.db, attempt.workspaceId, {
      attemptId: attempt.attemptId,
      storageKey,
      takenAt,
      // No cast: `recordSnapshot` takes a `string`, and the closed-set check
      // above is what actually narrows this — an assertion here asserted
      // nothing (`@typescript-eslint/no-unnecessary-type-assertion`).
      reason,
    });

    // `Q4a`: the response carries no key at all.
    return c.json({ stored: true });
  });

  return routes;
}
