# apps/api

The Pariksha HTTP API, built with [Hono](https://hono.dev/) so the same code runs on Cloudflare Workers and Node 22.

**Status:** the Phase 3 surface is shipped and runs on both targets — health, OIDC and magic-link sign-in, sessions and sign-out, `/me`, the first-run wizard (`/setup/status`, `/setup/complete`), workspaces and members, server-enforced authorization and the audit log. Authoring, the candidate runtime and results are not built yet. The full endpoint list is in [PRD — REST API](../../docs/PRD.md#data-model-question-format-and-api).

Run it locally with `pnpm --filter @pariksha/api build && node dist/node.js` — the Node entry migrates the database on boot, so an empty SQLite file or `:memory:` is a working instance. See [Running Pariksha locally](../../README.md#running-pariksha-locally) for the variables it needs.
