/**
 * Which side rails the viewer left open, per viewer (spec §11 `D7a`, `D7d`).
 *
 * ONE KEY, NOT TWO. `D7a` describes both sides collapsing, and the obvious
 * shape for this module is `{ nav; checklist }` — but the nav rail is
 * `OrganiserShell`'s own state (`OrganiserShell.tsx`, `useState(!wide)` with
 * an effect keyed on `wide`), and that shape is what `D18` requires: "Bank
 * browser opens with the rail collapsed." A stored `nav: "open"` read on
 * first paint would reopen the rail `D18` collapses, so persisting the nav
 * side is not an addition to this file — it is a ruling about another plan's
 * merged work, taken in a storage helper. And a `nav` field nothing writes is
 * a field that lies. So: the checklist side only, and 6.5c keeps the nav
 * side's rule where the nav side's state lives.
 *
 * `D7d` — per viewer, in `localStorage`, and the page must render when the
 * read throws: a private window, cleared site data, or storage blocked by
 * policy. The `localStorage` getter itself throws in a sandboxed iframe, not
 * only `getItem`, so the access is inside the try and not just the call —
 * the same shape, and the same reason, as `ground.ts` one plan earlier.
 */
export interface RailState {
  checklist: "docked" | "lights";
}

const KEY = "pariksha.rail";

/** The checklist is a right rail that is present from the first paint
 *  (`D7`), so the default is the panel, not the strip. */
const DEFAULT: RailState = { checklist: "docked" };

/** Never throws, under any combination of blocked storage, absent stored
 *  value and a stored value from a future (or hand-edited) shape. */
export function readRailState(): RailState {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* private window, cleared site data, blocked by policy */
  }
  return stored === "lights" || stored === "docked" ? { checklist: stored } : DEFAULT;
}

/** Remembers the choice. A choice that cannot be remembered still applies to
 *  this tab — the caller holds the state either way. */
export function writeRailState(state: RailState): void {
  try {
    localStorage.setItem(KEY, state.checklist);
  } catch {
    /* private window, cleared site data, storage blocked by policy */
  }
}
