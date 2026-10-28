import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  proctoringRequirements,
  resolveProctoring,
  type ResolvedProctoring,
} from "@pariksha/core";
import { ExamApp, requiresMicrophone, writeRegistrationToken } from "../../src/routes/exam";
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
    attemptId: "att_mic01",
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

function clientFor(test: LandingPayload, paper: AttemptPaper, resumePaper: AttemptPaper | null = null): RunClient {
  return {
    landing: () => Promise.resolve(test),
    access: () => Promise.reject(new Error("no access")),
    requestEmailCode: () => Promise.reject(new Error("no code")),
    form: () => Promise.reject(new Error("no form")),
    register: () => Promise.reject(new Error("no register")),
    start: () => Promise.resolve(paper),
    resume: () => Promise.resolve(resumePaper),
    ...RESULT_STUB,
    putAnswer: () => Promise.resolve({ outcome: "accepted" as const }),
  };
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

function stubDesktop(): void {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function fakeTrack(kind: "video" | "audio"): MediaStreamTrack {
  return { kind, stop: vi.fn(), enabled: true } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[]): MediaStream {
  return {
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

class FakeAudioContext {
  state = "running";
  createMediaStreamSource = vi.fn().mockReturnValue({
    connect: vi.fn(),
  });
  createAnalyser = vi.fn().mockReturnValue({
    fftSize: 256,
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn((array: Uint8Array) => {
      array.fill(128); // 50%
    }),
  });
  close = vi.fn().mockResolvedValue(undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("Candidate Microphone Proctoring Gate & Device Check (Task 4, #209)", () => {
  describe("1. requiresMicrophone helper", () => {
    it("returns true when proctoring requirements contain microphone text", () => {
      const resolved = resolveProctoring({ overrides: { require_microphone: true } });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "off", requirements },
      };
      expect(requiresMicrophone(test)).toBe(true);
    });

    it("returns false when proctoring requirements do not mention microphone", () => {
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "off", requirements: ["A working camera is required."] },
      };
      expect(requiresMicrophone(test)).toBe(false);
    });
  });

  describe("2. Joint Start Gate Media Acquisition", () => {
    it("requests both video and audio when test requires camera and microphone", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        profile: "strict",
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "strict", requirements },
      };

      const gum = vi.fn().mockImplementation((constraints: MediaStreamConstraints) => {
        const tracks: MediaStreamTrack[] = [];
        if (constraints.video) tracks.push(fakeTrack("video"));
        if (constraints.audio) tracks.push(fakeTrack("audio"));
        return Promise.resolve(fakeStream(tracks));
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      writeRegistrationToken("tok_start01");
      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });
      await user.click(await screen.findByRole("button", { name: /Start/ }));

      await screen.findByRole("navigation", { name: /question palette/i });
      expect(gum).toHaveBeenCalledWith({ video: true, audio: true });
    });
  });

  describe("3. Fail-open audio start (AG1)", () => {
    it("starts the exam anyway when microphone is denied on a test requiring microphone", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        profile: "standard",
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "standard", requirements },
      };

      const gum = vi.fn().mockRejectedValue(
        Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
      );
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      writeRegistrationToken("tok_failopen01");
      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });
      await user.click(await screen.findByRole("button", { name: /Start/ }));

      // Exam enters runner despite microphone denial
      expect(await screen.findByRole("navigation", { name: /question palette/i })).toBeVisible();
      expect(screen.queryByText(/This test needs a working camera/i)).toBeNull();
    });

    it("starts the exam with video only when audio fails on a test requiring both camera and mic (AG1)", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        profile: "strict",
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "strict", requirements },
      };

      const videoTrack = fakeTrack("video");
      const gum = vi.fn().mockImplementation((constraints: MediaStreamConstraints) => {
        if (constraints.video && constraints.audio) {
          return Promise.reject(Object.assign(new Error("Audio device not found"), { name: "NotFoundError" }));
        }
        if (constraints.video) {
          return Promise.resolve(fakeStream([videoTrack]));
        }
        return Promise.reject(new Error("Unexpected call"));
      });
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      writeRegistrationToken("tok_failopen02");
      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });
      await user.click(await screen.findByRole("button", { name: /Start/ }));

      // Candidate reaches exam paper successfully
      expect(await screen.findByRole("navigation", { name: /question palette/i })).toBeVisible();
    });
  });

  describe("4. Review Focus 5: Attempt Resume (boot)", () => {
    it("resumes attempt without setting cameraUnavailable when microphone fails", async () => {
      const resolved = resolveProctoring({
        profile: "standard",
        overrides: { require_microphone: true },
      });
      const resumedPaper = paperFixture(resolved);

      const gum = vi.fn().mockRejectedValue(
        Object.assign(new Error("Microphone unavailable"), { name: "NotAllowedError" }),
      );
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      render(<ExamApp client={clientFor(landingFixture, resumedPaper, resumedPaper)} />);

      // Resumes to runner
      expect(await screen.findByRole("navigation", { name: /question palette/i })).toBeVisible();
      // Lost camera overlay is NOT shown
      expect(screen.queryByText(/Camera required|Lost connection to camera/i)).toBeNull();
    });
  });

  describe("5. Interactive Device Check", () => {
    beforeEach(() => {
      vi.stubGlobal("AudioContext", FakeAudioContext);
    });

    it("renders a responsive volume/VU indicator when requiresMicrophone is true", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "off", requirements },
      };

      const audioTrack = fakeTrack("audio");
      const gum = vi.fn().mockResolvedValue(fakeStream([audioTrack]));
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });

      const checkBtn = screen.getByRole("button", { name: /check my device/i });
      await user.click(checkBtn);

      // Renders VU meter
      const meter = await screen.findByRole("meter", { name: /microphone/i });
      expect(meter).toBeInTheDocument();
      expect(meter).toHaveAttribute("value", "50");
    });

    it("renders camera preview and VU meter when both are required", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        profile: "strict",
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "strict", requirements },
      };

      const videoTrack = fakeTrack("video");
      const audioTrack = fakeTrack("audio");
      const gum = vi.fn().mockResolvedValue(fakeStream([videoTrack, audioTrack]));
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });

      await user.click(screen.getByRole("button", { name: /check my device/i }));

      expect(await screen.findByTestId("camera-preview")).toBeInTheDocument();
      expect(await screen.findByRole("meter", { name: /microphone/i })).toBeInTheDocument();
    });

    it("shows informational notice when microphone is denied without disabling Start", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "off", requirements },
      };

      const gum = vi.fn().mockRejectedValue(
        Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }),
      );
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });

      await user.click(screen.getByRole("button", { name: /check my device/i }));

      expect(
        await screen.findByText("Microphone not detected. You may still take the test."),
      ).toBeVisible();

      // Start remains enabled (AG1)
      expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
    });

    it("stops preview tracks cleanly when dismissed", async () => {
      stubDesktop();
      const resolved = resolveProctoring({
        profile: "strict",
        overrides: { require_microphone: true },
      });
      const requirements = proctoringRequirements(resolved);
      const test: LandingPayload = {
        ...landingFixture,
        proctoring: { profile: "strict", requirements },
      };

      const videoTrack = fakeTrack("video");
      const audioTrack = fakeTrack("audio");
      const gum = vi.fn().mockResolvedValue(fakeStream([videoTrack, audioTrack]));
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: gum },
      });

      render(<ExamApp client={clientFor(test, paperFixture(resolved))} />);
      await screen.findByRole("heading", { level: 1 });

      await user.click(screen.getByRole("button", { name: /check my device/i }));
      expect(await screen.findByTestId("camera-preview")).toBeInTheDocument();

      const dismissBtn = screen.getByRole("button", { name: /dismiss/i });
      await user.click(dismissBtn);

      expect(videoTrack.stop).toHaveBeenCalled();
      expect(audioTrack.stop).toHaveBeenCalled();
      expect(screen.queryByTestId("camera-preview")).toBeNull();
    });
  });
});
