import type { JSX } from "react";
import type { AttemptReviewData } from "../../lib/api";

export interface AttemptReviewProps {
  review: AttemptReviewData;
  onBack?: (() => void) | undefined;
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

function isSingleOptionId(str: string): boolean {
  return /^[a-zA-Z0-9]$/.test(str);
}

function renderCandidateAnswer(answer: unknown, key?: unknown): JSX.Element | string {
  if (answer === null || answer === undefined) return "—";

  if (typeof answer === "string") {
    if (isSingleOptionId(answer)) {
      return (
        <span className="attempt-review__choice-badge">
          {answer.toUpperCase()}
        </span>
      );
    }
    return answer;
  }

  if (typeof answer === "number" || typeof answer === "boolean") {
    return String(answer);
  }

  if (typeof answer === "object") {
    const obj = answer as Record<string, unknown>;
    const kind = obj.kind;

    if (kind === "option" && typeof obj.option === "string") {
      const isMatch = typeof key === "string" && key.toLowerCase() === obj.option.toLowerCase();
      return (
        <span
          className={`attempt-review__choice-badge ${
            key !== undefined
              ? isMatch
                ? "attempt-review__choice-badge--match"
                : "attempt-review__choice-badge--mismatch"
              : ""
          }`}
        >
          {obj.option.toUpperCase()}
        </span>
      );
    }

    if (kind === "options" && Array.isArray(obj.options)) {
      const keyArr = Array.isArray(key)
        ? (key as string[]).map((k) => String(k).toLowerCase())
        : null;
      return (
        <div className="attempt-review__badge-group">
          {obj.options.map((opt, i) => {
            const optStr = String(opt);
            const isMatch = keyArr ? keyArr.includes(optStr.toLowerCase()) : null;
            return (
              <span
                key={i}
                className={`attempt-review__choice-badge ${
                  isMatch === true
                    ? "attempt-review__choice-badge--match"
                    : isMatch === false
                      ? "attempt-review__choice-badge--mismatch"
                      : ""
                }`}
              >
                {optStr.toUpperCase()} {isMatch === true ? "✓" : isMatch === false ? "✕" : ""}
              </span>
            );
          })}
        </div>
      );
    }

    if (kind === "number" && typeof obj.value === "number") {
      return <span className="attempt-review__numeric-value">{String(obj.value)}</span>;
    }

    if (kind === "blanks" && obj.values && typeof obj.values === "object") {
      const entries = Object.entries(obj.values as Record<string, unknown>);
      if (entries.length === 0) return "—";
      return (
        <div className="attempt-review__blank-group">
          {entries.map(([k, v]) => (
            <span key={k} className="attempt-review__blank-chip mono-caption">
              {k}: {typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : "—"}
            </span>
          ))}
        </div>
      );
    }

    if (kind === "map" && obj.pairs && typeof obj.pairs === "object") {
      const entries = Object.entries(obj.pairs as Record<string, unknown>);
      if (entries.length === 0) return "—";
      return (
        <table className="attempt-review__match-table">
          <tbody>
            {entries.map(([left, right]) => (
              <tr key={left}>
                <td className="attempt-review__match-left">{left}</td>
                <td className="attempt-review__match-arrow" aria-hidden="true">➔</td>
                <td className="attempt-review__match-right">
                  {typeof right === "string" || typeof right === "number" ? String(right) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (kind === "text" && typeof obj.text === "string") {
      return <p className="attempt-review__text-answer">{obj.text}</p>;
    }

    if (kind === "order" && Array.isArray(obj.order)) {
      return (
        <ol className="attempt-review__order-list">
          {obj.order.map((item, idx) => (
            <li key={idx}>
              {typeof item === "string" || typeof item === "number" ? String(item) : "—"}
            </li>
          ))}
        </ol>
      );
    }

    try {
      return JSON.stringify(answer);
    } catch {
      return "—";
    }
  }

  return typeof answer === "number" || typeof answer === "boolean" ? String(answer) : "—";
}

function renderCorrectKey(key: unknown): JSX.Element | string {
  if (key === null || key === undefined) return "—";

  if (typeof key === "string") {
    if (isSingleOptionId(key)) {
      return (
        <span className="attempt-review__choice-badge">
          {key.toUpperCase()}
        </span>
      );
    }
    return key;
  }

  if (typeof key === "number" || typeof key === "boolean") {
    return String(key);
  }

  if (Array.isArray(key)) {
    return (
      <div className="attempt-review__badge-group">
        {key.map((item, idx) => (
          <span key={idx} className="attempt-review__choice-badge">
            {typeof item === "string" ? item.toUpperCase() : String(item)}
          </span>
        ))}
      </div>
    );
  }

  if (typeof key === "object") {
    const obj = key as Record<string, unknown>;

    // NumericKey { value: number, tolerance?: number, tolerance_type?: string }
    if ("value" in obj && typeof obj.value === "number") {
      const tolerance = obj.tolerance;
      const tolType = obj.tolerance_type === "percent" ? "%" : "";
      return (
        <span className="attempt-review__numeric-key">
          {obj.value}
          {typeof tolerance === "number" ? ` (± ${tolerance}${tolType})` : ""}
        </span>
      );
    }

    // Map or Blanks dictionary
    const entries = Object.entries(obj);
    if (entries.length > 0) {
      return (
        <table className="attempt-review__match-table">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k}>
                <td className="attempt-review__match-left">{k}</td>
                <td className="attempt-review__match-arrow" aria-hidden="true">➔</td>
                <td className="attempt-review__match-right">
                  {Array.isArray(v)
                    ? v.map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : "—")).join(", ")
                    : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
                      ? String(v)
                      : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    try {
      return JSON.stringify(key);
    } catch {
      return "—";
    }
  }

  return typeof key === "number" || typeof key === "boolean" ? String(key) : "—";
}

interface AnswerReviewCardProps {
  ans: AttemptReviewData["answers"][number];
  index: number;
}

function AnswerReviewCard({ ans, index }: AnswerReviewCardProps): JSX.Element {
  const isCorrect = ans.verdict === "correct" || ans.correct === true;
  const isIncorrect = ans.verdict === "incorrect" || ans.correct === false;
  const verdictClass = isCorrect
    ? "status-badge--pass"
    : isIncorrect
      ? "status-badge--fail"
      : "";

  return (
    <div className="attempt-review__answer-card card-hairline">
      <div className="attempt-review__answer-header">
        <div className="attempt-review__answer-title-row">
          <span className="mono-caption">Question {index + 1}</span>
          {ans.verdict && (
            <span className={`status-badge ${verdictClass}`}>
              {isCorrect ? "✓ Correct" : isIncorrect ? "✕ Incorrect" : ans.verdict}
            </span>
          )}
        </div>
        <span className="mono-caption">
          Points: {ans.pointsAwarded ?? "—"} / {ans.maxPoints}
        </span>
      </div>

      {ans.prompt && (
        <div className="attempt-review__question-prompt">
          {ans.prompt}
        </div>
      )}

      <div className="attempt-review__answer-body">
        <div>
          <span className="field-label">Candidate Answer:</span>
          <div className="attempt-review__answer-box">
            {renderCandidateAnswer(ans.answer, ans.key)}
          </div>
        </div>
        <div>
          <span className="field-label">Correct Key:</span>
          <div className="attempt-review__answer-box">
            {renderCorrectKey(ans.key)}
          </div>
        </div>
      </div>
    </div>
  );
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

              const isSpeech = item.eventKind === "speech_detected";
              const transcript = typeof item.details?.transcript === "string" ? item.details.transcript : null;
              const source = typeof item.details?.source === "string" ? item.details.source : "audio";

              return (
                <li
                  key={`event-${idx}`}
                  className={`attempt-review__timeline-event card-hairline ${isSpeech ? "attempt-review__timeline-event--speech" : ""}`}
                >
                  <div className="attempt-review__event-meta">
                    <span className="mono-caption">
                      {isSpeech ? "Speech Detected" : `Event: ${item.eventKind ?? "unspecified"}`}
                    </span>
                    {isSpeech ? (
                      <span className="badge badge--neutral">
                        {source.toUpperCase()}
                      </span>
                    ) : item.flagged ? (
                      <span className="badge badge--flagged">
                        {item.reason ? item.reason : "Flagged"}
                      </span>
                    ) : null}
                    <time
                      dateTime={new Date(item.timestamp).toISOString()}
                      className="mono-caption"
                    >
                      {formatTime(item.timestamp)}
                    </time>
                  </div>
                  {isSpeech && transcript && (
                    <p className="attempt-review__transcript field-help" style={{ marginTop: "0.25rem", fontStyle: "italic" }}>
                      &ldquo;{transcript}&rdquo;
                    </p>
                  )}
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
                      <AnswerReviewCard
                        key={ans.questionId || aIdx}
                        ans={ans}
                        index={aIdx}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="attempt-review__answers-grid">
            {answers.map((ans, aIdx) => (
              <AnswerReviewCard
                key={ans.questionId || aIdx}
                ans={ans}
                index={aIdx}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
