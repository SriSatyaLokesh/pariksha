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
 *
 * Phase 7e Task 2 (`AC-21`) adds the terminal case: `EventsResponse.
 * submitted` (`proctoring-queue.ts`), set true on the one response whose
 * own batch carried the attempt past its limit under `auto_submit`, flips
 * `autoSubmitted` — a one-way flag reusing `ProctoringOverlay` the same
 * no-recourse way the camera block already does, because there genuinely
 * is nothing left to press. The actual submission (`finishAttempt`'s own
 * idempotent statement) happened server-side, inside the ingest route,
 * before this response ever arrived — this component only has to tell the
 * candidate it happened, not make it happen.
 *
 * Phase 7e Task 3 adds the fourth and most intrusive action's own overlay:
 * `EventsResponse.locked`, set true on the one response whose own batch
 * locked the attempt under `lock`, flips `locked` the same one-way way
 * `autoSubmitted` flips. Unlike `autoSubmitted`, this one can also be
 * seeded on mount — `initialLocked`, off `AttemptPaper.lockedAt` — because
 * a lock does not submit the attempt: a reload mid-lock resumes straight
 * back to this component rather than to the finish page, and without the
 * seed it would raise no overlay at all until the next violation batch.
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
import { acquireCamera, captureJpeg, isCameraLensCovered, releaseCameraSampler } from "../../lib/camera";
import { ProctoringOverlay } from "./ProctoringOverlay";
import { Watermark } from "./Watermark";

/** Mirrors `EVENTS_PATH` in `apps/api/src/routes/proctoring.ts` — a
 *  server-only module this bundle cannot import across the app boundary. */
const EVENTS_PATH = "/api/v1/run/attempt/events";

/** Mirrors `routes/exam.tsx`'s own `uploadSnapshot` (the identity photo's
 *  upload, against Task 1's `POST /api/v1/run/attempt/snapshot`) rather
 *  than importing it — a component importing from a route runs the
 *  dependency the wrong way round, and the function is three lines. */
async function uploadSnapshot(
  blob: Blob,
  reason: "interval" | "violation",
  onProctorMessage?: (message: string, messageAt: number) => void,
): Promise<void> {
  const res = await fetch(`/api/v1/run/attempt/snapshot?reason=${reason}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "image/jpeg" },
    body: blob,
  });
  if (!res.ok) throw new Error(`snapshot upload failed: ${String(res.status)}`);
  try {
    const data = (await res.json()) as { message?: string; messageAt?: number };
    if (data?.message && typeof data?.messageAt === "number") {
      onProctorMessage?.(data.message, data.messageAt);
    }
  } catch {}
}

/**
 * The capture schedule's one upload path, shared by the interval timer and
 * every violation snapshot below (`AC-20`, `Q4d`).
 *
 * `AG1`: a capture that produces nothing (`captureJpeg`'s own `null` —
 * jsdom's baseline with no canvas stubbed, or a refused frame) is not a
 * stack failure, and reports nothing — only a reached-but-refused UPLOAD
 * is one. `Q4d`: that failure never shows the candidate anything and never
 * blocks the paper — one `snapshot_failed` event, nothing else. `queue` is
 * passed in rather than read off a ref, so this plain async function needs
 * no closure over component state to be called from any of this file's
 * effects.
 */
async function captureAndUpload(
  stream: MediaStream,
  reason: "interval" | "violation",
  queue: ReturnType<typeof createProctoringQueue> | null,
  onProctorMessage?: (message: string, messageAt: number) => void,
): Promise<void> {
  const blob = await captureJpeg(stream).catch(() => null);
  if (!blob) return;
  try {
    await uploadSnapshot(blob, reason, onProctorMessage);
  } catch {
    queue?.push("snapshot_failed");
  }
}

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
  /**
   * Phase 7d Task 2 (`P-05`): the live stream the start gate already
   * acquired, minted once in `routes/exam.tsx`'s `startWith` and handed
   * down rather than reacquired here — asking twice would prompt a
   * candidate a second time for a permission already granted. `null` on
   * every resumed attempt, where nothing survived the reload to hand over.
   * Only this component's OWN initial seed from here on — fix pass 1,
   * finding 1: a successful unplug/replug reconnect replaces the stream
   * this layer actually watches (`liveStream` below) with a fresh one
   * `acquireCamera()` hands back, which this prop itself never sees or
   * needs to; `routes/exam.tsx` still owns nothing past mount. Stopped in
   * this component's own queue-lifecycle effect below ("Stop the tracks"),
   * reading whichever stream is current, not this prop — that effect
   * already owns "the thing that lives exactly as long as the attempt",
   * and a `MediaStream` left running is the same camera-light-stays-on
   * defect a forgotten `setInterval` would be. Optional (default `null`) so
   * every caller that mounts this with no camera in play —
   * `proctoring-layer-lifecycle.test.tsx` included — need not pass one.
   */
  cameraStream?: MediaStream | null;
  /**
   * B1 (whole-branch review, BLOCKING): true only when `routes/exam.tsx`'s
   * resume path tried to reacquire a required camera and was refused —
   * never inferred here from `proctoring.requireCamera && !cameraStream`,
   * because that pair is also how several callers (test fixtures focused on
   * fullscreen or window-leave included) legitimately mount this component
   * with no camera in play at all. When true, the liveness effect below
   * raises the SAME lost-camera overlay a mid-attempt loss would, rather
   * than leaving the rest of the attempt silently unproctored. Optional
   * (default `false`) so every existing caller is unaffected.
   */
  cameraUnavailable?: boolean;
  /**
   * Phase 7e Task 3 (`E-R1`): `AttemptPaper.lockedAt !== null`, off
   * `routes/exam.tsx`'s own resume path — the `initialViolations` seed's
   * own shape, for the one state that (unlike `autoSubmitted`) really can
   * still be live on a reload: a locked attempt is not submitted, so it
   * resumes straight back to this component rather than to the finish
   * page. Optional (default `false`) so every existing caller — a fresh
   * `/start`, and every fixture in this package's own test suite — is
   * unaffected.
   */
   initialLocked?: boolean;
  /** Phase 8g Task 3 (`C-10`, `K12`, `K13`): proctor broadcast callback. */
  onProctorMessage?: (message: string, messageAt: number) => void;
}

export function ProctoringLayer({
  attemptId,
  proctoring,
  initialViolations,
  cameraStream = null,
  cameraUnavailable = false,
  initialLocked = false,
  onProctorMessage,
}: ProctoringLayerProps) {
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
   * Phase 7e Task 2 (`AC-21`): `true` once the ingest has told this layer
   * that THIS batch is what carried the attempt over its violation limit
   * under `auto_submit` (`EventsResponse.submitted`). Terminal — nothing
   * below ever sets it back to `false` — because the attempt really is
   * over: `submitAttempt` (`apps/api/src/run/submit.ts`) already stamped
   * `submitted_at` by the time this flag can be true, the same statement
   * every other way an attempt ends uses. `initialViolations` seeds
   * `count` above but never this: a resumed attempt that was auto-submitted
   * on an earlier page load reloads straight to the finish page before
   * `ProctoringLayer` is ever mounted again (`routes/exam.tsx`'s own
   * resume path), so this flag only ever needs to catch the live case.
   */
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  /**
   * Phase 7e Task 3 (`E-R1`): the lock's own mirror of `autoSubmitted`
   * immediately above — `true` once the ingest has told this layer that
   * THIS batch is what locked the attempt under `lock`
   * (`EventsResponse.locked`), **or** seeded `true` from `initialLocked`
   * on a reload mid-lock (the one way this state really does differ from
   * `autoSubmitted`'s: a lock does not submit the attempt, so a reload
   * resumes straight back to this component rather than to the finish
   * page — `routes/exam.tsx`'s own resume path). Terminal in the same
   * direction `autoSubmitted` is — nothing below ever sets it back to
   * `false` — because only an organiser clearing the lock (Phase 8) ends
   * it, and that is a fresh page load this component does not live through
   * either way.
   */
  const [locked, setLocked] = useState(initialLocked);

  /**
   * Fix round 1 (MAJOR, mirrors the server's own `apps/api/src/routes/
   * proctoring.ts` `attempt.lockedAt !== null` no-op): every violation and
   * interval capture below reads this ref rather than the `locked` state
   * directly, the same `liveStreamRef` shape this file already uses for a
   * value several long-lived effects need to read FRESH without listing it
   * as a dependency (which would tear down and rebuild listeners on every
   * lock transition for no reason — the effects themselves do not change
   * shape when a lock fires, only whether their one `captureAndUpload` call
   * should still run). Without this, a locked candidate's browser kept
   * calling `POST /attempt/snapshot` on every subsequent violation —
   * wasted requests the server-side no-op alone would still refuse, but a
   * request this component should simply stop making.
   */
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

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
  const onProctorMessageRef = useRef(onProctorMessage);
  useEffect(() => {
    onProctorMessageRef.current = onProctorMessage;
  }, [onProctorMessage]);

  function doCaptureAndUpload(stream: MediaStream, reason: "interval" | "violation") {
    void captureAndUpload(stream, reason, queueRef.current, (msg, at) => onProctorMessageRef.current?.(msg, at));
  }

  /**
   * Phase 7d Task 2 review finding 1 (MEDIUM, closed here): `cameraStream`
   * is a prop, not something this effect builds — unlike `queue` (recreated
   * fresh every run, the comment above), it is the SAME object across
   * StrictMode's phantom mount→cleanup→mount, so the unconditional
   * `track.stop()` this cleanup used to call killed the one real hardware
   * track for good on the phantom cleanup, and nothing on the phantom
   * remount could ever get it back (a stopped `MediaStreamTrack` stays
   * stopped). Stopping is deferred by one tick rather than skipped
   * outright: the phantom cycle's own remount runs synchronously,
   * within the same commit, before this timer ever fires, so its setup
   * below cancels the stop; a genuine unmount has no following setup to
   * cancel it, so the timer fires and the camera light actually goes off.
   * No effect on production builds, where StrictMode's double-invoke is
   * stripped and this timer always fires on the very next tick.
   */
  const cameraStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Fix pass 1, finding 1 (Task 3 review Finding 1, BLOCKING): the stream
   * this layer actually watches — seeded from the `cameraStream` prop but
   * not pinned to it afterward. `onDeviceChange` below (the unplug/replug
   * recovery) calls `acquireCamera()` again on a successful reconnect, and
   * that returns a genuinely NEW `MediaStream`/track every time (`camera.ts`
   * is a pure function of permission, never the same object twice) — the
   * prop alone has nowhere to receive it, so "restored" used to mean only
   * the overlay cleared while every listener below kept watching the same
   * permanently-dead track. `liveStream` is what the liveness effect and
   * the capture schedule key off from here on, not the prop; `liveStreamRef`
   * mirrors it for the effects further down (fullscreen/window-leave/
   * copy-paste/extra-monitor) that are gated on something else entirely and
   * so must read whichever stream is CURRENT through a ref rather than
   * close over whatever `liveStream` was the render they mounted.
   */
  const [liveStream, setLiveStream] = useState<MediaStream | null>(cameraStream);
  const liveStreamRef = useRef(liveStream);
  liveStreamRef.current = liveStream;

  /** Swaps in a newly acquired stream and stops the discarded one's tracks
   *  — a reconnect must not leave two streams' hardware lights on, and
   *  nothing else owns the stream this replaces once it is replaced. */
  function replaceStream(next: MediaStream | null): void {
    const previous = liveStreamRef.current;
    if (previous && previous !== next) {
      previous.getTracks().forEach((track) => {
        track.stop();
      });
    }
    liveStreamRef.current = next;
    setLiveStream(next);
  }

  useEffect(() => {
    if (cameraStopTimerRef.current !== null) {
      clearTimeout(cameraStopTimerRef.current);
      cameraStopTimerRef.current = null;
    }
    const queue = createProctoringQueue({
      send: sendEvents,
      onCount: (violations, limit, action, submitted, lockedNow) => {
        // Checked against the ref, not a boolean: a state update from
        // *this* queue instance only lands while it is still the live
        // one. A stale closure from a queue this same effect has already
        // replaced or stopped — StrictMode's phantom cycle, or a real
        // unmount — is a no-op here, alongside the queue's own internal
        // `stopped` check one layer down.
        if (queueRef.current !== queue) return;
        setCount({ violations, limit, action });
        setLeaveCountKnown(true);
        // Phase 7e Task 2: never unset — see `autoSubmitted`'s own doc
        // comment above.
        if (submitted) setAutoSubmitted(true);
        // Phase 7e Task 3: never unset — see `locked`'s own doc comment
        // above.
        if (lockedNow) setLocked(true);
      },
      onMessage: (message, messageAt) => {
        if (queueRef.current !== queue) return;
        onProctorMessageRef.current?.(message, messageAt);
      },
      flushMs: FLUSH_MS,
    });
    queueRef.current = queue;
    // `stop()` on unmount, and nowhere else — this view lives exactly as
    // long as the attempt. "Stop the tracks" rides the same cleanup: this
    // effect is already the one place that owns "runs for exactly the
    // attempt's lifetime", and a `MediaStream` left running after unmount
    // is the same forgotten-resource defect a leaked `setInterval` would
    // be. `liveStreamRef` (fix pass 1, finding 1), not the `cameraStream`
    // prop: a reconnect may have swapped in a different stream since mount,
    // and this cleanup fires on a deferred timer (below) that can run well
    // after that swap, so reading the ref is what gets the CURRENT stream
    // rather than whichever one was live when this effect was set up.
    return () => {
      queueRef.current = null;
      queue.stop();
      // Deferred, not immediate — see `cameraStopTimerRef`'s own comment
      // above. `attemptId` never changes without a real remount (the
      // dependency array below), so the only thing that can cancel this
      // is StrictMode's own phantom setup, which runs first.
      cameraStopTimerRef.current = setTimeout(() => {
        cameraStopTimerRef.current = null;
        liveStreamRef.current?.getTracks().forEach((track) => {
          track.stop();
        });
        // L3: the luminance sampler's own module-scoped `<video>`/
        // `<canvas>` pair outlives this component by design (`camera.ts`'s
        // own doc comment) — released here, beside the track stop, so the
        // stopped STREAM reference does not survive the attempt that
        // produced it. The last drawn frame deliberately does survive, a
        // few KB of stale 32x24 pixels on the shared canvas; `camera.ts`
        // records why, and nothing reads that canvas without first drawing
        // over it from a live stream.
        releaseCameraSampler();
      }, 0);
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
        // `AC-20`: one snapshot per violation, alongside the event itself.
        // Fix pass 1, finding 1: the CURRENT stream, via the ref — a
        // reconnect may have swapped it since this effect last ran, and
        // this effect does not depend on `liveStream` to re-close over it.
        if (liveStreamRef.current && !lockedRef.current) doCaptureAndUpload(liveStreamRef.current, "violation");
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
      if (awayAtRef.current === null) {
        awayAtRef.current = { startedAt: Date.now(), type };
        // `AC-20`: the snapshot belongs to the moment the violation
        // actually happens, not the moment the queue's own event is
        // pushed — `endAway` below only pushes `window_blur`/
        // `visibility_hidden` once the candidate RETURNS (`T4-R4`'s own
        // "no returned counterpart" rule), which a departure that never
        // ends (a closed tab) would never reach at all.
        // Fix pass 1, finding 1: the CURRENT stream, via the ref — a
        // reconnect may have swapped it since this effect last ran, and
        // this effect does not depend on `liveStream` to re-close over it.
        if (liveStreamRef.current && !lockedRef.current) doCaptureAndUpload(liveStreamRef.current, "violation");
      }
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

  // ---- camera liveness (`P-05`/`AC-19`/`Q2` — the phase's one `AG1`
  // exception) ---------------------------------------------------------------

  /** `Q6`: the outage this pair brackets, carried on `camera_restored` the
   *  same way `WindowBlurDetail.awayMs` carries a window-leave's. Declared
   *  locally rather than in `@pariksha/core` — the wire stays `z.unknown()`
   *  there (`proctoring.ts`'s own comment: shape-declaring belongs to
   *  whoever emits the event), and nothing outside this file reads either
   *  shape. */
  interface CameraLostDetail {
    reason: "ended" | "muted" | "covered";
  }
  interface CameraRestoredDetail {
    outageMs: number;
  }

  /** At most every five seconds while the camera reads fine — Review Focus
   *  3's own luminance sample, cheap enough to run for the whole attempt.
   *  Comfortably under the ceiling rather than pinned to it: Task 4's own
   *  interval capture (once it exists) is the natural thing to ride instead
   *  of sampling twice, and a shorter standalone cadence costs little while
   *  it doesn't. */
  const CAMERA_SAMPLE_MS = 1_000;

  const [cameraLost, setCameraLost] = useState(false);
  /** Decided once, outside any event handler, the same shape
   *  `inFullscreenRef`/`awayAtRef` already use above — a duplicate
   *  `ended`/`mute` for one real loss must not re-stamp `cameraLostAtRef`
   *  or double-report. */
  const cameraLostRef = useRef(false);
  const cameraLostReasonRef = useRef<CameraLostDetail["reason"] | null>(null);
  const cameraLostAtRef = useRef<number | null>(null);

  /**
   * M1 (whole-branch review): first-writer-wins is right for a DUPLICATE
   * signal of the same loss, but it also used to swallow a genuine
   * ESCALATION between reasons — "muted" then "ended" (a shutter, then the
   * cable pulled), or "covered" then "ended" — and every reason has exactly
   * one recovery door (`onUnmute` below, `onDeviceChange`, the sampler).
   * Stranded forever was the failure mode: the reason stayed "muted" while
   * the track was actually `ended`, so no door ever matched. A different
   * reason now re-stamps `cameraLostReasonRef` (the latest signal is what
   * recovery must match) without re-stamping `cameraLostAtRef` or
   * re-pushing the event — it is still the SAME outage, continuously lost
   * since the first report, not a second one. Hoisted to component scope
   * (not nested in the liveness effect below) so B1's mount-time check —
   * reached with no stream at all — can call the same function.
   */
  function reportLost(reason: CameraLostDetail["reason"]): void {
    if (cameraLostRef.current) {
      cameraLostReasonRef.current = reason;
      return;
    }
    cameraLostRef.current = true;
    cameraLostReasonRef.current = reason;
    cameraLostAtRef.current = Date.now();
    setCameraLost(true);
    // `pushImmediate`, not `push`: `AC-19`'s own 5 s bound is about the
    // overlay, but the organiser's own count (`Q6`) should not lag a
    // flush interval behind a block that is already up.
    void queueRef.current?.pushImmediate("camera_lost", { reason } satisfies CameraLostDetail);
    // `AC-20`'s snapshot deliberately does not fire for "ended"/"muted" —
    // neither leaves a frame to capture, and Task 3's own overlay (below)
    // is already the phase's one `AG1` exception. Fix pass 1, finding 3
    // (Task 4 review finding B): "covered" is different — the track
    // stays `live` with a drawable frame (`isCameraLensCovered` above
    // depends on exactly that to detect the condition at all), so a
    // capture here is both obtainable and the single most useful
    // evidence a `camera_lost` event can ever produce.
    if (reason === "covered" && liveStreamRef.current && !lockedRef.current) {
      doCaptureAndUpload(liveStreamRef.current, "violation");
    }
  }

  function reportRestored(): void {
    if (!cameraLostRef.current) return;
    cameraLostRef.current = false;
    cameraLostReasonRef.current = null;
    const startedAt = cameraLostAtRef.current;
    cameraLostAtRef.current = null;
    setCameraLost(false);
    void queueRef.current?.pushImmediate(
      "camera_restored",
      { outageMs: startedAt !== null ? Date.now() - startedAt : 0 } satisfies CameraRestoredDetail,
    );
  }

  useEffect(() => {
    // B1 (whole-branch review, BLOCKING): `cameraUnavailable` is true only
    // when `routes/exam.tsx`'s resume path tried to reacquire a required
    // camera and was refused — the attempt row already exists, so this is
    // NOT `P-05`'s start gate; it is Task 3's own lost-camera condition,
    // reused rather than rebuilt. `reportLost` raises the SAME overlay and
    // records the SAME event a mid-attempt loss would, rather than leaving
    // the rest of the attempt silently unproctored.
    if (!liveStream && !cameraUnavailable) return;
    if (!liveStream) reportLost("ended");

    function onEnded(): void {
      reportLost("ended");
    }
    function onMute(): void {
      reportLost("muted");
    }
    function onUnmute(): void {
      // A `mute`/`unmute` pair is the browser's own signal for a track that
      // stayed open throughout — a stream `devicechange` reconnected (the
      // `ended` case below) never unmutes, it only ever ends.
      if (cameraLostReasonRef.current === "muted") reportRestored();
    }

    const tracks = liveStream ? liveStream.getVideoTracks() : [];
    tracks.forEach((track) => {
      track.addEventListener?.("ended", onEnded);
      track.addEventListener?.("mute", onMute);
      track.addEventListener?.("unmute", onUnmute);
    });

    // Fix pass 1, finding 5 (Task 3 review finding 3): a track already dead
    // or muted in the narrow window between `acquireCamera()` succeeding
    // (`routes/exam.tsx`, or `onDeviceChange`'s own reconnect below) and
    // this effect actually attaching its listeners never fires the
    // transition event those listeners wait for — checked once, here, at
    // the moment the listeners for THIS stream go up, so a track that
    // arrives already in its terminal state is reported under the right
    // reason immediately rather than caught a tick later by the luminance
    // sampler and mislabelled "covered".
    tracks.forEach((track) => {
      if (track.readyState === "ended") reportLost("ended");
      else if (track.muted) reportLost("muted");
    });

    // L1 (whole-branch review): a reconnect that resolves after this
    // effect's own cleanup has already run acquires a stream nothing will
    // ever stop — the queue-lifecycle effect's deferred stop (above) only
    // ever sees the stream that was live AT THAT MOMENT, never one that
    // arrives afterward. Flipped in the cleanup below, read in the `.then`.
    let cancelled = false;

    // The unplug's own return trip. A real `MediaStreamTrack` never leaves
    // `ended` once it arrives there — there is no event this file, or any
    // file, can listen for on the dead track itself — so the only way back
    // is a fresh `getUserMedia`. `devicechange` is the browser's own signal
    // that a camera just appeared or disappeared, not a guess dressed up as
    // a poll. Also the recovery path for B1's "no stream at all" case —
    // reaching this point at all already proved `proctoring.requireCamera`,
    // and `reportLost("ended")` above primes the reason this checks.
    function onDeviceChange(): void {
      if (!cameraLostRef.current || cameraLostReasonRef.current !== "ended") return;
      void acquireCamera().then((result) => {
        if (cancelled) {
          // L1: this layer tore down while the reconnect was in flight —
          // stop the hardware track this resolved rather than leaving the
          // camera light on for the life of the document.
          if (result.ok) {
            result.stream.getTracks().forEach((track) => {
              track.stop();
            });
          }
          return;
        }
        if (result.ok) {
          // Fix pass 1, finding 1 (Task 3 review Finding 1, BLOCKING):
          // `result.stream` is a brand-new `MediaStream` — `replaceStream`
          // is what makes this effect actually re-subscribe to it (its
          // `[liveStream]` dependency below re-runs this whole effect on
          // the swap, tearing down these listeners against the dead track
          // and re-attaching fresh ones against the new one), rather than
          // clearing the overlay while every listener here keeps watching
          // a track that can never fire another event.
          replaceStream(result.stream);
          reportRestored();
        }
        // Q2: still gone. The next `devicechange` (or the next sample
        // tick, for a covered lens discovered later) tries again.
      });
    }
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

    // Review Focus 3 — a covered lens, not an ended track: the track stays
    // `live` and fires nothing at all while every frame reads as a covered
    // lens, which `onended`/`onmute` can never see. Skipped entirely while
    // lost for a reason this sample cannot speak to (`ended`/`muted`) —
    // drawing from a genuinely dead track proves nothing either way, and
    // only `onDeviceChange`/`onUnmute` above are the real signal for those.
    // Also simply absent whenever there is no `liveStream` to sample (B1).
    const sampleTimer = liveStream
      ? setInterval(() => {
          if (cameraLostRef.current && cameraLostReasonRef.current !== "covered") return;
          void isCameraLensCovered(liveStream).then((covered) => {
            if (covered === null) return; // Q2: an unreadable frame is not a violation.
            if (covered) reportLost("covered");
            else reportRestored();
          });
        }, CAMERA_SAMPLE_MS)
      : null;

    return () => {
      cancelled = true;
      tracks.forEach((track) => {
        track.removeEventListener?.("ended", onEnded);
        track.removeEventListener?.("mute", onMute);
        track.removeEventListener?.("unmute", onUnmute);
      });
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      if (sampleTimer !== null) clearInterval(sampleTimer);
    };
    // Fix pass 1, finding 1: `liveStream`, not the `cameraStream` prop — a
    // successful reconnect now genuinely changes which stream this effect
    // watches mid-attempt (`replaceStream` above), so this dependency array
    // intentionally re-runs the effect on that swap, tearing down the old
    // track's listeners and attaching fresh ones to the new track. B1:
    // `cameraUnavailable` is added because it is now this effect's own gate
    // for running at all when there is no stream — fixed for the life of
    // one mount in practice (`routes/exam.tsx` never flips it after render),
    // but listed honestly since the effect body reads it.
  }, [liveStream, cameraUnavailable]);

  // ---- the capture schedule (`AC-20`/`Q11b`/`Q4d`, Phase 7d Task 4) --------

  /**
   * How often the schedule checks whether a capture is due — not the
   * capture cadence itself. **Review Focus 4 (`D-R10`):** a tab throttled
   * for twenty minutes stops this tick from firing at all for that whole
   * span (`clock.test.tsx`'s own technique — `Date` moves, the timer
   * functions do not — is what the test file for this proves it with);
   * counting *ticks* would under-count every candidate who ever switched
   * windows. So `nextSnapshotAtRef` is a wall-clock timestamp, compared
   * against `Date.now()` on every tick, not incremented once per fire.
   *
   * One second, not `snapshotIntervalSeconds * 1000`: a fine check
   * granularity is what lets a throttled tab notice it is overdue within a
   * handful of real ticks once it returns, rather than waiting out a whole
   * interval.
   *
   * Fix pass 1, finding 2 (Task 4 review finding A, ruled): `due = now +
   * intervalMs` on every fire, never `due += intervalMs`. The brief's own
   * prose promises one capture on return, not a backlog burst — `due +=
   * intervalMs` drained the entire missed backlog, one capture per
   * subsequent tick, until caught up (~20 captures for a 20-minute hide,
   * `snapshot-schedule.test.tsx`'s own hidden-tab numbers before this fix).
   * Resetting to `now + intervalMs` instead means a capture always resumes
   * the cadence from the moment it actually happens, so any gap — a second
   * or twenty minutes — costs exactly one catch-up shot, never a cluster.
   * The gap itself is not lost: a hidden tab already emits
   * `visibility_hidden` as a counted violation, and a backlog burst would
   * only paper over it with photographs of the wrong moment. 7e's
   * `expectedSnapshots`/`observed` mechanism is the designed way to say
   * "proctoring was not watching" for the resulting shortfall.
   */
  const SNAPSHOT_CHECK_MS = 1_000;
  const nextSnapshotAtRef = useRef<number | null>(null);

  useEffect(() => {
    // `Q11b`: `snapshotIntervalSeconds: 0` is no capture timer at all —
    // not a timer whose upload is skipped, not a capture that is
    // discarded, no timer.
    if (!liveStream || proctoring.snapshotIntervalSeconds <= 0) return;
    const intervalMs = proctoring.snapshotIntervalSeconds * 1000;
    nextSnapshotAtRef.current = Date.now() + intervalMs;
    const timer = setInterval(() => {
      const due = nextSnapshotAtRef.current;
      if (due === null || Date.now() < due) return;
      // Fix round 1 (MAJOR): a locked attempt is terminal (only a fresh
      // page load after an organiser clears it ever reaches this component
      // again), so there is no "restore" to resume a cadence for — unlike
      // the camera-lost skip below, this one need not preserve `due` for
      // anything.
      if (lockedRef.current) return;
      // M2 (whole-branch review): a frameless outage ("ended"/"muted")
      // must not manufacture coverage from the frozen last frame a real
      // browser keeps showing on a dead `<video>` — `camera_lost`/
      // `camera_restored` already records the gap, and 7e's own
      // `observed: false` is the designed way to flag the resulting
      // shortfall, not twenty photographs of the moment the camera died.
      // "covered" keeps capturing: the track stays live with a real (if
      // dark) frame, the same exception `reportLost`'s own violation
      // snapshot above takes. `due` is deliberately left unadvanced while
      // skipped, so the first capture once restored still fires at once —
      // fix pass 1, finding 2's own "resumes from the moment it happens".
      if (cameraLostRef.current && cameraLostReasonRef.current !== "covered") return;
      // Fix pass 1, finding 2: resets from NOW, not from `due` — see the
      // doc comment above. One capture per return, never a drained backlog.
      nextSnapshotAtRef.current = Date.now() + intervalMs;
      doCaptureAndUpload(liveStream, "interval");
    }, SNAPSHOT_CHECK_MS);
    return () => {
      clearInterval(timer);
      nextSnapshotAtRef.current = null;
    };
    // Fix pass 1, finding 1: `liveStream`, not the `cameraStream` prop — a
    // reconnect mid-attempt now genuinely changes which stream this effect
    // captures from (the queue effect's own comment on `replaceStream`).
    // `snapshotIntervalSeconds` still varies this effect's behaviour
    // independently, never mid-attempt on its own.
  }, [liveStream, proctoring.snapshotIntervalSeconds]);

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
        // `AC-20`: one snapshot per violation.
        // Fix pass 1, finding 1: the CURRENT stream, via the ref — a
        // reconnect may have swapped it since this effect last ran, and
        // this effect does not depend on `liveStream` to re-close over it.
        if (liveStreamRef.current && !lockedRef.current) doCaptureAndUpload(liveStreamRef.current, "violation");
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
        // `AC-20`: one snapshot per violation.
        // Fix pass 1, finding 1: the CURRENT stream, via the ref — a
        // reconnect may have swapped it since this effect last ran, and
        // this effect does not depend on `liveStream` to re-close over it.
        if (liveStreamRef.current && !lockedRef.current) doCaptureAndUpload(liveStreamRef.current, "violation");
      }
    } catch {
      /* Q2: degrade — an unreadable screen is not a violation */
    }
  }, [proctoring.extraMonitorCheck]);

  // ---- the overlay, and marking the covered runner (`Q2a`, `T4-R2`) -------

  const fullscreenBlocked = fullscreenEnforced && !inFullscreen;
  const overlayOpen = autoSubmitted || locked || cameraLost || fullscreenBlocked || leaveWarning !== null;

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
      {/* `autoSubmitted` wins the floor over everything else: the attempt
          is over, not merely blocked, so there is nothing left for a
          camera or fullscreen overlay to be about. No control, the same
          as the camera overlay below and for the same reason — there is
          no action that makes this one go away, because nothing the
          candidate does now can un-submit the attempt. `locked` wins next,
          over the camera too: a locked attempt is frozen regardless of
          *why* a camera or fullscreen check might also be failing right
          now, and the recourse is the same either way — an organiser, not
          a control on this screen. The camera wins the floor over
          everything else beneath this — `Q2`'s one deliberate `AG1`
          exception, and the only one of the three with no control at
          all: no "Enter fullscreen", no "Continue", nothing a candidate
          can press to make it go away. Fullscreen still wins over a leave
          warning — it is indefinite and still wrong; the leave warning is
          already resolved (the candidate is back) and only needs
          acknowledging. */}
      {autoSubmitted ? (
        <ProctoringOverlay
          title="Test submitted"
          message="Submitted because the warning limit was reached. Your answers up to this point are saved."
        />
      ) : locked ? (
        <ProctoringOverlay
          title="Test locked"
          message="This attempt is locked after reaching the warning limit. Contact the organiser to unlock it — the timer keeps running while this is up, and nothing you have answered is lost."
        />
      ) : cameraLost ? (
        <ProctoringOverlay
          title="Camera connection lost"
          message="This test requires a working camera for the whole attempt. Reconnect or uncover your camera — your answers and the timer are unaffected while this is up, and it clears itself the moment the camera is back."
        />
      ) : fullscreenBlocked ? (
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
