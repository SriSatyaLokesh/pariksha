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
 * Longest candidate value matched against a `regex` blank. Backtracking
 * cost in a pathological pattern grows exponentially with *input* length,
 * so capping the input bounds the damage regardless of which pattern
 * shapes `assertSafeRegex`'s heuristic fails to catch (see its own doc
 * comment). A fill-in-the-blank answer is a word, a number or a short
 * phrase — the schema caps a full `short_answer` at 500 characters and a
 * `long_answer` at 5000, and a single blank inside a sentence template is
 * shorter than either — so 300 is generous headroom for any real answer
 * while keeping worst-case backtracking cost bounded in-process. This is
 * the only bound available here: `packages/core` performs no I/O and
 * starts no timers, so a wall-clock execution deadline belongs at the API
 * layer, not in this pure function.
 */
export const MAX_BLANK_INPUT_LENGTH = 300;

/**
 * Rejects an author-supplied regex pattern before it is ever compiled or
 * run against candidate input. Grading runs this pattern against every
 * attempt that touches the question, so a catastrophically backtracking
 * pattern would hang the grading worker for all of them.
 *
 * This is a conservative heuristic for known dangerous shapes, not a
 * general decision procedure — detecting catastrophic backtracking in
 * general is undecidable. It catches:
 *   - a group quantified with an unbounded repetition (`*`, `+`, `{n,}`)
 *     whose own contents also contain an unbounded repetition — the
 *     `(a+)+`, `(a*)*`, `(a+)*` nested-quantifier shape that produces
 *     exponential backtracking. The check is textual and recursive-by-
 *     substring: it also catches multi-level nesting such as `((a+)+)+`.
 *   - a group quantified with an unbounded repetition whose own contents
 *     contain a top-level `|` — the `(a|a)+`, `(a|ab|b)+` overlapping-
 *     alternation shape, which backtracks exponentially even with no
 *     quantifier character inside the group at all. No attempt is made to
 *     decide whether the alternatives actually overlap (that is at least
 *     as hard as detecting backtracking in general): a safe pattern like
 *     `(cat|dog)+` is rejected too. An author who needs alternation inside
 *     a repeat can bound the repeat (`(cat|dog){1,5}`) or list the forms
 *     in `accepted` instead — `accepted` already holds a list of whole
 *     answers for exactly this reason.
 *
 * It does NOT catch every pattern that can backtrack catastrophically —
 * notably:
 *   - danger spread across several non-nested groups that each look safe
 *     alone but compose badly (e.g. `a*a*a*a*b` without any grouping);
 *   - backreference blowups, e.g. `(a+)\1+`;
 *   - patterns using lookahead/lookbehind to manufacture backtracking.
 * Those shapes are out of scope for this heuristic; `MAX_BLANK_INPUT_LENGTH`
 * is the defense-in-depth backstop for whatever this check misses.
 */
export function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new Error(`unsafe regex: pattern is too long (max ${MAX_REGEX_LENGTH} characters)`);
  }
  for (const group of findParenGroups(pattern)) {
    const outer = quantifierAt(pattern, group.end + 1);
    if (outer?.unbounded === true) {
      const inner = pattern.slice(group.start + 1, group.end);
      if (hasUnboundedQuantifier(inner)) {
        throw new Error(
          "unsafe regex: a quantified group contains an unbounded quantifier " +
            "(nested unbounded quantifiers can cause catastrophic backtracking)",
        );
      }
      if (hasTopLevelAlternation(inner)) {
        throw new Error(
          "unsafe regex: a quantified group contains a top-level alternation, e.g. (a|a)+ " +
            "(overlapping alternatives can also cause catastrophic backtracking) — " +
            "bound the repeat (e.g. {1,5}) or list the alternative forms in `accepted` instead",
        );
      }
    }
  }
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

/** Whether `*`, `+` or an open-ended `{n,}` appears anywhere outside a character class. */
function hasUnboundedQuantifier(segment: string): boolean {
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
    } else if (c === "*" || c === "+") {
      return true;
    } else if (c === "{") {
      const q = quantifierAt(segment, i);
      if (q?.unbounded === true) return true;
    }
  }
  return false;
}

/**
 * Whether `|` appears at depth 0 of `segment` (outside a character class
 * and outside any nested parenthesized group within `segment`) — i.e. the
 * group this segment came from has a top-level alternation. A `|` inside a
 * deeper nested group doesn't count here: that nested group is itself
 * walked by `findParenGroups` and checked on its own terms.
 */
function hasTopLevelAlternation(segment: string): boolean {
  let depth = 0;
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
    } else if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (c === "|" && depth === 0) {
      return true;
    }
  }
  return false;
}

/** The quantifier (if any) starting at index `j`: `*`, `+`, `?` or `{m,n}`. */
function quantifierAt(pattern: string, j: number): { unbounded: boolean } | null {
  const c = pattern[j];
  if (c === "*" || c === "+") return { unbounded: true };
  if (c === "?") return { unbounded: false };
  if (c === "{") {
    const m = /^\{\d*(,(\d*))?\}/.exec(pattern.slice(j));
    if (m) {
      const hasComma = m[1] !== undefined;
      const upperBound = m[2];
      return { unbounded: hasComma && (upperBound === undefined || upperBound === "") };
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
