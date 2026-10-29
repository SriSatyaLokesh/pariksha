# Landing page content inventory

| | |
| --- | --- |
| **Status** | Complete — input to the landing page rebuild |
| **Date** | 2026-10-17 |
| **Scope** | Everything true about Pariksha that could go on the page, with its source |
| **Rule** | If a claim is not in this file with a file path beside it, it does not go on the page |

Sources read in full: `README.md`, `docs/PRD.md`, `docs/ROADMAP.md`, `docs/question-format.md`,
`docs/test-format.md`, `docs/design.md`, `docs/adr/`, `examples/` (all files), `CHANGELOG.md`,
`deploy/cloudflare/README.md`, `packages/core/` (skim), GitHub issues #40 and #103–#108.

**Status vocabulary used throughout**

| Mark | Means |
| --- | --- |
| **SHIPPED** | Code exists in this repository today and is tested |
| **SPECIFIED** | Written down in the PRD or a format spec; no code |
| **ROADMAP** | Assigned to a later build phase; not specified in PRD detail |

The honest one-line summary the whole page has to stay inside: **the formats, the schemas, a worked
example and the scoring engine exist; the application does not.** (`README.md:22`,
`examples/reasoning-aptitude/README.md:14`)

---

## 1. Features, grouped by the organiser's job

### Job A — "I need to write questions that are worth asking"

| Claim | Status | Source |
| --- | --- | --- |
| 12 question types: single, multiple, select exactly K, true/false, assertion–reason, matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short answer, long answer | **SHIPPED** as types + grading in `packages/core`; **SPECIFIED** as an editor UI | `docs/question-format.md:35-50`; `packages/core/README.md:3`; PRD `:146-159` |
| Every type takes Markdown, fenced code blocks, LaTeX (`$…$`), images with required alt text, per-question points, difficulty, tags and an explanation shown only in review | **SPECIFIED** (format fields exist and validate) | `docs/question-format.md:20-33`; PRD `:144` |
| 5 scoring modes: all-or-nothing, partial credit, negative marking, ordering-by-position, rubric | **SHIPPED** — every mode graded and unit-tested | `docs/question-format.md:52-60`; `packages/core/README.md:3` |
| A mode only applies to some types, and that is enforced, not left to grade by the wrong arithmetic (`APPLICABLE_MODES`) | **SHIPPED** | `packages/core/src/index.ts:21-26`; `docs/test-format.md:139` |
| Cross-field import validation: keys must exist among the options, `select_k` key must hold exactly `k`, matching keys must use only declared items, every `{{id}}` blank must have a row and vice versa, IDs unique | **SHIPPED** (`validateBank`) | `docs/question-format.md:62-72`; `packages/core/src/validate.ts` |
| Whole-test validation: default mode applies to every drawable type, a pool matches at least `count`, sets hold equal points, `on_date` has `at`, `link_code` has `access_code` | **SHIPPED** (`validateTest`, closes #132) | `CHANGELOG.md` Unreleased/Added; `docs/test-format.md:200-213` |
| Import is all-or-nothing with a line-by-line error report — one bad question imports nothing | **SHIPPED** as the rule engine; **SPECIFIED** as an importer UI | `docs/question-format.md:72`; PRD `D-02`, `AC-05` |
| Passage groups: one table, passage or code sample shown once above several questions | **SPECIFIED**, and demonstrated in the example (`library-loans`) | `docs/question-format.md:7`; `examples/reasoning-aptitude/questions.json:7-13` |
| Import from CSV and Moodle GIFT as well as Pariksha JSON | **ROADMAP** (Phase 4) | PRD `D-01`; `docs/ROADMAP.md:81` |

### Job B — "Everyone must get a different paper"

| Claim | Status | Source |
| --- | --- | --- |
| Three question sources per section: a fixed hand-picked list, a random draw from a pool filtered by tag and difficulty, or fixed sets A/B/C | **SHIPPED** (selection logic); **SPECIFIED** (builder UI) | `docs/test-format.md:141-168`; `packages/core/src/select.ts` |
| Set assignment: round-robin by registration order (so neighbours differ), random, hash of the candidate ID, or a `set` column in an uploaded CSV | **SHIPPED** (`assignSet`) | `docs/test-format.md:170`; PRD `T-09` |
| Questions shuffle within a section and options shuffle per candidate; options marked `pinned` never move ("All of the above") | **SHIPPED** (`shuffleOptions`, seeded) | `packages/core/src/index.ts:37-39`; PRD `T-10`, `:176` |
| The shuffle is seeded and stored per attempt, so a refresh gives back the same order | **SHIPPED** (deterministic `makeRng` + `layoutForAttempt`); **SPECIFIED** (persistence) | `packages/core/src/index.ts:37-47`; PRD `T-10`, `AC-11` |
| Publishing warns if a pool holds fewer questions than `count`, or if sets drift apart in points; import refuses outright | **SHIPPED** (the check); **SPECIFIED** (the warning UI) | `docs/test-format.md:172`; PRD `T-11` |
| `PoolTooSmallError` is a catchable value, not a string | **SHIPPED** | `packages/core/src/index.ts:46` |

### Job C — "I need to collect the right details before they start"

| Claim | Status | Source |
| --- | --- | --- |
| A registration form you design per test, 11 field types: short text, long text, email, phone with country code, number, date, dropdown, radio, checkbox, URL with allowed domains, consent tick box | **SPECIFIED** | `docs/test-format.md:94-106`; PRD `T-16` |
| `unique: true` on a field (email, phone, roll number) refuses a second registration with the same value | **SPECIFIED** | `docs/test-format.md:89-92`; PRD `T-17` |
| Validation per field: min/max length, regex with a required human message, allowed domains, number ranges, date bounds | **SPECIFIED** | `docs/test-format.md:94-108` |
| URL fields can check the link actually opens and flag it as unverified | **SPECIFIED** | PRD `T-19` |
| Every rule is re-checked on the server; the browser's copy is a courtesy, not a control | **SPECIFIED** (design rule) | `docs/test-format.md:110`; `examples/reasoning-aptitude/README.md:223` |
| Built-in form templates: campus hiring, course exam, open contest | **SPECIFIED** | PRD `T-18` |

### Job D — "Only the right people, at the right time"

| Claim | Status | Source |
| --- | --- | --- |
| Four access modes: public link + access code, single-use personal invite links, 6-digit email code valid 10 minutes, SSO with an allowed email domain | **SPECIFIED** | `docs/test-format.md:63-72`; PRD `S-06`, `T-20` |
| Optional allowlists: email domain globs (`*.ac.in`), IP ranges (a lab network), an uploaded candidate list | **SPECIFIED** | `docs/test-format.md:72`; PRD `T-21` |
| Rate limits are per attempt and per test, never per IP, because a whole campus shares one | **SPECIFIED** (and argued as a design decision) | `docs/test-format.md:74`; PRD `S-07`; ADR 0002 (Supabase rejected for exactly this) |
| The clock is the server's — changing the computer's clock does nothing; answers more than 30 s late are rejected | **SPECIFIED** | `docs/test-format.md:61`, `:59`; PRD `AC-13` |
| Lifecycle Draft → Scheduled → Open → Closed → Archived; publishing freezes a numbered version and running attempts keep theirs | **SPECIFIED** | PRD `T-04`; `docs/design.md:248-259` |
| Each test has an immutable `tst_` ID, a slug, a short link `/t/<6-char code>` and a QR code | **SPECIFIED** | PRD `T-01`, `T-02` |
| Clone a test, or export it as one JSON file and import it into any other Pariksha installation | **SPECIFIED**; the format that makes it possible is **SHIPPED** | PRD `T-05`, `T-06`; `docs/test-format.md:3` |

### Job E — "I cannot be in the room"

| Claim | Status | Source |
| --- | --- | --- |
| Three proctoring profiles — Off, Standard, Strict — with every individual control overridable | **SPECIFIED** | `docs/test-format.md:112-127`; PRD `:288-303` |
| Standard: desktop/laptop only, minimum 1024 px, fullscreen required, tab-switch warning and log, copy/paste/right-click/print blocked, watermark with name and ID | **SPECIFIED** | PRD `:290-296` |
| Strict adds: camera required throughout, identity photo at start, a snapshot every 60 s and on each violation, microphone loudness events, on-device face counting, extra-monitor check, auto-submit at the violation limit | **SPECIFIED** | PRD `:297-303` |
| **No video and no audio are ever recorded** — snapshots only, 320×240 JPEG, about 25 KB | **SPECIFIED** (a design commitment, repeated in three documents) | PRD `P-06`; `README.md:47`; `docs/PRD.md:678` |
| Face counting runs on-device (MediaPipe); no face data or biometric template is stored | **SPECIFIED** | PRD `P-07` |
| Flags, never verdicts: an attempt is marked `clean`, `review` or `high_risk` and a person decides | **SPECIFIED** (and stated as the product's ethic) | `README.md:48`; PRD `P-10`, `:286`; `docs/test-format.md:129` |
| Browser checks cannot prove or prevent cheating — a second phone is invisible to all of them — and the docs say so | **SPECIFIED**, stated plainly as a risk with its mitigation | `docs/test-format.md:129`; PRD `:674` |
| Proctoring failures (snapshot upload, face model) never block answering | **SPECIFIED** (non-functional requirement) | PRD `:541` |

### Job F — "Give me a spreadsheet I can act on"

| Claim | Status | Source |
| --- | --- | --- |
| Results CSV, one row per candidate, with one column per registration field named by its **label**, plus set, times, submit reason, score, max, percent, rank, pass/fail, one column per section, integrity counts and flag, reviewer verdict, note and a review link | **SPECIFIED**, with a real file in the repo | PRD `R-08`; `examples/reasoning-aptitude/results.csv` |
| UTF-8 with a BOM, so non-Latin names open correctly in Excel; named `<test-slug>_results_<YYYYMMDD-HHMM>.csv`; downloadable mid-test for partial results | **SPECIFIED** | PRD `R-10` |
| Also: per-answer CSV, events CSV, full test JSON, a ZIP of snapshots | **SPECIFIED** | PRD `R-09` |
| Live monitor refreshing every 15 s: counts, per-candidate set, time left, answered count, violations, last heartbeat, camera status; proctor can extend time, unlock, reset, force-submit, broadcast a message — every action audit-logged | **SPECIFIED** | PRD `R-01`, `R-02`, `C-10` |
| Grading queue for manual questions, optionally blind and by-question across all candidates | **SPECIFIED** | PRD `R-04` |
| Item analysis per question: share correct, discrimination index (top 27% vs bottom 27%), option pick rates, average time | **SPECIFIED** | PRD `R-07` |
| Per-set comparison, to check sets were equally hard | **SPECIFIED** | PRD `R-06` |
| Change an answer key afterwards and **Regrade** every attempt, with one audit entry | **SPECIFIED**; the arithmetic it re-runs (`applyMode`) is **SHIPPED** and exported for exactly this | PRD `:174`, `AC-08`; `packages/core/src/index.ts:17-26` |
| REST API under `/api/v1`, and signed webhooks (`attempt.started/submitted/flagged`, `test.closed`) HMAC-SHA256 with retry up to 24 hours | **SPECIFIED** | PRD `:517-531` |

### Job G — "It must not cost me anything, and the data must be mine"

| Claim | Status | Source |
| --- | --- | --- |
| Two deployment targets from one codebase: Cloudflare's free plan (Workers, D1, R2, Turnstile, Cron) or Docker on any server (Node 22, SQLite or Postgres 16, MinIO/S3/disk, Caddy) | **SPECIFIED**; the adapter architecture is the decision | PRD `:449-458`; ADR 0002 |
| 500 candidates in one hour costs **$0** on the reference stack | **SPECIFIED** — an estimate, with its arithmetic published | PRD `:70`, `:551-559`; ADR 0002 |
| Candidate data lives in the organiser's own account; no telemetry, no third-party scripts, no trackers | **SPECIFIED** as a principle; **SHIPPED** on the landing page itself (self-hosted fonts, `default-src 'self'` CSP) | PRD `:43`, `S-11`; `CHANGELOG.md` Unreleased/Added |
| Answer keys, explanations and other candidates' data never reach a candidate's browser; every rule is enforced server-side | **SPECIFIED**, with an automated test required to prove it | PRD `S-10`, `AC-22`; `README.md:98` |
| Retention defaults: snapshots 90 days, personal data and answers 12 months; a daily job deletes and logs it | **SPECIFIED** | PRD `S-13`; `docs/test-format.md:192-198` |
| Per-candidate export and deletion on request; optional field-level AES-GCM encryption; snapshots behind signed URLs expiring in 10 minutes | **SPECIFIED** | PRD `S-14`, `S-15`, `S-16` |
| Append-only audit log of sign-ins, role changes, publishes, key changes, regrades, exports and deletions, kept 12 months | **SPECIFIED** | PRD `S-18` |
| A consent screen whose text the organiser writes; the version and time of acceptance stored per candidate | **SPECIFIED**, with a real worked consent text | PRD `S-12`; `examples/reasoning-aptitude/test.json:33` |
| A data-processing template for GDPR and India's DPDP Act 2023 | **SPECIFIED** (documentation deliverable) | PRD `S-19` |
| AGPL-3.0 code protecting self-hosters; docs, schemas and examples CC BY 4.0 | **SHIPPED** (`LICENSE` is in the repo) | ADR 0013; `README.md` |

### Job H — "Several people work on this with me"

| Claim | Status | Source |
| --- | --- | --- |
| Seven workspace roles plus Candidate: Instance owner, Workspace owner, Admin, Author, Proctor, Reviewer, Viewer | **SPECIFIED** | PRD `:79-88` |
| An Author can build a whole test but cannot make it live; permissions narrow to specific tests | **SPECIFIED** | PRD `:96-98`, `:108`; `docs/design.md:99` |
| Every permission check runs on the server for every request; the interface only hides what a role cannot do | **SPECIFIED** | PRD `:109` |
| Tenant isolation: every query scoped by workspace ID in the data layer, with tests that try to read across workspaces | **SPECIFIED**, and it is Phase 3's gate | PRD `S-09`, `AC-23`; `docs/ROADMAP.md:75` |
| Draft review: a draft test can be sent to named reviewers who comment and approve — without a sixth lifecycle state | **ROADMAP** (Phase 5), decided in the UX design | `docs/design.md:236-246` (UX-10) |

### Job I — "Later"

| Claim | Status | Source |
| --- | --- | --- |
| BYOK AI question drafting (see §6) | **ROADMAP** Phase 9 | `docs/ROADMAP.md:119-125`; issues #40, #103–#108 |
| A public demo instance anyone can click into without signing in | **ROADMAP** Phase 10 | `docs/ROADMAP.md:127-133`; issue #41 |
| Docker self-host with Postgres, MinIO, Caddy, Argon2id passwords and TOTP | **ROADMAP** Phase 11 | `docs/ROADMAP.md:135-141` |
| WCAG 2.1 AA audit, translations, right-to-left layout, OpenAPI 3.1, a plugin interface for new question types, k6 load script, signed releases | **ROADMAP** Phase 12 | `docs/ROADMAP.md:143-149` |
| A coding-question runner, as the first plugin | **SPECIFIED** as a non-goal for v1 and the first planned plugin | PRD `:60`, `O-06` |
| QTI 2.1 import | **ROADMAP**, explicitly after v1 | PRD `D-01` |

### Explicit non-goals (useful on the page as proof of focus)

Live video streaming or human live proctoring · coding questions with a code runner · native mobile
apps or lockdown browsers · AI that decides whether someone cheated · **a hosted SaaS run by the
project**. (PRD `:57-63`)

---

## 2. Differentiators, and where Pariksha is worse

### (a) Against free form tools (Google Forms, Microsoft Forms)

Each line below is written to survive a reader who is looking for the catch.

1. **A form shows every candidate the same paper.** Pariksha draws a different one per candidate — N questions from a tagged pool, or fixed sets handed out round-robin so neighbours never match — and shuffles the options underneath. (PRD `T-08`, `T-09`, `T-10`; `packages/core/src/select.ts`)
2. **A form has three or four question types. Pariksha's format defines twelve**, including matching, multi-matching, ordering, fill-in-the-blank with regex matching, and numeric with a tolerance. (`README.md:34`; `docs/question-format.md:35-50`)
3. **A form's answer key is in the page you send.** Pariksha's keys and explanations are stated never to reach a candidate's browser, and an automated test that scans every response is written into the acceptance criteria. (PRD `S-10`, `AC-22`)
4. **A form cannot tell you the tab was switched.** Standard proctoring logs window and tab switches with their duration and shows the candidate a counted warning. (PRD `P-04`)
5. **A form's timer is the browser's.** Pariksha's deadline is set and enforced on the server, so changing the computer clock does nothing, and answers arriving more than 30 s late are rejected. (`docs/test-format.md:61`; PRD `AC-13`)
6. **A form cannot stop one person registering twice.** Any field can be marked `unique`, and a second registration with that value is refused on the server. (`docs/test-format.md:91`; PRD `T-17`)
7. **A form's results need rebuilding by hand.** The results CSV already carries rank, percent, pass/fail against your pass mark, a column per section and the integrity flag. (PRD `R-08`; `examples/reasoning-aptitude/results.csv`)
8. **Negative marking, partial credit and rubrics are arithmetic a form cannot do.** Five scoring modes, each one implemented and unit-tested today. (`docs/question-format.md:52-60`)

### (b) Against paid assessment platforms (Mettl, HackerEarth, Testlify, Testportal)

1. **They charge per candidate or per month. Pariksha's reference deployment is designed to cost nothing** — 500 candidates in one hour fits inside Cloudflare's free tier, and the arithmetic is published rather than asserted. (PRD `:70`, `:551-568`; ADR 0002)
2. **Their candidate data sits on their servers. Yours sits in your account** — your Cloudflare account or your own machine, with the database region and storage jurisdiction your choice where the host allows it. (PRD `:43`, `S-17`)
3. **You cannot read their scoring code. You can read all of ours** — AGPL-3.0, with copyleft network trigger ensuring improvements stay open, so you may self-host, modify or embed it. (ADR 0013)
4. **No lock-in by design: a test is one JSON file.** `pariksha/test@1` is what export returns and import accepts, so a test built on one installation runs unchanged on another — or is read by a tool that is not Pariksha at all. (`docs/test-format.md:3`; `docs/question-format.md:3`)
5. **No telemetry, no third-party scripts, no trackers** — fonts and the face model are served by the app itself. This landing page already keeps that promise: self-hosted subset fonts and a `default-src 'self'` CSP. (PRD `S-11`; `CHANGELOG.md`)
6. **Proctoring that does not record you.** No video, no audio — periodic 320×240 snapshots only, face counting on-device, no biometric template stored. Several vendors record the full session. (PRD `P-06`, `P-07`)
7. **Nobody is auto-disqualified by a machine.** An attempt is flagged `clean`, `review` or `high_risk`; the only automatic actions are the ones an organiser explicitly configured. (PRD `P-10`; `docs/test-format.md:129`)
8. **Price does not change when the free tier does.** The storage, database and identity adapters exist precisely so an organiser who outgrows Cloudflare moves to Docker and Postgres without a rewrite. (ADR 0002, Consequences)

### (c) Where Pariksha is WORSE today — say these out loud

| Admission | Source |
| --- | --- |
| **The application does not exist yet.** The repository holds the PRD, the open formats, their JSON Schemas, a worked example and the scoring engine. Code lands with v0.1. | `README.md:22`; `docs/ROADMAP.md:30-35` |
| **You cannot click a button and run a test today.** Nothing here is a hosted service, and the project explicitly does not plan to run one. | PRD `:63`, `:57-63` |
| **Browser proctoring is beatable.** A second phone is invisible to every check in the product. For high-stakes use the documentation recommends a supervised follow-up round. | `docs/test-format.md:129`; PRD `:674` |
| **No live human proctoring, no video stream, no lockdown browser.** If your exam board requires one, Pariksha is the wrong tool. | PRD `:59`, `:61` |
| **Phones and tablets are blocked, not supported.** With Standard or Strict, a candidate without a laptop cannot sit the test at all. | PRD `P-01`, `AC-17` |
| **Camera and face checks fail in poor light and on old webcams**, which is why flags never auto-reject and the thresholds are organiser-tunable. | PRD `:677` |
| **Password sign-in is not available on the Cloudflare free plan** — a Worker gets 10 ms of CPU per request, too little for safe Argon2id — so organiser sign-in there is OIDC or magic links. Passwords are a Docker-only path. | PRD `S-01`, `:565`; ADR 0002 |
| **Accessibility is a target, not a measured result.** WCAG 2.1 AA is a v1.0 commitment audited in Phase 12. | `docs/ROADMAP.md:145`; PRD `:544` |
| **Translations ship at v1.0.** v1 interface language is English, with translation files for others. | PRD `T-24`; `docs/ROADMAP.md:145` |
| **No coding questions with a runner.** It is a non-goal for v1 and a later plugin. | PRD `:60`, `O-06` |
| **Audio and video question types are deliberately absent**, and the reasoning is written down rather than hidden. | `docs/design.md:348-353` |
| **Moodle is the nearest open-source comparison and it is more capable today.** The PRD's own words: "Moodle comes closest, but it is heavy to run and needs Safe Exam Browser installed." | PRD `:38` |
| **Free-tier limits can change**, which is the named risk against the zero-cost promise; the mitigation is the adapters, the Docker path, and a dashboard warning at 70% of the daily limits. | PRD `:675` |
| **Small maintainer team.** Listed in the PRD's own risk table, mitigated by a narrow v1 scope. | PRD `:680` |

---

## 3. Who it is NOT for

Each of these is sourced, not invented. The page should say them in the product's own voice.

1. **Anyone who needs to run a test this week.** Pre-alpha. The formats are ready to write against; the application is not ready to run. (`README.md:22`)
2. **Anyone who wants somebody else to host it.** There is no Pariksha SaaS and the project lists one as a non-goal. You bring a Cloudflare account or a server. (PRD `:63`)
3. **High-stakes examinations that must be invigilated** — licensing boards, public service commissions, anything where a result is legally contestable. Browser checks deter and record; they cannot prove. (PRD `:674`; `docs/test-format.md:129`)
4. **Anyone who needs live human proctoring or a lockdown browser.** Both are explicit v1 non-goals. (PRD `:59`, `:61`)
5. **Tests candidates will sit on a phone.** With Standard or Strict, phones and tablets are blocked by design — including iPads sending a desktop user agent. (PRD `P-01`, `AC-17`)
6. **Coding interviews that need a code runner.** Not in v1; planned as the first plugin. (PRD `:60`, `O-06`)
7. **Organisations whose policy requires a vendor to carry the liability.** Self-hosting means the data, the retention and the consent text are yours to get right. The project ships a template, not an indemnity. (PRD `S-19`)
8. **Anyone who wants an AI to decide who cheated.** The app flags; a person decides. That is not a limitation to be lifted later — it is the design. (PRD `:62`; `README.md:48`)

---

## 4. The code blocks and examples to put on the page

All five are short enough to read on a phone. Text is exact; any trim is marked.

### 4.1 The question JSON — primary pick: `LOG-001` (`single`)

Pick this one because it is the **same question drawn in the candidate screen mock (§4.5)**, so the
page can show the input and the output of the identical artefact. Verbatim from
`examples/reasoning-aptitude/questions.json:85-100`, with the `\n` in `prompt` kept as the file has it:

```json
{
  "id": "LOG-001",
  "type": "single",
  "prompt": "What comes next in the series?\n\n3, 7, 15, 31, 63, ?",
  "options": [
    { "id": "a", "text": "95" },
    { "id": "b", "text": "117" },
    { "id": "c", "text": "127" },
    { "id": "d", "text": "131" }
  ],
  "key": "c",
  "difficulty": "easy",
  "tags": ["reasoning", "series"],
  "scoring": { "mode": "all_or_nothing", "points": 2 },
  "explanation": "Each term is double the previous term plus one: 63 × 2 + 1 = 127."
}
```

**Secondary pick if the page wants a second, richer block** — `QNT-003` (`select_k`, partial credit,
array key), verbatim from `examples/reasoning-aptitude/questions.json:38-56`:

```json
{
  "id": "QNT-003",
  "type": "select_k",
  "k": 2,
  "prompt": "Choose **exactly two** numbers below that are prime.",
  "options": [
    { "id": "a", "text": "51" },
    { "id": "b", "text": "53" },
    { "id": "c", "text": "57" },
    { "id": "d", "text": "59" },
    { "id": "e", "text": "91" }
  ],
  "key": ["b", "d"],
  "difficulty": "medium",
  "tags": ["quantitative", "number-theory"],
  "scoring": { "mode": "partial", "points": 2 },
  "explanation": "51 = 3 × 17, 57 = 3 × 19 and 91 = 7 × 13. Only 53 and 59 have no factor other than 1 and themselves."
}
```

Caption either with: *the `key` and the `explanation` live in the file, never in the candidate's
browser* (PRD `S-10`).

### 4.2 A test section showing a pool draw

Verbatim from `examples/reasoning-aptitude/test.json:161-176` — the quantitative section:

```json
{
  "id": "quant",
  "title": "Quantitative aptitude",
  "time_limit_minutes": 15,
  "shuffle_questions": true,
  "source": {
    "kind": "pool",
    "bank": "questions.json",
    "count": 4,
    "filter": { "tags": ["quantitative"] }
  }
}
```

*(The file's `instructions` string is removed above to keep the block phone-sized; nothing else is
changed. If the page wants a sets example beside it, use `docs/test-format.md:159-168`, which is
already the short form.)*

Caption: *four questions drawn at random, per candidate, from everything tagged `quantitative`.*

### 4.3 The results CSV excerpt

Verbatim from `examples/reasoning-aptitude/README.md:414-418` — the README's own trimmed form, which
is what fits a phone. The real file at `examples/reasoning-aptitude/results.csv` has 29 columns.

```csv
Full name,...,Set,...,Score,Max score,Percent,Rank,Result,...,Integrity flag,Reviewer verdict,...
Fatima Sheikh,...,A,...,24.00,27,88.9,1,Pass,...,clean,,...
Ananya Rao,...,A,...,21.50,27,79.6,2,Pass,...,review,Clear,...
Divya Menon,...,A,...,9.50,27,35.2,6,Fail,...,high_risk,Suspicious,...
```

Caption, drawn almost verbatim from `examples/reasoning-aptitude/README.md:420`: *Divya's row is the
whole design in one line. The app recorded five tab switches and three fullscreen exits and marked
the attempt `high_risk`. It did not cancel her result. A reviewer looked, wrote a note, and invited
her to a supervised re-test.*

### 4.4 The deploy command — read the warning first

There are **two** different deploys in this repository and the page must not blur them.

**(i) What ships today** — deploying this web app to Cloudflare Workers Static Assets. Verbatim from
`deploy/cloudflare/README.md`:

```bash
pnpm install && pnpm build
pnpm --filter @pariksha/web exec wrangler login
pnpm --filter @pariksha/web deploy
```

Honest caption: *this is how the site you are reading is deployed. The exam API is Phase 2.*
(`deploy/cloudflare/README.md:5`: "configured for the web app, not yet published … Planned for the API.")

**(ii) What a reader can actually run today** — validating the formats, no install. Verbatim from
`README.md:139-148`:

```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"
```

Caption from `README.md:150`: *Write your own questions, validate them, and they will import into
Pariksha on day one.*

**Recommendation for the page:** lead with (ii). It is the only command a visitor can run today that
does something real, it demonstrates the open-format claim rather than asserting it, and it carries no
risk of implying the exam platform is deployable. Show (i) only in a "how this site is hosted" aside.
The organiser's five-step deploy (fork, setup script, secrets, first-run wizard, custom domain —
PRD `:462-470`) is **SPECIFIED** and must be labelled as planned if it appears at all.

### 4.5 The candidate test screen mock

Verbatim from `README.md:71-85`. Keep it in a monospace block, horizontally scrollable on narrow
screens — the top rule is 68 characters wide and must not be reflowed:

```
┌──────────────────────────────────────────────────────────────┐
│ Section 2 of 3 · Logical reasoning     Section 08:41 ▸ Total 22:10 │
├────────────────────────────────────────────┬─────────────────┤
│  Question 6 of 12                   2 pts  │  Questions      │
│                                            │  Section 1      │
│  What comes next in the series?            │  ① ② ③ ④        │
│      3, 7, 15, 31, 63, ?                   │  Section 2      │
│                                            │  ⑤ ⑥ ⑦ ⑧        │
│   ( ) 95     (•) 127                       │  Section 3      │
│   ( ) 117    ( ) 131                       │  🔒 locked      │
├────────────────────────────────────────────┴─────────────────┤
│  ✓ Saved 2 seconds ago                     Ananya Rao 21CS0147│
└──────────────────────────────────────────────────────────────┘
```

**Note for the writer:** the mock contains one 🔒 and the project bans emoji in prose. It is inside a
quoted ASCII artefact from the README, not prose. If the ban is read strictly, the fuller mock at
`examples/reasoning-aptitude/README.md:286-310` has the same lock glyph; substitute the word
`locked` and say the mock was adjusted, or keep it verbatim and note that it is quoted. Raise it —
do not decide it silently.

Three true captions available for it, all from `examples/reasoning-aptitude/README.md:313-317`:
*the palette on the right is the whole test at a glance; Section 3 is locked because navigation is
`per_section`* · *if the network drops, Saved becomes "Offline — your answers are kept and will be
sent when you reconnect". Nothing is lost* · *the options are shuffled per candidate: 127 is not
always second.*

### 4.6 Three extra blocks worth having (all short, all verbatim)

**Scoring, worked** — `examples/reasoning-aptitude/README.md:386-388`. Shows partial credit is real arithmetic, not a slogan:

```
points × (correct parts − wrong parts) ÷ total parts
   2   × (     1        −      1      ) ÷      2        = 0
```

**Negative marking, as the test declares it** — `examples/reasoning-aptitude/test.json:155-159`:

```json
"scoring": { "default_mode": "negative", "negative_fraction": 0.25, "pass_mark_percent": 50 }
```

**Access, as the test declares it** — `examples/reasoning-aptitude/README.md:84`:

```json
"access": { "mode": "link_code", "access_code": "APTI-2026", "allow_email_domains": ["*.edu.in", "*.ac.in"] }
```

---

## 5. The no-code story

**The shape of the claim: an organiser never writes JSON. The JSON exists so that they *could*, and
so that nothing they build is trapped.**

### What the UI does, so nobody hand-writes it

Every item below is a decision recorded in `docs/design.md`, which is the interaction design for
Phases 4 and 5. All are **ROADMAP** — none of these screens is built. The page must not imply
otherwise.

| The organiser does this in the UI | Never writes | Source |
| --- | --- | --- |
| Picks a question type from 12 cards, grouped choice / match / written — and can change it later, keeping prompt, media, tags, difficulty and explanation | `"type"` | UX-06, `docs/design.md:165` |
| Fills one screen of five stacked blocks, the same order for all 12 types: **prompt → answer → key and scoring → meta → preview**. Only the answer block changes by type | the whole document shape | UX-07, `docs/design.md:170` |
| Sets the key on the option rows themselves — a correct toggle and a pin toggle per row | `"key"`, `"pinned"` | `docs/design.md:173-174` |
| Is offered **only the scoring modes the type supports**, so an invalid combination cannot be entered in the first place | `"scoring.mode"` | `docs/design.md:175-179` |
| Types `{{1}}` in the prompt and a blank row appears beneath with its accepted answers and match mode; deleting the placeholder deletes the row | `"blanks"` | UX-21, `docs/design.md:300` |
| Writes the ordering question **in the correct order**; the editor says underneath that Pariksha shuffles it for candidates | the "this is the key" concept | UX-08, `docs/design.md:181` |
| Types tags with autocomplete over tags already used in the workspace; a `/` in a tag (`sdlc/agile`) renders as a breadcrumb chip and groups the browser's left rail | a category hierarchy, a link table, a two-level choice before writing anything | UX-03, `docs/design.md:115-119` |
| Drags sections to reorder; each collapses to one row reading *title · source · question count · points · time* | `"sections"` | UX-12, `docs/design.md:211` |
| Watches a pool section count live — "10 drawn from 14 matching · medium · `sql/joins`" — and sees the row turn to the `flag-risk` token when matches fall below the count | `"source.filter"` | UX-15, `docs/design.md:225` |
| Sees a points-balance strip, one bar per set, while building rather than at the gate | the equal-points rule | UX-16, `docs/design.md:230` |
| Picks fixed questions in a drawer over the builder with a running "12 selected · 24 points" footer, never losing the shape of the paper behind it | a question-ID list | UX-14, `docs/design.md:221` |
| Sees the Publish button in place and **disabled**, with "Needs an Admin — request review instead" beside it, instead of a 403 after a full build | — | UX-11, `docs/design.md:261` |
| Works through a publish **checklist**, not a publish button: every section filled or satisfiably pooled, every pool with enough matches, sets within tolerance, a unique field present if repeat registration is to be blocked, the window in the future — each failing row linking to the thing that is wrong | the import rules | UX-17, `docs/design.md:266` |
| Reads one line after editing a live test: "Version 2 (draft). Attempts in progress stay on version 1." | versioning | UX-18, `docs/design.md:271` |

Two further quotable decisions:

- **Authoring is bank-first.** "A question is created inside a bank and tagged; a test is assembled afterwards by drawing from banks. Creating a test is never a prerequisite for writing a question." (UX-01, `docs/design.md:106`)
- **A bank is created with a name and nothing else required.** "One field, one click, then straight into writing." (UX-02, `docs/design.md:110`)
- **The prompt editor is Markdown with a small toolbar, not WYSIWYG** — because the format already fixes the ceiling, and a WYSIWYG editor that can produce what Markdown cannot would produce questions that fail `schemas/question-1.json` on export. (UX-19, `docs/design.md:284-292`)

### What the open format lets them do, if they want to

| Capability | Why it only works because the format is open | Source |
| --- | --- | --- |
| Hand-author questions in a text editor today, against a documented schema, and validate them with one `npx` command before the app exists | `docs/question-format.md` + `schemas/question-1.json` | `README.md:135-150` |
| Generate a bank from a script, a spreadsheet or anything else, then import it all-or-nothing with a line-by-line error report | the importer validates the same rules the UI enforces | `docs/question-format.md:62-72` |
| Export a whole test — timing, access, registration form, sections, scoring, release — as one file, and import it into a different installation unchanged | `pariksha/test@1` is what export returns and import accepts | `docs/test-format.md:3` |
| Diff a test in git, review a question set in a pull request, licence a bank CC BY 4.0 and hand it to someone using a different tool | plain JSON, documented, versioned `@1` | `examples/README.md`; ADR 0003 |
| Keep working after a format change: fields may be added within `@1`, importers ignore what they do not recognise, and a breaking change requires `@2`, a new schema file **and a converter** | `docs/question-format.md:78-80`; `docs/test-format.md:215-217` |

**The sentence the page is reaching for:** *You will never have to write this. It is here so that you
can — and so that nothing you build is trapped.*

---

## 6. BYOK — what Phase 9 actually promises

**Status: ROADMAP. Not built, not specified in the PRD, and not yet decided — its own ADR is
required before a line of it is written** (`docs/ROADMAP.md:183`; issue #103, "Record the decision
before the phase starts").

### What it promises, exactly

| Promise | Source |
| --- | --- |
| Per-workspace storage of an organiser-supplied **Anthropic or OpenAI** API key | `docs/ROADMAP.md:121`; issue #40 |
| Encrypted at rest with the deployment's field-encryption key (`S-15`), **never returned by any API response and never present in the browser**, revocable, absent by default | `docs/ROADMAP.md:121`; issue #104 (P9.2) |
| A deployment with no key configured behaves **exactly as it does today** | `docs/ROADMAP.md:193` |
| One adapter interface, two implementations; the request is made server-side from the calling workspace's own key | issue #105 (P9.3) |
| It drafts **questions into a bank, not whole tests.** Generating entire `pariksha/test@1` documents — sections, timing, registration form — is explicitly out of scope and would need its own decision | `docs/ROADMAP.md:191` |
| A topic, syllabus or pasted source text produces questions in `pariksha/question@1` form, run through the JSON Schema and the Phase 1 cross-field rules **before anything is stored** | `docs/ROADMAP.md:121`; issue #106 (P9.4) |
| A batch that fails validation is **rejected whole with its errors, exactly like a bad import** — reusing the import path's validation wholesale, so the blast radius stays at one bank item | `docs/ROADMAP.md:123`, `:191`; issue #106 |
| Drafts land as **unpublished items marked as AI-drafted** which an Author reviews and accepts one at a time. **Nothing is ever auto-published** | `docs/ROADMAP.md:121`; issue #107 (P9.5) |
| Per-workspace token and spend display, and a **hard cap the owner sets**, so a drafting loop cannot quietly spend an organiser's budget | `docs/ROADMAP.md:121`; issue #108 (P9.6) |

### Who holds the key, and what it costs

- **The organiser holds it.** They create it at Anthropic or OpenAI, paste it into their own
  workspace, and can revoke it. (`docs/ROADMAP.md:191`)
- **Pariksha ships no model keys and makes no outbound AI request on its own behalf.** (`docs/ROADMAP.md:193`)
- **Pariksha charges nothing for it** — there is no Pariksha billing of any kind (PRD `:63`, non-goal).
  The cost is whatever the organiser's own provider bills them for the tokens they spend, which is
  why the owner-set cap exists.
- **Demo workspaces cannot hold a BYOK key.** (`docs/ROADMAP.md:129`)
- **Phase 9 is off the critical path** — it needs only banks (Phase 4) and encrypted workspace
  settings (Phase 3), and can slip without delaying v1.0. (`docs/ROADMAP.md:179`)

### Exact honest phrasing for a page that cannot claim it today

Use one of these. Each is defensible line by line against the sources above.

> **Bring your own key — planned, Phase 9.** Paste your own Anthropic or OpenAI key into your
> workspace and Pariksha will draft questions from a topic, a syllabus or pasted text. Every draft is
> validated against `pariksha/question@1` before it is stored, lands in a bank unpublished, and waits
> for an author to accept it. Nothing auto-publishes. Pariksha ships no model keys and makes no AI
> request of its own — a deployment with no key behaves exactly as it does now. Not built yet: the
> decision record comes first.

Shorter, for a roadmap card:

> **BYOK question drafting · Phase 9, not built.** Your own Anthropic or OpenAI key, encrypted per
> workspace, never sent to the browser. Drafts questions into a bank, never whole tests. Validated
> like an import, rejected whole if it fails, reviewed by a human before use. You set a spend cap.

**Phrases that would be false today and must not appear:** "AI-powered", "generate a test with AI",
"AI question generation" without a status label, anything implying Pariksha calls a model for you,
any pricing claim, and any suggestion the key store exists. The nearest true adjacent claim is that
`packages/core`'s import validation — the thing a generated batch would be checked against —
**is** shipped and tested today.

---

## 7. Twelve to twenty real questions, with 40–60 word answers

Written as the FAQ copy and as the `FAQPage` JSON-LD payload. Each answer is 40–60 words and sourced.

**Q1. What is Pariksha?**
Pariksha is a free, open-source exam platform that any school, company or community can run on its
own account at zero cost. One deployment hosts many tests, each with its own URL, question sets,
registration form, access rules and proctoring policy. Candidates take tests in a browser; organisers
get scores and integrity reports as CSV. *(PRD `:31`)*

**Q2. Can I use Pariksha today?**
Not as an application. The repository holds the product requirements, the open question and test
formats, their JSON Schemas, a complete worked example and the scoring engine, which is built and
tested. The application lands with v0.1. The formats are stable enough to write questions against
right now. *(`README.md:22`; `packages/core/README.md`)*

**Q3. What does "Pariksha" mean?**
Pariksha — పరీక్ష in Telugu, परीक्षा in Hindi — means "examination". The project's typeface, Anek,
ships Latin, Telugu and Devanagari on one skeleton, so a translated test keeps the same typographic
voice. The name is still being checked for trademark and domain conflicts before public launch.
*(`README.md:24`; `DESIGN.md`; PRD `:684`)*

**Q4. How much does it cost to run?**
Nothing on the reference deployment. Five hundred candidates in one hour fits inside Cloudflare's
free tier: about 55,000 Worker requests against 100,000 a day, 55,000 D1 row writes against 100,000,
and 0.75 GB of snapshots against 10 GB. The arithmetic is published, not asserted. *(PRD `:551-559`;
ADR 0002)*

**Q5. Where is candidate data stored?**
In the organiser's own account — your Cloudflare D1 database and R2 bucket, or your own Postgres and
disk under Docker. There is no Pariksha server in the path. You pick the database region and storage
jurisdiction where the host allows it, and there is no telemetry or third-party script anywhere.
*(PRD `:43`, `S-17`, `S-11`)*

**Q6. How many question types does it support?**
Twelve: single choice, multiple choice, select exactly K, true/false, assertion–reason, matching,
multi-matching, ordering, fill in the blank, numeric with tolerance, short answer and long answer.
Each takes Markdown, code blocks, LaTeX and images. All twelve are implemented and unit-tested in
`packages/core` today. *(`docs/question-format.md:35-50`; `packages/core/README.md`)*

**Q7. How does it stop candidates copying from each other?**
Each candidate can get a different paper. A section draws N questions at random from a pool filtered
by tag and difficulty, or hands out fixed sets A, B and C round-robin by registration order so
neighbours never match. Question order and option order shuffle per candidate; pinned options stay
put. *(PRD `T-08`–`T-10`)*

**Q8. Does Pariksha record video of candidates?**
No. No video and no audio are ever recorded. Strict proctoring takes 320×240 JPEG snapshots, about
25 KB each, every sixty seconds and on each violation, stored in a private bucket behind signed URLs
that expire in ten minutes. Face counting runs on-device and stores no biometric template. *(PRD
`P-06`, `P-07`, `S-16`)*

**Q9. Can browser proctoring actually prevent cheating?**
No, and the documentation says so. Browser checks deter and record; a second phone is invisible to
all of them. Pariksha marks an attempt clean, review or high risk and leaves the judgement to a
person. For high-stakes use the docs recommend a supervised follow-up round. *(`docs/test-format.md:129`;
PRD `:674`)*

**Q10. Is Pariksha better than Google Forms for an exam?**
For an exam, yes on the things that matter: question pools so no two candidates share a paper, twelve
question types rather than three, answer keys that never reach the browser, a server-enforced timer,
unique-field checks that block repeat registrations, and tab-switch logging. A form has none of those.
*(`README.md:30-38`)*

**Q11. How is it different from Mettl, HackerEarth or Testlify?**
They charge per candidate or per month and keep candidate data on their servers. Pariksha is
AGPL-3.0, self-hosted, and designed to cost nothing. You can read and change the scoring code, and
a whole test exports as one JSON file that imports into any other installation, so nothing is trapped.
*(PRD `:36`; ADR 0013; `docs/test-format.md:3`)*

**Q12. Do I have to write JSON to create a test?**
No. Organisers build questions and tests in a UI: one editing screen for all twelve types, a type
picker, a drag-to-reorder section list, live pool counts, and a publish checklist. The JSON exists so
you can hand-author, script, diff or export if you want to — and so nothing you build is locked in.
*(`docs/design.md` UX-06, UX-07, UX-12, UX-17)*

**Q13. Can I write questions before the app exists?**
Yes, and that is the most useful thing to do today. Write them against `pariksha/question@1`, validate
them with one `npx ajv` command against the schemas in `schemas/`, and they will import into Pariksha
on day one. The worked example in `examples/reasoning-aptitude/` is a template to copy. *(`README.md:135-150`)*

**Q14. Can Pariksha generate questions with AI?**
Not yet. Phase 9 plans bring-your-own-key drafting: your own Anthropic or OpenAI key, stored encrypted
per workspace and never sent to the browser, drafting questions into a bank — never whole tests.
Every draft is schema-validated and waits for a human to accept it. Nothing auto-publishes. *(`docs/ROADMAP.md:119-125`)*

**Q15. What licence is it under, and can I sell a service built on it?**
Code is AGPL-3.0, which carries a network-use copyleft clause (§13): you may self-host, modify or embed it,
and any network-accessible service running modified code must provide that source code to users. Documentation,
the JSON Schemas and the sample tests are CC BY 4.0. The name "Pariksha" is not licensed with the code. *(ADR 0013)*

**Q16. What do I need to deploy it?**
A Cloudflare account on the free plan, or any server that runs Docker. The target is under thirty
minutes from clone to a first live test with no paid service. On Cloudflare, organiser sign-in uses
OIDC or magic links, because the free plan's ten-millisecond CPU limit cannot hash a password safely.
*(PRD `:55`, `AC-01`, `S-01`)*

**Q17. How many candidates can it handle at once?**
Five hundred starting within five minutes on the Cloudflare free plan, about 900 candidate-hours a day
before the daily limits bite. Five thousand at once on Workers Paid at five dollars a month, or Docker
on four vCPUs and eight gigabytes with Postgres. Both figures are design targets, not measurements.
*(PRD `:537-538`)*

**Q18. What happens if a candidate's internet drops mid-test?**
Nothing is lost. Answers are queued in the browser and synced on reconnect, with a banner reading
Saving, Saved or Offline, and the server upsert is idempotent by attempt, question and sequence number.
A test continues through drops of up to ten minutes; a browser restart resumes the same questions and
remaining time. *(PRD `C-05`, `C-06`, `:540-541`)*

**Q19. Can candidates take the test on a phone?**
No, not with Standard or Strict proctoring. Phones and tablets are blocked using client hints, user
agent, touch points and viewport width — which also catches an iPad sending a desktop user agent. The
candidate sees "This test needs a laptop or desktop computer." Off-profile tests have no device rule.
*(PRD `P-01`, `AC-17`)*

**Q20. How do I contribute if I do not write TypeScript?**
The most valuable contributions right now need no code: add a question set under `examples/` in your
own subject, translate interface strings, read the PRD and argue with it in an issue, or write a real
test in `pariksha/test@1` and report what you could not express. Original content only, CC BY 4.0.
*(`README.md:165-177`)*

---

## 8. Every number worth printing

| Number | What it is | Measured or estimated | Source |
| --- | --- | --- | --- |
| **12** | Question types | **Measured** — implemented and tested in `packages/core` | `docs/question-format.md:35-50`; `packages/core/README.md` |
| **5** | Scoring modes | **Measured** — all five graded and tested | `docs/question-format.md:52-60` |
| **11** | Registration form field types | Specified (format defines eleven) | `docs/test-format.md:94-106`; PRD `T-16` |
| **4** | Candidate access modes | Specified | `docs/test-format.md:65-70` |
| **3** | Proctoring profiles (Off, Standard, Strict) | Specified | PRD `:288` |
| **3** | Question sources per section (fixed, pool, sets) | **Measured** (selection logic shipped) | `docs/test-format.md:141-168` |
| **7 + 1** | Workspace roles, plus Candidate | Specified | PRD `:79-88` |
| **30 minutes** | Clone to first live test | **Target**, not measured — it is acceptance criterion `AC-01` | PRD `:69`, `:598` |
| **$0** | Hosting cost for 500 candidates in one hour | **Estimated**, with published arithmetic | PRD `:70`, `:551-559` |
| **500** | Candidates at once on the free tier, all starting within 5 minutes | **Estimated** capacity target; `AC-29` is the k6 run that would measure it (Phase 12) | PRD `:537`, `:644` |
| **~900** | Candidate-hours per day before daily limits | **Estimated** | PRD `:537` |
| **5,000** | Candidates at once on Workers Paid ($5/month) or Docker on 4 vCPU / 8 GB | **Estimated** | PRD `:538` |
| **100,000 / day** | Cloudflare Worker requests, free plan — about 55,000 used | Free limit **documented by Cloudflare**; usage **estimated** | PRD `:555`; ADR 0002 |
| **100,000 / day** | D1 rows written — about 55,000 used including indexes | Same | PRD `:556` |
| **5,000,000 / day** | D1 rows read — under 300,000 used | Same | PRD `:557` |
| **10 GB / month** | R2 storage — about 0.75 GB of snapshots used | Same | PRD `:558` |
| **1,000,000 / month** | R2 writes — about 30,000 used | Same | PRD `:559` |
| **10 ms** | Worker CPU per invocation, free plan — the reason there is no password sign-in on Cloudflare | Cloudflare-documented limit | PRD `:565`; ADR 0002 |
| **50** | Subrequests per Worker invocation — every D1, R2 and KV call counts as one | Cloudflare-documented limit | PRD `:566` |
| **0** | Answers lost — the durability requirement and the pilot gate | **Target** (client queue + idempotent upsert) | PRD `:72`, `:540`; `docs/ROADMAP.md:115` |
| **≥ 99%** | Attempts finishing without a technical failure | **Target** | PRD `:71` |
| **300 ms** | p95 API latency target | **Target** | PRD `:539` |
| **2 s** | Answer save confirmed within | **Target** | PRD `:539`, `C-05` |
| **3 s** | First load on 10 Mbps | **Target** | PRD `:539` |
| **300 KB** | Candidate app gzipped budget | **Target** | PRD `:542` |
| **75.7 KB** | Candidate bundle today, gzipped, against that 300 KB budget | **Measured**, in CI | `CHANGELOG.md` Unreleased/Added |
| **3 MB** | Face model, loaded only when Strict proctoring is on | **Estimated** | PRD `:542` |
| **300+** | Candidates in the v0.1 pilot gate, with zero lost answers | **Gate**, not yet run | `README.md:161`; `docs/ROADMAP.md:115` |
| **60 s** | Strict snapshot interval (and it doubles as the heartbeat) | Specified default | PRD `:299`, `:568` |
| **320×240, ~25 KB** | Snapshot size | **Estimated** | PRD `P-06` |
| **5** | Default violation limit (the example test lowers it to 4) | Specified default | PRD `P-09`; `examples/reasoning-aptitude/test.json:148` |
| **90 days / 12 months** | Retention defaults: snapshots / personal data and answers | Specified defaults | PRD `S-13`; `docs/test-format.md:195` |
| **10 minutes** | Signed snapshot URL expiry | Specified | PRD `S-16`, `AC-26` |
| **30 s** | Late-sync grace after the deadline | Specified default | PRD `T-15`; `docs/test-format.md:59` |
| **10 and 2 minutes** | Countdown warnings, configurable | Specified default | PRD `C-07`; `docs/test-format.md:58` |
| **27%** | Discrimination index cohorts (top vs bottom) | Specified (standard psychometric practice) | PRD `R-07` |
| **12** | Build phases underneath the four product milestones | **Measured** (the roadmap has twelve) | `docs/ROADMAP.md:10` |
| **4** | Product milestones: v0.1, v0.2, v0.3, v1.0 | **Measured** | `README.md:154-159` |
| **1 of 12 phases done** | Phase 1 complete; Phase 3 part done | **Measured** state | `docs/ROADMAP.md:30-35` |
| **173** | Tests merged with Phase 1 (PR #134) | **Measured at merge.** A grep of `packages/core/test` today counts 152 `it(`/`test(` calls, so quote the roadmap figure as "Phase 1 landed with 173 tests" or re-measure before printing a bare "173 tests today" | `docs/ROADMAP.md:32` |
| **97 / 93 / 100 / 98 %** | Coverage of `packages/core/src`: statements, branches, functions, lines | **Measured** and gated in CI | `CHANGELOG.md` Unreleased/Changed |
| **17** | Questions in the worked example, covering all 12 types | **Measured** | `examples/reasoning-aptitude/README.md:38` |
| **45 min · 3 sections · 12 questions · 27 points** | The worked example test as a candidate sees it | **Measured** (from `test.json`) | `examples/reasoning-aptitude/README.md:255` |
| **7 points each** | Sets A and B in the worked example, deliberately balanced | **Measured** | `examples/reasoning-aptitude/README.md:95` |
| **0.25** | Negative fraction in the worked example — a wrong answer costs a quarter of the question's points, a blank costs nothing | **Measured** (from `test.json`) | `examples/reasoning-aptitude/test.json:157` |
| **20 colours · 13 type tokens · 43 components** | The design system in `DESIGN.md` | **Measured** | `CHANGELOG.md` Unreleased/Added |
| **2** | Deployment targets from one codebase | Specified | PRD `:449` |
| **14 days** | Security fix turnaround commitment | Specified | PRD `O-05` |
| **7 days** | Member invitation link expiry | Specified | PRD `S-04` |
| **12 hours** | Organiser session idle timeout | Specified | PRD `S-03` |
| **10 minutes** | Candidate email one-time code validity | Specified | `docs/test-format.md:69` |
| **1024 px** | Minimum window width under Standard and Strict | Specified | PRD `:291` |
| **15 s** | Live-monitor refresh interval | Specified | PRD `R-01` |

### Numbers NOT to print

- Any user count, install count, star count or adoption figure — none exists, and the project ships no telemetry by design (PRD `S-11`).
- Any uptime or SLA figure — there is no hosted service (PRD `:63`).
- Any benchmark against a named competitor's speed, price or accuracy — the repository contains no such measurement.
- "173 tests" as a present-tense claim without re-measuring (see the table note above).
- "500 candidates, proven" — `AC-29`, the k6 run that would prove it, is a Phase 12 gate that has not been run.

---

## Writer's checklist, from this inventory

1. Every number on the page traces to §8, with its measured-or-estimated mark honoured in the copy.
2. Every feature on the page carries its §1 status, and nothing marked SPECIFIED or ROADMAP is written in the present tense without a label.
3. The §2(c) admissions appear on the page, not only in a footnote — they are the credibility of everything else.
4. §3 appears as its own section. "Who this is not for" is the strongest trust signal the page has.
5. The code blocks in §4 are the exact text given here; the deploy block carries its §4.4 caveat.
6. The no-code claim (§5) is written as "you never have to, and here is the UI" — never as "no JSON exists".
7. BYOK uses one of the §6 phrasings verbatim or something equally hedged.
8. The §7 answers are the FAQ copy and the `FAQPage` JSON-LD, kept identical between the two.
9. One open question for the owner: the lock glyph in the §4.5 ASCII mock, against the no-emoji rule.
