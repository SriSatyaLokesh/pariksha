// The offline save queue (#72, P6.8) — **Review Focus 3**, and the one
// piece of this phase the gate is written about: "a real unproctored test
// runs end to end with zero lost answers".
//
// The bug this file exists to prevent is not a crash. It is a queue that
// drains on HTTP 200: `upsertResponse` answers `{ stored: false }` for a
// stale sequence and the route answers 200 either way, which is correct —
// a late retry of 4 after 5 must not regress the answer. A queue written
// against the status code therefore drains correctly on that case and
// *also* drains on the 409 a refusal returns, marks the answer **Saved**,
// and drops it. Two minutes offline across a section boundary then loses
// precisely the answers the candidate was most careful about, and every
// happy-path fixture still passes.
//
// So the queue distinguishes four outcomes and the tests below pin each:
//
//  * `accepted`   — drop it, it is stored.
//  * `superseded` — drop it, the server holds newer.
//  * `refused`    — **keep it**, and say so. Never "Saved".
//  * `dropped`    — the server will never take it (404, a question
//                   outside the paper). Drop it, and say so. Never
//                   "Saved" either — a queue that held it would hold it
//                   forever.
//
// No wall-clock assertion anywhere (#161): every wait is a fake-timer
// advance and every count is a count.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResponseValue } from "@pariksha/core";
import {
  createSaveQueue,
  queueStorageKey,
  SAVE_DEBOUNCE_MS,
  type PutAnswer,
  type QueuedSave,
  type SaveQueue,
  type SaveState,
} from "../../src/lib/queue";

const ATTEMPT = "att_queue";

const text = (value: string): ResponseValue => ({ kind: "text", text: value });
const v = text("an answer");
const v2 = text("a better answer");

/** A real `Storage`, independent of the jsdom global, so one test cannot
 *  see another's rows and the revival tests have something to revive
 *  from. The jsdom `localStorage` is used too — by the default-argument
 *  test, which is the only one that should touch it. */
function memoryStorage(): Storage {
  const rows = new Map<string, string>();
  return {
    get length() {
      return rows.size;
    },
    clear: () => rows.clear(),
    getItem: (key) => rows.get(key) ?? null,
    key: (index) => [...rows.keys()][index] ?? null,
    removeItem: (key) => rows.delete(key),
    setItem: (key, value) => {
      rows.set(key, value);
    },
  };
}

/** Safari in private mode, and every browser with site data blocked. */
const throwingStorage: Storage = {
  get length(): number {
    throw new DOMException("blocked");
  },
  clear: () => {
    throw new DOMException("blocked");
  },
  getItem: () => {
    throw new DOMException("blocked");
  },
  key: () => {
    throw new DOMException("blocked");
  },
  removeItem: () => {
    throw new DOMException("blocked");
  },
  setItem: () => {
    throw new DOMException("blocked");
  },
};

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", { value: online, configurable: true });
}
const goOffline = (): void => {
  setOnline(false);
  window.dispatchEvent(new Event("offline"));
};
const goOnline = (): void => {
  setOnline(true);
  window.dispatchEvent(new Event("online"));
};

let put: ReturnType<typeof vi.fn<PutAnswer>>;
let storage: Storage;
let queue: SaveQueue;
let states: SaveState[];
const open: SaveQueue[] = [];

/** Every queue this file makes, tracked so its window listeners go with
 *  the test — otherwise `goOnline()` in test 12 would drain test 3's. */
function makeQueue(seed?: number, on: Storage = storage, send: PutAnswer = put): SaveQueue {
  const made = createSaveQueue(ATTEMPT, send, on, seed);
  open.push(made);
  return made;
}

const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

/**
 * Drive the queue until it has nothing left to send.
 *
 * Four passes rather than one: a pass sends, a transport failure schedules
 * a backoff timer, the advance fires it, and the next pass joins whatever
 * it started. Bounded by a count, never by elapsed time.
 */
async function flush(q: SaveQueue = queue): Promise<void> {
  for (let pass = 0; pass < 4; pass++) {
    await q.drain();
    await advance(5_000);
  }
  await q.drain();
}

const lastState = (): SaveState => states[states.length - 1] as SaveState;

beforeEach(() => {
  vi.useFakeTimers();
  setOnline(true);
  storage = memoryStorage();
  put = vi.fn<PutAnswer>(() => Promise.resolve({ outcome: "accepted" as const }));
  states = [];
  queue = makeQueue();
  queue.subscribe((next) => states.push(next));
});

afterEach(() => {
  for (const made of open.splice(0)) made.close();
  vi.useRealTimers();
  try {
    localStorage.clear();
  } catch {
    /* nothing to clear */
  }
});

// --- C-05: the save happens, and soon ------------------------------------

it("C-05: a change is sent within 2 seconds", async () => {
  queue.enqueue("LOG-001", v);
  expect(put).not.toHaveBeenCalled();

  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put).toHaveBeenCalledTimes(1);
  expect(SAVE_DEBOUNCE_MS).toBeLessThan(2000);
});

it("rapid edits to one question collapse to one request carrying the latest value", async () => {
  for (const x of ["a", "b", "c"]) queue.enqueue("LOG-001", text(x));

  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put).toHaveBeenCalledTimes(1);
  expect((put.mock.lastCall as [QueuedSave])[0].value).toEqual(text("c"));
});

it("a continuous typist is still saved: the window does not restart on every keystroke", async () => {
  // A debounce that resets would never fire while someone types an essay.
  // This one is a throttle: the first edit opens the window and the last
  // value in it is what goes.
  for (let keystroke = 0; keystroke < 20; keystroke++) {
    queue.enqueue("LOG-003", text(`word ${String(keystroke)}`));
    await advance(SAVE_DEBOUNCE_MS / 2);
  }
  expect(put.mock.calls.length).toBeGreaterThan(1);
});

it("a change to a second question does not wait behind the first", async () => {
  queue.enqueue("A", v);
  queue.enqueue("B", v);
  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put.mock.calls.map((call) => call[0].questionId)).toEqual(["A", "B"]);
});

// --- AC-14: two minutes with the network off -----------------------------

const QUESTION_IDS = Array.from({ length: 17 }, (_, i) => `Q${String(i + 1)}`);

it("AC-14: two minutes offline then reconnect loses no answers, and order is preserved", async () => {
  goOffline();
  for (const [i, q] of QUESTION_IDS.entries()) queue.enqueue(q, text(String(i)));

  await advance(120_000);
  expect(put).not.toHaveBeenCalled();
  expect(queue.pending()).toHaveLength(QUESTION_IDS.length);
  expect(lastState()).toMatchObject({ kind: "offline", pending: QUESTION_IDS.length });

  goOnline();
  await flush();

  expect(put.mock.calls.map((call) => call[0].questionId)).toEqual(QUESTION_IDS);
  expect(queue.pending()).toEqual([]);
  expect(lastState().kind).toBe("saved");
});

it("AC-14: the queue survives a reload — a new queue over the same storage drains what the old one held", async () => {
  goOffline();
  queue.enqueue("LOG-001", v);
  await advance(1000);
  expect(put).not.toHaveBeenCalled();

  // The tab is gone; only `localStorage` crossed the reload. Closing it
  // first is what makes this test about the revived queue: a still-live
  // original would answer `goOnline()` itself and the assertion would
  // pass against a queue that never read storage at all.
  queue.close();
  const revived = makeQueue();
  goOnline();
  await revived.drain();

  expect(put).toHaveBeenCalledWith(expect.objectContaining({ questionId: "LOG-001" }));
  expect(revived.pending()).toEqual([]);
});

it("what crossed the reload is the LATEST value, not the first", async () => {
  goOffline();
  queue.enqueue("LOG-001", v);
  queue.enqueue("LOG-001", v2);
  await advance(1000);

  queue.close();
  const revived = makeQueue();
  goOnline();
  await revived.drain();
  expect((put.mock.lastCall as [QueuedSave])[0].value).toEqual(v2);
});

it("the reload really goes through storage: a queue over empty storage drains nothing", async () => {
  // Otherwise the test above would pass on a queue that kept its answers
  // in a module-level variable.
  goOffline();
  queue.enqueue("LOG-001", v);
  await advance(1000);

  queue.close();
  const elsewhere = makeQueue(undefined, memoryStorage());
  goOnline();
  await elsewhere.drain();
  expect(put).not.toHaveBeenCalled();
  expect(storage.getItem(queueStorageKey(ATTEMPT))).toContain("LOG-001");
});

// --- Review Focus 3: the four outcomes ------------------------------------

it("Review Focus 3: a refused save is KEPT and surfaced; a superseded one is dropped", async () => {
  put
    .mockResolvedValueOnce({ outcome: "superseded" })
    .mockResolvedValueOnce({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v);
  queue.enqueue("B", v);

  await flush();

  expect(queue.pending().map((p) => p.questionId)).toEqual(["B"]);
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "B", message: "Time is up." });
});

it("Review Focus 3: the banner never reads Saved while anything refused is outstanding", async () => {
  put.mockResolvedValue({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v);
  await flush();

  queue.enqueue("C", v);
  put.mockResolvedValue({ outcome: "accepted" });
  await flush();

  expect(lastState().kind).not.toBe("saved");
  expect(states.map((s) => s.kind)).not.toContain("saved");
});

it("I-1: an outage does not erase a standing refusal from the banner", async () => {
  // The Review Focus 3 scenario one step on. A refusal stands; then the
  // network drops with another answer still waiting. A banner that
  // flipped to "Offline — 1 answer waiting" would be telling the
  // candidate that reconnecting fixes an answer `sendable()` excludes
  // until they edit it again — so they reconnect, watch the banner
  // clear, and submit without it.
  put.mockResolvedValueOnce({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v);
  await flush();
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "A" });

  goOffline();
  queue.enqueue("B", v);
  await advance(120_000);

  expect(queue.pending().map((p) => p.questionId)).toEqual(["A", "B"]);
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "A" });
  expect(states.map((s) => s.kind)).not.toContain("saved");
});

it("I-1: a transport failure does not erase one either", async () => {
  put
    .mockResolvedValueOnce({ outcome: "refused", message: "Time is up." })
    .mockRejectedValue(new TypeError("Failed to fetch"));
  queue.enqueue("A", v);
  await flush();
  expect(lastState().kind).toBe("refused");

  queue.enqueue("B", v);
  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put.mock.calls.length).toBeGreaterThan(1);
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "A" });
});

it("I-1: editing a DIFFERENT question does not erase the refusal either, not even for a tick", async () => {
  // `enqueue` is the third emit site. It clears the refusal on the
  // question being edited and on no other, so a refusal on A must still
  // be the banner the instant B is typed into — this assertion is made
  // synchronously, before any drain can put it back.
  put.mockResolvedValueOnce({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v);
  await flush();
  expect(lastState().kind).toBe("refused");

  queue.enqueue("B", v);
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "A" });
});

it("with no refusal standing, an outage still says Offline and counts what is waiting", () => {
  // The other half of the ranking: routing the offline branch through
  // `settle()` must not cost the Offline message when it is the right
  // one to show.
  goOffline();
  queue.enqueue("A", v);
  queue.enqueue("B", v);
  expect(lastState()).toEqual({ kind: "offline", pending: 2 });
});

it("a refused save is not re-sent on every tick — it is held, once", async () => {
  put.mockResolvedValue({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v);
  await flush();
  const afterFirst = put.mock.calls.length;

  await flush();
  await flush();
  expect(put.mock.calls.length).toBe(afterFirst);
  expect(queue.pending().map((p) => p.questionId)).toEqual(["A"]);
});

it("editing a refused answer clears the refusal and tries again", async () => {
  put.mockResolvedValueOnce({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v);
  await flush();
  expect(lastState().kind).toBe("refused");

  queue.enqueue("A", v2);
  await flush();
  expect(lastState().kind).toBe("saved");
  expect(queue.pending()).toEqual([]);
});

it("Review Focus 3: a dropped save is discarded and surfaced — never held, and never Saved", async () => {
  // The fourth outcome: a 404 for a question outside the paper. Keeping
  // it would hold that answer forever; silently dropping it would show
  // "Saved" over an answer the server refused to know about.
  put.mockResolvedValue({ outcome: "dropped", message: "Not on your paper." });
  queue.enqueue("NOT-MINE", v);
  await flush();

  expect(queue.pending()).toEqual([]);
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "NOT-MINE" });
  expect(states.map((s) => s.kind)).not.toContain("saved");
});

it("an accepted save is dropped and the banner reads Saved", async () => {
  queue.enqueue("A", v);
  await flush();
  expect(queue.pending()).toEqual([]);
  expect(lastState().kind).toBe("saved");
});

it("a superseded save is dropped silently — it is not an error, the server holds newer", async () => {
  put.mockResolvedValue({ outcome: "superseded" });
  queue.enqueue("A", v);
  await flush();
  expect(queue.pending()).toEqual([]);
  expect(lastState().kind).toBe("saved");
});

// --- the sequence counter -------------------------------------------------

it("clientSeq rises monotonically per question across a reload", async () => {
  queue.enqueue("A", v);
  await flush();

  queue.close();
  const revived = makeQueue();
  revived.enqueue("A", v2);
  await flush(revived);

  expect((put.mock.calls.at(-1) as [QueuedSave])[0].clientSeq).toBeGreaterThan(
    (put.mock.calls[0] as [QueuedSave])[0].clientSeq,
  );
});

it("a sequence the server already holds cannot be reused: the queue seeds from it", async () => {
  // The advisor's prediction, and the one data-loss path that passes every
  // other fixture: a second tab, or a candidate whose site data was
  // cleared, starts a queue over empty storage. Without the seed its
  // counter restarts at 1, the server's conditional upsert refuses
  // everything below what it holds, and each save comes back
  // `superseded` — which the queue is right to drop, and which means the
  // answer is gone.
  const server = sequenceServer(5);
  const fresh = makeQueue(undefined, memoryStorage(), server.put);

  fresh.enqueue("A", text("typed in the second tab"));
  await flush(fresh);

  // Unseeded: the server still holds what it held, and nothing says so.
  expect(server.stored.A).toBeUndefined();
  expect(server.seen).toEqual([1]);

  const seeded = makeQueue(5, memoryStorage(), server.put);
  seeded.enqueue("A", text("typed in the second tab"));
  await flush(seeded);

  expect(seeded.pending()).toEqual([]);
  expect(server.stored.A).toEqual(text("typed in the second tab"));
  expect(server.seen.at(-1)).toBe(6);
});

it("the seed never lowers a counter the browser already has", async () => {
  queue.enqueue("A", v);
  await flush();
  const first = (put.mock.calls[0] as [QueuedSave])[0].clientSeq;

  queue.close();
  // A stale `/attempt` read, or an attempt whose saves have not landed:
  // the stored counter is ahead of the server's, and must win.
  const revived = makeQueue(0);
  revived.enqueue("A", v2);
  await flush(revived);
  expect((put.mock.calls.at(-1) as [QueuedSave])[0].clientSeq).toBeGreaterThan(first);
});

/** The server's half of `upsertResponse`, in four lines: store only a
 *  strictly higher sequence, and say which happened. */
function sequenceServer(held: number): {
  put: PutAnswer;
  seen: number[];
  stored: Record<string, ResponseValue | null>;
} {
  const seqs: Record<string, number> = { A: held };
  const state = {
    seen: [] as number[],
    stored: {} as Record<string, ResponseValue | null>,
    put: (save: QueuedSave) => {
      state.seen.push(save.clientSeq);
      if (save.clientSeq > (seqs[save.questionId] ?? 0)) {
        seqs[save.questionId] = save.clientSeq;
        state.stored[save.questionId] = save.value;
        return Promise.resolve({ outcome: "accepted" as const });
      }
      return Promise.resolve({ outcome: "superseded" as const });
    },
  };
  return state;
}

// --- the transport --------------------------------------------------------

it("a transport failure retries with backoff rather than dropping", async () => {
  put
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValue({ outcome: "accepted" });
  queue.enqueue("A", v);

  await flush();
  expect(queue.pending()).toEqual([]);
  expect(put).toHaveBeenCalledTimes(2);
});

it("the retry really waits: nothing is re-sent before the backoff elapses", async () => {
  put.mockRejectedValue(new TypeError("Failed to fetch"));
  queue.enqueue("A", v);
  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put).toHaveBeenCalledTimes(1);

  // Counted in timer advances, never in wall-clock milliseconds (#161).
  await advance(500);
  expect(put).toHaveBeenCalledTimes(1);
  await advance(1000);
  expect(put).toHaveBeenCalledTimes(2);
});

it("a transport failure says Offline, not Saved", async () => {
  put.mockRejectedValue(new TypeError("Failed to fetch"));
  queue.enqueue("A", v);
  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(lastState().kind).toBe("offline");
  expect(queue.pending()).toHaveLength(1);
});

it("an answer edited while its own save is in flight is not lost", async () => {
  let release = (): void => undefined;
  put.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => {
          resolve({ outcome: "accepted" });
        };
      }),
  );
  queue.enqueue("A", v);
  await advance(SAVE_DEBOUNCE_MS + 50);

  // The candidate keeps typing while the first request is open.
  queue.enqueue("A", v2);
  release();
  await flush();

  expect((put.mock.calls.at(-1) as [QueuedSave])[0].value).toEqual(v2);
  expect(queue.pending()).toEqual([]);
});

// --- storage that is not there --------------------------------------------

it("storage that throws (private mode, blocked site data) degrades to in-memory, never to a crash", () => {
  const made = makeQueue(undefined, throwingStorage);
  expect(() => {
    made.enqueue("A", v);
  }).not.toThrow();
  expect(made.pending()).toHaveLength(1);
});

it("a save still reaches the server when storage is blocked", async () => {
  const made = makeQueue(undefined, throwingStorage);
  made.enqueue("A", v);
  await flush(made);
  expect(put).toHaveBeenCalledTimes(1);
  expect(made.pending()).toEqual([]);
});

it("junk in storage is ignored rather than thrown over", async () => {
  storage.setItem(queueStorageKey(ATTEMPT), "{not json");
  const made = makeQueue();
  expect(made.pending()).toEqual([]);
  made.enqueue("A", v);
  await flush(made);
  expect(put).toHaveBeenCalledTimes(1);
});

it("a stored row that is not a save is discarded, not sent", async () => {
  storage.setItem(
    queueStorageKey(ATTEMPT),
    JSON.stringify({ seq: 3, saves: [{ nonsense: true }, { questionId: "A", value: v, clientSeq: 2, queuedAt: 0 }] }),
  );
  const made = makeQueue();
  expect(made.pending().map((p) => p.questionId)).toEqual(["A"]);
});

// --- the listeners --------------------------------------------------------

describe("the queue reacts to the browser, not to a poll", () => {
  it("coming back online drains without waiting for another edit", async () => {
    goOffline();
    queue.enqueue("A", v);
    await advance(60_000);
    expect(put).not.toHaveBeenCalled();

    goOnline();
    await queue.drain();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("the tab becoming visible drains", async () => {
    goOffline();
    queue.enqueue("A", v);
    await advance(60_000);

    setOnline(true);
    document.dispatchEvent(new Event("visibilitychange"));
    await queue.drain();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("close() stops it listening, so a dead queue cannot drain", async () => {
    goOffline();
    queue.enqueue("A", v);
    await advance(60_000);

    queue.close();
    goOnline();
    await advance(60_000);
    expect(put).not.toHaveBeenCalled();
  });

  it("subscribe hands the current state over at once, and unsubscribe stops it", () => {
    const seen: SaveState[] = [];
    const off = queue.subscribe((s) => seen.push(s));
    expect(seen[0]).toEqual({ kind: "idle" });
    off();
    queue.enqueue("A", v);
    expect(seen).toHaveLength(1);
  });
});
