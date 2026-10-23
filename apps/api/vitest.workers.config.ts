import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // The deployed configuration, not a copy of it: bindings that drifted
      // from the ones production gets would still pass a test and prove
      // nothing about the Worker that ships.
      wrangler: { configPath: "../../deploy/cloudflare/wrangler.toml" },
      // Not a secret. Miniflare is local, and this value signs nothing that
      // outlives the test run — but `parseEnv` refuses to boot without it,
      // which is the behaviour being relied on, not worked around.
      miniflare: {
        bindings: { SESSION_SECRET: "miniflare-session-secret" },
        // Only the directory is replaced; the routing rules being tested
        // (`run_worker_first`, `not_found_handling`) still come from the
        // deployed config. A two-file fixture rather than `apps/web/dist`,
        // so this package's tests do not wait on the web build.
        assets: { directory: "test/fixtures/assets" },
      },
    }),
  ],
  // `test/webhooks/sign.test.ts` is listed here too: it is the one test file
  // that exercises `crypto.subtle`, and Workers' implementation is worth
  // proving directly rather than trusting that it matches Node's (K24).
  test: { include: ["test/worker.test.ts", "test/webhooks/sign.test.ts"] },
});
