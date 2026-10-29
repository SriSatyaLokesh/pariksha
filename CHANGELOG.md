# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Security Audit Remediation** (Epic #276, Issues #277, #278, #279, #280)
  - **BYOK SSRF & Egress Protection** (#277): Blocked SSRF and API key exfiltration via `baseUrl` in `POST /banks/:bankId/draft-ai` by enforcing `urlRefusal` validation against loopback, cloud metadata (169.254.169.254), RFC 1918 private IPs, and non-standard ports. Configured `redirect: "manual"` and `AbortSignal.timeout(15_000)` across all five provider adapters (`opencode`, `openai`, `anthropic`, `gemini`, `openrouter`).
  - **Organiser Auth Rate Limiting & Brute-Force Throttling** (#278): Added sliding-window rate limit buckets in `LIMITS` (`limit.ts`): `auth_magic_link_address` (5/10m), `auth_password_signin_address` (5 misses/10m), and `auth_totp_verify_user` (5 misses/5m). Enforced SHA-256 hashed email bucket keys to prevent plaintext email leakage in the `rate_limit` store (`S-07`, `S-15`), counting misses only for password sign-ins to prevent lockout of honest credentials.
  - **Bounded Outbound HTTP Timeouts** (#279): Added `signal: AbortSignal.timeout(5_000)` to `fetchLiveOpenRouterModels` and `signal: AbortSignal.timeout(10_000)` with `redirect: "manual"` to `httpSender` to eliminate unbounded HTTP connection hangs.
  - **Workspace Boundary Validation in Team Grants** (#280): Enforced tenant boundary checks in `grantTeamResource` verifying that the referenced `test` or `bank` exists in the requesting `workspaceId` before creating a grant row, returning 404 `not_found` on cross-tenant resource references.

- **Attempt Review Human-Readable Answer Display & Question Prompts** (Issue #274)
  - Enriched `GET /api/v1/workspaces/:id/attempts/:attemptId/review` to pass `prompt` and `questionType` for each answer in the review payload.
  - Replaced raw JSON string dumps in `AttemptReview.tsx` with human-readable, semantic formatting:
    - Uppercase choice badges for single, multiple, and select-K options with match/mismatch status indicators.
    - Clean numeric values with tolerance notation (e.g. `25 (± 0.5)`).
    - Side-by-side key-value mapping tables for matching questions.
    - Labeled pill chips for fill-in blanks (`Blank 1: 52`).
    - Typography for text, short, and long answer responses.
  - Rendered question stems/prompts prominently on each question card so organisers have full question context.
  - Structured side-by-side comparison layout for candidate answer vs expected scoring key.
  - Registered all new attempt review selectors into `contrast-usage.test.ts` for WCAG AA compliance.

### Added

- **Results Hub & Candidate Results Review Table** (Issue #271)
  - Dedicated Results Hub in the organiser navigation shell (`OrganiserShell.tsx` and `ResultsHub.tsx`) showing workspace-level tests with aggregate stats (candidates count, submitted attempts, class average, pass rate).
  - Test-scoped Candidate Results Route (`ResultsRoute.tsx`) and Table (`ResultsTable.tsx`) with search by name/email/ID, status filter, and integrity flag filter.
  - Expandable inline question breakdown accordion (`▼`) showing prompt excerpt, points earned vs max points, and correct/incorrect status with zero rubric/answer key leakage (`KG1`).
  - Integrated "Review" action directly navigating into the Attempt Review canvas (`AttemptReview.tsx`) with seamless back navigation.
  - In-browser CSV downloads for both candidate results and raw answer dumps.
  - Backend API endpoints `GET /api/v1/workspaces/:id/results/overview` and `GET /api/v1/workspaces/:id/tests/:testId/results` enforcing subrequest ceilings and permission checks (`results.export`).

- **Contributor setup guide** — `docs/contributing/setup.md`: prerequisites, install and build, running the API and web app (bash and PowerShell), the environment variable table, the three test tiers and the safe full-suite command, the Cloudflare commands contributors must not run, the migration rule and troubleshooting.
  The guide covers local development, Docker, Cloudflare and Google sign-in. Also corrects stale setup docs: `docs/quickstart.md` (Node 22, one-Worker Cloudflare flow, real commands), `apps/api/README.md`, `apps/web/README.md` and the phase status in `CONTRIBUTING.md`.

- **PRD v0.2 — Teams, RBAC & Credential Lifecycle** (Issues #175, #176, #177, #234)
  - Granular RBAC read permissions: unblocked `Reviewer` and `Viewer` workspace roles by introducing `"tests.view"` and `"banks.view"` actions, decoupling reading tests/banks from write permissions (`tests.edit`, `banks.create`).
  - Resource-scoped grants (S-08): elevated per-test and per-bank permissions via union model in `can()` without modifying user's base workspace role.
  - Member management: enabled updating member roles and direct test grants with last-owner protection (`PATCH /api/v1/workspaces/:id/members/:userId`).
  - Teams & Resource Collaboration: paired SQLite and PostgreSQL migrations (`0015_teams_and_rbac.sql`) introducing `team`, `team_member`, and `team_grant` schemas.
  - Complete Teams REST API (`/api/v1/workspaces/:id/teams/*`) supporting CRUD, member management, and resource grant assignment with comprehensive audit logging.
  - API Key Demotion Cascade: tracks `api_key.created_by` and automatically revokes all active API keys generated by a member when they are demoted below author or removed from the workspace.
  - Organiser UI: added `TeamsPanel` and `CollaboratorsDrawer` with accessible dialogs, tab-trapping, theme-compliant tables, and typed `ApiClient` integration.

- **Phase 8.5 — Proctoring: Ambient Noise & Microphone Proctoring ("The Ear")** ([#223](https://github.com/SriSatyaLokesh/pariksha/issues/223), [#266](https://github.com/SriSatyaLokesh/pariksha/pull/266))
  - In-browser `AudioWorkletProcessor` (`noise-processor.ts`) running in candidate browser for zero-allocation circular RMS energy calculation in $O(1)$ time.
  - Zero audio storage guarantee: no audio is ever recorded, transmitted, or stored on any server (backed by ADR 0012, PRD P-06, and automated AST scanner tests).
  - Main-thread falling-edge noise detector emitting candidate proctoring events with `{ durationMs }` metadata on noise bursts exceeding configurable thresholds.
  - Unified `acquireMedia` helper handling camera, microphone, and combined streams with fail-open `AG1` resilience.
  - Interactive `DeviceCheckModal` on candidate landing and start gate featuring live video preview, real-time responsive microphone VU meter, and clear readiness indicators.
  - Hardened upfront proctoring gate on `/test/:code/start` ensuring candidates complete required device permission checks before proceeding to access codes or the exam runner when proctoring is enabled.

## [1.0.0-rc.1] - 2026-10-27

### Added

- **Phase 12 — BYOK AI Question Drafting** ([PR #263](https://github.com/SriSatyaLokesh/pariksha/pull/263), closes [#40](https://github.com/SriSatyaLokesh/pariksha/issues/40))
  - Zero external AI SDK runtime dependencies: native Web `fetch` combined with WebCrypto AES-256-GCM authenticated encryption for workspace API keys.
  - Extensible Provider Router and Model Registry supporting Anthropic Claude (3.7 Sonnet, 3.5 Sonnet, 3.5 Haiku), OpenAI (GPT-4o, GPT-4o-mini, o3-mini), Google Gemini (2.5 Pro, 2.5 Flash, 1.5 Pro, 1.5 Flash), OpenRouter (DeepSeek R1/V3, Llama 3.3 70B, Qwen 2.5 72B), and local OpenCode models.
  - Two-step drafting pipeline: `/draft-ai` endpoint generating validated `pariksha/question@1` schema candidates and `/draft-ai/commit` atomically inserting approved questions into question banks.
  - Author drafting modal (`DraftAiModal`) with schema validation error badging, inline question editing, and single-click accept/exclude controls.
  - Per-workspace provider settings with encrypted storage, spending caps, and token usage accounting.

- **Phase 11 — Release Readiness & Multi-Target Deployment** ([PR #260](https://github.com/SriSatyaLokesh/pariksha/pull/260), closes [#43](https://github.com/SriSatyaLokesh/pariksha/issues/43))
  - Multi-target deployment architecture (`docs/deployment.md`) covering Cloudflare Workers + D1 + R2, Docker Compose (PostgreSQL 16 + MinIO S3 + Caddy HTTPS), standalone Docker SQLite, and air-gapped on-premise LAN.
  - Extensible plugin architecture (`@pariksha/core/plugins`) supporting custom question types, external scoring engines, and webhook transforms.
  - Auto-generated OpenAPI 3.1 specification and JSON schema endpoint (`GET /api/v1/openapi.json`).
  - Internationalization (i18n) framework supporting Hindi, Telugu, Spanish, French, German, and Arabic with dynamic Right-to-Left (RTL) layout switching for candidates.
  - k6 performance testing suite (`tests/load/k6-500-candidates.js`) validating 500 concurrent virtual candidates at sub-100ms response latencies.
  - Automated WCAG 2.1 AA accessibility audit running Axe Core in Playwright CI across all candidate and organiser surfaces.
  - Full search engine (SEO) and generative answer engine (GEO/AEO) optimization, including JSON-LD schema, agent-friendly `robots.txt`, and `llms.txt`.

- **Phase 10 — Docker Self-Host Stack** ([PR #260](https://github.com/SriSatyaLokesh/pariksha/pull/260), closes [#42](https://github.com/SriSatyaLokesh/pariksha/issues/42))
  - Multi-container Docker Compose stack (`deploy/docker/docker-compose.yml`) orchestrating API/Web SPA container, PostgreSQL 16, MinIO object store, and Caddy with automatic TLS.
  - Single-container lightweight SQLite mode (`deploy/docker/docker-compose.sqlite.yml`) for single-node deployments.
  - Native credentials authentication supporting Argon2id password hashing and RFC 6238 TOTP two-factor authentication (2FA).
  - In-process cron scheduler executing recurring data retention sweeps and ephemeral demo cleanup tasks.
  - Automated zero-downtime backup (`deploy/docker/backup.sh`) and restore (`deploy/docker/restore.sh`) utilities.

- **Phase 9 — Public Demo Instance & Candidate Section Division** ([PR #255](https://github.com/SriSatyaLokesh/pariksha/pull/255), closes [#41](https://github.com/SriSatyaLokesh/pariksha/issues/41), [#256](https://github.com/SriSatyaLokesh/pariksha/issues/256))
  - Public live demo environment (`/demo`) with local-first client question caching and zero Cloudflare D1 subrequest consumption.
  - Ephemeral per-visitor demo workspace provisioning with automated retention cleanup sweeps.
  - Section navigation tabs, grouped question palette with per-section progress bars, and instructions drawers.
  - Floating draggable candidate scientific calculator and bracket-style fill-in-the-blank input assistance.

- **Phase 8 & 8.5 — Proctor Watchtower, Results & Data Lifecycle** ([PR #221](https://github.com/SriSatyaLokesh/pariksha/pull/221), closes [#39](https://github.com/SriSatyaLokesh/pariksha/issues/39))
  - Real-time Proctor Watchtower (`/org/tests/:id/monitor`) streaming candidate statuses and live integrity metrics without unbounded subrequest fanout.
  - Server-to-candidate proctor broadcast messaging (`C-10`) multiplexed onto existing question autosave and clock polling HTTP responses without client polling overhead.
  - Proctor intervention suite: pause attempt, resume attempt, extend time, issue official warning, and terminate attempt with audit trail.
  - Per-attempt timeline review UI visualizing candidate event logs with unobserved intervals rendered as explicit timeline gaps.
  - Manual grading queue supporting anonymous/blind marking and by-question grading modes.
  - Psychometric item analysis computing facility index, item discrimination index, and distractor option distribution.
  - Comprehensive evidence exports: complete results CSV, granular per-response CSV, proctoring events CSV, and snapshot manifest ZIP.
  - Outbound webhook delivery system with HMAC-SHA256 signature verification, exponential backoff retries, and dead-letter queue.
  - Granular scoped API keys (`pk_live_...`) with read/write permission matrix.
  - Automated data retention sweep job implementing GDPR/DPDP right-to-erasure candidate deletion.

- **Phase 7 — Strict Proctoring & Integrity Defense** ([PR #205](https://github.com/SriSatyaLokesh/pariksha/pull/205), [#207](https://github.com/SriSatyaLokesh/pariksha/pull/207), [#208](https://github.com/SriSatyaLokesh/pariksha/pull/208), [#216](https://github.com/SriSatyaLokesh/pariksha/pull/216), [#239](https://github.com/SriSatyaLokesh/pariksha/pull/239))
  - Three proctoring security profiles: Off, Standard, and Strict.
  - Candidate client integrity enforcement: fullscreen lock, tab/window defocus detection, multi-display detection, clipboard lock (copy/cut/paste prevention), and context menu disabling.
  - Camera identity verification and periodic interval snapshots securely ingested to private object storage.
  - Dynamic anti-leak watermark rendering candidate session identifiers and micro-timestamps.
  - Configurable violation thresholds triggering automatic attempt lock overlays and organiser manual unlock approvals.

- **Phase 6 & 6.5 — Candidate Runtime & Organiser Design System Pass** ([PR #173](https://github.com/SriSatyaLokesh/pariksha/pull/173), [#195](https://github.com/SriSatyaLokesh/pariksha/pull/195)–[#203](https://github.com/SriSatyaLokesh/pariksha/pull/203), closes [#37](https://github.com/SriSatyaLokesh/pariksha/issues/37), [#187](https://github.com/SriSatyaLokesh/pariksha/issues/187))
  - Complete candidate test runner supporting all 12 question types with LaTeX formulas (KaTeX) and syntax-highlighted code snippets.
  - Resilient offline autosave queue backed by IndexedDB and server-side idempotent upserting (`/api/v1/run/:id/answers`).
  - Server-authoritative countdown clock with automatic submission upon time exhaustion.
  - Four candidate access modes: Public open link, Private access code, Pre-registered email token, and OIDC Single Sign-On.
  - Cryptographic Proof-of-Work challenge providing lightweight bot resistance without third-party tracking scripts.
  - Automated candidate payload scrubbing stripping answer keys, rubrics, and instructor explanations before delivery to the browser.
  - Unified Signal palette design tokens with seamless Dark and Light theme switching and zero CSS runtime cost.
  - Persistent organiser shell with desktop sidebar, top bar, breadcrumbs, and real-time navigation state.

- **Phases 2 - 5 — Data Platform, Auth/RBAC, Question Banks & Test Lifecycle** ([PR #138](https://github.com/SriSatyaLokesh/pariksha/pull/138), [#145](https://github.com/SriSatyaLokesh/pariksha/pull/145), closes [#24](https://github.com/SriSatyaLokesh/pariksha/issues/24), [#34](https://github.com/SriSatyaLokesh/pariksha/issues/34), [#35](https://github.com/SriSatyaLokesh/pariksha/issues/35), [#36](https://github.com/SriSatyaLokesh/pariksha/issues/36))
  - Multi-dialect Drizzle ORM layer supporting Cloudflare D1, SQLite, and PostgreSQL with automatic migrations.
  - Storage abstraction layer supporting Cloudflare R2, AWS S3/MinIO, and local filesystem storage.
  - Multi-tenant workspace architecture with Role-Based Access Control (Owner, Admin, Author, Proctor, Reviewer) and append-only audit log.
  - Rich question authoring studio with real-time preview across all 12 question types, passage groups, and tag filtering.
  - Bulk bank import and export supporting Pariksha JSON, CSV, and Moodle GIFT formats with line-by-line validation reports.
  - Complete test builder supporting random question pools, fixed sections, balanced points distribution, and dynamic registration form fields.
  - Immutable test lifecycle (Draft → Scheduled → Open → Closed → Archived) with version-pinned attempt freezing.

### Fixed

- Fixed proctoring event ingestion endpoint to reject client submissions attempting to inject server-only event types (`#227`).
- Fixed proctoring violation enforcement so violations trigger configured actions, attempt locking, and proctor review (`#213`, `#86`).
- Fixed candidate stream lifecycle during start-gate device checks to prevent redundant camera re-acquisition when audio acquisition encounters hardware denial (`#266`).
- Fixed organizer test start view to block candidates from advancing when proctoring requirements are unsatisfied on their hardware (`#266`).
- Fixed question bank CSV and Moodle GIFT import parsers to gracefully reject malformed delimiter blocks without server panic.

## [0.1.0] - 2026-10-16

### Added

- `validateTest` in `@pariksha/core` — cross-field import validation for `pariksha/test@1` documents, alongside the existing `validateBank`. It checks a test's `scoring.default_mode` against every question type its sections can draw (the mode most questions grade under, since a question's own `scoring` block is optional), a pool whose filter matches fewer questions than its `count`, sets of unequal total points, `release.when: "on_date"` without `at`, and `access.mode: "link_code"` without `access_code`. Line-by-line and all-or-nothing, like the bank importer. Closes #132.
- Design tokens generated from `DESIGN.md`'s front matter by `scripts/tokens.mjs` into committed `tokens.css` and `tokens.ts`, including a `contrastPairs` export of every ratio the design system states. The build regenerates them and the test suite fails if the committed files are stale or if a hex colour literal appears anywhere in `apps/web/src`.
- `apps/web` — a Vite + React application with the candidate and admin bundles split from the first commit, the design-system components `DESIGN.md` names, and the public landing page. Fonts (Anek Latin, Anek Telugu, Anek Devanagari, JetBrains Mono) are self-hosted, subset and SIL OFL, so the page makes no third-party request. Candidate bundle 75.7 KB gzipped against a 300 KB budget.
- A contrast test that reads each selector's real `color` and `font-size` declarations out of the stylesheet and asserts the computed WCAG ratio clears its threshold, because axe under jsdom cannot evaluate contrast at all.
- Cloudflare hosting for the web app on Workers Static Assets, with a strict `default-src 'self'` Content-Security-Policy, immutable caching for hashed assets and fonts, and a deploy workflow that runs only on the upstream repository.
- Product requirements document (`docs/PRD.md`) with Mermaid diagrams and PNG exports.
- Open question format `pariksha/question@1` and bank format `pariksha/bank@1`, with JSON Schemas and a written spec.
- Open test format `pariksha/test@1` — timing, access, registration form, proctoring, scoring, sections and release — with `schemas/test-1.json` and `docs/test-format.md`.
- Worked example `examples/reasoning-aptitude/`: a complete 45-minute test with 17 questions covering all 12 types, a registration form using every field type, a candidate list, a results CSV, and a walkthrough of every screen.
- Question-set example `examples/technical-screening/` (SQL, Python, AI basics), one question per type.
- `DESIGN.md` — the design system as machine-readable tokens plus the reasoning: 20 colours with measured contrast ratios, 13 type tokens, 43 components spanning marketing surfaces, the registration form, the test runner and the admin tables, a high-contrast mode, and motion rules that keep a live attempt still.
- `CONTRIBUTORS.md`, recognising every kind of contribution, not only commits.
- Repository scaffolding: contribution guide, code of conduct, security policy, maintainers list, issue and pull-request templates, Dependabot, and CI that validates every schema and example.

### Changed

- The landing page is rebuilt as twelve sections that teach before they compare, and it is prerendered to static HTML at build time, so `/` ships 0 bytes of JavaScript and an answer engine fetching the URL gets the full 52.5 KB of text without running anything. Every absolute URL comes from one build-time origin, `SITE_URL`, which the build requires rather than defaults. The prerender also emits `robots.txt`, `llms.txt`, `sitemap.xml` and a styled `404.html`. Every claim on the page traces to a row in the content inventory with a file path beside it, every status is dated, and no capability claim is made about a competitor without an external source. Closes most of #137.
- `docs/PRD.md` no longer lists ordering under partial credit. `ordering` is scored by `position` ("points × items in the right position ÷ items"), which already is partial credit for a sequence; `docs/question-format.md` and `APPLICABLE_MODES` always said so.
- `docs/PRD.md` T-10 no longer promises section shuffling. Nothing expressed it — there is no `shuffle_sections` field — and per-section time limits (T-12) and `per_section` navigation (T-13) both assume a stable section order. Shuffling questions within a section stays.
- `DESIGN.md` gains a `hero-lead` typography token (24px). Cream on the voltage canvas measures 3.86:1, which WCAG AA permits only at 24px and above, so the hero's lead sentence has a size floor rather than a tint exception.
- Licence is **Apache-2.0**, replacing the proposed AGPL-3.0. Reasoning recorded in `docs/adr/0003-license-apache-2-0.md`. Documentation, schemas and examples remain CC BY 4.0.
- `examples/` is organised one folder per subject, each holding its own questions, test and README, replacing the single `examples/banks/` directory.
- Grading memoises each `fill_blank` regex pattern by pattern string — both the `assertSafeRegex` verdict and the compiled `RegExp` — instead of re-parsing and recompiling it for every candidate, every blank and every attempt. The cache is a plain `Map` capped at 500 distinct patterns; past the cap nothing is evicted and nothing is cached, so an uncached pattern grades exactly as it did before.
- CI enforces test coverage on `packages/core/src` with `@vitest/coverage-v8` instead of the figure being re-measured by hand: 97% statements, 93% branches, 100% functions, 98% lines, each the measured value rounded down so the gate fails on a real drop rather than on rounding.

### Fixed

- A `short_answer` question can now score above zero. `rubric` is the only scoring mode applicable to it, and rubric scoring sums the levels a reviewer picks — but only `long_answer` declared a `rubric` field, so every `short_answer` scored 0 for every candidate and the type was inert ([#130](https://github.com/SriSatyaLokesh/pariksha/issues/130)). `short_answer` now takes the same **optional** `rubric` that `long_answer` takes, in `schemas/question-1.json` (as a shared `$defs/rubric` both types reference), in `docs/question-format.md`'s type table and in `@pariksha/core`'s `ShortAnswerQuestion`. The change is strictly additive — nothing is renamed, removed or made required — so it stays inside `pariksha/question@1` and every existing bank file keeps validating.
- The two worked `short_answer` examples (`WRI-001`, `GEN-002`) now carry a rubric, so they can be marked for the points they advertise.
- An `ordering` position the candidate never supplied no longer counts as a wrong part. A 1-of-3 ordering under `negative` scored −0.75 where the equivalent partial submission in `matching` (omitted left items) or `fill_blank` (unfilled blanks) scored 0; all three graders now answer "an unanswered part is not a wrong part" the same way.
- `assertSafeRegex` no longer rejects `(`, `?` and `=` as literal members of a character class — `[(?=]` was read as a lookahead. The lookaround check is now `inClass`-aware like the rest of the scanner.
