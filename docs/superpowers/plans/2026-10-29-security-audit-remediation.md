# Security Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remediate all four confirmed security audit vulnerabilities (Issues #277, #278, #279, #280 under Epic #276) across BYOK egress, authentication rate limiting, outbound timeouts, and team resource validation.

**Architecture:** Enforce strict URL refusal (`urlRefusal`) and `redirect: "manual"` with 15s timeouts on BYOK egress; add sliding-window rate limit buckets in `limit.ts` using hashed email keys for magic-link and password sign-in; bound third-party HTTP fetches with `AbortSignal.timeout`; and validate tenant ownership of tests/banks before creating team grants.

**Tech Stack:** TypeScript, Node.js / Cloudflare Workers, Hono, Zod, SQLite / PostgreSQL (`@pariksha/db`), Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-29-security-audit-remediation-design.md`](file:///d:/professional/code/SriSatyaLokesh/pariksha/docs/superpowers/specs/2026-10-29-security-audit-remediation-design.md)

## Global Constraints
- Commit author must strictly be: `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
- Never leak plaintext credentials, passwords, or emails into the database or audit logs (`S-07`, `S-15`, `KG5`).
- Never perform unvalidated outbound HTTP fetches to private RFC1918, loopback, or metadata addresses (`T-19`).
- Maintain zero-trust tenant isolation where every query is scoped by `workspace_id = ?` (`S-09`).
- Strict Red-Green-Refactor development: every task starts with a failing test and ends with full test suite passage.

## Review Focus
1. `urlRefusal` correctly blocks `169.254.169.254`, `127.0.0.1`, `::1`, and RFC1918 ranges in `baseUrl`.
2. Open redirects are blocked via `redirect: "manual"` across all AI provider adapters.
3. Password sign-in rate limiting charges failed attempts only, so honest sign-ins are never blocked.
4. Rate limit bucket keys store SHA-256 hashes of normalised emails, never plaintext emails (`S-07`).
5. Outbound requests to OpenRouter and email providers abort cleanly on timeout without hanging the process.

---

### Task 1: BYOK Egress Guard & SSRF Protection (#277)

**Files:**
- Modify: `apps/api/src/routes/byok.ts:35-42, 168-185`
- Modify: `apps/api/src/byok/adapters/opencode.ts:22-52`
- Modify: `apps/api/src/byok/adapters/openai.ts:22-45`
- Modify: `apps/api/src/byok/adapters/anthropic.ts:22-45`
- Modify: `apps/api/src/byok/adapters/gemini.ts:22-45`
- Modify: `apps/api/src/byok/adapters/openrouter.ts:22-45`
- Test: `apps/api/test/byok.test.ts`

- [x] **Step 1: Write failing tests for SSRF refusal and redirect manual in BYOK**
  In `apps/api/test/byok.test.ts`, add test cases asserting that:
  - `POST /banks/:bankId/draft-ai` with `baseUrl: "http://169.254.169.254/latest/meta-data"` returns `422 url_refused`.
  - `POST /banks/:bankId/draft-ai` with `baseUrl: "http://127.0.0.1:8787"` returns `422 url_refused`.
  - `POST /banks/:bankId/draft-ai` with `baseUrl: "http://10.0.0.1/inference"` returns `422 url_refused`.
  - An external 3xx redirect response from an adapter is not followed (`redirect: "manual"`).
- [x] **Step 2: Run test to confirm failure**
  Run: `npx vitest run apps/api/test/byok.test.ts`
- [x] **Step 3: Implement validation in `apps/api/src/routes/byok.ts` and adapters**
  - In `apps/api/src/routes/byok.ts`: Import `urlRefusal` from `@pariksha/db`. If `parsed.data.baseUrl` is present, check `urlRefusal(parsed.data.baseUrl)`. If not null, throw `ApiError(422, "url_refused", `${refused}.`)`.
  - In all five adapters (`opencode.ts`, `openai.ts`, `anthropic.ts`, `gemini.ts`, `openrouter.ts`):
    - Add `redirect: "manual"`.
    - Add `signal: AbortSignal.timeout(15_000)`.
    - Add defense-in-depth check `urlRefusal(url)`.
- [x] **Step 4: Run tests to confirm pass**
  Run: `npx vitest run apps/api/test/byok.test.ts`
- [x] **Step 5: Commit changes**
  Run: `git commit -m "fix(api): block SSRF and key exfiltration via baseUrl in BYOK draft-ai (#277)" --author="Satya K <srisatyalokesh2.12@gmail.com>"`

---

### Task 2: Organiser Authentication Rate Limiting & Brute-Force Throttling (#278)

**Files:**
- Modify: `apps/api/src/run/limit.ts:72-110`
- Modify: `apps/api/src/routes/auth.ts:87-175, 227-243`
- Test: `apps/api/test/auth.test.ts`

- [x] **Step 1: Write failing tests for organiser auth rate limiting**
  In `apps/api/test/auth.test.ts`, add test cases asserting that:
  - 5 consecutive magic-link requests for the same email address succeed (202), and the 6th returns `429 rate_limited`.
  - 5 consecutive failed password attempts for the same email return `401 invalid_credentials`, and the 6th returns `429 rate_limited`.
  - A successful password signin does not count against the failed attempts bucket.
  - The `rate_limit` bucket key does not contain the plaintext email address.
  - 5 consecutive failed TOTP verification attempts return `400 invalid_totp`, and the 6th returns `429 rate_limited`.
- [x] **Step 2: Run test to confirm failure**
  Run: `npx vitest run apps/api/test/auth.test.ts`
- [x] **Step 3: Implement rate limit buckets and checks**
  - In `apps/api/src/run/limit.ts`: Define `auth_magic_link_address` (5 / 10m), `auth_password_signin_address` (5 misses / 15m), and `auth_totp_verify_user` (5 misses / 5m) in `LIMITS`.
  - In `apps/api/src/routes/auth.ts`:
    - In `POST /magic-link`: Normalise email, compute hash, and call `await limitOrThrow(deps, "auth_magic_link_address", hashedEmail)`.
    - In `POST /password/signin`: Check `await limitOrThrow(deps, "auth_password_signin_address", hashedEmail)`. On invalid credentials, call `await limitMisses(deps, "auth_password_signin_address", hashedEmail)`.
    - In `POST /password/totp/verify`: Check `await limitOrThrow(deps, "auth_totp_verify_user", actor.userId)`. On invalid TOTP code, call `await limitMisses(deps, "auth_totp_verify_user", actor.userId)`.
- [x] **Step 4: Run tests to confirm pass**
  Run: `npx vitest run apps/api/test/auth.test.ts`
- [x] **Step 5: Commit changes**
  Run: `git commit -m "fix(api): add rate limiting and brute-force throttling to organiser auth (#278)" --author="Satya K <srisatyalokesh2.12@gmail.com>"`

---

### Task 3: Bounded Outbound HTTP Timeouts (#279)

**Files:**
- Modify: `apps/api/src/byok/models.ts:11-42`
- Modify: `apps/api/src/email/http.ts:12-39`
- Test: `apps/api/test/byok.test.ts`
- Test: `apps/api/test/email.test.ts`

- [x] **Step 1: Write failing tests for outbound timeouts**
  - In `apps/api/test/byok.test.ts`: Verify `fetchLiveOpenRouterModels()` returns `[]` when HTTP call hangs.
  - In `apps/api/test/email.test.ts`: Verify `httpSender.send()` rejects with `email_send_failed` when HTTP call hangs.
- [x] **Step 2: Run tests to confirm failure**
  Run: `npx vitest run apps/api/test/byok.test.ts apps/api/test/email.test.ts`
- [x] **Step 3: Add `AbortSignal.timeout` to outbound calls**
  - In `apps/api/src/byok/models.ts`: Add `signal: AbortSignal.timeout(5_000)` to `fetch()`.
  - In `apps/api/src/email/http.ts`: Add `signal: AbortSignal.timeout(10_000)` to `http()`.
- [x] **Step 4: Run tests to confirm pass**
  Run: `npx vitest run apps/api/test/byok.test.ts apps/api/test/email.test.ts`
- [x] **Step 5: Commit changes**
  Run: `git commit -m "fix(api): add AbortSignal timeouts to outbound model and email HTTP calls (#279)" --author="Satya K <srisatyalokesh2.12@gmail.com>"`

---

### Task 4: Workspace Boundary Validation in Team Grants (#280)

**Files:**
- Modify: `packages/db/src/repo/teams.ts:254-285`
- Modify: `apps/api/src/routes/teams.ts:201-224`
- Test: `packages/db/test/repo/teams.test.ts`
- Test: `apps/api/test/teams.test.ts`

- [x] **Step 1: Write failing tests for cross-workspace resource grant refusal**
  In `packages/db/test/repo/teams.test.ts` and `apps/api/test/teams.test.ts`, add test cases asserting that:
  - Attempting to grant a `test` ID that does not exist or belongs to another workspace throws an error / returns `404 not_found`.
  - Attempting to grant a `bank` ID that does not exist or belongs to another workspace throws an error / returns `404 not_found`.
- [x] **Step 2: Run tests to confirm failure**
  Run: `npx vitest run packages/db/test/repo/teams.test.ts apps/api/test/teams.test.ts`
- [x] **Step 3: Implement resource workspace verification in `grantTeamResource`**
  - In `packages/db/src/repo/teams.ts`: Before inserting into `team_grant`, query `SELECT 1 FROM test WHERE workspace_id = ? AND id = ?` or `SELECT 1 FROM bank WHERE workspace_id = ? AND id = ?`. If missing, throw `new Error("Resource not found in workspace")`.
  - In `apps/api/src/routes/teams.ts`: Catch error and throw `ApiError(404, "not_found", "No such resource in this workspace.")`.
- [x] **Step 4: Run tests to confirm pass**
  Run: `npx vitest run packages/db/test/repo/teams.test.ts apps/api/test/teams.test.ts`
- [x] **Step 5: Commit changes**
  Run: `git commit -m "fix(db,api): enforce workspace boundary on team resource grants (#280)" --author="Satya K <srisatyalokesh2.12@gmail.com>"`

---

### Task 5: Monorepo Verification & Audit Retest

**Files:**
- Modify: `CHANGELOG.md`
- Test: Full monorepo test suite (`pnpm test`)
- Test: `pnpm typecheck`
- Test: `pnpm lint`

- [x] **Step 1: Update CHANGELOG.md with security fixes**
- [ ] **Step 2: Re-run security audit validator**
  Run: `node .agents/skills/security-audit/validate-findings.cjs C:/Users/SatyaK/security-audit-skill/pariksha/run-1/findings.json`
- [ ] **Step 3: Run full monorepo typecheck and lint**
  Run: `pnpm typecheck && pnpm lint`
- [ ] **Step 4: Run monorepo test suites**
  Run: `pnpm test`
- [ ] **Step 5: Commit final updates**
  Run: `git commit -m "chore: record security audit remediations in CHANGELOG (#276)" --author="Satya K <srisatyalokesh2.12@gmail.com>"`
