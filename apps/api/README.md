# apps/api

The Pariksha HTTP API, built with [Hono](https://hono.dev/) so the same code runs on Cloudflare Workers and Node 22.

**Status:** runs on both targets (Cloudflare Workers and Node 22). It covers sign-in (OIDC, magic link, optional passwords), the first-run wizard, workspaces, teams and roles, authoring, the candidate runtime, proctoring, results and grading, exports and webhooks, and BYOK AI drafting. Per-phase status is in [the roadmap](../../docs/ROADMAP.md); the endpoint list is in [API reference](../../docs/api-reference.md) and [PRD — REST API](../../docs/PRD.md#data-model-question-format-and-api).

Run it locally with `pnpm --filter @pariksha/api build && node dist/node.js` — the Node entry migrates the database on boot, so an empty SQLite file or `:memory:` is a working instance. See the [contributor setup guide](../../docs/contributing/setup.md) for the variables it needs and how to run the tests.
