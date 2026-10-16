# Deploy on Cloudflare (zero cost)

The reference deployment: Pages (web app), Workers (API), D1 (database), R2 (snapshots), Turnstile (bot check) and Cron Triggers (retention jobs), all on the free plan.

**Status:** planned for v0.1. It will include a `wrangler.toml` template, a setup script that creates the D1 database and R2 bucket, and a "Deploy to Cloudflare" button. Free-tier sizing is in [PRD — Non-functional requirements](../../docs/PRD.md#non-functional-requirements).
