import { useId } from "react";
import { APPLICABLE_MODES, type QuestionType, type ScoringConfig, type ScoringMode } from "@pariksha/core";

// Reads APPLICABLE_MODES from @pariksha/core rather than keeping its own
// list, so the UI and validateBank can never disagree about which scoring
// modes a type accepts.

// G4-10: the wire value, spelled for an author rather than for validateBank.
const MODE_LABELS: Record<ScoringMode, string> = {
  all_or_nothing: "All or nothing",
  partial: "Partial credit",
  negative: "Negative marking",
  position: "Position",
  rubric: "Rubric",
};
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
    else {
      const parsed = Number(raw);
      // An in-progress or unparseable value ("-", "1e") is not a number
      // yet — ignore the keystroke rather than writing NaN into state,
      // which would otherwise save and only fail much later, at
      // validateBank or export.
      if (!Number.isFinite(parsed)) return;
      next.points = parsed;
    }
    onChange(next);
  }

  function setNegativeFraction(raw: string): void {
    const next = { ...value };
    if (raw === "") delete next.negative_fraction;
    else {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) return;
      next.negative_fraction = parsed;
    }
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
            {MODE_LABELS[mode]}
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
