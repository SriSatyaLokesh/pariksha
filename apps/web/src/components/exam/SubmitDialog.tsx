// The confirmation before a candidate ends their test (#75, `C-08`).
//
// The one irreversible action in the runtime, so it gets the one
// confirmation DESIGN.md requires of `button-danger`: it names what is
// about to happen, in numbers the candidate can check against the palette
// they have been staring at, and it says plainly that there is no way
// back. Nothing here animates.
//
// `useDialogKeys` is the shared hook the Clear-answer confirmation and
// four organiser dialogs already use: Escape closes, focus moves in on
// open and returns to the trigger on close. A candidate under a clock
// must never have to hunt for where the keyboard went.
//
// **With `{ trapTab: true }`, which is what earns `aria-modal`.** The
// hook's own rule, and the repo's two precedents: `Runner.tsx`'s
// Clear-answer confirmation declines the attribute because it traps
// nothing, and `Calculator.tsx` earns it. Claiming it without the trap
// tells assistive technology the paper behind is inert while Tab walks
// straight into it — and this is the one dialog whose wrong answer ends
// the attempt.

import { useDialogKeys } from "../useDialogKeys";

/** `n thing` / `n things`, because "1 questions unanswered" is the kind
 *  of sentence that makes a nervous candidate doubt the number. */
const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

export function SubmitDialog({
  unanswered,
  marked,
  total,
  pending,
  onConfirm,
  onCancel,
}: {
  unanswered: number;
  marked: number;
  total: number;
  /** A submission is in flight: both controls are inert and the screen
   *  says why, rather than looking dead while the request runs. */
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useDialogKeys<HTMLDivElement>(true, onCancel, { trapTab: true });

  return (
    <div
      className="exam-confirm exam-submit-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="exam-submit-heading"
      ref={dialog.dialogRef}
      tabIndex={-1}
      onKeyDown={dialog.onKeyDown}
    >
      <h2 id="exam-submit-heading" className="exam-submit-heading">
        Submit this test?
      </h2>
      <p>
        You have answered {plural(total - unanswered, "question", "questions")} of{" "}
        {String(total)}. {plural(unanswered, "question is", "questions are")} unanswered and{" "}
        {plural(marked, "is", "are")} marked for review.
      </p>
      <p>
        Submitting ends your test. You cannot come back to the paper, and nothing can be changed
        afterwards.
      </p>
      <div className="exam-submit-actions">
        <button
          type="button"
          className="exam-confirm-danger"
          disabled={pending}
          onClick={onConfirm}
        >
          Submit and finish
        </button>
        <button type="button" className="exam-button" disabled={pending} onClick={onCancel}>
          Keep working
        </button>
      </div>
      {/* Present from first render rather than inserted with its content:
          a live region a screen reader has never seen is one it does not
          announce. */}
      <p role="status" className="exam-submit-status">
        {pending ? "Submitting your test…" : ""}
      </p>
    </div>
  );
}
