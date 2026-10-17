# Deploy on Cloudflare (zero cost)

The reference deployment: Workers Static Assets (web app), Workers (API), D1 (database), R2 (snapshots), Turnstile (bot check) and Cron Triggers (retention jobs), all on the free plan.

**Status:** configured for the web app but not yet published — deploying the site is deliberately deferred, and the configuration below has had no code review. Planned for the API. Free-tier sizing is in [PRD — Non-functional requirements](../../docs/PRD.md#non-functional-requirements).

## Web app

`apps/web` deploys as a Cloudflare Worker with [Static Assets](https://developers.cloudflare.com/workers/static-assets/) — no Worker script, no D1, no R2. Every request is served straight from Cloudflare's asset store, so it costs nothing: static asset requests are free and unmetered on the Workers free plan, and only Worker *script* invocations count against the 100,000 requests/day limit. This deployment has no script to invoke.

First-time setup:

```bash
pnpm install && pnpm build
pnpm --filter @pariksha/web exec wrangler login
```

Then deploy any time with:

```bash
pnpm --filter @pariksha/web deploy
```

The app goes live at `https://pariksha-web.<your-subdomain>.workers.dev`. To use a custom domain instead, add it in the Cloudflare dashboard under **Workers & Pages → pariksha-web → Settings → Domains & Routes**, or add a `routes` entry to `apps/web/wrangler.jsonc`.

`.github/workflows/deploy-web.yml` deploys automatically on every push to `main`, using the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. It only runs against `SriSatyaLokesh/pariksha`, so forks never attempt a deploy, and it fails with an explanation instead of a wrangler stack trace if the secrets aren't set.

## API, D1 and R2

Planned for Phase 2: a `wrangler.jsonc` with a Worker `main`, a setup script that creates the D1 database and R2 bucket, and a "Deploy to Cloudflare" button.
