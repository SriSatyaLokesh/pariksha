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

---

## Task 1: ADR — review comments on a draft test (#148, P5.0)

**Files:**
- Create: `docs/adr/0007-review-comments-on-a-draft-test.md` (the next free number at execution time; `docs/adr/README.md` ends at 0006)
- Modify: `docs/adr/README.md` (index row), `docs/design.md` (replace the "needs an ADR" entry at `:333-336` with the link)
- Test: `packages/core/test/permissions.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `PERMISSIONS`, `can()` (`packages/core/src/permissions.ts`).
- Produces: no code. The four decisions below are consumed by Task 2 (the `review_requested` column and badge) and Task 11 (export carries no comments).

This is the one task in the phase with no red step: the deliverable is a decision, and the test it leaves behind is a **pin** that passes on the day it is written. Say so in the test's own comment rather than manufacturing a failure.

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

- [ ] **Step 4: Update the index and design.md**

Add the row to `docs/adr/README.md`'s table with status Accepted. Replace `docs/design.md:333-336`'s "needs an ADR" entry with a link to it.

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

**Review Focus 1 lands here.** `TV_REFERENCES_Q_ROW` (`packages/db/src/repo/banks.ts:99-101`), `testsUsingQuestion` (`:165`) and `testsUsingBank` (`:188`) each gain `AND tv.published_at IS NOT NULL`, because this task is the first to write a `test_version` row that is not published.

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
  await publishDraftVersion(db, ws, id, T);                        // Task 10's function; stub the row in this task's fixture
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
- Consumes: `getTest`, `createTest` (Task 2); `listQuestions`, `listBanks`, `QuestionRow`, `BankRow` (`packages/db/src/repo/banks.ts`); `validateTest`, `Section`, `QuestionSource`, `SourceFixed`, `SourcePool`, `SourceSets`, `Test` (`@pariksha/core`); `ReorderableList` (`apps/web/src/components/authoring/ReorderableList.tsx`); `RenderedHtml` (`apps/web/src/components/authoring/RenderedHtml.tsx`).
- Produces:
  ```ts
  // packages/db/src/repo/test-document.ts — pure mappers, re-exported from
  // packages/db/src/index.ts and NOT from repo/index.ts (they are not scoped
  // repository functions; repo/question-document.ts is the same arrangement)
  export type TestSettings = Omit<Test, "$schema" | "format" | "name" | "slug" | "sections">;
  /** A `Section` whose `source` names `qst_`/`bnk_` row IDs rather than the bank file's own. */
  export type StoredSection = Section;
  export interface TestDocumentBody { settings: TestSettings; sections: StoredSection[] }
  export interface IdRefs {
    questionIdByRef: Map<string, string>; refByQuestionId: Map<string, string>;
    bankIdByFile: Map<string, string>;    fileByBankId: Map<string, string>;
  }
  export function toTestDocument(test: TestRow, body: TestDocumentBody, refs: IdRefs): Test;
  export function toStoredBody(doc: Test, refs: IdRefs): TestDocumentBody;

  // packages/db/src/repo/tests.ts (added)
  export interface TestVersionRow { id: string; testId: string; version: number; body: TestDocumentBody; publishedAt: number | null; createdAt: number }
  export const getDraftVersion: ScopedFn<[testId: string], TestVersionRow | null>;
  export const putDraftVersion: ScopedFn<[testId: string, body: TestDocumentBody, now: number], TestVersionRow>;

  // apps/web/src/lib/api.ts
  export interface DraftPatch { settings?: Partial<TestSettings>; sections?: StoredSection[] }
  // on ApiClient:  draft(testId): Promise<TestVersionRow>;  patchDraft(testId, patch: DraftPatch): Promise<TestVersionRow>

  // apps/web/src/components/testbuilder/SectionList.tsx
  export function SectionList(props: {
    sections: readonly StoredSection[];
    draw: Readonly<Record<string, { matching: number; wanted: number }>>;  // UX-15, from the server
    setPoints: Readonly<Record<string, { set: string; points: number }[]>>; // UX-16
    onChange: (next: StoredSection[]) => void;
    openSectionId: string | null;
    onOpenSection: (id: string | null) => void;
  }): JSX.Element;
  export function QuestionPickerDrawer(props: {
    bankId: string | null; selected: readonly string[];
    onConfirm: (questionIds: string[]) => void; onCancel: () => void;
  }): JSX.Element;
  ```

**Routes.** Two, and they are the only ones Tasks 4 through 9 need — each of those tasks widens this payload rather than adding a route of its own.

| Method | Path | Guard | Budget (estimate — measure and pin) |
| --- | --- | --- | --- |
| GET | `/api/v1/workspaces/:id/tests/:testId/draft` | `tests.edit` | 5 |
| PATCH | `/api/v1/workspaces/:id/tests/:testId/draft` | `tests.edit` | 7 |

`GET …/draft` returns the draft body **and** the derived numbers the builder cannot compute — `draw` (UX-15's "10 drawn from 14 matching", one grouped query over `question`, never one per section) and `setPoints` (UX-16's balance strip). Computing them server-side is the same rule as Review Focus 4: the browser renders what it is given.

**PATCH replaces each named top-level block whole and merges nothing below it** (Review Focus 3). A body `{ settings: { access: {...} } }` replaces `settings.access` entirely and leaves `settings.timing` untouched; `{ sections: [...] }` replaces the whole array.

**Save-time versus publish-time, per rule.** Save-time, because the stored document would otherwise be unreadable or dangerous: the body must parse against `schemas/test-1.json` (`additionalProperties: false` is what catches a merged `sets` key inside a `pool` source), and every `fixed`/`sets` question ID and every `pool` bank ID must name a row in **this workspace** — a reference to another tenant's row is a cross-workspace read waiting to happen, not a half-built draft. Everything else is publish-time: an empty section (`UX-13`), a pool that matches fewer than `count` (`UX-15`), sets of unequal points (`UX-16`), a section with no title.

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
</content>
