// The proctoring queue's lifecycle under React's StrictMode (Phase 7c
// Task 2, review fix round 1 — finding 1).
//
// Review finding 1: `createProctoringQueue` (which starts a `setInterval`)
// used to live in a `useMemo`, stopped from a *separate* effect's cleanup
// — exactly the pattern `routes/exam.tsx`'s own save queue warns against a
// few hundred lines away ("calling it in an effect's cleanup would kill
// the queue on mount under `StrictMode`"), and `exam-main.tsx` really does
// render `<StrictMode>`.
//
// Measured directly against both versions (not inferred): mounting
// `ProctoringLayer` inside `<StrictMode>` always produces two creations
// and, eventually, two stops — StrictMode's dev-only double effect-invoke
// does that regardless of which construction is used, which is why a
// plain call-count assertion on `setInterval`/`clearInterval` cannot tell
// the two apart. What differs is the **pairing**:
//
//  * **Buggy** (`useMemo` builds the queue, a separate effect stops it):
//    `create(1)`, `create(2)`, `stop(1)` — both instances exist before
//    either is stopped, and the one the effect's cleanup actually closes
//    over is the **first**. It gets stopped and is never recreated
//    (`useMemo`'s factory does not re-run for an unchanged `attemptId`).
//    The **second** instance — the one the component's hook state
//    settles on — is never stopped at all: it leaks its own `setInterval`
//    forever while being simultaneously dead to the component, which
//    never reads from it again. `stop(1)` fires a second time at real
//    unmount; `stop(2)` never fires.
//  * **Fixed** (the effect owns both construction and teardown):
//    `create(1)`, `stop(1)`, `create(2)` — paired and sequential, the
//    phantom cycle cleans up fully after itself, and `stop(2)` arrives
//    only at the real unmount.
//
// `createProctoringQueue` is mocked in this file only — `vi.mock` is
// file-scoped in Vitest, so no other suite in `test/exam/` is affected by
// or needs this trace.

import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { resolveProctoring } from "@pariksha/core";

const trace: string[] = [];
let nextId = 0;

vi.mock("../../src/lib/proctoring-queue", () => ({
  createProctoringQueue: () => {
    const id = ++nextId;
    trace.push(`create(${String(id)})`);
    return {
      push: vi.fn(),
      pushImmediate: vi.fn(() => Promise.resolve()),
      buffered: () => 0,
      stop: vi.fn(() => {
        trace.push(`stop(${String(id)})`);
      }),
    };
  },
}));

const { ProctoringLayer } = await import("../../src/components/exam/ProctoringLayer");

describe("ProctoringLayer: queue lifecycle under StrictMode", () => {
  it("creates and stops the queue in matched, non-overlapping pairs, never two creates before the first stop", () => {
    const { unmount } = render(
      <StrictMode>
        <ProctoringLayer
          attemptId="att_strict01"
          proctoring={resolveProctoring({ profile: "strict" })}
          initialViolations={0}
        />
      </StrictMode>,
    );

    // The dev-only double-invoke settles into one full create/stop pair
    // (the phantom mount/unmount) followed by one more create — the
    // still-live instance. Two creates before any stop is the buggy
    // construction's own signature, confirmed by reverting the fix
    // locally and watching this assertion fail with exactly that order.
    expect(trace).toEqual(["create(1)", "stop(1)", "create(2)"]);

    unmount();

    // The real unmount stops exactly the surviving instance, exactly
    // once — not a repeat stop of the phantom's already-dead first one,
    // and not a leaked second interval nothing ever stops.
    expect(trace).toEqual(["create(1)", "stop(1)", "create(2)", "stop(2)"]);
  });
});

// Phase 7d Task 2 review finding 1 (MEDIUM, CONFIRMED — closed in Task 3):
// `cameraStream` is a prop, not something the queue-lifecycle effect builds,
// so it is the SAME object across the phantom mount→cleanup→mount above —
// unlike `queue`, nothing here recreates it. The old, unconditional
// `track.stop()` in that effect's cleanup killed the one real hardware
// track on the phantom cleanup, permanently (a stopped `MediaStreamTrack`
// never comes back), with no test the wiser because no test in this file
// passed a `cameraStream` at all. Pinned here, beside the queue's own trace,
// because it is the same StrictMode cycle doing the damage.
function fakeTrack(): MediaStreamTrack {
  return Object.assign(new EventTarget(), {
    kind: "video",
    readyState: "live",
    muted: false,
    stop: vi.fn(),
  }) as unknown as MediaStreamTrack;
}

function fakeStream(forTrack: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [forTrack],
    getTracks: () => [forTrack],
  } as unknown as MediaStream;
}

describe("ProctoringLayer: the camera survives a StrictMode phantom remount", () => {
  it("does not stop the real track on the phantom cleanup, only on a real unmount", async () => {
    const track = fakeTrack();
    const stream = fakeStream(track);
    const { unmount } = render(
      <StrictMode>
        <ProctoringLayer
          attemptId="att_strict02"
          proctoring={resolveProctoring({ profile: "strict" })}
          initialViolations={0}
          cameraStream={stream}
        />
      </StrictMode>,
    );

    // The phantom mount→cleanup→mount above already ran, synchronously, by
    // the time `render()` returned — if the old, unconditional
    // `track.stop()` were still here, this would already be true, and no
    // real camera would survive even one more render under StrictMode in
    // dev.
    expect(track.stop).not.toHaveBeenCalled();

    unmount();
    // The deferred-stop timer (`ProctoringLayer`'s own `cameraStopTimerRef`)
    // fires on the next tick, not this one — the same wait
    // `camera-gate.test.tsx`'s own unmount test now takes, for the same
    // reason.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});
