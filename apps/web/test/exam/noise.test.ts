import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monitorNoise } from "../../src/lib/noise";

// Test doubles for Web Audio API & MediaStream (absent in jsdom)
class FakeAudioWorklet {
  addModule = vi.fn().mockResolvedValue(undefined);
}

class FakeMessagePort extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;

  postMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

class FakeAudioWorkletNode {
  port = new FakeMessagePort();
  disconnect = vi.fn();
  context: unknown;
  name: string;
  options?: { processorOptions?: { windowMs?: number } } | undefined;

  constructor(
    context: unknown,
    name: string,
    options?: { processorOptions?: { windowMs?: number } } | undefined,
  ) {
    this.context = context;
    this.name = name;
    this.options = options;
    createdWorkletNodes.push(this);
  }
}

class FakeSourceNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeAudioContext {
  audioWorklet: FakeAudioWorklet | null = new FakeAudioWorklet();
  createMediaStreamSource = vi.fn(() => new FakeSourceNode());
  close = vi.fn().mockResolvedValue(undefined);

  constructor() {
    createdContexts.push(this);
  }
}

let createdContexts: FakeAudioContext[] = [];
let createdWorkletNodes: FakeAudioWorkletNode[] = [];
let originalAudioContext: unknown;
let originalAudioWorkletNode: unknown;

function makeAudioTrack(): MediaStreamTrack {
  return Object.assign(new EventTarget(), {
    kind: "audio",
    readyState: "live" as MediaStreamTrackState,
    stop: vi.fn(),
  }) as unknown as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[] = [makeAudioTrack()]): MediaStream {
  return {
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("monitorNoise (apps/web/src/lib/noise.ts)", () => {
  beforeEach(() => {
    createdContexts = [];
    createdWorkletNodes = [];
    vi.useFakeTimers();

    originalAudioContext = (window as unknown as { AudioContext?: unknown }).AudioContext;
    originalAudioWorkletNode = (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;

    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: FakeAudioContext,
    });
    Object.defineProperty(window, "AudioWorkletNode", {
      configurable: true,
      writable: true,
      value: FakeAudioWorkletNode,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: originalAudioContext,
    });
    Object.defineProperty(window, "AudioWorkletNode", {
      configurable: true,
      writable: true,
      value: originalAudioWorkletNode,
    });
  });

  it("1. emits once per crossing on falling edge with duration", async () => {
    const onCrossing = vi.fn();
    const track = makeAudioTrack();
    const stream = makeStream([track]);

    vi.setSystemTime(1000);
    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing,
    });
    expect(handle).not.toBeNull();
    await tick();

    expect(createdWorkletNodes).toHaveLength(1);
    const node = createdWorkletNodes[0]!;

    // Quiet noise below threshold -> no crossing
    node.port.postMessage({ level: -45 });
    expect(onCrossing).not.toHaveBeenCalled();

    // Level rises above threshold at t = 1000
    node.port.postMessage({ level: -25 });
    expect(onCrossing).not.toHaveBeenCalled();

    // Level stays above threshold at t = 1200
    vi.setSystemTime(1200);
    node.port.postMessage({ level: -20 });
    expect(onCrossing).not.toHaveBeenCalled();

    // Level drops below threshold at t = 1500 -> falling edge!
    vi.setSystemTime(1500);
    node.port.postMessage({ level: -35 });
    expect(onCrossing).toHaveBeenCalledTimes(1);
    expect(onCrossing).toHaveBeenCalledWith(500);

    // Level stays below threshold at t = 1700 -> no duplicate call
    vi.setSystemTime(1700);
    node.port.postMessage({ level: -50 });
    expect(onCrossing).toHaveBeenCalledTimes(1);

    handle?.stop();
  });

  it("2. emits nothing while level remains above threshold", async () => {
    const onCrossing = vi.fn();
    const stream = makeStream();

    vi.setSystemTime(1000);
    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing,
    });
    await tick();

    const node = createdWorkletNodes[0]!;

    // Rise above threshold
    node.port.postMessage({ level: -20 });
    expect(onCrossing).not.toHaveBeenCalled();

    // Advance time while still above threshold
    vi.setSystemTime(1300);
    node.port.postMessage({ level: -15 });
    vi.setSystemTime(1600);
    node.port.postMessage({ level: -10 });
    vi.setSystemTime(2000);
    node.port.postMessage({ level: -28 });

    expect(onCrossing).not.toHaveBeenCalled();

    handle?.stop();
  });

  it("3a. returns null when window.AudioContext is unavailable", () => {
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const handle = monitorNoise(makeStream(), {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing: vi.fn(),
    });

    expect(handle).toBeNull();
  });

  it("3b. returns null and closes context when audioWorklet is unavailable", () => {
    class NoWorkletAudioContext extends FakeAudioContext {
      override audioWorklet = null as unknown as FakeAudioWorklet;
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: NoWorkletAudioContext,
    });

    const handle = monitorNoise(makeStream(), {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing: vi.fn(),
    });

    expect(handle).toBeNull();
    expect(createdContexts[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("4a. (Review Focus 1) does not throw when audio track ends mid-attempt after worklet is initialized", async () => {
    const onCrossing = vi.fn();
    const track = makeAudioTrack();
    const stream = makeStream([track]);

    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing,
    });
    await tick();

    const node = createdWorkletNodes[0]!;
    const context = createdContexts[0]!;

    expect(() => {
      track.dispatchEvent(new Event("ended"));
    }).not.toThrow();

    expect(node.disconnect).toHaveBeenCalled();
    expect(context.close).toHaveBeenCalled();

    // Calling stop() afterwards is a safe no-op
    expect(() => handle?.stop()).not.toThrow();
  });

  it("4b. (Review Focus 1) does not throw when audio track ends mid-attempt while addModule is still in-flight", async () => {
    let resolveAddModule!: () => void;
    class DeferredAudioWorklet {
      addModule = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveAddModule = resolve;
          }),
      );
    }
    class DeferredAudioContext extends FakeAudioContext {
      override audioWorklet = new DeferredAudioWorklet() as unknown as FakeAudioWorklet;
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: DeferredAudioContext,
    });

    const track = makeAudioTrack();
    const stream = makeStream([track]);

    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing: vi.fn(),
    });

    // Track ends before addModule finishes
    expect(() => {
      track.dispatchEvent(new Event("ended"));
    }).not.toThrow();

    // Now let addModule finish
    resolveAddModule();
    await tick();

    // No AudioWorkletNode should have been constructed
    expect(createdWorkletNodes).toHaveLength(0);
    expect(() => handle?.stop()).not.toThrow();
  });

  it("5. (Review Focus 2) sends nothing for a crossing still open when stop() is invoked", async () => {
    const onCrossing = vi.fn();
    const stream = makeStream();

    vi.setSystemTime(1000);
    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing,
    });
    await tick();

    const node = createdWorkletNodes[0]!;

    // Crossing opens at t = 1000
    node.port.postMessage({ level: -15 });
    expect(onCrossing).not.toHaveBeenCalled();

    // Advance time while still open
    vi.setSystemTime(1800);

    // Stop invoked before any falling edge occurs
    handle?.stop();

    // Still nothing emitted
    expect(onCrossing).not.toHaveBeenCalled();

    // Any subsequent message received after stop does nothing
    node.port.postMessage({ level: -45 });
    expect(onCrossing).not.toHaveBeenCalled();
  });

  it("degrades silently when addModule rejects", async () => {
    class RejectingAudioWorklet {
      addModule = vi.fn().mockRejectedValue(new Error("Network fetch failed"));
    }
    class RejectingAudioContext extends FakeAudioContext {
      override audioWorklet = new RejectingAudioWorklet() as unknown as FakeAudioWorklet;
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      writable: true,
      value: RejectingAudioContext,
    });

    const stream = makeStream();
    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing: vi.fn(),
    });

    await tick();

    expect(createdContexts[0]?.close).toHaveBeenCalled();
    expect(createdWorkletNodes).toHaveLength(0);
    expect(() => handle?.stop()).not.toThrow();
  });

  it("emits multiple crossing events across sequential above-and-below cycles", async () => {
    const onCrossing = vi.fn();
    const stream = makeStream();

    vi.setSystemTime(1000);
    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing,
    });
    await tick();

    const node = createdWorkletNodes[0]!;

    // First cycle: 1000 to 1300 = 300ms
    node.port.postMessage({ level: -20 });
    vi.setSystemTime(1300);
    node.port.postMessage({ level: -35 });
    expect(onCrossing).toHaveBeenLastCalledWith(300);

    // Quiet period: 1300 to 2000
    vi.setSystemTime(1500);
    node.port.postMessage({ level: -40 });
    expect(onCrossing).toHaveBeenCalledTimes(1);

    // Second cycle: 2000 to 2450 = 450ms
    vi.setSystemTime(2000);
    node.port.postMessage({ level: -10 });
    vi.setSystemTime(2450);
    node.port.postMessage({ level: -32 });
    expect(onCrossing).toHaveBeenCalledTimes(2);
    expect(onCrossing).toHaveBeenLastCalledWith(450);

    handle?.stop();
  });

  it("is idempotent when calling stop multiple times", async () => {
    const stream = makeStream();
    const handle = monitorNoise(stream, {
      thresholdDb: -30,
      windowMs: 200,
      onCrossing: vi.fn(),
    });
    await tick();

    expect(() => {
      handle?.stop();
      handle?.stop();
    }).not.toThrow();

    expect(createdContexts[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe("NoiseLevelProcessor (apps/web/public/noise-worklet.js)", () => {
  it("registers processor and calculates RMS correctly", () => {
    const workletPath = resolve(fileURLToPath(import.meta.url), "../../../public/noise-worklet.js");
    const code = readFileSync(workletPath, "utf8");

    let registeredName = "";
    interface TestProcessor {
      windowSamples: number;
      process(inputs: unknown[][]): boolean;
      port: { postMessage: ReturnType<typeof vi.fn> };
    }
    type ProcessorConstructor = new (options?: { processorOptions?: { windowMs?: number } }) => TestProcessor;
    let ProcessorClass: ProcessorConstructor | undefined;
    const registerProcessor = vi.fn((name: string, ctor: ProcessorConstructor) => {
      registeredName = name;
      ProcessorClass = ctor;
    });

    class BaseProcessor {
      port = { postMessage: vi.fn() };
    }

    const runner = new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", code);
    runner(BaseProcessor, registerProcessor, 48000);

    expect(registeredName).toBe("noise-level-processor");
    expect(ProcessorClass).toBeDefined();

    // 1. Empty / missing input returns true
    const processor = new ProcessorClass!({ processorOptions: { windowMs: 100 } });
    expect(processor.windowSamples).toBe(4800);
    expect(processor.process([])).toBe(true);
    expect(processor.process([[]])).toBe(true);

    // 2. Feed silence (zeros)
    const silenceChunk = new Float32Array(4800);
    const handledSilence = processor.process([[silenceChunk]]);
    expect(handledSilence).toBe(true);
    expect(processor.port.postMessage).toHaveBeenCalledWith({ level: -Infinity });

    // 3. Feed constant 0.5 amplitude
    processor.port.postMessage.mockClear();
    const halfAmpChunk = new Float32Array(4800).fill(0.5);
    const handledAmp = processor.process([[halfAmpChunk]]);
    expect(handledAmp).toBe(true);
    expect(processor.port.postMessage).toHaveBeenCalledTimes(1);
    const msg = processor.port.postMessage.mock.calls[0]?.[0] as { level: number };
    expect(msg).toBeDefined();
    // 20 * Math.log10(0.5) is approx -6.0205999
    expect(msg.level).toBeCloseTo(-6.02, 1);
  });
});
