import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

// vitest.config's `test` block doesn't enable `globals`, so
// @testing-library/react's automatic cleanup (which hooks a global
// `afterEach`) never registers. Without this, every render() in a test
// file accumulates in the document, which both breaks later queries and
// trips axe's duplicate-landmark rules across tests.
afterEach(() => {
  cleanup();
});

// One jsdom window serves every test in a file, so its URL is as shared as
// its document — and since `D5` put the organiser's view in the query
// string, a test that navigates leaves `?view=tests` behind for the next
// one, which then boots somewhere its first `findBy*` never looks. The same
// hazard `cleanup()` answers for the DOM, answered the same way and in the
// same place rather than as a `beforeEach` copied into a dozen files (three
// already had one). A test that wants a particular URL still sets it in its
// own body, after this has run.
// Guarded, because this file is also the setup for the handful of tests that
// declare `@vitest-environment node` (the bundle and artefact budgets) and
// there is no window there at all.
//
// One limit, recorded rather than fixed (fix round 1): `replaceState`
// cleans the *current* entry and leaves the back-entries an earlier test in
// the same file pushed. A test that called `history.back()` before pushing
// anything of its own would therefore traverse into a previous test's URL.
// Every `back()` in this package is preceded by a push — which truncates
// the forward entries and makes the one behind it that test's own — so this
// is correct today, and there is no API for clearing a jsdom history stack
// short of a fresh window per test.
beforeEach(() => {
  if (typeof window !== "undefined") {
    window.history.replaceState(null, "", "/");
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      configurable: true,
    });
  }
});
