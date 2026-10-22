// Phase 7d Task 2 (`P-05`/`Q2a`, `P-06`/`Q11a`): the camera start gate and
// the identity photo.
//
// **D-R1.** The brief's fourth test asks `captureJpeg` to really encode a
// JPEG and measure it — jsdom implements neither `HTMLCanvasElement`'s
// `getContext` nor `toBlob` (confirmed against this workspace's own jsdom
// source: with no `canvas` npm package installed, `getContext` returns
// `null` and `toBlob` never calls its callback at all), so that test cannot
// run here. The real measurement moved to
// `e2e/measurement/camera.spec.ts`, a real Chromium against Chromium's own
// fake camera device, the same move 7c's `T5-R1` made for `D8`'s no-reflow
// claim. What stays here is what jsdom CAN see: that `captureJpeg` asks for
// a 320×240 canvas and requests `image/jpeg`, against a stubbed `toBlob`
// (the fourth test below).
//
// **D-R3.** `navigator.mediaDevices`, `MediaStream` and `MediaStreamTrack`
// are all absent from jsdom — the same absence `fullscreen.test.tsx` and
// `proctoring-failopen.test.tsx` already document for the Fullscreen API.
// `withCamera` below installs `navigator.mediaDevices` with
// `Object.defineProperty`, never `vi.spyOn` (there is no existing getter to
// wrap), and `fakeStream`/`fakeTrack` build plain objects shaped like a
// `MediaStream`/`MediaStreamTrack` rather than constructing real ones —
// jsdom has no `window.MediaStream` constructor to instantiate.
//
// **D-R4.** `withCamera`, `captureUploads`, `startStrictAttempt`,
// `openCandidateStart`, `fakeStream` and `installFakeCanvas` do not exist
// anywhere else in this package — every task in this phase writes its own
// local helpers, and this file's are its own.
//
// **D-R5.** The first test's `queryByRole("radio", { name: /Option A/
// }))).toBeNull()` is paired with the SAME query finding the element in
// the second test, the same positive-control shape
// `device-gate.test.tsx`'s own pair of `it`s already uses: a wrong query
// could not pass the first test for free, because the second proves it
// really does match a rendered radio named "Option A".

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  proctoringRequirements,
  resolveProctoring,
  type ProctoringProfile,
  type ResolvedProctoring,
} from "@pariksha/core";
import { captureJpeg } from "../../src/lib/camera";
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
    attemptId: "att_camera01",
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
    // Resolves rather than rejects, on purpose (`D-R5`): a gate that failed
    // to block would otherwise reach the "error" view instead of the
    // runner, and `queryByRole("radio", ...).toBeNull()` would pass for the
    // wrong reason. Letting `start` succeed makes the first test a real
    // test of the gate.
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

function fakeTrack(): MediaStreamTrack {
  return { kind: "video", stop: vi.fn() } as unknown as MediaStreamTrack;
}

/** A plain object shaped like a `MediaStream` — jsdom has no `MediaStream`
 *  constructor to instantiate for real (D-R3). */
function fakeStream(tracks: MediaStreamTrack[] = [fakeTrack()]): MediaStream {
  return {
    getVideoTracks: () => tracks,
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

interface CameraOptions {
  denied?: boolean;
  absent?: boolean;
  frames?: boolean;
  stream?: MediaStream;
}

/** Installs `navigator.mediaDevices` for the duration of `fn`, then removes
 *  it — `Object.defineProperty`, not `vi.spyOn` (D-R3: there is no existing
 *  property on jsdom's `Navigator` to wrap). */
async function withCamera(opts: CameraOptions, fn: () => Promise<void>): Promise<void> {
  if (opts.absent) {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  } else {
    const stream = opts.stream ?? fakeStream();
    const getUserMedia = opts.denied
      ? () => Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }))
      : () => Promise.resolve(stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  }
  try {
    await fn();
  } finally {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  }
}

interface UploadRecord {
  reason: string;
  bytes: number;
}

/** Stubs `fetch` and records every call to Task 1's snapshot route — the
 *  one this task uploads to (`POST /api/v1/run/attempt/snapshot?reason=
 *  ...`). Anything else (the events route `ProctoringLayer`'s own queue may
 *  flush) answers a harmless 200 rather than failing the test: this file
 *  is testing the start gate, not the event queue. */
function captureUploads(): () => UploadRecord[] {
  const uploads: UploadRecord[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/snapshot")) {
      const reason = new URL(url, "http://localhost").searchParams.get("reason") ?? "";
      const body = init?.body;
      uploads.push({ reason, bytes: body instanceof Blob ? body.size : 0 });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ violations: 0, limit: 5, action: "warn_then_flag" }),
    } as Response);
  });
  return () => uploads;
}

/** Skips registration entirely — the token is written straight to
 *  `sessionStorage`, the same storage `writeRegistrationToken` itself
 *  writes to, so clicking Start goes straight to `client.start()` (`P-05`:
 *  the gate fires there, before an attempt row exists). */
async function openCandidateStart(opts: {
  proctoring: { profile: ProctoringProfile; requirements: string[] };
}): Promise<void> {
  writeRegistrationToken("tok_camera01");
  const resolved = resolveProctoring({ profile: opts.proctoring.profile });
  const test: LandingPayload = { ...landingFixture, proctoring: opts.proctoring };
  render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
  await screen.findByRole("heading", { level: 1 });
}

/** Opens a Strict candidate start and presses Start, reaching the runner —
 *  `identityPhoto` controls whether the resolved paper actually asks for
 *  one, independent of `requireCamera` (`Q11b`'s own distinction).
 *  Returns the render result so a caller that needs to unmount (checking
 *  "Stop the tracks") can. */
async function startStrictAttempt(opts: { identityPhoto: boolean }): Promise<ReturnType<typeof render>> {
  const resolved: ResolvedProctoring = { ...resolveProctoring({ profile: "strict" }), identityPhoto: opts.identityPhoto };
  const test: LandingPayload = {
    ...landingFixture,
    proctoring: { profile: "strict", requirements: proctoringRequirements(resolved) },
  };
  writeRegistrationToken("tok_identity01");
  const view = render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: /Start/ }));
  await screen.findByRole("navigation", { name: /question palette/i });
  return view;
}

/** Stands in for the `canvas` npm package jsdom does not have installed
 *  (D-R1): a working `getContext`/`toBlob` pair so `captureJpeg` can
 *  actually produce a `Blob` in this environment, and spies so a test can
 *  see what was asked of them. `vi.spyOn`, not `Object.defineProperty`:
 *  unlike `mediaDevices`, these methods genuinely exist on
 *  `HTMLCanvasElement.prototype` in jsdom (D-R1's own "Not implemented"
 *  stubs) — a stub to wrap, not an absent property. */
function installFakeCanvas(): { toBlob: ReturnType<typeof vi.fn>; sizeAtContext: () => { width: number; height: number } } {
  let size = { width: 0, height: 0 };
  const fakeCtx = { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  const toBlob = vi.fn(
    (callback: BlobCallback) => {
      callback(new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }));
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    size = { width: this.width, height: this.height };
    return fakeCtx;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob);
  return { toBlob, sizeAtContext: () => size };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the camera start gate (P-05, Q2a)", () => {
  it("refuses to start a Strict attempt when the camera is denied", async () => {
    await withCamera({ denied: true }, async () => {
      await openCandidateStart({ proctoring: { profile: "strict", requirements: ["A working camera…"] } });
      await user.click(screen.getByRole("button", { name: /Start/ }));
      expect(await screen.findByText(/This test needs a working camera/i)).toBeVisible();
      expect(screen.queryByRole("radio", { name: /Option A/ })).toBeNull();
    });
  });

  it("starts without a camera when it is not required", async () => {
    await withCamera({ denied: true }, async () => {
      await openCandidateStart({ proctoring: { profile: "off", requirements: [] } });
      await user.click(screen.getByRole("button", { name: /Start/ }));
      expect(await screen.findByRole("radio", { name: /Option A/ })).toBeVisible();
    });
  });
});

describe("the identity photo (Q11a)", () => {
  it("captures one identity photo before the first question", async () => {
    installFakeCanvas();
    const uploads = captureUploads();
    await withCamera({ frames: true }, async () => {
      await startStrictAttempt({ identityPhoto: true });
      await waitFor(() => {
        expect(uploads()).toContainEqual(expect.objectContaining({ reason: "identity" }));
      });
    });
  });

  it("stops the camera track once the attempt view unmounts", async () => {
    installFakeCanvas();
    captureUploads();
    const track = fakeTrack();
    await withCamera({ stream: fakeStream([track]) }, async () => {
      const view = await startStrictAttempt({ identityPhoto: false });
      expect(track.stop).not.toHaveBeenCalled();
      view.unmount();
      expect(track.stop).toHaveBeenCalledTimes(1);
    });
  });
});

describe("captureJpeg (P-06, Q11a — D-R1)", () => {
  it("asks for a 320×240 canvas and requests image/jpeg", async () => {
    const canvas = installFakeCanvas();
    const blob = await captureJpeg(fakeStream());
    expect(blob).toBeInstanceOf(Blob);
    expect(canvas.sizeAtContext()).toEqual({ width: 320, height: 240 });
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", expect.any(Number));
  });
});
