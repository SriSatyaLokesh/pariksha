// Re-review finding N3 (merge blocker). `releaseCameraSampler()` can land
// while `isCameraLensCovered`'s `await sampleVideo.play()` is suspended —
// that race is the whole reason L3's release was redesigned to clear
// `srcObject` rather than null the module binding. Clearing it does not
// throw: it makes the `drawImage` that follows a no-op, leaving a
// transparent (or stale) canvas whose luma reads 0. Unguarded, that is a
// FALSE `"covered"` violation — overlay, event and snapshot — raised
// against a candidate whose attempt has just ended, and silent where the
// old crash at least failed loudly.
//
// `Q2` already names the honest answer for a frame that cannot be read:
// it is not a violation either way. This pins that the released sampler
// takes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isCameraLensCovered, releaseCameraSampler } from "../../src/lib/camera";

/** jsdom ships no `canvas` package, so `getContext`/`toBlob` are stubbed by
 *  hand (`D-R1`). `getImageData` returns all-zero bytes — exactly what a
 *  canvas nothing has drawn on reads as, which is the false-covered frame
 *  this file is about. */
function installFakeCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ({
    drawImage: vi.fn(),
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
    }),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
}

function fakeStream(): MediaStream {
  const track = Object.assign(new EventTarget(), { kind: "video", stop: vi.fn() });
  return { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream;
}

beforeEach(() => {
  installFakeCanvas();
});

afterEach(() => {
  releaseCameraSampler();
  vi.restoreAllMocks();
});

describe("N3: a sampler released mid-sample reports nothing, not a covered lens", () => {
  it("returns null when the release lands while play() is still suspended", async () => {
    // The ordering the race needs: `play()` resolves only after the test has
    // released the sampler, which is what a real teardown does to a sample
    // already in flight. A synchronously-resolving stub cannot reach it.
    const played: { resolve: (() => void) | null } = { resolve: null };
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
      () => new Promise<void>((resolve) => {
        played.resolve = resolve;
      }),
    );

    const sample = isCameraLensCovered(fakeStream());
    await vi.waitFor(() => expect(played.resolve).not.toBeNull());
    releaseCameraSampler();
    played.resolve?.();

    // Not `false` either: the sample is abandoned, not answered.
    await expect(sample).resolves.toBeNull();
  });

  // The positive control. Without it, `toBeNull()` above could mean the
  // harness never produces a reading at all rather than that the release
  // suppressed one — and an all-zero canvas is precisely a covered lens,
  // so this also proves the stub reaches the luma path it claims to.
  it("control: the same all-zero frame reads as covered when nothing releases", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    await expect(isCameraLensCovered(fakeStream())).resolves.toBe(true);
  });
});
