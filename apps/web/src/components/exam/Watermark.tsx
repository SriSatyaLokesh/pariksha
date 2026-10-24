/*
 * `Q9` (Phase 7c Task 5): a faint, tiled mark over the paper — identity and
 * the current time — that deters a photograph and survives nothing more
 * than that. It does not stop a DOM inspector or a screenshot with the
 * element deleted, and nothing here pretends otherwise.
 *
 * `attemptId` is the identity it carries. `ProctoringLayer` already holds
 * it (it is the queue's own key), so this draws on what the file already
 * has rather than plumbing a candidate name through `AttemptPaper` and the
 * `/start`/`/attempt` routes for one line of text no part of this task's
 * file list touches.
 *
 * Three things make it honest rather than merely decorative (`Q9`):
 * - `aria-hidden="true"` — excluded from the accessibility tree, so a
 *   screen reader never announces text that exists only for a camera.
 * - `pointer-events: none` and `user-select: none` (`exam.css`) — it
 *   cannot be selected, so it is never part of a copy that grabs the
 *   paper's own text.
 * - `position: fixed`, off the normal flow (`exam.css`, `D8`) — painted
 *   over the paper without moving a single box of it, mounted or not.
 *
 * `T5-R2`: jsdom applies no stylesheet, so `pointer-events`/`user-select`
 * are a blind spot for a unit test — `test/exam/watermark.test.tsx` proves
 * them against the candidate chain's own resolved CSS (`paintsIn`), not
 * against `getComputedStyle` here. `T5-R1`: the no-reflow claim (`D8`)
 * itself is proved in a real browser, in `e2e/measurement/`, for the same
 * reason — jsdom's `getBoundingClientRect()` is all zeros either way.
 */

import { useEffect, useState } from "react";

export interface WatermarkProps {
  attemptId: string;
}

/** Enough tiles to cover an enlarged, rotated viewport (`exam.css`'s own
 *  `inset: -10vmax`) at any real window size without a gap. */
const TILE_COUNT = 40;

/** Live, not precise — a watermark that read the mount time once would
 *  prove nothing about when a photograph was taken.
 *
 *  G5-12 (UI/UX audit). A second-resolution tick rewrote all 40 tiles'
 *  text content every second, behind the question stem, for the whole
 *  attempt. The deterrent a photo needs to defeat is "which minute was
 *  this taken in" — minute resolution reads exactly the same in a photo
 *  and costs the page 1/60th of the DOM writes. Exported so the regression
 *  test pins the constant directly rather than fast-forwarding a real
 *  `setInterval` through fake timers across an async render — `openAttempt`
 *  itself awaits a `findByRole`, which polls on the real clock. */
export const TICK_MS = 60_000;

export function Watermark({ attemptId }: WatermarkProps) {
  const [now, setNow] = useState(() => new Date());

  // r1 (code review, round 3). Dropping seconds from the stamp (m2, below)
  // hid the staleness instead of removing it: a plain `setInterval(cb,
  // TICK_MS)` fires TICK_MS after MOUNT, not after the wall-clock minute
  // it names — mounted at 10:00:59, it first fires at 10:01:59, so the
  // stamp reads "10:00" from 10:01:00 through 10:01:58, a wrong minute for
  // nearly all of it. A minute-resolution display asserts the minute it
  // names; only a tick that lands ON that minute's boundary can back that
  // up. This waits out whatever is left of the current minute once (a
  // `setTimeout`, not a second `setInterval`, since it fires at most
  // once), updates, and only then starts the steady TICK_MS interval --
  // which stays aligned forever, because every whole minute added to a
  // minute boundary is itself a minute boundary.
  useEffect(() => {
    const msToBoundary = (TICK_MS - (Date.now() % TICK_MS)) % TICK_MS;
    let intervalId: number | undefined;
    const alignId = window.setTimeout(() => {
      setNow(new Date());
      intervalId = window.setInterval(() => {
        setNow(new Date());
      }, TICK_MS);
    }, msToBoundary);
    return () => {
      window.clearTimeout(alignId);
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
      }
    };
  }, []);

  // m2 (code review of this plan). `toLocaleString()` renders seconds in
  // most locales, which a 60s tick cannot keep current: mounted at
  // 10:00:59, the stamp reads that exact second until the next tick at
  // 10:01:59, showing the wrong minute for nearly all of it. `timeStyle:
  // "short"` drops seconds, so the rendered precision matches the minute
  // r1's alignment (above) actually lands the tick on.
  const stamp = `${attemptId} · ${now.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}`;

  return (
    <div className="exam-watermark" data-watermark aria-hidden="true">
      {Array.from({ length: TILE_COUNT }, (_, i) => (
        <span key={i}>{stamp}</span>
      ))}
    </div>
  );
}
