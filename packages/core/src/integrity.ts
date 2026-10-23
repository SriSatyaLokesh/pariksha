// Phase 7e Task 5 (`Q6`): the verdict an organiser reads, one flag per
// attempt — `clean` / `review` / `high_risk` — plus whether anyone was
// actually watching. Pure, per `packages/core`'s purity gate: no
// `new Date()`, no I/O. Every fact this needs — the events, the snapshots,
// the resolved proctoring settings and how many snapshots the interval and
// the elapsed time implied by now — arrives as input; the caller
// (`apps/api/src/routes/proctoring.ts`, `apps/api/src/run/submit.ts`) is
// where the clock and the database live.
//
// `Q6a`: computed, never stored as the last word — the caller recomputes
// this on every submit and whenever a violation (or a stack failure) lands,
// and writes the result through `setIntegrity` (`@pariksha/db`, 7a Task 3).

import {
  FAILURE_EVENTS,
  VIOLATION_EVENTS,
  type ProctoringEventType,
  type ResolvedProctoring,
} from "./proctoring.js";

export type IntegrityFlag = "clean" | "review" | "high_risk";

/**
 * `P7E-R9` (owner ruling, 2026-10-23) — verbatim: "escalate unwatched to
 * review, dont render clean." `integrityFor` must never answer
 * `{ flag: "clean", observed: false }`. When nobody was watching, `review`
 * is the floor; a genuine `high_risk` still wins (an unwatched attempt that
 * also crossed a threshold stays `high_risk`). `observed` stays its own
 * field — `review` is reachable for two unrelated reasons an organiser must
 * be able to tell apart: violations that were seen, and silence that
 * shouldn't have been there.
 *
 * Scoping (also the ruling, and what keeps it from being noise): "watching"
 * only ever meant something under a camera-requiring, interval-capturing
 * configuration. Off, and Standard's `snapshotIntervalSeconds: 0` /
 * `requireCamera: false` defaults, promised nothing, so nothing can be
 * missing from them — `observed` stays `true` there regardless of the two
 * signals below. Get this backwards and every Standard attempt escalates
 * to `review` forever, which warns nobody about anything.
 */
function watchingConfigured(resolved: ResolvedProctoring): boolean {
  return resolved.requireCamera && resolved.snapshotIntervalSeconds > 0;
}

/**
 * `Q6b`'s substance survives `P7E-R9`: a stack failure (`FAILURE_EVENTS` —
 * `proctoring_unavailable`, `snapshot_failed`) is still not a violation and
 * still no reflection on the candidate. But three or more of them in one
 * attempt is the capture pipeline not working, not one flaky upload — below
 * this a single dropped frame stays silent, same as Step 3's own "not one
 * upload failed."
 */
const FAILURE_EVENT_THRESHOLD = 3;

/**
 * The other way `observed` goes false: `K11` deliberately refuses a
 * heartbeat, so a candidate who simply switches proctoring off leaves no
 * `FAILURE_EVENTS` at all — silence on the event stream is indistinguishable
 * from honest quiet. `expectedSnapshots` (the resolved interval against the
 * elapsed time — the caller's job, not this function's) is what catches
 * that instead: fewer than half of what the interval promised having
 * actually arrived is a material gap, not "one upload failed." This is the
 * one constant `Q6`'s ruling allows for "unobserved" — three organiser
 * numbers (`violationLimit`, `cameraOutageSeconds`, `multiFaceSnapshots`)
 * plus this, never a fourth organiser control.
 */
const UNOBSERVED_SHORTFALL_RATIO = 0.5;

export function integrityFor(input: {
  events: { type: ProctoringEventType; detail?: unknown }[];
  snapshots: { faceCount: number | null }[];
  resolved: ResolvedProctoring;
  /** How many interval snapshots should have arrived by now — the caller's
   *  own `snapshotIntervalSeconds` and elapsed-time arithmetic, not
   *  recomputed here. */
  expectedSnapshots: number;
}): { flag: IntegrityFlag; observed: boolean } {
  const { events, snapshots, resolved, expectedSnapshots } = input;

  const violationCount = events.filter((event) => VIOLATION_EVENTS.has(event.type)).length;

  // `Q3a`: `null` is not evidence of anything — only a `faceCount` that is a
  // number greater than one counts toward the multi-face threshold. Every
  // Phase 7 snapshot is `null` (face detection is pre-cut, `Q3`), so this is
  // always 0 today; the field and the threshold exist for the reader that
  // eventually writes a real count.
  const multiFaceCount = snapshots.filter(
    (snapshot) => typeof snapshot.faceCount === "number" && snapshot.faceCount > 1,
  ).length;

  // The longest single `camera_lost` outage, in seconds. `camera_lost` is
  // itself a `VIOLATION_EVENTS` member, so even a short outage already
  // triggers `review` through `violationCount` below; only a long enough
  // one crosses into `high_risk`.
  const cameraOutageSeconds = events
    .filter((event) => event.type === "camera_lost")
    .reduce((longest, event) => {
      const detail = event.detail as { outageMs?: unknown } | undefined;
      const outageMs = typeof detail?.outageMs === "number" ? detail.outageMs : 0;
      return Math.max(longest, outageMs / 1000);
    }, 0);

  const highRisk =
    violationCount >= resolved.violationLimit ||
    cameraOutageSeconds >= resolved.cameraOutageSeconds ||
    multiFaceCount >= resolved.multiFaceSnapshots;

  const watching = watchingConfigured(resolved);
  const failureCount = events.filter((event) => FAILURE_EVENTS.has(event.type)).length;
  const reportedFailure = failureCount >= FAILURE_EVENT_THRESHOLD;
  const silentShortfall =
    expectedSnapshots > 0 && snapshots.length < expectedSnapshots * UNOBSERVED_SHORTFALL_RATIO;
  const observed = !(watching && (reportedFailure || silentShortfall));

  if (highRisk) return { flag: "high_risk", observed };
  // `P7E-R9`: the floor. An attempt nobody was watching is never `clean`.
  if (!observed) return { flag: "review", observed: false };
  if (violationCount > 0) return { flag: "review", observed: true };
  return { flag: "clean", observed: true };
}
