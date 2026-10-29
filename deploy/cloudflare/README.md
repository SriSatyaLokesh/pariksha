# Deploy on Cloudflare (zero cost)

The reference deployment: one Worker serving the web app as [Static Assets](https://developers.cloudflare.com/workers/static-assets/) and the Hono API as its script, with D1 (database), R2 (snapshots and media) and a Cron Trigger (retention, from Phase 8). All on the free plan. Free-tier sizing is in [PRD — Non-functional requirements](../../docs/PRD.md#non-functional-requirements).

Everything is in [`wrangler.toml`](./wrangler.toml). It is the only deployment config in the repository and it deploys exactly one Worker.

## Why one Worker and not two

Two Workers — `pariksha-web` and `pariksha-api` — would break sign-in in production while passing every test in the repository.

`workers.dev` is on the [Public Suffix List](https://publicsuffix.org/), so `pariksha-web.workers.dev` and `pariksha-api.workers.dev` are different **sites**, not merely different origins. The session cookie is set `SameSite=Lax` (`apps/api/src/middleware/authenticate.ts`), and a `Lax` cookie is not sent on a cross-site `fetch()`. The organiser app would sign in, receive a cookie it could never send back, and get 401 from `/api/v1/me`, `/api/v1/workspaces` and `/api/v1/setup/complete`. The e2e suite hides this because the dev server proxies `/api` onto one origin.

The alternatives all cost more than they save: `SameSite=None` needs `Secure` and gives up the CSRF protection `Lax` provides for free, CORS with credentials needs an allowlist and a preflight on the hot path, and a custom domain with subdomains would be same-site but there is no custom domain today.

One Worker costs nothing extra: static asset requests are free and unmetered, and `run_worker_first = ["/api/*"]` means they never invoke the script. Only `/api/*` counts against the 100,000 script invocations per day. It is also the topology Phase 11 plans for Docker — one container serving both — so the two targets stop diverging.

The Worker is still named `pariksha-web`. The name is now a slight misnomer, and it stays: the repository variable `SITE_URL` is baked into prerendered canonical URLs and SEO metadata at build time, so renaming the Worker changes its URL and invalidates all of them. Rename when a real domain arrives.

### Routing

| Request                                   | Served by                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `/api/*`                                  | the Worker script, always (`run_worker_first`)                                        |
| a path matching a file in `apps/web/dist` | the asset store, without invoking the script                                          |
| any other path                            | the script, which hands it back to the `ASSETS` binding, which serves `dist/404.html` |

That last row is not the platform default and is worth knowing: with a Worker script present, a path that matches no asset reaches the **Worker**, not `not_found_handling`. Without the hand-back in `apps/api/src/index.ts`, a visitor to a mistyped URL would get the API's JSON error envelope instead of a 404 page. Both directions are asserted against Miniflare in `apps/api/test/worker.test.ts`.

## First-time setup

You need a Cloudflare account, and an API token with **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit** and **Account Settings: Read** (Dashboard → My Profile → API Tokens → Create Token → Edit Cloudflare Workers).

```bash
pnpm install && pnpm build
pnpm --filter @pariksha/api exec wrangler login
node deploy/cloudflare/setup.mjs
```

`setup.mjs` creates the D1 database and the R2 bucket, writes the database's id into `wrangler.toml`, and applies the migrations. It is idempotent: run it again and it reports what already exists and changes nothing. **Commit the `database_id` it writes.**

Then set the secrets and deploy:

```bash
pnpm --filter @pariksha/api exec wrangler secret put SESSION_SECRET -c deploy/cloudflare/wrangler.toml
pnpm build && pnpm deploy:cf
curl https://pariksha-web.<your-subdomain>.workers.dev/api/v1/health
```

The health check answers `{"status":"ok","dialect":"d1","migrations":N}`, where N equals the number of files in `packages/db/migrations/sqlite/`.

To use a custom domain, add it under **Workers & Pages → pariksha-web → Settings → Domains & Routes**, or add a `routes` entry to `wrangler.toml` — and then set `workers_dev = false` and `preview_urls = false`, which `apps/web/test/hosting.test.ts` enforces so the two URLs do not index alongside each other.

## Secrets

Set with `wrangler secret put NAME -c deploy/cloudflare/wrangler.toml`, never under `[vars]` in `wrangler.toml` — that block is plaintext in the file and in the dashboard. For local `wrangler dev`, copy [`.dev.vars.example`](./.dev.vars.example) to `.dev.vars`, which is gitignored.

| Name                                          | Required              | What it is                                                                                                                            |
| --------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`                              | yes                   | Signs the session cookie. `openssl rand -base64 32`. Changing it signs every open session out, which is also how you revoke them all. |
| `APP_URL`                                     | no                    | Origin the magic-link email points at. Defaults to the request's origin.                                                              |
| `EMAIL_ENDPOINT`, `EMAIL_TOKEN`, `EMAIL_FROM` | no, all three or none | The transactional-email endpoint magic links are sent through. Any provider with an HTTP API; there is no SDK.                        |
| `EMAIL_CONSOLE`                               | no                    | `true` keeps the console sender past a production deploy — for a trial instance.                                                      |
| `OIDC_PROVIDERS`                              | no                    | A JSON array of providers. Each `redirectUri` must match the provider's own console byte for byte.                                    |

`DB` and `FILES` are bindings, not secrets: Cloudflare injects them and `wrangler dev` creates local stand-ins. The schema holds no encrypted columns yet, so there is no `FIELD_KEY` — add it as a secret in the phase that introduces field encryption, not before, so an unused secret cannot go stale in an operator's vault.

## Automatic deployment

[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) deploys on every push to `main`, but it is **off until you turn it on**, so a repository with no Cloudflare account never gets a failing run for a deployment nobody asked for. Under **Settings → Secrets and variables → Actions**:

1. Add two **secrets**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
2. Add two **variables**: `DEPLOY_WEB` set to `true`, and `SITE_URL` set to the Worker's URL.

`DEPLOY_WEB` keeps its name although the Worker now carries the API too — renaming it would silently switch off the deploy on an instance that had already set it.

The job lints, type-checks, builds and runs the full test suite before it deploys, so a red test run stops the deploy. It only runs against `SriSatyaLokesh/pariksha`, so forks never attempt a deploy, and if `DEPLOY_WEB` is set while a secret is missing it fails with an explanation instead of a wrangler stack trace.

**It deploys code and nothing else.** `wrangler deploy` does not touch the schema; migrations are applied by `setup.mjs`, which a human runs. That is what makes an automatic deploy safe for a Worker with a database, and it means the ordering is yours to get right: when a change needs a new migration, run `node deploy/cloudflare/setup.mjs` **before** merging it, so the new schema is in place when the new code arrives.

## What CI checks without an account

`ci.yml` runs two steps that need no credentials: `wrangler deploy --dry-run`, which proves this config parses and the Worker bundles, and `node deploy/cloudflare/setup.mjs --dry-run`, which runs the setup flow twice against an in-memory Cloudflare and asserts the second run changes nothing. `apps/api/test/worker.test.ts` runs the real Worker entry against Miniflare — D1's own engine, locally — and is where the migrations are proved against D1 rather than against better-sqlite3.
