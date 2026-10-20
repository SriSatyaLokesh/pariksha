// What a candidate is allowed to be told about their own result (#75,
// P6.11) — `AC-16`, and the second half of `S-10`.
//
// **The gate is assembled on the server, not filtered in the browser.**
// `AC-16` ("results show to candidates exactly as the release setting
// says, and never before it") is a property of what the response
// *contains*: `score_only` carries no `sections` key at all,
// `score_and_sections` carries no `review` key, and `never` and an
// `on_date` that has not arrived carry nothing but the receipt. A browser
// that renders less than it was given is a UI bug; a browser given more
// than it should have is the vulnerability `SECURITY.md` names ("Any way
// to read or change them from a candidate session **is** a
// vulnerability"). So the payload is **built up by level**, never built
// whole and then pruned — Review Focus 5, and the same reasoning that made
// `forCandidate` an allowlist.
//
// Two rulings live here.
//
// 1. **`full_review` degrades to `score_and_sections` while the candidate
//    has an attempt left, and opens on the last.** `T-22` permits
//    `when: "on_submit"` with `show: "full_review"` and `T-14` permits
//    `attempts_allowed > 1`; together they hand a candidate every correct
//    answer and every explanation before their retake.
//    `docs/test-format.md` says `full_review` is for "after the test has
//    closed for everyone", which is the intent but is advice to an
//    organiser rather than a rule anything enforces. Degrading at runtime
//    serves the practice-test case (one attempt, full review immediately)
//    and the retake case (several attempts, review after the last) without
//    forbidding either at publish. The downgrade happens **before** the
//    build, so a `review` array is never constructed and then dropped.
//
// 2. **This attempt's score, not the counted one.** `T-14`'s
//    `counted_attempt` (`highest`, `latest`, `average`) is a results
//    concept and `docs/ROADMAP.md` gives results to Phase 8. Reading every
//    prior attempt to compute a counted figure would add a subrequest to a
//    route that needs none and would tell a candidate mid-series about
//    their earlier attempts. **This disagrees with the organiser's results
//    CSV whenever `counted_attempt` is `highest` or `average`**, and Phase
//    8 inherits that reconciliation: its results view and its CSV must
//    show the counted figure beside the per-attempt one, or say which is
//    which. Recorded here so it is not rediscovered as a bug report.

import type {
  AttemptScore,
  Question,
  ReleaseShow,
  ResponseValue,
  TestRelease,
} from "@pariksha/core";

/**
 * One attempt's result, as the candidate is allowed to see it.
 *
 * `show` is the level **actually served**, which is not always the level
 * the organiser asked for — see ruling 1. The browser renders by this
 * field and never by the test's setting, which it is never told.
 */
export interface ReleasedResult {
  show: ReleaseShow;
  total: number;
  max: number;
  percent: number;
  /** `null` when the test sets no pass mark — not `false`. */
  passed: boolean | null;
  /** Question ids awaiting a human: a manual type with no award yet, and
   *  a question whose grading the regex bound refused (#129). */
  pending: string[];
  sections?: { sectionId: string; title: string; points: number; max: number }[];
  review?: {
    questionId: string;
    yourAnswer: ResponseValue | null;
    correct: unknown;
    explanation: string | null;
    points: number;
  }[];
}

/**
 * The answer key, by type — the mirror of `forCandidate`'s allowlist and
 * written the same way, as a `switch` with no `default`. A thirteenth
 * question type is then a compile error here as well as there, rather
 * than a key silently withheld from a full review (a candidate told their
 * answer was wrong and not told what was right) or silently leaked into a
 * degraded one.
 *
 * `ordering` has no `key` field: `items` as authored **is** the correct
 * order (`docs/question-format.md`, and `gradeStructured` says the same).
 * The two manual types have no key at all — a rubric is a marking guide
 * for a human, not an answer, and `S-10` keeps it out of a candidate's
 * hands even at `full_review`.
 */
function answerKeyOf(q: Question): unknown {
  switch (q.type) {
    case "single":
    case "multiple":
    case "select_k":
    case "true_false":
    case "assertion_reason":
    case "matching":
    case "multi_matching":
    case "numeric":
      return q.key;
    case "ordering":
      return [...q.items];
    case "fill_blank":
      return q.blanks.map((blank) => ({ id: blank.id, accepted: [...blank.accepted] }));
    case "short_answer":
    case "long_answer":
      return null;
  }
}

/**
 * The level this attempt is actually served at, or `null` for "not yet,
 * or never" — the whole gate decision, in one function, so the callers
 * that need to know *whether* a review will be built (and therefore
 * whether the question bank has to be read at all) cannot drift from the
 * function that builds it.
 */
export function servedShow(
  release: TestRelease | undefined,
  attemptsRemaining: number,
  now: number,
): ReleaseShow | null {
  // No `release` block at all is `never`: a result is disclosure, and the
  // default for disclosure is off. `docs/test-format.md` gives `when` no
  // default, so there is no organiser choice to honour here.
  const when = release?.when ?? "never";
  if (when === "never") return null;
  if (when === "on_date") {
    // An absent or unparseable `at` is an organiser's mistake, and the
    // safe reading of it is "not yet" — `Number.isNaN` rather than a
    // comparison, because every comparison against NaN is false and
    // `now < NaN` would release immediately.
    const at = release?.at === undefined ? Number.NaN : Date.parse(release.at);
    if (Number.isNaN(at) || now < at) return null;
  }
  const asked: ReleaseShow = release?.show ?? "score_only";
  // Ruling 1, decided here rather than during the build, so a `review`
  // array is never constructed and then dropped.
  return asked === "full_review" && attemptsRemaining > 0 ? "score_and_sections" : asked;
}

/**
 * The gate.
 *
 * `null` means "not yet, or never" — the finish page then shows the
 * receipt and nothing else, which is a complete answer and not an error.
 *
 * `sectionTitles` is the one argument the plan's signature did not carry:
 * `AttemptScore.sections` names section ids and a candidate reads titles,
 * and the titles live on the pinned paper the caller already holds. A
 * section the map does not name falls back to its id rather than to an
 * empty heading.
 */
export function releasedResult(
  release: TestRelease | undefined,
  score: AttemptScore,
  questions: readonly Question[],
  responses: Record<string, ResponseValue | null>,
  now: number,
  attemptsRemaining: number,
  sectionTitles: Readonly<Record<string, string>> = {},
): ReleasedResult | null {
  const show = servedShow(release, attemptsRemaining, now);
  if (show === null) return null;

  const base: ReleasedResult = {
    show,
    total: score.total,
    max: score.max,
    percent: score.percent,
    passed: score.passed,
    pending: [...score.pending],
  };
  if (show === "score_only") return base;

  const sections = score.sections.map((section) => ({
    sectionId: section.sectionId,
    title: sectionTitles[section.sectionId] ?? section.sectionId,
    points: section.points,
    max: section.max,
  }));
  if (show === "score_and_sections") return { ...base, sections };

  return {
    ...base,
    sections,
    review: questions.map((q) => ({
      questionId: q.id,
      yourAnswer: responses[q.id] ?? null,
      correct: answerKeyOf(q),
      explanation: q.explanation ?? null,
      points: score.perQuestion[q.id]?.points ?? 0,
    })),
  };
}
