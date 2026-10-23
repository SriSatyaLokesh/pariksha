// Phase 8f Task 1 (`#209`, `Q12b`): noise-LEVEL monitoring, not recording.
// `AG2`/`AG3` are a public promise, not an implementation preference — this
// module and the worklet it loads (`public/noise-worklet.js`) are the whole
// surface that may ever touch a candidate's microphone, and neither one may
// ever construct a `MediaRecorder`, keep an `AudioBuffer`, or call
// `getChannelData`. The worklet reduces a window of samples to a single dB
// number; this module turns a stream of those numbers into ONE fact —
// how long the level stayed above `thresholdDb` — and reports nothing else.
//
// `Q12b`'s ruling is "cheap or off": an `AudioWorklet` computing RMS over a
// window, never an `AnalyserNode` polled on a frame loop. The crossing
// state machine below lives on the MAIN thread rather than inside the
// worklet, which is what makes it testable without a real audio graph
// (apps/web/test/exam/noise.test.ts installs fakes for `AudioContext`,
// `AudioWorkletNode` and `MediaStream` — jsdom has none of the three).
//
// `AG1`: a proctoring stack failure never blocks answering. Every failure
// path here — no `AudioContext`, no `audioWorklet`, the module failing to
// load, the track ending mid-attempt — degrades silently: `null` or a
// no-op `stop()`, never a throw into the caller.

const WORKLET_URL = "/noise-worklet.js";
const WORKLET_NAME = "noise-level-processor";

interface NoiseLevelMessage {
  level: number;
}

export function monitorNoise(
  stream: MediaStream,
  opts: { thresholdDb: number; windowMs: number; onCrossing: (durationMs: number) => void },
): { stop(): void } | null {
  const AudioContextCtor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
  if (typeof AudioContextCtor !== "function") return null;

  const context = new AudioContextCtor();
  if (!context.audioWorklet) {
    void context.close();
    return null;
  }

  let stopped = false;
  let node: AudioWorkletNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  // `Date.now()`, not a running sample count: the worklet posts at most
  // once per window, so a wall-clock timestamp is what turns "still above"
  // into a duration on the falling edge (Review Focus 1/2's own shape —
  // see the test file for the exact two).
  let aboveSince: number | null = null;

  function handleLevel(level: number): void {
    const above = level >= opts.thresholdDb;
    if (above && aboveSince === null) {
      aboveSince = Date.now();
    } else if (!above && aboveSince !== null) {
      const durationMs = Date.now() - aboveSince;
      aboveSince = null;
      opts.onCrossing(durationMs);
    }
  }

  function handleMessage(event: MessageEvent<NoiseLevelMessage>): void {
    handleLevel(event.data.level);
  }

  // Review Focus 2: a crossing still open (no falling edge yet) when `stop`
  // runs is dropped, deliberately — `aboveSince` is simply never read here.
  // One event lost at submission time is the documented correct behaviour,
  // not a bug this function needs to work around.
  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (node) node.port.onmessage = null;
    node?.disconnect();
    source?.disconnect();
    for (const track of stream.getAudioTracks()) {
      track.removeEventListener("ended", stop);
    }
    void context.close();
  }

  // Review Focus 1: the track can end (a USB headset unplugged) before or
  // after the worklet module finishes loading — `stop()` is idempotent and
  // every reference it touches is already null-safe either way.
  for (const track of stream.getAudioTracks()) {
    track.addEventListener("ended", stop);
  }

  // `addModule` must resolve before an `AudioWorkletNode` naming its
  // processor can be constructed (the spec's own ordering) — chained with
  // the two-argument form rather than `.then().catch()` so a rejection
  // (a browser that half-supports the API, a network hiccup fetching the
  // module) degrades through the exact same silent `stop()` as every other
  // `AG1` failure, instead of an unhandled rejection.
  context.audioWorklet.addModule(WORKLET_URL).then(
    () => {
      if (stopped) return;
      node = new AudioWorkletNode(context, WORKLET_NAME, {
        processorOptions: { windowMs: opts.windowMs },
      });
      node.port.onmessage = handleMessage;
      source = context.createMediaStreamSource(stream);
      source.connect(node);
    },
    () => stop(),
  );

  return { stop };
}
