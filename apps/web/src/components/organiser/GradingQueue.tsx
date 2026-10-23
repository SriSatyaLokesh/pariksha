import { useId, useState, type JSX } from "react";
import type { GradingQueueRow, Verdict } from "../../lib/api";

// Phase 8b Task 2 (`K15`): the grading queue a Reviewer actually works in —
// blind, and groupable by question.
//
// Phase 8b Task 3 (`K16`): the verdict control. A verdict is per-*attempt*,
// not per-answer, so it is shown once per attempt — the first row this
// component renders for a given `attemptId` — never once per question, or
// a two-question attempt would carry two independent pickers a reviewer
// could set to disagree with each other. It never changes the score, and a
// regrade never changes it: see `packages/db/src/repo/review.ts`'s header
// for why the two are deliberately uncoupled.
//
// BLIND IS A SERVER FACT, NOT A COMPONENT ONE. This file never asks whether
// grading is blind: it renders whatever `row.formValues` holds, and renders
// nothing identifying when that key is absent. The caller decides blindness
// by which fetch it made (`apiClient.gradingQueue(..., { blind: true })`);
// this component has no "blind" prop and no branch that could leak a name
// past a filter — the only way the field is ever withheld is that it was
// never sent (`apps/api/src/grade/award.ts`'s own header makes the same
// point from the server side).
//
// EVERY PIECE OF TEXT REUSES AN ALREADY-PAINTED SELECTOR. `.card-hairline`,
// `.organiser-empty__title`, `.organiser__status`, `.field-help`,
// `.field-label`, `.mono-caption` and `.form-builder__field`'s legend rule
// all carry `SURFACE` entries in `contrast-usage.test.ts` already — nothing
// in `grading.css` declares a `color` of its own, so this screen adds no new
// row to that gate. Native `input[type="radio"]` is already painted for the
// organiser ground by `registration.css`'s one-checkbox-and-one-radio rule
// (`D17`), through `--control-accent`/`--control-edge`, which `admin.css`
// already aliases — so the rubric picker needed no paint of its own either.

/** One ungraded (or already-graded) manual answer, as `GradingQueueRow`
 *  comes back from `apiClient.gradingQueue` — re-exported here so a caller
 *  importing this component does not also need `lib/api`. */
export type { GradingQueueRow };

function answerText(value: unknown): string | null {
  if (
    value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "text"
  ) {
    const text = (value as { text?: unknown }).text;
    if (typeof text === "string" && text.trim().length > 0) return text;
  }
  return null;
}

/** `row.formValues` present (not blind) joins every registration field into
 *  one compact line; absent (blind) says so instead of showing nothing,
 *  which would read as a loading state rather than a deliberate one. */
function identityLabel(row: GradingQueueRow): string {
  if (row.formValues === undefined) return "Blind — candidate withheld";
  const entries = Object.entries(row.formValues);
  if (entries.length === 0) return "No registration details";
  return entries
    .map(([field, value]) => `${field}: ${String(value)}`)
    .join(", ");
}

interface QuestionGroup {
  questionId: string;
  /** "Question 1", "Question 2", ... by order of first appearance in
   *  `rows` — this component numbers the question set it was handed, not a
   *  position in the test's own section order, which it is never given. */
  label: string;
  rows: GradingQueueRow[];
}

const VERDICTS: readonly Verdict[] = ["clear", "suspicious", "disqualified"];

const VERDICT_LABEL: Record<Verdict, string> = {
  clear: "Clear",
  suspicious: "Suspicious",
  disqualified: "Disqualified",
};

/** The first row object for each distinct `attemptId`, in `rows`' own
 *  order — what decides which single card carries the verdict control (see
 *  the header above). A `Set` of the row objects themselves, not of
 *  indices: `groupByQuestion` reorders rows into groups but reuses the
 *  same row references, so membership here still means "the first one",
 *  wherever it ends up rendered. */
function firstRowPerAttempt(
  rows: readonly GradingQueueRow[],
): Set<GradingQueueRow> {
  const seenAttempts = new Set<string>();
  const firstRows = new Set<GradingQueueRow>();
  for (const row of rows) {
    if (seenAttempts.has(row.attemptId)) continue;
    seenAttempts.add(row.attemptId);
    firstRows.add(row);
  }
  return firstRows;
}

function groupByQuestion(rows: readonly GradingQueueRow[]): QuestionGroup[] {
  const order: string[] = [];
  const byQuestion = new Map<string, GradingQueueRow[]>();
  for (const row of rows) {
    let group = byQuestion.get(row.questionId);
    if (group === undefined) {
      group = [];
      byQuestion.set(row.questionId, group);
      order.push(row.questionId);
    }
    group.push(row);
  }
  return order.map((questionId, index) => ({
    questionId,
    label: `Question ${String(index + 1)}`,
    rows: byQuestion.get(questionId) ?? [],
  }));
}

function QueueCard({
  row,
  onGrade,
  showVerdict,
  onVerdict,
}: {
  row: GradingQueueRow;
  onGrade?:
    | ((row: GradingQueueRow, levels: string[]) => void | Promise<void>)
    | undefined;
  /** This card carries the verdict control — the first row rendered for
   *  `row.attemptId` (`firstRowPerAttempt`), never every row. */
  showVerdict?: boolean;
  onVerdict?:
    | ((
        attemptId: string,
        verdict: Verdict,
        note?: string,
      ) => void | Promise<void>)
    | undefined;
}): JSX.Element {
  const ids = useId();
  const rubric = row.question.rubric ?? [];
  const selected = row.award?.levels[0] ?? null;
  const text = answerText(row.value);
  // The note is free text typed ahead of a verdict pick, so it needs its
  // own state — unlike the rubric above, which has nothing to hold before
  // the reviewer clicks. Sent along with whichever verdict is picked next,
  // never on its own: `recordVerdict` (`apps/api/src/grade/verdict.ts`)
  // takes a verdict and an optional note together, not a note alone.
  const [note, setNote] = useState("");

  return (
    <article
      className="card-hairline grading-queue__card"
      aria-label={`${identityLabel(row)} — ${row.question.prompt}`}
    >
      <p className="mono-caption">{identityLabel(row)}</p>
      <p className="field-help">{row.question.prompt}</p>
      <p className="organiser__status">{text ?? "No answer given."}</p>
      {rubric.length === 0 ? (
        // `K15` brief, Step 2: a question authored with no rubric cannot be
        // graded (`gradeManual`/`recordAward` both refuse it) — said in
        // words, never an empty picker a reviewer could click through.
        <p className="field-help">
          This question has no rubric and cannot be graded.
        </p>
      ) : (
        <fieldset className="form-builder__field grading-queue__rubric">
          <legend>Grade</legend>
          <div className="grading-queue__options">
            {rubric.map((level) => {
              const optionId = `${ids}-${level.level}`;
              return (
                <div className="grading-queue__option" key={level.level}>
                  <input
                    type="radio"
                    id={optionId}
                    name={`${ids}-rubric`}
                    value={level.level}
                    checked={selected === level.level}
                    onChange={() => void onGrade?.(row, [level.level])}
                  />
                  <label className="field-label" htmlFor={optionId}>
                    {level.level}
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      )}
      {showVerdict === true && onVerdict !== undefined && (
        <fieldset className="form-builder__field grading-queue__rubric">
          <legend>Verdict</legend>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-verdict-note`}>
              Note
            </label>
            <input
              type="text"
              className="text-input"
              id={`${ids}-verdict-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional — what a later reviewer should know"
            />
          </div>
          <div className="grading-queue__options">
            {VERDICTS.map((verdict) => {
              const optionId = `${ids}-verdict-${verdict}`;
              return (
                <div className="grading-queue__option" key={verdict}>
                  <input
                    type="radio"
                    id={optionId}
                    name={`${ids}-verdict`}
                    value={verdict}
                    onChange={() =>
                      void onVerdict(
                        row.attemptId,
                        verdict,
                        note.trim() === "" ? undefined : note,
                      )
                    }
                  />
                  <label className="field-label" htmlFor={optionId}>
                    {VERDICT_LABEL[verdict]}
                  </label>
                </div>
              );
            })}
          </div>
          <p className="field-help">
            Appends a new verdict — it never overwrites or deletes an earlier
            one, and never changes this attempt's score.
          </p>
        </fieldset>
      )}
    </article>
  );
}

export function GradingQueue({
  rows,
  mode = "by-candidate",
  onGrade,
  onVerdict,
}: {
  rows: readonly GradingQueueRow[];
  /** "by-candidate" (default): every row in the order it arrived, one
   *  article per answer. "by-question": the same rows grouped under a
   *  "Question N" heading per distinct question. */
  mode?: "by-candidate" | "by-question";
  /** Fires once per rubric pick — this component auto-saves on selection,
   *  the same instant-apply shape `ProctoringPanel`'s own controls use,
   *  rather than holding a draft behind a second "Save" click. */
  onGrade?: (row: GradingQueueRow, levels: string[]) => void | Promise<void>;
  /** Fires once per verdict pick (`K16`). Rendered on exactly one card per
   *  attempt — omitted entirely (not merely hidden) when absent, so a
   *  Reviewer with no verdict callback wired sees no verdict control at
   *  all rather than a dead one. */
  onVerdict?: (
    attemptId: string,
    verdict: Verdict,
    note?: string,
  ) => void | Promise<void>;
}): JSX.Element {
  const firstRows = firstRowPerAttempt(rows);

  if (mode === "by-question") {
    const groups = groupByQuestion(rows);
    return (
      <div className="grading-queue">
        {groups.map((group) => {
          const headingId = `grading-queue-${group.questionId}`;
          return (
            <section
              className="grading-queue__group"
              key={group.questionId}
              aria-labelledby={headingId}
            >
              <h2 className="organiser-empty__title" id={headingId}>
                {group.label}
              </h2>
              <div className="grading-queue__cards">
                {group.rows.map((row) => (
                  <QueueCard
                    key={`${row.attemptId}-${row.questionId}`}
                    row={row}
                    onGrade={onGrade}
                    showVerdict={firstRows.has(row)}
                    onVerdict={onVerdict}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grading-queue">
      {rows.map((row) => (
        <QueueCard
          key={`${row.attemptId}-${row.questionId}`}
          row={row}
          onGrade={onGrade}
          showVerdict={firstRows.has(row)}
          onVerdict={onVerdict}
        />
      ))}
    </div>
  );
}
