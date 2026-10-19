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
// **Never per IP** — a hall behind one NAT is one address, and a botnet is
// a thousand. Every bucket is keyed by the thing being attacked (a test
// version, a short code), which is also why `rate_limit` is untenanted:
// those keys are already globally unique and a `/t/:code` miss has no
// workspace at all.
//
// A brute force against an 8-character access code at 300 guesses a minute
// is still hopeless, so the sizing costs nothing in security.

import { takeRateToken } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { refuse } from "./entry.js";

export const LIMITS = {
  /** Refused access attempts, per test version, per minute. */
  test_access: { limit: 300, windowMs: 60_000 },
  /** Registrations, per test version, per five minutes. */
  test_register: { limit: 1_000, windowMs: 5 * 60_000 },
  /** Short codes that resolved to nothing, per code, per minute. */
  short_link: { limit: 300, windowMs: 60_000 },
} as const;

export type LimitKind = keyof typeof LIMITS;

/**
 * Takes one token from `kind`'s bucket for `key`, and refuses when the
 * bucket is empty. One subrequest.
 *
 * The bucket name carries the kind, so two limits over one id (a test
 * version's refusals and its registrations) never share a counter.
 */
export async function limitOrThrow(deps: AppDeps, kind: LimitKind, key: string): Promise<void> {
  const { limit, windowMs } = LIMITS[kind];
  const count = await takeRateToken(deps.db, `${kind}:${key}`, windowMs, deps.now());
  if (count > limit) throw refuse("too_many_attempts");
}

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
