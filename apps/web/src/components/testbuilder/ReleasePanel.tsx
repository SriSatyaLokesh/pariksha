import { useId, useState } from "react";
import { Icon } from "../OrganiserShell";
import {
  RELEASE_CONSEQUENCE,
  SHOW_CONSEQUENCE,
  type ReleaseShow,
  type ReleaseWhen,
  type TestRelease,
} from "@pariksha/core";

// T-22 (Task 10, #61, P5.8): when a candidate learns their result, and how
// much of it they see.
//
// Both choices are rendered with their consequence attached, in the place
// the choice is made — "score_only" and "full_review" are three words
// apart on the screen and a world apart for a candidate who can see the
// answer key. `RELEASE_CONSEQUENCE` and `SHOW_CONSEQUENCE` are
// `@pariksha/core`'s so Task 13's checklist row says the same sentence.
//
// `on_date` needs a date before it can be chosen: the schema's
// `if when === "on_date" then required at` is a *publish-time* rule now
// (`draftSchema` strips conditional presence floors, and `validateTest`
// carries the twin), so nothing stops the half-built state reaching
// storage — which is exactly why it has to be visible here rather than
// discovered at publish.

export const WHEN_LABEL: Readonly<Record<ReleaseWhen, string>> = {
  never: "Never",
  on_submit: "On submit",
  on_date: "On a date",
};

export const SHOW_LABEL: Readonly<Record<ReleaseShow, string>> = {
  score_only: "Score only",
  score_and_sections: "Score and sections",
  full_review: "Full review",
};

/** `<input type="date">` gives `YYYY-MM-DD`; the document wants RFC 3339.
 * Results are released at the start of the day, in UTC — the release is a
 * day, not a moment, and nothing in T-22 asks for an hour. */
const toIso = (day: string): string => `${day}T00:00:00Z`;
const toDay = (iso: string): string => iso.slice(0, 10);

export function ReleasePanel({
  release,
  onChange,
}: {
  release: TestRelease;
  onChange: (next: TestRelease) => void;
}) {
  const ids = useId();
  // `on_date` chosen but no date yet is held here rather than written:
  // the save would take it (it is an ordinary draft state) and the
  // organiser would never be told the one thing that makes the choice
  // mean anything.
  const [pendingDate, setPendingDate] = useState(false);
  const needsDate = pendingDate || (release.when === "on_date" && release.at === undefined);

  function setWhen(when: ReleaseWhen): void {
    if (when === "on_date" && release.at === undefined) {
      setPendingDate(true);
      return;
    }
    setPendingDate(false);
    onChange(when === "on_date" ? { ...release, when } : withoutDate({ ...release, when }));
  }

  function setDate(day: string): void {
    if (day === "") return;
    setPendingDate(false);
    onChange({ ...release, when: "on_date", at: toIso(day) });
  }

  const when: ReleaseWhen = pendingDate ? "on_date" : release.when;

  return (
    <section className="release-panel" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>When candidates see their result</h2>

      <fieldset className="release-panel__group">
        <legend>Release</legend>
        {(Object.keys(WHEN_LABEL) as ReleaseWhen[]).map((value) => (
          <div className="release-panel__choice" key={value}>
            <input
              type="radio"
              id={`${ids}-when-${value}`}
              name={`${ids}-when`}
              value={value}
              checked={when === value}
              onChange={() => setWhen(value)}
            />
            <label htmlFor={`${ids}-when-${value}`}>{WHEN_LABEL[value]}</label>
            <p className="release-panel__fact">{RELEASE_CONSEQUENCE[value]}</p>
          </div>
        ))}
      </fieldset>

      {when === "never" && (
        <p className="release-panel__fact">
          Candidates see a receipt with their attempt reference and no score, so they can prove they sat it.
        </p>
      )}

      {when === "on_date" && (
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-at`}>
            Release date
          </label>
          <input
            className="text-input"
            id={`${ids}-at`}
            type="date"
            value={release.at === undefined ? "" : toDay(release.at)}
            onChange={(event) => setDate(event.target.value)}
          />
          {needsDate && (
            <p className="release-panel__risk" role="alert">
              <Icon name="warn" />
              Choose a release date. Until there is one, release.at is unset and nobody would ever see a result.
            </p>
          )}
        </div>
      )}

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-show`}>
          What they see
        </label>
        <select
          className="text-input"
          id={`${ids}-show`}
          value={release.show ?? "score_only"}
          disabled={when === "never"}
          onChange={(event) => onChange({ ...release, show: event.target.value as ReleaseShow })}
        >
          {(Object.keys(SHOW_LABEL) as ReleaseShow[]).map((value) => (
            <option key={value} value={value}>
              {SHOW_LABEL[value]}
            </option>
          ))}
        </select>
        {(Object.keys(SHOW_LABEL) as ReleaseShow[]).map((value) => (
          <p className="release-panel__fact" key={value}>
            <span className="release-panel__legend">{SHOW_LABEL[value]}: </span>
            <span>{SHOW_CONSEQUENCE[value]}</span>
          </p>
        ))}
      </div>
    </section>
  );
}

/** `at` means nothing under `never` or `on_submit`, and a stale one left
 * under them is the `access_code` bug in another block. */
function withoutDate(release: TestRelease): TestRelease {
  const next: Record<string, unknown> = { ...release };
  delete next.at;
  return next as unknown as TestRelease;
}
