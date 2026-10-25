import { useMemo, useRef, useState, type ReactElement } from "react";
import { NAVIGATION_LOCKED_MESSAGE } from "@pariksha/core";
import type { AttemptPaper, CandidateQuestion } from "../../lib/paper";
import { Palette, type PaletteQuestion, type PaletteState } from "./Palette";
import { ViewControls, useViewPreferences } from "./ViewControls";
import { Calculator } from "./Calculator";
import { SectionNav } from "./SectionNav";
import { useDialogKeys } from "../useDialogKeys";

/**
 * C-04's test runner shell: the question column, the numbered palette, the
 * four controls, the view controls and the calculator. The question body
 * (Task 7), the save banner (Task 8) and the clock (Task 9) arrive as
 * slots, so this screen is testable and committable before any of them
 * exists.
 *
 * `DESIGN.md`, "The clock kills the canvas": cream and ink, hairline
 * ruled, the voltage surviving only as the "you are here" square and the
 * focus ring. **Nothing here animates** — a candidate who thinks the page
 * reloaded thinks their answer was lost. Below 1024px there is no layout,
 * because `P-01` blocks the device.
 */

/** Every question in paper order, which is the order the palette numbers
 * and the order `maxIndex` counts in. */
export function flatQuestions(paper: AttemptPaper): CandidateQuestion[] {
  return paper.sections.flatMap((section) => section.questions);
}

/**
 * Which section each flat index falls in, as one array — the browser's
 * copy of the server's `sectionIndexOf`, over the same pinned order.
 */
export function sectionOfIndex(paper: AttemptPaper): number[] {
  return paper.sections.flatMap((section, at) => section.questions.map(() => at));
}

/**
 * The first question of the next section that actually *has* a question,
 * or null when there is none. `C-07`'s auto-advance target.
 *
 * The first index in a **later** section, not the first in `here + 1`:
 * `sectionOfIndex` emits one entry per question, so a section an organiser
 * left empty contributes no entry at all and an exact match would strand
 * the candidate in the section whose time has just run out.
 */
export function firstOfNextSection(paper: AttemptPaper, index: number): number | null {
  const sections = sectionOfIndex(paper);
  const here = sections[index] ?? 0;
  const next = sections.findIndex((at) => at > here);
  return next === -1 ? null : next;
}

/**
 * The first flat question index of a given section index, or 0 if not found.
 */
export function firstIndexOfSection(paper: AttemptPaper, sectionIndex: number): number {
  const sections = sectionOfIndex(paper);
  const first = sections.indexOf(sectionIndex);
  return first === -1 ? 0 : first;
}

function stateOf(
  question: CandidateQuestion,
  paper: AttemptPaper,
  marked: ReadonlySet<string>,
): PaletteState {
  if (marked.has(question.id)) return "marked";
  if (paper.responses[question.id] != null) return "answered";
  return "unanswered";
}

/**
 * Which flat indices this candidate may no longer write to (`T-13`).
 *
 * **"No going back", not "no looking forward"** — `AC-14` puts the whole
 * paper in the browser before the network drops, so the lock is on
 * *returning* and nothing else. `linear` closes everything behind
 * `maxIndex`; `per_section` closes every section before the one
 * `maxIndex` falls in, and leaves that section entirely open; `free`
 * closes nothing.
 *
 * The server is the authority (standing decision 6) and refuses the same
 * writes in `apps/api/src/run/navigation.ts`. This only draws it — which
 * is why it reads `maxIndex` off the paper rather than tracking a number
 * of its own.
 */
export function lockedIndices(paper: AttemptPaper): ReadonlySet<number> {
  if (paper.navigation === "free") return new Set();
  const sections = sectionOfIndex(paper);
  const here = sections[paper.maxIndex] ?? 0;
  const locked = new Set<number>();
  for (let at = 0; at < sections.length; at++) {
    const behind =
      paper.navigation === "linear" ? at < paper.maxIndex : (sections[at] ?? 0) < here;
    if (behind) locked.add(at);
  }
  return locked;
}

/** Why, in the test's own words — `C-02`: a refusal names the thing that
 *  helps. `undefined` on a `free` paper, where nothing is locked.
 *
 *  The sentence is `@pariksha/core`'s, not a second copy: written out by
 *  hand here it had already drifted from the server's 403 on
 *  `per_section`. */
export function lockedReasonFor(paper: AttemptPaper): string | undefined {
  return paper.navigation === "free" ? undefined : NAVIGATION_LOCKED_MESSAGE[paper.navigation];
}

/**
 * The rail, as `Palette` takes it.
 *
 * `locked` is additive beside `current`, not a sixth `state`: under
 * `linear` every question behind the candidate is locked, and a
 * single-valued state would repaint the whole rail as padlocks and lose
 * the answered/marked information the palette exists to carry.
 */
export function paletteStates(
  paper: AttemptPaper,
  marked: ReadonlySet<string>,
  current: number,
): PaletteQuestion[] {
  const locked = lockedIndices(paper);
  return flatQuestions(paper).map((question, at) => ({
    id: question.id,
    number: at + 1,
    state: stateOf(question, paper, marked),
    current: at === current,
    ...(locked.has(at) ? { locked: true } : {}),
  }));
}

/**
 * Mark-for-review is browser state, not a column (the plan's "Smaller
 * calls" ruling), keyed by attempt id so two attempts in one browser do
 * not share marks. The owner is whoever owns the attempt — `routes/exam`
 * — and `Runner` only reads the prop.
 */
export function markedStorageKey(attemptId: string): string {
  return `pariksha.marked.${attemptId}`;
}

export function readMarked(attemptId: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(markedStorageKey(attemptId)) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeMarked(attemptId: string, marked: ReadonlySet<string>): void {
  try {
    localStorage.setItem(markedStorageKey(attemptId), JSON.stringify([...marked]));
  } catch {
    /* a mark that cannot be remembered still shows for this tab */
  }
}

export function Runner({
  paper,
  index,
  onIndex,
  marked,
  onToggleMark,
  onClear,
  questionSlot,
  clockSlot,
  bannerSlot,
  submitSlot,
}: {
  paper: AttemptPaper;
  index: number;
  onIndex: (next: number) => void;
  marked: ReadonlySet<string>;
  onToggleMark: (questionId: string) => void;
  onClear: (questionId: string) => void;
  questionSlot: (question: CandidateQuestion) => ReactElement;
  clockSlot: ReactElement;
  bannerSlot: ReactElement;
  /** The one irreversible control in the runtime (Task 11). A slot, like
   *  the clock and the banner beside it, because what pressing it does
   *  belongs to whoever owns the attempt and not to the layout. */
  submitSlot: ReactElement;
}) {
  const questions = useMemo(() => flatQuestions(paper), [paper]);
  const sectionIndices = useMemo(() => sectionOfIndex(paper), [paper]);
  const currentSectionIndex = sectionIndices[index] ?? 0;
  const view = useViewPreferences();
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const paletteStop = useRef<HTMLButtonElement | null>(null);

  const current = questions[index];
  const number = index + 1;
  const confirm = useDialogKeys<HTMLDivElement>(confirmingClear, () => {
    setConfirmingClear(false);
  });

  const squares = paletteStates(paper, marked, index);
  const locked = lockedIndices(paper);
  const reason = lockedReasonFor(paper);

  if (!current) return null;

  const isMarked = marked.has(current.id);

  return (
    <div className="exam-runner">
      <header className="exam-runner-bar">
        {/* The rail is to the right of the question, which is where a
            candidate looks for it — so the keyboard needs a way to it
            that is not seventeen tab stops through the question first.
            This is the runner's first tab stop. */}
        <button
          type="button"
          className="exam-skip"
          onClick={() => {
            paletteStop.current?.focus();
          }}
        >
          Skip to the palette
        </button>
        <div className="exam-runner-clock">{clockSlot}</div>
        <div className="exam-runner-banner">{bannerSlot}</div>
        <ViewControls {...view} />
        {paper.allowCalculator && (
          <button
            type="button"
            className="exam-calc-open"
            onClick={() => {
              setCalculatorOpen(true);
            }}
          >
            Calculator
          </button>
        )}
        {/* Last in the bar and pushed to its end: the one primary action
            on the screen, as far from Next and Clear as the row allows,
            because it cannot be undone. */}
        <div className="exam-runner-finish">{submitSlot}</div>
      </header>

      <main className="exam-question" aria-label={`Question ${String(number)}`}>
        <SectionNav
          sections={paper.sections}
          activeSectionIndex={currentSectionIndex}
          navigation={paper.navigation}
          onSelectSection={(targetSection) => {
            const first = firstIndexOfSection(paper, targetSection);
            onIndex(first);
          }}
          sectionRemainingMs={paper.sectionRemainingMs}
        />
        {questionSlot(current)}

        <div className="exam-question-controls">
          {/* **Absent, not disabled, when the question behind is locked.**
              A disabled control is a promise that the thing exists and
              might come back; under `linear` it never will, and leaving
              a dead button on the one screen a candidate cannot leave is
              a question they spend their own exam time on. The general
              form, so it covers `per_section`'s first question and
              `linear` alike: hide it exactly when the target is closed.
              At index 0 there is no target at all. */}
          {!locked.has(index - 1) && (
            <button
              type="button"
              className="exam-button"
              aria-label="Previous question"
              // At the start of the paper it is disabled, not absent:
              // there is a previous question in principle and the
              // candidate will have one in a moment. A *locked* previous
              // question is the different case handled above.
              disabled={index === 0}
              onClick={() => {
                onIndex(index - 1);
              }}
            >
              Previous
            </button>
          )}
          <button
            type="button"
            className="exam-button"
            aria-label="Next question"
            disabled={index >= questions.length - 1}
            onClick={() => {
              onIndex(index + 1);
            }}
          >
            Next
          </button>
          <button
            type="button"
            className="exam-button"
            aria-pressed={isMarked}
            onClick={() => {
              onToggleMark(current.id);
            }}
          >
            Mark for review
          </button>
          <button
            type="button"
            className="exam-clear"
            onClick={() => {
              setConfirmingClear(true);
            }}
          >
            Clear answer
          </button>
        </div>

        {confirmingClear && (
          // DESIGN.md's `button-danger`: "always paired with a
          // confirmation naming what is about to happen".
          <div
            className="exam-confirm"
            role="dialog"
            aria-label="Clear answer"
            ref={confirm.dialogRef}
            tabIndex={-1}
            onKeyDown={confirm.onKeyDown}
          >
            <p>Clear your answer to question {number}? This cannot be undone.</p>
            <button
              type="button"
              className="exam-confirm-danger"
              onClick={() => {
                setConfirmingClear(false);
                onClear(current.id);
              }}
            >
              Clear it
            </button>
            <button
              type="button"
              className="exam-button"
              onClick={() => {
                setConfirmingClear(false);
              }}
            >
              Keep it
            </button>
          </div>
        )}
        {/* Inside the landmark on purpose: a dialog is not a landmark,
            and content outside every landmark is content a screen-reader
            user can only reach by walking the whole page. */}
        {calculatorOpen && (
          <Calculator
            onClose={() => {
              setCalculatorOpen(false);
            }}
          />
        )}
      </main>

      <Palette
        questions={squares}
        onJump={(id) => {
          onIndex(questions.findIndex((question) => question.id === id));
        }}
        focusRef={paletteStop}
        {...(reason === undefined ? {} : { lockedReason: reason })}
      />
    </div>
  );
}
