// The server's regex seam (#129).
//
// `packages/core`'s `validateRegistration` takes its matcher as an argument
// because a bound needs a host a pure leaf package does not have. The
// browser passes nothing and gets `RegExp.test`; the server passes this.
//
// **It returns a boolean and never throws**, which is the whole contract.
// Three parties can be at fault when a pattern does not run, and only one
// of them is the candidate:
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
// An earlier plan had this throw `MatchBudgetExceeded` and the route
// answer 422. Reversed: it punished the candidate for the author's regex,
// and it put a throw on a path where a missed `catch` is a 500.
//
// Task 11 reuses this seam for grading, where the same reasoning holds for
// the same reason.

import { assertSafeRegex, MAX_MATCH_INPUT } from "@pariksha/core";

export { MAX_MATCH_INPUT };

/**
 * Runs `pattern` against `input` under both halves of the bound: the
 * grammar gate (`assertSafeRegex`, which admits only patterns that are
 * safe by construction) and the input cap (which is what actually bounds
 * the damage if the grammar gate ever has a bug, because backtracking cost
 * grows with input length whatever the pattern is).
 *
 * Either bound refused, or the pattern would not compile: `true`. See the
 * header for why that direction is the safe one here and the unsafe one in
 * `domainMatches`.
 */
export function matchBounded(pattern: string, input: string): boolean {
  if (input.length > MAX_MATCH_INPUT) return true;
  try {
    assertSafeRegex(pattern);
    return new RegExp(pattern).test(input);
  } catch {
    return true;
  }
}
