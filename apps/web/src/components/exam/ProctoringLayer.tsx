/*
 * The signal layer that cannot break the runner (Phase 7c Task 2,
 * `Q2`/`Q2c`/`AG4`; Task 4 extends it with fullscreen and window-leave).
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
 * Task 2 shipped the lifecycle every listener here calls into:
 * `createProctoringQueue`, the transport that batches to `Q7`'s ingest
 * route, and the minimal count line Review Focus 3 asks for ("Warning 2
 * of 5"), read off the server's own accumulated count and never
 * recomputed locally (`Q7a`). `T4-R6`: that line stays exactly as Task 2
 * built it (Task 2's own existing tests read it); `ProctoringOverlay`
 * consumes the same `count` state rather than keeping a second one.
 *
 * Task 4 adds two listeners, both gated so a stack limitation degrades
 * rather than blocks (`Q2`/`Q1a`):
 *
 * - **Fullscreen** (`P-03`), gated on `proctoring.requireFullscreen` AND
 *   the Fullscreen API actually existing (`typeof
 *   document.documentElement.requestFullscreen === "function"`, checked
 *   once). jsdom ships no Fullscreen API at all, which is also exactly
 *   `Q1a`'s iOS Safari case — "fullscreen has no `requestFullscreen` on
 *   most elements" — so "API absent" degrades to "the control never
 *   fires" on both. The mount-time state is Task 2's own
 *   `fullscreenAtMount` ref (`T4-R6`) — this file reads it rather than
 *   re-deriving it, since a `fullscreenchange` listener attached here
 *   only ever sees a change from the moment it attaches.
 *
 * - **Window-leave** (`P-04`), `blur`/`focus` and `visibilitychange`
 *   together. Neither `window_blur` nor `visibility_hidden` has a
 *   "returned" counterpart in the closed union (`T4-R4`): the departure
 *   starts a timer and emits nothing; the return sends one event carrying
 *   `awayMs`, never a second. One shared timer, not two — a tab switch
 *   commonly fires both `blur`+`focus` and `visibilitychange` for the
 *   same departure, and a shared ref reports it once under whichever
 *   signal returns first rather than twice.
 *
 * There is no dedicated override for "monitor window-leave" in 7a's
 * fifteen keys, so this reads `anyProctoringControlActive` (`@pariksha/core`,
 * review finding 7's fix) — the single exported predicate
 * `proctoringRequirements` also gates its browser and window-leave
 * sentences on, so the two cannot read "is anything at all required"
 * differently again — rather than branching on `profile` (`Q1`). An `off`
 * test, where every control is false, gets no window-leave monitoring
 * either.
 *
 * Task 5 adds the last three controls in 7c's gate list (`Q9`/`P-08`):
 *
 * - **Copy, paste and the context menu**, gated on `blockCopyPaste` —
 *   `preventDefault()` on all three and one `pushImmediate`d event each,
 *   the same honesty `Watermark`'s own doc comment names: this deters, it
 *   does not disable a determined candidate's browser.
 * - **The watermark**, gated on `watermark` — `Watermark.tsx` is the whole
 *   of it; this file only decides whether to mount it.
 * - **The extra-monitor check** (`P-08`), gated on `extraMonitorCheck` —
 *   read once at mount, never polled and never `getScreenDetails()`'d: the
 *   one call in that API surface that raises a Window Management
 *   permission dialog mid-exam, which is a `Q2` hazard this task's own
 *   ruling refuses.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Component } from "react";
import {
  anyProctoringControlActive,
  type ContextmenuBlockedDetail,
  type CopyBlockedDetail,
  type ExtraMonitorDetail,
  type FullscreenExitDetail,
  type FullscreenRestoreDetail,
  type PasteBlockedDetail,
  type ProctoringEventType,
  type ResolvedProctoring,
  type VisibilityHiddenDetail,
  type WindowBlurDetail,
} from "@pariksha/core";
import { createProctoringQueue, type EventsResponse, type QueuedEvent } from "../../lib/proctoring-queue";
import { ProctoringOverlay } from "./ProctoringOverlay";
import { Watermark } from "./Watermark";

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

/** Review finding 5's fix — `navigator.sendBeacon`, for the one event a
 *  normal `fetch` cannot be trusted to land: the page is already
 *  unloading, and the browser (not this tab) is responsible for delivering
 *  it afterward. Guarded, not assumed (older WebViews lack it) — a `false`
 *  return (absent, or the browser's own queue refused it) tells the caller
 *  to fall back to the buffered queue instead, same as before this fix. */
function sendBeaconEvent(type: ProctoringEventType, detail: unknown): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  try {
    const body = JSON.stringify({ events: [{ type, detail, clientTs: Date.now() }] });
    return navigator.sendBeacon(EVENTS_PATH, new Blob([body], { type: "application/json" }));
  } catch {
    return false; // Q2: degrade, never throw.
  }
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

  /** Review finding 4: `count` is only ever assigned from a server
   *  response, so the window-leave overlay below must not show a figure
   *  from *before* the server has answered this departure — the first
   *  violation of an attempt rendered "Warning 0 of 5" (`initialViolations`
   *  is `0`), and a down ingest kept it there for the rest of the attempt.
   *  Set `false` the moment a departure ends (below), `true` the moment
   *  this effect's own `onCount` next runs — never seeded optimistically
   *  (`Q7a` stays true: the server is still the only counter). */
  const [leaveCountKnown, setLeaveCountKnown] = useState(true);

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
        setLeaveCountKnown(true);
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

  // ---- fullscreen (`P-03`) -------------------------------------------------

  /** Checked once: jsdom ships no Fullscreen API at all (no
   *  `fullscreenElement` getter, no `requestFullscreen`), which is also
   *  exactly `Q1a`'s iOS Safari case — "absent" degrades the control to
   *  never firing, on both, rather than a false violation. */
  const fullscreenApiAvailable = useRef<boolean | null>(null);
  if (fullscreenApiAvailable.current === null) {
    fullscreenApiAvailable.current = typeof document.documentElement.requestFullscreen === "function";
  }
  const fullscreenEnforced = proctoring.requireFullscreen && fullscreenApiAvailable.current;

  const [inFullscreen, setInFullscreen] = useState(() => fullscreenAtMount.current ?? false);
  // Review finding (minor) J: the push used to live inside the
  // `setInFullscreen` updater, and React (StrictMode deliberately,
  // `exam-main.tsx` really renders it) may invoke an updater more than
  // once — which emitted two `fullscreen_exit` events in development for
  // one real exit. `inFullscreenRef` mirrors the state so "did this
  // actually change" is decided once, outside any updater, the same shape
  // the window-leave effect below already uses (`awayAtRef`).
  const inFullscreenRef = useRef(fullscreenAtMount.current ?? false);

  useEffect(() => {
    if (!fullscreenEnforced) return;
    function onChange(): void {
      let next: boolean;
      try {
        next = document.fullscreenElement !== null;
      } catch {
        return; // Q2: degrade rather than guess at a value that cannot be read.
      }
      if (inFullscreenRef.current === next) return;
      inFullscreenRef.current = next;
      if (next) {
        queueRef.current?.push("fullscreen_restore", {} satisfies FullscreenRestoreDetail);
      } else {
        // `pushImmediate`, not `push`: a violation whose count the
        // overlay is about to show needs to reach the server sooner
        // than the next flush interval (`FLUSH_MS`'s own doc comment).
        void queueRef.current?.pushImmediate("fullscreen_exit", {} satisfies FullscreenExitDetail);
      }
      setInFullscreen(next);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, [fullscreenEnforced]);

  /** The overlay's own remedy control (`Q2b`) — and `P-03`'s "the test
   *  starts only from a click that enters fullscreen": a browser refuses
   *  `requestFullscreen()` without a user gesture reaching it directly. */
  function enterFullscreen(): void {
    try {
      void document.documentElement.requestFullscreen().catch(() => {
        // Q2: the browser refused (a permissions policy, the gesture
        // didn't reach it in time, …) — the overlay simply stays up.
      });
    } catch {
      /* same degrade, for a call that throws synchronously instead */
    }
  }

  // ---- window-leave (`P-04`) -----------------------------------------------

  /** Review finding 7's fix: the single exported predicate, not a second
   *  local derivation that can drift from `proctoringRequirements`'s own
   *  (see the file header). An `off` test monitors nothing. */
  const anyControlActive = anyProctoringControlActive(proctoring);

  /** One shared departure, not two — `T4-R4`: a tab switch commonly fires
   *  both `blur`/`focus` and `visibilitychange` for the same departure,
   *  and this reports it once, under whichever signal returns first,
   *  rather than twice. The `type` travels with it so a page that
   *  unloads mid-departure (below) can still name which signal it was. */
  const awayAtRef = useRef<{ startedAt: number; type: "window_blur" | "visibility_hidden" } | null>(null);
  const [leaveWarning, setLeaveWarning] = useState<WindowBlurDetail | null>(null);

  useEffect(() => {
    if (!anyControlActive) return;
    function startAway(type: "window_blur" | "visibility_hidden"): void {
      if (awayAtRef.current === null) awayAtRef.current = { startedAt: Date.now(), type };
    }
    function endAway(type: "window_blur" | "visibility_hidden"): void {
      const pending = awayAtRef.current;
      awayAtRef.current = null;
      if (pending === null) return; // a return with no matching departure
      const awayMs = Date.now() - pending.startedAt;
      setLeaveWarning({ awayMs });
      // Review finding 4: this departure's own count has not been
      // confirmed by the server yet — `leaveCountKnown` flips back to
      // `true` from the queue's own `onCount`, never seeded here.
      setLeaveCountKnown(false);
      void queueRef.current?.pushImmediate(
        type,
        type === "window_blur"
          ? ({ awayMs } satisfies WindowBlurDetail)
          : ({ awayMs } satisfies VisibilityHiddenDetail),
      );
    }
    function onBlur(): void {
      startAway("window_blur");
    }
    function onFocus(): void {
      endAway("window_blur");
    }
    function onVisibility(): void {
      if (document.hidden) startAway("visibility_hidden");
      else endAway("visibility_hidden");
    }
    // `T4-R4`'s unload clause: a page that dies mid-departure never gets a
    // `focus`/`visibilitychange`-back to defer to, so the only way it
    // isn't silently lost is pushing it here, duration unknown
    // (`awayMs: null`) — `push`, not `pushImmediate`, since there is no
    // reason to believe a fresh network round trip started during teardown
    // completes; this only needs to reach the queue's own buffer.
    function onPageHide(): void {
      const pending = awayAtRef.current;
      awayAtRef.current = null;
      if (pending === null) return;
      const detail: WindowBlurDetail = { awayMs: null };
      // Review finding 5: `push` alone only enqueues — the sole flush is
      // the 5-second interval, which gets no further tick on an unloading
      // page, and `T4-R4`'s promised `awayMs: null` event was lost outright
      // on a closed tab rather than merely delayed. `sendBeacon` is queued
      // by the browser itself and still sent after the page is gone; kept
      // guarded and falling back to the buffered queue (same as before this
      // fix) when it is absent, never thrown (`AG1`/`AG4`).
      if (!sendBeaconEvent(pending.type, detail)) {
        queueRef.current?.push(pending.type, detail);
      }
    }
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [anyControlActive]);

  // ---- copy, paste and the context menu (`Q9`, 7c Task 5) ------------------

  /** `Q9`: the same honesty as the watermark below — `preventDefault()` on
   *  three events and a recorded one, nothing more. `document`, not the
   *  runner's own root: a candidate can paste into a text-answer field
   *  anywhere in the paper, and a listener scoped to one element would miss
   *  every other one. `pushImmediate`, not `push`: the ambient count line
   *  (`.exam-proctoring-count`) is the one surface that shows a blocked
   *  paste without a click of the candidate's own, and that line should
   *  not wait out `FLUSH_MS` to catch up with what already happened. */
  useEffect(() => {
    if (!proctoring.blockCopyPaste) return;
    function blocked(type: ProctoringEventType) {
      return (event: Event): void => {
        event.preventDefault();
        void queueRef.current?.pushImmediate(
          type,
          {} satisfies CopyBlockedDetail | PasteBlockedDetail | ContextmenuBlockedDetail,
        );
      };
    }
    const onCopy = blocked("copy_blocked");
    const onPaste = blocked("paste_blocked");
    const onContextMenu = blocked("contextmenu_blocked");
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onContextMenu);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onContextMenu);
    };
  }, [proctoring.blockCopyPaste]);

  // ---- extra monitor (`P-08`) -----------------------------------------------

  /** Read once, at mount, and never again — there is no `screen` change
   *  event this reacts to, and `P-08`'s own ruling is "read, never prompt":
   *  `window.screen.isExtended` where the browser exposes it, nothing where
   *  it does not, and `getScreenDetails()` — the call that raises a Window
   *  Management permission dialog mid-exam (`Q2` hazard) — is never made.
   *  `try/catch` is the same `Q2` degrade every other read in this file
   *  takes: an unreadable `screen` is not evidence of a second monitor. */
  // Review finding (minor) J, same class as the fullscreen updater above:
  // this effect has no cleanup, so StrictMode's dev-only phantom
  // mount/unmount/remount re-runs its body and pushed `extra_monitor`
  // twice for one real check. `extraMonitorPushed` makes the push happen
  // at most once per mounted instance, the same single-fire guarantee the
  // updater fix above gives the fullscreen check.
  const extraMonitorPushed = useRef(false);
  useEffect(() => {
    if (!proctoring.extraMonitorCheck || extraMonitorPushed.current) return;
    try {
      const extended = (window.screen as Screen & { isExtended?: boolean }).isExtended;
      if (extended) {
        extraMonitorPushed.current = true;
        void queueRef.current?.pushImmediate("extra_monitor", {} satisfies ExtraMonitorDetail);
      }
    } catch {
      /* Q2: degrade — an unreadable screen is not a violation */
    }
  }, [proctoring.extraMonitorCheck]);

  // ---- the overlay, and marking the covered runner (`Q2a`, `T4-R2`) -------

  const fullscreenBlocked = fullscreenEnforced && !inFullscreen;
  const overlayOpen = fullscreenBlocked || leaveWarning !== null;

  useEffect(() => {
    // `ProctoringLayer` mounts as `Runner`'s sibling, never its parent
    // (`Q2c`'s own doc comment) — marking the covered region is a direct
    // DOM reach to its root rather than a prop threaded through
    // `routes/exam.tsx`. `Q2a`'s real requirement is that `Runner` stays
    // MOUNTED; this never removes it, only marks it unreachable to
    // assistive tech and keyboard focus for as long as the overlay is up
    // (`T4-R2`). Q2: if the region cannot be found, the overlay still
    // visually covers the paper (`exam.css`) regardless — this degrades,
    // it does not strand anyone.
    function setRunnerHidden(hidden: boolean): void {
      try {
        const runner = document.querySelector<HTMLElement>(".exam-runner");
        if (!runner) return;
        if (hidden) {
          runner.setAttribute("inert", "");
          runner.setAttribute("aria-hidden", "true");
        } else {
          runner.removeAttribute("inert");
          runner.removeAttribute("aria-hidden");
        }
      } catch {
        /* degrade */
      }
    }
    setRunnerHidden(overlayOpen);
    return () => {
      setRunnerHidden(false);
    };
  }, [overlayOpen]);

  return (
    <>
      {proctoring.watermark && <Watermark attemptId={attemptId} />}
      <div className="exam-proctoring-count" role="status" aria-live="polite">
        {/* Plain on purpose (R5 / `T4-R6`): `ProctoringOverlay` below
            consumes this same `count` state rather than keeping a second
            one that could disagree with it, and this line stays exactly
            as Task 2 built it. */}
        {count.violations > 0 && (
          <span>
            Warning {count.violations} of {count.limit}
          </span>
        )}
      </div>
      {/* Fullscreen wins the floor over a leave warning — it is indefinite
          and still wrong; the leave warning is already resolved (the
          candidate is back) and only needs acknowledging. */}
      {fullscreenBlocked ? (
        <ProctoringOverlay
          title="Fullscreen required"
          message="This test runs in fullscreen. Your answers and the timer are unaffected while this is up — select Enter fullscreen to continue."
          action={{ label: "Enter fullscreen", onClick: enterFullscreen }}
        />
      ) : (
        leaveWarning !== null && (
          <ProctoringOverlay
            title="Leaving the test window is not allowed"
            // Review finding 4: `count` is the pre-flush figure until the
            // server answers this departure — showing it regardless read
            // "Warning 0 of 5" for the first violation of an attempt, and
            // kept doing so for the rest of the attempt if the ingest was
            // down. No figure at all until `leaveCountKnown` says the
            // server has actually answered.
            message={
              leaveCountKnown
                ? `Leaving the test window is not allowed. Warning ${String(count.violations)} of ${String(count.limit)}.`
                : "Leaving the test window is not allowed."
            }
            onAcknowledge={() => {
              setLeaveWarning(null);
            }}
          />
        )
      )}
    </>
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
