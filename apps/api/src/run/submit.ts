// Ending an attempt: the score, the receipt and the release (#75, P6.11).
//
// Three rules shape this module and each has cost a phase somewhere.
//
// 1. **Submission is idempotent, in one statement.** `finishAttempt` is
//    `UPDATE … WHERE submitted_at IS NULL`, and the score rides the same
//    `SET`. So the browser's auto-submit at zero, the timeout
//    materialisation `GET /run/attempt` performs, and a double-click
//    cannot produce two scores or two audit rows — whichever lands first
//    is the attempt's result and the others are reads.
//
// 2. **`deriveState` gates entry only.** Nothing here re-checks the
//    test's window. A candidate who started in time may submit after
//    `closes_at`: the clock a write is judged by is `attempt.deadline_at`
//    plus `late_sync_grace_seconds` and nothing else (`AC-13`, `AC-14`).
//    Submission is not even judged by *that* — an attempt past its
//    deadline is submitted as a `timeout`, not refused, because refusing
//    would leave a candidate who lost their network at the end with no
//    receipt at all.
//
// 3. **One bad question costs one question.** #129: a pattern the regex
//    bound refuses makes that question **pending** and flags the attempt
//    for the organiser; the rest of the paper scores and the candidate
//    gets their receipt. Scoring failures never block answering, which is
//    the PRD's own rule.

import {
  appendAudit,
  countAttemptsForCandidate,
  finishAttempt,
  listResponses,
  workspaceQuestions,
} from "@pariksha/db";
import {
  scoreAttempt,
  type AttemptScore,
  type Question,
  type ResponseValue,
  type ScoringDefaults,
  type TestRelease,
  type TestScoring,
} from "@pariksha/core";
import type { AppDeps } from "../app.js";
import type { AttemptContextVar } from "../middleware/attemptContext.js";
import type { PinnedLayout } from "./attempt.js";
import { TIMING_DEFAULTS, timingOf } from "./clock.js";
import { MatchBudgetExceeded, matchStrict } from "./bounded.js";
import { releasedResult, servedShow, type ReleasedResult } from "./release.js";

/** Which of the three ended the attempt. `limit` is reserved for Phase 7's
 *  proctoring cut-off; nothing mints it yet. */
export type SubmitReason = "manual" | "timeout" | "limit";

/**
 * `C-08`'s finish page, and the only thing a `release.when = "never"` test
 * ever hands a candidate. It carries **no score** — the score, if any, is
 * the separate `released` payload the gate built.
 */
export interface Receipt {
  attemptId: string;
  submittedAt: number;
  answered: number;
  unanswered: number;
  total: number;
  /** "Attempt 2 of 3": this attempt's ordinal among the candidate's own,
   *  and `timing.attempts_allowed`. */
  attemptNo: number;
  attemptsAllowed: number;
}

/** The organiser-facing marker on an attempt whose grading hit a pattern
 *  the bound refused. Also the audit action, prefixed. */
const BLOCKED = "scoring_blocked";

const scoringOf = (settings: unknown): TestScoring =>
  (settings as { scoring?: TestScoring }).scoring ?? {};

/** `scoring.default_mode` / `negative_fraction`, with the engine's own
 *  fallbacks. `resolveScoring` applies a question's override on top. */
const defaultsOf = (scoring: TestScoring): ScoringDefaults => ({
  mode: scoring.default_mode ?? "all_or_nothing",
  negativeFraction: scoring.negative_fraction ?? 0,
});

const releaseOf = (settings: unknown): TestRelease | undefined =>
  (settings as { release?: TestRelease }).release;

/**
 * Whether the bound will run this pattern at all — the pattern half of
 * `matchStrict`, asked with no input.
 *
 * `matchBlank` (packages/core) answers a refused pattern with "did not
 * match", which is right for a pure function with nowhere to report to
 * and wrong as a *verdict*: it scores a candidate zero for a regex
 * somebody else typed. Asking here, where there is an audit log to write
 * to, is what turns that into a pending question and a flag.
 */
function runnable(pattern: string): boolean {
  try {
    matchStrict(pattern, "");
    return true;
  } catch (error) {
    if (error instanceof MatchBudgetExceeded) return false;
    throw error;
  }
}

/** The question ids on this paper whose grading cannot be trusted, each
 *  with the reason an organiser needs. Only `fill_blank` runs an
 *  author-written pattern; a question the bank no longer holds is the
 *  other case, and it is here rather than in `/start`'s stale-version net
 *  because the paper was pinned when it still existed. */
function blockedQuestions(
  layout: PinnedLayout,
  byId: ReadonlyMap<string, Question>,
): { questionId: string; reason: string }[] {
  const blocked: { questionId: string; reason: string }[] = [];
  for (const section of layout.sections) {
    for (const id of section.questionIds) {
      const q = byId.get(id);
      if (q === undefined) {
        // ponytail: its points leave `max` with it, so a deletion
        // mid-window moves one candidate's denominator. The repair is a
        // regrade (Phase 8), not a second copy of the key here — and the
        // audit row is what tells the organiser it happened.
        blocked.push({ questionId: id, reason: "the bank no longer holds this question" });
        continue;
      }
      if (q.type !== "fill_blank") continue;
      for (const blank of q.blanks) {
        if (blank.match !== "regex") continue;
        const refused = blank.accepted.find((pattern) => !runnable(pattern));
        if (refused !== undefined) {
          blocked.push({ questionId: id, reason: `pattern cannot be run safely: ${refused}` });
          break;
        }
      }
    }
  }
  return blocked;
}

/** Section id to the title the candidate reads, off the pinned paper. */
const titlesOf = (layout: PinnedLayout): Record<string, string> =>
  Object.fromEntries(layout.paper.map((section) => [section.id, section.title]));

/** The live documents for this paper's questions, in the order the
 *  candidate saw them — which is the order a review reads in. A question
 *  the bank no longer holds is simply absent; it is also already in
 *  `blockedQuestions`, so it is reported rather than silently missing. */
export function paperOrder(
  layout: PinnedLayout,
  byId: ReadonlyMap<string, Question>,
): Question[] {
  return layout.sections.flatMap((section) =>
    section.questionIds.flatMap((id) => {
      const q = byId.get(id);
      return q === undefined ? [] : [q];
    }),
  );
}

/** The live documents for the questions this paper pinned, keyed by row
 *  id. One read of the workspace's bank, never one read per question — the
 *  same statement `/start` draws the paper from. */
async function liveQuestions(
  deps: AppDeps,
  workspaceId: string,
): Promise<Map<string, Question>> {
  const held = await workspaceQuestions(deps.db, workspaceId);
  return new Map(held.map((one) => [one.id, { ...one.document, id: one.id }]));
}

/** Everything a receipt counts, off the rows the scoring read already
 *  returned — so the counts cost nothing of their own. */
function counts(
  layout: PinnedLayout,
  responses: Record<string, ResponseValue | null>,
): { answered: number; unanswered: number; total: number } {
  const ids = layout.sections.flatMap((section) => section.questionIds);
  const answered = ids.filter((id) => (responses[id] ?? null) !== null).length;
  return { answered, unanswered: ids.length - answered, total: ids.length };
}

/**
 * Submit, score, release.
 *
 * The caller is the route; `reason` is `"manual"` from the candidate's own
 * press and `"timeout"` when the attempt's deadline has already passed,
 * which is also what stamps `submitted_at` at the deadline rather than at
 * `now` — the attempt ended when the clock ran out, not when somebody
 * next looked at it.
 */
export async function submitAttempt(
  deps: AppDeps,
  attempt: AttemptContextVar,
  reason: SubmitReason,
  now: number,
): Promise<{ receipt: Receipt; released: ReleasedResult | null }> {
  const layout = attempt.layout;
  const timing = timingOf(attempt.settings);
  const attemptsAllowed = timing.attempts_allowed ?? TIMING_DEFAULTS.attempts_allowed;

  const rows = await listResponses(deps.db, attempt.workspaceId, attempt.attemptId);
  const responses: Record<string, ResponseValue | null> = {};
  for (const row of rows) responses[row.questionId] = row.value as ResponseValue | null;

  // Every attempt row this candidate has, this one included — so `count`
  // is the ordinal the receipt prints and what is left is what the
  // `full_review` degrade is judged by.
  const attempts = await countAttemptsForCandidate(
    deps.db,
    attempt.workspaceId,
    attempt.candidateId,
    now,
  );
  const attemptNo = Math.max(1, attempts.count);
  const attemptsRemaining = Math.max(0, attemptsAllowed - attemptNo);

  const release = releaseOf(attempt.settings);
  const titles = titlesOf(layout);
  const { answered, unanswered, total } = counts(layout, responses);

  // **The already-submitted path reads nothing more.** A second press, a
  // finish page reloaded, or a candidate returning to a tab the server
  // timed out while they were away: the row the cookie resolved already
  // carries the score and the stamp, so this costs one read in total and
  // writes nothing at all.
  if (attempt.submittedAt !== null) {
    const stored = attempt.score as AttemptScore | null;
    return {
      receipt: {
        attemptId: attempt.attemptId,
        submittedAt: attempt.submittedAt,
        answered,
        unanswered,
        total,
        attemptNo,
        attemptsAllowed,
      },
      released:
        stored === null
          ? null
          : releasedResult(
              release,
              stored,
              // The bank is read **only** when a review is going to be
              // built, which is the one level that needs the key. Every
              // other level, and every un-released test, pays nothing.
              servedShow(release, attemptsRemaining, now) === "full_review"
                ? paperOrder(layout, await liveQuestions(deps, attempt.workspaceId))
                : [],
              responses,
              now,
              attemptsRemaining,
              titles,
            ),
    };
  }

  const byId = await liveQuestions(deps, attempt.workspaceId);
  const blocked = blockedQuestions(layout, byId);
  const blockedIds = new Set(blocked.map((one) => one.questionId));

  const questionsBySection = layout.sections.map((section) => ({
    sectionId: section.sectionId,
    questions: section.questionIds.flatMap((id) => {
      const q = byId.get(id);
      return q === undefined ? [] : [q];
    }),
  }));
  const scoring = scoringOf(attempt.settings);
  const scored = scoreAttempt({
    questionsBySection,
    responses,
    // Phase 8 owns rubric awards; nothing has recorded one yet, so every
    // manual question is pending and that is the whole of `awards`.
    awards: {},
    defaults: defaultsOf(scoring),
    ...(scoring.pass_mark_percent === undefined
      ? {}
      : { passMarkPercent: scoring.pass_mark_percent }),
  });
  // A blocked question joins the manual ones: awaiting a human, not
  // wrong. Deduplicated, because a manual question cannot also be a
  // `fill_blank` but a deleted one can already be neither.
  const score: AttemptScore = {
    ...scored,
    pending: [...new Set([...scored.pending, ...blockedIds])],
  };

  // The deadline, not the moment somebody noticed — see the header.
  const submittedAt = reason === "timeout" ? attempt.deadlineAt : now;
  const { submitted } = await finishAttempt(deps.db, attempt.workspaceId, {
    attemptId: attempt.attemptId,
    submittedAt,
    reason,
    score,
    ...(blocked.length === 0 ? {} : { flag: BLOCKED }),
  });

  // **Only the writer audits.** The loser of the race wrote nothing, so
  // it must not leave a row saying it did — that is what makes "two
  // presses, one audit row" a property of the statement above.
  if (submitted) {
    await appendAudit(deps.db, attempt.workspaceId, {
      actor: "candidate",
      action: "attempt.submitted",
      target: attempt.attemptId,
      detail: { reason, answered, unanswered, total, attemptNo },
      now,
    });
    if (blocked.length > 0) {
      await appendAudit(deps.db, attempt.workspaceId, {
        actor: "candidate",
        action: `attempt.${BLOCKED}`,
        target: attempt.attemptId,
        detail: { questions: blocked },
        now,
      });
    }
  }

  return {
    receipt: {
      attemptId: attempt.attemptId,
      // ponytail: the loser of a same-millisecond race reports its own
      // stamp rather than the winner's, which can differ by the
      // milliseconds between the two reads. The score, the reason and the
      // audit row are all the winner's — only this one display value can
      // drift, and re-reading the row to fix it would cost every
      // submission a subrequest to correct a case nobody can observe.
      submittedAt,
      answered,
      unanswered,
      total,
      attemptNo,
      attemptsAllowed,
    },
    released: releasedResult(
      release,
      score,
      paperOrder(layout, byId),
      responses,
      now,
      attemptsRemaining,
      titles,
    ),
  };
}

/**
 * The released result for an attempt that has already been submitted —
 * `GET /run/attempt/result` and, through `findAttemptByReference`, the
 * emailed-code route (`C-09`).
 *
 * One gate, not two. The finish page and the return visit a week later
 * answer the same bytes because they call the same function; a second
 * copy of the `show` ladder is exactly how a review leaks into a level
 * that must not carry one.
 */
export async function resultFor(
  deps: AppDeps,
  attempt: {
    workspaceId: string;
    candidateId: string;
    attemptId: string;
    layout: PinnedLayout;
    settings: unknown;
    score: unknown;
  },
  now: number,
): Promise<ReleasedResult | null> {
  const stored = attempt.score as AttemptScore | null;
  if (stored === null) return null;

  const release = releaseOf(attempt.settings);
  const timing = timingOf(attempt.settings);
  const attempts = await countAttemptsForCandidate(
    deps.db,
    attempt.workspaceId,
    attempt.candidateId,
    now,
  );
  const attemptsRemaining = Math.max(
    0,
    (timing.attempts_allowed ?? TIMING_DEFAULTS.attempts_allowed) - Math.max(1, attempts.count),
  );
  const show = servedShow(release, attemptsRemaining, now);
  if (show === null) return null;

  // The two reads below are paid **only** at `full_review`, the one level
  // whose payload needs the key and the candidate's own answers. A
  // `score_only` result is the row the caller already holds.
  const [questions, responses] =
    show === "full_review"
      ? await Promise.all([
          liveQuestions(deps, attempt.workspaceId).then((byId) => paperOrder(attempt.layout, byId)),
          listResponses(deps.db, attempt.workspaceId, attempt.attemptId).then((rows) => {
            const map: Record<string, ResponseValue | null> = {};
            for (const row of rows) map[row.questionId] = row.value as ResponseValue | null;
            return map;
          }),
        ])
      : [[] as Question[], {} as Record<string, ResponseValue | null>];

  return releasedResult(
    release,
    stored,
    questions,
    responses,
    now,
    attemptsRemaining,
    titlesOf(attempt.layout),
  );
}
