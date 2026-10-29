import { Fragment, useMemo, useState } from "react";
import type { ApiClient, TestResultAttempt } from "../../lib/api";
import { downloadCsv } from "../../lib/download";

export interface ResultsTableProps {
  testId: string;
  workspaceId: string;
  client: ApiClient;
  results: TestResultAttempt[];
  totalPoints: number;
  passMark: number | null;
  nextCursor?: string | null | undefined;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  onReviewAttempt: (attemptId: string) => void;
  onFilterChange?: (filters: { status: string; integrity: string; search: string }) => void;
}

async function drainExport(
  client: ApiClient,
  workspaceId: string,
  testId: string,
  kind: "results" | "answers",
  onPage?: (pages: number) => void,
): Promise<{ csv: string; filename: string }> {
  let csv = "";
  let pages = 0;
  const first = await client.exportPage(workspaceId, testId, kind, undefined);
  csv += first.csv;
  pages += 1;
  onPage?.(pages);
  let cursor: string | undefined = typeof first.nextCursor === "string" ? first.nextCursor : undefined;
  while (cursor !== undefined) {
    const page = await client.exportPage(workspaceId, testId, kind, cursor);
    csv += page.csv;
    pages += 1;
    onPage?.(pages);
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
  }
  return { csv, filename: first.filename };
}

function formatSubmitted(ts: number | null, status: string): string {
  if (ts === null || status === "in_progress") {
    return "—";
  }
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderStatusBadge(status: TestResultAttempt["status"]) {
  switch (status) {
    case "submitted":
      return <span className="status-badge">Submitted</span>;
    case "auto_submitted":
      return <span className="status-badge">Auto-submitted</span>;
    case "in_progress":
      return <span className="status-badge">In progress</span>;
    case "locked":
      return <span className="status-badge">Locked</span>;
  }
}

function renderIntegrityBadge(flag: TestResultAttempt["integrityFlag"]) {
  switch (flag) {
    case "clean":
      return <span className="status-badge status-badge--clean">Clean</span>;
    case "review":
      return (
        <span className="status-badge status-badge--review">
          Review<span className="sr-only"> required</span>
        </span>
      );
    case "scoring_blocked":
      return (
        <span className="status-badge status-badge--blocked">
          Blocked<span className="sr-only"> (scoring blocked)</span>
        </span>
      );
  }
}

export function ResultsTable({
  testId,
  workspaceId,
  client,
  results,
  totalPoints,
  passMark: _passMark,
  nextCursor,
  onLoadMore,
  isLoadingMore = false,
  onReviewAttempt,
  onFilterChange,
}: ResultsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [integrityFilter, setIntegrityFilter] = useState("all");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [exportingKind, setExportingKind] = useState<"results" | "answers" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleFilterUpdate = (newSearch: string, newStatus: string, newIntegrity: string) => {
    onFilterChange?.({
      search: newSearch,
      status: newStatus,
      integrity: newIntegrity,
    });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearch(val);
    handleFilterUpdate(val, statusFilter, integrityFilter);
  };

  const handleStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setStatusFilter(val);
    handleFilterUpdate(search, val, integrityFilter);
  };

  const handleIntegrityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setIntegrityFilter(val);
    handleFilterUpdate(search, statusFilter, val);
  };

  const toggleExpand = (attemptId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(attemptId)) {
        next.delete(attemptId);
      } else {
        next.add(attemptId);
      }
      return next;
    });
  };

  const handleExport = async (kind: "results" | "answers") => {
    setExportingKind(kind);
    setExportError(null);
    try {
      const { csv, filename } = await drainExport(client, workspaceId, testId, kind);
      downloadCsv(csv, filename);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExportingKind(null);
    }
  };

  const filteredResults = useMemo(() => {
    return results.filter((attempt) => {
      if (statusFilter !== "all") {
        if (statusFilter === "submitted") {
          if (attempt.status !== "submitted" && attempt.status !== "auto_submitted") {
            return false;
          }
        } else if (attempt.status !== statusFilter) {
          return false;
        }
      }
      if (integrityFilter !== "all" && attempt.integrityFlag !== integrityFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const nameMatch = attempt.candidateName?.toLowerCase().includes(q) ?? false;
        const emailMatch = attempt.candidateEmail?.toLowerCase().includes(q) ?? false;
        const extMatch = attempt.externalId?.toLowerCase().includes(q) ?? false;
        if (!nameMatch && !emailMatch && !extMatch) {
          return false;
        }
      }
      return true;
    });
  }, [results, statusFilter, integrityFilter, search]);

  return (
    <div className="results-table-container">
      <div className="results-toolbar">
        <div className="results-toolbar__filters">
          <label htmlFor="results-search" className="sr-only">
            Search candidates
          </label>
          <input
            id="results-search"
            type="search"
            className="results-toolbar__search"
            placeholder="Search by candidate name or email…"
            value={search}
            onChange={handleSearchChange}
          />

          <label htmlFor="results-filter-status" className="sr-only">
            Filter by status
          </label>
          <select
            id="results-filter-status"
            className="results-toolbar__select"
            value={statusFilter}
            onChange={handleStatusChange}
          >
            <option value="all">All statuses</option>
            <option value="submitted">Submitted</option>
            <option value="in_progress">In progress</option>
            <option value="locked">Locked</option>
          </select>

          <label htmlFor="results-filter-integrity" className="sr-only">
            Filter by integrity
          </label>
          <select
            id="results-filter-integrity"
            className="results-toolbar__select"
            value={integrityFilter}
            onChange={handleIntegrityChange}
          >
            <option value="all">All integrity</option>
            <option value="clean">Clean</option>
            <option value="review">Review required</option>
            <option value="scoring_blocked">Scoring blocked</option>
          </select>
        </div>

        <div className="results-toolbar__actions">
          <button
            type="button"
            className="button-secondary"
            disabled={exportingKind !== null}
            onClick={() => void handleExport("results")}
          >
            {exportingKind === "results" ? "Exporting…" : "Export Results (CSV)"}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={exportingKind !== null}
            onClick={() => void handleExport("answers")}
          >
            {exportingKind === "answers" ? "Exporting…" : "Export Answers (CSV)"}
          </button>
        </div>
      </div>

      {exportError && (
        <p className="field-error" role="alert">
          {exportError}
        </p>
      )}

      {filteredResults.length === 0 ? (
        <p className="organiser-empty__body" role="status">
          No candidate results found matching your filters.
        </p>
      ) : (
        <div
          className="table-scroll"
          role="region"
          aria-label="Candidate results table"
          tabIndex={0}
        >
          <table className="testbuilder-list">
            <caption className="sr-only">Candidate results and scores</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Expand</span>
                </th>
                <th scope="col">Rank</th>
                <th scope="col">Candidate</th>
                <th scope="col">Status</th>
                <th scope="col">Score</th>
                <th scope="col">Percentage</th>
                <th scope="col">Result</th>
                <th scope="col">Integrity</th>
                <th scope="col">Submitted</th>
                <th scope="col" className="acts">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredResults.map((attempt) => {
                const isExpanded = expandedIds.has(attempt.attemptId);
                const maxPointsVal = attempt.maxScore ?? totalPoints;
                return (
                  <Fragment key={attempt.attemptId}>
                    <tr>
                      <td>
                        <button
                          type="button"
                          className="results-accordion-btn"
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? "Collapse question breakdown"
                              : "Expand question breakdown"
                          }
                          onClick={() => toggleExpand(attempt.attemptId)}
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </td>
                      <td className="tabular-nums">
                        {attempt.rank !== null ? `#${attempt.rank}` : "—"}
                      </td>
                      <td>
                        <div className="test-name">
                          <strong>
                            {attempt.candidateName ?? "Unnamed candidate"}
                          </strong>
                          <span className="test-id">
                            {attempt.candidateEmail ?? attempt.externalId ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td>{renderStatusBadge(attempt.status)}</td>
                      <td className="tabular-nums">
                        {attempt.score !== null
                          ? `${attempt.score} / ${maxPointsVal}`
                          : "—"}
                      </td>
                      <td className="tabular-nums">
                        {attempt.percentage !== null
                          ? `${attempt.percentage.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td>
                        {attempt.passed === true ? (
                          <span className="status-badge status-badge--pass">Pass</span>
                        ) : attempt.passed === false ? (
                          <span className="status-badge status-badge--fail">Fail</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>{renderIntegrityBadge(attempt.integrityFlag)}</td>
                      <td className="tabular-nums">
                        {formatSubmitted(attempt.submittedAt, attempt.status)}
                      </td>
                      <td className="acts">
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => onReviewAttempt(attempt.attemptId)}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="results-accordion-row">
                        <td colSpan={10}>
                          {attempt.questionBreakdown.length === 0 ? (
                            <p className="results-empty">No question breakdown available.</p>
                          ) : (
                            <table className="results-breakdown-table">
                              <thead>
                                <tr>
                                  <th scope="col">Question</th>
                                  <th scope="col">Prompt</th>
                                  <th scope="col">Points</th>
                                  <th scope="col">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {attempt.questionBreakdown.map((q, qIndex) => (
                                  <tr key={q.questionId || qIndex}>
                                    <td>Q{qIndex + 1}</td>
                                    <td>{q.promptExcerpt}</td>
                                    <td className="tabular-nums">
                                      {q.pointsEarned} / {q.maxPoints}
                                    </td>
                                    <td>
                                      {q.correct === true && (
                                        <span className="status-badge status-badge--pass">
                                          ✓ Correct
                                        </span>
                                      )}
                                      {q.correct === false && (
                                        <span className="status-badge status-badge--fail">
                                          ✗ Incorrect
                                        </span>
                                      )}
                                      {q.correct === null && (
                                        <span className="status-badge">Pending</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <div className="results-pagination">
          <button
            type="button"
            className="button-secondary"
            disabled={isLoadingMore}
            onClick={onLoadMore}
          >
            {isLoadingMore ? "Loading…" : "Load more candidates"}
          </button>
        </div>
      )}
    </div>
  );
}
