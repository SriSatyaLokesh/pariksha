import { useId, useState, type JSX, type ReactNode } from "react";
import {
  resolveProctoring,
  snapshotCost,
  PROCTORING_DEFAULTS,
  PROFILE_LABEL,
  type ProctoringOverrides,
  type ProctoringProfile,
  type ResolvedProctoring,
  type ViolationAction,
} from "@pariksha/core";
import { useDialogKeys } from "../useDialogKeys";

// Phase 7b Task 2 (`Q8`): the fifteen overrides, in the three groups `Q8`
// names — gating, camera and microphone, consequences. Task 1 shipped the
// shell this fills; Task 3 (`Q8a`) adds the profile control itself, the
// "changed from its profile default" marker, and the confirmation that
// fires when changing the profile would discard a real edit.
//
// Task 3's two additions, in the field-row's own vocabulary (`D16`): the
// marker is a CONSTRAINT about one field — "this no longer matches the
// profile" — so it lives in that field's own help track, never in a
// fifteen-times-repeated group note. `R1` (task-3-brief.md): no group is
// named for an individual control (Task 2 shipped exactly two kinds —
// the three `<fieldset>`s and the panel's own `role="group"`), so the
// marker is wired through `aria-describedby` from this instance's own
// `useId()` rather than reached by a `getByRole("group", { name })` query
// that nothing here could ever satisfy.
//
// "Differs" (`overriddenKeys` below) is the same presence discipline
// `overrideOr` applies in `packages/core/src/proctoring.ts`: `key in
// overrides && overrides[key] !== undefined`, computed against
// `PROCTORING_DEFAULTS[profile]` field by field. An absent key, or one
// explicitly set to `undefined`, is not a difference — and `0` or `false`
// are real values that can differ from a `true`/non-zero default just as
// much as the reverse. Never `||`, never a bare `??`.
//
// The confirmation (`R2`, `R3`): changing the profile always clears the
// overrides (`Q8a`'s ruling), and asks first, naming the count, only when
// at least one override actually differs from the OLD profile's defaults —
// an override present but already equal to what it is about to lose is not
// a change and is not counted. Unlike the candidate's Q2b overlay, this
// dialog takes Escape: it is a cancellable confirmation on the organiser's
// own surface, not a condition the candidate must resolve.
//
// `D16`'s content rule, applied three times over: a UNIT goes inside the
// control as an affix (`seconds`, `violations`, `snapshots`), a constraint
// or consequence goes in a field's own help line, and an explanation of the
// WHOLE GROUP is one note under the row — never help per field, which is
// what would otherwise repeat the same sentence five or six times. `Q3`'s
// face-check copy and `Q12b`'s microphone copy (issue 209) are the two
// remaining deliberate exceptions — each is not a group fact, it is the
// reason ONE control is unusable — and `violation_action`'s own help line
// is a third, different kind: `lock`'s own consequence (`proctoring_lock_
// without_recourse`, `apps/api/src/publish/checklist.ts`), now that Phase
// 7e Task 3 re-enabled the control issue 214 shipped disabled. `D16a`
// requires every id that copy is reached by to come from this instance's
// own `useId()`.
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
  | "extra_monitor_check"
  | "allow_calculator"
>;

type NumberOverrideKey = Extract<
  keyof ProctoringOverrides,
  "snapshot_interval_seconds" | "violation_limit" | "camera_outage_seconds" | "multi_face_snapshots"
>;

/** Every override key's resolved counterpart, so one generic function can
 *  read `PROCTORING_DEFAULTS[profile]` for any of the fifteen without
 *  fifteen hand-written branches. `face_check` is included on the same
 *  footing as the other fourteen — it accepts and round-trips an override
 *  (Task 2's comment on the field below), so whether IT differs from its
 *  profile default is answerable the same way, even though resolution
 *  itself refuses to act on it (`Q3`). This table does not touch which
 *  value the checkbox renders — that stays `value.overrides.face_check`,
 *  per the brief's own standing ruling. */
const OVERRIDE_KEY_TO_RESOLVED: Readonly<Record<keyof ProctoringOverrides, keyof ResolvedProctoring>> = {
  desktop_only: "desktopOnly",
  require_fullscreen: "requireFullscreen",
  block_copy_paste: "blockCopyPaste",
  watermark: "watermark",
  require_camera: "requireCamera",
  identity_photo: "identityPhoto",
  snapshot_interval_seconds: "snapshotIntervalSeconds",
  face_check: "faceCheck",
  require_microphone: "requireMicrophone",
  ai_audio_check: "aiAudioCheck",
  extra_monitor_check: "extraMonitorCheck",
  violation_limit: "violationLimit",
  violation_action: "violationAction",
  camera_outage_seconds: "cameraOutageSeconds",
  multi_face_snapshots: "multiFaceSnapshots",
  allow_calculator: "allowCalculator",
};

/**
 * The override keys that actually differ from `profile`'s own defaults —
 * what Task 3's marker marks, and what the confirmation dialog counts.
 * Same presence rule as `overrideOr` (`packages/core/src/proctoring.ts`):
 * `key in overrides && overrides[key] !== undefined`. An absent key, or an
 * explicit `undefined`, is not a difference; `snapshot_interval_seconds: 0`
 * is a real value and is compared on equal footing with every other one.
 * A pure function of `(profile, overrides)` rather than a method closed
 * over `value`, so the confirmation can ask "what would change AWAY FROM
 * the profile being left" without needing a second copy once `onChange`
 * has already moved `value.profile` on.
 */
function overriddenKeys(
  profile: ProctoringProfile,
  overrides: ProctoringOverrides,
): (keyof ProctoringOverrides)[] {
  const defaults = PROCTORING_DEFAULTS[profile];
  return (Object.keys(OVERRIDE_KEY_TO_RESOLVED) as (keyof ProctoringOverrides)[]).filter((key) => {
    if (!(key in overrides) || overrides[key] === undefined) return false;
    return overrides[key] !== defaults[OVERRIDE_KEY_TO_RESOLVED[key]];
  });
}

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
  marker,
}: {
  id: string;
  label: string;
  min: number;
  unit: string;
  value: number;
  onCommit: (value: number) => void;
  /** Task 3: the "changed from Strict" help paragraph, when this field's
   *  override differs from its profile default — `undefined` otherwise, so
   *  an unmarked field carries no second id. Rendered by the caller (so the
   *  marker's own id and text stay in one place, `fieldHelp` below) and
   *  passed in whole, the same shape `TimingPanel.tsx`'s `NumberField`
   *  takes `children` for its own facts. */
  marker?: { id: string; node: ReactNode } | undefined;
}): JSX.Element {
  const [blank, setBlank] = useState(false);
  const unitId = `${id}-unit`;
  const describedBy = marker === undefined ? unitId : `${unitId} ${marker.id}`;
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
          aria-describedby={describedBy}
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
      {marker?.node}
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
  const ids = useId();
  const resolved = resolveProctoring(value);

  // `Q11`/`Q11a` (Task 4): the cost of the settings as entered, per
  // candidate — never a total, the product does not know the headcount.
  // `snapshotCost` (moved to `@pariksha/core`, branch-review Finding 6)
  // already guards the division: `durationMinutes === null`,
  // `!resolved.requireCamera` (`Q11b` — no camera means no stream and
  // nothing captured, branch-review Finding 1) and
  // `snapshotIntervalSeconds <= 0` all come back `null` before any
  // arithmetic runs. Snapshots off reads as nothing to say (`Q11b` — off
  // means off, all the way down) rather than reusing the "set a duration"
  // sentence for a reason that is not about the duration at all.
  const cost = snapshotCost({ durationMinutes, resolved });

  // Task 3 (`Q8a`): which of the fifteen overrides currently differ from
  // THIS profile's own defaults — computed once per render, read by every
  // field below to decide whether it carries a marker.
  const overridden = new Set(overriddenKeys(value.profile, value.overrides));

  /** Writes one override key through explicitly — `next` and all, never
   *  merged through `||` or dropped by a bare `??`. Same shape as
   *  `TimingPanel.tsx`'s `withKey` and `AccessPanel.tsx`'s `omit`: a fresh
   *  copy, one key assigned, handed to `onChange` whole. */
  function setOverride<K extends keyof ProctoringOverrides>(key: K, next: ProctoringOverrides[K]): void {
    const overrides: ProctoringOverrides = { ...value.overrides };
    overrides[key] = next;
    onChange({ profile: value.profile, overrides });
  }

  /** `R1`: the marker lives in the field's own help track, reached through
   *  `aria-describedby` from this instance's `useId()` — never a named
   *  `role="group"` nothing here renders. `undefined` when `key` is not in
   *  `overridden`, so an unmarked field adds no id and no paragraph. */
  function fieldMarker(key: keyof ProctoringOverrides): { id: string; node: ReactNode } | undefined {
    if (!overridden.has(key)) return undefined;
    const id = `${ids}-${key}-marker`;
    return {
      id,
      node: (
        <p className="field-help" id={id}>
          {`changed from ${PROFILE_LABEL[value.profile]}`}
        </p>
      ),
    };
  }

  function checkboxField(key: BoolOverrideKey, label: string, checked: boolean): JSX.Element {
    const fieldId = `${ids}-${key}`;
    const marker = fieldMarker(key);
    return (
      <div className="field" key={key}>
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
        <input
          type="checkbox"
          id={fieldId}
          checked={checked}
          aria-describedby={marker?.id}
          onChange={(event) => setOverride(key, event.target.checked)}
        />
        {marker?.node}
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
        marker={fieldMarker(key)}
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
  const faceCheckMarker = fieldMarker("face_check");
  const requireMicrophoneHelpId = `${ids}-require_microphone-help`;
  const requireMicrophoneMarker = fieldMarker("require_microphone");
  const aiAudioCheckHelpId = `${ids}-ai_audio_check-help`;
  const aiAudioCheckMarker = fieldMarker("ai_audio_check");
  const violationActionHelpId = `${ids}-violation_action-help`;
  const violationActionMarker = fieldMarker("violation_action");

  const headingId = `${ids}-heading`;

  // `Q8a`: the profile is the panel's first control and it rewrites the
  // rest. `pendingProfile` holds the profile the organiser just picked
  // while the confirmation is open; `null` means no confirmation is in
  // flight (and nothing has changed yet — the select's own `value` still
  // reads `value.profile` until the organiser confirms or the dialog is
  // cancelled, since `onChange` is not called either way until then).
  const [pendingProfile, setPendingProfile] = useState<ProctoringProfile | null>(null);
  // Counted against the OLD profile — `value.profile`, unchanged while the
  // dialog is open — so "2 settings" names what the organiser's own edits
  // were, not what the new profile happens to differ on. `overridden` above
  // is already exactly this set (fix round 1, finding 2): read it rather
  // than recomputing `overriddenKeys` a second time with the same arguments.
  const pendingChangeCount = overridden.size;

  function cancelProfileChange(): void {
    setPendingProfile(null);
  }

  // `R3`: this is the organiser's own cancellable confirmation of a
  // destructive edit, not the candidate's Q2b condition-to-resolve — it
  // takes Escape (the hook's default), and earns `trapTab`/`aria-modal`
  // because it traps Tab, the same rule `useDialogKeys`'s own header note
  // states and `SubmitDialog.tsx`/`Calculator.tsx` already apply.
  const confirmDialog = useDialogKeys<HTMLDivElement>(pendingProfile !== null, cancelProfileChange, {
    trapTab: true,
  });

  function selectProfile(nextProfile: ProctoringProfile): void {
    if (nextProfile === value.profile) return;
    if (overridden.size === 0) {
      // Nothing to lose — clears unconditionally (`Q8a`), but there is
      // nothing visible to confirm.
      onChange({ profile: nextProfile, overrides: {} });
      return;
    }
    setPendingProfile(nextProfile);
  }

  function confirmProfileChange(): void {
    if (pendingProfile === null) return;
    onChange({ profile: pendingProfile, overrides: {} });
    setPendingProfile(null);
  }

  const profileConfirmHeadingId = `${ids}-profile-confirm-heading`;

  return (
    <section className="proctoring-panel" role="group" aria-labelledby={headingId}>
      <h2 id={headingId}>Proctoring</h2>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-profile`}>
          Profile
        </label>
        <select
          className="text-input"
          id={`${ids}-profile`}
          value={value.profile}
          onChange={(event) => selectProfile(event.target.value as ProctoringProfile)}
        >
          {(Object.keys(PROFILE_LABEL) as ProctoringProfile[]).map((profile) => (
            <option key={profile} value={profile}>
              {PROFILE_LABEL[profile]}
            </option>
          ))}
        </select>
      </div>

      {pendingProfile !== null && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={profileConfirmHeadingId}
          ref={confirmDialog.dialogRef}
          tabIndex={-1}
          onKeyDown={confirmDialog.onKeyDown}
        >
          <h3 id={profileConfirmHeadingId}>{`Change the profile to ${PROFILE_LABEL[pendingProfile]}?`}</h3>
          <p>
            {`${String(pendingChangeCount)} ${pendingChangeCount === 1 ? "setting differs" : "settings differ"} from ${PROFILE_LABEL[value.profile]} and will be reset to ${PROFILE_LABEL[pendingProfile]}'s defaults.`}
          </p>
          <button type="button" className="button-secondary" onClick={cancelProfileChange}>
            Cancel
          </button>
          <button type="button" className="button-primary" onClick={confirmProfileChange}>
            Change profile
          </button>
        </div>
      )}

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
          // Issue 264: Native on-device face counting via Shape Detection API.
          <div className="field" key="face_check">
            <label className="field-label" htmlFor={`${ids}-face_check`}>
              Count faces in each image
            </label>
            <input
              type="checkbox"
              id={`${ids}-face_check`}
              checked={value.overrides.face_check ?? resolved.faceCheck}
              onChange={(e) => {
                const next = { ...value.overrides, face_check: e.target.checked };
                onChange({ ...value, overrides: next });
              }}
              aria-describedby={
                faceCheckMarker === undefined ? faceCheckHelpId : `${faceCheckHelpId} ${faceCheckMarker.id}`
              }
            />
            <p className="field-help" id={faceCheckHelpId}>
              Native on-device face counting via Shape Detection API. Fails open gracefully if unsupported.
            </p>
            {faceCheckMarker?.node}
          </div>,
          // Phase 8.5 / issue 209: microphone noise monitoring enabled.
          <div className="field" key="require_microphone">
            <label className="field-label" htmlFor={`${ids}-require_microphone`}>
              Require a microphone
            </label>
            <input
              type="checkbox"
              id={`${ids}-require_microphone`}
              checked={resolved.requireMicrophone}
              onChange={(event) => setOverride("require_microphone", event.target.checked)}
              aria-describedby={
                requireMicrophoneMarker === undefined
                  ? requireMicrophoneHelpId
                  : `${requireMicrophoneHelpId} ${requireMicrophoneMarker.id}`
              }
            />
            <p className="field-help" id={requireMicrophoneHelpId}>
              Monitors ambient noise level. No audio is ever recorded or stored.
            </p>
            {requireMicrophoneMarker?.node}
          </div>,
          <div className="field" key="ai_audio_check">
            <label className="field-label" htmlFor={`${ids}-ai_audio_check`}>
              AI speech evaluation
            </label>
            <input
              type="checkbox"
              id={`${ids}-ai_audio_check`}
              checked={resolved.aiAudioCheck}
              onChange={(event) => setOverride("ai_audio_check", event.target.checked)}
              aria-describedby={
                aiAudioCheckMarker === undefined
                  ? aiAudioCheckHelpId
                  : `${aiAudioCheckHelpId} ${aiAudioCheckMarker.id}`
              }
            />
            <p className="field-help" id={aiAudioCheckHelpId}>
              Evaluates spoken audio via browser Web Speech API or workspace BYOK models (OpenAI Whisper / Gemini).
            </p>
            {aiAudioCheckMarker?.node}
          </div>,
        ],
        // L4 (whole-branch review): the microphone clauses promised a
        // control that cannot act — `resolveProctoring` hardcodes
        // `requireMicrophone: false` and `middleware/security.ts` denies
        // the capability at the browser level (`Q12b`, issue 209). Dropped
        // rather than reworded to something still true but vaguer: there
        // is no path by which a candidate is told a microphone is
        // required, so the note says only what the camera control does.
        "A camera only starts if one of these needs it, and turning it off removes its indicator for the candidate too. Snapshots stop entirely at an interval of 0.",
      )}

      {group(
        "Consequences",
        [
          numberField("violation_limit", "Warn after", 1, "violations", resolved.violationLimit),
          // Phase 7e Task 3 (controller addition, issues 213/214):
          // re-enabled. Issue 214 shipped this disabled because nothing
          // enforced anything past the warning; Phase 7e's four tasks
          // closed that gap one action at a time (flag, auto-submit,
          // lock) and this is the last of the four — the select now
          // drives a real control again, same as every other field in
          // this panel.
          <div className="field" key="violation_action">
            <label className="field-label" htmlFor={`${ids}-violation_action`}>
              When the limit is reached
            </label>
            <select
              className="text-input"
              id={`${ids}-violation_action`}
              value={value.overrides.violation_action ?? resolved.violationAction}
              onChange={(event) => setOverride("violation_action", event.target.value as ViolationAction)}
              aria-describedby={
                violationActionMarker === undefined
                  ? violationActionHelpId
                  : `${violationActionHelpId} ${violationActionMarker.id}`
              }
            >
              {(Object.keys(VIOLATION_ACTION_LABEL) as ViolationAction[]).map((action) => (
                <option key={action} value={action}>
                  {VIOLATION_ACTION_LABEL[action]}
                </option>
              ))}
            </select>
            <p className="field-help" id={violationActionHelpId}>
              Lock has no way out but an organiser opening the attempt — see the publish checklist.
            </p>
            {violationActionMarker?.node}
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
        "A violation counts toward the limit above; a camera outage or a crowded snapshot marks the attempt for review instead — two different axes, never added together.",
      )}

      {/* `Q11`: the cost, on the screen. Reuses `.field-help` — the same
          muted, body-sm note every group above already carries for its own
          note, already repainted for the Signal ground in both modes
          (`admin.css`'s `:root[data-theme] .field-help`) — rather than a
          new selector `contrast-usage.test.ts` would need two fresh
          SURFACE entries for. `durationMinutes !== null` picks between the
          two messages: a missing duration says so in words (#179's shape),
          while no cost for any other reason (no camera, or snapshots off)
          says nothing, since there is no missing input to name and no cost
          to state.

          `role="status"`, mounted unconditionally (branch-review Finding
          4): every other computed fact this builder states as the organiser
          edits — `AccessPanel`'s two, `BrandingPanel`'s one,
          `SectionList`'s undo row, `FormBuilder`'s link check — carries a
          live region, and this is the same shape: a figure that moves when
          the interval, the camera or the duration changes, with no other
          way for a screen-reader organiser to learn it moved. Named, same
          reason as `AccessPanel`'s two regions: this panel also carries the
          "changed from {Profile}" marker, reachable only on focus, so a
          region announcing on its own needs a name to be told apart from
          it. Mounted unconditionally rather than only while it has
          something to say — a live region that only exists once it is
          populated announces nothing the first time it is populated,
          which is 7c's sibling bug to this one. */}
      <p role="status" aria-label="Snapshot cost" className="field-help">
        {cost !== null
          ? `≈ ${String(cost.images)} images · ≈ ${String(cost.megabytes)} MB · ≈ ${String(cost.uploads)} uploads per candidate`
          : durationMinutes === null
            ? "Set a duration under Timing to see what this costs."
            : ""}
      </p>
    </section>
  );
}
