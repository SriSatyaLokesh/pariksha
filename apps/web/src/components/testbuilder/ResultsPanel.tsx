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
import type { CandidateRow } from "../../lib/api";

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
// Phase 8e Task 2 (`S-14`, issue 101, fix round 1): `CandidateDataPanel`
// mounts here, behind a lookup-then-act control (`CandidateLookup` below).
// This panel already owns the policy that governs a candidate's data (the
// retention fields above), so acting on one candidate's data sits beside
// it rather than inventing a fourth organiser surface. Deliberately plain:
// a text field, a list of matches, no modal — there is no confirm-dialog
// precedent in `apps/web/src` for a *lookup*, and `CandidateDataPanel`'s
// own typed confirmation is already the deliberate step for the actual
// deletion.
//
// Fix round 2 (`AC-25`): searches the test's OWN candidate list
// (`candidates`, a prop — `routes/test.tsx` already fetches it for
// `AccessPanel`'s count whenever this actor holds `candidates.manage`,
// which every `candidates.delete`-holding Owner does too, since
// `owner: ACTIONS` in `packages/core/src/permissions.ts` is the full set)
// by `external_id` and every registration answer, never by the internal
// `cnd_…` id a request-driven erasure never arrives holding — *"delete my
// data, I'm jane@example.com"* names an email, not a row id. `KG3`: this
// is the list `GET …/tests/:testId/candidates` already fetches in ONE
// query (Task 9, `candidates.manage`, budget 3, unpaginated — see this
// file's own header note on that route), so the search below issues zero
// further requests regardless of how many characters are typed or how
// large the list is — filtering `candidates` already in memory, the same
// array `AccessPanel`'s own candidate count reads.

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
  candidates,
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
  /** This test's own candidate list — already fetched by the caller
   *  (`routes/test.tsx`) for `AccessPanel`'s count. The lookup below
   *  searches this array in memory; it issues no request of its own. */
  candidates: readonly CandidateRow[];
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
          candidates={candidates}
          canDeleteCandidateData={canDeleteCandidateData}
          onExport={onExportCandidateData}
          onDelete={onDeleteCandidateData}
        />
      </fieldset>
    </div>
  );
}

/** How many matches render before the list is truncated — a broad query
 *  (a single common letter) against a 300-candidate test must not paint
 *  300 buttons; narrowing the query is the fix, not scrolling further. */
const MAX_MATCHES_SHOWN = 20;

/** Every string value on a candidate row that an organiser might actually
 *  type to find them: `external_id` and every registration answer. Not a
 *  fixed field name (`email`, `name`) — the registration form is per-test
 *  and this component does not know its shape, only `CandidateRow`'s. */
function searchableText(candidate: CandidateRow): string[] {
  const values = Object.values(candidate.formValues).filter(
    (value): value is string => typeof value === "string",
  );
  return candidate.externalId === null ? values : [candidate.externalId, ...values];
}

function matchesQuery(candidate: CandidateRow, query: string): boolean {
  return searchableText(candidate).some((text) => text.toLowerCase().includes(query));
}

/** A short, human line for one match — enough to tell two "Jane"s apart
 *  before acting on either, never the internal id (S-14's whole point is
 *  that an organiser should not need it). */
function describeCandidate(candidate: CandidateRow): string {
  const parts = searchableText(candidate);
  return parts.length > 0 ? parts.join(" · ") : "(no registration answers on file)";
}

/**
 * Fix round 2 (`AC-25`): searches `candidates` — this test's own list,
 * already fetched once by the caller — by `external_id` and every
 * registration answer, so the organiser types what they actually have
 * ("jane@example.com", a roll number, a name) rather than a `cnd_…` id
 * nothing hands them. Selecting a match is what resolves it to the
 * internal id `CandidateDataPanel`'s `onExport`/`onDelete` need —
 * `KG3`: filtering an array already in memory, not a query, so this
 * issues zero requests of its own regardless of how many characters are
 * typed. See this file's own header for why `candidates` is already in
 * hand rather than fetched here.
 */
function CandidateLookup({
  candidates,
  canDeleteCandidateData,
  onExport,
  onDelete,
}: {
  candidates: readonly CandidateRow[];
  canDeleteCandidateData: boolean;
  onExport: (candidateId: string) => void;
  onDelete: (candidateId: string, keepAnonymisedScore: boolean) => Promise<void>;
}) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId !== null) {
    const selected = candidates.find((candidate) => candidate.id === selectedId);
    return (
      <div>
        <button
          type="button"
          className="button-secondary"
          onClick={() => {
            setSelectedId(null);
            setQuery("");
          }}
        >
          Look up a different candidate
        </button>
        <CandidateDataPanel
          candidateLabel={selected !== undefined ? describeCandidate(selected) : selectedId}
          isOwner={canDeleteCandidateData}
          onExport={() => onExport(selectedId)}
          onDelete={(input) => onDelete(selectedId, input.keepAnonymisedScore)}
        />
      </div>
    );
  }

  const trimmed = query.trim().toLowerCase();
  const matches = trimmed.length === 0 ? [] : candidates.filter((candidate) => matchesQuery(candidate, trimmed));
  const shown = matches.slice(0, MAX_MATCHES_SHOWN);

  return (
    <div className="field">
      <label className="field-label" htmlFor={`${ids}-candidate-query`}>
        Find a candidate
      </label>
      <input
        className="text-input"
        id={`${ids}-candidate-query`}
        value={query}
        placeholder="Name, email, roll number…"
        onChange={(event) => setQuery(event.target.value)}
      />
      <p className="field-help">
        Searches this test&rsquo;s {String(candidates.length)} candidate{candidates.length === 1 ? "" : "s"} by name,
        email, or any other registration answer.
      </p>

      {trimmed.length > 0 && matches.length === 0 && (
        <p role="status" className="field-help">{`No candidate on this test matches "${query}".`}</p>
      )}

      {shown.length > 0 && (
        <ul>
          {shown.map((candidate) => (
            <li key={candidate.id}>
              <button type="button" className="button-secondary" onClick={() => setSelectedId(candidate.id)}>
                {describeCandidate(candidate)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {matches.length > MAX_MATCHES_SHOWN && (
        <p className="field-help">
          {`${String(matches.length - MAX_MATCHES_SHOWN)} more match — narrow the search to see them.`}
        </p>
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
