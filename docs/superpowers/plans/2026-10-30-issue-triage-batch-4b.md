# Issue Triage Batch 4 Part 2 (#178, #229) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and close the final 2 non-epic issues (#178 and #229) by shipping the downloadable question bank template & LLM prompt, and establishing end-to-end test infrastructure for PostgreSQL code paths.

**Architecture:** Export `BANK_CONVERSION_PROMPT` in `@pariksha/core`, add "Copy AI Prompt" and "Download sample" buttons to `bank.tsx` and `import.tsx`, create `packages/db/test/postgres-repo.test.ts` for full Postgres repository validation under CI / local environments, and add `client-pg.test.ts` for offline dialect parsing verification.

**Tech Stack:** TypeScript, React, Vitest, PostgreSQL, Drizzle ORM, Git, GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-10-30-issue-triage-batch-4b-design.md`

## Global Constraints

- **Ponytail Ladder:** Shortest working diffs, YAGNI, reuse existing sample generators and test helpers.
- **Commit Format:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).
- **Zero New Dependencies:** No new npm or external dependencies.

---

### Task 1: Ship Question Bank Downloadable Template & LLM Prompt (#178)

**Files:**
- Create: `packages/core/src/prompt.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/prompt.test.ts`
- Modify: `apps/web/src/routes/bank.tsx`
- Modify: `apps/web/src/routes/import.tsx`
- Create: `apps/web/test/authoring/bank-prompt.test.tsx`
- Modify: `docs/question-format.md`

**Interfaces:**
- Consumes: `sampleBank()`, `SAMPLE_BANK_FILENAME` in `@pariksha/core`.
- Produces: `BANK_CONVERSION_PROMPT` and interactive copy/download buttons in the UI.

- [ ] **Step 1: Write failing test in `packages/core/test/prompt.test.ts`**
  - Verify that `BANK_CONVERSION_PROMPT` exists, contains instructions for all 12 question types, and embeds a sample bank that validates against `schemas/bank-1.json`.
  - Run: `pnpm --filter @pariksha/core test test/prompt.test.ts` -> Expected: FAIL.

- [ ] **Step 2: Implement `packages/core/src/prompt.ts` & re-export in `index.ts`**
  - Define and export `BANK_CONVERSION_PROMPT`.
  - Re-export in `packages/core/src/index.ts`.
  - Run: `pnpm --filter @pariksha/core test test/prompt.test.ts` -> Expected: PASS.

- [ ] **Step 3: Add UI controls in `apps/web/src/routes/bank.tsx` & `import.tsx`**
  - In `apps/web/src/routes/bank.tsx`:
    - Add "AI Prompt" button in the action bar beside "Import" / "Draft with AI".
    - Clicking copies `BANK_CONVERSION_PROMPT` and displays transient "Copied prompt!" notice.
    - Add "Download sample" button using `downloadJson(sampleBank(), SAMPLE_BANK_FILENAME)`.
  - In `apps/web/src/routes/import.tsx`:
    - Add "Copy AI Prompt" button beside "Download a sample".

- [ ] **Step 4: Write and run web tests in `apps/web/test/authoring/bank-prompt.test.tsx`**
  - Test copying prompt and downloading template.
  - Run: `pnpm --filter @pariksha/web test test/authoring/bank-prompt.test.tsx` -> Expected: PASS.

- [ ] **Step 5: Update documentation in `docs/question-format.md`**
  - Document the LLM prompt usage and few-shot formatting.

- [ ] **Step 6: Commit changes**
  - Command:
    ```bash
    git add packages/core/ apps/web/ docs/
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(core,web): ship downloadable template and LLM conversion prompt for question banks (closes #178)"
    ```

- [ ] **Step 7: Close GitHub Issue #178**
  - Command:
    ```bash
    gh issue close 178 --comment "Resolved in commit $(git rev-parse --short HEAD): shipped BANK_CONVERSION_PROMPT in @pariksha/core covering all 12 question types, added Copy AI Prompt and Download Sample buttons to bank and import screens, verified schema conformance, and documented in docs/question-format.md."
    ```

---

### Task 2: Postgres Code Paths Test Infrastructure (#229)

**Files:**
- Create: `packages/db/test/postgres-repo.test.ts`
- Create: `packages/db/test/client-pg.test.ts`
- Modify: `packages/db/package.json` (add `"test:pg"` script)
- Modify: `packages/db/README.md`

**Interfaces:**
- Consumes: `pgClient`, `migrate`, `packages/db/src/repo/index.ts`.
- Produces: Complete automated test runner for Postgres repository and dialect paths.

- [x] **Step 1: Write `packages/db/test/client-pg.test.ts`**
  - Unit tests for Postgres client type mapping, dialect checking (`db.dialect === "pg"`), JSON param handling, and SQL template formatting.
  - Run: `pnpm --filter @pariksha/db test test/client-pg.test.ts` -> Expected: PASS.

- [x] **Step 2: Create `packages/db/test/postgres-repo.test.ts`**
  - Uses `describePostgres = POSTGRES_URL ? describe : describe.skip`.
  - Applies migrations 0000 to 0016 against Postgres.
  - Tests multi-tenant isolation, test creation, attempt lifecycle, webhook deliveries with `PAUSED_SENTINEL`, and retention sweep JSON queries.
  - Run: `pnpm --filter @pariksha/db test test/postgres-repo.test.ts`.

- [x] **Step 3: Update `packages/db/package.json` & docs**
  - Add `"test:pg": "TEST_POSTGRES_URL=postgres://postgres:pariksha@localhost:5432/pariksha_test vitest run test/postgres-repo.test.ts"`.
  - Document Postgres testing workflow in `packages/db/README.md`.

- [x] **Step 4: Commit changes**
  - Command:
    ```bash
    git add packages/db/
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "test(db): establish comprehensive postgres repository test suite and dialect runner (closes #229)"
    ```

- [x] **Step 5: Close GitHub Issue #229**
  - Command:
    ```bash
    gh issue close 229 --comment "Resolved in commit $(git rev-parse --short HEAD): added end-to-end postgres repository test suite in packages/db/test/postgres-repo.test.ts running against CI Postgres service, verified migration 0000-0016 application and dialect conditional queries, and added test:pg script."
    ```

---

### Task 3: Final Review, Push to PR #284, and Sync
- Run whole-branch review and monorepo validation.
- Push to origin and update PR #284 description.
