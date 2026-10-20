// Where a candidate is, and where they are allowed to be (`#74`, P6.10).
//
// Pure arithmetic over the pinned layout and `attempt.max_index`, so the
// clock, the answer route and the paper payload all read one definition of
// "which section is this" and "is this question behind us".
//
// **The rule is "no going back", not "no looking forward".** `AC-14` puts
// the whole paper in the browser before the network drops, so withholding
// later questions is not available to us — and `T-13` never asked for it:
// `linear` is "no going back", `per_section` is "free inside a section,
// locked once left". Both forbid *returning*, and both are enforceable on
// the write path alone, which is exactly where `AC-15`'s "either through
// the interface or through the API" bites.

import { ApiError } from "../errors.js";
import { NAVIGATION_LOCKED_MESSAGE, type NavigationMode } from "@pariksha/core";
import type { PinnedLayout } from "./attempt.js";

/** Presentation order across sections; the index into this is
 *  `attempt.max_index`.
 *
 *  Not exported: the brief listed it as part of this module's interface,
 *  but `indexOf` is the only thing that ever wants it and an export with
 *  no caller outside its own file is the class of defect this phase has
 *  already found twice. */
function flatQuestionIds(layout: PinnedLayout): string[] {
  return layout.sections.flatMap((section) => section.questionIds);
}

/** -1 when the question is not on this candidate's paper at all. */
export function indexOf(layout: PinnedLayout, questionId: string): number {
  return flatQuestionIds(layout).indexOf(questionId);
}

/**
 * Which section a flat index falls in. Clamped at both ends rather than
 * answering -1: `max_index` is 0 on a fresh attempt and the last index on a
 * finished one, and both are real positions in a real section.
 */
export function sectionIndexOf(layout: PinnedLayout, flatIndex: number): number {
  let seen = 0;
  for (const [at, section] of layout.sections.entries()) {
    seen += section.questionIds.length;
    if (flatIndex < seen) return at;
  }
  return Math.max(0, layout.sections.length - 1);
}

/**
 * The flat index that `flatIndex`'s own section **begins** at.
 *
 * This is the number `max_index` has to still be below for a save to be
 * the one that *enters* that section, which is what lets
 * `section_started_at` be stamped by the statement against the committed
 * row rather than by a caller reasoning from a read that may already be
 * stale — see `upsertResponse`.
 */
export const sectionStartIndexOf = (layout: PinnedLayout, flatIndex: number): number =>
  layout.sections
    .slice(0, sectionIndexOf(layout, flatIndex))
    .reduce((sum, section) => sum + section.questionIds.length, 0);

/**
 * Throws 403 `navigation_locked`, naming the rule — **never a 404**.
 *
 * A question outside the paper is the 404 (`S-10`'s one body, in the route
 * before this is reached); a question on the paper that this candidate may
 * not write to right now is this. The two are deliberately distinguishable:
 * the first would otherwise disclose which questions exist, and the second
 * is a rule the candidate was told about on the landing page.
 */
export function assertReachable(
  layout: PinnedLayout,
  mode: NavigationMode,
  maxIndex: number,
  questionId: string,
): void {
  if (mode === "free") return;
  const target = indexOf(layout, questionId);
  const behind =
    mode === "linear"
      ? target < maxIndex
      : sectionIndexOf(layout, target) < sectionIndexOf(layout, maxIndex);
  if (!behind) return;
  throw new ApiError(403, "navigation_locked", NAVIGATION_LOCKED_MESSAGE[mode]);
}
