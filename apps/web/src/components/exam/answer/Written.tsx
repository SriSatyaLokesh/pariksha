import { useId, useMemo } from "react";
import { placeholderIds } from "@pariksha/core";
import { useRenderedMarkdown } from "../../authoring/RenderedHtml";
import { MAX_LENGTH_CEILING, numberFieldValue } from "../../answer-common";
import type { AnswerProps } from "./props";

/**
 * U+2063 INVISIBLE SEPARATOR, by code point rather than as a literal in
 * this source file.
 *
 * The pre-flight scan's finding A-22: written as two pasted invisible
 * characters, a terminal round-trip, a trailing-whitespace lint or an
 * editor normalisation silently drops them, the marker degrades to the
 * ASCII `pkb:1`, and a prompt that merely contains that text can forge a
 * blank. `answer-written.test.tsx` pins the code point directly.
 */
const SEP = String.fromCodePoint(0x2063);

/** The sentinel the inline-blank renderer splits on. Markdown-inert by
 * construction: `markdown-it` has no rule that can reinterpret an
 * invisible separator or an ASCII `pkb:` payload as emphasis, a link or a
 * code span, so the marker survives rendering in all three. */
export const BLANK_MARKER = (id: string): string => `${SEP}pkb:${id}${SEP}`;

/** Capturing, so `String.prototype.split` yields
 * `[text, id, text, id, …, text]` — the blanks at the odd indices. */
const MARKER_RE = new RegExp(`${SEP}pkb:([^${SEP}]*)${SEP}`, "g");

function FillBlank({ question, value, onChange, disabled }: AnswerProps) {
  const declared = useMemo(
    () => new Set((question.blanks ?? []).map((blank) => blank.id)),
    [question.blanks],
  );

  const source = useMemo(() => {
    // Strip any separator the prompt already carries BEFORE substituting,
    // so the only markers in the rendered HTML are the ones put there
    // here. Without this a prompt holding the marker's literal text
    // forges a blank, which is the plan's own named failure. U+2063 has
    // no visible effect in prose, so nothing a candidate reads changes.
    const safe = question.prompt.replaceAll(SEP, "");
    return placeholderIds(safe)
      .filter((id) => declared.has(id))
      .reduce((text, id) => text.replaceAll(`{{${id}}}`, BLANK_MARKER(id)), safe);
  }, [question.prompt, declared]);

  // Split AFTER rendering, never before. Substituting an `<input>` into
  // the Markdown source would need `html: true`, which ADR 0004 and
  // markdown-it's settings here forbid, and would make this the product's
  // first stored-HTML surface; substituting a placeholder for one would
  // land the inputs inside escaped text.
  const pieces = useRenderedMarkdown(source).split(MARKER_RE);
  const values = value !== null && value.kind === "blanks" ? value.values : {};

  function fill(id: string, text: string): void {
    const next = { ...values };
    if (text === "") delete next[id];
    else next[id] = text;
    onChange(Object.keys(next).length > 0 ? { kind: "blanks", values: next } : null);
  }

  return (
    <div className="exam-blanks rendered">
      {pieces.map((piece, index) =>
        index % 2 === 0 ? (
          <span
            key={index}
            className="exam-blank-text"
            dangerouslySetInnerHTML={{ __html: piece }}
          />
        ) : (
          <input
            key={index}
            type="text"
            className="exam-blank-input"
            // 1-based, in prompt order: the odd indices are 1, 3, 5, …
            aria-label={`Blank ${String((index + 1) / 2)}`}
            value={values[piece] ?? ""}
            disabled={disabled}
            onChange={(event) => {
              fill(piece, event.target.value);
            }}
          />
        ),
      )}
    </div>
  );
}

function Numeric({ question, value, onChange, disabled }: AnswerProps) {
  const uid = useId();
  const unitId = `${uid}-unit`;

  return (
    <div className="exam-numeric">
      <label className="exam-field-label" htmlFor={uid}>
        Your answer
      </label>
      <input
        id={uid}
        type="number"
        className="exam-text-input"
        inputMode="decimal"
        step="any"
        // The unit is described, not labelled: a candidate hears it, sees
        // it, and cannot type into it.
        aria-describedby={question.unit === undefined ? undefined : unitId}
        value={value !== null && value.kind === "number" ? String(value.value) : ""}
        disabled={disabled}
        onChange={(event) => {
          const next = numberFieldValue(event.target.value);
          onChange(next === null ? null : { kind: "number", value: next });
        }}
      />
      {question.unit !== undefined && (
        <span className="exam-unit" id={unitId}>
          {question.unit}
        </span>
      )}
    </div>
  );
}

function Manual({ question, value, onChange, disabled }: AnswerProps) {
  const uid = useId();
  const long = question.type === "long_answer";
  // schemas/question-1.json's own ceilings, imported rather than retyped.
  const max = question.maxLength ?? MAX_LENGTH_CEILING[long ? "long_answer" : "short_answer"];
  const text = value !== null && value.kind === "text" ? value.text : "";

  function write(next: string): void {
    onChange(next === "" ? null : { kind: "text", text: next });
  }

  return (
    <div className="exam-written">
      <label className="exam-field-label" htmlFor={uid}>
        Your answer
      </label>
      {long ? (
        <textarea
          id={uid}
          className="exam-text-area"
          rows={10}
          maxLength={max}
          value={text}
          disabled={disabled}
          onChange={(event) => {
            write(event.target.value);
          }}
        />
      ) : (
        <input
          id={uid}
          type="text"
          className="exam-text-input"
          maxLength={max}
          value={text}
          disabled={disabled}
          onChange={(event) => {
            write(event.target.value);
          }}
        />
      )}
      {/* Rendered from first render, so a screen reader has seen the
          region before it ever changes. */}
      <p className="exam-answer-status" role="status">
        {`${String(max - text.length)} characters left`}
      </p>
    </div>
  );
}

export function Written(props: AnswerProps) {
  switch (props.question.type) {
    case "fill_blank":
      return <FillBlank {...props} />;
    case "numeric":
      return <Numeric {...props} />;
    default:
      return <Manual {...props} />;
  }
}
