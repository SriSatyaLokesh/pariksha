import type { MonitorAttemptRow } from "../../lib/api";

export interface MonitorTableProps {
  rows: readonly MonitorAttemptRow[];
  now?: number;
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

export function MonitorTable({ rows, now = Date.now() }: MonitorTableProps) {
  if (rows.length === 0) {
    return (
      <p role="status" className="monitor-empty">
        No attempts matching current filters.
      </p>
    );
  }

  return (
    <div className="table-scroll">
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
