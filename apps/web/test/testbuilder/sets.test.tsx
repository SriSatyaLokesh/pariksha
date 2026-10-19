// Set assignment and shuffle configuration (#56, P5.3) — T-09, T-10, UX-08.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import type { SetAssignment, SourceSets } from "@pariksha/core";

import {
  ASSIGNMENT_CONSEQUENCE,
  SetsPanel,
  ShuffleFieldset,
} from "../../src/components/testbuilder/SetsPanel";

const SOURCE: SourceSets = {
  kind: "sets",
  assignment: "round_robin",
  sets: [
    { set: "A", questions: ["qst_1", "qst_2"] },
    { set: "B", questions: ["qst_3", "qst_4"] },
  ],
};

function renderPanel(over: Partial<{ source: SourceSets; shuffleQuestions: boolean }> = {}) {
  const onChange = vi.fn();
  const result = render(
    <SetsPanel
      source={over.source ?? SOURCE}
      shuffleQuestions={over.shuffleQuestions ?? true}
      onChange={onChange}
    />,
  );
  return { ...result, onChange };
}

describe("SetsPanel (T-09)", () => {
  it("each strategy carries its consequence as persistent helper text, not a tooltip", () => {
    renderPanel();
    for (const [key, copy] of Object.entries(ASSIGNMENT_CONSEQUENCE)) {
      expect(screen.getByRole("radio", { name: new RegExp(key.replace(/_/g, " "), "i") })).toBeVisible();
      expect(screen.getByText(copy)).toBeVisible();
    }
  });

  it("the consequence is tied to its own radio, so a screen reader hears it too", () => {
    renderPanel();
    const radio = screen.getByRole("radio", { name: /round robin/i });
    expect(radio).toHaveAccessibleDescription(ASSIGNMENT_CONSEQUENCE.round_robin);
  });

  it("from the candidate list states what happens to a row with no set", () => {
    renderPanel();
    expect(screen.getByText(/cannot start, and the publish checklist says so/i)).toBeVisible();
  });

  // The plan's own sketch for this case ("only the chosen strategy's own
  // options are shown — round_robin shows no list column picker") names a
  // control the format has no home for: `$defs/sourceSets` is
  // `additionalProperties: false` over `kind`/`assignment`/`sets`, and the
  // column is fixed as `set` by ASSIGNMENT_CONSEQUENCE's own copy, so there
  // is no per-strategy field to hide. What is actually falsifiable — and
  // what that case was protecting — is that the panel reflects and writes
  // the stored strategy rather than decorating a hardcoded one.
  it("the stored strategy is the only one checked, and choosing another writes it", () => {
    const { onChange } = renderPanel({ source: { ...SOURCE, assignment: "hash" } });

    const checked = screen.getAllByRole("radio").filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName(/hash/i);

    fireEvent.click(screen.getByRole("radio", { name: /from candidate list/i }));
    expect(onChange).toHaveBeenCalledWith({
      source: { ...SOURCE, assignment: "from_candidate_list" },
      shuffleQuestions: true,
    });
  });

  it("a source that names no assignment reads as round robin, the format's own default", () => {
    const { sets } = SOURCE;
    renderPanel({ source: { kind: "sets", sets } });
    expect(screen.getByRole("radio", { name: /round robin/i })).toBeChecked();
  });

  it("the sets panel has no axe violations", async () => {
    const { container } = renderPanel();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("shuffling (T-10, UX-08)", () => {
  it("the shuffle controls are one group with a legend", () => {
    renderPanel();
    expect(screen.getByRole("group", { name: /shuffling/i })).toBeVisible();
  });

  it("the group is one switch and two statements of fact, not three switches", () => {
    renderPanel();
    const group = screen.getByRole("group", { name: /shuffling/i });
    expect(within(group).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(group).queryAllByRole("radio")).toHaveLength(0);
    expect(within(group).getByRole("checkbox", { name: /shuffle questions within this section/i })).toBeVisible();
    expect(within(group).getByText(/answer-option order is set per question/i)).toBeVisible();
  });

  it("UX-08: ordering items are stated to shuffle regardless of these switches", () => {
    renderPanel();
    expect(screen.getByText(/ordering questions always shuffle their items/i)).toBeVisible();
  });

  it("the switch reflects the section's own shuffle_questions and writes the change", () => {
    const { onChange } = renderPanel({ shuffleQuestions: true });
    const toggle = screen.getByRole("checkbox", { name: /shuffle questions within this section/i });
    expect(toggle).toBeChecked();

    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ source: SOURCE, shuffleQuestions: false });
  });

  it("an off switch reads as off, so the control is not write-only", () => {
    renderPanel({ shuffleQuestions: false });
    expect(screen.getByRole("checkbox", { name: /shuffle questions within this section/i })).not.toBeChecked();
  });

  it("the shuffle group alone has no axe violations", async () => {
    const { container } = render(<ShuffleFieldset shuffleQuestions={true} onChange={() => undefined} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("the two controls stay independent", () => {
  // A panel that rebuilt both halves of its `onChange` payload from its own
  // internal state, rather than from the props it was handed, would lose
  // whichever half the user did not just touch.
  function Controlled({ assignment }: { assignment: SetAssignment }) {
    const [state, setState] = useState<{ source: SourceSets; shuffleQuestions: boolean }>({
      source: { ...SOURCE, assignment },
      shuffleQuestions: true,
    });
    return <SetsPanel source={state.source} shuffleQuestions={state.shuffleQuestions} onChange={setState} />;
  }

  it("turning shuffling off keeps the chosen strategy, and changing strategy keeps shuffling off", () => {
    render(<Controlled assignment="hash" />);

    fireEvent.click(screen.getByRole("checkbox", { name: /shuffle questions within this section/i }));
    expect(screen.getByRole("radio", { name: /hash/i })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /random/i }));
    expect(screen.getByRole("checkbox", { name: /shuffle questions within this section/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /random/i })).toBeChecked();
  });
});
