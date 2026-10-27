import { useId } from "react";
import type { ResponseValue } from "@pariksha/core";
import type { CandidateQuestion } from "../../../lib/paper";
import { ReorderableList } from "../../authoring/ReorderableList";
import { reordered } from "../../answer-common";
import type { AnswerProps } from "./props";

/**
 * The three structured types: `matching`, `multi_matching` and `ordering`.
 *
 * `matching` is one native `<select>` per left item rather than a grid of
 * radios. The author's grid has to show a whole key at once; a candidate
 * answers one row at a time, and options remain reusable across rows so
 * multiple left items can map to the same right item.
 *
 * `multi_matching` keeps the grid, because there is no one-at-a-time
 * reading of "a left item may match several right items".
 *
 * `ordering` is `ReorderableList` — Phase 4's control, now with the drag
 * half of AC-07 that this task added to it.
 */

export const STRUCTURED_TYPES = ["matching", "multi_matching", "ordering"] as const;

export function isStructuredQuestion(question: CandidateQuestion): boolean {
  return (STRUCTURED_TYPES as readonly string[]).includes(question.type);
}

/** The pairs this response holds — empty for a response of the wrong
 * kind, which is no answer to this question, the same rule
 * `gradeStructured` applies. Two plain functions rather than one generic
 * over the kind: the generic version needed a cast to compile, and a cast
 * is how a narrowing bug gets in. */
function mapPairs(value: ResponseValue | null): Record<string, string> {
  return value !== null && value.kind === "map" ? value.pairs : {};
}

function multimapPairs(value: ResponseValue | null): Record<string, string[]> {
  return value !== null && value.kind === "multimap" ? value.pairs : {};
}

function Matching({ question, value, onChange, disabled }: AnswerProps) {
  const uid = useId();
  const left = question.left ?? [];
  const right = question.right ?? [];
  const pairs = mapPairs(value);

  function choose(item: string, chosen: string): void {
    const next = { ...pairs };
    if (chosen === "") delete next[item];
    else next[item] = chosen;
    onChange(Object.keys(next).length > 0 ? { kind: "map", pairs: next } : null);
  }

  return (
    <div className="exam-matching">
      {left.map((item, index) => {
        const id = `${uid}-${String(index)}`;
        return (
          <div className="exam-match-row" key={index}>
            <label className="exam-match-left" htmlFor={id}>
              {item}
            </label>
            <select
              id={id}
              className="exam-select"
              value={pairs[item] ?? ""}
              disabled={disabled}
              onChange={(event) => {
                choose(item, event.target.value);
              }}
            >
              <option value="">Not matched</option>
              {right.map((candidate, optIndex) => (
                <option key={`${candidate}-${optIndex}`} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

function MultiMatching({ question, value, onChange, disabled }: AnswerProps) {
  const left = question.left ?? [];
  const right = question.right ?? [];
  const pairs = multimapPairs(value);

  function toggle(item: string, candidate: string, checked: boolean): void {
    const current = new Set(pairs[item] ?? []);
    if (checked) current.add(candidate);
    else current.delete(candidate);
    const next = { ...pairs };
    // Emitted in the dealt right-item order, so two candidates who chose
    // the same pairs produce the same payload.
    const chosen = right.filter((option) => current.has(option));
    if (chosen.length > 0) next[item] = chosen;
    else delete next[item];
    onChange(Object.keys(next).length > 0 ? { kind: "multimap", pairs: next } : null);
  }

  return (
    <table className="exam-match-grid">
      <caption className="exam-match-caption">Choose every pair that holds</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          {right.map((candidate) => (
            <th scope="col" key={candidate}>
              {candidate}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {left.map((item, index) => (
          <tr key={index}>
            <th scope="row">{item}</th>
            {right.map((candidate) => (
              <td key={candidate}>
                {/* G5-13 (UI/UX audit). A bare 17x17 checkbox inside a 48px
                    cell failed WCAG 2.5.8 and was genuinely hard to hit in
                    a dense grid on a touchscreen. Wrapping it in a label
                    that fills the cell (`.exam-match-cell`, exam.css) makes
                    the whole 48x48 area the hit target, not just the
                    control drawn inside it. */}
                <label className="exam-match-cell">
                  <input
                    type="checkbox"
                    // Every cell states the pair it represents outright,
                    // not a row/column index — the defect UX review sent
                    // Phase 4's grid back for once already.
                    aria-label={`${item} matches ${candidate}`}
                    checked={(pairs[item] ?? []).includes(candidate)}
                    disabled={disabled}
                    onChange={(event) => {
                      toggle(item, candidate, event.target.checked);
                    }}
                  />
                </label>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Ordering({ question, value, onChange, disabled }: AnswerProps) {
  // UX-08: the dealt order is the shuffled one, and the candidate's own
  // order is the answer. Before they touch it the two are the same, which
  // is why an untouched ordering question is still unanswered — `value`
  // stays null and the palette square stays empty.
  const items = value !== null && value.kind === "order" ? value.items : (question.items ?? []);

  // Fix round 1, C1. `<fieldset disabled>` reaches form controls and
  // nothing else, so it disables `ReorderableList`'s move buttons and
  // position fields but NOT its `draggable` rows: a submitted attempt
  // was reorderable by mouse, and `onChange` fired. A read-only ordering
  // answer therefore renders as what it actually is — the order the
  // candidate left, with no affordance at all, so there is no drag path
  // to make inert.
  //
  // The two alternatives were threading `disabled` into
  // `ReorderableList` (its props must not change — Phase 4's deferral
  // note, and this task's own constraint) and leaving the rows
  // `draggable` while short-circuiting the handler, which keeps a
  // control that looks operable and is not. `index.tsx` states the rule
  // that second one breaks: "a read-only attempt whose controls still
  // respond is the kind of lie this screen must not tell."
  if (disabled) {
    return (
      <div className="exam-ordering-readonly">
        <p className="exam-field-label">Your order</p>
        <ol className="exam-ordering-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <ReorderableList
      items={items}
      keyOf={(item) => item}
      labelOf={(item) => `item ${item}`}
      legend="Put these in order"
      onReorder={(from, to) => {
        onChange({ kind: "order", items: reordered(items, from, to) });
      }}
      renderItem={(item) => <span>{item}</span>}
    />
  );
}

export function Structured(props: AnswerProps) {
  switch (props.question.type) {
    case "matching":
      return <Matching {...props} />;
    case "multi_matching":
      return <MultiMatching {...props} />;
    default:
      return <Ordering {...props} />;
  }
}
