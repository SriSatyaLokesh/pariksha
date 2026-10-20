import { useId } from "react";
import type { ResponseValue } from "@pariksha/core";
import type { CandidateQuestion } from "../../../lib/paper";
import { ASSERTION_REASON_OPTIONS } from "../../answer-common";
import type { AnswerProps } from "./props";

/**
 * The five choice types a candidate answers: `single`, `multiple`,
 * `select_k`, `true_false` and `assertion_reason` — the same family split
 * `components/authoring/answer/Choice.tsx` uses on the editor side, so the
 * two sides stay recognisably the same code shape.
 *
 * Nothing here holds a key, because `CandidateQuestion` has none: the
 * scrubber strips it server-side (S-10). What this file still has to get
 * right is not *leaking* one — no correctness-shaped class name, no
 * data attribute, and no ordering that reveals anything. The options are
 * rendered exactly in the order the pinned layout dealt them.
 */

export const CHOICE_TYPES = [
  "single",
  "multiple",
  "select_k",
  "true_false",
  "assertion_reason",
] as const;

export function isChoiceQuestion(question: CandidateQuestion): boolean {
  return (CHOICE_TYPES as readonly string[]).includes(question.type);
}

/** `true_false`'s options are fixed by the format, not by the author —
 * `TrueFalseQuestion` carries no `options` at all and its key is a
 * boolean. Same for `assertion_reason`, whose four conclusions ARE its
 * `AssertionReasonKey` union; the labels are imported rather than retyped
 * so the candidate reads exactly what the author marked. */
const TRUE_FALSE_OPTIONS = [
  { id: "true", text: "True" },
  { id: "false", text: "False" },
];

const ASSERTION_REASON_CHOICES = ASSERTION_REASON_OPTIONS.map((option) => ({
  id: option.value,
  text: option.label,
}));

function optionsOf(question: CandidateQuestion): { id: string; text: string }[] {
  if (question.type === "true_false") return TRUE_FALSE_OPTIONS;
  if (question.type === "assertion_reason") return ASSERTION_REASON_CHOICES;
  return question.options ?? [];
}

/** Which option ids the current response selects. A response of the wrong
 * `kind` for this question type selects nothing — the same rule
 * `gradeChoice` applies, rather than guessing at a shape. */
function selectedOf(question: CandidateQuestion, value: ResponseValue | null): ReadonlySet<string> {
  if (value === null) return new Set();
  if (question.type === "true_false") {
    return value.kind === "boolean" ? new Set([value.value ? "true" : "false"]) : new Set();
  }
  if (value.kind === "option") return new Set([value.option]);
  if (value.kind === "options") return new Set(value.options);
  return new Set();
}

/** No "correct", no "answer": `S-10` forbids a correctness word in the
 * candidate's DOM, and a legend that said one would put it there. */
function legendOf(question: CandidateQuestion): string {
  switch (question.type) {
    case "multiple":
      return "Choose all that apply";
    case "select_k":
      return `Choose exactly ${String(question.k ?? 1)}`;
    case "true_false":
      return "True or false";
    default:
      return "Choose one";
  }
}

export function Choice({ question, value, onChange, disabled }: AnswerProps) {
  const name = useId();
  const options = optionsOf(question);
  const selected = selectedOf(question, value);
  const multi = question.type === "multiple" || question.type === "select_k";
  const k = question.type === "select_k" ? (question.k ?? options.length) : undefined;
  const atLimit = k !== undefined && selected.size >= k;

  function toggle(id: string, checked: boolean): void {
    if (question.type === "true_false") {
      onChange({ kind: "boolean", value: id === "true" });
      return;
    }
    if (!multi) {
      onChange({ kind: "option", option: id });
      return;
    }
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    // Emitted in the pinned option order, not in click order: the response
    // is a set and two candidates who chose the same options should not
    // produce two different payloads.
    const chosen = options.filter((option) => next.has(option.id)).map((option) => option.id);
    onChange(chosen.length > 0 ? { kind: "options", options: chosen } : null);
  }

  return (
    <>
      {question.type === "assertion_reason" && (
        <dl className="exam-assertion-reason">
          <dt>Assertion</dt>
          <dd>{question.assertion}</dd>
          <dt>Reason</dt>
          <dd>{question.reason}</dd>
        </dl>
      )}
      <fieldset className="exam-options">
        <legend className="exam-options-legend">{legendOf(question)}</legend>
        {k !== undefined && (
          // Present from first render, not inserted with its content: a
          // live region a screen reader has never seen is a live region it
          // does not announce. It is also the non-visual carrier for the
          // lock below — a greyed-out checkbox explains nothing on its own.
          <p className="exam-answer-status" role="status">
            {`${String(selected.size)} of ${String(k)} chosen`}
          </p>
        )}
        {options.map((option) => {
          const isSelected = selected.has(option.id);
          return (
            <label
              key={option.id}
              className={isSelected ? "exam-option-row is-selected" : "exam-option-row"}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                // One shared name per radio group is what gives the
                // browser its arrow-key navigation; a group without it is
                // keyboard-operable only one Tab at a time.
                name={multi ? undefined : name}
                checked={isSelected}
                // An already-chosen option is never locked, or the k-th
                // choice could not be undone.
                disabled={disabled || (atLimit && !isSelected)}
                onChange={(event) => {
                  toggle(option.id, event.target.checked);
                }}
              />
              <span className="exam-option-text">{option.text}</span>
            </label>
          );
        })}
      </fieldset>
    </>
  );
}
