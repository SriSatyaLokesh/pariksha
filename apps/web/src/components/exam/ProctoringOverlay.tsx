/*
 * The overlay Phase 7c Task 4 builds — produced here, consumed again by
 * 7d's camera block and 7e's lock (the brief's own "Produces" line), so its
 * shape is a contract: a condition, a remedy, and nothing that lets a
 * keystroke make it go away.
 *
 * `Q2b`, ruled rather than left open: `role="alertdialog"`, `aria-modal`,
 * focus moved and trapped, an accessible name stating the condition and the
 * remedy, and no Escape handler. `useDialogKeys`'s `dismissible: false`
 * (`T4-R1`) is what makes the last one true without this component lying to
 * the hook with a no-op `onClose`.
 *
 * This component never touches `Runner`'s own tree — it doesn't know it
 * exists. `ProctoringLayer` mounts it as `Runner`'s sibling (the same
 * reason `Q2c`'s doc comment on that file gives) and is what marks the
 * runner region `inert`/`aria-hidden` for as long as this is open. "Hides
 * the questions" is therefore two things working together: this renders a
 * full-area scrim over the paper in CSS (`exam.css`, positioned off the
 * normal flow — `D8`, nothing here reflows the runtime), and the sibling
 * marks the covered region unreachable to assistive tech. Neither one
 * unmounts anything (`Q2a`, `T4-R2`): the runner keeps running underneath,
 * which is the whole point of the split.
 */

import { useDialogKeys } from "../useDialogKeys";

export interface ProctoringOverlayAction {
  label: string;
  onClick: () => void;
}

export interface ProctoringOverlayProps {
  /** The accessible name (via `aria-labelledby`) and the heading — states
   *  the condition, per `Q2b`. */
  title: string;
  /** The remedy, in full sentences — what the candidate reads to
   *  understand what is wrong and what fixes it. */
  message: string;
  /** The control that fixes the condition — fullscreen's "Enter
   *  fullscreen". Omitted where there is nothing to press to fix it
   *  (7e's lock has no recourse inside the product at all). */
  action?: ProctoringOverlayAction;
  /** Present only where acknowledging is itself the remedy — the
   *  window-leave warning, which is already resolved by the time it shows
   *  (the candidate is back). Never present together with a condition
   *  that is still wrong, because a dismiss button on an unfixed condition
   *  would be the same defect Q2b rules out for Escape. */
  onAcknowledge?: () => void;
}

export function ProctoringOverlay({ title, message, action, onAcknowledge }: ProctoringOverlayProps) {
  const dialog = useDialogKeys<HTMLDivElement>(true, () => {}, {
    trapTab: true,
    dismissible: false,
  });

  return (
    <div className="exam-proctoring-overlay">
      <div
        className="exam-proctoring-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="exam-proctoring-overlay-title"
        aria-describedby="exam-proctoring-overlay-message"
        ref={dialog.dialogRef}
        tabIndex={-1}
        onKeyDown={dialog.onKeyDown}
      >
        <h2 id="exam-proctoring-overlay-title" className="exam-proctoring-overlay-title">
          {title}
        </h2>
        <p id="exam-proctoring-overlay-message" className="exam-proctoring-overlay-message">
          {message}
        </p>
        {(action || onAcknowledge) && (
          <div className="exam-proctoring-overlay-actions">
            {action && (
              <button
                type="button"
                className="exam-proctoring-overlay-action"
                onClick={action.onClick}
              >
                {action.label}
              </button>
            )}
            {onAcknowledge && (
              <button type="button" className="exam-button" onClick={onAcknowledge}>
                Continue
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
