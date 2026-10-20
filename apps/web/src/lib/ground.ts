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
 * policy. Every access is inside the try, because the `localStorage` getter
 * itself throws in a sandboxed iframe, not only `getItem`.
 */
export type Ground = "dark" | "light";

const KEY = "pariksha.ground";

/**
 * Never throws. A storage failure costs the seed and lands on dark rather
 * than on a blank page.
 *
 * ponytail: one try, so blocked storage skips the OS seed too. Splitting it
 * in two would keep the seed for a private window, at the cost of a second
 * catch no test here exercises.
 */
export function readGround(): Ground {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "dark" || stored === "light") return stored;
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
