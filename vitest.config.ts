import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `maxWorkers` sizes one shared pool for every project, and a project's
    // own config cannot raise or lower it — so `apps/web`'s ceiling has to
    // be repeated here or `npx vitest run apps/web` from the root silently
    // runs at `availableParallelism()` and fails the way the gate used to
    // (24 failed, against 0 under the ceiling). See the long note on
    // `maxWorkers` in `apps/web/vite.config.ts` for the measurements; the
    // short version is that fifty isolated jsdom forks queue rather than
    // compute, and twenty-two workers is both slower and flakier than four.
    maxWorkers: Math.min(availableParallelism(), 4),
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
