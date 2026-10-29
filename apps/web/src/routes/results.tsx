import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  type ApiClient,
  type ResultsQueryOptions,
  type TestResultAttempt,
  type TestResultsPayload,
} from "../lib/api";
import { CardHairline } from "../components/CardHairline";
import { ResultsTable } from "../components/organiser/ResultsTable";

export interface ResultsRouteProps {
  client: ApiClient;
  workspaceId: string;
  testId: string;
  onBack: () => void;
  onReviewAttempt: (attemptId: string) => void;
}

export function ResultsRoute({
  client,
  workspaceId,
  testId,
  onBack,
  onReviewAttempt,
}: ResultsRouteProps) {
  const [payload, setPayload] = useState<TestResultsPayload | null>(null);
  const [results, setResults] = useState<TestResultAttempt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ResultsQueryOptions>({});

  const loadInitial = useCallback(
    async (queryOpts: ResultsQueryOptions = {}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await client.testResults(workspaceId, testId, queryOpts);
        setPayload(res);
        setResults(res.results);
        setNextCursor(res.nextCursor);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : "Failed to load test results",
        );
      } finally {
        setLoading(false);
      }
    },
    [client, workspaceId, testId],
  );

  useEffect(() => {
    void loadInitial(filters);
  }, [loadInitial, filters]);

  const handleFilterChange = (newFilters: { status: string; integrity: string; search: string }) => {
    const opts: ResultsQueryOptions = {};
    if (newFilters.status && newFilters.status !== "all") {
      opts.status = newFilters.status as ResultsQueryOptions["status"];
    }
    if (newFilters.integrity && newFilters.integrity !== "all") {
      opts.integrity = newFilters.integrity as ResultsQueryOptions["integrity"];
    }
    if (newFilters.search.trim()) {
      opts.search = newFilters.search.trim();
    }
    setFilters(opts);
  };

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await client.testResults(workspaceId, testId, {
        ...filters,
        cursor: nextCursor,
      });
      setResults((prev) => [...prev, ...res.results]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
          ? err.message
          : "Failed to load more results",
      );
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading && !payload) {
    return (
      <main id="main-content" className="organiser organiser--wide">
        <p className="organiser__status" role="status">
          Loading test results…
        </p>
      </main>
    );
  }

  if (error && !payload) {
    return (
      <main id="main-content" className="organiser organiser--wide">
        <p className="field-error" role="alert">
          {error}
        </p>
        <button type="button" className="button" onClick={onBack}>
          ← Back to Results Hub
        </button>
      </main>
    );
  }

  if (!payload) {
    return null;
  }

  const { test, summary } = payload;

  return (
    <main id="main-content" className="organiser organiser--wide" data-testid="test-results-view">
      <header className="results-header">
        <button
          type="button"
          className="button-secondary results-back-btn"
          onClick={onBack}
        >
          ← Back to Results Hub
        </button>
        <div className="results-title-row">
          <h1>{test.title}</h1>
        </div>
      </header>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {/* 4 Summary metric cards */}
      <div className="results-summary-grid">
        <CardHairline className="results-summary-card">
          <span className="results-summary-card__label">Registered Candidates</span>
          <span className="results-summary-card__value tabular-nums">
            {summary.totalRegistered}
          </span>
        </CardHairline>

        <CardHairline className="results-summary-card">
          <span className="results-summary-card__label">Submitted</span>
          <span className="results-summary-card__value tabular-nums">
            {summary.submittedCount}
          </span>
          <span className="results-summary-card__subtext">
            {summary.inProgressCount} in progress, {summary.lockedCount} locked
          </span>
        </CardHairline>

        <CardHairline className="results-summary-card">
          <span className="results-summary-card__label">Class Average</span>
          <span className="results-summary-card__value tabular-nums">
            {summary.averageScore !== null ? `${summary.averageScore}%` : "—"}
          </span>
        </CardHairline>

        <CardHairline className="results-summary-card">
          <span className="results-summary-card__label">Pass Rate</span>
          <span className="results-summary-card__value tabular-nums">
            {summary.passRate !== null ? `${Math.round(summary.passRate * 100)}%` : "—"}
          </span>
          {test.passMark !== null && (
            <span className="results-summary-card__subtext">
              Pass mark: {test.passMark}%
            </span>
          )}
        </CardHairline>
      </div>

      <ResultsTable
        testId={testId}
        workspaceId={workspaceId}
        client={client}
        results={results}
        totalPoints={test.totalPoints}
        passMark={test.passMark}
        nextCursor={nextCursor}
        onLoadMore={handleLoadMore}
        isLoadingMore={loadingMore}
        onReviewAttempt={onReviewAttempt}
        onFilterChange={handleFilterChange}
      />
    </main>
  );
}
