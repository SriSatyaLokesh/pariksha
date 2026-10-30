import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import { ProctoringLayer } from "../../src/components/exam/ProctoringLayer";
import type { MonitorNoiseOptions, NoiseMonitorHandle } from "../../src/lib/noise";

let capturedOptions: MonitorNoiseOptions | null = null;
const stopSpy = vi.fn();
const monitorNoiseSpy = vi.fn((_stream: MediaStream, opts: MonitorNoiseOptions): NoiseMonitorHandle => {
  capturedOptions = opts;
  return { stop: stopSpy };
});

vi.mock("../../src/lib/noise", () => ({
  monitorNoise: (stream: MediaStream, opts: MonitorNoiseOptions) => monitorNoiseSpy(stream, opts),
}));

let capturedSpeechCallback: ((transcript: string) => void) | null = null;
const speechStopSpy = vi.fn();
const startSpeechRecognitionSpy = vi.fn((onSpeech: (transcript: string) => void) => {
  capturedSpeechCallback = onSpeech;
  return { stop: speechStopSpy };
});

vi.mock("../../src/lib/speech", () => ({
  startSpeechRecognition: (onSpeech: (transcript: string) => void) => startSpeechRecognitionSpy(onSpeech),
  isSpeechRecognitionSupported: () => true,
}));

const pushSpy = vi.fn();
const pushImmediateSpy = vi.fn().mockResolvedValue(undefined);
const queueStopSpy = vi.fn();

vi.mock("../../src/lib/proctoring-queue", () => ({
  createProctoringQueue: vi.fn(() => ({
    push: pushSpy,
    pushImmediate: pushImmediateSpy,
    buffered: vi.fn().mockReturnValue(0),
    stop: queueStopSpy,
  })),
}));

function makeAudioTrack(): MediaStreamTrack {
  return {
    kind: "audio",
    id: "audio-track-1",
    enabled: true,
    readyState: "live",
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[] = [makeAudioTrack()]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

describe("ProctoringLayer audio noise monitoring (Phase 8.5 Task 5)", () => {
  beforeEach(() => {
    capturedOptions = null;
    capturedSpeechCallback = null;
    stopSpy.mockClear();
    speechStopSpy.mockClear();
    monitorNoiseSpy.mockClear();
    startSpeechRecognitionSpy.mockClear();
    pushSpy.mockClear();
    pushImmediateSpy.mockClear();
    queueStopSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("mounts monitorNoise when requireMicrophone is true and stream contains audio track", () => {
    const stream = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream}
      />,
    );

    expect(monitorNoiseSpy).toHaveBeenCalledTimes(1);
    expect(monitorNoiseSpy).toHaveBeenCalledWith(
      stream,
      expect.objectContaining({
        thresholdDb: -40,
        windowMs: 200,
        onCrossing: expect.any(Function),
      }),
    );
  });

  it("mounts monitorNoise when audio track is present on cameraStream prop", () => {
    const stream = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        cameraStream={stream}
      />,
    );

    expect(monitorNoiseSpy).toHaveBeenCalledTimes(1);
  });

  it("does not mount monitorNoise when requireMicrophone is false", () => {
    const stream = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: false,
    };

    render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream}
      />,
    );

    expect(monitorNoiseSpy).not.toHaveBeenCalled();
  });

  it("does not mount monitorNoise when stream has no audio tracks", () => {
    const stream = makeStream([]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream}
      />,
    );

    expect(monitorNoiseSpy).not.toHaveBeenCalled();
  });

  it("emits noise_above_threshold event into queue when crossing is observed", () => {
    const stream = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream}
      />,
    );

    expect(capturedOptions).not.toBeNull();
    capturedOptions!.onCrossing(350);

    expect(pushSpy).toHaveBeenCalledWith("noise_above_threshold", { durationMs: 350 });
  });

  it("cleanly stops monitorNoise when component unmounts", () => {
    const stream = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    const { unmount } = render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream}
      />,
    );

    expect(stopSpy).not.toHaveBeenCalled();
    unmount();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("stops previous monitorNoise and restarts when stream changes", () => {
    const stream1 = makeStream([makeAudioTrack()]);
    const stream2 = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    const { rerender } = render(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream1}
      />,
    );

    expect(monitorNoiseSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).not.toHaveBeenCalled();

    rerender(
      <ProctoringLayer
        attemptId="att_test_mic"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream2}
      />,
    );

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(monitorNoiseSpy).toHaveBeenCalledTimes(2);
    expect(monitorNoiseSpy).toHaveBeenLastCalledWith(stream2, expect.any(Object));
  });

  it("starts speech recognition when requireMicrophone is true and pushes speech_detected event on speech", () => {
    const stream = makeStream([makeAudioTrack()]);
    const proctoring: ResolvedProctoring = {
      ...resolveProctoring({ profile: "off" }),
      requireMicrophone: true,
    };

    const { unmount } = render(
      <ProctoringLayer
        attemptId="att_test_speech"
        proctoring={proctoring}
        initialViolations={0}
        stream={stream}
      />,
    );

    expect(startSpeechRecognitionSpy).toHaveBeenCalledTimes(1);
    expect(capturedSpeechCallback).toBeTypeOf("function");

    // Simulate speech detection
    capturedSpeechCallback?.("talking to someone");
    expect(pushSpy).toHaveBeenCalledWith("speech_detected", {
      transcript: "talking to someone",
      source: "native",
    });

    unmount();
    expect(speechStopSpy).toHaveBeenCalledTimes(1);
  });
});
