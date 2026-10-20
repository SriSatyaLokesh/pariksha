import { useState, type ReactNode } from "react";
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
export type NavKey = "home" | "banks" | "tests";

/* One icon family, one stroke width, `currentColor` — PRD S-11 has no
   iconography exception and emoji are not icons. Inline rather than a sprite
   or a font: five glyphs do not earn a loading strategy. */
const ICONS: Record<string, string[]> = {
  home: ["M3 9.2 10 3.2l7 6v8.1a.7.7 0 0 1-.7.7h-3.8v-5H7.5v5H3.7a.7.7 0 0 1-.7-.7Z"],
  banks: ["M10 2.6 2.6 6.4 10 10.2l7.4-3.8Z", "M2.6 10 10 13.8 17.4 10", "M2.6 13.6 10 17.4l7.4-3.8"],
  tests: ["M5.4 2.6h6l3.2 3.2v11.6H5.4Z", "M11.2 2.6v3.4h3.4", "M7.8 10.4h4.4", "M7.8 13.4h4.4"],
  panel: ["M3 4.2h14v11.6H3Z", "M7.8 4.2v11.6"],
  sun: ["M10 6.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z", "M10 2.4v1.6", "M10 16v1.6", "M2.4 10H4", "M16 10h1.6", "M4.6 4.6l1.2 1.2", "M14.2 14.2l1.2 1.2", "M15.4 4.6l-1.2 1.2", "M5.8 14.2l-1.2 1.2"],
  moon: ["M16 11.8A6.6 6.6 0 0 1 8.2 4a6.6 6.6 0 1 0 7.8 7.8Z"],
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      className="shell__icon"
      viewBox="0 0 20 20"
      width="18"
      height="18"
      fill="none"
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
];

export function OrganiserShell({
  current,
  crumb,
  title,
  lead,
  actions,
  workspace,
  actor,
  onNavigate,
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
  workspace: Workspace;
  actor: Actor;
  onNavigate: (key: NavKey) => void;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [railOpen, setRailOpen] = useState(true);
  const [ground, setGround] = useState<Ground>(readGround);

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

          <span className="shell__workspace">{workspace.name}</span>

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

        <main id="main-content" className="organiser organiser--wide shell__page">
          {hasHead && (
            <div className="shell__head">
              {crumb !== undefined && <MonoCaption>{crumb}</MonoCaption>}
              {title !== undefined && <h1 className="organiser__title">{title}</h1>}
              {lead !== undefined && <p className="organiser__lead">{lead}</p>}
              {actions !== undefined && <div className="shell__head-actions">{actions}</div>}
            </div>
          )}
          {children}
        </main>
      </div>
    </>
  );
}
