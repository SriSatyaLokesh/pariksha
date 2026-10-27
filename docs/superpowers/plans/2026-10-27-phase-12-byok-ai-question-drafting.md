# Phase 12: BYOK AI Question Drafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver per-workspace BYOK (Bring Your Own Key) encrypted storage for Anthropic, OpenAI, and generic OpenAI-compatible/OpenRouter keys, spend limits, a zero-dependency provider router with dynamic model selection, and an interactive in-modal preview workflow with admin-level validation flagging and inline editing before bank commit.

**Architecture:** 
1. Database tables `byok_credential` and `byok_usage` in `packages/db` with AES-256-GCM encryption using native WebCrypto (`crypto.subtle`) across SQLite/D1 and PostgreSQL 16.
2. Pluggable zero-SDK Provider Router in `apps/api/src/byok/router.ts` with adapters for Anthropic, OpenAI, and OpenRouter, supporting dynamic model metadata and freeform custom model IDs.
3. Strict two-step drafting engine in `apps/api/src/byok/draft.ts` (`POST .../draft-ai` for schema validation and preview, `POST .../draft-ai/commit` for atomic persistence into the bank repository).
4. Accessible, Signal-themed UI components in `apps/web` for workspace key management (`ByokSettings.tsx`) and an in-modal review dialog (`DraftAiModal.tsx`) with per-question validation badges, 1-click "Flag as Incorrect" exclusion, and inline editing.
5. Contributor guide and RFC issue in `docs/contributing/ai-model-router-issue.md` for community additions (Google Gemini, DeepSeek, Local Ollama).

**Tech Stack:** TypeScript, WebCrypto (`crypto.subtle`), Drizzle ORM (D1 / SQLite / Postgres), Hono, `@pariksha/core` validator, React, Signal CSS tokens.

**Spec:** [`docs/superpowers/specs/2026-10-27-phase-12-byok-ai-question-drafting-design.md`](../specs/2026-10-27-phase-12-byok-ai-question-drafting-design.md), [`docs/ROADMAP.md`](../../ROADMAP.md) § Phase 12.

## Global Constraints
- **Zero AI SDK dependencies:** Use standard `fetch` with WebCrypto. Do not add `@anthropic-ai/sdk`, `openai`, or any third-party AI package.
- **Key secrecy:** API keys are encrypted at rest with `FIELD_ENCRYPTION_KEY` using AES-256-GCM. Decrypted keys are NEVER sent to the browser or stored in logs. Only truncated hints (e.g. `sk-ant-...4a9b`) are returned over HTTP.
- **Strict Two-Step Flow (Gate 1):** The drafting endpoint is purely computational and never inserts directly into the database. Persistence occurs exclusively when the author confirms the approved subset via `/commit`.
- **Tenant isolation (Gate 2):** Provider calls ONLY use the key belonging to the verified caller's workspace.
- **Monthly spend limits:** Workspace spend is tracked in `byok_usage` (UTC calendar month, 1-cent floor for micro-calls) and drafting fails immediately if the monthly spend limit is reached.
- **Author review (Gate 3):** All questions land in the bank as editable drafts. Nothing is ever auto-published to a test.

## Review Focus
1. Key decryption failure (wrong or missing `FIELD_ENCRYPTION_KEY`): Returns clean 500 error without exposing stack trace or cipher text.
2. Malformed LLM response: Handles markdown code blocks, truncated JSON, or missing required fields without crashing; reports schema rejection to user.
3. Spend limit boundary: Request rejected with 402/403 when current UTC month spend reaches or exceeds `spend_limit_cents`.
4. Provider API error (e.g., 401 invalid key, 429 rate limit): Translated into structured error messages without leaking the key.
5. Dual-dialect database parity: `packages/db/test/parity.test.ts` passes with exact schema agreement between SQLite and Postgres.

---

### Task 1: Provider Router, Model Registry, and Adapters (`apps/api/src/byok/`)

**Files:**
- Create: `apps/api/src/byok/types.ts`
- Create: `apps/api/src/byok/models.ts`
- Create: `apps/api/src/byok/router.ts`
- Create: `apps/api/src/byok/adapters/anthropic.ts`
- Create: `apps/api/src/byok/adapters/openai.ts`
- Create: `apps/api/src/byok/adapters/openrouter.ts`
- Modify: `apps/api/src/byok/client.ts`
- Modify: `apps/api/src/byok/prompts.ts`
- Test: `apps/api/test/byok/router.test.ts`
- Test: `apps/api/test/byok/client.test.ts`

**Interfaces:**
- Consumes: `QuestionType` from `@pariksha/core`, `decryptApiKey` from `./crypto.js`
- Produces: `routeDraftRequest(req: DraftRequest): Promise<DraftResponse>`, `MODEL_REGISTRY: Record<string, ModelMetadata[]>`

- [ ] **Step 1: Write failing tests for Provider Router and dynamic model selection**

Create `apps/api/test/byok/router.test.ts` testing:
- Resolving default model and pricing for Anthropic, OpenAI, and OpenRouter.
- Routing requests to `AnthropicAdapter`, `OpenAIAdapter`, and `OpenRouterAdapter`.
- Gracefully handling custom/unregistered model IDs with fallback pricing.
- Upstream error translation without leaking API keys.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api exec vitest run test/byok/router.test.ts`  
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement `types.ts`, `models.ts`, and adapters in `apps/api/src/byok/`**

- Define `ProviderAdapter`, `ModelMetadata`, `ProviderRequest`, and `ProviderResponse` in `types.ts`.
- Define `MODEL_REGISTRY` with Claude 3.5 Sonnet, Claude 3.5 Haiku, Claude 3 Opus, GPT-4o, GPT-4o-mini, o1, o3-mini, and OpenRouter models in `models.ts`.
- Implement `AnthropicAdapter`, `OpenAIAdapter`, and `OpenRouterAdapter` using native `fetch`.
- Implement `routeDraftRequest` in `router.ts` delegating to adapters and calculating token cost.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api exec vitest run test/byok/router.test.ts test/byok/client.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/byok/ apps/api/test/byok/
git commit -m "feat(api): implement extensible provider router and model registry" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 2: Two-Step Draft Engine and Commit Route (`apps/api`)

**Files:**
- Modify: `apps/api/src/byok/draft.ts`
- Modify: `apps/api/src/routes/byok.ts`
- Modify: `apps/api/test/byok/draft.test.ts`
- Modify: `apps/api/test/byok/routes.test.ts`

**Interfaces:**
- Consumes: `routeDraftRequest` from `./router.js`, `validateBank` from `@pariksha/core`, `upsertQuestions` from `@pariksha/db`
- Produces: 
  - `POST /api/v1/workspaces/:workspaceId/banks/:bankId/draft-ai` -> `{ questions, validationIssues, usage }` (computational preview only)
  - `POST /api/v1/workspaces/:workspaceId/banks/:bankId/draft-ai/commit` -> `{ importedCount, bankId }` (atomic persistence)

- [ ] **Step 1: Write failing tests for two-step draft and commit flow**

Update `apps/api/test/byok/draft.test.ts` and `apps/api/test/byok/routes.test.ts`:
- Verify `POST .../draft-ai` returns validated candidate questions WITHOUT inserting to `question` table.
- Verify `POST .../draft-ai/commit` inserts approved questions into the bank with unique `q_...` IDs.
- Verify spend limit is charged during preview with 1-cent floor for micro-tokens.
- Verify permission checks (`banks.edit` for drafting/commit, `keys.manage` for key credentials).

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @pariksha/api exec vitest run test/byok/draft.test.ts test/byok/routes.test.ts`  
Expected: FAIL (missing commit endpoint or schema mismatch)

- [ ] **Step 3: Update `draft.ts` and `routes/byok.ts`**

- Refactor `draftQuestions` in `apps/api/src/byok/draft.ts` to return candidate questions and validation diagnostics without database writes.
- Add `commitDraftQuestions` in `apps/api/src/byok/draft.ts` to insert approved questions with unique IDs.
- Add `POST /workspaces/:workspaceId/banks/:bankId/draft-ai/commit` route in `apps/api/src/routes/byok.ts`.
- Ensure spend cap check computes over current UTC calendar month.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pariksha/api exec vitest run test/byok/`  
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/byok/ apps/api/src/routes/ apps/api/test/byok/
git commit -m "feat(api): implement two-step drafting preview and atomic commit endpoints" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 3: Organiser UI — In-Modal Preview, Validation Badges, Flagging & Inline Edit (`apps/web`)

**Files:**
- Modify: `apps/web/src/components/admin/DraftAiModal.tsx`
- Modify: `apps/web/src/components/admin/ByokSettings.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/test/admin/draft-ai-modal.test.tsx`
- Test: `apps/web/test/admin/byok-settings.test.tsx`

**Interfaces:**
- Consumes: `/draft-ai` (preview) and `/draft-ai/commit` (commit) from `@pariksha/api`
- Produces: Complete in-modal review experience with validation diagnostics, 1-click flagging, and inline question editing

- [ ] **Step 1: Write failing UI tests for in-modal preview, flagging, and inline edit**

Update `apps/web/test/admin/draft-ai-modal.test.tsx`:
- Test dynamic model selection dropdown and custom model entry.
- Test preview state rendering question cards with prompt, options, answer key, and explanation.
- Test validation status badge display (`✓ Schema Valid` / `⚠️ Validation Warning`).
- Test "Flag as Incorrect" toggle: strikes through card, excludes item from commit payload.
- Test "Unflag & Keep" restores question.
- Test inline "Edit" mode: allows editing prompt, options, and key.
- Test clicking "Import Approved Questions" sends only unflagged/approved items to `/commit`.

- [ ] **Step 2: Run web tests to verify failure**

Run: `pnpm --filter @pariksha/web exec vitest run test/admin/draft-ai-modal.test.tsx`  
Expected: FAIL

- [ ] **Step 3: Update `DraftAiModal.tsx` and `ByokSettings.tsx`**

- Add multi-step state to `DraftAiModal.tsx`:
  - `step === "config"`: topic, count, provider, model select (curated list + custom input), question types.
  - `step === "review"`: header statistics, question cards list with admin validation status, flagging toggle (`flaggedIds: Set<string>`), inline editing mode (`editingId: string | null`), and commit action bar.
- Update `ByokSettings.tsx` to support configuring OpenAI-Compatible / OpenRouter credentials.
- Add `draftAiQuestions` and `commitDraftQuestions` helper functions in `apps/web/src/lib/api.ts`.

- [ ] **Step 4: Run web tests to verify they pass**

Run: `pnpm --filter @pariksha/web exec vitest run test/admin/draft-ai-modal.test.tsx test/admin/byok-settings.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ apps/web/test/admin/
git commit -m "feat(web): add in-modal question preview, validation flagging, and inline edit" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 4: Full Monorepo Integration, Playwright E2E & Roadmap Update

**Files:**
- Modify: `apps/web/e2e/byok-drafting.spec.ts`
- Modify: `docs/ROADMAP.md`
- Test: Full monorepo verification (`turbo run typecheck`, `turbo run lint`, `turbo run test`, `pnpm --filter @pariksha/web e2e`)

- [ ] **Step 1: Update Playwright E2E spec for preview & flagging**

In `apps/web/e2e/byok-drafting.spec.ts`:
- Test generating questions via "Draft with AI".
- Verify review cards appear with validation badges.
- Click "Flag as Incorrect" on one question and confirm it is marked excluded.
- Click "Import Approved Questions to Bank" and verify the bank receives the approved items.

- [ ] **Step 2: Run Playwright E2E spec**

Run: `pnpm --filter @pariksha/web e2e byok-drafting.spec.ts`  
Expected: PASS

- [ ] **Step 3: Run full monorepo quality checks**

Run:
```bash
turbo run typecheck
turbo run lint
turbo run test
```
Expected: All suites PASS with zero errors.

- [ ] **Step 4: Update `docs/ROADMAP.md` marking Phase 12 as Done**

Mark Phase 12 as **Done** in `docs/ROADMAP.md` with complete deliverable descriptions.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/ docs/ROADMAP.md
git commit -m "feat(byok): complete full integration, e2e validation, and roadmap signoff" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```
