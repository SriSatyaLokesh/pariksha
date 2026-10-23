// Phase 7e Task 5 (`Q6`), as the brief's own fixtures and assertions
// (task-5-brief.md), amended where the owner ruling `P7E-R9` (2026-10-23,
// verbatim: "escalate unwatched to review, dont render clean") overrides
// the plain reading of `Q6b` — noted at each site that changed.

import { describe, expect, it } from "vitest";
import { PROCTORING_DEFAULTS, integrityFor, type ProctoringEventType, type ResolvedProctoring } from "../src/index.js";

type EventIn = { type: ProctoringEventType; detail?: unknown };
type SnapshotIn = { faceCount: number | null };

// Strict: `requireCamera: true`, `snapshotIntervalSeconds: 60` — "watching
// configured" per `P7E-R9`'s scoping. `expectedSnapshots: 0` and no
// snapshots by default — an attempt that has just started, where nothing
// is yet missing because nothing has yet been promised to have arrived.
function base(overrides: {
  events?: EventIn[];
  snapshots?: SnapshotIn[];
  resolved?: ResolvedProctoring;
  expectedSnapshots?: number;
}): {
  events: EventIn[];
  snapshots: SnapshotIn[];
  resolved: ResolvedProctoring;
  expectedSnapshots: number;
} {
  return {
    events: overrides.events ?? [],
    snapshots: overrides.snapshots ?? [],
    resolved: overrides.resolved ?? PROCTORING_DEFAULTS.strict,
    expectedSnapshots: overrides.expectedSnapshots ?? 0,
  };
}

describe("integrityFor", () => {
  it("is clean with no events", () => {
    expect(integrityFor(base({}))).toEqual({ flag: "clean", observed: true });
  });

  it("is review on any violation", () => {
    expect(integrityFor(base({ events: [{ type: "window_blur" }] })).flag).toBe("review");
  });

  it("is high_risk at the violation limit", () => {
    expect(integrityFor(base({ events: Array(5).fill({ type: "window_blur" }) })).flag).toBe("high_risk");
  });

  // Boundary: one below the limit stays `review`, never `high_risk` — the
  // off-by-one `>=` versus `>` is the whole bug surface here.
  it("stays review one violation short of the limit", () => {
    expect(integrityFor(base({ events: Array(4).fill({ type: "window_blur" }) })).flag).toBe("review");
  });

  it("is high_risk past the camera-outage threshold", () => {
    expect(integrityFor(base({ events: [
      { type: "camera_lost", detail: { outageMs: 130_000 } },
    ] })).flag).toBe("high_risk");
  });

  // Boundary: the default threshold is exactly 120s — met, not just
  // crossed, still counts (`>=`).
  it("is high_risk exactly at the camera-outage threshold", () => {
    expect(integrityFor(base({ events: [
      { type: "camera_lost", detail: { outageMs: 120_000 } },
    ] })).flag).toBe("high_risk");
  });

  // Boundary: one second under the threshold is `review` (camera_lost is
  // still a violation), never `high_risk`.
  it("stays review one second under the camera-outage threshold", () => {
    expect(integrityFor(base({ events: [
      { type: "camera_lost", detail: { outageMs: 119_000 } },
    ] })).flag).toBe("review");
  });

  // Q3a — null is not evidence.
  it("never reaches the multi-face threshold on Phase 7's null counts", () => {
    expect(integrityFor(base({ snapshots: Array(10).fill({ faceCount: null }) })).flag).toBe("clean");
  });

  it("reaches it on two snapshots with more than one face", () => {
    expect(integrityFor(base({
      snapshots: [{ faceCount: 2 }, { faceCount: 3 }, { faceCount: 1 }, { faceCount: null }],
    })).flag).toBe("high_risk");
  });

  // Boundary: one multi-face snapshot, one short of the default threshold
  // of 2, is not itself a `VIOLATION_EVENTS` member — it stays clean rather
  // than silently becoming `review` through a different door than `Q6`
  // names ("review on any violation at all").
  it("stays clean one multi-face snapshot short of the threshold", () => {
    expect(integrityFor(base({ snapshots: [{ faceCount: 2 }] })).flag).toBe("clean");
  });

  // Q6b's substance survives P7E-R9: a failure is still not a violation —
  // `violationCount` stays 0, so a genuine `high_risk` is never reached off
  // failures alone.
  //
  // P7E-R9 changes the *outcome* from the brief's own verbatim
  // `{ flag: "clean", observed: false }` (forbidden by the ruling) to
  // `{ flag: "review", observed: false }` — the ruling's whole point.
  it("marks an attempt unobserved without flagging the candidate", () => {
    const r = integrityFor(base({ events: Array(20).fill({ type: "snapshot_failed" }) }));
    expect(r).toEqual({ flag: "review", observed: false });
  });

  // Boundary on the implementation's own `FAILURE_EVENT_THRESHOLD` (3):
  // below it a dropped frame stays silent ("not one upload failed").
  it("stays observed below the failure-event threshold", () => {
    expect(integrityFor(base({ events: Array(2).fill({ type: "snapshot_failed" }) })).observed).toBe(true);
  });
  it("goes unobserved exactly at the failure-event threshold", () => {
    expect(integrityFor(base({ events: Array(3).fill({ type: "snapshot_failed" }) })).observed).toBe(false);
  });

  it("marks unobserved when far fewer snapshots arrived than the interval implies", () => {
    expect(integrityFor(base({ expectedSnapshots: 60, snapshots: Array(3).fill({ faceCount: null }) })).observed).toBe(false);
  });

  // Boundary on `UNOBSERVED_SHORTFALL_RATIO` (0.5): exactly half arrived is
  // not yet "materially short"; one fewer is.
  it("stays observed at exactly half of what the interval implied", () => {
    expect(integrityFor(base({ expectedSnapshots: 10, snapshots: Array(5).fill({ faceCount: null }) })).observed).toBe(true);
  });
  it("goes unobserved one snapshot short of half", () => {
    expect(integrityFor(base({ expectedSnapshots: 10, snapshots: Array(4).fill({ faceCount: null }) })).observed).toBe(false);
  });

  // --- P7E-R9's mandatory pair --------------------------------------------

  const strictWithNoEvidence = base({
    resolved: PROCTORING_DEFAULTS.strict,
    expectedSnapshots: 20,
    snapshots: [],
  });
  const standardWithNoEvidence = base({
    resolved: PROCTORING_DEFAULTS.standard,
    expectedSnapshots: 0,
    snapshots: [],
  });

  it("escalates an unwatched Strict attempt to review", () => {
    expect(integrityFor(strictWithNoEvidence)).toEqual({ flag: "review", observed: false });
  });
  it("leaves a Standard attempt clean — nothing was expected, so nothing is missing", () => {
    expect(integrityFor(standardWithNoEvidence)).toEqual({ flag: "clean", observed: true });
  });

  // A genuine high_risk still wins over an unwatched attempt (P7E-R9).
  it("stays high_risk, not merely review, when an unwatched attempt also crosses a threshold", () => {
    expect(integrityFor(base({
      expectedSnapshots: 20,
      snapshots: [],
      events: Array(5).fill({ type: "window_blur" }),
    }))).toEqual({ flag: "high_risk", observed: false });
  });

  // No input combination reaches the forbidden pair: observed false always
  // floors the flag at review or above, regardless of any other signal.
  it("never returns clean with observed false, across every signal that can drive observed false", () => {
    const unobservedInputs = [
      base({ events: Array(3).fill({ type: "snapshot_failed" }) }),
      base({ events: Array(20).fill({ type: "proctoring_unavailable" }) }),
      base({ expectedSnapshots: 60, snapshots: [] }),
      strictWithNoEvidence,
    ];
    for (const input of unobservedInputs) {
      const result = integrityFor(input);
      expect(result.observed).toBe(false);
      expect(result.flag).not.toBe("clean");
    }
  });
});
