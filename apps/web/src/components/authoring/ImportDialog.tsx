import { useId, useRef, useState } from "react";
import { ApiError, type ApiClient, type ImportReport } from "../../lib/api";

/** Task 8 (#52, P4.8): the extension decides the format — `.csv`/`.gift`
 * are sent as text with `?format=…`, everything else is parsed as JSON
 * the way Task 7 always did. `undefined` means "not a file this dialog
 * accepts", reported rather than guessed at. */
function formatOf(name: string): "json" | "csv" | "gift" | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".gift")) return "gift";
  if (lower.endsWith(".json")) return "json";
  return undefined;
}

// Task 7 (#51, P4.7): the web half of whole-bank import. A file is read and
// parsed locally, then dry-run against the API (`?dryRun=1`) so the report —
// imported or not, and every issue found — renders before anything is
// written; only "Import" sends the real request. The two calls share one
// `ApiClient.importBank` and one report shape (`ImportReport`), which is why
// there is only one render path for "a clean dry run" and "a real import
// that also turned out clean" below.
//
// Task 8: a CSV/GIFT file is read as text, not `JSON.parse`d, and carries
// its own `format` through both calls — `doc` is `unknown` either way
// (a parsed document or a source string), which is what lets this
// component and `ApiClient.importBank` stay agnostic about which.
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
  const [format, setFormat] = useState<"json" | "csv" | "gift">("json");
  const [report, setReport] = useState<ImportReport | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const headingId = useId();
  const fileId = useId();
  // Fix round 1, finding 11: picking file A then quickly picking file B
  // starts two overlapping dry-run requests; without this, A's response can
  // resolve after B's and land A's report (and `doc`) against B's already-
  // chosen file. Each call captures its own generation number and only
  // applies its result if nothing newer has started since.
  const generation = useRef(0);

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    const thisGeneration = ++generation.current;
    setDoc(undefined);
    setReport(undefined);
    setError(undefined);
    if (!file) return;

    const fileFormat = formatOf(file.name);
    if (fileFormat === undefined) {
      setError("Choose a .json, .csv or .gift file.");
      return;
    }

    let parsed: unknown;
    if (fileFormat === "json") {
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        if (thisGeneration === generation.current) setError("That file is not valid JSON.");
        return;
      }
    } else {
      // CSV/GIFT: the converter (apps/api/src/import/csv.ts, gift.ts) reads
      // the text itself — nothing here parses it, same as Task 7 never
      // validated the JSON it parsed.
      parsed = await file.text();
    }

    try {
      const dry = await client.importBank(workspaceId, bankId, parsed, {
        dryRun: true,
        ...(fileFormat !== "json" && { format: fileFormat }),
      });
      if (thisGeneration !== generation.current) return;
      setReport(dry);
      setDoc(parsed);
      setFormat(fileFormat);
    } catch (cause) {
      if (thisGeneration !== generation.current) return;
      setError(cause instanceof ApiError ? cause.message : "The file could not be checked.");
    }
  }

  async function onImport(): Promise<void> {
    if (doc === undefined) return;
    setImporting(true);
    setError(undefined);
    try {
      const result = await client.importBank(workspaceId, bankId, doc, {
        dryRun: false,
        ...(format !== "json" && { format }),
      });
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
        accept="application/json,.json,.csv,.gift"
        onChange={(event) => void onFileChange(event)}
      />
      <p className="field-help">A pariksha/bank@1 JSON file, a CSV file, or a Moodle GIFT file.</p>

      {error !== undefined && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {/* Fix round 1, finding 11: `role="alert"` already implies an
          assertive live region on its own paragraph — wrapping it in a
          second, `aria-live="polite"` region announced the same text twice.
          Only the non-alert "ready to import" message needs a live region
          of its own, and `role="status"` (implicit `aria-live="polite"`)
          is that region without nesting one inside another. */}
      {report !== undefined && hasIssues && (
        <>
          <p className="field-error" role="alert">
            Nothing was imported — {report.issues.length} {report.issues.length === 1 ? "issue" : "issues"} found.
          </p>

          {/* Fix round 1, finding 11: this table is ImportDialog's own, not
              bank-browser's — `.import-dialog__table` (authoring.css) rather
              than borrowing another component's BEM block by class name.
              Task 8: a fourth "Line" column extends the same three-column
              design rather than replacing it with per-row `aria-label`s —
              for a CSV/GIFT import `issue.line` is the only position a
              person can act on (there is no `bank.questions` to show them),
              and it also keeps two otherwise-identical rows (no
              `questionId`, the same field) distinguishable by accessible
              name. */}
          <table className="import-dialog__table">
            <caption className="visually-hidden">Import issues, one row per problem found</caption>
            <thead>
              <tr>
                <th scope="col">Question</th>
                <th scope="col">Line</th>
                <th scope="col">Field</th>
                <th scope="col">Problem</th>
              </tr>
            </thead>
            <tbody>
              {report.issues.map((issue, index) => (
                // `index` is a stable key here — the dry-run report is
                // replaced wholesale on every file change, never patched in
                // place, so there is no row identity to preserve across a
                // reorder.
                <tr key={index}>
                  {/* Fix round 1, finding 14: this used to repeat the line
                      number here too ("line 4") when there was no
                      `questionId` — the Line column already shows it. "—"
                      falls back to the `bank.questions` index only when
                      there is neither a question id nor a line to show. */}
                  <td>{issue.questionId ?? (issue.line === undefined ? `entry ${issue.index}` : "—")}</td>
                  <td>{issue.line ?? "—"}</td>
                  <td>{issue.field}</td>
                  <td>{issue.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {report !== undefined && !hasIssues && (
        <p role="status">
          {report.imported} {report.imported === 1 ? "question" : "questions"} ready to import.
        </p>
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
