import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * Fix round (task 3 review, I9): the three `role="dialog"` elements this
 * task added (the source-switch confirmation and the delete confirmation
 * in `SectionList.tsx`, the question picker drawer) handled none of
 * Escape, initial focus or returning focus on close — against the repo's
 * own precedent, `QuestionEditor.tsx:515-520`'s "change type?" dialog,
 * which does all three (and explains in its own comment why it still
 * declines `aria-modal`: nothing here traps Tab either).
 *
 * One hook rather than three copies of the same five lines. `active` is
 * whether the dialog this call describes is currently open — for a dialog
 * that is itself conditionally rendered as an element inside an
 * always-mounted parent (`SectionList`'s own two), that toggles true/false
 * within one hook instance's lifetime; for a dialog that is its own
 * component, conditionally *mounted* (`QuestionPickerDrawer`), `active` is
 * simply `true` for the component's whole life and the effect's cleanup —
 * which fires on unmount exactly as it would on a dependency change — is
 * what returns focus to the control that opened it.
 */
export function useDialogKeys<T extends HTMLElement>(active: boolean, onClose: () => void) {
  const dialogRef = useRef<T>(null);

  useEffect(() => {
    if (!active) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => {
      trigger?.focus();
    };
  }, [active]);

  return {
    dialogRef,
    onKeyDown: (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    },
  };
}
