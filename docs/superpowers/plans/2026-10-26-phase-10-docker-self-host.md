# Phase 10: Docker Self-Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

This plan implements **Phase 10 — Docker Self-Host** of the Pariksha roadmap, satisfying PRD items **O-03**, **S-01**, **S-02**, and **AC-01**.

---

## Architecture & Principles
1. **`ponytail` for Code**:
   - Simplest, shortest path that works. Standard library first.
   - RFC 6238 TOTP using standard HMAC crypto rather than bulky dependencies.
   - Fast, reliable Argon2id password hashing via prebuilt `@node-rs/argon2`.
   - Node built-in scheduler (`setInterval.unref`) calling existing `runScheduled`.
2. **`uiuxpromax` for UI UX**:
   - Password and TOTP forms matching Signal design tokens and WCAG contrast guards.
   - Clean keyboard accessible forms with proper labels, errors, and autocomplete tokens.
3. **Dual Database & Dual Storage**:
   - SQLite (zero external dependencies) and Postgres 16 (high scale).
   - Local disk storage (zero external dependencies) and MinIO / S3 (distributed object storage).
   - Static asset serving from the Node API container with Caddy reverse proxy for automatic HTTPS.

---

## File Structure

```
deploy/docker/
├── Dockerfile                         # Multi-stage production container
├── docker-compose.yml                 # Full stack: Pariksha, Postgres, MinIO, Caddy
├── docker-compose.sqlite.yml          # Minimal single-host stack: Pariksha + SQLite + Caddy
├── Caddyfile                          # Reverse proxy with automatic TLS & caching
├── .env.example                       # Documented environment variables
├── backup.sh                          # Backup script for SQLite & Postgres
├── restore.sh                         # Restore script for SQLite & Postgres
└── README.md                          # Quick start and operations guide (< 30 min AC-01)

packages/db/
├── migrations/
│   └── 0010_user_password.sql         # Migration adding password & totp columns
├── src/
│   ├── schema/
│   │   ├── sqlite.ts                  # Add passwordHash, totpSecret, totpEnabled
│   │   └── pg.ts                      # Add passwordHash, totpSecret, totpEnabled
│   └── repo/
│       └── identity.ts                # Password & TOTP queries
└── test/
    └── repo/
        └── password.test.ts           # DB credentials test

apps/api/
├── src/
│   ├── auth/
│   │   ├── password.ts                # Argon2id hashing & RFC 6238 TOTP
│   │   └── identity.ts                # List 'password' provider on Node
│   ├── routes/
│   │   ├── auth.ts                    # POST /auth/password/signin, register, totp
│   │   └── static.ts                  # Static assets & SPA fallback
│   ├── env.ts                         # S3 storage env & password auth config
│   └── node.ts                        # S3/disk switch, static handler, scheduled timer
└── test/
    ├── auth/
    │   └── password.test.ts           # Argon2id & TOTP unit tests
    └── routes/
        └── password-auth.test.ts      # Password sign-in & TOTP verification tests

apps/web/
├── src/
│   └── routes/
│       ├── signin.tsx                 # Email/password & 2FA TOTP view
│       └── setup.tsx                  # Instance owner password setup
└── test/
    └── routes/
        └── signin-password.test.tsx   # Password login UI tests
```

---

## Tasks

### Task 1: Database Schema & Migration for Password and TOTP (Lane A)
- [ ] Add `passwordHash`, `totpSecret`, and `totpEnabled` columns to `user` in `packages/db/src/schema/sqlite.ts` and `packages/db/src/schema/pg.ts`.
- [ ] Create `packages/db/migrations/0010_user_password.sql` applying columns across SQLite, D1, and Postgres.
- [ ] Export repository helper functions in `packages/db/src/repo/identity.ts`:
  - `setUserPassword(db, userId, passwordHash)`
  - `setUserTotp(db, userId, { secret, enabled })`
  - `getUserCredentials(db, email)`
- [ ] Write tests in `packages/db/test/repo/password.test.ts` verifying migration application and credential persistence.
- [ ] Verify `pnpm --filter @pariksha/db test`.

### Task 2: Argon2id Hashing, TOTP, and Password Auth Routes in `@pariksha/api` (Lane B)
- [ ] Implement `apps/api/src/auth/password.ts`:
  - `hashPassword(password: string): Promise<string>` using `@node-rs/argon2`.
  - `verifyPassword(hash: string, password: string): Promise<boolean>` using `@node-rs/argon2`.
  - `generateTotpSecret(): string` (base32 string).
  - `getTotpUri(email: string, secret: string, issuer?: string): string`.
  - `verifyTotp(token: string, secret: string): boolean` (with +/- 1 step drift window).
- [ ] Update `apps/api/src/auth/identity.ts`:
  - Return `{ id: "password", kind: "password", label: "Email and password" }` when `env.target === "node"`.
- [ ] Add password auth endpoints to `apps/api/src/routes/auth.ts`:
  - `POST /api/v1/auth/password/signin` (validates email & password, verifies TOTP if enabled, issues session cookie, logs audit).
  - `POST /api/v1/auth/password/totp/setup` (authenticated user gets TOTP secret & otpauth URI).
  - `POST /api/v1/auth/password/totp/verify` (validates code, sets `totp_enabled = true`).
- [ ] Write unit & route tests in `apps/api/test/auth/password.test.ts` and `apps/api/test/routes/password-auth.test.ts`.
- [ ] Verify `pnpm --filter @pariksha/api test`.

### Task 3: Organiser Web UI for Password Sign-in & First Run (Lane C)
- [ ] Update `apps/web/src/routes/signin.tsx`:
  - If `providers` has `password`, display email and password inputs.
  - If server response indicates 2FA required (`totp_required`), present 6-digit TOTP code input.
  - Adhere strictly to Signal design tokens, accessible form patterns, and contrast guards.
- [ ] Update `apps/web/src/routes/setup.tsx`:
  - Allow setting an owner password during first-run setup when on Docker.
- [ ] Add unit tests in `apps/web/test/routes/signin-password.test.tsx`.
- [ ] Verify `pnpm --filter @pariksha/web test test/routes/signin-password.test.tsx` and contrast guards.

### Task 4: Node Server Static Assets, MinIO/S3 Storage & In-Process Scheduler (Lane B)
- [ ] Extend `apps/api/src/env.ts` for Node:
  - `STATIC_DIR`: directory serving `apps/web/dist`.
  - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`.
- [ ] Update `apps/api/src/node.ts`:
  - Initialize storage: if S3 options present, use `s3Adapter(options)`; otherwise use `diskAdapter(options)`.
  - Mount static assets serving `STATIC_DIR` with SPA fallback for `/`, `/admin/*`, and `/t/*`.
  - Start periodic `setInterval` calling `runScheduled(deps, env)` every 60s (with `scheduler.unref()`).
- [ ] Write tests in `apps/api/test/node-server.test.ts`.
- [ ] Verify `pnpm --filter @pariksha/api test test/node-server.test.ts`.

### Task 5: Docker Packaging, Docker Compose, Caddy & Backup/Restore (Lane D)
- [ ] Create `deploy/docker/Dockerfile`:
  - Multi-stage build (pnpm install, build packages, build web, build api, minimal node production runner).
- [ ] Create `deploy/docker/docker-compose.yml`:
  - Full production stack with `pariksha`, `postgres:16-alpine`, `minio/minio`, and `caddy:2-alpine`.
- [ ] Create `deploy/docker/docker-compose.sqlite.yml`:
  - Lean single-container stack with SQLite, local disk storage, and optional Caddy.
- [ ] Create `deploy/docker/Caddyfile`:
  - Automatic HTTPS, reverse proxy to pariksha:8787, static caching headers, websocket proxying.
- [ ] Create `deploy/docker/.env.example` with documented configuration.
- [ ] Create `deploy/docker/backup.sh` and `deploy/docker/restore.sh` with safe snapshotting.
- [ ] Update `deploy/docker/README.md` with complete step-by-step setup satisfying `AC-01`.

### Task 6: Monorepo Verification, Acceptance Gate & Deployment
- [ ] Run full test suite: `pnpm turbo run test`.
- [ ] Run typecheck: `pnpm turbo run typecheck`.
- [ ] Run lint: `pnpm turbo run lint`.
- [ ] Run build: `SITE_URL=https://pariksha.org pnpm turbo run build`.
- [ ] Update `docs/ROADMAP.md` Phase 10 status to Done.
- [ ] Commit, merge to `main`, push and verify GitHub Actions CI/CD.
