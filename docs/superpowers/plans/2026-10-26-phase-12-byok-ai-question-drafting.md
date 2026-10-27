# Phase 12: BYOK AI Question Drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver per-workspace BYOK (Bring Your Own Key) encrypted storage for Anthropic and OpenAI API keys, spend limits, and a native AI question drafting pipeline that turns topics, syllabi, or source text into valid `pariksha/question@1` draft bank items with schema validation and zero external SDK dependencies.

**Architecture:** 
1. Database tables `byok_credential` and `byok_usage` in `packages/db` with AES-GCM 256 encryption (`S-15`) using WebCrypto (`crypto.subtle`) and dual-dialect parity (Postgres & SQLite).
2. Pure HTTP client in `apps/api/src/byok/client.ts` using standard `fetch` for Anthropic (`/v1/messages`) and OpenAI (`/v1/chat/completions`) with structured JSON outputs.
3. Batch validation and drafting engine in `apps/api/src/byok/draft.ts` ensuring batches are rejected whole upon schema errors (`@pariksha/core` `validateQuestion`) and inserted as unpublished Draft questions.
4. Dedicated REST endpoints (`GET/PUT/DELETE /api/v1/workspaces/:workspaceId/byok`, `POST /api/v1/workspaces/:workspaceId/banks/:bankId/draft-ai`) guarded by permissions (`banks.create`, `workspaces.manage`).
5. Accessible, Signal-themed UI components in `apps/web` for workspace BYOK key management (masked input, spend limits) and an in-bank "Draft with AI" modal.

**Tech Stack:** TypeScript, WebCrypto (`crypto.subtle`), Drizzle ORM (D1 / SQLite / Postgres), Hono, `@pariksha/core` validator, React, Signal CSS tokens.

**Spec:** `docs/ROADMAP.md` § "Phase 12 — BYOK AI question drafting", `docs/PRD.md` § `S-15`.

## Global Constraints
- **Zero AI SDK dependencies:** Use standard `fetch` with WebCrypto. Do not add `@anthropic-ai/sdk` or `openai`.
- **Key secrecy:** API keys are encrypted at rest with `FIELD_ENCRYPTION_KEY` (or derived secret) using AES-256-GCM. Decrypted keys are NEVER sent to the browser or stored in logs. Only truncated key hints (e.g., `sk-ant-...4a9b`) are returned.
- **Atomic batch validation (Gate 1):** If any generated question in a batch fails schema validation or import rules, the entire batch is rejected with errors. No partial writes.
- **Tenant isolation (Gate 2):** Provider calls ONLY use the key belonging to the verified caller's workspace.
- **Hard spend caps:** Workspace spend is tracked in `byok_usage` and drafting requests fail immediately if the workspace hard cap is exceeded.
- **Author review:** All generated questions are inserted with `status = "draft"` and must never be auto-published into a live test.

## Review Focus
1. Key decryption failure (wrong or missing `FIELD_ENCRYPTION_KEY`): Returns clean 500 error without exposing stack trace or cipher text.
2. Malformed LLM response: Handles markdown code blocks, truncated JSON, or missing required fields without crashing; reports schema rejection to user.
3. Spend limit boundary: Request rejected with 402/403 when current month spend reaches or exceeds `spend_limit_cents`.
4. Provider API error (e.g., 401 invalid key, 429 rate limit): Translated into structured error messages without leaking the key.
5. Dual-dialect database parity: `parity.test.ts` passes with exact schema agreement between SQLite and Postgres.

---

### Task 1: BYOK Database Schema, Encryption, and Repository (`packages/db`, `apps/api`)

**Files:**
- Create: `apps/api/src/byok/crypto.ts`
- Create: `packages/db/src/repo/byok.ts`
- Create: `packages/db/migrations/sqlite/0011_byok_credentials.sql`
- Create: `packages/db/migrations/pg/0011_byok_credentials.sql`
- Modify: `packages/db/src/schema/columns.ts`
- Modify: `packages/db/src/schema/sqlite.ts`
- Modify: `packages/db/src/schema/pg.ts`
- Modify: `packages/db/src/migrations.generated.ts`
- Modify: `packages/db/src/index.ts`
- Test: `apps/api/test/byok/crypto.test.ts`
- Test: `packages/db/test/byok.test.ts`

- [ ] Step 1: Write failing tests for AES-256-GCM encryption/decryption (`apps/api/test/byok/crypto.test.ts`).
- [ ] Step 2: Implement `encryptApiKey` and `decryptApiKey` in `apps/api/src/byok/crypto.ts` using native WebCrypto (`crypto.subtle`).
- [ ] Step 3: Define `byok_credential` and `byok_usage` tables in `columns.ts`, `sqlite.ts`, and `pg.ts`.
- [ ] Step 4: Generate migrations `0011_byok_credentials.sql` and update `migrations.generated.ts`.
- [ ] Step 5: Implement `ByokRepo` in `packages/db/src/repo/byok.ts` with methods for saving credentials, fetching masked credentials, logging usage, and computing total spend.
- [ ] Step 6: Write and run repository tests in `packages/db/test/byok.test.ts` and verify `packages/db/test/parity.test.ts` passes.
- [ ] Step 7: Commit with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

### Task 2: Provider Client and Prompt Engineering (`apps/api/src/byok/client.ts`)

**Files:**
- Create: `apps/api/src/byok/client.ts`
- Create: `apps/api/src/byok/prompts.ts`
- Test: `apps/api/test/byok/client.test.ts`

- [ ] Step 1: Write failing test in `apps/api/test/byok/client.test.ts` with mocked Anthropic and OpenAI HTTP endpoints.
- [ ] Step 2: Implement structured prompts in `apps/api/src/byok/prompts.ts` defining JSON output instructions for `pariksha/question@1` format across all supported question types (`single_choice`, `multiple_choice`, `true_false`, `short_text`, `numerical`).
- [ ] Step 3: Implement lightweight HTTP caller in `apps/api/src/byok/client.ts` calling Anthropic (`/v1/messages`) and OpenAI (`/v1/chat/completions`) using native `fetch`.
- [ ] Step 4: Extract token usage and compute estimated cost based on standard model pricing.
- [ ] Step 5: Run tests and ensure proper error handling for 401, 429, and 500 upstream responses.
- [ ] Step 6: Commit with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

### Task 3: Draft Engine, Validation Gate, and API Routes (`apps/api`)

**Files:**
- Create: `apps/api/src/byok/draft.ts`
- Create: `apps/api/src/routes/byok.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/auth/roles.ts`
- Modify: `apps/api/test/route-authority.test.ts`
- Test: `apps/api/test/byok/draft.test.ts`
- Test: `apps/api/test/byok/routes.test.ts`

- [ ] Step 1: Write failing tests in `apps/api/test/byok/draft.test.ts` verifying Gate 1 (all-or-nothing schema rejection), Gate 2 (tenant key isolation), and Gate 3 (no key returned).
- [ ] Step 2: Implement `draftQuestions` in `apps/api/src/byok/draft.ts` validating each candidate question with `@pariksha/core` `validateQuestion` and storing drafts with `status = "draft"`.
- [ ] Step 3: Implement Hono routes in `apps/api/src/routes/byok.ts`:
  - `GET /api/v1/workspaces/:workspaceId/byok`
  - `PUT /api/v1/workspaces/:workspaceId/byok/:provider`
  - `DELETE /api/v1/workspaces/:workspaceId/byok/:provider`
  - `POST /api/v1/workspaces/:workspaceId/banks/:bankId/draft-ai`
- [ ] Step 4: Register routes in `apps/api/src/app.ts` with subrequest budgets and role permissions (`workspaces.manage` for keys, `banks.create` for drafting).
- [ ] Step 5: Update `apps/api/test/route-authority.test.ts` and run tests.
- [ ] Step 6: Commit with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

### Task 4: Organiser UI — BYOK Settings and In-Bank AI Drafting Modal (`apps/web`)

**Files:**
- Create: `apps/web/src/components/admin/ByokSettings.tsx`
- Create: `apps/web/src/components/admin/DraftAiModal.tsx`
- Modify: `apps/web/src/components/admin/BankDetail.tsx`
- Modify: `apps/web/src/components/admin/Settings.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/test/admin/byok-settings.test.tsx`
- Test: `apps/web/test/admin/draft-ai-modal.test.tsx`

- [ ] Step 1: Write failing UI tests for `ByokSettings` and `DraftAiModal`.
- [ ] Step 2: Implement `ByokSettings.tsx` with provider selection, masked key input, spend limit setting, and current usage display with Signal tokens.
- [ ] Step 3: Implement `DraftAiModal.tsx` in `BankDetail.tsx` allowing authors to input a topic/text, pick question count (1-10) and types, view generation progress, review generated questions, and import them as drafts.
- [ ] Step 4: Verify accessibility, keyboard navigation, and theme compatibility with `theme.test.ts` and `signal-boundary.test.ts`.
- [ ] Step 5: Run web unit and component tests.
- [ ] Step 6: Commit with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

### Task 5: Full Integration, E2E Tests, and Roadmap Finalization

**Files:**
- Create: `apps/web/e2e/byok-drafting.spec.ts`
- Modify: `docs/ROADMAP.md`
- Test: Playwright E2E suite

- [ ] Step 1: Add E2E test verifying:
  - Configuring a BYOK key in workspace settings.
  - Opening a question bank and clicking "Draft with AI".
  - Generating questions with mocked AI provider and confirming questions appear in the bank list as Drafts.
- [ ] Step 2: Run full monorepo verification: `turbo run typecheck`, `turbo run lint`, `turbo run test`, `pnpm --filter @pariksha/web e2e`.
- [ ] Step 3: Update `docs/ROADMAP.md` marking Phase 12 as **Done**.
- [ ] Step 4: Commit with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.
- [ ] Step 5: Merge branch `phase-12/byok-ai-question-drafting` into `main` and push to remote.
