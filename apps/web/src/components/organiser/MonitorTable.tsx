import { useState } from "react";
import type { ApiClient, MonitorAttemptRow } from "../../lib/api";
import { useDialogKeys } from "../useDialogKeys";

export interface MonitorTableProps {
  rows: readonly MonitorAttemptRow[];
  now?: number | undefined;
  client?: ApiClient | undefined;
  workspaceId?: string | undefined;
  onActionComplete?: (() => void) | undefined;
}

type ModalType = "extend_time" | "reset" | "force_submit" | "message";

interface ActiveModalState {
  type: ModalType;
  attemptId: string;
  candidateName: string;
}

function formatLastContact(ts: number | null, now: number): string {
  if (ts === null) return "—";
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return `${Math.floor(diffMin / 60)}h ago`;
}

function statusLabel(status: MonitorAttemptRow["status"]): string {
  switch (status) {
    case "started":
      return "Started";
    case "in_progress":
      return "In progress";
    case "submitted":
      return "Submitted";
    case "auto_submitted":
      return "Auto-submitted";
    case "locked":
      return "Locked";
  }
}

function integrityLabel(flag: MonitorAttemptRow["integrityFlag"]): string {
  switch (flag) {
    case "clean":
      return "Clean";
    case "review":
      return "Review";
    case "scoring_blocked":
      return "Scoring blocked";
  }
}

function cameraLabel(camera: MonitorAttemptRow["camera"]): string {
  switch (camera) {
    case "active":
      return "Active";
    case "lost":
      return "Lost";
    case "not_required":
      return "Not required";
  }
}

export function MonitorTable({
  rows,
  now = Date.now(),
  client,
  workspaceId,
  onActionComplete,
}: MonitorTableProps) {
  const [activeModal, setActiveModal] = useState<ActiveModalState | null>(null);
  const [minutes, setMinutes] = useState<number>(10);
  const [messageText, setMessageText] = useState<string>("");
  const [pending, setPending] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const dialog = useDialogKeys<HTMLDivElement>(
    activeModal !== null,
    () => {
      if (!pending) {
        setActiveModal(null);
        setActionError(null);
      }
    },
    { trapTab: true },
  );

  const handleUnlock = async (attemptId: string) => {
    if (!client || !workspaceId) return;
    try {
      setPending(true);
      setActionError(null);
      await client.performProctorAction(workspaceId, attemptId, { kind: "unlock" });
      onActionComplete?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to unlock attempt");
    } finally {
      setPending(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!client || !workspaceId || !activeModal) return;
    try {
      setPending(true);
      setActionError(null);

      switch (activeModal.type) {
        case "extend_time":
          await client.performProctorAction(workspaceId, activeModal.attemptId, {
            kind: "extend_time",
            minutes: Number(minutes),
          });
          break;
        case "reset":
          await client.performProctorAction(workspaceId, activeModal.attemptId, {
            kind: "reset",
          });
          break;
        case "force_submit":
          await client.performProctorAction(workspaceId, activeModal.attemptId, {
            kind: "force_submit",
          });
          break;
        case "message":
          await client.performProctorAction(workspaceId, activeModal.attemptId, {
            kind: "message",
            text: messageText,
          });
          break;
      }

      setActiveModal(null);
      setMessageText("");
      onActionComplete?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(false);
    }
  };

  if (rows.length === 0) {
    return (
      <p role="status" className="monitor-empty">
        No attempts matching current filters.
      </p>
    );
  }

  return (
    <div className="table-scroll">
      {actionError && !activeModal && (
        <p role="alert" className="organiser__notice error">
          {actionError}
        </p>
      )}
      <table className="monitor-table">
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Status</th>
            <th scope="col">Progress</th>
            <th scope="col">Violations</th>
            <th scope="col">Integrity</th>
            <th scope="col">Last Contact</th>
            <th scope="col">Camera</th>
            <th scope="col">Face count</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const displayName =
              row.candidateName ??
              row.candidateEmail ??
              row.candidateId;
            const subtitle =
              row.candidateName && row.candidateEmail
                ? row.candidateEmail
                : row.candidateId;

            const isQuiet = row.lastContactAt === null;
            const isLocked = row.status === "locked" || row.lockedAt !== null;
            const isSubmitted = row.status === "submitted" || row.status === "auto_submitted" || row.submittedAt !== null;

            return (
              <tr key={row.attemptId} data-attempt-id={row.attemptId}>
                <td className="monitor-cell-candidate">
                  <span className="candidate-name">{displayName}</span>
                  {subtitle !== displayName && (
                    <span className="candidate-sub">{subtitle}</span>
                  )}
                </td>
                <td>
                  <span className={`status-pill status-${row.status}`}>
                    {statusLabel(row.status)}
                  </span>
                </td>
                <td className="tabular-num">
                  {`${row.answeredCount}/${row.totalQuestions}`}
                </td>
                <td className="tabular-num">{row.violations}</td>
                <td>
                  <span className={`integrity-pill integrity-${row.integrityFlag}`}>
                    {integrityLabel(row.integrityFlag)}
                  </span>
                </td>
                <td className="tabular-num monitor-cell-contact">
                  {isQuiet ? "—" : formatLastContact(row.lastContactAt, now)}
                </td>
                <td>
                  <span className={`camera-pill camera-${row.camera}`}>
                    {cameraLabel(row.camera)}
                  </span>
                </td>
                <td className="tabular-num">
                  {row.faceCount == null
                    ? "not counted"
                    : `${row.faceCount} faces`}
                </td>
                <td className="monitor-cell-actions">
                  <div className="action-buttons-group">
                    <button
                      type="button"
                      className="btn-action"
                      onClick={() => {
                        setActiveModal({
                          type: "extend_time",
                          attemptId: row.attemptId,
                          candidateName: displayName,
                        });
                        setMinutes(10);
                        setActionError(null);
                      }}
                      title="Extend Time"
                    >
                      Extend
                    </button>

                    {isLocked && (
                      <button
                        type="button"
                        className="btn-action btn-unlock"
                        onClick={() => void handleUnlock(row.attemptId)}
                        disabled={pending}
                        title="Unlock Attempt"
                      >
                        Unlock
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-action"
                      onClick={() => {
                        setActiveModal({
                          type: "reset",
                          attemptId: row.attemptId,
                          candidateName: displayName,
                        });
                        setActionError(null);
                      }}
                      title="Reset Attempt"
                    >
                      Reset
                    </button>

                    {!isSubmitted && (
                      <button
                        type="button"
                        className="btn-action btn-danger"
                        onClick={() => {
                          setActiveModal({
                            type: "force_submit",
                            attemptId: row.attemptId,
                            candidateName: displayName,
                          });
                          setActionError(null);
                        }}
                        title="Force Submit"
                      >
                        Force Submit
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-action"
                      onClick={() => {
                        setActiveModal({
                          type: "message",
                          attemptId: row.attemptId,
                          candidateName: displayName,
                        });
                        setMessageText("");
                        setActionError(null);
                      }}
                      title="Send Message"
                    >
                      Message
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {activeModal && (
        <div className="modal-backdrop">
          <div
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-heading"
            ref={dialog.dialogRef}
            tabIndex={-1}
            onKeyDown={dialog.onKeyDown}
          >
            {activeModal.type === "extend_time" && (
              <>
                <h3 id="modal-heading">Extend Time</h3>
                <p>Extend deadline for {activeModal.candidateName}</p>
                <div className="modal-form-group">
                  <label htmlFor="extend-minutes">Minutes to add</label>
                  <input
                    id="extend-minutes"
                    type="number"
                    min="1"
                    max="180"
                    value={minutes}
                    onChange={(e) => setMinutes(Math.max(1, Number(e.target.value)))}
                    disabled={pending}
                  />
                </div>
              </>
            )}

            {activeModal.type === "reset" && (
              <>
                <h3 id="modal-heading">Reset Attempt</h3>
                <p>
                  Are you sure you want to reset this attempt for {activeModal.candidateName}?
                </p>
                <p className="modal-notice">
                  A new attempt will be created for this candidate. The current attempt and its responses will be preserved and remain intact.
                </p>
              </>
            )}

            {activeModal.type === "force_submit" && (
              <>
                <h3 id="modal-heading">Force Submit Attempt</h3>
                <p>
                  Are you sure you want to force submit the attempt for {activeModal.candidateName}?
                </p>
                <p className="modal-notice">
                  The candidate will no longer be able to answer questions or modify responses.
                </p>
              </>
            )}

            {activeModal.type === "message" && (
              <>
                <h3 id="modal-heading">Send Message</h3>
                <p>Send a proctor message to {activeModal.candidateName}</p>
                <div className="modal-form-group">
                  <label htmlFor="proctor-message-text">Message text</label>
                  <textarea
                    id="proctor-message-text"
                    rows={3}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder="Enter message for candidate…"
                    disabled={pending}
                  />
                </div>
              </>
            )}

            {actionError && (
              <p role="alert" className="modal-error">
                {actionError}
              </p>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setActiveModal(null);
                  setActionError(null);
                }}
                disabled={pending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleConfirmAction()}
                disabled={pending || (activeModal.type === "message" && messageText.trim() === "")}
              >
                {pending ? "Processing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
