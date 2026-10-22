/*
 * The signal layer that cannot break the runner (Phase 7c Task 2,
 * `Q2`/`Q2c`/`AG4`).
 *
 * `AttemptView` (`routes/exam.tsx`) mounts `ProctoringLayer` as a
 * **sibling** of `Runner`, inside `ProctoringErrorBoundary` — never as
 * `Runner`'s parent. `Q2c` makes the boundary the backstop, and a backstop
 * that could take the paper down with it is not one: if this component's
 * own work throws, the boundary swallows exactly this subtree and
 * `Runner` keeps rendering untouched beside it. Positioned off the normal
 * flow in CSS (`exam.css`) for the same reason D8 names directly — a
 * count line must not reflow the paper whether or not it is even mounted.
 *
 * This task wires no DOM listener — Tasks 4 and 5 do, by extending this
 * file. What ships here is the lifecycle every one of those listeners
 * will call into: `createProctoringQueue`, the transport that batches to
 * `Q7`'s ingest route, and the minimal count line Review Focus 3 asks
 * for ("Warning 2 of 5"), read off the server's own accumulated count and
 * never recomputed locally (`Q7a`).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Component } from "react";
import type { ResolvedProctoring } from "@pariksha/core";
import { createProctoringQueue, type EventsResponse, type QueuedEvent } from "../../lib/proctoring-queue";

/** Mirrors `EVENTS_PATH` in `apps/api/src/routes/proctoring.ts` — a
 *  server-only module this bundle cannot import across the app boundary. */
const EVENTS_PATH = "/api/v1/run/attempt/events";

/** How often the buffer flushes on its own. `pushImmediate` (the queue's
 *  own escape hatch) is for a violation whose action a candidate needs to
 *  see sooner than this. */
const FLUSH_MS = 5_000;

/** The transport `createProctoringQueue` is given. A non-2xx or a network
 *  failure both throw, which is what the queue's own `send` contract
 *  treats as "this batch did not reach the server" (`Q2`: degrade, keep
 *  the batch, try again next interval). */
async function sendEvents(events: QueuedEvent[]): Promise<EventsResponse> {
  const res = await fetch(EVENTS_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) throw new Error(`events request failed: ${String(res.status)}`);
  return (await res.json()) as EventsResponse;
}

export interface ProctoringLayerProps {
  attemptId: string;
  proctoring: ResolvedProctoring;
  /** `Q7a`'s seed — `AttemptPaper.violations`, the server's own count.
   *  Never recomputed here; this is what Review Focus 3's remount test
   *  reads before the queue has ever flushed anything of its own. */
  initialViolations: number;
}

export function ProctoringLayer({ attemptId, proctoring, initialViolations }: ProctoringLayerProps) {
  /**
   * The paper's fullscreen state **at the moment this layer first
   * renders** — captured once and kept, not read-and-discarded. Task 4's
   * `fullscreenchange` listener attaches later and only ever sees a
   * *change* from that point forward, so whether the candidate was
   * already fullscreen when the attempt opened is lost unless something
   * captures it before that listener exists — this is where. The `=== null`
   * guard is the lazy-init idiom for "compute on the first render only",
   * without a second render a `useState` initialiser would not add here
   * either but a plain unconditional call during every render would.
   * `document.fullscreenElement` is also exactly the API
   * `fullscreen_exit`/`fullscreen_restore` are built on (`Q7b`), so this
   * is the layer's own first touch of it rather than a borrowed probe.
   *
   * Read directly, not behind a try/catch. This is `AG4`'s own signal
   * path — not `routes/exam.tsx`'s `window.matchMedia?.("(pointer:
   * fine)")` device check, which runs on the landing page before this
   * component exists and would prove only that the boundary survives a
   * throw from somewhere it was never mounted to protect.
   * `ProctoringErrorBoundary`, around this component, is what is meant to
   * survive a throw from this line; the fail-open test exercises exactly
   * that.
   */
  const fullscreenAtMount = useRef<boolean | null>(null);
  if (fullscreenAtMount.current === null) {
    fullscreenAtMount.current = "fullscreenElement" in document ? document.fullscreenElement !== null : false;
  }

  const [count, setCount] = useState({
    violations: initialViolations,
    limit: proctoring.violationLimit,
    action: proctoring.violationAction,
  });

  /**
   * The live queue — owned by the effect below, not by `useMemo`.
   *
   * `useMemo` is a cache React is free to drop and recreate on its own
   * schedule; it is the wrong place to construct an object that owns a
   * running `setInterval`. `routes/exam.tsx`'s own save queue carries the
   * exact warning this component used to miss: "calling it in an
   * effect's cleanup would kill the queue on mount under `StrictMode`"
   * (and `exam-main.tsx` really does render `<StrictMode>`). Built with
   * `useMemo` and stopped in a *separate* effect's cleanup, the two
   * disagree about which render owns the interval the moment
   * StrictMode's dev-only double mount/unmount/remount runs: the
   * `useMemo`-cached queue (and its one `setInterval`) survives the
   * phantom unmount untouched by the memo, but the phantom cleanup still
   * calls `queue.stop()` on it — and nothing recreates the interval on
   * the phantom remount, because `useMemo`'s factory does not re-run for
   * an unchanged `attemptId`. The queue silently never flushes again, in
   * development only, with no test the wiser.
   *
   * Owning construction and teardown in the **same** effect fixes it:
   * each `setup → cleanup → setup` cycle creates and destroys its own
   * queue, and whichever one survives once the dust settles has a live
   * interval. `queueRef` is also the handle Tasks 4 and 5 push and
   * `pushImmediate` into from their own effects in this same file.
   */
  const queueRef = useRef<ReturnType<typeof createProctoringQueue> | null>(null);

  useEffect(() => {
    const queue = createProctoringQueue({
      send: sendEvents,
      onCount: (violations, limit, action) => {
        // Checked against the ref, not a boolean: a state update from
        // *this* queue instance only lands while it is still the live
        // one. A stale closure from a queue this same effect has already
        // replaced or stopped — StrictMode's phantom cycle, or a real
        // unmount — is a no-op here, alongside the queue's own internal
        // `stopped` check one layer down.
        if (queueRef.current !== queue) return;
        setCount({ violations, limit, action });
      },
      flushMs: FLUSH_MS,
    });
    queueRef.current = queue;
    // `stop()` on unmount, and nowhere else — this view lives exactly as
    // long as the attempt.
    return () => {
      queueRef.current = null;
      queue.stop();
    };
    // One queue per attempt — the same rule the save queue follows in
    // `AttemptView` below: a new attempt id is a new attempt and a new
    // queue. `proctoring` is fixed for the life of one attempt already.
  }, [attemptId]);

  return (
    <div className="exam-proctoring-count" role="status" aria-live="polite">
      {/* Plain on purpose (R5): `ProctoringOverlay`'s richer presentation
          is Task 4's, built on this line rather than duplicating it. */}
      {count.violations > 0 && (
        <span>
          Warning {count.violations} of {count.limit}
        </span>
      )}
    </div>
  );
}

interface BoundaryState {
  crashed: boolean;
}

/**
 * `Q2c`: the backstop, not the plan. `ProctoringLayer` and
 * `createProctoringQueue` are both written to degrade on their own —
 * this exists only for the one path that still throws, so a defect in
 * the signal layer costs the organiser a missing proctoring record and
 * costs the candidate nothing (`AG4`, which is `AG1` "wearing a
 * different coat").
 */
export class ProctoringErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { crashed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: unknown): void {
    // Diagnostic only. The paper is already safe — that is the whole job
    // of catching here — so nothing a candidate's browser does should
    // depend on this line succeeding.
    try {
      console.error("proctoring layer crashed", error);
    } catch {
      /* even logging is inside the net */
    }
  }

  render(): ReactNode {
    if (this.state.crashed) return null;
    return this.props.children;
  }
}
