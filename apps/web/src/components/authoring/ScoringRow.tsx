import { useId } from "react";
import { APPLICABLE_MODES, type QuestionType, type ScoringConfig, type ScoringMode } from "@pariksha/core";

// Reads APPLICABLE_MODES from @pariksha/core rather than keeping its own
// list, so the UI and validateBank can never disagree about which scoring
// modes a type accepts.
export function ScoringRow({
  type,
  value,
  onChange,
}: {
  type: QuestionType;
  value: ScoringConfig;
  onChange: (next: ScoringConfig) => void;
}) {
  const id = useId();
  const modes = APPLICABLE_MODES[type];

  function setMode(mode: string): void {
    const next = { ...value };
    if (mode === "") delete next.mode;
    else next.mode = mode as ScoringMode;
    onChange(next);
  }

  function setPoints(raw: string): void {
    const next = { ...value };
    if (raw === "") delete next.points;
    else next.points = Number(raw);
    onChange(next);
  }

  function setNegativeFraction(raw: string): void {
    const next = { ...value };
    if (raw === "") delete next.negative_fraction;
    else next.negative_fraction = Number(raw);
    onChange(next);
  }

  return (
    <div className="scoring-row">
      <label className="field-label" htmlFor={`${id}-mode`}>
        Scoring mode
      </label>
      <select id={`${id}-mode`} value={value.mode ?? ""} onChange={(event) => setMode(event.target.value)}>
        <option value="">Default</option>
        {modes.map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>

      <label className="field-label" htmlFor={`${id}-points`}>
        Points
      </label>
      <input
        className="text-input"
        id={`${id}-points`}
        type="number"
        min={0}
        value={value.points ?? ""}
        onChange={(event) => setPoints(event.target.value)}
      />

      {value.mode === "negative" && (
        <>
          <label className="field-label" htmlFor={`${id}-negative`}>
            Negative fraction
          </label>
          <input
            className="text-input"
            id={`${id}-negative`}
            type="number"
            min={0}
            max={1}
            step={0.1}
            value={value.negative_fraction ?? ""}
            onChange={(event) => setNegativeFraction(event.target.value)}
          />
        </>
      )}
    </div>
  );
}
