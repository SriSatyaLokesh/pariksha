/*
 * The candidate's proctoring event queue (Phase 7c Task 2) — `Q7`'s client
 * half: batch to `POST /api/v1/run/attempt/events`, bounded, fail-open.
 *
 * `Q2` is the whole point: try, and on anything at all, degrade. Nothing
 * here throws out to a caller — `push` and `pushImmediate` swallow their
 * own failures. A dead network, a 500, a refused rate limit: the queue
 * just keeps buffering and tries again on the next interval. `Q2c`'s error
 * boundary (`components/exam/ProctoringLayer.tsx`) is the backstop for
 * whatever still gets past that, not the plan.
 *
 * **Bounded, not unbounded** — the brief's own ruling. A candidate with a
 * dead network for twenty minutes must not accumulate an unbounded array;
 * at most 100 events are held and the oldest is dropped past that.
 *
 * **One `proctoring_unavailable` per gap, not per failure (ruling R2).**
 * The brief ties the marker to *dropping* events, but its own test raises
 * it from a single failed send with nothing dropped at all — both are a
 * gap in the evidence, so the trigger is "something did not reach the
 * server", not "something was discarded". A failed send or an overflow
 * drop both set one flag; the next flush that actually reaches the server
 * spends it by prepending exactly one marker event, never one per retry
 * and never one per dropped event. The marker itself is synthesised only
 * at send time and is never stored in the capped buffer, so a standing
 * outage cannot grow it past 100 by re-queueing its own marker.
 */

import type { ProctoringEventType, ViolationAction } from "@pariksha/core";

export interface QueuedEvent {
  type: ProctoringEventType;
  detail?: unknown;
  clientTs: number;
}

/** `Q7`'s ingest response — `apps/api/src/routes/proctoring.ts`. */
export interface EventsResponse {
  violations: number;
  limit: number;
  action: ViolationAction;
  /** Phase 7e Task 2: `true` only on the one response whose own batch
   *  pushed this attempt over the limit under `auto_submit` — never a
   *  standing fact repeated on every later flush. Optional, not required:
   *  every fixture across this package's test suite that stubs this route
   *  predates the field, and treating an absent key as "not this response"
   *  is the correct reading for every one of them, not a gap to patch. */
  submitted?: boolean;
  /** Phase 7e Task 3: the `submitted` field's own mirror — `true` only on
   *  the one response whose own batch locked this attempt under `lock`.
   *  Optional for the identical reason `submitted` is: every pre-existing
   *  fixture predates it, and an absent key reads as "not this response". */
  locked?: boolean;
  /** Phase 8g Task 3 (`C-10`, `K12`, `K13`): proctor broadcast message. */
  message?: string;
  messageAt?: number;
}

/** The brief's own ruling: a dead network for twenty minutes must not grow
 *  the buffer without bound. */
const MAX_BUFFERED = 100;

/** Mirrors `MAX_EVENTS_PER_REQUEST` in `apps/api/src/routes/proctoring.ts`
 *  — a server-only module this bundle cannot import across the app
 *  boundary, so the cap is duplicated rather than shared. */
const MAX_PER_REQUEST = 10;

export interface ProctoringQueue {
  push(type: ProctoringEventType, detail?: unknown): void;
  /** Violations that trigger an action flush now, not on the interval.
   *  Never rejects — a candidate's own event never costs them a thrown
   *  promise; a send it could not complete stays buffered for the next
   *  interval. */
  pushImmediate(type: ProctoringEventType, detail?: unknown): Promise<void>;
  buffered(): number;
  stop(): void;
}

export function createProctoringQueue(opts: {
  send: (events: QueuedEvent[]) => Promise<EventsResponse>;
  /** `submitted`/`locked`: Phase 7e Tasks 2 and 3's own additions — see
   *  `EventsResponse`'s doc comment on each. Both default `false` for
   *  every pre-existing caller, which is also the correct reading of a
   *  response that omits either field. */
  onCount: (
    violations: number,
    limit: number,
    action: ViolationAction,
    submitted: boolean,
    locked: boolean,
  ) => void;
  /** Phase 8g Task 3 (`C-10`, `K12`, `K13`): proctor broadcast callback. */
  onMessage?: (message: string, messageAt: number) => void;
  flushMs: number;
}): ProctoringQueue {
  let buffer: QueuedEvent[] = [];
  let owesGap = false;
  let stopped = false;
  let running: Promise<void> | null = null;

  function enqueue(type: ProctoringEventType, detail?: unknown): void {
    buffer.push({ type, detail, clientTs: Date.now() });
    if (buffer.length > MAX_BUFFERED) {
      // Oldest first: the ruling's own cost analysis — a long outage loses
      // the middle of its own evidence rather than the tab.
      buffer.splice(0, buffer.length - MAX_BUFFERED);
      owesGap = true;
    }
  }

  /** One pass: send what fits, ten at a time, until the buffer is empty
   *  or a send fails. The marker is built fresh each iteration from
   *  `owesGap` rather than stored in `buffer`, so it never counts against
   *  the 100-event bound and a standing outage can never grow by
   *  re-queueing its own marker on every retry. */
  async function pass(): Promise<void> {
    while (!stopped && (buffer.length > 0 || owesGap)) {
      const marker: QueuedEvent[] = owesGap
        ? [{ type: "proctoring_unavailable", clientTs: Date.now() }]
        : [];
      const real = buffer.slice(0, MAX_PER_REQUEST - marker.length);
      const batch = [...marker, ...real];

      let answer: EventsResponse;
      try {
        answer = await opts.send(batch);
      } catch {
        // Q2: degrade, don't throw. Nothing in `batch` is committed —
        // `buffer` is untouched and the gap is still owed (it may
        // already have been true; either way the next flush retries
        // with the marker still unspent).
        owesGap = true;
        return;
      }

      buffer = buffer.slice(real.length);
      owesGap = false;
      if (!stopped) {
        try {
          opts.onCount(
            answer.violations,
            answer.limit,
            answer.action,
            answer.submitted === true,
            answer.locked === true,
          );
        } catch {
          // A consumer's own callback must not break the queue either.
        }
        if (answer.message && typeof answer.messageAt === "number") {
          try {
            opts.onMessage?.(answer.message, answer.messageAt);
          } catch {
            // A consumer's own callback must not break the queue either.
          }
        }
      }
    }
  }

  /** Single-flight: a tick that lands while a pass is already running
   *  joins it rather than starting a second one over the same buffer. */
  function flush(): Promise<void> {
    if (running) return running;
    const started = pass().finally(() => {
      if (running === started) running = null;
    });
    running = started;
    return started;
  }

  const timer = setInterval(() => {
    void flush();
  }, opts.flushMs);

  return {
    push(type, detail) {
      try {
        enqueue(type, detail);
      } catch {
        // Q2: a signal path never throws out to its caller.
      }
    },
    async pushImmediate(type, detail) {
      try {
        enqueue(type, detail);
        await flush();
      } catch {
        // Fail-open: whatever could not go out now is still buffered
        // for the next interval.
      }
    },
    buffered: () => buffer.length,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
