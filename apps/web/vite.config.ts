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
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
    // e2e/*.spec.ts matches Vitest's default include, and a Playwright spec
    // loaded by Vitest fails in a way that reads like a broken unit test.
    // `pnpm test` stays the fast suite; `pnpm --filter @pariksha/web e2e`
    // is the browser one.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
