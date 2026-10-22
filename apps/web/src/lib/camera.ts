// Phase 7d Task 2 (`P-05`/`Q2a`, `P-06`/`Q11a`): the camera primitives the
// Strict start gate and the identity photo are built on.
//
// Two functions, nothing else. `acquireCamera` asks for permission and a
// live stream; `captureJpeg` draws one frame off that stream onto a
// 320×240 canvas and encodes it. Neither touches the network — uploading
// is `routes/exam.tsx`'s job, against Task 1's `POST
// /api/v1/run/attempt/snapshot` — and neither records anything (`AG2`):
// one still frame per call, never a `MediaRecorder`.

const CAPTURE_WIDTH = 320;
const CAPTURE_HEIGHT = 240;

/**
 * `P-06`/`Q11a`'s own figure — `Tail.tsx:125` states it publicly as "about
 * 25 KB". Measured against Chromium's `--use-fake-device-for-media-stream`
 * test pattern (D-R11): that synthetic source peaks at **4.2 KB even at
 * quality 0.9** (a flat, low-entropy pattern compresses far smaller than a
 * real face under real room lighting), so it cannot confirm or refute 25 KB
 * against real content — a finding, not a constant this task is free to
 * retune to make a number agree. 0.8 is chosen as a reasonable, commonly
 * used quality for a face capture: comfortably under the 60 KB this task
 * checks and the 256 KB `SNAPSHOT_MAX_BYTES` ceiling the upload route
 * enforces, with headroom for real photographic noise the fake device
 * cannot produce.
 */
const JPEG_QUALITY = 0.8;

/**
 * Permission plus one live frame, nothing more. `getUserMedia` itself is
 * absent from jsdom entirely (D-R3, same shape as the Fullscreen API
 * `fullscreen.test.tsx` already documents) — every caller of this function
 * in a test installs `navigator.mediaDevices` itself.
 *
 * Three reasons, not an error object: every caller of this (the start
 * gate) only ever shows one sentence regardless of which — Q2's own
 * "everything else degrades" posture — but a browser without
 * `mediaDevices` at all (`absent`), a real permission refusal (`denied`)
 * and everything else (`failed`, a busy device, a hardware fault) are kept
 * apart because a future caller may reasonably want to say something
 * different about a browser with no camera API at all.
 */
export async function acquireCamera(): Promise<
  | { ok: true; stream: MediaStream }
  | { ok: false; reason: "denied" | "absent" | "failed" }
> {
  if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
    return { ok: false, reason: "absent" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    return { ok: true, stream };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      return { ok: false, reason: "denied" };
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return { ok: false, reason: "absent" };
    }
    return { ok: false, reason: "failed" };
  }
}

/**
 * `P-05`/`AC-19`/`Q2`'s Review Focus 3 — a covered lens, not an unplugged
 * camera: the track stays `live` and keeps firing no events at all, so
 * `track.onended`/`track.muted` (`ProctoringLayer`'s other signal) can
 * never see it. This draws the same kind of frame `captureJpeg` does, at a
 * much smaller size (nothing here is kept or uploaded), and answers only
 * whether the lens reads covered rather than handing back a number a caller
 * would have to know how to read.
 *
 * `null`, not `false`, when the frame cannot be sampled at all — jsdom with
 * no stubbed canvas (`captureJpeg`'s own baseline) included. A frame this
 * cannot read is not evidence of anything either way (`AG1`): the caller's
 * job is to treat `null` as "skip this tick", never as "covered".
 */
const LUMINANCE_SAMPLE_WIDTH = 32;
const LUMINANCE_SAMPLE_HEIGHT = 24;

/** Below this average 0–255 luma, a sampled frame reads as a covered lens
 *  rather than a dim room — comfortable headroom under a real face lit by
 *  nothing but a monitor, well above the near-zero a taped-over lens
 *  actually produces. */
const COVERED_LENS_THRESHOLD = 10;

/**
 * Fix pass 1, finding 4 (Task 3 review finding 2): module-scoped and built
 * once, lazily, rather than a fresh `<video>`/`<canvas>` pair every sample
 * tick. `ProctoringLayer` samples at most once a second for the length of
 * an attempt — not a leak either way (both would be GC-reclaimable), but an
 * avoidable standing cost this reuses instead. Safe to share across calls:
 * only one attempt, and so only one `ProctoringLayer`, samples a camera at
 * a time in this app, and `srcObject` is reassigned on every call in case
 * the stream being sampled has changed (a reconnect, fix pass 1 finding 1).
 */
let sampleVideo: HTMLVideoElement | null = null;
let sampleCanvas: HTMLCanvasElement | null = null;

/**
 * L3 (whole-branch review): the module-scoped pair above is reused across
 * an attempt's whole luminance-sampling lifetime by design (its own doc
 * comment), which means it otherwise keeps `sampleVideo.srcObject`
 * referencing the stopped `MediaStream` and `sampleCanvas` holding the last
 * drawn frame for the life of the document, not just the attempt. Not an
 * `AG2` violation on a plain reading — nothing here is recorded, stored or
 * uploaded — but `ProctoringLayer`'s own queue-lifecycle cleanup (the one
 * place that already owns "runs for exactly the attempt's lifetime") calls
 * this beside the track stop so neither survives past it. Dropped, not just
 * detached: `isCameraLensCovered` only sets a freshly created canvas's
 * dimensions (`if (!sampleCanvas)`, above), so clearing it in place rather
 * than nulling the module binding would leave a 0×0 canvas behind for the
 * next attempt in the same document to silently sample nothing from.
 */
export function releaseCameraSampler(): void {
  if (sampleVideo) sampleVideo.srcObject = null;
  sampleVideo = null;
  sampleCanvas = null;
}

export async function isCameraLensCovered(stream: MediaStream): Promise<boolean | null> {
  if (stream.getVideoTracks().length === 0) return null;

  if (!sampleVideo) {
    sampleVideo = document.createElement("video");
    sampleVideo.muted = true;
    sampleVideo.playsInline = true;
  }
  if (sampleVideo.srcObject !== stream) {
    sampleVideo.srcObject = stream;
  }
  try {
    await sampleVideo.play();
  } catch {
    /* AG1: same degrade `captureJpeg` takes on a refused autoplay. */
  }

  if (!sampleCanvas) {
    sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = LUMINANCE_SAMPLE_WIDTH;
    sampleCanvas.height = LUMINANCE_SAMPLE_HEIGHT;
  }
  const ctx = sampleCanvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(sampleVideo, 0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT);

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, LUMINANCE_SAMPLE_WIDTH, LUMINANCE_SAMPLE_HEIGHT).data;
  } catch {
    return null; // Q2: an unreadable frame is not a violation either way.
  }

  let total = 0;
  const pixelCount = pixels.length / 4;
  if (pixelCount === 0) return null;
  for (let i = 0; i < pixels.length; i += 4) {
    // ITU-R BT.601 luma — the standard grayscale weighting, not an even
    // average across the three channels: the eye does not perceive them
    // as equally bright, and an even average would misjudge a real
    // picture's brightness against this threshold.
    total += 0.299 * (pixels[i] ?? 0) + 0.587 * (pixels[i + 1] ?? 0) + 0.114 * (pixels[i + 2] ?? 0);
  }
  return total / pixelCount < COVERED_LENS_THRESHOLD;
}

/**
 * One frame, drawn onto a 320×240 canvas and encoded to a JPEG — `AG2`:
 * nothing is retained beyond the returned `Blob`, and this never starts a
 * `MediaRecorder`.
 *
 * `null`, never a throw, for every way this can fail to produce an image —
 * no video track on the stream, no 2D context (jsdom's own baseline with no
 * `canvas` npm package installed: `getContext` returns `null` rather than
 * throwing, confirmed against this workspace's jsdom source), or
 * `toBlob` handing back `null` itself. `AG1`: a capture that cannot run is
 * not a reason to block anything, and every caller of this treats `null`
 * as "no photo this time" rather than an error to surface.
 */
export async function captureJpeg(stream: MediaStream): Promise<Blob | null> {
  if (stream.getVideoTracks().length === 0) return null;

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  try {
    // Real browsers: resolves once a frame is actually available. jsdom:
    // `play()` is a documented no-op stub (no `canvas` package installed)
    // that neither throws nor returns a promise, so this resolves at once.
    await video.play();
  } catch {
    /* AG1: a refused autoplay is not a reason to abandon the capture —
       `loadedmetadata` having already fired is what a camera stream
       guarantees by the time `acquireCamera` hands it over. */
  }

  const canvas = document.createElement("canvas");
  canvas.width = CAPTURE_WIDTH;
  canvas.height = CAPTURE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob);
    }, "image/jpeg", JPEG_QUALITY);
  });
}
