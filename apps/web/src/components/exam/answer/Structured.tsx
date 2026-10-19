import { useId } from "react";
import type { ResponseValue } from "@pariksha/core";
import type { CandidateQuestion } from "../Runner";
import { ReorderableList } from "../../authoring/ReorderableList";
import { reordered } from "../../authoring/answer/Structured";
import type { AnswerProps } from "./props";

/**
 * The three structured types: `matching`, `multi_matching` and `ordering`.
 *
 * `matching` is one native `<select>` per left item rather than a grid of
 * radios. The author's grid has to show a whole key at once; a candidate
 * answers one row at a time, and a `<select>` gives the one-right-item-per
 * -left rule for free — a used option is simply `disabled` on every other
 * row, which is a state the platform already announces.
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

/** The pairs this response holds, for whichever of the two map kinds the
 * question expects. A response of the wrong kind is no answer at all. */
function pairsOf<K extends "map" | "multimap">(
  value: ResponseValue | null,
  kind: K,
): Extract<ResponseValue, { kind: K }>["pairs"] {
  if (value !== null && value.kind === kind) {
    return (value as Extract<ResponseValue, { kind: K }>).pairs;
  }
  return {};
}

function Matching({ question, value, onChange, disabled }: AnswerProps) {
  const uid = useId();
  const left = question.left ?? [];
  const right = question.right ?? [];
  const pairs = pairsOf(value, "map");

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
              {right.map((candidate) => (
                <option
                  key={candidate}
                  value={candidate}
                  // One right item per left item: taken elsewhere means
                  // unavailable here, but never on the row that took it,
                  // or the choice could not be changed.
                  disabled={Object.entries(pairs).some(
                    ([other, taken]) => other !== item && taken === candidate,
                  )}
                >
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
  const pairs = pairsOf(value, "multimap");

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
                <input
                  type="checkbox"
                  // Every cell states the pair it represents outright, not
                  // a row/column index — the defect UX review sent Phase
                  // 4's grid back for once already.
                  aria-label={`${item} matches ${candidate}`}
                  checked={(pairs[item] ?? []).includes(candidate)}
                  disabled={disabled}
                  onChange={(event) => {
                    toggle(item, candidate, event.target.checked);
                  }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Ordering({ question, value, onChange }: AnswerProps) {
  // UX-08: the dealt order is the shuffled one, and the candidate's own
  // order is the answer. Before they touch it the two are the same, which
  // is why an untouched ordering question is still unanswered — `value`
  // stays null and the palette square stays empty.
  const items = value !== null && value.kind === "order" ? value.items : (question.items ?? []);

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
