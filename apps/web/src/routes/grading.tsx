import { useCallback, useEffect, useState } from "react";
import { ApiError, type ApiClient, type GradingQueueRow } from "../lib/api";
import { GradingQueue } from "../components/organiser/GradingQueue";

// Phase 8b Task 2 (`K15`): the grading screen. A content component, the
// same shape `BankList`/`BankBrowser` already are (`routes/banks.tsx`,
// `routes/bank.tsx`) — `organiser.tsx` owns the one `OrganiserShell`
// instance and the actor/workspace chrome around it, and slots a screen's
// content in; this is the screen, not a second shell.
//
// REACHED FROM THE TEST BUILDER, NOT THE TOP NAV (fix round 1, `AC-26`).
// `D3`'s own ruling (`OrganiserShell.tsx:141-144`) keeps Grading off `NAV` —
// a grader is working on *a test* and goes to its queue, never opens
// "Grading" first and picks a test — so the entry point is the "Grading
// queue" button `routes/test.tsx` renders beside its Results row, gated on
// `attempts.grade`, wired through `organiser.tsx`'s `"grading"` view kind
// (`?view=grading&test=…`, `lib/view-url.ts`). `organiser.tsx` is this
// component's production caller.
//
// `blind` is the one control that re-fetches: whether a candidate's
// registration answers are even IN the payload is a server decision
// (`apps/api/src/grade/award.ts`'s own header), so flipping it has to ask
// again rather than hide a field the browser already received. `mode`
// (by-candidate / by-question) is purely how `GradingQueue` arranges rows
// it already has, so it never re-fetches.

export function GradingRoute({
  workspaceId,
  testId,
  client,
}: {
  workspaceId: string;
  testId: string;
  client: ApiClient;
}) {
  const [rows, setRows] = useState<GradingQueueRow[]>([]);
  const [mode, setMode] = useState<"by-candidate" | "by-question">("by-candidate");
  const [blind, setBlind] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const page = await client.gradingQueue(workspaceId, testId, { blind });
      setRows(page.rows);
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The grading queue could not be loaded.");
    }
  }, [client, workspaceId, testId, blind]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onGrade(row: GradingQueueRow, levels: string[]): Promise<void> {
    try {
      await client.grade(workspaceId, testId, { attemptId: row.attemptId, questionId: row.questionId, award: { levels } });
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "That grade could not be saved. Try again.");
    }
  }

  return (
    <>
      <div className="grading-queue__controls">
        <div className="field">
          <label className="field-label" htmlFor="grading-blind">
            Blind grading
          </label>
          <input
            type="checkbox"
            id="grading-blind"
            checked={blind}
            onChange={(event) => setBlind(event.target.checked)}
          />
          <p className="field-help" id="grading-blind-help">
            Withholds the candidate's registration answers from every row below.
          </p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="grading-mode">
            Group by
          </label>
          <select
            className="text-input"
            id="grading-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as "by-candidate" | "by-question")}
          >
            <option value="by-candidate">Answer</option>
            <option value="by-question">Question</option>
          </select>
        </div>
      </div>

      {error !== undefined && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="organiser-empty">
          <h2 className="organiser-empty__title">Nothing to grade</h2>
          <p className="organiser-empty__body">Every manually-scored answer for this test has already been graded.</p>
        </div>
      ) : (
        <GradingQueue rows={rows} mode={mode} onGrade={onGrade} />
      )}
    </>
  );
}
