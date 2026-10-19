import { useId, useRef } from "react";
import type {
  AssertionReasonKey,
  AssertionReasonQuestion,
  MultipleQuestion,
  QuestionOption,
  SelectKQuestion,
  SingleQuestion,
  TrueFalseQuestion,
} from "@pariksha/core";
import { ReorderableList } from "../ReorderableList";

export type ChoiceQuestion =
  | SingleQuestion
  | MultipleQuestion
  | SelectKQuestion
  | TrueFalseQuestion
  | AssertionReasonQuestion;

/** Spreadsheet-style A, B, … Z, AA, AB, … — unlike a raw
 * `String.fromCharCode(65 + n)`, this never runs past Z into `[`, `\`, `]`
 * (option 27 would otherwise be named with punctuation, and so would its
 * accessible name). */
function letterAt(n: number): string {
  let result = "";
  let i = n;
  do {
    result = String.fromCharCode(65 + (i % 26)) + result;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return result;
}

/** A-Z… by first-seen order, stable across a reorder (`options` only moves
 * positions; it never drops and re-adds an id), so "Option B" names the
 * same option for as long as it exists. */
function useLetters(): (id: string) => string {
  const letters = useRef(new Map<string, string>());
  return (id: string) => {
    if (!letters.current.has(id)) {
      letters.current.set(id, letterAt(letters.current.size));
    }
    return letters.current.get(id)!;
  };
}

/** The lowercase, schema-legal counterpart to `letterAt` for generating a
 * fresh option id: single lowercase letters first (matching the ids
 * `defaultExtra` already hands out), then `option-N` once those run out —
 * never colliding with whatever ids already exist. */
function newOptionId(existing: readonly QuestionOption[]): string {
  const used = new Set(existing.map((option) => option.id));
  for (let i = 0; i < 26; i++) {
    const candidate = String.fromCharCode(97 + i);
    if (!used.has(candidate)) return candidate;
  }
  let n = existing.length + 1;
  while (used.has(`option-${n}`)) n++;
  return `option-${n}`;
}

function OptionsEditor({
  options,
  mode,
  selected,
  maxSelected,
  onOptionsChange,
  onToggle,
  onAddOption,
  onRemoveOption,
}: {
  options: QuestionOption[];
  mode: "single" | "multi";
  selected: ReadonlySet<string>;
  maxSelected?: number | undefined;
  onOptionsChange: (next: QuestionOption[]) => void;
  onToggle: (id: string, checked: boolean) => void;
  onAddOption: () => void;
  onRemoveOption: (id: string) => void;
}) {
  const uid = useId();
  const letterOf = useLetters();
  // schemas/question-1.json's `options` def requires minItems: 2.
  const canRemove = options.length > 2;

  function updateText(id: string, text: string): void {
    onOptionsChange(options.map((option) => (option.id === id ? { ...option, text } : option)));
  }

  function togglePinned(id: string): void {
    onOptionsChange(
      options.map((option) => (option.id === id ? { ...option, pinned: !option.pinned } : option)),
    );
  }

  function moveOption(from: number, to: number): void {
    const next = [...options];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onOptionsChange(next);
  }

  return (
    <>
      <ReorderableList
        items={options}
        keyOf={(option) => option.id}
        labelOf={(option) => `Option ${letterOf(option.id)}`}
        legend="Options"
        onReorder={moveOption}
        renderItem={(option) => {
          const letter = letterOf(option.id);
          const isSelected = selected.has(option.id);
          const disabled = mode === "multi" && maxSelected !== undefined && !isSelected && selected.size >= maxSelected;
          return (
            <div className="choice-option">
              <label className="field-label" htmlFor={`${uid}-option-text-${option.id}`}>
                {`Option ${letter} text`}
              </label>
              <input
                className="text-input"
                id={`${uid}-option-text-${option.id}`}
                type="text"
                value={option.text}
                onChange={(event) => updateText(option.id, event.target.value)}
              />
              <label className="choice-option__flag">
                <input
                  type={mode === "single" ? "radio" : "checkbox"}
                  name={mode === "single" ? `${uid}-choice-correct` : undefined}
                  checked={isSelected}
                  disabled={disabled}
                  onChange={(event) => onToggle(option.id, event.target.checked)}
                />
                {`Option ${letter} is correct`}
              </label>
              <label className="choice-option__flag">
                <input
                  type="checkbox"
                  checked={option.pinned === true}
                  onChange={() => togglePinned(option.id)}
                />
                {`Pin option ${letter}`}
              </label>
              <button
                type="button"
                className="button-secondary"
                disabled={!canRemove}
                onClick={() => onRemoveOption(option.id)}
              >
                {`Remove option ${letter}`}
              </button>
            </div>
          );
        }}
      />
      <button type="button" className="prompt-editor__tool" onClick={onAddOption}>
        Add option
      </button>
    </>
  );
}

function SingleAnswer({
  question,
  onChange,
}: {
  question: SingleQuestion;
  onChange: (next: SingleQuestion) => void;
}) {
  return (
    <OptionsEditor
      options={question.options}
      mode="single"
      selected={new Set([question.key])}
      onOptionsChange={(options) => onChange({ ...question, options })}
      onToggle={(id) => onChange({ ...question, key: id })}
      onAddOption={() => {
        const id = newOptionId(question.options);
        onChange({ ...question, options: [...question.options, { id, text: "" }] });
      }}
      onRemoveOption={(id) => {
        const options = question.options.filter((option) => option.id !== id);
        // The correct option can be removed too; the first survivor
        // becomes correct rather than leaving `key` pointing at nothing.
        const key = question.key === id ? (options[0]?.id ?? "") : question.key;
        onChange({ ...question, options, key });
      }}
    />
  );
}

function MultiAnswer({
  question,
  onChange,
}: {
  question: MultipleQuestion | SelectKQuestion;
  onChange: (next: MultipleQuestion | SelectKQuestion) => void;
}) {
  const kId = useId();
  const maxSelected = question.type === "select_k" ? question.k : undefined;

  function withOptions(options: QuestionOption[], key: string[]): MultipleQuestion | SelectKQuestion {
    if (question.type !== "select_k") return { ...question, options, key };
    // k must stay < options.length (validate.ts) — shrinking the list can
    // force it down; key is trimmed to match if it shrinks under it.
    const k = Math.max(1, Math.min(question.k, options.length - 1));
    return { ...question, options, key: key.slice(0, k), k };
  }

  return (
    <>
      {question.type === "select_k" && (
        <>
          <label className="field-label" htmlFor={kId}>
            How many options are correct (k)
          </label>
          <input
            className="text-input"
            id={kId}
            type="number"
            min={1}
            max={Math.max(1, question.options.length - 1)}
            value={question.k}
            onChange={(event) => {
              const k = Number(event.target.value);
              if (!Number.isInteger(k) || k < 1) return;
              onChange({ ...question, k, key: question.key.slice(0, k) });
            }}
          />
          <p className="field-help">Mark exactly {question.k} correct options.</p>
        </>
      )}
      <OptionsEditor
        options={question.options}
        mode="multi"
        selected={new Set(question.key)}
        maxSelected={maxSelected}
        onOptionsChange={(options) => onChange({ ...question, options })}
        onToggle={(id, checked) => {
          const key = checked ? [...question.key, id] : question.key.filter((existing) => existing !== id);
          onChange({ ...question, key });
        }}
        onAddOption={() => {
          const id = newOptionId(question.options);
          onChange({ ...question, options: [...question.options, { id, text: "" }] });
        }}
        onRemoveOption={(id) => {
          const options = question.options.filter((option) => option.id !== id);
          const key = question.key.filter((existing) => existing !== id);
          onChange(withOptions(options, key));
        }}
      />
    </>
  );
}

function TrueFalseAnswer({
  question,
  onChange,
}: {
  question: TrueFalseQuestion;
  onChange: (next: TrueFalseQuestion) => void;
}) {
  const id = useId();
  return (
    <fieldset className="choice-true-false">
      <legend>Correct answer</legend>
      <label>
        <input
          type="radio"
          name={id}
          checked={question.key === true}
          onChange={() => onChange({ ...question, key: true })}
        />
        True
      </label>
      <label>
        <input
          type="radio"
          name={id}
          checked={question.key === false}
          onChange={() => onChange({ ...question, key: false })}
        />
        False
      </label>
    </fieldset>
  );
}

/** The four conclusions `assertion_reason` allows, which ARE its
 * `AssertionReasonKey` union. Exported because the candidate's own input
 * (`components/exam/answer/Choice.tsx`) must offer exactly these, with
 * exactly these ids — a second copy of the labels is a second thing to
 * keep in step with the key. */
export const ASSERTION_REASON_OPTIONS: { value: AssertionReasonKey; label: string }[] = [
  { value: "both_true_explains", label: "Both true, and the reason explains the assertion" },
  { value: "both_true_not_explains", label: "Both true, but the reason does not explain the assertion" },
  { value: "a_true_r_false", label: "The assertion is true and the reason is false" },
  { value: "a_false_r_true", label: "The assertion is false and the reason is true" },
];

function AssertionReasonAnswer({
  question,
  onChange,
}: {
  question: AssertionReasonQuestion;
  onChange: (next: AssertionReasonQuestion) => void;
}) {
  const id = useId();
  return (
    <div className="choice-assertion-reason">
      <label className="field-label" htmlFor={`${id}-assertion`}>
        Assertion
      </label>
      <textarea
        className="text-input"
        id={`${id}-assertion`}
        value={question.assertion}
        onChange={(event) => onChange({ ...question, assertion: event.target.value })}
      />
      <label className="field-label" htmlFor={`${id}-reason`}>
        Reason
      </label>
      <textarea
        className="text-input"
        id={`${id}-reason`}
        value={question.reason}
        onChange={(event) => onChange({ ...question, reason: event.target.value })}
      />
      <fieldset>
        <legend>Correct answer</legend>
        {ASSERTION_REASON_OPTIONS.map((option) => (
          <label key={option.value}>
            <input
              type="radio"
              name={`${id}-key`}
              checked={question.key === option.value}
              onChange={() => onChange({ ...question, key: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function Choice({
  question,
  onChange,
}: {
  question: ChoiceQuestion;
  onChange: (next: ChoiceQuestion) => void;
}) {
  switch (question.type) {
    case "single":
      return <SingleAnswer question={question} onChange={onChange} />;
    case "multiple":
    case "select_k":
      return <MultiAnswer question={question} onChange={onChange} />;
    case "true_false":
      return <TrueFalseAnswer question={question} onChange={onChange} />;
    case "assertion_reason":
      return <AssertionReasonAnswer question={question} onChange={onChange} />;
  }
}

export const CHOICE_TYPES = ["single", "multiple", "select_k", "true_false", "assertion_reason"] as const;

export function isChoiceQuestion(question: { type: string }): question is ChoiceQuestion {
  return (CHOICE_TYPES as readonly string[]).includes(question.type);
}
