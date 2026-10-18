import { useId } from "react";
import type { Question, QuestionOption } from "@pariksha/core";
import { RenderedHtml } from "./RenderedHtml";

// UX-09: the candidate's view, with an "as the reviewer sees it" toggle that
// reveals the key and the explanation. It calls `renderMarkdown` through
// RenderedHtml, and so will Phase 6's exam runtime, because there is only
// one renderer — which is what makes the preview a promise rather than an
// approximation (ADR 0004).

const ASSERTION_REASON: Record<string, string> = {
  both_true_explains: "Both true, and the reason explains the assertion",
  both_true_not_explains: "Both true, but the reason does not explain the assertion",
  a_true_r_false: "The assertion is true and the reason is false",
  a_false_r_true: "The assertion is false and the reason is true",
};

const optionText = (options: QuestionOption[], id: string) =>
  options.find((option) => option.id === id)?.text ?? id;

/** The key, in the words the reviewer reads rather than the shape it is stored in. */
function describeAnswer(question: Question): string {
  switch (question.type) {
    case "single":
      return optionText(question.options, question.key);
    case "multiple":
    case "select_k":
      return question.key.map((id) => optionText(question.options, id)).join(", ");
    case "true_false":
      return question.key ? "True" : "False";
    case "assertion_reason":
      return ASSERTION_REASON[question.key] ?? question.key;
    case "matching":
      return Object.entries(question.key)
        .map(([left, right]) => `${left} → ${right}`)
        .join("; ");
    case "multi_matching":
      return Object.entries(question.key)
        .map(([left, right]) => `${left} → ${right.join(", ")}`)
        .join("; ");
    case "ordering":
      // UX-08: authored in the correct order, shuffled for the candidate.
      return question.items.join(" → ");
    case "fill_blank":
      return question.blanks
        .map((blank) => `${blank.id}: ${blank.accepted.join(" / ")}`)
        .join("; ");
    case "numeric":
      return question.unit
        ? `${question.key.value} ${question.unit}`
        : String(question.key.value);
    case "short_answer":
      return question.model_answer ?? "Marked by a reviewer.";
    case "long_answer":
      return "Marked by a reviewer.";
  }
}

const options = (question: Question): QuestionOption[] =>
  "options" in question ? question.options : [];

export function PreviewPane({
  question,
  reveal,
  onRevealChange,
}: {
  question: Question;
  reveal: boolean;
  onRevealChange: (next: boolean) => void;
}) {
  const headingId = useId();

  return (
    <section className="preview" aria-labelledby={headingId}>
      <div className="preview__bar">
        <h2 className="preview__heading" id={headingId}>
          Preview
        </h2>
        {/* A real switch rather than a checkbox styled as one: the control
            has two states and announcing it as "on"/"off" is the honest
            reading of "as the reviewer sees it". */}
        <button
          className="preview__toggle"
          type="button"
          role="switch"
          aria-checked={reveal}
          onClick={() => onRevealChange(!reveal)}
        >
          As the reviewer sees it
        </button>
      </div>

      <RenderedHtml className="rendered--stem" markdown={question.prompt} />

      {question.media?.map((image) => (
        <img className="preview__media" key={image.src} src={image.src} alt={image.alt} />
      ))}

      {options(question).length > 0 && (
        <ol className="preview__options">
          {options(question).map((option) => (
            <li key={option.id}>
              <RenderedHtml markdown={option.text} />
            </li>
          ))}
        </ol>
      )}

      {reveal && (
        <div className="preview__key">
          <p className="preview__key-line">
            <strong>Correct answer:</strong> {describeAnswer(question)}
          </p>
          {question.explanation !== undefined && (
            <RenderedHtml markdown={question.explanation} />
          )}
        </div>
      )}
    </section>
  );
}
