import type { CSSProperties, ReactElement } from "react";

export interface DemoBannerProps {
  mode: "exam" | "organiser";
  expiresInMs?: number;
  onExit?: () => void;
  onReset?: () => void;
}

const bannerStyle: CSSProperties = {
  background: "var(--color-signal-surface, #0f1713)",
  borderBottom: "1px solid var(--color-signal-line-strong, #5a7465)",
  color: "var(--color-signal-text, #eaf2ed)",
  padding: "8px 16px",
  fontSize: "13px",
  position: "relative",
  zIndex: 100,
  fontFamily: "var(--type-body-sm-family, sans-serif)",
};

const innerStyle: CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: "12px",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontWeight: 700,
  color: "var(--color-signal-accent, #19e68c)",
};

const dotStyle: CSSProperties = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  background: "var(--color-signal-accent, #19e68c)",
};

const textStyle: CSSProperties = {
  margin: 0,
  color: "var(--color-signal-text-2, #9db0a6)",
  flex: 1,
};

const actionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
};

const linkStyle: CSSProperties = {
  color: "var(--color-signal-accent, #19e68c)",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
};

const btnStyle: CSSProperties = {
  background: "transparent",
  border: "1px solid var(--color-signal-line-strong, #5a7465)",
  color: "var(--color-signal-text, #eaf2ed)",
  borderRadius: "var(--rounded-sm, 4px)",
  padding: "4px 10px",
  fontSize: "12px",
  cursor: "pointer",
};

const exitBtnStyle: CSSProperties = {
  ...btnStyle,
  borderColor: "var(--color-signal-flag-risk, #f87171)",
  color: "var(--color-signal-flag-risk, #f87171)",
};

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
      style={bannerStyle}
      role="region"
      aria-label="Demo mode announcement"
    >
      <div className="demo-banner__inner" style={innerStyle}>
        <div className="demo-banner__badge" style={badgeStyle}>
          <span className="demo-banner__dot" style={dotStyle} aria-hidden="true" />
          <strong>Public Demo</strong>
        </div>

        <p className="demo-banner__text" style={textStyle}>
          {mode === "exam" ? (
            <>
              <b>Sample Candidate Exam</b> · 12 question types · Evaluated locally with no Cloudflare subrequests.
            </>
          ) : (
            <>
              <b>Ephemeral Workspace</b> · Sample banks, test & attempts · Resets in ~{minsLeft}m.
            </>
          )}
        </p>

        <div className="demo-banner__actions" style={actionsStyle}>
          {mode === "organiser" && onReset && (
            <button
              type="button"
              className="demo-banner__btn"
              style={btnStyle}
              onClick={onReset}
            >
              Reset Demo
            </button>
          )}
          <a
            href="https://github.com/SriSatyaLokesh/pariksha#deploy-to-cloudflare"
            className="demo-banner__link"
            style={linkStyle}
            target="_blank"
            rel="noopener noreferrer"
          >
            Deploy your own
          </a>
          {onExit ? (
            <button
              type="button"
              className="demo-banner__btn demo-banner__btn--exit"
              style={exitBtnStyle}
              onClick={onExit}
            >
              Exit Demo
            </button>
          ) : (
            <a
              href="/"
              className="demo-banner__btn demo-banner__btn--exit"
              style={exitBtnStyle}
            >
              Exit Demo
            </a>
          )}
        </div>
      </div>
    </aside>
  );
}
