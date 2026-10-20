import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * How many test files this package runs at once (#161's second half).
 *
 * Vitest's default is `availableParallelism()`, and for *this* package
 * that default is not merely wasteful, it is **strictly dominated** —
 * measured over the whole suite on a 22-core box:
 *
 * | workers | wall  | failures |
 * | ------- | ----- | -------- |
 * | 22 (default) | 84 s | 27 |
 * | 8       | 37 s  | 0 (of this class) |
 * | 4       | 50 s  | 0 |
 *
 * Twenty-two workers is both slower *and* flakier than four. Each one is
 * an isolated fork paying ~2.66 s of spawn plus a fresh jsdom, and fifty
 * files means fifty of them: past a handful they stop computing and start
 * queueing. The box reads ~91% idle and 7 GB free while a **synchronous**
 * 174 ms test takes over ten seconds, which is what queueing looks like
 * from the outside and why "add cores" has never helped.
 *
 * `Math.min` and not a percentage: the ceiling is a property of this
 * suite, not of the host, so it must be a no-op on anything smaller than
 * itself. A two-core CI runner was never above the knee and is not
 * slowed down to prove a point; a big developer box stops sabotaging
 * itself. Same shape in both places, nothing tuned to one machine.
 */
const maxWorkers = Math.min(availableParallelism(), 4);

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
    maxWorkers,
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
    // That fix capped *packages* in flight, not workers inside one, and the
    // package has since grown to fifty files. Re-measured with a probe
    // running inside a loaded worker, the tick is **not** what stretches any
    // more: hops cost 14-19 ms against 15.2 ms idle, CPU and React mounts
    // are nominal, and the host is 91% idle. What stretches is the queue in
    // front of fifty isolated forks — see `maxWorkers` above, which is the
    // same fix one level down.
    //
    // The 15.6 ms floor itself is removable and this bar could fall a long
    // way further: a self-rescheduling `setImmediate` keeps Node's loop off
    // the OS tick and takes a zero-delay hop from 15.24 ms to 1.06 ms, which
    // took the axe tests here from 620-1611 ms to 31-307 ms. It belongs in
    // `test/setup.ts` and only alongside the worker cap -- churning in
    // twenty-two forks at once is worse than the disease (130 s, 40 failed).
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
