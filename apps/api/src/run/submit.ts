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
// 3. **One bad question costs one question, and a bad engine costs the
//    score, never the receipt.** #129: a pattern the regex bound refuses
//    makes that question **pending** and flags the attempt for the
//    organiser; the rest of the paper scores and the candidate gets their
//    receipt. A pending question is also never *graded* — handing one to
//    the engine scores it wrong, which under `negative` marking takes
//    marks off for somebody else's regex. And when the engine throws for
//    a reason the pre-scan cannot see, the attempt is still stamped and
//    still flagged, with no score at all: scoring failures never block
//    answering *or submitting*, which is the PRD's own rule.

import {
  appendAudit,
  attemptFiguresForCandidate,
  countAttemptsForCandidate,
  finishAttempt,
  listResponses,
  workspaceQuestions,
} from "@pariksha/db";
import {
  type AttemptFigure,
  type AttemptScore,
  type CountedAttempt,
  type Question,
  type ResponseValue,
  type ScoringDefaults,
  type TestBranding,
  type TestRelease,
  type TestScoring,
} from "@pariksha/core";
import type { AppDeps } from "../app.js";
import type { AttemptContextVar } from "../middleware/attemptContext.js";
import { fireWebhooks } from "../webhooks/deliver.js";
import type { PinnedLayout } from "./attempt.js";
import { TIMING_DEFAULTS, timingOf } from "./clock.js";
import { MatchBudgetExceeded, matchStrict } from "./bounded.js";
import { releasedResult, servedShow, type ReleasedResult } from "./release.js";
import { rescoreAttempt } from "./rescore.js";

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
  /** `branding.finish_message`, off the version this attempt is pinned to
   *  — the last thing the organiser gets to say to a candidate, and on a
   *  `release.when: "never"` test the only one. `null` when none was
   *  written. */
  finishMessage: string | null;
}

/** The organiser-facing marker on an attempt whose grading hit a pattern
 *  the bound refused. Also the audit action, prefixed. */
const BLOCKED = "scoring_blocked";

/** Exported for `rescore.ts` (`K5`) — the one other reader of this
 *  attempt's `settings` blob. */
export const scoringOf = (settings: unknown): TestScoring =>
  (settings as { scoring?: TestScoring }).scoring ?? {};

/** `scoring.default_mode` / `negative_fraction`, with the engine's own
 *  fallbacks. `resolveScoring` applies a question's override on top. */
export const defaultsOf = (scoring: TestScoring): ScoringDefaults => ({
  mode: scoring.default_mode ?? "all_or_nothing",
  negativeFraction: scoring.negative_fraction ?? 0,
});

const releaseOf = (settings: unknown): TestRelease | undefined =>
  (settings as { release?: TestRelease }).release;

const brandingOf = (settings: unknown): TestBranding =>
  (settings as { branding?: TestBranding }).branding ?? {};

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
/** Exported for `rescore.ts` (`K5`). */
export function blockedQuestions(
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

/**
 * `K6`/`K7`'s `counted` argument to `releasedResult`, read only when it
 * could actually be used. Mirrors `releasedResult`'s own `countedFieldOf`
 * gate (`attemptsRemaining === 0`, never under `"latest"`) exactly.
 *
 * **This function alone does not keep the read off a discarded result**
 * (`M-1`): `releasedResult`'s own `show === null` gate — `release.when:
 * "never"`, or an `on_date` that has not arrived — sits one level up, in
 * `servedShow`, which this function is never told. Both call sites below
 * check `show === null` before calling this at all, which is what keeps
 * this route from paying `attemptFiguresForCandidate`'s subrequest for a
 * result `releasedResult` is guaranteed to discard (`K9`).
 */
async function countedFor(
  deps: AppDeps,
  workspaceId: string,
  candidateId: string,
  countedAttempt: CountedAttempt | undefined,
  attemptsRemaining: number,
): Promise<{ mode: CountedAttempt; attempts: readonly AttemptFigure[] } | undefined> {
  if (attemptsRemaining > 0 || countedAttempt === undefined || countedAttempt === "latest") {
    return undefined;
  }
  return { mode: countedAttempt, attempts: await attemptFiguresForCandidate(deps.db, workspaceId, candidateId) };
}

/** The live documents for this paper's questions, in the order the
 *  candidate saw them — which is the order a review reads in. A question
 *  the bank no longer holds is simply absent; it is also already in
 *  `blockedQuestions`, so it is reported rather than silently missing. */
function paperOrder(
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
/** Exported for `rescore.ts` (`K5`) and `resultFor`, below. */
export async function liveQuestions(
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
  // `releasedResult`'s own gate, computed once here so neither branch
  // below pays `countedFor`'s read (and `full_review`'s bank read) for a
  // result `releasedResult` is guaranteed to discard (`M-1`): a `show` of
  // `null` — `release.when: "never"`, or an `on_date` that has not arrived
  // — means nothing downstream of it is ever used.
  const show = servedShow(release, attemptsRemaining, now);
  // `attempt.settings` is the pinned version's own `settings_json`, joined
  // on `test_version_id` — so an organiser rewriting the draft mid-window
  // cannot change what a candidate already sitting the paper is told.
  const finishMessage = brandingOf(attempt.settings).finish_message ?? null;
  const titles = titlesOf(layout);
  const { answered, unanswered, total } = counts(layout, responses);

  // **The already-submitted path writes nothing.** A second press, a
  // finish page reloaded, or a candidate returning to a tab the server
  // timed out while they were away: the row the cookie resolved already
  // carries the score and the stamp, so nothing is scored and nothing is
  // stored again.
  //
  // It is not free, and an earlier version of this comment said it was.
  // The two reads above this line are paid on *every* press — the
  // receipt's `answered`/`unanswered` come from `listResponses` and its
  // `attemptNo` from `countAttemptsForCandidate` — so a second press
  // costs **3** subrequests (the join, the answers, the count) and **4**
  // at `full_review`, where the bank is read again to rebuild the review.
  // Measured in `submit.test.ts`'s "a second press costs 3" rather than
  // asserted here; both numbers are well under the route's budget of 7.
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
        finishMessage,
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
              show === "full_review"
                ? paperOrder(layout, await liveQuestions(deps, attempt.workspaceId))
                : [],
              responses,
              now,
              attemptsRemaining,
              titles,
              show === null
                ? undefined
                : await countedFor(
                    deps,
                    attempt.workspaceId,
                    attempt.candidateId,
                    timing.counted_attempt,
                    attemptsRemaining,
                  ),
            ),
    };
  }

  // `K5`: the one scoring path, shared with grading and regrade (8b).
  // `awards: {}` is `submitAttempt`'s whole contribution — nothing has
  // recorded a rubric award yet, so every manual question is pending.
  const { score, blocked, questions: byId } = await rescoreAttempt(deps, {
    workspaceId: attempt.workspaceId,
    layout,
    settings: attempt.settings,
    responses,
    awards: {},
  });

  // The deadline, not the moment somebody noticed — see the header.
  const submittedAt = reason === "timeout" ? attempt.deadlineAt : now;
  const { submitted } = await finishAttempt(deps.db, attempt.workspaceId, {
    attemptId: attempt.attemptId,
    submittedAt,
    reason,
    ...(score === null ? {} : { score }),
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
    // Phase 8d Task 3 (K23, K37): the one event delivered inline, and only
    // for the race's winner — the loser writes nothing above and must not
    // fire a second webhook for the same submission either. `fireWebhooks`
    // never throws; a dead or slow receiver costs this request at most
    // `DELIVERY_TIMEOUT_MS` and never the receipt.
    await fireWebhooks(deps, {
      workspaceId: attempt.workspaceId,
      event: "attempt.submitted",
      payload: { attemptId: attempt.attemptId },
      now,
    });
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
      finishMessage,
    },
    // No score, no release: an attempt the engine could not grade has
    // nothing to disclose, and the receipt is a complete answer on its own.
    released:
      score === null
        ? null
        : releasedResult(
            release,
            score,
            paperOrder(layout, byId),
            // What the candidate actually typed, not the blanked copy the
            // grader was given — a review shows them their own answer.
            responses,
            now,
            attemptsRemaining,
            titles,
            show === null
              ? undefined
              : await countedFor(
                  deps,
                  attempt.workspaceId,
                  attempt.candidateId,
                  timing.counted_attempt,
                  attemptsRemaining,
                ),
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
    await countedFor(deps, attempt.workspaceId, attempt.candidateId, timing.counted_attempt, attemptsRemaining),
  );
}
