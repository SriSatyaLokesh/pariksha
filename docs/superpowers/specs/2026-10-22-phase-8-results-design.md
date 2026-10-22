# Phase 8 — results, monitoring, grading and data lifecycle: the design

- **Date:** 2026-10-22
- **Status:** awaiting approval
- **Milestone:** Phase 8 — [#39](https://github.com/SriSatyaLokesh/pariksha/issues/39), tasks #89–#102
- **Also owned here:** [#209](https://github.com/SriSatyaLokesh/pariksha/issues/209) (the microphone),
  [#84](https://github.com/SriSatyaLokesh/pariksha/issues/84) (face counting),
  [#87](https://github.com/SriSatyaLokesh/pariksha/issues/87) (`C-10`'s broadcast),
  [#186](https://github.com/SriSatyaLokesh/pariksha/issues/186) (`finish_message` has no reader),
  [#179](https://github.com/SriSatyaLokesh/pariksha/issues/179) (a test with no duration publishes)
- **PRD:** `R-01`–`R-11`, `S-05`, `S-13`, `S-14`, `D-03`, `AC-08`, `AC-24`, `AC-25`, `AC-27`, `AC-28`
- **Rulings:** `K1`–`K42`. **Guards:** `KG1`–`KG10`.

Rulings are numbered so a plan can cite one instead of re-arguing it. Each is written
`Ruling: <what> — <why> — <cost if wrong>`. Twelve were taken by the owner before or during this
document and are marked **(owner)**; the rest were taken here against the tree and are the owner's
to overturn on reading.

**Numbers record when a ruling was taken; position records what it is about.** `K35`–`K42` were
added after a builder's review of the first draft and sit in the sections they belong to, not at
the end — so `K37` is in §7.6 with the other webhook rulings, and `K40`/`K41` are in §9 because
they are about order. Cite the number; find it by subject.

---

## 1. Intent

Phase 6 made a candidate able to sit a test. Phase 7 made the product able to watch them.
**Nothing yet lets an organiser read what came back.** A test today finishes into a database and
stops: there is no results screen, no grading, no export, no analytics, no deletion, and no way for
another system to learn that anything happened.

Phase 8 is the other end of the product. It is also the phase the **pilot gate** runs against —
PRD `G1`: one real test, 300 or more candidates, zero lost answers, and a results CSV that matches
hand-scoring. Every ruling below that trades completeness for cost is making that trade in service
of a test that has to survive 300 people on a free plan.

### Why this is one phase and not three

Grading, exports, analytics, retention, webhooks and the monitor look separable, and five of the
six are. They share one thing that makes splitting them expensive: **they all read the same
aggregate over `response`, `event`, `snapshot` and `attempt`, under the same 50-subrequest
ceiling.** Writing that read six times is how six surfaces end up disagreeing about what a score
is — exactly the defect `snapshotCost` was extracted to end in 7b, where the same arithmetic was
found duplicated and *independently wrong* on two surfaces at once.

So the phase front-loads the shared reads into one plan and everything else consumes them.

## 2. Goals

- **G1** An organiser can watch a live test and act on what they see.
- **G2** A manual question can be graded, blind or by question, and the score it produces is the
  same arithmetic the automatic path uses.
- **G3** Results leave the product as files a human opens in Excel and a machine reads over HTTP.
- **G4** The product can tell an organiser whether their test was any good — per question, per set,
  per cohort.
- **G5** Data dies on a schedule, and a named candidate can be erased on request.
- **G6** The zero-cost promise fails **loudly**, and early: an organiser sees what a control costs
  **at the moment they turn it on**, and sees the running total before they publish — rather than
  discovering either from Cloudflare. On a deployment that is not Cloudflare, the product says
  nothing about cost, because it is not ours to estimate.

## 3. Non-goals

- **Realtime.** No WebSockets, no Server-Sent Events, no Durable Objects. The monitor refreshes on a
  timer and the candidate hears from the server only when it was already going to talk to it.
- **A reporting builder.** `R-06` and `R-07` name a fixed set of figures. They are the whole of it.
  No custom query, no saved view, no scheduled report.
- **Grading by anyone but a human.** `R-04` is a queue, not a model. Phase 9 owns BYOK AI, and
  nothing here touches a provider.
- **Multi-workspace anything.** Every read, every export and every key is scoped to one workspace,
  as every table already is.

## 4. Anti-goals — what would make this a failure even if it worked

- **A results figure that disagrees with another results figure.** One scoring path, one counted
  figure, one cost function. A CSV total that differs from the screen total is worse than no CSV.
- **A surface that lies about coverage.** A monitor column saying a candidate is fine when the
  product has no idea; a snapshot timeline implying continuous observation across a gap 7d
  deliberately left empty; an item analysis whose "average time" is a number nobody measured.
- **An export that quietly drops rows.** A CSV that truncates at the subrequest ceiling and still
  returns 200 is a lost-answers bug wearing a results hat — on the phase gated by "zero lost
  answers".
- **A deletion that does not delete.** `S-14` is a legal promise. An erased candidate whose email
  survives in a `candidate_unique` hash row, an R2 object, or an un-swept event is a breach, not a
  defect.
- **A feature that costs the free tier its promise.** Any design adding a per-candidate periodic
  request is measured against 300 candidates × test duration before it ships.

---

## 5. The pre-flight — what the tree already has

**Read this section before writing or running any plan.** Seven of 7a's planned helpers did not
exist when its execution began; the hour spent finding that out was the cheapest in the phase.
This is that hour, spent in advance. Every line below was verified against `main` at `243ba07`.

### Already built — a plan that re-creates any of these costs a task

| thing | where | what it means for Phase 8 |
| --- | --- | --- |
| `review` table | `0000`, `schema/columns.ts:471` | `attempt_id`, `reviewer`, `verdict`, `note`, `at`. **`P8.5` needs no migration.** |
| `webhook` table | `0000`, `:514` | `url`, `events_json`, `signing_secret`, `active`. Config exists; **delivery does not.** |
| `api_key` table | `0000`, `:499` | `name`, `secret_hash`, `scopes_json`, `last_used_at`, `revoked_at`, unique on the hash. `P8.12` needs no migration. |
| `audit_log` + `appendAudit` / `listAudit` | `repo/audit.ts` | Every `R-02` action and every `S-13`/`S-14` deletion logs through this. Already scoped. |
| `sweepRateLimits(db, before)` | `repo/rate-limit.ts:70` | **Already written.** Phase 6 deferred "no `rate_limit` row expiry until Phase 8" — only the caller is missing. |
| `StorageAdapter.delete(keys[])` | `storage/adapter.ts:16` | *"Batched: one call for many keys, never one call per key."* Snapshot expiry is **one** subrequest. |
| The nightly cron | `deploy/cloudflare/wrangler.toml` | `crons = ["17 3 * * *"]`, already committed, with a comment reading *"Declared now, handled in Phase 8"*. **No `scheduled` export exists yet.** |
| `scoreAttempt({ awards })` | `core/src/score.ts:43` | Already takes rubric awards and already reports `pending`. `submit.ts:319` passes `{}` with the comment *"Phase 8 owns rubric awards"*. |
| `response.points` / `response.graded_by` | `0000`, `:424` | The grading queue's storage. Nullable, present, unwritten. |
| `snapshot.face_count` | `0000`, `:457` | Nullable. 7a fixed the rule that `null` means "not counted" and `0` means "counted, nobody there". |
| `attempt.integrity_flag` / `.observed` | `0008` | Written by 7e. `IntegrityFlag = "clean" \| "review" \| "high_risk"`. |
| `countViolations` | `repo/attempts.ts:448` | The server-authoritative count 7c already serves to candidates. |
| `deriveState` + `POST …/close` | `@pariksha/db`, `routes/tests.ts` | The `test.closed` webhook has a trigger point already. |
| `readDelimitedRows` / `readDelimited` | `import/rows.ts` | A CSV **reader**. There is **no writer** anywhere in the repo. |
| Six unused permissions | `core/src/permissions.ts` | `attempts.monitor`, `attempts.read_evidence`, `attempts.grade`, `results.export`, `candidates.delete`, `keys.manage` have **zero production callers** — only `permissions.test.ts`. Phase 8 is where six of thirteen are wired for the first time. |
| `snapshotCost()` + `SNAPSHOT_KB` / `KB_PER_MB` | `core/src/proctoring.ts:239` | Returns per-candidate `{ images, megabytes, uploads }`, already read by the builder panel and the publish checklist. **`K35`'s estimator composes this; it does not replace it.** Its own comment carries the rule the whole cost surface follows: *"requests, not bytes, are the ceiling that actually stops a test."* |
| `AppEnv.target` | `apps/api/src/env.ts:121` | `"workers" \| "node"`. The deployment distinction `K36` needs **already exists** — Docker is `node`. No new configuration, no new flag. |

### Deliberately absent — a plan must not assume otherwise

- **`retention` is in `schemas/test-1.json` and is not modelled in `Test`.** `core/src/types.ts:192`
  says so explicitly: *"`retention` is in the schema but no rule in this package reads it, so it is
  not modelled here yet. Add it when a phase needs it."* This is that phase.
- **There is no per-question time anywhere.** `grep -rn "time_ms|timeOnQuestion|dwell|time_spent"`
  over `apps/` and `packages/*/src` returns nothing.
- **There is no heartbeat.** `Clock.tsx` ticks locally on a 1 s `setInterval` and makes no request.
  The only candidate→server traffic is an answer save, an event flush, and a snapshot POST.
- **The event queue does not flush when empty.** `proctoring-queue.ts:91` —
  `while (!stopped && (buffer.length > 0 || owesGap))`. An idle candidate's 5 s tick sends nothing.
- **There is no organiser-side attempt read of any kind.** `repo/attempts.ts` has no `listAttempts`.
  7e creates the first two organiser attempt routes; `main` has none.
- **`ROUTE_AUTH` has five authorities** — `public`, `entry`, `attempt`, `actor`, `workspace`.
- **`ADR 0007`'s "review panel" is not this phase's.** It is `test_comment` on a **draft test**
  (`UX-10`, authoring review), explicitly deferred there, and it needs its own table and its own
  `tests.comment` permission. The `review` table is free for `P8.5`'s verdicts. Do not conflate them.

### Two places the written record is behind the code

- **`docs/PRD.md:568` says *"Interval snapshots get no database row."*** Phase 7's `Q4f` ruled the
  opposite — *"the row exists if and only if the object does"* — and shipped it. The PRD sentence is
  stale, and the retention job, the review timeline and `K12` all depend on rows existing.
- **The same line says the snapshot upload *"doubles as the 60 s heartbeat."*** True only under
  Strict: `PROCTORING_DEFAULTS.standard` resolves `snapshotIntervalSeconds: 0` and
  `requireCamera: false`. Under the default profile there is no upload and therefore no heartbeat.

Both are corrected by `K33`.

---

## 6. The four constraints that shape every ruling

Nothing below is new. They are collected because six of this phase's seven slices hit at least one,
and a plan that meets them late redesigns itself.

1. **50 subrequests per invocation** (`instrument.ts:16`, ADR 0002). Every D1 call, every R2 call
   and every outbound `fetch` is one; `db.batch()` is one regardless of statement count;
   `signedUrl` is deliberately **not** counted, because the adapter presigns locally and issues no
   request. The failure this catches is *"a query per item — correct at ten rows, over the ceiling
   at sixty, and invisible to every other test."* Phase 8 is the first phase whose every screen is a
   list of 300 things.
2. **10 ms CPU per invocation** (ADR 0002's own limits table). Waiting on D1 is not CPU time;
   computing a discrimination index over 300 × 60 cells is.
3. **One cron trigger, nightly.** `17 3 * * *`, already declared, with no handler.
4. **The candidate's browser never polls.** Adding one periodic request per live attempt costs
   `300 candidates × duration ÷ interval`. At 60 s over a 60-minute test that is **18,000 metered
   requests** against a free-plan budget of 100,000/day — one fifth of a day for one test.

---

## 7. Rulings

### 7.1 Scope — the three cuts and the one re-cut

**`K1` (owner) — on-device face counting (`#84`) is re-cut, and the column stays.**

> Ruling: `P-07`'s MediaPipe face counting does not ship in Phase 8. `snapshot.face_count` keeps its
> `null`-means-not-counted semantics, the disabled `face_check` control re-points from "Phase 8" to
> a fresh issue, and every Phase 8 surface reading the column treats `null` as "not counted" rather
> than "zero faces" — **why:** the blocker has not moved an inch. MediaPipe cannot instantiate
> WebAssembly without `'wasm-unsafe-eval'`, and `apps/web/test/hosting.test.ts`'s own comment still
> reads *"A design that needed a CSP change would be the wrong design."* Re-cutting costs a comment
> and an issue; relaxing the CSP weakens the script policy for every candidate in the product to buy
> one advisory signal — **cost if wrong:** `multi_face_snapshots` (7a's `PROCTORING_DEFAULTS`
> threshold, default 2) can never fire, so one of `Q6`'s three integrity thresholds is permanently
> inert. 7e must not treat its absence as a bug.

**`K2` (owner) — per-question time is cut from `R-07` and `R-09`, and filed.**

> Ruling: item analysis ships **share correct, discrimination index and option pick rates**. The
> per-answer CSV ships without a time column. Both omissions are stated on the surface itself, not
> only in a document, and one issue records the migration and runner change they need — **why:**
> nothing in the product has ever measured it. The only free derivation — the gap between
> consecutive `response.saved_at` values — measures the gap between *saves*, counts reading and
> idling as answering, and is simply absent for a question never saved. A plausible wrong number on
> an analytics screen is worse than an absent one, because nobody audits a number that looks
> reasonable — **cost if wrong:** `R-07` is three-quarters delivered. `AC-27` is unaffected; the
> results CSV never named time. The column is additive later.

**`K3` (owner) — the snapshot ZIP becomes a manifest of presigned URLs.**

> Ruling: `R-09`'s "ZIP of snapshots for selected candidates" ships as a **CSV manifest** — one row
> per snapshot carrying attempt, candidate, `taken_at`, `reason`, `face_count` and a presigned URL —
> plus a short documented one-liner (`curl`/`wget` over the URL column) for pulling them down.
> `R-09` and the roadmap row are reworded to say what ships — **why:** a server-built ZIP reads every
> object through the Worker, and one R2 `get` is one subrequest. A single Strict attempt at the 60 s
> default holds ~60 images, so **a ZIP of one attempt already exceeds the 50-subrequest ceiling**
> before a second candidate is selected. `signedUrl` is the one storage call `instrument.ts`
> deliberately does not count, so a manifest of any size costs the same as a manifest of one —
> **cost if wrong:** an organiser does two steps instead of one, and the URLs expire
> (`SIGNED_URL_TTL_SECONDS`, 600) so a manifest left overnight must be re-fetched. Both are stated
> on the download.

**`K4` — `SIGNED_URL_TTL_SECONDS` is not raised for the manifest.**

> Ruling: the manifest's URLs use the existing 600-second TTL — **why:** it is a shared constant
> governing every presigned URL in the product, and lengthening it to make one export more
> convenient lengthens the window on candidate media and identity photos too. Re-fetching a manifest
> is one request — **cost if wrong:** an organiser downloading 300 attempts' snapshots on a slow
> connection re-fetches the manifest partway through. The manifest states its expiry.

### 7.2 The shared ledger — one arithmetic, used everywhere

**`K5` — the scoring block in `submitAttempt` is extracted to `rescoreAttempt()` before anything grades.**

> Ruling: `apps/api/src/run/submit.ts:288–348` — `liveQuestions`, `blockedQuestions`, the
> `questionsBySection` build, `scoringOf`, the blocked-question nulling, the `scoreAttempt` call, the
> `pending` union and the throw-is-not-a-500 catch — becomes one exported function taking `awards`
> and returning `{ score, blocked }`. `submitAttempt` calls it with `{}`; the grading queue calls it
> with the reviewer's awards; `P8.8`'s regrade calls it with the awards already stored. **Phase 8
> adds no second place where an `AttemptScore` is produced** — **why:** three callers need identical,
> subtle behaviour. A blocked question must be nulled before grading or `scoring.mode: "negative"`
> takes marks off for the organiser's own broken regex; a throw must stamp the attempt rather than
> 500; `pending` must union the blocked ids. This is precisely the shape 7b's branch review found
> duplicated and independently wrong on two surfaces when `snapshotCost` lived in two files —
> **cost if wrong:** a grading path and a submit path that score the same attempt differently, which
> is the one defect `AC-27` is written to catch and the one the pilot gate measures by hand against
> ten attempts.

**`K6` — `countedScore()` is one function in `@pariksha/core`, and both sides read it.**

> Ruling: `T-14`'s `counted_attempt` (`highest` | `latest` | `average`) gains a pure function in
> `@pariksha/core` taking a candidate's attempt scores and the setting, returning the counted figure
> **and which attempt produced it**. The organiser's CSV, the analytics screen and the candidate's
> own result page all call it — **why:** `counted_attempt` has been settable, stored, exported and
> imported since Phase 5 and has had **no reader at all**; `TimingPanel.tsx:460` writes it and
> nothing computes it. The roadmap names this phase as owning the reconciliation. A second
> implementation on the candidate side is how the two disagree — **cost if wrong:** under `highest`
> or `average` the organiser's CSV and the candidate's receipt report different numbers for the same
> person, which is exactly the disagreement the roadmap's Phase 6 row left for this phase to close.

**`K7` — the candidate sees both figures, labelled, per-attempt first — and the counted figure obeys
the release gate and appears only once no attempts remain.**

> Ruling: where `counted_attempt` is not `latest`, the candidate's result page shows *this attempt's*
> score as the headline and the counted figure beneath it, each named ("This attempt: 72%" /
> "Counted for your result: 81%, your best of 3"). The counted line is governed by the **same**
> `release.show` and `release.when` as every other figure on that page, and is **suppressed entirely
> while the candidate has attempts remaining**. The organiser's CSV carries both as separate columns
> unconditionally — **why:** the candidate just sat *this* attempt and that is the number they came
> to see, so both deserve naming. But `apps/api/src/run/release.ts` already refused to read prior
> attempts here, deliberately and at length: doing so *"would add a subrequest to a route that needs
> none and would tell a candidate mid-series about their earlier attempts."* A counted figure shown
> under `show: score_only` with two attempts left discloses exactly the prior score that ruling
> withheld. Gating it costs the feature nothing — the counted figure is only *meaningful* once the
> series is over — **cost if wrong:** a candidate mid-series learns their earlier score, which
> changes how they sit the next attempt. The suppression is the mitigation and it is also the honest
> reading: a "best of 3" after one attempt is not a result. The budget note stands — the route reads
> prior attempts **only** on the last one, and that read is in its measured `ROUTE_BUDGETS` entry.

**`K8` — the CSV writer is one function in `@pariksha/core`, and it owns the BOM.**

> Ruling: a `toCsv(rows, columns)` in `@pariksha/core` producing RFC 4180 quoting and a UTF-8 BOM,
> with the `<slug>_<kind>_<YYYYMMDD-HHMM>.csv` filename helper beside it. All four of this phase's
> CSVs go through it. There is no second serialiser — **why:** `R-10` is a correctness requirement
> (`AC-27`: *"opens correctly in Excel with non-Latin names"*), and BOM-plus-quoting is exactly the
> kind of detail that is right in the file somebody tested and wrong in the other three. The repo
> already has one CSV **reader** (`import/rows.ts`) and this is its mirror — **cost if wrong:** one
> export opens as mojibake in Excel. Caught by a test asserting the leading bytes `EF BB BF` and a
> round-trip through `readDelimited`.

**`K38` — an export that does not fit in one invocation pages, and never truncates silently.**

> Ruling: every export route takes a cursor and returns one bounded page plus a `nextCursor`; the
> browser requests pages until there is none and appends them into one file through `toCsv`. A route
> that reaches its page bound **always** returns a cursor — there is no branch where a full-looking
> 200 is actually a partial file. The per-answer CSV (300 × 60 ≈ 18,000 rows) and the events CSV
> (unbounded) are the two that will page in practice — **why:** `K9` and `KG3` stop a route issuing
> a query per item; neither bounds **raw volume**, and a set-based read does not make one D1
> response arbitrarily large. This phase's own anti-goal is that *"an export that quietly drops rows
> is a lost-answers bug wearing a results hat"*, on the phase gated by zero lost answers. Paging is
> the only answer that is neither a cap nor a lie — **cost if wrong:** the browser makes several
> requests for one file and a download can fail partway. Pinned by a test that exports a
> 300-candidate fixture and asserts the row count of the assembled file equals the row count in the
> database — the one assertion that catches a silent truncation, and the reason the fixture is 300
> and not ten.

**`K9` — every Phase 8 list read is set-based, and its budget is measured, not estimated.**

> Ruling: no Phase 8 route issues a query per attempt, per candidate or per question. Each gets a
> `ROUTE_BUDGETS` entry **measured with `countingDeps`** against a fixture of **300 candidates**, not
> ten — **why:** `instrument.ts`'s own header names this failure exactly: *"a route that issues a
> query per item — correct at ten rows, over the ceiling at sixty, and invisible to every other
> test."* Every screen in this phase is a list of 300 things, and the pilot gate is 300 candidates —
> **cost if wrong:** the monitor and the results CSV work in development and fail on the one test the
> phase is gated on. A 300-row fixture is the only thing that can tell the difference.

### 7.3 One migration, numbered after 7e's

**`K10` — Phase 8 ships exactly one migration, and it is `0010`.**

> Ruling: one SQLite file and one Postgres sibling, adding the `webhook_delivery` table and two
> `attempt` columns (`K12`). Both dialects, plus `schema/columns.ts`'s `TABLE_MANIFEST` and a
> regenerated `migrations.generated.ts`, plus `worker.test.ts`'s hard-coded filename list and
> `migrations: N` count. It is numbered **`0010`** because **7e adds `0009_attempt_lock.sql`**
> (handoff-3, `E-R1`), and the plan that ships it declares that dependency in its own header —
> **why:** 7a's precedent. One plan owns the migration for the whole phase so no later plan has to
> renumber under a parallel branch, and a migration is five files, not two. Numbering around 7e
> rather than waiting for it is what lets the independent slices run while 7e is still in flight —
> **cost if wrong:** two branches both claim `0010`. **The guard is weaker than it looks and the
> plan must know which one it is:** `migrations-bundle.test.ts` does **not** catch this — it asserts
> only that the committed bundle equals the generator's output and that the bundled names match the
> sorted `.sql` files on disk, so two branches each adding a differently-named `0010_*.sql` both
> pass. The real guard is `apps/api/test/worker.test.ts`'s hard-coded filename list and
> `migrations: N` count, and **that file runs only under `apps/api`'s second vitest config**
> (`vitest.workers.config.ts`), so a focused run stays green while the branch is red. 8a's plan says
> this in its own verification steps. If 7e is abandoned, `0010` renumbers in one commit.

**`K42` — `0010` also adds the index by-question grading and item analysis both need.**

> Ruling: the migration adds an index on `response(workspace_id, question_id)` alongside
> `webhook_delivery` and the two `attempt` columns — **why:** `response` is indexed on
> `workspace_id` and `attempt_id`, and its unique constraint is `(attempt_id, question_id)`, whose
> **leading** column is `attempt_id`. `R-04`'s "grading by question across all candidates" and
> `R-07`'s option pick rates both filter by `question_id` across a whole test, and neither is served
> by any existing index. Pre-empting it here is what keeps `K10`'s one-migration rule honest:
> otherwise 8b or 8c measures its budget, discovers it needs schema, and has to claim `0011` from
> inside a plan running in parallel with two others — the exact renumbering `K10` exists to prevent
> — **cost if wrong:** one unused index on a table that is written once per answer and read by every
> results surface. Cheap in the direction that matters. If 8b or 8c still finds it needs schema, that
> is a stop-and-ask, not a quiet `0011`.

**`K11` (owner) — the monitor derives "last contact" and renames the column.**

> Ruling: `R-01`'s "last heartbeat" ships as **last contact** —
> `max(response.saved_at, event.server_ts, snapshot.taken_at)` per attempt, served as `null` and
> rendered as `—` when there is none. `R-02`'s "inactive more than 2 minutes" filter ships, and the
> monitor states on the surface which profiles produce a usable signal — **why:** there is nothing to
> read. `PROCTORING_DEFAULTS.standard` resolves `snapshotIntervalSeconds: 0` and
> `requireCamera: false`, `Clock.tsx` ticks locally, and `proctoring-queue.ts:91` does not flush an
> empty buffer — so a Standard candidate reading a long passage contacts the server **never**. A
> dedicated ping is constraint 4's arithmetic: 18,000 requests for one test, to fill one column —
> **cost if wrong:** under Off and a quiet Standard attempt the filter reports honest candidates as
> inactive. The copy beside it is what stops a proctor acting on that, and it is the whole mitigation.

**`K12` — the broadcast is two nullable columns on `attempt`, and it rides existing responses.**

> Ruling: `0010` adds `attempt.proctor_message` (text, null) and `attempt.proctor_message_at`
> (timestamp, null). A proctor action sets both; the **existing** candidate→server routes —
> `POST /run/attempt/events`, `PUT /run/attempt/answer` and 7d's snapshot POST — each carry
> `{ message, messageAt }` on their response when one is pending; the client shows the banner and
> dedupes on `messageAt`. **No new route, no new request, no poll** — **why:** `#87` needs to reach a
> browser that never asks, and free-plan Workers have no WebSocket without a paid Durable Object. The
> events route **already** returns `{ violations, limit, action }` and the client already consumes
> it, so the channel exists; one field joins it. Riding all three routes rather than events alone is
> what makes it work for a candidate who is answering but not violating — **cost if wrong:** a
> candidate who has done nothing at all for ten minutes has not received the message, and the proctor
> cannot tell from the banner. They can tell from `K11`'s last-contact column, which is the same
> signal in the same table — the two features cover each other, and that is the design, not a
> coincidence.

**`K39` (owner) — "reset an attempt" mints a new attempt and keeps the old one.**

> Ruling: `R-02`'s reset creates a **fresh attempt** for the same candidate against the same pinned
> test version, leaves the previous attempt and all of its responses intact, and writes one audit
> row naming both attempt ids. It deletes nothing. The organiser's confirmation says plainly that
> the earlier attempt is kept and remains visible — **why:** the action is undefined in the PRD, the
> roadmap and every ADR, and it is the only destructive organiser action in a phase gated on *"zero
> lost answers"*. Both other readings lose candidate work to one misclick on a 300-person test. The
> machinery already exists: a candidate may already hold several attempts, and `countedScore`
> (`K6`) already decides which one counts — so "let them start again" is delivered by the path the
> product already has, rather than by a new destructive one — **cost if wrong:** a reset leaves two
> attempt rows where an organiser expected one, and under `counted_attempt: "highest"` an abandoned
> first attempt cannot drag a candidate's result down, only up. If a true erase is ever wanted it is
> a separate, named, confirmed action — and `S-14`'s candidate deletion (`K29`) already exists for
> the case that genuinely needs data gone.

**`K13` — the message is a single slot, overwritten, and cleared on delivery.**

> Ruling: one pending message per attempt. Sending a second replaces the first. The route that
> delivers it clears both columns in the same statement it is already issuing — **why:** `C-10` is
> *"a proctor message appears as a banner"*, singular. A queue of messages needs a table, an order, a
> read-receipt and a UI for all three, to deliver a feature whose realistic use is "your camera has
> gone dark, please fix it." The audit row is the permanent record of what was sent — **cost if
> wrong:** a proctor sending two messages four seconds apart loses the first. The send UI says the
> message replaces any undelivered one.

### 7.4 Grading and verdicts

**`K14` — grading writes `response.points` and `response.graded_by`, then rescores through `K5`.**

> Ruling: an award is stored on the response row and the attempt is immediately rescored through
> `rescoreAttempt`, writing a fresh `score_json`. There is no separate awards store and no deferred
> rescore — **why:** the columns exist for this, `scoreAttempt` already consumes awards and already
> reports `pending`, and a stored score that lags its awards is a results figure that is wrong until
> something else runs. Rescoring on write costs one extra call on an action a human performs at human
> speed — **cost if wrong:** grading a 60-question attempt rescores 60 times. Measured against the
> budget; if it bites, the by-question flow batches a section's awards into one rescore, which is a
> change inside the route.

**`K15` — blind grading hides identity in the payload, not in the browser.**

> Ruling: the blind grading route omits every candidate-identifying field from the response body. The
> browser is never sent a name it is trusted not to render — **why:** `R-04`'s blind grading exists so
> a grader cannot be influenced, and CSS that hides a name still ships the name to a machine the
> grader controls. This is the same reasoning `scrub.ts` applies on the candidate side, and the same
> allowlist shape — **cost if wrong:** a grader who wants the name opens devtools and the feature was
> decoration. Pinned by a test asserting the serialised body carries no `form_values` key at all.

**`K16` — a verdict is a row, not a column, and the latest one wins.**

> Ruling: `P8.5` inserts into the existing `review` table. An attempt may carry several verdicts over
> time; every read and every export takes the one with the greatest `at`, and the full history stays
> — **why:** the table already has no unique constraint on `attempt_id` and already carries `reviewer`
> and `at`, which is an append-only shape and the right one for a judgement a second reviewer may
> overturn. Collapsing to one row per attempt discards who changed their mind and when — **cost if
> wrong:** a results CSV on an attempt reviewed twice in the same millisecond is non-deterministic.
> Ordered by `(at, id)` so it is not.

**`K17` — `P8.8`'s regrade is scoped to a test version and writes exactly one audit entry.**

> Ruling: Regrade runs over every submitted attempt of one test version, calls `rescoreAttempt` per
> attempt, and writes **one** `audit_log` row naming the version, the count rescored and the count
> whose total changed — **why:** `AC-08` says *"updates every affected attempt's score and writes one
> audit entry"*, singular, and one row per attempt would bury the event under 300 of them — **cost if
> wrong:** which specific attempts moved is not in the audit log. The count is, and the scores
> themselves are the record.

**`K18` — regrade runs on the cron, not in the request.**

> Ruling: the Regrade button enqueues; the frequent cron (`K22`) drains it, rescoring a bounded batch
> per tick, and the screen shows progress. It does not rescore 300 attempts inside one HTTP request —
> **why:** constraints 1 and 2. 300 attempts is at minimum 300 D1 reads and 300 writes, six times the
> subrequest ceiling and far past 10 ms of grading arithmetic. The drain already exists for webhooks
> and takes a second job for free — **cost if wrong:** a regrade is not instant. The screen says so
> and names the batch size.

### 7.5 Analytics

**`K19` — every `R-06` and `R-07` figure is computed in SQL aggregate or in one pass over one fetched set.**

> Ruling: counts, mean, pass rate, completion rate and integrity-flag counts are `GROUP BY`
> aggregates — one query each, or one query for all. The distribution, the per-set comparison, the
> discrimination index and option pick rates are computed in a **single pass** over one fetch of the
> response set. Never per question and never per candidate. Measured against 300 candidates × 60
> questions — **why:** `K9`, plus constraint 2: a discrimination index over top and bottom 27% is a
> sort and two means, cheap *once* and sixty sorts if written per question — **cost if wrong:** the
> analytics screen is the one that times out on the pilot test, where it is most wanted.

**`K20` — the discrimination index states its own `n`, and is withheld below it.**

> Ruling: the index is shown only where the cohort has at least **10** submitted attempts, and the
> screen names the cohort size beside it. Below that the cell reads "too few attempts" — **why:** top
> and bottom 27% over 6 candidates is two people against two people, and a number computed from that
> is noise presented as a measurement. `R-07` exists so an organiser can find a bad distractor; a
> confident wrong index sends them to rewrite a fine question — **cost if wrong:** a small genuine
> pilot sees no index. The cohort size is on screen, so they know why.

**`K21` — `D7c`'s readiness meter is one aggregate route, and the test list calls it once.**

> Ruling: a single route returns readiness for **every** test in the workspace in one response; the
> test list renders from it. It is **not** one `GET …/checklist` per row — **why:** `tests.tsx:74` is
> explicit: *"NO READINESS METER, deliberately (`D7c`): this route loads version heads, not draft
> bodies, so a real '5 / 7' would be one `GET …/checklist` per row. The meter lives in the builder
> until Phase 8 adds an aggregate, and `test-list.test.tsx` guards both the absence and the call
> budget."* That guard is a contract with this phase — **cost if wrong:** `test-list.test.tsx` fails
> on the call budget, which is the guard working.

### 7.6 Webhooks, keys and the scheduled handler

**`K22` (owner) — delivery is a table drained by a second, frequent cron.**

> Ruling: `0010` adds `webhook_delivery` (`webhook_id`, `event`, `payload_json`, `attempt_count`,
> `next_attempt_at`, `last_status`, `last_error`, `delivered_at`, `created_at`). The triggering
> request attempts delivery **inline** once; on failure it writes a row. `wrangler.toml` gains a
> second cron entry draining it with exponential backoff out to 24 hours — **why:** `AC-28` wants the
> signature at the endpoint *"within 10 s"*, which only an inline first attempt meets, and `D-03`
> wants retries *"with backoff up to 24 hours"*, which the one nightly cron cannot express. Free-plan
> Workers have neither Queues nor Durable Object alarms — **cost if wrong:** a second cron entry is
> 288 invocations a day of a handler that usually finds nothing and exits. Measured, and stated in
> the free-tier dashboard `P8.14` builds — the right place for it to show up.

**`K37` — all four `D-03` events ship, and only `attempt.submitted` delivers inline.**

> Ruling: `attempt.started`, `attempt.submitted`, `attempt.flagged` and `test.closed` all ship.
> **`attempt.submitted` is the only one that attempts delivery inline** (`K23`); the other three
> write a `webhook_delivery` row and the drain sends it on the next tick. `attempt.flagged` fires
> from 7e's integrity recompute, so 8d ships its delivery path and its trigger lands with 8g —
> **why:** `AC-28` names a 10-second bound for `attempt.submitted` alone, and that is the only event
> an organiser watches live. `attempt.started` fires on attempt creation, which is a **candidate hot
> path** — an inline outbound `fetch` there is one more subrequest and one more failure mode on the
> 300-times-per-test route the pilot gate measures, to save a receiver five minutes of latency on an
> event nobody waits for. `K23`'s fail-open argument justified the risk for submit; it does not
> generalise — **cost if wrong:** three of four events arrive up to one drain tick late. The drain
> interval is stated in the webhook UI, so a receiver knows what it is subscribing to.

**`K23` — the inline first attempt never fails the request that triggered it.**

> Ruling: a webhook delivery attempted during `attempt.submitted` is wrapped so that a timeout, a 500
> or a DNS failure writes a `webhook_delivery` row and nothing else. The candidate's submission
> succeeds — **why:** this is `Q2`'s fail-open rule applied one layer out. A candidate's result must
> not depend on an organiser's ATS being up, and an outbound `fetch` is one subrequest against the
> submit route's budget whether it succeeds or not — **cost if wrong:** the submit route's measured
> budget must include the fetch. It does, and `budget.test.ts` checks it.

**`K24` — the HMAC signs the exact bytes sent, with a timestamp inside the signed string.**

> Ruling: `X-Pariksha-Signature: t=<unix>,v1=<hex>`, where `v1` is HMAC-SHA256 over
> `"<t>.<raw body>"` using `webhook.signing_secret`. The receiver recomputes over the raw body it
> received — **why:** signing a re-serialised object rather than the bytes on the wire is how a
> signature verifies on the sender and fails on the receiver; including `t` inside the signed string
> is what makes a replay window enforceable rather than advisory — **cost if wrong:** every
> receiver's verification fails and the feature is unusable. Pinned by a test that signs, sends
> through the real route, and verifies with an independently written verifier.

**`K25` — an API key is a second way to satisfy the `workspace` authority, not a sixth authority.**

> Ruling: `ROUTE_AUTH` keeps its five values. A `Bearer pk_…` on a `workspace` route resolves to a
> workspace and a scope set, and the **same** `can()` check against the **same** `ROUTE_ACTIONS`
> entry admits or refuses it. A key is admitted on any `workspace` route whose action is in its
> scopes — **why:** `S-05` describes exactly this ("scoped to one workspace and a set of
> permissions"), the matrix is already pure data with no request context in it, and inventing a sixth
> authority would mean a second authorisation path to keep in step with the first — the shape
> `permissions.ts`'s own header exists to avoid — **cost if wrong:** if keys later need a route no
> session may reach, that route needs its own authority. Nothing in `R-11` wants one.

**`K26` — a key may never hold `keys.manage` or `members.manage`.**

> Ruling: those two actions are refused at key **creation**, not merely at use. A key cannot mint a
> key and cannot change who is in the workspace — **why:** a leaked key that can mint keys is not
> revocable by revoking it, and one that can add a member is a persistence mechanism. Every other
> action is recoverable by revoking the key — **cost if wrong:** an organiser automating member
> provisioning cannot. Nobody has asked, and `R-11`'s use cases are all reads.

**`K27` — the `scheduled` export is a registry, shipped empty and tested, in the first plan.**

> Ruling: the foundations plan adds `scheduled` to `apps/api/src/index.ts` as a dispatcher over a
> named job list, with a test that an unknown cron expression is a no-op and a known one runs its
> jobs. It ships registering **nothing**. The webhook drain, the retention sweep, the `rate_limit`
> sweep and the regrade drain each register one job in their own plan — **why:** four later jobs need
> the handler and three of them are in plans that can run in parallel. Whichever shipped it first
> would own a file the other three edit — **cost if wrong:** one file with a registry in it that
> holds one job if three slices get cut. Twenty lines.

### 7.7 Retention, deletion and the free-tier meter

**`K28` — `TestRetention` is modelled in `@pariksha/core`, with the PRD's defaults, and gets a control in the existing Results panel.**

> Ruling: `types.ts` gains `retention?: { personal_data_days?: number; snapshots_days?: number }` and
> a resolver applying `S-13`'s defaults (**snapshots 90 days, personal data and answers 12 months**).
> The two numbers join the **existing** `results` setting row — **not** a seventh panel — **why:**
> `types.ts:192` says to model it when a phase needs it, and `PANEL_KEYS` has six entries that each
> answer a question an organiser asks ("what happens at the end" is the results panel's question, and
> deletion is the last thing that happens). A seventh row for two integers costs a row of `AG1`'s
> density budget to say nothing new — **cost if wrong:** two fields sit in a panel someone expected
> elsewhere. One line of `PANEL_KEYS` to move.

**`K29` — deleting a candidate blanks the row rather than removing it, and sweeps every table that holds their data.**

> Ruling: `S-14` deletion overwrites `candidate.form_values_json` to `{}`, nulls `external_id`,
> deletes that candidate's `candidate_unique` rows, deletes their `response` values, `event` rows and
> `snapshot` rows **and the R2 objects those name**, and keeps `attempt` with its `score_json` when
> the organiser chose to keep an anonymised score. One `audit_log` row records it. A blanked candidate
> is recognisable by a null `external_id` with empty form values — **why:** a hard delete of
> `candidate` orphans every `attempt` row `S-14` explicitly allows to survive, and `candidate_unique`
> holds a **SHA-256 of the candidate's email** (`columns.ts:337`) which is personal data a `candidate`
> delete would not touch — the exact leak `S-14` is written against. No migration, because a blanked
> row is detectable from its own columns — **cost if wrong:** a deleted candidate occupies a row. If a
> count ever needs to exclude them, the detection rule is one predicate in one place.

**`K30` — the retention job deletes in batches bounded by the subrequest ceiling, and resumes.**

> Ruling: each nightly job processes a bounded batch and leaves the rest for the next tick, logging
> what it did. It never attempts "everything expired" in one invocation — **why:** `delete(keys[])`
> is batched at one subrequest, but the D1 reads that find the expired rows are not, and the first
> run after a 300-candidate pilot has a lot of rows. A job that exceeds the ceiling fails silently
> every night — **cost if wrong:** a large backlog clears over several nights. `AC-24` asks that
> expired data is deleted and logged, not that it happens in one tick.

**`K31` (owner) — the free-tier meter projects from rows we own, and says so.**

> Ruling: `P8.14` computes projected daily usage from `attempt`, `snapshot` and `event` counts times
> their known per-unit request cost, plus the declared `ROUTE_BUDGETS` figures. It warns at 70%. It
> is labelled an estimate on the surface. No Cloudflare API token, no outbound call, no per-request
> counter — **why:** the Worker cannot read its own billed request count; that lives in Cloudflare's
> analytics. Querying it needs a new secret and an outbound fetch, and works on exactly one of the
> product's two deployment targets. Counting every request in D1 adds a write to every request in the
> product, which is a real slice of the quota it exists to measure — **cost if wrong:** the figure
> drifts from the real bill. It moves for the same reasons the bill moves.

**`K35` (owner) — the cost is stated at the control, before the control is enabled.**

> Ruling: every setting whose cost scales with candidates carries its own estimate **beside the
> toggle that turns it on**, in the test builder, before it is enabled — not only in `P8.14`'s
> dashboard. One estimator in `@pariksha/core`, `estimateCost({ test, candidates, resolved })`,
> returning a per-control breakdown in **requests first**, bytes second. It **composes**
> `snapshotCost` rather than replacing it. The controls that get a line: interval snapshots (already
> has one, 7b), the identity photo, webhook subscriptions, and the whole-test total on the publish
> checklist — **why:** the organiser's decision happens at the toggle, and a dashboard they visit
> afterwards is a bill, not a choice. 7b already proved the pattern works and already proved the
> failure mode: the cost clause existed on two surfaces, was **independently wrong on both**, and
> only became correct when it moved to one function in core. The unit is requests because
> `snapshotCost`'s own comment is right — *"requests, not bytes, are the ceiling that actually stops
> a test… the megabytes figure alone is reassuring and wrong"* — **cost if wrong:** an organiser
> enables a control and meets its cost on the dashboard afterwards, which is the situation `G6`
> exists to prevent. The estimate is per-candidate and multiplied by the candidate count the test
> actually has, so it is wrong in the same direction and by the same ratio as reality.

**`K36` (owner) — no cost surface on the `node` target.**

> Ruling: every cost line, the publish-checklist total and the whole of `P8.14` render only when
> `env.target === "workers"`. On `node` — the Docker deployment — they are absent, not zeroed and
> not greyed out. The API omits the field rather than sending a null the browser has to interpret —
> **why:** `AppEnv` already carries exactly this distinction (`apps/api/src/env.ts:121`,
> `target: "workers" | "node"`), so no new configuration is invented. The numbers are Cloudflare's
> free-plan limits — 100,000 requests/day, 50 subrequests, 10 ms CPU — and on an operator's own
> container they describe nothing: the hardware is theirs, the bill is theirs, and a warning at 70%
> of a limit that does not apply is noise that teaches an operator to ignore warnings — **cost if
> wrong:** a Docker operator sees no usage figure. They have their own host's metrics, which are
> real where ours would be fabricated.

### 7.8 The two inherited defects and the stale PRD line

**`K32` — `#186` and `#179` ship in the foundations plan, with the tests their issues specify.**

> Ruling: `branding.finish_message` joins the `Receipt` payload in `submit.ts` and renders in
> `Receipt.tsx`, tested **from `ExamApp` clicked through to submission** as `#186` demands; `#179`'s
> no-duration test becomes a **blocking** publish-checklist row, and the landing page stops
> advertising `durationMinutes: 0` — **why:** both live in files the foundations plan already opens
> (`submit.ts` for `K5`, `publish/checklist.ts` for `K28`'s retention rows), and both are the kind of
> small visible defect that never gets a phase of its own — **cost if wrong:** the foundations plan
> grows two tasks. Both are small and both are specified in full on their issues.

**`K33` — `docs/PRD.md:568` is corrected in the same change that first reads a snapshot row.**

> Ruling: *"Interval snapshots get no database row"* is replaced with what the product does, and the
> "snapshot upload doubles as the 60 s heartbeat" sentence is qualified to Strict — **why:** Phase 7's
> `Q4f` shipped the opposite and this phase's retention job, review timeline and monitor all depend
> on rows existing. `#209` establishes the precedent that a public claim is corrected in the change
> that makes it false, never a release later — **cost if wrong:** the PRD describes a product that
> does not exist, and the next phase plans against it.

### 7.9 The microphone

**`K34` — `#209` ships as written, and the `P-06` reword and the ADR land in the same commit as the first audio stream.**

> Ruling: `#209`'s acceptance criteria are the specification; this document adds nothing to them.
> `resolveProctoring` stops hardcoding `requireMicrophone: false`, the control is re-enabled, the
> candidate sentence appears, and `P-06` is reworded to *"no audio is ever recorded or stored"* with
> its ADR **in the same change that first calls `getUserMedia` for audio** — **why:** the issue
> carries the full criteria, the `monitorNoise` signature, and four traps already paid for in Phase 7.
> It also carries the reason the reword cannot lag: capture-without-retention is a different public
> claim from no-capture — **cost if wrong:** the product ships a release claiming no audio while a
> worklet is listening. That is the one failure this ruling exists to prevent, and it is a
> credibility failure, not a technical one.

---

## 8. Guards — mechanical, permanent, and broken on purpose once each

Probe verification is standard on this project: every new guard is broken deliberately to prove it
can fail, the verbatim failure line is recorded, and the probe never appears in a commit.

- **`KG1` — no export leaks a key.** A `scrub-scan`-shaped test over every Phase 8 export route: no
  question key, explanation, rubric, model answer or accepted pattern appears in any CSV or manifest
  served to anyone below `attempts.read_evidence`. The per-answer CSV carries *correct* as a boolean,
  never the correct answer.
- **`KG2` — no results route is reachable without its permission.** Every new route has a
  `ROUTE_AUTH` entry and a `ROUTE_ACTIONS` entry, and `route-authority.test.ts` enforces both. Six
  permissions gain their first production caller here; each gets a 403 test **with a 200 beside it in
  the same file** (`E-R5` — a typo in the URL makes a bare 403 test pass for free).
- **`KG3` — no route issues a query per item.** Every Phase 8 route's `ROUTE_BUDGETS` entry is
  measured with `countingDeps` against a **300-candidate** fixture.
- **`KG4` — the deletion sweep is complete, and `audit_log` is its one declared exemption.** A test
  enumerates every table holding candidate data from `TABLE_MANIFEST` and asserts that `S-14`
  deletion empties each one, so a table added in a later phase fails this test rather than silently
  surviving a deletion. **`audit_log` is exempt by name, with the reason in the test**, because
  `S-13` requires deletions to be logged and `K29` writes the deletion's own audit row — a guard
  that emptied it would delete the record of the deletion. The exemption is paid for by `KG9`.
- **`KG9` — `audit_log.detail_json` carries identifiers, never personal data.** A test asserts that
  every `appendAudit` call site in `apps/api/src` passes ids (`cnd_…`, `att_…`, `tst_…`) and never a
  name, an email or a form value, with a positive control that the scan catches one when planted.
  `detail_json` is free-form JSON (`columns.ts:492`) and every `R-02` proctor action logs against a
  named candidate — so without this, `KG4`'s exemption would leave a candidate's email sitting in a
  table `S-14` deletion deliberately does not touch. This is what makes the exemption safe rather
  than convenient.
- **`KG5` — no secret is readable.** No response body anywhere contains `secret_hash`,
  `signing_secret`, or a key's plaintext after the one creation response. Source-scanned, with a
  positive control.
- **`KG6` — the CSV is Excel-safe.** Leading bytes are `EF BB BF`; a round-trip through
  `readDelimited` returns the input; a non-Latin name and a value containing a comma, a quote and a
  newline each survive.
- **`KG7` — no new periodic candidate request.** A source scan over `apps/web/src` asserting the
  candidate runtime adds no `setInterval` that issues a `fetch`. Constraint 4 made mechanical, so the
  next phase cannot undo `K11` and `K12` by accident.
- **`KG10` — the monitor joins the density registry.** The live monitor is added to
  `apps/web/e2e/density.ts`'s `SURFACES`, which has held a **fixed four entries** since 6.5e
  (`testList`, `bankList`, `bankBrowser`, `questionPicker`). It is a 300-row scanning list — the
  densest screen the product will have and the exact thing `D13`/`AG1` exists for. Opting the
  densest screen out of its own gate is how a gate quietly stops meaning anything. Costs one
  Playwright seed and one e2e spec. The phase's other new screens are read-once detail views and do
  not join.
- **`KG8` — no cost figure reaches a `node` deployment.** A test builds the app under
  `target: "node"` and asserts every cost field is **absent** from the payload — not null, not zero
  — and that no cost element renders. With a `target: "workers"` positive control in the same file,
  because an assertion that a field is missing passes for free when the field was never named
  correctly (`E-R5`, which shipped vacuous three times in 7c). `K36` made mechanical.

---

## 9. The slices, and the order

Seven plans. Each produces working, testable software on its own.

| plan | ships | depends on |
| --- | --- | --- |
| **8a — the ledger** | `rescoreAttempt`, `countedScore`, `toCsv`, `estimateCost`, `TestRetention`, the organiser attempt reads, migration `0010`, the `scheduled` registry, `#186`, `#179`, `K33`'s PRD correction | — (see `K40`) |
| **8b — the verdict** | grading queue, blind and by-question, reviewer verdicts, regrade | a |
| **8c — the numbers** | test analytics, item analysis, results CSV, the three detailed exports, the snapshot manifest, `D7c`'s readiness aggregate | a, b |
| **8d — the perimeter** | webhook CRUD **and** delivery, HMAC, the retry drain, API-key CRUD and scopes | a |
| **8e — the sweep** | retention job, candidate export and deletion, `rate_limit` expiry, the free-tier meter | a |
| **8f — the ear** | `#209`'s microphone, `#84`'s re-cut | a, **7d** |
| **8g — the watchtower** | live monitor, the five proctor actions, per-attempt review page, `C-10`'s broadcast | a, **7e** |

> **8d is bigger than "add delivery to an existing feature."** The pre-flight says of `webhook` and
> `api_key` that the **tables** exist. Nothing else does: grepping `apps/` and `packages/` outside
> `packages/db` finds no repo function, no route and no organiser screen for either — only the
> landing page's marketing copy. 8d builds both CRUD surfaces, both secret-shown-once flows, the
> event selector and the scope selector, **and** HMAC, `webhook_delivery` and the drain. Size it as
> two plans' worth of work in one, or split it when it is written.

### Order

**8a first and alone.** Every other plan consumes it, and it owns the only migration.

**Then 8b, 8d and 8e in parallel** — none touches proctoring, and their tables (`review`,
`webhook`, `api_key`) have existed since `0000`. This is the independent slice the brief asks to
execute first, and it is **three** plans wide.

**8c after 8b**, because the results CSV carries the verdict and the note.

**8f once 7d merges.** `#209` re-enables a control and deletes a hardcoded `false` that **7d
ships** — against today's `main` there is nothing there to re-enable.

**8g last.** It needs 7e. It replaces the **surface** of 7e's two minimal organiser attempt routes
and keeps their **endpoint**, as the roadmap says.

**`K40` (owner) — Phase 8 is planned whole now, and its two Phase-7-dependent plans are gated at
execution rather than deferred at planning.**

> Ruling: all seven plans are written in this pass. 8f declares 7d and 8g declares 7e as execution
> gates in their own headers. `0010` stands, and 8a's plan states that **7e must take `0009` or
> renumber** — whichever lands second yields — **why:** `main` carries 7a–7c only; 7d is in flight
> on an unmerged branch and 7e is not started. Planning only the five unblocked slices would cost a
> second planning session against a moving tree, and the five that *are* unblocked do not change
> based on what 7d and 7e ship. Gating at execution costs a line in two headers — **cost if wrong:**
> if 7d or 7e changes shape materially, 8f or 8g is re-planned against what actually shipped. That
> is one plan each, and the handoff precedent is that a plan re-checked against a merged dependency
> is normal work rather than waste.

**`K41` (owner) — `0010` is applied to the live database *before* 8a merges, not after.**

> Ruling: applying the migration is an explicit, blocking item in 8a's definition of done, run by
> the owner (`node deploy/cloudflare/setup.mjs` — the sandbox classifier refuses it for the agent).
> The agent's own pre-merge evidence is the two free checks `CLAUDE.md` names:
> `node deploy/cloudflare/setup.mjs --dry-run` (the whole flow twice against an in-memory
> Cloudflare, asserting the second run is a no-op) and `pnpm --filter @pariksha/api test`, whose
> `worker.test.ts` runs the real Worker entry against **Miniflare — D1's own engine locally**.
> After the merge, `GET /api/v1/health` must answer a `migrations` count equal to the number of
> files in `packages/db/migrations/sqlite/` — **why:** `deploy.yml` redeploys `main` on every push
> and applies **no** migrations, so a merge ships code whose schema is not there yet. This has
> already happened on this repository: **`0008` merged with Phase 7a and went four days unapplied**,
> and every live `attempt` select failed with `no such column` until setup was run on **2026-10-22**.
> `CLAUDE.md` now carries this as a repository-wide rule, and `K41` is this phase's instance of it —
> **cost if wrong:** a deployed 500 on a live instance rather than a red test, surfacing in whichever
> plan deploys first rather than in the one that caused it.
>
> **`0008` is applied as of 2026-10-22** and is no longer outstanding. `attempt.integrity_flag` and
> `observed` exist in production; the plans may assume them. `0010` is the only migration this phase
> gates on.

### What is shared across plans

| produced by | name | consumed by |
| --- | --- | --- |
| a | `rescoreAttempt()` | b (grading), b (regrade) |
| a | `countedScore()` | c (CSV, analytics), and the candidate result page |
| a | `toCsv()`, the filename helper, the cursor-paging shape (`K38`) | c, e |
| a | `estimateCost()` — composes `snapshotCost`, `workers`-only (`K35`, `K36`) | d (webhooks), e (the dashboard), and the publish checklist |
| a | `TestRetention` + its resolver | e |
| a | the organiser attempt reads | b, c, g |
| a | `0010` — `webhook_delivery`, `attempt.proctor_message`, `.proctor_message_at`, the `response(workspace_id, question_id)` index | b, c, d, g |
| a | the `scheduled` job registry | b (regrade drain), d (webhook drain), e (retention, rate limits) |
| b | the verdict read | c |

### Cut order

**Already cut, by `K1`, `K2` and `K3`:** face counting, per-question time, and the real ZIP.

- **Cut first: `P8.14`'s free-tier *dashboard*** (8e). It is a mitigation named in the PRD risk
  table, not an `AC`. **Cutting it does not cut the cost surface**: `K35`'s per-control estimates
  live beside the controls they describe, in 8a's estimator and 8d's and the builder's own panels,
  so an organiser still meets the cost at the moment of the decision — which is `G6`'s actual
  requirement. The dashboard is the aggregate view, and it is the part that can go.
- **Cut second: `D7c`'s readiness aggregate** (8c). It is a Phase 6.5 carry-forward, the builder
  already shows readiness, and `tests.tsx`'s own guard documents its absence.

**A third cut stops and asks.**

---

## 10. Deferred — named, with the reason, so none is rediscovered as a bug

| item | why it is not here | who should own it |
| --- | --- | --- |
| On-device face counting (`#84`, `P-07`) | `K1`. CSP unchanged. | A phase willing to overturn `hosting.test.ts`, or a non-wasm detector. |
| Per-question time (`R-07`, `R-09`) | `K2`. No data source; needs a migration and a candidate-runtime change. | Its own issue, filed by 8a. |
| A real snapshot ZIP | `K3`. 50 subrequests. | Phase 11's Docker target has no ceiling. |
| `PROCTORING_DEFAULTS` is global and unversioned | Open since handoff-1 §3.1, still unfixed, *"cheap now and expensive after 7e."* Phase 8 reads resolved proctoring on the monitor and the review page and so makes it **more** expensive, but the fix is a publish-time change belonging to whoever owns publish. | A publish-materialisation change. **Flagged, not taken.** |
| `ADR 0007`'s `test_comment` table and the draft review panel | Not this phase's `review`. Authoring, not results. | Whoever owns authoring review. |
| A contact route for a locked candidate | No support-email field exists anywhere in the schema. Unchanged since 7a. | Whoever owns organiser contact details. |
| Section-order shuffling (`D19`) | Needs a `pariksha/test@1` field, a format bump and an ADR. | Carried from 6.5. |
| `branding.logo` on the candidate side | Needs a branding-scoped media route; never `layout.media`. | Carried from Phase 6. |
| A message queue for `C-10` | `K13`. One slot. | Nobody, until someone asks. |
| The noise threshold as an organiser control | 7d's constant. Unchanged. | Nobody, until someone asks. |
| A custom report builder | §3. `R-06` and `R-07` are a fixed list. | Out of v1.0. |

---

## 11. What the owner validates by hand

CI proves everything provable without a real cohort. Three things need one.

- **`AC-27`'s hand-scoring.** Ten sample attempts, scored by hand, compared to the results CSV. This
  is the pilot gate's own wording and it cannot be automated, because an automated check would use
  the same scoring engine the CSV did.
- **The CSV in real Excel.** `KG6` proves the bytes. It does not prove Excel. One file with a
  non-Latin name in it, opened on a real machine.
- **A webhook against a real endpoint.** `AC-28` — delivery under 10 s with a verifying signature,
  and a retry after a deliberate 500. The HMAC is unit-tested against an independent verifier; a real
  receiver is what proves the header survives the wire.

Each result goes in the roadmap's Phase 8 row, not only in a task report.
