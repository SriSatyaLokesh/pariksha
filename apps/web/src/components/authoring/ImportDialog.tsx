import { useId, useState } from "react";
import { ApiError, type ApiClient, type ImportReport } from "../../lib/api";

// Task 7 (#51, P4.7): the web half of whole-bank import. A file is read and
// parsed locally, then dry-run against the API (`?dryRun=1`) so the report —
// imported or not, and every issue found — renders before anything is
// written; only "Import" sends the real request. The two calls share one
// `ApiClient.importBank` and one report shape (`ImportReport`), which is why
// there is only one render path for "a clean dry run" and "a real import
// that also turned out clean" below.
export function ImportDialog({
  workspaceId,
  bankId,
  client,
  onImported,
}: {
  workspaceId: string;
  bankId: string;
  client: ApiClient;
  onImported: (report: ImportReport) => void;
}) {
  const [doc, setDoc] = useState<unknown>(undefined);
  const [report, setReport] = useState<ImportReport | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const headingId = useId();
  const fileId = useId();

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    setDoc(undefined);
    setReport(undefined);
    setError(undefined);
    if (!file) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setError("That file is not valid JSON.");
      return;
    }

    try {
      setReport(await client.importBank(workspaceId, bankId, parsed, { dryRun: true }));
      setDoc(parsed);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The file could not be checked.");
    }
  }

  async function onImport(): Promise<void> {
    if (doc === undefined) return;
    setImporting(true);
    setError(undefined);
    try {
      const result = await client.importBank(workspaceId, bankId, doc, { dryRun: false });
      setReport(result);
      if (result.issues.length === 0) onImported(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The import could not be completed.");
    } finally {
      setImporting(false);
    }
  }

  const hasIssues = report !== undefined && report.issues.length > 0;
  const canImport = report !== undefined && !hasIssues && doc !== undefined;

  return (
    // Not `aria-modal`: like `QuestionEditor`'s own type-change dialog,
    // nothing here traps focus, so claiming "modal" to assistive tech would
    // be a lie the keyboard does not back up.
    <div role="dialog" aria-labelledby={headingId}>
      <h2 id={headingId}>Import questions</h2>

      <label className="field-label" htmlFor={fileId}>
        Bank file
      </label>
      <input
        className="text-input"
        id={fileId}
        type="file"
        accept="application/json,.json"
        onChange={(event) => void onFileChange(event)}
      />
      <p className="field-help">A pariksha/bank@1 JSON file.</p>

      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {report !== undefined && (
        <div aria-live="polite">
          {hasIssues ? (
            <p className="field-error" role="alert">
              Nothing was imported — {report.issues.length}{" "}
              {report.issues.length === 1 ? "issue" : "issues"} found.
            </p>
          ) : (
            <p>
              {report.imported} {report.imported === 1 ? "question" : "questions"} ready to import.
            </p>
          )}

          {hasIssues && (
            <table className="bank-browser__table">
              <caption className="visually-hidden">Import issues, one row per problem found</caption>
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Field</th>
                  <th scope="col">Problem</th>
                </tr>
              </thead>
              <tbody>
                {report.issues.map((issue, index) => (
                  // `index` is a stable key here — the dry-run report is
                  // replaced wholesale on every file change, never patched
                  // in place, so there is no row identity to preserve
                  // across a reorder.
                  <tr key={index}>
                    <td>{issue.questionId ?? `entry ${issue.index}`}</td>
                    <td>{issue.field}</td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <button
        type="button"
        className="button-primary button-primary--surface"
        disabled={!canImport || importing}
        onClick={() => void onImport()}
      >
        Import
      </button>
    </div>
  );
}
