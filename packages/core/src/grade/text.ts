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
 * Three rounds got here. Round 1 ("reject known-dangerous shapes") was
 * bypassed by `(a|a)+`. Round 2 replaced it with a whitelist — "no
 * quantifier or alternation inside an unbounded-quantified group, no two
 * adjacent unbounded quantifiers" — which is the right *rule*, but it was
 * still two independent single-pass scans over the raw string, each with
 * its own idea of where it applied: the containment scan only fired
 * directly under a group with its own unbounded quantifier, and the
 * adjacency scan ran exactly once, over the whole pattern, treating every
 * group as one opaque atom. `(a*a*a*a*b)` — the round-2-safe shape wrapped
 * in one extra, unquantified pair of parentheses — fell through the gap
 * between them: the containment scan didn't apply (the wrapping group has
 * no quantifier at all) and the adjacency scan never looked inside a
 * group. Same underlying mistake as round 1, in a different rule: a check
 * that only reaches the nesting depth it was written to reach.
 *
 * So the structure changed, not just the rule list. The pattern is parsed
 * once into its nesting tree — each group's interior, and each `|`-
 * separated branch within it, recursively — and then walked. At *every*
 * node of that walk (the top level, and the interior of every group, at
 * every depth, quantified or not), two predicates are evaluated:
 *
 *   1. No two atoms adjacent to each other *at that level* both carry an
 *      unbounded quantifier (the `a*a*a*a*b` polynomial-blowup shape).
 *      This runs unconditionally at every level, including inside a
 *      group that itself has no quantifier, or a bounded one — so
 *      `(a*a*a*b)` and `(a*a*a*b){1,2}` are both rejected on their own
 *      interior, regardless of what quantifies the wrapper.
 *   2. If the group enclosing that node carries an **unbounded**
 *      quantifier (`*`, `+`, an open-ended `{n,}`), nothing anywhere
 *      inside it — at any depth, through any number of nested groups —
 *      may itself carry a quantifier of any kind (including a bounded one
 *      like `?` or `{m,n}`) or an alternation (`|`). A **bounded** outer
 *      quantifier (`{m,n}` with an explicit upper bound, or none at all)
 *      leaves the interior unrestricted: bounded repetition caps the work
 *      by construction, which is what keeps `(cat|dog){1,5}` usable.
 *
 * Because both predicates are evaluated at every node of the same
 * recursive walk — not as two scans each hoping to reach far enough — a
 * new rule added later inherits the recursion instead of needing to
 * remember it, and a pattern can't hide a rule's blind spot behind one
 * more pair of parentheses.
 *
 * Round 4 found two narrower bugs, unrelated to whether the recursive walk
 * reaches every nesting depth (it does — that is what round 4 set out to
 * attack, and found no backtracking bypass): this function judged whether
 * a pattern was *safe* without ever checking whether it was *valid*, so an
 * author's typo (`(unclosed`, `[z-a]`, `\p{Nope}`, `*leading`) sailed
 * through every check below — none of which parse regex grammar, only
 * judge the grammar they're given — and then threw a `SyntaxError` out of
 * `matchBlank` on every attempt touching the question; and the atom
 * scanner treated `\p{L}` as `\p` plus a separate `{L}`, so three of them
 * in a row didn't read as three adjacent unbounded quantifiers the way
 * `a*a*a*` does. Both are fixed (see `assertValidRegexSyntax` and
 * `parseAtom`'s `\p`/`\P` handling) — the second is why `\p{...}` and
 * `\P{...}` are each walked as one atom, the same way `\d` already was.
 *
 * Outright bans, checked separately (their own blind spot doesn't exist:
 * they scan the whole raw pattern unconditionally, with no depth-based
 * gating to bypass):
 *   - The pattern must be valid regex syntax at all (checked by actually
 *     compiling it — see `assertValidRegexSyntax`).
 *   - No backreferences (`\1`, `\k<name>`) anywhere.
 *   - No lookahead/lookbehind (`(?=`, `(?!`, `(?<=`, `(?<!`) anywhere. An
 *     ordinary named capture group (`(?<name>...)`) is not a lookbehind
 *     and is not banned.
 *   - The pattern must not exceed `MAX_REGEX_LENGTH`.
 *
 * This is still a whitelist, not a blacklist: it asks "is this pattern
 * inside the permitted subset?", not "is this pattern dangerous?", and
 * rejects everything outside the subset whether or not it would actually
 * have been dangerous (`(cat|dog)+` is perfectly safe and is refused
 * anyway). It is not a claim that every pattern inside the subset is
 * dangerous-pattern-proof in some formal sense — a subset this size is a
 * pragmatic line, not a proof — which is why `MAX_BLANK_INPUT_LENGTH`
 * stays as an independent backstop regardless of how sound this check is
 * believed to be.
 *
 * Patterns this still allows: `\d{1,5}`, `[a-z]+`, `(abc)+`, `(\d\d)+`,
 * `(cat|dog){1,5}`, `cat|dog`, `^(yes|no)$`, `[0-9]{4}-[0-9]{2}`,
 * `\d{3}[- ]?\d{3}[- ]?\d{4}`, `\d+(\.\d+)?`, `(https?://)?example\.com`,
 * `\p{L}+`, `\p{Script=Devanagari}+` — a single quantified Unicode
 * property escape is fine; only adjacent unbounded ones are the danger,
 * and Pariksha's whole premise is tests in scripts like Telugu and
 * Devanagari, so property escapes have to stay usable.
 *
 * An author who cannot express their accepted answer inside this subset —
 * typically because they wanted alternation or adjacent repetition inside
 * an unbounded repeat — should bound the repeat (`{1,5}` instead of `+`),
 * add a required literal between adjacent repeats, or list the accepted
 * forms in `accepted` instead: `accepted` already holds a list of whole
 * answers for exactly this reason, and every rejection message says so.
 */
export function assertSafeRegex(pattern: string): void {
  if (pattern.length > MAX_REGEX_LENGTH) {
    throw new Error(`unsafe regex: pattern is too long (max ${MAX_REGEX_LENGTH} characters)`);
  }
  assertValidRegexSyntax(pattern);
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
  validateAlternation(parseAlternation(pattern, 0).node);
}

/**
 * Rejects a pattern that is not valid regex syntax at all, compiling it
 * exactly the way `matchBlank` will — the same `^(?:…)$` wrapper and `u`
 * flag — so this checks precisely what will run, not a looser
 * approximation of it. This function asks "is this pattern safe?"; safety
 * is meaningless to ask about a pattern that doesn't parse, and without
 * this check an author's typo (`(unclosed`, `[z-a]`, `\p{Nope}`,
 * `*leading`) passed straight through the structural checks below — none
 * of which attempt to validate regex grammar, only to judge the grammar
 * they're given — and then threw a `SyntaxError` out of `matchBlank` on
 * every attempt that touched the question. Catching it here means the
 * author sees the engine's own message at import time, where they can fix
 * it; `matchBlank` also never trusts this check alone (see its own
 * comment) in case a pattern reaches grading without having passed it.
 */
function assertValidRegexSyntax(pattern: string): void {
  try {
    new RegExp(`^(?:${pattern})$`, "u");
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(
      `unsafe regex: pattern is not a valid regular expression (${reason}) — ` +
        "fix the pattern, or list the alternative forms in `accepted` instead",
      { cause: e },
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

/**
 * Whether `pattern` contains a lookahead or lookbehind group.
 *
 * Scanned character by character rather than with a regex over the raw
 * string, because `(`, `?` and `=` inside a character class are literal
 * members of that class, not a lookahead: `[(?=]` matches any one of
 * those three characters and was being rejected as `(?=`. Every other
 * scanner in this file is already `inClass`-aware; this one was not.
 */
function hasLookaround(pattern: string): boolean {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      // An escaped character is never structure, inside a class or out.
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "(" && pattern[i + 1] === "?") {
      const third = pattern[i + 2];
      if (third === "=" || third === "!") return true;
      if (third === "<" && (pattern[i + 3] === "=" || pattern[i + 3] === "!")) return true;
    }
  }
  return false;
}

// --- Recursive regex structure -------------------------------------------
//
// The pattern is parsed once into this shape, then `validateAlternation`
// walks it. Nothing here attempts to be a full regex parser — it only
// needs to find atom boundaries, group boundaries, alternation branches
// and quantifiers accurately enough to evaluate the two safety predicates
// above at every nesting depth.

/** A quantifier attached to an atom: absent, bounded, or unbounded. */
interface Quantifier {
  /** Whether any quantifier at all (even a bounded one) is present. */
  present: boolean;
  /** Whether the quantifier, if present, is unbounded (`*`, `+`, open `{n,}`). */
  unbounded: boolean;
  /** Characters the quantifier itself consumes (0 if absent). */
  length: number;
}

const NO_QUANTIFIER: Quantifier = { present: false, unbounded: false, length: 0 };

/** A single-character, escaped-pair, or character-class atom, with its quantifier. */
interface LiteralAtom {
  kind: "literal";
  quantifier: Quantifier;
}

/** A parenthesized group, with its parsed interior and its own quantifier. */
interface GroupAtom {
  kind: "group";
  body: Alternation;
  quantifier: Quantifier;
}

type Atom = LiteralAtom | GroupAtom;

/** A `|`-free run of atoms: one branch of an alternation (or the only branch, if there is no `|`). */
type Sequence = Atom[];

/** One nesting level's content: one or more `|`-separated branches. */
interface Alternation {
  branches: Sequence[];
}

/**
 * The quantifier (if any) starting at index `j`: `*`, `+`, `?` or a valid
 * `{m,n}` — plus a trailing lazy `?` (`*?`, `+?`, `??`, `{m,n}?`), which is
 * consumed as part of the same quantifier rather than left for the caller
 * to parse as its own atom. Leaving it unconsumed was the bug: `parseAtom`
 * would then read that `?` as a separate literal atom sitting *between*
 * the two real atoms, so two unbounded quantifiers like `a*?a*?b` never
 * looked adjacent to `hasAdjacentUnbounded` even though they are exactly
 * the `a*a*b` polynomial-blowup shape with laziness sprinkled on top.
 */
function quantifierAt(pattern: string, j: number): Quantifier {
  const c = pattern[j];
  let base: Quantifier;
  if (c === "*" || c === "+") {
    base = { present: true, unbounded: true, length: 1 };
  } else if (c === "?") {
    base = { present: true, unbounded: false, length: 1 };
  } else if (c === "{") {
    const m = /^\{\d*(,(\d*))?\}/.exec(pattern.slice(j));
    if (!m) return NO_QUANTIFIER;
    const hasComma = m[1] !== undefined;
    const upperBound = m[2];
    base = { present: true, unbounded: hasComma && (upperBound === undefined || upperBound === ""), length: m[0].length };
  } else {
    return NO_QUANTIFIER;
  }
  if (pattern[j + base.length] === "?") {
    return { ...base, length: base.length + 1 };
  }
  return base;
}

/**
 * Characters to skip right after a group's opening `(` for a non-capturing
 * `(?:` or named `(?<name>` prefix, so the interior parse doesn't mistake
 * the prefix's own characters for atoms. `(?=`, `(?!`, `(?<=`, `(?<!`
 * (lookaround) are already rejected by `hasLookaround` before parsing ever
 * reaches this, so any other `(?` here is one of these two forms.
 */
function groupPrefixLength(pattern: string, i: number): number {
  if (pattern[i] !== "?") return 0;
  if (pattern[i + 1] === ":") return 2;
  if (pattern[i + 1] === "<" && pattern[i + 2] !== "=" && pattern[i + 2] !== "!") {
    let j = i + 2;
    while (j < pattern.length && pattern[j] !== ">") j++;
    return j + 1 - i;
  }
  return 0;
}

/** Parses one atom (literal, escape, character class, or group) starting at index `i`. */
function parseAtom(pattern: string, i: number): { atom: Atom; next: number } {
  const c = pattern[i];
  if (c === "(") {
    let j = i + 1;
    j += groupPrefixLength(pattern, j);
    const { node, end } = parseAlternation(pattern, j);
    const bodyEnd = pattern[end] === ")" ? end + 1 : end;
    const quantifier = quantifierAt(pattern, bodyEnd);
    return { atom: { kind: "group", body: node, quantifier }, next: bodyEnd + quantifier.length };
  }
  let bodyEnd: number;
  if (c === "\\") {
    const next = pattern[i + 1];
    if ((next === "p" || next === "P") && pattern[i + 2] === "{") {
      // A Unicode property escape (\p{L}, \P{Script=Devanagari}) is one
      // atom, four-plus characters longer than a plain \d — without this,
      // three of them in a row (\p{L}*\p{L}*\p{L}*) looked like six
      // separate atoms to the adjacency scan instead of three quantified
      // ones, so the a*a*a* shape wasn't recognised.
      let j = i + 3;
      while (j < pattern.length && pattern[j] !== "}") j++;
      bodyEnd = Math.min(j + 1, pattern.length);
    } else {
      bodyEnd = Math.min(i + 2, pattern.length);
    }
  } else if (c === "[") {
    // A character class is one opaque atom: quantifier/alternation/group
    // characters inside `[...]` are literal members of the class, not
    // structure, so they are never interpreted as such.
    let j = i + 1;
    while (j < pattern.length && pattern[j] !== "]") {
      if (pattern[j] === "\\") j++;
      j++;
    }
    bodyEnd = Math.min(j + 1, pattern.length);
  } else {
    bodyEnd = i + 1;
  }
  const quantifier = quantifierAt(pattern, bodyEnd);
  return { atom: { kind: "literal", quantifier }, next: bodyEnd + quantifier.length };
}

/**
 * Parses a `|`-separated sequence of branches starting at index `start`,
 * stopping at the first unescaped `)` (left for the caller to consume) or
 * at the end of the pattern. Used both for the whole pattern (top level,
 * `start = 0`) and for the interior of every group.
 */
function parseAlternation(pattern: string, start: number): { node: Alternation; end: number } {
  const branches: Sequence[] = [];
  let current: Sequence = [];
  let i = start;
  while (i < pattern.length && pattern[i] !== ")") {
    if (pattern[i] === "|") {
      branches.push(current);
      current = [];
      i++;
      continue;
    }
    const { atom, next } = parseAtom(pattern, i);
    current.push(atom);
    i = next;
  }
  branches.push(current);
  return { node: { branches }, end: i };
}

/**
 * Whether `node` contains a quantifier (of any kind, even bounded) or an
 * alternation anywhere inside it, at any nesting depth — used only when
 * the group enclosing `node` itself carries an unbounded quantifier.
 */
function containsQuantifierOrAlternation(node: Alternation): boolean {
  if (node.branches.length > 1) return true;
  for (const seq of node.branches) {
    for (const atom of seq) {
      if (atom.quantifier.present) return true;
      if (atom.kind === "group" && containsQuantifierOrAlternation(atom.body)) return true;
    }
  }
  return false;
}

/** Whether two atoms adjacent to each other in `seq` both carry an unbounded quantifier. */
function hasAdjacentUnbounded(seq: Sequence): boolean {
  for (let k = 1; k < seq.length; k++) {
    const prev = seq[k - 1];
    const cur = seq[k];
    if (prev !== undefined && cur !== undefined && prev.quantifier.unbounded && cur.quantifier.unbounded) {
      return true;
    }
  }
  return false;
}

/**
 * Walks `node` and every group inside it, at every depth, applying both
 * safety predicates at each level: no adjacent unbounded quantifiers in
 * any branch, and — for a group whose own quantifier is unbounded — no
 * quantifier or alternation anywhere in its interior.
 */
function validateAlternation(node: Alternation): void {
  for (const seq of node.branches) {
    if (hasAdjacentUnbounded(seq)) {
      throw new Error(
        "unsafe regex: two unbounded repeats (*, +, {n,}) sit next to each other with nothing " +
          "required between them (e.g. a*a*b) — this can take polynomial time to fail a match, " +
          "at any nesting depth, even inside an unquantified or bounded group — require a literal " +
          "between them, bound one of the repeats instead (e.g. {1,5}), or list the alternative " +
          "forms in `accepted` instead",
      );
    }
    for (const atom of seq) {
      if (atom.kind !== "group") continue;
      validateAlternation(atom.body);
      if (atom.quantifier.unbounded && containsQuantifierOrAlternation(atom.body)) {
        throw new Error(
          "unsafe regex: a group with an unbounded repeat (*, +, {n,}) contains another " +
            "quantifier or an alternation at some nesting depth inside it (e.g. (a+)+, (a|a)+, " +
            "(a?a?)+, ((a|a))+) — bound the repeat instead (e.g. {1,5}), or list the alternative " +
            "forms in `accepted` instead",
        );
      }
    }
  }
}

/**
 * How many distinct patterns `compilePattern` will remember. Grading runs
 * the same handful of patterns over and over — every candidate, every
 * blank, every attempt — so the cache is nearly always warm after the
 * first attempt, and a bank with more than this many *distinct* regex
 * blanks simply stops adding new entries rather than growing without
 * bound. Nothing is evicted: an uncached pattern still grades correctly,
 * it just pays the parse-and-compile cost it paid before this cache
 * existed. At `MAX_REGEX_LENGTH` (200) per key this ceiling is well under
 * a megabyte of keys plus compiled objects.
 *
 * ponytail: a plain size cap, not an LRU. Swap in eviction only if a real
 * bank is ever found with more than 500 distinct regex blanks *and* the
 * uncached ones measurably matter.
 */
const PATTERN_CACHE_LIMIT = 500;

/** Pattern string -> compiled regex, or null if the pattern is unsafe or invalid. */
const patternCache = new Map<string, RegExp | null>();

/**
 * The compiled form of an author-supplied `regex` pattern, or `null` if it
 * is unsafe or not valid regex syntax.
 *
 * This never throws, regardless of what `assertSafeRegex` does: a pattern
 * can reach grading without having passed it (stored before that check
 * existed, or a future gap in it), and an author's typo must not crash
 * grading for every attempt that touches the question. `assertSafeRegex`
 * at import gives the author the good error message; this is the
 * unconditional guarantee for grading — belt and braces, not either/or.
 *
 * The verdict is memoised by pattern string because both halves of it —
 * the safety parse and the compile — are pure functions of that string,
 * and grading repeats them for every candidate, every blank, every
 * attempt.
 */
function compilePattern(pattern: string): RegExp | null {
  // `null` is a real cached verdict ("rejected"), so ask whether the key
  // is present rather than whether the value is truthy.
  if (patternCache.has(pattern)) return patternCache.get(pattern) ?? null;
  let compiled: RegExp | null;
  try {
    assertSafeRegex(pattern);
    compiled = new RegExp(`^(?:${pattern})$`, "u");
  } catch {
    compiled = null;
  }
  if (patternCache.size < PATTERN_CACHE_LIMIT) patternCache.set(pattern, compiled);
  return compiled;
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
    const re = compilePattern(accepted);
    return re !== null && re.test(candidate);
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
