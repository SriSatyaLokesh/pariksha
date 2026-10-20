import type { ChecklistRow } from "../../lib/api";
import { useDialogKeys } from "../useDialogKeys";

// Screen 11 (docs/design.md's screen inventory) — `UX-17`: "a publish
// checklist, not a publish button".
//
// This component **computes nothing** (Review Focus 4). It renders the
// array the server returned, in the order the server returned it, and the
// text of every row is the server's own sentence — the one `POST
// .../publish` would refuse over and the one an import of the same
// document would report. A number re-derived here is a number that can
// disagree with the gate, which is the failure that teaches organisers to
// ignore the list.

const SEVERITY_LABEL: Readonly<Record<ChecklistRow["severity"], string>> = {
  // In words, not only by colour or icon: the two groups have to be
  // distinguishable to a reader who sees neither (`O-04`).
  blocking: "Must fix",
  advisory: "Worth checking",
};

const SEVERITY_GLYPH: Readonly<Record<ChecklistRow["severity"], string>> = {
  blocking: "⨯",
  advisory: "!",
};

/** Stable across a re-run, and unique within one list. `row.id` alone is
 * not: two empty sections are two `section_empty` rows. Including the
 * message keeps the key stable while the *problem* is unchanged and lets
 * React reuse the node, which is what stops the list rebuilding under the
 * reader's cursor when they press Re-run. */
function keyOf(row: ChecklistRow): string {
  return `${row.id}:${row.sectionId ?? row.field}:${row.message}`;
}

export function PublishChecklist({
  rows,
  version,
  rerunning,
  onGoTo,
  onRerun,
  onConfirm,
  onClose,
  busy,
}: {
  rows: readonly ChecklistRow[];
  /** The version number publishing would freeze — named on the button, so
   * the confirmation says what it does rather than "OK". */
  version: number;
  rerunning: boolean;
  onGoTo: (row: ChecklistRow) => void;
  onRerun: () => void;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const { dialogRef, onKeyDown } = useDialogKeys<HTMLDivElement>(true, onClose);
  const blocking = rows.filter((row) => row.severity === "blocking");

  return (
    <div
      className="publish-checklist organiser__panel"
      role="dialog"
      aria-label="Publish checklist"
      ref={dialogRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <h2>Publish checklist</h2>

      {rows.length === 0 ? (
        <p>Everything checks out.</p>
      ) : (
        <ul className="publish-checklist__rows">
          {rows.map((row) => (
            <li key={keyOf(row)}>
              <span className="publish-checklist__severity">
                <span aria-hidden="true">{SEVERITY_GLYPH[row.severity]}</span> {SEVERITY_LABEL[row.severity]}
              </span>{" "}
              <span>{row.message}</span>{" "}
              <button type="button" className="button-link" onClick={() => onGoTo(row)}>
                Go to {row.sectionId ?? row.field}
              </button>
            </li>
          ))}
        </ul>
      )}

      <p>Publishing freezes version {version}. Attempts already running stay on the version they started.</p>

      <button type="button" className="button-secondary" onClick={onRerun} disabled={rerunning}>
        Re-run the checks
      </button>
      <button
        type="button"
        className="button-primary button-primary--surface"
        disabled={busy || blocking.length > 0}
        onClick={onConfirm}
      >
        Publish version {version}
      </button>
      <button type="button" className="button-secondary" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}
