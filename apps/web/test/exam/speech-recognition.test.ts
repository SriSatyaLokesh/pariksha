import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSpeechRecognitionSupported,
  startSpeechRecognition,
} from "../../src/lib/speech";

describe("speech recognition (Web Speech API, apps/web/src/lib/speech.ts)", () => {
  const originalSpeechRecognition = (window as any).SpeechRecognition;
  const originalWebkitSpeechRecognition = (window as any).webkitSpeechRecognition;

  afterEach(() => {
    (window as any).SpeechRecognition = originalSpeechRecognition;
    (window as any).webkitSpeechRecognition = originalWebkitSpeechRecognition;
    vi.restoreAllMocks();
  });

  it("reports unsupported when neither SpeechRecognition nor webkitSpeechRecognition exists", () => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it("reports supported when SpeechRecognition exists", () => {
    (window as any).SpeechRecognition = vi.fn();
    delete (window as any).webkitSpeechRecognition;
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it("reports supported when webkitSpeechRecognition exists", () => {
    delete (window as any).SpeechRecognition;
    (window as any).webkitSpeechRecognition = vi.fn();
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it("returns no-op handle and does not throw when speech recognition is absent (AG1 fail-open)", () => {
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;

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

    class MockSpeechRecognition {
      continuous = false;
      interimResults = true;
      lang = "";
      start = mockStart;
      abort = mockAbort;
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;
    }

    (window as any).SpeechRecognition = MockSpeechRecognition;

    const onSpeech = vi.fn();
    const handle = startSpeechRecognition(onSpeech, { lang: "en-US" });

    expect(mockStart).toHaveBeenCalledTimes(1);

    handle.stop();
    expect(mockAbort).toHaveBeenCalledTimes(1);
  });

  it("invokes onSpeech callback when final transcript is emitted", () => {
    let capturedInstance: any = null;

    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      start = vi.fn();
      abort = vi.fn();
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;

      constructor() {
        capturedInstance = this;
      }
    }

    (window as any).SpeechRecognition = MockSpeechRecognition;

    const onSpeech = vi.fn();
    startSpeechRecognition(onSpeech);

    expect(capturedInstance).not.toBeNull();

    // Simulate final speech transcript result
    const mockEvent = {
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          0: { transcript: "  hello proctor  " },
        },
      ],
    };

    capturedInstance.onresult(mockEvent);

    expect(onSpeech).toHaveBeenCalledTimes(1);
    expect(onSpeech).toHaveBeenCalledWith("hello proctor");
  });

  it("handles errors gracefully without throwing (AG1 fail-open)", () => {
    let capturedInstance: any = null;

    class MockSpeechRecognition {
      start = vi.fn();
      abort = vi.fn();
      onresult: ((event: any) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: any) => void) | null = null;

      constructor() {
        capturedInstance = this;
      }
    }

    (window as any).SpeechRecognition = MockSpeechRecognition;

    const onSpeech = vi.fn();
    startSpeechRecognition(onSpeech);

    expect(() => {
      capturedInstance.onerror({ error: "network" });
    }).not.toThrow();
  });
});
