import { useId, useState } from "react";
import {
  resolveRetention,
  type CostEstimate,
  type CostLine,
  type TestRelease,
  type TestRetention,
} from "@pariksha/core";

import { ReleasePanel } from "./ReleasePanel";
import { CandidateDataPanel } from "../organiser/CandidateDataPanel";

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
//
// Phase 8e Task 2 (`S-14`, issue 101, fix round 1): `CandidateDataPanel` mounts
// here, behind a lookup-then-act control (`CandidateLookup` below), not a
// list — there is no per-candidate read route to page or search over yet,
// and building one is a different task. This panel already owns the
// policy that governs a candidate's data (the retention fields above), so
// acting on one candidate's data sits beside it rather than inventing a
// fourth organiser surface. Deliberately plain: a text field, a button, no
// modal — there is no confirm-dialog precedent in `apps/web/src` for a
// *lookup*, and `CandidateDataPanel`'s own typed confirmation is already
// the deliberate step for the actual deletion.

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
  canDeleteCandidateData,
  onExportCandidateData,
  onDeleteCandidateData,
}: {
  release: TestRelease;
  onReleaseChange: (next: TestRelease) => void;
  retention: TestRetention | undefined;
  onRetentionChange: (next: TestRetention) => void;
  /** Absent on `node` (`K36`) — never `null`. Composed by `estimateCost`,
   *  not re-derived here. */
  cost?: CostEstimate | undefined;
  /** `candidates.delete` — Owner-only, in no other role (`S-14`). */
  canDeleteCandidateData: boolean;
  onExportCandidateData: (candidateId: string) => void;
  onDeleteCandidateData: (candidateId: string, keepAnonymisedScore: boolean) => Promise<void>;
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

      <fieldset className="release-panel__group">
        <legend>One candidate&rsquo;s data (S-14)</legend>
        <CandidateLookup
          canDeleteCandidateData={canDeleteCandidateData}
          onExport={onExportCandidateData}
          onDelete={onDeleteCandidateData}
        />
      </fieldset>
    </div>
  );
}

/**
 * Fix round 1 (`AC-25`): a candidate's own internal id (`cnd_…`) — the
 * same id `GET`/`DELETE
 * /api/v1/workspaces/:id/candidates/:candidateId/data` already takes —
 * typed in and "loaded" before `CandidateDataPanel` renders for it.
 *
 * A **lookup**, not a list: there is no route in this product that reads
 * candidates by page, by search, or by `external_id`, so a list here would
 * either invent one (a different task) or silently page over nothing.
 * `candidates.manage`'s own list (`AccessPanel.tsx`) shows aggregate counts
 * and a CSV upload, never a single row with an id attached — an organiser
 * reaches this id from wherever they already have it (a results export, a
 * support ticket), the same way `routes/bank.tsx`'s "export a single
 * question" takes a ref id typed in rather than browsed to.
 */
function CandidateLookup({
  canDeleteCandidateData,
  onExport,
  onDelete,
}: {
  canDeleteCandidateData: boolean;
  onExport: (candidateId: string) => void;
  onDelete: (candidateId: string, keepAnonymisedScore: boolean) => Promise<void>;
}) {
  const ids = useId();
  const [typed, setTyped] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);

  if (loaded !== null) {
    return (
      <div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setLoaded(null);
            setTyped("");
          }}
        >
          Look up a different candidate
        </button>
        <CandidateDataPanel
          candidateLabel={loaded}
          isOwner={canDeleteCandidateData}
          onExport={() => onExport(loaded)}
          onDelete={(input) => onDelete(loaded, input.keepAnonymisedScore)}
        />
      </div>
    );
  }

  return (
    <form
      className="field"
      onSubmit={(event) => {
        event.preventDefault();
        const id = typed.trim();
        if (id.length > 0) setLoaded(id);
      }}
    >
      <label className="field-label" htmlFor={`${ids}-candidate-id`}>
        Candidate id
      </label>
      <input
        className="text-input"
        id={`${ids}-candidate-id`}
        value={typed}
        placeholder="cnd_…"
        onChange={(event) => setTyped(event.target.value)}
      />
      <p className="field-help">
        From a results export or a support request — this screen has no candidate list to browse.
      </p>
      <button type="submit" className="button-secondary" disabled={typed.trim().length === 0}>
        Look up
      </button>
    </form>
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
