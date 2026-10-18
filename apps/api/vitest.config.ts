import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `worker.test.ts` needs the Workers pool, which cannot load
    // better-sqlite3 — and the rest of the suite is built on it. One pool per
    // config file is all vitest allows, so the two run as two invocations
    // (see this package's `test` script), not one.
    exclude: [...defaultExclude, "test/worker.test.ts"],
  },
});
