import { useMemo, useRef, useState, type ReactElement } from "react";
import type { QuestionType, ResponseValue } from "@pariksha/core";
import { Palette, type PaletteQuestion, type PaletteState } from "./Palette";
import { ViewControls, useViewPreferences } from "./ViewControls";
import { Calculator } from "./Calculator";
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

/**
 * Task 5 defines `CandidateQuestion` and `AttemptPaper` in
 * `apps/web/src/lib/run.ts`, alongside the `RunClient.start`/`resume`
 * methods that answer with them. They are declared here, against the
 * plan's pinned shape, so the shell can be built and reviewed before the
 * API half lands; the merge deletes these two and re-points the import.
 */
export interface CandidateQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  points: number;
  media?: { kind: "image"; src: string; alt: string }[];
  options?: { id: string; text: string }[];
  left?: string[];
  right?: string[];
  items?: string[];
  blanks?: { id: string }[];
  unit?: string;
  assertion?: string;
  reason?: string;
  maxLength?: number;
  k?: number;
  group?: { id: string; passage: string };
}

export interface AttemptPaper {
  attemptId: string;
  sections: {
    id: string;
    title: string;
    instructions: string | null;
    timeLimitMinutes: number | null;
    questions: CandidateQuestion[];
  }[];
  responses: Record<string, ResponseValue | null>;
  navigation: "free" | "linear" | "per_section";
  maxIndex: number;
  remainingMs: number;
  sectionRemainingMs: number | null;
  warnAtMinutes: number[];
  lateSyncGraceSeconds: number;
  allowCalculator: boolean;
  serverNow: number;
}

/** Every question in paper order, which is the order the palette numbers
 * and the order `maxIndex` counts in. */
export function flatQuestions(paper: AttemptPaper): CandidateQuestion[] {
  return paper.sections.flatMap((section) => section.questions);
}

function stateOf(
  question: CandidateQuestion,
  at: number,
  paper: AttemptPaper,
  marked: ReadonlySet<string>,
): PaletteState {
  // A `free` paper locks nothing. On `linear` and `per_section` the server
  // is the authority (standing decision 6) and `maxIndex` is its answer;
  // this only draws it.
  if (paper.navigation !== "free" && at > paper.maxIndex) return "locked";
  if (marked.has(question.id)) return "marked";
  if (paper.responses[question.id] != null) return "answered";
  return "unanswered";
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
}) {
  const questions = useMemo(() => flatQuestions(paper), [paper]);
  const view = useViewPreferences();
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const paletteStop = useRef<HTMLButtonElement | null>(null);

  const current = questions[index];
  const number = index + 1;
  const confirm = useDialogKeys<HTMLDivElement>(confirmingClear, () => {
    setConfirmingClear(false);
  });

  const squares: PaletteQuestion[] = questions.map((question, at) => ({
    id: question.id,
    number: at + 1,
    state: stateOf(question, at, paper, marked),
    current: at === index,
  }));

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
      </header>

      <main className="exam-question" aria-label={`Question ${String(number)}`}>
        {questionSlot(current)}

        <div className="exam-question-controls">
          <button
            type="button"
            className="exam-button"
            aria-label="Previous question"
            disabled={index === 0}
            onClick={() => {
              onIndex(index - 1);
            }}
          >
            Previous
          </button>
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
      />
    </div>
  );
}
