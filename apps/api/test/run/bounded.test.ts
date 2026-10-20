// The server's regex bound (#129), both policies.
//
// `matchStrict` is the bound itself and says out loud when it refuses;
// `matchBounded` is the registration policy over it — never throws, and a
// refusal passes the candidate, because an author's bad pattern must not
// become a stranger's refusal at the door (Task 3's ruling, and the
// reversal recorded in `run/bounded.ts`'s header).
//
// Grading takes the other policy, and that half is asserted through the
// submit route in `submit.test.ts`: a question whose pattern the bound
// refuses is **pending and flagged**, never a zero the candidate owns.

import { expect, it } from "vitest";
import {
  MatchBudgetExceeded,
  MAX_MATCH_INPUT,
  matchBounded,
  matchStrict,
} from "../../src/run/bounded.js";

it("#129: matchStrict caps input length before it runs the pattern", () => {
  expect(() => matchStrict("^a*$", "a".repeat(MAX_MATCH_INPUT + 1))).toThrow(MatchBudgetExceeded);
  // One character under the cap is an ordinary match, so the throw above
  // is the cap and not the pattern.
  expect(matchStrict("^a*$", "a".repeat(MAX_MATCH_INPUT))).toBe(true);
});

it("#129: matchStrict re-checks the pattern at execution time, not only at authoring time", () => {
  expect(() => matchStrict("(a+)+$", "aaaa")).toThrow(MatchBudgetExceeded);
  expect(() => matchStrict("(a|a)+$", "aaaa")).toThrow(MatchBudgetExceeded);
});

it("#129: an unparseable pattern is refused, not thrown as a SyntaxError", () => {
  expect(() => matchStrict("([a-", "aaaa")).toThrow(MatchBudgetExceeded);
});

it("the refusal names the pattern, because the organiser is the one who can fix it", () => {
  try {
    matchStrict("(a+)+$", "aaaa");
    expect.unreachable("matchStrict did not refuse");
  } catch (error) {
    expect(error).toBeInstanceOf(MatchBudgetExceeded);
    expect((error as MatchBudgetExceeded).pattern).toBe("(a+)+$");
  }
});

it("an ordinary pattern still matches, under both policies", () => {
  expect(matchStrict("^\\d{2}[A-Z]{2}\\d{4}$", "21CS0147")).toBe(true);
  expect(matchBounded("^\\d{2}[A-Z]{2}\\d{4}$", "21CS0147")).toBe(true);
  expect(matchStrict("^\\d{2}[A-Z]{2}\\d{4}$", "nope")).toBe(false);
  expect(matchBounded("^\\d{2}[A-Z]{2}\\d{4}$", "nope")).toBe(false);
});

it("matchBounded never throws, and a refusal passes the candidate", () => {
  expect(matchBounded("(a+)+$", "aaaa")).toBe(true);
  expect(matchBounded("([a-", "aaaa")).toBe(true);
  expect(matchBounded("^a*$", "a".repeat(MAX_MATCH_INPUT + 1))).toBe(true);
});
