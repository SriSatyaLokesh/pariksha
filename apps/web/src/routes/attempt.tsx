import { useEffect, useState, type JSX } from "react";
import { ApiError, type ApiClient, type AttemptReviewData } from "../lib/api";
import { AttemptReview } from "../components/organiser/AttemptReview";

export interface AttemptRouteProps {
  workspaceId: string;
  attemptId: string;
  client: ApiClient;
  onBack?: () => void;
}

export function AttemptRoute({
  workspaceId,
  attemptId,
  client,
  onBack,
}: AttemptRouteProps): JSX.Element {
  const [data, setData] = useState<AttemptReviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const fetchReview = async () => {
      try {
        if (!client.attemptReview) {
          throw new Error("attemptReview method is not implemented on client");
        }
        const review = await client.attemptReview(workspaceId, attemptId);
        if (active) {
          setData(review);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof ApiError
              ? err.message
              : err instanceof Error
              ? err.message
              : "Failed to load attempt review",
          );
          setLoading(false);
        }
      }
    };

    void fetchReview();

    return () => {
      active = false;
    };
  }, [client, workspaceId, attemptId]);

  if (loading) {
    return (
      <main id="main-content" className="organiser">
        <p className="organiser__status" role="status">
          Loading attempt review…
        </p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main id="main-content" className="organiser">
        <p className="field-error" role="alert">
          {error ?? "Attempt review could not be loaded."}
        </p>
        {onBack && (
          <button
            type="button"
            className="button"
            onClick={onBack}
          >
            ← Back
          </button>
        )}
      </main>
    );
  }

  return (
    <main id="main-content" className="organiser organiser--wide">
      <AttemptReview review={data} {...(onBack ? { onBack } : {})} />
    </main>
  );
}
