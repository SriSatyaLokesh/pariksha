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
 * Rejects an author-supplied regex pattern before it is ever compiled or
 * run against candidate input. Grading runs this pattern against every
 * attempt that touches the question, so a catastrophically backtracking
 * pattern would hang the grading worker for all of them.
 *
 * This is a conservative heuristic for ONE well-known shape, not a general
 * decision procedure — detecting catastrophic backtracking in general is
 * undecidable. It catches:
 *   - a group quantified with an unbounded repetition (`*`, `+`, `{n,}`)
 *     whose own contents also contain an unbounded repetition — the
 *     `(a+)+`, `(a*)*`, `(a+)*` nested-quantifier shape that produces
 *     exponential backtracking. The check is textual and recursive-by-
 *     substring: it also catches multi-level nesting such as `((a+)+)+`.
 *
 * It does NOT catch every pattern that can backtrack catastrophically —
 * notably:
 *   - overlapping-alternation blowups with no quantifier characters at all,
 *     e.g. `(a|a)+$` or `(a|ab|b)+$`;
 *   - danger spread across several non-nested groups that each look safe
 *     alone but compose badly (e.g. `a*a*a*a*b` without any grouping);
 *   - patterns using lookahead/lookbehind to manufacture backtracking.
 * Those shapes are out of scope for this heuristic.
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
