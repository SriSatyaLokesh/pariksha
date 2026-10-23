import { useState } from "react";
import type { LockedAttemptRow } from "../../lib/api";

// Phase 7e Task 4 (`Q5a`): the surface the unlock needs — a locked-attempts
// read and, on each row, the one button that calls it. Controlled, the same
// shape every other testbuilder panel takes (`routes/test.tsx` owns the
// fetch and the write; this renders what it is handed and reports what was
// clicked) — `ResultsPanel.tsx`'s own header is why panels here stay
// controlled rather than fetching for themselves.
//
// Returns `null` when nothing is locked, the same convention
// `VersionHistory` (`VersionBanner.tsx`) already follows for its own empty
// case. Deliberate, and documented twice over: the ruling in
// `task-4-brief.md` is that this list does not join `apps/web/e2e/
// density.ts` — `D12` scopes `AG1`'s rows-visible gate to surfaces an
// organiser SCANS, and nobody scans a list that is empty on almost every
// test. An empty state rendered here on every load would be exactly that
// noise.

export function LockedAttempts({
  attempts,
  onUnlock,
}: {
  attempts: readonly LockedAttemptRow[];
  /** Resolves once the attempt is unlocked server-side. The caller (`routes/
   *  test.tsx`) owns removing it from `attempts` — this component only asks. */
  onUnlock: (attemptId: string) => Promise<void>;
}) {
  // Which row's own button is mid-request — disables only that one, not the
  // whole table, so an organiser clearing five attempts in a row is never
  // blocked on the first.
  const [unlocking, setUnlocking] = useState<string | null>(null);
  // Phase 7e fix wave (M5): which row's unlock is armed, awaiting a second
  // click. There is no re-lock surface anywhere in the product — this is at
  // least as irreversible as close/archive, which already confirm — so a
  // mis-click must not fire the request on its own.
  const [confirming, setConfirming] = useState<string | null>(null);

  if (attempts.length === 0) return null;

  return (
    <section className="locked-attempts" aria-labelledby="locked-attempts-heading">
      <h2 id="locked-attempts-heading">Locked attempts</h2>
      {/* `Q2b`'s no-recourse shape, named from the organiser's own side: the
          candidate's overlay (`ProctoringLayer.tsx`) says the same thing in
          its own words, and this is the one place that statement is made
          true. */}
      <p className="release-panel__fact">A locked attempt clears only when you unlock it here.</p>
      <table className="testbuilder-list">
        <thead>
          <tr>
            <th scope="col">Candidate</th>
            <th scope="col">Locked</th>
            <th scope="col">Violations</th>
            <th scope="col">Time left</th>
            <th scope="col">
              <span className="visually-hidden">Unlock</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {attempts.map((attempt) => (
            <tr key={attempt.attemptId}>
              <td>{attempt.candidateLabel}</td>
              <td>{new Date(attempt.lockedAt).toLocaleString()}</td>
              <td>{attempt.violations}</td>
              <td>{Math.ceil(attempt.remainingSeconds / 60)} min</td>
              <td>
                {confirming === attempt.attemptId ? (
                  <span className="locked-attempts__confirm">
                    <span>Unlock {attempt.candidateLabel}?</span>
                    <button
                      type="button"
                      className="button-primary button-primary--surface"
                      disabled={unlocking === attempt.attemptId}
                      onClick={() => {
                        setConfirming(null);
                        setUnlocking(attempt.attemptId);
                        void onUnlock(attempt.attemptId).finally(() => {
                          setUnlocking(null);
                        });
                      }}
                    >
                      Confirm unlock
                    </button>
                    <button type="button" className="button-secondary" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="button-secondary"
                    disabled={unlocking === attempt.attemptId}
                    aria-label={`Unlock ${attempt.candidateLabel}'s attempt`}
                    onClick={() => setConfirming(attempt.attemptId)}
                  >
                    Unlock
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
