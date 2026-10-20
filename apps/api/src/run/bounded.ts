// The server's regex seam (#129).
//
// `packages/core`'s `validateRegistration` takes its matcher as an argument
// because a bound needs a host a pure leaf package does not have. The
// browser passes nothing and gets `RegExp.test`; the server passes this.
//
// **`matchBounded` returns a boolean and never throws**, which is the
// whole contract of the *registration* half. Three parties can be at fault
// when a pattern does not run, and only one of them is the candidate:
//
//   * the *organiser* wrote an unsafe or unparseable pattern — their
//     defect, surfaced to them by `unsatisfiableValidation` in the builder
//     and again at the publish gate, and `check_reachable`'s sibling: it
//     must never become a stranger's refusal at registration. So an
//     unsafe pattern **passes**, exactly as the browser's copy does.
//   * the *candidate* typed something longer than any pattern may be run
//     against. That is a real validation issue, and `packages/core` raises
//     it as a positioned `too_long` before the matcher is ever called —
//     from core, so the browser says the same sentence. The length check
//     below is the backstop under that, not the message.
//   * nobody — the pattern simply did not match, and the candidate is told
//     the organiser's `pattern_message`.
//
// An earlier plan had the *registration* path throw `MatchBudgetExceeded`
// and the route answer 422. Reversed: it punished the candidate for the
// author's regex, and it put a throw on a path where a missed `catch` is
// a 500.
//
// Task 11 reuses this seam for grading — **the bound, not the policy.**
// The two surfaces want opposite fallbacks and both are right:
//
//   * registration refuses nothing, for the three reasons above.
//   * grading refuses to *guess*. Passing would award full marks to every
//     candidate on a question nobody could grade; failing would score them
//     zero for a pattern somebody else typed. So the question goes
//     **pending** and is flagged for the organiser — which needs the bound
//     to say out loud that it refused, rather than return a verdict.
//
// So the bound is written once and the policy belongs to the caller: one
// helper with two faces, rather than two helpers that drift apart.

import { assertSafeRegex, MAX_MATCH_INPUT } from "@pariksha/core";

/**
 * The bound refused: the pattern is not safe to run, will not compile, or
 * the input is longer than any pattern may be run against.
 *
 * It carries the pattern because the organiser is the only person who can
 * fix it, and the audit row this becomes is read in their workspace — never
 * in the candidate's response body (`S-10`).
 */
export class MatchBudgetExceeded extends Error {
  readonly pattern: string;

  constructor(pattern: string, reason: string) {
    super(`regex budget exceeded: ${reason}`);
    this.name = "MatchBudgetExceeded";
    this.pattern = pattern;
  }
}

/**
 * Runs `pattern` against `input` under both halves of the bound: the
 * grammar gate (`assertSafeRegex`, which admits only patterns that are
 * safe by construction) and the input cap (which is what actually bounds
 * the damage if the grammar gate ever has a bug, because backtracking cost
 * grows with input length whatever the pattern is).
 *
 * **Re-run here, at execution time**, rather than trusting the
 * authoring-time pass: a pattern can reach this having been stored before
 * that check existed, imported from another instance, or admitted through
 * a gap since closed.
 *
 * Throws `MatchBudgetExceeded` when either half refuses, so a caller that
 * must not invent a verdict can tell "did not match" from "could not be
 * run". `matchBounded` is the caller that may.
 */
export function matchStrict(pattern: string, input: string): boolean {
  if (input.length > MAX_MATCH_INPUT) {
    throw new MatchBudgetExceeded(
      pattern,
      `input is ${String(input.length)} characters, over the ${String(MAX_MATCH_INPUT)} cap`,
    );
  }
  let compiled: RegExp;
  try {
    assertSafeRegex(pattern);
    compiled = new RegExp(pattern);
  } catch (error) {
    throw new MatchBudgetExceeded(pattern, error instanceof Error ? error.message : String(error));
  }
  return compiled.test(input);
}

/**
 * The registration policy over that bound: either half refused, or the
 * pattern would not compile, and the candidate passes. See the header for
 * why that direction is the safe one here, the unsafe one in
 * `domainMatches`, and the wrong one for grading.
 *
 * **Byte-identical to Task 3's version**, which had `.test(input)` inside
 * its own `try`. `matchStrict` now runs it outside the compile's `catch`,
 * but the whole call still sits inside *this* `try` — so even a throw out
 * of `RegExp.prototype.test` (which cannot happen for a string argument)
 * lands on the same `return true`. Every refusal that passed the candidate
 * before still passes them, which is what `bounded.test.ts`'s last case
 * pins.
 */
export function matchBounded(pattern: string, input: string): boolean {
  try {
    return matchStrict(pattern, input);
  } catch {
    return true;
  }
}
