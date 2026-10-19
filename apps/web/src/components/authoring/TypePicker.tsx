import type { QuestionType } from "@pariksha/core";

// The picker's three groups (plan's Task 3 step): `choice` is this task's
// own family, `match` and `written` are Tasks 4 and 5's — listed here so
// one picker serves all twelve types for every caller, even though only
// `choice` has an answer block behind it yet (QuestionEditor shows a
// placeholder for the other two groups until those tasks land).
export const TYPE_GROUPS: Readonly<Record<"choice" | "match" | "written", readonly QuestionType[]>> = {
  choice: ["single", "multiple", "select_k", "true_false", "assertion_reason"],
  match: ["matching", "multi_matching", "ordering"],
  written: ["fill_blank", "numeric", "short_answer", "long_answer"],
};

const GROUP_LABELS: Record<keyof typeof TYPE_GROUPS, string> = {
  choice: "Choice",
  match: "Match",
  written: "Written",
};

// Human labels for every type's picker button and the type-change dialog's
// wording (QuestionEditor imports this too). Kept here, next to the groups
// they label.
export const TYPE_LABELS: Record<QuestionType, string> = {
  single: "Single choice",
  multiple: "Multiple choice",
  select_k: "Select K",
  true_false: "True / false",
  assertion_reason: "Assertion-reason",
  matching: "Matching",
  multi_matching: "Multi matching",
  ordering: "Ordering",
  fill_blank: "Fill in the blank",
  numeric: "Numeric",
  short_answer: "Short answer",
  long_answer: "Long answer",
};

export function TypePicker({
  value,
  onPick,
}: {
  value?: QuestionType;
  onPick: (type: QuestionType) => void;
}) {
  return (
    <div className="type-picker">
      {(Object.keys(TYPE_GROUPS) as (keyof typeof TYPE_GROUPS)[]).map((group) => (
        <fieldset className="type-picker__group" key={group}>
          <legend className="type-picker__group-label">{GROUP_LABELS[group]}</legend>
          {TYPE_GROUPS[group].map((type) => (
            <button
              type="button"
              className="prompt-editor__tool"
              key={type}
              aria-pressed={value === type}
              onClick={() => onPick(type)}
            >
              {TYPE_LABELS[type]}
            </button>
          ))}
        </fieldset>
      ))}
    </div>
  );
}
