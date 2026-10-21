import { useState, type Ref } from "react";
import type { ChecklistRow } from "../../lib/api";
import type { RailState } from "../../lib/rail-state";
import { Icon } from "../OrganiserShell";

// Screen 11 (docs/design.md's screen inventory) — `UX-17`: "a publish
// checklist, not a publish button" — as Phase 6.5d's `D7` re-sites it: not
// the last thing on the page and not behind the Publish button, but a right
// rail that is present from the first paint, with a readiness figure.
//
// This component **computes nothing** (Review Focus 4). It renders the
// array the server returned, in the order the server returned it, and the
// text of every row is the server's own sentence — the one `POST
// .../publish` would refuse over and the one an import of the same
// document would report. A number re-derived here is a number that can
// disagree with the gate, which is the failure that teaches organisers to
// ignore the list. The readiness figure below is a COUNT of those rows, in
// their own severities, and nothing is re-sorted, re-filtered or re-judged.
//
// `D7a`, the three states this renders:
//
//   docked   the full panel, in the rail, in flow.
//   lights   a strip of indicator lights, one per row.
//   lights + floating
//            the strip, plus the full panel painted OVER the page. It must
//            never reflow what is being edited, so the panel is positioned
//            out of flow (testbuilder.css) rather than inserted into it —
//            and `position: fixed` rather than `absolute`, because below
//            719px shell.css gives every direct child of the page
//            `overflow-x: auto`, which makes this rail a scroll container
//            and would clip an absolutely positioned panel. That file's
//            header names the answer ("give the construct somewhere to
//            paint ... rather than widen the rule"); the viewport is that
//            somewhere.
//
// The dock toggle is ONE control, rendered in both states. `D7a`: "both
// toggles stay operable while a panel is open — auto-collapse is a
// convenience, never a lock." A pin that lived only inside the floating
// panel would be unreachable the moment a hover ended.

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

/** What a light is called. Three colours cannot carry three meanings on
 *  their own — that is colour-not-alone and the contrast rule at once — and
 *  an icon beside them would only add a second thing to decode. The NAME is
 *  what carries it, and it says both what is wrong and where to go. The
 *  words after the dash are the server's; only the severity and the
 *  destination are this file's. */
function lightName(row: ChecklistRow): string {
  const severity = row.severity === "blocking" ? "Blocking" : "Advisory";
  return `${severity} — ${row.message}. Go to ${row.sectionId ?? row.field}.`;
}

/** Stable across a re-run, and unique within one list. `row.id` alone is
 * not: two empty sections are two `section_empty` rows. Including the
 * message keeps the key stable while the *problem* is unchanged and lets
 * React reuse the node, which is what stops the list rebuilding under the
 * reader's cursor when they press Re-run. */
function keyOf(row: ChecklistRow): string {
  return `${row.id}:${row.sectionId ?? row.field}:${row.message}`;
}

export function PublishChecklist({
  railRef,
  rows,
  version,
  rerunning,
  state,
  onState,
  onGoTo,
  onRerun,
  onConfirm,
  busy,
}: {
  /** The builder's Publish control moves focus here — the rail is where the
   *  answer appears, and a control whose whole effect is elsewhere on the
   *  page has to take the reader with it. */
  railRef?: Ref<HTMLElement>;
  /** `null` until the screen's own load answers. Not `[]`: an empty array is
   *  "every check passed", which is the opposite claim. */
  rows: readonly ChecklistRow[] | null;
  /** The version number publishing would freeze — named on the button, so
   * the confirmation says what it does rather than "OK". */
  version: number;
  rerunning: boolean;
  state: RailState["checklist"];
  onState: (next: RailState["checklist"]) => void;
  onGoTo: (row: ChecklistRow) => void;
  onRerun: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  // Hover or keyboard focus over the strip. Not persisted and not routed
  // through `onState`: floating is a gesture, docking is a choice, and
  // writing a hover to `localStorage` would make a mouse passing over the
  // rail the state the next visit opens in.
  const [floating, setFloating] = useState(false);
  const docked = state === "docked";
  const open = docked || floating;
  const blocking = rows?.filter((row) => row.severity === "blocking") ?? [];

  return (
    <section
      className="checklist-rail"
      aria-labelledby="checklist-rail-heading"
      ref={railRef}
      tabIndex={-1}
      data-state={state}
      onMouseEnter={() => setFloating(true)}
      onMouseLeave={(event) => {
        // Not while a reader is inside it with the keyboard: a mouse
        // crossing the rail would otherwise take the panel out from under
        // the control they have focused.
        if (!event.currentTarget.contains(document.activeElement)) setFloating(false);
      }}
      onFocus={() => setFloating(true)}
      onBlur={(event) => {
        // `onBlur` is `focusout`, which fires when focus moves BETWEEN two
        // controls inside this rail as well as when it leaves. Without the
        // containment check the panel would unmount and remount on every
        // Tab inside it, which loses the focus it is reacting to.
        if (!event.currentTarget.contains(event.relatedTarget)) setFloating(false);
      }}
    >
      <div className="checklist-rail__head">
        <h2 id="checklist-rail-heading" className="checklist-rail__heading">
          Publish checklist
        </h2>

        {rows !== null && (
          <p className="checklist-rail__readiness">
            {rows.length === 0 ? (
              <strong>All clear</strong>
            ) : (
              <>
                {/* `D7c`: the readiness figure lives here and nowhere else.
                    How many of the gate's own rows do not stop a publish,
                    over how many it raised. */}
                <strong>{`${rows.length - blocking.length} / ${rows.length}`}</strong>{" "}
                <span className="checklist-rail__count">
                  clear{blocking.length > 0 ? `, ${blocking.length} must fix` : ""}
                </span>
              </>
            )}
          </p>
        )}

        <button
          type="button"
          className="checklist-rail__pin"
          aria-expanded={docked}
          onClick={() => onState(docked ? "lights" : "docked")}
        >
          <Icon name="panel" />
          <span className="visually-hidden">
            {docked ? "Collapse the checklist to lights" : "Pin the checklist open"}
          </span>
        </button>
      </div>

      {!docked && rows !== null && (
        <ul className="checklist-rail__lights" aria-label="Checklist lights">
          {rows.length === 0 ? (
            <li>
              <span className="checklist-rail__light" data-severity="passing">
                <span className="visually-hidden">Passing — every check is clear.</span>
              </span>
            </li>
          ) : (
            rows.map((row) => (
              <li key={keyOf(row)}>
                <button
                  type="button"
                  className="checklist-rail__light"
                  data-severity={row.severity}
                  onClick={() => onGoTo(row)}
                >
                  <span className="visually-hidden">{lightName(row)}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {open && (
        <div className="checklist-rail__panel" data-floating={docked ? "false" : "true"}>
          {rows === null ? (
            <p className="organiser__status" role="status">
              Checking…
            </p>
          ) : rows.length === 0 ? (
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
            disabled={busy || rows === null || blocking.length > 0}
            onClick={onConfirm}
          >
            Publish version {version}
          </button>
        </div>
      )}
    </section>
  );
}
