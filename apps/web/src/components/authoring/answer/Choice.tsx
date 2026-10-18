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

/** A-Z by first-seen order, stable across a reorder (`options` only moves
 * positions; it never drops and re-adds an id), so "Option B" names the
 * same option for as long as it exists. */
function useLetters(): (id: string) => string {
  const letters = useRef(new Map<string, string>());
  return (id: string) => {
    if (!letters.current.has(id)) {
      letters.current.set(id, String.fromCharCode(65 + letters.current.size));
    }
    return letters.current.get(id)!;
  };
}

function OptionsEditor({
  options,
  mode,
  selected,
  maxSelected,
  onOptionsChange,
  onToggle,
}: {
  options: QuestionOption[];
  mode: "single" | "multi";
  selected: ReadonlySet<string>;
  maxSelected?: number | undefined;
  onOptionsChange: (next: QuestionOption[]) => void;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const letterOf = useLetters();

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
            <label className="field-label" htmlFor={`option-text-${option.id}`}>
              {`Option ${letter} text`}
            </label>
            <input
              className="text-input"
              id={`option-text-${option.id}`}
              type="text"
              value={option.text}
              onChange={(event) => updateText(option.id, event.target.value)}
            />
            <label className="choice-option__flag">
              <input
                type={mode === "single" ? "radio" : "checkbox"}
                name={mode === "single" ? "choice-correct" : undefined}
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
          </div>
        );
      }}
    />
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
  const maxSelected = question.type === "select_k" ? question.k : undefined;
  return (
    <>
      {question.type === "select_k" && <p className="field-help">Mark exactly {question.k} correct options.</p>}
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

const ASSERTION_REASON_OPTIONS: { value: AssertionReasonKey; label: string }[] = [
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
