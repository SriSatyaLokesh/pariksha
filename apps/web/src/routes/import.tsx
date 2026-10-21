import { useId, useRef, useState } from "react";
import { sampleBank, SAMPLE_BANK_FILENAME } from "@pariksha/core";
import { ApiError, type ApiClient, type ImportReport, type TestImportReport } from "../lib/api";
import { downloadJson } from "../lib/download";

/**
 * Import, as a page (`D18`, owner's preference): "linkable, no focus trap,
 * room for a long report, sticky action bar. It carries **Download a
 * sample** — generated from `schemas/question-1.json`, one question of
 * every type, so it cannot drift from what the importer accepts."
 *
 * This is `components/authoring/ImportDialog.tsx` moved and unwrapped. What
 * went: `role="dialog"`, `useDialogKeys` (the focus grab, the Escape
 * handler, the focus return) and the `onClose` prop that was the `false`
 * half of each route's Import toggle. A page's way out is the browser's
 * own Back and the rail, both of which exist without this screen doing
 * anything.
 *
 * What did NOT go: every rule. The dry run comes first, the report is the
 * same positioned table, and the import stays all-or-nothing — this task
 * moved the surface, not the validation. `apps/web/test/authoring/
 * import.test.tsx` carries those tests, now clicked from `OrganiserApp`.
 *
 * `kind` is still the only switch, and still has two call sites: a bank
 * import (`?view=import&bank=bnk_1`) and a whole-test import
 * (`?view=import`). It chooses the call, the copy, which extensions the
 * picker offers — and now whether the sample is offered at all, because
 * the sample is a `pariksha/bank@1` document and handing it to the test
 * importer would be handing someone a file that cannot work.
 */
export interface ImportResult {
  imported: number;
  issues: ImportReport["issues"];
  rebound?: TestImportReport["rebound"];
}

/** Task 8 (#52, P4.8): the extension decides the format — `.csv`/`.gift`
 * are sent as text with `?format=…`, everything else is parsed as JSON
 * the way Task 7 always did. `undefined` means "not a file this page
 * accepts", reported rather than guessed at. */
function formatOf(name: string): "json" | "csv" | "gift" | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".gift")) return "gift";
  if (lower.endsWith(".json")) return "json";
  return undefined;
}

const COPY = {
  bank: {
    fileLabel: "Bank file",
    help: "A pariksha/bank@1 JSON file, a CSV file, or a Moodle GIFT file.",
    accept: "application/json,.json,.csv,.gift",
    wrongFile: "Choose a .json, .csv or .gift file.",
    unit: ["question", "questions"] as const,
  },
  test: {
    // JSON only: there is no CSV or GIFT shape for a whole test, and
    // offering an extension nothing can read is worse than not offering it.
    fileLabel: "Test file",
    help: "A pariksha/test@1 JSON file. The questions it names have to be in this workspace already.",
    accept: "application/json,.json",
    wrongFile: "Choose a .json file.",
    unit: ["test", "tests"] as const,
  },
} as const;

export function ImportScreen({
  workspaceId,
  bankId,
  client,
  onImported,
  kind = "bank",
}: {
  workspaceId: string;
  /** Required for `kind: "bank"`; a test import creates its own test and
   * names no bank. That asymmetry is also the URL's: `?view=import&bank=…`
   * is a bank import and `?view=import` alone is a test one. */
  bankId?: string | undefined;
  client: ApiClient;
  /** Where a clean import goes next — the bank it filled, or the test
   * list. The dialog closed itself and told its route to re-fetch; a page
   * navigates, which is the same move one level up. */
  onImported: (report: ImportResult) => void;
  kind?: "bank" | "test";
}) {
  const [doc, setDoc] = useState<unknown>(undefined);
  const [format, setFormat] = useState<"json" | "csv" | "gift">("json");
  const [report, setReport] = useState<ImportResult | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [importing, setImporting] = useState(false);
  const fileId = useId();
  // Fix round 1, finding 11 (carried from `ImportDialog`): picking file A
  // then quickly picking file B starts two overlapping dry-run requests;
  // without this, A's response can resolve after B's and land A's report
  // (and `doc`) against B's already-chosen file. Each call captures its own
  // generation number and only applies its result if nothing newer has
  // started since.
  const generation = useRef(0);
  const copy = COPY[kind];

  /** The one call both the dry run and the real import make. A test import
   * answers `{ testId, imported: boolean, rebound }`; it is adapted to this
   * page's own count-shaped report here rather than teaching the table two
   * shapes. */
  async function run(parsed: unknown, dryRun: boolean, fileFormat: "json" | "csv" | "gift"): Promise<ImportResult> {
    if (kind === "test") {
      const result = await client.importTest(workspaceId, parsed, { dryRun });
      return { imported: result.imported ? 1 : 0, issues: result.issues, rebound: result.rebound };
    }
    return client.importBank(workspaceId, bankId ?? "", parsed, {
      dryRun,
      ...(fileFormat !== "json" && { format: fileFormat }),
    });
  }

  async function onFileChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    const thisGeneration = ++generation.current;
    setDoc(undefined);
    setReport(undefined);
    setError(undefined);
    if (!file) return;

    const fileFormat = kind === "test" ? (file.name.toLowerCase().endsWith(".json") ? "json" : undefined) : formatOf(file.name);
    if (fileFormat === undefined) {
      setError(copy.wrongFile);
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
      const dry = await run(parsed, true, fileFormat);
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
      const result = await run(doc, false, format);
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
    // A fragment, not a wrapper: `D3a` makes every direct child of
    // `.shell__page` its own scroll container below 719px, and a wrapper
    // would become the nearest scrollport for the action bar below — which
    // is exactly as tall as its own content, so `position: sticky` inside
    // it would be silently inert at phone width. The page's children are
    // the page's children.
    <>
      <div className="import">
        <p className="import__lead">{copy.help}</p>

        <label className="field-label" htmlFor={fileId}>
          {copy.fileLabel}
        </label>
        <input
          className="text-input"
          id={fileId}
          type="file"
          accept={copy.accept}
          onChange={(event) => void onFileChange(event)}
        />

        {error !== undefined && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        {/* `role="alert"` already implies an assertive live region on its own
            paragraph — wrapping it in a second, `aria-live="polite"` region
            announced the same text twice. Only the non-alert "ready to
            import" message needs a live region of its own, and
            `role="status"` (implicit `aria-live="polite"`) is that region
            without nesting one inside another. */}
        {report !== undefined && hasIssues && (
          <>
            <p className="field-error" role="alert">
              Nothing was imported — {report.issues.length} {report.issues.length === 1 ? "issue" : "issues"} found.
            </p>

            {/* `.import-dialog__table` (authoring.css) is kept by name: the
                bank browser's export-issue table renders the same block,
                so this class outlived the dialog it was named for. Renaming
                it is a sweep of its own, not this task's.

                Task 8: a fourth "Line" column extends the same three-column
                design rather than replacing it with per-row `aria-label`s —
                for a CSV/GIFT import `issue.line` is the only position a
                person can act on (there is no `bank.questions` to show
                them), and it also keeps two otherwise-identical rows (no
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
                  // replaced wholesale on every file change, never patched
                  // in place, so there is no row identity to preserve
                  // across a reorder.
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

        {/* #63's own line: a question that resolved into a bank other than
            the file's `banks` entry implied still imports, and the page
            says which — silently rebinding it is how an organiser publishes
            a paper drawn from the wrong bank. */}
        {report !== undefined && (report.rebound?.length ?? 0) > 0 && (
          <ul className="import-dialog__rebound">
            {report.rebound?.map((entry) => (
              <li key={entry.questionId}>
                {entry.questionId} resolved to bank “{entry.bankName}”
              </li>
            ))}
          </ul>
        )}

        {report !== undefined && !hasIssues && (
          <p role="status">
            {report.imported} {report.imported === 1 ? copy.unit[0] : copy.unit[1]} ready to import.
          </p>
        )}
      </div>

      {/* `D18`'s sticky action bar. It is a sibling of the report, not its
          footer, so a long report scrolls under a bar that stays reachable
          — the whole reason a page could carry a long report in the first
          place. */}
      <div className="import__bar">
        <button
          type="button"
          className="button-primary button-primary--surface"
          disabled={!canImport || importing}
          onClick={() => void onImport()}
        >
          Import
        </button>

        {/* Bank only. The sample is a `pariksha/bank@1` document; the test
            importer would refuse it, and a button that hands someone a file
            their next click rejects is worse than no button. */}
        {kind === "bank" && (
          <button
            type="button"
            className="button-secondary"
            onClick={() => downloadJson(sampleBank(), SAMPLE_BANK_FILENAME)}
          >
            Download a sample
          </button>
        )}
      </div>
    </>
  );
}
