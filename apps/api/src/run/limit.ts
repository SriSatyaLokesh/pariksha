// `S-07`'s volume defence, and the two numbers that decide whether it
// protects the test or breaks it.
//
// **Count misses, never successes, and never a bucket keyed on nothing.**
// The PRD's own capacity row is 500 candidates starting within five
// minutes. A bucket that counted honest traffic would turn the busiest
// two minutes of the first live test into a lockout for everyone who
// clicked eleventh, on the one URL they were given. So:
//
//   * `test_access` counts **refusals only** — a wrong code, an
//     off-network address, an identifier that is not on the list. A
//     successful gate pays nothing, and therefore costs no subrequest
//     either, which is why Task 2's measured budgets are unchanged by
//     this file. Enumeration is all misses; a real cohort is all hits.
//   * `test_register` counts every registration, because a registration
//     *is* the volume — but at a ceiling twice the capacity row, so the
//     cohort it is sized for cannot reach it.
//   * `short_link` counts only a code that resolved to nothing. A
//     six-character code is the one enumerable surface the product
//     exposes, and every probe of it is a miss while every candidate
//     reading the projector is a hit.
//
//     **It is the one bucket with no key at all, deliberately.** Keyed
//     per code it would be a counter that never reaches 2 against the
//     only attack it exists for: a sweep across the 32^6 space never
//     repeats a code. Globally it puts a floor of years on a full
//     sweep. The "never a bucket keyed on nothing" rule above is about
//     buckets that count traffic a real candidate generates — this one
//     counts misses, and a real candidate's code resolves, so no hall
//     can be locked out of anything by it. The worst case is a stranger
//     reading 429 instead of 404 on a link that was already dead, and
//     429 gives the better advice of the two.
//   * `email_code` and `email_code_address` count **every** request,
//     because a request is the abuse: each one writes a row and sends a
//     message to an address a stranger typed. Two buckets rather than
//     one, because the two attacks are different shapes — thousands of
//     addresses sprayed at one test, and thousands of codes aimed at one
//     inbox — and a single ceiling that stopped the second would refuse
//     the hall long before it stopped the first.
//   * `attempt_events` (`Q7c`) counts **every** request too, keyed per
//     attempt: the proctoring ingest is an endpoint a candidate's browser
//     can call in a loop, and each call writes a batch of rows regardless
//     of outcome, so there is no "miss" to charge instead.
//   * `attempt_snapshot` (`B3`) is the same shape and the same window,
//     keyed per attempt too — and harder in cost, since each call also
//     writes an R2 object, not just D1 rows. See its own entry in `LIMITS`
//     for the arithmetic.
//
// **Never per IP** — a hall behind one NAT is one address, and a botnet is
// a thousand. Every bucket is keyed by the thing being attacked (a test
// version, a short code), which is also why `rate_limit` is untenanted:
// those keys are already globally unique and a `/t/:code` miss has no
// workspace at all.
//
// A brute force against an 8-character access code at 300 guesses a minute
// is still hopeless, so the sizing costs nothing in security.

import { sweepRateLimits, takeRateToken } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { EMAIL_CODE_TTL_MS, refuse } from "./entry.js";

/** `RESULT_CODE_TTL_MS`, restated rather than imported: `run/result.ts`
 *  imports this module, so taking the constant from there would be a
 *  cycle. No assertion ties the two — they are pinned to the same
 *  literal from both sides instead: `LIMITS` in `access.test.ts`
 *  ("every anti-abuse ceiling and window is pinned to a literal") and
 *  `RESULT_CODE_TTL_MS` in `release.test.ts`. A drift changes one of
 *  those two literals and fails there. */
const RESULT_CODE_WINDOW_MS = 10 * 60_000;

export const LIMITS = {
  /** Refused access attempts, per test version, per minute. */
  test_access: { limit: 300, windowMs: 60_000 },
  /** Registrations, per test version, per five minutes. */
  test_register: { limit: 1_000, windowMs: 5 * 60_000 },
  /** Emailed codes, per test version, per five minutes. Sized like
   *  `test_register` and for the same reason: a 500-seat hall all
   *  asking for a code in the same five minutes is the capacity row,
   *  and twice that is the ceiling. */
  email_code: { limit: 1_000, windowMs: 5 * 60_000 },
  /** Emailed codes, per **address**, per ten minutes — the code's own
   *  TTL, so the window is the lifetime of what it protects. Five,
   *  because an honest candidate needs one and occasionally two, and
   *  because this is the number that stands between a stranger and
   *  someone else's inbox. */
  email_code_address: { limit: 5, windowMs: EMAIL_CODE_TTL_MS },
  /** Code guesses against one **resolved attempt**, per ten minutes — the
   *  code's own TTL, so the window is the lifetime of what it protects.
   *  Keyed on the attempt the reference resolved to and never on the
   *  reference as typed: a guesser sweeping references never repeats
   *  one, so a bucket per typed string was a counter that could not
   *  reach 2 while minting a permanent row per request. Asking for a
   *  code is bounded by the inbox it is sent to
   *  (`email_code_address`) instead, which is the thing that attack
   *  actually aims at. Twenty is generous for a candidate who mistypes
   *  a code twice and asks again. */
  result_code: { limit: 20, windowMs: RESULT_CODE_WINDOW_MS },
  /** Short codes that resolved to nothing — **instance-wide**, not per
   *  code, per minute. See the header: a sweep never repeats a code. */
  short_link: { limit: 300, windowMs: 60_000 },
  /** Proctoring events, per **attempt**, per five minutes (`Q7c`, Phase
   *  7c Task 1). Ten events a request and 120 requests is 1,200 rows in
   *  five minutes — far past any legitimate candidate's traffic (the
   *  busiest real source is `window_blur`/`visibility_hidden` on tab
   *  switches) and nowhere near the daily write budget `appendEvents`'s
   *  own cap already protects. */
  attempt_events: { limit: 120, windowMs: 5 * 60_000 },
  /** Proctoring snapshots, per **attempt**, per five minutes — the SAME
   *  window as `attempt_events` above, deliberately (`B3`, whole-branch
   *  review, Phase 7d Task 1 follow-up): `MAX_WINDOW_MS` below is the
   *  longest window any bucket counts over, and every sweep pays for
   *  whichever bucket owns it, so this does not widen it past
   *  `email_code_address`'s own 10 minutes for every OTHER kind in this
   *  table. Harder than `attempt_events` in cost, not in window: each call
   *  here also writes an R2 object of up to `SNAPSHOT_MAX_BYTES`, not just
   *  D1 rows.
   *
   *  The organiser-facing interval control (`ProctoringPanel.tsx`'s
   *  `NumberField`) enforces no floor above zero, but the one cadence this
   *  codebase actually ships, tests and budgets against is Strict's own
   *  default, `PROCTORING_DEFAULTS.strict.snapshotIntervalSeconds = 60`
   *  (`@pariksha/core`): `checklist.ts`'s own 200-image advisory threshold
   *  is calibrated to stay silent against exactly this cadence (`Q1c`). At
   *  60 s, five honest minutes is 300 / 60 = 5 interval captures. Add one
   *  identity photo (once, at the start). Violation snapshots are the
   *  wildcard — `ProctoringLayer.tsx` pairs every one with a
   *  `push`/`pushImmediate` into the SAME `attempt_events` queue this
   *  module already rate-limits at 120 REQUESTS per five minutes per
   *  attempt: 5 + 1 + 120 = 126.
   *
   *  Read that 120 as a calibration point, not as a proof. It bounds
   *  requests, not violations — `appendEvents` batches up to ten events per
   *  request, and a departure snapshots on leaving but pushes on returning,
   *  so a pathological attempt could drive far more violations through far
   *  fewer requests. The number below is defensible because it clears real
   *  traffic by a wide margin and refuses an abusive client quickly, not
   *  because 126 is a ceiling anything enforces. An organiser who sets
   *  `snapshot_interval_seconds` below about two seconds (the control's own
   *  floor is zero) will exceed it legitimately; that is the signal to raise
   *  this, and `Q1c`'s 200-image advisory is what would flag it first.
   *  Rounded up to 150 for
   *  headroom — comfortably clear of real traffic and, against the
   *  review's own abuse scenario (~20 requests/second), refusing within
   *  about 8 seconds rather than never. */
  attempt_snapshot: { limit: 150, windowMs: 5 * 60_000 },
} as const;

export type LimitKind = keyof typeof LIMITS;

/**
 * Takes one token from `kind`'s bucket for `key`, and refuses when the
 * bucket is empty. One subrequest.
 *
 * The bucket name carries the kind, so two limits over one id (a test
 * version's refusals and its registrations) never share a counter.
 *
 * `key` is omitted only by `short_link`, whose bucket is deliberately
 * instance-wide — see the header for why that is safe there and nowhere
 * else.
 */
export async function limitOrThrow(deps: AppDeps, kind: LimitKind, key?: string): Promise<void> {
  const { limit, windowMs } = LIMITS[kind];
  const bucket = key === undefined ? kind : `${kind}:${key}`;
  const count = await takeRateToken(deps.db, bucket, windowMs, deps.now());
  // The one bucket whose key a stranger mints: every other one is a test
  // version, a resolved attempt or nothing at all, and those rows are
  // bounded by what the instance holds. Swept here because this is where
  // the unbounded row is written, and by the **longest** window of any
  // kind — one `DELETE` sees every kind's rows and clearing a live one
  // would reset its count. One extra subrequest, on the two routes that
  // already send a message.
  if (kind === "email_code_address") {
    await sweepRateLimits(deps.db, deps.now() - MAX_WINDOW_MS);
  }
  if (count > limit) throw refuse("too_many_attempts");
}

/** The longest window any bucket counts over — see `limitOrThrow`. Exported
 *  for `retention/sweep.ts`'s `rateLimitJob`, the other caller of
 *  `sweepRateLimits` that needs the same "older than every kind's window"
 *  cutoff (Fix round 1, F2) — read off `LIMITS` here rather than re-derived
 *  there, so there is one definition instead of two that merely agree. */
export const MAX_WINDOW_MS = Math.max(...Object.values(LIMITS).map((one) => one.windowMs));

/**
 * The miss-counting form: run `work`, and charge the bucket only when it
 * refuses.
 *
 * A 400 is not charged. "You sent nothing" says nothing about the secret,
 * so it is not a guess at it — and it is what the `public` reachability
 * probes in `route-authority.test.ts` answer, which must not write a row.
 * A 5xx is not charged either: the caller did not do anything wrong.
 */
export async function limitMisses<T>(
  deps: AppDeps,
  kind: LimitKind,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status >= 401 &&
      error.status < 500 &&
      error.code !== "not_found"
    ) {
      // Throws `too_many_attempts` in place of the original refusal once
      // the bucket is empty, which is the one case where a candidate is
      // told something other than what actually happened — and `C-02`'s
      // sentence for it says to wait and try again.
      await limitOrThrow(deps, kind, key);
    }
    throw error;
  }
}
