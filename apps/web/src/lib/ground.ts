/**
 * The organiser's ground, per viewer (spec §11 `D20`).
 *
 * `theme.css` maps both Signal palettes onto one set of semantic names and
 * keys the light one off `:root[data-theme="light"]`. So switching ground is
 * one attribute on `<html>` — there is no state to thread through a screen
 * and nothing else to call. 6.5c's control in the top bar is `writeGround`
 * and nothing more.
 *
 * `D20b` — which ground is the *default* is still open, and this is not the
 * ruling: an explicit stored choice wins, otherwise the OS preference seeds
 * it, otherwise dark (where the prototype opens). Changing that answer is
 * `readGround`'s last two lines.
 *
 * `D7d` — per viewer, in `localStorage`, and the page must render when the
 * read throws: a private window, cleared site data, or storage blocked by
 * policy. The `localStorage` getter itself throws in a sandboxed iframe, not
 * only `getItem`, so the access is inside the try and not just the call.
 */
export type Ground = "dark" | "light";

const KEY = "pariksha.ground";

/**
 * Never throws, under any combination of blocked storage, absent stored
 * value and absent `matchMedia`.
 *
 * Two narrow catches rather than one wide one: storage being unavailable
 * and the viewer's colour preference are independent facts, so a private
 * window must still be seeded from `prefers-color-scheme`. Wrapping the
 * whole body would quietly charge a viewer who prefers light the dark
 * ground for a reason that has nothing to do with their preference.
 */
export function readGround(): Ground {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY);
  } catch {
    /* private window, cleared site data, blocked by policy — the seed still runs */
  }
  if (stored === "dark" || stored === "light") return stored;

  try {
    return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** Applies the ground and remembers it. A choice that cannot be remembered
 *  still applies to this tab. */
export function writeGround(ground: Ground): void {
  document.documentElement.dataset.theme = ground;
  try {
    localStorage.setItem(KEY, ground);
  } catch {
    /* private window, cleared site data, storage blocked by policy */
  }
}
