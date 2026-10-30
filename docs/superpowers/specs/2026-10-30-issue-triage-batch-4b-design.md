# Issue Triage Batch 4 Part 2 Design Spec (#178, #229)

**Date:** 2026-10-30  
**Authors:** Antigravity & Satya K  
**Scope:** Resolve and close Issue #178 (Question banks downloadable template & LLM conversion prompt) and Issue #229 (Postgres test infrastructure for repository and dialect code paths).

---

## 1. Issue #178: Question Bank Downloadable Template & LLM Conversion Prompt

### Problem Statement
Test organisers often have raw unformatted question text (from PDFs, Word documents, or existing notes). Currently, to import them into Pariksha, they must either hand-format them or use Phase 12 BYOK AI drafting (which requires configuring API keys).
By shipping a downloadable template and a proven few-shot LLM conversion prompt beside the Import/Export controls, organisers can use any AI tool (ChatGPT, Claude, Gemini, etc.) with zero server infrastructure cost or API key configuration.

### Technical Design
1. **Core Prompt Definition (`packages/core/src/prompt.ts`)**:
   Export `BANK_CONVERSION_PROMPT`:
   - Contains strict instructions for formatting raw questions into `pariksha/bank@1` JSON conforming to `schemas/bank-1.json`.
   - Specifies formatting rules for all 12 supported question types: `single`, `multiple`, `select_k`, `true_false`, `assertion_reason`, `matching`, `multi_matching`, `ordering`, `fill_blank`, `numeric`, `short_answer`, `long_answer`.
   - Embeds sample few-shot question examples.
   - Re-exports in `packages/core/src/index.ts`.
2. **UI Controls (`apps/web/src/routes/bank.tsx` & `import.tsx`)**:
   - In `apps/web/src/routes/bank.tsx`: Add "Template & Prompt" or "AI Prompt" button in the bulk action bar beside "Import" / "Export bank".
   - Clicking copies `BANK_CONVERSION_PROMPT` to clipboard via `navigator.clipboard.writeText` and renders transient feedback ("Copied prompt!"). Also offers a 1-click "Download sample" triggering `downloadJson(sampleBank(), SAMPLE_BANK_FILENAME)`.
   - In `apps/web/src/routes/import.tsx`: Add a companion "Copy AI Prompt" button beside "Download a sample".
3. **Verification**:
   - `packages/core/test/prompt.test.ts`: Validates that questions generated from the sample in `prompt.ts` strictly validate against `schemas/bank-1.json`.
   - `apps/web/test/authoring/bank-prompt.test.tsx`: Tests that clicking the button copies the prompt and displays feedback.
   - Update `docs/question-format.md` with instructions on using the AI prompt.

---

## 2. Issue #229: Postgres Code Paths Test Infrastructure

### Problem Statement
`packages/db` supports three database engines: SQLite, Cloudflare D1, and PostgreSQL. SQLite is tested via `better-sqlite3`, D1 via Miniflare in `apps/api/test/worker.test.ts`. However, PostgreSQL dialect code paths (such as `jsonb` operations, `#>>` extraction in retention sweeps, `c.form_values_json = '{}'::jsonb`, and pg repository CRUD) lacked an end-to-end repository test suite.

### Technical Design
1. **Postgres Repository Suite (`packages/db/test/postgres-repo.test.ts`)**:
   - Uses `describePostgres = POSTGRES_URL ? describe : describe.skip`, consistent with `migrate.test.ts`.
   - When `TEST_POSTGRES_URL` is set (which is already configured in GitHub Actions CI via `.github/workflows/ci.yml:128`), this suite executes all migrations (0000 to 0016) against a real Postgres database and tests:
     - Multi-tenant workspace isolation (`createWorkspace`, `listWorkspaces`)
     - Test creation & versioning
     - Candidate registration & attempts
     - Webhook queuing & pause range sentinel (`setWebhookActive` with `PAUSED_SENTINEL`)
     - Retention SQL expiry expressions (`#>> '{retention,snapshots_days}'::numeric`)
     - Candidate erasure blanking check (`form_values_json = '{}'::jsonb`)
     - Teams & RBAC queries
   - Clean teardown with `closeClient(db)`.
2. **Postgres Unit / Syntax Checks**:
   - Add targeted dialect unit tests in `packages/db/test/client-pg.test.ts` to verify SQL parameter building and type mapping even when no live Postgres instance is connected locally.
3. **Local Developer Convenience**:
   - Add `"test:pg"` npm script in `packages/db/package.json` pointing to Docker Compose Postgres (`postgres://postgres:pariksha@localhost:5432/pariksha_test`).
   - Document how to run Postgres tests locally in `packages/db/README.md`.

---

## 3. Review & Verification

1. **Test Commands:**
   - `pnpm --filter @pariksha/core test`
   - `pnpm --filter @pariksha/web test`
   - `pnpm --filter @pariksha/db test`
   - `pnpm typecheck`
2. **Issue Closure:**
   - Close #178 and #229 via GitHub CLI with commit citations.
