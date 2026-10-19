# Phase 6: Candidate Runtime Implementation Plan

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
- Create: `apps/web/exam.html`, `apps/web/src/exam-main.tsx`, `apps/web/src/routes/exam.tsx`, `apps/web/src/lib/run.ts`, `apps/web/src/styles/exam.css`, `apps/web/test/exam/landing.test.tsx`
- Create: `docs/adr/00NN-candidate-runtime-is-a-third-request-authority.md` (**the next free number at execution time**; `docs/adr/0000-template.md`, 0006 is the highest today)
- Modify: `packages/db/src/index.ts` (export beside `identity.js` and `question-document.js`, deliberately outside `repo/index.js`), `apps/api/src/app.ts`, `apps/api/src/instrument.ts`, `apps/web/vite.config.ts` (a third Rollup input), `apps/web/public/_headers`, `apps/web/test/bundle.test.ts`, `apps/web/test/hosting.test.ts`, `docs/adr/README.md`

**Interfaces:**
- Consumes: `DbClient`, `newId`, `isId` (`@pariksha/db`) · `ApiError` (`apps/api/src/errors.ts`) · `mountedRoutes(app): string[]`, `countingDeps(deps): { deps, counts }`, `guardOf(handler)` (`apps/api/src/instrument.ts`, `apps/api/src/middleware/authorize.ts`) · `RenderedHtml({ markdown, className? })` (Phase 4) · `tokens.css`. From **Phase 5**: `test_version` (interface row 1), `settings_json` (row 2), `sections_json` (row 3), `test.status` and `current_version` (row 12), workspace branding (row 11).
- Produces:
  ```ts
  // packages/db/src/repo/candidate-entry.ts — exported from the package root,
  // deliberately NOT from repo/index.ts.
  export interface PublishedTest {
    workspaceId: string; testId: string; testVersionId: string; version: number;
    status: string; name: string;
    settings: unknown;          // interface row 2
    sections: unknown;          // Section[] (row 3)
    workspaceBranding: unknown; // workspace.branding_json (row 11)
  }
  export function resolvePublishedTest(
    db: DbClient, workspaceSlug: string, testSlug: string,
  ): Promise<PublishedTest | null>;

  // apps/api/src/app.ts
  export type RouteAuthority = "workspace" | "attempt" | "public";
  export const ROUTE_AUTH: Record<string, RouteAuthority>;   // keyed "METHOD /path"

  // apps/api/src/instrument.ts
  export function mountedEndpoints(app: Hono<AppBindings>): string[];               // "METHOD /path"
  export function routeAuthorities(app: Hono<AppBindings>): Record<string, RouteAuthority>;

  // apps/web/src/lib/run.ts — the candidate app's one door to the API.
  export interface LandingPayload {
    name: string; description: string | null; durationMinutes: number;
    questionCount: number;
    sections: { id: string; title: string; questionCount: number; timeLimitMinutes: number | null }[];
    rules: string | null; proctoring: "off" | "standard" | "strict";
    accessMode: AccessMode; opensAt: number | null; closesAt: number | null;
    latestStartAt: number | null; timezone: string;
    branding: { logo: string | null; primaryColour: string | null; footerText: string | null; startMessage: string | null };
    serverNow: number;
  }
  export function createRunClient(workspaceSlug: string, testSlug: string): RunClient;
  export interface RunClient { landing(): Promise<LandingPayload> }   // widened by Tasks 2, 3, 5, 8, 11

  // apps/web/src/routes/exam.tsx
  export function deviceReport(): { ok: boolean; findings: { label: string; ok: boolean; detail: string }[] };
  ```

### Ruling: candidate traffic is a third request authority, addressed under `/api/v1/run/…`

The structural decision the rest of the phase rests on, so it is made here with its citations.

**Candidate routes do not mount under `/api/v1/workspaces/:id/…` and carry no `requires()` guard.** [`docs/PRD.md`](../../PRD.md#rest-api-v1)'s REST API table names them literally — "Candidate runtime | `POST /run/{test}/register`, `/start`, `PUT /run/attempt/answer`, … **(attempt token)**" — and `S-06` names the authority: "Each attempt gets a random 256-bit token; only its hash is stored. Every request is checked against the token, the attempt status and the server deadline." [ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md) closes the alternative: "Candidate access is not organiser auth … Nothing in this decision gives a candidate a user row." No user means no session, no membership, and nothing for `guard()` (`apps/api/src/middleware/authorize.ts:100`) to find; a workspace ID in a candidate URL would also hand a stranger a workspace identifier, which is the opposite of the 404-not-403 posture that file was written for.

**`{test}` is the slug pair.** `T-02` fixes the candidate URL at `/<workspace-slug>/<test-slug>`, so the only identifier a candidate holds is two slugs: `GET /api/v1/run/:workspaceSlug/:testSlug`.

**What this means for `GUARDS` and `authorization.test.ts`: nothing changes, and that is the problem.** No candidate route calls `requires()` or `requireMember()`, so none enters the `GUARDS` WeakMap, so `guardedRoutes(app)` is unchanged and `authorization.test.ts:153` and `:159` keep passing untouched — correctly, and uselessly. Those two tests only ever saw guarded routes, and after this phase an unguarded line in `app.ts` no longer looks out of place (Review Focus 1). So Phase 6 adds the missing half: `ROUTE_AUTH`, keyed `"METHOD /path"` like `ROUTE_ACTIONS`, naming every mounted endpoint's authority, checked in four directions by `apps/api/test/route-authority.test.ts`. Three registries, complementary rather than duplicated: `GUARDS` says *which action*, `ROUTE_AUTH` says *which authority*, `ROUTE_BUDGETS` says *what it may spend*.

**The data layer stays absolute.** `resolvePublishedTest` — and, in Task 5, `readAttemptByTokenHash` — cannot take a workspace ID, because the workspace ID is what they *produce*: exactly [ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md)'s admission test, "unable to know a workspace, not merely awkward to give one." They do **not** join `identity.ts`; that ADR's own "to watch" section says a function that is not about users or sessions should take a workspace ID instead, and these cannot. They get a third module with its own pinned set and its own both-directions test, copying `packages/db/test/repo/identity.test.ts`. Every read after the resolution is an ordinary `scoped()` function with the resolved `workspaceId`.

**Path collision.** `/api/v1/run/attempt/answer` and `/api/v1/run/:workspaceSlug/:testSlug` can both match three segments. Hono prefers a static segment to a parameter; the test below pins that rather than assuming it, and `resolvePublishedTest` additionally refuses `workspaceSlug === "attempt"`.

### What the landing route returns

`C-01` in one read: branding, name, description, duration, total question count, the section list, the proctoring profile, the supported-device rule, the window and timezone, and the access mode so the browser knows which gate to render. Consent is **not** included — it arrives after the gate, in Task 3. Question counts come from `sections_json` alone (`fixed` and `sets` count their lists, `pool` reports its `count`), so the route never touches the bank and cannot name a question.

`C-01`'s "Check my device": Phase 6 ships the button and the report, Phase 7 makes it block. `docs/ROADMAP.md`'s Phase 7 owns "device and browser gating" and "the camera requirement" — the *gate* — while `C-01` puts the button on the landing page, which is this phase. `deviceReport()` is therefore a pure function over `window.innerWidth`, `matchMedia("(pointer: fine)")` and the browser name against the PRD's supported-browser row. It does not ask for the camera and it does not prevent starting.

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug` | `public` | `MEASURE` (expected 1 — one join; the floor is 0, not 2: no cookie, no `readSession`) |

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/test/repo/candidate-entry.test.ts — ADR 0006's pattern, third module
const UNSCOPED_BY_DESIGN = ["resolvePublishedTest"];   // Task 5 adds readAttemptByTokenHash

it("the unscoped set is exactly the one named here", () =>
  expect(new Set(functionNames(candidateEntry))).toEqual(new Set(UNSCOPED_BY_DESIGN)));

it("no unscoped function reaches the scoped barrel or its registry", () => {
  for (const n of UNSCOPED_BY_DESIGN) {
    expect(repo, n).not.toHaveProperty(n);
    expect(REPO_FUNCTIONS, n).not.toHaveProperty(n);
  }
});

it("resolves a published test from the slug pair alone, in one statement", async () => {
  const counting = countingClient(db);
  expect(await resolvePublishedTest(counting.db, "alpha", "aptitude"))
    .toMatchObject({ workspaceId: wspA, version: 1, status: "open" });
  expect(counting.count()).toBe(1);
});

it("two workspaces may hold the same test slug and resolve to different tests", async () => {
  expect((await resolvePublishedTest(db, "alpha", "aptitude"))!.testId)
    .not.toBe((await resolvePublishedTest(db, "beta", "aptitude"))!.testId);
});

it("a test with current_version null resolves to null", async () =>
  expect(await resolvePublishedTest(db, "alpha", "draft-only")).toBeNull());

it("the slug 'attempt' never resolves, so it cannot shadow the attempt routes", async () => {
  await createWorkspace(db, newId("wsp"), { slug: "attempt", name: "Attempt" });
  expect(await resolvePublishedTest(db, "attempt", "anything")).toBeNull();
});
```

```ts
// apps/api/test/route-authority.test.ts — Review Focus 1. THE LOAD-BEARING FILE.
it("every mounted endpoint declares an authority", () =>
  expect(new Set(mountedEndpoints(app))).toEqual(new Set(Object.keys(ROUTE_AUTH))));

it("the workspace-authority set is exactly the guarded set", () => {
  // A route that loses its requires() in a later phase stops matching here even
  // though routeGuards(app) === ROUTE_ACTIONS still holds on both sides.
  expect(new Set(Object.entries(ROUTE_AUTH).filter(([, a]) => a === "workspace").map(([e]) => e)))
    .toEqual(new Set(Object.keys(ROUTE_ACTIONS)));
});

it("every attempt-authority endpoint actually mounts attemptContext", () => {
  for (const [endpoint, a] of Object.entries(ROUTE_AUTH)) {
    if (a === "attempt") expect(routeAuthorities(app)[endpoint], endpoint).toBe("attempt");
  }
});

it("the public set is a literal allowlist, so widening it is a visible diff", () => {
  expect(Object.entries(ROUTE_AUTH).filter(([, a]) => a === "public").map(([e]) => e).sort())
    .toEqual([
      "GET /api/v1/auth/:provider/callback", "GET /api/v1/auth/:provider/start",
      "GET /api/v1/health", "GET /api/v1/run/:workspaceSlug/:testSlug",
      "GET /api/v1/setup/status", "POST /api/v1/auth/magic-link",
    ]);   // every later task that adds one edits this literal
});

it("a candidate route is reachable with no cookie and spends no session read", async () => {
  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request("/api/v1/run/alpha/aptitude");
  expect(res.status).toBe(200);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug"]);
});
```

```ts
// apps/api/test/run/landing.test.ts
it("C-01: the landing payload carries everything the page shows", async () => {
  expect(await json("/api/v1/run/alpha/aptitude")).toMatchObject({
    name: "Aptitude", durationMinutes: 45, questionCount: 17,
    sections: [{ title: "Logic", questionCount: 4 }],
    proctoring: "standard", accessMode: "link_code", timezone: "Asia/Kolkata",
    opensAt: expect.any(Number), closesAt: expect.any(Number), serverNow: expect.any(Number),
  });
});

it("S-10: the landing payload names no question, key, code or internal id", async () => {
  const text = await (await app.request("/api/v1/run/alpha/aptitude")).text();
  for (const leak of ["LOG-001", "qst_", "wsp_", "tst_", "ver_", "OPENSESAME", "access_code"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("a pool section reports its requested count without reading the bank", async () => {
  const counting = countingDeps(deps);
  const body = await (await createApp(counting.deps).request("/api/v1/run/alpha/pooled")).json();
  expect(body.sections[0].questionCount).toBe(10);
  expect(counting.counts().total).toBe(1);
});

it("unpublished, archived and unknown are the same 404, byte for byte", async () => {
  const bodies = await Promise.all(["alpha/draft-only", "alpha/archived", "alpha/nope", "nope/x"]
    .map(async (p) => (await app.request(`/api/v1/run/${p}`)).text()));
  expect(new Set(bodies).size).toBe(1);
});

it("Hono reaches the attempt routes, not the slug-pair route, for /run/attempt/*", async () =>
  expect((await app.request("/api/v1/run/attempt/answer", { method: "PUT" })).status).toBe(401));
```

```tsx
// apps/web/test/exam/landing.test.tsx
it("C-01: name, duration, question count, sections, rules, proctoring, devices and the window", () => {
  render(<ExamLanding test={landingFixture} />);
  for (const t of [/45 minutes/, /17 questions/i, /Logic/, /Standard/i, /laptop or desktop/i, /opens/i]) {
    expect(screen.getByText(t)).toBeVisible();
  }
});

it("C-01: 'Check my device' reports before the window opens and does not block starting", async () => {
  render(<ExamLanding test={{ ...landingFixture, opensAt: Date.now() + 86_400_000 }} />);
  await userEvent.click(screen.getByRole("button", { name: /check my device/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/screen|browser/i);
  expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();   // the window, not the device
});

it("DESIGN.md: the landing page keeps the voltage canvas", () =>
  expect(container.querySelector(".exam-landing-hero")).toHaveClass("canvas-voltage"));

it("the landing and start pages have no axe violations", async () =>
  expect(await axe(container)).toHaveNoViolations());

it("WCAG 2.5.3: every control's accessible name contains its visible label", () => {
  for (const el of screen.getAllByRole("button")) {
    expect(accessibleName(el).toLowerCase()).toContain(visibleLabel(el).toLowerCase());
  }
});
```

```ts
// apps/web/test/bundle.test.ts (extended) — the 300 KB budget's structural guard
it("no organiser code is statically reachable from the exam entry", () =>
  expect(staticModules(threeEntryChunks, "exam").filter((m) => ADMIN_PATH_RE.test(m))).toEqual([]));

it("KaTeX is not in the exam entry's static graph either (ADR 0004)", () => {
  const modules = staticModules(threeEntryChunks, "exam").join("\n");
  for (const lazy of ["katex", "@vscode/markdown-it-katex"]) expect(modules).not.toContain(lazy);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db/test/repo/candidate-entry.test.ts apps/api/test/route-authority.test.ts apps/api/test/run apps/web/test/exam apps/web/test/bundle.test.ts`
Expected: FAIL — neither the module, the table nor the entry exists.

- [ ] **Step 3: Implement `resolvePublishedTest`, `ROUTE_AUTH`, `mountedEndpoints`, `routeAuthorities`, the landing route and the two screens**

`resolvePublishedTest` is one `SELECT` joining `workspace`, `test` and `test_version` on `test.current_version = test_version.version`, written as a single statement the way `readSessionActor` (`packages/db/src/repo/identity.ts`) is, returning null when any link is missing. `ROUTE_AUTH` goes beside `ROUTE_BUDGETS` and `ROUTE_ACTIONS` in `app.ts` with a line for **every** endpoint already mounted — classifying the existing twenty-odd routes once, here, is the migration. `routeAuthorities` reads a `WeakMap` that `attemptContext` registers into, exactly as `guardOf` reads `GUARDS`. `exam.html` is a third Rollup input beside `index` and `admin`; `_headers` gains `/exam.html  X-Robots-Tag: noindex` and the SPA fallback mapping `/<ws>/<test>` onto it, ordered **after** every specific rule so it cannot swallow `/api`, `/assets` or `/admin.html` — which is what the extended `hosting.test.ts` asserts.

- [ ] **Step 4: Write the ADR**

`docs/adr/00NN-candidate-runtime-is-a-third-request-authority.md` from `docs/adr/0000-template.md`, taking **the next free number at execution time**. Context: two authorities until now, and `authorization.test.ts` enumerates only one. Decision: the `/api/v1/run` prefix, the attempt token, `ROUTE_AUTH`, and `repo/candidate-entry.ts` as a third pre-workspace module rather than a growth of `identity.ts`. Consequences: `guard.ts` and `GUARDS` untouched; "unguarded" becomes declared rather than absent; the admission test is ADR 0006's. Add the row to `docs/adr/README.md`.

- [ ] **Step 5: Run the tests and commit**

Run: `pnpm vitest run packages/db apps/api apps/web` — PASS, with `authorization.test.ts` unchanged and green.

```bash
git add packages/db apps/api apps/web docs/adr
git commit -s -m "feat(run): candidate landing page and the third request authority"
```

---

## Task 2: Access gate for all four modes, and invite minting (#66, P6.2)

**Files:**
- Create: `apps/api/src/run/entry.ts`, `apps/api/src/run/net.ts`, `apps/api/src/routes/invites.ts`
- Create: `apps/api/test/run/access.test.ts`, `apps/api/test/run/net.test.ts`, `apps/api/test/invites.test.ts`
- Create: `apps/web/src/components/exam/AccessGate.tsx`, `apps/web/test/exam/access.test.tsx`
- Modify: `apps/api/src/routes/run.ts`, `apps/api/src/app.ts` (five `ROUTE_BUDGETS`, four `public` + **one `workspace`** `ROUTE_AUTH` line, and one `ROUTE_ACTIONS` line), `apps/api/src/auth/oidc.ts` (branch the callback), `packages/db/src/repo/run.ts`, `apps/web/src/routes/exam.tsx`

**Interfaces:**
- Consumes: `resolvePublishedTest` (Task 1) · `insertAuthToken(db, { tokenHash, kind, payload, now, expiresAt })`, `consumeAuthToken(db, tokenHash, kind, now): Promise<unknown>` (`packages/db/src/repo/identity.ts`) · `randomToken(): string`, `sha256Hex(value): Promise<string>` (`apps/api/src/auth/tokens.ts`) · `EmailAdapter` (`apps/api/src/email/adapter.ts`) · `requires("candidates.manage")`, `appendAudit`, `DbClient.batch` · `deps.http`, `deps.now` · `TestAccess`, `AccessMode` (`@pariksha/core`; **Phase 5** interface row 6) · **Phase 5's `candidate_list_entry` rows** (interface row 14 — a real dependency, not an assumption: `listCandidateListEntries` and `findCandidateListEntry`).
- Produces:
  ```ts
  // apps/api/src/run/entry.ts
  export const ENTRY_TTL_MS = 30 * 60_000;
  export const EMAIL_CODE_TTL_MS = 10 * 60_000;             // docs/test-format.md:69
  export interface EntryClaim { testVersionId: string; workspaceId: string; email?: string; listRef?: string }
  export function issueEntryToken(deps: AppDeps, claim: EntryClaim): Promise<string>;
  /** Reads without consuming. Task 3 consumes it in the same batch as the write. */
  export function readEntryToken(deps: AppDeps, token: string): Promise<EntryClaim | null>;
  export function consumeEntryToken(deps: AppDeps, token: string): Promise<EntryClaim | null>;

  // apps/api/src/run/net.ts — ~30 lines, no dependency
  export function ipInRanges(ip: string, cidrs: readonly string[]): boolean;   // v4 and v6
  export function emailInDomains(email: string, globs: readonly string[]): boolean;
  export function clientIp(c: Context<AppBindings>): string | null;            // CF-Connecting-IP, then X-Forwarded-For

  // apps/api/src/routes/invites.ts — organiser-facing, workspace authority, candidates.manage
  export interface MintedInvite { listEntryId: string; identifier: string; email: string | null; url: string }
  export function inviteRoutes(deps: AppDeps): Hono<AppBindings>;

  // packages/db/src/repo/run.ts — scoped(), in REPO_FUNCTIONS
  /** Which of a test's candidate-list entries already hold a live, unused invite. */
  export const listInvitedEntryIds: ScopedFn<[{ testId: string }], string[]>;

  // apps/web/src/lib/run.ts (widened)
  export interface RunClient {
    access(input: { code?: string; invite?: string; email?: string; otp?: string; captchaToken?: string }):
      Promise<{ entryToken: string }>;
    requestEmailCode(email: string): Promise<void>;
  }
  ```

All four modes end in one place — a single-use `run_entry` token carrying the test version and, where the mode knows it, a verified email — so Task 3 has exactly one thing to check and the four gates do not each grow their own session concept. The token is an `auth_token` row: `consumeAuthToken` is already a single `UPDATE … WHERE used_at IS NULL AND expires_at > ? RETURNING`, the race-free single-use primitive all four need, with `kind` in the `WHERE` clause so a `run_invite` cannot be redeemed as a `run_entry`.

| Mode | The gate | The attack it stops | The test that proves it |
| --- | --- | --- | --- |
| `link_code` | Constant-time compare against `access.access_code` | Brute-forcing a short code over a public URL | The `test_access` bucket (Task 4) refuses the 11th wrong code in a minute |
| `invite_only` | `consumeAuthToken(hash, "run_invite", now)` against a link this phase minted | Replaying one candidate's personal link; two tabs racing it; an invite forged for a candidate not on the list | Mint-then-consume as one round trip; two concurrent redemptions give exactly one 200, one 410, one candidate row; minting for an identifier absent from the list is 422 |
| any mode with `access.candidate_list` | `findCandidateListEntry(testId, identifier)` before the switch (`T-21`) | A candidate who was never on the uploaded list registering on a public link | An identifier absent from the list is refused with the same body as a wrong code |
| `email_code` | 6 digits, 10-minute expiry, stored only as `sha256(testVersionId:email:code)` | Reading codes out of a database dump; guessing by volume | No 6-digit string appears in an `auth_token` dump; the 6th wrong code for an address is refused |
| `sso` | The organiser OIDC flow's discovery, PKCE and ID-token verification, branched at the end | A candidate outside `allow_email_domains`; an unverified `email` claim | A token with no `email_verified` is refused unless the provider is configured for it; an outside address is refused with the rule named |

**`sso` creates no user row and issues no session cookie.** `apps/api/src/auth/oidc.ts` already performs discovery, PKCE S256, the token exchange and ID-token verification over the injectable `deps.http`; the candidate callback reuses all of it and branches where the organiser flow calls `createUser` and `issueSession`, minting a `run_entry` token with the verified email instead ([ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md): "Nothing in this decision gives a candidate a user row").

### Ruling: Phase 6 mints the invite links, and it is this phase's one workspace-authority route

**Ruling: `POST /tests/{id}/invites` is a Phase 6 deliverable, mounted as `POST /api/v1/workspaces/:id/tests/:testId/invites`, guarded by `requires("candidates.manage")`, and declared `workspace` in `ROUTE_AUTH`. Phase 5 owns the candidate list it draws from; Phase 6 owns the tokens.**

— **Why:** the two plans were written in parallel and left a hole — this plan's interface row 13 assumed Phase 5 minted invites, and Phase 5 assumed Phase 6 ingested the list; neither built the other half. The split follows ownership of the data: the candidate list is organiser content uploaded during test building (`T-21`, `docs/ROADMAP.md`'s Phase 5 "Delivers": "access modes and allowlists"), while an invite is a single-use credential whose whole lifecycle — mint, deliver, consume, refuse a replay — is the access gate this task already builds, on the `auth_token` table it already uses. Splitting it the other way would put `consumeAuthToken`'s single-use semantics in one phase and its only producer in another. The path is `/api/v1/workspaces/:id/tests/:testId/invites` and not the PRD's bare `/tests/{id}/invites` for the reason stated in Global Constraints: `guard()` (`apps/api/src/middleware/authorize.ts:106`) reads `c.req.param("id")` and throws without it, and Phase 4 mounted `/workspaces/:id/banks/…` against the PRD's bare `/banks` for the same reason. `candidates.manage` is in the matrix already (`packages/core/src/permissions.ts:15`), held by owner and admin and by nobody else.

— **Cost if wrong:** if Phase 5 turns out to mint them after all, this task deletes one route file and one `ROUTE_ACTIONS` line; the consume side is unchanged either way. If *neither* phase mints them, `invite_only` is a mode with no way to issue a link — which is the hole this ruling closes.

**It is the first `workspace`-authority route in an otherwise candidate-facing phase, which is exactly what `ROUTE_AUTH` was built for.** `route-authority.test.ts`'s second direction — the `workspace` set equals `Object.keys(ROUTE_ACTIONS)` — covers it with no new machinery: the route adds one line to each table, and a mismatch between them fails. Add it to both in the same commit.

**Mint and consume are tested as one round trip, not separately.** A mint test that asserts a row and a consume test that asserts a redemption can both pass while the URL shape, the `kind` string or the payload disagree between them. The test issues invites through the organiser route, hands the returned URL to the candidate route, and asserts the redemption — then replays it.

**The allowlists are checked before the mode's own gate** (`docs/test-format.md:72`, `T-21`), so an off-network candidate never learns whether their code was right. A request carrying no client-IP header at all, on a test that sets `allow_ip_ranges`, is refused rather than allowed — failing open on an allowlist is the whole of the bug. **`T-21`'s candidate-list allowlist is no longer deferred**: Phase 5's `candidate_list_entry` rows are real and queryable, so a test whose `access.candidate_list` is set refuses an identifier that is not on the list, in the same pre-switch block as the domain and IP checks.

**`C-02`'s errors say what to do next.** Codes: `invite_used` ("This invite link was already used. Contact the organiser." — the PRD's own wording), `code_wrong`, `code_expired`, `domain_not_allowed`, `ip_not_allowed`, `window_closed`, `too_many_attempts`.

| Method | Path | Authority | `ROUTE_ACTIONS` | `ROUTE_BUDGETS` |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/access` | `public` | — | `MEASURE` |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/email-code` | `public` | — | `MEASURE` (the email send is not a D1 or R2 call) |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/sso/start` | `public` | — | `MEASURE` |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/sso/callback` | `public` | — | `MEASURE` |
| `POST` | `/api/v1/workspaces/:id/tests/:testId/invites` | **`workspace`** | `candidates.manage` | `MEASURE` (auth 2 + list read + already-invited read + one `batch` + audit) |

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/access.test.ts
it("link_code: the right code yields a single-use entry token", async () => {
  const { entryToken } = await (await post("/api/v1/run/alpha/aptitude/access", { code: "OPENSESAME" })).json();
  expect(await readEntryToken(deps, entryToken)).toMatchObject({ testVersionId: ver });
});

it("link_code: a wrong code is refused with an actionable message and mints nothing", async () => {
  const body = await (await post("/api/v1/run/alpha/aptitude/access", { code: "nope" })).json();
  expect(body.error).toMatchObject({ code: "code_wrong", message: expect.stringMatching(/check|ask|organiser/i) });
  expect(await countAuthTokens("run_entry")).toBe(0);
});

it("invite_only: a link minted by the organiser route works once, and the replay is 410", async () => {
  // One round trip: the mint side and the consume side cannot drift on URL shape,
  // `kind` or payload, because only one test touches both.
  const [invite] = await mintInvites(testId, ["21CS0147"], asAdmin);
  expect((await redeem(invite.url)).status).toBe(200);
  const again = await redeem(invite.url);
  expect(again.status).toBe(410);
  expect((await again.json()).error.message).toMatch(/already used.*organiser/i);
});

it("invite_only: two concurrent redemptions produce exactly one entry token", async () => {
  const [invite] = await mintInvites(testId, ["21CS0147"], asAdmin);
  const [a, b] = await Promise.all([redeem(invite.url), redeem(invite.url)]);
  expect([a.status, b.status].sort()).toEqual([200, 410]);
});

it("T-21: an identifier absent from the candidate list is refused like a wrong code", async () => {
  const onList = await post("/api/v1/run/alpha/listed/access", { code: "OPENSESAME", identifier: "21CS0147" });
  const offList = await post("/api/v1/run/alpha/listed/access", { code: "OPENSESAME", identifier: "99XX9999" });
  expect(onList.status).toBe(200);
  expect(offList.status).toBe(403);
  expect(await offList.text()).toBe(await (await post("/api/v1/run/alpha/listed/access", { code: "nope" })).text());
});

it("email_code: six digits, emailed, 10-minute expiry, never stored in the clear", async () => {
  await post("/api/v1/run/alpha/otp/email-code", { email: "a@b.ac.in" });
  const code = sentCode(mailbox);
  expect(code).toMatch(/^\d{6}$/);
  expect(JSON.stringify(await allAuthTokenRows())).not.toContain(code);
  deps.now = () => T + EMAIL_CODE_TTL_MS + 1;
  expect((await post("/api/v1/run/alpha/otp/access", { email: "a@b.ac.in", otp: code })).status).toBe(401);
});

it("sso: a verified address inside the domain rule gets an entry token, no user row and no cookie", async () => {
  const res = await ssoCallback({ email: "s@college.ac.in", email_verified: true });
  expect(res.headers.get("set-cookie") ?? "").not.toContain("pk_session");
  expect(await countUsers()).toBe(usersBefore);
});

it("sso: an address outside allow_email_domains is refused and the rule is named", async () => {
  expect((await (await ssoCallback({ email: "s@gmail.com", email_verified: true })).json()).error)
    .toMatchObject({ code: "domain_not_allowed", message: expect.stringContaining("*.ac.in") });
});

it("sso: no email_verified claim is refused unless the provider is configured for it", async () =>
  expect((await ssoCallback({ email: "s@college.ac.in" })).status).toBe(401));

it("T-21: the IP allowlist is checked first, so an off-network candidate learns nothing about their code", async () => {
  const off = { headers: { "CF-Connecting-IP": "203.0.113.9" } };
  const right = await post("/api/v1/run/alpha/lab/access", { code: "OPENSESAME" }, off);
  const wrong = await post("/api/v1/run/alpha/lab/access", { code: "nope" }, off);
  expect(await right.text()).toBe(await wrong.text());
  expect((await right.json()).error.code).toBe("ip_not_allowed");
});

it("a request with no client-IP header is refused when the test sets allow_ip_ranges", async () =>
  expect((await post("/api/v1/run/alpha/lab/access", { code: "OPENSESAME" })).status).toBe(403));

it("C-02: every refusal message tells the candidate what to do next", async () => {
  for (const r of await everyRefusal()) expect(r.message, r.code).toMatch(/\b(check|ask|contact|try|wait|use|sign)\b/i);
});
```

```ts
// apps/api/test/run/net.test.ts
it.each([
  ["10.0.0.5", ["10.0.0.0/8"], true], ["11.0.0.5", ["10.0.0.0/8"], false],
  ["192.168.1.1", ["192.168.1.0/24"], true], ["192.168.2.1", ["192.168.1.0/24"], false],
  ["2001:db8::1", ["2001:db8::/32"], true], ["2001:dba::1", ["2001:db8::/32"], false],
  ["10.0.0.5", [], false],                                  // an empty list allows nobody
])("ipInRanges(%j, %j) is %s", (ip, cidrs, x) => expect(ipInRanges(ip, cidrs)).toBe(x));

it.each([
  ["a@iit.ac.in", ["*.ac.in"], true], ["a@acme.in", ["*.ac.in"], false],
  ["a@evil.test?x=@iit.ac.in", ["*.ac.in"], false],         // the domain follows the LAST @
])("emailInDomains(%j, %j) is %s", (e, g, x) => expect(emailInDomains(e, g)).toBe(x));
```

```ts
// apps/api/test/invites.test.ts — the organiser half, and this phase's one guarded route
it("an Admin mints one single-use link per candidate-list entry", async () => {
  const minted = await mintInvites(testId, ["21CS0147", "21CS0148"], asAdmin);
  expect(minted.map((m) => m.identifier)).toEqual(["21CS0147", "21CS0148"]);
  expect(new Set(minted.map((m) => m.url)).size).toBe(2);
  expect(minted[0]!.url).toMatch(/^https:\/\/[^/]+\/alpha\/invited\?invite=/);
});

it("an Author cannot mint, and a cross-workspace test is 404 not 403", async () => {
  expect((await mintRaw(testId, ["x"], asAuthor)).status).toBe(403);
  expect((await mintRaw(testInWorkspaceB, ["x"], asAdmin)).status).toBe(404);
});

it("minting for an identifier that is not on the test's candidate list is 422, naming it", async () => {
  const res = await mintRaw(testId, ["99XX9999"], asAdmin);
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.unknown).toEqual(["99XX9999"]);
});

it("minting twice for the same entry does not issue a second live link", async () => {
  await mintInvites(testId, ["21CS0147"], asAdmin);
  expect((await mintInvites(testId, ["21CS0147"], asAdmin))[0]!.url).toBeUndefined();
  expect(await liveInviteCount(testId, "21CS0147")).toBe(1);
});

it("only the hash is stored — the minted URL's token appears in no row", async () => {
  const [m] = await mintInvites(testId, ["21CS0147"], asAdmin);
  expect(JSON.stringify(await allAuthTokenRows())).not.toContain(tokenIn(m.url));
});

it("minting 200 invites is one batch, flat in the list's size", async () => {
  const counting = countingDeps(deps);
  await mintInvites(testId, twoHundredIdentifiers, asAdmin, createApp(counting.deps));
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/invites"]);
});

it("the route is in ROUTE_ACTIONS and declared workspace in ROUTE_AUTH", () => {
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/invites"]).toBe("candidates.manage");
  expect(ROUTE_AUTH["POST /api/v1/workspaces/:id/tests/:testId/invites"]).toBe("workspace");
});

it("S-18: minting writes one audit row naming the test and the count, not the tokens", async () => {
  await mintInvites(testId, ["21CS0147", "21CS0148"], asAdmin);
  const [row] = await auditFor(testId);
  expect(row).toMatchObject({ action: "invites.minted", detail_json: expect.stringContaining('"count":2') });
  expect(JSON.stringify(row)).not.toContain(tokenIn(minted[0]!.url));
});
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

it("no axe violations and the error is associated with the field", async () => {
  expect(await axe(container)).toHaveNoViolations();
  expect(screen.getByLabelText(/access code/i)).toHaveAccessibleDescription(/check the code/i);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run apps/web/test/exam/access.test.tsx` — FAIL.

- [ ] **Step 3: Implement the four gates**

One handler, one `switch` on `access.mode`, with the three allowlists — domains, IP ranges, candidate list — checked before the switch. `ipInRanges` parses v4 into a 32-bit integer and v6 into two `BigInt` halves and masks, written here rather than taken from a dependency because the Worker bundle is size-constrained and the input is two well-defined notations. The email-code row's key is `sha256Hex(`${testVersionId}:${email.toLowerCase()}:${code}`)`, so the row is a lookup key and never a plaintext secret. The `sso` callback imports from `apps/api/src/auth/oidc.ts` and diverges only at the final step. `inviteRoutes` mounts under the existing `/api/v1/workspaces` prefix beside `bankRoutes`, reads the test's candidate-list entries and the already-invited set, and writes every token row in **one** `db.batch` so the cost is flat in the list's size.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api apps/web` and `pnpm vitest run apps/api/test/budget.test.ts apps/api/test/route-authority.test.ts`
Expected: PASS, with four new `ROUTE_AUTH` lines and four measured budgets.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web
git commit -s -m "feat(run): access gate for all four modes, allowlists and invite minting"
```

---

## Task 3: Consent and registration with server-side validation (#67, P6.3)

**Files:**
- Create: `packages/core/src/registration.ts`, `packages/core/test/registration.test.ts`
- Create: `apps/api/src/run/registration.ts`, `apps/api/test/run/registration.test.ts`
- Create: `apps/web/src/components/exam/ConsentPanel.tsx`, `apps/web/src/components/exam/RegistrationForm.tsx`, `apps/web/test/exam/registration.test.tsx`
- Modify: `packages/core/src/index.ts`, `packages/core/src/types.ts` (the `RegistrationForm`, `FormField`, `FieldValidation`, `Consent` and `Timing` types — **only if Phase 5 did not add them**; interface rows 7, 8, 10), `packages/db/src/schema/columns.ts` (`candidate_unique`; `consent_at` on `candidate`), `packages/db/src/repo/run.ts`, `packages/db/test/parity.test.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `readEntryToken` / `consumeEntryToken` (Task 2) · `createCandidate(db, ws, { testId, formValues, consentVersion, now? }): Promise<string>`, `appendAudit`, `scoped`, `DbClient.batch(statements)` (`@pariksha/db`) · `limitOrThrow` (Task 4, after it lands) · `matchBounded` (Task 11 hardens it; this task writes the first version in `apps/api/src/run/bounded.ts`). From **Phase 5**: the registration form (row 7) and consent (row 10).
- Produces:
  ```ts
  // packages/core/src/registration.ts — pure, no I/O, the ONE copy of T-17's rules
  export interface FieldIssue { field: string; code: string; message: string }
  export function validateRegistration(
    form: RegistrationForm,
    values: Record<string, unknown>,
    opts?: { matcher?: (pattern: string, input: string) => boolean },
  ): FieldIssue[];
  /** Only the fields the form declares, coerced to their declared type. */
  export function normaliseValues(form: RegistrationForm, values: Record<string, unknown>): Record<string, unknown>;
  export function uniqueFieldIds(form: RegistrationForm): string[];

  // packages/db/src/repo/run.ts — scoped(), in REPO_FUNCTIONS
  export const registerCandidate: ScopedFn<
    [{ testId: string; formValues: unknown; consentVersion: string; consentAt: number;
       claims: { fieldId: string; valueHash: string }[]; now: number }],
    { candidateId: string } | { taken: string[] }>;

  // apps/api/src/run/bounded.ts
  export const MAX_MATCH_INPUT = 500;    // question-format.md's short_answer ceiling
  export function matchBounded(pattern: string, input: string): boolean;

  // apps/web/src/lib/run.ts (widened)
  export interface RunClient {
    form(entryToken: string): Promise<{ consent: { version: string; text: string }; form: RegistrationForm }>;
    register(entryToken: string, values: Record<string, unknown>, captchaToken?: string):
      Promise<{ registrationToken: string }>;
  }
  ```

**The validator is one function in `packages/core`, called twice.** `docs/test-format.md:110` — "Every rule is re-checked on the server. The browser's copy of it is a courtesy, not a control" — and the cheapest way to make the browser's copy *be* the server's rule is one implementation and two callers, which also makes the inline message a candidate sees identical to the 422's. `packages/core` stays pure: data in, issues out, with the regex matcher injected, because a bounded matcher needs a host a pure package does not have (issue [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129) — the server passes `matchBounded`, the browser passes `RegExp.test`).

**Unique fields need a table, not a JSON index.** `candidate.form_values_json` is a JSON column and neither dialect gives a portable unique index into one, so `T-17` becomes `candidate_unique(workspace_id, test_id, field_id, value_hash)` with `UNIQUE (test_id, field_id, value_hash)`. The value is stored as a SHA-256 of the normalised value, so the table that blocks a repeat email does not become a second plaintext copy of every candidate's email beside the encryptable one (`S-15`). Every claim is written in **one** `db.batch` with the candidate insert, so a duplicate rolls the whole registration back — `AC-12`'s refusal with no half-written candidate behind it.

**Consent (`S-12`).** `candidate.consent_version` already exists; this task adds `consent_at`. Both are stored so a later edit to the text stays distinguishable (`docs/test-format.md:85`).

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/form` | `public` (entry token, `Authorization: Bearer`) | `MEASURE` |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/register` | `public` (entry token) | `MEASURE` |

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/registration.test.ts — the rules, once
it.each([
  ["required",    { id: "name", type: "short_text", label: "Name", required: true }, {}, "required"],
  ["min_length",  { id: "n", type: "short_text", label: "N", validation: { min_length: 3 } }, { n: "ab" }, "too_short"],
  ["pattern",     { id: "roll", type: "short_text", label: "Roll", validation: { pattern: "^\\d{2}[A-Z]{2}\\d{4}$", pattern_message: "Format: 21CS0147" } }, { roll: "x" }, "pattern"],
  ["email domain",{ id: "e", type: "email", label: "E", validation: { allowed_domains: ["*.ac.in"] } }, { e: "a@gmail.com" }, "domain"],
  ["number max",  { id: "cgpa", type: "number", label: "C", validation: { min: 0, max: 10 } }, { cgpa: 11 }, "max"],
  ["integer",     { id: "yr", type: "number", label: "Y", validation: { integer: true } }, { yr: 2026.5 }, "integer"],
  ["date max",    { id: "d", type: "date", label: "D", validation: { max: "2026-01-01" } }, { d: "2027-01-01" }, "max"],
  ["dropdown",    { id: "deg", type: "dropdown", label: "D", options: ["BE", "ME"] }, { deg: "PhD" }, "not_an_option"],
  ["checkbox",    { id: "s", type: "checkbox", label: "S", options: ["a", "b"] }, { s: ["a", "z"] }, "not_an_option"],
  ["url domain",  { id: "u", type: "url", label: "U", validation: { allowed_domains: ["github.com"] } }, { u: "https://evil.test" }, "domain"],
  ["consent",     { id: "c", type: "consent", label: "C", required: true }, { c: false }, "required"],
])("T-17: %s is an issue on the field itself", (_n, field, values, code) =>
  expect(validateRegistration({ fields: [field] }, values)[0]).toMatchObject({ field: field.id, code }));

it("AC-12: pattern_message is the message, verbatim", () =>
  expect(validateRegistration(rollForm, { roll: "x" })[0]!.message).toBe("Format: 21CS0147"));

it("S-11: a field the form does not declare is dropped, not stored", () =>
  expect(normaliseValues(nameForm, { name: "A", secret: "x" })).toEqual({ name: "A" }));

it("every issue names a field that exists in the form", () => {
  for (const i of validateRegistration(campusHiringForm, {})) {
    expect(campusHiringForm.fields.map((f) => f.id)).toContain(i.field);
  }
});

it("#129: the injected matcher is what runs a pattern, so the server can bound it", () => {
  const seen: string[] = [];
  validateRegistration(rollForm, { roll: "x" }, { matcher: (p) => { seen.push(p); return false; } });
  expect(seen).toEqual(["^\\d{2}[A-Z]{2}\\d{4}$"]);
});
```

```ts
// apps/api/test/run/registration.test.ts
it("AC-12: an invalid submission is 422, names every bad field, writes no candidate", async () => {
  const res = await register(entryToken, { email: "nope", cgpa: 11 });
  expect(res.status).toBe(422);
  expect((await res.json()).error.details.issues.map((i) => i.field).sort()).toEqual(["cgpa", "email"]);
  expect(await countCandidates(testId)).toBe(0);
});

it("AC-12: the server refuses a rule the browser was patched to skip", async () =>
  expect((await register(entryToken, { email: "a@b.ac.in", roll: "not-a-roll" })).status).toBe(422));

it("AC-12: a repeat of a unique field is refused and the field is named", async () => {
  await register(await gate(), { email: "a@b.ac.in", roll: "21CS0147" });
  const res = await register(await gate(), { email: "a@b.ac.in", roll: "21CS9999" });
  expect(res.status).toBe(409);
  expect((await res.json()).error.details).toMatchObject({ fields: ["email"] });
});

it("a refused duplicate leaves no candidate row and no partial claim", async () => {
  expect(await countCandidates(testId)).toBe(1);
  expect(await countUniqueClaims(testId, "roll")).toBe(1);
});

it("two registrations racing on the same unique value: exactly one wins", async () => {
  const [a, b] = await Promise.all([register(await gate(), v), register(await gate(), v)]);
  expect([a.status, b.status].sort()).toEqual([201, 409]);
  expect(await countCandidates(testId)).toBe(1);
});

it("the unique table stores a hash, never the value", async () =>
  expect(JSON.stringify(await allUniqueRows())).not.toContain("a@b.ac.in"));

it("S-12: the consent version and the acceptance time are stored per candidate", async () =>
  expect(await candidateRow(testId)).toMatchObject({ consent_version: "2026-10-01", consent_at: expect.any(Number) }));

it("S-12: registering without accepting the consent is refused on the consent field", async () =>
  expect((await register(entryToken, { ...valid, consent: false })).status).toBe(422));

it("the form route answers only behind a live entry token", async () =>
  expect((await app.request("/api/v1/run/alpha/aptitude/form")).status).toBe(401));

it("the entry token is single use and cannot be replayed at registration", async () => {
  await register(entryToken, validValues);
  expect((await register(entryToken, validValues)).status).toBe(410);
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

it("the consent text renders through the one shared renderer, not a second one", async () =>
  expect(await screen.findByRole("list")).toBeVisible());   // the consent text's Markdown bullets

it("AC-12: the browser's message for a failed rule is byte-identical to the server's", async () => {
  const client = validateRegistration(form, { roll: "x" })[0]!;
  const server = (await (await register(token, { roll: "x" })).json()).error.details.issues[0];
  expect(client.message).toBe(server.message);
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

Run: `pnpm vitest run packages/core/test/registration.test.ts apps/api/test/run/registration.test.ts apps/web/test/exam/registration.test.tsx` — FAIL.

- [ ] **Step 3: Implement `validateRegistration`, `normaliseValues`, `registerCandidate`, `matchBounded` and the two routes**

`validateRegistration` is one `switch` on `field.type` behind a shared `required` check, collecting rather than throwing at the first, which is what lets the route return every bad field at once. The route's order is: read the entry token, validate, hash the unique values, then **one** `db.batch([consume entry token, insert candidate, …insert claims])` so a `UNIQUE` violation rolls the whole thing back; on the failure path only, one query re-reads which hashes already exist so the 409 can name the fields.

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
- Create: `apps/api/src/run/ratelimit.ts`, `apps/api/src/run/pow.ts`, `apps/api/src/run/captcha.ts`
- Create: `apps/api/test/run/ratelimit.test.ts`, `apps/api/test/run/pow.test.ts`, `apps/api/test/run/captcha.test.ts`
- Create: `apps/web/src/lib/pow.ts`, `apps/web/test/exam/pow.test.ts`
- Modify: `packages/db/src/schema/columns.ts` (`rate_limit`), `packages/db/src/repo/run.ts`, `apps/api/src/env.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`, `apps/web/src/components/exam/RegistrationForm.tsx`, `apps/web/test/hosting.test.ts`, `docs/PRD.md` (the `AC-01` / acceptance checklist note that `S-07` is formally unmet)
- **No ADR.** The CSP is not narrowed — see the ruling below. `apps/api/src/middleware/security.ts` and `apps/web/public/_headers` are **not** modified by this task.

**Interfaces:**
- Consumes: `scoped`, `DbClient.run` · `deps.http`, `deps.now`, `AppEnv` (`apps/api/src/env.ts`) · `ApiError` · `TestAccess` (**Phase 5** interface row 6, `captcha` defaulting to `true`).
- Produces:
  ```ts
  // packages/db/src/repo/run.ts — one statement: insert-or-increment inside the window
  export const takeRateToken: ScopedFn<
    [{ bucket: string; limit: number; windowMs: number; now: number }],
    { allowed: boolean; count: number; retryAfterMs: number }>;

  // apps/api/src/run/ratelimit.ts
  export type RateBucket =
    | "test_access" | "test_register" | "email_code" | "attempt_start" | "attempt_submit" | "result_code";
  export const LIMITS: Readonly<Record<RateBucket, { limit: number; windowMs: number }>>;
  /** Throws ApiError(429) with Retry-After. `key` is a test version, candidate or email hash — never an IP. */
  export function limitOrThrow(deps: AppDeps, workspaceId: string, bucket: RateBucket, key: string): Promise<void>;

  // apps/api/src/run/pow.ts — the default bot protection. Same origin, no third party.
  export const POW_DIFFICULTY_BITS = 18;          // ~0.3 s on a laptop, ~1.5 s on a slow phone
  export const POW_TTL_MS = 10 * 60_000;
  export interface PowChallenge { challenge: string; bits: number; expiresAt: number }
  /** HMAC(SESSION_SECRET, `${testVersionId}:${nonce}:${expiresAt}`) — stateless, so issuing costs no row. */
  export function issuePowChallenge(deps: AppDeps, testVersionId: string, now: number): Promise<PowChallenge>;
  /** True when `solution` is a preimage whose SHA-256 over the challenge has POW_DIFFICULTY_BITS leading zeros
   *  AND the challenge's HMAC and expiry verify. Throws nothing; a bad solution is false. */
  export function verifyPow(deps: AppDeps, challenge: string, solution: string, now: number): Promise<boolean>;

  // apps/web/src/lib/pow.ts — WebCrypto only; runs in the page, not a worker (it is sub-second)
  export function solvePow(challenge: string, bits: number): Promise<string>;

  // apps/api/src/run/captcha.ts — the per-instance opt-in, OFF by default
  export function captchaConfigured(deps: AppDeps): boolean;
  export function captchaRequired(deps: AppDeps, access: TestAccess): boolean;
  /** Resolves true when unconfigured — an instance with no provider is not broken (AC-01). */
  export function verifyCaptcha(deps: AppDeps, token: string | undefined): Promise<boolean>;
  ```

| Attack | Control | The test |
| --- | --- | --- |
| A script registers ten thousand fake candidates on a public `link_code` test, exhausting the free tier's 100,000 daily D1 writes and burying the real results | `test_register` bucket, keyed by test version | The 101st registration in the window is 429 with `Retry-After`, and the write count stops rising |
| A script brute-forces a short `access_code` over a public URL | `test_access` bucket, keyed by test version | The 11th wrong code in a minute is refused before the code is compared |
| A script requests ten thousand codes to one address, or sprays one code across ten thousand addresses | `email_code` bucket, keyed by test version **and** separately by `sha256(email)` | Both directions refused; the email adapter records no send past the limit |
| One valid registration opens a thousand attempts | `attempt_start` bucket, keyed by candidate, under `attempts_allowed` (Task 5) | The second attempt on a one-attempt test is 409 before any layout is computed |
| A headless browser farm registers at human speed, under every limit | A same-origin proof of work on registration (see the ruling below) | Registering without a valid solution is 403; a solution for another test version, a replayed one and an expired one are each 403 |
| An operator who wants a hosted captcha instead | `verifyCaptcha` over `deps.http`, off unless a secret is configured | A failed verification is 403 and writes no candidate; an unconfigured instance registers normally |

**Limits are per attempt and per test, never per IP** — `S-07` and `docs/test-format.md:74`: "a whole campus often shares one."

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/challenge` | `public` | `MEASURE` (expected **0** — an HMAC over the slug pair's already-resolved version, or 1 if it must resolve it) |

**The bucket store is a D1 table, not KV and not a Durable Object.** One `INSERT … ON CONFLICT DO UPDATE` is a single statement, one subrequest, portable to SQLite and Postgres, and testable in memory; the alternatives are Cloudflare-only, which ADR 0002's adapter rule rules out for the reference path. Buckets apply to the expensive, abusable routes (access, email-code, register, start, submit, result-code) and **not** to the answer save: a save is already bounded by a live attempt token and a server deadline, and a counter write would double the hottest path against the PRD's "one D1 write" line for no attack it stops. `ponytail:` a `DELETE FROM rate_limit WHERE window_start < ?` sweep belongs beside Phase 8's retention job; until then the table grows one row per bucket per window.

### Ruling: bot protection is a same-origin proof of work, and a hosted captcha is a per-instance opt-in

**Ruling: registration is protected by a same-origin proof of work by default; Turnstile / hCaptcha stays available behind `CAPTCHA_SECRET` for an operator who chooses it and accepts the CSP change on their own deployment. `S-07` is therefore formally unmet, and is recorded as unmet rather than quietly treated as satisfied.**

— **Why:** the PRD contradicts itself, and the stronger clause is the privacy promise. Turnstile is named in **three** places, all of which this ruling overrides: `S-07` (`docs/PRD.md:386`, "Registration is protected by Cloudflare Turnstile or hCaptcha (both free) **and** by rate limits per attempt and per test"), the reference-stack diagram (`docs/PRD.md:437`, "Pages, Workers, D1, R2, **Turnstile**") and the adapter table (`docs/PRD.md:456`, "Bot protection | Turnstile | hCaptcha or Turnstile"). Against them stands `S-11`: "No analytics, telemetry or third-party scripts; fonts and the face model are served from the app itself." A widget from `challenges.cloudflare.com` needs `script-src`, `frame-src` and `connect-src` entries in a CSP that is `'self'` in two files that must stay byte-identical (`apps/api/src/middleware/security.ts:17`, `apps/web/public/_headers`), one of which `apps/web/test/hosting.test.ts:25` pins by asserting no `https?://` appears at all. `S-11` is the clause the product is marketed on and the one a self-hoster cannot restore after the fact; the three Turnstile mentions all name *a* mechanism for a goal a same-origin proof of work also serves, at the cost of being weaker against a determined farm. The proof of work is a few lines of WebCrypto, costs a candidate under a second (and `P-01` blocks phones anyway), and keeps every default deployment at `'self'`.

— **Cost if wrong:** a farm with real CPU registers anyway, so a public `link_code` test accumulates junk candidate rows at whatever rate the `test_register` bucket allows. Recovery is one environment variable, not a code change: `verifyCaptcha`'s seam, `access.captcha` and `captchaConfigured()` all ship in this task, so an operator turns Turnstile on, adds the three CSP directives to their own `_headers`, and accepts that their instance no longer satisfies `S-11`.

**Recorded as unmet.** `S-07`'s second half — rate limits per attempt and per test — ships in full. Its first half does not, on the default deployment, and this task edits the acceptance checklist in `docs/PRD.md` to say so rather than leaving a reader to infer it from a passing suite.

**The seam, unchanged by the ruling:** `captchaRequired()` reads `access.captcha` and `captchaConfigured()`; `verifyCaptcha()` posts to `CAPTCHA_VERIFY_URL` with `CAPTCHA_SECRET` over `deps.http`, and **returns true when nothing is configured**, because `AC-01` promises a working deployment in thirty minutes "using no paid service". **This task does not touch the CSP in either file.**

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
  await post("/api/v1/run/alpha/aptitude/access", { code: "nope" },
    { headers: { "CF-Connecting-IP": "198.51.100.77" } });
  expect(JSON.stringify(await allRateRows())).not.toContain("198.51.100.77");
});

it("two tests on one instance do not share a bucket", async () => {
  await exhaust("alpha/aptitude");
  expect((await post("/api/v1/run/alpha/other/access", { code: "OPENSESAME" })).status).toBe(200);
});

it("the window rolls: the limit is spendable again once windowMs has passed", async () => {
  await exhaust("alpha/aptitude");
  deps.now = () => T + LIMITS.test_access.windowMs + 1;
  expect((await post("/api/v1/run/alpha/aptitude/access", { code: "OPENSESAME" })).status).toBe(200);
});

it("taking a token is one statement, so a limiter adds at most 1 to a route's budget", async () => {
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
// apps/api/test/run/pow.test.ts — the default control
it("registering without a proof of work is 403 and writes no candidate", async () => {
  expect((await register(await gate(), valid, { pow: undefined })).status).toBe(403);
  expect(await countCandidates(testId)).toBe(0);
});

it("a valid solution registers, and the same solution replayed is refused", async () => {
  const { challenge, bits } = await (await get("/api/v1/run/alpha/aptitude/challenge")).json();
  const solution = await solvePow(challenge, bits);
  expect((await register(await gate(), valid, { challenge, solution })).status).toBe(201);
  expect((await register(await gate(), other, { challenge, solution })).status).toBe(403);
});

it("a challenge minted for another test version, or an expired one, is refused", async () => {
  expect((await registerOn("other", await gate(), valid, solvedForAptitude)).status).toBe(403);
  deps.now = () => T + POW_TTL_MS + 1;
  expect((await register(await gate(), valid, solvedForAptitude)).status).toBe(403);
});

it("issuing a challenge costs no database row — it is an HMAC, not a table", async () => {
  const counting = countingDeps(deps);
  await createApp(counting.deps).request("/api/v1/run/alpha/aptitude/challenge");
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/challenge"]);
});

it("S-11: the solver uses WebCrypto only and reaches no third-party origin", async () => {
  const seen: string[] = [];
  await withFetchSpy(seen, () => solvePow(challenge, POW_DIFFICULTY_BITS));
  expect(seen).toEqual([]);
});

it("the work is bounded: solving at the shipped difficulty stays under 3 s in jsdom", async () => {
  const started = performance.now();
  await solvePow(challenge, POW_DIFFICULTY_BITS);
  expect(performance.now() - started).toBeLessThan(3000);
});

it("a candidate whose browser cannot run it gets a message, not a dead button", async () => {
  render(<RegistrationForm form={f} onSubmit={noop} solve={() => Promise.reject(new Error("no subtle"))} />);
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/could not complete the security check/i);
});
```

```ts
// apps/api/test/run/captcha.test.ts — the opt-in
it("AC-01: an instance with no captcha configured registers normally", async () =>
  expect((await register(await gate(), valid)).status).toBe(201));

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

it("access.captcha=false turns it off for that test even when configured", () =>
  expect(captchaRequired(withCaptchaDeps, { mode: "link_code", access_code: "x", captcha: false })).toBe(false));

it("the proof of work still applies on an instance that also configured a captcha", async () =>
  expect((await register(await gate(), valid, { captchaToken: "ok", pow: undefined }, withCaptchaDeps)).status)
    .toBe(403));
```

```ts
// apps/web/test/hosting.test.ts (extended) — S-11's guard, now unconditional
it("S-11: the shipped CSP names no third-party origin, bot protection included", () =>
  expect(headers.match(/https?:\/\/[^\s;]+/g) ?? []).toEqual([]));

it("the API's headers and _headers still agree byte for byte", () =>
  expect(cspOf(headers)).toBe(SECURITY_HEADERS["Content-Security-Policy"]));
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run/ratelimit.test.ts apps/api/test/run/captcha.test.ts apps/web/test/hosting.test.ts` — FAIL.

- [ ] **Step 3: Implement `rate_limit`, `takeRateToken`, `limitOrThrow` and the captcha seam**

`issuePowChallenge` is stateless: the challenge is `${testVersionId}:${nonce}:${expiresAt}` plus its HMAC under `SESSION_SECRET`, so issuing costs no row and verifying costs no read, and single use comes from the registration write consuming the entry token in the same batch rather than from a second table. `rate_limit(workspace_id, bucket, window_start, count)` with `UNIQUE (workspace_id, bucket)`. `takeRateToken` must roll the window and increment in the *same* statement, or two concurrent requests both read a stale count:

```sql
INSERT INTO rate_limit (id, workspace_id, bucket, window_start, count) VALUES (?, ?, ?, ?, 1)
ON CONFLICT (workspace_id, bucket) DO UPDATE SET
  count        = CASE WHEN rate_limit.window_start <= ? THEN 1 ELSE rate_limit.count + 1 END,
  window_start = CASE WHEN rate_limit.window_start <= ? THEN ? ELSE rate_limit.window_start END
RETURNING count, window_start
```

**Do not touch the CSP in this step, or in any step of this phase.** The ruling above is that it does not change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS, with every Task 2 and 3 budget re-measured — a route that gained a limiter gained exactly one subrequest.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(run): same-origin proof of work, per-test rate limits and the captcha seam"
```

---

## Task 5: Attempt creation with version and layout pinning (#69, P6.5)

**Files:**
- Create: `apps/api/src/run/attempt.ts`, `apps/api/src/run/scrub.ts`, `apps/api/src/middleware/attemptContext.ts`
- Create: `apps/api/test/run/start.test.ts`, `apps/api/test/run/attempt-context.test.ts`
- Modify: `packages/db/src/repo/candidate-entry.ts` (+ its pinned set and test), `packages/db/src/repo/banks.ts` (one new scoped read), `packages/db/src/repo/run.ts`, `packages/db/src/schema/columns.ts` (`max_index`, `section_started_at` on `attempt`), `packages/db/test/parity.test.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`, `apps/api/src/instrument.ts` (register `attemptContext` in the authority WeakMap), `apps/web/src/lib/run.ts`

**Interfaces:**
- Consumes: `consumeEntryToken` / `EntryClaim` (Task 2) · `registerCandidate` (Task 3) · `limitOrThrow` (Task 4) · `createAttempt(db, ws, { candidateId, testVersionId, setNo, layout, startedAt, deadlineAt, tokenHash }): Promise<string>`, `getAttempt`, `listResponses`, `appendAudit`, `toQuestionDocument` (`@pariksha/db`) · `layoutForAttempt`, `assignSet`, `AttemptLayout`, `PoolTooSmallError`, `Question`, `ResponseValue` (`@pariksha/core`) · `randomToken`, `sha256Hex` · `setSignedCookie` pattern from `apps/api/src/middleware/authenticate.ts`. From **Phase 5**: sections (row 3), timing (row 8), set assignment (row 4), `attempts_allowed` / `cooldown_minutes` (row 8).
- Produces — **the attempt lifecycle types every later task reads. Names and shapes are fixed here:**
  ```ts
  // packages/db/src/repo/candidate-entry.ts (second pre-workspace read)
  export interface AttemptRecord {
    attemptId: string; workspaceId: string; candidateId: string;
    testId: string; testVersionId: string; version: number;
    setNo: number; layout: unknown;                     // PinnedLayout, as stored
    startedAt: number; deadlineAt: number;
    submittedAt: number | null; submitReason: string | null;
    sectionStartedAt: number | null; maxIndex: number; flag: string;
    settings: unknown; sections: unknown;               // joined from test_version
  }
  /** One join: attempt + test_version. The workspace is what it produces (ADR 0006). */
  export function readAttemptByTokenHash(db: DbClient, tokenHash: string): Promise<AttemptRecord | null>;

  // packages/db/src/repo/banks.ts — scoped(), in REPO_FUNCTIONS
  /** Every question in the banks a test version draws from, in one statement.
   *  ponytail: bounded by the test's declared banks; if a bank ever holds
   *  thousands, narrow to the ref_ids fixed/sets name plus the pool filters. */
  export const listQuestionsForBanks: ScopedFn<[bankIds: readonly string[]], Question[]>;

  // packages/db/src/repo/run.ts — scoped(), in REPO_FUNCTIONS
  export const countAttemptsForCandidate: ScopedFn<[candidateId: string], { count: number; lastStartedAt: number | null }>;

  // apps/api/src/run/attempt.ts
  export type PinnedLayout = AttemptLayout & { media: string[] };
  export const ATTEMPT_COOKIE = "pk_attempt";
  export function startAttempt(deps: AppDeps, claim: RegistrationClaim, now: number):
    Promise<{ attemptId: string; token: string; deadlineAt: number; paper: AttemptPaper }>;

  // apps/api/src/run/scrub.ts — Task 12 proves it complete; Task 5 writes the first version
  export interface CandidateQuestion {
    id: string; type: QuestionType; prompt: string; points: number;
    media?: { kind: "image"; src: string; alt: string }[];
    options?: { id: string; text: string }[];          // already in the pinned order
    left?: string[]; right?: string[]; items?: string[];
    blanks?: { id: string }[]; unit?: string; assertion?: string; reason?: string;
    maxLength?: number; k?: number;
    group?: { id: string; passage: string };
  }
  export function forCandidate(
    q: Question,
    opts: { optionOrder?: readonly string[]; mediaBase: string; group?: PassageGroup },
  ): CandidateQuestion;
  export function mediaKeysOf(questions: readonly Question[]): string[];

  // apps/api/src/run/attempt.ts — the one payload /start and GET /attempt both answer with
  export interface AttemptPaper {
    attemptId: string;                                  // C-08's receipt reference
    sections: { id: string; title: string; instructions: string | null;
                timeLimitMinutes: number | null; questions: CandidateQuestion[] }[];
    responses: Record<string, ResponseValue | null>;
    navigation: "free" | "linear" | "per_section";
    maxIndex: number;
    remainingMs: number; sectionRemainingMs: number | null;
    warnAtMinutes: number[]; lateSyncGraceSeconds: number;
    allowCalculator: boolean; serverNow: number;
  }

  // apps/api/src/middleware/attemptContext.ts
  export type AttemptContextVar = AttemptRecord & { layout: PinnedLayout };
  /** 401 when the cookie is absent or dead. Registers itself so routeAuthorities() can read it back. */
  export function attemptContext(deps: AppDeps): MiddlewareHandler<AppBindings>;
  // AppBindings["Variables"] gains: attempt: AttemptContextVar

  // apps/web/src/lib/run.ts (widened)
  export interface RunClient {
    start(registrationToken: string): Promise<AttemptPaper>;
    resume(): Promise<AttemptPaper | null>;             // the cookie travels on its own
  }
  ```

**The attempt token is an HttpOnly cookie, not a body field.** `C-06` requires a browser restart to resume the same attempt, so the token must outlive the tab — a `Max-Age` cookie does, `sessionStorage` does not. HttpOnly keeps it out of reach of any script, which matters more here than in the organiser app because the runner renders author-written Markdown. It rides every `fetch` automatically, including the offline queue's replay (Task 8), and never appears in a URL or a log. Cookie options follow `apps/api/src/middleware/authenticate.ts:31` — `httpOnly`, `secure`, `sameSite: "Lax"` — with `path: "/api/v1/run"` and `maxAge = duration + late_sync_grace`. The stored form is `sha256Hex(token)` in `attempt.token_hash`, which is already `UNIQUE` in the manifest (`columns.ts:289`), satisfying `S-06`.

**Pinning, in one place.** `layoutForAttempt` runs once, seeded with the `att_` id minted before the insert, and its output plus `mediaKeysOf(selected)` is `attempt.layout_json`. Nothing recomputes it: `AC-11`'s "a refresh keeps each order" and `AC-14`'s "resumes with the same questions" are both properties of reading one column. `layout.media` is what makes Review Focus 2's media authorisation free — Task 7 checks membership in an array that is already in memory.

**Two new `attempt` columns, and only two.** `max_index` (the furthest flat question index reached, default 0) carries *both* navigation rules — `linear` refuses a target below it, `per_section` derives the current section from it — so no second column is needed for section locking. `section_started_at` is what a per-section deadline is measured from.

**The start gate**, in order, refusing before any work: the window (`opens_at`, `closes_at`, `latest_start_at`), `attempts_allowed` and `cooldown_minutes` against `countAttemptsForCandidate` (`T-14`), then the rate bucket, then the layout. `PoolTooSmallError` is caught and returned as a 409 naming the section and the shortfall — a published version goes stale the moment a drawn question is deleted, and a stack trace in a candidate's browser is the wrong way to find out.

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/start` | `public` (registration token) | `MEASURE` (consume + attempt count + bank read + batch + audit) |
| `GET` | `/api/v1/run/attempt` | `attempt` | `MEASURE` (the one join + `listResponses`) |

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/start.test.ts
it("S-06: the attempt token is 256 bits, arrives as an HttpOnly cookie, and is stored only as a hash", async () => {
  const res = await start(registrationToken);
  const cookie = res.headers.get("set-cookie")!;
  expect(cookie).toMatch(/pk_attempt=/);
  expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Lax");
  expect(cookie).toContain("Path=/api/v1/run");
  expect(JSON.stringify(await attemptRows())).not.toContain(tokenFrom(cookie));
  expect((await res.json()).token).toBeUndefined();       // the body never carries it
});

it("AC-03: the attempt pins the version it started on; publishing v2 does not move it", async () => {
  const before = (await attemptRow(attemptId)).test_version_id;
  await publishVersion2();
  expect((await attemptRow(attemptId)).test_version_id).toBe(before);
  expect((await resume(cookie)).sections[0].questions[0].id).toBe(firstQuestionOfV1);
});

it("AC-11: two candidates on the same set see different question and option orders", async () => {
  const [a, b] = await Promise.all([startFresh(), startFresh()]);
  expect(order(a)).not.toEqual(order(b));
});

it("AC-11: a refresh keeps each order, and pinned options stay in place", async () => {
  expect(order(await resume(cookie))).toEqual(order(paper));
  expect(optionIds(await resume(cookie), "LOG-001")[0]).toBe("none-of-the-above");  // shuffle_options: false
});

it("AC-09: five sets, round robin, 50 registrations split 10 each with no two neighbours alike", async () => {
  const sets = await Promise.all(Array.from({ length: 50 }, () => startFresh().then((p) => setNoOf(p))));
  expect(countBy(sets)).toEqual({ A: 10, B: 10, C: 10, D: 10, E: 10 });
  expect(sets.some((s, i) => i > 0 && s === sets[i - 1])).toBe(false);
});

it("AC-10: '10 from pool, tag sql, medium' gives 10 distinct questions matching the filter", async () => {
  const qs = (await startFresh("pooled")).sections[0].questions;
  expect(new Set(qs.map((q) => q.id)).size).toBe(10);
  expect(qs.every((q) => q.tags === undefined)).toBe(true);     // tags are not candidate-facing
});

it("the layout pins every media key the selected questions reference, and nothing else", async () => {
  const layout = JSON.parse((await attemptRow(attemptId)).layout_json);
  expect(layout.media).toEqual(expect.arrayContaining([keyOfDiagramInSelectedQuestion]));
  expect(layout.media).not.toContain(keyOfDiagramInUnselectedQuestion);
});

it("T-14: a second attempt on a one-attempt test is 409 before any layout is computed", async () => {
  const counting = countingDeps(deps);
  const res = await start(await registerAgain(), createApp(counting.deps));
  expect(res.status).toBe(409);
  expect(counting.counts().total).toBeLessThan(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/start"]);
});

it("T-12: starting after latest_start_at is refused and the window is named", async () => {
  deps.now = () => latestStartAt + 1;
  expect((await (await start(t)).json()).error).toMatchObject({ code: "window_closed" });
});

it("AC-13: deadline_at is started_at + duration, from the server clock, not the request", async () => {
  expect((await attemptRow(attemptId)).deadline_at).toBe(FIXED_NOW + 45 * 60_000);
});

it("a stale published version whose pool no longer fills is a 409 naming the section", async () => {
  await deleteQuestionsUntilPoolIsShort();
  expect((await (await start(await reg())).json()).error)
    .toMatchObject({ code: "pool_too_small", details: { section: "quant" } });
});

it("S-10: /start's paper carries no key, explanation, rubric, tag or internal id", async () => {
  const text = JSON.stringify(await start(t).then((r) => r.json()));
  for (const leak of ["key", "explanation", "rubric", "model_answer", "accept", "qst_", "wsp_", "bnk_"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("the bank is read once, not once per question", async () => {
  const counting = countingDeps(deps);
  await start(await reg(), createApp(counting.deps));
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/:workspaceSlug/:testSlug/start"]);
});
```

```ts
// apps/api/test/run/attempt-context.test.ts
it("no cookie, a junk cookie and a cookie for a deleted attempt are all the same 401", async () => {
  const bodies = await Promise.all([undefined, "pk_attempt=junk", `pk_attempt=${await deadToken()}`]
    .map(async (c) => (await app.request("/api/v1/run/attempt", c ? { headers: { cookie: c } } : {})).text()));
  expect(new Set(bodies).size).toBe(1);
});

it("the context read is one statement — the attempt and its version settings together", async () => {
  const counting = countingClient(db);
  await readAttemptByTokenHash(counting.db, hash);
  expect(counting.count()).toBe(1);
});

it("ADR 0006: readAttemptByTokenHash is pinned unscoped and reaches neither the barrel nor the registry", () => {
  expect(new Set(functionNames(candidateEntry)))
    .toEqual(new Set(["resolvePublishedTest", "readAttemptByTokenHash"]));
  expect(repo).not.toHaveProperty("readAttemptByTokenHash");
  expect(REPO_FUNCTIONS).not.toHaveProperty("readAttemptByTokenHash");
});

it("a candidate's cookie reaches only their own attempt's workspace", async () => {
  const ctx = await contextFor(cookieOfCandidateInWorkspaceB);
  expect(ctx.workspaceId).toBe(wspB);
});

it("C-06: a browser restart resumes the same questions, answers and remaining time", async () => {
  await saveAnswer(cookie, "LOG-001", answer);
  deps.now = () => FIXED_NOW + 10 * 60_000;
  const resumed = await resume(cookie);                      // a fresh client, same cookie jar
  expect(order(resumed)).toEqual(order(paper));
  expect(resumed.responses["LOG-001"]).toEqual(answer);
  expect(resumed.remainingMs).toBe(35 * 60_000);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run packages/db apps/api/test/run` — FAIL.

- [ ] **Step 3: Implement the two columns, `readAttemptByTokenHash`, `listQuestionsForBanks`, `startAttempt`, `forCandidate` and `attemptContext`**

`readAttemptByTokenHash` is one `SELECT` joining `attempt` to `test_version` on `test_version_id`, written as a single statement for the same reason `readSessionActor` is. `startAttempt` mints the `att_` id first and uses it as `layoutForAttempt`'s `seed`, so the seed is reproducible from the row and nothing else has to store it. `attemptContext` registers itself in the authority `WeakMap` the way `guard()` registers in `GUARDS`, so `routeAuthorities()` reads what is mounted rather than what was declared. `forCandidate` is a `switch` over the 12 types that *builds* the candidate shape field by field rather than deleting from the stored one — a denylist misses the field added next phase, an allowlist does not (Review Focus 5).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api` with `TEST_POSTGRES_URL` set — PASS on both dialects.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(run): attempt creation with pinned version, layout and media keys"
```

---

## Task 6: Test runner shell (#70, P6.6)

**Files:**
- Create: `apps/web/src/components/exam/Runner.tsx`, `Palette.tsx`, `ViewControls.tsx`, `Calculator.tsx`
- Create: `apps/web/test/exam/runner.test.tsx`, `apps/web/test/exam/calculator.test.tsx`
- Modify: `apps/web/src/routes/exam.tsx`, `apps/web/src/styles/exam.css`, `apps/web/test/no-hex-colors.test.ts` (no change expected; re-run as the gate)

**Interfaces:**
- Consumes: `AttemptPaper`, `CandidateQuestion` (Task 5) · `RunClient.resume` (Task 5) · `RenderedHtml` (Phase 4) · `tokens.ts`. The `Clock` component arrives in Task 9 and the answer blocks in Task 7; this task renders a `questionSlot` prop and a `clockSlot` prop so it is testable and committable before either exists.
- Produces:
  ```ts
  export type PaletteState = "unanswered" | "answered" | "marked" | "current" | "locked";
  export function Palette(props: {
    questions: { id: string; number: number; state: PaletteState }[];
    onJump: (questionId: string) => void;
  }): JSX.Element;

  export function Runner(props: {
    paper: AttemptPaper;
    index: number;
    onIndex: (next: number) => void;
    marked: ReadonlySet<string>;
    onToggleMark: (questionId: string) => void;
    onClear: (questionId: string) => void;
    questionSlot: (q: CandidateQuestion) => JSX.Element;    // Task 7
    clockSlot: JSX.Element;                                 // Task 9
    bannerSlot: JSX.Element;                                // Task 8
  }): JSX.Element;

  export function ViewControls(props: {
    fontScale: 1 | 1.25 | 1.5; onFontScale: (s: 1 | 1.25 | 1.5) => void;
    highContrast: boolean; onHighContrast: (on: boolean) => void;
  }): JSX.Element;

  export function Calculator(props: { onClose: () => void }): JSX.Element;
  ```

**`DESIGN.md` is binding here and says the opposite of the marketing pages.** "The clock kills the canvas … The test runner is cream and ink, hairline-ruled, and the voltage survives only as the 'you are here' square in the question palette and the focus ring on a selected answer row." Layout is fixed: question column `1fr` with a `680px` max width, palette rail a fixed `240px`, one tempo for the whole attempt, **no animation of any kind** ("a candidate who thinks the page reloaded thinks their answer was lost"). Below 1024px there is no mobile layout, because `P-01` blocks the device.

**Every palette state carries a non-colour signal**, because `DESIGN.md` requires it by name: `answered` is filled, `marked` carries a corner notch, `current` carries a ring, `locked` carries a lock glyph. A candidate with deuteranopia reads the palette from shape alone, and the test asserts that rather than trusting the CSS.

**Mark-for-review is browser state, not a column** — see the ruling in [Smaller calls](#smaller-calls-made-while-planning). It lives beside the offline queue in `localStorage`, keyed by attempt id, and the palette reads it from the `marked` prop.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/exam/runner.test.tsx
it("C-04: the runner shows the question panel, the numbered palette and the four controls", () => {
  render(<Runner {...props} />);
  expect(screen.getByRole("navigation", { name: /question palette/i })).toBeVisible();
  for (const n of [/previous/i, /next/i, /mark for review/i, /clear answer/i]) {
    expect(screen.getByRole("button", { name: n })).toBeVisible();
  }
});

it("C-04: the palette numbers every question and marks the current one", async () => {
  expect(screen.getAllByRole("button", { name: /question \d+/i })).toHaveLength(17);
  expect(screen.getByRole("button", { name: /question 1 .*current/i })).toHaveAttribute("aria-current", "true");
});

it("DESIGN.md: every palette state carries a non-colour carrier a greyscale reader can see", () => {
  for (const [state, carrier] of [["answered", "is-filled"], ["marked", "has-notch"],
                                  ["current", "has-ring"], ["locked", "has-lock"]] as const) {
    expect(squareFor(state)).toHaveClass(carrier);
    expect(squareFor(state)).toHaveAccessibleName(new RegExp(state, "i"));   // and a word, not only a shape
  }
});

it("Mark for review toggles the palette state and the button's pressed state", async () => {
  await userEvent.click(screen.getByRole("button", { name: /mark for review/i }));
  expect(screen.getByRole("button", { name: /mark for review/i })).toHaveAttribute("aria-pressed", "true");
  expect(squareFor("marked")).toBeVisible();
});

it("Clear answer asks before discarding, naming what is discarded (DESIGN.md: button-danger)", async () => {
  await userEvent.click(screen.getByRole("button", { name: /clear answer/i }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/question 1/i);
  expect(await axe(container)).toHaveNoViolations();
});

it("the whole runner is operable from the keyboard alone, including the palette", async () => {
  await userEvent.tab(); await userEvent.keyboard("{Enter}");
  expect(document.activeElement).toHaveAccessibleName(/question/i);
});

it("C-04: the font-size control scales the question stem and the choice persists across a remount", async () => {
  await userEvent.click(screen.getByRole("radio", { name: /large/i }));
  expect(document.documentElement).toHaveAttribute("data-font-scale", "1.5");
  cleanup(); render(<Runner {...props} />);
  expect(document.documentElement).toHaveAttribute("data-font-scale", "1.5");
});

it("C-04: high contrast is a token swap and keeps every non-colour carrier", async () => {
  await userEvent.click(screen.getByRole("switch", { name: /high contrast/i }));
  expect(document.documentElement).toHaveAttribute("data-contrast", "high");
  expect(squareFor("marked")).toHaveClass("has-notch");
});

it("DESIGN.md: nothing inside a live attempt animates", () => {
  for (const el of container.querySelectorAll("*")) {
    expect(getComputedStyle(el).transitionDuration).toBe("0s");
    expect(getComputedStyle(el).animationName).toBe("none");
  }
});

it("the calculator appears only when the test allows it", () => {
  render(<Runner {...props} paper={{ ...paper, allowCalculator: false }} />);
  expect(screen.queryByRole("button", { name: /calculator/i })).toBeNull();
});

it("the runner has no axe violations at 100% and at 200% zoom", async () => {
  expect(await axe(container)).toHaveNoViolations();
  document.documentElement.style.fontSize = "32px";
  expect(await axe(container)).toHaveNoViolations();
});
```

```tsx
// apps/web/test/exam/calculator.test.tsx
it.each([["2+3=", "5"], ["7/2=", "3.5"], ["9-10=", "-1"], ["5*0.2=", "1"], ["1/0=", "Error"]])(
  "%s gives %s", async (keys, shown) => { await type(keys); expect(display()).toBe(shown); });

it("every key is reachable by keyboard and labelled", async () => {
  expect(await axe(container)).toHaveNoViolations();
  await userEvent.keyboard("12{+}3{Enter}");
  expect(display()).toBe("15");
});

it("Escape closes it and returns focus to the control that opened it", async () => {
  await userEvent.keyboard("{Escape}");
  expect(document.activeElement).toHaveAccessibleName(/calculator/i);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/web/test/exam` — FAIL.

- [ ] **Step 3: Implement `Runner`, `Palette`, `ViewControls` and `Calculator`**

The palette is a `nav` of buttons, one per question, each with an accessible name carrying both the number and the state word. `ViewControls` writes `data-font-scale` and `data-contrast` on `documentElement` and mirrors them into `localStorage`, so `exam.css` is a token swap and no component branches on contrast. `Calculator` is a `dialog` with a focus trap and a reducer over a four-function state machine — about sixty lines, no dependency. Every value in `exam.css` comes from `tokens.css`; `no-hex-colors.test.ts` is the gate.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web` — PASS, with `no-hex-colors.test.ts` and `bundle.test.ts` green.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -s -m "feat(run): test runner shell, question palette and view controls"
```

---

## Task 7: Answer rendering and input for all 12 types, and attempt-scoped media (#71, P6.7)

**Files:**
- Create: `apps/web/src/components/exam/answer/Choice.tsx`, `Structured.tsx`, `Written.tsx`, `index.tsx`
- Create: `apps/web/test/exam/answer-choice.test.tsx`, `answer-structured.test.tsx`, `answer-written.test.tsx`
- Create: `apps/api/test/run/media.test.ts`
- Modify: `apps/web/src/components/authoring/ReorderableList.tsx` (**add the pointer-drag enhancement Phase 4 deferred** — no prop change), `apps/web/test/authoring/reorder.test.tsx`, `apps/api/src/routes/run.ts`, `apps/api/src/run/scrub.ts` (`mediaBase` rewriting), `apps/api/src/app.ts`, `apps/web/src/routes/exam.tsx`

**Interfaces:**
- Consumes: `CandidateQuestion`, `forCandidate`, `PinnedLayout`, `AttemptContextVar` (Task 5) · `Runner`'s `questionSlot` (Task 6) · `ResponseValue` (`@pariksha/core`) · `RenderedHtml({ markdown, className? })`, `renderMarkdown(src): Promise<string>`, `ReorderableList<T>({ items, keyOf, labelOf, onReorder, renderItem, legend })` (Phase 4) · `MEDIA_TYPE_EXT` / `EXT_MEDIA_TYPE` and the `media/<workspaceId>/<sha256>.<ext>` key convention (`apps/api/src/routes/media.ts`).
- Produces:
  ```ts
  export function AnswerInput(props: {
    question: CandidateQuestion;
    value: ResponseValue | null;
    onChange: (next: ResponseValue | null) => void;
    disabled: boolean;
  }): JSX.Element;
  /** The sentinel the inline-blank renderer splits on. Markdown-inert by construction. */
  export const BLANK_MARKER: (id: string) => string;       // `⁣pkb:${id}⁣`
  ```

### Closing Phase 4's media hand-off

`GET /api/v1/workspaces/:id/media/:key` is guarded by `banks.edit` (`apps/api/src/app.ts:199`), which was right for Phase 4 and leaves a candidate unable to load a question's images. Phase 6 adds a sibling, authorised by the attempt and **not** by the workspace:

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `GET` | `/api/v1/run/attempt/media/:key` | `attempt` | `MEASURE` (expected 2: the context join + one storage read) |

The authorisation is membership in `layout.media`, the array Task 5 pinned — not "this attempt names a workspace, so serve anything in it" (Review Focus 2). It costs no subrequest because the array is already in `c.var.attempt`. Two Phase 4 properties are carried verbatim: `Cache-Control: private, max-age=31536000, immutable` (`apps/api/src/routes/media.ts:200` — `private`, because the response needed a credential and there is no `Vary`), and the refusal of `image/svg+xml` (that file's fixture-review finding 11 — an SVG can carry `<script>`, and `script-src 'self'` should not be the only thing standing between a stored SVG and XSS). The scrubber rewrites every `media.src` to this path, so a candidate's browser never requests the organiser one.

### The twelve inputs

Three components, the same families Phase 4's editors use, so the candidate side and the authoring side stay recognisably the same code shape. The prompt, the explanation-free stem and any passage render through Phase 4's `RenderedHtml` — `UX-09`'s "it is the same renderer the candidate runtime uses", now literally.

`AC-07` asks for "drag **and** keyboard reordering" and Phase 4 shipped only the keyboard half, recording the drag half as a known deferral with the exact shape it should take: "`draggable` on the row with native HTML5 `dragstart` / `dragover` / `drop` handlers calling the `onReorder(from, to)` Task 3 already exposes, plus a drop-position indicator — no dependency, and no change to `ReorderableList`'s props." **This task closes it**, which is why `ReorderableList.tsx` is modified rather than copied, and why Phase 4's `reorder.test.tsx` is extended rather than replaced: the keyboard path must keep passing unchanged.

`fill_blank` renders its inputs **inside** the prompt, which is the one place the shared renderer and candidate input meet. The prompt's `{{id}}` placeholders are replaced with `BLANK_MARKER(id)` *before* `renderMarkdown` runs; the rendered HTML is split on the marker and the pieces interleaved with `<input>`s. The marker is two invisible separators around an ASCII payload so that `markdown-it` cannot reinterpret it as emphasis, a link or a code span, and so that a prompt that happens to contain the literal text cannot forge one — the test pins all three.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/exam/answer-choice.test.tsx
it.each(["single", "multiple", "select_k", "true_false", "assertion_reason"] as const)(
  "%s renders its options in the pinned order with the whole row as the hit target", async (type) => {
    render(<AnswerInput question={fixture(type)} value={null} onChange={spy} disabled={false} />);
    expect(optionTexts()).toEqual(pinnedOrder(type));
    await userEvent.click(screen.getByText(pinnedOrder(type)[1]!));     // the label text, not the control
    expect(spy).toHaveBeenCalled();
  });

it("AC-07: select_k locks further choices once k options are picked, and unlocks on deselect", async () => {
  render(<AnswerInput question={{ ...selectK, k: 2 }} value={null} onChange={onChange} disabled={false} />);
  await pick("A"); await pick("B");
  expect(screen.getByRole("checkbox", { name: /C/ })).toBeDisabled();
  await pick("A");
  expect(screen.getByRole("checkbox", { name: /C/ })).toBeEnabled();
});

it("the locked state is announced, not only visual", async () => {
  expect(screen.getByRole("status")).toHaveTextContent(/2 of 2 chosen/i);
});

it("S-10: no option carries a correctness marker in the DOM or in its props", () => {
  expect(container.innerHTML).not.toMatch(/correct|is-key|data-answer/i);
});

it("every choice type is operable with the keyboard alone and has no axe violations", async () => {
  await userEvent.tab(); await userEvent.keyboard("{ArrowDown}{Space}");
  expect(onChange).toHaveBeenCalled();
  expect(await axe(container)).toHaveNoViolations();
});
```

```tsx
// apps/web/test/exam/answer-structured.test.tsx
it("matching: each left item takes one right item, and a used right item cannot be reused", async () => {
  await userEvent.selectOptions(screen.getByLabelText(/INNER JOIN/), "Only matching rows");
  expect(within(screen.getByLabelText(/LEFT JOIN/)).queryByRole("option", { name: "Only matching rows" }))
    .toBeDisabled();
});

it("multi_matching accepts several right items per left item", async () => {
  await check("A matches X"); await check("A matches Y");
  expect(onChange).toHaveBeenLastCalledWith({ kind: "multimap", pairs: { A: ["X", "Y"] } });
});

it("UX-08: ordering shows the shuffled order, and the candidate's order is the answer", async () => {
  expect(itemTexts()).toEqual(pinnedShuffledOrder);
  await userEvent.click(screen.getByRole("button", { name: /move .* down/i }));
  expect(onChange).toHaveBeenLastCalledWith({ kind: "order", items: expect.any(Array) });
});

it("AC-07 (Phase 4 deferral): ordering reorders by keyboard AND by pointer drag", async () => {
  const down = screen.getByRole("button", { name: /move item A down/i });
  down.focus(); await userEvent.keyboard("{Enter}");
  expect(itemTexts()[1]).toBe("A");
  expect(document.activeElement).toHaveAccessibleName(/move item A down/i);   // Phase 4's focus rule holds
  fireEvent.dragStart(rowFor("A")); fireEvent.dragOver(rowFor("C")); fireEvent.drop(rowFor("C"));
  expect(itemTexts()[2]).toBe("A");
});

it("drag is an enhancement: with no pointer events at all, every reorder is still reachable", async () => {
  expect(screen.getAllByRole("button", { name: /move .*(up|down)/i }).length).toBeGreaterThan(0);
  expect(await axe(container)).toHaveNoViolations();
});
```

```tsx
// apps/web/test/exam/answer-written.test.tsx
it("fill_blank renders an input inline, in the prompt, one per placeholder, in prompt order", () => {
  render(<AnswerInput question={fillBlankFixture} value={null} onChange={spy} disabled={false} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(screen.getByLabelText(/blank 1/i).previousSibling).toHaveTextContent(/The capital is/);
});

it("a prompt containing the marker's literal text cannot forge a blank", () => {
  render(<AnswerInput question={{ ...fillBlankFixture, prompt: `pkb:1 and ${BLANK_MARKER("1")}` }} {...rest} />);
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
});

it("the marker survives markdown-it unchanged inside emphasis, a link and a code span", async () => {
  for (const wrap of [(s) => `*${s}*`, (s) => `[${s}](https://x.test)`, (s) => `\`${s}\``]) {
    expect(await renderMarkdown(wrap(BLANK_MARKER("1")))).toContain(BLANK_MARKER("1"));
  }
});

it("numeric accepts a number and a unit is shown but not typed into", async () => {
  await userEvent.type(screen.getByRole("spinbutton"), "9.81");
  expect(onChange).toHaveBeenLastCalledWith({ kind: "number", value: 9.81 });
  expect(screen.getByText("m/s²")).toBeVisible();
});

it("short_answer and long_answer enforce max_length and show a live remaining count", async () => {
  expect(screen.getByRole("textbox")).toHaveAttribute("maxlength", "500");
  await userEvent.type(screen.getByRole("textbox"), "x".repeat(10));
  expect(screen.getByRole("status")).toHaveTextContent(/490 characters left/i);
});

it("S-10: no accepted answer, tolerance, rubric or model answer reaches the DOM", () => {
  for (const leak of ["Delhi", "tolerance", "rubric", "model"]) expect(container.innerHTML).not.toContain(leak);
});

it("LaTeX in a prompt renders through the shared renderer and loads KaTeX only when present", async () => {
  render(<AnswerInput question={{ ...numericFixture, prompt: "Find $x^2$" }} {...rest} />);
  expect(await screen.findByText("", { selector: "math" })).toBeInTheDocument();
});

it("all four written types have no axe violations and every input is labelled", async () =>
  expect(await axe(container)).toHaveNoViolations());
```

```ts
// apps/api/test/run/media.test.ts — Review Focus 2
it("a candidate loads exactly the media in their own attempt's pinned layout", async () => {
  const res = await app.request(`/api/v1/run/attempt/media/${keyInMyPaper}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
});

it("a key in the same workspace but outside this attempt's layout is 404", async () =>
  expect((await app.request(`/api/v1/run/attempt/media/${keyInAnotherQuestion}`, { headers: { cookie } })).status)
    .toBe(404));

it("a key from another workspace is the same 404, byte for byte", async () => {
  const [mine, theirs] = await Promise.all([fetchMedia(keyInAnotherQuestion), fetchMedia(keyInWorkspaceB)]);
  expect(await mine.text()).toBe(await theirs.text());
});

it("no cookie is 401, and the organiser route is still banks.edit", async () => {
  expect((await app.request(`/api/v1/run/attempt/media/${keyInMyPaper}`)).status).toBe(401);
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/media/:key"]).toBe("banks.edit");
});

it("the response is private and immutable, and SVG is still refused", async () => {
  expect((await fetchMedia(keyInMyPaper)).headers.get("cache-control"))
    .toBe("private, max-age=31536000, immutable");
  expect((await fetchMedia("x.svg")).status).toBe(404);
});

it("the scrubber rewrites media.src to the run path, so no paper names the organiser route", async () => {
  const text = JSON.stringify(await resume(cookie));
  expect(text).toContain("/api/v1/run/attempt/media/");
  expect(text).not.toContain("/api/v1/workspaces/");
});

it("authorising the key costs no extra subrequest", async () => {
  const counting = countingDeps(deps);
  await fetchMedia(keyInMyPaper, createApp(counting.deps));
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/attempt/media/:key"]);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/web/test/exam apps/web/test/authoring/reorder.test.tsx apps/api/test/run/media.test.ts` — FAIL.

- [ ] **Step 3: Implement the three answer components, the inline-blank renderer, the drag enhancement and the media route**

`AnswerInput` dispatches on `question.type` to one of three components; each is a controlled component over `ResponseValue` and holds no copy of a key, because the key is not in `CandidateQuestion` at all. The inline-blank renderer replaces placeholders with `BLANK_MARKER(id)`, awaits `renderMarkdown`, splits the HTML on the marker, and renders the pieces through `RenderedHtml`'s existing single `dangerouslySetInnerHTML` site with `<input>`s between them — one algorithm the signature does not determine, so: split on the marker **after** rendering, never before, or the inputs land inside escaped text. The drag enhancement adds `draggable`, `onDragStart`, `onDragOver` and `onDrop` to `ReorderableList`'s row, all four calling the existing `onReorder(from, to)`; the props do not change.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web apps/api` — PASS, with Phase 4's `reorder.test.tsx` green unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/api
git commit -s -m "feat(run): candidate input for all 12 types and attempt-scoped media"
```

---

## Task 8: Autosave with an offline queue (#72, P6.8)

**Files:**
- Create: `apps/web/src/lib/queue.ts`, `apps/web/src/components/exam/SaveBanner.tsx`
- Create: `apps/web/test/exam/queue.test.ts`, `apps/web/test/exam/autosave.test.tsx`, `apps/api/test/run/answer.test.ts`
- Modify: `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/run.ts`, `apps/web/src/routes/exam.tsx`

**Interfaces:**
- Consumes: `upsertResponse(db, ws, { attemptId, questionId, value, clientSeq, savedAt }): Promise<{ stored: boolean }>` (`packages/db/src/repo/attempts.ts:149` — **already sequence-safe; do not rewrite it**) · `AttemptContextVar`, `AttemptPaper` (Task 5) · `Runner`'s `bannerSlot` (Task 6) · `ResponseValue`.
- Produces:
  ```ts
  // apps/web/src/lib/queue.ts
  export type SaveOutcome = "accepted" | "superseded" | "refused" | "offline";
  export interface QueuedSave { questionId: string; value: ResponseValue | null; clientSeq: number; queuedAt: number }
  export interface SaveQueue {
    enqueue(questionId: string, value: ResponseValue | null): void;
    drain(): Promise<void>;
    pending(): readonly QueuedSave[];
    subscribe(listener: (s: SaveState) => void): () => void;
  }
  export type SaveState =
    | { kind: "idle" } | { kind: "saving"; pending: number }
    | { kind: "saved"; at: number } | { kind: "offline"; pending: number }
    | { kind: "refused"; questionId: string; message: string };
  export const SAVE_DEBOUNCE_MS = 800;                 // C-05's 2 s, with room for one retry
  export function createSaveQueue(attemptId: string, put: PutAnswer, storage?: Storage): SaveQueue;
  export type PutAnswer = (s: QueuedSave) => Promise<{ outcome: SaveOutcome; message?: string }>;

  // apps/web/src/components/exam/SaveBanner.tsx
  export function SaveBanner(props: { state: SaveState }): JSX.Element;

  // apps/web/src/lib/run.ts (widened)
  export interface RunClient {
    putAnswer(s: QueuedSave): Promise<{ outcome: SaveOutcome; message?: string; remainingMs: number }>;
  }
  ```

**The server side already exists.** `upsertResponse` is one statement — `INSERT … ON CONFLICT (attempt_id, question_id) DO UPDATE … WHERE excluded.client_seq > response.client_seq` — which is exactly the idempotent, sequence-safe upsert the PRD's durability row names, and its `{ stored }` already distinguishes "this call won" from "a newer answer is already there". The route maps that to the wire: `stored: true` → `accepted`, `stored: false` → `superseded`. Nothing is re-implemented.

**Review Focus 3 is this task's gate.** A queue that drains on HTTP 200 also drains on a refusal. The three outcomes are distinct on the wire — 200 `accepted`, 200 `superseded`, 409/403 `refused` — the queue drops the first two and **keeps** the third, and `SaveBanner` never shows "Saved" while anything refused is outstanding.

**`localStorage`, not IndexedDB.** `C-05` and `AC-14` require the queue to survive a reload and a browser restart; `localStorage` does both, is synchronous (so a `beforeunload` flush actually lands), and needs no polyfill in jsdom. `ponytail:` text answers only — move to IndexedDB if an answer ever carries a blob.

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `PUT` | `/api/v1/run/attempt/answer` | `attempt` | `MEASURE` (expected **2**: the context join and the one upsert — one D1 write, per the PRD's hot-path rule) |

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/answer.test.ts
it("a save is one read and one write, and nothing else", async () => {
  const counting = countingDeps(deps);
  await putAnswer(createApp(counting.deps), cookie, { questionId: "LOG-001", value: v, clientSeq: 1 });
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/attempt/answer"]);
  expect(counting.counts().db).toBe(2);
  expect(counting.counts().storage).toBe(0);
});

it("a late retry of sequence 4 after 5 is superseded, not a regression", async () => {
  await put({ clientSeq: 5, value: newer });
  expect((await (await put({ clientSeq: 4, value: older })).json()).outcome).toBe("superseded");
  expect((await resume(cookie)).responses["LOG-001"]).toEqual(newer);
});

it("the same sequence sent twice is idempotent", async () => {
  await put({ clientSeq: 7, value: v }); await put({ clientSeq: 7, value: v });
  expect(await countResponses(attemptId)).toBe(1);
});

it("a save for a question outside this attempt's layout is 404, not a stored row", async () => {
  expect((await put({ questionId: "NOT-MINE", clientSeq: 1 })).status).toBe(404);
  expect(await countResponses(attemptId)).toBe(0);
});

it("a save after submission is refused and the stored answer is unchanged", async () => {
  await submit(cookie);
  expect((await put({ clientSeq: 9, value: other })).status).toBe(409);
  expect((await attemptResponses())["LOG-001"]).toEqual(v);
});

it("every save response carries the server's remainingMs so the client can re-anchor (Task 9)", async () =>
  expect((await (await put({ clientSeq: 1 })).json()).remainingMs).toBe(45 * 60_000));
```

```ts
// apps/web/test/exam/queue.test.ts — Review Focus 3
it("C-05: a change is sent within 2 seconds", async () => {
  queue.enqueue("LOG-001", v);
  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put).toHaveBeenCalledTimes(1);
});

it("rapid edits to one question collapse to one request carrying the latest value", async () => {
  for (const x of ["a", "b", "c"]) queue.enqueue("LOG-001", text(x));
  await advance(SAVE_DEBOUNCE_MS + 50);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.lastCall![0].value).toEqual(text("c"));
});

it("AC-14: two minutes offline then reconnect loses no answers, and order is preserved", async () => {
  goOffline();
  for (const [i, q] of questionIds.entries()) queue.enqueue(q, text(String(i)));
  await advance(120_000);
  expect(put).not.toHaveBeenCalled();
  expect(queue.pending()).toHaveLength(questionIds.length);
  goOnline();
  await flush();
  expect(put.mock.calls.map((c) => c[0].questionId)).toEqual(questionIds);
  expect(queue.pending()).toEqual([]);
});

it("AC-14: the queue survives a reload — a new queue over the same storage drains what the old one held", async () => {
  goOffline(); queue.enqueue("LOG-001", v); await advance(1000);
  const revived = createSaveQueue(attemptId, put, storage);
  goOnline(); await revived.drain();
  expect(put).toHaveBeenCalledWith(expect.objectContaining({ questionId: "LOG-001" }));
});

it("Review Focus 3: a refused save is KEPT and surfaced; a superseded one is dropped", async () => {
  put.mockResolvedValueOnce({ outcome: "superseded" }).mockResolvedValueOnce({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v); queue.enqueue("B", v);
  await flush();
  expect(queue.pending().map((p) => p.questionId)).toEqual(["B"]);
  expect(lastState()).toMatchObject({ kind: "refused", questionId: "B", message: "Time is up." });
});

it("Review Focus 3: the banner never reads Saved while anything refused is outstanding", async () => {
  put.mockResolvedValue({ outcome: "refused", message: "Time is up." });
  queue.enqueue("A", v); await flush();
  queue.enqueue("C", v); put.mockResolvedValue({ outcome: "accepted" }); await flush();
  expect(lastState().kind).not.toBe("saved");
});

it("clientSeq rises monotonically per question across a reload", async () => {
  queue.enqueue("A", v); await flush();
  const revived = createSaveQueue(attemptId, put, storage);
  revived.enqueue("A", v2); await flush();
  expect(put.mock.calls.at(-1)![0].clientSeq).toBeGreaterThan(put.mock.calls[0]![0].clientSeq);
});

it("a transport failure retries with backoff rather than dropping", async () => {
  put.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue({ outcome: "accepted" });
  queue.enqueue("A", v); await flush();
  expect(queue.pending()).toEqual([]);
  expect(put).toHaveBeenCalledTimes(2);
});

it("storage that throws (private mode, blocked site data) degrades to in-memory, never to a crash", () => {
  expect(() => createSaveQueue(attemptId, put, throwingStorage).enqueue("A", v)).not.toThrow();
});
```

```tsx
// apps/web/test/exam/autosave.test.tsx
it.each([
  [{ kind: "saving", pending: 1 }, /saving/i], [{ kind: "saved", at: 0 }, /saved/i],
  [{ kind: "offline", pending: 3 }, /offline.*3/i], [{ kind: "refused", questionId: "A", message: "Time is up." }, /not saved/i],
])("C-05: the banner states %j", (state, text) => {
  render(<SaveBanner state={state} />);
  expect(screen.getByRole("status")).toHaveTextContent(text);
});

it("the banner is a live region, and the refused state is an alert, not a status", () => {
  render(<SaveBanner state={{ kind: "refused", questionId: "A", message: "Time is up." }} />);
  expect(screen.getByRole("alert")).toBeVisible();
});

it("the banner carries a word, not only a colour, and has no axe violations", async () => {
  expect(screen.getByRole("status").textContent).toMatch(/\w/);
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run/answer.test.ts apps/web/test/exam/queue.test.ts apps/web/test/exam/autosave.test.tsx` — FAIL.

- [ ] **Step 3: Implement the route, `createSaveQueue` and `SaveBanner`**

The route reads `c.var.attempt`, refuses a `questionId` outside the pinned layout, and calls `upsertResponse`. The queue is a map of question id to the latest pending save plus a monotonic per-question sequence, mirrored to `localStorage` on every mutation inside a `try/catch`; the drain is sequential (ordering is asserted) with exponential backoff on a transport error, and it reacts to `online`, `visibilitychange` and `beforeunload`. The one algorithm the tests do not determine is the retry schedule: 1 s, 2 s, 4 s, capped at 30 s, which keeps a ten-minute drop (the PRD's availability row) inside a bounded number of attempts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api apps/web` — PASS, with the answer route measured at 2.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web
git commit -s -m "feat(run): answer autosave with an offline queue and a three-outcome banner"
```

---

## Task 9: Server-authoritative timer (#73, P6.9)

**Files:**
- Create: `apps/api/src/run/clock.ts`, `apps/api/test/run/clock.test.ts`
- Create: `apps/web/src/components/exam/Clock.tsx`, `apps/web/test/exam/clock.test.tsx`
- Modify: `apps/api/src/routes/run.ts` (the deadline check on every write), `packages/db/src/repo/run.ts`, `apps/web/src/routes/exam.tsx`, `apps/web/src/lib/run.ts`

**Interfaces:**
- Consumes: `AttemptContextVar`, `AttemptPaper` (Task 5) · `Runner`'s `clockSlot` (Task 6) · `SaveOutcome` (Task 8) · timing (**Phase 5** interface row 8: `duration_minutes`, `warn_at_minutes`, `late_sync_grace_seconds`, per-section `time_limit_minutes`).
- Produces:
  ```ts
  // apps/api/src/run/clock.ts — pure over the attempt row and a now
  export interface ClockView {
    remainingMs: number; sectionRemainingMs: number | null;
    expired: boolean; withinGrace: boolean; sectionExpired: boolean;
  }
  export function clockOf(attempt: AttemptContextVar, now: number): ClockView;
  /** Throws ApiError(409, "time_up") past deadline + grace. The one place a write is refused on time. */
  export function assertWritable(attempt: AttemptContextVar, now: number): void;

  // packages/db/src/repo/run.ts
  export const advanceSection: ScopedFn<[{ attemptId: string; sectionStartedAt: number }], void>;

  // apps/web/src/components/exam/Clock.tsx
  export interface ClockAnchor { remainingMs: number; sectionRemainingMs: number | null; at: number }  // at = performance.now()
  export function Clock(props: { anchor: ClockAnchor; warnAtMinutes: readonly number[]; onZero: () => void }): JSX.Element;
  /** Re-anchors from any server response. Called by the queue's drain and by resume. */
  export function anchorFrom(remainingMs: number, sectionRemainingMs: number | null): ClockAnchor;
  ```

**`AC-13` has two halves and only one of them is easy.** The server half: `deadline_at` is an epoch column, every write route calls `assertWritable` against `deps.now()`, and an answer arriving more than `late_sync_grace_seconds` after the deadline is refused. The display half is Review Focus 4: the countdown is `anchor.remainingMs - (performance.now() - anchor.at)`, never `deadlineAt - Date.now()`, and it re-anchors from every server response — `/start`, resume, and each save (which is why Task 8's `putAnswer` returns `remainingMs`). `performance.now()` is monotonic, so a clock change, a correction after sleep, or a deliberate edit moves nothing.

**Section timers.** `section_started_at` is written when the candidate first reaches a question in a later section; `sectionRemainingMs` is `time_limit_minutes` from it. Auto-advance (`C-07`) happens on the client at zero and on the server the next time any request arrives past a section deadline — a write to an expired section is refused with the next section named.

**Auto-submit at zero** — see the ruling in [Smaller calls](#smaller-calls-made-while-planning): whichever of the client at zero or the server's next request materialises it first, with `submit_reason = "timeout"`. There is no sweeper in this phase and a candidate who closes the tab and never returns leaves an attempt that is submitted when it is next read.

| Where | What changes |
| --- | --- |
| `PUT /run/attempt/answer`, `POST /run/attempt/submit` | `assertWritable` first; both already measured in Tasks 8 and 11 |
| `GET /run/attempt` | Adds `remainingMs`, `sectionRemainingMs`, `warnAtMinutes`, `serverNow`; no new subrequest |

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/clock.test.ts
it("AC-13: the server timer ignores the client clock entirely", async () => {
  const res = await put({ clientSeq: 1, clientNow: FIXED_NOW - 3_600_000 });   // a lying client
  expect((await res.json()).remainingMs).toBe(45 * 60_000);
});

it("AC-13: an answer 29 s after the deadline is accepted and 31 s is rejected", async () => {
  deps.now = () => deadlineAt + 29_000;
  expect((await put({ clientSeq: 2 })).status).toBe(200);
  deps.now = () => deadlineAt + 31_000;
  const late = await put({ clientSeq: 3 });
  expect(late.status).toBe(409);
  expect((await late.json()).error.code).toBe("time_up");
});

it("a rejected late answer leaves the stored response untouched", async () =>
  expect((await attemptResponses())["LOG-001"]).toEqual(valueFromSeq2));

it("the grace comes from the version's late_sync_grace_seconds, not a constant", async () => {
  deps.now = () => deadlineAt + 45_000;
  expect((await putOn("sixty-second-grace", { clientSeq: 1 })).status).toBe(200);
});

it("C-07: a write to a section whose time has ended is refused and names the next section", async () => {
  deps.now = () => sectionStartedAt + 10 * 60_000 + 1;
  expect((await (await put({ questionId: inSectionOne, clientSeq: 4 })).json()).error)
    .toMatchObject({ code: "section_over", details: { nextSection: "quant" } });
});

it("entering a later section stamps section_started_at exactly once", async () => {
  await put({ questionId: firstOfSectionTwo, clientSeq: 5 });
  const stamped = (await attemptRow(attemptId)).section_started_at;
  await put({ questionId: secondOfSectionTwo, clientSeq: 6 });
  expect((await attemptRow(attemptId)).section_started_at).toBe(stamped);
});

it("C-07: the first request past the deadline submits the attempt with reason timeout", async () => {
  deps.now = () => deadlineAt + 60_000;
  await resume(cookie);
  expect(await attemptRow(attemptId)).toMatchObject({ submitted_at: expect.any(Number), submit_reason: "timeout" });
});
```

```tsx
// apps/web/test/exam/clock.test.tsx — Review Focus 4
it("AC-13: moving the system clock forward an hour does not move the countdown", () => {
  render(<Clock anchor={anchorFrom(45 * 60_000, null)} warnAtMinutes={[10, 2]} onZero={noop} />);
  const before = screen.getByRole("timer").textContent;
  vi.setSystemTime(Date.now() + 3_600_000);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByRole("timer").textContent).not.toBe(before);         // it ticked one second
  expect(minutesShown()).toBe(44);                                        // not zero
});

it("the countdown advances with performance.now(), one second per second", () => {
  act(() => { advancePerformanceNow(60_000); vi.advanceTimersByTime(60_000); });
  expect(minutesShown()).toBe(44);
});

it("a server response re-anchors the countdown, correcting any drift", () => {
  rerender(<Clock anchor={anchorFrom(10 * 60_000, null)} {...rest} />);
  expect(minutesShown()).toBe(10);
});

it("C-07: the chip swaps once at each warning mark and never pulses or animates", () => {
  act(() => advanceTo(10 * 60_000));
  expect(screen.getByRole("timer")).toHaveClass("timer-chip-urgent");
  expect(getComputedStyle(screen.getByRole("timer")).animationName).toBe("none");
});

it("a warning is announced in words as well as colour", () => {
  expect(screen.getByRole("status")).toHaveTextContent(/10 minutes remaining/i);
});

it("C-07: onZero fires exactly once at zero", () => {
  act(() => advanceTo(45 * 60_000 + 5_000));
  expect(onZero).toHaveBeenCalledTimes(1);
});

it("DESIGN.md: the digits are tabular so the countdown does not jitter", () =>
  expect(getComputedStyle(screen.getByRole("timer")).fontVariantNumeric).toContain("tabular-nums"));

it("section and total clocks sit side by side, each labelled, with no axe violations", async () => {
  expect(screen.getAllByRole("timer")).toHaveLength(2);
  expect(await axe(container)).toHaveNoViolations();
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run/clock.test.ts apps/web/test/exam/clock.test.tsx` — FAIL.

- [ ] **Step 3: Implement `clockOf`, `assertWritable`, `advanceSection` and `Clock`**

`clockOf` is pure arithmetic over the attempt row and a `now`, so every route shares one definition of "expired" and of "within grace". `Clock` holds `anchor` in state, ticks on a one-second `setInterval` reading `performance.now()`, and derives everything displayed; it stores no absolute deadline at all, which is what makes Review Focus 4 structurally impossible rather than merely tested.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api apps/web` — PASS, with Tasks 5 and 8's budgets unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web packages/db
git commit -s -m "feat(run): server-authoritative deadline and a monotonic candidate countdown"
```

---

## Task 10: Navigation modes enforced server-side (#74, P6.10)

**Files:**
- Create: `apps/api/src/run/navigation.ts`, `apps/api/test/run/navigation.test.ts`
- Create: `apps/web/test/exam/navigation.test.tsx`
- Modify: `apps/api/src/routes/run.ts`, `packages/db/src/repo/run.ts`, `apps/web/src/components/exam/Runner.tsx`, `apps/web/src/components/exam/Palette.tsx`

**Interfaces:**
- Consumes: `PinnedLayout`, `AttemptContextVar` (Task 5) · `assertWritable` (Task 9) · `upsertResponse`, `DbClient.batch` · `PaletteState` (Task 6) · `navigation` (**Phase 5** interface row 8).
- Produces:
  ```ts
  // apps/api/src/run/navigation.ts — pure
  /** Presentation order across sections; the index into this is `attempt.max_index`. */
  export function flatQuestionIds(layout: PinnedLayout): string[];
  export function indexOf(layout: PinnedLayout, questionId: string): number;      // -1 when not in the paper
  export function sectionIndexOf(layout: PinnedLayout, flatIndex: number): number;
  /** Throws ApiError(403, "navigation_locked") naming the rule. Never a 404. */
  export function assertReachable(
    layout: PinnedLayout, mode: "free" | "linear" | "per_section", maxIndex: number, questionId: string,
  ): void;
  export function paletteStates(
    layout: PinnedLayout, mode: "free" | "linear" | "per_section", maxIndex: number,
    answered: ReadonlySet<string>, marked: ReadonlySet<string>, current: string,
  ): Record<string, PaletteState>;

  // packages/db/src/repo/run.ts
  /** Bumps only when it rises, so an ordinary save costs no extra statement. */
  export const advanceMaxIndex: ScopedFn<[{ attemptId: string; maxIndex: number }], void>;
  ```

**The rule is "no going back", not "no looking forward", and that is what makes offline work possible.** `AC-14` requires the whole paper in the browser before the network drops, so withholding later questions is not available. `T-13` does not ask for it: `linear` is "no going back", `per_section` is "free inside a section, locked once left". Both forbid *returning*, and both are enforceable on the write path alone — which is where `AC-15`'s "either through the interface or through the API" actually bites. So `assertReachable` refuses a write to an index below `max_index` under `linear`, and to any section before `sectionIndexOf(maxIndex)` under `per_section`.

**`max_index` rises in the same subrequest as the save.** When the target index exceeds `max_index`, the route issues `db.batch([upsert, advanceMaxIndex])`, which `countingDeps` counts as one (`apps/api/src/instrument.ts:70`); when it does not — the common case, re-editing an answer in place — there is no second statement at all. The answer route's measured budget therefore does not move.

**Attack and test.** The attack is a candidate scripting `PUT /run/attempt/answer` against an earlier question after the interface stopped offering it — reading a later question, going back to improve an earlier one, and in `per_section` re-entering a section whose time has been banked. The test drives the route directly with a hand-built body, never the UI.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/navigation.test.ts
it("AC-15: linear — the API refuses a write to an earlier question, with the rule named", async () => {
  await put({ questionId: flat[3]!, clientSeq: 1 });
  const back = await put({ questionId: flat[1]!, clientSeq: 2 });
  expect(back.status).toBe(403);
  expect((await back.json()).error).toMatchObject({ code: "navigation_locked", message: /going back/i });
});

it("AC-15: linear — the refused write stores nothing", async () =>
  expect(await readResponseFor(flat[1]!)).toBeNull());

it("linear allows re-editing the question the candidate is on, and moving forward", async () => {
  expect((await put({ questionId: flat[3]!, clientSeq: 3 })).status).toBe(200);
  expect((await put({ questionId: flat[9]!, clientSeq: 4 })).status).toBe(200);
});

it("per_section: free inside the current section, refused for a section already left", async () => {
  await put({ questionId: firstOfSectionTwo, clientSeq: 5 });
  expect((await put({ questionId: secondOfSectionTwo, clientSeq: 6 })).status).toBe(200);
  expect((await put({ questionId: lastOfSectionOne, clientSeq: 7 })).status).toBe(403);
});

it("free allows any order", async () => {
  for (const [i, q] of [flat[9]!, flat[0]!, flat[4]!].entries()) {
    expect((await putOn("free-nav", { questionId: q, clientSeq: i + 1 })).status).toBe(200);
  }
});

it("a question outside the pinned layout is 404, never 403 — existence is not disclosed", async () => {
  const [mine, theirs] = await Promise.all([put({ questionId: flat[1]! }), put({ questionId: "OTHER-001" })]);
  expect(theirs.status).toBe(404);
  expect(mine.status).toBe(403);                                   // the two are distinguishable, deliberately
});

it("max_index rises inside the same batch, so the save's budget does not move", async () => {
  const counting = countingDeps(deps);
  await put({ questionId: flat[6]!, clientSeq: 8 }, createApp(counting.deps));
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/attempt/answer"]);
});

it("max_index never falls, so a resume cannot reopen a locked question", async () => {
  const before = (await attemptRow(attemptId)).max_index;
  await put({ questionId: flat[Number(before)]!, clientSeq: 9 });
  expect((await attemptRow(attemptId)).max_index).toBe(before);
});

it("AC-15: a resumed attempt keeps the lock across a browser restart", async () => {
  expect((await resume(cookie)).maxIndex).toBe((await attemptRow(attemptId)).max_index);
  expect((await put({ questionId: flat[0]!, clientSeq: 10 })).status).toBe(403);
});
```

```tsx
// apps/web/test/exam/navigation.test.tsx
it("linear: Previous is absent, not merely disabled, and locked squares carry a lock glyph", () => {
  render(<Runner {...props} paper={{ ...paper, navigation: "linear", maxIndex: 3 }} />);
  expect(screen.queryByRole("button", { name: /previous/i })).toBeNull();
  expect(squareFor("locked")).toHaveClass("has-lock");
});

it("per_section: squares in a left section are locked and announce why", () => {
  expect(screen.getByRole("button", { name: /question 1 .*locked/i })).toBeDisabled();
  expect(screen.getByRole("button", { name: /question 1/i })).toHaveAccessibleDescription(/section is closed/i);
});

it("a server 403 the interface did not predict is shown, not swallowed", async () => {
  putAnswer.mockResolvedValue({ outcome: "refused", message: "This test does not allow going back." });
  await userEvent.click(screen.getByRole("button", { name: /question 1/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/going back/i);
});

it("the palette's locked state has no axe violations and is reachable by keyboard", async () =>
  expect(await axe(container)).toHaveNoViolations());
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run/navigation.test.ts apps/web/test/exam/navigation.test.tsx` — FAIL.

- [ ] **Step 3: Implement `navigation.ts`, `advanceMaxIndex` and the palette states**

`flatQuestionIds` concatenates `layout.sections[].questionIds` in order; everything else is arithmetic over that array and `max_index`. The route's order is `assertWritable` (Task 9), then `assertReachable`, then the upsert — time before navigation, because an expired attempt should say so rather than complain about ordering.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api apps/web` — PASS, with the answer route's budget unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web packages/db
git commit -s -m "feat(run): free, linear and per-section navigation refused server-side"
```

---

## Task 11: Submit, receipt and result release (#75, P6.11)

**Files:**
- Create: `apps/api/src/run/submit.ts`, `apps/api/src/run/release.ts`, `apps/api/test/run/submit.test.ts`, `apps/api/test/run/release.test.ts`, `apps/api/test/run/bounded.test.ts`
- Create: `apps/web/src/components/exam/SubmitDialog.tsx`, `apps/web/src/components/exam/Receipt.tsx`, `apps/web/src/components/exam/ResultView.tsx`, `apps/web/test/exam/submit.test.tsx`
- Modify: `apps/api/src/run/bounded.ts` (**closes issue [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129)**), `packages/db/src/repo/run.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/app.ts`, `apps/web/src/lib/run.ts`, `docs/ROADMAP.md` (the Progress table)

**Interfaces:**
- Consumes: `AttemptContextVar`, `PinnedLayout`, `forCandidate` (Task 5) · `assertWritable`, `clockOf` (Task 9) · `flatQuestionIds` (Task 10) · `limitOrThrow` (Task 4) · `scoreAttempt({ questionsBySection, responses, awards, defaults, passMarkPercent }): AttemptScore`, `AttemptScore` (`packages/core/src/score.ts:25,43`), `gradeQuestion`, `matchBounded`'s call sites in `packages/core/src/grade/text.ts` · `listResponses`, `listQuestionsForBanks`, `appendAudit`, `insertAuthToken`, `consumeAuthToken`, `EmailAdapter`. From **Phase 5**: release (row 9), scoring defaults (row 2).
- Produces:
  ```ts
  // apps/api/src/run/submit.ts
  export type SubmitReason = "manual" | "timeout" | "limit";
  export interface Receipt { attemptId: string; submittedAt: number; answered: number; unanswered: number; total: number }
  export function submitAttempt(deps: AppDeps, attempt: AttemptContextVar, reason: SubmitReason, now: number):
    Promise<{ receipt: Receipt; released: ReleasedResult | null }>;

  // apps/api/src/run/release.ts — the server-side gate; the browser renders what it is given
  export interface ReleasedResult {
    show: "score_only" | "score_and_sections" | "full_review";
    total: number; max: number; percent: number; passed: boolean | null; pending: string[];
    sections?: { sectionId: string; title: string; points: number; max: number }[];
    review?: { questionId: string; yourAnswer: unknown; correct: unknown; explanation: string | null; points: number }[];
  }
  /** null when the release setting says the candidate may not see it yet. */
  export function releasedResult(
    release: TestRelease, score: AttemptScore, questions: readonly Question[],
    responses: Record<string, ResponseValue | null>, now: number,
  ): ReleasedResult | null;

  // packages/db/src/repo/run.ts
  export const finishAttempt: ScopedFn<
    [{ attemptId: string; submittedAt: number; reason: SubmitReason; score: AttemptScore }], { already: boolean }>;
  export const findAttemptByReference: ScopedFn<[{ testId: string; attemptRef: string; emailHash: string }], string | null>;

  // apps/api/src/run/bounded.ts (hardened — issue #129)
  export class MatchBudgetExceeded extends Error { readonly pattern: string }
  export function matchBounded(pattern: string, input: string): boolean;

  // apps/web/src/lib/run.ts (widened)
  export interface RunClient {
    submit(): Promise<{ receipt: Receipt; released: ReleasedResult | null }>;
    result(): Promise<ReleasedResult | null>;
    requestResultCode(attemptRef: string, email: string): Promise<void>;
    verifyResultCode(attemptRef: string, email: string, code: string): Promise<ReleasedResult | null>;
  }
  ```

**The release gate is assembled on the server, not filtered in the browser.** `AC-16` — "Results show to candidates exactly as the release setting says, and never before it" — is a property of what the response *contains*: `score_only` carries no `sections` key at all, `score_and_sections` carries no `review` key, and `never` and a future `on_date` carry nothing but the receipt. A browser that renders less than it was given is a UI bug; a browser that was given more than it should have is the vulnerability `SECURITY.md` names ("Any way to read or change them from a candidate session **is** a vulnerability").

**Submission is idempotent.** `finishAttempt` writes only when `submitted_at IS NULL`, in one statement, and returns `{ already: true }` otherwise — so the client at zero, the server's next request past the deadline, and a double-click cannot produce two scores or two audit rows.

**`C-09`'s return visit** reuses `auth_token` once more: `POST /run/result/code` mints a 10-minute `run_result` code against `(attemptRef, email)` and emails it; `POST /run/result/verify` consumes it and answers `releasedResult` — the same function the finish page calls, so there is one gate and not two. Both are rate-limited by Task 4's `result_code` bucket, and a wrong reference and a wrong email produce the same response, so neither enumerates attempts.

### Issue #129 lands here, widened

**Ruling: [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129) lands in Phase 6, as a step of this task, and its scope widens from `fill_blank` grading to every author-written regex run against candidate input.** — Why: #129 asks for "a server-side execution bound where grading actually runs", and **Phase 6 is the first phase where grading runs at all** — Phase 1 wrote `assertSafeRegex` as the authoring-time heuristic, Phase 4 let an author store a pattern, and nothing has ever executed one against a candidate's text. Phase 6 also adds a *second* execution site the issue predates: `registration_form` field `validation.pattern`, which `schemas/test-1.json` `$defs.validation` describes as "RE2-safe regular expression, checked on the server" and which Task 3 runs against candidate input before any attempt exists. Two surfaces, one helper. — Cost if wrong: if it is deferred instead, a single six-character pattern an author typed takes the candidate's request past the Workers 10 ms CPU limit and the candidate loses an answer save to a question someone else authored badly, which is the exact failure the issue says must not happen.

`matchBounded` does what a pure package cannot: it caps the input at `MAX_MATCH_INPUT` (500, `question-format.md`'s `short_answer` ceiling), re-runs `assertSafeRegex` at execution time rather than trusting the authoring-time pass, and throws `MatchBudgetExceeded` rather than returning a verdict. `gradeQuestion`'s caller catches it per question: that question scores as **pending** and is flagged for the organiser, and the attempt completes — #129's acceptance criteria, and consistent with the PRD's rule that scoring failures never block answering.

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `POST` | `/api/v1/run/attempt/submit` | `attempt` | `MEASURE` (context + responses + questions + batch + audit) |
| `GET` | `/api/v1/run/attempt/result` | `attempt` | `MEASURE` |
| `POST` | `/api/v1/run/result/code` | `public` | `MEASURE` |
| `POST` | `/api/v1/run/result/verify` | `public` | `MEASURE` |

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/run/submit.test.ts
it("C-08: the receipt carries the attempt reference and the time, and no score", async () => {
  const { receipt, released } = await (await submit(cookie)).json();
  expect(receipt).toMatchObject({ attemptId: expect.stringMatching(/^att_/), submittedAt: expect.any(Number),
    answered: 12, unanswered: 5, total: 17 });
  expect(released).toBeNull();                                  // release.when = "never" on this fixture
});

it("submitting twice scores once and writes one audit row", async () => {
  await submit(cookie); await submit(cookie);
  expect(await auditCount(attemptId)).toBe(1);
  expect((await attemptRow(attemptId)).score_json).toEqual(firstScore);
});

it("AC-06: the stored score matches scoreAttempt over the same responses", async () => {
  expect(JSON.parse((await attemptRow(attemptId)).score_json))
    .toEqual(scoreAttempt({ questionsBySection, responses, awards: {}, defaults, passMarkPercent: 50 }));
});

it("manual types are pending, not zero", async () =>
  expect(JSON.parse((await attemptRow(attemptId)).score_json).pending).toEqual(["WRI-001"]));

it("submit_reason records which of the three ended it", async () => {
  expect((await attemptRow(manualId)).submit_reason).toBe("manual");
  expect((await attemptRow(timedOutId)).submit_reason).toBe("timeout");
});

it("a save after submit is refused (Task 8's contract, from the other side)", async () =>
  expect((await put({ clientSeq: 99 })).status).toBe(409));

it("the submit route reads the questions once, not once per answer", async () => {
  const counting = countingDeps(deps);
  await submit(cookie, createApp(counting.deps));
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/run/attempt/submit"]);
});
```

```ts
// apps/api/test/run/release.test.ts
it.each([
  ["never",    "score_only",         null],
  ["on_submit","score_only",         { total: expect.any(Number), sections: undefined, review: undefined }],
  ["on_submit","score_and_sections", { sections: expect.any(Array), review: undefined }],
  ["on_submit","full_review",        { sections: expect.any(Array), review: expect.any(Array) }],
])("AC-16: when=%s show=%s returns %j and nothing more", async (when, show, expected) => {
  const body = (await (await submitOn({ when, show })).json()).released;
  expect(body).toEqual(expected === null ? null : expect.objectContaining(expected));
});

it("AC-16: on_date shows nothing before `at` and the result after it", async () => {
  expect((await (await submitOn({ when: "on_date", at: future })).json()).released).toBeNull();
  deps.now = () => Date.parse(future) + 1;
  expect(await (await result(cookie)).json()).toMatchObject({ total: expect.any(Number) });
});

it("S-10: a score_and_sections release carries no key and no explanation", async () => {
  const text = JSON.stringify(await releasedFor("score_and_sections"));
  for (const leak of ["explanation", "correct", "key", "rubric"]) expect(text, leak).not.toContain(leak);
});

it("full_review carries the correct answer and the explanation, because that is what it means", async () => {
  const r = await releasedFor("full_review");
  expect(r.review![0]).toMatchObject({ correct: expect.anything(), explanation: expect.any(String) });
});

it("C-09: a result code is emailed, is 10-minute single-use, and a wrong email answers identically", async () => {
  await requestResultCode(ref, "a@b.ac.in");
  const code = sentCode(mailbox);
  expect((await verifyResultCode(ref, "a@b.ac.in", code)).status).toBe(200);
  expect((await verifyResultCode(ref, "a@b.ac.in", code)).status).toBe(410);
  expect(await (await requestResultCode(ref, "wrong@b.ac.in")).text())
    .toBe(await (await requestResultCode("att_000000000000", "a@b.ac.in")).text());
});
```

```ts
// apps/api/test/run/bounded.test.ts — issue #129
it("#129: a catastrophic pattern does not block answering, saving or submitting", async () => {
  await seedFillBlankWith("(a|a)+$", "a".repeat(30));
  const res = await submit(cookie);
  expect(res.status).toBe(200);
  expect((await res.json()).receipt.attemptId).toBe(attemptId);
});

it("#129: the affected question is flagged for the organiser, not silently scored zero", async () => {
  const score = JSON.parse((await attemptRow(attemptId)).score_json);
  expect(score.pending).toContain("BLK-001");
  expect(await auditFor(attemptId)).toContainEqual(expect.objectContaining({ action: "attempt.scoring_blocked" }));
});

it("matchBounded caps input length before it runs the pattern", () => {
  expect(() => matchBounded("^a*$", "a".repeat(MAX_MATCH_INPUT + 1))).toThrow(MatchBudgetExceeded);
});

it("matchBounded re-checks the pattern at execution time, not only at authoring time", () => {
  expect(() => matchBounded("(a+)+$", "aaaa")).toThrow(MatchBudgetExceeded);
});

it("#129's second surface: a registration pattern runs through the same helper", async () => {
  await publishFormWithPattern("(a|a)+$");
  expect((await register(await gate(), { roll: "a".repeat(40) })).status).toBe(422);
});

it("an ordinary pattern still matches", () => expect(matchBounded("^\\d{2}[A-Z]{2}\\d{4}$", "21CS0147")).toBe(true));
```

```tsx
// apps/web/test/exam/submit.test.tsx
it("C-08: the confirmation names the unanswered and marked counts before submitting", async () => {
  await userEvent.click(screen.getByRole("button", { name: /submit/i }));
  expect(screen.getByRole("dialog")).toHaveTextContent(/5 unanswered.*2 marked/is);
  expect(onSubmit).not.toHaveBeenCalled();
});

it("C-08: the finish page shows the reference and the time, and no score when release says never", () => {
  render(<Receipt receipt={receipt} released={null} />);
  expect(screen.getByText(receipt.attemptId)).toBeVisible();
  expect(screen.queryByText(/score|%|passed/i)).toBeNull();
});

it("AC-16: the result view renders only what the payload carries", () => {
  render(<ResultView result={{ show: "score_only", total: 31, max: 40, percent: 77.5, passed: true, pending: [] }} />);
  expect(screen.queryByRole("table")).toBeNull();
});

it("the submit dialog traps focus, returns it on cancel, and has no axe violations", async () => {
  expect(await axe(container)).toHaveNoViolations();
  await userEvent.keyboard("{Escape}");
  expect(document.activeElement).toHaveAccessibleName(/submit/i);
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run apps/web/test/exam/submit.test.tsx` — FAIL.

- [ ] **Step 3: Implement `submitAttempt`, `releasedResult`, `finishAttempt`, the hardened `matchBounded`, and the three screens**

`releasedResult` builds the payload by `show` level rather than deleting from a full one, for Review Focus 5's reason. `finishAttempt` is one `UPDATE … WHERE submitted_at IS NULL … RETURNING`, the same single-statement idempotence `consumeAuthToken` uses. `matchBounded` wraps the match in a `try` around `assertSafeRegex` plus the length cap; the per-question `catch` lives in `submitAttempt`, so one bad question costs one `pending` entry and one audit row.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`, with `TEST_POSTGRES_URL` set — all pass on both dialects.

- [ ] **Step 5: Close #129, update the roadmap and commit**

Move Phase 6 to **Done** in `docs/ROADMAP.md`'s Progress table, naming what landed and the issues that closed, and note that #129 closed here rather than in Phase 1.

```bash
git add apps/api apps/web packages/db docs/ROADMAP.md
git commit -s -m "feat(run): submit, receipt, release gate and a bounded regex at scoring time"
```

---

## Task 12: Candidate response scrubbing (#76, P6.12)

**Files:**
- Create: `apps/api/test/run/scrub-scan.test.ts`, `apps/api/test/fixtures/run/sentinel-bank.json`
- Modify: `apps/api/src/run/scrub.ts` (complete it for every type), `apps/api/src/run/release.ts`, `apps/api/src/app.ts` (no new route), `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `ROUTE_AUTH`, `mountedEndpoints` (Task 1) · `forCandidate`, `CandidateQuestion` (Task 5) · `releasedResult` (Task 11) · every candidate route Tasks 1–11 mounted.
- Produces: no new exported symbol. The deliverable is `apps/api/test/run/scrub-scan.test.ts`, the gate `AC-22` names, plus whatever `forCandidate` and `releasedResult` must drop to pass it.

**`AC-22` asks for a scan, not a suite.** "No candidate API response contains keys, explanations or other candidates' data. This is checked by an automated test that scans every response." The scan is a fixture in which every secret is a unique sentinel string — `__KEY_LOG001__`, `__EXPL_LOG001__`, `__RUBRIC_WRI001__`, `__MODELANS_WRI001__`, `__ACCEPT_BLK001__`, `__TOL_QNT003__`, `__OTHER_CANDIDATE__`, `__ACCESS_CODE__` — replayed through **every** endpoint `ROUTE_AUTH` marks `attempt` or candidate-`public`, with the route list derived from `ROUTE_AUTH` rather than written by hand. A Phase 7 snapshot route is then either scanned or a failing enumeration, which is the only form of this test that survives the next phase (Review Focus 5).

Two further leak classes ride the same scan, following `apps/api/test/export/round-trip.test.ts:249`'s precedent: **internal identifiers** (`wsp_`, `bnk_`, `qst_`, `ver_`, `usr_`, and any `cnd_`/`att_` that is not this candidate's own) and **other candidates' data**, seeded by a second registered candidate whose every form value is a sentinel.

The one deliberate exception is `full_review`, where the key and the explanation are exactly what `T-22` promises; the scan asserts the sentinels appear there and **only** there, and only once the release gate has opened.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/run/scrub-scan.test.ts — AC-22's gate
const SECRETS = ["__KEY_LOG001__", "__EXPL_LOG001__", "__RUBRIC_WRI001__", "__MODELANS_WRI001__",
  "__ACCEPT_BLK001__", "__TOL_QNT003__", "__OTHER_CANDIDATE__", "__ACCESS_CODE__"];
const INTERNAL = ["wsp_", "bnk_", "qst_", "ver_", "usr_"];

/** Derived from ROUTE_AUTH, never hand-written: a route added later is scanned or fails. */
const CANDIDATE_ENDPOINTS = Object.entries(ROUTE_AUTH)
  .filter(([e, a]) => a === "attempt" || (a === "public" && e.includes("/run/")));

it("AC-22: every candidate endpoint is covered by this scan", () => {
  expect(CANDIDATE_ENDPOINTS.length).toBe(expectedCandidateEndpointCount);   // bumped deliberately
  expect(scanned()).toEqual(new Set(CANDIDATE_ENDPOINTS.map(([e]) => e)));
});

it.each(CANDIDATE_ENDPOINTS)("AC-22: %s leaks no key, explanation or other candidate's data", async (endpoint) => {
  const body = await replay(endpoint);                      // a live attempt over the sentinel fixture
  for (const s of SECRETS) expect(body, `${endpoint} leaked ${s}`).not.toContain(s);
});

it.each(CANDIDATE_ENDPOINTS)("S-09: %s leaks no internal identifier", async (endpoint) => {
  const body = await replay(endpoint);
  for (const p of INTERNAL) expect(body, `${endpoint} leaked ${p}`).not.toContain(p);
});

it("AC-22: the scan would catch a leak — a deliberately unscrubbed route fails it", async () => {
  // The scan's own guard: without this, a scan over an empty body passes forever.
  expect(await replayWith(unscrubbedRoute)).toContain("__KEY_LOG001__");
});

it("T-22: full_review is the one place a key and an explanation appear, and only after release", async () => {
  expect(await replay("GET /api/v1/run/attempt/result", { show: "full_review", when: "on_submit" }))
    .toContain("__KEY_LOG001__");
  expect(await replay("GET /api/v1/run/attempt/result", { show: "full_review", when: "on_date", at: future }))
    .not.toContain("__KEY_LOG001__");
});

it("a candidate's own attempt and candidate ids are present; another candidate's are not", async () => {
  const body = await replay("GET /api/v1/run/attempt");
  expect(body).toContain(myAttemptId);
  expect(body).not.toContain(otherAttemptId);
});

it.each(QUESTION_TYPES)("forCandidate builds %s field by field, so a new stored field cannot leak", (type) => {
  const stored = { ...fixture(type), __future_secret__: "__LEAK__" } as unknown as Question;
  expect(JSON.stringify(forCandidate(stored, { mediaBase }))).not.toContain("__LEAK__");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/run/scrub-scan.test.ts` — FAIL, naming each endpoint and each sentinel it still carries.

- [ ] **Step 3: Complete `forCandidate` and `releasedResult`**

Fix whatever the scan reports. `forCandidate` must be an allowlist — it constructs `CandidateQuestion` field by field and never spreads the stored document — which is what makes the last test above pass and what keeps a field added in Phase 7 or 9 from leaking by default.

- [ ] **Step 4: Run the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`, with `TEST_POSTGRES_URL` set — all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api docs/ROADMAP.md
git commit -s -m "test(run): AC-22 scan of every candidate response for keys and other candidates' data"
```

---

## Smaller calls made while planning

The planner's calls, not the PRD's. Listed so a human can overrule them cheaply.

- **Ruling: candidate routes mount under `/api/v1/run/…` and are authorised by the attempt token, not by workspace membership.** — Why: `docs/PRD.md`'s REST API table names those paths and that authority verbatim; `S-06`; [ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md) ("Nothing in this decision gives a candidate a user row"). — Cost if wrong: every route path and every `ROUTE_AUTH`, `ROUTE_BUDGETS` key changes, plus the candidate URL in `T-02`.
- **Ruling: a third table, `ROUTE_AUTH`, declares every mounted endpoint's authority.** — Why: `authorization.test.ts:153` enumerates only guarded routes, and this phase makes "unguarded" ordinary (Review Focus 1). — Cost if wrong: one table and one test file to delete; the alternative is that a later phase's unguarded organiser route ships silently.
- **Ruling: the two pre-workspace candidate reads live in `repo/candidate-entry.ts`, not in `identity.ts`.** — Why: [ADR 0006](../../adr/0006-identity-reads-sit-outside-the-workspace-guard.md)'s "to watch" section — a function that is not about users or sessions should take a workspace ID — and these cannot. — Cost if wrong: move two functions and merge two pinned lists.
- **Ruling: the attempt token is an HttpOnly cookie scoped to `/api/v1/run`, not a body field the client stores.** — Why: `C-06` requires a browser restart to resume, which `sessionStorage` cannot do; `S-03` sets the cookie posture; HttpOnly keeps the token away from the runner's own Markdown rendering. — Cost if wrong: the client stores and sends a bearer token, and the offline queue has to carry it; one header, no schema change.
- **Ruling: `attempt` gains exactly two columns, `max_index` and `section_started_at`.** — Why: `max_index` carries `linear` *and* `per_section` because the current section is `sectionIndexOf(max_index)` over the pinned layout, and `section_started_at` is the only thing a per-section deadline cannot be derived from. — Cost if wrong: one more column and one migration.
- **Ruling: mark-for-review is browser state in `localStorage`, not a column.** — Why: `C-06` promises resume "in the same browser"; `C-08`'s confirmation is rendered client-side; a column would cost a D1 write per toggle against the 100,000/day budget for a flag the server never reads. — Cost if wrong: one `json` column on `attempt` and one field on the save route.
- **Ruling: the offline queue uses `localStorage`, not IndexedDB.** — Why: `AC-14` needs survival across a reload, which both give; `localStorage` is synchronous (so a `beforeunload` flush lands), needs no jsdom polyfill, and answers are text. — Cost if wrong: swap one module behind `SaveQueue`'s interface.
- **Ruling: rate-limit buckets are a D1 table, and the answer-save path takes none.** — Why: ADR 0002's adapter rule rules out KV and Durable Objects for the reference path; a save is already bounded by a live token and a server deadline, and a counter write would double the PRD's one-write hot path. — Cost if wrong: one table, and a limiter line on one route.
- **Ruling: auto-submit at zero is whichever of the client at zero or the server's next request happens first, with no scheduled sweep.** — Why: nothing in the roadmap gives Phase 6 a Cron Trigger (Phases 10 and 11 introduce scheduling), and an attempt read past its deadline materialises the submission, so Phase 8's results read is correct either way. — Cost if wrong: one Cron Trigger and a `WHERE submitted_at IS NULL AND deadline_at < ?` sweep beside Phase 8's retention job.
- **Ruling: `C-01`'s "Check my device" reports in Phase 6 and blocks in Phase 7.** — Why: `C-01` puts the button on the landing page, which is this phase; `docs/ROADMAP.md`'s Phase 7 "Delivers" owns "device and browser gating" and "the camera requirement". — Cost if wrong: the gate moves into `ExamLanding`'s existing `deviceReport()` call site.
- **Ruling: no `POST /run/attempt/events` and no `/snapshot` route in Phase 6.** — Why: both appear in the PRD's REST table but every event and snapshot producer is a `P-*` control, and `docs/ROADMAP.md` puts all of them in Phase 7. `appendEvents` already exists in `packages/db` and is not called by this phase. — Cost if wrong: two routes and two `ROUTE_AUTH` lines.
- **Ruling: the candidate app is a third Vite entry (`exam.html`), not a route inside the admin bundle.** — Why: the candidate's 300 KB budget is a PRD non-functional requirement and the admin bundle is unbounded; `bundle.test.ts`'s existing `ADMIN_PATH_RE` guard becomes enforceable for the candidate only if the entries are separate. — Cost if wrong: one Rollup input and one HTML file.
- **Ruling: the SPA fallback mapping `/<ws>/<test>` to `exam.html` is ordered after every specific `_headers` / `_redirects` rule.** — Why: a two-segment wildcard would otherwise swallow `/api`, `/assets` and `/admin.html`; `apps/web/test/hosting.test.ts` already pins hosting configuration and is extended to pin the order. — Cost if wrong: a reordered rule and a failing hosting test, caught locally.
- **Ruling: `validateRegistration` lives in `packages/core` and takes its regex matcher as an injected option.** — Why: `docs/test-format.md:110` makes the server the only copy that counts, and one implementation with two callers is the cheapest way to keep the browser's message identical; `packages/core` is a pure leaf package and cannot host a bounded matcher itself. — Cost if wrong: two validators that drift, which is the defect the ruling exists to prevent.
- **Ruling: unique registration values are stored as SHA-256 hashes in `candidate_unique`, not as a JSON index.** — Why: neither SQLite nor Postgres gives a portable unique index into a JSON column, and a plaintext column would be a second copy of data `S-15` lets an operator encrypt. — Cost if wrong: a plain-value column, and a case-folding decision to make explicit.
- **Ruling: `GET /api/v1/run/attempt/media/:key` is authorised by membership in `layout.media`, not by the attempt's workspace.** — Why: Review Focus 2; the pinned layout is already in memory so the check costs nothing, and the workspace check would authorise every image in the workspace. — Cost if wrong: a candidate can enumerate the workspace's content-addressed media, which is a reportable vulnerability under `SECURITY.md`'s scope note.
- **Ruling: `GET /api/v1/workspaces/:id/media/:key` keeps `banks.edit` and is not relaxed.** — Why: Phase 4 chose it deliberately; relaxing it would widen the organiser route instead of adding a candidate one, and `ROUTE_ACTIONS` would stop expressing who may read a bank. — Cost if wrong: one line in `ROUTE_ACTIONS` and a weaker organiser boundary.
- **Ruling: `AC-07`'s pointer drag, deferred by Phase 4, is closed in Task 7 by extending `ReorderableList` rather than writing a second control.** — Why: Phase 4's deferral note specifies the exact shape ("native HTML5 `dragstart` / `dragover` / `drop` handlers calling the `onReorder(from, to)` Task 3 already exposes … no change to `ReorderableList`'s props"). — Cost if wrong: the authoring and candidate sides grow two reordering controls that drift.
- **Ruling: `fill_blank` inputs are interleaved into the *rendered* HTML on an invisible marker, not substituted into the Markdown source.** — Why: substituting an `<input>` before rendering requires `html: true`, which [ADR 0004](../../adr/0004-client-side-rendering-with-lazy-loaded-katex.md) and `markdown-it`'s `html: false` setting forbid, and would create the first stored-HTML surface in the product. — Cost if wrong: a different splitting token; the tests pin the three ways a marker can be mangled.
- **Ruling: issue [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129) lands in Phase 6 (Task 11) and widens to cover registration patterns.** — Why: Phase 6 is the first phase in which any author-written regex runs against candidate input, and it adds a second such surface the issue predates (`schemas/test-1.json` `$defs.validation.pattern`). — Cost if wrong: one `fill_blank` question can cost every candidate who answers it a failed save, which is what the issue was filed to prevent.

## Known deferrals, recorded so they are not rediscovered as bugs

- **`T-21`'s uploaded candidate-list allowlist is not enforced.** Issue [#66](https://github.com/SriSatyaLokesh/pariksha/issues/66) names the four access modes; `allow_email_domains` and `allow_ip_ranges` ship in Task 2, and "only listed IDs may register" does not, because the list is a Phase 5 artefact whose storage shape this plan could not read (interface row 14). What would be added: one lookup in `entry.ts`'s pre-switch allowlist block, against whatever Phase 5 stores. **Until that lands, `T-21` is partly met.**
- **`C-10`'s proctor broadcast banner is not built.** The PRD lists it under Candidate experience, but `docs/ROADMAP.md`'s Phase 6 "Delivers" omits it and Phase 8 owns "the live monitor with proctor actions" — the sender. `DESIGN.md` specifies `proctor-banner` as a runner component; Phase 6 ships no receiver, so both halves land together in Phase 8.
- **`T-19`'s URL reachability check is not performed.** `validation.check_reachable` is accepted and ignored. A server-side `fetch` of a candidate-supplied URL during registration is an SSRF surface and a latency hazard on a 10 ms CPU budget, and the PRD's own wording is "flag it as unverified", which is a results-side annotation. What would be added: a queued check in Phase 8, writing the flag onto the candidate row.
- **`T-24`'s per-test interface language is English only.** The PRD scopes translation files to v1 and `docs/ROADMAP.md` puts internationalisation in Phase 12; the candidate runtime adds no hard-coded string that a translation file could not later replace, but there is no translation file in this phase.
- **No scheduled auto-submit sweep** — see the ruling above. An attempt whose candidate closes the tab stays un-submitted until it is next read.
- **No `rate_limit` row expiry.** The table grows one row per bucket per window until Phase 8's retention job sweeps it.
- **Phase 7 will add `blob:` to `img-src`** for camera frames (`apps/api/src/middleware/security.ts:10` already says so). Phase 6 changes `img-src` not at all.

## Escalated — needs a human decision

**1. Bot protection breaks the "no third-party scripts" promise, and two PRD clauses of equal precedence disagree.**
`S-07`: "Registration is protected by Cloudflare Turnstile or hCaptcha (both free)". `S-11`: "No analytics, telemetry or third-party scripts; fonts and the face model are served from the app itself." A Turnstile or hCaptcha widget is a script from `challenges.cloudflare.com` (or `hcaptcha.com`), an iframe and an XHR, so it needs `script-src`, `frame-src` and `connect-src` entries in a CSP that is `'self'` everywhere today — in two files that must stay byte-identical, one of which is pinned by `apps/web/test/hosting.test.ts:25` asserting no `https?://` appears at all. `docs/ROADMAP.md`'s operator table lists "A Turnstile site key and secret — Registration bot protection — Phase 6", which favours Turnstile, but the roadmap ranks below the PRD and cannot overrule `S-11`.
- **(a) Ship Turnstile, narrow `S-11`.** Costs: an ADR amending `S-11`; three CSP directives naming one origin; `hosting.test.ts` gains an allowlist; every candidate's browser contacts Cloudflare on the registration page, on a product whose landing page sells "no third-party scripts"; a self-hoster with no Cloudflare account gets no bot protection.
- **(b) Ship no captcha; rate limits only.** Costs: `S-07` is unmet and the acceptance checklist must say so; a browser farm registering at human speed is unstopped, which on a public `link_code` test means junk candidate rows and D1 writes. `S-11` and the CSP are untouched.
- **(c) Ship a same-origin proof-of-work on registration** (a few lines of WebCrypto, one server-issued challenge, no third-party anything). Costs: it is not what `S-07` names, so `S-07` is still formally unmet; it raises a farm's cost without stopping a determined one; it costs a candidate on a slow phone a second or two — and `P-01` already blocks phones.
- **Recommendation: (c), with (a) available as a per-instance opt-in.** It keeps the `S-11` promise the product is marketed on, keeps the CSP at `'self'` for every default deployment, and leaves `verifyCaptcha`'s seam in place so an operator who wants Turnstile configures a secret and accepts the CSP change on their own instance. If (a) is chosen instead, Task 4's ADR is written and `ALLOWED_THIRD_PARTY_ORIGINS` names exactly one origin.

**2. `full_review` on submit hands a candidate the answer key before their next attempt.**
`T-22` allows `when: "on_submit"` with `show: "full_review"`, and `T-14` allows `attempts_allowed > 1`. Together they mean a candidate finishes attempt 1, reads every correct answer and explanation, and starts attempt 2. `docs/test-format.md:190` says "use only after the test has closed for everyone", which is advice to an organiser, not a rule the server enforces, and nothing says who should enforce it.
- **(a) Nobody enforces it.** Costs: an organiser configuring a retake with full review silently hands out the key; it will be reported as a bug.
- **(b) Phase 5 refuses the combination at publish**, in the `UX-17` checklist. Costs: one checklist row; an organiser who genuinely wants it (a practice test) cannot have it.
- **(c) Phase 6 degrades it at runtime** — `full_review` falls back to `score_and_sections` while the candidate has attempts remaining, and opens fully once they do not.
- **Recommendation: (c).** It is three lines in `releasedResult` and the only option that serves both the practice-test case and the retake case correctly, but it is a product behaviour nobody has specified, so it is not a planner's call to make.

**3. Which attempt's score does a candidate see when `attempts_allowed > 1`?**
`T-14` sets `counted_attempt` to `highest`, `latest` or `average` — a *results* concept the roadmap gives to Phase 8. `AC-16` says results show "exactly as the release setting says" and is silent on which attempt. On the finish page after attempt 2 of 3, a candidate could reasonably be shown this attempt's score or the counted one, and the two disagree whenever `counted_attempt` is `highest` or `average`.
- **(a) This attempt's score.** Matches what a finish page means; disagrees with the organiser's CSV.
- **(b) The counted score.** Matches the CSV; requires reading every prior attempt on the finish page, which adds a subrequest to a route that currently needs none, and tells a candidate mid-series something about earlier attempts.
- **Recommendation: (a)**, with the receipt naming which attempt it is ("Attempt 2 of 3"). It is cheaper, it is what the page appears to promise, and Phase 8 owns the counted figure.

## Done when

- `AC-12` passes: required, regex, domain and unique rules each block an invalid registration with the message on the field, driven through `POST /run/:ws/:test/register` with a body no honest client could produce, and a repeat of a unique field is refused with no half-written candidate behind it.
- `AC-13` passes: the server deadline ignores the client clock, an answer 31 s past the deadline is refused where 29 s is accepted, and moving the system clock forward an hour does not move the rendered countdown.
- `AC-14` passes: two minutes with the network off loses no answers and preserves their order, and a new queue over the same `localStorage` drains what the old one held; a resumed attempt reproduces the same questions, the same option order, the same answers and the correct remaining time.
- `AC-15` passes: in `linear`, `PUT /run/attempt/answer` against an earlier question is 403 with the rule named and stores nothing — asserted against the route, not the interface — and the lock survives a browser restart.
- `AC-16` passes: for every `(when, show)` combination the response body contains exactly what the setting allows and no more, `on_date` carries nothing before `at`, and `full_review` is the only shape carrying a key or an explanation.
- `AC-22` passes: a sentinel fixture replayed through every endpoint `ROUTE_AUTH` marks `attempt` or candidate-`public` leaks no key, explanation, rubric, model answer, accepted answer, tolerance, access code, internal identifier or other candidate's value — with the endpoint list derived from `ROUTE_AUTH`, and a self-check proving the scan would catch a leak.
- `AC-07`'s remaining half is closed: `ordering` reorders by pointer drag as well as by keyboard, through the same `onReorder`, with Phase 4's focus and live-region behaviour unchanged.
- The candidate can load exactly the media in their own attempt's pinned layout and nothing else; a key in the same workspace but outside the layout is the same 404 as a key from another workspace; the response is `private, max-age=31536000, immutable`; SVG is still refused; and `GET /api/v1/workspaces/:id/media/:key` is still `banks.edit`.
- Issue [#129](https://github.com/SriSatyaLokesh/pariksha/issues/129) is closed: a `fill_blank` carrying `(a|a)+$` against 30 characters does not block answering, saving or submitting; the question is flagged rather than silently zeroed; and a registration `validation.pattern` runs through the same bound.
- `ROUTE_AUTH` covers every mounted endpoint, its `workspace` set equals `ROUTE_ACTIONS`'s keys, its `public` set matches a literal allowlist, and `authorization.test.ts` passes unchanged.
- `ROUTE_BUDGETS` covers every route this phase mounts, each number measured with `toBe` rather than bounded, none reaching 50, and `PUT /run/attempt/answer` at exactly one D1 read and one D1 write.
- Every candidate screen passes `jest-axe` at 100% and 200% zoom, every control's accessible name contains its visible label, every palette and banner state carries a non-colour signal, nothing inside a live attempt animates, and `apps/web/test/no-hex-colors.test.ts` still finds nothing.
- `katex` is in no entry's static graph including `exam`, no organiser module is statically reachable from `exam`, and `_headers` still names no third-party origin unless the escalation above was answered (a) and an ADR says which one.
- `pnpm lint typecheck build test` passes with SQLite and Postgres both migrating in CI.

## Self-review

Run after writing, against the spec, by the planner.

**1. Spec coverage.** `C-01`→T1, `C-02`→T2, `C-03`+`S-12`→T3, `C-04`→T6, `C-05`→T8, `C-06`→T5+T8, `C-07`→T9, `C-08`+`C-09`→T11, `S-06`→T5, `S-07`→T4, `S-10`→T12, `T-12`/`T-14`→T5, `T-13`→T10, `T-16`/`T-17`→T3, `T-20`→T2, `T-21`→T2 (partly; see deferrals), `T-22`→T11, `T-23`→T1, `AC-07`→T7, `AC-09`–`AC-11`→T5, `AC-12`→T3, `AC-13`→T9, `AC-14`→T8, `AC-15`→T10, `AC-16`→T11, `AC-22`→T12. **Gaps, each recorded as a deferral with its reason:** `C-10` (Phase 8 owns the sender), `T-19` (`check_reachable`), `T-21`'s candidate list, `T-24` (translations, Phase 12).

**2. Step scan.** Every Step 3 names the exact symbols to implement and carries prose only where the signature and tests leave a choice — the `rate_limit` upsert (two concurrent requests must not both read a stale count), the queue's retry schedule, the inline-blank split order, and the `max_index` batch. No step says "handle edge cases" or "add appropriate validation", and no step carries a function body the tests already determine.

**3. Type consistency.** `AttemptRecord` (T5) is the shape `attemptContext` (T5) puts on `c.var.attempt` as `AttemptContextVar` and that T7, T8, T9, T10 and T11 consume by that name. `PinnedLayout = AttemptLayout & { media: string[] }` is defined once in T5 and used in T7 and T10. `AttemptPaper` (T5) is what `/start`, resume (T5), the runner (T6) and the clock (T9) share. `SaveOutcome` (T8) is the three-way result T9's `assertWritable` and T10's `assertReachable` produce. `PaletteState` is defined in T6 and produced by T10's `paletteStates`. `forCandidate` / `CandidateQuestion` are defined in T5 and completed in T12 — no second name. `matchBounded` is written in T3 and hardened in T11, same signature.

**4. Review Focus.** 1 → `apps/api/test/route-authority.test.ts` (T1). 2 → `apps/api/test/run/media.test.ts` (T7). 3 → `apps/web/test/exam/queue.test.ts`'s "a refused save is KEPT" and "the banner never reads Saved" (T8). 4 → `apps/web/test/exam/clock.test.tsx`'s "moving the system clock forward an hour" (T9). 5 → `apps/api/test/run/scrub-scan.test.ts` (T12).

**5. Proportion.** The spec this plan argues from is about 1,600 lines (`docs/PRD.md` 689, `docs/test-format.md` 217, `docs/ROADMAP.md` 245, `docs/question-format.md` 80, the six ADRs, `SECURITY.md`). The plan is about 2,380 lines — of that order, not a multiple of it. Code blocks are test names and assertions carrying the spec's exact values (`45 * 60_000`, `29_000` / `31_000`, `[10, 2]`, 500, `*.ac.in`, `21CS0147`), plus three implementation fragments the signatures genuinely do not determine: the `rate_limit` upsert, the `BLANK_MARKER` shape, and the `ROUTE_AUTH` declaration. No task carries a function body.
