/**
 * Native On-Device Face Counting via Shape Detection API (`window.FaceDetector`).
 *
 * Runs directly in the browser's native C++ engine with:
 * - Zero external npm dependencies
 * - Zero WASM
 * - Zero CSP changes
 * - Fail-open fallback (returns null if FaceDetector is unsupported)
 *
 * (Closes Issue #264)
 */

export interface DetectedFace {
  boundingBox?: unknown;
}

export interface NativeFaceDetector {
  detect(image: ImageBitmapSource): Promise<DetectedFace[]>;
}

declare global {
  interface Window {
    FaceDetector?:
      | (new (options?: { maxDetectedFaces?: number; fastMode?: boolean }) => NativeFaceDetector)
      | undefined;
  }
}

let cachedDetector: NativeFaceDetector | null | undefined = undefined;

export function resetFaceDetectorForTesting(): void {
  cachedDetector = undefined;
}

export function isFaceDetectorSupported(): boolean {
  return typeof window !== "undefined" && typeof window.FaceDetector === "function";
}

export function getFaceDetector(): NativeFaceDetector | null {
  if (cachedDetector !== undefined) return cachedDetector;
  if (!isFaceDetectorSupported()) {
    cachedDetector = null;
    return null;
  }
  try {
    cachedDetector = new window.FaceDetector!({ maxDetectedFaces: 5, fastMode: true });
    return cachedDetector;
  } catch {
    cachedDetector = null;
    return null;
  }
}

/**
 * Counts faces in the provided canvas or image source.
 * Returns the number of detected faces (e.g. 0, 1, 2+), or null if the API is unsupported or failed.
 */
export async function detectFaces(source: ImageBitmapSource): Promise<number | null> {
  const detector = getFaceDetector();
  if (!detector) return null;
  try {
    const faces = await detector.detect(source);
    return Array.isArray(faces) ? faces.length : 0;
  } catch {
    return null;
  }
}
