import { useState, useEffect, type ReactElement } from "react";

export interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DemoModal({ isOpen, onClose }: DemoModalProps): ReactElement | null {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  async function handleProvisionOrganiser() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/demo/provision", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Demo provisioning returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        ok: boolean;
        workspace: { id: string; slug: string; isDemo: boolean };
      };
      // Redirect to organiser workspace
      window.location.assign(`/w/${data.workspace.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to provision demo workspace");
      setLoading(false);
    }
  }

  return (
    <div className="demo-modal-backdrop" onClick={onClose}>
      <div
        className="demo-modal"
        role="dialog"
        aria-label="Choose demo experience"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="demo-modal__header">
          <p className="signal-eyebrow">Public Demo</p>
          <h2 className="demo-modal__title">Choose your demo experience</h2>
          <button
            type="button"
            className="demo-modal__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        <div className="demo-modal__grid">
          <div className="demo-card">
            <div className="demo-card__tag">Candidate Experience</div>
            <h3 className="demo-card__title">Take Sample Exam</h3>
            <p className="demo-card__desc">
              Sit a multi-section exam covering all 12 question types. Zero cost,
              instant start, scored locally with no server calls.
            </p>
            <div className="demo-code-pill">
              Access Code: <code><strong>DEMO</strong></code>
            </div>
            <a
              href="/exam?demo=true"
              className="signal-btn demo-card__action"
            >
              Take Sample Exam
            </a>
          </div>

          <div className="demo-card">
            <div className="demo-card__tag">Organiser Experience</div>
            <h3 className="demo-card__title">Explore Dashboard</h3>
            <p className="demo-card__desc">
              An ephemeral workspace with pre-loaded question banks, published test,
              and 5 realistic candidate attempts with review flags.
            </p>
            <button
              type="button"
              className="signal-btn signal-btn--ghost demo-card__action"
              onClick={() => void handleProvisionOrganiser()}
              disabled={loading}
            >
              {loading ? "Provisioning..." : "Explore Organiser Dashboard"}
            </button>
          </div>
        </div>

        {error && (
          <p className="demo-modal__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
