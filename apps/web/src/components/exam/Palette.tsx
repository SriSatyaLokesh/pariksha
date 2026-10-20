import { useRef, useState, type KeyboardEvent, type RefObject } from "react";

/**
 * `DESIGN.md`'s `palette-square`, as a navigation rail.
 *
 * "Every palette state carries a non-colour signal" is not a nicety here:
 * `DESIGN.md` says in its own words that colour is never the only carrier,
 * and a candidate with deuteranopia reading forty squares under a clock
 * has no second device and no tomorrow. So each state draws a *shape* —
 * a fill, a corner notch, a ring, a lock glyph — and each square says its
 * state in words in its accessible name. The tests assert both, rather
 * than trusting the stylesheet.
 */
export type PaletteState = "unanswered" | "answered" | "marked" | "current" | "locked";

/**
 * `current` is additive rather than a sixth value of `state`, which is the
 * one place this departs from the plan's pinned shape. A single enum
 * cannot say "the question you are on, which you have also marked" — the
 * commonest thing a candidate does with the mark button — and whichever of
 * the two won, the other's carrier would vanish from the rail. `state`
 * keeps all five of its members (a caller passing `"current"` gets the
 * ring), and `Runner` instead passes the content state plus this flag.
 */
export interface PaletteQuestion {
  id: string;
  number: number;
  state: PaletteState;
  current?: boolean;
  /**
   * `locked` is additive for the same reason `current` is, and Task 10
   * hit the limit from the other side.
   *
   * Under `linear` *every* question behind the candidate is locked, so a
   * single-valued state would repaint the whole rail as a wall of
   * padlocks and destroy the one thing a palette is for: knowing what you
   * have answered. A square can legitimately be answered **and** closed
   * — that is the normal condition of a linear paper — and both carriers
   * have to survive. `state` keeps all five of its members.
   */
  locked?: boolean;
}

/** The shape a greyscale reader sees. `unanswered` is the outline-only
 * default, so it has no carrier of its own to add. */
const CARRIER: Readonly<Record<PaletteState, string>> = {
  unanswered: "",
  answered: "is-filled",
  marked: "has-notch",
  current: "has-ring",
  locked: "has-lock",
};

/** The rail is 240px (`DESIGN.md`) and a square is 36px, so five fit a
 * row. Up and Down move by a row; nothing here measures the DOM for it. */
const COLUMNS = 5;

const isLocked = (question: PaletteQuestion): boolean =>
  question.locked === true || question.state === "locked";

function classesFor(question: PaletteQuestion): string {
  const carriers = [CARRIER[question.state]];
  if (question.current) carriers.push(CARRIER.current);
  if (question.locked) carriers.push(CARRIER.locked);
  return ["palette-square", ...carriers.filter(Boolean)].join(" ");
}

function nameFor(question: PaletteQuestion): string {
  const words = question.current && question.state !== "current" ? ["current"] : [];
  words.push(question.state);
  if (question.locked && question.state !== "locked") words.push("locked");
  return `Question ${String(question.number)} (${words.join(", ")})`;
}

export function Palette({
  questions,
  onJump,
  focusRef,
  lockedReason,
}: {
  questions: PaletteQuestion[];
  onJump: (questionId: string) => void;
  /** The roving tab stop, so a "skip to the palette" control elsewhere on
   * the screen can hand focus to the rail in one keystroke. */
  focusRef?: RefObject<HTMLButtonElement | null>;
  /**
   * Why the locked squares are locked, in the test's own words.
   *
   * "Locked" says *that* a square will not open; `C-02` says a refusal
   * must say what would help. One sentence, written once and referenced
   * by every locked square's `aria-describedby`, so a screen-reader user
   * hears the reason on the square itself rather than having to go
   * looking for it.
   */
  lockedReason?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focused, setFocused] = useState<number | null>(null);

  // One tab stop for the whole rail, arrow keys inside it — the APG's
  // roving tabindex. Seventeen tab stops between the candidate and their
  // question is not keyboard access, it is a penalty for not using a
  // mouse.
  const fallback = Math.max(
    questions.findIndex((question) => question.current),
    0,
  );
  const stop = focused ?? fallback;

  const move = (to: number) => {
    const next = Math.min(Math.max(to, 0), questions.length - 1);
    setFocused(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, at: number) => {
    const delta: Readonly<Record<string, number>> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    if (event.key in delta) {
      event.preventDefault();
      move(at + (delta[event.key] ?? 0));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(questions.length - 1);
    }
  };

  return (
    <nav className="exam-palette" aria-label="Question palette">
      <ul className="exam-palette-grid">
        {questions.map((question, at) => (
          <li key={question.id}>
            <button
              type="button"
              ref={(element) => {
                refs.current[at] = element;
                if (focusRef && at === stop) focusRef.current = element;
              }}
              className={classesFor(question)}
              // The accessible name is a superset of the visible label
              // (WCAG 2.5.3): the square shows its number, the name adds
              // the word "question" and the state.
              aria-label={nameFor(question)}
              aria-current={question.current ? "true" : undefined}
              // `aria-disabled`, not `disabled`: a locked square still has
              // to be reachable and readable, or a candidate cannot find
              // out why it will not open. It is genuinely inert all the
              // same — `onJump` is not called for it below.
              aria-disabled={isLocked(question) ? "true" : undefined}
              aria-describedby={
                isLocked(question) && lockedReason ? "exam-palette-locked-reason" : undefined
              }
              tabIndex={at === stop ? 0 : -1}
              onKeyDown={(event) => {
                onKeyDown(event, at);
              }}
              onFocus={() => {
                setFocused(at);
              }}
              onClick={() => {
                if (!isLocked(question)) onJump(question.id);
              }}
            >
              {question.number}
            </button>
          </li>
        ))}
      </ul>
      {lockedReason && (
        <p id="exam-palette-locked-reason" className="exam-palette-reason">
          {lockedReason}
        </p>
      )}
    </nav>
  );
}
