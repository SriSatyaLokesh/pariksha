import type { NavKey } from "../components/OrganiserShell";

/**
 * The organiser's view, in the query string (spec §5, `D5`).
 *
 * `?view=tests&test=tst_8c21a4`, read on first paint and on `popstate`,
 * written by every navigation — exactly the convention `sectionFromUrl()`
 * already followed in the test builder, hoisted so there is **one** parser
 * rather than one per screen. 6.5d's `?panel=` and 6.5e's `?section=` go
 * through here too; neither reads the query string for itself.
 *
 * No router library. A path router needs a server rewrite the static host
 * does not have, and #183 is what happens when this project assumes a
 * platform rewrite behaves as modelled. Routing is one `switch` in
 * `organiser.tsx`; this module is the two functions that switch reads and
 * writes through.
 *
 * What this module does **not** do: validate. An id in a URL is a claim
 * anyone can type, so `readView` returns what the string said and
 * `organiser.tsx` decides whether a view with that id can be built at all
 * (no id, no view) — and the screen's own fetch decides whether the actor
 * can reach it.
 *
 * `?returnTo=` is not ours. It survives the identity round trip, is
 * validated by `safeReturnTo`, and is read once by `admin-main.tsx`:
 * `readView` ignores it and `writeView` preserves it, along with every
 * other parameter a screen owns (`TestList`'s `?status=`/`?search=`).
 */
export interface ViewParams {
  view: NavKey | "test" | "bank" | "question";
  test?: string;
  bank?: string;
  section?: string;
  panel?: string;
}

const VIEWS: readonly string[] = ["home", "banks", "tests", "test", "bank", "question"];

/** The id-bearing half, in one place so reading and writing cannot drift. */
const IDS = ["test", "bank", "section", "panel"] as const;

/** An unknown or absent `?view=` is Home — a hand-typed URL lands somewhere
 *  real rather than on a blank switch arm. */
export function readView(search: string): ViewParams {
  const params = new URLSearchParams(search);
  const view = params.get("view") ?? "";
  const result: ViewParams = {
    view: VIEWS.includes(view) ? (view as ViewParams["view"]) : "home",
  };
  for (const key of IDS) {
    const value = params.get(key);
    if (value) result[key] = value;
  }
  return result;
}

/** Pushes a history entry, because a navigation is a place Back should
 *  return from. Parameters this module does not own are carried over; the
 *  id-bearing ones it does own are cleared when the new view has no value
 *  for them, so leaving a test never leaves `?test=` behind. */
export function writeView(params: ViewParams): void {
  const search = new URLSearchParams(window.location.search);
  search.set("view", params.view);
  for (const key of IDS) {
    const value = params[key];
    if (value) search.set(key, value);
    else search.delete(key);
  }
  // Arriving where you already are is not a navigation. Clicking Tests
  // while on Tests is a no-op an organiser can perform five times without
  // noticing, and five identical entries make Back look broken for five
  // presses — the failure a persistent nav is most exposed to.
  const next = `?${search}`;
  if (next === window.location.search) return;
  window.history.pushState(null, "", `${window.location.pathname}${next}`);
}
