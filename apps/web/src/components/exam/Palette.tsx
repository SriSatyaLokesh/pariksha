import { useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";

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
export type PaletteState = "unanswered" | "answered" | "marked";

/**
 * A group of questions in one section of the palette.
 */
export interface PaletteSectionGroup {
  id: string;
  title: string;
  questions: PaletteQuestion[];
}

/**
 * `current` and `locked` are **flags beside** `state`, not values of it.
 *
 * A single enum cannot say "the question you are on, which you have also
 * marked" — the commonest thing a candidate does with the mark button —
 * and under `linear` *every* question behind the candidate is locked, so a
 * single-valued state would repaint the whole rail as a wall of padlocks
 * and destroy the one thing a palette is for: knowing what you have
 * answered. A square is legitimately answered **and** closed, and both
 * carriers have to survive.
 *
 * `state` therefore holds only the three a question's *content* can be in.
 * It used to carry `"current"` and `"locked"` as members too, for a caller
 * that might pass them — `paletteStates` never did, nothing else ever
 * called this, and the two arms kept three branches alive that production
 * could not reach.
 */
export interface PaletteQuestion {
  id: string;
  number: number;
  state: PaletteState;
  current?: boolean;
  locked?: boolean;
}

/** The shape a greyscale reader sees — one per state and one per flag.
 * `unanswered` is the outline-only default, so it has no carrier of its
 * own to add. */
const CARRIER = {
  unanswered: "",
  answered: "is-filled",
  marked: "has-notch",
  current: "has-ring",
  locked: "has-lock",
} as const;

/** The rail is 240px (`DESIGN.md`) and a square is 36px, so five fit a
 * row. Up and Down move by a row; nothing here measures the DOM for it. */
const COLUMNS = 5;

const isLocked = (question: PaletteQuestion): boolean => question.locked === true;

function classesFor(question: PaletteQuestion): string {
  const carriers: string[] = [CARRIER[question.state]];
  if (question.current) carriers.push(CARRIER.current);
  if (question.locked) carriers.push(CARRIER.locked);
  return ["palette-square", ...carriers.filter(Boolean)].join(" ");
}

function nameFor(question: PaletteQuestion): string {
  const words = question.current ? ["current"] : [];
  words.push(question.state);
  if (question.locked) words.push("locked");
  return `Question ${String(question.number)} (${words.join(", ")})`;
}

export function Palette({
  questions,
  sections,
  onJump,
  focusRef,
  lockedReason,
}: {
  questions?: PaletteQuestion[];
  sections?: PaletteSectionGroup[];
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

  const allQuestions = useMemo(() => {
    if (sections) {
      return sections.flatMap((section) => section.questions);
    }
    return questions ?? [];
  }, [sections, questions]);

  const indexMap = useMemo(() => {
    const map = new Map<string, number>();
    allQuestions.forEach((q, i) => {
      map.set(q.id, i);
    });
    return map;
  }, [allQuestions]);

  // One tab stop for the whole rail, arrow keys inside it — the APG's
  // roving tabindex. Seventeen tab stops between the candidate and their
  // question is not keyboard access, it is a penalty for not using a
  // mouse.
  const fallback = Math.max(
    allQuestions.findIndex((question) => question.current),
    0,
  );
  const stop = focused ?? fallback;

  const move = (to: number) => {
    const next = Math.min(Math.max(to, 0), allQuestions.length - 1);
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
      move(allQuestions.length - 1);
    }
  };

  const renderSquare = (question: PaletteQuestion) => {
    const at = indexMap.get(question.id) ?? 0;
    return (
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
    );
  };

  return (
    <nav className="exam-palette" aria-label="Question palette">
      {sections ? (
        sections.map((section) => {
          const answeredCount = section.questions.filter((q) => q.state === "answered").length;
          const totalCount = section.questions.length;
          return (
            <div
              key={section.id}
              className="exam-palette-section"
              role="group"
              aria-label={section.title}
            >
              <div className="exam-palette-section-header">
                <h3 className="exam-palette-section-title">{section.title}</h3>
                <span className="exam-palette-section-tally">
                  {answeredCount}/{totalCount} answered
                </span>
              </div>
              <ul className="exam-palette-grid">
                {section.questions.map(renderSquare)}
              </ul>
            </div>
          );
        })
      ) : (
        <ul className="exam-palette-grid">
          {allQuestions.map(renderSquare)}
        </ul>
      )}
      {lockedReason && (
        <p id="exam-palette-locked-reason" className="exam-palette-reason">
          {lockedReason}
        </p>
      )}
    </nav>
  );
}
