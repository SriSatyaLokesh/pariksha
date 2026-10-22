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
import { render, screen } from "@testing-library/react";
import { resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";
import { paintsIn, resolvedChain } from "../css-chain";

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
});
