/*
 * The candidate's save queue (#72, P6.8) — the thing that keeps Phase 6's
 * promise of "zero lost answers".
 *
 * **Four outcomes, not two status codes.** `upsertResponse` on the server
 * is one conditional statement and the route answers 200 whether the row
 * moved or not, because a late retry of sequence 4 after 5 must *not*
 * regress the answer. A queue written against `res.ok` therefore drains
 * correctly on that case and also drains on every refusal, marks the
 * answer Saved, and drops it. So the transport reports an outcome and
 * this file branches on it:
 *
 *  | outcome      | the queue    | the banner |
 *  | ------------ | ------------ | ---------- |
 *  | `accepted`   | drops it     | Saved      |
 *  | `superseded` | drops it     | Saved      |
 *  | `refused`    | **keeps it** | Not saved  |
 *  | `dropped`    | drops it     | Not saved  |
 *
 * `refused` is a 409 or a 403 — submitted, out of time (Task 9), out of
 * order (Task 10). The answer may yet be savable, so it is held and the
 * candidate is told. `dropped` is a 404: a question outside this
 * candidate's pinned paper, which no retry will ever change, so holding
 * it would mean holding it forever — it is discarded and the candidate is
 * still told, because it is not a save.
 *
 * **`localStorage`, not IndexedDB.** `AC-14` needs the queue to survive a
 * reload and a browser restart; `localStorage` does both, is synchronous
 * (so nothing is half-written when a tab closes), needs no polyfill in
 * jsdom, and answers are text. ponytail: text only — move to IndexedDB
 * the day an answer carries a blob.
 *
 * **Every read and write of it is wrapped.** A private window, blocked
 * site data or a full quota throws on `getItem`, and a candidate under a
 * clock must not meet that as a white screen. Storage that throws
 * degrades to an in-memory queue, which still saves; it only loses the
 * reload.
 */

import type { ResponseValue } from "@pariksha/core";

/** What the transport says happened to one save. */
export type SaveOutcome = "accepted" | "superseded" | "refused" | "dropped";

export interface QueuedSave {
  questionId: string;
  value: ResponseValue | null;
  clientSeq: number;
  queuedAt: number;
}

export type PutAnswer = (save: QueuedSave) => Promise<{ outcome: SaveOutcome; message?: string }>;

/** `C-05`'s four states. Each one is a word on the screen, never a colour
 *  alone — see `components/exam/SaveBanner.tsx`. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; pending: number }
  | { kind: "saved"; at: number }
  | { kind: "offline"; pending: number }
  | { kind: "refused"; questionId: string; message: string };

export interface SaveQueue {
  enqueue(questionId: string, value: ResponseValue | null): void;
  drain(): Promise<void>;
  pending(): readonly QueuedSave[];
  subscribe(listener: (state: SaveState) => void): () => void;
  /** Drops the `online` and `visibilitychange` listeners and any pending
   *  timer. The attempt view calls it when it unmounts; without it a
   *  second attempt in one tab would have two queues racing on one key. */
  close(): void;
}

/**
 * How long one edit waits before it goes.
 *
 * `C-05` says a change is saved within two seconds; 800 ms leaves room
 * for a round trip and one retry inside that. It is a **throttle, not a
 * reset**: the first edit opens the window and whatever is in the map
 * when it closes is what goes. A window that restarted on every keystroke
 * would never close while somebody typed an essay — which is exactly the
 * candidate with the most to lose.
 */
export const SAVE_DEBOUNCE_MS = 800;

/** 1s, 2s, 4s… capped at 30s. A ten-minute drop (the PRD's availability
 *  row) is then a bounded number of attempts rather than a busy loop. */
const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

/** What a refusal says when the server sent no sentence of its own. */
const REFUSED_MESSAGE = "This answer was not saved. Check your connection, then try again.";

/** A 404: the question is not on this candidate's paper, so no retry will
 *  ever store it. `C-02` — name the thing that helps. */
const DROPPED_MESSAGE =
  "This answer could not be saved because the question is not part of your paper. Tell your invigilator.";

export const queueStorageKey = (attemptId: string): string => `pariksha.queue.${attemptId}`;

interface Persisted {
  seq: number;
  saves: QueuedSave[];
}

const isSave = (row: unknown): row is QueuedSave =>
  typeof row === "object" &&
  row !== null &&
  typeof (row as QueuedSave).questionId === "string" &&
  typeof (row as QueuedSave).clientSeq === "number";

function restore(storage: Storage | undefined, key: string): Persisted {
  try {
    const raw = storage?.getItem(key);
    if (raw === null || raw === undefined) return { seq: 0, saves: [] };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      seq: typeof parsed.seq === "number" ? parsed.seq : 0,
      saves: Array.isArray(parsed.saves) ? parsed.saves.filter(isSave) : [],
    };
  } catch {
    // Blocked site data, a quota error, or a row written by a version
    // that shaped it differently. An empty queue is the honest answer and
    // the candidate's current answers are still in the page.
    return { seq: 0, saves: [] };
  }
}

/** `globalThis.localStorage` where there is one. The access itself can
 *  throw (a sandboxed iframe, site data blocked), which is why even this
 *  is wrapped. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * One queue for one attempt.
 *
 * `seed` is the highest `client_seq` the **server** holds, off
 * `AttemptPaper.clientSeq`. It is not an optimisation: a second tab, or a
 * candidate whose site data was cleared, starts with an empty
 * `localStorage` and would restart the counter at 1 — whereupon the
 * server's conditional upsert refuses every save as stale, the queue
 * drops each one as `superseded` (which is the right thing to do with a
 * genuinely stale retry), and the banner reads Saved over answers that
 * were never written. Seeding is what makes "the server holds newer"
 * true whenever the queue believes it.
 */
export function createSaveQueue(
  attemptId: string,
  put: PutAnswer,
  storage: Storage | undefined = browserStorage(),
  seed = 0,
): SaveQueue {
  const key = queueStorageKey(attemptId);
  const held = restore(storage, key);
  /** Insertion-ordered, and re-setting an existing key keeps its place —
   *  which is what makes `AC-14`'s "order is preserved" a property of the
   *  data structure rather than of a sort. */
  const waiting = new Map<string, QueuedSave>(held.saves.map((save) => [save.questionId, save]));
  /** Questions the server would not take, by the sentence to show. A
   *  refused one is still in `waiting`; a dropped one is not. */
  const unsaved = new Map<string, string>();
  const listeners = new Set<(state: SaveState) => void>();

  let seq = Math.max(held.seq, seed);
  let state: SaveState = { kind: "idle" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let failures = 0;

  const emit = (next: SaveState): void => {
    state = next;
    for (const listener of listeners) listener(next);
  };

  function persist(): void {
    try {
      storage?.setItem(key, JSON.stringify({ seq, saves: [...waiting.values()] } satisfies Persisted));
    } catch {
      // An answer that cannot be remembered across a reload is still
      // going to be sent in this one.
    }
  }

  /** Offline only when the browser says so. `navigator.onLine` is a false
   *  positive often enough (a captive portal) that the transport's own
   *  failure path is the real detector; this one just avoids a pointless
   *  request when the answer is already known. */
  const offline = (): boolean => typeof navigator !== "undefined" && navigator.onLine === false;

  const sendable = (): QueuedSave[] =>
    [...waiting.values()].filter((save) => !unsaved.has(save.questionId));

  /**
   * **The one place the banner's state is decided**, and the only place
   * the ranking lives.
   *
   * Refusals outrank everything: the banner must never read Saved while
   * one stands, and it must not read *Offline* over one either. The
   * offline and transport-failure branches used to `emit()` for
   * themselves, which skipped this ranking — so a standing refusal was
   * replaced on screen by "Offline — N waiting" for the whole outage,
   * telling a candidate that reconnecting would fix an answer that
   * `sendable()` excludes until they edit it again. Every state now
   * comes from here.
   *
   * `failures > 0` is the transport's own verdict and outranks
   * `navigator.onLine`, which says nothing useful behind a captive
   * portal: a save that could not be sent is a save the candidate should
   * be told is waiting, whatever the browser believes about the network.
   */
  function settle(): void {
    const outstanding = [...unsaved.entries()].pop();
    if (outstanding) {
      emit({ kind: "refused", questionId: outstanding[0], message: outstanding[1] });
      return;
    }
    const left = sendable().length;
    if (left === 0) {
      emit({ kind: "saved", at: Date.now() });
      return;
    }
    emit(
      offline() || failures > 0
        ? { kind: "offline", pending: left }
        : { kind: "saving", pending: left },
    );
  }

  function schedule(delay = SAVE_DEBOUNCE_MS): void {
    // One timer for the window and for the backoff alike: if a drain is
    // already coming, the failure can ride it rather than queue a second.
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  async function pass(): Promise<void> {
    let sent = false;
    for (;;) {
      const next = sendable()[0];
      if (next === undefined) break;
      if (offline()) {
        settle();
        return;
      }
      settle();

      let answer: { outcome: SaveOutcome; message?: string };
      try {
        answer = await put(next);
      } catch {
        // A transport failure is not a refusal: the answer is kept, the
        // banner says Offline, and the next attempt is further away than
        // the last. Through `settle()`, so a refusal that is already
        // standing stays on the screen instead of being replaced by a
        // message that promises reconnecting will fix it.
        failures += 1;
        schedule(RETRY_MS[Math.min(failures - 1, RETRY_MS.length - 1)]);
        settle();
        return;
      }
      failures = 0;
      sent = true;

      // A newer edit to the same question landed while this request was
      // open: leave it queued and let the loop pick it up, whatever the
      // server said about the value it has already replaced.
      if (waiting.get(next.questionId)?.clientSeq === next.clientSeq) {
        if (answer.outcome === "refused") {
          unsaved.set(next.questionId, answer.message ?? REFUSED_MESSAGE);
        } else {
          waiting.delete(next.questionId);
          if (answer.outcome === "dropped") {
            unsaved.set(next.questionId, answer.message ?? DROPPED_MESSAGE);
          }
        }
        persist();
      }
    }
    if (sent || unsaved.size > 0) settle();
  }

  /** Single-flight: a second caller joins the pass already running rather
   *  than sending the same answer twice. */
  function drain(): Promise<void> {
    if (running) return running;
    const started = pass().finally(() => {
      if (running === started) running = null;
    });
    running = started;
    return started;
  }

  const wake = (): void => {
    failures = 0;
    void drain();
  };
  const onVisible = (): void => {
    if (typeof document === "undefined" || document.visibilityState === "visible") wake();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);
  }
  // No `beforeunload` handler: every mutation below writes through to
  // storage before it returns, so there is never anything left to flush
  // when the tab goes — and an unload handler that fired a request the
  // browser is entitled to cancel would be a save the candidate was told
  // about and did not get.

  return {
    enqueue(questionId, value) {
      seq += 1;
      waiting.set(questionId, { questionId, value, clientSeq: seq, queuedAt: Date.now() });
      // A new edit is a new chance: whatever the server said about the
      // last value, this one has not been refused yet.
      unsaved.delete(questionId);
      persist();
      // Through `settle()` like every other state: another question's
      // refusal still stands even though this one's is cleared.
      settle();
      schedule();
    },
    drain,
    pending: () => [...waiting.values()],
    subscribe(listener) {
      listeners.add(listener);
      // At once, so a freshly mounted banner shows what is true now
      // rather than waiting for the next change.
      listener(state);
      return () => listeners.delete(listener);
    },
    close() {
      if (typeof window !== "undefined") {
        window.removeEventListener("online", wake);
        document.removeEventListener("visibilitychange", onVisible);
      }
      if (timer !== null) clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}
