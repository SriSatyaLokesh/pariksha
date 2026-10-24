// Phase 7c Task 5 (`Q9`): the watermark.
//
// `T5-R1` — the brief's own draft no-reflow test is broken twice over: it
// calls `screen.getByRole` before `openAttempt` ever renders anything
// (nothing to find — it would throw), and even fixed, jsdom's own
// `getBoundingClientRect()` is all zeros, so `expect(after.top).toBe(
// before.top)` is `0 === 0` whatever the watermark does to the layout. The
// `D8` no-reflow claim moves to `e2e/measurement/watermark.spec.ts`, which
// exists for exactly this (`field-rows.spec.ts`, `density.spec.ts` and the
// rest already measure what jsdom cannot). What stays here is what jsdom
// *can* see: the watermark mounts, is excluded from the accessibility tree,
// and sits outside the tab order.
//
// `T5-R2` — `getComputedStyle(mark).pointerEvents` / `.userSelect` are a
// second jsdom blind spot: `vitest.config.ts` sets `css: false`, so jsdom
// loads no external stylesheet and both resolve to `""` regardless of what
// `exam.css` declares. `paintsIn` (`../css-chain`) reads the real resolved
// chain instead — the candidate's own (`exam.html`), not the organiser's.
//
// No `@testing-library/user-event` in this workspace (`test/exam/
// submit.test.tsx`'s own note) — not needed here; nothing in this file
// drives a pointer.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";
import { paintsIn, resolvedChain } from "../css-chain";
import { TICK_MS, Watermark } from "../../src/components/exam/Watermark";

const NOW = 1_760_000_000_000;
const EVENTS_PATH = "/api/v1/run/attempt/events";

/** The candidate runtime's own resolved cascade — `T5-R2`'s ruling, never
 *  the organiser's `admin.html`. */
const EXAM_CSS = resolvedChain("exam.html");

const strictResolved: ResolvedProctoring = resolveProctoring({ profile: "strict" });

const question: CandidateQuestion = {
  id: "q1",
  type: "single",
  prompt: "Pick one.",
  points: 1,
  options: [
    { id: "a", text: "Option A" },
    { id: "b", text: "Option B" },
  ],
};

function paperFixture(opts: { proctoring: ResolvedProctoring }): AttemptPaper {
  return {
    attemptId: "att_watermark01",
    sections: [{ id: "s1", title: "Section", instructions: null, timeLimitMinutes: null, questions: [question] }],
    responses: {},
    clientSeq: 0,
    navigation: "free",
    maxIndex: 0,
    remainingMs: 45 * 60_000,
    sectionRemainingMs: null,
    warnAtMinutes: [10, 2],
    lateSyncGraceSeconds: 30,
    allowCalculator: false,
    serverNow: NOW,
    submittedAt: null,
    lockedAt: null,
    proctoring: opts.proctoring,
    violations: 0,
  };
}

function clientFor(paper: AttemptPaper): RunClient {
  return {
    landing: () => Promise.reject(new Error("this test does not land")),
    resume: () => Promise.resolve(paper),
    start: () => Promise.reject(new Error("this test does not start")),
    access: () => Promise.reject(new Error("this test passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("this test sends no code")),
    form: () => Promise.reject(new Error("this test reads no form")),
    register: () => Promise.reject(new Error("this test registers nobody")),
    putAnswer: () => Promise.resolve({ outcome: "accepted" as const }),
    ...RESULT_STUB,
  };
}

/** Reach the runner the way a resumed candidate does. `openAttempt` does not
 *  exist anywhere in `apps/web/test/exam/` (`T5-R5`) — every task on this
 *  phase writes its own local copy. */
async function openAttempt(opts: { proctoring: ResolvedProctoring }): Promise<void> {
  render(<ExamApp client={clientFor(paperFixture(opts))} />);
  await screen.findByRole("navigation", { name: /question palette/i });
}

beforeEach(() => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.endsWith(EVENTS_PATH)) {
      return Promise.reject(new Error(`unexpected fetch in this test: ${url}`));
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ violations: 0, limit: 5, action: "warn_then_flag" }),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Watermark (Q9)", () => {
  // Positive control: mounted, hidden from assistive tech, outside the tab
  // order, when the resolved setting is on.
  it("mounts the watermark, hidden from assistive tech and outside the tab order, when watermark is on", async () => {
    await openAttempt({ proctoring: { ...strictResolved, watermark: true } });
    const mark = document.querySelector("[data-watermark]");
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute("aria-hidden", "true");
    // Outside the tab order: nothing inside it is a native stop or carries
    // an explicit tabindex.
    expect(mark?.querySelector("a, button, input, select, textarea, [tabindex]")).toBeNull();
    // It really carries identity and the time (`Q9`) — the attempt id and
    // something that reads as a timestamp, not an empty mark.
    expect(mark?.textContent).toMatch(/att_watermark01/);
  });

  // Negative control — the SAME query, proving the positive case above is
  // really the mount and not a selector that always matches (top-level task
  // note, "the queryBy-expecting-null trap").
  it("renders no watermark when watermark is off", async () => {
    await openAttempt({ proctoring: { ...strictResolved, watermark: false } });
    expect(document.querySelector("[data-watermark]")).toBeNull();
  });

  // `T5-R2`: the two properties `getComputedStyle` cannot see in jsdom,
  // proved instead against the real resolved candidate chain.
  it("is unselectable and never intercepts a pointer, by the stylesheet it really ships", async () => {
    await openAttempt({ proctoring: { ...strictResolved, watermark: true } });
    const mark = document.querySelector("[data-watermark]")!;
    expect(paintsIn(mark, "pointer-events", EXAM_CSS)).toBe("none");
    expect(paintsIn(mark, "user-select", EXAM_CSS)).toBe("none");
  });

  // G5-12 (UI/UX audit). The tick used to be 1000ms — 40 tiles' text
  // content rewritten every second, behind the question stem, for the
  // whole attempt. Minute resolution gives a photo the same "which minute
  // was this taken" deterrence for a fraction of the DOM writes.
  //
  // m3/r2 (code review, rounds 2 and 3). Round 2 replaced
  // `expect(TICK_MS).toBe(60_000)` — which imported the constant and
  // asserted its own literal back, passing even if the component's
  // `setInterval` call hardcoded a different number — with a render that
  // reads the rendered STAMP before and after advancing fake timers. That
  // guard's sensitivity turned out to be an accident of `NOW` (shared with
  // every other test in this file): after m2 dropped seconds, the stamp
  // can only change on a minute rollover, so whether an elapsed TICK_MS
  // crosses one depends on where `NOW` happens to sit inside its own
  // minute. Proved three ways against that version: a 30_000ms tick with
  // `TICK_MS` left unused at 60_000 passed clean (one fire at `NOW`+30s
  // still inside `NOW`'s own minute, so by `TICK_MS` elapsed a second fire
  // had already rolled it over); the original 1000ms bug failed, as
  // intended, only because `NOW`'s own seconds field (`:20`) happens to
  // let a 1s tick cross a boundary before the deadline; moving `NOW` to a
  // minute-aligned instant made even that failure go quiet.
  //
  // This reads the actual timer registrations instead — a `setInterval`
  // call's own delay argument, not a rendered string capped by the
  // precision it would otherwise be used to measure — so it no longer
  // depends on where the mount instant falls inside a minute. Mounting
  // mid-minute (not the shared `NOW`, and deliberately NOT aligned) also
  // exercises r1: the first scheduled wait must be the remainder of THAT
  // minute, not a full `TICK_MS` after mount.
  it("ticks once a minute, aligned to the minute boundary, not once a second or half a minute", () => {
    vi.useFakeTimers();
    try {
      // Mounted mid-minute, deliberately NOT on a boundary and NOT the
      // shared `NOW` above — this guard's phase must not matter (r2). (A
      // mount instant already ON a boundary is its own degenerate case —
      // the wait is legitimately 0ms and nothing visibly changes at that
      // exact instant — so it is exercised separately, below, in a way
      // that does not fold that edge case into this one.)
      const mountedAt = Date.UTC(2025, 0, 1, 10, 0, 59, 0);
      vi.setSystemTime(mountedAt);
      const setTimeoutSpy = vi.spyOn(window, "setTimeout");
      const setIntervalSpy = vi.spyOn(window, "setInterval");

      render(<Watermark attemptId="att_watermark01" />);
      const mark = document.querySelector("[data-watermark]")!;
      const initialStamp = mark.textContent;

      // r1: the first scheduled wait must land exactly on a minute
      // boundary from THIS mount instant — not a hardcoded delay, so this
      // still holds whatever instant the clock starts at. Read the real
      // delay the component registered, rather than asserting one by hand.
      const alignCall = setTimeoutSpy.mock.calls.at(-1);
      expect(alignCall, "no setTimeout scheduled to align the first tick").toBeDefined();
      const alignDelay = alignCall![1] as number;
      expect(
        (mountedAt + alignDelay) % TICK_MS,
        "the scheduled wait does not land on a minute boundary",
      ).toBe(0);
      expect(
        alignDelay,
        "waited a full TICK_MS instead of only the remainder of this minute",
      ).toBeLessThan(TICK_MS);

      act(() => {
        vi.advanceTimersByTime(alignDelay);
      });

      // r2: only once aligned does the steady interval take over, and it
      // must be registered at exactly TICK_MS — the real argument the
      // component's own `setInterval` call was made with, which a
      // mismatched hardcoded rate (probes F/G/H above) cannot satisfy
      // regardless of which instant the clock started at.
      const steadyCall = setIntervalSpy.mock.calls.at(-1);
      expect(steadyCall, "no steady interval registered after alignment").toBeDefined();
      expect(steadyCall![1], "steady tick is not TICK_MS").toBe(TICK_MS);

      // End-to-end sanity: a further, unambiguously nonzero TICK_MS of
      // real elapsed time must show up as an actual, distinguishable
      // stamp change — not just a correctly-shaped timer call nobody
      // wired up.
      act(() => {
        vi.advanceTimersByTime(TICK_MS);
      });
      expect(mark.textContent, "stamp never changed despite a full TICK_MS elapsing").not.toBe(
        initialStamp,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
