import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The session cookie is HttpOnly, `SameSite=Lax`, `Secure` and path `/`
 * (apps/api/src/middleware/authenticate.ts). A browser only behaves the way
 * production expects if the app and the API answer on one origin, so the dev
 * and preview servers proxy `/api` to the Node API instead of the app
 * talking cross-origin to port 8787. That is also what the deployed shape
 * is: one hostname, static assets and the Worker behind it.
 *
 * 8787 is the API's own default `PORT` (apps/api/src/env.ts), so neither
 * side has to be told about the other.
 */
const proxy = { "/api": { target: "http://127.0.0.1:8787" } };

export default defineConfig({
  plugins: [react()],
  server: { proxy },
  preview: { proxy },
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "admin.html"),
        // The hero's exam-demo island (v3 spec §2.7) — one vanilla-TS entry,
        // injected into dist/index.html from the manifest by
        // scripts/prerender.mjs. Not a page; no HTML entry of its own.
        island: resolve(__dirname, "src/island/exam-demo.ts"),
        // Phase 6 Task 1 (#65, P6.1): the candidate runtime — the FOURTH
        // input, and a different thing entirely from `island` above
        // despite both names saying "exam". `island` is the landing page's
        // marketing demo; this is the page a real candidate sits a real
        // test in. `bundle.test.ts` keeps organiser code out of it, and
        // `hosting.test.ts` keeps the two from being confused for each
        // other.
        exam: resolve(__dirname, "exam.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
    // jsdom warm-up plus React's first mount plus the first jest-dom/jest-axe
    // matcher are all charged to whichever test renders first in a file:
    // measured at 5-80x the median of every later test in the same file
    // (sections-s4-s6's first `render` took 3.9 s against a 49 ms median).
    //
    // The slow part of that is waiting, not computing. `await axe(...)` --
    // 45 of them in this package -- drives axe-core's rule queue through
    // `setTimeout`, and a zero-delay timer on Windows costs one 15.6 ms
    // scheduler tick: measured at 87 hops x 14.5 ms = 1263 ms for one axe
    // run over a 200-element DOM, which is 100% of that call's wall time.
    // `pnpm test` used to run five package test tasks at once, each vitest
    // sizing its own pool to every core, so ~105 node processes competed for
    // that tick and a hop measured inside a worker cost 65-102 ms instead of
    // 15 ms -- a 4-6.5x tax on every axe test, with the machine 97% idle.
    // That, not CPU, is what made a different handful of tests lose the race
    // each run (#161). The fix is in the root `test` script: turbo now runs
    // the package test tasks one at a time, so each vitest instance gets the
    // whole machine its pool is sized for, and the tick stays nominal.
    //
    // With that in place the slowest single test in this package measured
    // 2.63 / 3.13 / 2.65 s over three consecutive runs, so 10 s is ~3.2x of
    // headroom. The node-environment packages keep the 5 s default so a
    // genuine hang there still fails fast.
    testTimeout: 10_000,
    // e2e/*.spec.ts matches Vitest's default include, and a Playwright spec
    // loaded by Vitest fails in a way that reads like a broken unit test.
    // `pnpm test` stays the fast suite; `pnpm --filter @pariksha/web e2e`
    // is the browser one.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
