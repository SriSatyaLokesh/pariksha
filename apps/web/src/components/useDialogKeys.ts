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
 *
 * Phase 6 Task 6 (#70) moved this file up one directory, out of
 * `components/testbuilder/`. Nothing about it was ever builder-specific —
 * `authoring/ImportDialog.tsx` already reached across for it — and
 * `bundle.test.ts` fails the build if anything under
 * `src/components/testbuilder` is statically reachable from the candidate
 * `exam` entry, so the candidate runtime's calculator could not have reused
 * it where it stood. Moved rather than copied: a second copy of five lines
 * of focus handling is how two dialogs end up disagreeing about Escape.
 *
 * `trapTab` is opt-in and off by default, which is every existing caller's
 * behaviour unchanged. The repo's precedent deliberately declines
 * `aria-modal` *because* it traps nothing; a caller that does trap Tab has
 * earned `aria-modal="true"`, and the candidate's calculator — an overlay
 * over a live attempt, under a clock, with no second device to fall back on
 * — is one.
 *
 * `dismissible` is the same shape of opt-in, added for Phase 7c Task 4's
 * `ProctoringOverlay` (`T4-R1`). `Q2b` is explicit that the candidate's
 * proctoring overlay has **no Escape handler** — "an overlay a keystroke
 * dismisses is not a proctoring control". Passing a no-op `onClose` to get
 * that would be a writer with no reader, indistinguishable from an
 * oversight; copying this hook's five lines a second time is worse, which
 * is the whole reason this file exists ("a second copy of five lines of
 * focus handling is how two dialogs end up disagreeing about Escape").
 * Default `true` is every existing caller's behaviour unchanged.
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialogKeys<T extends HTMLElement>(
  active: boolean,
  onClose: () => void,
  options?: { trapTab?: boolean; dismissible?: boolean },
) {
  const dialogRef = useRef<T>(null);
  const trapTab = options?.trapTab ?? false;
  const dismissible = options?.dismissible ?? true;

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
      if (dismissible && event.key === "Escape") {
        onClose();
        return;
      }
      if (!trapTab || event.key !== "Tab") return;
      const stops = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      if (edge === undefined || document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? stops[stops.length - 1] : stops[0])?.focus();
    },
  };
}
