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

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
   * The paper's fullscreen state **at the moment this layer mounts** —
   * read directly, not behind a try/catch. Mount is the only time this
   * can be captured: Task 4's `fullscreenchange` listener attaches after
   * this render and only ever sees a *change* from here forward, so
   * whether the candidate was already fullscreen when the attempt opened
   * is lost the instant this line does not run. `document.fullscreenElement`
   * is also exactly the API `fullscreen_exit`/`fullscreen_restore` are
   * built on (`Q7b`), so this is the layer's own first touch of it rather
   * than a borrowed probe.
   *
   * This is `AG4`'s signal path, deliberately — not `routes/exam.tsx`'s
   * `window.matchMedia?.("(pointer: fine)")` device check, which runs on
   * the landing page before this component exists and would prove only
   * that the boundary survives a throw from somewhere it was never
   * mounted to protect. `ProctoringErrorBoundary`, around this component,
   * is what is meant to survive a throw from this line; the fail-open
   * test exercises exactly that.
   */
  if ("fullscreenElement" in document) void document.fullscreenElement;

  const [count, setCount] = useState({
    violations: initialViolations,
    limit: proctoring.violationLimit,
    action: proctoring.violationAction,
  });

  const mounted = useRef(true);

  const queue = useMemo(
    () =>
      createProctoringQueue({
        send: sendEvents,
        onCount: (violations, limit, action) => {
          // No state update after unmount: the queue's own `send` can
          // still be in flight when `stop()` runs, so this guard is the
          // one place that matters even though `stop()` also halts the
          // interval that would schedule a new pass.
          if (!mounted.current) return;
          setCount({ violations, limit, action });
        },
        flushMs: FLUSH_MS,
      }),
    // One queue per attempt — the same rule the save queue follows in
    // `AttemptView` below: a new attempt id is a new attempt and a new
    // queue. `proctoring` is fixed for the life of one attempt already.
    [attemptId],
  );

  useEffect(() => {
    mounted.current = true;
    // `stop()` on unmount, and nowhere else — this view lives exactly as
    // long as the attempt, the same reasoning `queue.ts`'s save queue
    // documents for its own `close()`.
    return () => {
      mounted.current = false;
      queue.stop();
    };
  }, [queue]);

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
