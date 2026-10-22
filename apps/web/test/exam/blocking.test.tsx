// Phase 7c Task 5: copy, paste, the context menu and the extra-monitor
// check — `Q9` and `P-08`.
//
// `T5-R5`: `captureEvents`, `withScreens` and `openAttempt` do not exist
// anywhere in `apps/web/test/exam/`; every task this phase has written them
// locally, and this file does too.
//
// Two corrections to the brief's own snippets, stated rather than silently
// fixed — the assertions themselves are the brief's, verbatim, in both
// cases.
//
// One: both extra-monitor snippets call `withScreens(patch, async () =>
// {...})` with no `await` in front of it. `withScreens` has to be async
// (its own callback awaits `openAttempt`), so an un-awaited call lets the
// `it` finish before the callback's `expect`s ever run — a test that
// cannot fail, the exact trap this phase keeps finding (`T5-R1`'s own two,
// the `field-rows.spec.ts` header's "test that cannot fail"). Both call
// sites below `await` it.
//
// Two: the copy/paste/context-menu loop fires three events back to back
// with no `await` between them and reads `sent()` straight after each.
// `pushImmediate` is single-flight (`proctoring-queue.ts`'s own doc
// comment) — the SECOND call in the loop lands while the first `fetch` is
// still in flight, so it only enqueues; the send that actually posts it
// happens a microtask later, once the first `pass()` loops back around.
// Proved by running the brief's own loop unmodified: it reddens on
// `paste_blocked` ("expected ['copy_blocked'] to include 'paste_blocked'"),
// not because the handler is wrong but because the check ran before the
// request did. `waitFor` around each `sent()` check is the fix — same
// assertion, given the microtask it needs to actually land.
//
// No `@testing-library/user-event` in this workspace (`test/exam/
// submit.test.tsx`'s own note) — not needed here; this file fires events
// directly, the way the brief's own snippet does.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import { ExamApp } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;
const EVENTS_PATH = "/api/v1/run/attempt/events";

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
    attemptId: "att_blocking01",
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

/** Stubs `fetch` for the events route and records every event TYPE posted
 *  through it, in order, across every request this test makes — `sent()`
 *  is what the brief's own snippets read. The violation count a flush
 *  answers with is the running count of events captured so far, which is
 *  enough for the ambient count line without a second counter to keep in
 *  sync by hand. */
function captureEvents(): () => string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.endsWith(EVENTS_PATH)) {
      return Promise.reject(new Error(`unexpected fetch in this test: ${url}`));
    }
    const body = JSON.parse(String(init?.body)) as { events: { type: string }[] };
    seen.push(...body.events.map((event) => event.type));
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ violations: seen.length, limit: 5, action: "warn_then_flag" }),
    } as Response);
  });
  return () => seen;
}

/**
 * `P-08`'s own surface: `window.screen.isExtended` and, where this task's
 * ruling says it must never be called, `getScreens()`.
 *
 * `patch: undefined` is "the browser does not expose screens" — jsdom's
 * own baseline `Screen` already carries neither property, so there is
 * nothing to add; the callback runs against that real baseline rather
 * than a double negative constructed by deleting something that was
 * never there.
 */
async function withScreens(
  patch: { isExtended: boolean; getScreens: () => void } | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  if (patch === undefined) {
    await fn();
    return;
  }
  Object.defineProperty(window.screen, "isExtended", { configurable: true, value: patch.isExtended });
  Object.defineProperty(window.screen, "getScreens", { configurable: true, value: patch.getScreens });
  try {
    await fn();
  } finally {
    delete (window.screen as { isExtended?: unknown }).isExtended;
    delete (window.screen as { getScreens?: unknown }).getScreens;
  }
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

describe("copy, paste and the context menu (Q9)", () => {
  it("blocks copy, paste and the context menu, and records each", async () => {
    const sent = captureEvents();
    await openAttempt({ proctoring: { ...strictResolved, blockCopyPaste: true } });
    for (const [type, expected] of [
      ["copy", "copy_blocked"],
      ["paste", "paste_blocked"],
      ["contextmenu", "contextmenu_blocked"],
    ] as const) {
      const ev = new Event(type, { cancelable: true, bubbles: true });
      fireEvent(screen.getByRole("radio", { name: /Option A/ }), ev);
      expect(ev.defaultPrevented).toBe(true);
      await waitFor(() => {
        expect(sent()).toContain(expected);
      });
    }
  });

  // Off control — proves the block above is really gated on the resolved
  // setting and not simply always on.
  it("leaves copy, paste and the context menu alone when blockCopyPaste is off", async () => {
    await openAttempt({ proctoring: { ...strictResolved, blockCopyPaste: false } });
    for (const type of ["copy", "paste", "contextmenu"] as const) {
      const ev = new Event(type, { cancelable: true, bubbles: true });
      fireEvent(screen.getByRole("radio", { name: /Option A/ }), ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });
});

describe("the extra-monitor check (P-08)", () => {
  it("reports an extra monitor without ever requesting a permission", async () => {
    const getScreens = vi.fn();
    await withScreens({ isExtended: true, getScreens }, async () => {
      const sent = captureEvents();
      await openAttempt({ proctoring: { ...strictResolved, extraMonitorCheck: true } });
      expect(sent()).toContain("extra_monitor");
      expect(getScreens).not.toHaveBeenCalled();
    });
  });

  // Positive control above, negative control here — the SAME check (`sent()`
  // over the same route) on a browser that exposes nothing (top-level task
  // note, "the queryBy-expecting-null trap", the same shape for a captured
  // event as for a query).
  it("reports nothing where the browser does not expose screens", async () => {
    await withScreens(undefined, async () => {
      const sent = captureEvents();
      await openAttempt({ proctoring: { ...strictResolved, extraMonitorCheck: true } });
      expect(sent()).not.toContain("extra_monitor");
    });
  });
});
