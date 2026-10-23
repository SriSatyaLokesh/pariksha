// Phase 7e Task 3 (`E-R1`/`Q2b`): the lock at the limit, the candidate's own
// side. The server half (`apps/api/test/run/lock.test.ts`) proves
// `lockAttempt` actually runs; this file proves `ProctoringLayer` reads
// `EventsResponse.locked` and tells the candidate what happened and what to
// do — announced, focus-trapped, no Escape (`Q2b`), the same contract
// `auto-submit-limit.test.tsx`'s own suite already proves for the
// auto-submit overlay.
//
// **D-R3/D-R4**: this file's own local helpers (`stubDesktop`, `fakeStream`,
// `startStrictAttempt`, `clientFor`, `user`) mirror `auto-submit-limit.
// test.tsx`'s verbatim — the same `camera-loss.test.tsx`/`camera-gate.
// test.tsx` precedent this repo already follows: no shared helper of these
// names exists anywhere else in this package.

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  proctoringRequirements,
  resolveProctoring,
  type ProctoringProfile,
  type ResolvedProctoring,
} from "@pariksha/core";
import { ExamApp, writeRegistrationToken } from "../../src/routes/exam";
import type { AttemptPaper, CandidateQuestion } from "../../src/lib/paper";
import type { LandingPayload, RunClient } from "../../src/lib/run";
import { RESULT_STUB } from "./run-client-stub";

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

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

function paperFixture(proctoring: ResolvedProctoring, lockedAt: number | null = null): AttemptPaper {
  return {
    attemptId: "att_locked01",
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
    lockedAt,
    proctoring,
    violations: 0,
  };
}

const landingFixture: LandingPayload = {
  name: "Aptitude",
  description: null,
  durationMinutes: 45,
  questionCount: 1,
  sections: [{ id: "s1", title: "Section", questionCount: 1, timeLimitMinutes: null }],
  rules: null,
  proctoring: { profile: "off", requirements: [] },
  accessMode: "link_code",
  state: "open",
  opensAt: NOW - DAY,
  closesAt: NOW + DAY,
  latestStartAt: null,
  timezone: "Asia/Kolkata",
  branding: { logo: null, logoAlt: null, primaryColour: null, footerText: null, startMessage: null },
  candidateList: false,
  serverNow: NOW,
};

function clientFor(test: LandingPayload, paper: AttemptPaper): RunClient {
  return {
    landing: () => Promise.resolve(test),
    access: () => Promise.reject(new Error("this test passes no gate")),
    requestEmailCode: () => Promise.reject(new Error("this test sends no code")),
    form: () => Promise.reject(new Error("this test reads no form")),
    register: () => Promise.reject(new Error("this test registers nobody")),
    start: () => Promise.resolve(paper),
    resume: () => Promise.resolve(null),
    ...RESULT_STUB,
    putAnswer: () => Promise.resolve({ outcome: "accepted" as const }),
  };
}

/** No `@testing-library/user-event` in this workspace; the same local
 *  stand-in every other suite here uses. */
const user = {
  async click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.focus();
      fireEvent.click(element);
      await Promise.resolve();
    });
  },
};

/** `camera-gate.test.tsx`'s own helper, reused verbatim: Strict resolves
 *  `desktopOnly: true`, and the device gate decides at mount, so a Strict
 *  attempt cannot start in jsdom without this. */
function stubDesktop(): void {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** A plain object shaped like a `MediaStream` (D-R3) — just enough for the
 *  start gate's `requireCamera` check and for `liveStreamRef` to be truthy. */
function fakeStream(): MediaStream {
  const track = { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(fakeStream()) },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  localStorage.clear();
  sessionStorage.clear();
});

/** Stubs `fetch`: every `/attempt/events` POST answers as though this
 *  batch is the one that reaches `violationLimit` under `lock` — `locked:
 *  true` on the very first violation, matching a paper whose
 *  `violation_limit` is 1 (the brief's own fixture shape). */
function stubIngest(): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ violations: 1, limit: 1, action: "lock", locked: true }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response);
  });
}

async function startStrictAttempt(opts: {
  violationLimit: number;
  violationAction: ResolvedProctoring["violationAction"];
  lockedAt?: number | null;
}): Promise<void> {
  stubDesktop();
  const resolved: ResolvedProctoring = {
    ...resolveProctoring({ profile: "strict" }),
    identityPhoto: false,
    violationLimit: opts.violationLimit,
    violationAction: opts.violationAction,
  };
  const test: LandingPayload = {
    ...landingFixture,
    proctoring: { profile: "strict" as ProctoringProfile, requirements: proctoringRequirements(resolved) },
  };
  writeRegistrationToken("tok_locked01");
  render(<ExamApp client={clientFor(test, paperFixture(resolved, opts.lockedAt ?? null))} />);
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: /Start/ }));
  await screen.findByRole("navigation", { name: /question palette/i });
  // `blocking.test.tsx`'s own `openAttempt` reason: the palette's commit is
  // not the instant `ProctoringLayer`'s effects run, and the window-leave
  // listener this test drives is installed by one of those effects.
  await act(async () => {});
}

// --- the brief's own test ----------------------------------------------------

it("shows a locked overlay naming what happened and what to do", async () => {
  stubIngest();
  await startStrictAttempt({ violationLimit: 1, violationAction: "lock" });

  await act(async () => {
    fireEvent(window, new Event("blur"));
  });
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveAccessibleName(/locked/i);
  expect(within(dialog).getByText(/contact the organiser/i)).toBeVisible();

  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeVisible();
});

// `Q2b`: announced and modal, the same contract every other candidate-facing
// overlay in this phase already carries.
it("is announced as an alertdialog, modal, with the paper marked inert underneath", async () => {
  stubIngest();
  await startStrictAttempt({ violationLimit: 1, violationAction: "lock" });

  await act(async () => {
    fireEvent(window, new Event("blur"));
  });
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(document.querySelector(".exam-runner")).toHaveAttribute("inert");
  expect(document.querySelector(".exam-runner")).toHaveAttribute("aria-hidden", "true");
});

// A warning that never reaches the limit must never show this overlay — the
// surface exists for exactly one condition.
it("never appears for an attempt that is merely warned, not locked", async () => {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/events")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ violations: 1, limit: 5, action: "warn_then_flag" }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response);
  });
  await startStrictAttempt({ violationLimit: 5, violationAction: "warn_then_flag" });

  await act(async () => {
    fireEvent(window, new Event("blur"));
  });
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toMatch(/warning 1 of 5/i);
  expect(screen.queryByText(/test locked/i)).toBeNull();
});

// The negative the brief asks to test explicitly, not only the positive:
// unreachable for a candidate who was never locked — a window-leave that
// never reaches the server at all raises nothing.
it("is unreachable for a candidate whose attempt was never locked", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response),
  );
  await startStrictAttempt({ violationLimit: 5, violationAction: "lock" });

  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByText(/test locked/i)).toBeNull();
});

// Phase 7e Task 3 (`E-R1`): a reload mid-lock must raise the overlay again
// from `AttemptPaper.lockedAt` alone, with no violation batch required —
// unlike auto-submit, a locked attempt is not submitted, so it resumes
// straight back to this component rather than to the finish page. The
// overlay covers the palette the instant this mounts (`lockedAt` is
// already set at `/start`'s own paper here), so this does not reuse
// `startStrictAttempt`'s own "palette is reachable" assertion — that would
// be testing against the very overlay this test exists to prove.
it("raises the overlay again on a reload mid-lock, from lockedAt alone", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response),
  );
  stubDesktop();
  const resolved: ResolvedProctoring = {
    ...resolveProctoring({ profile: "strict" }),
    identityPhoto: false,
    violationLimit: 1,
    violationAction: "lock",
  };
  const test: LandingPayload = {
    ...landingFixture,
    proctoring: { profile: "strict" as ProctoringProfile, requirements: proctoringRequirements(resolved) },
  };
  writeRegistrationToken("tok_locked02");
  render(<ExamApp client={clientFor(test, paperFixture(resolved, NOW - 60_000))} />);
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: /Start/ }));

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveAccessibleName(/locked/i);
});
