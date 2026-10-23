// The signal layer that cannot break the runner (Phase 7c Task 2, `Q2`,
// `Q2c`, `AG4`).
//
// **R3's correction.** The brief's own draft threw from `window.matchMedia`
// — but `window.matchMedia?.("(pointer: fine)")` already runs at
// `routes/exam.tsx:93`, inside `deviceReport()`, on the **landing page**,
// before `ProctoringLayer` ever mounts. A mock that throws there would
// prove only that the boundary survives a throw from a screen it was never
// wrapped around; `openAttempt` below reaches the attempt view directly
// (the way a resumed candidate does), so that call is never even reached.
// `AG4`'s claim is that the runner survives a throw from the **signal
// path**, so this file throws from the one call `ProctoringLayer` makes
// directly in its own render — `document.fullscreenElement` — using
// `Object.defineProperty` rather than `vi.spyOn`, because jsdom does not
// implement the Fullscreen API at all (`vi.spyOn(document,
// "fullscreenElement", "get")` has no existing getter to wrap). The
// assertions are the brief's, verbatim.
//
// No `@testing-library/user-event` in this workspace (`test/exam/
// submit.test.tsx`'s own note); `user.click` below is this file's local
// stand-in, same shape as every other suite's `click` helper.

import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;

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

function paperFixture(opts: { proctoring: ResolvedProctoring; violations?: number }): AttemptPaper {
  return {
    attemptId: "att_proctor01",
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
    violations: opts.violations ?? 0,
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

/** Reach the runner the way a resumed candidate does — `client.resume()`
 *  answers the paper directly, so this never touches the landing page or
 *  `deviceReport()`'s own `matchMedia` call. `openAttempt` does not exist
 *  anywhere in `apps/web/test/exam/` (R5, the same gap 7b's `openBuilder`
 *  filled locally); this is this file's own. */
async function openAttempt(opts: { proctoring: ResolvedProctoring; violations?: number }): Promise<void> {
  render(<ExamApp client={clientFor(paperFixture(opts))} />);
  await screen.findByRole("navigation", { name: /question palette/i });
}

/** No `@testing-library/user-event` in this workspace. A real click
 *  focuses what it hits, which matters for the radio's own `checked`
 *  state here exactly as it does in `submit.test.tsx`'s identical
 *  helper. */
const user = {
  async click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.focus();
      fireEvent.click(element);
      await Promise.resolve();
    });
  },
};

afterEach(() => {
  localStorage.clear();
  // Undo the fullscreen-getter patch if a test left it in place — a
  // thrown assertion inside `try` below would otherwise leak the throwing
  // getter into every later test in the run.
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
});

describe("ProctoringLayer: fail-open", () => {
  // AG4 — the runner survives a signal path that throws.
  it("keeps the paper answerable when the proctoring layer throws on mount", async () => {
    // jsdom implements no Fullscreen API at all, so there is no existing
    // getter for `vi.spyOn(document, "fullscreenElement", "get")` to
    // wrap. Defining one directly is the same injection in spirit — a
    // browser API throwing when `ProctoringLayer` reads it — and it is
    // the exact call that component makes, unwrapped, in its own render
    // (see the doc comment on that line in `ProctoringLayer.tsx`).
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });

    await openAttempt({ proctoring: strictResolved });
    await user.click(await screen.findByRole("radio", { name: /Option A/ }));
    expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked();
  });

  // Review Focus 3 — the count survives a reload.
  it("shows the server's accumulated count after a remount", async () => {
    await openAttempt({ proctoring: strictResolved, violations: 3 });
    expect(await screen.findByText(/Warning 3 of 5/)).toBeVisible();
  });

  it("renders no count line at all when there are no violations yet", async () => {
    await openAttempt({ proctoring: strictResolved });
    expect(screen.queryByText(/Warning/)).toBeNull();
  });

  it("the attempt view, with a standing warning count, has no axe violations", async () => {
    const { container } = render(<ExamApp client={clientFor(paperFixture({ proctoring: strictResolved, violations: 2 }))} />);
    await screen.findByText(/Warning 2 of 5/);
    expect(await axe(container)).toHaveNoViolations();
  });
});
