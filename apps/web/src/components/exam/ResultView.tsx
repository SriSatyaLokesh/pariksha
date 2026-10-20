// A released result, as the server assembled it (#75, `AC-16`).
//
// **This component renders what it is given and asks no questions.** It
// never reads the test's release setting — it is never told it — and it
// has no branch of the form "hide this unless the organiser allowed it".
// The gate is `releasedResult` on the server: `score_only` arrives with no
// `sections` key, `score_and_sections` with no `review` key, and a test
// that releases nothing arrives as `null` and this never renders at all.
// A browser that showed less than it was given would be a bug here; a
// browser that was given more than it should have is the vulnerability,
// and it cannot be fixed in this file.
//
// So every section below is `payload.x && <…>` over a key the server
// either put there or did not, and there is no third state.

import { RenderedHtml } from "../authoring/RenderedHtml";
import type { ReleasedResult } from "../../lib/run";

/** A number the candidate will compare against another number, so it is
 *  rendered through the same `toLocaleString` the rest of the runtime
 *  uses rather than with a stray `toFixed`. */
const points = (value: number): string =>
  value.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** The answer a candidate gave, or a correct one, as text.
 *
 *  Both sides come out of the stored document, so both can be a string, a
 *  list, a map or a number. Rendering `[object Object]` on a results page
 *  is worse than rendering nothing, so a structure is shown as its own
 *  JSON — readable for the pairs a matching question stores, and honest
 *  about there being no prose form of it. */
function asText(value: unknown): string {
  if (value === null || value === undefined) return "No answer";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((one) => asText(one)).join(", ");
  if (typeof value === "object") {
    const r = value as { kind?: string; [k: string]: unknown };
    // `ResponseValue` is a tagged union; its one carried field is what the
    // candidate actually chose.
    if (typeof r.kind === "string") {
      const carried = Object.entries(r).find(([key]) => key !== "kind")?.[1];
      return carried === undefined ? r.kind : asText(carried);
    }
    return Object.entries(r)
      .map(([key, one]) => `${key} → ${asText(one)}`)
      .join(", ");
  }
  // Unreachable over a JSON payload — a symbol, a function and a bigint
  // cannot survive `JSON.parse`. "No answer" rather than a stringified
  // one, because whatever reached here is not something to show a
  // candidate as their answer.
  return "No answer";
}

export function ResultView({ result }: { result: ReleasedResult }) {
  return (
    <section className="exam-result" aria-labelledby="exam-result-heading">
      <h2 id="exam-result-heading">Your result</h2>

      <p className="exam-score">
        <span className="exam-score-value">{points(result.total)}</span>
        <span className="exam-score-max"> out of {points(result.max)}</span>
        <span className="exam-score-percent"> ({points(result.percent)}%)</span>
      </p>

      {/* `null` is "this test sets no pass mark", which is not the same as
          failing — so there is no verdict at all rather than a hedged one.
          The word is the carrier and the colour is the third signal, never
          the first (DESIGN.md). */}
      {result.passed !== null && (
        <p className="exam-verdict" data-passed={result.passed}>
          <span className="exam-verdict-mark" aria-hidden="true">
            {result.passed ? "✓" : "—"}
          </span>
          {result.passed ? "Passed" : "Not passed"}
        </p>
      )}

      {result.pending.length > 0 && (
        <p className="exam-result-pending">
          {result.pending.length === 1
            ? "One question is still waiting to be marked by a person, so this score may rise."
            : `${String(result.pending.length)} questions are still waiting to be marked by a person, so this score may rise.`}
        </p>
      )}

      {result.sections && (
        <table className="exam-result-table">
          <caption>Marks by section</caption>
          <thead>
            <tr>
              <th scope="col">Section</th>
              <th scope="col">Marks</th>
              <th scope="col">Out of</th>
            </tr>
          </thead>
          <tbody>
            {result.sections.map((section) => (
              <tr key={section.sectionId}>
                <th scope="row">{section.title}</th>
                <td>{points(section.points)}</td>
                <td>{points(section.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result.review && (
        <ol className="exam-review" aria-label="Every question, with the correct answer">
          {result.review.map((one, at) => (
            <li key={one.questionId} className="exam-review-item">
              <h3 className="exam-review-number">Question {String(at + 1)}</h3>
              <dl className="exam-facts">
                <dt>Your answer</dt>
                <dd>{asText(one.yourAnswer)}</dd>
                <dt>Correct answer</dt>
                <dd>{asText(one.correct)}</dd>
                <dt>Marks</dt>
                <dd>{points(one.points)}</dd>
              </dl>
              {one.explanation !== null && (
                // The one place an organiser's prose reaches a candidate
                // after the paper, through the same renderer the question
                // stem uses — so a formula in an explanation renders the
                // way it rendered in the question.
                <RenderedHtml markdown={one.explanation} className="exam-review-explanation" />
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
