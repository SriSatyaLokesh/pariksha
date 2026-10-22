// Phase 7d Task 4 (`AC-20`/`Q11b`/`Q4d`): the capture schedule —
// `ProctoringLayer`'s own interval timer for `snapshotIntervalSeconds`, and
// the one extra snapshot each violation takes.
//
// **D-R10 — Review Focus 4.** The hidden-tab test is the whole reason this
// file exists: a tab throttled for twenty minutes stops its timers firing
// while the wall clock keeps advancing, and a schedule that counts TICKS
// instead of comparing `Date.now()` under-counts an honest candidate who
// switched windows once. `clock.test.tsx:10-18` solved exactly this split —
// `Date` faked through `vi.useFakeTimers`, `performance.now` stubbed by
// hand, so the two clocks can be told apart — and `hideTabFor` below is
// that file's own technique, not a second one: `vi.setSystemTime` moves
// `Date` forward without pumping a single timer (`clock.test.tsx`'s own
// `"moving the system clock forward..."` test uses the identical call),
// which is what "the tab is throttled" means for a fake-timer test. This
// file does not touch `performance` at all — nothing here reads it.
//
// **D-R4.** `captureUploads`, `captureEvents`, `failUploads`,
// `startStrictAttempt` and `hideTabFor` are this file's own local helpers —
// adapted from `camera-gate.test.tsx`'s (`withCamera`, `stubDesktop`,
// `installFakeCanvas`, `fakeStream`) rather than reusing them directly,
// since those run under REAL timers and this file needs fake ones for
// `vi.advanceTimersByTimeAsync` to simulate a 60-minute attempt in no real
// time at all.
//
// **D-R5.** The zero-interval test (`Q11b`) is paired with the first
// test's own positive control: the very same `captureUploads`/
// `startStrictAttempt` harness records 55-65 uploads when the interval is
// on, so a reason the zero-interval assertion could pass "for free" (a
// harness that never records anything) is ruled out by the test before it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  proctoringRequirements,
  resolveProctoring,
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
    attemptId: "att_snapshot01",
    sections: [{ id: "s1", title: "Section", instructions: null, timeLimitMinutes: null, questions: [question] }],
    responses: {},
    clientSeq: 0,
    navigation: "free",
    maxIndex: 0,
    remainingMs: 90 * 60_000,
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
  durationMinutes: 90,
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

/** A real `EventTarget`, not a plain object (`camera-loss.test.tsx`'s own
 *  `D-R3`) — production code calls `track.addEventListener` directly. */
function fakeTrack(): MediaStreamTrack {
  return Object.assign(new EventTarget(), { kind: "video", stop: vi.fn() }) as unknown as MediaStreamTrack;
}

function fakeStream(): MediaStream {
  const track = fakeTrack();
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

/** `camera-gate.test.tsx`'s own `stubDesktop` — Strict resolves
 *  `desktopOnly: true`, and the device gate decides at mount, so a Strict
 *  attempt cannot start in jsdom without this. Only `innerWidth` and
 *  `matchMedia` are stubbed, never `navigator` wholesale — that would take
 *  `navigator.mediaDevices` down with it. */
function stubDesktop(): void {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** Installs `navigator.mediaDevices` for the whole file — every test here
 *  needs a working camera, unlike `camera-gate.test.tsx`'s per-call
 *  `withCamera`, so this is a plain `beforeEach`/`afterEach` pair instead. */
function installCamera(): void {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve(fakeStream()) },
  });
}

/** `camera-gate.test.tsx`'s own `installFakeCanvas`, trimmed to what this
 *  file needs: jsdom has no `canvas` package, so `getContext`/`toBlob` are
 *  stubbed by hand (`D-R1`) rather than left to return `null`/never call
 *  back, which would make every capture here silently produce nothing. */
function installFakeCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(((callback: BlobCallback) => {
    callback(new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }));
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob);
}

interface UploadRecord {
  reason: string;
}

/** Stubs `fetch` and records every call to Task 1's snapshot route — the
 *  positive half of `D-R5`'s pair: a non-zero interval must show up here
 *  before the zero-interval test's `toHaveLength(0)` means anything. The
 *  events route (`ProctoringLayer`'s own queue flush) answers a harmless
 *  200 so it never fails a test that is not about it. */
function captureUploads(): () => UploadRecord[] {
  const uploads: UploadRecord[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/snapshot")) {
      const reason = new URL(url, "http://localhost").searchParams.get("reason") ?? "";
      uploads.push({ reason });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ stored: true }) } as Response);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ violations: 0, limit: 5, action: "warn_then_flag" }),
    } as Response);
  });
  return () => uploads;
}

/** `Q4d`'s own scenario — every snapshot upload 500s, and every event TYPE
 *  posted to the events route lands here for `captureEvents()` to read.
 *  One `fetch` stub doing both jobs (only one can be installed at a time),
 *  split into two calls to match the brief's own shape: `failUploads()`
 *  installs it, `captureEvents()` hands back the accessor. */
let failedAttemptEventTypes: string[] = [];
function failUploads(): void {
  failedAttemptEventTypes = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/attempt/snapshot")) {
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as Response);
    }
    if (url.includes("/attempt/events")) {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { events: { type: string }[] }) : { events: [] };
      body.events.forEach((event) => {
        failedAttemptEventTypes.push(event.type);
      });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ violations: 0, limit: 5, action: "warn_then_flag" }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
  });
}

function captureEvents(): () => string[] {
  return () => failedAttemptEventTypes;
}

const user = {
  async click(element: HTMLElement): Promise<void> {
    await act(async () => {
      element.focus();
      fireEvent.click(element);
      await vi.advanceTimersByTimeAsync(0);
    });
  },
};

/** Reaches the runner on a Strict attempt whose `snapshotIntervalSeconds`
 *  and `identityPhoto` the caller controls (`Q11b`'s own distinction
 *  between the two). Driven with `act`+`vi.advanceTimersByTimeAsync(0)`
 *  rather than `findBy*`/`waitFor` throughout (`clock.test.tsx`'s own
 *  `settle()` note: under fake timers, `waitFor`'s internal polling is
 *  also fake and a real race) — every step here is a settled promise
 *  chain (`client.resume`/`client.landing`/`client.start` all resolve
 *  immediately), never a real timer, so flushing microtasks is enough. */
async function startStrictAttempt(opts: {
  snapshotIntervalSeconds: number;
  identityPhoto?: boolean;
}): Promise<void> {
  stubDesktop();
  const resolved: ResolvedProctoring = {
    ...resolveProctoring({ profile: "strict" }),
    snapshotIntervalSeconds: opts.snapshotIntervalSeconds,
    identityPhoto: opts.identityPhoto ?? false,
  };
  const test: LandingPayload = {
    ...landingFixture,
    proctoring: { profile: "strict", requirements: proctoringRequirements(resolved) },
  };
  writeRegistrationToken("tok_snapshot01");
  render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const startButton = screen.getByRole("button", { name: /Start/ });
  await user.click(startButton);
  expect(screen.getByRole("navigation", { name: /question palette/i })).toBeInTheDocument();
}

/** Review Focus 4 (`D-R10`): moves `Date` forward by `ms` WITHOUT pumping
 *  a single timer — `clock.test.tsx`'s own `vi.setSystemTime` call, the
 *  one tool in this suite that can move the wall clock independently of
 *  the fake timer queue. A hidden tab's `setInterval` genuinely stops
 *  firing while backgrounded; this is that, not an approximation of it. */
async function hideTabFor(ms: number): Promise<void> {
  await act(async () => {
    vi.setSystemTime(Date.now() + ms);
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  installCamera();
  installFakeCanvas();
  vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  localStorage.clear();
  sessionStorage.clear();
});

describe("the capture schedule (AC-20)", () => {
  it("stores 55-65 interval snapshots across a 60-minute attempt", async () => {
    const uploads = captureUploads();
    await startStrictAttempt({ snapshotIntervalSeconds: 60 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    const intervals = uploads().filter((u) => u.reason === "interval");
    expect(intervals.length).toBeGreaterThanOrEqual(55);
    expect(intervals.length).toBeLessThanOrEqual(65);
  });

  // Review Focus 4 — a throttled hidden tab must not under-count.
  it("keeps the count inside the window when the tab is hidden for twenty minutes", async () => {
    const uploads = captureUploads();
    await startStrictAttempt({ snapshotIntervalSeconds: 60 });
    await hideTabFor(20 * 60 * 1000); // timers throttled, wall clock advances
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
    });
    expect(uploads().filter((u) => u.reason === "interval").length).toBeGreaterThanOrEqual(55);
  });

  // Q11b — off means no timer.
  it("takes no snapshot at all when the interval is 0", async () => {
    const uploads = captureUploads();
    await startStrictAttempt({ snapshotIntervalSeconds: 0, identityPhoto: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    });
    expect(uploads()).toHaveLength(0);
  });

  it("takes one extra snapshot per violation", async () => {
    const uploads = captureUploads();
    await startStrictAttempt({ snapshotIntervalSeconds: 60 });
    await act(async () => {
      fireEvent(window, new Event("blur"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(uploads().filter((u) => u.reason === "violation")).toHaveLength(1);
  });

  // Q4d — a failing upload is silent.
  it("records snapshot_failed and leaves the paper answerable when the upload 500s", async () => {
    failUploads();
    const sent = captureEvents();
    await startStrictAttempt({ snapshotIntervalSeconds: 60 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(sent()).toContain("snapshot_failed");
    await user.click(screen.getByRole("radio", { name: /Option A/ }));
    expect(screen.getByRole("radio", { name: /Option A/ })).toBeChecked();
  });
});
