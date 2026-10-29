# Contributor setup

Get Pariksha running on your machine, prove your change, and open a pull request. Nothing here needs a Cloudflare account, Docker, or any network beyond `pnpm install`.

For the process side (commit style, sign-off, what we look for) see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| Node.js | 22 or newer | `engines.node` in `package.json` is `>=22`; the API runs TypeScript natively |
| pnpm | 10 (`10.18.0` is pinned) | `corepack enable` picks the pinned version up automatically |
| Git | any recent | commits must be signed off (`git commit -s`) |

Chromium for the browser suite is installed on demand: `pnpm --filter @pariksha/web exec playwright install chromium`.

## 1. Clone, install, build

```bash
git clone https://github.com/<your-fork>/pariksha.git
cd pariksha
pnpm install
SITE_URL="https://pariksha.example" pnpm build
```

- **`SITE_URL` is required.** The landing-page prerender refuses to invent an origin. Any absolute `https` URL works locally; it only affects canonical and Open Graph tags.
- **Build order matters.** `packages/core`, `packages/db` and `packages/storage` must be built before `apps/api` or `apps/web` will type-check. `pnpm build` does this through `turbo`; a bare `tsc` inside an app does not.

## 2. Run it locally

The API and the web app are two processes. The browser must reach both on **one origin**, because the session cookie is `HttpOnly`, `SameSite=Lax` and `Secure`. The Vite dev server proxies `/api` to port 8787, so open the Vite URL (`http://localhost:5173`) and never the API's.

**Terminal 1 — the API** (it migrates the database on boot, so a new path is a new, empty instance):

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

Open `http://localhost:5173/admin.html`. `/` is the landing page and is deliberately empty under `vite dev`; it only has content after `pnpm build` runs the prerender.

### Signing in

A brand-new instance has no accounts, so a magic link cannot reach anyone. To get the first owner in, configure an OpenID provider with `OIDC_PROVIDERS`, or run the end-to-end suite (below), which ships a stub provider. With `EMAIL_CONSOLE=true` the magic-link email is printed to the API's log instead of sent, for accounts that already exist.

### Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `SESSION_SECRET` | yes | Signs sessions. At least 32 hex characters |
| `DATABASE_URL` | yes | SQLite file path (or `:memory:`), or a Postgres URL |
| `STORAGE_DIR` | no | Local directory for uploaded files and snapshots. Defaults to `./data/storage` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION` | no | S3-compatible storage (MinIO, R2) instead of `STORAGE_DIR`; the first four must all be set |
| `PUBLIC_URL` | yes | The origin the browser uses. `http://localhost:5173` in dev |
| `APP_URL` | no | The origin magic-link URLs are built against |
| `OIDC_PROVIDERS` | one sign-in method | JSON array of `{ id, label, issuer, clientId, clientSecret, redirectUri }` |
| `EMAIL_ENDPOINT`, `EMAIL_TOKEN`, `EMAIL_FROM` | one sign-in method | Magic links through any transactional-email HTTP endpoint |
| `EMAIL_CONSOLE` | no | `true` prints magic links to the log. Refused in production unless set deliberately |
| `PASSWORD_AUTH` | no | `true` or `false`; password sign-in, used by the Docker self-host |
| `CAPTCHA_SECRET`, `CAPTCHA_VERIFY_URL` | no | Optional external CAPTCHA verification |
| `STATIC_DIR` | no | Directory the Node server serves the built web app from |
| `PORT` | no | API port. Defaults to 8787, which the Vite proxy expects |

`apps/api/src/env.ts` is the source of truth; if this table and that file disagree, the file wins and this page needs a fix.

## 3. Prove your change

Cheapest tier first:

| When | Command | Notes |
| --- | --- | --- |
| While iterating | `pnpm test:changed` | Only test files your uncommitted changes affect |
| One package | `pnpm test:pkg @pariksha/web` | Rebuilds the packages it depends on first |
| Lint and types | `pnpm lint` and `pnpm typecheck` | Whole workspace |
| Browser flow | `pnpm --filter @pariksha/web e2e` | Real Chromium against a local server and a local stub identity provider. Not part of `pnpm test` |
| Before committing | `npx turbo run test --concurrency=1 -- --no-file-parallelism` | The full suite, run **alone** |

Three traps worth knowing before you trust a red or green result:

1. **Run the full suite on its own.** Two full suites at once, or `turbo` running `apps/api` and `apps/web` concurrently, produces a cascade of unrelated timing failures. `--concurrency=1` fixes that. The bare `--` before `--no-file-parallelism` is required: without it `turbo` rejects the flag and the wrapper can still exit 0 having run no tests. **Read the output, not the exit code.**
2. **One timing failure under load is not a real failure** until it fails again alone. Re-run the whole file, not a single test with `-t`.
3. **Cross-package changes need `pnpm test`.** `pnpm test:changed` follows imports, but packages import each other through built `dist/`, so editing `packages/core` reports no affected tests in `apps/api`.

## 4. Things you must not run

Pariksha has a live Cloudflare deployment, and the free plan is metered. These commands touch it and need the maintainers' say-so, so do not run them "to try something":

- `node deploy/cloudflare/setup.mjs`
- `wrangler deploy`, `pnpm deploy:cf`
- `wrangler d1 execute … --remote`
- `wrangler r2 object put` or `delete`
- `wrangler secret put`

Free substitutes that need no account:

- `node deploy/cloudflare/setup.mjs --dry-run` runs the whole setup flow against an in-memory Cloudflare.
- `pnpm --filter @pariksha/api exec wrangler deploy --dry-run -c ../../deploy/cloudflare/wrangler.toml` proves the config parses and the Worker bundles.
- `pnpm --filter @pariksha/api test` includes `worker.test.ts`, the real Worker entry against Miniflare (D1's own engine, locally).

### If your change adds a migration

`wrangler deploy` never touches the schema; only a maintainer running `setup.mjs` does. Put the migration in `packages/db/migrations/sqlite/` and say so in the pull request, so a maintainer can apply it **before** merge. After a merge that carries a migration, `GET /api/v1/health` must report `{"migrations": N}` with N equal to the number of files in that directory.

## 5. Open the pull request

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`).
2. Add or update tests; update `CHANGELOG.md` under *Unreleased* if behaviour changed.
3. Commit with a Conventional Commit message and sign off: `git commit -s -m "fix(api): reject answers after the deadline"`.
4. Stage files by name rather than `git add -A`.
5. Fill in the pull-request template. CI must pass and one maintainer must approve. Pull requests are squash-merged.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `SITE_URL` error during `pnpm build` | Set it: `SITE_URL="https://pariksha.example" pnpm build` |
| Type errors in `apps/*` about missing `@pariksha/core` exports | Packages not built. Run `pnpm build` |
| Sign-in page says no sign-in method is configured | Set `OIDC_PROVIDERS` or the `EMAIL_*` variables |
| Signed in, then 401 on every call | You opened the API's port (8787) instead of the Vite URL (5173) |
| Landing page blank under `vite dev` | Expected. Run `pnpm build` for the prerendered page |
| `turbo` says `unexpected argument '--no-file-parallelism'` | Missing the bare `--` before the flag |
| A handful of unrelated tests fail only on a full run | Machine load. Re-run with `--concurrency=1`, then re-run the failing file alone |
