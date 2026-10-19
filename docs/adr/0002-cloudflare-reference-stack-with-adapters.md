# 0002. Cloudflare free plan as the reference stack, behind adapters

- **Status:** Accepted — the reference-stack list below is **amended by
  [ADR 0009](0009-same-origin-proof-of-work-instead-of-a-hosted-captcha.md)**,
  which drops Turnstile from the default deployment. Everything else stands.
- **Date:** 2026-10-16

## Context

Pariksha promises zero-cost hosting for a test of about 500 candidates in one hour (about 55,000 API requests and 55,000 database row writes, plus 0.75 GB of snapshots). We compared free tiers:

- **Cloudflare:** Workers 100,000 requests/day, D1 100,000 rows written/day, R2 10 GB storage. Fits.
- **Supabase free:** sign-in is rate-limited to 30 requests per 5 minutes per IP, and Realtime to 200 concurrent clients. A campus behind one IP breaks the sign-in limit.
- **Firebase Spark:** Firestore allows 20,000 writes/day, and Cloud Storage is not available on the free plan since 2024.
- **Cloudflare KV:** 1,000 writes/day, so it is unsuitable for answers.

Some organisers will not want Cloudflare and will run their own servers.

## Decision

- The reference deployment uses Cloudflare Pages, Workers, D1, R2, Turnstile and Cron Triggers on the free plan. **(Amended by [ADR 0009](0009-same-origin-proof-of-work-instead-of-a-hosted-captcha.md): Turnstile is not in the default deployment. Bot protection is a same-origin proof of work, and a hosted captcha is a per-instance opt-in, because a widget's `script-src`, `frame-src` and `connect-src` entries cannot be reconciled with `S-11`.)**
- All code is written against three interfaces: database (Drizzle, for D1, SQLite and Postgres), object storage (R2, S3, disk) and identity (OIDC, email, captcha). The captcha half of the identity adapter ships as `verifyCaptcha`, switched off — ADR 0009 again.
- The API uses Hono so the same code runs on Workers and Node, and a Docker deployment is maintained alongside.
- To stay inside free limits, the snapshot upload doubles as the heartbeat, events are batched, and interval snapshots get no database row.
- Strong password hashing does not fit the Workers free plan's 10 ms CPU limit, so organiser sign-in there uses OIDC or magic links. Passwords with Argon2id are offered on Docker only.
- No API endpoint may issue more than a handful of D1 or R2 calls, because the free plan allows 50 subrequests per invocation and every storage call counts as one. Endpoints fetch a candidate's questions in one query, not one query per question.

## Why Workers can host the API at all

Worth stating plainly, because "serverless" and "static hosting" get conflated: a Worker **is** an HTTP request handler. `fetch(request, env, ctx)` receives the request and returns the response, which is exactly what a REST API does, and Hono is a router written for that runtime. Cloudflare's own documentation uses Hono on Workers as the example. There is no separate server to run and no backend that Pages cannot host — Pages Functions are Workers too.

What the free plan does restrict is the *shape* of each request, not whether it can be one:

| Free plan | Limit | Consequence |
| --- | --- | --- |
| Requests | 100,000 / day | About 55,000 for 500 candidates in an hour. Fits |
| CPU per invocation | 10 ms | No password hashing. Waiting on D1 or R2 is not CPU time |
| Subrequests per invocation | 50 | Few storage calls per endpoint; batch, never loop |

Those are the real constraints, and the adapters exist precisely so an organiser who outgrows them moves to Docker and Postgres without a rewrite.

## Consequences

- Two database dialects must be tested in CI.
- Free-tier limits can change, so the admin dashboard shows usage against the daily limits and warns at 70%.
- Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Supabase auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits), [Firebase pricing](https://firebase.google.com/pricing).
