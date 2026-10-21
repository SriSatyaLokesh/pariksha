import { useId, type ReactNode } from "react";
import type {
  FormField,
  RegistrationFormSpec,
  TestAccess,
  TestBranding,
  TestRelease,
  TestTiming,
} from "@pariksha/core";
import { MODE_LABEL } from "./AccessPanel";
import { SHOW_LABEL, WHEN_LABEL } from "./ReleasePanel";
import { isZone } from "./TimingPanel";

// Phase 6.5d Task 1, spec D7: the five settings — timing, access,
// registration form, results, branding — collapse into one panel of rows
// that each state their own setting, opening in place, one at a time.
//
// The panels themselves are consumed unchanged: each becomes this
// component's `children`. What changed is where they live and when they
// mount, not what they contain.
//
// THE ONE RULE, and the only thing that pays for the collapse. A collapsed
// panel is one an organiser has to find. Every summary below therefore
// STATES THE VALUE, never names the field — "60 minutes · opens 24 Oct
// 09:00 IST", never "when the test opens and closes". A row that describes
// its setting has bought a collapse and paid nothing for it.
//
// And every summary is a PURE FUNCTION OF THE DRAFT, called at render by
// the shell (apps/web/src/routes/test.tsx) and never memoised or stored.
// A summary computed once at mount is a summary that lies the moment the
// organiser changes the value it states.
//
// An empty setting SAYS SO — "finish message empty" — rather than being
// dropped from the line, because a row that omits what is unset reads
// identically to a row whose author never scrolled far enough.

export type PanelKey = "timing" | "access" | "registration" | "results" | "branding";

/** The field a candidate list is keyed on: the first `unique: true` field
 * in the registration form's own order. The same rule
 * `apps/api/src/import/candidates.ts` applies — stated in both places
 * because the panel prints it and the converter keys on it, and a screen
 * naming one column while the server wants another is the defect this
 * exists to avoid.
 *
 * It lives here rather than in `test.tsx` because it is a pure derivation
 * over `FormField[]` with no route knowledge in it, and because every
 * other thing this module reuses (`MODE_LABEL`, `WHEN_LABEL`,
 * `SHOW_LABEL`, `isZone`) is a sibling import. The shell takes it from
 * here; nothing points back up. */
export function identityFieldOf(form: { fields: FormField[] } | undefined): FormField | null {
  return form?.fields.find((field) => field.unique === true) ?? null;
}

export function SettingRow({
  id,
  icon,
  label,
  summary,
  open,
  onToggle,
  children,
}: {
  id: PanelKey;
  icon: ReactNode;
  label: string;
  /** The CURRENT setting, stated. Never a description of the field. */
  summary: string;
  open: boolean;
  onToggle: (id: PanelKey) => void;
  /** The existing panel, unchanged. Mounted only while `open`. */
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <div className="setting-row">
      {/* No heading around this button. `SectionList` states the same
          disclosure the same way — one <h2> over the list, a plain
          <button aria-expanded> per row — and a heading here would land
          between the list's own <h2> and the panel's, which is a level
          this screen does not have. */}
      <button
        type="button"
        className="setting-row__button"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => onToggle(id)}
      >
        <span className="setting-row__icon" aria-hidden="true">
          {icon}
        </span>
        {/* The dash is part of the label, not a flex item of its own, so
            the row reads as `D7` writes it — "Timing — 60 minutes · …" —
            and so the accessible name has a separator in it rather than
            running the two together as "Timing60 minutes". */}
        <span className="setting-row__label">{label} —</span>
        {/* Inside the button on purpose: the summary is what a screen
            reader needs in order to answer "what is timing set to"
            without opening the row, which is the whole defence D7 rests
            on. */}
        <span className="setting-row__summary">{summary}</span>
      </button>
      {open && (
        <div className="setting-row__body" id={bodyId}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The five summaries. Each takes exactly the draft it states and nothing
// else, so there is nowhere for a stale copy to live.

/** "24 Oct 09:00 IST", or `null` when the stored string is not a time this
 * screen can read. `en-IN` because it is the one English locale whose ICU
 * data abbreviates the zones this product is used in ("IST", not
 * "GMT+5:30"), and a fixed locale because the row must read the same on
 * every machine. The comma `en-IN` puts after the day is dropped: the spec
 * writes this stamp without one. */
function stamp(iso: string, zone: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: zone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  })
    .format(at)
    .replace(",", "");
}

/** "24 Oct 2026" — the stored midnight-UTC release day, read back in UTC so
 * it does not slide a day either way on a machine west of Greenwich. `null`
 * when the document holds something that is not a date. */
function day(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(at);
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** One end of the window, stated three ways: the time, the absence of one,
 * or — for a document an import brought in carrying an unreadable string —
 * the fact that it cannot be read. `D7` forbids the fourth way, which is
 * an empty clause: "opens  · closes " tells an organiser nothing and reads
 * as a rendering fault rather than as a setting. */
function edge(iso: string | undefined, verb: string, absent: string, zone: string): string {
  if (iso === undefined) return absent;
  const at = stamp(iso, zone);
  return at === null ? `${verb} at a time that cannot be read` : `${verb} ${at}`;
}

export function timingSummary(timing: TestTiming): string {
  // `TimingPanel`'s own gate, not a second copy of it: the row and the
  // panel must not disagree about which zone a stamp is in.
  const zone = timing.timezone !== undefined && isZone(timing.timezone) ? timing.timezone : "UTC";
  // `attempts_allowed`'s documented default is 1 — docs/test-format.md
  // § `timing`, and the runtime's own `TIMING_DEFAULTS.attempts_allowed`
  // (`apps/api/src/run/clock.ts`), which is the source of record and is
  // not importable from this app. Named here so whoever moves it can find
  // this line. The row states what a candidate will actually get rather
  // than going silent on an unset field.
  return [
    plural(timing.duration_minutes, "minute"),
    edge(timing.opens_at, "opens", "no opening time", zone),
    edge(timing.closes_at, "closes", "no closing time", zone),
    plural(timing.attempts_allowed ?? 1, "attempt"),
  ].join(" · ");
}

/**
 * `candidateCount` is `null` for an actor without `candidates.manage`: the
 * shell deliberately does not fetch the list for them (`test.tsx`'s `load`
 * resolves `[]` rather than asking, because the route would 403 and fail
 * the whole load). A row that printed "no candidates on the list" there
 * would be stating a fact about data the screen never read — the one
 * failure `D7`'s whole defence rests on avoiding — so it states the
 * permission instead.
 */
export function accessSummary(access: TestAccess, candidateCount: number | null): string {
  const clauses = [MODE_LABEL[access.mode]];
  // The access code belongs to `link_code` alone: `AccessPanel` renders the
  // field only for that mode and `validateTest` requires one only then.
  // Naming it under SSO would name a setting that mode does not have, and
  // "no code set" would read as unfinished work rather than as a value.
  if (access.mode === "link_code") {
    clauses.push(
      access.access_code === undefined || access.access_code === ""
        ? "no code set"
        : `code ${access.access_code}`,
    );
  }
  clauses.push(
    candidateCount === null
      ? "candidate list needs an Admin"
      : candidateCount === 0
        ? "no candidates on the list"
        : `${plural(candidateCount, "candidate")} on the list`,
  );
  return clauses.join(" · ");
}

export function registrationSummary(form: RegistrationFormSpec | undefined): string {
  const fields = form?.fields ?? [];
  if (fields.length === 0) return "no fields yet · nothing identifies a candidate";
  const required = fields.filter((field) => field.required === true).length;
  // The shell's own rule, not a copy of it: the row must name the column
  // the candidate list is really keyed on, which is what `AccessPanel` is
  // handed and what the CSV importer keys on.
  const identity = identityFieldOf(form);
  return [
    plural(fields.length, "field"),
    `${required} required`,
    identity === null ? "nothing identifies a candidate" : `identified by ${identity.label}`,
  ].join(" · ");
}

export function resultsSummary(release: TestRelease): string {
  // `never` releases nothing, so there is no "what they see" to state and
  // naming one would describe a control rather than a setting.
  if (release.when === "never") return "Never released";
  const when =
    release.when === "on_date"
      ? release.at === undefined
        ? "On a date · no date chosen"
        : // A release is a day, not a moment (`ReleasePanel` stores
          // midnight UTC and T-22 asks for no hour), so the row states the
          // day. An "00:00 UTC" here would be a figure the product does
          // not actually honour.
          `On ${day(release.at) ?? "a date that cannot be read"}`
      : WHEN_LABEL[release.when];
  // `ReleasePanel`'s own control falls back to `score_only` when the
  // document omits `show`, so that is what a candidate gets and that is
  // what this states. Lowercased: the first clause carries the line's one
  // capital, the way every other row here reads.
  return `${when} · ${SHOW_LABEL[release.show ?? "score_only"].toLowerCase()}`;
}

/** The two halves T-23 splits branding across: the workspace's logo and the
 * test's own two messages. Each says "set" or "empty" — a value an
 * organiser can act on, where an omitted clause would read as an unvisited
 * row. */
export function brandingSummary(branding: TestBranding, workspaceBranding: TestBranding): string {
  const state = (value: string | undefined, name: string): string =>
    `${name} ${value === undefined || value === "" ? "empty" : "set"}`;
  return [
    state(workspaceBranding.logo, "logo"),
    state(branding.start_message, "start message"),
    state(branding.finish_message, "finish message"),
  ].join(" · ");
}
