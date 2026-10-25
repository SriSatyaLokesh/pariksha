# Pariksha Security Architecture & Administrator Guide

This guide details the security model, cryptographic primitives, authentication controls, and threat mitigations implemented across Pariksha (`O-04`, `S-01` through `S-18`).

---

## 1. Authentication & Identity Architecture

### Password Hashing (Argon2id) & TOTP
On self-hosted Docker and Node environments (`S-01`):
- **Password Hashes:** Stored using `Argon2id` (memory cost: 65,536 KiB, iterations: 3, parallelism: 4). Passwords are never stored in plaintext or weak single-pass hashes.
- **Two-Factor Authentication (2FA):** Standard RFC 6238 Time-based One-Time Password (TOTP) algorithm using HMAC-SHA1 with 30-second step windows and 6-digit tokens.
- **Recovery Codes:** Hashed backup codes provided during setup for emergency account recovery.

### OpenID Connect (OIDC) & Magic Links
On Cloudflare and enterprise setups:
- **OIDC Discovery:** Implements Authorization Code Flow with PKCE (`RFC 7636`), verifying cryptographic nonce parameters and JWT signature keys.
- **Magic Link Sign-In:** Short-lived (15-minute), single-use cryptographic tokens sent via transactional email, bound to client user-agent fingerprints.

### Session Management
- Sessions are stored in cryptographically signed, `HttpOnly`, `SameSite=Lax`, `Secure` cookies.
- Server-side session hashes enable instant revocation (`signout-everywhere`).

---

## 2. Candidate Runtime Defense & Anti-Cheating

### Proof of Work (PoW) Anti-Flooding (`S-07`)
To prevent automated bot registrations and DDoS attacks without relying on third-party tracking captchas:
- The server issues a cryptographic challenge before registration.
- The candidate browser computes a SHA-256 proof-of-work preimage meeting configurable difficulty levels.
- Registration requests without valid PoW solutions are immediately rejected with HTTP 403.

### Candidate Response Scrubbing (`AC-22`, `S-10`)
Pariksha enforces strict server-side response data isolation:
- Candidate endpoints (`/api/v1/run/*`) mechanically scrub all answer keys, explanations, model answers, regex patterns, rubrics, and internal author notes.
- A candidate browser never receives grading keys or another candidate's responses under any circumstances.
- Score and feedback breakdown is delivered only when the organiser explicitly flips the test state to `released`.

### Webhook Signatures (HMAC-SHA256)
All outbound webhook event payloads (`attempt.submitted`, `attempt.flagged`, etc.) carry an `X-Pariksha-Signature` header computed using HMAC-SHA256 against the workspace's secret signing key.

---

## 3. Data Sovereignty & Retention Policies (`S-13`)

Organisers configure automatic data lifecycle schedules:
- **Snapshots & Webcam Images:** Automatically deleted after `N` days (default 30 days) to minimize biometric storage liability.
- **Candidate PII Anonymisation:** Option to anonymize candidate contact fields after assessment processing while preserving item statistics.
- **Tenant Isolation:** Every database query and storage path includes the tenant `workspace_id`. Cross-workspace access returns HTTP 404.

---

## 4. Subrequest Budget Discipline (`ADR 0002`)

To eliminate Cloudflare denial-of-service vulnerabilities and surprise cloud bills, Pariksha enforces hard code-level subrequest ceilings:
- Every API endpoint declares a static subrequest budget (`ROUTE_BUDGETS`).
- Automated tests verify in CI that no request path can exceed platform limits.
