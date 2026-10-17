import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
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
