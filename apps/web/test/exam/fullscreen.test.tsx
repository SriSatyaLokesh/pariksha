// Phase 7c Task 4 (`P-03`, `P-04`, `Q2a`, `Q2b`): fullscreen enforcement,
// window-leave detection, and `ProctoringOverlay`.
//
// **`T4-R3`**: jsdom ships no Fullscreen API at all — no `fullscreenElement`
// getter, no `requestFullscreen` (verified directly: `"fullscreenElement"
// in document` is `false` and `document.documentElement.requestFullscreen`
// is `undefined` in this workspace's jsdom). `ProctoringLayer` treats that
// absence exactly as `Q1a` treats iOS Safari's own missing
// `requestFullscreen`: the control degrades to never firing rather than a
// false violation. So "available" here is something each test that needs
// it installs for itself (`installFullscreenApi`, same spirit as
// `proctoring-failopen.test.tsx`'s `Object.defineProperty` patch, which
// this file's header comment explains at length); a test that installs
// nothing is exercising the real, unavailable, baseline — which is exactly
// what the "does not fire ... where requestFullscreen is unavailable" test
// below needs, with no patch of its own at all.
//
// **`T4-R2`**: `toBeVisible()` cannot see the overlay's covering — jsdom
// applies no external stylesheet, and this file hides the covered region
// via `aria-hidden`/`inert`, not `display:none`, so `toBeVisible()` would
// not move either way and asserting on it would test nothing. `Q2a`'s real
// requirement — the runner stays MOUNTED, an answer survives, the region
// is unreachable to assistive tech while covered — is what every assertion
// below checks instead. Every `queryByRole(...)` expecting `null` here is
// paired with the SAME query (or the `hidden: true` escape hatch) finding
// the element when it legitimately should, so a wrong selector cannot pass
// this suite for free (top-level task note, "the queryBy-expecting-null
// trap").
//
// No `@testing-library/user-event` in this workspace
// (`test/exam/submit.test.tsx`'s own note) — `user.click` is this file's
// local stand-in, and the Tab-trap test fires `keyDown` directly on the
// boundary element, the same pattern `calculator.test.tsx`'s own trap test
// uses, rather than simulating a whole browser tab order jsdom does not
// have.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import { ExamApp } from "../../src/routes/exam";
import { useDialogKeys } from "../../src/components/useDialogKeys";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;
const EVENTS_PATH = "/api/v1/run/attempt/events";

// `requireCamera: false` — this file is not about the camera, and every
// test here reaches the runner through `client.resume()`. B1 (whole-branch
// review) made the resume path really try `acquireCamera()` whenever
// `requireCamera` is true, which this file's fixtures never stub; left at
// Strict's own default, every test below would hit the lost-camera overlay
// instead of the fullscreen/window-leave one it is actually testing.
const strictResolved: ResolvedProctoring = { ...resolveProctoring({ profile: "strict" }), requireCamera: false };

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
    attemptId: "att_fullscreen01",
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
 *  answers the paper directly. `openAttempt` does not exist anywhere in
 *  `apps/web/test/exam/` (every task on this phase writes its own local
 *  copy; Task 2's own file explains why one is not shared). */
async function openAttempt(opts: { proctoring: ResolvedProctoring; violations?: number }): Promise<void> {
  render(<ExamApp client={clientFor(paperFixture(opts))} />);
  await screen.findByRole("navigation", { name: /question palette/i });
  // Same reason as `blocking.test.tsx`'s own `openAttempt`: the palette's
  // commit is not the instant `ProctoringLayer`'s effects run, and every
  // signal this file dispatches lands on a listener one of those effects
  // installs. `findByRole` resolves on the commit; React flushes passive
  // effects afterwards. An empty `act` closes that gap and nothing else.
  await act(async () => {});
}

const user = {
  async click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.focus();
      fireEvent.click(element);
      await Promise.resolve();
    });
  },
};

/** The server's violation count for this test's single `fetch` mock — a
 *  fixed response is enough: no test here needs more than one round trip
 *  to matter. `Q7a`: the warning names THIS, never a client counter. */
let mockViolations = 0;

beforeEach(() => {
  mockViolations = 0;
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.endsWith(EVENTS_PATH)) {
      return Promise.reject(new Error(`unexpected fetch in this test: ${url}`));
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ violations: mockViolations, limit: 5, action: "warn_then_flag" }),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  // `T4-R3`: undo whatever a test installed, so the next one starts from
  // jsdom's real baseline (no Fullscreen API) rather than a leaked patch.
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
});

/** Installs just enough of the Fullscreen API for `fullscreenchange` and
 *  `requestFullscreen()` to behave like a real browser's: a single
 *  tracked element, a getter that reads it, and a `requestFullscreen`
 *  that sets it and fires the event — the same shape `P-03` describes
 *  ("the test starts only from a click that enters fullscreen"). */
function installFullscreenApi(): void {
  let current: Element | null = null;
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => current,
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: () => {
      current = document.documentElement;
      fireEvent(document, new Event("fullscreenchange"));
      return Promise.resolve();
    },
  });
}

/** Clicks the overlay's own remedy control — exercising the real path
 *  `P-03` describes rather than calling `requestFullscreen()` directly. */
async function enterFullscreen(): Promise<void> {
  await user.click(screen.getByRole("button", { name: /enter fullscreen/i }));
}

describe("ProctoringOverlay: fullscreen (P-03)", () => {
  beforeEach(installFullscreenApi);

  it("hides the questions on fullscreen exit and restores them", async () => {
    await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true } });

    // Mount state is "not fullscreen" (nothing has entered yet), so the
    // overlay is already up — the explicit fullscreenchange below is the
    // brief's own way of marking "now out" and changes nothing about that.
    fireEvent(document, new Event("fullscreenchange"));
    expect(await screen.findByRole("alertdialog")).toBeVisible();

    // Positive control first (top-level task note): the SAME query finds
    // the radio once it is reachable again, below — proving the `null`
    // here is really the covering, not a selector that never matched.
    expect(screen.queryByRole("radio", { name: /Option A/ })).toBeNull();
    expect(screen.getByRole("radio", { name: /Option A/, hidden: true })).toBeInTheDocument();

    await enterFullscreen();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByRole("radio", { name: /Option A/ })).toBeVisible();
  });

  // Q2a — the answer, the mount, and the AT-reachability all survive the
  // overlay. T4-R2: not a `toBeVisible()` claim.
  it("keeps the runner mounted and the typed answer intact, hidden from assistive tech while covered", async () => {
    await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true } });

    const radio = screen.getByRole("radio", { name: /Option A/, hidden: true });
    await user.click(radio);
    expect(radio).toBeChecked();

    const runner = document.querySelector(".exam-runner");
    expect(runner).not.toBeNull();
    expect(runner).toHaveAttribute("aria-hidden", "true");
    expect(runner).toHaveAttribute("inert");
    // Still in the document — never unmounted, only covered.
    expect(document.body).toContainElement(radio);
    // Positive control: the default (accessible) query cannot reach it
    // while covered — proving the mechanism is really aria-hidden.
    expect(screen.queryByRole("radio", { name: /Option A/ })).toBeNull();

    await enterFullscreen();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    expect(document.querySelector(".exam-runner")).not.toHaveAttribute("aria-hidden");
    expect(document.querySelector(".exam-runner")).not.toHaveAttribute("inert");
    // The answer survived the whole round trip, reachable by the default
    // query again now that nothing covers it.
    expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked();
  });

  // Review Focus 5 — announced, trapped, and not escapable.
  it("traps focus in the overlay and ignores Escape", async () => {
    await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true } });
    fireEvent(document, new Event("fullscreenchange"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(/fullscreen/i);

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeVisible();

    const action = screen.getByRole("button", { name: /enter fullscreen/i });
    action.focus();
    expect(document.activeElement).toBe(action);
    // Only one focusable stop inside this overlay (the one remedy
    // control) — the trap's own edge case, and the honest shape of a
    // dialog with exactly one action: Tab at the edge wraps to itself.
    // `calculator.test.tsx`'s own trap test reads the SAME signal
    // (`fireEvent`'s return value is `false` exactly when the handler
    // called `preventDefault()`) because jsdom has no native tab order to
    // observe moving — a `document.activeElement` check alone cannot
    // distinguish "trapped" from "untrapped" when there is only one stop.
    expect(fireEvent.keyDown(action, { key: "Tab" })).toBe(false);
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("the overlay has no axe violations while open", async () => {
    const { container } = render(
      <ExamApp
        client={clientFor(
          paperFixture({ proctoring: { ...strictResolved, requireFullscreen: true }, violations: 1 }),
        )}
      />,
    );
    await screen.findByRole("alertdialog");
    expect(await axe(container)).toHaveNoViolations();
  });
});

// Q1a — a phone (or any browser without the API) must not manufacture a
// violation, and must not strand the candidate behind an overlay that can
// never clear.
describe("ProctoringOverlay: fullscreen degrades where the API is unavailable (Q1a)", () => {
  it("does not fire a fullscreen violation where requestFullscreen is unavailable", async () => {
    // No `installFullscreenApi()` — jsdom's own baseline already has
    // neither `fullscreenElement` nor `requestFullscreen`, which is
    // exactly what "unavailable" means here. `afterEach` above also
    // guarantees a leaked patch from an earlier test cannot survive into
    // this one.
    await openAttempt({ proctoring: { ...strictResolved, requireFullscreen: true, desktopOnly: false } });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    // Positive control: the same query, in the fullscreen-available
    // `describe` block above, does find an alertdialog — proving this
    // `null` is the degrade, not a selector that can never match.
    expect(screen.getByRole("radio", { name: /Option A/ })).toBeVisible();
  });
});

describe("ProctoringOverlay: window-leave (P-04)", () => {
  // Deliberately no fullscreen patching anywhere in this block: real
  // jsdom has no Fullscreen API, so `requireFullscreen` on `strictResolved`
  // never fires its own overlay here and cannot compete with this one.

  it("names the count from the server on a window-leave warning", async () => {
    mockViolations = 2;
    await openAttempt({ proctoring: strictResolved, violations: 1 });
    await act(async () => {
      fireEvent(window, new Event("blur"));
    });
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    expect(
      await screen.findByText(/Leaving the test window is not allowed\. Warning 2 of 5\./),
    ).toBeVisible();
  });

  // Review finding 4 — `findByText`/`getByText` both retry past the
  // intermediate render, so this is the one assertion that cannot: no
  // `act(async …)`/`await` between the departure and the check, so the
  // fetch mock's promise has not resolved yet and `count` is still
  // whatever it was before this departure (`0` here, the attempt's first
  // violation) — the sentence must not show that stale figure.
  it("shows no figure until the server has answered this departure", async () => {
    mockViolations = 1;
    await openAttempt({ proctoring: strictResolved });
    fireEvent(window, new Event("blur"));
    fireEvent(window, new Event("focus"));
    expect(screen.getByText("Leaving the test window is not allowed.")).toBeVisible();
    expect(screen.queryByText(/Warning \d+ of \d+\./)).toBeNull();
    // The server answers on the next tick; the figure appears once it does.
    await screen.findByText(/Leaving the test window is not allowed\. Warning 1 of 5\./);
  });

  it("reports one event per departure even when blur+focus and visibilitychange both fire", async () => {
    mockViolations = 2;
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.endsWith(EVENTS_PATH)) return Promise.reject(new Error(`unexpected fetch: ${url}`));
      calls.push(JSON.parse(String(init?.body)));
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ violations: mockViolations, limit: 5, action: "warn_then_flag" }),
      } as Response);
    });

    await openAttempt({ proctoring: strictResolved, violations: 1 });
    await act(async () => {
      fireEvent(window, new Event("blur"));
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      fireEvent(document, new Event("visibilitychange"));
    });
    await act(async () => {
      fireEvent(window, new Event("focus"));
    });
    // The full sentence, not a bare `/Warning 2 of 5/` — the ambient count
    // line (Task 2's own, untouched) shows the same count simultaneously,
    // and the bare pattern matches both.
    await screen.findByText(/Leaving the test window is not allowed\. Warning 2 of 5\./);

    const violationEvents = calls
      .flatMap((call) => (call as { events: { type: string }[] }).events)
      .filter((event) => event.type === "window_blur" || event.type === "visibility_hidden");
    expect(violationEvents).toHaveLength(1);

    delete (document as { hidden?: unknown }).hidden;
  });

  // Review finding 5 — `T4-R4` promised the departure survives an unload
  // with `awayMs: null`; the 5-second flush interval gets no further tick
  // on an unloading page, so `pagehide` has to reach the server by a
  // transport the browser itself finishes delivering.
  it("sends the pending departure via sendBeacon on pagehide", async () => {
    const beacon = vi.fn(() => true);
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
    await openAttempt({ proctoring: strictResolved });
    // Fix pass 1, finding 6 (Task 4 review finding D): wrapped in `act`,
    // matching every sibling test in this block — without it, this was a
    // listener-registration race (`openAttempt` resolves via an async
    // boundary before `ProctoringLayer`'s window-leave effect is guaranteed
    // to have run as a passive effect of that same commit), not a real
    // double-send: diagnosed and ruled out, see the task 4 review. Not
    // `waitFor` on the assertion below — that would mask a genuine
    // double-send rather than close the race.
    await act(async () => {
      fireEvent(window, new Event("blur")); // departure starts, no focus back
      fireEvent(window, new Event("pagehide"));
    });
    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, body] = beacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe(EVENTS_PATH);
    const payload = JSON.parse(await body.text()) as { events: { type: string; detail: unknown }[] };
    expect(payload.events).toEqual([{ type: "window_blur", detail: { awayMs: null }, clientTs: expect.any(Number) }]);
    delete (navigator as { sendBeacon?: unknown }).sendBeacon;
  });
});

// `T4-R1`: `useDialogKeys` gained `dismissible` for this overlay
// (`ProctoringOverlay` always declines it). There is no dedicated test
// file for the hook itself, so its own contract — Escape calls `onClose`
// by default, and must not when `dismissible: false` — is proven directly
// here, at the level where it is actually decided. The integration test
// above ("ignores Escape") cannot prove this on its own: `ProctoringOverlay`
// wires a no-op `onClose`, so even a regression that re-enabled Escape
// would have nothing observable to call.
function DialogKeysProbe({
  dismissible = true,
  onClose,
}: {
  dismissible?: boolean;
  onClose: () => void;
}) {
  const dialog = useDialogKeys<HTMLDivElement>(true, onClose, { dismissible });
  return <div data-testid="probe-dialog" ref={dialog.dialogRef} tabIndex={-1} onKeyDown={dialog.onKeyDown} />;
}

describe("useDialogKeys: dismissible (T4-R1)", () => {
  it("calls onClose on Escape by default, unchanged for every existing caller", () => {
    const onClose = vi.fn();
    render(<DialogKeysProbe onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("probe-dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("never calls onClose on Escape when dismissible is false — Q2b's rule", () => {
    const onClose = vi.fn();
    render(<DialogKeysProbe dismissible={false} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("probe-dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
