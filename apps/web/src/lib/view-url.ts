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
  /**
   * `import` is 6.5e Task 4's (`D18`: "a page, not a modal — linkable").
   * A VIEW and not a `?panel=` value: `?panel=` belongs to 6.5d's five
   * settings panels inside one screen, and import is a destination of its
   * own, reached from two different screens.
   *
   * It is also the one view whose `bank` is optional, and that optionality
   * carries the meaning a second parameter would otherwise:
   * `?view=import&bank=bnk_1` is a bank import, `?view=import` alone is a
   * whole-test import — which names no bank, because it creates its own
   * test. One parameter, not two that can disagree.
   *
   * `grading` is Phase 8b Task 2 fix round 1 (`K15`): a destination of its
   * own, reached from the test builder (`test.tsx`'s "Grading queue"
   * button) rather than the top nav — `OrganiserShell.tsx:141-144`'s `D3`
   * ruling. It carries `test`, the same id-bearing parameter `test`
   * already does, because it names a queue scoped to one test, not a
   * second kind of id.
   *
   * `analytics` is Phase 8c Task 1 (`R-06`, #94) — the same shape as
   * `grading`, for the same reason: reached from the test builder's own
   * "Analytics" button, carrying the same `test` id parameter, not a
   * second one.
   */
  view:
    | NavKey
    | "test"
    | "bank"
    | "question"
    | "import"
    | "grading"
    | "analytics"
    | "monitor"
    | "attempt";
  test?: string;
  bank?: string;
  section?: string;
  panel?: string;
  attempt?: string;
}

/* Typed as the union and not as `string[]`: this is the module whose whole
   job is being the single source, and a typo in a `readonly string[]`
   compiles and then quietly sends that view to Home for ever (fix round 1,
   Minor 3). The cast is at the `includes` call instead, where it is a
   widening of the *argument* and cannot hide a bad member. */
const VIEWS: readonly ViewParams["view"][] = [
  "home",
  "banks",
  "tests",
  "teams",
  "webhooks",
  "keys",
  "test",
  "bank",
  "question",
  "import",
  "grading",
  "analytics",
  "monitor",
  "attempt",
];

/** The id-bearing half, in one place so reading and writing cannot drift. */
const IDS = ["test", "bank", "section", "panel", "attempt"] as const;

/** An unknown or absent `?view=` is Home — a hand-typed URL lands somewhere
 *  real rather than on a blank switch arm. */
export function readView(search: string): ViewParams {
  const params = new URLSearchParams(search);
  const view = params.get("view") ?? "";
  const result: ViewParams = {
    view: (VIEWS as readonly string[]).includes(view)
      ? (view as ViewParams["view"])
      : "home",
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
  //
  // Both sides are normalised before the comparison (fix round 1, Minor 4).
  // `search` has been through `URLSearchParams`; the address bar has not,
  // and an identity provider handing back `?returnTo=/admin` differs from
  // the `%2F` this would write by encoding alone. Comparing those raw makes
  // the first click on the open destination push a semantically identical
  // entry, which is this same defect in the one corner the first fix
  // could not see.
  const next = search.toString();
  if (next === new URLSearchParams(window.location.search).toString()) return;
  window.history.pushState(null, "", `${window.location.pathname}?${next}`);
}

/**
 * A workspace switch lands on Home with every id-bearing parameter gone
 * (spec §5, `D4a`).
 *
 * `?view=test&test=tst_8c21a4` carried across a switch asks workspace B for
 * a test id belonging to workspace A — a 404 where the route checks
 * membership and a cross-tenant read where it does not. `IDS` is the same
 * list `readView` and `writeView` walk, so a parameter added to one is
 * cleared by this without a second edit.
 *
 * `replaceState`, not the `pushState` `writeView` uses, and that is the
 * whole reason this is not `writeView({ view: "home" })`: the entry being
 * left names workspace A's test, and `organiser.tsx` rebuilds a view from
 * the URL on `popstate` against whatever workspace is *current*. Pushing
 * would leave that entry one Back press from workspace B — the same
 * cross-tenant read by a slower route. A switch is not a place you navigate
 * to and come back from; it replaces where you are. Entries further back
 * still name workspace A, which this cannot reach: they are left as the
 * ordinary history of a session, and the screens' own fetches refuse them.
 */
export function resetViewForWorkspace(): void {
  const search = new URLSearchParams(window.location.search);
  search.set("view", "home");
  for (const key of IDS) search.delete(key);
  window.history.replaceState(null, "", `${window.location.pathname}?${search}`);
}
