import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectFaces, isFaceDetectorSupported, resetFaceDetectorForTesting } from "../../src/lib/face";

describe("Native Face Counting via Shape Detection API (Issue #264)", () => {
  const originalFaceDetector = window.FaceDetector;

  beforeEach(() => {
    resetFaceDetectorForTesting();
  });

  afterEach(() => {
    window.FaceDetector = originalFaceDetector;
    resetFaceDetectorForTesting();
  });

  it("reports unsupported and returns null when window.FaceDetector is missing", async () => {
    delete (window as unknown as { FaceDetector?: unknown }).FaceDetector;
    expect(isFaceDetectorSupported()).toBe(false);

    const canvas = document.createElement("canvas");
    const count = await detectFaces(canvas);
    expect(count).toBeNull();
  });

  it("detects and counts faces when window.FaceDetector is present", async () => {
    const mockDetect = vi.fn().mockResolvedValue([
      { boundingBox: { x: 10, y: 10, width: 50, height: 50 } },
    ]);

    class MockFaceDetector {
      detect = mockDetect;
    }

    (window as unknown as { FaceDetector: typeof MockFaceDetector }).FaceDetector = MockFaceDetector;

    expect(isFaceDetectorSupported()).toBe(true);
    const canvas = document.createElement("canvas");
    const count = await detectFaces(canvas);

    expect(count).toBe(1);
    expect(mockDetect).toHaveBeenCalledWith(canvas);
  });

  it("counts multiple faces when detected", async () => {
    const mockDetect = vi.fn().mockResolvedValue([
      { boundingBox: { x: 10, y: 10, width: 50, height: 50 } },
      { boundingBox: { x: 80, y: 10, width: 50, height: 50 } },
    ]);

    class MockFaceDetector {
      detect = mockDetect;
    }

    (window as unknown as { FaceDetector: typeof MockFaceDetector }).FaceDetector = MockFaceDetector;

    const canvas = document.createElement("canvas");
    const count = await detectFaces(canvas);
    expect(count).toBe(2);
  });

  it("returns null when detector.detect throws an exception", async () => {
    const mockDetect = vi.fn().mockRejectedValue(new Error("Hardware acceleration failure"));

    class MockFaceDetector {
      detect = mockDetect;
    }

    (window as unknown as { FaceDetector: typeof MockFaceDetector }).FaceDetector = MockFaceDetector;

    const canvas = document.createElement("canvas");
    const count = await detectFaces(canvas);
    expect(count).toBeNull();
  });
});
