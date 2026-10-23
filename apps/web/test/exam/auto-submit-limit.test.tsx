// Phase 7e Task 2 (`AC-21`): auto-submit at the limit, the candidate's own
// side. The server half (`apps/api/test/run/auto-submit.test.ts`) proves
// `submitAttempt` actually runs; this file proves `ProctoringLayer` reads
// `EventsResponse.submitted` and tells the candidate what happened, rather
// than leaving the paper to just stop answering with no explanation.
//
// **D-R3.** `navigator.mediaDevices`/`MediaStream` are absent from jsdom —
// `camera-gate.test.tsx`'s own note, same fix here: a plain object shaped
// like a `MediaStream`, installed with `Object.defineProperty`.
//
// **D-R4.** `stubDesktop`, `fakeStream`, `startStrictAttempt`, `clientFor`
// and `captureEvents` are this file's own local helpers — the same
// `camera-loss.test.tsx`/`camera-gate.test.tsx` precedent: no shared helper
// of these names exists anywhere else in this package.

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

function paperFixture(proctoring: ResolvedProctoring): AttemptPaper {
  return {
    attemptId: "att_autosubmit01",
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
 *  start gate's `requireCamera` check and for `liveStreamRef` to be truthy,
 *  so the window-leave violation's own snapshot attempt has a stream to
 *  read (and fails closed, harmlessly, with no canvas in jsdom). */
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
 *  batch is the one that reaches `violationLimit` under `auto_submit` —
 *  `submitted: true` on the very first violation, matching a paper whose
 *  `violation_limit` is 1 (the brief's own fixture shape). The snapshot
 *  route (the violation's own capture attempt, which a camera-less jsdom
 *  frame fails closed) answers a harmless 200: this file is testing the
 *  ingest response, not the upload surface. */
function stubIngest(): void {
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/events")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ violations: 1, limit: 1, action: "auto_submit", submitted: true }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response);
  });
}

async function startStrictAttempt(opts: {
  violationLimit: number;
  violationAction: ResolvedProctoring["violationAction"];
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
  writeRegistrationToken("tok_autosubmit01");
  render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: /Start/ }));
  await screen.findByRole("navigation", { name: /question palette/i });
  // `blocking.test.tsx`'s own `openAttempt` reason: the palette's commit is
  // not the instant `ProctoringLayer`'s effects run, and the window-leave
  // listener this test drives is installed by one of those effects.
  await act(async () => {});
}

it("takes the candidate to the receipt, saying why", async () => {
  stubIngest();
  await startStrictAttempt({ violationLimit: 1, violationAction: "auto_submit" });

  await act(async () => {
    fireEvent(window, new Event("blur"));
  });
  await act(async () => {
    fireEvent(window, new Event("focus"));
  });

  expect(await screen.findByText(/submitted because the warning limit was reached/i)).toBeVisible();
});

// A warning that never reaches the limit must never show this terminal
// message — the surface exists for exactly one condition, not for every
// window-leave violation.
it("never appears for an attempt that is merely warned, not submitted", async () => {
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
  expect(screen.queryByText(/submitted because the warning limit was reached/i)).toBeNull();
});
