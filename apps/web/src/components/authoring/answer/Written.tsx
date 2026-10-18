import { useId, useState } from "react";
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
 * reimplementation of validateBank's placeholder/blank cross-check
 * (that one returns an unordered `Set`; this one keeps prompt order, which
 * is what the UI needs and the Set-returning version doesn't give). */
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
 * The cross-field issues `validateBank` (@pariksha/core) would raise for
 * this question's blanks (an unsafe regex pattern, or — defensively — a
 * blank/placeholder mismatch, though `QuestionEditor` derives `blanks` from
 * the prompt precisely so that never actually happens), surfaced inline as
 * the author types rather than only at import. This calls the real
 * `validateBank`/`assertSafeRegex` the same way an import or export would,
 * against a throwaway single-question bank, instead of re-implementing
 * regex-safety rules in the browser.
 *
 * This is fast author feedback only — nothing server-side repeats it today.
 * `saveQuestion` (apps/api/src/routes/questions.ts) validates only that the
 * body is *shaped* like a question (id/type/prompt), not that a fill_blank's
 * regex is safe; a document could still reach storage some other way
 * without ever going through this check. The server-side guard is expected
 * to land with the import path (Task 7), the same way `validateBank`
 * already gates import there.
 */
export function fillBlankIssues(question: FillBlankQuestion): string[] {
  const result = validateBank({ format: "pariksha/bank@1", name: "preview", questions: [question] });
  if (result.ok) return [];
  return result.issues
    .filter((issue) => issue.field === "blanks" || issue.field === "prompt")
    .map((issue) => issue.message);
}

const MATCH_MODES: Blank["match"][] = ["exact", "case_insensitive", "regex"];

/**
 * A blank's accepted answers as one comma-separated text field, committed
 * on blur or Enter rather than on every keystroke — the same deferred-
 * commit pattern `Structured.tsx`'s `ItemText` uses for exactly the same
 * reason. A controlled input bound directly to `accepted.join(", ")`, with
 * `onChange` splitting on every keystroke, fights the typist: typing the
 * separator itself (`,`) yields a trailing empty segment that
 * `.filter(Boolean)` drops immediately, so the committed value reverts to
 * `"Delhi"` and the controlled `value` prop erases the comma (and the space
 * after it) the instant it's typed — a second accepted answer could never
 * be entered at all. Holding the raw text as an uncommitted `draft` until
 * blur/Enter means the field only ever gets re-split once the author is
 * actually done, not mid-keystroke.
 */
function AcceptedAnswersField({
  id,
  label,
  accepted,
  onCommit,
}: {
  id: string;
  label: string;
  accepted: string[];
  onCommit: (accepted: string[]) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit(): void {
    if (draft === null) return;
    const text = draft;
    setDraft(null);
    onCommit(
      text
        .split(",")
        .map((answer) => answer.trim())
        .filter(Boolean),
    );
  }

  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="text-input"
        id={id}
        type="text"
        value={draft ?? accepted.join(", ")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commit();
        }}
      />
    </>
  );
}

function FillBlankAnswer({
  question,
  onChange,
  issues,
}: {
  question: FillBlankQuestion;
  onChange: (next: Question) => void;
  issues: string[];
}) {
  const uid = useId();

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

          <AcceptedAnswersField
            id={`${uid}-${blank.id}-accepted`}
            label={`Accepted answers for blank ${blank.id}`}
            accepted={blank.accepted}
            onCommit={(accepted) => updateBlank(blank.id, { accepted })}
          />

          <label className="field-label" htmlFor={`${uid}-${blank.id}-match`}>
            {`Match mode for blank ${blank.id}`}
          </label>
          <select
            id={`${uid}-${blank.id}-match`}
            value={blank.match ?? "case_insensitive"}
            onChange={(event) =>
              updateBlank(blank.id, { match: event.target.value as Exclude<Blank["match"], undefined> })
            }
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
      const key = { ...question.key };
      delete key.tolerance;
      onChange({ ...question, key });
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
          const raw = event.target.value;
          // Unlike Tolerance (optional — an empty field just deletes it),
          // `value` is required: there is no "unset" to fall back to, so an
          // in-progress clear (not yet a real number) is ignored rather than
          // coerced through `Number("") === 0` into silently zeroing it.
          if (raw === "") return;
          const value = Number(raw);
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
        onChange={(event) =>
          setKey({ tolerance_type: event.target.value as Exclude<NumericKey["tolerance_type"], undefined> })
        }
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
    // Not clamped to `ceiling` here: doing that on every keystroke fights
    // the typist exactly like the accepted-answers field did — typing "600"
    // snaps to "500" at the third digit, silently, with no way to tell what
    // happened. The `max` attribute already tells a spinner/validity-aware
    // UA the limit; the out-of-range value stands, and the message below
    // names the violation instead of hiding it behind a forced rewrite.
    next.max_length = value;
    onChange(next);
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
      {question.max_length !== undefined && question.max_length > ceiling && (
        <p className="field-error" role="alert">
          {`Maximum length cannot exceed ${ceiling} characters for this type.`}
        </p>
      )}

      <RubricEditor
        rubric={rubric}
        onChange={(next) => {
          const updated = { ...question };
          if (next === undefined) delete updated.rubric;
          else updated.rubric = next;
          onChange(updated);
        }}
      />

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
  fillBlankIssues: issues = [],
}: {
  question: WrittenQuestion;
  onChange: (next: Question) => void;
  /** `fillBlankIssues(question)`, precomputed by `QuestionEditor` — which
   * needs the same list to decide whether Save is blocked — and threaded in
   * here rather than recomputed, so `validateBank` runs once per render,
   * not twice. Ignored for every type but `fill_blank`. */
  fillBlankIssues?: string[];
}) {
  switch (question.type) {
    case "fill_blank":
      return <FillBlankAnswer question={question} onChange={onChange} issues={issues} />;
    case "numeric":
      return <NumericAnswer question={question} onChange={onChange} />;
    case "short_answer":
    case "long_answer":
      return <ManualAnswer question={question} onChange={onChange} />;
  }
}
