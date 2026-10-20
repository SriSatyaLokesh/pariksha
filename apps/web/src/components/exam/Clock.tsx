import { useEffect, useRef, useState, type ReactElement } from "react";

/**
 * The candidate's countdown (#73, P6.9) — **Review Focus 4**.
 *
 * **It never reads the wall clock.** A countdown computed as
 * `deadlineAt - Date.now()` is wrong the instant the machine's clock is
 * corrected, wakes from sleep, or is deliberately changed: the candidate
 * is handed either an hour of free time or a sudden panic, and both arrive
 * as a support ticket that reads like data loss. So this component stores
 * no absolute deadline at all. It holds an **anchor** — a reading the
 * server sent, stamped with the `performance.now()` at which it arrived —
 * and shows `anchor.remainingMs - (performance.now() - anchor.at)`.
 * `performance.now()` is monotonic and unaffected by the system clock, so
 * moving `Date.now()` forward an hour moves nothing here. That is a
 * property of the shape, not of the test that proves it.
 *
 * The server is still the authority (standing decision 6): every response
 * carries `remainingMs`, the attempt view re-anchors from it, and drift of
 * any kind is corrected by the next save rather than accumulating.
 *
 * `DESIGN.md`: cream chip, hairline border, tabular figures, and **one**
 * swap to `timer-chip-urgent` at the last warning mark. Nothing pulses,
 * flashes or animates — motion under a clock reads as lag, and a candidate
 * who thinks the page moved thinks their answer went with it.
 */

/** A server reading plus the monotonic instant it was taken at. */
export interface ClockAnchor {
  remainingMs: number;
  sectionRemainingMs: number | null;
  /** `performance.now()`, never `Date.now()`. */
  at: number;
}

/**
 * Re-anchors from any server response. Called by the attempt view on the
 * paper it was handed, and again on every save the queue drains — which is
 * why Task 8's `putAnswer` carries `remainingMs` at all.
 */
export function anchorFrom(remainingMs: number, sectionRemainingMs: number | null): ClockAnchor {
  return { remainingMs, sectionRemainingMs, at: performance.now() };
}

/**
 * Re-anchor from a **save**, which carries the paper's own remaining time
 * and not the section's.
 *
 * The section is carried forward from where the previous anchor projects
 * it to be now — monotonically, like everything else here. Inventing a
 * zero or reusing a stale absolute would be worse than the small drift of
 * a section clock the server is not reporting on, and the next resume
 * corrects it from the row.
 */
export function reanchor(previous: ClockAnchor, remainingMs: number): ClockAnchor {
  const elapsed = performance.now() - previous.at;
  return anchorFrom(
    remainingMs,
    previous.sectionRemainingMs === null
      ? null
      : Math.max(0, previous.sectionRemainingMs - elapsed),
  );
}

/** `H:MM:SS` over an hour, `MM:SS` under it. Floor, not round: a clock
 *  that shows 45:00 when 44:59.6 is left has lied by half a second in the
 *  candidate's favour, and the server will not agree. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = total >= 3600 ? String(Math.floor(total / 60) % 60).padStart(2, "0") : String(Math.floor(total / 60));
  return total >= 3600 ? `${String(Math.floor(total / 3600))}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

/** How many of the configured marks this reading has passed. The marks are
 *  sorted descending so the count rises by one at each, whatever order the
 *  organiser listed them in. */
function warningsPassed(remainingMs: number, warnAtMinutes: readonly number[]): number {
  return [...warnAtMinutes]
    .sort((a, b) => b - a)
    .filter((minutes) => remainingMs <= minutes * 60_000).length;
}

/**
 * Milliseconds since the anchor, from the monotonic clock.
 *
 * Ticks once a second, and **again on `visibilitychange`**: a background
 * tab's timers are throttled to once a minute or stopped outright, so a
 * candidate coming back to the tab would otherwise read a countdown up to
 * a minute stale for up to a second. The recompute is local — no request —
 * because `performance.now()` kept running while the tab was hidden.
 */
function useElapsed(anchorAt: number): number {
  const [elapsed, setElapsed] = useState(() => performance.now() - anchorAt);

  useEffect(() => {
    const tick = () => {
      setElapsed(performance.now() - anchorAt);
    };
    tick();
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [anchorAt]);

  return elapsed;
}

function Chip({
  id,
  label,
  remainingMs,
  urgent,
  warnings,
}: {
  id: string;
  label: string;
  remainingMs: number;
  urgent: boolean;
  warnings: number;
}): ReactElement {
  return (
    <span
      // `timer`'s accessible name comes from the author, never from its
      // content, so the two spans are named explicitly — and the name is a
      // superset of the visible text (WCAG 2.5.3) because the value span
      // is one of the two things it points at.
      role="timer"
      aria-labelledby={`${id}-label ${id}-value`}
      className={`exam-timer${urgent ? " timer-chip-urgent" : ""}`}
      data-warn={warnings}
    >
      <span id={`${id}-label`} className="exam-timer-label">
        {label}
      </span>
      {/* The non-colour carrier. `DESIGN.md` allows exactly one colour
          swap and no pulse, so the mark is what a greyscale or
          colour-blind reader sees change at each mark. */}
      {warnings > 0 && (
        <span className="exam-timer-mark" aria-hidden="true">
          {"!".repeat(warnings)}
        </span>
      )}
      <span id={`${id}-value`} className="exam-timer-value">
        {formatRemaining(remainingMs)}
      </span>
    </span>
  );
}

/** Fires its callback once, the first time `remainingMs` reaches zero.
 *  Once per mount and not once per anchor: a save that happens to answer
 *  `remainingMs: 0` re-anchors, and a second submission out of that would
 *  be a second request from a candidate who has already finished. */
function useZeroOnce(remainingMs: number, at: number | null, onZero: (() => void) | undefined) {
  const fired = useRef(false);
  useEffect(() => {
    if (at === null || remainingMs > 0 || fired.current || !onZero) return;
    fired.current = true;
    onZero();
  }, [remainingMs, at, onZero]);
}

export function Clock({
  anchor,
  warnAtMinutes,
  onZero,
  onSectionZero,
}: {
  anchor: ClockAnchor;
  warnAtMinutes: readonly number[];
  /** Fired once, when the whole paper's countdown reaches zero. The owner
   *  **drains the save queue before it submits**; see `routes/exam.tsx`. */
  onZero: () => void;
  /** `C-07`'s client half: the section's own clock reaching zero is what
   *  moves the candidate on. The server half is the refusal that names
   *  the next section. */
  onSectionZero?: () => void;
}): ReactElement {
  const elapsed = useElapsed(anchor.at);
  const remainingMs = Math.max(0, anchor.remainingMs - elapsed);
  const sectionRemainingMs =
    anchor.sectionRemainingMs === null ? null : Math.max(0, anchor.sectionRemainingMs - elapsed);

  const marks = [...warnAtMinutes].sort((a, b) => b - a);
  // Each clock warns on its own remaining time: a ten-minute section
  // inside a forty-five-minute paper has to warn at its own two minutes,
  // not at the paper's.
  const totalWarnings = warningsPassed(remainingMs, marks);
  const sectionWarnings =
    sectionRemainingMs === null ? 0 : warningsPassed(sectionRemainingMs, marks);

  useZeroOnce(remainingMs, anchor.at, onZero);
  useZeroOnce(sectionRemainingMs ?? 1, sectionRemainingMs === null ? null : anchor.at, onSectionZero);

  /** What is *said*, as opposed to what is coloured — the carrier a
   *  screen-reader user has instead of the chip. Empty until a mark is
   *  passed, so nothing is announced on mount, and it speaks for whichever
   *  clock is closer to the end. */
  const closest =
    sectionRemainingMs !== null && sectionWarnings >= totalWarnings && sectionWarnings > 0
      ? { warnings: sectionWarnings, remainingMs: sectionRemainingMs, where: " in this section" }
      : { warnings: totalWarnings, remainingMs, where: "" };
  const announcement =
    closest.warnings === 0
      ? ""
      : closest.remainingMs === 0
        ? `Your time${closest.where} is up.`
        : `${String(marks[closest.warnings - 1] ?? 0)} minutes remaining${closest.where}.`;

  return (
    <div className="exam-clocks">
      <Chip
        id="exam-clock-total"
        label="Time left"
        remainingMs={remainingMs}
        urgent={totalWarnings >= marks.length && totalWarnings > 0}
        warnings={totalWarnings}
      />
      {sectionRemainingMs !== null && (
        <Chip
          id="exam-clock-section"
          label="This section"
          remainingMs={sectionRemainingMs}
          urgent={sectionWarnings >= marks.length && sectionWarnings > 0}
          warnings={sectionWarnings}
        />
      )}
      {/* Present from the first render rather than inserted with its
          content: a live region a screen reader has never seen is one it
          does not announce. */}
      <p role="status" aria-label="Time warnings" className="exam-clock-announce">
        {announcement}
      </p>
    </div>
  );
}
