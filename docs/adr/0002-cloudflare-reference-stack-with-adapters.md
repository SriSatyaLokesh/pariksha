# 0002. Cloudflare free plan as the reference stack, behind adapters

- **Status:** Accepted
- **Date:** 2026-10-16

## Context

Pariksha promises zero-cost hosting for a test of about 500 candidates in one hour (about 55,000 API requests and 55,000 database row writes, plus 0.75 GB of snapshots). We compared free tiers:

- **Cloudflare:** Workers 100,000 requests/day, D1 100,000 rows written/day, R2 10 GB storage. Fits.
- **Supabase free:** sign-in is rate-limited to 30 requests per 5 minutes per IP, and Realtime to 200 concurrent clients. A campus behind one IP breaks the sign-in limit.
- **Firebase Spark:** Firestore allows 20,000 writes/day, and Cloud Storage is not available on the free plan since 2024.
- **Cloudflare KV:** 1,000 writes/day, so it is unsuitable for answers.

Some organisers will not want Cloudflare and will run their own servers.

## Decision

- The reference deployment uses Cloudflare Pages, Workers, D1, R2, Turnstile and Cron Triggers on the free plan.
- All code is written against three interfaces: database (Drizzle, for D1, SQLite and Postgres), object storage (R2, S3, disk) and identity (OIDC, email, captcha).
- The API uses Hono so the same code runs on Workers and Node, and a Docker deployment is maintained alongside.
- To stay inside free limits, the snapshot upload doubles as the heartbeat, events are batched, and interval snapshots get no database row.
- Strong password hashing does not fit the Workers free plan's 10 ms CPU limit, so organiser sign-in there uses OIDC or magic links. Passwords with Argon2id are offered on Docker only.

## Consequences

- Two database dialects must be tested in CI.
- Free-tier limits can change, so the admin dashboard shows usage against the daily limits and warns at 70%.
- Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Supabase auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Firebase pricing](https://firebase.google.com/pricing).
