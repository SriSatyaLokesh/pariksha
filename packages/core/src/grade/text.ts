// Text-family graders: fill_blank and numeric. Both reduce to a `parts`
// count and hand it to `applyMode` (grade/result.ts) — no mode arithmetic
// or rounding lives here.
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import type { Blank, FillBlankQuestion, NumericKey, NumericQuestion, ResponseValue } from "../types.js";
import { applyMode, resolveScoring } from "./result.js";
import type { GradeResult, ScoringDefaults } from "./result.js";

export type TextQuestion = FillBlankQuestion | NumericQuestion;

/** Longest regex pattern an author may supply for a `fill_blank` blank. */
export const MAX_REGEX_LENGTH = 200;

/**
 * Longest candidate value matched against a `regex` blank. This is the
 * defense-in-depth backstop, not the primary defense — `assertSafeRegex`
 * (see below) only admits a subset of patterns that is safe by
 * construction, but a subset that is "safe by construction" is only as
 * good as the construction: if the grammar check has a bug, or someone
 * changes it later and gets it wrong, the input cap is what actually
 * bounds the damage, because backtracking cost (whether exponential or
 * merely polynomial) grows with *input* length. The round-1 fix used 300
 * on the premise that it wouldn't matter once the pattern itself was
 * provably safe; `(a?a?)+` needed only 25 characters to take over a
 * minute, which proved the cap has to do real work on its own. 100
 * characters is still ample for a fill-in-the-blank answer — a word, a
 * number, a short phrase — while keeping a cap small enough that even an
 * undiscovered polynomial-blowup pattern finishes in well under a second.
 * `short_answer` (500) and `long_answer` (5000) are separate question
 * types that never take this regex path. This is the only bound available
 * here: `packages/core` performs no I/O and starts no timers, so a
 * wall-clock execution deadline belongs at the API layer, not in this pure
 * function.
 */
export const MAX_BLANK_INPUT_LENGTH = 100;

/**
 * Rejects an author-supplied regex pattern before it is ever compiled or
 * run against candidate input. Grading runs this pattern against every
 * attempt that touches the question, so a catastrophically backtracking
 * pattern would hang the grading worker for all of them.
 *
 * Two rounds of "reject known-dangerous shapes" were each bypassed within
 * minutes by a shape the list didn't name (`(a|a)+` after the first round;
 * `((a|a))+`, `(a?a?)+` and `a*a*a*a*b` after the second). That is the
 * nature of a blacklist against an undecidable problem: the space of
 * dangerous constructions is unbounded, so enumerating them always loses.
 * This function is now a **whitelist**: it does not ask "is this pattern
 * dangerous?", it asks "is this pattern inside a permitted safe subset?"
 * and rejects everything else, whether or not the rejected pattern would
 * actually have been dangerous.
 *
 * The permitted subset, precisely:
 *   - No backreferences (`\1`, `\k<name>`) anywhere — banned outright.
 *   - No lookahead/lookbehind (`(?=`, `(?!`, `(?<=`, `(?<!`) anywhere —
 *     banned outright.
 *   - A parenthesized group quantified with an **unbounded** repetition
 *     (`*`, `+`, an open-ended `{n,}`) must not contain — at ANY nesting
 *     depth inside it — another quantifier of any kind (including `?` and
 *     a bounded `{m,n}`) or an alternation (`|`). A group quantified with a
 *     **bounded** repetition (`{m,n}` with an explicit upper bound, or no
 *     quantifier at all) is unrestricted inside: the work it can do is
 *     capped by construction, so `(cat|dog){1,5}` is fine but
 *     `(cat|dog)+` and `(cat|dog)*` are not.
 *   - No two unbounded-quantified atoms may sit adjacent to each other at
 *     the top level of the pattern with nothing between them (the
 *     `a*a*a*a*b` polynomial-blowup shape) — a conservative check: two
 *     unbounded quantifiers back to back is refused even where they might
 *     not actually interact badly.
 *   - The pattern must not exceed `MAX_REGEX_LENGTH`.
 *
 * Patterns this still allows: `\d{1,5}`, `[a-z]+`, `(abc)+`, `(\d\d)+`,
 * `(cat|dog){1,5}`, `cat|dog`, `^(yes|no)$`.
 *
 * An author who cannot express their accepted answer inside this subset —
 * typically because they wanted alternation inside an unbounded repeat —
 * should bound the repeat (`{1,5}` instead of `+`) or list the accepted
 * forms in `accepted` instead: `accepted` already holds a list of whole
 * answers for exactly this reason, and every rejection message says so.
 *
 * This is not a claim that every rejected pattern is actually dangerous
 * (`(cat|dog)+` is perfectly safe and is refused anyway), and it is not a
 * claim that every accepted pattern is provably safe in general — a
 * subset this size is a pragmatic line, not a proof. `MAX_BLANK_INPUT_LENGTH`
 * exists specifically because a subset this size can still be wrong.
 */
export function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new Error(`unsafe regex: pattern is too long (max ${MAX_REGEX_LENGTH} characters)`);
  }
  if (hasBackreference(pattern)) {
    throw new Error(
      "unsafe regex: backreferences (e.g. \\1, \\k<name>) are not supported — " +
        "list the alternative forms in `accepted` instead",
    );
  }
  if (hasLookaround(pattern)) {
    throw new Error(
      "unsafe regex: lookahead/lookbehind ((?=...), (?!...), (?<=...), (?<!...)) are not supported — " +
        "express the condition directly in the pattern, or list the alternative forms in `accepted` instead",
    );
  }
  for (const group of findParenGroups(pattern)) {
    const outer = quantifierAt(pattern, group.end + 1);
    if (outer?.unbounded === true) {
      const inner = pattern.slice(group.start + 1, group.end);
      if (hasQuantifierOrAlternation(inner)) {
        throw new Error(
          "unsafe regex: a group with an unbounded repeat (*, +, {n,}) contains another " +
            "quantifier or an alternation at some nesting depth inside it (e.g. (a+)+, (a|a)+, " +
            "(a?a?)+) — bound the repeat instead (e.g. {1,5}), or list the alternative forms " +
            "in `accepted` instead",
        );
      }
    }
  }
  if (hasAdjacentUnboundedQuantifiers(pattern)) {
    throw new Error(
      "unsafe regex: two unbounded repeats (*, +, {n,}) sit next to each other with nothing " +
        "required between them (e.g. a*a*b) — this can take polynomial time to fail a match; " +
        "require a literal between them, bound one of the repeats instead (e.g. {1,5}), or " +
        "list the alternative forms in `accepted` instead",
    );
  }
}

/** Whether `pattern` contains a backreference: `\1`-`\9` or `\k<name>`. */
function hasBackreference(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      const next = pattern[i + 1];
      if (next !== undefined && next >= "1" && next <= "9") return true;
      if (next === "k") return true;
      i++;
    }
  }
  return false;
}

/** Whether `pattern` contains a lookahead or lookbehind group. */
function hasLookaround(pattern: string): boolean {
  return /\(\?=|\(\?!|\(\?<=|\(\?<!/.test(pattern);
}

/** A balanced, unescaped, outside-character-class pair of parentheses. */
interface ParenGroup {
  start: number;
  end: number;
}

function findParenGroups(pattern: string): ParenGroup[] {
  const groups: ParenGroup[] = [];
  const stack: number[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "(") {
      stack.push(i);
    } else if (c === ")") {
      const start = stack.pop();
      if (start !== undefined) groups.push({ start, end: i });
    }
  }
  return groups;
}

/**
 * Whether a quantifier (`*`, `+`, `?`, or a valid `{m,n}`) or an
 * alternation (`|`) appears anywhere in `segment`, outside character
 * classes and escapes — deliberately NOT depth-aware with respect to
 * nested parentheses, so a quantifier or `|` buried inside a deeper nested
 * group (e.g. `((a|a))+`, `(x(a|a))+`) is still found: the permitted
 * subset forbids these at ANY nesting depth inside an unbounded-quantified
 * group, not just immediately inside it.
 */
function hasQuantifierOrAlternation(segment: string): boolean {
  let inClass = false;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
    } else if (c === "*" || c === "+" || c === "?" || c === "|") {
      return true;
    } else if (c === "{" && quantifierAt(segment, i) !== null) {
      return true;
    }
  }
  return false;
}

/**
 * Whether two unbounded-quantified atoms sit directly adjacent to each
 * other at the top level of `pattern`, with nothing between them —
 * the `a*a*a*a*b` shape. Groups are treated as opaque atoms here (their
 * own interiors are validated separately, above); `|`, `^` and `$` break
 * the adjacency chain, since they mean the next atom isn't actually
 * immediately after the previous one in the same required sequence.
 */
function hasAdjacentUnboundedQuantifiers(pattern: string): boolean {
  let i = 0;
  let prevUnbounded = false;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "|" || c === "^" || c === "$") {
      i++;
      prevUnbounded = false;
      continue;
    }
    let atomEnd: number;
    if (c === "\\") {
      atomEnd = Math.min(i + 2, pattern.length);
    } else if (c === "[") {
      let j = i + 1;
      while (j < pattern.length && pattern[j] !== "]") {
        if (pattern[j] === "\\") j++;
        j++;
      }
      atomEnd = Math.min(j + 1, pattern.length);
    } else if (c === "(") {
      let depth = 1;
      let j = i + 1;
      while (j < pattern.length && depth > 0) {
        if (pattern[j] === "\\") {
          j += 2;
          continue;
        }
        if (pattern[j] === "(") depth++;
        else if (pattern[j] === ")") depth--;
        j++;
      }
      atomEnd = j;
    } else {
      atomEnd = i + 1;
    }
    const q = quantifierAt(pattern, atomEnd);
    const isUnbounded = q?.unbounded === true;
    if (isUnbounded && prevUnbounded) return true;
    prevUnbounded = isUnbounded;
    i = q ? atomEnd + q.length : atomEnd;
  }
  return false;
}

/** The quantifier (if any) starting at index `j`: `*`, `+`, `?` or `{m,n}`. */
function quantifierAt(pattern: string, j: number): { unbounded: boolean; length: number } | null {
  const c = pattern[j];
  if (c === "*" || c === "+") return { unbounded: true, length: 1 };
  if (c === "?") return { unbounded: false, length: 1 };
  if (c === "{") {
    const m = /^\{\d*(,(\d*))?\}/.exec(pattern.slice(j));
    if (m) {
      const hasComma = m[1] !== undefined;
      const upperBound = m[2];
      return { unbounded: hasComma && (upperBound === undefined || upperBound === ""), length: m[0].length };
    }
  }
  return null;
}

/**
 * Whether `given` matches one of `blank.accepted`, under `blank.match`
 * (default `case_insensitive`). Both sides are normalised to NFC and
 * trimmed before comparing: text can arrive decomposed from one keyboard
 * and composed from another, and NFC is what makes those compare equal.
 */
export function matchBlank(given: string, blank: Blank): boolean {
  const candidate = given.normalize("NFC").trim();
  const mode = blank.match ?? "case_insensitive";
  return blank.accepted.some((raw) => {
    const accepted = raw.normalize("NFC").trim();
    if (mode === "exact") {
      return candidate === accepted;
    }
    if (mode === "case_insensitive") {
      // An explicit locale, never the host locale: a Turkish-locale host
      // would otherwise map "I" to "ı" and mark a correct answer wrong.
      // `toLowerCase()` takes no locale argument in the DOM/ES lib types
      // (TS rejects `toLowerCase("en-US")`); `toLocaleLowerCase("en-US")`
      // is the actual API for pinning the locale, so that is used here.
      return candidate.toLocaleLowerCase("en-US") === accepted.toLocaleLowerCase("en-US");
    }
    // mode === "regex": author-supplied pattern. Validate before compiling
    // (defense in depth — Task 10's import validator also runs this check,
    // but grading must never trust that every stored question passed it).
    // An over-length candidate is refused rather than matched — never
    // thrown — so a candidate pasting an essay into a blank scores as a
    // non-match instead of breaking grading for everyone else's attempt.
    if (candidate.length > MAX_BLANK_INPUT_LENGTH) return false;
    assertSafeRegex(accepted);
    const re = new RegExp(`^(?:${accepted})$`, "u");
    return re.test(candidate);
  });
}

/**
 * Whether `given` is within the key's tolerance of `key.value`. For
 * `tolerance_type: "percent"` the allowance is `|key.value| * tolerance /
 * 100` — computed by multiplication, never by dividing by `key.value`, so
 * a key value of 0 yields an allowance of 0 (only an exact 0 passes)
 * instead of a `NaN` that would silently score a correct answer as wrong.
 */
export function withinTolerance(given: number, key: NumericKey): boolean {
  const tolerance = key.tolerance ?? 0;
  const toleranceType = key.tolerance_type ?? "absolute";
  const allowance = toleranceType === "percent" ? (Math.abs(key.value) * tolerance) / 100 : tolerance;
  return Math.abs(given - key.value) <= allowance;
}

function gradeNumeric(q: NumericQuestion, r: ResponseValue | null, scoring: ScoringDefaults): GradeResult {
  const { mode, points, negativeFraction } = resolveScoring(q, scoring);
  const answered = r !== null && r.kind === "number";
  const correct = answered && r.kind === "number" && withinTolerance(r.value, q.key) ? 1 : 0;
  return applyMode({
    mode,
    points,
    negativeFraction,
    parts: { correct, wrong: answered ? 1 - correct : 0, total: 1 },
    answered,
  });
}

function gradeFillBlank(q: FillBlankQuestion, r: ResponseValue | null, scoring: ScoringDefaults): GradeResult {
  const { mode, points, negativeFraction } = resolveScoring(q, scoring);
  const answered = r !== null && r.kind === "blanks";
  const values = answered && r.kind === "blanks" ? r.values : {};
  const total = q.blanks.length;

  // A blank the candidate left empty is unattempted, not a wrong answer —
  // it scores as not-correct without incurring a negative-mode penalty,
  // same as the question-level "blank loses nothing" rule, applied per
  // part. Only a value that was actually typed and didn't match counts
  // as wrong.
  let correct = 0;
  let wrong = 0;
  if (answered) {
    for (const blank of q.blanks) {
      const value = values[blank.id];
      if (value === undefined || value.trim() === "") continue;
      if (matchBlank(value, blank)) correct++;
      else wrong++;
    }
  }

  return applyMode({ mode, points, negativeFraction, parts: { correct, wrong, total }, answered });
}

export function gradeText(q: TextQuestion, r: ResponseValue | null, d: ScoringDefaults): GradeResult {
  return q.type === "numeric" ? gradeNumeric(q, r, d) : gradeFillBlank(q, r, d);
}
