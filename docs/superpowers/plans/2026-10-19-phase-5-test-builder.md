# Phase 5: Test Builder and Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an Admin something to publish — a test with an immutable `tst_` ID, slug, short link and QR code; sections drawing from fixed lists, random pools or sets; the registration form builder; timing, access, release and branding; the Draft → Scheduled → Open → Closed → Archived lifecycle with numbered frozen versions; clone; and whole-test `pariksha/test@1` export and import, gated by a publish checklist that states the measured fact.

**Architecture:** Three seams, and the discipline is in what each refuses to do. **The draft is the whole document** — a test's editable head is one `test_version` row with `published_at IS NULL` holding a complete `pariksha/test@1` settings object and sections array; publishing stamps `published_at` and freezes it, and blocks Phase 5 builds no editor for (`consent`, `proctoring`, `retention`) round-trip untouched rather than being dropped. **`@pariksha/core` already owns the test rules** — `validateTest` (`packages/core/src/validate.ts:455`) implements most of test-format.md's "Rules checked on import"; the rules it lacks are added *to it* by the task that builds the block they are about, and no route writes a second copy. **One publish gate, computed once, server-side** — `apps/api/src/publish/checklist.ts` decides; `GET …/checklist` renders its rows and `POST …/publish` re-runs it and refuses, so the screen and the gate cannot disagree.

**Tech Stack:** `qrcode-generator` 1.4 (MIT, ~12 KB, admin entry only) for T-02's QR code, plus what Phases 1–4 brought: Hono 4, Drizzle, `@cfworker/json-schema`, Zod 4, React 19, Vite, Vitest, Testing Library, `jest-axe`.

**Spec:** [`docs/PRD.md`](../../PRD.md#creating-and-configuring-tests) `T-01`–`T-24`, `AC-02`–`AC-04`, `AC-09`–`AC-11` · [`docs/test-format.md`](../../test-format.md) and [`schemas/test-1.json`](../../../schemas/test-1.json) · [`docs/ROADMAP.md`](../../ROADMAP.md#phase-5--test-builder-and-lifecycle) · [`docs/design.md`](../../design.md) `UX-10`–`UX-18`, screen inventory rows 6–12 · [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md), [ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md)

## Precondition

**Phase 5 starts from `main` with Phase 4 merged.** Everything this phase draws on — banks, the twelve question types, `question.ref_id`, the bank browser's filters, the shared Markdown renderer, `toQuestionDocument` / `toQuestionRow`, the all-or-nothing import, the UX-05 delete refusal — lives today only on branch `phase-4/bank-crud-and-browser` (tip `f4d4f7a`, under final whole-branch review). Every file path and line number below is that branch's, and becomes `main`'s on merge. **Do not start Task 2 before that merge**; Task 1 is documentation and may run ahead of it.

Phases 1–3 are consumed, never re-implemented: `can()` and `PERMISSIONS` (`packages/core/src/permissions.ts`); `assignSet`, `layoutForAttempt`, `matchesFilter`, `PoolTooSmallError` (`packages/core/src/select.ts`); `requires(action)` / `actorOr401` / `membershipOr404` (`apps/api/src/middleware/authorize.ts`); `appendAudit`; `scoped()` (`packages/db/src/repo/guard.ts`); `countingDeps` / `mountedRoutes` / `routeGuards` / `SUBREQUEST_LIMIT` (`apps/api/src/instrument.ts`); `apps/web/src/lib/api.ts` and `apps/web/src/routes/organiser.tsx`.

## Global Constraints

- Everything from Phases 1–4 holds: Node 22, pnpm, strict TypeScript, DCO sign-off on every commit, epoch-millisecond timestamps, one error envelope `{ "error": { "code", "message", "details"? } }`, 404-not-403 across workspaces.
- `tsconfig.base.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`. **`erasableSyntaxOnly` bans parameter properties.** `exactOptionalPropertyTypes` is why an optional patch field is built key-by-key, never spread with `undefined` — copy `filterFromQuery` in `apps/api/src/routes/questions.ts`.
- **Every route mounts under `/api/v1/workspaces/:id/…`, with one named exception.** `guard()` (`apps/api/src/middleware/authorize.ts`) reads `c.req.param("id")` and throws `"<path> is guarded but names no :id workspace parameter"` when absent, so a flat path cannot carry `requires(...)`, and resolving the workspace another way bypasses the `GUARDS` registry `apps/api/test/authorization.test.ts` enumerates in both directions. The exception is `GET /t/:code` (T-02), deliberately public and unguarded — Task 2.
- **The test path parameter is `:testId`, never `:id`.** `requires()` reads `c.req.param("testId")` and unions the actor's per-test grants into the check. Any other spelling silently drops `S-08`'s grants with nothing failing.
- **Budgets are measured, not declared.** Every route adds a line to `ROUTE_BUDGETS` (`apps/api/src/app.ts`) or `apps/api/test/budget.test.ts` fails, and every line is pinned with **`toBe`** — equal, not `toBeLessThanOrEqual`. Authentication alone costs a fixed 2 (`apps/api/src/auth/session.ts`), so no authenticated route that reads anything costs less than 3. The numbers in each task's route table are estimates; **the measurement wins and the table is edited to match it.**
- **The write path enforces only what must never reach storage regardless of draft state.** `UX-13`: "a section may be empty in Draft … the publish checklist is where emptiness becomes an error rather than a nag". Phase 4's precedent is `isSaveTimeIssue` (`apps/api/src/routes/questions.ts:79`). Each task states, per rule, save-time or publish-time. The default is publish-time.
- Tenant tables carry `workspace_id`; every repository function takes it first, goes through `scoped()`, and is reachable from `packages/db/src/repo/index.ts`, which `packages/db/test/repo/scoping.test.ts` enumerates. Pure mappers live in their own module (`packages/db/src/repo/question-document.ts` is the pattern) and are re-exported from `packages/db/src/index.ts` — a non-function export in `repo/index.ts` reads to that suite as an unguarded repository function.
- **Tests drive the production path.** Composing a mapper beside the real call site is false assurance; Phase 4 was sent back for it twice. Where Phase 5 has no runtime to drive (`AC-09`–`AC-11` need an attempt, which is Phase 6), the test reads the published version back through `getTestVersion` and hands it to `layoutForAttempt` / `assignSet` — the real composition, missing only the attempt row.
- **No hex colour literal in `apps/web/src`** outside the two generated token files, and **no `style={}` attribute in any `.tsx` there** — `apps/web/test/no-hex-colors.test.ts` enforces both, the second with `/\sstyle=\{/`, and also bans CSS-in-JS imports. The T-23 brand colour is user-supplied and reaches CSS through `element.style.setProperty("--brand-primary", value)` in an effect.
- **No third-party browser request** (`S-11`), CSP `default-src 'self'` (`apps/web/public/_headers`). QR is inline SVG; the logo is proxied by the API.
- **The candidate budget is 300 KB gzipped** and Phase 4 spent 41 KB. Phase 5 adds nothing to it: every component here is reachable only from the `admin` entry, pinned by extending `staticModules()` in `apps/web/test/bundle.test.ts`.
- Accessibility is a requirement, not a later pass (`O-04`, WCAG 2.1 AA): accessible name a superset of the visible label (WCAG 2.5.3), a `jest-axe` assertion per screen and per dialog, real key events wherever a test claims keyboard coverage, state as text plus glyph rather than colour alone.
- **Reordering is buttons-first.** `ReorderableList` (`apps/web/src/components/authoring/ReorderableList.tsx`) already ships move buttons, a numeric position field, focus retention and an `aria-live` announcement. Sections and form fields use it; neither grows a second control. Pointer drag stays Phase 4's deferral.
- **Everything is testable locally** — in-memory SQLite, the in-memory storage adapter, jsdom, and an injected `deps.http` for #58. No task may require a deployed Worker or a Cloudflare credential.

## Review Focus

1. **The UX-05 usage predicate going blind the moment a draft lives in `test_version`.** `TV_REFERENCES_Q_ROW` (`packages/db/src/repo/banks.ts:99-101`), `testsUsingQuestion` (`:165`) and `testsUsingBank` (`:188`) scan `test_version.sections_json` and **none filters on `published_at`**, because on Phase 4's branch every row is published — `publishTestVersion` is the only writer and always stamps it. Task 2 starts writing `published_at IS NULL` rows, and all three go wrong at once: an Author who adds a question to a *draft* test can no longer delete it from its bank, the refusal names a test nobody published, and the browser's "not used in any test" filter hides it. Phase 4's suite cannot catch it — `packages/db/test/repo/banks.test.ts` only ever inserts published versions. — Task 2, re-run by Task 10.
2. **`publishTestVersion` setting `status = "open"` unconditionally** (`packages/db/src/repo/tests.ts`). Wrong the moment `timing.opens_at` is in the future: `T-04`'s **Scheduled** state would never exist and a Phase 6 candidate reading `status` is told a test is open hours early. Invisible today because nothing reads `status`. — Task 10.
3. **A settings patch that merges where it must replace.** Switching `access.mode` from `link_code` to `sso` must drop `access_code`. The sibling case is caught for free — `$defs/sourcePool` and `$defs/sourceSets` carry `additionalProperties: false`, so a merged `sets` key inside a `pool` source fails the schema. **`access` is not**: `access_code` is a legal property of `access` under every mode, so a stale code survives, passes the schema, passes `validateTest` (whose rule fires only *when* the mode is `link_code`), publishes, and leaves the workspace inside an exported file. The proof is an **export** assertion, not a read-back of the patch. — Task 3 builds the merge; Task 8 owns the proof.
4. **A publish checklist computed twice.** The screen has every number it needs, so computing rows in the browser is the obvious move; then the server computes them again, slightly differently, and either an all-green checklist 422s on publish or a red row is not enforced — the second being worse, because it teaches organisers to ignore the list. — Task 12, and every task from 4 onward that adds a row.
5. **The short code scoped to a workspace.** Every tenant-table unique in `TABLE_MANIFEST` is composite with `workspace_id` (`test` already has `[["workspace_id","slug"]]`), so copying that shape is the natural move and is wrong: `/t/<code>` carries no workspace, two workspaces can hold one code, and `AC-02` fails silently on any instance with more than one workspace. — Task 2.
6. **The #58 reachability check as an SSRF pivot and an unbudgeted subrequest.** An outbound `fetch` is one subrequest against the same 50 the database shares; and on Docker (Phase 11) the same code runs inside someone's network, where `http://169.254.169.254/` is reachable and a redirect can walk to it from a URL that looked fine. — Task 6.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/adr/0007-review-comments-on-a-draft-test.md` | The #148 ADR (number: the next free one at execution time) |
| `packages/core/src/types.ts` | Modified: `timing`, `registration_form`, `consent`, `proctoring`, `retention`, `branding` on `Test` — the blocks its own header (`:187-193`) defers "until a phase needs it" |
| `packages/core/src/validate.ts` | Modified: the test-format.md import rules `validateTest` still lacks |
| `packages/core/src/contrast.ts` | `contrastRatio`, `meetsAA` — one copy, replacing the two in `apps/web/test` |
| `packages/db/src/schema/columns.ts` | Modified: `test.description`, `test.short_code`, `test.review_requested`, `test.updated_at`; `test_version.created_at`; the bare `short_code` unique |
| `packages/db/migrations/{sqlite,pg}/0004_*.sql` | The Phase 5 delta, generated for both dialects |
| `packages/db/src/repo/tests.ts` | Test and version reads and writes, the draft head, the lifecycle transitions |
| `packages/db/src/repo/test-document.ts` | `toTestDocument` / `toTestRecord` — the one place a `pariksha/test@1` document becomes rows; pure-mapper sibling of `repo/question-document.ts` |
| `packages/db/src/repo/banks.ts` | Modified: `published_at IS NOT NULL` on all three usage predicates |
| `apps/api/src/routes/tests.ts` | `/tests`, `/tests/:testId`, `/tests/:testId/draft`, and the lifecycle, clone, export, import, checklist and check-url routes |
| `apps/api/src/routes/shortlink.ts` | `GET /t/:code` — the one public unguarded route |
| `apps/api/src/index.ts` | Modified: hand `/t/` to the Worker, not the asset router |
| `apps/api/src/publish/checklist.ts` | The one publish gate |
| `apps/api/src/export/test.ts` | Rows → one `pariksha/test@1` document, row IDs translated back to the bank file's own |
| `apps/api/src/import/test.ts` | Schema, then `validateTest`, then one batch |
| `apps/api/src/net/reachable.ts` | T-19's server-side check and its refusals |
| `apps/web/src/routes/tests.tsx` | Screen 6 — test list |
| `apps/web/src/routes/test.tsx` | Screens 7, 9, 11, 12 — the builder shell |
| `apps/web/src/components/testbuilder/SectionList.tsx` | `UX-12`, `UX-13`, `UX-15`, `UX-16` — the spine |
| `apps/web/src/components/testbuilder/QuestionPickerDrawer.tsx` | Screen 8 — `UX-14` |
| `apps/web/src/components/testbuilder/SetsPanel.tsx` | T-09, T-10 |
| `apps/web/src/components/testbuilder/FormBuilder.tsx` | T-16 – T-18 |
| `apps/web/src/components/testbuilder/RegistrationForm.tsx` | **The one registration renderer.** The builder previews with it; Phase 6's candidate registration imports it |
| `apps/web/src/components/testbuilder/TimingPanel.tsx` | T-12 – T-15 |
| `apps/web/src/components/testbuilder/AccessPanel.tsx` | T-20, T-21 |
| `apps/web/src/components/testbuilder/ReleasePanel.tsx` | T-22 |
| `apps/web/src/components/testbuilder/BrandingPanel.tsx` | T-23, with the contrast gate |
| `apps/web/src/components/testbuilder/PublishChecklist.tsx` | Screen 11 — renders what the server computed |
| `apps/web/src/components/testbuilder/VersionBanner.tsx` | Screen 12 — `UX-18` |
| `apps/web/src/components/QrCode.tsx` | T-02, inline SVG, admin entry only |
| `apps/web/src/styles/testbuilder.css` | Builder styling, every value from tokens |
| `schemas/test-1.json` | Modified: `scoring.set_points_tolerance` (additive, within `@1`) |
</content>
