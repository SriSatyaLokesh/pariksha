import type { AssertionReasonKey } from "@pariksha/core";

/**
 * The handful of facts the authoring answer editors
 * (`components/authoring/answer/*`) and the candidate answer inputs
 * (`components/exam/answer/*`) both need.
 *
 * It exists for a measured reason, not a tidiness one. These three
 * values started life inside the three authoring editors, and the
 * candidate side imported them from there — which is correct for
 * single-source-of-truth and wrong for the bundle: Rollup keeps a module
 * whole, so importing one constant out of `authoring/answer/Choice.tsx`
 * put all 10 KB of the option editor into the candidate's static graph,
 * and the three imports together cost 35 KB raw of organiser-only code
 * an exam-taker under a clock downloads and never runs.
 *
 * Nothing in here imports a component, so neither side pays for the
 * other. `bundle.test.ts` fails the build if the exam entry ever reaches
 * `src/components/authoring/answer` again.
 */

/** The four conclusions `assertion_reason` allows, which ARE its
 * `AssertionReasonKey` union. One list, so the option a candidate picks
 * and the key an author marks cannot drift apart. */
export const ASSERTION_REASON_OPTIONS: { value: AssertionReasonKey; label: string }[] = [
  { value: "both_true_explains", label: "Both true, and the reason explains the assertion" },
  {
    value: "both_true_not_explains",
    label: "Both true, but the reason does not explain the assertion",
  },
  { value: "a_true_r_false", label: "The assertion is true and the reason is false" },
  { value: "a_false_r_true", label: "The assertion is false and the reason is true" },
];

/** Longest `max_length` the format allows each manual type —
 * schemas/question-1.json's own ceilings, not a number invented here.
 * Neither is exported as a runtime constant from @pariksha/core (only
 * the schema states them), so this is the one place the UI names them:
 * the editor to cap what an author may set, the candidate input to cap
 * what they may type when the author set nothing. */
export const MAX_LENGTH_CEILING = { short_answer: 500, long_answer: 5000 } as const;

/** `items` with the one at `from` moved to `to`. The move every
 * `ReorderableList` caller makes in its `onReorder`, written once. */
export function reordered<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * A number field's value, or `null` for an empty or unusable one.
 *
 * The general form of a bug this repo has now fixed three times in three
 * files: `Number("")` is `0`, so a field a user clears reads back as
 * zero rather than as nothing. On the candidate's numeric answer that is
 * the expensive version — a cleared answer silently submits 0, which is
 * a wrong answer and, under negative marking, a penalty, where they
 * meant to submit nothing at all.
 *
 * It lives here rather than beside the one caller that needed it first
 * so the three existing sites can actually adopt it: `ReorderableList`'s
 * position field, `authoring/answer/Written.tsx`'s value and tolerance,
 * and `authoring/answer/Choice.tsx`'s `k`. Each of those guards the case
 * correctly by hand today, so none is broken and none is rewritten here;
 * this is what any new numeric field should use instead of a fourth
 * hand-rolled guard.
 */
export function numberFieldValue(raw: string): number | null {
  if (raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
