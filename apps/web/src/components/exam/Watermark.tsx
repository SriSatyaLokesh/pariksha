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
 *  prove nothing about when a photograph was taken. */
const TICK_MS = 1_000;

export function Watermark({ attemptId }: WatermarkProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date());
    }, TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, []);

  const stamp = `${attemptId} · ${now.toLocaleString()}`;

  return (
    <div className="exam-watermark" data-watermark aria-hidden="true">
      {Array.from({ length: TILE_COUNT }, (_, i) => (
        <span key={i}>{stamp}</span>
      ))}
    </div>
  );
}
