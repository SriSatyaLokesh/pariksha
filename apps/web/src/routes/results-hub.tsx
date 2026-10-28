import { useEffect, useState } from "react";
import { ApiError, type ApiClient, type TestResultsOverviewItem } from "../lib/api";
import { CardHairline } from "../components/CardHairline";
import { TestStateBadge } from "./tests";

export interface ResultsHubProps {
  client: ApiClient;
  workspaceId: string;
  onSelectTest: (testId: string) => void;
}

export function ResultsHub({ client, workspaceId, onSelectTest }: ResultsHubProps) {
  const [tests, setTests] = useState<TestResultsOverviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await client.resultsOverview(workspaceId);
        if (!cancelled) {
          setTests(res.tests);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Failed to load results overview",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [client, workspaceId]);

  return (
    <div className="results-hub" data-testid="results-view">
      <header className="results-hub__header">
        <h1>Results</h1>
        <p className="page-lead">
          Select a test to review candidate submissions, scores, and exam integrity.
        </p>
      </header>

      {loading ? (
        <p className="organiser__status" role="status">
          Loading…
        </p>
      ) : error ? (
        <p className="organiser__notice" role="alert">
          {error}
        </p>
      ) : tests && tests.length === 0 ? (
        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No tests yet</h2>
          <p className="organiser-empty__body">
            No tests exist yet in this workspace.
          </p>
        </CardHairline>
      ) : tests ? (
        <div
          className="table-scroll"
          role="region"
          aria-label="Tests results overview"
          tabIndex={0}
        >
          <table className="testbuilder-list">
            <thead>
              <tr>
                <th scope="col">Test</th>
                <th scope="col">State</th>
                <th scope="col">Candidates</th>
                <th scope="col">Submissions</th>
                <th scope="col">Class Average</th>
                <th scope="col">Pass Rate</th>
                <th scope="col" className="acts">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tests.map((test) => (
                <tr key={test.id}>
                  <td>
                    <div className="test-name">
                      <strong>{test.name}</strong>
                      <span className="test-id">{test.slug}</span>
                    </div>
                  </td>
                  <td>
                    <TestStateBadge state={test.state} />
                  </td>
                  <td className="tabular-nums">{test.candidateCount}</td>
                  <td className="tabular-nums">
                    {test.submittedCount} / {test.candidateCount}
                  </td>
                  <td className="tabular-nums">
                    {test.averageScore !== null ? `${test.averageScore}%` : "—"}
                  </td>
                  <td className="tabular-nums">
                    {test.passRate !== null
                      ? `${Math.round(test.passRate * 100)}%`
                      : "—"}
                  </td>
                  <td className="acts">
                    <button
                      type="button"
                      className="button-secondary"
                      aria-label={`Open results for ${test.name}`}
                      onClick={() => onSelectTest(test.id)}
                    >
                      Open results
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
