# Phase 6 — Candidate Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first time a person who is not an organiser touches Pariksha. A candidate opens a link, gets past the test's access mode, consents, registers, and sits a paper pinned to one published version and one layout — answering all 12 types, with every change saved inside two seconds and queued when the network drops, against a clock the server owns and navigation rules the server refuses rather than hides, ending in a receipt and a result the release setting gates. Nothing in any response carries a key, an explanation or another candidate's data.

**Architecture:** Four seams, and three of them are about *who is asking*. **Candidate traffic is a third authority.** Phases 3 and 4 had two: a signed-in actor with a workspace membership, and a handful of deliberately public routes. A candidate is neither — [ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md) is explicit that candidate access gives nobody a user row — so Phase 6 mounts every candidate route under `/api/v1/run/…` ([`docs/PRD.md`](../../PRD.md#rest-api-v1), the REST API table's "Candidate runtime" row), authorised by a 256-bit attempt token whose hash is the only stored form (`S-06`), and declares a `ROUTE_AUTH` table so "unguarded" can never again mean "unexamined". **Everything downstream of that authority is ordinary.** The token lookup produces a `workspace_id`, and from that point every read is a `scoped()` repository function exactly as Phase 2 built them — the pre-workspace read lives in its own module, not in an exemption list ([ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md)). **The paper is pinned, not recomputed.** `layoutForAttempt` runs once at `/start` and its output is `attempt.layout_json`; every later request reads that row, which is what makes a refresh, a crash and a two-minute network drop reproduce the same questions in the same order — and what makes attempt-scoped media authorisation cost nothing. **The server decides, the browser displays.** The timer, the navigation rule, the registration validation and the result gate each exist twice — once in the browser so the candidate sees why, once on the server because that is the only copy that counts ([`docs/test-format.md:110`](../../test-format.md)).

**Tech Stack:** Nothing new. Hono 4, Drizzle, `@pariksha/core`, React 19, Vite, Vitest, Testing Library, `jest-axe`, `zod` — all already in the workspace. No router dependency (the organiser app hand-rolls routing in `apps/web/src/routes/organiser.tsx` and the candidate app follows it), no drag-and-drop dependency, no CSV, captcha or IndexedDB library. The one new third-party *origin* — Cloudflare Turnstile — is escalated rather than decided; see [Escalated](#escalated--needs-a-human-decision).

**Spec:** [`docs/PRD.md`](../../PRD.md#candidate-experience) `C-01`–`C-09`, `T-12`–`T-22`, `S-06`, `S-07`, `S-10`, `S-11`, `S-12`, `AC-12`–`AC-16`, `AC-22`, the non-functional table · [`docs/test-format.md`](../../test-format.md) `timing`, `access`, `consent`, `registration_form`, `release` · [`schemas/test-1.json`](../../../schemas/test-1.json) · [`docs/question-format.md`](../../question-format.md) · [`docs/ROADMAP.md`](../../ROADMAP.md#phase-6--candidate-runtime) · [`DESIGN.md`](../../../DESIGN.md) §"The clock kills the canvas", `palette-square`, `timer-chip`, `consent-row` · [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md), [ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md), [ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md) · [`SECURITY.md`](../../../SECURITY.md)

## Precondition

**Phases 4 and 5 are both complete before this phase starts.**

**Phase 4** is on branch `phase-4/bank-crud-and-browser` (tip `f4d4f7a`) and is not yet merged to `main`. Every web task here consumes its `apps/web/src/render/markdown.ts` (`renderMarkdown`, `hasLatex`) and `apps/web/src/components/authoring/RenderedHtml.tsx`, and Task 7 consumes `apps/web/src/components/authoring/ReorderableList.tsx` by name. Every API task consumes `packages/db/src/repo/banks.ts`'s `listQuestions` / `getQuestion` and `packages/db/src/repo/question-document.ts`'s `toQuestionDocument`, and `apps/api/src/routes/media.ts`'s storage-key convention. Do not re-implement any of them; they appear in `Consumes:` by name. **Phase 4 explicitly handed this phase one open item** — `GET /api/v1/workspaces/:id/media/:key` is guarded by `banks.edit` (`apps/api/src/app.ts:199`), so a candidate sitting an exam cannot fetch a question's images. Task 7 closes it.

**Phase 5** delivers the test builder and the published test version. This plan consumes it as a *declared interface* and not as read code: see [Assumed Phase 5 interface](#assumed-phase-5-interface), a numbered table of every Phase 5 artefact this plan touches with the document and clause each was derived from. Reconcile that table against Phase 5's plan before Task 1 starts; a row that turns out wrong is a localised change, a row nobody checked is a rewrite.

**From Phase 3**, every task consumes `apps/api/src/middleware/authenticate.ts`, `apps/api/src/errors.ts`'s `ApiError`, `apps/api/src/auth/tokens.ts`'s `randomToken` / `sha256Hex`, `apps/api/src/email/adapter.ts`, and `packages/db/src/repo/identity.ts`'s `insertAuthToken` / `consumeAuthToken`. **From Phase 2**, `packages/db/src/repo/attempts.ts` already contains `createCandidate`, `createAttempt`, `getAttempt`, `upsertResponse`, `readResponse`, `listResponses` and `appendEvents`, and `attempt`, `candidate`, `response`, `event`, `test_version` and `set` are already in `TABLE_MANIFEST`. This phase adds columns and two tables; it does not re-create those.

## Global Constraints

- Everything from Phases 1–5 still holds: Node 22, pnpm, strict TypeScript, DCO sign-off on every commit, epoch-millisecond timestamps everywhere, one error envelope `{ "error": { "code", "message", "details"? } }`, 404-not-403 across workspaces.
- `tsconfig.base.json` runs `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `erasableSyntaxOnly`. **`erasableSyntaxOnly` bans TypeScript parameter properties** — a constructor writes its own fields.
- **Every authenticated route still mounts under `/api/v1/workspaces/:id/…`.** `guard()` in `apps/api/src/middleware/authorize.ts:106` reads `c.req.param("id")` and throws when it is absent. Nothing in this phase changes that, because **no route in this phase is authenticated in that sense** — see Task 1's ruling. The one organiser-side route this phase touches (`GET /api/v1/workspaces/:id/media/:key`) keeps its guard exactly as it is.
- **Subrequest budgets are measured, not declared.** Every route this phase mounts adds a line to `ROUTE_BUDGETS` in `apps/api/src/app.ts` or `apps/api/test/budget.test.ts:38` fails, and the number is pinned with `toBe` against `countingDeps` — the idiom `apps/api/test/export/round-trip.test.ts:455` established, not `toBeLessThanOrEqual`. **The authentication floor of 2 does not apply here.** `authenticate` (`apps/api/src/middleware/authenticate.ts:39`) calls `readSession` only when a signed session cookie is present; a candidate request carries none, so it spends nothing. A candidate route's cost is exactly what the route itself reads and writes, and every budget in this plan reads `MEASURE` until an implementer measures it.
- **The hot path is one answer save.** The PRD's non-functional table: "the hottest path — saving one answer — must stay at one D1 write plus at most one R2 call". `upsertResponse` (`packages/db/src/repo/attempts.ts:149`) is already that one write. The attempt-token lookup is a *read* and is additional; the measured total is expected to be 2 and must be pinned, not estimated.
- Scoped repository functions go through `packages/db/src/repo/index.ts` and are registered in `REPO_FUNCTIONS`, which `packages/db/test/repo/scoping.test.ts` enumerates. The two pre-workspace candidate reads do **not** go there — see Task 1.
- **No hex colour literal in `apps/web/src`** outside the two generated token files; `apps/web/test/no-hex-colors.test.ts` also catches `rgb()`, `hsl()`, `oklch()` and the named colours. Every value in the candidate runtime comes from `DESIGN.md` through `tokens.css` / `tokens.ts`.
- **The candidate's budget is 300 KB gzipped** (PRD non-functional table) and Phase 4 already spent 41 KB of it on `markdown-it`. KaTeX's further 76 KB stays behind the dynamic import ([ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md)); `apps/web/test/bundle.test.ts` is extended to the new `exam` entry in Task 1 and re-run by every task that touches it. **No organiser code may be statically reachable from the exam entry** — the existing `ADMIN_PATH_RE` guard (`apps/web/test/bundle.test.ts:57`) is pointed at it.
- **No third-party browser request** (`S-11`), CSP `default-src 'self'`, in two files that must change together (`apps/api/src/middleware/security.ts:1`, `apps/web/public/_headers`). `apps/web/test/hosting.test.ts:25` asserts `_headers` matches no `https?://` at all. Task 4's bot protection collides with this head-on and is escalated, not decided.
- Accessibility is a requirement, not a later pass (`O-04`, WCAG 2.1 AA), **and this is the phase where it matters most**: a candidate cannot choose a different tool, cannot come back tomorrow, and is under a clock. Keyboard reachable, labelled, visible focus, accessible name a superset of the visible label (WCAG 2.5.3), a `jest-axe` assertion per screen, real `userEvent` key events in any test claiming keyboard coverage, and every palette and banner state carrying a non-colour signal (`DESIGN.md`: "Colour is never the only carrier here").
- **Tests drive the production path.** A test that composes helpers beside the real call site proves nothing; Phase 4 was sent back for it twice. Every API assertion here goes through `app.request()` on a real `createApp(deps)`, and every navigation, timer and scrubbing assertion is made against the route, not against the function the route happens to call.
- **Everything is testable locally** — in-memory SQLite, the in-memory storage adapter, the console email adapter, jsdom, and `deps.http` for any outbound call. No task may require a deployed Worker, a Cloudflare credential or a live identity provider.

## Assumed Phase 5 interface

Phase 5 is being planned in parallel with this document and its output could not be read. Every artefact of Phase 5 that this plan consumes is listed here with the document and clause it was derived from. **Read** means the shape exists today, in committed code or a committed schema, and was verified. **Assumed** means it was derived from a specification and no code expresses it yet. Each row is a contract to reconcile when Phase 5's plan lands; reconcile the whole table before Task 1.

| # | Artefact this plan consumes | Derived from | Read or assumed |
| --- | --- | --- | --- |
| 1 | `test_version` row: `id`, `workspace_id`, `test_id`, `version`, `settings_json`, `sections_json`, `published_at`; unique `(test_id, version)` | `packages/db/src/schema/columns.ts:233` (`TABLE_MANIFEST`), written in Phase 2 | **Read** |
| 2 | `test_version.settings_json` holds the `pariksha/test@1` document **minus** `format`, `name`, `slug` and `sections` — that is, `{ timing, access, consent, registration_form, proctoring, scoring, release, retention, branding }` | `docs/PRD.md`'s data-model table names five of them ("settings_json (timing, access, proctoring, release, form)"); `docs/test-format.md:12-29` gives the whole document shape. The other four are assumed into the same blob because there is nowhere else for them to live | **Assumed** — the riskiest row here. If Phase 5 splits them across columns, every `settings.X` read in Tasks 1–11 changes path and nothing else |
| 3 | `Section`, `QuestionSource`, `SourceFixed`, `SourcePool`, `SourceSets`, `SetDefinition`, `SetAssignment`, `PoolFilter` | `packages/core/src/types.ts:195-236` | **Read** |
| 4 | `layoutForAttempt({ sections, bank, seed, setNo }) → AttemptLayout`, `assignSet({ sets, assignment, registrationIndex, candidateId, listValue })`, `AttemptLayout = { sections: { sectionId, questionIds, optionOrder }[]; setNo? }`, `PoolTooSmallError` | `packages/core/src/select.ts:10,81,113,118`, all exported from `packages/core/src/index.ts` | **Read** |
| 5 | The shuffle seed is **not** a Phase 5 artefact. Phase 6 mints it per attempt (Task 5) and pins the resulting layout in `attempt.layout_json`, so nothing downstream ever reads a seed | `packages/db/src/repo/attempts.ts:72` — "The question and option order is stored per attempt, so a refresh or a crash resumes the same paper (T-10, C-06)" | **Assumed.** If Phase 5 stores a per-version seed, Task 5 uses it instead and the pinning is unchanged |
| 6 | `AccessMode = "link_code" \| "invite_only" \| "email_code" \| "sso"`; `TestAccess = { mode, access_code?, candidate_list?, allow_email_domains?, allow_ip_ranges?, captcha? }`, `captcha` defaulting to `true` | `packages/core/src/types.ts:244-253`; `schemas/test-1.json` `$defs.access`, which also requires `access_code` when `mode` is `link_code` | **Read** |
| 7 | Registration form `{ title?, description?, fields: FormField[] }` with `fields` non-empty; `FormField = { id matching ^[a-z0-9_]{1,40}$, type (11 values), label, help?, required?, unique?, options?, link_text?, link_target?, validation? }`; `validation = { min_length, max_length, pattern, pattern_message, min, max, integer, decimals, allowed_domains, check_reachable, default_country }` | `schemas/test-1.json` `$defs.form`, `$defs.formField`, `$defs.validation`; `docs/test-format.md:87-110` | **Read as JSON Schema, assumed as TypeScript.** `packages/core/src/types.ts:190` says `registration_form` is "not modelled here yet. Add each when a phase needs it." If Phase 5 adds the types, Task 3 imports them; if not, Task 3 adds them to that same file |
| 8 | Timing `{ timezone?, opens_at?, closes_at?, latest_start_at?, duration_minutes (required, ≥ 1), navigation ("free" \| "linear" \| "per_section", default "free"), attempts_allowed (default 1), cooldown_minutes, counted_attempt, warn_at_minutes (default [10, 2]), late_sync_grace_seconds (default 30) }` | `schemas/test-1.json` `$defs.timing`; `docs/test-format.md:46-61` | **Read as JSON Schema, assumed as TypeScript** — same note as row 7 |
| 9 | `TestRelease = { when: "never" \| "on_submit" \| "on_date"; at?; show?: "score_only" \| "score_and_sections" \| "full_review" }`, `show` defaulting to `score_only`, `at` required when `when` is `on_date` | `packages/core/src/types.ts:255`; `schemas/test-1.json` `$defs.release` | **Read** |
| 10 | Consent `{ version: string; text: string }`, shown before registration, with the version and the acceptance time stored per candidate | `schemas/test-1.json` `consent`; `docs/test-format.md:76-85`; `S-12`. `candidate.consent_version` already exists (`columns.ts:265`) | **Read as JSON Schema, assumed as TypeScript** |
| 11 | Branding is split: logo, primary colour and footer text come from `workspace.branding_json`; `start_message` and `finish_message` come from the test version's `branding` block | `T-23` — "Branding per workspace (logo, primary colour, footer text) **and** an optional custom message on the start and finish pages". `workspace.branding_json` exists (`columns.ts:89`) and `schemas/test-1.json` `branding` carries all five | **Assumed.** Both places can hold all five, and that PRD sentence is the only thing splitting them. If Phase 5 puts all five on the version, Task 1 reads one object instead of two |
| 12 | A published test is reached by `(workspace.slug, test.slug) → test.current_version → test_version`, and `test.status` is one of `draft \| scheduled \| open \| closed \| archived` | `T-02` (the candidate URL is `/<workspace-slug>/<test-slug>`), `T-04`; `packages/db/src/repo/tests.ts:95` already writes `current_version` and `status` on publish | **Assumed.** Phase 2's `publishTestVersion` hard-codes `status = "open"` and never writes `scheduled`; Phase 5 must fix that, and Task 1's availability-window check depends on it |
| 13 | Invite links for `invite_only` are minted by Phase 5 (`POST /tests/{id}/invites`, PRD REST table) as single-use rows in the existing `auth_token` table with `kind = "run_invite"` and a payload naming the test version and the candidate-list row | `S-06`, `T-20`; `packages/db/src/repo/identity.ts`'s `insertAuthToken` / `consumeAuthToken`, whose `UPDATE … WHERE used_at IS NULL … RETURNING` already makes a replay find nothing | **Assumed.** Task 2 builds only the *consume* side, and its tests mint through `insertAuthToken` directly — so Task 2 is executable whether or not Phase 5's minting route exists |
| 14 | The uploaded candidate list (`access.candidate_list`, `T-21`) is stored by Phase 5 with a lookup by identifier | `T-21`; `docs/test-format.md:68` | **Assumed, and deferred.** Issue [#66](https://github.com/SriSatyaLokesh/pariksha/issues/66) names only the four modes; Task 2 implements `allow_email_domains` and `allow_ip_ranges` (which `docs/test-format.md:72` makes optional for every mode) and leaves the candidate-list allowlist to whichever phase owns the list — see [Known deferrals](#known-deferrals-recorded-so-they-are-not-rediscovered-as-bugs) |
| 15 | The short link `/t/<6-char code>` and the QR code (`T-02`) | `T-02`; `docs/ROADMAP.md` Phase 5 "Delivers" | **Assumed, not consumed.** Phase 6 resolves only the long URL; a short link that redirects to it needs nothing from this phase |
| 16 | Pre-publish warnings (`T-11`) have already run, so a published version's pools are satisfiable and its sets are balanced | `docs/test-format.md:172`; `T-11` | **Assumed.** Task 5 still catches `PoolTooSmallError` at `/start` and refuses the attempt with a message an organiser can act on — a published version goes stale the moment a drawn question is deleted |

## Review Focus

1. **An organiser route that silently escapes the guard, because Phase 6 made "unguarded" normal.** Until this phase, a route in `app.ts` either carried `requires()` / `requireMember()` or was one of six obviously public ones, and the gap was small enough to see by reading `createApp`. `authorization.test.ts:153` enumerates only the *guarded* routes — `guardedRoutes(app)` is built from the `GUARDS` WeakMap, so a route with no guard contributes nothing and asserts nothing. Phase 6 mounts a dozen deliberately unguarded routes, and from the day it lands "no `requires()` on this line" is an ordinary sight. The failure is a Phase 7 snapshot route or a Phase 8 results route mounted without a guard: `routeGuards(app)` still equals `ROUTE_ACTIONS`, `budget.test.ts` still passes because the budget line was added, and the route is open to the internet. The structural answer is a third table, `ROUTE_AUTH`, naming every mounted endpoint's authority as `workspace`, `attempt` or `public`, checked in both directions against the live route table — with the `public` set asserted by literal value, so widening it is a diff a reviewer sees. — Task 1, and every later task adds a line.
2. **The attempt-scoped media path handing out the whole workspace's images.** The obvious implementation of `GET /api/v1/run/attempt/media/:key` is "the attempt token tells me the workspace, so serve `media/<workspaceId>/<key>`" — and it works perfectly for every candidate in every test. It also authorises every image in the workspace to every candidate: the diagram in a question they were not given, in a bank belonging to a different test, in a draft nobody has published. Nothing fails — the candidate's own images load, the route is 200, `jest-axe` is silent, the budget is 1. The keys are SHA-256 content addresses so guessing is not the threat; a candidate who sat an earlier version of the test, or who read a leaked bank export, is. The answer is that Task 5 collects every `media.src` key of the selected questions into `layout_json.media` at attempt creation, and the route's authorisation is membership in that pinned array — no extra subrequest, and the set it covers is exactly the paper the candidate was given. — Task 7.
3. **The offline queue acknowledging a save the server refused.** `upsertResponse` answers `{ stored: false }` for a stale `client_seq` and the route answers 200 either way, which is correct: a late retry of sequence 4 after 5 must not regress the answer. A queue that drains on HTTP 200 therefore drains correctly on that case and *also* drains on the 409 the deadline check returns (Task 9) and the 403 the navigation check returns (Task 10), marks the answer **Saved**, and drops it. Two minutes offline across a section boundary then loses precisely the answers the candidate was most careful about, and `AC-14` still passes because its fixture never crosses a refusal. The queue must distinguish three outcomes — *accepted*, *superseded* (drop, the server holds newer), *refused* (keep, and say so) — and the banner must never read "Saved" for the third. — Tasks 8, 9 and 10; the test that proves it belongs to Task 8.
4. **The countdown re-anchoring itself to the wall clock.** The server half of `AC-13` is easy and will be right: `deadline_at` is a stored epoch, every write compares it to `deps.now()`, and a candidate who moves their system clock changes nothing. The display half is where it goes wrong, and it looks correct in every test that never moves a clock: a countdown computed as `deadlineAt - Date.now()` is wrong the instant the machine's clock is corrected, wakes from sleep, or is deliberately changed — and the candidate sees either an hour of free time or a sudden panic, both of which arrive as a support ticket that reads like data loss. Remaining time must come from the server's own reading, carried on every response, plus a monotonic `performance.now()` delta since that reading, re-synced on `visibilitychange`. The test moves `Date.now` forward by an hour and asserts the rendered countdown does not move. — Task 9.
5. **The scrubber tested field-by-field instead of scanned.** A per-type suite of `expect(scrubbed).not.toHaveProperty("key")` is easy to write, reads as thorough, and is written once — against the twelve types that exist on the day it is written. It then says nothing about the `rubric` Task 7 surfaces, the `model_answer` a `long_answer` carries, the `blanks[].accept` inside `extra_json`, the `numeric` key's `tolerance`, or the snapshot URL Phase 7 adds. `AC-22` does not ask for that suite; it asks for "an automated test that scans every response". The scan is the gate: a fixture whose every key, explanation, rubric and other-candidate value is a unique sentinel string, replayed through every route `ROUTE_AUTH` marks `attempt` or candidate-`public`, asserting no sentinel appears in any body. Enumerating from `ROUTE_AUTH` rather than from a hand-written list is what makes a route added in Phase 7 either scanned or a failing test. — Task 12; the per-type assertions stay beside it as documentation.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/schema/columns.ts` | Modified: the Phase 6 columns on `attempt`, and the `candidate_unique` and `rate_limit` tables |
| `packages/db/migrations/{sqlite,pg}/0002_*.sql` | The Phase 6 schema delta, generated for both dialects |
| `packages/db/src/repo/candidate-entry.ts` | **Not re-exported from `repo/index.ts`.** The two pre-workspace reads a candidate request makes before any workspace is known: resolve a published test by slug pair, resolve an attempt by token hash. [ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md)'s pattern, as a third module rather than a growing `identity.ts` |
| `packages/db/src/repo/run.ts` | Workspace-scoped candidate-runtime reads and writes: unique-field claims, attempt progress, submission, rate-limit buckets. All `scoped()`, all in `REPO_FUNCTIONS` |
| `packages/core/src/registration.ts` | `validateRegistration(form, values)` — the one copy of `T-17`'s rules, called by the server and by the browser |
| `apps/api/src/middleware/attemptContext.ts` | The attempt-token authority: cookie → hash → attempt row → `c.var.attempt`. Registers itself the way `authorize.ts`'s `GUARDS` does, so the live route table can be read back |
| `apps/api/src/run/entry.ts` | The access gate: the four modes, the allowlists, and the short-lived entry token |
| `apps/api/src/run/registration.ts` | Consent capture, server-side form validation, unique-field enforcement |
| `apps/api/src/run/ratelimit.ts` | Per-test and per-attempt buckets. Never per IP (`S-07`) |
| `apps/api/src/run/captcha.ts` | Turnstile / hCaptcha siteverify over `deps.http`; a no-op when unconfigured |
| `apps/api/src/run/attempt.ts` | `/start`: set assignment, layout pinning, media-key pinning, deadline, token issue |
| `apps/api/src/run/navigation.ts` | `free`, `linear`, `per_section`, decided from `layout_json` and `attempt.max_index` |
| `apps/api/src/run/clock.ts` | The deadline, the section deadline, the late-sync grace, `remainingMs` |
| `apps/api/src/run/scrub.ts` | `forCandidate()` — the one place a stored question becomes a candidate-facing one, and the one place `media.src` is rewritten |
| `apps/api/src/run/bounded.ts` | `matchBounded()` — the execution-time bound on every author-written regex run against candidate input (issue [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129)) |
| `apps/api/src/routes/run.ts` | Every `/api/v1/run/…` route |
| `apps/api/src/app.ts` | Modified: mount `runRoutes`, extend `ROUTE_BUDGETS`, add `ROUTE_AUTH` |
| `apps/api/src/instrument.ts` | Modified: `mountedEndpoints()` and `routeAuthorities()`, both read off the live route table |
| `apps/web/exam.html`, `apps/web/src/exam-main.tsx` | The third Vite entry. No organiser code is statically reachable from it |
| `apps/web/src/lib/run.ts` | The candidate app's one door to the API, and the offline queue |
| `apps/web/src/routes/exam.tsx` | The candidate screens: landing, access, consent, registration, runner, receipt, result |
| `apps/web/src/components/exam/Palette.tsx` | `C-04`'s numbered palette; `DESIGN.md`'s four `palette-square` variants, each with a non-colour carrier |
| `apps/web/src/components/exam/Clock.tsx` | Both countdowns, anchored to `performance.now()`, never to `Date.now()` |
| `apps/web/src/components/exam/SaveBanner.tsx` | Saving / Saved / Offline / Not saved (`C-05`) |
| `apps/web/src/components/exam/Calculator.tsx` | `allow_calculator`; four functions, keyboard-operable, no dependency |
| `apps/web/src/components/exam/ViewControls.tsx` | Font size and high contrast (`C-04`, `DESIGN.md` §"High contrast") |
| `apps/web/src/components/exam/answer/*.tsx` | Candidate *input* for all 12 types, in Phase 4's three families |
| `apps/web/src/styles/exam.css` | The runner's cream-and-ink canvas, every value from tokens |

---

## Task 1: Candidate landing and start pages, and the third authority (#65, P6.1)

**Files:**
- Create: `packages/db/src/repo/candidate-entry.ts`, `packages/db/test/repo/candidate-entry.test.ts`
- Create: `apps/api/src/routes/run.ts`, `apps/api/test/run/landing.test.ts`, `apps/api/test/route-authority.test.ts`
- Create: `apps/web/exam.html`, `apps/web/src/exam-main.tsx`, `apps/web/src/routes/exam.tsx`, `apps/web/src/lib/run.ts`, `apps/web/src/styles/exam.css`
- Create: `apps/web/test/exam/landing.test.tsx`
- Create: `docs/adr/00NN-candidate-runtime-is-a-third-request-authority.md` (**the next free number at execution time** — `docs/adr/README.md` and `docs/adr/0000-template.md`; 0006 is the highest today)
- Modify: `packages/db/src/index.ts` (export the new module deliberately outside `repo/index.js`, beside `identity.js` and `question-document.js`), `apps/api/src/app.ts`, `apps/api/src/instrument.ts`, `apps/web/vite.config.ts` (a third Rollup input), `apps/web/public/_headers` (`/exam.html` `X-Robots-Tag: noindex`, and the SPA fallback), `apps/web/test/bundle.test.ts`, `apps/web/test/hosting.test.ts`, `docs/adr/README.md`

**Interfaces:**
- Consumes: `DbClient`, `ApiError`, `mountedRoutes`, `countingDeps`, `guardOf`, `RenderedHtml`, `renderMarkdown`, `tokens.css`.
- Produces:
  ```ts
  // packages/db/src/repo/candidate-entry.ts — pre-workspace by nature.
  // Exported from the package root, deliberately NOT from repo/index.ts.
  export interface PublishedTest {
    workspaceId: string; testId: string; testVersionId: string;
    version: number; status: string; name: string;
    settings: unknown; sections: unknown; branding: unknown;  // workspace.branding_json
  }
  /** One join: workspace -> test -> test_version at test.current_version. */
  export function resolvePublishedTest(
    db: DbClient, workspaceSlug: string, testSlug: string,
  ): Promise<PublishedTest | null>;

  // apps/api/src/instrument.ts
  /** "METHOD /path" for every mounted handler, middleware excluded. */
  export function mountedEndpoints(app: Hono<AppBindings>): string[];
  /** Read off the live table the way routeGuards() is. */
  export function routeAuthorities(app: Hono<AppBindings>): Record<string, RouteAuthority>;

  // apps/api/src/app.ts
  export type RouteAuthority = "workspace" | "attempt" | "public";
  export const ROUTE_AUTH: Record<string, RouteAuthority>;
  ```

### Ruling: candidate traffic is a third request authority, addressed under `/api/v1/run/…`

This is the structural decision the rest of the phase rests on, so it is made here, in full, with its citations.

**Candidate routes do not mount under `/api/v1/workspaces/:id/…` and carry no `requires()` guard.** [`docs/PRD.md`](../../PRD.md#rest-api-v1)'s REST API table names them literally — "Candidate runtime | `POST /run/{test}/register`, `/start`, `PUT /run/attempt/answer`, `POST /run/attempt/events`, `/snapshot`, `/submit` **(attempt token)**" — and `S-06` names the authority: "Each attempt gets a random 256-bit token; only its hash is stored. Every request is checked against the token, the attempt status and the server deadline." [ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md) closes the alternative: "Candidate access is not organiser auth. The four candidate access modes (`T-20`) are per-test configuration, not accounts … Nothing in this decision gives a candidate a user row." A candidate has no `user`, so no `session`, so no `membership`, so `guard()` has nothing to find; putting a workspace ID in the candidate's URL would also hand a stranger a workspace identifier for free, which is the opposite of the 404-not-403 posture `authorize.ts:8` was written for.

**`{test}` is the slug pair.** `T-02` fixes the candidate URL at `/<workspace-slug>/<test-slug>`, so the only identifier a candidate holds is a pair of slugs: `GET /api/v1/run/:workspaceSlug/:testSlug`.

**What this means for `GUARDS` and `authorization.test.ts`: nothing changes, and that is the problem.** No candidate route calls `requires()` or `requireMember()`, so none enters the `GUARDS` WeakMap, so `guardedRoutes(app)` is unchanged and `authorization.test.ts:153`'s "every guarded route is covered by this table" and `:159`'s "the table names the action each guard actually enforces" both keep passing untouched. That is correct — and it is exactly Review Focus item 1: those two tests only ever saw guarded routes, and after this phase an unguarded route in `app.ts` no longer looks out of place. So Phase 6 adds the missing half:

```ts
// apps/api/src/app.ts
export type RouteAuthority = "workspace" | "attempt" | "public";

/**
 * What authorises every mounted endpoint. `ROUTE_ACTIONS` says which action
 * a *guarded* route enforces; this says which routes are guarded at all, so
 * an organiser route mounted without `requires()` is a failing test rather
 * than an open endpoint. Keyed "METHOD /path", like ROUTE_ACTIONS.
 */
export const ROUTE_AUTH: Record<string, RouteAuthority> = { /* … */ };
```

and `apps/api/test/route-authority.test.ts`, which checks it in four directions. Three middleware registries now exist and they are complementary, not duplicated: `GUARDS` says *which action*, `ROUTE_AUTH` says *which authority*, `ROUTE_BUDGETS` says *what it may spend*.

**And the data layer stays absolute.** `resolvePublishedTest` and (in Task 5) `readAttemptByTokenHash` cannot take a workspace ID, because the workspace ID is what they *produce* — the exact admission test [ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md) sets: "a candidate function must be unable to know a workspace, not merely awkward to give one." They do **not** join `identity.ts`: that ADR's own "to watch" section says "If a function that is not about users or sessions is proposed for `identity.ts`, the right response is almost always that it *can* take a workspace ID and should", and a candidate entry read is not about users or sessions. They get a third module, `repo/candidate-entry.ts`, with its own pinned set and its own both-directions test, copying `packages/db/test/repo/identity.test.ts` exactly. Every read after the resolution — the branding, the questions, the responses, the audit row — goes through an ordinary `scoped()` function with the resolved `workspaceId`.

**Path collision.** `/api/v1/run/attempt/answer` and `/api/v1/run/:workspaceSlug/:testSlug` can both match a three-segment path. Hono's routers prefer a static segment to a parameter, but this plan pins that rather than assuming it, and `resolvePublishedTest` additionally refuses `workspaceSlug === "attempt"` so a workspace slug cannot shadow the attempt routes even if the router order ever changes.

### What the landing route returns

`GET /api/v1/run/:workspaceSlug/:testSlug` answers `C-01` in one read and nothing more: workspace branding, test name and description, duration, total question count, the section list (title, question count, time limit), the proctoring profile name, the supported-device rule, the availability window and the timezone, the access mode (so the browser knows which gate to render), and `consent` is **not** included — it arrives after the gate, in Task 3. Question *counts* come from `sections_json` alone (a `fixed` or `sets` source counts its list, a `pool` source reports its `count`), so the route never touches the bank and never risks naming a question.

`C-01`'s "Check my device" button: Phase 6 ships the button and the report; Phase 7 makes it block. `docs/ROADMAP.md`'s Phase 7 "Delivers" owns "device and browser gating" and "the camera requirement" — the *gate* — while `C-01` puts the button on the landing page, which is this phase. So `deviceReport()` here is a pure function over `window.innerWidth`, `matchMedia("(pointer: fine)")` and the browser name and version against the PRD's supported-browser row, rendering what it found and what the test requires. It does not ask for the camera and it does not prevent starting.

**Routes.** Every budget is `MEASURE`: an implementer sets it from `countingDeps` and pins it with `toBe`. The floor is zero, not two — no session cookie, no `readSession`.

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug` | `public` | `MEASURE` (expected 1: one join) |

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/repo/candidate-entry.test.ts — ADR 0006's pattern, third module
const UNSCOPED_BY_DESIGN = ["resolvePublishedTest"];   // Task 5 adds readAttemptByTokenHash

it("the unscoped set is exactly the one named here", () => {
  expect(new Set(functionNames(candidateEntry))).toEqual(new Set(UNSCOPED_BY_DESIGN));
});

it("no unscoped function reaches the scoped barrel or its registry", () => {
  for (const name of UNSCOPED_BY_DESIGN) {
    expect(repo, name).not.toHaveProperty(name);
    expect(REPO_FUNCTIONS, name).not.toHaveProperty(name);
  }
});

it("resolves a published test from the slug pair alone, in one statement", async () => {
  const counting = countingClient(db);
  const found = await resolvePublishedTest(counting.db, "alpha", "aptitude");
  expect(found).toMatchObject({ workspaceId: wspA, version: 1, status: "open" });
  expect(counting.count()).toBe(1);
});

it("two workspaces may hold the same test slug and resolve to different tests", async () => {
  expect((await resolvePublishedTest(db, "alpha", "aptitude"))!.testId)
    .not.toBe((await resolvePublishedTest(db, "beta", "aptitude"))!.testId);
});

it("an unpublished test (current_version null) resolves to null", async () => {
  expect(await resolvePublishedTest(db, "alpha", "draft-only")).toBeNull();
});

it("the slug 'attempt' never resolves, so it cannot shadow the attempt routes", async () => {
  await createWorkspace(db, newId("wsp"), { slug: "attempt", name: "Attempt" });
  expect(await resolvePublishedTest(db, "attempt", "anything")).toBeNull();
});
```

```ts
// apps/api/test/route-authority.test.ts — Review Focus item 1. THE LOAD-BEARING FILE.
it("every mounted endpoint declares an authority", () => {
  expect(new Set(mountedEndpoints(app))).toEqual(new Set(Object.keys(ROUTE_AUTH)));
});

it("the workspace-authority set is exactly the guarded set", () => {
  // A route that loses its `requires()` in a later phase stops matching here
  // even though `routeGuards(app) === ROUTE_ACTIONS` still holds on both sides.
  const declared = Object.entries(ROUTE_AUTH)
    .filter(([, a]) => a === "workspace").map(([e]) => e);
  expect(new Set(declared)).toEqual(new Set(Object.keys(ROUTE_ACTIONS)));
});

it("every attempt-authority endpoint actually mounts attemptContext", () => {
  // Read off the live table, not off the declaration — Task 5 fills this in.
  for (const [endpoint, authority] of Object.entries(ROUTE_AUTH)) {
    if (authority === "attempt") expect(routeAuthorities(app)[endpoint], endpoint).toBe("attempt");
  }
});

it("the public set is a literal allowlist, so widening it is a visible diff", () => {
  expect(Object.entries(ROUTE_AUTH).filter(([, a]) => a === "public").map(([e]) => e).sort())
    .toEqual([
      "GET /api/v1/health",
      "GET /api/v1/auth/:provider/callback",
      "GET /api/v1/auth/:provider/start",
      "GET /api/v1/run/:workspaceSlug/:testSlug",
      "GET /api/v1/setup/status",
      "POST /api/v1/auth/magic-link",
      // …and nothing else. Every later task that adds one edits this literal.
    ].sort());
});

it("a candidate route is reachable with no cookie at all and costs no session read", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(`/api/v1/run/alpha/aptitude`);
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug"]);
});
```

```ts
// apps/api/test/run/landing.test.ts
it("C-01: the landing payload carries everything the page shows and nothing else", async () => {
  const body = await json(`/api/v1/run/alpha/aptitude`);
  expect(body).toMatchObject({
    name: "Aptitude", durationMinutes: 45, questionCount: 17,
    sections: [{ title: "Logic", questionCount: 4 }],
    proctoring: "standard", accessMode: "link_code",
    opensAt: expect.any(Number), closesAt: expect.any(Number), timezone: "Asia/Kolkata",
    branding: { logo: expect.any(String), footerText: expect.any(String) },
  });
});

it("S-10: the landing payload names no question, key or explanation", async () => {
  const text = await (await app.request(`/api/v1/run/alpha/aptitude`)).text();
  for (const leak of ["LOG-001", "qst_", "wsp_", "tst_", "ver_", "access_code", "correct"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("a pool section reports its requested count without reading the bank", async () => {
  const counting = countingDeps(deps);
  const body = await (await createApp(counting.deps).request(`/api/v1/run/alpha/pooled`)).json();
  expect(body.sections[0].questionCount).toBe(10);
  expect(counting.counts().total).toBe(1);        // the bank was never touched
});

it("an unpublished, archived or unknown test is the same 404, byte for byte", async () => {
  const bodies = await Promise.all(
    ["alpha/draft-only", "alpha/archived", "alpha/no-such-test", "no-such-ws/x"]
      .map(async (p) => (await app.request(`/api/v1/run/${p}`)).text()));
  expect(new Set(bodies).size).toBe(1);
});

it("Hono reaches the attempt routes, not the slug-pair route, for /run/attempt/*", async () => {
  // Pinned rather than assumed: static-over-parameter is router behaviour.
  expect((await app.request("/api/v1/run/attempt/answer", { method: "PUT" })).status).toBe(401);
});
```

```tsx
// apps/web/test/exam/landing.test.tsx
it("C-01: the landing page shows name, duration, question count, sections, rules, proctoring, devices and the window", () => {
  render(<ExamLanding test={landingFixture} />);
  for (const text of [/45 minutes/, /17 questions/i, /Logic/, /Standard/i, /laptop or desktop/i, /opens/i]) {
    expect(screen.getByText(text)).toBeVisible();
  }
});

it("C-01: 'Check my device' reports before the window opens and does not block starting", async () => {
  render(<ExamLanding test={{ ...landingFixture, opensAt: Date.now() + 86_400_000 }} />);
  await userEvent.click(screen.getByRole("button", { name: /check my device/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/screen|browser/i);
  expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();   // the window, not the device
});

it("DESIGN.md: the landing page keeps the voltage canvas and the runner does not", () => {
  expect(container.querySelector(".exam-landing-hero")).toHaveClass("canvas-voltage");
});

it("the landing and start pages have no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
});

it("every control's accessible name is a superset of its visible label (WCAG 2.5.3)", () => {
  for (const el of screen.getAllByRole("button")) {
    expect(accessibleName(el).toLowerCase()).toContain(visibleLabel(el).toLowerCase());
  }
});
```

```ts
// apps/web/test/bundle.test.ts (extended) — the 300 KB budget's structural guard
it("no organiser code is statically reachable from the exam entry", () => {
  expect(staticModules(threeEntryChunks, "exam").filter((m) => ADMIN_PATH_RE.test(m))).toEqual([]);
});

it("KaTeX is not in the exam entry's static graph either (ADR 0004)", () => {
  const modules = staticModules(threeEntryChunks, "exam").join("\n");
  for (const lazy of ["katex", "@vscode/markdown-it-katex"]) expect(modules).not.toContain(lazy);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db/test/repo/candidate-entry.test.ts apps/api/test/route-authority.test.ts apps/api/test/run apps/web/test/exam apps/web/test/bundle.test.ts`
Expected: FAIL — neither the module, the table nor the entry exists.

- [ ] **Step 3: Implement the module, the authority table, the route and the two screens**

`resolvePublishedTest` is one `SELECT` joining `workspace`, `test` and `test_version` on `test.current_version = test_version.version`, returning null when any link is missing — written the way `readSessionActor` is, as one statement rather than three reads. Add `ROUTE_AUTH` beside `ROUTE_BUDGETS` and `ROUTE_ACTIONS` in `app.ts`, with a line for **every** endpoint already mounted (this is the migration: the existing twenty-odd routes get classified once, here). `mountedEndpoints` is `mountedRoutes`'s sibling, keyed by method; `routeAuthorities` reads a `WeakMap` that `attemptContext` registers into, exactly as `guardOf` reads `GUARDS`. `exam.html` is a third Rollup input in `apps/web/vite.config.ts` next to `index` and `admin`, and `_headers` gains `/exam.html  X-Robots-Tag: noindex` beside `admin.html`'s and the SPA fallback that maps `/<ws>/<test>` onto it — ordered *after* every specific rule so it cannot swallow `/api`, `/assets` or `/admin.html`, which is what the extended `hosting.test.ts` asserts.

- [ ] **Step 4: Write the ADR**

`docs/adr/00NN-candidate-runtime-is-a-third-request-authority.md`, using `docs/adr/0000-template.md` and taking **the next free number at execution time** (0006 is the highest today). Context: Phases 3–5 had two authorities and `authorization.test.ts` only enumerates one of them. Decision: the `/api/v1/run` prefix, the attempt token, `ROUTE_AUTH`, and `repo/candidate-entry.ts` as a third pre-workspace module rather than a growth of `identity.ts`. Consequences: `guard.ts` and `GUARDS` are untouched; "unguarded" becomes a declared state rather than an absence; the admission test for `candidate-entry.ts` is the same one ADR 0006 set. Add the row to `docs/adr/README.md`'s table.

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS, with `authorization.test.ts` unchanged and green.

```bash
git add packages/db apps/api apps/web docs/adr
git commit -s -m "feat(run): candidate landing page and the third request authority"
```

---

## Task 2: Access gate for all four modes (#66, P6.2)

**Files:**
- Create: `apps/api/src/run/entry.ts`, `apps/api/src/run/net.ts` (CIDR matching), `apps/api/test/run/access.test.ts`, `apps/api/test/run/net.test.ts`
- Create: `apps/web/src/components/exam/AccessGate.tsx`, `apps/web/test/exam/access.test.tsx`
- Modify: `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`, `apps/api/src/auth/oidc.ts` (branch the callback), `apps/web/src/routes/exam.tsx`

**Interfaces:**
- Consumes: `resolvePublishedTest`, `insertAuthToken`, `consumeAuthToken`, `randomToken`, `sha256Hex`, `EmailAdapter`, `ApiError`, `TestAccess`, `AccessMode`, `deps.http`.
- Produces:
  ```ts
  // apps/api/src/run/entry.ts
  export const ENTRY_TTL_MS = 30 * 60_000;      // long enough to read a consent text
  export const EMAIL_CODE_TTL_MS = 10 * 60_000; // docs/test-format.md:69

  export interface EntryClaim { testVersionId: string; workspaceId: string; email?: string; listRef?: string }
  /** Mints the single-use `run_entry` token the registration step consumes. */
  export function issueEntryToken(deps: AppDeps, claim: EntryClaim): Promise<string>;
  export function readEntryToken(deps: AppDeps, token: string): Promise<EntryClaim | null>;

  // apps/api/src/run/net.ts — ~30 lines, no dependency
  export function ipInRanges(ip: string, cidrs: readonly string[]): boolean;   // v4 and v6
  export function emailInDomains(email: string, globs: readonly string[]): boolean;
  ```

The four modes all end in the same place — a single-use `run_entry` token carrying the test version and, where the mode knows it, the candidate's verified email — so Task 3 has exactly one thing to check and the four gates do not each grow their own session concept. The token is an `auth_token` row: `packages/db/src/repo/identity.ts`'s `consumeAuthToken` is already a single `UPDATE … WHERE used_at IS NULL AND expires_at > ? RETURNING`, which is precisely the race-free single-use primitive all four need, and `kind` is in its `WHERE` clause so a `run_invite` cannot be redeemed as a `run_entry`.

| Mode | The gate | The attack it stops | The test that proves it |
| --- | --- | --- | --- |
| `link_code` | Constant-time compare against `access.access_code` | Brute-forcing a 4–8 character code over a public URL | The per-test attempt bucket (Task 4) refuses the 11th wrong code in a minute; a timing test asserts the compare does not short-circuit on the first differing byte |
| `invite_only` | `consumeAuthToken(hash, "run_invite", now)` | Replaying one candidate's personal link for a second sitting, and two tabs racing it | Two concurrent redemptions of the same link: exactly one 200, one 410, and one candidate row |
| `email_code` | A 6-digit code, 10-minute expiry, stored only as `sha256(testVersionId:email:code)` | Reading codes out of a database dump; guessing one of 10⁶ by volume | A dump of `auth_token` contains no 6-digit string; the sixth wrong code for one address is refused (Task 4's bucket) |
| `sso` | The organiser OIDC flow's discovery, PKCE and ID-token verification, branched at the end | A candidate from outside `allow_email_domains`; an unverified `email` claim | An ID token whose `email_verified` is absent is refused unless the provider is configured `allowUnverifiedEmail`; an address outside the globs is refused with the domain rule named |

**`sso` creates no user row and issues no session cookie.** `apps/api/src/auth/oidc.ts` already performs discovery, PKCE S256, the token exchange and ID-token verification over the injectable `deps.http`; the candidate callback reuses all of it and branches where the organiser flow calls `createUser` and `issueSession`, minting a `run_entry` token with the verified email instead. [ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md): "Nothing in this decision gives a candidate a user row", and "any later request to let a candidate 'log in and see their history' is a new decision, not an extension of this one."

**`allow_email_domains` and `allow_ip_ranges` are optional for every mode** (`docs/test-format.md:72`, `T-21`) and are checked before the mode's own gate, so an off-network candidate never learns whether their code was right. `ipInRanges` reads `CF-Connecting-IP` first and the right-most `X-Forwarded-For` hop second; a request with neither, on a test that sets `allow_ip_ranges`, is refused rather than allowed — failing open on an allowlist is the whole of the bug.

**`C-02`'s errors say what to do next.** Each refusal carries its own `code` and a message naming the action: `invite_used` → "This invite link was already used. Contact the organiser." (the PRD's own example), `code_wrong`, `code_expired`, `domain_not_allowed`, `ip_not_allowed`, `window_closed`, `too_many_attempts`. A test asserts every refusal message contains a verb.

**Routes.**

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/access` | `public` | `MEASURE` (resolve + consume/insert + maybe one rate-limit upsert) |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/email-code` | `public` | `MEASURE` (resolve + insert + the email send, which is not a subrequest on D1 or R2) |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/sso/start` | `public` | `MEASURE` |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/sso/callback` | `public` | `MEASURE` |

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/access.test.ts
it("link_code: the right code yields a single-use entry token", async () => {
  const res = await post(`/api/v1/run/alpha/aptitude/access`, { code: "OPENSESAME" });
  expect(res.status).toBe(200);
  const { entryToken } = await res.json();
  expect(await readEntryToken(deps, entryToken)).toMatchObject({ testVersionId: ver });
});

it("link_code: a wrong code is refused with an actionable message and mints nothing", async () => {
  const body = await (await post(`/api/v1/run/alpha/aptitude/access`, { code: "nope" })).json();
  expect(body.error).toMatchObject({ code: "code_wrong", message: expect.stringMatching(/check|ask|organiser/i) });
  expect(await countAuthTokens("run_entry")).toBe(0);
});

it("invite_only: a link works once; the second redemption is 410 and names the next step", async () => {
  const link = await mintInvite(ver, "row-7");
  expect((await post(`/api/v1/run/alpha/aptitude/access`, { invite: link })).status).toBe(200);
  const again = await post(`/api/v1/run/alpha/aptitude/access`, { invite: link });
  expect(again.status).toBe(410);
  expect((await again.json()).error.message).toMatch(/already used.*organiser/i);
});

it("invite_only: two concurrent redemptions produce exactly one entry token", async () => {
  const link = await mintInvite(ver, "row-7");
  const [a, b] = await Promise.all([redeem(link), redeem(link)]);
  expect([a.status, b.status].sort()).toEqual([200, 410]);
});

it("email_code: the code is emailed, expires in 10 minutes, and is never stored in the clear", async () => {
  await post(`/api/v1/run/alpha/otp/email-code`, { email: "a@b.ac.in" });
  const code = sentCode(mailbox);
  expect(code).toMatch(/^\d{6}$/);
  expect(JSON.stringify(await allAuthTokenRows())).not.toContain(code);
  deps.now = () => T + EMAIL_CODE_TTL_MS + 1;
  expect((await post(`/api/v1/run/alpha/otp/access`, { email: "a@b.ac.in", code })).status).toBe(401);
});

it("sso: a verified address inside the domain rule gets an entry token and no user row and no cookie", async () => {
  const res = await ssoCallback({ email: "s@college.ac.in", email_verified: true });
  expect(res.headers.get("set-cookie") ?? "").not.toContain("pk_session");
  expect(await countUsers()).toBe(usersBefore);
});

it("sso: an address outside allow_email_domains is refused and the rule is named", async () => {
  const body = await (await ssoCallback({ email: "s@gmail.com", email_verified: true })).json();
  expect(body.error).toMatchObject({ code: "domain_not_allowed", message: expect.stringContaining("*.ac.in") });
});

it("sso: an ID token with no email_verified claim is refused unless the provider is configured for it", async () => {
  expect((await ssoCallback({ email: "s@college.ac.in" })).status).toBe(401);
});

it("T-21: the IP allowlist is checked before the mode, so an off-network candidate learns nothing about their code", async () => {
  const wrongIp = { headers: { "CF-Connecting-IP": "203.0.113.9" } };
  const right = await post(`/api/v1/run/alpha/lab/access`, { code: "OPENSESAME" }, wrongIp);
  const wrong = await post(`/api/v1/run/alpha/lab/access`, { code: "nope" }, wrongIp);
  expect(await right.text()).toBe(await wrong.text());
  expect((await right.json()).error.code).toBe("ip_not_allowed");
});

it("a request with no client-IP header at all is refused when the test sets allow_ip_ranges", async () => {
  expect((await post(`/api/v1/run/alpha/lab/access`, { code: "OPENSESAME" })).status).toBe(403);
});

it("every refusal message tells the candidate what to do next (C-02)", async () => {
  for (const refusal of await everyRefusal()) {
    expect(refusal.message, refusal.code).toMatch(/\b(check|ask|contact|try|wait|use|sign)\b/i);
  }
});

it("an entry token is single use and cannot be replayed at registration", async () => {
  const { entryToken } = await passGate();
  await register(entryToken, validValues);
  expect((await register(entryToken, validValues)).status).toBe(410);
});
```

```ts
// apps/api/test/run/net.test.ts
it.each([
  ["10.0.0.5", ["10.0.0.0/8"], true], ["11.0.0.5", ["10.0.0.0/8"], false],
  ["192.168.1.1", ["192.168.1.0/24"], true], ["192.168.2.1", ["192.168.1.0/24"], false],
  ["2001:db8::1", ["2001:db8::/32"], true], ["2001:dba::1", ["2001:db8::/32"], false],
  ["10.0.0.5", [], false],                                  // an empty list allows nobody
])("ipInRanges(%j, %j) is %s", (ip, cidrs, expected) => expect(ipInRanges(ip, cidrs)).toBe(expected));

it.each([
  ["a@iit.ac.in", ["*.ac.in"], true], ["a@acme.in", ["*.ac.in"], false],
  ["a@AC.IN", ["*.ac.in"], false],                          // the glob matches a subdomain, not the apex
  ["a@evil.com?x=@iit.ac.in", ["*.ac.in"], false],          // the domain is what follows the LAST @
])("emailInDomains(%j, %j) is %s", (e, g, x) => expect(emailInDomains(e, g)).toBe(x));
```

```tsx
// apps/web/test/exam/access.test.tsx
it("the gate renders only the control the test's mode needs", () => {
  for (const [mode, label] of [["link_code", /access code/i], ["email_code", /email/i], ["sso", /sign in/i]] as const) {
    render(<AccessGate mode={mode} onPassed={noop} />);
    expect(screen.getByLabelText(label)).toBeVisible();
    cleanup();
  }
});

it("a refusal shows the server's message on the field, not a status code", async () => {
  await userEvent.type(screen.getByLabelText(/access code/i), "nope");
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/check the code/i);
  expect(screen.queryByText(/401|403/)).toBeNull();
});

it("the access gate has no axe violations and the error is associated with the field", async () => {
  expect(await axe(container)).toHaveNoViolations();
  expect(screen.getByLabelText(/access code/i)).toHaveAccessibleDescription(/check the code/i);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run apps/web/test/exam/access.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the four gates**

One handler, one `switch` on `access.mode`, with the allowlists checked before the switch. `ipInRanges` parses v4 into a 32-bit integer and v6 into two `BigInt` halves and masks — about thirty lines, written here rather than taken from a dependency because the Worker bundle is size-constrained and the input is two well-defined notations. The email-code hash is `sha256Hex(`${testVersionId}:${email.toLowerCase()}:${code}`)` so the row is a lookup key and never a plaintext secret. The `sso` callback imports from `apps/api/src/auth/oidc.ts` and diverges only at the final step.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api apps/web` and `pnpm vitest run apps/api/test/budget.test.ts apps/api/test/route-authority.test.ts`
Expected: PASS, with four new `ROUTE_AUTH` lines and four measured budgets.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web
git commit -s -m "feat(run): access gate for link code, invite, email code and sso"
```

---

## Task 3: Consent and registration with server-side validation (#67, P6.3)

**Files:**
- Create: `packages/core/src/registration.ts`, `packages/core/test/registration.test.ts`
- Create: `apps/api/src/run/registration.ts`, `apps/api/test/run/registration.test.ts`
- Create: `apps/web/src/components/exam/ConsentPanel.tsx`, `apps/web/src/components/exam/RegistrationForm.tsx`, `apps/web/test/exam/registration.test.tsx`
- Modify: `packages/core/src/index.ts`, `packages/core/src/types.ts` (the `RegistrationForm`, `FormField`, `FieldValidation`, `Consent` and `Timing` types, **only if Phase 5 did not add them** — see interface rows 7, 8 and 10), `packages/db/src/schema/columns.ts` (`candidate_unique`, and `consent_at` on `candidate`), `packages/db/src/repo/run.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `readEntryToken`, `createCandidate`, `appendAudit`, `matchBounded` (Task 11 hardens it; Task 3 writes the first version), `scoped`.
- Produces:
  ```ts
  // packages/core/src/registration.ts — pure, no I/O, the ONE copy of T-17's rules
  export interface FieldIssue { field: string; code: string; message: string }
  export function validateRegistration(
    form: RegistrationForm,
    values: Record<string, unknown>,
    opts?: { matcher?: (pattern: string, input: string) => boolean },
  ): FieldIssue[];
  /** The fields a test blocks repeat registration on, in form order. */
  export function uniqueFieldIds(form: RegistrationForm): string[];

  // packages/db/src/repo/run.ts — every one scoped(), registered in REPO_FUNCTIONS
  export const claimUniqueFields: ScopedFn<
    [{ testId: string; candidateId: string; claims: { fieldId: string; valueHash: string }[] }],
    { taken: string[] }>;
  export const releaseUniqueFields: ScopedFn<[candidateId: string], void>;
  ```

**The validator is one function in `packages/core`, called twice.** `docs/test-format.md:110` is unambiguous — "Every rule is re-checked on the server. The browser's copy of it is a courtesy, not a control" — and the cheapest way to make the browser's copy *be* the server's rule is to have one implementation and two callers, which is also what makes the inline message a candidate sees identical to the one the 422 carries. `packages/core` is a pure leaf package with no runtime dependencies, which this respects: `validateRegistration` is data in, issues out, and it takes the regex matcher as an injected option precisely because a bounded matcher needs a host the pure package does not have (issue [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129); the server passes `matchBounded`, the browser passes the platform's `RegExp.test`).

**Unique fields need a table, not a JSON index.** `candidate.form_values_json` is a JSON column, and neither SQLite nor Postgres gives a portable unique index into one — so `T-17`'s "unique per test" becomes `candidate_unique(workspace_id, test_id, field_id, value_hash)` with `UNIQUE (test_id, field_id, value_hash)`. The value is stored as a SHA-256 of the normalised value and never in the clear, so the table that exists to block a repeat email does not become a second copy of every candidate's email next to the encryptable one (`S-15`). All of a registration's claims are written in **one** `db.batch` with the candidate insert, so a duplicate rolls the whole registration back and the response names the field — `AC-12`'s "a repeat of a unique field is refused" with no half-written candidate behind it.

**Consent (`S-12`).** `candidate.consent_version` already exists; this task adds `consent_at`. The consent text and version come from the version's `settings.consent`, the candidate must tick before the form enables, and both the version and the acceptance time are stored — so a later edit to the text stays distinguishable, which is the whole point of `docs/test-format.md:85`.

**Routes.**

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/form` | `public` (entry token in the body-less `Authorization: Bearer`) | `MEASURE` (resolve + consume-free read of the entry token) |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/register` | `public` (entry token) | `MEASURE` (resolve + consume + one batch + audit) |

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/registration.test.ts — the rules, once
it.each([
  ["required", { id: "name", type: "short_text", label: "Name", required: true }, {}, "required"],
  ["min_length", { id: "n", type: "short_text", label: "N", validation: { min_length: 3 } }, { n: "ab" }, "too_short"],
  ["pattern", { id: "roll", type: "short_text", label: "Roll", validation: { pattern: "^\\d{2}[A-Z]{2}\\d{4}$", pattern_message: "Format: 21CS0147" } }, { roll: "x" }, "pattern"],
  ["email domain", { id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }, { e: "a@gmail.com" }, "domain"],
  ["number min", { id: "cgpa", type: "number", label: "C", validation: { min: 0, max: 10 } }, { cgpa: 11 }, "max"],
  ["integer", { id: "yr", type: "number", label: "Y", validation: { integer: true } }, { yr: 2026.5 }, "integer"],
  ["date max", { id: "d", type: "date", label: "D", validation: { max: "2026-01-01" } }, { d: "2027-01-01" }, "max"],
  ["dropdown", { id: "deg", type: "dropdown", label: "D", options: ["BE", "ME"] }, { deg: "PhD" }, "not_an_option"],
  ["checkbox", { id: "s", type: "checkbox", label: "S", options: ["a", "b"] }, { s: ["a", "z"] }, "not_an_option"],
  ["url domain", { id: "u", type: "url", label: "U", validation: { allowed_domains: ["github.com"] } }, { u: "https://evil.test" }, "domain"],
  ["consent", { id: "c", type: "consent", label: "C", required: true }, { c: false }, "required"],
])("T-17: %s is an issue on the field itself", (_n, field, values, code) => {
  const [issue] = validateRegistration({ fields: [field] }, values);
  expect(issue).toMatchObject({ field: field.id, code });
});

it("AC-12: pattern_message is the message, verbatim — 'Invalid format' tells a nervous candidate nothing", () => {
  const [issue] = validateRegistration(rollForm, { roll: "x" });
  expect(issue.message).toBe("Format: 21CS0147");
});

it("a field the form does not declare is dropped, not stored (S-11: collect only what the form asks for)", () => {
  expect(normalise(nameForm, { name: "A", secret: "x" })).toEqual({ name: "A" });
});

it("every issue names a field that exists in the form", () => {
  for (const i of validateRegistration(campusHiringForm, {})) {
    expect(campusHiringForm.fields.map((f) => f.id)).toContain(i.field);
  }
});

it("the injected matcher is what runs a pattern, so the server can bound it (#129)", () => {
  const calls: string[] = [];
  validateRegistration(rollForm, { roll: "x" }, { matcher: (p) => { calls.push(p); return false; } });
  expect(calls).toEqual(["^\\d{2}[A-Z]{2}\\d{4}$"]);
});
```

```ts
// apps/api/test/run/registration.test.ts
it("AC-12: an invalid submission is 422, names every bad field, and writes no candidate", async () => {
  const res = await register(entryToken, { email: "nope", cgpa: 11 });
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.issues.map((i) => i.field).sort()).toEqual(["cgpa", "email"]);
  expect(await countCandidates(testId)).toBe(0);
});

it("AC-12: the server refuses a rule the browser was patched to skip", async () => {
  // Driven through the route with a body no honest client could produce.
  expect((await register(entryToken, { email: "a@b.ac.in", roll: "not-a-roll" })).status).toBe(422);
});

it("AC-12: a repeat of a unique field is refused and the field is named", async () => {
  await register(await gate(), { email: "a@b.ac.in", roll: "21CS0147" });
  const res = await register(await gate(), { email: "a@b.ac.in", roll: "21CS9999" });
  expect(res.status).toBe(409);
  expect((await res.json()).error.details).toMatchObject({ fields: ["email"] });
});

it("a refused duplicate leaves no candidate row and no partial unique claim", async () => {
  expect(await countCandidates(testId)).toBe(1);
  expect(await countUniqueClaims(testId, "roll")).toBe(1);
});

it("two registrations racing on the same unique value: exactly one wins", async () => {
  const [a, b] = await Promise.all([register(await gate(), v), register(await gate(), v)]);
  expect([a.status, b.status].sort()).toEqual([201, 409]);
  expect(await countCandidates(testId)).toBe(1);
});

it("the unique table stores a hash, never the value", async () => {
  expect(JSON.stringify(await allUniqueRows())).not.toContain("a@b.ac.in");
});

it("S-12: the consent version and the acceptance time are stored per candidate", async () => {
  const row = await candidateRow(testId);
  expect(row).toMatchObject({ consent_version: "2026-10-01", consent_at: expect.any(Number) });
});

it("S-12: registering without accepting the consent is refused on the consent field", async () => {
  expect((await register(entryToken, { ...valid, consent: false })).status).toBe(422);
});

it("the form route answers only behind a live entry token", async () => {
  expect((await app.request(`/api/v1/run/alpha/aptitude/form`)).status).toBe(401);
});

it("S-10: the form route carries no access code and no question", async () => {
  const text = await (await formWith(entryToken)).text();
  for (const leak of ["OPENSESAME", "LOG-001", "qst_"]) expect(text, leak).not.toContain(leak);
});
```

```tsx
// apps/web/test/exam/registration.test.tsx
it("S-12: the form is disabled until the consent row is ticked", async () => {
  render(<ConsentAndForm test={fixture} />);
  expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox", { name: /i agree/i }));
  expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled();
});

it("the consent text renders through the one shared renderer, not a second one", async () => {
  expect(await screen.findByRole("list")).toBeVisible();     // the consent text's Markdown bullets
});

it("AC-12: the browser's message for a failed rule is byte-identical to the server's", async () => {
  const clientIssue = validateRegistration(form, { roll: "x" })[0];
  const serverIssue = (await (await register(token, { roll: "x" })).json()).error.details.issues[0];
  expect(clientIssue.message).toBe(serverIssue.message);
});

it("an error is on the field, announced, and the first bad field takes focus", async () => {
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(screen.getByLabelText(/email/i)).toHaveAccessibleDescription(/required/i);
  expect(document.activeElement).toBe(screen.getByLabelText(/email/i));
  expect(screen.getByRole("alert")).toHaveTextContent(/2 fields need/i);
});

it("all 11 field types render with a label and no axe violations", async () => {
  render(<RegistrationForm form={allElevenTypes} onSubmit={noop} />);
  expect(await axe(container)).toHaveNoViolations();
  for (const f of allElevenTypes.fields) expect(screen.getByLabelText(new RegExp(f.label))).toBeVisible();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/core/test/registration.test.ts apps/api/test/run/registration.test.ts apps/web/test/exam/registration.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the validator, the table and the route**

`validateRegistration` is one `switch` on `field.type` with the shared `required` check in front of it; it collects rather than throwing at the first, which is what lets the route return every bad field at once. The route's order is: read the entry token (not consume — consumption happens with the write), validate, hash the unique values, then one `db.batch([insert candidate, …insert claims])` so a `UNIQUE` violation rolls the whole thing back; the 409 names the fields by re-reading which hashes already exist, in one query, only on the failure path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/core packages/db apps/api apps/web` with `TEST_POSTGRES_URL` set.
Expected: PASS on both dialects, with `scoping.test.ts` and `parity.test.ts` green on the new table.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/db apps/api apps/web
git commit -s -m "feat(run): consent capture and server-side registration with unique fields"
```

---

## Task 4: Bot protection and rate limits (#68, P6.4)

**Files:**
- Create: `apps/api/src/run/ratelimit.ts`, `apps/api/src/run/captcha.ts`, `apps/api/test/run/ratelimit.test.ts`, `apps/api/test/run/captcha.test.ts`
- Create: `docs/adr/00NN-bot-protection-narrows-the-no-third-party-script-rule.md` (**the next free number at execution time**) — *only if the escalation below is resolved in favour of a hosted captcha*
- Modify: `packages/db/src/schema/columns.ts` (`rate_limit`), `packages/db/src/repo/run.ts`, `apps/api/src/env.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/middleware/security.ts` and `apps/web/public/_headers` (**together, or not at all**), `apps/web/test/hosting.test.ts`, `docs/adr/README.md`

**Interfaces:**
- Consumes: `scoped`, `deps.http`, `deps.now`, `ApiError`, `AppEnv`.
- Produces:
  ```ts
  // packages/db/src/repo/run.ts
  /** One statement: insert-or-increment inside the window, returning the new count. */
  export const takeRateToken: ScopedFn<
    [{ bucket: string; limit: number; windowMs: number; now: number }],
    { allowed: boolean; count: number; retryAfterMs: number }>;

  // apps/api/src/run/ratelimit.ts
  export const LIMITS: Readonly<Record<RateBucket, { limit: number; windowMs: number }>>;
  export type RateBucket = "test_access" | "test_register" | "email_code" | "attempt_start" | "attempt_submit" | "result_code";
  export function limitOrThrow(deps: AppDeps, workspaceId: string, bucket: RateBucket, key: string): Promise<void>;

  // apps/api/src/run/captcha.ts
  /** Resolves true when unconfigured — an instance with no provider is not broken. */
  export function verifyCaptcha(deps: AppDeps, token: string | undefined): Promise<boolean>;
  export function captchaRequired(deps: AppDeps, access: TestAccess): boolean;
  ```

**The attack, and the control that stops it, one row each.**

| Attack | Control | The test |
| --- | --- | --- |
| A script registers ten thousand fake candidates on a public `link_code` test, exhausting the free tier's 100,000 daily D1 writes and burying the real results | `test_register` bucket, keyed by test version | 101 registrations inside the window: the 101st is 429 with `Retry-After`, and the write count stops rising |
| A script brute-forces a short `access_code` over a public URL | `test_access` bucket, keyed by test version | The 11th wrong code in a minute is 429; the 11th is refused before the code is compared |
| A script requests ten thousand 6-digit codes to one address, or sprays one code across ten thousand addresses | `email_code` bucket, keyed by test version **and** separately by `sha256(email)` | Both directions refused; the email adapter records no send past the limit |
| A script with one valid registration opens a thousand attempts | `attempt_start` bucket, keyed by candidate, under `attempts_allowed` (Task 5) | The second attempt on a one-attempt test is 409 before any layout is computed |
| A headless browser farm registers at human speed, under every rate limit | A captcha on registration (`S-07`) — **escalated**, see below | `verifyCaptcha` is called with the submitted token and a failed verification is 403 |

**Limits are per attempt and per test, never per IP** — `S-07` and `docs/test-format.md:74` give the reason: "a whole campus often shares one". A test asserts no bucket key is ever derived from a client-IP header, by passing a distinctive IP and grepping every `rate_limit` row for it.

**The bucket store is a D1 table, not KV and not a Durable Object.** One `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE window_start > ?` is a single statement, one subrequest, portable to SQLite and Postgres, and testable in memory — and the alternatives are Cloudflare-only, which ADR 0002's adapter rule rules out for the reference path. Buckets are applied to the *expensive and abusable* routes (access, email-code, register, start, submit, result-code) and **not** to the answer-save path: a save is already bounded by a live attempt token and a server deadline, and adding a counter write to it would double the hottest path's cost against the PRD's "one D1 write" line for no attack it stops. `ponytail:` a `DELETE FROM rate_limit WHERE window_start < ?` sweep belongs to Phase 8's retention job; until then the table grows at one row per bucket per window, which is small.

**Bot protection is escalated, not decided.** `S-07` names Cloudflare Turnstile or hCaptcha; `S-11` says "No analytics, telemetry or third-party scripts; fonts and the face model are served from the app itself"; the CSP in `apps/api/src/middleware/security.ts:17` is `script-src 'self'` and `apps/web/test/hosting.test.ts:25` asserts `_headers` contains no `https?://` whatsoever. Two PRD clauses of equal precedence contradict each other and a committed test enforces one of them. See [Escalated](#escalated--needs-a-human-decision). **What this task builds either way** is the seam: `captchaRequired()` reads `access.captcha` (schema default `true`), `verifyCaptcha()` posts to a configured `CAPTCHA_VERIFY_URL` with `CAPTCHA_SECRET` over the injectable `deps.http`, and **returns true when nothing is configured** — because `AC-01` promises a working deployment in thirty minutes "using no paid service", and an instance that cannot run a test until its operator holds a Cloudflare account would fail it. The browser half and the CSP change land only once the escalation is answered; the rate limits above ship regardless and are the control that is actually enforceable today.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/ratelimit.test.ts
it("S-07: the 101st registration in the window is 429 and carries Retry-After", async () => {
  for (let i = 0; i < 100; i++) expect((await register(await gate(), unique(i))).status).toBe(201);
  const res = await register(await gate(), unique(100));
  expect(res.status).toBe(429);
  expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
});

it("S-07: no bucket key is derived from a client IP — a campus shares one", async () => {
  await post(`/api/v1/run/alpha/aptitude/access`, { code: "nope" }, { headers: { "CF-Connecting-IP": "198.51.100.77" } });
  expect(JSON.stringify(await allRateRows())).not.toContain("198.51.100.77");
});

it("two tests on one instance do not share a bucket", async () => {
  await exhaust("alpha/aptitude");
  expect((await post(`/api/v1/run/alpha/other/access`, { code: "OPENSESAME" })).status).toBe(200);
});

it("the window rolls: the limit is spendable again once windowMs has passed", async () => {
  await exhaust("alpha/aptitude");
  deps.now = () => T + LIMITS.test_access.windowMs + 1;
  expect((await post(`/api/v1/run/alpha/aptitude/access`, { code: "OPENSESAME" })).status).toBe(200);
});

it("taking a token is one statement, so the limiter never doubles a route's budget by more than 1", async () => {
  const counting = countingClient(db);
  await takeRateToken(counting.db, ws, { bucket: "test_access:ver_1", limit: 10, windowMs: 60_000, now: T });
  expect(counting.count()).toBe(1);
});

it("the answer-save path takes no rate token (the hot path stays one write plus one read)", async () => {
  const counting = countingDeps(deps);
  await saveAnswer(createApp(counting.deps), attemptCookie, "LOG-001", answer);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/attempt/answer"]);
  expect(await allRateRows()).toEqual([]);
});

it("the email-code bucket limits per address as well as per test", async () => {
  for (let i = 0; i < 5; i++) await requestCode("a@b.ac.in");
  expect((await requestCode("a@b.ac.in")).status).toBe(429);
  expect((await requestCode("c@d.ac.in")).status).toBe(200);
});
```

```ts
// apps/api/test/run/captcha.test.ts
it("an instance with no captcha configured registers normally (AC-01: no paid service)", async () => {
  expect((await register(await gate(), valid)).status).toBe(201);
});

it("with a secret configured, a missing or failed token is 403 and writes no candidate", async () => {
  const d = { ...deps, env: withCaptcha(deps.env), http: alwaysFails };
  expect((await register(await gate(d), valid, { captchaToken: "x" }, d)).status).toBe(403);
  expect(await countCandidates(testId)).toBe(0);
});

it("the verification goes through deps.http and sends the secret, never the site key", async () => {
  const sent: RequestInit[] = [];
  await verifyCaptcha({ ...deps, env: withCaptcha(deps.env), http: record(sent) }, "tok");
  expect(String(sent[0]!.body)).toContain("secret=");
  expect(String(sent[0]!.body)).not.toContain(SITE_KEY);
});

it("access.captcha=false turns it off for that test even when configured", async () => {
  expect(captchaRequired(withCaptchaDeps, { mode: "link_code", access_code: "x", captcha: false })).toBe(false);
});
```

```ts
// apps/web/test/hosting.test.ts (extended) — S-11's guard, kept honest
it("S-11: the CSP names no third-party origin unless the bot-protection ADR says which one", () => {
  const thirdParty = headers.match(/https?:\/\/[^\s;]+/g) ?? [];
  expect(thirdParty, "see docs/adr/00NN-bot-protection…").toEqual(ALLOWED_THIRD_PARTY_ORIGINS);
});

it("the API's headers and _headers still agree byte for byte", () => {
  expect(cspOf(headers)).toBe(SECURITY_HEADERS["Content-Security-Policy"]);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run/ratelimit.test.ts apps/api/test/run/captcha.test.ts apps/web/test/hosting.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the bucket table, the limiter and the captcha seam**

`rate_limit(workspace_id, bucket, window_start, count)` with `UNIQUE (workspace_id, bucket)`; `takeRateToken` is one `INSERT … ON CONFLICT DO UPDATE SET count = CASE WHEN window_start <= ? THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END RETURNING count, window_start`, so the window roll and the increment are the same statement and two concurrent requests cannot both read a stale count. `verifyCaptcha` is twenty lines over `deps.http`. **Do not touch the CSP in this step** — the two header files change together, in whichever direction the escalation is answered, and `hosting.test.ts`'s `ALLOWED_THIRD_PARTY_ORIGINS` starts as `[]`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS, with every Task 2 and 3 budget re-measured — a route that gained a limiter gained exactly one subrequest.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(run): per-test and per-attempt rate limits and the captcha seam"
```

---
