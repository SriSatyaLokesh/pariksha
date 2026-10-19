import { useId } from "react";
import type { SetAssignment, SourceSets } from "@pariksha/core";

/**
 * T-09's four strategies, each with the one-line consequence it carries.
 * The copy is fixed by the plan (#56's design note) because it is the whole
 * point of the control: a strategy name alone tells an organiser nothing
 * about what a candidate will experience, and these sentences do. They are
 * persistent helper text — every one of them visible at once, under its own
 * radio — never a tooltip, which a keyboard or touch user may never see.
 */
export const ASSIGNMENT_CONSEQUENCE: Readonly<Record<SetAssignment, string>> = {
  round_robin: "By registration order, so candidates sitting next to each other get different sets.",
  random: "A different set per registration, not tied to the candidate.",
  hash: "From the candidate's ID, so the same candidate always gets the same set across attempts.",
  from_candidate_list:
    "From the set column of the uploaded candidate list. A candidate whose row has no set cannot start, and the publish checklist says so.",
};

const ASSIGNMENT_LABEL: Readonly<Record<SetAssignment, string>> = {
  round_robin: "Round robin",
  random: "Random",
  hash: "Hash of the candidate ID",
  from_candidate_list: "From candidate list",
};

/** `$defs/sourceSets`'s own `assignment` enum, in the schema's order. Its
 * `default` is `round_robin`, which is why a source naming none reads as
 * that one rather than as nothing chosen. */
const ASSIGNMENTS: readonly SetAssignment[] = ["round_robin", "random", "hash", "from_candidate_list"];

const DEFAULT_ASSIGNMENT: SetAssignment = "round_robin";

/**
 * T-10 and UX-08. Two controls, not the three #56's wording implies: the
 * format carries exactly one shuffle switch per section
 * (`$defs/section.shuffle_questions`), and answer-option order is
 * `shuffle_options` per question, which the Phase 4 question editor already
 * owns. #56's "three switches" is honoured as three rows under one legend —
 * one switch and two statements of fact, the second being UX-08's.
 *
 * Its own component rather than a block inside `SetsPanel`, because
 * `shuffle_questions` belongs to every section whatever its source kind:
 * `SectionList` renders this one directly for `fixed` and `pool` sections,
 * and `SetsPanel` composes it for `sets` ones.
 */
export function ShuffleFieldset({
  shuffleQuestions,
  onChange,
}: {
  shuffleQuestions: boolean;
  onChange: (shuffleQuestions: boolean) => void;
}) {
  const id = useId();
  return (
    <fieldset className="shuffle-group">
      <legend>Shuffling</legend>
      <div className="shuffle-group__row">
        <input
          type="checkbox"
          id={id}
          checked={shuffleQuestions}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label htmlFor={id}>Shuffle questions within this section</label>
      </div>
      <p className="shuffle-group__fact">
        Answer-option order is set per question, in the question editor — there is no switch for it here.
      </p>
      <p className="shuffle-group__fact">
        Ordering questions always shuffle their items for the candidate, whatever these say.
      </p>
    </fieldset>
  );
}

/**
 * T-09 and T-10 for a `sets` section: which set a candidate is assigned to,
 * and whether that set's questions are shuffled. Both halves come back in
 * one `onChange` because both live on the same section — two separate
 * callbacks fired from one handler would each rebuild the section from the
 * same stale copy, and the second would undo the first.
 */
export function SetsPanel({
  source,
  shuffleQuestions,
  onChange,
}: {
  source: SourceSets;
  shuffleQuestions: boolean;
  onChange: (next: { source: SourceSets; shuffleQuestions: boolean }) => void;
}) {
  const group = useId();
  const chosen = source.assignment ?? DEFAULT_ASSIGNMENT;

  return (
    <div className="sets-panel">
      <fieldset className="sets-panel__assignment">
        <legend>Set assignment</legend>
        {ASSIGNMENTS.map((assignment) => (
          <div className="sets-panel__choice" key={assignment}>
            <div className="sets-panel__choice-control">
              <input
                type="radio"
                id={`${group}-${assignment}`}
                name={`${group}-assignment`}
                value={assignment}
                checked={chosen === assignment}
                aria-describedby={`${group}-${assignment}-why`}
                onChange={() => onChange({ source: { ...source, assignment }, shuffleQuestions })}
              />
              <label htmlFor={`${group}-${assignment}`}>{ASSIGNMENT_LABEL[assignment]}</label>
            </div>
            <p className="sets-panel__consequence" id={`${group}-${assignment}-why`}>
              {ASSIGNMENT_CONSEQUENCE[assignment]}
            </p>
          </div>
        ))}
      </fieldset>

      <ShuffleFieldset
        shuffleQuestions={shuffleQuestions}
        onChange={(next) => onChange({ source, shuffleQuestions: next })}
      />
    </div>
  );
}
