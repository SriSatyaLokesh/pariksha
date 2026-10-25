import { useCallback, useEffect, useState } from "react";
import type { ApiClient, MonitorAttemptRow, MonitorResponse } from "../lib/api";
import { MonitorTable } from "../components/organiser/MonitorTable";

export interface MonitorProps {
  client?: ApiClient;
  workspaceId?: string;
  testId?: string;
  rows?: readonly MonitorAttemptRow[];
  counts?: MonitorResponse["counts"];
}

const DEFAULT_COUNTS: MonitorResponse["counts"] = {
  registered: 0,
  inProgress: 0,
  submitted: 0,
  autoSubmitted: 0,
};

export function Monitor({
  client,
  workspaceId,
  testId,
  rows: initialRows,
  counts: initialCounts,
}: MonitorProps) {
  const [data, setData] = useState<MonitorResponse>(() => ({
    counts:
      initialCounts ??
      (initialRows
        ? {
            registered: initialRows.length,
            inProgress: initialRows.filter(
              (r) => r.status === "in_progress" || r.status === "started" || r.status === "locked",
            ).length,
            submitted: initialRows.filter((r) => r.status === "submitted").length,
            autoSubmitted: initialRows.filter((r) => r.status === "auto_submitted").length,
          }
        : DEFAULT_COUNTS),
    rows: initialRows ? [...initialRows] : [],
  }));

  const [loading, setLoading] = useState<boolean>(!initialRows);
  const [error, setError] = useState<string | null>(null);
  const [flaggedOnly, setFlaggedOnly] = useState<boolean>(false);
  const [inactiveOnly, setInactiveOnly] = useState<boolean>(false);
  const [now, setNow] = useState<number>(Date.now());

  const fetchMonitor = useCallback(async () => {
    if (!client || !workspaceId || !testId) return;
    try {
      const res = await client.getMonitor(workspaceId, testId, {
        flagged: flaggedOnly,
        inactive: inactiveOnly,
      });
      setData(res);
      setError(null);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load monitor data");
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId, testId, flaggedOnly, inactiveOnly]);

  // Initial fetch and 15s interval poll
  useEffect(() => {
    void fetchMonitor();
    const interval = setInterval(() => {
      void fetchMonitor();
    }, 15_000);
    return () => clearInterval(interval);
  }, [fetchMonitor]);

  // If props.rows is provided and changes, update data
  useEffect(() => {
    if (initialRows) {
      setData((prev) => ({
        ...prev,
        rows: [...initialRows],
        ...(initialCounts ? { counts: initialCounts } : {}),
      }));
    }
  }, [initialRows, initialCounts]);

  const displayedRows = initialRows && !client ? initialRows : data.rows;

  return (
    <div className="monitor-container">
      <div className="monitor-header">
        <div className="monitor-counts" aria-label="Attempt counts">
          <div className="monitor-stat-card">
            <span className="stat-label">Registered</span>
            <span className="stat-value">{data.counts.registered}</span>
          </div>
          <div className="monitor-stat-card">
            <span className="stat-label">In progress</span>
            <span className="stat-value">{data.counts.inProgress}</span>
          </div>
          <div className="monitor-stat-card">
            <span className="stat-label">Submitted</span>
            <span className="stat-value">{data.counts.submitted}</span>
          </div>
          <div className="monitor-stat-card">
            <span className="stat-label">Auto-submitted</span>
            <span className="stat-value">{data.counts.autoSubmitted}</span>
          </div>
        </div>

        <div className="monitor-banner" role="note">
          <p>
            Only Strict attempts report continuously; Standard attempts report on answer save, window
            blur, and interval snapshots.
          </p>
        </div>

        <div className="monitor-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => setFlaggedOnly(e.target.checked)}
            />
            <span>Flagged only</span>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={inactiveOnly}
              onChange={(e) => setInactiveOnly(e.target.checked)}
            />
            <span>Inactive &gt; 2 min</span>
          </label>
        </div>
      </div>

      {error && (
        <p role="alert" className="organiser__notice error">
          {error}
        </p>
      )}

      {loading && displayedRows.length === 0 ? (
        <p role="status" className="organiser__status">
          Loading monitor…
        </p>
      ) : (
        <MonitorTable
          rows={displayedRows}
          now={now}
          client={client}
          workspaceId={workspaceId}
          onActionComplete={fetchMonitor}
        />
      )}
    </div>
  );
}

export const MonitorRoute = Monitor;
