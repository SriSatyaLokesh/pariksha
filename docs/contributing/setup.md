# Setup guide

Three ways to run Pariksha, plus Google sign-in for any of them. Pick the one that matches what you are doing:

| You want to | Use | Needs |
| --- | --- | --- |
| Change code and run the tests | [A. Local development](#a-local-development) | Node 22, pnpm 10 |
| Run your own instance on a server or laptop | [B. Docker](#b-docker-self-host) | Docker with Compose v2 |
| Run your own instance on Cloudflare's free tier | [C. Cloudflare](#c-cloudflare-serverless) | A Cloudflare account, Node 22, pnpm 10 |
| Add "Sign in with Google" to any of them | [D. Google sign-in](#d-google-sign-in) | A Google account |

For the process side (commit style, sign-off, what we look for) see [CONTRIBUTING.md](../../CONTRIBUTING.md). Full production guidance is in the [Deployment Guide](../deployment.md).

## Prerequisites

| Tool | Version | Needed for |
| --- | --- | --- |
| Node.js | 22 or newer (`engines.node` is `>=22`) | A and C |
| pnpm | 10 (`10.18.0` is pinned; `corepack enable` picks it up) | A and C |
| Docker | Engine with Compose v2.20+ | B |
| Git | any recent | all. Commits must be signed off (`git commit -s`) |

---

## A. Local development

The fastest loop: no Docker, no Cloudflare, no network beyond `pnpm install`.

### 1. Clone, install, build

```bash
git clone https://github.com/<your-fork>/pariksha.git
cd pariksha
pnpm install
SITE_URL="https://pariksha.example" pnpm build
```

- **`SITE_URL` is required.** The landing-page prerender refuses to invent an origin. Any absolute `https` URL works locally; it only affects canonical and Open Graph tags.
- **Build order matters.** `packages/core`, `packages/db` and `packages/storage` must be built before `apps/api` or `apps/web` will type-check. `pnpm build` does this through `turbo`; a bare `tsc` inside an app does not.

### 2. Run the API and the web app

Two processes. The browser must reach both on **one origin**, because the session cookie is `HttpOnly`, `SameSite=Lax` and `Secure`. The Vite dev server proxies `/api` to port 8787, so open the Vite URL (`http://localhost:5173`) and never the API's.

**Terminal 1 — the API.** It migrates the database on boot, so a path that does not exist yet is a new, empty instance.

```bash
# bash / zsh / Git Bash
SESSION_SECRET="$(openssl rand -hex 32)" \
DATABASE_URL=./pariksha.sqlite \
STORAGE_DIR=./files \
PUBLIC_URL=http://localhost:5173 \
EMAIL_CONSOLE=true \
  node apps/api/dist/node.js
```

```powershell
# PowerShell
$env:SESSION_SECRET = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
$env:DATABASE_URL = "./pariksha.sqlite"
$env:STORAGE_DIR = "./files"
$env:PUBLIC_URL = "http://localhost:5173"
$env:EMAIL_CONSOLE = "true"
node apps/api/dist/node.js
```

**Terminal 2 — the web app:**

```bash
pnpm --filter @pariksha/web dev
```

### 3. First sign-in

Open `http://localhost:5173/admin.html`. On the Node target, email-and-password sign-in is on by default, and while no workspace exists the first registration is open: register with an email and password, name your first workspace, and you are the owner of the instance. After that, registration is closed and new people are invited.

With `EMAIL_CONSOLE=true`, magic-link emails for accounts that already exist are printed to the API's log instead of sent. To sign in with Google instead, see [D](#d-google-sign-in). To watch a first run with nothing configured, run the browser suite (below), which brings its own stub identity provider.

`/` is the landing page and is deliberately empty under `vite dev`; it only has content after `pnpm build` runs the prerender.

### 4. Prove your change

Cheapest tier first:

| When | Command | Notes |
| --- | --- | --- |
| While iterating | `pnpm test:changed` | Only test files your uncommitted changes affect |
| One package | `pnpm test:pkg @pariksha/web` | Rebuilds the packages it depends on first |
| Lint and types | `pnpm lint` and `pnpm typecheck` | Whole workspace |
| Browser flow | `pnpm --filter @pariksha/web e2e` | Real Chromium against a local server and a local stub identity provider. Not part of `pnpm test`. First time: `pnpm --filter @pariksha/web exec playwright install chromium` |
| Before committing | `npx turbo run test --concurrency=1 -- --no-file-parallelism` | The full suite, run **alone** |

Three traps worth knowing before you trust a red or green result:

1. **Run the full suite on its own.** Two full suites at once, or `turbo` running `apps/api` and `apps/web` concurrently, produces a cascade of unrelated timing failures. `--concurrency=1` fixes that. The bare `--` before `--no-file-parallelism` is required: without it `turbo` rejects the flag and the wrapper can still exit 0 having run no tests. **Read the output, not the exit code.**
2. **One timing failure under load is not a real failure** until it fails again alone. Re-run the whole file, not a single test with `-t`.
3. **Cross-package changes need `pnpm test`.** `pnpm test:changed` follows imports, but packages import each other through built `dist/`, so editing `packages/core` reports no affected tests in `apps/api`.

### 5. Open the pull request

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Add or update tests; update `CHANGELOG.md` under *Unreleased* if behaviour changed.
3. Commit with a Conventional Commit message and sign off: `git commit -s -m "fix(api): reject answers after the deadline"`.
4. Stage files by name rather than `git add -A`.
5. Fill in the pull-request template. CI must pass and one maintainer must approve. Pull requests are squash-merged.

If your change adds a migration, put it in `packages/db/migrations/sqlite/` and say so in the pull request. `wrangler deploy` never touches the schema; a maintainer applies migrations to the live database before merge.

---

## B. Docker self-host

One container serves the API and the web app; Caddy in front gives automatic HTTPS. Two stacks, same image:

| Stack | Compose file | Database | Storage | Memory |
| --- | --- | --- | --- | --- |
| Lightweight | `docker-compose.sqlite.yml` | SQLite | local volume | ~80 MB |
| Production | `docker-compose.yml` | PostgreSQL 16 | MinIO (S3 API) | ~350 MB |

### 1. Configure

```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha/deploy/docker
cp .env.example .env
```

Edit `.env`:

| Variable | Set it to |
| --- | --- |
| `DOMAIN` | Your domain or `localhost`. Caddy gets its TLS certificate for this name |
| `PUBLIC_URL` | `https://<your-domain>`, or `http://localhost:8787` locally |
| `ACME_EMAIL` | An address for Let's Encrypt notices |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` | Strong random values. Production stack only |

`EMAIL_ENDPOINT`, `EMAIL_TOKEN` and `EMAIL_FROM` are optional (magic links through a transactional-email HTTP API). Both compose files set `EMAIL_CONSOLE: "true"`, so magic links print to the container log until you wire a real sender.

### 2. Start

```bash
# Lightweight: SQLite + local disk
docker compose -f docker-compose.sqlite.yml up -d --build

# or Production: Postgres 16 + MinIO
docker compose up -d --build
```

### 3. First run

Open `PUBLIC_URL` (`http://localhost:8787` locally). The first-run wizard asks you to name the workspace and create the owner with an email and password; you can turn on TOTP two-factor authentication afterwards from your profile. Check it is healthy:

```bash
curl -f http://localhost:8787/api/v1/health
```

### 4. Operate

```bash
./backup.sh                                          # timestamped archive in ./backups/
./restore.sh ./backups/pariksha_backup_<timestamp>.tar.gz
docker compose -f docker-compose.sqlite.yml logs -f pariksha   # magic links print here
```

Everything else (Caddy, clustering, air-gapped labs) is in [`deploy/docker/README.md`](../../deploy/docker/README.md) and the [Deployment Guide](../deployment.md). To add Google sign-in to this stack, follow [D](#d-google-sign-in).

---

## C. Cloudflare serverless

One Worker serves the web app (Static Assets) and the API, with D1 (database) and R2 (storage) behind it, all on the free plan. Why it is one Worker and not two is in [`deploy/cloudflare/README.md`](../../deploy/cloudflare/README.md).

> **Use your own account.** The maintainers' live instance is `pariksha-web.srisatyalokesh2-12.workers.dev`, and its CI deploys on every push to `main`. You have no credentials for it, and a fork never deploys there. The steps below create a **separate** instance in a Cloudflare account you own. Free plan means *metered with a free allowance*: D1 reads and writes, R2 operations and Worker invocations count against it.

### 1. Token and login

You need a Cloudflare account and, for CI, an API token with **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit** and **Account Settings: Read** (Dashboard → My Profile → API Tokens → Create Token → *Edit Cloudflare Workers*). For a one-off deploy from your machine, `wrangler login` is enough:

```bash
pnpm install
SITE_URL="https://pariksha-web.<your-subdomain>.workers.dev" pnpm build
pnpm --filter @pariksha/api exec wrangler login
```

### 2. Rehearse for free

These need no account and change nothing; run them first:

```bash
node deploy/cloudflare/setup.mjs --dry-run
pnpm --filter @pariksha/api exec wrangler deploy --dry-run -c ../../deploy/cloudflare/wrangler.toml
```

The first runs the whole setup flow twice against an in-memory Cloudflare and checks that the second run changes nothing. The second proves the config parses and the Worker bundles.

### 3. Provision, migrate, deploy

```bash
node deploy/cloudflare/setup.mjs        # creates D1 + R2 if missing, applies migrations. Idempotent
pnpm --filter @pariksha/api exec wrangler secret put SESSION_SECRET -c ../../deploy/cloudflare/wrangler.toml
pnpm deploy:cf
curl https://pariksha-web.<your-subdomain>.workers.dev/api/v1/health
```

`setup.mjs` writes the new database's id into `wrangler.toml`; commit it on your fork. The health check answers `{"status":"ok","dialect":"d1","migrations":N}`, where **N must equal the number of files in `packages/db/migrations/sqlite/`**. Check this after any deploy that carries a migration. `wrangler deploy` never touches the schema, so run `setup.mjs` **before** deploying code that needs a new migration.

### 4. Sign in

The Cloudflare target has **no password sign-in** (that is Docker/Node only). A fresh instance has no accounts, so a magic link cannot reach anyone yet: configure Google (or another OIDC provider) with [D](#d-google-sign-in) before you try to sign in. Magic links (`EMAIL_ENDPOINT`, `EMAIL_TOKEN`, `EMAIL_FROM`) work once at least one account exists.

### 5. Secrets and local `wrangler dev`

Set secrets with `wrangler secret put NAME -c deploy/cloudflare/wrangler.toml`, never under `[vars]` (that block is plaintext). For `wrangler dev`, copy [`deploy/cloudflare/.dev.vars.example`](../../deploy/cloudflare/.dev.vars.example) to `deploy/cloudflare/.dev.vars` (gitignored). Secret names: `SESSION_SECRET` (required), `APP_URL`, `EMAIL_ENDPOINT`/`EMAIL_TOKEN`/`EMAIL_FROM` (all three or none), `EMAIL_CONSOLE`, `OIDC_PROVIDERS`.

### 6. Automatic deploys (optional)

`.github/workflows/deploy.yml` deploys on every push to `main`, but only when you turn it on. In your fork's **Settings → Secrets and variables → Actions** add secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and variables `DEPLOY_WEB=true` and `SITE_URL=<your Worker URL>`. The job is also gated to the upstream repository name, so edit that condition in your fork if you want it to run there. Details: [`deploy/cloudflare/README.md`](../../deploy/cloudflare/README.md#automatic-deployment).

### Commands that touch a live account

Against **any** account that matters, these are not "try it and see" commands: `setup.mjs` (without `--dry-run`), `wrangler deploy` / `pnpm deploy:cf`, `wrangler d1 execute … --remote`, `wrangler r2 object put|delete`, `wrangler secret put`. The free equivalents are `--dry-run`, `pnpm --filter @pariksha/api test` (which runs the real Worker against Miniflare, D1's own engine, locally) and `pnpm --filter @pariksha/web e2e`. No test in this repository reaches Cloudflare.

---

## D. Google sign-in

Pariksha speaks standard OpenID Connect; Google is configured the same way as any provider, through one variable, `OIDC_PROVIDERS`. If an instance configures only Google, the sign-in page shows only Google.

### 1. Create the Google OAuth client

In the [Google Cloud Console](https://console.cloud.google.com/):

1. Create or pick a project.
2. **APIs & Services → OAuth consent screen**: configure it. While the app is in *Testing*, only the test users you add can sign in.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. Under **Authorised redirect URIs**, add the callback for each place you will run it. It is always `<origin>/api/v1/auth/google/callback`, and it must match what you put in `OIDC_PROVIDERS` **byte for byte**:

| Where | Redirect URI |
| --- | --- |
| Local development | `http://localhost:5173/api/v1/auth/google/callback` (the Vite origin, not 8787, so the cookie lands on the app's origin) |
| Docker | `<PUBLIC_URL>/api/v1/auth/google/callback` |
| Cloudflare | `https://pariksha-web.<your-subdomain>.workers.dev/api/v1/auth/google/callback`, or your custom domain |

5. Copy the **Client ID** and **Client secret**.

### 2. The configuration

One JSON array, on a single line. `id` is `google` so the callback path above matches. Scopes default to `openid email profile`; Google reports `email_verified`, so nothing else is needed.

```json
[{"id":"google","label":"Google","issuer":"https://accounts.google.com","clientId":"<client id>","clientSecret":"<client secret>","redirectUri":"<redirect URI from the table>"}]
```

Treat `clientSecret` as a secret: never commit it, and never put it under `[vars]` in `wrangler.toml`.

### 3. Give it to the instance

**Local development.** Add it to the API's environment (Terminal 1 in [A](#2-run-the-api-and-the-web-app)), then restart the API:

```bash
OIDC_PROVIDERS='[{"id":"google","label":"Google","issuer":"https://accounts.google.com","clientId":"…","clientSecret":"…","redirectUri":"http://localhost:5173/api/v1/auth/google/callback"}]' \
  node apps/api/dist/node.js   # plus the variables from step A.2
```

In PowerShell: `$env:OIDC_PROVIDERS = '[{"id":"google",…}]'` before `node apps/api/dist/node.js`.

**Docker.** The compose files do **not** forward `OIDC_PROVIDERS` to the container today, so add it yourself, only when you are using Google:

1. In `deploy/docker/.env` add the single-quoted line `OIDC_PROVIDERS='[{"id":"google",…}]'`.
2. In the compose file you use, under `services.pariksha.environment`, add `OIDC_PROVIDERS: ${OIDC_PROVIDERS}`.
3. `docker compose -f <file> up -d` to recreate the container.

Do not add the line and leave the value empty: an empty `OIDC_PROVIDERS` is not valid JSON and the API refuses to start. Password sign-in keeps working next to Google on Docker; set `PASSWORD_AUTH=false` on the container if you want Google only.

**Cloudflare.** Set it as a secret (the value is read from standard input):

```bash
echo '[{"id":"google",…}]' | pnpm --filter @pariksha/api exec wrangler secret put OIDC_PROVIDERS -c ../../deploy/cloudflare/wrangler.toml
```

For `wrangler dev`, put the same line in `deploy/cloudflare/.dev.vars`. This is the way to create the first owner on Cloudflare.

### 4. Check it

Open the sign-in page: a "Google" button should appear. Signing in the first time on an instance with no workspace walks you through naming it, and you become the owner. If Google answers `redirect_uri_mismatch`, the URI in the console and in `OIDC_PROVIDERS` differ (scheme, host, port or path); fix whichever is wrong and retry.

---

## Environment variables

`apps/api/src/env.ts` is the source of truth; if this table and that file disagree, the file wins and this page needs a fix.

| Variable | Required | What it does |
| --- | --- | --- |
| `SESSION_SECRET` | yes | Signs sessions. Use `openssl rand -hex 32`. Changing it signs everyone out |
| `DATABASE_URL` | Node only | SQLite file path (or `:memory:`), or a Postgres URL. On Cloudflare the `DB` binding replaces it |
| `PUBLIC_URL` | Node only | The origin the browser uses. `http://localhost:5173` in dev |
| `STORAGE_DIR` | no | Local directory for uploads and snapshots. Defaults to `./data/storage` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | no | S3-compatible storage (MinIO, R2) instead of `STORAGE_DIR`; the first four must all be set |
| `APP_URL` | no | The origin magic-link URLs are built against |
| `OIDC_PROVIDERS` | no | JSON array of `{ id, label, issuer, clientId, clientSecret, redirectUri, scopes?, allowUnverifiedEmail? }`. See [D](#d-google-sign-in) |
| `EMAIL_ENDPOINT`, `EMAIL_TOKEN`, `EMAIL_FROM` | no | Magic links through any transactional-email HTTP endpoint. All three or none |
| `EMAIL_CONSOLE` | no | `true` prints magic links to the log. Refused in production unless set deliberately |
| `PASSWORD_AUTH` | no | Node/Docker only. On unless set to `false` |
| `CAPTCHA_SECRET`, `CAPTCHA_VERIFY_URL` | no | Optional external CAPTCHA. Both or neither |
| `STATIC_DIR` | no | Directory the Node server serves the built web app from (set by the Docker image) |
| `PORT` | no | API port. Defaults to 8787, which the Vite proxy expects |

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `SITE_URL` error during `pnpm build` | Set it: `SITE_URL="https://pariksha.example" pnpm build` |
| Type errors in `apps/*` about missing `@pariksha/core` exports | Packages not built. Run `pnpm build` |
| Signed in, then 401 on every call | You opened the API's port (8787) instead of the Vite URL (5173) |
| Landing page blank under `vite dev` | Expected. Run `pnpm build` for the prerendered page |
| API will not start, "is not valid JSON" | `OIDC_PROVIDERS` is empty or malformed. Remove it or fix the JSON |
| Google: `redirect_uri_mismatch` | The console and `OIDC_PROVIDERS` redirect URIs differ. They must match byte for byte |
| Google: "Access blocked" or "not a test user" | The consent screen is in *Testing*; add your address as a test user |
| Sign-in page says no sign-in method is configured | Cloudflare/OIDC: set `OIDC_PROVIDERS`. Node: password sign-in is on unless `PASSWORD_AUTH=false` |
| Docker: Caddy cannot get a certificate | `DOMAIN` must resolve to the host and ports 80 and 443 must be reachable. Use `localhost` for local trials |
| `/api/v1/health` migrations count is below the number of migration files | `setup.mjs` has not been run for the newest migration (Cloudflare) |
| `turbo` says `unexpected argument '--no-file-parallelism'` | Missing the bare `--` before the flag |
| A handful of unrelated tests fail only on a full run | Machine load. Re-run with `--concurrency=1`, then re-run the failing file alone |
