import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { MonoCaption } from "./MonoCaption";
import type { Actor, Workspace } from "../lib/api";
import { readGround, writeGround, type Ground } from "../lib/ground";

// The organiser's one piece of chrome (spec §5, `D3`).
//
// `OrganiserHeader` existed because four screens needed the same way back and
// the same way out; eleven `case` arms in `organiser.tsx` now do, and a "way
// back" threaded screen by screen is not navigation — it is a trail. So the
// chrome hoists: `OrganiserApp` renders this once, every screen renders
// inside `children`, and `onSignOut`/`onBack`/`backLabel` leave every screen's
// props.
//
// Not rendered during sign-in, the first-run wizard, the boot or an error:
// a nav with nothing behind it is exactly the lie `admin.css:99-101` refused
// when it declined to invent one for three screens. `organiser.tsx` decides
// that, because it is the only place that knows which of the two it is.
export type NavKey = "home" | "banks" | "tests" | "webhooks";

/* One icon family, one stroke width, `currentColor` — PRD S-11 has no
   iconography exception and emoji are not icons. Inline rather than a sprite
   or a font: twelve glyphs do not earn a loading strategy.

   Exported from 6.5d Task 1 (fix round 1) rather than copied: the builder's
   five setting rows (`D7`) needed icons, and the only way "one family" stays
   true is if there is literally one `ICONS` and one `Icon`. The five entries
   below `moon` are that plan's; they are on this viewBox, at this stroke,
   and they are the whole reason this is `export` and not `const`. A second
   family — a font, a sprite, a dependency, or a row of Unicode glyphs whose
   coverage is per-OS — is the thing this comment exists to refuse. */
export const ICONS: Record<string, string[]> = {
  home: ["M3 9.2 10 3.2l7 6v8.1a.7.7 0 0 1-.7.7h-3.8v-5H7.5v5H3.7a.7.7 0 0 1-.7-.7Z"],
  banks: ["M10 2.6 2.6 6.4 10 10.2l7.4-3.8Z", "M2.6 10 10 13.8 17.4 10", "M2.6 13.6 10 17.4l7.4-3.8"],
  tests: ["M5.4 2.6h6l3.2 3.2v11.6H5.4Z", "M11.2 2.6v3.4h3.4", "M7.8 10.4h4.4", "M7.8 13.4h4.4"],
  panel: ["M3 4.2h14v11.6H3Z", "M7.8 4.2v11.6"],
  sun: ["M10 6.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z", "M10 2.4v1.6", "M10 16v1.6", "M2.4 10H4", "M16 10h1.6", "M4.6 4.6l1.2 1.2", "M14.2 14.2l1.2 1.2", "M15.4 4.6l-1.2 1.2", "M5.8 14.2l-1.2 1.2"],
  moon: ["M16 11.8A6.6 6.6 0 0 1 8.2 4a6.6 6.6 0 1 0 7.8 7.8Z"],
  /* The builder's five settings (`D7`): a clock, a lock, a filled-in form,
     a bar chart and a drop of ink. */
  timing: ["M10 3.4a6.6 6.6 0 1 0 0 13.2 6.6 6.6 0 0 0 0-13.2Z", "M10 6.4V10l2.8 1.8"],
  access: ["M5.4 9h9.2v7.8H5.4Z", "M7.6 9V6.8a2.4 2.4 0 0 1 4.8 0V9"],
  registration: [
    "M7.4 3.4h5.2v2.2H7.4Z",
    "M12.6 4.4h2v13H5.4v-13h2",
    "M8 9.4h4",
    "M8 12.6h4",
  ],
  results: ["M3.4 16.6h13.2", "M6.2 16.6v-4.4", "M10 16.6V7", "M13.8 16.6v-6.6"],
  branding: ["M10 3.2c0 0 4.6 5.2 4.6 8.4a4.6 4.6 0 0 1-9.2 0C5.4 8.4 10 3.2 10 3.2Z"],
  /* Phase 7b Task 1 (`Q8`): the sixth setting, an eye for the thing every
     proctoring control watches. */
  proctoring: [
    "M2.6 10c1.6-3.4 4.6-5.4 7.4-5.4s5.8 2 7.4 5.4c-1.6 3.4-4.6 5.4-7.4 5.4S4.2 13.4 2.6 10Z",
    "M10 12.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z",
  ],
  /* 6.5d Task 6: the "In review" badge, on the builder header and the test
     list. It replaces U+25C6 BLACK DIAMOND — a text character whose shape,
     weight and baseline are the reader's font's business, which is the
     thing §13 and PRD S-11 refuse. A lens, because the badge says the
     draft is being LOOKED AT; a tick would say it had been approved, and
     approvals are ADR 0007's undelivered half (`D18`). */
  review: ["M9 3.4a5.2 5.2 0 1 0 0 10.4 5.2 5.2 0 0 0 0-10.4Z", "M12.9 12.9 16.8 16.8"],
  /* 6.5e Task 2, issue 200: the test list's five lifecycle glyphs and the
     field-error mark, which were U+25CF U+25D0 U+25CB U+25A0 U+25A2 and
     U+26A0 — text characters whose shape, weight and baseline are the
     reader's font's business, and whose coverage is per-OS. Same viewBox,
     same stroke, same `currentColor` as every entry above.

     ONLY `routes/tests.tsx`'s. The other 24 Unicode glyphs across 12 files
     are their own piece of work (issue 200) and are deliberately not swept
     here; these six are the ones this task rewrites the lines of anyway.

     The lifecycle pair reads as a progression: a disc for a draft that
     exists but is not out, a clock for one waiting on its window, a ring
     for one open now, a filled square for one shut and an outline square
     for one filed away. Fill versus outline is the distinction the Unicode
     shapes carried and it is kept, because the label beside it is the
     primary signal and the glyph only has to agree with it. */
  "state-draft": ["M10 4.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z"],
  "state-scheduled": ["M10 4.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6Z", "M10 6.8V10l2.4 1.6"],
  "state-open": ["M10 4.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8Z"],
  "state-closed": ["M5.2 5.2h9.6v9.6H5.2Z"],
  "state-archived": ["M4.4 5h11.2v10H4.4Z", "M4.4 8.2h11.2", "M8.4 11h3.2"],
  warn: ["M10 3.6 17.4 16.4H2.6Z", "M10 8.4v3.4", "M10 14h.01"],
  /* Phase 8d Task 1: the perimeter's own nav destination — a bolt, for the
     event this screen's webhooks fire out on. Same viewBox, same stroke,
     same `currentColor` as every entry above. */
  webhooks: ["M11.4 3 5.6 11.6h3.4L8 17l6.4-9h-3.6Z"],
};

/* The icons whose SHAPE is a fill rather than an outline — `D1`'s "glyph and
   label on inherited ink" needs a draft to look different from an open test
   with no hue to tell them apart, and filled-against-outline is the one
   distinction left. Two entries, so this is a set and not a parameter on
   every call site. */
const FILLED = new Set(["state-draft", "state-closed"]);

/**
 * `D7a` — "Opening a section or a setting retracts **both** sides
 * automatically ... auto-collapse is a convenience, never a lock."
 *
 * A screen inside `children` has no handle on `railOpen`, which lives here.
 * A context rather than a callback prop, because the alternative is one more
 * argument through `organiser.tsx`'s page descriptor and every one of its
 * eleven arms, for a thing exactly one screen asks for. The default is a
 * no-op, so a screen rendered outside the shell (sign-in, the wizard, the
 * boot) calls it harmlessly.
 *
 * TRANSIENT AND UNSTORED, and that is the whole of what keeps it clear of
 * `D18`. Nothing writes this to `localStorage` (see `lib/rail-state.ts`,
 * which carries the checklist side only and says why): it lasts as long as
 * the screen, so it cannot be read back on a first paint and cannot reopen
 * — or re-collapse — a rail whose default `D18` derives from `wide`.
 */
const RetractRail = createContext<() => void>(() => {});

/** Collapse the nav rail, once, now. See `RetractRail` above. */
export function useRetractRail(): () => void {
  return useContext(RetractRail);
}

export function Icon({ name }: { name: string }) {
  return (
    <svg
      className="shell__icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill={FILLED.has(name) ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {(ICONS[name] ?? []).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// `D3`: Home, then Banks and Tests. Phase 8's Results and Grading are
// ABSENT, not dimmed — the prototype dimmed them to convey the eventual
// shape, and a disabled destination in a shipped nav is a promise the build
// cannot keep. They arrive with the phase that has something behind them.
const NAV: { key: NavKey; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "banks", label: "Banks" },
  { key: "tests", label: "Tests" },
  // Phase 8d Task 1: the first thing behind this nav slot — present, not
  // dimmed (the comment above this table's own rule).
  { key: "webhooks", label: "Webhooks" },
];

export function OrganiserShell({
  current,
  crumb,
  title,
  lead,
  actions,
  wide = false,
  workspace,
  workspaces,
  actor,
  onNavigate,
  onSwitchWorkspace,
  onSignOut,
  children,
}: {
  current: NavKey;
  crumb?: string;
  /** Optional for exactly one screen: the test builder, whose title is the
   *  test's name and which fetches that itself and renders its own <h1>
   *  (`test.tsx`). Every other arm passes a title. 6.5d lifts the builder's
   *  and this becomes required. */
  title?: string;
  lead?: string;
  actions?: ReactNode;
  /** `D18`, one ruling with two halves: "Bank browser opens with the rail
   *  collapsed. Browsing is where the page wants width; the toggle still
   *  restores it." One flag, because both halves buy the same thing — the
   *  page drops `.organiser--wide`'s 1080px clamp AND the rail opens
   *  collapsed.
   *
   *  Not cosmetic, and not guessed: `AG1`'s gate measured the bank browser
   *  at 3 rows of 145px where `main` had 5 of 101px, because that screen was
   *  the one organiser surface rendered OUTSIDE `.organiser--wide` and Task 1
   *  wrapped every arm in the same clamped <main>. `.bank-browser__main` went
   *  1183px -> 772px and the prompt wrapped. Collapsing the rail alone
   *  recovers nothing — 1204px and 1384px are both over the clamp — so the
   *  two halves only work together. */
  wide?: boolean;
  workspace: Workspace;
  /** Every workspace this actor is a member of — the list `OrganiserApp`
   *  already fetches to pick `workspaces[0]`, so `D4`'s count is free. */
  workspaces: Workspace[];
  actor: Actor;
  onNavigate: (key: NavKey) => void;
  onSwitchWorkspace: (workspace: Workspace) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(!wide);
  const [ground, setGround] = useState<Ground>(readGround);

  // `OrganiserApp` renders ONE shell for every screen, so the initial state
  // above only ever runs once — arriving at a browsing surface from the bank
  // list would otherwise keep the rail open. Keyed on `wide` rather than on
  // the screen, so a second bank does not re-collapse a rail the reader just
  // restored, which is the half of `D18` that says "the toggle still
  // restores it".
  useEffect(() => {
    setRailOpen(!wide);
  }, [wide]);

  // `D7a`'s nav half. It survives the effect above rather than racing it:
  // that effect fires only when `wide` changes, which for the builder means
  // arriving at it or leaving it — never while a section is being opened —
  // so a retract taken inside the screen stands until the reader navigates
  // or presses the toggle. `D18`'s width-derived default is untouched, and
  // the half of `D18` that says "the toggle still restores it" is what the
  // button below keeps doing.
  const retract = useCallback(() => setRailOpen(false), []);

  const hasHead =
    crumb !== undefined || title !== undefined || lead !== undefined || actions !== undefined;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>

      <div className="shell" data-rail={railOpen ? "open" : "collapsed"}>
        <header className="shell__bar">
          <button
            type="button"
            className="shell__icon-button"
            aria-expanded={railOpen}
            aria-controls="organiser-nav"
            onClick={() => setRailOpen((open) => !open)}
          >
            <Icon name="panel" />
            <span className="visually-hidden">Navigation</span>
          </button>

          {/* The wordmark is the way home at every width. `D3a` takes the
              rail out of the grid below 719px, and a phone with no route
              back to Home would be a shell that navigates in one
              direction. */}
          <button type="button" className="shell__mark" onClick={() => onNavigate("home")}>
            Pariksha
          </button>

          {/* `D4`: the bar always names the workspace. It becomes a
              *switcher* only above one membership, because most people hold
              one and an always-no-op control is noise.

              `D4b`: a native <select>, which carries the keyboard, the
              mobile picker and an accessible name for free — a custom menu
              is focus-management work for no gain. The visible "Workspace"
              label IS the <label>; below 719px shell.css clips it to the
              accessibility tree rather than removing it, so the select keeps
              its name while Sign out stays whole. */}
          {workspaces.length > 1 ? (
            <div className="shell__switcher">
              <label className="shell__switcher-label" htmlFor="shell-workspace">
                Workspace
              </label>
              <select
                id="shell-workspace"
                className="shell__switcher-select"
                value={workspace.id}
                onChange={(event) => {
                  const next = workspaces.find((item) => item.id === event.target.value);
                  if (next !== undefined) onSwitchWorkspace(next);
                }}
              >
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <span className="shell__workspace">{workspace.name}</span>
          )}

          <div className="shell__bar-actions">
            {/* `D20`: the ground is one attribute on <html>, per viewer.
                There is no state to thread through a screen, so this button
                is the whole control. */}
            <button
              type="button"
              className="shell__icon-button"
              onClick={() => {
                const next: Ground = ground === "dark" ? "light" : "dark";
                writeGround(next);
                setGround(next);
              }}
            >
              <Icon name={ground === "dark" ? "sun" : "moon"} />
              <span className="visually-hidden">
                {ground === "dark" ? "Switch to the light ground" : "Switch to the dark ground"}
              </span>
            </button>

            <span className="shell__email">{actor.email}</span>

            <button type="button" className="shell__signout" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </header>

        <nav id="organiser-nav" className="shell__rail" aria-label="Organiser">
          <ul className="shell__nav">
            {NAV.map((item) => {
              const here = item.key === current;
              return (
                <li key={item.key}>
                  {/* "You are here" is three signals and never hue alone
                      (`D3`): `aria-current` for a screen reader, the accent
                      bar below for a glance, and a heavier label in
                      shell.css for everyone who reads the word. */}
                  <button
                    type="button"
                    className="shell__nav-item"
                    aria-current={here ? "page" : undefined}
                    onClick={() => onNavigate(item.key)}
                  >
                    {here && <span className="shell__nav-bar" aria-hidden="true" />}
                    <Icon name={item.key} />
                    <span className="shell__nav-label">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <main
          id="main-content"
          className={`organiser ${wide ? "organiser--full" : "organiser--wide"} shell__page`}
        >
          {hasHead && (
            <div className="shell__head">
              {crumb !== undefined && <MonoCaption>{crumb}</MonoCaption>}
              {title !== undefined && <h1 className="organiser__title">{title}</h1>}
              {lead !== undefined && <p className="organiser__lead">{lead}</p>}
              {actions !== undefined && <div className="shell__head-actions">{actions}</div>}
            </div>
          )}
          <RetractRail.Provider value={retract}>{children}</RetractRail.Provider>
        </main>
      </div>
    </>
  );
}
