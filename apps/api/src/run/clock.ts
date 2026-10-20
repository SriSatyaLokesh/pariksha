// The server's clock (`#73`, P6.9) — `AC-13`'s first half.
//
// Pure arithmetic over the attempt row and a `now`, so `/start`,
// `GET /attempt` and the answer route share one definition of "expired",
// one of "within grace" and one of "which section is running". The browser
// draws a countdown; **only this file decides whether a write is in time**
// (standing decision 6).
//
// Three separate deadlines live here and they are not interchangeable:
//
//  * `deadline_at` — `started_at + duration_minutes`, uncapped by
//    `closes_at`. The one a *write* is judged against, plus
//    `late_sync_grace_seconds`.
//  * the **section** deadline — `section_started_at + time_limit_minutes`,
//    which gets the same grace, because an answer queued offline across a
//    section boundary must not be refused forever.
//  * `latest_start_at` — a third rule entirely, belonging only to `/start`.
//
// And `deriveState(...) === "open"` is **none** of them. It gates ENTRY
// only: a test with a tight `closes_at` would otherwise refuse exactly the
// late offline saves `AC-14` exists to deliver, which is the opposite of
// what this phase is gated on.

import type { NavigationMode, TestTiming } from "@pariksha/core";
import { ApiError } from "../errors.js";
import type { PinnedLayout } from "./attempt.js";
import { sectionIndexOf } from "./navigation.js";

/**
 * Reconciliation row 8: `timing` is optional on `Test`, and these four
 * defaults live **only** in a web component (`TimingPanel.tsx:42-50`).
 * There is no shared default-applier, so the server applies its own — in
 * one place, because a candidate's clock and a candidate's screen
 * disagreeing about the grace period is a lost answer.
 */
export const TIMING_DEFAULTS: {
  navigation: NavigationMode;
  attempts_allowed: number;
  warn_at_minutes: readonly number[];
  late_sync_grace_seconds: number;
} = {
  navigation: "free",
  attempts_allowed: 1,
  warn_at_minutes: [10, 2],
  late_sync_grace_seconds: 30,
};

export const timingOf = (settings: unknown): Partial<TestTiming> =>
  (settings as { timing?: Partial<TestTiming> }).timing ?? {};

export const graceMsOf = (settings: unknown): number =>
  (timingOf(settings).late_sync_grace_seconds ?? TIMING_DEFAULTS.late_sync_grace_seconds) * 1000;

/**
 * What the clock knows, from a row and a `now`.
 *
 * `expired` is "the paper is over"; `withinGrace` is "it is over but a save
 * made before it ended may still arrive". The two together are what make a
 * late sync possible without making an unlimited test possible.
 * `sectionExpired` already has the grace folded in, because the only
 * question anybody asks it is "may this be written".
 */
export interface ClockView {
  remainingMs: number;
  sectionRemainingMs: number | null;
  expired: boolean;
  withinGrace: boolean;
  sectionExpired: boolean;
}

/**
 * Everything `clockOf` reads. `AttemptContextVar` satisfies it; so does the
 * shape `/start` holds in its hand before any row exists, which is why this
 * is structural rather than the context type itself — one definition of
 * "remaining", used by the route that mints the attempt and by every route
 * that reads it.
 */
export interface ClockInput {
  layout: PinnedLayout;
  settings: unknown;
  startedAt: number;
  deadlineAt: number;
  sectionStartedAt: number | null;
  maxIndex: number;
}

/** The section the candidate is in, by the ruling that `max_index` carries
 *  both `linear` and `per_section`: it is `sectionIndexOf(max_index)` over
 *  the pinned layout, and nothing else. */
export const currentSectionIndex = (attempt: ClockInput): number =>
  sectionIndexOf(attempt.layout, attempt.maxIndex);

function sectionDeadlineOf(attempt: ClockInput): number | null {
  const limit = attempt.layout.paper[currentSectionIndex(attempt)]?.timeLimitMinutes ?? null;
  if (limit === null) return null;
  // Null until the candidate's first save in a later section, which is the
  // only moment the server learns they reached one. The first section's
  // clock therefore runs from `started_at`.
  return (attempt.sectionStartedAt ?? attempt.startedAt) + limit * 60_000;
}

export function clockOf(attempt: ClockInput, now: number): ClockView {
  const grace = graceMsOf(attempt.settings);
  const sectionDeadline = sectionDeadlineOf(attempt);
  return {
    remainingMs: Math.max(0, attempt.deadlineAt - now),
    sectionRemainingMs: sectionDeadline === null ? null : Math.max(0, sectionDeadline - now),
    expired: now > attempt.deadlineAt,
    withinGrace: now > attempt.deadlineAt && now <= attempt.deadlineAt + grace,
    sectionExpired: sectionDeadline !== null && now > sectionDeadline + grace,
  };
}

/** Past the deadline *and* past the grace — the point at which the attempt
 *  is over for every purpose, including a read. */
export const timedOut = (attempt: ClockInput, now: number): boolean =>
  now > attempt.deadlineAt + graceMsOf(attempt.settings);

/**
 * Throws `409 time_up` past `deadline_at + late_sync_grace_seconds`. **The
 * one place a write is refused on the whole paper's time.**
 *
 * 409 and not 403 on purpose: Task 8's queue classifies both as `refused`,
 * which keeps the answer and never reads "Saved" — but the two codes say
 * different things to a human reading a log, and `time_up` is the one a
 * candidate's support ticket will be about.
 */
export function assertWritable(attempt: ClockInput, now: number): void {
  if (!timedOut(attempt, now)) return;
  throw new ApiError(
    409,
    "time_up",
    "Your time for this test is up, so this answer was not saved.",
  );
}

/**
 * `C-07`'s server half: a write into a section whose time has ended is
 * refused and the **next** section is named.
 *
 * Naming the next section is the auto-advance. The server never hears about
 * navigation — `max_index` only ever rises through a save — so there is
 * nothing to advance *to* until the candidate writes there; telling them
 * where to go, and accepting the first write when they do, is the whole
 * mechanism and it costs no statement on the refusal path.
 *
 * A target in a **later** section is always allowed: moving on is how a
 * candidate leaves a section whose time is up, and refusing it would lock
 * them out of the rest of the paper.
 */
export function assertSectionOpen(attempt: ClockInput, targetIndex: number, now: number): void {
  if (!clockOf(attempt, now).sectionExpired) return;
  const current = currentSectionIndex(attempt);
  if (sectionIndexOf(attempt.layout, targetIndex) > current) return;
  const title = attempt.layout.paper[current]?.title ?? "this section";
  const next = attempt.layout.paper[current + 1];
  throw new ApiError(
    409,
    "section_over",
    next
      ? `Time for ${title} is up. Carry on with ${next.title}.`
      : `Time for ${title} is up, so this answer was not saved.`,
    next ? { nextSection: next.id } : undefined,
  );
}
