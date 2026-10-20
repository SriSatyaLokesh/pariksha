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

import type { PinnedLayout } from "./attempt.js";

/** Presentation order across sections; the index into this is
 *  `attempt.max_index`. */
export function flatQuestionIds(layout: PinnedLayout): string[] {
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
