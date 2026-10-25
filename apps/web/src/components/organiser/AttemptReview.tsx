import type { JSX } from "react";
import type { AttemptReviewData } from "../../lib/api";

export interface AttemptReviewProps {
  review: AttemptReviewData;
  onBack?: () => void;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return String(ts);
  }
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return JSON.stringify(val);
}

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

export function AttemptReview({ review, onBack }: AttemptReviewProps): JSX.Element {
  const { attempt, registration, identityPhotoUrl, timeline, answers, sectionScores } = review;

  return (
    <div className="attempt-review">
      <header className="attempt-review__header">
        {onBack && (
          <button
            type="button"
            className="button"
            onClick={onBack}
            aria-label="Back to attempts"
          >
            ← Back
          </button>
        )}
        <h1 className="attempt-review__title">Attempt Review</h1>
      </header>

      {/* Top summary row: candidate info, identity photo, score & status */}
      <div className="attempt-review__top-grid">
        <section
          aria-labelledby="review-registration-heading"
          className="attempt-review__section card-hairline"
        >
          <h2 id="review-registration-heading" className="field-label">
            Candidate Information
          </h2>
          <div className="attempt-review__identity-container">
            {identityPhotoUrl ? (
              <div className="attempt-review__photo-wrapper">
                <img
                  src={identityPhotoUrl}
                  alt="Identity photo of candidate"
                  className="attempt-review__photo"
                />
              </div>
            ) : null}
            <dl className="attempt-review__dl">
              {Object.entries(registration).map(([key, val]) => (
                <div key={key} className="attempt-review__dl-item">
                  <dt className="mono-caption">{formatKey(key)}</dt>
                  <dd>{formatValue(val)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          aria-labelledby="review-score-heading"
          className="attempt-review__section card-hairline"
        >
          <h2 id="review-score-heading" className="field-label">
            Score Summary
          </h2>
          <div className="attempt-review__score-box">
            <div className="attempt-review__score-total">
              <span className="mono-caption">Total Score</span>
              <p className="attempt-review__score-value">
                {attempt.totalScore ?? "—"} / {attempt.maxScore ?? "—"}
              </p>
            </div>
            <dl className="attempt-review__dl">
              <div className="attempt-review__dl-item">
                <dt className="mono-caption">Status</dt>
                <dd>{attempt.status}</dd>
              </div>
              <div className="attempt-review__dl-item">
                <dt className="mono-caption">Integrity Flag</dt>
                <dd>{attempt.integrityFlag}</dd>
              </div>
              <div className="attempt-review__dl-item">
                <dt className="mono-caption">Observation</dt>
                <dd>{attempt.observed ? "Observed" : "Unobserved"}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>

      {/* Proctoring Timeline & Snapshots */}
      <section
        aria-labelledby="review-timeline-heading"
        className="attempt-review__section card-hairline"
      >
        <h2 id="review-timeline-heading" className="field-label">
          Timeline & Evidence
        </h2>
        {timeline.length === 0 ? (
          <p className="field-help">No proctoring timeline entries recorded.</p>
        ) : (
          <ol className="attempt-review__timeline-list">
            {timeline.map((item, idx) => {
              if (item.kind === "snapshot") {
                return (
                  <li
                    key={`snap-${idx}`}
                    className={`attempt-review__timeline-item card-hairline ${
                      item.flagged ? "attempt-review__timeline-item--flagged" : ""
                    }`}
                  >
                    {item.snapshotUrl ? (
                      <img
                        src={item.snapshotUrl}
                        alt={`Snapshot at ${formatTime(item.timestamp)}`}
                        className="attempt-review__snapshot-thumb"
                      />
                    ) : null}
                    <div className="attempt-review__timeline-meta">
                      <time
                        dateTime={new Date(item.timestamp).toISOString()}
                        className="mono-caption"
                      >
                        {formatTime(item.timestamp)}
                      </time>
                      {item.flagged && (
                        <span className="badge badge--flagged">
                          {item.reason ? item.reason : "Violation"}
                        </span>
                      )}
                      <div className="field-help">
                        Face count:{" "}
                        {item.faceCount != null ? item.faceCount : "Not counted"}
                      </div>
                    </div>
                  </li>
                );
              }

              if (item.kind === "unobserved") {
                return (
                  <li
                    key={`unobserved-${idx}`}
                    className="attempt-review__timeline-gap card-hairline"
                  >
                    <div className="attempt-review__gap-content" role="status">
                      <span className="attempt-review__gap-badge">
                        Unobserved period
                      </span>
                      {item.reason ? (
                        <span className="field-help">({item.reason})</span>
                      ) : null}
                      <time
                        dateTime={new Date(item.timestamp).toISOString()}
                        className="mono-caption"
                      >
                        {formatTime(item.timestamp)}
                      </time>
                    </div>
                  </li>
                );
              }

              return (
                <li
                  key={`event-${idx}`}
                  className="attempt-review__timeline-event card-hairline"
                >
                  <div className="attempt-review__event-meta">
                    <span className="mono-caption">
                      Event: {item.eventKind ?? "unspecified"}
                    </span>
                    {item.flagged && (
                      <span className="badge badge--flagged">
                        {item.reason ? item.reason : "Flagged"}
                      </span>
                    )}
                    <time
                      dateTime={new Date(item.timestamp).toISOString()}
                      className="mono-caption"
                    >
                      {formatTime(item.timestamp)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Candidate Answers against Keys */}
      <section
        aria-labelledby="review-answers-heading"
        className="attempt-review__section card-hairline"
      >
        <h2 id="review-answers-heading" className="field-label">
          Candidate Answers & Keys
        </h2>

        {sectionScores.length > 0 ? (
          <div className="attempt-review__sections-summary">
            {sectionScores.map((sec) => (
              <div key={sec.sectionId} className="attempt-review__section-card">
                <h3 className="attempt-review__section-title">{sec.title}</h3>
                <p className="mono-caption">
                  Section Score: {sec.score} of {sec.maxScore} pts
                </p>

                <div className="attempt-review__answers-grid">
                  {answers
                    .filter((a) => a.sectionId === sec.sectionId)
                    .map((ans, aIdx) => (
                      <div
                        key={ans.questionId || aIdx}
                        className="attempt-review__answer-card card-hairline"
                      >
                        <div className="attempt-review__answer-header">
                          <span className="mono-caption">
                            Question {aIdx + 1}
                          </span>
                          <span className="mono-caption">
                            Points: {ans.pointsAwarded ?? "—"} / {ans.maxPoints}
                          </span>
                        </div>
                        <div className="attempt-review__answer-body">
                          <div>
                            <span className="field-label">Candidate Answer:</span>
                            <div className="attempt-review__code-box">
                              {formatValue(ans.answer)}
                            </div>
                          </div>
                          <div>
                            <span className="field-label">Correct Key:</span>
                            <div className="attempt-review__code-box">
                              {formatValue(ans.key)}
                            </div>
                          </div>
                        </div>
                        {ans.verdict ? (
                          <div className="attempt-review__answer-footer field-help">
                            Verdict: {ans.verdict}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="attempt-review__answers-grid">
            {answers.map((ans, aIdx) => (
              <div
                key={ans.questionId || aIdx}
                className="attempt-review__answer-card card-hairline"
              >
                <div className="attempt-review__answer-header">
                  <span className="mono-caption">Question {aIdx + 1}</span>
                  <span className="mono-caption">
                    Points: {ans.pointsAwarded ?? "—"} / {ans.maxPoints}
                  </span>
                </div>
                <div className="attempt-review__answer-body">
                  <div>
                    <span className="field-label">Candidate Answer:</span>
                    <div className="attempt-review__code-box">
                      {formatValue(ans.answer)}
                    </div>
                  </div>
                  <div>
                    <span className="field-label">Correct Key:</span>
                    <div className="attempt-review__code-box">
                      {formatValue(ans.key)}
                    </div>
                  </div>
                </div>
                {ans.verdict ? (
                  <div className="attempt-review__answer-footer field-help">
                    Verdict: {ans.verdict}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
