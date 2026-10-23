import { useId, type JSX } from "react";
import type { GradingQueueRow } from "../../lib/api";

// Phase 8b Task 2 (`K15`): the grading queue a Reviewer actually works in —
// blind, and groupable by question.
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
  if (value && typeof value === "object" && (value as { kind?: unknown }).kind === "text") {
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
  return entries.map(([field, value]) => `${field}: ${String(value)}`).join(", ");
}

interface QuestionGroup {
  questionId: string;
  /** "Question 1", "Question 2", ... by order of first appearance in
   *  `rows` — this component numbers the question set it was handed, not a
   *  position in the test's own section order, which it is never given. */
  label: string;
  rows: GradingQueueRow[];
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
}: {
  row: GradingQueueRow;
  onGrade?: ((row: GradingQueueRow, levels: string[]) => void | Promise<void>) | undefined;
}): JSX.Element {
  const ids = useId();
  const rubric = row.question.rubric ?? [];
  const selected = row.award?.levels[0] ?? null;
  const text = answerText(row.value);

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
        <p className="field-help">This question has no rubric and cannot be graded.</p>
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
    </article>
  );
}

export function GradingQueue({
  rows,
  mode = "by-candidate",
  onGrade,
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
}): JSX.Element {
  if (mode === "by-question") {
    const groups = groupByQuestion(rows);
    return (
      <div className="grading-queue">
        {groups.map((group) => {
          const headingId = `grading-queue-${group.questionId}`;
          return (
            <section className="grading-queue__group" key={group.questionId} aria-labelledby={headingId}>
              <h2 className="organiser-empty__title" id={headingId}>
                {group.label}
              </h2>
              <div className="grading-queue__cards">
                {group.rows.map((row) => (
                  <QueueCard key={`${row.attemptId}-${row.questionId}`} row={row} onGrade={onGrade} />
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
        <QueueCard key={`${row.attemptId}-${row.questionId}`} row={row} onGrade={onGrade} />
      ))}
    </div>
  );
}
