# Security Audit Remediation: Architecture & Technical Design Specification

> **Epic:** [#276](https://github.com/SriSatyaLokesh/pariksha/issues/276)
> **Issues Covered:**
> - [#277](https://github.com/SriSatyaLokesh/pariksha/issues/277): Prevent SSRF & Credential Exfiltration in BYOK Question Drafting (`FP.BYOK.SSRF.EXFIL`)
> - [#278](https://github.com/SriSatyaLokesh/pariksha/issues/278): Organiser Auth Rate Limiting & Brute-Force Throttling (`FP.AUTH.UNTHROTTLED.SIGNIN`)
> - [#279](https://github.com/SriSatyaLokesh/pariksha/issues/279): Outbound HTTP Call Timeouts (`FP.HTTP.OUTBOUND.NO.TIMEOUT`)
> - [#280](https://github.com/SriSatyaLokesh/pariksha/issues/280): Workspace Ownership Validation in Team Grants (`FP.TEAM.GRANT.CROSS.WSP.REF`)

---

## 1. Executive Summary & Architecture Context

Following the Cloudflare `security-audit` skill run on Pariksha, four confirmed vulnerabilities were documented under Epic #276. This specification establishes the engineering and architectural designs for remediating all four vulnerabilities in accordance with **Senior Backend** and **Senior Architect** standards:
1. **Zero-Trust Input Validation & Egress Bounding**: All outbound network interactions must enforce cryptographic invariants, IP blocklists (`urlRefusal`), redirect refusal (`redirect: "manual"`), and strict wall-clock timeouts (`AbortSignal.timeout`).
2. **Defensive Anti-Abuse & Authentication Throttling**: Every entry point capable of sending transactional emails or verifying secrets must implement sliding-window rate limiting backed by durable storage (`rate_limit`).
3. **Strict Tenant & Relational Integrity**: All resource association mutations must assert that foreign identifiers belong to the calling workspace boundary before persisting references.

---

## 2. Technical Specifications by Track

### Track 1: BYOK Egress Guard & SSRF Prevention ([#277](https://github.com/SriSatyaLokesh/pariksha/issues/277))

#### Problem Statement
`POST /api/v1/workspaces/:id/banks/:bankId/draft-ai` accepted arbitrary `baseUrl` parameters. When drafting questions, `apps/api/src/byok/draft.ts` decrypted the workspace's secret API key and dispatched an outbound HTTP request sending `Authorization: Bearer <plainApiKey>` to `baseUrl` without checking for internal network ranges (`urlRefusal`) or preventing redirect hijacking (`redirect: "manual"`).

#### Architecture & Design
1. **Schema & Route Layer (`apps/api/src/routes/byok.ts`)**:
   - In `draftAiSchema`, refine `baseUrl`:
     - Must be valid HTTP/HTTPS URL.
     - Must pass `urlRefusal(baseUrl) === null` (blocks RFC 1918 private IPs, loopback `127.0.0.1`, cloud metadata `169.254.169.254`, `.local`, `.internal`).
     - Rejects credentials embedded in URL (`http://user:pass@host`).
   - If `baseUrl` fails `urlRefusal`, throw `ApiError(422, "url_refused", `${refused}.`)`.
2. **Adapter Layer (`apps/api/src/byok/adapters/*`)**:
   - All adapters (`opencode.ts`, `openai.ts`, `anthropic.ts`, `gemini.ts`, `openrouter.ts`):
     - Before invoking `fetch(url)`, run defense-in-depth `urlRefusal(url)`.
     - Set `redirect: "manual"` to block 3xx open-redirect SSRF bypasses.
     - Enforce `signal: AbortSignal.timeout(15_000)` (15s ceiling).
     - If `res.status >= 300 && res.status < 400`, treat as misconfigured receiver error.

---

### Track 2: Organiser Authentication Rate Limiting ([#278](https://github.com/SriSatyaLokesh/pariksha/issues/278))

#### Problem Statement
Unlike the candidate runtime (`apps/api/src/run/limit.ts`), organiser-facing authentication endpoints in `apps/api/src/routes/auth.ts` had no rate limiting, leaving them susceptible to password brute-force guessing and email quota exhaustion.

#### Architecture & Design
1. **Rate Limit Buckets (`apps/api/src/run/limit.ts` & `LIMITS`)**:
   - `auth_magic_link_address`:
     - Limit: **5 requests per 10 minutes** (`windowMs: 10 * 60_000`).
     - Key: SHA-256 hash of normalised email (`sha256Hex(normalisedEmail)`).
     - Strategy: Count **all requests** (each request triggers an email).
   - `auth_password_signin_address`:
     - Limit: **5 failed attempts per 15 minutes** (`windowMs: 15 * 60_000`).
     - Key: SHA-256 hash of normalised email (`sha256Hex(normalisedEmail)`).
     - Strategy: Count **misses/failures only**. Before verifying credentials, check if bucket is exhausted (`limitOrThrow`). On wrong password / non-existent user, record failure via `limitMisses`. On successful signin, honest user is not charged.
   - `auth_totp_verify_user`:
     - Limit: **5 failed attempts per 5 minutes** (`windowMs: 5 * 60_000`).
     - Key: `userId`.
     - Strategy: Count **misses/failures only**. On incorrect TOTP code, record failure via `limitMisses`.
2. **Privacy Guarantee (`S-07`, `S-15`)**:
   - No email address reaches the `rate_limit` table in plaintext. All bucket keys use `sha256Hex(normalisedEmail)`.
   - Responses for locked-out requests return `429 Too Many Requests` with `ApiError(429, "rate_limited", ...)`.

---

### Track 3: Bounded Outbound HTTP Timeouts ([#279](https://github.com/SriSatyaLokesh/pariksha/issues/279))

#### Problem Statement
`apps/api/src/byok/models.ts` and `apps/api/src/email/http.ts` called `fetch()` without an `AbortSignal.timeout`, creating hanging socket risks during third-party outages.

#### Architecture & Design
1. **OpenRouter Models Fetch (`apps/api/src/byok/models.ts`)**:
   - Add `signal: AbortSignal.timeout(5_000)`.
   - On error or timeout, return `[]` fallback gracefully.
2. **Transactional Email Dispatch (`apps/api/src/email/http.ts`)**:
   - Add `signal: AbortSignal.timeout(10_000)`.
   - On timeout or non-2xx response, throw `ApiError(502, "email_send_failed", ...)` without logging message content or token values.

---

### Track 4: Workspace Boundary Validation in Team Grants ([#280](https://github.com/SriSatyaLokesh/pariksha/issues/280))

#### Problem Statement
`packages/db/src/repo/teams.ts:254` (`grantTeamResource`) validated that `teamId` belongs to `workspaceId`, but did not check whether `resourceId` (test or bank) belongs to `workspaceId`.

#### Architecture & Design
1. **Database Layer (`packages/db/src/repo/teams.ts`)**:
   - In `grantTeamResource`:
     ```typescript
     if (input.resourceType === "test") {
       const testExists = await db.query(
         "SELECT 1 FROM test WHERE workspace_id = ? AND id = ?",
         [workspaceId, input.resourceId],
       );
       if (testExists.length === 0) {
         throw new Error(`Test ${input.resourceId} not found in workspace ${workspaceId}`);
       }
     } else if (input.resourceType === "bank") {
       const bankExists = await db.query(
         "SELECT 1 FROM bank WHERE workspace_id = ? AND id = ?",
         [workspaceId, input.resourceId],
       );
       if (bankExists.length === 0) {
         throw new Error(`Bank ${input.resourceId} not found in workspace ${workspaceId}`);
       }
     }
     ```
2. **Route Layer (`apps/api/src/routes/teams.ts`)**:
   - In `POST /:teamId/grants`: Wrap `grantTeamResource` and map `"not found in workspace"` error to `ApiError(404, "not_found", "No such resource in this workspace.")`.

---

## 3. Testing & Verification Plan
- **Track 1**: New unit & integration tests in `apps/api/test/byok.test.ts` asserting:
  - Private IPv4/IPv6, metadata (`169.254.169.254`), and loopback are rejected with `422 url_refused`.
  - Redirect responses from receivers are not followed (`redirect: "manual"`).
- **Track 2**: New tests in `apps/api/test/auth.test.ts`:
  - 5 rapid magic link requests to the same email triggers `429 rate_limited`.
  - 5 failed password attempts to an account triggers `429 rate_limited` on the 6th attempt.
  - Rate limit bucket keys store SHA-256 hashes, never plaintext emails.
- **Track 3**: New tests in `apps/api/test/byok.test.ts` and `apps/api/test/email.test.ts`:
  - Hanging HTTP connection times out cleanly within 5s/10s.
- **Track 4**: New tests in `packages/db/test/repo/teams.test.ts` and `apps/api/test/teams.test.ts`:
  - Granting a test or bank from another workspace throws a 404 error and does not insert into `team_grant`.
