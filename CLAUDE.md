# Working in this repository

Guidance for coding agents. Everything here is a trap someone has already
fallen into — not style preference.

## Cloudflare costs real money and touches a live instance

`https://pariksha-web.srisatyalokesh2-12.workers.dev` is a **live deployment**,
and `.github/workflows/deploy.yml` redeploys it on every push to `main`
(`DEPLOY_WEB` is `true` on this repository). Everything below is on
Cloudflare's free plan today, but free plan means *metered with a free
allowance*, not unmetered: D1 reads and writes, R2 operations and storage, and
Worker invocations all count against that allowance, and an account that
crosses it is billed.

**These commands touch the live account. Never run one to "try something".**

| Command | What it does to the account |
| --- | --- |
| `node deploy/cloudflare/setup.mjs` | Creates D1/R2 if missing, applies pending migrations to the **production** database |
| `wrangler d1 execute … --remote` | Reads/writes production data |
| `wrangler deploy` / `pnpm deploy:cf` | Replaces the running Worker |
| `wrangler r2 object put/delete` | Writes production object storage |
| `wrangler secret put` | Rotates a production secret |

**These are free and need no account — use them instead.**

| Command | What it proves |
| --- | --- |
| `node deploy/cloudflare/setup.mjs --dry-run` | The whole setup flow, twice, against an in-memory Cloudflare; asserts the second run is a no-op |
| `wrangler deploy --dry-run` | The config parses and the Worker bundles |
| `pnpm --filter @pariksha/api test` | Includes `worker.test.ts` — the real Worker entry against **Miniflare**, which is D1's own engine running locally |
| `pnpm --filter @pariksha/web e2e` | Playwright against a local dev server and a local stub IdP |

No test in this repository reaches Cloudflare. If a change needs proving
against D1, prove it against Miniflare — that is what `worker.test.ts` is for.

### The migration ordering rule

`wrangler deploy` does **not** touch the schema. Migrations are applied only by
`setup.mjs`, which a human runs. So a branch that adds a migration must have
that migration applied to the live D1 **before** it merges — otherwise the
auto-deploy ships code whose schema is not there yet.

This has already happened once: `0008_attempt_integrity.sql` merged with Phase
7a and was not applied for four days, while the Drizzle schema declared
`integrity_flag` and `observed` — so every live `attempt` select failed with
`no such column` until setup was run on 2026-10-22.

`GET /api/v1/health` answers `{"migrations":N}`. **N must equal the number of
files in `packages/db/migrations/sqlite/`.** Check it after any merge that
carries a migration.

## Clones, never worktrees

Three fixed checkouts exist and no others: `pariksha`, `pariksha-wt1`,
`pariksha-wt2`. **Never create a git worktree.** pnpm's junctions have twice
deleted `packages/core/**` and `packages/db/**` out of the primary checkout
when a worktree was removed. To read a file at a frozen commit, use
`git show <sha>:<path>`.

## Git

- Commit as `Satya K <srisatyalokesh2.12@gmail.com>`.
- Never `git add -A` — untracked phase notes and scratch files live beside the
  tree.
- Squash-merge pull requests.

## Build order

`packages/core`, `packages/db` and `packages/storage` must be built before
`apps/api` or `apps/web` will type-check: `pnpm build`. `turbo` knows the
order; a bare `tsc` in an app does not.
