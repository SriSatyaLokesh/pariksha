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

1. **The UX-05 usage predicate going blind the moment a draft lives in `test_version`.** `TV_REFERENCES_Q_ROW` (`packages/db/src/repo/banks.ts:99-101`), `testsUsingQuestion` (`:165`) and `testsUsingBank` (`:185`) scan `test_version.sections_json` and **none filters on `published_at`**, because on Phase 4's branch every row is published — `publishTestVersion` is the only writer and always stamps it. Task 2 starts writing `published_at IS NULL` rows, and all three go wrong at once: an Author who adds a question to a *draft* test can no longer delete it from its bank, the refusal names a test nobody published, and the browser's "not used in any test" filter hides it. Phase 4's suite cannot catch it — `packages/db/test/repo/banks.test.ts` only ever inserts published versions. — Task 2, re-run by Task 11.
2. **`publishTestVersion` setting `status = "open"` unconditionally** (`packages/db/src/repo/tests.ts`). Wrong the moment `timing.opens_at` is in the future: `T-04`'s **Scheduled** state would never exist and a Phase 6 candidate reading `status` is told a test is open hours early. Invisible today because nothing reads `status`. — Task 11.
3. **A settings patch that merges where it must replace.** Switching `access.mode` from `link_code` to `sso` must drop `access_code`. The sibling case is caught for free — `$defs/sourcePool` and `$defs/sourceSets` carry `additionalProperties: false`, so a merged `sets` key inside a `pool` source fails the schema. **`access` is not**: `access_code` is a legal property of `access` under every mode, so a stale code survives, passes the schema, passes `validateTest` (whose rule fires only *when* the mode is `link_code`), publishes, and leaves the workspace inside an exported file. The proof is an **export** assertion, not a read-back of the patch. — Task 3 builds the merge; Task 8 owns the proof.
4. **A publish checklist computed twice.** The screen has every number it needs, so computing rows in the browser is the obvious move; then the server computes them again, slightly differently, and either an all-green checklist 422s on publish or a red row is not enforced — the second being worse, because it teaches organisers to ignore the list. Tasks 4–10 each *name* their publish-time rules; Task 11 creates `checklist.ts` carrying the blocking rows and makes `POST …/publish` refuse on them; Task 13 adds the advisory rows, the `GET …/checklist` route and the screen. — Tasks 11 and 13.
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
| `packages/db/src/repo/candidates.ts` | The candidate list: the rows Phase 6 mints invites against and matches registrations to |
| `apps/api/src/import/candidates.ts` | Candidate-list CSV → rows, with each issue's source line |
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

---

## Task 1: ADR — review comments on a draft test (#148, P5.0)

**Files:**
- Create: `docs/adr/0007-review-comments-on-a-draft-test.md` (the next free number at execution time; `docs/adr/README.md` ends at 0006)
- Modify: `docs/adr/README.md` (index row), `docs/design.md` (replace the "needs an ADR" entry at `:333-336` with the link), `docs/ROADMAP.md` (a fourth entry under "Decisions that extend the PRD")
- Test: `packages/core/test/permissions.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `PERMISSIONS`, `can()` (`packages/core/src/permissions.ts`).
- Produces: no code. The four decisions below are consumed by Task 2 (the `review_requested` column and badge) and Task 12 (export carries no comments).

**This ADR records a PRD extension, not an implementation of one.** The string "review comment" appears nowhere in `docs/PRD.md`; review on a draft test is `docs/design.md`'s own addition (`UX-10`, argued there as the one real gap its source case study exposes). So it belongs with the three entries under `docs/ROADMAP.md` § "Decisions that extend the PRD" — the public demo, BYOK drafting, and auth moving ahead of the candidate runtime — as a **fourth**, and is written the way those are: what is being added, and what it costs. Write that cost paragraph explicitly, covering the fourteenth permission action and its `AC-23` matrix row, the new table, and the retention and export obligations a row of one person's words about a colleague's work carries that a content row does not.

This is also the one task in the phase with no red step: the deliverable is a decision, and the test it leaves behind is a **pin** that passes on the day it is written. Say so in the test's own comment rather than manufacturing a failure.

The ADR answers the four questions [#148](https://github.com/SriSatyaLokesh/pariksha/issues/148) names. Write these decisions; the argument for each is given, and a reviewer should check the argument rather than the conclusion.

| Question | Decision | Why |
| --- | --- | --- |
| Export | **Comments never leave with the test.** `pariksha/test@1` gains no `comments` key | `docs/test-format.md` § Shape lists the document's keys and the format is explicitly portable into another installation (#63); `docs/design.md:335` proposes the same |
| Anchoring | A comment carries `anchor_kind` (`test` \| `section` \| `question`) and a nullable `anchor_id` | #148's own words — far cheaper now than to retrofit; `UX-10`'s reviewer points at something specific |
| Who may comment | A **fourteenth action, `tests.comment`**, held by Owner, Admin, Author and Reviewer — **added by the task that builds commenting, not by Phase 5** | `packages/core/src/permissions.ts` gives Reviewer no `tests.edit`, so the one role UX-10 exists for could not comment under any existing action. An action nothing enforces is a matrix row `apps/api/test/authorization.test.ts` cannot check, so it is not added early |
| Retention | Comments are organiser data: deleted with their test, untouched by the `S-13` retention job, and left attributed to the user ID when a member is removed (display name resolved at read time) | `S-13`/`S-14` are written around candidate data; `S-18`'s audit log is append-only and comments follow it, which also settles #148's last question — **resolving a thread is a state on the thread, never a deletion** |

The ADR states, in its Consequences, that Phase 5 ships only the `review_requested` flag and the "In review" badge (Task 2), and that the reviewers panel, the comment table and approvals are not built — see "Known deferrals".

- [ ] **Step 1: Write the pin**

```ts
// packages/core/test/permissions.test.ts — a pin, not a red test. ADR 0007
// decided the comment action is added by the task that builds commenting.
it("no permission action is about comments yet (ADR 0007)", () => {
  expect(ACTIONS).toHaveLength(13);
  expect(ACTIONS.filter((a) => a.includes("comment"))).toEqual([]);
});

it("ADR 0007: a Reviewer holds no tests.edit, which is why commenting needs its own action", () => {
  expect(can({ role: "reviewer", action: "tests.edit" })).toBe(false);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run packages/core/test/permissions.test.ts`
Expected: PASS. It pins the ADR rather than driving it.

- [ ] **Step 3: Write the ADR**

Copy `docs/adr/0000-template.md`. Record the four decisions above with their arguments, and the Consequences paragraph naming what Phase 5 does and does not ship.

- [ ] **Step 4: Update the index, design.md and the roadmap**

Add the row to `docs/adr/README.md`'s table with status Accepted. Replace `docs/design.md:333-336`'s "needs an ADR" entry with a link to it. Add a fourth entry to `docs/ROADMAP.md` § "Decisions that extend the PRD", in the shape the three already there use.

- [ ] **Step 5: Commit**

```bash
git add docs packages/core/test/permissions.test.ts
git commit -s -m "docs(adr): review comments on a draft test"
```

---

## Task 2: Test CRUD, IDs, slugs, short links and QR codes (#54, P5.1)

**Files:**
- Modify: `packages/db/src/schema/columns.ts`, `packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/pg.ts`, `packages/db/src/repo/tests.ts`, `packages/db/src/repo/banks.ts`, `packages/db/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/routes/organiser.tsx`, `apps/web/package.json`
- Create: `packages/db/src/repo/shortlink.ts`, `apps/api/src/routes/tests.ts`, `apps/api/src/routes/shortlink.ts`, `apps/web/src/routes/tests.tsx`, `apps/web/src/components/QrCode.tsx`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/db/test/parity.test.ts` (extend), `packages/db/test/repo/tests.test.ts`, `packages/db/test/repo/banks.test.ts` (extend), `apps/api/test/tests.test.ts`, `apps/web/test/testbuilder/test-list.test.tsx`, `apps/web/test/bundle.test.ts` (extend)
- Generated: `packages/db/migrations/{sqlite,pg}/0004_*.sql`, `packages/db/src/migrations.generated.ts`

**Interfaces:**
- Consumes: `scoped`, `newId`, `DbClient`, `TABLE_MANIFEST`, `ColumnSpec` (`packages/db`); `requires`, `actorOr401`, `appendAudit`, `ApiError`; `Test` (`@pariksha/core`); `ApiClient` (`apps/web/src/lib/api.ts`); `staticModules()` (`apps/web/test/bundle.test.ts`).
- Produces:
  ```ts
  // packages/db/src/repo/tests.ts — every function scoped(), workspaceId first
  export type TestStatus = "draft" | "published" | "closed" | "archived";
  export interface TestRow {
    id: string; slug: string; name: string; description: string | null;
    shortCode: string; status: TestStatus; currentVersion: number | null;
    reviewRequested: boolean; tags: string[]; createdAt: number; updatedAt: number;
  }
  export interface TestFilter { tag?: string; status?: TestStatus; search?: string; sort?: "name" | "updated" | "created" }
  export interface TestPatch { name?: string; slug?: string; description?: string; tags?: string[]; reviewRequested?: boolean }
  // packages/db/src/ids.ts (added beside newId, same alphabet and masking)
  export function newShortCode(): string;   // 6 characters

  export const createTest: ScopedFn<[input: { name: string; slug: string; now?: number }], TestRow>;
  export const getTest: ScopedFn<[testId: string], TestRow | null>;
  export const listTests: ScopedFn<[filter: TestFilter], TestRow[]>;
  export const updateTest: ScopedFn<[testId: string, patch: TestPatch, now: number], TestRow | null>;

  // packages/db/src/repo/shortlink.ts — NOT exported from repo/index.ts.
  // `/t/<code>` names no workspace, so this read sits outside the workspace
  // guard for the reason ADR 0006 gives, and follows repo/identity.ts, which
  // repo/index.ts likewise does not re-export.
  export function resolveShortCode(db: DbClient, code: string): Promise<{ workspaceSlug: string; testSlug: string } | null>;

  // apps/web/src/lib/api.ts
  // `state` is `status` verbatim in this task — Scheduled and Open do not
  // exist until Task 11 adds `deriveState`, which is where the route starts
  // mapping them. The wire type is declared whole here so no later task
  // renames a field the screens already read.
  export type TestState = "draft" | "scheduled" | "open" | "closed" | "archived";
  export interface TestSummary {
    id: string; name: string; slug: string; description: string | null;
    shortCode: string; state: TestState; currentVersion: number | null;
    draftVersion: number | null; reviewRequested: boolean; tags: string[]; updatedAt: number;
  }
  // on ApiClient:
  //   tests(filter?: TestFilter): Promise<TestSummary[]>
  //   createTest(input: { name: string; slug: string }): Promise<TestSummary>
  //   test(testId: string): Promise<TestSummary>
  //   updateTest(testId: string, patch: TestPatch): Promise<TestSummary>

  // apps/web/src/components/QrCode.tsx
  export function QrCode(props: { value: string; label: string; size?: number }): JSX.Element;
  ```

**Columns this task adds.** Everything else `test` and `test_version` need already exists from Phase 2.

| Table | Column | Class | Why |
| --- | --- | --- | --- |
| `test` | `description` | text, null | `pariksha/test@1` identity field; export round-trip |
| `test` | `short_code` | text | T-02's 6-character code. **Unique bare, not composite with `workspace_id`** — Review Focus 5 |
| `test` | `review_requested` | bool | `UX-10`'s badge, the only half of review Phase 5 ships (ADR 0007) |
| `test` | `updated_at` | timestamp, null | The test list's "last edited" column; null until the first edit, matching `question_bank.updated_at` |
| `test_version` | `created_at` | timestamp | A draft version has no `published_at`, so without this there is nothing to order versions by |

`short_code` is six characters from `packages/db/src/ids.ts`'s Crockford alphabet (`0123456789abcdefghjkmnpqrstvwxyz`, no `i`/`l`/`o`/`u`), minted with the same `crypto.getRandomValues` masking `newId` uses — read aloud down a phone line, it cannot be misheard as another valid code. Export a `newShortCode(): string` from `ids.ts` beside `newId`; `createTest` retries once on the unique violation.

**Review Focus 1 lands here.** `TV_REFERENCES_Q_ROW` (`packages/db/src/repo/banks.ts:99-101`), `testsUsingQuestion` (`:165`) and `testsUsingBank` (`:185`) each gain `AND tv.published_at IS NOT NULL`, because this task is the first to write a `test_version` row that is not published.

**Routes.** Guarded with `requires("tests.edit")`, including the reads: there is no `tests.view` in `packages/core/src/permissions.ts`, and Phase 4 set this precedent explicitly for banks in `apps/api/src/app.ts`'s `ROUTE_ACTIONS` comment, so a Viewer is 403 on all of these.

| Method | Path | Guard | Budget (estimate — measure and pin with `toBe`) |
| --- | --- | --- | --- |
| GET | `/api/v1/workspaces/:id/tests` | `tests.edit` | 4 |
| POST | `/api/v1/workspaces/:id/tests` | `tests.edit` | 5 |
| GET | `/api/v1/workspaces/:id/tests/:testId` | `tests.edit` | 4 |
| PATCH | `/api/v1/workspaces/:id/tests/:testId` | `tests.edit` | 6 |
| GET | `/t/:code` | none — public | 1 |

`POST /tests` creates the test row **and** its draft version 1 in one `db.batch`, so a test is never a row with no document. `GET /t/:code` is the one unguarded route: it resolves the code and 302s to `/<workspace-slug>/<test-slug>`, the public candidate URL T-02 defines, which Phase 6 will serve. `apps/api/src/index.ts`'s `if (!new URL(request.url).pathname.startsWith("/api/"))` must also let `/t/` through to the Worker, or the asset router answers it with `404.html` before Hono runs.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/parity.test.ts (extend)
it("the Phase 5 columns exist in both dialects", () => { /* test.description, short_code, review_requested, updated_at; test_version.created_at */ });
it("short_code is unique across the whole instance, not per workspace", async () => {
  await createTest(db, wsA, { name: "A", slug: "a" });            // code forced to "abc123" by the fixture
  await expect(insertTestRow(db, { workspaceId: wsB, shortCode: "abc123" })).rejects.toThrow(/unique|constraint/i);
});
```

```ts
// packages/db/test/repo/tests.test.ts
it("T-01: a new test gets a tst_ id, a draft status and a 6-character short code", async () => {
  const row = await createTest(db, ws, { name: "Midterm", slug: "midterm" });
  expect(row.id).toMatch(/^tst_/);
  expect(row.status).toBe("draft");
  expect(row.shortCode).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]{6}$/);
});
it("AC-02: three tests get three distinct ids and three distinct short codes", async () => { /* Set size 3 for each */ });
it("AC-02: a duplicate slug in the same workspace is rejected", async () => {
  await expect(createTest(db, ws, { name: "B", slug: "midterm" })).rejects.toThrow(/unique|constraint/i);
});
it("the same slug in another workspace is accepted", async () => { /* resolves */ });
it("T-01: the slug is editable while current_version is null and refused once it is set", async () => {
  expect(await updateTest(db, ws, id, { slug: "renamed" }, T)).toMatchObject({ slug: "renamed" });
  await publishDraftVersion(db, ws, id, T);                        // Task 11's function; stub the row in this task's fixture
  await expect(updateTest(db, ws, id, { slug: "again" }, T)).rejects.toThrow(/published/i);
});
it("S-09: a test in another workspace is not found", async () => { expect(await getTest(db, wsA, testInB)).toBeNull(); });
it("resolveShortCode answers the workspace and test slug, and null for an unknown code", async () => { /* both */ });

// Review Focus 1
it("a question referenced only by an unpublished draft version can still be deleted", async () => {
  await putDraftVersion(db, ws, testId, draftNaming(questionId), T);
  expect(await deleteQuestion(db, ws, bankId, questionId)).toEqual({ deleted: true, blockedBy: [] });
});
it("UX-05: the same reference in a published version still refuses the delete", async () => {
  expect(await deleteQuestion(db, ws, bankId, q2)).toEqual({ deleted: false, blockedBy: ["Midterm"] });
});
it("the bank browser's unused filter counts draft references as unused", async () => {
  expect((await listQuestions(db, ws, bankId, { unused: true })).rows.map((r) => r.id)).toContain(questionId);
});
```

```ts
// apps/api/test/tests.test.ts
it("POST /tests takes a name and a slug and answers 201 with the tst_ id", async () => { /* 201, id matches /^tst_/ */ });
it("a cross-workspace test is 404, not 403", async () => { /* 404 */ });
it("a Viewer cannot read the test list", async () => { /* 403 */ });
it("T-03: the list filters by tag, searches by name and sorts, in one query", async () => { /* ?tag=, ?search=, ?sort=name */ });
it("AC-02: GET /t/<code> redirects to /<workspace-slug>/<test-slug> and nothing else", async () => {
  const res = await app.request(`/t/${shortCode}`);               // no cookie
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/${workspaceSlug}/midterm`);
});
it("GET /t/<unknown> is 404 and names no workspace", async () => { /* 404, body has no wsp_ */ });
it("the short-link route is the only route with no guard", () => {
  expect(mountedRoutes(app).filter((r) => !(r in ROUTE_ACTIONS) && r.startsWith("/t"))).toEqual(["/t/:code"]);
});
it("measures the real subrequest cost of every route this task mounts", async () => { /* toBe against ROUTE_BUDGETS, per method */ });
```

```tsx
// apps/web/test/testbuilder/test-list.test.tsx
it("the list is a table with aria-sort on the sorted column", () => { /* columnheader Name has aria-sort="ascending" */ });
it("state and In review are text plus glyph, never colour alone", () => { /* getByText(/draft/i) inside the row, aria-hidden glyph beside it */ });
it("filters, tags and search live in the URL and survive the back button", async () => { /* history.pushState, popstate restores */ });
it("the locked slug is read-only, not disabled, and says why", () => {
  expect(screen.getByLabelText(/slug/i)).toHaveAttribute("readonly");
  expect(screen.getByLabelText(/slug/i)).not.toBeDisabled();
  expect(screen.getByText(/locked because this test has been published/i)).toBeVisible();
});
it("the QR code has a text alternative and the short link is reachable without it", () => {
  expect(screen.getByRole("img", { name: /qr code for the short link/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /\/t\// })).toBeVisible();
});
it("copying the short link confirms in a live region without moving focus", async () => {
  const button = screen.getByRole("button", { name: /copy short link/i });
  await userEvent.click(button);
  expect(screen.getByRole("status")).toHaveTextContent(/copied/i);
  expect(document.activeElement).toBe(button);
});
it("an empty workspace and a filter with no results are different states with different actions", () => { /* two distinct texts, two distinct buttons */ });
it("the test list has no axe violations", async () => { expect(await axe(container)).toHaveNoViolations(); });
```

```ts
// apps/web/test/bundle.test.ts (extend)
it("the QR generator is in the admin entry only", () => {
  expect(staticModules(twoEntryChunks, "island").join("\n")).not.toContain("qrcode-generator");
  expect(staticModules(twoEntryChunks, "admin").join("\n")).toContain("qrcode-generator");
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db apps/api/test/tests.test.ts apps/web/test/testbuilder apps/web/test/bundle.test.ts`
Expected: FAIL — the columns, `repo/tests.ts`'s new functions and the routes do not exist.

- [ ] **Step 3: Implement the schema delta, the repository, the routes and the list**

Add the five columns to `TABLE_MANIFEST` and both dialect files, generate each dialect's migration with `drizzle-kit`, then `pnpm --filter @pariksha/db migrations` to refresh the bundle. Follow `packages/db/src/repo/banks.ts` exactly: raw SQL through `db.query` / `db.run`, JSON through `db.jsonParam`, every export wrapped in `scoped()`. `listTests` resolves tag, search and sort as WHERE and ORDER BY clauses in one statement. `QrCode` calls `qrcode-generator` and emits one `<svg role="img">` with a `<title>`; no canvas, no data URI, so the CSP needs nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`, and `pnpm --filter @pariksha/db test` with `TEST_POSTGRES_URL` set.
Expected: PASS on both dialects, with `budget.test.ts` and `authorization.test.ts` green against their new entries.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): test crud with slugs, short links and qr codes"
```

---

## Task 3: Sections and question sources (#55, P5.2)

**Files:**
- Create: `packages/db/src/repo/test-document.ts`, `apps/web/src/components/testbuilder/SectionList.tsx`, `apps/web/src/components/testbuilder/QuestionPickerDrawer.tsx`, `apps/web/src/routes/test.tsx`
- Modify: `packages/db/src/repo/tests.ts`, `packages/db/src/index.ts`, `apps/api/src/routes/tests.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/db/test/repo/test-document.test.ts`, `apps/api/test/draft.test.ts`, `apps/web/test/testbuilder/sections.test.tsx`

**Interfaces:**
- Consumes: `getTest`, `createTest` (Task 2); `listQuestions`, `listBanks`, `QuestionRow`, `BankRow` (`packages/db/src/repo/banks.ts`); `validateTest`, `Section`, `QuestionSource`, `SourceFixed`, `SourcePool`, `SourceSets`, `Test` (`@pariksha/core`); `ReorderableList`, `RenderedHtml` (`apps/web/src/components/authoring/`).
- Produces — **CORRECTED after Task 3 shipped and was reviewed.** The block originally
  written here was wrong in ways Tasks 4–9 would each have hit: `workspaceId` was missing
  from `ApiClient.draft`/`patchDraft` and from the two components' props (nothing can reach
  the API without it, and every sibling method takes it first); `QuestionPickerDrawer` was
  implied to live inside `SectionList.tsx`; and three things it never named at all are
  listed below. Trust this block, not the original:

  ```ts
  // packages/db/src/repo/test-document.ts — as planned, no change
  export type TestSettings = Omit<Test, "$schema" | "format" | "name" | "slug" | "sections">;
  export type StoredSection = Section;
  export interface TestDocumentBody { settings: TestSettings; sections: StoredSection[] }
  export interface IdRefs {
    questionIdByRef: Map<string, string>; refByQuestionId: Map<string, string>;
    bankIdByFile: Map<string, string>;    fileByBankId: Map<string, string>;
  }
  export function toTestDocument(test: TestRow, body: TestDocumentBody, refs: IdRefs): Test;
  export function toStoredBody(doc: Test, refs: IdRefs): TestDocumentBody;

  // packages/db/src/repo/tests.ts — as planned, no change
  export interface TestVersionRow {
    id: string; testId: string; version: number;
    body: TestDocumentBody; publishedAt: number | null; createdAt: number;
  }
  export const getDraftVersion: ScopedFn<[testId: string], TestVersionRow | null>;
  export const putDraftVersion: ScopedFn<[testId: string, body: TestDocumentBody, now: number], TestVersionRow>;

  // packages/db/src/repo/banks.ts — NOT IN THE PLAN. Two new scoped reads the
  // draft route builds every derived number from; Tasks 4, 8 and 13 will want
  // both. Exported from @pariksha/db.
  export interface QuestionSummary {
    id: string; bankId: string; points: number;
    difficulty: Difficulty | null; tags: string[]; type: QuestionType;
  }
  export const workspaceQuestionSummaries: ScopedFn<[], QuestionSummary[]>;
  export const existingRowIds: ScopedFn<
    [ids: { questionIds: readonly string[]; bankIds: readonly string[] }],
    { questionIds: Set<string>; bankIds: Set<string> }
  >;

  // @pariksha/core — NOT IN THE PLAN. matchesFilter is now public.
  export function matchesFilter(question: Question, filter: PoolFilter | undefined): boolean;
  // After fix 5 below, this becomes:
  // export function matchesFilter(q: Pick<Question, "tags" | "difficulty" | "type">, filter?: PoolFilter): boolean;

  // apps/web/src/lib/api.ts — mirrors of the db types (this package never
  // imports @pariksha/db), plus the wire shapes.
  export type TestSettings = Omit<Test, "$schema" | "format" | "name" | "slug" | "sections">;
  export type StoredSection = Section;
  export interface TestDocumentBody { settings: TestSettings; sections: StoredSection[] }
  export interface TestVersionRow {
    id: string; testId: string; version: number;
    body: TestDocumentBody; publishedAt: number | null; createdAt: number;
    // present on GET only; see Interfaces note 1 — split these out
    draw?: Record<string, { matching: number; wanted: number }>;
    setPoints?: Record<string, { set: string; points: number }[]>;
    points?: Record<string, number>;
  }
  export interface DraftPatch { settings?: Partial<TestSettings>; sections?: StoredSection[] }

  // on ApiClient — workspaceId FIRST, as every sibling method takes it:
  draft(workspaceId: string, testId: string): Promise<TestVersionRow>;
  patchDraft(workspaceId: string, testId: string, patch: DraftPatch): Promise<TestVersionRow>;

  // apps/web/src/components/testbuilder/SectionList.tsx
  export function SectionList(props: {
    sections: readonly StoredSection[];
    draw: Readonly<Record<string, { matching: number; wanted: number }>>;
    setPoints: Readonly<Record<string, { set: string; points: number }[]>>;
    points: Readonly<Record<string, number>>;          // additive — UX-12's collapsed-row figure
    onChange: (next: StoredSection[]) => void;
    openSectionId: string | null;
    onOpenSection: (id: string | null) => void;
    client: ApiClient;                                  // additive — bank <select>
    workspaceId: string;                                // additive
  }): JSX.Element;

  // apps/web/src/components/testbuilder/QuestionPickerDrawer.tsx  ← its OWN module,
  // not SectionList.tsx as the plan's Interfaces block implies
  export function QuestionPickerDrawer(props: {
    bankId: string | null; selected: readonly string[];
    onConfirm: (questionIds: string[]) => void; onCancel: () => void;
    client: ApiClient; workspaceId: string;             // additive
  }): JSX.Element;

  // apps/web/src/routes/test.tsx — NOT IN THE PLAN, and the shell Tasks 5, 7,
  // 8, 10, 11 and 13 all mount their panel into.
  export function TestBuilder(props: {
    workspaceId: string; testId: string; client: ApiClient;
    actorEmail: string; onSignOut: () => void; onBack: () => void;
  }): JSX.Element;

  // apps/web/src/routes/tests.tsx — TestList grew one prop
  onOpenTest: (testId: string) => void;
  ```

  Routes, for the six tasks that add none of their own:

  ```
  GET   /api/v1/workspaces/:id/tests/:testId/draft    tests.edit   budget 7 (GET measures 4)
  PATCH /api/v1/workspaces/:id/tests/:testId/draft    tests.edit   budget 7 (settings-only 6)
  ```
  `GET` returns `TestVersionRow` **plus** `draw`, `setPoints` and `points`;
  `PATCH` returns `TestVersionRow` alone. `PATCH` replaces `settings`
  one level deep (a named key's whole value is replaced; an unnamed key is
  untouched) and replaces `sections` wholesale.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/repo/test-document.test.ts
it("a test document round-trips through the stored body for all three source kinds", () => {
  expect(toTestDocument(testRow, toStoredBody(exampleTest, refs), refs)).toEqual(exampleTest);
});
it("sections name qst_ and bnk_ row ids in storage and the bank file's own ids in the document", () => {
  const body = toStoredBody(exampleTest, refs);
  expect(JSON.stringify(body.sections)).toContain("qst_");
  expect(JSON.stringify(body.sections)).not.toContain("LOG-001");
  expect(toTestDocument(testRow, body, refs).sections[1].source.sets[0].questions).toEqual(["LOG-001", "LOG-003", "LOG-005", "LOG-007"]);
});
it("a block Phase 5 has no editor for survives the round trip untouched", () => {
  expect(toTestDocument(testRow, toStoredBody(exampleTest, refs), refs).proctoring)
    .toEqual(exampleTest.proctoring);   // also consent, retention
});
```

```ts
// apps/api/test/draft.test.ts
it("UX-13: a section with no questions saves in Draft", async () => { /* 200 */ });
it("a section whose source kind changes is replaced, not merged", async () => {
  await patchDraft({ sections: [{ ...section, source: { kind: "sets", assignment: "round_robin", sets } }] });
  await patchDraft({ sections: [{ ...section, source: { kind: "pool", bank: bankId, count: 4 } }] });
  expect(JSON.stringify((await draft()).body.sections)).not.toContain("round_robin");
});
it("patching one settings block leaves the others untouched", async () => { /* access changed, timing identical */ });
it("a fixed source naming a question in another workspace is 422 with the field named", async () => {
  expect((await patch({ sections: [fixedNaming(questionInOtherWorkspace)] })).status).toBe(422);
});
it("UX-15: the draft reports the live draw per pool section", async () => {
  expect((await draft()).draw["quant"]).toEqual({ matching: 14, wanted: 10 });
});
it("UX-16: the draft reports each set's total points", async () => {
  expect((await draft()).setPoints["reasoning"]).toEqual([{ set: "A", points: 8 }, { set: "B", points: 8 }]);
});
it("the draw costs one query however many pool sections there are", async () => {
  const { counts } = await withCountingDeps(() => draft(testWithTenPoolSections));
  expect(counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/draft"]);
});
it("measures the real subrequest cost of GET and PATCH draft", async () => { /* toBe */ });
```

```tsx
// apps/web/test/testbuilder/sections.test.tsx
it("UX-12: a collapsed section reads title, source, question count, points and time", () => {
  expect(screen.getByRole("button", { name: /Quantitative aptitude · pool · 4 questions · 8 points · 15 min/i })).toBeVisible();
});
it("sections reorder by keyboard and the new position is announced", async () => {
  screen.getByRole("button", { name: /move section Quantitative aptitude down/i }).focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("status")).toHaveTextContent(/moved to position 2 of 3/i);
});
it("UX-15: a shortfall states the number short, in text plus glyph", () => {
  expect(screen.getByText(/3 short — needs 10, 7 match/i)).toBeVisible();
});
it("UX-16: the balance strip has a table equivalent, not only bars", () => {
  expect(within(screen.getByRole("table", { name: /points per set/i })).getByText("8")).toBeVisible();
});
it("switching a section's source warns before discarding a configured pool", async () => {
  await userEvent.selectOptions(screen.getByLabelText(/source/i), "fixed");
  expect(screen.getByRole("dialog")).toHaveTextContent(/pool.*count.*filter/is);
});
it("deleting a section confirms and offers undo", async () => { /* dialog, then role=status with an Undo button */ });
it("the open section is in the URL, so a reload returns to it", () => { /* ?section=quant */ });
it("UX-14: the picker is a drawer over the builder, with the bank browser's filters and a running footer", async () => {
  expect(screen.getByRole("dialog", { name: /add questions/i })).toBeVisible();
  expect(screen.getByText(/12 selected · 24 points/i)).toBeVisible();
  expect(screen.getByRole("heading", { name: /sections/i })).toBeVisible();   // builder still behind it
});
it("the collapsed row stays readable at 400 px", () => { /* no horizontal overflow at 400px */ });
it("the section list and the picker drawer have no axe violations", async () => { /* both */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db/test/repo/test-document.test.ts apps/api/test/draft.test.ts apps/web/test/testbuilder/sections.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the mappers, the draft routes and the section spine**

`toStoredBody` and `toTestDocument` are pure and take `IdRefs` rather than a `DbClient` — the route builds the maps from one `listQuestions` and one `listBanks` call, which is also what keeps the budget flat. `draw` is one `SELECT bank_id, difficulty, tags_json, type FROM question WHERE workspace_id = ?` grouped in memory against each pool filter through `matchesFilter` from `@pariksha/core`, so the builder's count and the engine's draw use the same arithmetic. `SectionList` renders each section through `ReorderableList`; the collapsed row is one `<button>` whose accessible name is the UX-12 sentence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): sections with fixed, pool and set sources"
```

---

## Task 4: Set assignment and shuffle configuration (#56, P5.3)

**Files:**
- Create: `apps/web/src/components/testbuilder/SetsPanel.tsx`
- Modify: `schemas/test-1.json` (`scoring.set_points_tolerance`), `packages/core/src/types.ts` (`TestScoring.set_points_tolerance`), `apps/api/src/routes/tests.ts` (accept it in the patch), `apps/web/src/components/testbuilder/SectionList.tsx`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/core/test/select.test.ts` (extend), `apps/api/test/selection.test.ts`, `apps/web/test/testbuilder/sets.test.tsx`

**Interfaces:**
- Consumes: `assignSet`, `layoutForAttempt`, `SetAssignment`, `SourceSets`, `Section` (`packages/core/src/select.ts`, `types.ts`); `getPublishedVersion` (Task 11 — in this task's fixtures, read the draft through `getDraftVersion` and publish it with the Task 11 stub); `SectionList` (Task 3); `DraftPatch` (Task 3).
- Produces:
  ```ts
  // packages/core/src/types.ts (added to TestScoring)
  //   set_points_tolerance?: number;   // points; default 0 (any difference reported)
  // apps/web/src/components/testbuilder/SetsPanel.tsx
  export function SetsPanel(props: {
    source: SourceSets;
    shuffleQuestions: boolean;
    onChange: (next: { source: SourceSets; shuffleQuestions: boolean }) => void;
  }): JSX.Element;
  export const ASSIGNMENT_CONSEQUENCE: Readonly<Record<SetAssignment, string>>;
  ```

This task adds **no route**: assignment and shuffling are fields of a section's `source` and of `settings.scoring`, written through Task 3's `PATCH …/draft`. If accepting them changes that route's measured cost, update its `ROUTE_BUDGETS` number and its `toBe` in the same commit.

`ASSIGNMENT_CONSEQUENCE` is the one-line consequence each strategy carries as persistent helper text, and the exact copy is fixed here because it is the whole point of #56's design note:

| Key | Copy |
| --- | --- |
| `round_robin` | "By registration order, so candidates sitting next to each other get different sets." |
| `random` | "A different set per registration, not tied to the candidate." |
| `hash` | "From the candidate's ID, so the same candidate always gets the same set across attempts." |
| `from_candidate_list` | "From the `set` column of the uploaded candidate list. A candidate whose row has no set cannot start, and the publish checklist says so." |

**Shuffle is two controls, not three** — see the ruling. The group carries a legend and three rows: one switch (`section.shuffle_questions`) and two statements of fact, that answer-option order is per question (`shuffle_options`, authored in the Phase 4 editor) and that `ordering` items always shuffle for the candidate whatever these say (`UX-08`).

**All publish-time.** No rule here blocks a save: a `sets` source with one set, or with sets of unequal points, is an ordinary half-built draft.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/selection.test.ts — driven through the stored version, not through a hand-built Section
it("AC-09: 5 sets, round robin, 50 registrations — 10 each, and no two consecutive the same", async () => {
  const version = await getPublishedVersion(db, ws, testId);
  const sets = version.body.sections[0].source.sets.map((s) => s.set);
  const got = Array.from({ length: 50 }, (_, i) =>
    assignSet({ sets, assignment: "round_robin", registrationIndex: i, candidateId: `cnd_${i}` }));
  expect(countBy(got)).toEqual({ A: 10, B: 10, C: 10, D: 10, E: 10 });
  expect(got.some((s, i) => i > 0 && s === got[i - 1])).toBe(false);
});
it("hash assignment is stable across attempts for one candidate", () => { /* two calls, differing registrationIndex, same set */ });
it("from_candidate_list uses the listValue and throws without one", () => { /* both */ });
it("AC-10: a pool section draws `count` distinct questions matching the filter, per candidate", async () => {
  const layout = layoutForAttempt({ sections: version.body.sections, bank, seed: "cnd_1", setNo: "A" });
  const drawn = layout.sections[0].questionIds;
  expect(new Set(drawn).size).toBe(10);
  expect(drawn.every((id) => byId.get(id).tags.includes("sql") && byId.get(id).difficulty === "medium")).toBe(true);
});
it("AC-11: two candidates on the same set get different question and option orders", () => { /* two seeds, orders differ */ });
it("AC-11: a pinned option (shuffle_options false) stays in place for both", () => { /* equal arrays */ });
it("T-10: shuffle_questions false keeps the authored order", () => { /* identical to source.questions */ });
```

```tsx
// apps/web/test/testbuilder/sets.test.tsx
it("each strategy carries its consequence as persistent helper text, not a tooltip", () => {
  for (const [key, copy] of Object.entries(ASSIGNMENT_CONSEQUENCE)) {
    expect(screen.getByRole("radio", { name: new RegExp(key.replace(/_/g, " "), "i") })).toBeVisible();
    expect(screen.getByText(copy)).toBeVisible();
  }
});
it("from the candidate list states what happens to a row with no set", () => {
  expect(screen.getByText(/cannot start, and the publish checklist says so/i)).toBeVisible();
});
it("the shuffle controls are one group with a legend", () => {
  expect(screen.getByRole("group", { name: /shuffling/i })).toBeVisible();
});
it("UX-08: ordering items are stated to shuffle regardless of these switches", () => {
  expect(screen.getByText(/ordering questions always shuffle their items/i)).toBeVisible();
});
it("only the chosen strategy's own options are shown", async () => { /* round_robin shows no list column picker */ });
it("the sets panel has no axe violations", async () => { expect(await axe(container)).toHaveNoViolations(); });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/selection.test.ts apps/web/test/testbuilder/sets.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add `set_points_tolerance` and implement `SetsPanel`**

Add `set_points_tolerance` (`number`, `minimum: 0`, default 0) to `$defs/scoring` in `schemas/test-1.json` and to `TestScoring` — additive within `@1`, which `docs/test-format.md` § Versioning allows. Thread it into `validateTest`'s existing `options.setPointsTolerance` parameter rather than adding a second path. `SetsPanel` is radios plus `ASSIGNMENT_CONSEQUENCE` beneath each; no strategy's own fields render unless it is chosen.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core apps/api apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add schemas packages apps
git commit -s -m "feat(tests): set assignment strategies and shuffle configuration"
```

---

## Task 5: Registration form builder (#57, P5.4)

> **Correction, applied while building Task 5.** This task labels the unsatisfiable-validation
> rule (`min > max`, and friends) *save-time*. That is wrong and the label is withdrawn: it is
> a **publish-time** rule with a live author-facing message, which is what shipped.
> The draft write path's gate is the derived JSON schema, which cannot express `min <= max`,
> and the standing ruling for this phase is that the write path enforces only what must never
> reach storage regardless of draft state. A half-typed numeric range is ordinary authoring —
> the author sees `unsatisfiableValidation`'s sentence live in the builder, and the publish
> checklist (Task 13) is where it blocks. Do **not** make the draft route call `validateTest`
> to manufacture a 422.

**Files:**
- Create: `apps/web/src/components/testbuilder/FormBuilder.tsx`, `apps/web/src/components/testbuilder/RegistrationForm.tsx`
- Modify: `packages/core/src/types.ts`, `packages/core/src/validate.ts`, `packages/core/src/index.ts`, `apps/web/src/routes/test.tsx`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/core/test/validate-test.test.ts` (extend), `apps/web/test/testbuilder/form-builder.test.tsx`

**Interfaces:**
- Consumes: `validateTest`, `ImportIssue` (`packages/core/src/validate.ts`); `ReorderableList`; `DraftPatch` (Task 3).
- Produces:
  ```ts
  // packages/core/src/types.ts — mirrors schemas/test-1.json $defs/form,
  // $defs/formField and $defs/validation exactly
  export const FORM_FIELD_TYPES = ["short_text","long_text","email","phone","number","date","dropdown","radio","checkbox","url","consent"] as const;
  export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
  export interface FieldValidation {
    min_length?: number; max_length?: number; pattern?: string; pattern_message?: string;
    min?: number | string; max?: number | string; integer?: boolean; decimals?: number;
    allowed_domains?: string[]; default_country?: string; check_reachable?: boolean;
    link_text?: string; link_target?: string;
  }
  export interface FormField {
    id: string; type: FormFieldType; label: string; help?: string;
    required?: boolean; unique?: boolean; options?: string[]; validation?: FieldValidation;
  }
  export interface RegistrationFormSpec { title?: string; description?: string; fields: FormField[] }
  // added to Test: registration_form?: RegistrationFormSpec;
  // Named ...Spec, not ...Form, so the core type and the React component of
  // the same job do not share a name across two packages.

  // packages/core/src/validate.ts — new rules inside validateTest, not a new function
  // apps/web/src/components/testbuilder/RegistrationForm.tsx — the ONE renderer
  export function RegistrationForm(props: {
    form: RegistrationFormSpec;
    values: Readonly<Record<string, unknown>>;
    errors: Readonly<Record<string, string>>;
    onChange: (id: string, value: unknown) => void;
    disabled?: boolean;
  }): JSX.Element;
  export const FIELD_INPUT: Readonly<Record<FormFieldType, { type: string; autocomplete: string; inputMode?: string }>>;
  export const FORM_TEMPLATES: Readonly<Record<"campus_hiring" | "course_exam" | "open_contest", RegistrationFormSpec>>;
  ```

`RegistrationForm.tsx` is **the one renderer**, the same structure [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md) gave Markdown: the builder's preview imports it today and Phase 6's candidate registration imports it next, so the preview cannot drift from what a candidate sees. It takes `values`/`errors` from its caller and owns no submission.

`FIELD_INPUT` is the table #57 asks to be true per type, and the values are fixed here so the test can assert them: `short_text` → `text`/`name`; `long_text` → textarea/`off`; `email` → `email`/`email`; `phone` → `tel`/`tel`, `inputMode: "tel"`; `number` → `number`/`off`, `inputMode: "decimal"`; `date` → `date`/`bday` where the label matches a birth date, else `off`; `url` → `url`/`url`; `dropdown`/`radio`/`checkbox`/`consent` → no autocomplete token.

`FORM_TEMPLATES` carries T-18's three templates verbatim: *Campus hiring* (name, email, phone, college, roll number, degree, graduation year, CGPA, resume link, LinkedIn, GitHub), *Course exam* (name, student ID, email), *Open contest* (name, email, country). `examples/reasoning-aptitude/test.json`'s `registration_form` is the worked reference for field shapes.

**Rules added to `validateTest`** — two of `docs/test-format.md` § "Rules checked on import" that it does not yet carry, both **publish-time** (an organiser mid-build may legitimately have two fields called `email` for a second):

- form field IDs are unique within the test (and so are section IDs — the same loop, the other half of the same rule line)
- every `options` list belongs to a `dropdown`, `radio` or `checkbox` field

**Publish-time, with a live author-facing message** (the correction at the head of this task) is the one rule whose breach is not a half-built form: an unsatisfiable `validation`, because it silently refuses every candidate at registration and nothing before Phase 6 would surface it. Three shapes, all through `unsatisfiableValidation`: `min` above `max`, `max_length` below `min_length`, and a `pattern` `assertSafeRegex` refuses — #57's acceptance row names that third one ("a regex matching nothing allowed is caught in the builder with cause and fix") and the task 5/6 review found it missing (M3). It reports `field: "registration_form"` with the field's `id` in the message.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/validate-test.test.ts (extend)
it("duplicate form field ids are reported with the field named", () => {
  const r = validateTest(testWithDuplicateFieldId, bank);
  expect(r.ok).toBe(false);
  expect(r.issues[0]).toMatchObject({ field: "registration_form.fields", index: -1, message: expect.stringMatching(/"email".*more than once/) });
});
it("duplicate section ids are reported", () => { /* field: "sections" */ });
it("an options list on a short_text field is reported", () => {
  expect(validateTest(testWithOptionsOnShortText, bank).issues[0]).toMatchObject({ field: "registration_form.fields" });
});
it("min above max is reported", () => { /* message names the field id */ });
it("the worked example validates clean", () => { expect(validateTest(exampleTest, exampleQuestions).ok).toBe(true); });
```

```tsx
// apps/web/test/testbuilder/form-builder.test.tsx
it("all eleven field types can be added", async () => {
  for (const type of FORM_FIELD_TYPES) { await addField(type); }
  expect(screen.getAllByRole("group", { name: /field/i })).toHaveLength(11);
});
it("the preview is the candidate renderer, including its validation messages", async () => {
  await userEvent.type(within(preview()).getByLabelText(/roll number/i), "nope");
  await userEvent.tab();
  expect(within(preview()).getByText("Format: 21CS0147 — two digits, two letters, four digits.")).toBeVisible();
});
it("the builder cannot produce a placeholder-only field", () => {
  expect(screen.getByLabelText(/visible label/i)).toBeRequired();
  expect(within(preview()).getByText(/^Full name/)).toBeVisible();
});
it("every field type sets the right input type and autocomplete token in the preview", () => {
  for (const [type, spec] of Object.entries(FIELD_INPUT)) { /* assert type and autocomplete on the rendered input */ }
});
it("required is marked in the preview, not only in the editor", () => { /* aria-required and a visible marker */ });
it("the unique flag states its effect in one line", () => {
  expect(screen.getByText("A second registration with the same value is refused.")).toBeVisible();
});
it("validation that cannot be satisfied is caught in the builder with cause and fix", async () => {
  await userEvent.type(screen.getByLabelText(/minimum/i), "10");
  await userEvent.type(screen.getByLabelText(/maximum/i), "5");
  expect(await screen.findByRole("alert")).toHaveTextContent(/minimum 10 is above maximum 5 — lower the minimum/i);
});
it("fields reorder by keyboard and announce the new position", async () => { /* ReorderableList, real {Enter} */ });
it("applying a template over existing fields confirms first, and names what is replaced", async () => {
  await userEvent.click(screen.getByRole("button", { name: /campus hiring/i }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/replace the 3 fields you have/i);
});
it("the builder and the preview have no axe violations", async () => { /* both containers */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/core/test/validate-test.test.ts apps/web/test/testbuilder/form-builder.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the types, the rules, the renderer and the builder**

Add the types to `packages/core/src/types.ts` under the header comment at `:187-193` that defers them "until a phase needs it", and export them from `index.ts`. The new rules go inside `validateTest`'s existing body and push onto its existing `issues` array, so the whole report still arrives at once. `RegistrationForm` renders a native control per type — `<input type="date">`, `<select>`, `<input type="tel">` — and loads nothing: a country-code picker is a `<select>` of dialling codes, not a dependency.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): registration form builder with the shared candidate renderer"
```

---

## Task 6: URL field reachability check (#58, P5.5)

**Files:**
- Create: `apps/api/src/net/reachable.ts`
- Modify: `apps/api/src/routes/tests.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/testbuilder/FormBuilder.tsx`
- Test: `apps/api/test/reachable.test.ts`, `apps/web/test/testbuilder/url-check.test.tsx`

**Interfaces:**
- Consumes: `AppDeps.http` (`apps/api/src/app.ts` — already injected and already optional, added in Phase 3 for OIDC), `deps.now`, `requires("tests.edit")`, `FormBuilder` (Task 5).
- Produces:
  ```ts
  // apps/api/src/net/reachable.ts
  export type ReachState = "reachable" | "unverified" | "timeout" | "refused";
  export interface ReachResult { state: ReachState; status: number | null; reason?: string; checkedAt: number }
  export const REACH_TIMEOUT_MS = 5000;
  export function checkReachable(http: typeof globalThis.fetch, url: string, now: () => number): Promise<ReachResult>;

  // apps/web/src/lib/api.ts — on ApiClient
  //   checkUrl(testId: string, url: string): Promise<ReachResult>
  ```

| Method | Path | Guard | Budget (estimate — measure and pin) |
| --- | --- | --- | --- |
| POST | `/api/v1/workspaces/:id/tests/:testId/check-url` | `tests.edit` | 4 |

Four: authentication's 2, the `getTest` existence check, and **one outbound `fetch`**, which is a subrequest on Workers exactly as a D1 query is. `countingDeps` counts the database and storage adapters, not `deps.http`, so this task extends it to wrap `http` too — otherwise the one call this route exists to make is the one call the budget cannot see.

**Review Focus 6 is this task's whole shape.** `checkReachable` refuses before it fetches:

| Input | Result |
| --- | --- |
| scheme other than `http:` / `https:` | `refused`, reason "only http and https links can be checked" |
| host that parses as an IPv4 or IPv6 literal, or is `localhost` / ends in `.localhost` / `.internal` | `refused`, reason "a link to a network address cannot be checked" |
| anything else | `HEAD` with `redirect: "manual"`, `AbortSignal.timeout(REACH_TIMEOUT_MS)` |
| 405 on `HEAD` | retried once with `GET`; the body is never read |
| 200 | `reachable` |
| any other status, or a 3xx | `unverified` with the status |
| abort | `timeout`, which the UI reports as a timeout with a retry, never as unreachable |

Nothing here blocks anything: the result is advisory, is never stored on the field, and `POST …/check-url` 200s with the result even when the result is `refused`. T-19's "flag it as unverified" is a thing the organiser sees, not a thing the server enforces — **no rule from this task appears in the publish checklist.**

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/reachable.test.ts — deps.http is a stub; no network in any case
it.each([
  ["file:///etc/passwd", "only http and https"],
  ["ftp://example.com", "only http and https"],
  ["http://127.0.0.1:5432/", "network address"],
  ["http://169.254.169.254/latest/meta-data/", "network address"],
  ["http://localhost/", "network address"],
  ["http://[::1]/", "network address"],
])("refuses %s without fetching", async (url, reason) => {
  const http = vi.fn();
  expect(await checkReachable(http, url, () => T)).toMatchObject({ state: "refused", reason: expect.stringContaining(reason) });
  expect(http).not.toHaveBeenCalled();
});
it("a 200 is reachable and the body is never read", async () => {
  const body = { getReader: vi.fn() };
  expect(await checkReachable(okWithBody(body), "https://example.com/cv.pdf", () => T)).toMatchObject({ state: "reachable", status: 200, checkedAt: T });
  expect(body.getReader).not.toHaveBeenCalled();
});
it("a 404 is unverified with the status, not an error", async () => { /* state "unverified", status 404 */ });
it("a redirect is not followed and is unverified", async () => { /* redirect: "manual" passed; state "unverified", status 302 */ });
it("a HEAD rejected with 405 is retried once with GET and no third call", async () => { /* http called exactly twice */ });
it("an abort is a timeout, not unreachable", async () => { /* state "timeout" */ });
it("the route answers 200 with the result even when the result is refused", async () => { /* 200 */ });
it("a Viewer cannot call check-url", async () => { /* 403 */ });
it("measures the real subrequest cost of check-url, counting the outbound fetch", async () => {
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/check-url"]);
});
```

```tsx
// apps/web/test/testbuilder/url-check.test.tsx
it("the three states are text plus glyph, and unverified never reads as invalid", async () => {
  expect(screen.getByText(/not checked/i)).toBeVisible();
  await check("unverified");
  expect(screen.getByText(/unverified — the link did not return 200/i)).toBeVisible();
  expect(screen.queryByText(/invalid/i)).toBeNull();
});
it("the check shows it is running", async () => { /* role=status, /checking/i, while the promise is pending */ });
it("a timeout reports a timeout with a retry, not unreachable", async () => {
  expect(screen.getByText(/timed out/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /check again/i })).toBeEnabled();
});
it("the result says when it was checked", () => { expect(screen.getByText(/checked at /i)).toBeVisible(); });
it("an unverified result blocks nothing — the draft still saves", async () => { /* save button enabled */ });
it("the url field row has no axe violations", async () => { /* axe */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/reachable.test.ts apps/web/test/testbuilder/url-check.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `checkReachable`, the route and the field affordance**

Parse with `new URL()` and refuse on the table above before the first `fetch`. The literal-address test is a regex over `url.hostname` for IPv4 dotted quads and bracketed IPv6 plus the three name suffixes — a DNS lookup is not available on Workers and is not attempted, so a hostname that *resolves* to a private address is out of scope and is named as such in a `ponytail:` comment with its upgrade path (resolve and check at the Node entry, Phase 11). Extend `countingDeps` in `apps/api/src/instrument.ts` to wrap `deps.http`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api apps/web`
Expected: PASS, with `budget.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add apps
git commit -s -m "feat(tests): server-side url reachability check for registration fields"
```

---

## Task 7: Timing, navigation and attempt policy (#59, P5.6)

> **Warning, added after Task 3 shipped.** Making `timing` required on `TestSettings`
> breaks four places that assume it is optional, and all four must change in this task:
> `toTestVersionRow` and `toTestDocument`'s spread (`packages/db/src/repo/test-document.ts`),
> `apps/api/test/draft.test.ts:146`, and `createTest`'s `{}` settings seed
> (`packages/db/src/repo/tests.ts`). Decide deliberately whether `timing` becomes required
> at all — a draft legitimately has no timing yet, and the save path enforces only what must
> never reach storage, so the publish checklist is the natural place for the requirement.

**Files:**
- Create: `apps/web/src/components/testbuilder/TimingPanel.tsx`
- Modify: `packages/core/src/types.ts`, `packages/core/src/validate.ts`, `packages/core/src/index.ts`, `apps/web/src/routes/test.tsx`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/core/test/validate-test.test.ts` (extend), `apps/web/test/testbuilder/timing.test.tsx`

**Interfaces:**
- Consumes: `validateTest`, `Test` (`@pariksha/core`); `DraftPatch` (Task 3); `StoredSection` (Task 3, for the per-section duration sum).
- Produces:
  ```ts
  // packages/core/src/types.ts — mirrors schemas/test-1.json $defs/timing exactly
  export type NavigationMode = "free" | "linear" | "per_section";
  export type CountedAttempt = "highest" | "latest" | "average";
  export interface TestTiming {
    timezone?: string; opens_at?: string; closes_at?: string; latest_start_at?: string;
    duration_minutes: number; navigation?: NavigationMode;
    attempts_allowed?: number; cooldown_minutes?: number; counted_attempt?: CountedAttempt;
    warn_at_minutes?: number[]; late_sync_grace_seconds?: number;
  }
  // added to Test (required, per schemas/test-1.json's root `required`): timing: TestTiming;
  export const NAVIGATION_CONSEQUENCE: Readonly<Record<NavigationMode, string>>;

  // apps/web/src/components/testbuilder/TimingPanel.tsx
  export function TimingPanel(props: {
    timing: TestTiming; sections: readonly StoredSection[];
    published: boolean;
    onChange: (next: TestTiming) => void;
  }): JSX.Element;
  ```

**No new route** — `PATCH …/draft`'s `settings.timing` block. `timing` is the one block `schemas/test-1.json` makes required at the root, so `createTest` (Task 2) writes a default draft carrying `{ duration_minutes: 60 }` and nothing else; every other field has a documented default in `docs/test-format.md` § `timing` and is omitted until set.

**Defaults, copied verbatim from `docs/test-format.md`:** `navigation` `free`, `attempts_allowed` `1`, `cooldown_minutes` `0`, `counted_attempt` `highest`, `warn_at_minutes` `[10, 2]`, `late_sync_grace_seconds` `30`, `latest_start_at` defaults to `closes_at`, `timezone` the instance default.

`NAVIGATION_CONSEQUENCE` copy, fixed here because the issue asks for it by name: `free` → "A candidate can jump to any question at any time."; `linear` → "A candidate cannot go back to an earlier question."; `per_section` → "Free inside a section; a section is locked once the candidate leaves it."

**Rules added to `validateTest`** — the remaining two from `docs/test-format.md` § "Rules checked on import", both **publish-time** (a half-set window is an ordinary draft), plus one the PRD implies through T-12:

- `closes_at` is after `opens_at`
- `latest_start_at` falls inside the window
- the per-section durations sum to no more than `duration_minutes` (T-12's "overall duration, optional per-section durations"; a sum above the whole is unsatisfiable, and #59 asks for it "caught here, with cause and fix")

"Opens in the past" is **not** a `validateTest` rule — `validateTest` is pure and takes no clock — and belongs to the checklist (Task 13), which has `now`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/validate-test.test.ts (extend)
it("a window that ends before it opens is reported on closes_at", () => {
  expect(validateTest({ ...t, timing: { ...timing, opens_at: "2026-11-14T13:00:00+05:30", closes_at: "2026-11-14T09:00:00+05:30" } }, bank).issues[0])
    .toMatchObject({ field: "timing.closes_at", index: -1 });
});
it("a latest_start_at outside the window is reported", () => { /* field: "timing.latest_start_at" */ });
it("per-section durations summing above the overall duration are reported with both numbers", () => {
  expect(validateTest(testWith45MinOf60InSections(70), bank).issues[0])
    .toMatchObject({ field: "timing.duration_minutes", message: expect.stringMatching(/sections total 70 minutes against an overall 60/) });
});
it("sections with no time limit do not count toward the sum", () => { expect(validateTest(testWithUntimedSections, bank).ok).toBe(true); });
it("the worked example still validates clean", () => { expect(validateTest(exampleTest, exampleQuestions).ok).toBe(true); });
```

```tsx
// apps/web/test/testbuilder/timing.test.tsx
it("no time is rendered bare — every one states its zone", () => {
  expect(screen.getByText(/14 Nov 2026, 09:00 Asia\/Kolkata/)).toBeVisible();
  expect(screen.getByText(/03:30 your time/i)).toBeVisible();
});
it("the per-section sum is shown against the overall duration", () => {
  expect(screen.getByText(/sections total 45 min of 60 min/i)).toBeVisible();
});
it("a sum above the overall duration is caught on blur with cause and fix", async () => {
  await userEvent.clear(screen.getByLabelText(/overall duration/i));
  await userEvent.type(screen.getByLabelText(/overall duration/i), "30");
  await userEvent.tab();
  expect(await screen.findByRole("alert")).toHaveTextContent(/sections total 45 min against an overall 30 min — raise the duration or shorten a section/i);
});
it("a window that ends before it opens is caught on blur", async () => { /* role=alert */ });
it("latest start is echoed as the sentence it means", () => {
  expect(screen.getByText(/a candidate arriving after 12:00 cannot begin/i)).toBeVisible();
});
it("each navigation mode carries its consequence as persistent helper text", () => {
  for (const copy of Object.values(NAVIGATION_CONSEQUENCE)) expect(screen.getByText(copy)).toBeVisible();
});
it("T-14: attempts allowed, cooldown and which attempt counts are settable, with their documented defaults", () => {
  expect(screen.getByLabelText(/attempts allowed/i)).toHaveValue(1);
  expect(screen.getByLabelText(/cooldown between attempts/i)).toHaveValue(0);
  expect(optionValues("Which attempt counts")).toEqual(["highest", "latest", "average"]);
});
it("T-15: the warning marks and the late-sync grace carry their defaults and state what they do", () => {
  expect(screen.getByLabelText(/warn at/i)).toHaveValue("10, 2");
  expect(screen.getByLabelText(/late sync grace \(seconds\)/i)).toHaveValue(30);
  expect(screen.getByText(/answers arriving later than this after the deadline are rejected/i)).toBeVisible();
});
it("times and durations use tabular figures", () => {
  expect(getComputedStyle(screen.getByText(/60 min/)).fontVariantNumeric).toContain("tabular-nums");
});
it("UX-18: changing timing on a published test says what happens to attempts in progress, before it is applied", async () => {
  render(<TimingPanel {...props} published />);
  await userEvent.clear(screen.getByLabelText(/overall duration/i));
  await userEvent.type(screen.getByLabelText(/overall duration/i), "90");
  expect(screen.getByRole("dialog")).toHaveTextContent(/attempts in progress stay on version 1/i);
  expect(props.onChange).not.toHaveBeenCalled();
});
it("the timing panel has no axe violations", async () => { expect(await axe(container)).toHaveNoViolations(); });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/core/test/validate-test.test.ts apps/web/test/testbuilder/timing.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `TestTiming`, the three rules and the panel**

The rules go inside `validateTest`'s existing body, pushing onto its `issues` array. Timestamps are compared with `Date.parse`, and a value that does not parse is reported as its own issue rather than compared as `NaN`. The panel formats with `Intl.DateTimeFormat` and the test's `timezone`, and renders the organiser's local echo with the browser's zone — no date library; tabular figures come from `{typography.timer-numeric}` through the tokens.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): timing, navigation and attempt policy"
```

---

## Task 8: Access modes and allowlists (#60, P5.7)

**Files:**
- Create: `apps/web/src/components/testbuilder/AccessPanel.tsx`
- Modify: `packages/core/src/validate.ts`, `apps/api/src/routes/tests.ts`, `apps/web/src/routes/test.tsx`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/core/test/validate-test.test.ts` (extend), `apps/api/test/draft.test.ts` (extend), `apps/web/test/testbuilder/access.test.tsx`

**Interfaces:**
- Consumes: `TestAccess`, `AccessMode`, `validateTest` (`@pariksha/core` — `TestAccess` already exists at `packages/core/src/types.ts:246`); `DraftPatch` (Task 3); `exportTest` (Task 12 — this task's Review Focus 3 proof calls it, so it runs after Task 12 or against Task 12's stub; see Step 1).
- Produces:
  ```ts
  // apps/web/src/components/testbuilder/AccessPanel.tsx
  export function AccessPanel(props: { access: TestAccess; onChange: (next: TestAccess) => void }): JSX.Element;
  export const ACCESS_CONSEQUENCE: Readonly<Record<AccessMode, { candidate: string; organiser: string }>>;
  /** Plain-words summary of the combined allowlists, for the panel and for the checklist row. */
  export function describeAllowlists(access: TestAccess): string;
  ```

**No new route.** `settings.access` through `PATCH …/draft` — and this task owns **Review Focus 3's proof**: switching `access.mode` must drop the fields that belonged to the old mode, and the assertion is made on the *exported document*, because reading the patch back would pass either way.

`ACCESS_CONSEQUENCE` copy, one line each for what the candidate does and what the organiser must send:

| Mode | Candidate | Organiser sends |
| --- | --- | --- |
| `link_code` | "Opens the public link and types the code." | "The link and the access code." |
| `invite_only` | "Opens their own single-use link." | "One personal link per candidate, from the uploaded list." |
| `email_code` | "Types their email and then the 6-digit code it receives." | "The link only." |
| `sso` | "Signs in with their own school or company account." | "The link only." |

**Save-time versus publish-time.** Save-time: a malformed CIDR in `allow_ip_ranges` or a malformed glob in `allow_email_domains`, because a stored value nothing can parse becomes a candidate silently refused on test day and the organiser never sees the cause. Publish-time (checklist rows, Task 13): `access_code` missing under `link_code` — `validateTest` already carries this rule at `packages/core/src/validate.ts:480` — an allowlist that can match nothing, and a candidate list with no rows.

Rotating the access code is a write to `settings.access.access_code` like any other; the panel states before the write that existing links keep working and the old code stops.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/draft.test.ts (extend) — Review Focus 3
it("switching access.mode away from link_code drops the access code from the exported document", async () => {
  await patchDraft({ settings: { access: { mode: "link_code", access_code: "APTI-2026" } } });
  await patchDraft({ settings: { access: { mode: "sso", allow_email_domains: ["*.ac.in"] } } });
  const text = await (await app.request(exportUrl, get(adminCookie))).text();
  expect(text).not.toContain("APTI-2026");
});
it("a malformed CIDR is refused at save with the field named", async () => {
  const res = await patch({ settings: { access: { mode: "sso", allow_ip_ranges: ["10.0.0.0/64"] } } });
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.issues[0]).toMatchObject({ field: "access.allow_ip_ranges" });
});
it("a malformed email-domain glob is refused at save", async () => { /* 422, field: "access.allow_email_domains" */ });
it("a well-formed allowlist saves even when it can match nothing", async () => { /* 200 — publish-time, not save-time */ });
```

```ts
// packages/core/test/validate-test.test.ts (extend)
it("describeAllowlists states the combined effect in plain words", () => {
  expect(describeAllowlists({ mode: "sso", allow_email_domains: ["*.ac.in"], allow_ip_ranges: ["10.0.0.0/24"] }))
    .toBe("Only addresses matching *.ac.in, and only from 10.0.0.0/24.");
  expect(describeAllowlists({ mode: "link_code", access_code: "X" })).toBe("Anyone with the link and the code.");
});
```

```tsx
// apps/web/test/testbuilder/access.test.tsx
it("only the chosen mode's own fields appear", async () => {
  await userEvent.click(screen.getByRole("radio", { name: /single sign-on/i }));
  expect(screen.queryByLabelText(/access code/i)).toBeNull();
});
it("each mode states what the candidate does and what the organiser sends", () => {
  for (const c of Object.values(ACCESS_CONSEQUENCE)) { expect(screen.getByText(c.candidate)).toBeVisible(); expect(screen.getByText(c.organiser)).toBeVisible(); }
});
it("a malformed CIDR is caught on blur with an example of a correct one", async () => {
  await userEvent.type(screen.getByLabelText(/ip ranges/i), "10.0.0.0/64");
  await userEvent.tab();
  expect(await screen.findByRole("alert")).toHaveTextContent(/for example 10\.0\.0\.0\/24/i);
});
it("the combined allowlist effect is summarised in plain words", () => {
  expect(screen.getByText("Only addresses matching *.ac.in, and only from 10.0.0.0/24.")).toBeVisible();
});
it("the access code has a copy control and is visible as text", async () => { /* both; role=status confirms the copy */ });
it("rotating the code states that the old one stops working, before it rotates", async () => {
  await userEvent.click(screen.getByRole("button", { name: /rotate/i }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/the existing code stops working/i);
  expect(props.onChange).not.toHaveBeenCalled();
});
it("the access panel has no axe violations", async () => { expect(await axe(container)).toHaveNoViolations(); });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/core apps/api/test/draft.test.ts apps/web/test/testbuilder/access.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the save-time checks, `describeAllowlists` and the panel**

CIDR and glob parsing is about fifteen lines in `packages/core/src/validate.ts` beside the rules that use it — no dependency, and a `ponytail:` comment naming the ceiling (IPv4 and IPv6 prefix-length bounds only, no range arithmetic) and its upgrade path. `describeAllowlists` lives in `validate.ts` and is exported from `packages/core/src/index.ts`, so the panel and the checklist row produce the same sentence rather than two.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core apps/api apps/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): access modes and allowlists"
```

---

## Task 9: Candidate list ingest (#60 / #56, P5.7b)

**Files:**
- Modify: `packages/db/src/schema/columns.ts`, `packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/pg.ts`, `packages/db/src/repo/index.ts`, `apps/api/src/routes/tests.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/components/testbuilder/AccessPanel.tsx`
- Create: `packages/db/src/repo/candidates.ts`, `apps/api/src/import/candidates.ts`
- Test: `packages/db/test/parity.test.ts` (extend), `packages/db/test/repo/candidates.test.ts`, `apps/api/test/candidate-list.test.ts`, `apps/web/test/testbuilder/candidate-list.test.tsx`
- Generated: `packages/db/migrations/{sqlite,pg}/0005_*.sql`

**Interfaces:**
- Consumes: `readDelimitedRows`, `DelimitedRow` (`apps/api/src/import/rows.ts:21,34`, Phase 4 Task 8 — each row already carries its source line, which is what gives this import #51's positioned errors for free); `getTest` (Task 2); `getDraftVersion`, `TestDocumentBody` (Task 3); `RegistrationFormSpec`, `FormField` (Task 5); `ImportIssue` (`@pariksha/core`); `requires("candidates.manage")`, `appendAudit`.
- Produces:
  ```ts
  // packages/db/src/repo/candidates.ts — every function scoped(), workspaceId first
  export interface CandidateRow {
    id: string;              // cnd_…
    testId: string;
    /** The value of the test's first `unique: true` registration field for this
     *  row — the key an invite is minted against and a registration matched to. */
    externalId: string | null;
    /** The CSV's `set` column: a set *label* ("A"), not `attempt.set_no`. */
    setLabel: string | null;
    /** Prefill, keyed by registration field id. */
    formValues: Record<string, unknown>;
    /** `"list"` is written by this task; `"registration"` by Phase 6 when a
     *  candidate registers. The discriminator is what lets a re-upload
     *  replace the list without touching anyone who has already signed up. */
    source: "list" | "registration";
    consentVersion: string | null;
    createdAt: number;
  }
  export interface NewCandidate { externalId: string; setLabel: string | null; formValues: Record<string, unknown> }
  export const listCandidates: ScopedFn<[testId: string, filter?: { source?: "list" | "registration" }], CandidateRow[]>;
  export const getCandidateByExternalId: ScopedFn<[testId: string, externalId: string], CandidateRow | null>;
  export const countCandidates: ScopedFn<[testId: string], { total: number; withoutSet: number }>;
  /** Replaces the whole list for this test in one batch: every `source: "list"`
   *  row is deleted and the new ones inserted. A row that already carries a
   *  registration (`source: "registration"`) is never touched. */
  export const replaceCandidateList: ScopedFn<[testId: string, rows: readonly NewCandidate[], now: number], { imported: number }>;

  // apps/api/src/import/candidates.ts
  export interface CandidateImportReport { imported: number; issues: (ImportIssue & { line: number })[] }
  export function convertCandidateCsv(text: string, form: RegistrationFormSpec, setLabels: readonly string[]): { rows: NewCandidate[]; issues: (ImportIssue & { line: number })[] };

  // apps/web/src/lib/api.ts — on ApiClient
  //   candidates(testId: string): Promise<CandidateRow[]>
  //   importCandidates(testId: string, csv: string, dryRun?: boolean): Promise<CandidateImportReport>
  ```

**Produced for Phase 6, stated here because a Phase 6 implementer will build against it.** The `candidate` rows above are the whole of Phase 5's contract, and **Phase 5 mints no invite links**: `POST /tests/{id}/invites`, the single-use signed token, its hash column and its expiry are Phase 6's, and Phase 5 deliberately adds no token column — the token's hashing and lifetime belong to the runtime that consumes them (`S-06` is written about attempt tokens, not list rows). Phase 6 mints against `CandidateRow.externalId` and `CandidateRow.id`; Phase 6's `invite_only` gate reads `getCandidateByExternalId`; Phase 6's `from_candidate_list` assignment reads `CandidateRow.setLabel` and passes it as `assignSet`'s `listValue` (`packages/core/src/select.ts`).

**The CSV's columns are registration field IDs, plus one reserved `set`.** `examples/reasoning-aptitude/candidates.csv` is the worked reference — its header is `roll_number,full_name,email,set`, and `roll_number` is that test's first `unique: true` field. So the list needs no vocabulary of its own: the identity column is the test's first `unique` field, `set` is reserved, every other column is a field ID whose value becomes prefill, and a column that is neither is a positioned error. It is also what gives `UX-17`'s "the registration form has at least one unique field" row teeth — without one, a list cannot be keyed at all.

**Columns this task adds**, plus one Phase 2 correction riding along in the same migration (the precedent is Phase 4 Task 1 widening `question.points` to a real):

| Table | Column | Class | Why |
| --- | --- | --- | --- |
| `candidate` | `external_id` | text, null | The list's identity value. Null for a self-registration that matched no list row |
| `candidate` | `set_label` | text, null | T-09's `set` column. Named `set_label`, not `set_no`, because `attempt.set_no` is an integer and these are the format's set names |
| `candidate` | `source` | text | `"list"` or `"registration"`, so a re-upload replaces only what it owns |
| `candidate` | `consent_version` | **made nullable** | Phase 2 declares it `NOT NULL`; a listed candidate has not consented yet. Null means "listed, not yet registered" |

Unique: `[["test_id", "external_id"]]`, following `question`'s `[["bank_id", "ref_id"]]` — a duplicate identity in the uploaded file is a positioned error, and a re-upload is idempotent.

| Method | Path | Guard | Budget (estimate — measure and pin) |
| --- | --- | --- | --- |
| POST | `/api/v1/workspaces/:id/tests/:testId/candidates/import` | `candidates.manage` | 7 |
| GET | `/api/v1/workspaces/:id/tests/:testId/candidates` | `candidates.manage` | 4 |

`candidates.manage` is the **third guard in Phase 5** and the first route in the application to use it, so `apps/api/test/authorization.test.ts`'s enumeration gains a new action. An Author holds `tests.edit` but not `candidates.manage` (`packages/core/src/permissions.ts`), so an Author who built the whole test cannot upload its candidate list — which is the matrix's own "Manage candidate lists and invites" line, surfaced in the panel the way `UX-11` surfaces the publish boundary rather than discovered as a 403.

**All-or-nothing with positioned errors**, the same shape as `AC-05`: the upload parses, converts and validates whole, and `replaceCandidateList`'s single `db.batch` runs only if there are no issues. `?dryRun=1` reports without writing. The budget is flat in row count.

**Save-time versus publish-time.** Save-time: an unknown column, a missing identity column, a duplicate identity, and a `set` value naming no set in any `sets` section — all four make the row unusable rather than half-built, and all four are fixed in the file before uploading again. Publish-time (Task 13's rows): the list being empty, and rows with no set.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/parity.test.ts (extend)
it("the candidate list columns exist in both dialects and consent_version is nullable", () => { /* external_id, set_label, source; consent_version notNull false */ });
it("two list rows cannot share an external_id within one test", async () => { /* rejects /unique|constraint/i */ });
it("the same external_id in two different tests is accepted", async () => { /* resolves */ });
```

```ts
// packages/db/test/repo/candidates.test.ts
it("replaceCandidateList replaces only the rows it owns", async () => {
  await replaceCandidateList(db, ws, testId, [a, b], T);
  // Phase 5 writes no `source: "registration"` row — Phase 6 does, when a
  // candidate registers. The fixture inserts it directly, which is the one
  // place in this phase a test may bypass a production path, because the
  // production path is a phase away and this is what it must not destroy.
  await insertCandidateRow(db, { workspaceId: ws, testId, externalId: "21CS0147", source: "registration" });
  await replaceCandidateList(db, ws, testId, [c], T);
  expect((await listCandidates(db, ws, testId)).map((r) => [r.externalId, r.source]))
    .toEqual([["21CS0147", "registration"], ["21EC0211", "list"]]);
});
it("countCandidates reports the total and how many have no set, in one query", async () => {
  expect(await countCandidates(db, ws, testId)).toEqual({ total: 3, withoutSet: 1 });
});
it("getCandidateByExternalId is the lookup Phase 6's invite_only gate uses", async () => { /* found, and null for an unknown id */ });
it("S-09: a candidate list in another workspace is not found", async () => { expect(await listCandidates(db, wsA, testInB)).toEqual([]); });
```

```ts
// apps/api/test/candidate-list.test.ts — fixture: examples/reasoning-aptitude/candidates.csv
it("the worked example's list imports whole, keyed on the test's unique field", async () => {
  expect(await json(importUrl, postCsv(candidatesCsv, adminCookie))).toMatchObject({ imported: 3, issues: [] });
  expect((await listCandidates(db, ws, testId))[0]).toMatchObject({
    externalId: "21CS0147", setLabel: "A",
    formValues: { full_name: "Ananya Rao", email: "ananya.rao@vce.edu.in" },
  });
});
it("a column that is neither `set` nor a registration field id is a positioned error on the header", async () => {
  expect((await (await importCsv("unknown-column.csv")).json()).error.details.issues[0])
    .toMatchObject({ line: 1, field: "header", message: expect.stringMatching(/"cgpa_v2" is not a field of this test's registration form/) });
});
it("a test with no unique registration field refuses the upload and says what is missing", async () => {
  expect((await (await importCsv(candidatesCsv)).json()).error.details.issues[0])
    .toMatchObject({ line: 1, field: "header", message: expect.stringMatching(/needs a registration field marked unique/) });
});
it("a duplicate identity in the file reports its line and imports nothing", async () => {
  expect((await (await importCsv("duplicate-roll.csv")).json()).error.details.issues[0]).toMatchObject({ line: 4, field: "roll_number" });
  expect(await candidateCount(testId)).toBe(0);
});
it("a set value naming no set in any sets section reports its line", async () => {
  expect((await (await importCsv("set-z.csv")).json()).error.details.issues[0])
    .toMatchObject({ line: 2, field: "set", message: expect.stringMatching(/no section defines a set "Z"/) });
});
it("dryRun reports exactly what a real import would and writes nothing", async () => { /* same report, count 0 */ });
it("an Author cannot upload a candidate list — it is candidates.manage", async () => { /* 403 */ });
it("an Admin can, and the upload writes one audit entry", async () => { /* 200, appendAudit action "candidates.import" */ });
it("importing 500 rows stays at the route's budget", async () => {
  expect((await withCountingDeps(() => importRows(500))).counts().total)
    .toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/candidates/import"]);
});
it("measures the real subrequest cost of both routes", async () => { /* toBe, per method */ });
```

```tsx
// apps/web/test/testbuilder/candidate-list.test.tsx
it("the panel reports the list's size and how many rows have no set", () => {
  expect(screen.getByText(/3 candidates · 1 with no set/i)).toBeVisible();
});
it("an upload shows the dry-run report before anything is written, one row per issue", async () => {
  await userEvent.upload(screen.getByLabelText(/candidate list/i), badCsv);
  expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
  expect(screen.getAllByRole("row", { name: /line 4/ })).toHaveLength(1);
});
it("replacing an existing list confirms first and names what is replaced and what is kept", async () => {
  expect(screen.getByRole("dialog")).toHaveTextContent(/replace the 3 listed candidates/i);
  expect(screen.getByText(/candidates who have already registered are kept/i)).toBeVisible();
});
it("an Author sees the control in place and disabled, with the reason in text beside it", () => {
  expect(screen.getByLabelText(/candidate list/i)).toBeDisabled();
  expect(screen.getByText("Needs an Admin — candidate lists are managed by Admins and Owners")).toBeVisible();
});
it("the expected columns are stated before an upload, naming this test's unique field", () => {
  expect(screen.getByText(/roll_number \(required\), set \(optional\), and any other registration field/i)).toBeVisible();
});
it("the candidate list panel has no axe violations", async () => { expect(await axe(container)).toHaveNoViolations(); });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db apps/api/test/candidate-list.test.ts apps/web/test/testbuilder/candidate-list.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the columns, the repository, the converter and the panel**

Add the three columns and the `consent_version` nullability change to `TABLE_MANIFEST` and both dialect files, generate each migration with `drizzle-kit`, then `pnpm --filter @pariksha/db migrations`. `convertCandidateCsv` reads with `readDelimitedRows` so every issue already carries its source line, resolves the header against the form's field IDs once, and reports rather than throws — the same shape `convertCsv` has in `apps/api/src/import/csv.ts`. `replaceCandidateList` is one `db.batch`: one `DELETE … WHERE test_id = ? AND source = 'list'` plus the inserts, so it is one subrequest on D1 and a half-replaced list cannot exist.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`, and `pnpm --filter @pariksha/db test` with `TEST_POSTGRES_URL` set.
Expected: PASS on both dialects, with `authorization.test.ts` green against the application's first `candidates.manage` route.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): candidate list ingest with positioned errors"
```

---

## Task 10: Result release and branding (#61, P5.8)

**Files:**
- Create: `packages/core/src/contrast.ts`, `apps/web/src/components/testbuilder/ReleasePanel.tsx`, `apps/web/src/components/testbuilder/BrandingPanel.tsx`
- Modify: `packages/core/src/index.ts`, `packages/core/src/types.ts`, `apps/api/src/routes/workspaces.ts`, `apps/web/test/contrast.test.ts`, `apps/web/test/contrast-usage.test.ts`, `apps/web/src/routes/test.tsx`, `apps/web/src/styles/testbuilder.css`
- Test: `packages/core/test/contrast.test.ts`, `apps/api/test/branding.test.ts`, `apps/web/test/testbuilder/release-branding.test.tsx`

**Interfaces:**
- Consumes: `TestRelease` (`packages/core/src/types.ts:255`); `PATCH /api/v1/workspaces/:id` and `workspace.branding_json` (Phase 3, `apps/api/src/routes/workspaces.ts`, `packages/db/src/schema/columns.ts`); `POST …/banks/:bankId/media` and `GET …/media/:key` (Phase 4, `apps/api/src/routes/media.ts`); `tokens` (`apps/web/src/styles/tokens.ts`); `RegistrationForm` (Task 5, for the start-page preview).
- Produces:
  ```ts
  // packages/core/src/contrast.ts — WCAG 2.1 relative luminance, no dependency
  export function contrastRatio(foreground: string, background: string): number;   // "#rrggbb"
  export function meetsAA(foreground: string, background: string): boolean;        // ratio >= 4.5
  export const CREAM = "#fffbf5";
  export const INK = "#231f1d";

  // packages/core/src/types.ts
  export interface TestBranding { logo?: string; primary_colour?: string; footer_text?: string; start_message?: string; finish_message?: string }
  // added to Test: branding?: TestBranding;
  export const RELEASE_CONSEQUENCE: Readonly<Record<"never" | "on_submit" | "on_date", string>>;
  export const SHOW_CONSEQUENCE: Readonly<Record<"score_only" | "score_and_sections" | "full_review", string>>;

  // apps/web/src/components/testbuilder/*
  export function ReleasePanel(props: { release: TestRelease; onChange: (next: TestRelease) => void }): JSX.Element;
  export function BrandingPanel(props: {
    branding: TestBranding; workspaceBranding: TestBranding;
    onChange: (next: TestBranding) => void;
    onUploadLogo: (file: File, alt: string) => Promise<{ src: string }>;
  }): JSX.Element;
  ```

**No new route.** T-23 splits across two existing ones: logo, primary colour and footer text are *per workspace* and go through Phase 3's `PATCH /api/v1/workspaces/:id` into `workspace.branding_json` under `workspace.settings`; the start and finish messages are *per test* and go through `PATCH …/draft`'s `settings.branding` under `tests.edit`. That split is the PRD's own sentence (T-23) and keeps an Author out of workspace branding. The logo uploads through Phase 4's existing `POST …/banks/:bankId/media`; serving it to a signed-out candidate is Phase 6's — see "Known deferrals".

**`contrastRatio` moves into `@pariksha/core`.** It exists twice today, byte-identical, in `apps/web/test/contrast.test.ts:23` and `apps/web/test/contrast-usage.test.ts:56`; this task deletes both and has them import the one copy, which the picker and the publish check also use. The server re-checks at publish because `docs/test-format.md` says every rule is re-checked on the server and the browser's copy is a courtesy.

**Save-time:** a `primary_colour` below 4.5:1 against both `CREAM` and `INK` is refused at the write, not at publish. It is not a half-built value — it is a stored setting that makes candidate-facing text unreadable the moment any page renders with it, including the preview on the screen that set it.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/contrast.test.ts
it.each([[ "#b3261e", CREAM, 6.34 ], [ "#0d7a51", CREAM, 5.2 ], [ "#0a6fd4", CREAM, 4.81 ]])(
  "matches the ratio DESIGN.md states for %s", (fg, bg, stated) =>
    expect(Math.round(contrastRatio(fg, bg) * 100) / 100).toBeCloseTo(stated, 2));
it("meetsAA is the 4.5:1 boundary", () => { expect(meetsAA("#767676", "#ffffff")).toBe(true); expect(meetsAA("#777777", "#ffffff")).toBe(false); });
```

```ts
// apps/api/test/branding.test.ts
it("a brand colour below 4.5:1 against cream and ink is refused, with the measured ratio in the message", async () => {
  const res = await app.request(wsUrl, patch({ branding: { primary_colour: "#f59a6e" } }, ownerCookie));
  expect(res.status).toBe(422);
  expect((await res.json()).error.message).toMatch(/1\.9:1 against cream.*at least 4\.5:1/i);
});
it("a brand colour that passes against ink is accepted", async () => { /* 200 */ });
it("an Admin cannot set workspace branding — it is workspace.settings", async () => { /* 403 */ });
it("an Author can set the per-test start and finish messages", async () => { /* 200 through PATCH …/draft */ });
```

```tsx
// apps/web/test/testbuilder/release-branding.test.tsx
it("each release option states what the candidate will see, where it is chosen", () => {
  for (const copy of [...Object.values(RELEASE_CONSEQUENCE), ...Object.values(SHOW_CONSEQUENCE)]) expect(screen.getByText(copy)).toBeVisible();
});
it("never release states what the candidate gets instead", () => {
  expect(screen.getByText(/candidates see a receipt with their attempt reference and no score/i)).toBeVisible();
});
it("on_date requires a date before it can be chosen", async () => { /* save disabled, role=alert names release.at */ });
it("the colour picker reports its contrast and refuses below 4.5:1 with the measured ratio", async () => {
  await userEvent.clear(screen.getByLabelText(/primary colour/i));
  await userEvent.type(screen.getByLabelText(/primary colour/i), "#f59a6e");
  expect(await screen.findByRole("alert")).toHaveTextContent(/1\.9:1 against cream/i);
  expect(screen.getByRole("button", { name: /^save/i })).toBeDisabled();
});
it("the brand colour reaches CSS as a custom property, never a style attribute", () => {
  expect(preview().style.getPropertyValue("--brand-primary")).toBe("#b63a10");
});
it("start, finish and the released result view are previewed with the branding applied", () => { /* three previews, each carrying --brand-primary */ });
it("a logo upload requires alt text and states the render size", async () => {
  await userEvent.upload(screen.getByLabelText(/logo file/i), pngFile);
  expect(screen.getByRole("button", { name: /^upload$/i })).toBeDisabled();
  expect(screen.getByText(/renders at 32 px tall/i)).toBeVisible();
  await userEvent.type(screen.getByLabelText(/alt text/i), "Acme College crest");
  expect(screen.getByRole("button", { name: /^upload$/i })).toBeEnabled();
});
it("the release and branding panels have no axe violations", async () => { /* both */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/core/test/contrast.test.ts apps/api/test/branding.test.ts apps/web/test/testbuilder/release-branding.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Move `contrastRatio` into core and implement both panels**

Move the function from `apps/web/test/contrast.test.ts` into `packages/core/src/contrast.ts` unchanged, export it from `index.ts`, and change both web test files to import it — they must keep passing untouched otherwise, which is the proof the move was a move. `BrandingPanel` writes the colour with `ref.current.style.setProperty("--brand-primary", value)` in an effect, because `apps/web/test/no-hex-colors.test.ts` bans `style={}` in `.tsx` under `src`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core apps/api apps/web`
Expected: PASS, with `contrast.test.ts` and `contrast-usage.test.ts` green against the imported function.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): result release and branding with a contrast gate"
```

---

## Task 11: Lifecycle and numbered published versions (#62, P5.9)

> **Correction, found while building Task 4.** `publishTestVersion` currently INSERTs a
> new `test_version` row, and `(test_id, version)` is unique — but `createTest` already
> seeded the draft as version 1. So publishing a brand-new test raises
> `UNIQUE constraint failed: test_version.test_id, test_version.version`, and any fixture
> that works around it by publishing as version 2 is hiding the bug rather than meeting it.
> **The real transition must stamp `published_at` on the existing draft row and then open
> N+1 as the new draft — not insert a row alongside it.** Otherwise the first published
> version of every test in the product is numbered 2. Task 4's fixture publishes as
> version 2 with a comment pointing here; fix the transition in this task and that fixture
> becomes version 1.

**Files:**
- Create: `apps/api/src/publish/checklist.ts`, `apps/web/src/components/testbuilder/VersionBanner.tsx`
- Modify: `packages/db/src/repo/tests.ts`, `packages/db/src/repo/test-document.ts`, `apps/api/src/routes/tests.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/routes/tests.tsx`, `apps/web/src/routes/test.tsx`
- Test: `packages/db/test/repo/tests.test.ts` (extend), `apps/api/test/lifecycle.test.ts`, `apps/web/test/testbuilder/lifecycle.test.tsx`

**Interfaces:**
- Consumes: `getTest`, `updateTest`, `getDraftVersion`, `putDraftVersion` (Tasks 2–3); `validateTest`, `TestTiming` (Tasks 5, 7); `describeAllowlists` (Task 8); `can`, `requires("tests.publish")`, `appendAudit`.
- Produces:
  ```ts
  // packages/db/src/repo/tests.ts
  export interface TestVersionSummary { version: number; publishedAt: number | null; attemptCount: number }
  export const listVersions: ScopedFn<[testId: string], TestVersionSummary[]>;
  export const getPublishedVersion: ScopedFn<[testId: string, version?: number], TestVersionRow | null>;
  /** Stamps published_at on the draft head, sets test.current_version, and opens
   *  no new draft — the next edit does that (UX-18). One db.batch. */
  export const publishDraftVersion: ScopedFn<[testId: string, now: number], { version: number }>;
  export const setTestStatus: ScopedFn<[testId: string, status: TestStatus, now: number], boolean>;

  // packages/db/src/repo/test-document.ts
  export type TestState = "draft" | "scheduled" | "open" | "closed" | "archived";
  export function deriveState(status: TestStatus, timing: TestTiming | undefined, now: number): TestState;

  // apps/api/src/publish/checklist.ts
  export type ChecklistSeverity = "blocking" | "advisory";
  export interface ChecklistRow { id: string; severity: ChecklistSeverity; message: string; field: string; sectionId?: string }
  export function buildChecklist(input: {
    test: TestRow; body: TestDocumentBody; questions: readonly Question[]; now: number;
  }): ChecklistRow[];

  // apps/web/src/components/testbuilder/VersionBanner.tsx
  export function VersionBanner(props: { draftVersion: number; publishedVersion: number | null; onOpenPublished: () => void }): JSX.Element;
  ```

| Method | Path | Guard | Budget (estimate — measure and pin) |
| --- | --- | --- | --- |
| POST | `/api/v1/workspaces/:id/tests/:testId/publish` | `tests.publish` | 8 |
| POST | `/api/v1/workspaces/:id/tests/:testId/close` | `tests.publish` | 5 |
| POST | `/api/v1/workspaces/:id/tests/:testId/archive` | `tests.publish` | 5 |
| GET | `/api/v1/workspaces/:id/tests/:testId/versions` | `tests.edit` | 4 |

**Review Focus 2 lands here.** `test.status` stores only the four states a human causes — `draft`, `published`, `closed`, `archived` — and `deriveState` turns `published` into **Scheduled** or **Open** against `timing.opens_at` / `closes_at` and `now`. `publishDraftVersion` replaces `publishTestVersion`'s `status = 'open'` with `status = 'published'`.

**UX-18's shape.** Publishing stamps `published_at` on the draft head; it opens no new draft. The *next* edit does: `PATCH …/draft` on a test whose head is published inserts version N+1 with `published_at IS NULL`, copying the published body, and returns it. So a test has at most one unpublished version, `test.current_version` always names the highest published one, and the banner is `draftVersion > publishedVersion`.

**`buildChecklist` is created here with the blocking rows only** (Task 13 adds the advisory ones and the surface). It is pure: it takes the body, the drawable questions and `now`, and calls `validateTest` for everything already in it rather than re-deriving any rule.

| Row `id` | Severity | Message shape | Source |
| --- | --- | --- | --- |
| `section_empty` | blocking | `section "<title>" has no questions` | `UX-13`, `UX-17` |
| `pool_no_bank` | blocking | `pool section "<title>" names no bank` | the `SourcePool.bank` ruling |
| `window_backwards` | blocking | `the window closes before it opens` | `validateTest` |
| `window_past` | blocking | `the window closed <n> days ago` | `UX-17` ("the availability window is in the future"); needs `now`, so it is not a `validateTest` rule |
| `access_code_missing` | blocking | `access mode "link_code" requires an access code` | `validateTest` (`packages/core/src/validate.ts:480`) |
| `release_at_missing` | blocking | `release "on_date" requires a date` | `validateTest` (`:489`) |
| `duplicate_ids` | blocking | `section id "<id>" is used more than once` | Task 5's rule |
| `section_durations` | blocking | `sections total <n> minutes against an overall <m>` | Task 7's rule |

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/repo/tests.test.ts (extend)
it("T-04: publishing freezes the draft head and points current_version at it", async () => {
  expect(await publishDraftVersion(db, ws, id, T)).toEqual({ version: 1 });
  expect((await getTest(db, ws, id))!.status).toBe("published");
  expect((await getDraftVersion(db, ws, id))).toBeNull();
});
it("Review Focus 2: status is never stored as open", async () => {
  expect(await db.query("SELECT DISTINCT status FROM test")).not.toContainEqual({ status: "open" });
});
it.each([
  ["published", { opens_at: future, closes_at: later }, "scheduled"],
  ["published", { opens_at: past, closes_at: future }, "open"],
  ["published", { opens_at: past, closes_at: past }, "closed"],
  ["published", {}, "open"],                    // no window means open from publish
  ["closed", { opens_at: past, closes_at: future }, "closed"],
  ["archived", { opens_at: past, closes_at: future }, "archived"],
])("deriveState(%s, %o) is %s", (status, timing, state) =>
  expect(deriveState(status, { duration_minutes: 60, ...timing }, NOW)).toBe(state));
it("AC-03: editing a published test opens draft version 2 and leaves version 1 intact", async () => {
  await putDraftVersion(db, ws, id, editedBody, T);
  expect((await getDraftVersion(db, ws, id))!.version).toBe(2);
  expect((await getPublishedVersion(db, ws, id, 1))!.body).toEqual(originalBody);
  expect((await getTest(db, ws, id))!.currentVersion).toBe(1);
});
it("listVersions reports each version's published time and how many attempts are pinned to it", async () => {
  expect(await listVersions(db, ws, id)).toEqual([{ version: 1, publishedAt: T, attemptCount: 2 }]);
});
```

```ts
// apps/api/test/lifecycle.test.ts
it("an Author gets 403 on publish and an Admin gets 200", async () => { /* both */ });
it("publish refuses on any blocking checklist row and writes no version", async () => {
  const res = await app.request(publishUrl, post({}, adminCookie));
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.rows.map((r) => r.id)).toContain("section_empty");
  expect(await versionCount(testId)).toBe(0);
});
it("publish writes one audit entry naming the version", async () => { /* appendAudit, action "test.publish" */ });
it("AC-03: a new attempt would get version 2 and an existing one keeps version 1", async () => {
  // Phase 5 has no attempt row; the production composition is the version read
  expect((await getPublishedVersion(db, ws, testId))!.version).toBe(2);
  expect((await getTestVersion(db, ws, pinnedVersionId))!.version).toBe(1);
});
it("close and archive each confirm through their own route and are audit-logged", async () => { /* status transitions */ });
it("archiving a draft is refused — Archived follows Closed", async () => { /* 409 */ });
it("measures the real subrequest cost of publish, close, archive and versions", async () => { /* toBe */ });
```

```tsx
// apps/web/test/testbuilder/lifecycle.test.tsx
it("the state is text plus glyph wherever it appears", () => { /* list row and builder header */ });
it("UX-18: the banner is one line, on every screen of a test with a newer draft, and links to the published version", () => {
  expect(screen.getByRole("status")).toHaveTextContent("Version 2 (draft). Attempts in progress stay on version 1.");
  expect(screen.getByRole("button", { name: /view version 1/i })).toBeVisible();
});
it("UX-11: an Author sees Publish in place, disabled, with the reason in text beside it and reachable by keyboard", async () => {
  const button = screen.getByRole("button", { name: /^publish$/i });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-describedby");
  expect(screen.getByText("Needs an Admin — request review instead")).toBeVisible();
  await userEvent.tab();                                   // reachable, so a reader meets the explanation
  expect(document.activeElement).toBe(button);
});
it("UX-10: requesting review sets the flag and the list shows the In review badge", async () => {
  await userEvent.click(screen.getByRole("button", { name: /request review/i }));
  expect(client.updateTest).toHaveBeenCalledWith("tst_1", { reviewRequested: true });
});
it("closing and archiving confirm, and name what candidates will see afterwards", async () => {
  await userEvent.click(screen.getByRole("button", { name: /^close$/i }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/candidates opening the link will see that the test has closed/i);
});
it("version history lists each version with when it was published and how many attempts are pinned", () => { /* a table row per version */ });
it("the builder header, banner and dialogs have no axe violations", async () => { /* axe on each */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db apps/api/test/lifecycle.test.ts apps/web/test/testbuilder/lifecycle.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the lifecycle, `deriveState` and the blocking checklist**

`publishDraftVersion` is one `db.batch` — the `UPDATE test_version SET published_at` and the `UPDATE test SET current_version, status` — so it is one subrequest on D1 and one transaction elsewhere, and a half-published test cannot exist. `attemptCount` in `listVersions` is a correlated subquery over `attempt.test_version_id`, not a query per version, matching `QUESTION_SELECT`'s shape in `packages/db/src/repo/banks.ts:103`. `buildChecklist` calls `validateTest` once and maps its `ImportIssue`s onto rows, adding only the rows that need `now`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS, including Review Focus 1's draft-reference tests from Task 2, which this task's new published rows re-exercise.

- [ ] **Step 5: Commit**

```bash
git add packages apps
git commit -s -m "feat(tests): lifecycle with numbered published versions"
```

---

## Task 12: Clone, whole-test export and import (#63, P5.10)

**Files:**
- Create: `apps/api/src/export/test.ts`, `apps/api/src/import/test.ts`
- Modify: `apps/api/src/routes/tests.ts`, `apps/api/src/app.ts`, `apps/api/src/import/schema.ts` (compile `schemas/test-1.json` beside the bank schemas), `packages/db/src/repo/tests.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/routes/tests.tsx`, `apps/web/src/components/authoring/ImportDialog.tsx`
- Test: `apps/api/test/export/test-round-trip.test.ts`, `apps/api/test/clone.test.ts`, `apps/web/test/testbuilder/clone-import.test.tsx`

**Interfaces:**
- Consumes: `toTestDocument`, `toStoredBody`, `IdRefs` (Task 3); `getPublishedVersion`, `getDraftVersion` (Tasks 3, 11); `validateTest`; `validateBankDocumentStructure` and the `@cfworker/json-schema` compilation in `apps/api/src/import/schema.ts` (Phase 4 Task 7); `listQuestions`, `listBanks`; `createTest`, `putDraftVersion`; `newShortCode` (Task 2).
- Produces:
  ```ts
  // packages/db/src/repo/tests.ts
  export const cloneTest: ScopedFn<[testId: string, input: { name: string; slug: string; now: number }], TestRow>;

  // apps/api/src/export/test.ts
  export function exportTest(deps: AppDeps, workspaceId: string, testId: string, version?: number): Promise<Test>;

  // apps/api/src/import/test.ts
  export interface TestImportReport {
    testId: string | null; imported: boolean;
    issues: ImportIssue[];
    /** Question IDs the file named that resolved into a bank other than the one its `banks` entry implied. */
    rebound: { questionId: string; bankName: string }[];
  }
  export function importTestDocument(deps: AppDeps, workspaceId: string, body: unknown, opts: { dryRun: boolean; now: number }): Promise<TestImportReport>;

  // apps/api/src/import/schema.ts (added)
  export function validateTestDocumentStructure(doc: unknown): StructuralIssue[];
  ```

| Method | Path | Guard | Budget (estimate — measure and pin) |
| --- | --- | --- | --- |
| POST | `/api/v1/workspaces/:id/tests/:testId/clone` | `tests.edit` | 7 |
| GET | `/api/v1/workspaces/:id/tests/:testId/export` | `tests.edit` | 7 |
| POST | `/api/v1/workspaces/:id/tests/import` | `tests.edit` | 8 |

**Export is a mapping, not a serialiser**, for the same reason Phase 4's bank export was: `toTestDocument` already exists (Task 3) and export reads the test row, the version and the questions the sections name, then assembles. `?version=` selects a published version; the default is `current_version`, falling back to the draft head when nothing is published yet. The document carries `$schema`, `format`, `name`, `slug` and every settings block including the ones Phase 5 has no editor for; **the `tst_` ID, the short code and the QR code are omitted**, which `docs/test-format.md` § Identity states outright ("generated by Pariksha and are not part of the file, so an exported test can be imported anywhere without colliding"). `banks` is the list of bank names the sections draw from, and the `qst_` / `bnk_` IDs in `sections_json` become the bank file's own IDs through `IdRefs`.

**Import is all-or-nothing** and reuses Phase 4's three-stage order exactly: structural (`validateTestDocumentStructure`), then `validateTest`, then one `db.batch` writing the test row and its draft version 1. A slug already used in the workspace is a **409 naming the field**, matching Phase 4's `duplicate_group` precedent, not a silent suffix. Questions are resolved by `id` against the workspace's banks; one that resolves into a different bank than the file's `banks` entry implied is reported in `rebound` and imports — #63's "says plainly when questions resolved to a different bank" — while one that resolves nowhere is an issue and nothing imports.

**Clone** copies the test's *editable head* — the draft if there is one, else the latest published version — into a new Draft with a new `tst_` ID, a new short code and a new slug (`<slug>-copy`, suffixed with `-2`, `-3`… on collision). It does not copy: published versions, the version number (the clone starts at draft 1), `review_requested`, or anything candidate-side (there is none yet). The response names all three new identifiers so the screen can show them.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/export/test-round-trip.test.ts — against examples/reasoning-aptitude/test.json
it("AC-04: the worked example round-trips through import and export", async () => {
  await importTest(exampleTest);
  expect(await json(exportUrl)).toEqual({ ...exampleTest, $schema: expect.any(String) });
});
it("the exported document validates against test-1.json and validateTest", async () => {
  expect(validateTestDocumentStructure(out)).toEqual([]);
  expect(validateTest(out, exampleQuestions).ok).toBe(true);
});
it("export carries no internal identifier", async () => {
  for (const leak of ["workspace_id", "tst_", "qst_", "bnk_", "ver_"]) expect(text, leak).not.toContain(leak);
});
it("export carries no review comment key (ADR 0007)", () => { expect(Object.keys(out)).not.toContain("comments"); });
it("blocks Phase 5 has no editor for survive the round trip", () => {
  for (const k of ["consent", "proctoring", "retention"]) expect(out[k]).toEqual(exampleTest[k]);
});
it("?version= exports a published version and the default exports the current one", async () => { /* two reads */ });
it("a bad section in the file imports nothing and reports the position and reason", async () => {
  const res = await importRequest(withUnknownQuestionId(exampleTest));
  expect(res.status).toBe(422);
  expect(await testCount()).toBe(0);
  expect((await res.json()).error.details.issues[0]).toMatchObject({ index: 1, field: "source.sets", questionId: "NOPE-001" });
});
it("a slug already used in the workspace is 409 with the field named", async () => { /* code "duplicate_slug", details.field "slug" */ });
it("a question resolving into a different bank imports and is reported in rebound", async () => { /* rebound[0] */ });
it("exporting a test with 200 questions across its sections stays at the route's budget", async () => { /* toBe, flat in question count */ });
it("measures the real subrequest cost of clone, export and import", async () => { /* toBe */ });
```

```ts
// apps/api/test/clone.test.ts
it("AC-04: a clone has the same settings and sections and a new id, slug and short code", async () => {
  expect(clone.id).not.toBe(original.id);
  expect(clone.slug).toBe("midterm-copy");
  expect(clone.shortCode).not.toBe(original.shortCode);
  expect((await getDraftVersion(db, ws, clone.id))!.body).toEqual(originalBody);
});
it("a clone starts in Draft at version 1 with no published version", async () => { /* status draft, currentVersion null */ });
it("a clone does not copy review_requested", async () => { expect(clone.reviewRequested).toBe(false); });
it("cloning twice gives midterm-copy and midterm-copy-2", async () => { /* both */ });
```

```tsx
// apps/web/test/testbuilder/clone-import.test.tsx
it("a clone opens with its new name, id and slug visible and states what it did not copy", () => {
  expect(screen.getByText(/version history and the review flag were not copied/i)).toBeVisible();
});
it("the clone's name is editable immediately, with focus in the field", () => {
  expect(document.activeElement).toBe(screen.getByLabelText(/^name$/i));
});
it("import reports what landed and what was skipped in the #51 error-summary pattern", async () => {
  expect(screen.getAllByRole("row", { name: /NOPE-001/ })).toHaveLength(1);
  expect(screen.getByText(/nothing was imported/i)).toBeVisible();
});
it("import says plainly when questions resolved to a different bank", async () => {
  expect(screen.getByText(/LOG-001 resolved to bank “Aptitude”/i)).toBeVisible();
});
it("export reports started and finished with the file name", async () => {
  expect(await screen.findByRole("status")).toHaveTextContent(/saved reasoning-aptitude-2026\.json/i);
});
it("the clone and import dialogs have no axe violations", async () => { /* both */ });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/export apps/api/test/clone.test.ts apps/web/test/testbuilder/clone-import.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement export, import and clone**

Compile `schemas/test-1.json` in `apps/api/src/import/schema.ts` beside the bank schemas — same `@cfworker/json-schema` instance, same `StructuralIssue` shape, imported as a JSON module so it inlines into the Worker bundle (Ajv compiles with `new Function`, which Workers forbid). `exportTest` omits every field the format calls optional when the stored value is absent, so a test that never had a licence does not export `"license": null` and fail a strict importer elsewhere. `cloneTest` is one `db.batch`: the `test` insert and the `test_version` insert.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages apps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps packages
git commit -s -m "feat(tests): clone, whole-test export and all-or-nothing import"
```

---

## Task 13: Pre-publish warnings (#64, P5.11)

> **Third trap, found building Task 7: there is no publish-time rule for a missing `timing`.**
> Task 7 deliberately did **not** make `timing` required — `TestSettings` is what a *draft*
> stores, `createTest` seeds `{}`, and `draftSchema()` drops the root `required` precisely so
> a new test is legal. Presence is therefore enforced in exactly two places: the schema's root
> `required` on import, and this checklist. **No rule in `validateTest` covers it**, and every
> fixture there legitimately omits `timing`, so adding one there would break them. This task
> must add the row, or a test can be published with no duration at all.

> **Two traps, found reviewing Task 4.** (1) `scoring.set_points_tolerance` is schema-legal
> and type-safe but has **no UI control** — Task 4 shipped it deliberately as schema, type and
> `validateTest` only. So the `sets_unbalanced` row prints `tolerance 0` and nothing an
> organiser can reach changes it: a legitimate one-point drift is a permanently red advisory
> with no knob. Either give it a control here or say in the row's copy that it is file-only.
> (2) Precedence in `validate.ts` is `options.setPointsTolerance ?? doc.scoring.set_points_tolerance ?? 0`,
> which overrides in **either** direction. So a `buildChecklist` that passes the
> apparently-harmless `{ setPointsTolerance: 0 }` silently discards a tolerance the file set.
> **Pass no `setPointsTolerance` unless this gate is deliberately stricter than the file.**
> Tasks 12 and 13 write the first production callers of `validateTest`, so this rule has no
> prior art to copy — it starts here.

**Files:**
- Create: `apps/web/src/components/testbuilder/PublishChecklist.tsx`
- Modify: `apps/api/src/publish/checklist.ts`, `apps/api/src/routes/tests.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/routes/test.tsx`, `docs/ROADMAP.md`
- Test: `apps/api/test/checklist.test.ts`, `apps/web/test/testbuilder/checklist.test.tsx`

**Interfaces:**
- Consumes: `buildChecklist`, `ChecklistRow`, `ChecklistSeverity` (Task 11); `validateTest`, `matchesFilter`, `describeAllowlists`; `getDraftVersion`, `listQuestions`; `countCandidates` (Task 9).
- Produces:
  ```ts
  // apps/web/src/lib/api.ts — on ApiClient
  //   checklist(testId: string): Promise<ChecklistRow[]>
  // apps/web/src/components/testbuilder/PublishChecklist.tsx
  export function PublishChecklist(props: {
    rows: readonly ChecklistRow[];
    onGoTo: (row: ChecklistRow) => void;
    onConfirm: () => void;
    onClose: () => void;
    busy: boolean;
  }): JSX.Element;
  ```

| Method | Path | Guard | Budget (estimate — measure and pin) |
| --- | --- | --- | --- |
| GET | `/api/v1/workspaces/:id/tests/:testId/checklist` | `tests.edit` | 6 |

**Advisory rows this task adds to `buildChecklist`.** Advisory, not blocking, and the distinction is the PRD's: `T-11` says the builder *warns* on both, and `docs/test-format.md` § "Rules checked on import" says "Import is stricter: it refuses the file for either, because an imported file is one an author can still edit." `design.md`'s `UX-17` "all green" is the lower-precedence document and is read as every row acknowledged.

| Row `id` | Severity | Message shape | Source |
| --- | --- | --- | --- |
| `pool_short` | advisory | `pool needs 10, bank has 7` | `T-11`, `UX-15` |
| `sets_unbalanced` | advisory | `set A is 8 points, set B is 6 — 2 apart, tolerance 0` | `T-11`, `UX-16` |
| `no_unique_field` | advisory | `no registration field is unique, so a candidate can register twice` | `UX-17` |
| `allowlist_empty` | advisory | `<describeAllowlists output>, which matches nobody` | #60's acceptance |
| `candidate_list_empty` | advisory | `the candidate list has no rows, so nobody can enter yet` | #60's acceptance. Shown **only** when something depends on it — `access.mode` is `invite_only`, or a section assigns `from_candidate_list`; otherwise the row does not appear |
| `candidate_no_set` | advisory | `4 of 50 candidates have no set, and cannot start` | #56's acceptance. Advisory because the candidate list is test-level data publish does not pin — the organiser re-uploads the file afterwards, and for `invite_only` that is the ordinary order of work |

Every row states the **measured fact**, never a category: the message carries the two numbers. `buildChecklist` gets these from `validateTest`'s existing issues wherever it already raises them (the pool and set rules are `packages/core/src/validate.ts:551` and `:571`), so the numbers in the checklist and the numbers an import would report are the same numbers.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/checklist.test.ts
it("a pool shortfall is advisory and states both numbers", async () => {
  expect(rows.find((r) => r.id === "pool_short")).toMatchObject({ severity: "advisory", message: "pool needs 10, bank has 7", sectionId: "quant" });
});
it("unequal sets are advisory and name each set's total", async () => { /* severity advisory, both totals in the message */ });
it("T-11: publish succeeds over advisory rows and refuses over blocking ones", async () => {
  expect((await app.request(publishUrl, post({}, adminCookie))).status).toBe(200);     // pool_short only
  await emptyASection();
  expect((await app.request(publishUrl, post({}, adminCookie))).status).toBe(422);
});
it("import refuses the same pool shortfall that publish only warns about", async () => {
  expect((await importRequest(testWithShortPool)).status).toBe(422);
});
it("the checklist and publish compute the same rows — one function, two callers", async () => {
  await emptyASection();
  const fromGet = (await json(checklistUrl)).filter((r) => r.severity === "blocking");
  const fromPublish = (await (await app.request(publishUrl, post({}, adminCookie))).json()).error.details.rows;
  expect(fromPublish).toEqual(fromGet);
});
it("an empty candidate list is advisory for invite_only and does not appear otherwise", async () => {
  await setAccessMode("invite_only");
  expect((await json(checklistUrl)).find((r) => r.id === "candidate_list_empty")).toMatchObject({ severity: "advisory" });
  await setAccessMode("link_code");
  expect(rowIds(await json(checklistUrl))).not.toContain("candidate_list_empty");
});
it("candidates with no set are advisory and state the count", async () => {
  expect((await json(checklistUrl)).find((r) => r.id === "candidate_no_set"))
    .toMatchObject({ severity: "advisory", message: "4 of 50 candidates have no set, and cannot start" });
});
it("an invite_only test with an empty candidate list publishes — the roster is uploaded afterwards", async () => {
  await setAccessMode("invite_only");
  expect((await app.request(publishUrl, post({}, adminCookie))).status).toBe(200);
});
it("both candidate rows cost one query, not one per candidate", async () => {
  expect((await withCountingDeps(() => json(checklistUrl))).counts().total)
    .toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/checklist"]);
});
it("an all-green test returns an empty row list", async () => { expect(await json(checklistUrl)).toEqual([]); });
it("every row names a field a screen can navigate to", async () => { for (const r of rows) expect(r.field).not.toBe(""); });
it("measures the real subrequest cost of the checklist route", async () => { /* toBe, flat in section count */ });
```

```tsx
// apps/web/test/testbuilder/checklist.test.tsx
it("blocking and advisory are distinguished in words, not only by colour or icon", () => {
  expect(screen.getByText(/must fix/i)).toBeVisible();
  expect(screen.getByText(/worth checking/i)).toBeVisible();
});
it("each row states the measured fact", () => { expect(screen.getByText("pool needs 10, bank has 7")).toBeVisible(); });
it("every row links to the exact field, and returning keeps the checklist open", async () => {
  await userEvent.click(screen.getByRole("button", { name: /go to Quantitative aptitude/i }));
  expect(props.onGoTo).toHaveBeenCalledWith(expect.objectContaining({ sectionId: "quant" }));
  expect(screen.getByRole("dialog", { name: /publish checklist/i })).toBeVisible();
});
it("the checklist is focusable and announced when it opens, and closing returns focus to the opener", async () => {
  const opener = screen.getByRole("button", { name: /^publish$/i });
  await userEvent.click(opener);
  expect(screen.getByRole("dialog", { name: /publish checklist/i })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(document.activeElement).toBe(opener);
});
it("re-running the checks does not rebuild the list under the reader's cursor", async () => {
  const first = screen.getAllByRole("listitem")[0];
  await userEvent.click(screen.getByRole("button", { name: /re-run/i }));
  expect(screen.getAllByRole("listitem")[0]).toBe(first);     // same node, keyed by row id
});
it("an all-green checklist still asks for a confirmation and states that publishing freezes the version", async () => {
  expect(screen.getByText(/publishing freezes version 2/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /publish version 2/i })).toBeEnabled();
});
it("the checklist has no axe violations", async () => { expect(await axe(container)).toHaveNoViolations(); });
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/checklist.test.ts apps/web/test/testbuilder/checklist.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Add the advisory rows, the route and the screen**

The rows come from `validateTest`'s issues wherever it already raises them; `buildChecklist` maps issue → row and sets the severity, so no rule is written twice. `PublishChecklist` renders the array it is given, keyed by `row.id`, and computes nothing (Review Focus 4). Re-running replaces `rows` with a fresh array whose items keep the same keys, so React reuses the nodes.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`, with `TEST_POSTGRES_URL` set.
Expected: all pass, on both dialects.

- [ ] **Step 5: Update the roadmap Progress table and commit**

Move Phase 5 to **Done** in `docs/ROADMAP.md`'s Progress table, naming what landed, the issues that closed, and the deferrals below.

```bash
git add apps docs/ROADMAP.md
git commit -s -m "feat(tests): pre-publish checklist with blocking and advisory rows"
```

---

## Smaller calls made while planning

The planner's calls, not the PRD's. Listed so a human can overrule them cheaply.

**Ruling: a test's editable head is one `test_version` row with `published_at IS NULL`; publishing stamps it rather than copying it.** — Why: `packages/db/src/schema/columns.ts` already declares `test_version.published_at` nullable and `test.current_version` nullable, which is this design written down; the alternative — draft columns on `test` — stores the same document shape in two places and gives `UX-18`'s "Version 2 (draft)" nowhere to get its number. — Cost if wrong: one migration moving two JSON columns onto `test`, before anything has published.

**Ruling: `test.status` stores `draft`, `published`, `closed`, `archived`; `scheduled` and `open` are derived from the published version's window at read time.** — Why: no scheduler exists until Phase 11 (ROADMAP, Phase 11: "the built-in scheduler in place of Cron Triggers"), so a stored `open` is wrong from the moment it is written until something flips it — and `publishTestVersion` writes exactly that today. — Cost if wrong: `deriveState` becomes a cron job that writes the column it currently computes; one function, no schema change.

**Ruling: `test_version.sections_json` names questions by their `qst_` row ID and banks by their `bnk_` row ID; export translates both back to the bank file's own IDs.** — Why: `packages/db/src/repo/banks.ts:99-101` already matches `q.id` and `q.bank_id` against `sections_json` and Phase 4 shipped `UX-05`'s delete refusal on it; and a `ref_id` is unique only per bank (`columns.ts`, `question.uniques: [["bank_id","ref_id"]]`), so a `fixed` list of ref IDs is ambiguous across the several banks `test.banks` explicitly allows. — Cost if wrong: `apps/api/src/export/test.ts` loses its mapping step and `sections_json` is rewritten once, over a table nothing has published to.

**Ruling: a pool section naming no bank is forbidden at publish, not at save, and neither `SourcePool.bank` nor `schemas/test-1.json` is tightened.** — Why: making an optional field required is a breaking change for every existing document, which `docs/test-format.md` § Versioning puts behind `@2`; and the UX-05 hole closes without it, because all three usage predicates consult only published versions (after Review Focus 1's fix) and `pool_no_bank` is a blocking checklist row, so a bankless pool can never reach a published version. The builder's pool editor is a `<select>` over the workspace's banks with no empty option. Proved in Task 11 (`pool_no_bank` blocks publish) and Task 2 (a published pool's questions are undeletable). — Cost if wrong: one checklist row is replaced by a `required` entry and a `@2` migration — which is exactly why it is not done speculatively.

**Ruling: Phase 4's `GET …/media/:key` needs nothing from Phase 5.** — Why: it is guarded by `banks.edit`, and in `packages/core/src/permissions.ts` every role holding `tests.edit` also holds `banks.edit` (owner holds all of `ACTIONS`; admin and author list both; proctor, reviewer and viewer hold neither), so any organiser who can open a test preview can already fetch its question images and the workspace logo. The gate only bites a caller with no membership — the candidate — and that, with the public branding read, is Phase 6's. Task 2 pins it with a matrix assertion, so splitting the two actions later breaks a test rather than an image. — Cost if wrong: one route's guard changes; no data moves.

**Ruling: one `PATCH …/draft` carrying a partial settings document, not a route per settings block.** — Why: `test_version.settings_json` is one column and `pariksha/test@1` is one document; ten routes would be ten `ROUTE_BUDGETS` lines, ten guards and ten places for Review Focus 3's merge bug to hide. Tasks 4 through 9 add no route at all. — Cost if wrong: splitting one handler's switch into several, with no storage change.

**Ruling: read routes are guarded by `tests.edit`, so a Viewer is 403 on the test list.** — Why: there is no `tests.view` in `packages/core/src/permissions.ts`, and `apps/api/src/app.ts`'s `ROUTE_ACTIONS` comment records Phase 4 making exactly this call for banks. — Cost if wrong: one `ACTIONS` entry and one matrix row, which is a PRD change either way.

**Ruling: a test is never deleted; Archived is terminal.** — Why: `T-04` lists five states ending at Archived and the PRD's API table (`Tests`) has no `DELETE`. — Cost if wrong: one route.

**Ruling: `GET /t/:code` is public, unguarded, and `apps/api/src/index.ts` is changed to hand `/t/` to the Worker.** — Why: the code names no workspace, so `guard()` cannot run on it at all; ADR 0006 is the standing precedent for a read that sits outside the workspace guard rather than inside an exemption list, and `packages/db/src/repo/identity.ts` is the existing module that is deliberately not re-exported from `repo/index.ts`. The response discloses nothing the public candidate URL does not already disclose. — Cost if wrong: the route moves behind a rate limiter in Phase 6; one file.

**Ruling: `short_code` is six characters from `ids.ts`'s Crockford alphabet, unique across the instance.** — Why: T-02 fixes the length; the alphabet's own comment in `packages/db/src/ids.ts` gives the reason (a code read down a phone line to a candidate who lost their link); the bare unique is Review Focus 5. — Cost if wrong: a longer code and one migration.

**Ruling: `qrcode-generator` is added to `apps/web` rather than hand-writing an encoder.** — Why: a QR encoder is Reed–Solomon arithmetic and a mask-pattern search, several hundred lines of exactly the code that is wrong in ways no reviewer sees; the library is MIT, ~12 KB, has no dependencies and no network, and the admin bundle carries no budget — the 300 KB ceiling is the candidate app's, and `bundle.test.ts` pins it out of that entry. — Cost if wrong: the dependency is dropped and the QR is omitted; T-02's short link stands alone.

**Ruling: `contrastRatio` moves into `@pariksha/core`.** — Why: it exists twice today, byte-identical, at `apps/web/test/contrast.test.ts:23` and `apps/web/test/contrast-usage.test.ts:56`, and T-23's gate needs a third copy in `src` and a fourth on the server. `packages/core` is the pure-leaf home with no runtime dependencies, and `docs/test-format.md`'s "every rule is re-checked on the server" is why the server needs it at all. — Cost if wrong: the module moves to `apps/web/src/lib/` and the server check goes.

**Ruling: the candidate list splits across two phases — Phase 5 ingests the list, Phase 6 mints the invite links.** — Why: the two halves answer to different owners. The list is an input to the builder's own gate — `UX-17`'s checklist has to count its rows, #60's acceptance asks for an empty list to be caught before publish, and #56's `from_candidate_list` reads a `set` column off it — so it has to exist while the test is still a draft. The single-use signed token is an input to the runtime that redeems it (`S-06`, `C-02`), and its hashing, expiry and replay behaviour are decisions the consuming phase owns. Planning both phases in parallel left a hole between them: Phase 6's "Assumed Phase 5 interface" table expected Phase 5 to mint at `POST /tests/{id}/invites` and built only the consume side, while this plan expected Phase 6 to ingest — so neither built the surface. The split closes it, and Task 9's `Produces` block states the row shape explicitly so Phase 6 builds the mint side against real columns. Phase 5 adds **no** token column, and because the list is test-level data publish never pins, its two checklist rows are advisory under the severity ruling above. — Cost if wrong: if minting should have been Phase 5's, Phase 6 writes one route and one column against rows that already exist; if ingestion should have been Phase 6's, Task 9's migration and repository move forward a phase intact.

**Ruling: two shuffle controls, not the three #56 names.** — Why: `T-10` names two shuffles; `schemas/test-1.json` `$defs/section` carries only `shuffle_questions`, and option order is `shuffle_options` per question (`schemas/question-1.json`, read by `layoutForAttempt` in `packages/core/src/select.ts`), which the Phase 4 editor already owns. No document names a third. #56's "three switches" is satisfied as three rows in one legend — one switch and two statements of fact, including `UX-08`'s. The one variant worth revisiting is a test-level `shuffle: { questions, options }` block (additive within `@1`), and only if organisers ask to override option shuffling per test; it would put a second decider on option order and make `layoutForAttempt` carry a precedence rule between the test setting and the question's own, which is why it is not done now. — Cost if wrong: that block plus one switch — one schema property, one field, one precedence line.

**Ruling: a checklist row blocks only when publish pins the thing it is about; everything else is advisory.** — Why: stated once as a rule so the next row does not have to be argued from scratch. A pool and a set source are resolved against the version publish freezes (`T-04`, "publishing freezes a numbered version"), so a shortfall or an imbalance is genuinely not fixable on that version afterwards — and the PRD still softens *those* to warnings (`T-11`, "the builder **warns**"), with `docs/test-format.md` § "Rules checked on import" making import the strict half ("Import is stricter: it refuses the file for either, because an imported file is one an author can still edit"). A candidate list is keyed `(test_id, external_id)` on a *test*-level table and is not pinned into `test_version` at all, so it stays editable after publish — and for `invite_only`, uploading the roster *after* publishing is the ordinary order of work, because Phase 6 mints invite links against a published version. Blocking the fixable case while the PRD only warns about the unfixable one would be backwards, so `candidate_list_empty` and `candidate_no_set` are advisory alongside `pool_short` and `sets_unbalanced`. The blocking rows are exactly the ones about the frozen document: an empty section, a bankless pool, a backwards or past window, a missing access code or release date, duplicate IDs, and section durations over the whole. `design.md`'s `UX-17` "all green" is lower precedence and reads as every row acknowledged, which the confirmation step delivers. **The test for any row Phase 6 or Phase 8 adds later: does publish freeze the thing this row is about?** — Cost if wrong: a row changes severity; one word each.

**Ruling: `scoring.set_points_tolerance` is added to `pariksha/test@1`.** — Why: `T-11` says sets may differ "by more than a set amount" and names no home for the amount; `validateTest` already takes it as `options.setPointsTolerance` with a default of 0 and a comment saying the PRD names no number (`packages/core/src/validate.ts:394-411`). Adding a field within a major version is allowed by `docs/test-format.md` § Versioning. — Cost if wrong: one schema property removed and the parameter hardcoded to 0.

**Ruling: Phase 5 ships ADR 0007 and the `review_requested` flag and badge; the reviewers panel, the comment table and approvals are not built.** — Why: `docs/ROADMAP.md`'s Phase 5 "Delivers" list names no review surface and ROADMAP outranks `design.md` in the precedence this plan works from; no Phase 5 issue covers the panel, and #148 itself says the review flow "belongs to the Phase 5 task that builds it" — there is none. #54's issue *does* name the badge, so the flag ships with it. — Cost if wrong: one task (a table, one route pair, one panel) added later, cheaply, because ADR 0007 already decided its data model.

**Ruling: T-24 (interface language per test) ships nothing.** — Why: the PRD's own text is "English in v1, with translation files for others", `schemas/test-1.json` has no `language` property, and ROADMAP Phase 12 owns "translation files and right-to-left layout". A field with one legal value that nothing reads is the definition of speculative. — Cost if wrong: one additive schema property and one `<select>`.

**Ruling: import refuses a duplicate slug with 409, rather than auto-suffixing.** — Why: import is all-or-nothing by `D-02`'s rule and Phase 4's precedent (`duplicate_group`, 409 with `details.field`, `apps/api/test/groups.test.ts`); a silent suffix is a second test nobody asked for. Clone is the opposite case and *does* suffix, because `T-05` says a clone gets "a new ID and slug" as part of its definition. — Cost if wrong: one branch in the import handler.

**Ruling: there is no "discard draft".** — Why: no document asks for one; the draft head is the editable test, and `UX-18`'s model has one unpublished version at a time. — Cost if wrong: one route and one repository function.

**Ruling: the registration form renderer is one module shared with Phase 6, not a builder-only preview.** — Why: #57's acceptance says "The preview is the candidate renderer, including its validation messages", which is only true if it is literally the same module — the same argument and the same structure [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md) gave the Markdown renderer for `UX-09`. — Cost if wrong: Phase 6 writes its own and the preview becomes an approximation, which is the defect the rule exists to prevent.

**Ruling: T-19's check ships as a mechanism plus a builder affordance; applying it to a candidate's submitted URL is Phase 6's.** — Why: `T-19` sits under the PRD's "Registration form builder" heading and #58 is a Phase 5 issue, while a candidate's registration submission is `C-03` and `AC-12`, both in ROADMAP's Phase 6 gate. — Cost if wrong: Phase 6 imports `checkReachable` instead of writing it; nothing moves.

**Ruling: the reachability check refuses literal addresses by hostname shape and does not resolve DNS.** — Why: `globalThis.fetch` on Workers exposes no resolver, so a hostname that *resolves* to a private address cannot be caught there at all; refusing the literal forms catches the direct attack, `redirect: "manual"` catches the walk, and the ceiling is named in a `ponytail:` comment with its upgrade path (resolve-then-check at the Node entry, Phase 11). — Cost if wrong: one guard added at the Node entry.

## Known deferrals, recorded so they are not rediscovered as bugs

- **The review panel, the comment table and approvals are not built.** Phase 5 ships ADR 0007, the `test.review_requested` column, a "Request review" control and the "In review" badge (`UX-10`'s badge, `#54`). What is missing: the reviewers list, per-section and per-question comments, and the Approved / Changes-requested marks — `docs/design.md`'s screen inventory row 10. ADR 0007 fixes the data model, including the fourteenth action (`tests.comment`) that the task building it must add to the PRD matrix, `PERMISSIONS` and `ROUTE_ACTIONS` together. **Until it lands, `UX-10` is partly met** and the acceptance checklist should say so.
- **Pointer drag remains deferred, as it was in Phase 4.** `UX-12` and #55 say sections are "dragged to reorder"; this phase ships the keyboard half in full through `ReorderableList`, and no pointer drag. The seam is unchanged: `onReorder(from, to)` is what a later `draggable` row would call.
- **`AC-11`'s "a refresh keeps each order" is not provable in Phase 5.** The order is stored in `attempt.layout_json`, and attempts are Phase 6. This phase proves the other two thirds — two candidates on one set get different orders, and pinned options do not move — through `layoutForAttempt` against the stored published version (Task 4).
- **Invite links are not minted.** Phase 5 ingests the candidate list (Task 9); `POST /tests/{id}/invites`, the single-use signed token and its expiry are Phase 6's. See the candidate-list ruling.
- **`consent`, `proctoring` and `retention` have no editor.** They belong to Phases 6, 7 and 8. Phase 5 carries them through import, clone and export untouched and asserts exactly that (Task 12), so a document that arrives whole leaves whole.
- **The public reads the candidate needs do not exist yet.** `GET /t/:code` redirects to `/<workspace-slug>/<test-slug>`, which nothing serves until Phase 6; and the workspace logo is readable only through `GET …/media/:key` behind `banks.edit`, so a signed-out candidate cannot fetch it. Phase 6 owns the candidate landing page and the public branding read. Both are expected 404s today, not regressions.
- **Phase 6 inherits one interface decision from Task 3.** The questions `layoutForAttempt` is handed come from `test_version.sections_json`, which names `qst_` row IDs — so the `Question` objects passed to it must carry the row ID in `Question.id`, and `response.question_id` stores that. Deciding otherwise means rewriting the three usage predicates in `packages/db/src/repo/banks.ts`.

## Escalated — needs a human decision

**Empty.** Both questions this plan raised — which phase ingests the candidate list, and whether there is a third shuffle switch — were put to a human and decided. They are recorded above as rulings (the candidate-list split and the two shuffle controls); this heading is kept rather than deleted so a reader can see the section was checked and came back empty, not skipped.

## Done when

- `AC-02` passes: three tests give three `tst_` IDs, three slugs and three short codes; `/t/<code>` and the candidate URL each open one test; a duplicate slug in one workspace is rejected and the same slug in another is not; and the same short code cannot exist in two workspaces.
- `AC-03` passes: editing a published test opens draft N+1, version N is readable unchanged, `test.current_version` still names N, and nothing stores `status = "open"`.
- `AC-04` passes: `examples/reasoning-aptitude/test.json` round-trips through import and export byte-for-byte including `consent`, `proctoring` and `retention`, carries no `tst_`, `qst_`, `bnk_`, `ver_` or `workspace_id`, and a clone reproduces the same settings and sections under a new ID, slug and short code.
- `AC-09`, `AC-10` and `AC-11` pass against the *published version read back through `getTestVersion`*: round robin over 5 sets splits 50 registrations 10 each with no two consecutive alike; a pool draws `count` distinct matching questions per candidate; two candidates on one set get different question and option orders and pinned options do not move. `AC-11`'s refresh case is Phase 6's.
- The UX-05 guarantee still holds and is now exact: a question referenced only by an unpublished draft can be deleted, the same reference in a published version refuses the delete and names the test, and a published pool's questions are undeletable because a bankless pool cannot be published.
- The candidate list is real, queryable data: `examples/reasoning-aptitude/candidates.csv` imports whole keyed on the test's `unique` field, a bad line imports nothing and reports its position, an Author is 403, and the publish gate *warns* — never blocks — on an empty list under `invite_only` and on rows with no set under `from_candidate_list`, because publish pins no part of it. Invite minting is Phase 6's and no token column exists.
- One publish gate: `GET …/checklist` and `POST …/publish` return the same blocking rows from the same function, every row states its measured numbers, publish succeeds over advisory rows and refuses over blocking ones, and import refuses what publish only warns about.
- `ROUTE_BUDGETS` covers every route this phase mounts, every entry is pinned with `toBe` against a measurement, no entry reaches 50, and the draft read and the export stay flat in section and question count.
- `GET /t/:code` is the only route in the application with no guard, and `apps/api/test/authorization.test.ts` says so.
- Every builder screen passes `jest-axe`, every reorder is reachable without a pointer and keeps focus, every state is text plus glyph, and `apps/web/test/no-hex-colors.test.ts` still finds nothing — including no `style={}` in the branding panel.
- `pnpm lint typecheck build test` passes with SQLite and Postgres both migrating in CI.
