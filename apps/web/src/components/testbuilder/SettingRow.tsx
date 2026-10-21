import { useId, type ReactNode } from "react";
import type {
  RegistrationFormSpec,
  TestAccess,
  TestBranding,
  TestRelease,
  TestTiming,
} from "@pariksha/core";
import { MODE_LABEL } from "./AccessPanel";
import { SHOW_LABEL, WHEN_LABEL } from "./ReleasePanel";

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

/** "24 Oct 09:00 IST". `en-IN` because it is the one English locale whose
 * ICU data abbreviates the zones this product is used in ("IST", not
 * "GMT+5:30"), and a fixed locale because the row must read the same on
 * every machine. The comma `en-IN` puts after the day is dropped: the spec
 * writes this stamp without one. */
function stamp(iso: string, zone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
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

/** A zone `Intl` will accept, falling back the way `TimingPanel` does. */
function safeZone(zone: string | undefined): string {
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: zone ?? "UTC" });
    return zone ?? "UTC";
  } catch {
    return "UTC";
  }
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

export function timingSummary(timing: TestTiming): string {
  const zone = safeZone(timing.timezone);
  const opens = timing.opens_at === undefined ? "no opening time" : `opens ${stamp(timing.opens_at, zone)}`;
  const closes =
    timing.closes_at === undefined ? "no closing time" : `closes ${stamp(timing.closes_at, zone)}`;
  // `attempts_allowed`'s documented default is 1 (docs/test-format.md
  // § `timing`), so the row states what a candidate will actually get
  // rather than going silent on an unset field.
  return [
    plural(timing.duration_minutes, "minute"),
    opens,
    closes,
    plural(timing.attempts_allowed ?? 1, "attempt"),
  ].join(" · ");
}

export function accessSummary(access: TestAccess, candidateCount: number): string {
  const code =
    access.access_code === undefined || access.access_code === ""
      ? "no code set"
      : `code ${access.access_code}`;
  const list =
    candidateCount === 0 ? "no candidates on the list" : `${plural(candidateCount, "candidate")} on the list`;
  return [MODE_LABEL[access.mode], code, list].join(" · ");
}

export function registrationSummary(form: RegistrationFormSpec | undefined): string {
  const fields = form?.fields ?? [];
  if (fields.length === 0) return "no fields yet · nothing identifies a candidate";
  const required = fields.filter((field) => field.required === true).length;
  // The same rule `identityFieldOf` and apps/api/src/import/candidates.ts
  // apply: the first `unique: true` field in the form's own order.
  const identity = fields.find((field) => field.unique === true);
  return [
    plural(fields.length, "field"),
    `${required} required`,
    identity === undefined ? "nothing identifies a candidate" : `identified by ${identity.label}`,
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
        : `On ${stamp(release.at, "UTC")}`
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
