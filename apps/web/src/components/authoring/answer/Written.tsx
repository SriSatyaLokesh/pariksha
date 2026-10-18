import { useId } from "react";
import type {
  Blank,
  FillBlankQuestion,
  LongAnswerQuestion,
  NumericKey,
  NumericQuestion,
  Question,
  RubricLevel,
  ShortAnswerQuestion,
} from "@pariksha/core";
import { validateBank } from "@pariksha/core";

export type WrittenQuestion = FillBlankQuestion | NumericQuestion | ShortAnswerQuestion | LongAnswerQuestion;

export const WRITTEN_TYPES = ["fill_blank", "numeric", "short_answer", "long_answer"] as const;

export function isWrittenQuestion(question: { type: string }): question is WrittenQuestion {
  return (WRITTEN_TYPES as readonly string[]).includes(question.type);
}

/** `{{id}}` placeholders in a fill_blank prompt, in prompt order,
 * deduplicated. Same expression packages/core/src/validate.ts's own
 * (private) `placeholdersIn` uses for the same purpose — the regex is
 * copied, not the rule: this is a UI-side read of the prompt text, not a
 * reimplementation of validateBank's placeholder/blank cross-check. */
export function placeholdersIn(prompt: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of prompt.matchAll(/\{\{([^{}]+)\}\}/g)) {
    const id = m[1];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/** A fresh blank for a placeholder the prompt just grew — `case_insensitive`
 * matches schemas/question-1.json's own default for `blanks[].match`. */
export function freshBlank(id: string): Blank {
  return { id, accepted: [], match: "case_insensitive" };
}

/**
 * The regex-safety issues `validateBank` (@pariksha/core) would raise for
 * this question's blanks, surfaced inline as the author types rather than
 * only at import. This calls the real `validateBank`/`assertSafeRegex` the
 * same way an import or export would, against a throwaway single-question
 * bank, instead of re-implementing regex-safety rules in the browser.
 */
export function fillBlankIssues(question: FillBlankQuestion): string[] {
  const result = validateBank({ format: "pariksha/bank@1", name: "preview", questions: [question] });
  if (result.ok) return [];
  return result.issues
    .filter((issue) => issue.field === "blanks" && /unsafe regex/i.test(issue.message))
    .map((issue) => issue.message);
}

const MATCH_MODES: Blank["match"][] = ["exact", "case_insensitive", "regex"];

function FillBlankAnswer({
  question,
  onChange,
}: {
  question: FillBlankQuestion;
  onChange: (next: Question) => void;
}) {
  const uid = useId();
  const issues = fillBlankIssues(question);

  function updateBlank(id: string, patch: Partial<Blank>): void {
    onChange({ ...question, blanks: question.blanks.map((blank) => (blank.id === id ? { ...blank, ...patch } : blank)) });
  }

  if (question.blanks.length === 0) {
    return (
      <p className="field-help">
        Type a placeholder like <code>{"{{1}}"}</code> in the prompt to create a blank.
      </p>
    );
  }

  return (
    <div className="written-blanks">
      {issues.length > 0 && (
        <p className="field-error" role="alert">
          {issues.join(" ")}
        </p>
      )}
      {question.blanks.map((blank) => (
        <fieldset className="written-blank" key={blank.id}>
          <legend>{`Blank ${blank.id}`}</legend>

          <label className="field-label" htmlFor={`${uid}-${blank.id}-accepted`}>
            {`Accepted answers for blank ${blank.id}`}
          </label>
          <input
            className="text-input"
            id={`${uid}-${blank.id}-accepted`}
            type="text"
            value={blank.accepted.join(", ")}
            onChange={(event) =>
              updateBlank(blank.id, {
                accepted: event.target.value
                  .split(",")
                  .map((answer) => answer.trim())
                  .filter(Boolean),
              })
            }
          />

          <label className="field-label" htmlFor={`${uid}-${blank.id}-match`}>
            {`Match mode for blank ${blank.id}`}
          </label>
          <select
            id={`${uid}-${blank.id}-match`}
            value={blank.match ?? "case_insensitive"}
            onChange={(event) => updateBlank(blank.id, { match: event.target.value as Blank["match"] })}
          >
            {MATCH_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </fieldset>
      ))}
    </div>
  );
}

function NumericAnswer({
  question,
  onChange,
}: {
  question: NumericQuestion;
  onChange: (next: Question) => void;
}) {
  const uid = useId();

  function setKey(patch: Partial<NumericKey>): void {
    onChange({ ...question, key: { ...question.key, ...patch } });
  }

  function setUnit(raw: string): void {
    const next = { ...question };
    if (raw === "") delete next.unit;
    else next.unit = raw;
    onChange(next);
  }

  function setTolerance(raw: string): void {
    if (raw === "") {
      const { tolerance: _tolerance, ...rest } = question.key;
      onChange({ ...question, key: rest });
      return;
    }
    const tolerance = Number(raw);
    if (Number.isFinite(tolerance)) setKey({ tolerance });
  }

  return (
    <div className="written-numeric">
      <label className="field-label" htmlFor={`${uid}-value`}>
        Value
      </label>
      <input
        className="text-input"
        id={`${uid}-value`}
        type="number"
        value={question.key.value}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) setKey({ value });
        }}
      />

      <label className="field-label" htmlFor={`${uid}-tolerance`}>
        Tolerance
      </label>
      <input
        className="text-input"
        id={`${uid}-tolerance`}
        type="number"
        min={0}
        value={question.key.tolerance ?? ""}
        onChange={(event) => setTolerance(event.target.value)}
      />

      <label className="field-label" htmlFor={`${uid}-tolerance-type`}>
        Tolerance type
      </label>
      <select
        id={`${uid}-tolerance-type`}
        value={question.key.tolerance_type ?? "absolute"}
        onChange={(event) => setKey({ tolerance_type: event.target.value as NumericKey["tolerance_type"] })}
      >
        <option value="absolute">absolute</option>
        <option value="percent">percent</option>
      </select>

      <label className="field-label" htmlFor={`${uid}-unit`}>
        Unit
      </label>
      <input
        className="text-input"
        id={`${uid}-unit`}
        type="text"
        value={question.unit ?? ""}
        onChange={(event) => setUnit(event.target.value)}
      />
    </div>
  );
}

/** Longest `max_length` the format allows each type — schemas/question-1.json's
 * own ceilings (`short_answer`: 500, `long_answer`: 5,000), not a number
 * invented here. Neither is exported as a runtime constant from
 * @pariksha/core (only the schema states them), so this is the one place in
 * the UI that names them. */
const MAX_LENGTH_CEILING = { short_answer: 500, long_answer: 5000 } as const;

function RubricEditor({
  rubric,
  onChange,
}: {
  rubric: RubricLevel[];
  onChange: (next: RubricLevel[] | undefined) => void;
}) {
  const uid = useId();

  function updateAt(index: number, patch: Partial<RubricLevel>): void {
    onChange(rubric.map((level, i) => (i === index ? { ...level, ...patch } : level)));
  }

  function setDescriptionAt(index: number, raw: string): void {
    const level = rubric[index];
    if (!level) return;
    const next = { ...level };
    if (raw === "") delete next.description;
    else next.description = raw;
    onChange(rubric.map((existing, i) => (i === index ? next : existing)));
  }

  function removeAt(index: number): void {
    const next = rubric.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : undefined);
  }

  // Rubric rows carry no schema identity of their own and nothing orders
  // them (a manual grader matches a response to the level that fits, not to
  // a position) — plain add/remove by index, not ReorderableList, and no
  // committed-value-as-key trap either: every field here is fully
  // controlled (`value={...}`), with no local in-progress draft state, so an
  // index key never drops focus or content the way an editable field used
  // as a key would.
  return (
    <fieldset className="written-rubric">
      <legend>Rubric</legend>
      {rubric.map((level, index) => (
        <div className="written-rubric-row" key={index}>
          <label className="field-label" htmlFor={`${uid}-level-${index}`}>
            {`Rubric level ${index + 1} name`}
          </label>
          <input
            className="text-input"
            id={`${uid}-level-${index}`}
            type="text"
            value={level.level}
            onChange={(event) => updateAt(index, { level: event.target.value })}
          />

          <label className="field-label" htmlFor={`${uid}-points-${index}`}>
            {`Rubric level ${index + 1} points`}
          </label>
          <input
            className="text-input"
            id={`${uid}-points-${index}`}
            type="number"
            value={level.points}
            onChange={(event) => {
              const points = Number(event.target.value);
              if (Number.isFinite(points)) updateAt(index, { points });
            }}
          />

          <label className="field-label" htmlFor={`${uid}-description-${index}`}>
            {`Rubric level ${index + 1} description`}
          </label>
          <input
            className="text-input"
            id={`${uid}-description-${index}`}
            type="text"
            value={level.description ?? ""}
            onChange={(event) => setDescriptionAt(index, event.target.value)}
          />

          <button type="button" className="button-secondary" onClick={() => removeAt(index)}>
            {`Remove rubric level ${index + 1}`}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="prompt-editor__tool"
        onClick={() => onChange([...rubric, { level: `Level ${rubric.length + 1}`, points: 0 }])}
      >
        Add rubric level
      </button>
    </fieldset>
  );
}

function ManualAnswer({
  question,
  onChange,
}: {
  question: ShortAnswerQuestion | LongAnswerQuestion;
  onChange: (next: Question) => void;
}) {
  const uid = useId();
  const ceiling = MAX_LENGTH_CEILING[question.type];
  const rubric = question.rubric ?? [];

  function setMaxLength(raw: string): void {
    const next = { ...question };
    if (raw === "") {
      delete next.max_length;
      onChange(next);
      return;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) return;
    next.max_length = Math.min(value, ceiling);
    onChange(next);
  }

  function setRubric(next: RubricLevel[] | undefined): void {
    const updated = { ...question };
    if (next === undefined) delete updated.rubric;
    else updated.rubric = next;
    onChange(updated);
  }

  return (
    <div className="written-manual">
      <label className="field-label" htmlFor={`${uid}-max-length`}>
        Maximum length
      </label>
      <input
        className="text-input"
        id={`${uid}-max-length`}
        type="number"
        min={1}
        max={ceiling}
        value={question.max_length ?? ""}
        onChange={(event) => setMaxLength(event.target.value)}
      />
      <p className="field-help">Up to {ceiling} characters.</p>

      <RubricEditor rubric={rubric} onChange={setRubric} />

      {rubric.length === 0 && (
        <p className="field-help" role="status">
          This question scores 0 without a rubric.
        </p>
      )}
    </div>
  );
}

export function WrittenAnswer({
  question,
  onChange,
}: {
  question: WrittenQuestion;
  onChange: (next: Question) => void;
}) {
  switch (question.type) {
    case "fill_blank":
      return <FillBlankAnswer question={question} onChange={onChange} />;
    case "numeric":
      return <NumericAnswer question={question} onChange={onChange} />;
    case "short_answer":
    case "long_answer":
      return <ManualAnswer question={question} onChange={onChange} />;
  }
}
