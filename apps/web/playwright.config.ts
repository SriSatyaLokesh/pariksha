// The end-to-end harness: three localhost processes and Chromium.
//
// All three ports below are the DEFAULTS, not fixed facts: WEB_PORT,
// API_PORT and IDP_PORT each override one. This machine reserves TCP
// 4198-4297 (`netsh interface ipv4 show excludedportrange protocol=tcp`),
// which is why the knobs exist. API_PORT also drives vite.config.ts's proxy
// target, so the browser and the health probe cannot disagree about where
// the API is.
//
//   vite preview (4173)  the built dist/ — the landing page only exists
//                        after the prerender, so `vite dev` would serve an
//                        empty <div id="root"> and there would be no
//                        landing page to walk through. Preview also serves
//                        exactly the artefact Cloudflare would.
//   node API    (8787)   apps/api's own Node entry, proxied onto 4173's
//                        /api by vite.config.ts so the session cookie sees
//                        one origin.
//   stub IdP    (9797)   e2e/stub-idp.mjs. No network, no credentials.
//
// Each app server builds itself below, so the suite can never test a stale
// dist/. Those two builds are `tsc` and `vite build` on one package each —
// neither builds the workspace packages they import by name, which resolve to
// a dist/ that has to already exist. The `e2e` script therefore builds
// @pariksha/api and its dependencies (core, db, storage) first, in one place
// rather than in both webServer commands, which run concurrently and would
// race on the same output directories. That is what keeps
// `pnpm --filter @pariksha/web e2e` one command from a clean checkout.
//
// Chromium only. This suite is a smoke test of one flow, not cross-browser
// coverage, and nothing in it is engine-sensitive.

import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = Number(process.env.WEB_PORT || 4373);
// Same reason WEB_PORT already is: a developer running clones side by side
// needs every port overridable, not just the one that happened to collide
// with Windows's excluded range first (phase 8h spec, "How these numbers
// were taken").
const API_PORT = Number(process.env.API_PORT || 8787);
const IDP_PORT = Number(process.env.IDP_PORT || 9797);
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // One API process means one database, and the first test is what completes
  // setup — so the file runs in order, in one worker. Each test still gets
  // its own browser context and therefore no inherited session.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: WEB_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/stub-idp.mjs",
      url: `http://127.0.0.1:${IDP_PORT}/.well-known/openid-configuration`,
      env: { IDP_PORT: String(IDP_PORT) },
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // Built rather than run through --experimental-strip-types: Node 22
      // does not resolve apps/api's `./app.js` specifiers back to their .ts
      // sources, so `dist/` is the only way to run that entry as itself.
      command: "pnpm --filter @pariksha/api build && node ../api/dist/node.js",
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        SESSION_SECRET: "e2e-session-secret",
        // In memory, so every run starts on an instance that has never been
        // set up. The first test depends on `setup.needed === true`, and a
        // file left behind by the last run would quietly break it — there
        // is no file to leave behind.
        DATABASE_URL: ":memory:",
        STORAGE_DIR: "../../node_modules/.cache/pariksha-e2e-files",
        PUBLIC_URL: WEB_ORIGIN,
        PORT: String(API_PORT),
        OIDC_PROVIDERS: JSON.stringify([
          {
            id: "stub",
            label: "Stub IdP",
            issuer: `http://127.0.0.1:${IDP_PORT}`,
            clientId: "pariksha-e2e",
            clientSecret: "shh",
            // Through the proxy, not straight at 8787: the browser must see
            // the callback and its Set-Cookie on the app's own origin.
            redirectUri: `${WEB_ORIGIN}/api/v1/auth/stub/callback`,
          },
        ]),
        // No EMAIL_* and no EMAIL_CONSOLE, and PASSWORD_AUTH disabled, so
        // `identityProviders` offers the one OIDC button and no magic link
        // or password form — which is what the fourth test asserts.
        PASSWORD_AUTH: "false",
      },
    },
    {
      command: `pnpm build && pnpm exec vite preview --port ${WEB_PORT} --strictPort`,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      stdout: "pipe",
      // scripts/prerender.mjs refuses to invent an origin (SEO-6 / OQ-1).
      // The same non-serving origin CI's build uses: nothing asserted here
      // reads a canonical.
      env: { SITE_URL: "https://pariksha.example" },
    },
  ],
});
