/**
 * Free Browser-Native Speech Recognition ($0 cost, 0 dependencies, 0 CSP changes)
 *
 * Utilizes the native Web Speech API (`window.SpeechRecognition` or `window.webkitSpeechRecognition`).
 * Complies with:
 * - AG1: Fail-open. Missing or throwing API never blocks candidates from taking exams.
 * - ADR 0012: Zero audio retention. Audio is processed on-device by the browser engine;
 *   no raw audio is recorded or stored on Pariksha servers.
 */

export interface SpeechRecognitionOptions {
  lang?: string;
}

export interface SpeechRecognitionHandle {
  stop: () => void;
}

export interface SpeechItem {
  transcript: string;
}

export interface SpeechResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechItem | undefined;
}

export interface SpeechResultList {
  length: number;
  [index: number]: SpeechResultItem | undefined;
}

export interface SpeechEventLike {
  resultIndex?: number;
  results: SpeechResultList;
}

export interface NativeSpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang?: string;
  start(): void;
  abort(): void;
  onresult: ((event: SpeechEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type NativeSpeechRecognitionCtor = new () => NativeSpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: NativeSpeechRecognitionCtor | undefined;
    webkitSpeechRecognition?: NativeSpeechRecognitionCtor | undefined;
  }
}

/**
 * Checks whether the browser natively supports the Web Speech API.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/**
 * Starts continuous browser-native speech recognition if available.
 * Returns a handle with a `stop()` method for cleanup.
 */
export function startSpeechRecognition(
  onSpeech: (transcript: string) => void,
  options?: SpeechRecognitionOptions,
): SpeechRecognitionHandle {
  if (typeof window === "undefined") {
    return { stop: () => {} };
  }

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (typeof SpeechRecognitionCtor !== "function") {
    return { stop: () => {} };
  }

  try {
    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = false;
    if (options?.lang) {
      recognition.lang = options.lang;
    }

    let stopped = false;

    recognition.onresult = (event: SpeechEventLike) => {
      if (stopped) return;
      const results = event.results;
      if (!results) return;

      const startIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;
      for (let i = startIndex; i < results.length; i++) {
        const item = results[i];
        const speechItem = item?.[0];
        if (item && item.isFinal && speechItem?.transcript) {
          const text = speechItem.transcript.trim();
          if (text) {
            onSpeech(text);
          }
        }
      }
    };

    // Auto-restart if stopped unexpectedly (e.g. timeout on silence)
    recognition.onend = () => {
      if (!stopped) {
        try {
          recognition.start();
        } catch {
          // Ignore if already started or permission revoked
        }
      }
    };

    recognition.onerror = () => {
      // AG1: Fail-open. Never surface audio recognition error to break exam runner.
    };

    recognition.start();

    return {
      stop: () => {
        stopped = true;
        try {
          recognition.abort();
        } catch {
          // Ignore abort errors
        }
      },
    };
  } catch {
    // AG1: Fail-open fallback
    return { stop: () => {} };
  }
}
