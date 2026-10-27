# Phase 12: BYOK AI Question Drafting Design Specification

**Date:** 2026-10-27  
**Status:** In Review  
**Milestone:** Phase 12 (BYOK AI Question Drafting)  
**Parent Specs & PRD:** [`docs/ROADMAP.md`](../ROADMAP.md) § Phase 12, [`docs/PRD.md`](../PRD.md) § `S-15`, [`docs/question-format.md`](../question-format.md)

---

## 1. Intent & The Why

Pariksha is designed for independent educators, universities, and enterprise assessment teams who need full sovereignty over their testing pipeline. High-quality exam question authoring is time-consuming and often requires substantial domain expertise.

While LLMs can draft plausible questions rapidly, three critical flaws undermine conventional AI authoring tools:
1. **Vendor Lock-in and Hidden Margins:** Platforms resell AI tokens with high markups and opaque credit systems.
2. **Key Security & Cloud Sprawl:** Third-party plugins leak API keys, store unencrypted secrets, or route sensitive curriculum material through intermediary SaaS servers.
3. **Hallucinations & Malformed Schemas:** AI models frequently hallucinate incorrect answer keys, generate ambiguous distractors, or produce invalid JSON schemas that corrupt exam banks or break student runtimes.

**Phase 12 solves these problems cleanly:**
- **Zero-margin BYOK & Extensible Provider Router:** Organizers connect their own Anthropic (Claude 3.5 Sonnet, 3.5 Haiku, 3 Opus), OpenAI (GPT-4o, GPT-4o-mini, o1, o3-mini), or generic OpenAI-Compatible/OpenRouter keys directly, with dynamic model selection and freeform model ID support.
- **AES-256-GCM Zero-Knowledge Key Secrecy:** Keys are encrypted at rest with the instance's `FIELD_ENCRYPTION_KEY` using native WebCrypto (`crypto.subtle`). Decrypted keys are never sent to browsers, never stored in client state, and never written to logs.
- **Hard Spend Caps:** Monthly budget caps set by the workspace owner prevent unexpected provider bills.
- **In-Modal Author Review & Validation Flagging:** Generated questions undergo strict `@pariksha/core` schema validation before presentation. Authors review questions interactively in an in-modal preview, with the power to flag and exclude incorrect questions, edit options inline, and commit only vetted items into the bank as drafts.
- **Open Architecture for Contributors:** A unified `ProviderAdapter` and `ModelRegistry` interface allows open-source contributors to add new models and providers (e.g., Google Gemini, DeepSeek, Local Ollama) via a standardized guide.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Zero AI SDK dependencies:** Use standard native `fetch` with WebCrypto. Zero runtime dependencies added to `@pariksha/api`.
- **Per-workspace key isolation:** Only members of workspace $W$ with `workspaces.manage` permission can configure BYOK credentials for $W$. Only members with `banks.create` permission can draft questions using $W$'s active key. Cross-tenant key usage is mathematically impossible.
- **Dual-dialect database parity:** Tables `byok_credential` and `byok_usage` operate identically on SQLite / Cloudflare D1 and PostgreSQL 16.
- **Structured Output Generation:** Prompts instruct models to output valid `pariksha/question@1` items across supported question types (`single`, `multiple`, `true_false`, `numeric`, `short_answer`).
- **Interactive In-Modal Preview & Flagging (User Choice A):**
  - Generated questions are previewed in the modal before writing to the database.
  - Each item displays an **Admin Validation** badge indicating schema conformance.
  - Authors have a 1-click **"Flag as Incorrect"** toggle on each question card to exclude flawed or hallucinated items from import.
  - Authors have an **"Edit"** mode to adjust question prompts, options, or answer keys inline.
  - Only approved, unflagged questions are committed to the bank.
- **Atomic Database Commit:** Approved questions are saved with `status = "draft"`. Nothing is ever auto-published.
- **Monthly Spend Limits:** Hard spend caps in USD cents; drafting requests fail immediately if the monthly spend limit is reached or exceeded.

### Non-Goals
- **Auto-Publishing:** Questions must never bypass author review or be added directly to published tests.
- **Direct Candidate Runtime AI:** No generative AI is invoked during candidate exam sessions.
- **Fine-tuned Model Training:** Pariksha does not train or fine-tune models.

### Anti-Goals
- **No Unencrypted Key Storage:** Never store raw API keys in tables, logs, error envelopes, or client payloads. Truncated hints (e.g. `sk-ant-...4a9b`) are the only visible representation.
- **No Partial Batch Corruption:** If an AI provider returns unparseable or completely invalid data, the system rejects the output with clear diagnostic issues rather than inserting half-formed items.
- **No Unbounded Retries:** Provider calls do not loop indefinitely; errors like 401 (invalid key), 429 (rate limit), and 500 (provider outage) fail fast with clean user-facing error messages.

---

## 3. Constraints

- **Execution Budget:** Worker requests must complete within subrequest and CPU execution limits. Standard timeouts (30s) apply.
- **Format Stability:** All generated items must strictly conform to `pariksha/question@1` JSON schema and pass `@pariksha/core` `validateQuestion` / `validateBank`.
- **Signal Design System:** All UI elements in `apps/web` must use existing Signal tokens, avoid arbitrary hex colors, adhere to WCAG 2.1 AA contrast requirements, and support both Dark and Light grounds.

---

## 4. Approaches Considered & Tradeoffs

During brainstorming, three interaction models were considered:

| Approach | Description | Tradeoffs | Verdict |
| :--- | :--- | :--- | :--- |
| **Option A: In-Modal Review & Validation Flagging** | Generated questions are returned to the modal dialog for interactive preview. Cards show validation badges, a 1-click "Flag as Incorrect" toggle (auto-excluding from import), and inline editing before saving. | **Pros:** Zero database garbage for discarded drafts; immediate author feedback; full control to edit or prune hallucinations before persistence.<br>**Cons:** Modal contains more state (preview vs configure). | **Selected (User Choice)** |
| **Option B: Bank Staging Area / Review Queue** | Generated questions are committed immediately to a separate "AI Staging" queue in the bank browser for later review. | **Pros:** Can close modal immediately.<br>**Cons:** Pollutes bank database with unvetted/hallucinated items; requires building a new staging view and cross-screen navigation. | **Rejected** |
| **Option C: Split-Pane Diagnostic Wizard** | Heavy two-column wizard with raw schema diagnostics and live candidate preview. | **Pros:** Extremely deep inspection.<br>**Cons:** High UI complexity; over-engineered for the typical 3-5 question drafting flow. | **Rejected** |

---

## 5. Architectural Specification

### 5.1 Data Model (`packages/db`)

Two tables govern BYOK in `packages/db/src/schema/columns.ts`, `sqlite.ts`, and `pg.ts`:

1. `byok_credential`:
   - `id`: `text` (primary key, e.g. `byok_...`)
   - `workspace_id`: `text` (references `workspace.id`, cascaded delete)
   - `provider`: `text` (`"anthropic" | "openai" | "openrouter"`)
   - `encrypted_key`: `text` (base64 ciphertext of AES-256-GCM encrypted key)
   - `key_hint`: `text` (e.g. `sk-ant-...4a9b`, `sk-proj-...8e1f`, `sk-or-...3b12`)
   - `spend_limit_cents`: `integer` (nullable, monthly cap in USD cents)
   - `status`: `text` (`"active" | "disabled"`)
   - `created_at`, `updated_at`, `last_used_at`: `integer` (epoch ms)
   - Unique index on `(workspace_id, provider)`

2. `byok_usage`:
   - `id`: `text` (primary key, e.g. `byoku_...`)
   - `workspace_id`: `text` (references `workspace.id`)
   - `provider`: `text`
   - `model`: `text`
   - `prompt_tokens`: `integer`
   - `completion_tokens`: `integer`
   - `cost_cents`: `integer` (computed from model registry rates)
   - `created_at`: `integer` (epoch ms)

### 5.2 Encryption & Provider Router Architecture (`apps/api/src/byok/`)

- **WebCrypto AES-256-GCM (`crypto.ts`):**
  - Symmetric encryption with SHA-256 derived keys from `FIELD_ENCRYPTION_KEY`.
  - Format: `base64( 12-byte IV + ciphertext + 16-byte auth tag )`.
  - Zero-leak guarantee: decryption occurs in ephemeral memory right before the native `fetch` dispatch.

- **Pluggable Model Registry (`models.ts`):**
  - Contains rich metadata for modern models:
    - **Anthropic:** `claude-3-5-sonnet-20241022` (default), `claude-3-5-haiku-20241022`, `claude-3-opus-20240229`, `claude-3-7-sonnet`.
    - **OpenAI:** `gpt-4o-mini` (default), `gpt-4o`, `o1-preview`, `o1-mini`, `o3-mini`.
    - **OpenAI-Compatible / OpenRouter:** `deepseek/deepseek-chat`, `meta-llama/llama-3.3-70b-instruct`, `mistralai/mistral-large-2411`.
  - Custom model IDs are always accepted: if an unrecognized model ID is supplied, the router falls back to default rates rather than rejecting the author.

- **Provider Router (`router.ts` & `adapters/`):**
  - Interface `ProviderAdapter`:
    ```typescript
    export interface ProviderAdapter {
      readonly id: string;
      readonly name: string;
      readonly defaultModel: string;
      readonly models: ModelMetadata[];
      call(req: ProviderRequest): Promise<ProviderResponse>;
    }
    ```
  - Standardized JSON generation with system prompt enforcement across all adapters.
  - Built-in adapters: `AnthropicAdapter`, `OpenAIAdapter`, `OpenRouterAdapter`.
  - Community extensibility: contributors can add Google Gemini, DeepSeek, or local Ollama by creating an adapter adhering to `ProviderAdapter`.

### 5.3 API Endpoints (`apps/api/src/routes/byok.ts`)

1. `GET /api/v1/workspaces/:workspaceId/byok`
   - Permission: `keys.manage` (Admin, Owner)
   - Returns: List of configured credentials with `keyHint`, `spendLimitCents`, `status`, and monthly usage summary (`totalPromptTokens`, `totalCompletionTokens`, `totalCostCents` for the current UTC calendar month).

2. `PUT /api/v1/workspaces/:workspaceId/byok/:provider`
   - Permission: `keys.manage` (Admin, Owner)
   - Body: `{ apiKey: string, spendLimitCents?: number }`
   - Encrypts key with AES-256-GCM, derives hint, upserts `byok_credential`.

3. `DELETE /api/v1/workspaces/:workspaceId/byok/:provider`
   - Permission: `keys.manage` (Admin, Owner)
   - Deletes credential from database.

4. `POST /api/v1/workspaces/:workspaceId/banks/:bankId/draft-ai`
   - Permission: `banks.edit` (Author, Admin, Owner)
   - Body: `{ prompt: string, count?: number, types?: QuestionType[], provider?: ByokProvider, model?: string }`
   - Strictly computational preview pipeline (Option A):
     - Checks monthly spend cap against `byok_credential.spend_limit_cents` for the current UTC calendar month.
     - Invokes provider API via native `fetch`.
     - Runs `@pariksha/core` schema validation (`validateQuestion` / `validateBank`).
     - Logs token telemetry and estimated cost to `byok_usage` (minimum 1 cent floor for non-zero token consumption).
     - Returns `{ questions, validationIssues, usage }` WITHOUT modifying the `question` table.

5. `POST /api/v1/workspaces/:workspaceId/banks/:bankId/draft-ai/commit`
   - Permission: `banks.edit` (Author, Admin, Owner)
   - Body: `{ questions: Question[] }`
   - Atomically inserts the author's approved/edited questions into the `question` table for `bankId` using the bank question repository, ensuring unique IDs (`q_...`). All bank items reside in the bank ready for authoring and addition to tests.

### 5.4 Organiser Frontend Experience (`apps/web`)

1. **Workspace Settings (`ByokSettings.tsx`):**
   - Mounted in the API & Integrations view (`/admin.html?view=keys`).
   - Cards for Anthropic and OpenAI showing status, key hint, monthly spend cap, and real-time monthly usage.
   - Modal/form to enter new key and set/edit spend cap.

2. **In-Bank AI Question Drafting Modal (`DraftAiModal.tsx`):**
   - Triggered via `"Draft with AI"` button in the Question Bank header.
   - **Step 1: Configuration Form**
     - Textarea: Topic, syllabus, or raw source text.
     - Provider selection (Anthropic Claude 3.5 Sonnet / OpenAI GPT-4o-mini).
     - Question count (slider or number input, 1 to 10).
     - Question type chips (Single Choice, Multiple Choice, True/False, Numeric, Short Answer).
   - **Step 2: Interactive Review & Flagging View**
     - Header summary: Question count, estimated cost, and status pills (e.g. `● 3 Approved`, `▲ 1 Flagged`).
     - List of generated question cards:
       - Question number, type badge, difficulty tag.
       - Admin Validation Status: Green `✓ Schema Valid` or Amber/Red `⚠️ Validation Warning`.
       - **Flag as Incorrect / Discard button:** Flags the question as inaccurate/hallucinated, striking through the card, graying it out, and automatically excluding it from the final commit payload.
       - **Unflag / Keep button:** Restores a flagged question if the author decides to retain it.
       - **Inline Edit button:** Toggles an edit view on the card allowing the author to fix options, prompt text, or the correct answer.
   - **Step 3: Commit**
     - Bottom action bar: Shows summary (e.g. `"1 flagged item will be excluded"`).
     - Primary button: `"Import N Approved Questions to Bank →"`.
     - On commit: Calls `/draft-ai/commit`, adds questions to bank as drafts, closes modal, and refreshes the question bank table with a success toast.

---

## 6. Architectural Decisions Settled (Builder Check)

1. **Question Persistence Schema:** Bank questions are stored in the existing `question` table using the existing bank question repository (`upsertQuestions`). In Pariksha, all bank questions are editable source items until selected into a published test, so no new `status` column migration on `question` is required.
2. **Strict Two-Step Flow:** `POST .../draft-ai` is strictly the preview generator; `POST .../draft-ai/commit` is the persistence endpoint. This eliminates direct write hazards and ensures zero unvetted database garbage.
3. **Spend Cap Window & Precision:** Spend caps are per-provider, evaluated over the current UTC calendar month. Sub-cent requests are rounded with a 1-cent floor (`Math.max(1, Math.round(cost))`) so micro-calls are charged against spend caps without leaking free usage.
4. **RBAC Mapping:** Key management is gated by `keys.manage` (Admin, Owner). Drafting and committing questions in banks is gated by `banks.edit` (Author, Admin, Owner).
5. **Question ID Assignment:** On `/commit`, question IDs default to client/AI IDs or auto-generated unique IDs (`q_...`) if collisions are detected within the bank.

---

## 7. What's Left to the Builder

- Exact Signal token color combinations for the flagged status card (e.g. `--signal-status-refused` background and border).
- Keyboard shortcuts in the preview list (e.g. `Esc` to exit edit mode, keyboard focus on toggle buttons).
- Specific regex / tolerance defaults for numeric question drafting prompts.

---

## 7. Verification & Quality Gates

1. **Unit & Integration Tests:**
   - `packages/db/test/byok.test.ts`: Credential CRUD, AES-GCM cipher round-trip, usage aggregation, SQLite/PG dual-dialect parity.
   - `apps/api/test/byok/crypto.test.ts`: WebCrypto encryption, decryption, invalid secret rejection.
   - `apps/api/test/byok/client.test.ts`: Native HTTP caller with mocked Anthropic and OpenAI responses, token counting, cost computation.
   - `apps/api/test/byok/draft.test.ts`: Spend limit enforcement, schema validation gate, preview vs commit modes.
   - `apps/api/test/byok/routes.test.ts`: RBAC permission checks, masked key output, preview and commit routes.
2. **Frontend Component & Accessibility Tests:**
   - `apps/web/test/admin/byok-settings.test.tsx`: Provider configuration, masked input, spend limit updates, token usage rendering.
   - `apps/web/test/admin/draft-ai-modal.test.tsx`: Full preview and flagging flow, flagging toggles, inline editing, exclude behavior on import.
3. **End-to-End Tests:**
   - `apps/web/e2e/byok-drafting.spec.ts`: Complete user journey: Settings BYOK setup -> Bank browser -> Draft with AI -> Flagging incorrect question -> Importing vetted drafts.
