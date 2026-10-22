import { useId, useState, type JSX, type ReactNode } from "react";
import {
  resolveProctoring,
  type ProctoringOverrides,
  type ProctoringProfile,
  type ViolationAction,
} from "@pariksha/core";

// Phase 7b Task 2 (`Q8`): the fifteen overrides, in the three groups `Q8`
// names — gating, camera and microphone, consequences. Task 1 shipped the
// shell this fills; Task 3 adds the profile control itself and the "changed
// from its profile default" marker, which is why every field below still
// has a reserved, empty help track (`.field-row`'s own geometry) rather than
// one filled with field-specific copy — Task 3 needs that slot. `Q8a`'s
// "profile is the panel's first control" is Task 3's to build, not this
// one's.
//
// `D16`'s content rule, applied three times over: a UNIT goes inside the
// control as an affix (`seconds`, `violations`, `snapshots`), a constraint
// or consequence goes in a field's own help line, and an explanation of the
// WHOLE GROUP is one note under the row — never help per field, which is
// what would otherwise repeat the same sentence five or six times. `Q3`'s
// face-check copy is the one deliberate exception: it is not a group fact,
// it is the reason ONE control is unusable, and `D16a` requires every id
// that copy is reached by to come from this instance's own `useId()`.
//
// `R2` (pre-flight ruling, progress.md): `.field-row` / `.field` /
// `.field-row > .field > *` are `primitives.css:194-233`'s existing D16
// primitive — subgrid, three tracks, the `@supports not (...)` fallback
// that reserves the help track already written. Nothing below declares that
// geometry a second time; every group is one `.field-row` and every control
// is one `.field` inside it, the same construct `FormBuilder.tsx` and
// `QuestionEditor.tsx` already render fields into.
//
// R1 (packages/core/src/proctoring.ts): never `||`, never a bare `??` on an
// overridable key — `0` and `false` are real settings (`Q11b`) and either
// operator would silently replace one with the profile default. `setOverride`
// below writes the key through explicitly, in both directions, the same
// discipline `overrideOr` applies on the read side.

type BoolOverrideKey = Extract<
  keyof ProctoringOverrides,
  | "desktop_only"
  | "require_fullscreen"
  | "block_copy_paste"
  | "watermark"
  | "require_camera"
  | "identity_photo"
  | "require_microphone"
  | "extra_monitor_check"
  | "allow_calculator"
>;

type NumberOverrideKey = Extract<
  keyof ProctoringOverrides,
  "snapshot_interval_seconds" | "violation_limit" | "camera_outage_seconds" | "multi_face_snapshots"
>;

const VIOLATION_ACTION_LABEL: Readonly<Record<ViolationAction, string>> = {
  warn_only: "Warn only",
  warn_then_flag: "Warn, then flag",
  auto_submit: "Auto-submit",
  lock: "Lock (needs an organiser to reopen)",
};

/**
 * A number box whose empty state means "not typed yet" rather than `0` —
 * `Number("") === 0` would otherwise commit a floor-violating value on the
 * very first backspace. Modelled on `TimingPanel.tsx`'s own `NumberField`;
 * not shared with it (that file's own comment explains why one helper
 * spanning every number box in this builder would be bigger than the two
 * or three it would serve) and this one additionally carries a `D16` unit
 * affix, which `TimingPanel`'s does not need.
 *
 * `min={0}` on `snapshot_interval_seconds` is what makes `Q11b` possible at
 * all: the committed value is read and written as the real number the
 * control holds, never `value || fallback`, so `0` renders as `0` and a
 * clear-then-type-`0` round-trip sends `0` up rather than being read as
 * "nothing typed yet."
 */
function NumberField({
  id,
  label,
  min,
  unit,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  min: number;
  unit: string;
  value: number;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [blank, setBlank] = useState(false);
  const unitId = `${id}-unit`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <span className="field-affix">
        <input
          className="text-input"
          id={id}
          type="number"
          min={min}
          value={blank ? "" : value}
          aria-describedby={unitId}
          onChange={(event) => {
            const next = event.target.value;
            setBlank(next === "");
            const parsed = Number(next);
            if (next !== "" && Number.isFinite(parsed)) onCommit(parsed);
          }}
          onBlur={() => setBlank(false)}
        />
        <span className="field-affix__unit" id={unitId}>
          {unit}
        </span>
      </span>
    </div>
  );
}

export function ProctoringPanel({
  value,
  durationMinutes,
  onChange,
}: {
  value: { profile: ProctoringProfile; overrides: ProctoringOverrides };
  durationMinutes: number | null;
  onChange: (next: { profile: ProctoringProfile; overrides: ProctoringOverrides }) => void;
}): JSX.Element {
  // Task 4's cost clause reads this; nothing here does yet.
  void durationMinutes;

  const ids = useId();
  const resolved = resolveProctoring(value);

  /** Writes one override key through explicitly — `next` and all, never
   *  merged through `||` or dropped by a bare `??`. Same shape as
   *  `TimingPanel.tsx`'s `withKey` and `AccessPanel.tsx`'s `omit`: a fresh
   *  copy, one key assigned, handed to `onChange` whole. */
  function setOverride<K extends keyof ProctoringOverrides>(key: K, next: ProctoringOverrides[K]): void {
    const overrides: ProctoringOverrides = { ...value.overrides };
    overrides[key] = next;
    onChange({ profile: value.profile, overrides });
  }

  function checkboxField(key: BoolOverrideKey, label: string, checked: boolean): JSX.Element {
    const fieldId = `${ids}-${key}`;
    return (
      <div className="field" key={key}>
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
        <input
          type="checkbox"
          id={fieldId}
          checked={checked}
          onChange={(event) => setOverride(key, event.target.checked)}
        />
      </div>
    );
  }

  function numberField(key: NumberOverrideKey, label: string, min: number, unit: string, value: number): JSX.Element {
    return (
      <NumberField
        key={key}
        id={`${ids}-${key}`}
        label={label}
        min={min}
        unit={unit}
        value={value}
        onCommit={(next) => setOverride(key, next)}
      />
    );
  }

  function group(legend: string, fields: ReactNode[], note: string): JSX.Element {
    return (
      <fieldset className="proctoring-panel__group">
        <legend>{legend}</legend>
        <div className="field-row">{fields}</div>
        <p className="field-help">{note}</p>
      </fieldset>
    );
  }

  const faceCheckHelpId = `${ids}-face_check-help`;

  const headingId = `${ids}-heading`;

  return (
    <section className="proctoring-panel" role="group" aria-labelledby={headingId}>
      <h2 id={headingId}>Proctoring</h2>

      {group(
        "Gating",
        [
          checkboxField("desktop_only", "Block phones and tablets", resolved.desktopOnly),
          checkboxField("require_fullscreen", "Require fullscreen", resolved.requireFullscreen),
          checkboxField("block_copy_paste", "Block copy and paste", resolved.blockCopyPaste),
          checkboxField("watermark", "Watermark the paper", resolved.watermark),
          checkboxField("extra_monitor_check", "Detect extra monitors", resolved.extraMonitorCheck),
          checkboxField("allow_calculator", "Allow the calculator", resolved.allowCalculator),
        ],
        "These restrict what the candidate's browser lets them do while the test is open. They deter — none of them survive a photograph of the screen or a second device.",
      )}

      {group(
        "Camera and microphone",
        [
          checkboxField("require_camera", "Require a camera", resolved.requireCamera),
          checkboxField("identity_photo", "Identity photo", resolved.identityPhoto),
          numberField(
            "snapshot_interval_seconds",
            "Images every",
            0,
            "seconds",
            resolved.snapshotIntervalSeconds,
          ),
          // `Q3`: pre-cut and shipped disabled. The raw document value is
          // shown, not `resolved.faceCheck` (always `false` — the
          // enforcement refusal is `resolveProctoring`'s, not a fact about
          // what an imported document holds), so a document authored for
          // Phase 8 round-trips visibly even though nothing here can act on
          // it yet.
          <div className="field" key="face_check">
            <label className="field-label" htmlFor={`${ids}-face_check`}>
              Count faces in each image
            </label>
            <input
              type="checkbox"
              id={`${ids}-face_check`}
              checked={value.overrides.face_check ?? false}
              disabled
              aria-describedby={faceCheckHelpId}
            />
            <p className="field-help" id={faceCheckHelpId}>
              On-device face counting ships in Phase 8. This control is disabled until then.
            </p>
          </div>,
          checkboxField("require_microphone", "Require a microphone", resolved.requireMicrophone),
        ],
        "A camera or microphone only starts if one of these needs it, and turning either off removes its indicator for the candidate too. Snapshots stop entirely at an interval of 0; the microphone's level is monitored and nothing is ever recorded or stored.",
      )}

      {group(
        "Consequences",
        [
          numberField("violation_limit", "Warn after", 1, "violations", resolved.violationLimit),
          <div className="field" key="violation_action">
            <label className="field-label" htmlFor={`${ids}-violation_action`}>
              When the limit is reached
            </label>
            <select
              className="text-input"
              id={`${ids}-violation_action`}
              value={resolved.violationAction}
              onChange={(event) => setOverride("violation_action", event.target.value as ViolationAction)}
            >
              {(Object.keys(VIOLATION_ACTION_LABEL) as ViolationAction[]).map((action) => (
                <option key={action} value={action}>
                  {VIOLATION_ACTION_LABEL[action]}
                </option>
              ))}
            </select>
          </div>,
          numberField(
            "camera_outage_seconds",
            "Camera may be lost for",
            1,
            "seconds",
            resolved.cameraOutageSeconds,
          ),
          numberField(
            "multi_face_snapshots",
            "Flag on faces in",
            1,
            "snapshots",
            resolved.multiFaceSnapshots,
          ),
        ],
        "A violation counts toward the limit above; a camera outage or a crowded snapshot marks the attempt for review instead — two different axes, never added together. Locking needs an organiser to reopen the attempt.",
      )}
    </section>
  );
}
