// `countedScore()` — `T-14`'s `counted_attempt` (`highest` | `latest` |
// `average`) has been settable, stored, exported and imported since Phase 5
// and has had no reader at all: `TimingPanel.tsx:460` writes it and nothing
// computes it (`K6`). One pure function, so the organiser's results CSV,
// the analytics screen and the candidate's own result page (`K7`,
// `apps/api/src/run/release.ts`) all read the same arithmetic rather than
// growing three independent, and eventually disagreeing, readings of
// "best"/"latest"/"average".
//
// No I/O, no runtime dependencies, nothing time- or randomness-based:
// packages/core is a pure, leaf package.

import { round2 } from "./grade/result.js";
import type { CountedAttempt } from "./types.js";

/** One attempt's contribution — just enough to pick a winner and name it. */
export interface AttemptFigure {
  attemptId: string;
  /** 0-100, as AttemptScore.percent already is. */
  percent: number;
  submittedAt: number;
}

export interface CountedResult {
  percent: number;
  /** null under "average" — the figure belongs to no single attempt. */
  attemptId: string | null;
  /** How many attempts the figure was computed from. */
  of: number;
}

/** Returns null for an empty list. Rounds to 2dp, as AttemptScore does. */
export function countedScore(
  attempts: readonly AttemptFigure[],
  mode: CountedAttempt,
): CountedResult | null {
  if (attempts.length === 0) return null;
  const of = attempts.length;

  if (mode === "average") {
    const mean = attempts.reduce((sum, one) => sum + one.percent, 0) / of;
    return { percent: round2(mean), attemptId: null, of };
  }

  const winner =
    mode === "highest"
      ? attempts.reduce((best, one) => (one.percent > best.percent ? one : best))
      : attempts.reduce((latest, one) => (one.submittedAt > latest.submittedAt ? one : latest));
  return { percent: round2(winner.percent), attemptId: winner.attemptId, of };
}
