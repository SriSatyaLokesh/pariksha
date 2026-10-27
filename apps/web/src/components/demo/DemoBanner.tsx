import type { ReactElement } from "react";

export interface DemoBannerProps {
  mode: "exam" | "organiser";
  expiresInMs?: number;
  onExit?: () => void;
  onReset?: () => void;
}

export function DemoBanner({
  mode,
  expiresInMs,
  onExit,
  onReset,
}: DemoBannerProps): ReactElement {
  const minsLeft = expiresInMs ? Math.max(1, Math.round(expiresInMs / 60_000)) : 60;

  return (
    <aside
      className="demo-banner"
      role="region"
      aria-label="Demo mode announcement"
    >
      <div className="demo-banner-inner">
        <div className="demo-banner-badge">
          <span className="demo-banner-dot" aria-hidden="true" />
          <strong>Public Demo</strong>
        </div>

        <p className="demo-banner-text">
          {mode === "exam" ? (
            <>
              <b>Sample Candidate Exam</b> · 12 question types · Access Code: DEMO · Evaluated locally with no Cloudflare subrequests.
            </>
          ) : (
            <>
              <b>Ephemeral Workspace</b> · Sample banks, test & attempts · Resets in ~{minsLeft}m.
            </>
          )}
        </p>

        <div className="demo-banner-actions">
          {mode === "organiser" && onReset && (
            <button
              type="button"
              className="demo-banner-btn"
              onClick={onReset}
            >
              Reset Demo
            </button>
          )}
          <a
            href="https://github.com/SriSatyaLokesh/pariksha#deploy-to-cloudflare"
            className="demo-banner-link"
            target="_blank"
            rel="noopener noreferrer"
          >
            Deploy your own
          </a>
          {onExit ? (
            <button
              type="button"
              className="demo-banner-btn demo-banner-btn--exit"
              onClick={onExit}
            >
              Exit Demo
            </button>
          ) : (
            <a
              href="/"
              className="demo-banner-btn demo-banner-btn--exit"
            >
              Exit Demo
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
