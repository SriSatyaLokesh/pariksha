import { useEffect, useState } from "react";

/**
 * C-04's two view controls: text size and high contrast.
 *
 * Both write a data attribute on `<html>` and mirror it into
 * `localStorage`. That is the whole mechanism — `exam.css` is a token swap
 * keyed off those attributes, so no component branches on contrast and no
 * component measures a font size. A candidate who turns the text up and
 * then reloads (or whose browser restarts mid-attempt, which C-06 says
 * must work) gets their setting back.
 */
export type FontScale = 1 | 1.25 | 1.5;

const SCALES: readonly { value: FontScale; label: string }[] = [
  { value: 1, label: "Normal text" },
  { value: 1.25, label: "Medium text" },
  { value: 1.5, label: "Large text" },
];

const SCALE_KEY = "pariksha.view.fontScale";
const CONTRAST_KEY = "pariksha.view.contrast";

/** Storage throws in a locked-down browser profile, and a view preference
 * is never worth taking a live attempt down for. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a preference that cannot be remembered still applies to this tab */
  }
}

function storedScale(): FontScale {
  const found = SCALES.find((scale) => String(scale.value) === read(SCALE_KEY));
  return found?.value ?? 1;
}

/**
 * The state behind `ViewControls`. It lives in a hook rather than in the
 * component so the preference survives the component — `Runner` holds it,
 * and remounting the runner re-reads storage instead of resetting a
 * candidate's text size to default mid-attempt.
 */
export function useViewPreferences() {
  const [fontScale, setFontScale] = useState<FontScale>(storedScale);
  const [highContrast, setHighContrast] = useState(() => read(CONTRAST_KEY) === "high");

  useEffect(() => {
    document.documentElement.dataset.fontScale = String(fontScale);
    write(SCALE_KEY, String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    const value = highContrast ? "high" : "normal";
    document.documentElement.dataset.contrast = value;
    write(CONTRAST_KEY, value);
  }, [highContrast]);

  return { fontScale, onFontScale: setFontScale, highContrast, onHighContrast: setHighContrast };
}

export function ViewControls({
  fontScale,
  onFontScale,
  highContrast,
  onHighContrast,
}: {
  fontScale: FontScale;
  onFontScale: (scale: FontScale) => void;
  highContrast: boolean;
  onHighContrast: (on: boolean) => void;
}) {
  return (
    <div className="exam-view-controls">
      <fieldset className="exam-font-scale">
        <legend>Text size</legend>
        {SCALES.map((scale) => (
          <label key={scale.value} className="exam-view-choice">
            <input
              type="radio"
              name="exam-font-scale"
              value={scale.value}
              checked={fontScale === scale.value}
              onChange={() => {
                onFontScale(scale.value);
              }}
            />
            <span>{scale.label}</span>
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        role="switch"
        className="exam-contrast-switch"
        aria-checked={highContrast}
        onClick={() => {
          onHighContrast(!highContrast);
        }}
      >
        High contrast
      </button>
    </div>
  );
}
