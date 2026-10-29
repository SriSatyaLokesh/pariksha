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

/**
 * Checks whether the browser natively supports the Web Speech API.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition,
  );
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

  const SpeechRecognitionCtor =
    (window as any).SpeechRecognition ||
    (window as any).webkitSpeechRecognition;

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

    recognition.onresult = (event: any) => {
      if (stopped) return;
      const results = event?.results;
      if (!results) return;

      const startIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;
      for (let i = startIndex; i < results.length; i++) {
        const item = results[i];
        if (item && item.isFinal && item[0]?.transcript) {
          const text = String(item[0].transcript).trim();
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

    recognition.onerror = (_err: any) => {
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
