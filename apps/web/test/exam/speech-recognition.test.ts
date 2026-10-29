import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSpeechRecognitionSupported,
  startSpeechRecognition,
  type NativeSpeechRecognitionInstance,
  type SpeechEventLike,
} from "../../src/lib/speech";

describe("speech recognition (Web Speech API, apps/web/src/lib/speech.ts)", () => {
  const originalSpeechRecognition = window.SpeechRecognition;
  const originalWebkitSpeechRecognition = window.webkitSpeechRecognition;

  afterEach(() => {
    window.SpeechRecognition = originalSpeechRecognition;
    window.webkitSpeechRecognition = originalWebkitSpeechRecognition;
    vi.restoreAllMocks();
  });

  it("reports unsupported when neither SpeechRecognition nor webkitSpeechRecognition exists", () => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it("reports supported when SpeechRecognition exists", () => {
    window.SpeechRecognition = vi.fn() as unknown as new () => NativeSpeechRecognitionInstance;
    delete window.webkitSpeechRecognition;
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it("reports supported when webkitSpeechRecognition exists", () => {
    delete window.SpeechRecognition;
    window.webkitSpeechRecognition = vi.fn() as unknown as new () => NativeSpeechRecognitionInstance;
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it("returns no-op handle and does not throw when speech recognition is absent (AG1 fail-open)", () => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;

    const onSpeech = vi.fn();
    const handle = startSpeechRecognition(onSpeech);
    expect(handle).toBeDefined();
    expect(typeof handle.stop).toBe("function");
    expect(() => handle.stop()).not.toThrow();
    expect(onSpeech).not.toHaveBeenCalled();
  });

  it("instantiates recognition, configures options and starts", () => {
    const mockStart = vi.fn();
    const mockAbort = vi.fn();

    class MockSpeechRecognition implements NativeSpeechRecognitionInstance {
      continuous = false;
      interimResults = true;
      lang = "";
      start = mockStart;
      abort = mockAbort;
      onresult: ((event: SpeechEventLike) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
    }

    window.SpeechRecognition = MockSpeechRecognition;

    const onSpeech = vi.fn();
    const handle = startSpeechRecognition(onSpeech, { lang: "en-US" });

    expect(mockStart).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it("invokes onSpeech callback when final transcript is emitted", () => {
    let capturedInstance: NativeSpeechRecognitionInstance | null = null;

    class MockSpeechRecognition implements NativeSpeechRecognitionInstance {
      continuous = false;
      interimResults = false;
      start = vi.fn();
      abort = vi.fn();
      onresult: ((event: SpeechEventLike) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        capturedInstance = this;
      }
    }

    window.SpeechRecognition = MockSpeechRecognition;

    const onSpeech = vi.fn();
    startSpeechRecognition(onSpeech);

    expect(capturedInstance).not.toBeNull();

    // Simulate final speech transcript result
    const mockEvent: SpeechEventLike = {
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          length: 1,
          0: { transcript: "  hello proctor  " },
        },
      ],
    };

    const instance = capturedInstance as unknown as NativeSpeechRecognitionInstance;
    instance.onresult?.(mockEvent);

    expect(onSpeech).toHaveBeenCalledTimes(1);
    expect(onSpeech).toHaveBeenCalledWith("hello proctor");
  });

  it("handles errors gracefully without throwing (AG1 fail-open)", () => {
    let capturedInstance: NativeSpeechRecognitionInstance | null = null;

    class MockSpeechRecognition implements NativeSpeechRecognitionInstance {
      start = vi.fn();
      abort = vi.fn();
      continuous = false;
      interimResults = false;
      onresult: ((event: SpeechEventLike) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;

      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        capturedInstance = this;
      }
    }

    window.SpeechRecognition = MockSpeechRecognition;

    const onSpeech = vi.fn();
    startSpeechRecognition(onSpeech);

    expect(() => {
      capturedInstance?.onerror?.({ error: "network" });
    }).not.toThrow();
  });
});
