import { useEffect, useId, useState, type ReactNode } from "react";
import {
  NAVIGATION_CONSEQUENCE,
  timingIssues,
  type CountedAttempt,
  type NavigationMode,
  type TestTiming,
} from "@pariksha/core";
import type { StoredSection } from "../../lib/api";
import { useDialogKeys } from "../useDialogKeys";

// T-12 - T-15 (Task 7, #59, P5.6): the timing, navigation and attempt
// policy panel.
//
// Two rules about time run through everything below. **No time is rendered
// bare**: every instant is shown in the test's own `timezone`, named, and
// echoed in the organiser's zone, because an organiser in Pune setting a
// window for a campus in Singapore is the case that goes wrong silently.
// And **the cross-field rules are `@pariksha/core`'s** — `timingIssues` is
// the one copy, shared with `validateTest` and with Task 13's checklist, so
// the nag here and the block there cannot word the same fact differently.
//
// Publish-time, not save-time: a half-set window saves. The alerts below
// appear once the organiser has left the control, and nothing here refuses
// a write.

const NAVIGATION_LABEL: Readonly<Record<NavigationMode, string>> = {
  free: "Free",
  linear: "Linear",
  per_section: "Per section",
};

const COUNTED_LABEL: Readonly<Record<CountedAttempt, string>> = {
  highest: "Highest",
  latest: "Latest",
  average: "Average",
};

/** docs/test-format.md § `timing`, verbatim. Rendered as the control's
 * value when the document omits the field, so what an organiser reads is
 * what a candidate will get — the schema's `default` keyword documents
 * these but never writes them. */
const DEFAULTS = {
  navigation: "free",
  attempts_allowed: 1,
  cooldown_minutes: 0,
  counted_attempt: "highest",
  warn_at_minutes: [10, 2],
  late_sync_grace_seconds: 30,
} as const;

/** A zone string `Intl` will accept. `Intl.supportedValuesOf` is not usable
 * as the gate: it answers with the legacy canonical names (`Asia/Calcutta`,
 * not `Asia/Kolkata`), so it would reject the zone this repo's own example
 * test and docs use. It is still the right source for the *suggestions*. */
export function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const ZONE_SUGGESTIONS = Intl.supportedValuesOf("timeZone");

/** The offset `zone` is at on the instant `at`, in minutes east of UTC. */
function zoneOffsetMinutes(zone: string, at: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0; // "GMT" with no offset is UTC.
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function offsetSuffix(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** An RFC 3339 instant as the `YYYY-MM-DDTHH:mm` wall clock `<input
 * type="datetime-local">` wants, read in the *test's* zone — so the
 * organiser types the time the candidate will see. */
function toLocalInput(iso: string, zone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  // `en-CA` renders midnight as hour "24" rather than "00" in some ICU
  // builds; the input only ever accepts 00-23.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * The inverse: a wall clock in `zone` back to the RFC 3339 string the
 * document stores, offset and all.
 *
 * ponytail: the offset is looked up once, from the wall clock read as if it
 * were UTC — so within the offset's own width of a DST transition (at most
 * 14 hours, twice a year, in zones that observe one) this can pick the
 * offset from the wrong side of the jump. Upgrade path when that matters:
 * look the offset up twice and keep the one that round-trips.
 */
function toIso(local: string, zone: string): string {
  const guess = Date.parse(`${local}:00Z`);
  if (Number.isNaN(guess)) return "";
  return `${local}:00${offsetSuffix(zoneOffsetMinutes(zone, new Date(guess)))}`;
}

/** "14 Nov 2026, 09:00 Asia/Kolkata" — the zone is named, never implied. */
function inZone(iso: string, zone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const stamp = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
  return `${stamp} ${zone}`;
}

/** The same instant on the organiser's own clock. */
function inBrowserZone(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

/** "10, 2" <-> [10, 2]. A value that is not a list of positive integers is
 * left alone rather than silently half-parsed. */
function parseWarnAt(raw: string): number[] | null {
  const trimmed = raw.trim();
  if (trimmed === "") return [];
  const parts = trimmed.split(",").map((part) => part.trim());
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < 1)) return null;
  return numbers;
}

/** Sets or clears one optional key without ever spreading `undefined` —
 * `exactOptionalPropertyTypes` holds "absent" and "explicitly undefined"
 * apart. Same shape as `FormBuilder`'s own `withKey`. */
function withKey(
  timing: TestTiming,
  key: Exclude<keyof TestTiming, "duration_minutes">,
  value: string | number | number[] | undefined,
): TestTiming {
  const next: Record<string, unknown> = { ...timing };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next as unknown as TestTiming;
}

/**
 * A number box whose empty state means "not typed yet", never `0`.
 *
 * `Number("") === 0` and `Number.isFinite(0)` is true, so backspacing
 * "60" out of "Overall duration" used to commit `duration_minutes: 0`
 * against `$defs/timing`'s `minimum: 1` - a floor `draftSchema()`
 * deliberately keeps - and the next debounced save answered
 * `A settings block is not shaped correctly.`, a banner naming no field.
 * Same for `attempts_allowed`, and the same shape as the two save-gate
 * bugs before it ("Add section", the "Link and code" radio): a control
 * bouncing off its own keystroke.
 *
 * So it is one control rather than four `onChange` handlers that each
 * have to remember. The blank is held here and never sent; the stored
 * value returns when the organiser leaves the box.
 *
 * Not shared any wider: `apps/web/src/components/authoring` already
 * answers the same problem twice (`Written`'s early return, the
 * draft-plus-blur in `ReorderableList`) against state shapes this one
 * does not have, and a helper spanning three of them would be bigger
 * than the three.
 */
function NumberField({
  id,
  label,
  min,
  value,
  onCommit,
  onBlur,
  children,
}: {
  id: string;
  label: string;
  min: number;
  value: number;
  onCommit: (value: number) => void;
  onBlur: () => void;
  children?: ReactNode;
}) {
  // Empty is the only state the committed value cannot express - every
  // other keystroke is written through and comes back as `value` - so
  // that one bit is all this holds. A `string | null` draft would also
  // have to be cleared by the published-test dialog's Cancel, which puts
  // `value` back but cannot reach in here.
  const [blank, setBlank] = useState(false);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        className="text-input timing-panel__figure"
        id={id}
        type="number"
        min={min}
        value={blank ? "" : value}
        onChange={(event) => {
          const next = event.target.value;
          setBlank(next === "");
          const parsed = Number(next);
          if (next !== "" && Number.isFinite(parsed)) onCommit(parsed);
        }}
        onBlur={() => {
          setBlank(false);
          onBlur();
        }}
      />
      {children}
    </div>
  );
}

export function TimingPanel({
  timing,
  sections,
  published,
  onChange,
}: {
  timing: TestTiming;
  sections: readonly StoredSection[];
  /** UX-18: a published test's timing change does not touch attempts
   * already running, and the organiser is told so before it is applied. */
  published: boolean;
  onChange: (next: TestTiming) => void;
}) {
  const ids = useId();
  // The controls are driven from a local copy so an invalid intermediate
  // ("3" on the way to "30") never has to round-trip the server, and so a
  // published test can show the change inside its confirmation dialog
  // before anything is written.
  const [form, setForm] = useState<TestTiming>(timing);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState<TestTiming | null>(null);
  const [warnRaw, setWarnRaw] = useState<string | null>(null);

  useEffect(() => {
    setForm(timing);
  }, [timing]);

  const dialog = useDialogKeys<HTMLDivElement>(pending !== null, () => {
    setPending(null);
    setForm(timing);
  });

  const zone = form.timezone ?? "UTC";
  const safeZone = isZone(zone) ? zone : "UTC";
  const issues = touched ? timingIssues(form, sections) : [];
  const sectionTotal = sections.reduce((sum, section) => sum + (section.time_limit_minutes ?? 0), 0);

  /** Every write goes through here: a draft keeps it locally and sends it,
   * a published test holds it until the organiser has read what it does. */
  function commit(next: TestTiming): void {
    setForm(next);
    setTouched(true);
    if (published) setPending(next);
    else onChange(next);
  }

  const issueFor = (field: string): string | undefined =>
    issues.find((issue) => issue.field === field)?.message;

  function stamp(key: "opens_at" | "closes_at" | "latest_start_at", label: string, help?: string) {
    const iso = form[key];
    const fieldId = `${ids}-${key}`;
    const message = issueFor(`timing.${key}`);
    // #59: "or opens in the past … caught on blur". `timingIssues` cannot
    // carry this one — `packages/core` owns no clock and
    // `packages/core/test/acceptance.test.ts` enforces that — but the
    // panel runs in a browser that has one, and the alternative is an
    // organiser learning at the publish checklist that the window they
    // set at the start of the build has already gone by. A nag, not a
    // refusal: a past window is legal, it just almost never is meant.
    const past =
      key === "opens_at" && touched && iso !== undefined && new Date(iso).getTime() < Date.now()
        ? `This opens at ${inZone(iso, safeZone)}, which is already past — candidates can start the moment the test is published.`
        : undefined;
    return (
      <div className="field">
        <label className="field-label" htmlFor={fieldId}>
          {label}
        </label>
        <input
          className="text-input"
          id={fieldId}
          type="datetime-local"
          value={iso === undefined ? "" : toLocalInput(iso, safeZone)}
          onChange={(event) => {
            const local = event.target.value;
            commit(withKey(form, key, local === "" ? undefined : toIso(local, safeZone)));
          }}
          onBlur={() => setTouched(true)}
        />
        {iso !== undefined && (
          <p className="timing-panel__fact">
            <span className="timing-panel__figure">{inZone(iso, safeZone)}</span>
            {" · "}
            <span className="timing-panel__figure">{inBrowserZone(iso)}</span> your time
          </p>
        )}
        {help !== undefined && <p className="timing-panel__fact">{help}</p>}
        {[message, past]
          .filter((why): why is string => why !== undefined)
          .map((why) => (
            <p className="timing-panel__risk" role="alert" key={why}>
              <span aria-hidden="true">⚠ </span>
              {why}
            </p>
          ))}
      </div>
    );
  }

  const latestStart = form.latest_start_at ?? form.closes_at;

  return (
    <section className="timing-panel" aria-labelledby={`${ids}-heading`}>
      <h2 id={`${ids}-heading`}>Timing and attempts</h2>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-zone`}>
          Time zone
        </label>
        <input
          className="text-input"
          id={`${ids}-zone`}
          list={`${ids}-zones`}
          value={form.timezone ?? ""}
          onChange={(event) => commit(withKey(form, "timezone", event.target.value))}
          onBlur={() => setTouched(true)}
        />
        <datalist id={`${ids}-zones`}>
          {ZONE_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <p className="timing-panel__fact">
          {form.timezone === undefined
            ? "Unset, so every time below is read and shown in UTC."
            : isZone(form.timezone)
              ? `Every time a candidate sees is shown in ${form.timezone}.`
              : ""}
        </p>
        {form.timezone !== undefined && !isZone(form.timezone) && (
          <p className="timing-panel__risk" role="alert">
            <span aria-hidden="true">⚠ </span>
            {`"${form.timezone}" is not a time zone — use an IANA name, for example Asia/Kolkata. Times are being read in UTC until it is one.`}
          </p>
        )}
      </div>

      <NumberField
        id={`${ids}-duration`}
        label="Overall duration (minutes)"
        min={1}
        value={form.duration_minutes}
        onCommit={(minutes) => commit({ ...form, duration_minutes: minutes })}
        onBlur={() => setTouched(true)}
      >
        <p className="timing-panel__fact">
          <span className="timing-panel__figure">
            {`sections total ${sectionTotal} min of ${form.duration_minutes} min`}
          </span>
        </p>
        {issueFor("timing.duration_minutes") !== undefined && (
          <p className="timing-panel__risk" role="alert">
            <span aria-hidden="true">⚠ </span>
            {issueFor("timing.duration_minutes")}
          </p>
        )}
      </NumberField>

      {stamp("opens_at", "Opens at")}
      {stamp("closes_at", "Closes at")}
      {stamp(
        "latest_start_at",
        "Latest start",
        latestStart === undefined
          ? "Unset, and no close time either, so nothing stops a late start."
          : `A candidate arriving after ${inZone(latestStart, safeZone)} cannot begin.${
              form.latest_start_at === undefined ? " (Unset, so it follows the close time.)" : ""
            }`,
      )}

      <fieldset className="timing-panel__group">
        <legend>Navigation</legend>
        {(Object.keys(NAVIGATION_LABEL) as NavigationMode[]).map((mode) => (
          <div className="timing-panel__choice" key={mode}>
            <input
              type="radio"
              id={`${ids}-nav-${mode}`}
              name={`${ids}-nav`}
              value={mode}
              checked={(form.navigation ?? DEFAULTS.navigation) === mode}
              onChange={() => commit(withKey(form, "navigation", mode))}
            />
            <label htmlFor={`${ids}-nav-${mode}`}>{NAVIGATION_LABEL[mode]}</label>
            <p className="timing-panel__fact">{NAVIGATION_CONSEQUENCE[mode]}</p>
          </div>
        ))}
      </fieldset>

      <NumberField
        id={`${ids}-attempts`}
        label="Attempts allowed"
        min={1}
        value={form.attempts_allowed ?? DEFAULTS.attempts_allowed}
        onCommit={(attempts) => commit(withKey(form, "attempts_allowed", attempts))}
        onBlur={() => setTouched(true)}
      />

      <NumberField
        id={`${ids}-cooldown`}
        label="Cooldown between attempts (minutes)"
        min={0}
        value={form.cooldown_minutes ?? DEFAULTS.cooldown_minutes}
        onCommit={(minutes) => commit(withKey(form, "cooldown_minutes", minutes))}
        onBlur={() => setTouched(true)}
      >
        <p className="timing-panel__fact">How long a candidate waits before starting the next attempt.</p>
      </NumberField>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-counted`}>
          Which attempt counts
        </label>
        <select
          className="text-input"
          id={`${ids}-counted`}
          value={form.counted_attempt ?? DEFAULTS.counted_attempt}
          onChange={(event) => commit(withKey(form, "counted_attempt", event.target.value))}
        >
          {(Object.keys(COUNTED_LABEL) as CountedAttempt[]).map((value) => (
            <option key={value} value={value}>
              {COUNTED_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${ids}-warn`}>
          Warn at (minutes left)
        </label>
        <input
          className="text-input timing-panel__figure"
          id={`${ids}-warn`}
          value={warnRaw ?? (form.warn_at_minutes ?? DEFAULTS.warn_at_minutes).join(", ")}
          onChange={(event) => {
            const raw = event.target.value;
            setWarnRaw(raw);
            const parsed = parseWarnAt(raw);
            if (parsed !== null) commit(withKey(form, "warn_at_minutes", parsed));
          }}
          onBlur={() => {
            setTouched(true);
            setWarnRaw(null);
          }}
        />
        <p className="timing-panel__fact">The countdown shows a warning at each of these marks.</p>
        {warnRaw !== null && parseWarnAt(warnRaw) === null && (
          <p className="timing-panel__risk" role="alert">
            <span aria-hidden="true">⚠ </span>
            {`"${warnRaw}" is not a list of minutes — write whole numbers separated by commas, for example 10, 2.`}
          </p>
        )}
      </div>

      <NumberField
        id={`${ids}-grace`}
        label="Late sync grace (seconds)"
        min={0}
        value={form.late_sync_grace_seconds ?? DEFAULTS.late_sync_grace_seconds}
        onCommit={(seconds) => commit(withKey(form, "late_sync_grace_seconds", seconds))}
        onBlur={() => setTouched(true)}
      >
        <p className="timing-panel__fact">
          Answers arriving later than this after the deadline are rejected. The deadline is the server&rsquo;s; changing
          the candidate&rsquo;s clock does nothing.
        </p>
      </NumberField>

      {pending !== null && (
        <div
          role="dialog"
          aria-label="Change timing on a published test"
          ref={dialog.dialogRef}
          tabIndex={-1}
          onKeyDown={dialog.onKeyDown}
        >
          <p>
            This test is published. Attempts in progress stay on version 1 and keep the timing they started under; the
            change applies to attempts begun after it is saved.
          </p>
          <button
            type="button"
            className="button-secondary"
            onClick={() => {
              setPending(null);
              setForm(timing);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              onChange(pending);
              setPending(null);
            }}
          >
            Apply the change
          </button>
        </div>
      )}
    </section>
  );
}
