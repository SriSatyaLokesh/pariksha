import { RenderedHtml } from "../../authoring/RenderedHtml";
import { Choice, isChoiceQuestion } from "./Choice";
import { Structured, isStructuredQuestion } from "./Structured";
import { Written, BLANK_MARKER } from "./Written";
import type { AnswerProps } from "./props";

export { BLANK_MARKER };
export type { AnswerProps };

/**
 * The candidate's answer block for all twelve question types: the
 * passage, the prompt, the question's media and the input itself.
 *
 * The prompt renders through Phase 4's `RenderedHtml` — UX-09's "the
 * preview is the same renderer the candidate runtime uses", now literally
 * the same module. `fill_blank` is the exception and renders its own
 * prompt, because its inputs sit *inside* it.
 *
 * `media[].src` arrives already pointing at the attempt-scoped media
 * route: the scrubber rewrites every `src` when the layout is pinned
 * (Task 5), so nothing here builds a URL or knows a workspace exists.
 *
 * The whole block is one `<fieldset>`, which is how `disabled` reaches
 * twelve components without being threaded through twelve prop lists: a
 * disabled fieldset disables every control inside it, natively and with
 * the state announced. Review and submitted attempts are read-only, and
 * a read-only attempt whose controls still respond is the kind of lie
 * this screen must not tell.
 */
export function AnswerInput({ question, value, onChange, disabled }: AnswerProps) {
  const props = { question, value, onChange, disabled };

  return (
    <fieldset className="exam-answer" disabled={disabled}>
      {question.group && (
        <section className="exam-passage" aria-label="Passage">
          <RenderedHtml markdown={question.group.passage} />
        </section>
      )}

      {question.type !== "fill_blank" && (
        <RenderedHtml markdown={question.prompt} className="rendered--stem exam-prompt" />
      )}

      {question.media?.map((item) => (
        <img key={item.src} className="exam-media" src={item.src} alt={item.alt} />
      ))}

      {isChoiceQuestion(question) ? (
        <Choice {...props} />
      ) : isStructuredQuestion(question) ? (
        <Structured {...props} />
      ) : (
        <Written {...props} />
      )}
    </fieldset>
  );
}
