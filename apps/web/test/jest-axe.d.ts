// jest-axe ships Jest-only type augmentations. This extends vitest's
// `expect` with the same matcher (the runtime matcher is registered via
// `expect.extend(toHaveNoViolations)` in test/setup.ts).
import "vitest";

declare module "vitest" {
  interface Assertion<T = unknown> {
    toHaveNoViolations: T extends { violations: unknown[] }
      ? () => void
      : never;
  }
}
