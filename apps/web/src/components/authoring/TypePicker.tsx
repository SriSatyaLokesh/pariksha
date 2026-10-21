import type { ReactNode } from "react";
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

// One line under each label, reaching a screen reader as the button's
// DESCRIPTION rather than as part of its name: `aria-hidden` keeps it out
// of name-from-content, so "Single choice" is still exactly what the
// button is called (and every existing test that queries these buttons by
// an anchored name keeps working), while `aria-describedby` still picks
// the text up — an IDREF reaches a hidden element by design.
const TYPE_NOTES: Record<QuestionType, string> = {
  single: "One correct option.",
  multiple: "Any number of correct options.",
  select_k: "Exactly k of the options.",
  true_false: "One statement, two answers.",
  assertion_reason: "Two statements, one verdict.",
  matching: "Pair every left item with a right one.",
  multi_matching: "A left item may take several right ones.",
  ordering: "Put the items in the right order.",
  fill_blank: "Type the words the prompt leaves out.",
  numeric: "A number, accepted within a tolerance.",
  short_answer: "A line or two, marked by hand.",
  long_answer: "An essay, marked by hand.",
};

/* ---- The twelve drawn miniatures (`D18`) ---------------------------------

   "Twelve distinct examples — a description is not an example." So each
   entry below DRAWS its type: single choice is a column of radio rows,
   matching is two columns joined by wires, ordering is a handle and a rank
   beside every row, long answer is a ruled box. Nothing here restates the
   sentence in TYPE_NOTES, and no two entries are the same drawing with
   different words — `test/authoring/type-picker.test.tsx` strips every
   text node out of all twelve and fails unless twelve distinct shapes
   remain, which is what stops a box of prose from passing as a drawing.

   Every part is a <span> with a class `authoring.css` paints; the shapes
   are borders, fills and one repeating gradient, so there is no SVG to
   ship and nothing to keep in step with the type list but this map. The
   whole miniature is `aria-hidden` on the card: it is a sighted reader's
   affordance, and TYPE_NOTES is what a screen reader gets instead. */

const bar = (key: number, short = false) => (
  <span className={short ? "mini__bar mini__bar--short" : "mini__bar"} key={key} />
);

const rows = (count: number, mark: (index: number) => ReactNode) =>
  Array.from({ length: count }, (_, index) => (
    <span className="mini__row" key={index}>
      {mark(index)}
      {bar(index)}
    </span>
  ));

const dot = (on: boolean) => <span className={on ? "mini__dot mini__dot--on" : "mini__dot"} />;
const box = (on: boolean) => <span className={on ? "mini__box mini__box--on" : "mini__box"} />;

const pills = (count: number) => (
  <span className="mini__col">
    {Array.from({ length: count }, (_, index) => (
      <span className="mini__pill" key={index} />
    ))}
  </span>
);

const wires = (count: number) => (
  <span className="mini__wire">
    {Array.from({ length: count }, (_, index) => (
      <span className="mini__wire-line" key={index} />
    ))}
  </span>
);

const MINIATURES: Record<QuestionType, ReactNode> = {
  single: <span className="mini">{rows(3, (index) => dot(index === 0))}</span>,
  multiple: <span className="mini">{rows(3, (index) => box(index !== 1))}</span>,
  // The counter is what makes "exactly k" visible, and is also what keeps
  // this shape distinct from `multiple`'s.
  select_k: (
    <span className="mini">
      <span className="mini__row">
        {box(true)}
        {bar(0)}
        <span className="mini__count" />
      </span>
      <span className="mini__row">
        {box(false)}
        {bar(1)}
      </span>
      <span className="mini__row">
        {box(true)}
        {bar(2)}
      </span>
    </span>
  ),
  true_false: (
    <span className="mini">
      <span className="mini__pair">
        <span className="mini__half mini__half--on" />
        <span className="mini__half" />
      </span>
    </span>
  ),
  assertion_reason: (
    <span className="mini">
      <span className="mini__row">
        <span className="mini__tag" />
        {bar(0)}
      </span>
      <span className="mini__row">
        <span className="mini__tag" />
        {bar(1)}
      </span>
      <span className="mini__row">
        {dot(true)}
        {bar(2, true)}
      </span>
      <span className="mini__row">
        {dot(false)}
        {bar(3, true)}
      </span>
    </span>
  ),
  matching: (
    <span className="mini mini--cols">
      {pills(3)}
      {wires(3)}
      {pills(3)}
    </span>
  ),
  // Two on the left, four on the right, four wires: one left item takes
  // more than one right one, which is the whole difference from `matching`.
  multi_matching: (
    <span className="mini mini--cols">
      {pills(2)}
      {wires(4)}
      {pills(4)}
    </span>
  ),
  ordering: (
    <span className="mini">
      {Array.from({ length: 3 }, (_, index) => (
        <span className="mini__row" key={index}>
          <span className="mini__grip" />
          <span className="mini__rank" />
          {bar(index)}
        </span>
      ))}
    </span>
  ),
  fill_blank: (
    <span className="mini">
      <span className="mini__row">
        {bar(0, true)}
        <span className="mini__gap" />
        {bar(1)}
      </span>
    </span>
  ),
  numeric: (
    <span className="mini">
      <span className="mini__row">
        <span className="mini__field" />
        <span className="mini__unit" />
      </span>
    </span>
  ),
  short_answer: (
    <span className="mini">
      <span className="mini__row">
        <span className="mini__field" />
      </span>
    </span>
  ),
  long_answer: (
    <span className="mini">
      <span className="mini__lines">
        {bar(0)}
        {bar(1)}
        {bar(2)}
        {bar(3, true)}
      </span>
    </span>
  ),
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
          {/* The cards are a grid INSIDE the fieldset rather than the
              fieldset itself: a rendered <legend> is laid out by the UA
              rather than by its parent's `display`, so a grid fieldset
              puts its own legend somewhere no author asked for. */}
          <div className="type-picker__grid">
            {TYPE_GROUPS[group].map((type) => (
              <button
                type="button"
                className="type-card"
                key={type}
                // `aria-pressed` is the selection semantics this picker
                // already had, and opening a drawer on focus does not
                // change what the button IS.
                aria-pressed={value === type}
                aria-describedby={`type-note-${type}`}
                onClick={() => onPick(type)}
              >
                <span className="type-card__name">{TYPE_LABELS[type]}</span>
                <span className="type-card__note" id={`type-note-${type}`} aria-hidden="true">
                  {TYPE_NOTES[type]}
                </span>
                <span className="type-card__example" aria-hidden="true">
                  {MINIATURES[type]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
