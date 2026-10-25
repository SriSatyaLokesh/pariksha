# Phase 11 — v1.0 Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 11 of the Pariksha roadmap, fulfilling all v1.0 release readiness deliverables: extensible plugin interfaces (`O-06`), internationalization and RTL translations (`T-24`), OpenAPI 3.1 specification (`O-04`), comprehensive user and administrator documentation (`O-04`), k6 load testing suite for 500 concurrent candidates (`AC-29`), and WCAG 2.1 AA accessibility and security scanning quality gates (`O-05`).

**Architecture:** 
- In `@pariksha/core`: zero-dependency plugin architecture for custom question types, proctoring signals, and export targets; zero-dependency i18n dictionaries and translator helper.
- In `@pariksha/api`: OpenAPI 3.1 generator and `GET /api/v1/openapi.json` route documenting endpoints, security definitions, and error models.
- In `@pariksha/web`: candidate runtime i18n support with RTL layout for Arabic, and exhaustive WCAG 2.1 AA axe audits across all views.
- In `scripts/k6`: automated load testing profile simulating 500 candidates sitting an exam concurrently under strict SLOs (<0.5% errors, p95 ≤ 300ms).
- In `docs`: complete documentation set for quick start, organisers, candidates, security, API reference, and institutional privacy.

**Tech Stack:** TypeScript, Hono, React, Zod, k6, Axe-core, Vitest, Playwright.

**Spec:** [docs/PRD.md](../../PRD.md) `O-04` through `O-07`, `T-24`, `AC-29`, and [docs/ROADMAP.md](../../ROADMAP.md) Phase 11.

## Global Constraints

- **Dependency minimalism (ponytail):** Zero heavy runtime dependencies. Plugin and i18n systems must use standard TypeScript/JavaScript primitives with zero third-party packages.
- **UI/UX rigor (uiuxpromax):** Accessible contrast ratios, semantic HTML landmarks, full keyboard operability, explicit focus rings, and RTL mirroring.
- **British spelling invariant:** British English spelling is maintained across documentation and user-facing copy.
- **Dual deployment parity:** All changes must function identically on Cloudflare Workers and Docker/Node.
- **Subrequest budget discipline:** No added API route or runtime mechanism may exceed stated subrequest limits.

## Review Focus

1. **Plugin Isolation & Type Safety:** A malformed custom question plugin must not crash the core scoring engine or bypass schema validation.
2. **Translation Fallbacks:** Missing keys in non-English dictionaries must cleanly fall back to default English strings without returning blank text or crashing.
3. **RTL Directional Layout:** Switching to an RTL language (e.g., Arabic) must mirror the reading order, navigation buttons, and form layouts while preserving numerals and math formulas LTR.
4. **OpenAPI Spec Accuracy:** OpenAPI document must accurately reflect real route schemas, authentication requirements, and the standard error envelope.
5. **k6 Profile Fidelity:** Load test must accurately simulate the candidate lifecycle under strict proctoring (PoW, start, answer batching, periodic snapshot/events, and submission) to realistically validate Cloudflare and Node bounds.

---

### Task 1: Plugin Architecture & Extensibility (O-06)

**Files:**
- Create: `packages/core/src/plugins/types.ts`
- Create: `packages/core/src/plugins/registry.ts`
- Create: `packages/core/src/plugins/index.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/plugins.test.ts`

- [ ] **Step 1: Write failing tests for plugin system**
  Create `packages/core/test/plugins.test.ts` asserting:
  - Registering a custom question type plugin with schema, validator, and custom scoring function.
  - Scoring a paper containing both core question types and a registered plugin question type.
  - Rejecting unregistered question types during validation.
  - Registering custom proctoring signal evaluators and export format transformers.

- [ ] **Step 2: Implement plugin types and registry**
  In `packages/core/src/plugins/`:
  - `QuestionPlugin<TConfig, TResponse>`: defines type name, zod/json schema, option validator, and score evaluator function.
  - `ProctoringSignalPlugin`: defines custom event name, severity score calculator, and violation categorizer.
  - `ExportTargetPlugin`: defines format identifier, mime type, file extension, and document transformer.
  - `PluginRegistry`: singleton-friendly registry with safe registration, retrieval, and error handling for missing/duplicate plugins.

- [ ] **Step 3: Export from `@pariksha/core` and verify tests**
  Export plugin definitions from `packages/core/src/index.ts`. Run `pnpm --filter @pariksha/core test test/plugins.test.ts`.

---

### Task 2: Internationalization & RTL Support (T-24)

**Files:**
- Create: `packages/core/src/i18n/types.ts`
- Create: `packages/core/src/i18n/locales/en.ts`
- Create: `packages/core/src/i18n/locales/hi.ts`
- Create: `packages/core/src/i18n/locales/es.ts`
- Create: `packages/core/src/i18n/locales/ar.ts`
- Create: `packages/core/src/i18n/index.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/src/apps/ExamApp.tsx`
- Test: `packages/core/test/i18n.test.ts`
- Test: `apps/web/test/exam/i18n-rtl.test.tsx`

- [ ] **Step 1: Write failing unit tests for i18n and RTL**
  - In `packages/core/test/i18n.test.ts`: test key translation lookup, parameterized string formatting (e.g. `Question {current} of {total}`), fallback to English when key is missing in target locale, and RTL direction detection for Arabic (`ar`).
  - In `apps/web/test/exam/i18n-rtl.test.tsx`: test candidate runner rendering in Arabic sets `dir="rtl"` on the document/wrapper and renders translated action buttons.

- [ ] **Step 2: Implement core i18n engine and locales**
  In `packages/core/src/i18n/`:
  - Define `LocaleCode = "en" | "hi" | "es" | "ar"`.
  - Create string catalog dictionaries covering candidate exam actions (Start, Next, Previous, Clear, Review, Submit, Confirm, Time Remaining, Reconnecting, Question of).
  - Implement `createTranslator(locale: LocaleCode)` with parameter substitution `{param}` and English fallback.
  - Implement `isRtlLocale(locale: LocaleCode): boolean` (returns true for `"ar"`).

- [ ] **Step 3: Integrate into candidate runner (`ExamApp.tsx`)**
  Update `ExamApp.tsx` to read the test's interface language (or candidate's selected locale) and apply `dir={isRtl ? "rtl" : "ltr"}` to the exam container. Pass translator to navigation buttons, question header, and submission modal.

- [ ] **Step 4: Verify tests pass**
  Run `pnpm --filter @pariksha/core test test/i18n.test.ts` and `pnpm --filter @pariksha/web test test/exam/i18n-rtl.test.tsx`.

---

### Task 3: OpenAPI 3.1 Specification & Endpoint (O-04)

**Files:**
- Create: `apps/api/src/openapi.ts`
- Modify: `apps/api/src/app.ts`
- Create: `docs/openapi.yaml`
- Test: `apps/api/test/openapi.test.ts`

- [ ] **Step 1: Write failing test for OpenAPI generation**
  Create `apps/api/test/openapi.test.ts` asserting:
  - `GET /api/v1/openapi.json` returns HTTP 200 with `application/json`.
  - Spec carries `openapi: "3.1.0"`, valid `info` (title: "Pariksha API", version: "1.0.0"), and server URLs.
  - Documents major route groups: `/api/v1/auth/*`, `/api/v1/workspaces/*`, `/api/v1/run/*`, `/api/v1/health`.
  - Documents authentication schemes (`bearerAuth`, `cookieAuth`, `apiKeyAuth`).
  - Documents standard `ApiError` envelope schema.

- [ ] **Step 2: Implement OpenAPI generator and route**
  In `apps/api/src/openapi.ts`:
  - Build clean OpenAPI 3.1 document programmatically.
  - Mount `app.get("/api/v1/openapi.json", ...)` in `apps/api/src/app.ts` with route budget ceiling.
  - Export static YAML definition to `docs/openapi.yaml`.

- [ ] **Step 3: Verify OpenAPI route and tests**
  Run `pnpm --filter @pariksha/api test test/openapi.test.ts`.

---

### Task 4: Complete Documentation Suite (O-04, O-07)

**Files:**
- Create: `docs/quickstart.md`
- Create: `docs/organiser-guide.md`
- Create: `docs/candidate-faq.md`
- Create: `docs/security-guide.md`
- Create: `docs/api-reference.md`
- Create: `docs/privacy-template.md`
- Test: `scripts/docs.test.mjs`

- [ ] **Step 1: Write documentation verification test**
  Create `scripts/docs.test.mjs` using Vitest to assert:
  - All 6 required documentation files exist and are non-empty.
  - Markdown links in `docs/*.md` resolve to valid existing files or valid absolute URLs.
  - Headings are well-formed and follow project conventions.

- [ ] **Step 2: Author documentation suite**
  - `docs/quickstart.md`: step-by-step deploy in <30 min for Docker & Cloudflare free tier.
  - `docs/organiser-guide.md`: question authoring, test builder, section division, access modes, proctoring configuration, results & analytics.
  - `docs/candidate-faq.md`: linkable FAQ for candidates answering camera permissions, network drops, offline saves, and access codes.
  - `docs/security-guide.md`: RBAC, proof-of-work, rate limits, session security, password Argon2id & TOTP, and proctoring privacy boundaries.
  - `docs/api-reference.md`: curl examples for workspace management, candidate invites, webhook consumption, and results export.
  - `docs/privacy-template.md`: turnkey institutional privacy notice covering data retention, proctoring snapshots, and candidate rights.

- [ ] **Step 3: Run docs test**
  Run `pnpm vitest run scripts/docs.test.mjs`.

---

### Task 5: k6 Load-Testing Suite (AC-29)

**Files:**
- Create: `scripts/k6/load-test.js`
- Create: `scripts/k6/k6-summary.js`
- Create: `scripts/k6/README.md`
- Test: `scripts/k6.test.mjs`

- [ ] **Step 1: Write failing test for k6 payload simulation**
  Create `scripts/k6.test.mjs` verifying:
  - k6 load test script syntax and exports.
  - Payload builders generate valid PoW responses, question answers, and event batch shapes conforming to API expectations.
  - Threshold definitions strictly enforce `http_req_failed < 0.005` and `p(95) <= 300ms`.

- [ ] **Step 2: Implement k6 load test suite**
  In `scripts/k6/load-test.js`:
  - 500 VUs ramping over 1 minute, sustained sitting for 3 minutes, 40 questions answered per candidate, periodic camera snapshot / tab event POSTs, and final submit.
  - Configurable target URL via environment variable (`__ENV.TARGET_URL || 'http://localhost:8787'`).
  - Summarize results using `k6-summary.js` producing a markdown scoreboard.
  - Author `scripts/k6/README.md` with instructions for running via Docker or native k6 binary.

- [ ] **Step 3: Verify k6 test suite**
  Run `pnpm vitest run scripts/k6.test.mjs`.

---

### Task 6: Accessibility Audit & Security Automation (O-04, O-05)

**Files:**
- Create: `apps/web/test/a11y/wcag.test.tsx`
- Create: `.github/workflows/security-scan.yml`
- Modify: `docs/ROADMAP.md`
- Test: Full monorepo verification (`pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm --filter @pariksha/web e2e`)

- [ ] **Step 1: Implement exhaustive WCAG 2.1 AA Axe tests**
  Create `apps/web/test/a11y/wcag.test.tsx`:
  - Render candidate runner screens (Welcome, Question, Submit modal, Result code view) and run `axe(container)`.
  - Render organiser dashboard screens (Overview, Bank list, Test builder, Monitor) and run `axe(container)`.
  - Verify zero axe violations.

- [ ] **Step 2: Create security scan GitHub Actions workflow**
  Create `.github/workflows/security-scan.yml`:
  - Runs daily and on PRs with `pnpm audit --audit-level=high`.
  - Validates zero known high/critical vulnerabilities.

- [ ] **Step 3: Update `docs/ROADMAP.md`**
  Mark Phase 11 as **Done** in `docs/ROADMAP.md` progress table.

- [ ] **Step 4: Monorepo verification and git commit**
  - Run all gates: `pnpm typecheck`, `pnpm lint`, `SITE_URL="https://pariksha.example" pnpm build`, `pnpm test`, `pnpm --filter @pariksha/web e2e`.
  - Stage specific files, commit with `--author="Satya K <srisatyalokesh2.12@gmail.com>"`, and push to `origin main`.
