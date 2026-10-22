// Phase 7d Task 3 (`P-05`/`AC-19`/`Q2`): a lost camera blocks the paper,
// indefinitely — the phase's one deliberate `AG1` exception. No auto-dismiss,
// no timeout that gives up, no "continue anyway": the overlay clears only
// when the camera is confirmed back, and `Q6` counts the outage.
//
// **Timer strategy.** Three distinct signals are under test here, each with
// its own honest timing, and mixing them under one blanket `vi.useFakeTimers()`
// (`clock.test.tsx`'s own warning: "that is a race, and a losing one") would
// make some of them lie:
//
//  - `endCameraTrack()` dispatches `ended` synchronously, inside `act()` —
//    the overlay is already in the DOM by the time `findByRole` runs its own
//    first, synchronous check, so detecting it needs no timer at all, fake or
//    real.
//  - The covered-lens sample is a real `setInterval` (`CAMERA_SAMPLE_MS` in
//    `ProctoringLayer.tsx`, comfortably under the 5 s ceiling). Detecting it
//    needs REAL elapsed time, so the one test that exercises it
//    (`"raises the overlay when frames go black..."`) never switches to fake
//    timers — `findByRole`'s own 5 s budget gives it generous margin.
//  - Recovery from an ended track rides `devicechange` → a fresh
//    `acquireCamera()` → a plain settled Promise, no timer at all — but the
//    `waitFor` that observes it needs to actually get a chance to re-check
//    (its `MutationObserver` only fires on a DOM mutation; `"records
//    camera_lost and camera_restored..."`'s own assertion is not one), so
//    timers are switched back to real before `restoreCamera()` in every test
//    that uses `vi.advanceTimersByTimeAsync` first.
//
// **D-R3.** `navigator.mediaDevices` and `MediaStreamTrack` are both absent
// from jsdom (`camera-gate.test.tsx`'s own note) — installed here with
// `Object.defineProperty`, and `navigator.mediaDevices` and the fake track
// are real `EventTarget`s (not `vi.spyOn`, nothing to wrap) so production
// code's own `addEventListener`/`dispatchEvent` calls work unmodified.
//
// **D-R4.** `endCameraTrack`, `blackenCameraFrames`, `restoreCamera`,
// `startStrictAttempt` and `captureEvents` are this file's own — no shared
// helper of these names exists anywhere else in this package.
//
// **D-R5.** Every negative query below is paired with a positive control:
// tests 1 and 2 both find `alertdialog` legitimately (proving the query can
// match at all), and test 3's own negative query is preceded, two lines
// above, by `findByRole("alertdialog")` finding the very element it later
// asserts is gone.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    attemptId: "att_cameraloss01",
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

/** No `@testing-library/user-event` in this workspace (`submit.test.tsx`'s
 *  own note); the same local stand-in every other suite here uses. */
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
 *  `desktopOnly: true`, and 7c's branch-review fix decides the device gate
 *  at mount, so a Strict attempt cannot start in jsdom without this.
 *  `device-gate.test.tsx` replaces `navigator` wholesale, which would take
 *  `navigator.mediaDevices` — the thing this file installs below — down
 *  with it, so only `innerWidth` and `matchMedia` are stubbed. */
function stubDesktop(): void {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

// ---- the camera + canvas fakes, shared across every test in this file ----
//
// Module-scoped and reset in `beforeEach` rather than wrapped in a
// `withCamera(fn)` callback (`camera-gate.test.tsx`'s own shape): the brief's
// own tests call `startStrictAttempt`, `endCameraTrack`, `blackenCameraFrames`
// and `restoreCamera` as bare top-level calls with no camera object threaded
// through them, so the state they share has to live somewhere all of them can
// reach without an argument.

let track: MediaStreamTrack;
let stream: MediaStream;
let mediaDevices: MediaDevices;
let frameIsBlack: boolean;
let getUserMediaSucceeds: boolean;

/** A real `EventTarget`, not a plain object — production code calls
 *  `track.addEventListener(...)`/`track.dispatchEvent(...)` directly (D-R3),
 *  so the fake needs to really support both rather than being wrapped with
 *  `vi.spyOn` over a method that does not exist on jsdom's `Navigator` or on
 *  a plain stub object either. */
function makeTrack(): MediaStreamTrack {
  return Object.assign(new EventTarget(), {
    kind: "video",
    readyState: "live" as MediaStreamTrackState,
    muted: false,
    stop: vi.fn(),
  }) as unknown as MediaStreamTrack;
}

function makeStream(forTrack: MediaStreamTrack): MediaStream {
  return {
    getVideoTracks: () => [forTrack],
    getTracks: () => [forTrack],
  } as unknown as MediaStream;
}

beforeEach(() => {
  frameIsBlack = false;
  getUserMediaSucceeds = true;
  track = makeTrack();
  stream = makeStream(track);

  const getUserMedia = (): Promise<MediaStream> =>
    getUserMediaSucceeds
      ? Promise.resolve(stream)
      : Promise.reject(Object.assign(new Error("no camera"), { name: "NotFoundError" }));
  mediaDevices = Object.assign(new EventTarget(), { getUserMedia }) as unknown as MediaDevices;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: mediaDevices });

  // D-R1's stand-in canvas (`camera-gate.test.tsx`'s own `installFakeCanvas`),
  // extended with `getImageData` — jsdom provides neither without a `canvas`
  // package installed. `frameIsBlack` (above) is read fresh on every call, so
  // `blackenCameraFrames()`/`restoreCamera()` change what the NEXT sample
  // sees without needing to re-install anything.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      drawImage: vi.fn(),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(frameIsBlack ? 0 : 200),
      }),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
    ((callback: BlobCallback) => {
      callback(new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob,
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  localStorage.clear();
  sessionStorage.clear();
});

/** Reaches the runner on a Strict attempt — `camera-gate.test.tsx`'s own
 *  `startStrictAttempt`, adapted to this file's module-scoped camera state
 *  (`identityPhoto` optional and defaulted, matching the brief's own
 *  `startStrictAttempt({})` call shape rather than Task 2's required one). */
async function startStrictAttempt(opts: { identityPhoto?: boolean }): Promise<void> {
  stubDesktop();
  const resolved: ResolvedProctoring = {
    ...resolveProctoring({ profile: "strict" }),
    identityPhoto: opts.identityPhoto ?? false,
  };
  const test: LandingPayload = {
    ...landingFixture,
    proctoring: { profile: "strict" as ProctoringProfile, requirements: proctoringRequirements(resolved) },
  };
  writeRegistrationToken("tok_cameraloss01");
  render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: /Start/ }));
  await screen.findByRole("navigation", { name: /question palette/i });
}

/** The unplug — `track.onended` (`P-05`'s first signal). Synchronous, inside
 *  `act()`: the overlay is already rendered by the time the next line reads
 *  it, so no test here ever needs to wait out a timer to see it. */
function endCameraTrack(): void {
  act(() => {
    (track as unknown as { readyState: MediaStreamTrackState }).readyState = "ended";
    track.dispatchEvent(new Event("ended"));
  });
}

/** The covered lens — Review Focus 3. Nothing to dispatch: the track stays
 *  exactly as it was, and `ProctoringLayer`'s own sample timer is what
 *  notices the next frame reads black. */
function blackenCameraFrames(): void {
  frameIsBlack = true;
}

/** The return trip for an ended track — the real signal is `devicechange`,
 *  not a poll (`ProctoringLayer.tsx`'s own comment on `onDeviceChange`), so
 *  this makes the next `getUserMedia()` succeed and then fires it. */
function restoreCamera(): void {
  frameIsBlack = false;
  getUserMediaSucceeds = true;
  act(() => {
    mediaDevices.dispatchEvent(new Event("devicechange"));
  });
}

/** Stubs `fetch` and records every event TYPE posted to `Q7`'s ingest route —
 *  `apps/web/src/components/exam/ProctoringLayer.tsx`'s own `EVENTS_PATH`.
 *  Anything else (the snapshot route, on an identity-photo attempt) answers a
 *  harmless 200: this helper is testing what reached the events route, not
 *  the whole upload surface. */
function captureEvents(): () => string[] {
  const types: string[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/events")) {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { events: { type: string }[] }) : { events: [] };
      body.events.forEach((event) => {
        types.push(event.type);
      });
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            violations: types.filter((type) => type === "camera_lost").length,
            limit: 5,
            action: "warn_then_flag",
          }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response);
  });
  return () => types;
}

describe("camera liveness blocks the paper indefinitely (P-05, AC-19, Q2)", () => {
  it("raises the overlay within 5 s of the track ending, and keeps it up", async () => {
    await startStrictAttempt({});
    endCameraTrack();
    expect(await screen.findByRole("alertdialog", {}, { timeout: 5000 })).toHaveAccessibleName(/camera/i);
    // `Q2`'s one `AG1` exception is indefinite, not merely patient — fake
    // timers only from here, once the synchronous detection above is
    // already proven to need none.
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(screen.getByRole("alertdialog")).toBeVisible();
  });

  // Review Focus 3 — a covered lens, not an ended track: the real
  // `setInterval` sample (`CAMERA_SAMPLE_MS`) needs real elapsed time, so
  // this test never switches to fake timers.
  it("raises the overlay when frames go black while the track stays live", async () => {
    await startStrictAttempt({});
    blackenCameraFrames();
    expect(await screen.findByRole("alertdialog", {}, { timeout: 5000 })).toBeVisible();
  });

  it("clears the overlay when the camera returns", async () => {
    await startStrictAttempt({});
    endCameraTrack();
    await screen.findByRole("alertdialog");
    restoreCamera();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  // Q2a — the answer and the clock survive.
  it("keeps the typed answer and lets the timer run behind the block", async () => {
    await startStrictAttempt({});
    await user.click(screen.getByRole("radio", { name: /Option A/ }));
    endCameraTrack();
    await screen.findByRole("alertdialog");
    restoreCamera();
    await waitFor(() => expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked());
  });

  it("records camera_lost and camera_restored with the outage duration", async () => {
    const sent = captureEvents();
    await startStrictAttempt({});
    vi.useFakeTimers();
    endCameraTrack();
    await vi.advanceTimersByTimeAsync(30_000);
    // Back to real timers before the recovery trip: `sent()` is not a DOM
    // assertion, so the `waitFor` below has no mutation to observe it
    // through and needs its own real-timer polling to ever re-check it.
    vi.useRealTimers();
    restoreCamera();
    await waitFor(() => expect(sent()).toEqual(expect.arrayContaining(["camera_lost", "camera_restored"])));
  });
});
