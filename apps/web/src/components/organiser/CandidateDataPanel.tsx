import { useId, useState, type JSX } from "react";
import { useDialogKeys } from "../useDialogKeys";

// Phase 8e Task 2 (`S-14`, issue 101): the organiser surface over
// `GET`/`DELETE /api/v1/workspaces/:id/candidates/:candidateId/data` —
// `candidates.delete`, Owner-only (both methods share the one permission,
// so `isOwner` gates the export button too, not only erasure).
//
// Irreversible, so the dialog that actually sends the `DELETE` is a typed
// confirmation (`CONFIRM_PHRASE`) rather than a second click — the same
// shape `ProctoringPanel.tsx`'s profile-change dialog and
// `SectionList.tsx`'s delete dialog already use (`role="alertdialog"`,
// `useDialogKeys` with `trapTab: true`, Escape to cancel), one step more
// deliberate because nothing here is undoable the way a deleted section is
// (`SectionList`'s own undo toast has no equivalent here — there is nothing
// to restore). No new colour or class: every selector below is `.field`,
// `.field-label`, `.field-help`, `.text-input`, `.button-primary` or
// `.button-secondary`, all already carrying `contrast-usage.test.ts`
// `SURFACE` entries on both grounds through `ProctoringPanel`/`AccessPanel`.
//
// Mounted at `ResultsPanel.tsx` (fix round 1), behind the lookup-then-act
// `CandidateLookup` control there — that panel already owns the policy
// governing a candidate's data (the retention fields beside it), so acting
// on one candidate's data sits there rather than inventing a fourth
// organiser surface. There is still no per-candidate *route* of its own
// (`AccessPanel.tsx`'s candidate list shows aggregate counts only); this
// component stays reusable rather than route-bound on purpose, for
// whichever screen next needs a single candidate's export/erasure controls.

const CONFIRM_PHRASE = "ERASE";

export interface CandidateDataPanelProps {
  /** How this candidate is named in the confirmation copy — their
   *  `external_id` when the test has one, otherwise a short internal id. */
  candidateLabel: string;
  /** Whether the signed-in actor holds `candidates.delete` — Owner only.
   *  The server is the real gate; this only keeps a non-Owner from seeing
   *  controls that would 403, and says why. */
  isOwner: boolean;
  /** `GET .../data`. Fire-and-forget on the caller's side (a download, a
   *  new tab) — this panel tracks no loading state for it, the same way
   *  `AccessPanel.tsx`'s own file controls do not for an upload until it is
   *  staged. */
  onExport: () => void;
  /** `DELETE .../data`. Rejects to report the failure in this panel (a 409
   *  for an attempt in progress, most likely) — resolves once the server
   *  confirms the erasure. */
  onDelete: (input: { keepAnonymisedScore: boolean }) => Promise<void>;
}

export function CandidateDataPanel({
  candidateLabel,
  isOwner,
  onExport,
  onDelete,
}: CandidateDataPanelProps): JSX.Element {
  const ids = useId();
  const [keepAnonymisedScore, setKeepAnonymisedScore] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function openConfirm(): void {
    setTyped("");
    setError(null);
    setConfirming(true);
  }

  function cancelConfirm(): void {
    setConfirming(false);
    setTyped("");
  }

  const confirmDialog = useDialogKeys<HTMLDivElement>(confirming, cancelConfirm, { trapTab: true });

  async function confirmErase(): Promise<void> {
    if (typed !== CONFIRM_PHRASE || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete({ keepAnonymisedScore });
      setConfirming(false);
      setDone(true);
    } catch (cause) {
      // `apps/api`'s envelope puts a person-readable sentence in
      // `error.message` (`errorEnvelope.ts`) — including the 409 an
      // in-progress attempt answers with, which is the one failure an
      // organiser here needs to actually understand ("force-submit it, or
      // wait").
      setError(cause instanceof Error ? cause.message : "The candidate's data could not be erased.");
    } finally {
      setBusy(false);
    }
  }

  const headingId = `${ids}-heading`;
  const confirmHeadingId = `${ids}-confirm-heading`;
  const typedId = `${ids}-typed`;

  if (done) {
    return (
      <section className="candidate-data-panel" role="group" aria-labelledby={headingId}>
        <h2 id={headingId}>Candidate data</h2>
        <p role="status" className="field-help">{`${candidateLabel}'s data has been erased.`}</p>
      </section>
    );
  }

  return (
    <section className="candidate-data-panel" role="group" aria-labelledby={headingId}>
      <h2 id={headingId}>Candidate data</h2>
      <p className="field-help">
        {`Download everything the product holds about ${candidateLabel}, or erase it for good. S-14: erasure cannot be undone.`}
      </p>

      <div className="field">
        <button type="button" className="button-secondary" disabled={!isOwner} onClick={onExport}>
          Download their data
        </button>
        {!isOwner && <p className="field-help">Needs an Owner — candidate erasure and export are Owner-only.</p>}
      </div>

      <fieldset className="field-row">
        <legend>When erased, keep the score?</legend>
        <div className="field">
          <input
            type="radio"
            id={`${ids}-keep-true`}
            name={`${ids}-keep`}
            checked={keepAnonymisedScore}
            disabled={!isOwner}
            onChange={() => setKeepAnonymisedScore(true)}
          />
          <label htmlFor={`${ids}-keep-true`}>Keep the attempt, anonymised</label>
        </div>
        <div className="field">
          <input
            type="radio"
            id={`${ids}-keep-false`}
            name={`${ids}-keep`}
            checked={!keepAnonymisedScore}
            disabled={!isOwner}
            onChange={() => setKeepAnonymisedScore(false)}
          />
          <label htmlFor={`${ids}-keep-false`}>Remove the attempt entirely</label>
        </div>
      </fieldset>

      <p role="status" aria-label="What erasure keeps and removes" className="field-help">
        {keepAnonymisedScore
          ? "Stays: the attempt and its score, with no name attached. Goes: their name, email, every other form answer, their answers, camera images, and the candidate_unique record of their email."
          : "Goes: everything — the attempt, its score, their name, email, every other form answer, their answers, and camera images."}
      </p>

      <div className="field">
        <button type="button" className="button-primary" disabled={!isOwner} onClick={openConfirm}>
          Erase this candidate&apos;s data
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="field-help">
          {error}
        </p>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={confirmHeadingId}
          ref={confirmDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={confirmDialog.onKeyDown}
        >
          <h3 id={confirmHeadingId}>{`Erase ${candidateLabel}'s data?`}</h3>
          <p>
            {keepAnonymisedScore
              ? "This keeps the attempt and its anonymised score, and removes everything else named above. This cannot be undone."
              : "This removes the attempt, its score, and every other trace of this candidate named above. This cannot be undone."}
          </p>
          <div className="field">
            <label className="field-label" htmlFor={typedId}>
              {`Type ${CONFIRM_PHRASE} to confirm`}
            </label>
            <input
              className="text-input"
              id={typedId}
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
          <button type="button" className="button-secondary" onClick={cancelConfirm}>
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            disabled={typed !== CONFIRM_PHRASE || busy}
            onClick={() => void confirmErase()}
          >
            {busy ? "Erasing…" : "Erase permanently"}
          </button>
        </div>
      )}
    </section>
  );
}
