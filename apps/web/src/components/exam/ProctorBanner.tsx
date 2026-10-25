import { useEffect, useRef } from "react";

export interface ProctorBannerProps {
  message: string;
  messageAt: number;
  onDismiss: () => void;
}

/**
 * Phase 8g Task 3 (`C-10`, `D8`): Proctor Broadcast Banner.
 * Floating fixed top overlay displayed when proctor broadcasts a message.
 * Sits over the layout and does not reflow the question paper (`D8`).
 * Dismissible via button, Escape key, or Enter key.
 */
export function ProctorBanner({ message, messageAt, onDismiss }: ProctorBannerProps) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="exam-proctor-banner"
      role="alert"
      aria-live="assertive"
      data-message-at={messageAt}
    >
      <div className="exam-proctor-banner-content">
        <span className="exam-proctor-banner-tag">Proctor Announcement</span>
        <p className="exam-proctor-banner-message">{message}</p>
      </div>
      <button
        ref={dismissRef}
        type="button"
        className="exam-proctor-banner-dismiss"
        aria-label="Dismiss proctor message"
        onClick={onDismiss}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onDismiss();
          }
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
