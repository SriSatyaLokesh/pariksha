// Phase 8.5 / issue 209: noise-level monitoring, not recording.
// AG2/AG3: this module and the worklet it loads (/noise-worklet.js) never
// record audio, retain buffers, or extract raw PCM. The worklet reduces a
// window of samples to a single dB level; this module converts those levels
// into duration above thresholdDb and reports nothing else.
//
// AG1: proctoring stack failures never throw or block candidate exam progress.
// All error paths degrade gracefully to null or a no-op stop().

const WORKLET_URL = "/noise-worklet.js";
const WORKLET_NAME = "noise-level-processor";

export interface MonitorNoiseOptions {
  thresholdDb: number;
  windowMs: number;
  onCrossing: (durationMs: number) => void;
}

export interface NoiseMonitorHandle {
  stop(): void;
}

export function monitorNoise(
  stream: MediaStream,
  opts: MonitorNoiseOptions,
): NoiseMonitorHandle | null {
  if (typeof window === "undefined") return null;

  const AudioContextCtor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (typeof AudioContextCtor !== "function") return null;

  let context: AudioContext;
  try {
    context = new AudioContextCtor();
  } catch {
    return null;
  }

  if (!context.audioWorklet) {
    try {
      void context.close();
    } catch {
      // safe no-op
    }
    return null;
  }

  let stopped = false;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let aboveSince: number | null = null;

  function handleLevel(level: number): void {
    if (stopped) return;
    const above = level >= opts.thresholdDb;
    if (above && aboveSince === null) {
      aboveSince = Date.now();
    } else if (!above && aboveSince !== null) {
      const durationMs = Date.now() - aboveSince;
      aboveSince = null;
      opts.onCrossing(durationMs);
    }
  }

  function handleMessage(event: MessageEvent<{ level?: number }>): void {
    if (typeof event.data?.level === "number") {
      handleLevel(event.data.level);
    }
  }

  const tracks = typeof stream?.getAudioTracks === "function" ? stream.getAudioTracks() : [];

  function stop(): void {
    if (stopped) return;
    stopped = true;
    aboveSince = null; // Discard unclosed crossings
    if (node) {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        // safe no-op
      }
    }
    if (source) {
      try {
        source.disconnect();
      } catch {
        // safe no-op
      }
    }
    for (const track of tracks) {
      try {
        track.removeEventListener("ended", stop);
      } catch {
        // safe no-op
      }
    }
    try {
      void context.close().catch(() => {});
    } catch {
      // safe no-op
    }
  }

  for (const track of tracks) {
    try {
      track.addEventListener("ended", stop);
    } catch {
      // safe no-op
    }
  }

  context.audioWorklet.addModule(WORKLET_URL).then(
    () => {
      if (stopped) return;
      try {
        node = new AudioWorkletNode(context, WORKLET_NAME, {
          processorOptions: { windowMs: opts.windowMs },
        });
        node.port.onmessage = handleMessage;
        source = context.createMediaStreamSource(stream);
        source.connect(node);
      } catch {
        stop();
      }
    },
    () => stop(),
  );

  return { stop };
}
