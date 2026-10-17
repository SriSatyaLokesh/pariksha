import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // This glob is NOT what makes `pnpm test` find each package's tests:
    // that is Turborepo running every package's own `test` script
    // (`turbo run test` in the root package.json), each of which runs
    // vitest inside its own package directory. This config only matters
    // when vitest is invoked from the repo root directly — e.g.
    // `npx vitest run` — and is what makes that single invocation cover
    // every workspace. `pnpm test` adds `pnpm vitest run scripts`
    // because `scripts/` is not a workspace package and so has no
    // Turborepo task of its own.
    projects: ["apps/*", "packages/*", "scripts"],
  },
});
