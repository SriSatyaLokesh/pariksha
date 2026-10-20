import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, expect } from "vitest";
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

// Node on Windows sleeps on the ~15.6ms OS timer tick, which is ~100% of
// axe's cost under jsdom (87 setTimeout hops per call). A self-rescheduling
// setImmediate keeps the event loop off that tick (measured 15.24ms -> 1.06ms
// per zero-delay hop). Torn down in afterAll so it never outlives the file.
let on = true;
const spin = (): void => {
  if (on) setImmediate(spin);
};
spin();
afterAll(() => {
  on = false;
});
