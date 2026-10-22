import { useId, useState } from "react";
import {
  resolveRetention,
  type CostEstimate,
  type CostLine,
  type TestRelease,
  type TestRetention,
} from "@pariksha/core";

import { ReleasePanel } from "./ReleasePanel";

// Phase 8a Task 5 (`K28`, `K35`): the Results panel (`SettingRow id="results"`,
// `routes/test.tsx`) answers "what happens at the end" — release already
// lived here (`ReleasePanel`, composed unchanged below). The two retention
// integers and the cost line join it rather than growing a seventh
// `PANEL_KEYS` row (`K28`): `types.ts:192`'s own comment is why — a row for
// two integers costs `AG1`'s density budget to say nothing a question an
// organiser actually asks doesn't already cover here.
//
// `cost` is the one prop a `node` deployment never passes (`K36`): absent,
// not `null` — the caller that reads `AppEnv.target` omits it rather than
// sending a figure that describes nothing on an operator's own container.

const COST_LABEL: Readonly<Record<CostLine["key"], string>> = {
  snapshots: "Camera snapshots",
  identity_photo: "Identity photo",
  webhooks: "Webhook deliveries",
};

export function ResultsPanel({
  release,
  onReleaseChange,
  retention,
  onRetentionChange,
  cost,
}: {
  release: TestRelease;
  onReleaseChange: (next: TestRelease) => void;
  retention: TestRetention | undefined;
  onRetentionChange: (next: TestRetention) => void;
  /** Absent on `node` (`K36`) — never `null`. Composed by `estimateCost`,
   *  not re-derived here. */
  cost?: CostEstimate | undefined;
}) {
  const ids = useId();
  const resolved = resolveRetention(retention);

  return (
    <div className="release-panel">
      <ReleasePanel release={release} onChange={onReleaseChange} />

      <fieldset className="release-panel__group">
        <legend>Data retention</legend>
        <p className="release-panel__fact">
          S-13&rsquo;s defaults: snapshots delete after 90 days, personal data and answers after 12 months.
        </p>
        <RetentionField
          id={`${ids}-snapshots-days`}
          label="Delete snapshots after (days)"
          value={retention?.snapshots_days ?? resolved.snapshotsDays}
          onCommit={(days) => onRetentionChange({ ...retention, snapshots_days: days })}
        />
        <RetentionField
          id={`${ids}-personal-data-days`}
          label="Delete personal data and answers after (days)"
          value={retention?.personal_data_days ?? resolved.personalDataDays}
          onCommit={(days) => onRetentionChange({ ...retention, personal_data_days: days })}
        />
      </fieldset>

      {cost !== undefined && (
        <fieldset className="release-panel__group">
          <legend>Estimated cost</legend>
          {cost.lines.map((line) => (
            <p className="release-panel__fact" key={line.key}>
              {COST_LABEL[line.key]}
              {`: ≈${String(line.requestsPerCandidate)} requests per candidate`}
              {line.megabytesPerCandidate !== null
                ? ` · ≈${String(line.megabytesPerCandidate)} MB`
                : ""}
            </p>
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** `min={1}` integer box — the same idiom `TimingPanel.tsx` and
 *  `ProctoringPanel.tsx` each own their own copy of (their own comments say
 *  why it is not shared wider). These two match their five siblings: no
 *  `issueFor` surface for a schema-rejecting value is a standing hole, left
 *  alone here rather than fixed for one panel of six. */
function RetentionField({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [blank, setBlank] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="text-input"
        id={id}
        type="number"
        min={1}
        value={blank ? "" : value}
        onChange={(event) => {
          const next = event.target.value;
          setBlank(next === "");
          const parsed = Number(next);
          if (next !== "" && Number.isFinite(parsed)) onCommit(parsed);
        }}
        onBlur={() => setBlank(false)}
      />
    </div>
  );
}
