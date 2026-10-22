import { useId, type JSX } from "react";
import type { ProctoringOverrides, ProctoringProfile } from "@pariksha/core";

// Phase 7b Task 1 (`Q8`): the sixth setting row's panel, as a SHELL. The
// profile control and the fifteen overrides — grouped gating, camera-and-
// microphone and consequences, per `Q8`'s own "cost if wrong" — are Task
// 2's. Stubbing them here as disabled placeholders would only be work Task
// 2 has to delete, so this task ships exactly what `D7`'s row needs to open
// onto: a named region a reader can find, nothing it has to act on yet.
//
// `role="group"` rather than the `<section aria-labelledby>` the other five
// panels use (`TimingPanel` etc., which resolve to ARIA `region`): the
// brief's own test asserts `getByRole("group", { name: /Proctoring/ })`,
// and 6.5d's five panels were never asked to be found this way, so there is
// no existing convention this breaks.

export function ProctoringPanel({
  value,
  durationMinutes,
  onChange,
}: {
  value: { profile: ProctoringProfile; overrides: ProctoringOverrides };
  durationMinutes: number | null;
  onChange: (next: { profile: ProctoringProfile; overrides: ProctoringOverrides }) => void;
}): JSX.Element {
  // Task 1 ships the shell only. `value` and `durationMinutes` are what
  // Task 2's profile control and Task 4's cost clause read, and `onChange`
  // is what every one of the fifteen overrides writes through — none of
  // them exist yet, so nothing here reads or calls these. Referenced so the
  // signature this task is handed, which Task 2 must keep exactly, does not
  // fail lint for props a shell is not yet allowed to wire up.
  void value;
  void durationMinutes;
  void onChange;

  const headingId = useId();

  return (
    <section className="proctoring-panel" role="group" aria-labelledby={headingId}>
      <h2 id={headingId}>Proctoring</h2>
      <p className="field-help">
        The profile and its fifteen overrides are not built yet. This row opens onto them once Task
        2 lands.
      </p>
    </section>
  );
}
