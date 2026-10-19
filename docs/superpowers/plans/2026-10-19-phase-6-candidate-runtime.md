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

## Task 2: Access gate for all four modes (#66, P6.2)

**Files:**
- Create: `apps/api/src/run/entry.ts`, `apps/api/src/run/net.ts`, `apps/api/test/run/access.test.ts`, `apps/api/test/run/net.test.ts`
- Create: `apps/web/src/components/exam/AccessGate.tsx`, `apps/web/test/exam/access.test.tsx`
- Modify: `apps/api/src/routes/run.ts`, `apps/api/src/app.ts` (four `ROUTE_BUDGETS` and four `ROUTE_AUTH` lines), `apps/api/src/auth/oidc.ts` (branch the callback), `apps/web/src/routes/exam.tsx`

**Interfaces:**
- Consumes: `resolvePublishedTest` (Task 1) · `insertAuthToken(db, { tokenHash, kind, payload, now, expiresAt })`, `consumeAuthToken(db, tokenHash, kind, now): Promise<unknown>` (`packages/db/src/repo/identity.ts`) · `randomToken(): string`, `sha256Hex(value): Promise<string>` (`apps/api/src/auth/tokens.ts`) · `EmailAdapter` (`apps/api/src/email/adapter.ts`) · `deps.http`, `deps.now` · `TestAccess`, `AccessMode` (`@pariksha/core`; **Phase 5** interface row 6).
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
| `invite_only` | `consumeAuthToken(hash, "run_invite", now)` | Replaying one candidate's personal link; two tabs racing it | Two concurrent redemptions: exactly one 200, one 410, one candidate row |
| `email_code` | 6 digits, 10-minute expiry, stored only as `sha256(testVersionId:email:code)` | Reading codes out of a database dump; guessing by volume | No 6-digit string appears in an `auth_token` dump; the 6th wrong code for an address is refused |
| `sso` | The organiser OIDC flow's discovery, PKCE and ID-token verification, branched at the end | A candidate outside `allow_email_domains`; an unverified `email` claim | A token with no `email_verified` is refused unless the provider is configured for it; an outside address is refused with the rule named |

**`sso` creates no user row and issues no session cookie.** `apps/api/src/auth/oidc.ts` already performs discovery, PKCE S256, the token exchange and ID-token verification over the injectable `deps.http`; the candidate callback reuses all of it and branches where the organiser flow calls `createUser` and `issueSession`, minting a `run_entry` token with the verified email instead ([ADR 0005](../../adr/0005-organiser-auth-before-the-candidate-runtime.md): "Nothing in this decision gives a candidate a user row").

**The allowlists are checked before the mode's own gate** (`docs/test-format.md:72`, `T-21`), so an off-network candidate never learns whether their code was right. A request carrying no client-IP header at all, on a test that sets `allow_ip_ranges`, is refused rather than allowed — failing open on an allowlist is the whole of the bug.

**`C-02`'s errors say what to do next.** Codes: `invite_used` ("This invite link was already used. Contact the organiser." — the PRD's own wording), `code_wrong`, `code_expired`, `domain_not_allowed`, `ip_not_allowed`, `window_closed`, `too_many_attempts`.

| Method | Path | Authority | `ROUTE_BUDGETS` |
| --- | --- | --- | --- |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/access` | `public` | `MEASURE` |
| `POST` | `/api/v1/run/:workspaceSlug/:testSlug/email-code` | `public` | `MEASURE` (the email send is not a D1 or R2 call) |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/sso/start` | `public` | `MEASURE` |
| `GET` | `/api/v1/run/:workspaceSlug/:testSlug/sso/callback` | `public` | `MEASURE` |

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

it("invite_only: a link works once; the second redemption is 410 and names the next step", async () => {
  const link = await mintInvite(ver, "row-7");
  expect((await redeem(link)).status).toBe(200);
  const again = await redeem(link);
  expect(again.status).toBe(410);
  expect((await again.json()).error.message).toMatch(/already used.*organiser/i);
});

it("invite_only: two concurrent redemptions produce exactly one entry token", async () => {
  const link = await mintInvite(ver, "row-7");
  const [a, b] = await Promise.all([redeem(link), redeem(link)]);
  expect([a.status, b.status].sort()).toEqual([200, 410]);
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

One handler, one `switch` on `access.mode`, with the allowlists checked before the switch. `ipInRanges` parses v4 into a 32-bit integer and v6 into two `BigInt` halves and masks — written here rather than taken from a dependency because the Worker bundle is size-constrained and the input is two well-defined notations. The email-code row's key is `sha256Hex(`${testVersionId}:${email.toLowerCase()}:${code}`)`, so the row is a lookup key and never a plaintext secret. The `sso` callback imports from `apps/api/src/auth/oidc.ts` and diverges only at the final step.

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
- Create: `apps/api/src/run/ratelimit.ts`, `apps/api/src/run/captcha.ts`, `apps/api/test/run/ratelimit.test.ts`, `apps/api/test/run/captcha.test.ts`
- Create: `docs/adr/00NN-bot-protection-narrows-the-no-third-party-script-rule.md` (**the next free number at execution time**) — **only if** the escalation below is resolved in favour of a hosted captcha
- Modify: `packages/db/src/schema/columns.ts` (`rate_limit`), `packages/db/src/repo/run.ts`, `apps/api/src/env.ts`, `apps/api/src/routes/run.ts`, `apps/api/src/middleware/security.ts` **and** `apps/web/public/_headers` (together, or not at all), `apps/web/test/hosting.test.ts`, `docs/adr/README.md`

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

  // apps/api/src/run/captcha.ts
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
| A headless browser farm registers at human speed, under every limit | A captcha on registration (`S-07`) — **escalated** | `verifyCaptcha` is called with the submitted token and a failed verification is 403 |

**Limits are per attempt and per test, never per IP** — `S-07` and `docs/test-format.md:74`: "a whole campus often shares one."

**The bucket store is a D1 table, not KV and not a Durable Object.** One `INSERT … ON CONFLICT DO UPDATE` is a single statement, one subrequest, portable to SQLite and Postgres, and testable in memory; the alternatives are Cloudflare-only, which ADR 0002's adapter rule rules out for the reference path. Buckets apply to the expensive, abusable routes (access, email-code, register, start, submit, result-code) and **not** to the answer save: a save is already bounded by a live attempt token and a server deadline, and a counter write would double the hottest path against the PRD's "one D1 write" line for no attack it stops. `ponytail:` a `DELETE FROM rate_limit WHERE window_start < ?` sweep belongs beside Phase 8's retention job; until then the table grows one row per bucket per window.

**Bot protection is escalated, not decided.** `S-07` names Turnstile or hCaptcha; `S-11` forbids third-party scripts; `apps/api/src/middleware/security.ts:17` is `script-src 'self'`; `apps/web/test/hosting.test.ts:25` asserts `_headers` contains no `https?://` at all. Two PRD clauses of equal precedence contradict each other and a committed test enforces one of them — see [Escalated](#escalated--needs-a-human-decision). **What this task builds either way** is the seam: `captchaRequired()` reads `access.captcha`, `verifyCaptcha()` posts to a configured `CAPTCHA_VERIFY_URL` with `CAPTCHA_SECRET` over `deps.http`, and **returns true when nothing is configured**, because `AC-01` promises a working deployment in thirty minutes "using no paid service". The browser half and the CSP change land only once the escalation is answered; the rate limits ship regardless and are the control that is enforceable today.

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
// apps/api/test/run/captcha.test.ts
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
```

```ts
// apps/web/test/hosting.test.ts (extended) — S-11's guard, kept honest
const ALLOWED_THIRD_PARTY_ORIGINS: string[] = [];   // widened only by the bot-protection ADR

it("S-11: the CSP names no third-party origin unless an ADR says which one", () =>
  expect(headers.match(/https?:\/\/[^\s;]+/g) ?? []).toEqual(ALLOWED_THIRD_PARTY_ORIGINS));

it("the API's headers and _headers still agree byte for byte", () =>
  expect(cspOf(headers)).toBe(SECURITY_HEADERS["Content-Security-Policy"]));
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run apps/api/test/run/ratelimit.test.ts apps/api/test/run/captcha.test.ts apps/web/test/hosting.test.ts` — FAIL.

- [ ] **Step 3: Implement `rate_limit`, `takeRateToken`, `limitOrThrow` and the captcha seam**

`rate_limit(workspace_id, bucket, window_start, count)` with `UNIQUE (workspace_id, bucket)`. `takeRateToken` must roll the window and increment in the *same* statement, or two concurrent requests both read a stale count:

```sql
INSERT INTO rate_limit (id, workspace_id, bucket, window_start, count) VALUES (?, ?, ?, ?, 1)
ON CONFLICT (workspace_id, bucket) DO UPDATE SET
  count        = CASE WHEN rate_limit.window_start <= ? THEN 1 ELSE rate_limit.count + 1 END,
  window_start = CASE WHEN rate_limit.window_start <= ? THEN ? ELSE rate_limit.window_start END
RETURNING count, window_start
```

**Do not touch the CSP in this step** — the two header files change together, in whichever direction the escalation is answered.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db apps/api apps/web`
Expected: PASS, with every Task 2 and 3 budget re-measured — a route that gained a limiter gained exactly one subrequest.

- [ ] **Step 5: Commit**

```bash
git add packages/db apps/api apps/web
git commit -s -m "feat(run): per-test and per-attempt rate limits and the captcha seam"
```

---
