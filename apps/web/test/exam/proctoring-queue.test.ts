// The proctoring queue (Phase 7c Task 2) — `Q2`'s client half: try, and on
// anything at all, degrade. Three behaviours pinned here, each one a
// ruling the brief or the pre-flight scan settled:
//
//  * A flush larger than ten events is split into separate requests —
//    `Q7`'s own ten-event cap on the ingest route.
//  * The buffer never exceeds 100 events, however long the network stays
//    dead (the brief's own ruling: AG1 outranks completeness of
//    evidence).
//  * One `proctoring_unavailable` is owed per gap in the evidence, not
//    per failed send — `T2-R2` in the pre-flight scan: the brief's own
//    third test raises it from a single failure with nothing dropped,
//    which a drop-only trigger could never pass.
//
// No wall-clock assertion anywhere: every wait is a fake-timer advance.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProctoringQueue,
  type EventsResponse,
  type QueuedEvent,
} from "../../src/lib/proctoring-queue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const OK: EventsResponse = { violations: 0, limit: 5, action: "warn_only" };

describe("createProctoringQueue", () => {
  // Review Focus 2 — eleven events is two requests.
  it("splits a flush larger than ten into separate requests", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
    for (let i = 0; i < 11; i++) q.push("window_blur");
    await vi.advanceTimersByTimeAsync(20);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toHaveLength(10);
    q.stop();
  });

  // Review Focus 1 — a failing ingest is silent and bounded.
  it("keeps accepting pushes while every send rejects, and never exceeds 100 buffered", async () => {
    const send = vi.fn().mockRejectedValue(new Error("500"));
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
    for (let i = 0; i < 500; i++) q.push("window_blur");
    await vi.advanceTimersByTimeAsync(100);
    expect(q.buffered()).toBeLessThanOrEqual(100);
    q.stop();
  });

  it("owes one proctoring_unavailable after an outage recovers", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue(OK);
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
    q.push("window_blur");
    await vi.advanceTimersByTimeAsync(40);
    const types = send.mock.calls.at(-1)![0].map((e: QueuedEvent) => e.type);
    expect(types).toContain("proctoring_unavailable");
    q.stop();
  });

  // T2-R2 is "one marker per GAP, not per failure", and the test above
  // cannot see the difference: `toContain` is satisfied by one marker or
  // by two hundred.
  //
  // What counts is markers the server RECEIVES, not batches the client
  // attempted. A rejected send delivered nothing, so the marker it
  // carried was never told to anyone — counting attempts instead of
  // deliveries reports three gaps where the server saw one. The first
  // draft of this test made exactly that mistake and failed against
  // correct code.
  it("delivers exactly one proctoring_unavailable across a long outage, not one per failed send", async () => {
    const FAILURES = 3;
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("500"))
      .mockRejectedValueOnce(new Error("500"))
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValue(OK);
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
    q.push("window_blur");
    await vi.advanceTimersByTimeAsync(100);
    // Everything from the first resolved call onward actually reached the server.
    const delivered = send.mock.calls
      .slice(FAILURES)
      .flatMap((call) => call[0] as QueuedEvent[])
      .filter((event) => event.type === "proctoring_unavailable");
    expect(delivered).toHaveLength(1);

    // And the gap is cleared once told: later traffic carries no second marker.
    q.push("window_blur");
    await vi.advanceTimersByTimeAsync(40);
    const after = send.mock.calls
      .slice(-1)
      .flatMap((call) => call[0] as QueuedEvent[])
      .filter((event) => event.type === "proctoring_unavailable");
    expect(after).toHaveLength(0);
    q.stop();
  });

  // T2-R1: `buffered()` is part of the returned object precisely so the
  // bound above is something a test can read at all.
  it("buffered() reports what is actually waiting, net of what a successful flush drained", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
    q.push("window_blur");
    q.push("copy_blocked");
    expect(q.buffered()).toBe(2);
    await vi.advanceTimersByTimeAsync(10);
    expect(q.buffered()).toBe(0);
    q.stop();
  });

  // Q2: a consumer's own callback throwing must not break the queue's
  // next flush — the layer is the thing wrapped in an error boundary,
  // not the queue it owns.
  it("keeps flushing even when onCount itself throws", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const onCount = vi.fn(() => {
      throw new Error("a consumer bug");
    });
    const q = createProctoringQueue({ send, onCount, flushMs: 10 });
    q.push("window_blur");
    await vi.advanceTimersByTimeAsync(10);
    expect(onCount).toHaveBeenCalledTimes(1);
    q.push("window_blur");
    await vi.advanceTimersByTimeAsync(10);
    expect(send).toHaveBeenCalledTimes(2);
    q.stop();
  });

  // Finding 3 (review fix round 1): `pushImmediate` is part of the
  // brief's required interface and its one documented claim — "flushes
  // now, not on the interval" — had no test anywhere. `flushMs` here is
  // long enough that nothing would reach `send` by the time the await
  // settles unless `pushImmediate` really does flush synchronously with
  // the call, not on the next tick.
  it("pushImmediate sends right away, without waiting for the interval", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10_000 });
    await q.pushImmediate("violation_limit_reached");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ type: "violation_limit_reached" }),
    ]);
    q.stop();
  });

  it("pushImmediate still resolves (fail-open) when the send it triggers rejects", async () => {
    const send = vi.fn().mockRejectedValue(new Error("500"));
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10_000 });
    await expect(q.pushImmediate("attempt_locked")).resolves.toBeUndefined();
    expect(q.buffered()).toBe(1);
    q.stop();
  });

  it("stop() halts the interval: nothing is sent after it", async () => {
    const send = vi.fn().mockResolvedValue(OK);
    const q = createProctoringQueue({ send, onCount: () => {}, flushMs: 10 });
    q.stop();
    q.push("window_blur");
    await vi.advanceTimersByTimeAsync(100);
    expect(send).not.toHaveBeenCalled();
  });
});
