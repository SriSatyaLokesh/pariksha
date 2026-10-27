import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireCamera, acquireMedia } from "../../src/lib/camera";

function fakeTrack(kind: "video" | "audio"): MediaStreamTrack {
  return {
    kind,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: { video?: boolean; audio?: boolean } = { video: true }): MediaStream {
  const videoTracks = tracks.video ? [fakeTrack("video")] : [];
  const audioTracks = tracks.audio ? [fakeTrack("audio")] : [];
  const allTracks = [...videoTracks, ...audioTracks];
  return {
    getVideoTracks: () => videoTracks,
    getAudioTracks: () => audioTracks,
    getTracks: () => allTracks,
  } as unknown as MediaStream;
}

describe("acquireMedia", () => {
  const originalMediaDevices = navigator.mediaDevices;

  function setMediaDevices(gum?: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
    Object.defineProperty(navigator, "mediaDevices", {
      value: gum ? { getUserMedia: gum } : undefined,
      configurable: true,
      writable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
    vi.restoreAllMocks();
  });

  it("1. requests only video when options = { video: true, audio: false }", async () => {
    const videoStream = fakeStream({ video: true });
    const gum = vi.fn().mockResolvedValue(videoStream);
    setMediaDevices(gum);

    const result = await acquireMedia({ video: true, audio: false });

    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledWith({ video: true });
    expect(result).toEqual({
      ok: true,
      stream: videoStream,
      audioAvailable: false,
    });
  });

  it("2. requests only audio when options = { video: false, audio: true }", async () => {
    const audioStream = fakeStream({ audio: true });
    const gum = vi.fn().mockResolvedValue(audioStream);
    setMediaDevices(gum);

    const result = await acquireMedia({ video: false, audio: true });

    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledWith({ audio: true });
    expect(result).toEqual({
      ok: true,
      stream: audioStream,
      audioAvailable: true,
    });
  });

  it("3. requests both video and audio when options = { video: true, audio: true }", async () => {
    const jointStream = fakeStream({ video: true, audio: true });
    const gum = vi.fn().mockResolvedValue(jointStream);
    setMediaDevices(gum);

    const result = await acquireMedia({ video: true, audio: true });

    expect(gum).toHaveBeenCalledTimes(1);
    expect(gum).toHaveBeenCalledWith({ video: true, audio: true });
    expect(result).toEqual({
      ok: true,
      stream: jointStream,
      audioAvailable: true,
    });
  });

  describe("4. Review Focus 4: AG1 fail-open fallback on audio failure", () => {
    it("retries video-only when joint acquisition fails with NotAllowedError (audio denied)", async () => {
      const videoStream = fakeStream({ video: true });
      const gum = vi.fn().mockImplementation((constraints: MediaStreamConstraints) => {
        if (constraints.audio && constraints.video) {
          const err = new Error("Microphone permission denied");
          err.name = "NotAllowedError";
          return Promise.reject(err);
        }
        if (constraints.video) {
          return Promise.resolve(videoStream);
        }
        return Promise.reject(new Error("Unexpected call"));
      });
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true, audio: true });

      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum).toHaveBeenNthCalledWith(1, { video: true, audio: true });
      expect(gum).toHaveBeenNthCalledWith(2, { video: true });
      expect(result).toEqual({
        ok: true,
        stream: videoStream,
        audioAvailable: false,
      });
    });

    it("retries video-only when joint acquisition fails with NotFoundError (no microphone device)", async () => {
      const videoStream = fakeStream({ video: true });
      const gum = vi.fn().mockImplementation((constraints: MediaStreamConstraints) => {
        if (constraints.audio && constraints.video) {
          const err = new Error("Requested device not found");
          err.name = "NotFoundError";
          return Promise.reject(err);
        }
        if (constraints.video) {
          return Promise.resolve(videoStream);
        }
        return Promise.reject(new Error("Unexpected call"));
      });
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true, audio: true });

      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum).toHaveBeenNthCalledWith(1, { video: true, audio: true });
      expect(gum).toHaveBeenNthCalledWith(2, { video: true });
      expect(result).toEqual({
        ok: true,
        stream: videoStream,
        audioAvailable: false,
      });
    });
  });

  describe("5. returns { ok: false, reason: 'denied' } if video is required and denied", () => {
    it("returns denied when video-only request is rejected with NotAllowedError", async () => {
      const gum = vi.fn().mockImplementation(() => {
        const err = new Error("Camera permission denied");
        err.name = "NotAllowedError";
        return Promise.reject(err);
      });
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true, audio: false });

      expect(gum).toHaveBeenCalledTimes(1);
      expect(gum).toHaveBeenCalledWith({ video: true });
      expect(result).toEqual({
        ok: false,
        reason: "denied",
      });
    });

    it("returns denied when joint request fails and fallback video-only is also denied", async () => {
      const gum = vi.fn().mockImplementation(() => {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        return Promise.reject(err);
      });
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true, audio: true });

      expect(gum).toHaveBeenCalledTimes(2);
      expect(gum).toHaveBeenNthCalledWith(1, { video: true, audio: true });
      expect(gum).toHaveBeenNthCalledWith(2, { video: true });
      expect(result).toEqual({
        ok: false,
        reason: "denied",
      });
    });
  });

  describe("other error and edge cases", () => {
    it("returns absent when camera is not found", async () => {
      const gum = vi.fn().mockImplementation(() => {
        const err = new Error("No device found");
        err.name = "NotFoundError";
        return Promise.reject(err);
      });
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true, audio: false });
      expect(result).toEqual({ ok: false, reason: "absent" });
    });

    it("returns absent when mediaDevices.getUserMedia is missing", async () => {
      setMediaDevices(undefined);

      const result = await acquireMedia({ video: true, audio: true });
      expect(result).toEqual({ ok: false, reason: "absent" });
    });

    it("returns failed when an unknown error is thrown", async () => {
      const gum = vi.fn().mockRejectedValue(new Error("Hardware failure"));
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true, audio: false });
      expect(result).toEqual({ ok: false, reason: "failed" });
    });

    it("returns an empty stream and audioAvailable: false when neither video nor audio requested", async () => {
      const gum = vi.fn();
      setMediaDevices(gum);

      const result = await acquireMedia({ video: false, audio: false });
      expect(gum).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.audioAvailable).toBe(false);
        expect(result.stream.getVideoTracks()).toEqual([]);
      }
    });

    it("defaults omitted options to false", async () => {
      const videoStream = fakeStream({ video: true });
      const gum = vi.fn().mockResolvedValue(videoStream);
      setMediaDevices(gum);

      const result = await acquireMedia({ video: true });
      expect(gum).toHaveBeenCalledWith({ video: true });
      expect(result).toEqual({
        ok: true,
        stream: videoStream,
        audioAvailable: false,
      });
    });
  });

  describe("acquireCamera delegation", () => {
    it("delegates to acquireMedia and returns stream without audioAvailable on success", async () => {
      const videoStream = fakeStream({ video: true });
      const gum = vi.fn().mockResolvedValue(videoStream);
      setMediaDevices(gum);

      const result = await acquireCamera();
      expect(gum).toHaveBeenCalledWith({ video: true });
      expect(result).toEqual({
        ok: true,
        stream: videoStream,
      });
    });

    it("delegates to acquireMedia and returns failure reason on error", async () => {
      const gum = vi.fn().mockImplementation(() => {
        const err = new Error("Permission denied");
        err.name = "NotAllowedError";
        return Promise.reject(err);
      });
      setMediaDevices(gum);

      const result = await acquireCamera();
      expect(result).toEqual({
        ok: false,
        reason: "denied",
      });
    });
  });
});
