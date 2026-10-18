# Content blueprint: the page, band by band

| | |
| --- | --- |
| **Status** | Recommendation — the spine the prototypes are built from |
| **Inputs** | `05-teardown`, `06-positioning-and-strategy`, `research-01`…`research-04`, `09-scorecard`, `10-comparison-strategy`, and `.planning/landing/content-inventory.md` for every claim |
| **Design** | Deliberately out of scope. Nothing here depends on a visual decision. Bands are content objects. |
| **Length target** | 13 bands + footer. Roughly 1,400–1,700 words of body copy, against roughly 1,900 today — **shorter, not longer.** |

---

## 0. The four rules this spine obeys

1. **The heading-only read is a complete argument.** (NN/g layer-cake scanning, 2019-08-04 — see
   `research-03` §2.) Every band heading is a claim.
2. **The first two screenfuls carry the value proposition, the audience and the first CTA.**
   (NN/g: 74% of viewing time in the first ~2,160 px, 2018-04-15.)
3. **Status is four designed objects, never prose.** Across 31 open-source homepages,
   **not one** used the words "pre-alpha", "pre-1.0" or "experimental", and not one apologised in a
   sentence for an unfinished feature; the universal pattern is a plain per-feature tag
   (`research-02` §4). Pariksha keeps exactly one whole-product status statement — the hero chip —
   and tags everything else at the feature.
4. **Nothing unbuilt is written in the present tense without a tag.** The `content-inventory.md`
   rule survives intact; only its *delivery* changes.

---

## 1. The spine

| # | Band | Heading | Job | Audience | Words |
| --- | --- | --- | --- | --- | --- |
| 0 | Nav | — | Orient, and carry the CTA | All | — |
| 1 | **Hero** | Run real exams on the internet, for free, on infrastructure you own. | Say what it is, who it is for, what to do | Priya ▸ Meera | 60 |
| 2 | **Signal strip** | *(no heading)* | Credibility in six facts, no adoption claims | Arjun ▸ Meera | 25 |
| 3 | **The problem** | Three hundred candidates, one week, and no budget. | Name the situation in the buyer's words | Priya | 110 |
| 4 | **P1 — not a form** | A form shows everyone the same paper. An exam should not. | Defeat the status quo | Priya | 180 |
| 5 | **What you get** | Twelve question types, five scoring modes, one open file. | The capability inventory, tagged | Priya ▸ Arjun | 220 |
| 6 | **P3 — integrity** | Integrity without surveillance: no video, no audio, no verdicts. | The most defensible position the project owns | Meera ▸ Priya | 170 |
| 7 | **Privacy and control** | Your account, your database, your retention rules. | The procurement answer, before it is asked | Meera | 150 |
| 8 | **Cost** | Five hundred candidates in an hour, for nothing. Here is the arithmetic. | Remove the price objection with evidence | Priya ▸ Meera | 160 |
| 9 | **Comparison** | Against a form tool, and against a paid platform. | Create preference | Meera ▸ Priya | 90 + table |
| 10 | **Status ledger** | What is live today, and what lands with v0.1. | Honesty, once, properly | All | 120 + ledger |
| 11 | **The filter** | Pariksha is the wrong tool if… | Qualify out, fast | All | 20 + table |
| 12 | **Built in the open** | Read the code, change it, or sell a service built on it. | Licence, decisions, contribution | Arjun ▸ Meera | 140 |
| 13 | **FAQ** | Questions and answers | Search and LLM surface | All | existing + 5 |
| 14 | **Closing** | Start your question bank today. It will import on day one. | The repeat CTA | All | 40 |
| — | Footer | — | Docs, project, licence | All | — |

**Removed from the current page:** the hero JSON bridge band (moves to band 5), the methodology
paragraph in the comparison band, the nine-paragraph "not for" prose, the self-referential closing
line about the page being Phase 3's output.

**Added:** the signal strip, the problem band, the integrity band, the privacy band, the
open-source band, and a nav CTA.

---

## 2. Band 0 — Navigation

```
Pariksha  పరీక్ష · परीक्षा        What it is   Features   Cost   Docs   GitHub   [ Start your question bank ]
```

Three fixes against today:

- **The nav carries the primary CTA.** It is the only element visible at every scroll depth.
- **"Docs" must stop pointing at the footer.** Today `#docs` is the footer element's own id, so the
  nav drops a reader at the licence column. Point it at `docs/` in the repository, or give the
  documentation band its own anchor.
- **Add anchors for `#compare`, `#status` and `#faq`** — the three destinations a returning or
  forwarded visitor wants.

---

## 3. Band 1 — Hero

**Heading (H1)**

> Run real exams on the internet, for free, on infrastructure you own.

**Status chip**, beside the wordmark, mono, small:

> `PRE-ALPHA · SCORING ENGINE AND FORMATS LIVE · v0.1 IN PROGRESS`

**Lead**

> For placement cells, training institutes and teams that have to test hundreds of people: twelve
> question types, a different paper for every candidate, proctoring that records no video, and a
> results CSV. Apache-2.0, on your own Cloudflare account or server.

**Actions** — three parallel buttons, the BookStack pattern for a project with no hosted tier
(`research-02` §5). Do **not** manufacture a "Cloud / Self-host" pair; there is no cloud, and
inventing the second button would be the page's first lie.

| Button | Target |
| --- | --- |
| **Start your question bank** (primary) | The format docs + the worked example, with the `npx ajv` command |
| **See a real exam, end to end** (secondary) | `examples/reasoning-aptitude/` |
| **Read the code** (tertiary, text) | The repository |

**Microcopy under the buttons**

> No account. No install. One `git clone` and a schema.

**The hero visual — the single biggest change**

Replace the three-question candidate quiz with **the organiser's side of the product**: a pool draw.

> **Give everyone a different paper.** Pick a tag and a count. Watch three candidates get three
> different papers from the same bank.
>
> `tag: reasoning` · `draw: 4 of 11` → *Ananya: LOG-001, LOG-004, SER-002, LOG-007* ·
> *Rahul: LOG-003, SER-001, LOG-001, LOG-009* · *Fatima: SER-002, LOG-006, LOG-002, LOG-004*

Why this and not the quiz:

- It casts the visitor as **the buyer** (the organiser), not as a candidate. The current demo
  inverts the role at the exact moment the page establishes who it is talking to.
- It demonstrates the one capability that is **both shipped today** (`packages/core/src/select.ts`,
  seeded, tested) **and impossible in a Google Form** — the precise intersection a hero should own.
- Interactive demos are the strongest-converting hero device currently measured (Storylane: 7.9×
  baseline; `research-03` §10), and across the whole forms/quiz category **only one site**
  (OpnForm) ships a genuinely live hero demo — the rest fake it with static imagery
  (`research-04`). Pariksha already has the engineering for a real one. Point it at the right claim.
- Across 31 open-source homepages, **none** put code or a JSON document in the hero
  (`research-02` §1). The existing bridge band moves to band 5.

Keep the candidate quiz. It becomes the proof object inside band 4, where "what the candidate sees"
is the point.

**Accessibility and no-JS behaviour carry over unchanged.** The prerendered state should show one
completed draw, with the interaction as the enhancement — exactly the pattern the current demo
already implements well.

---

## 4. Band 2 — Signal strip

No heading. One row, mono, directly under the hero — the position every open-source homepage in the
research uses for credibility signals (`research-02` §1, move 2).

> `APACHE-2.0` · `CI GREEN` · `97% COVERAGE ON THE SCORING ENGINE` · `12 QUESTION TYPES` ·
> `5 SCORING MODES` · `$0 PER CANDIDATE`

Rules:

- **No adoption numbers.** No stars, installs, users or downloads — forbidden by
  `content-inventory.md` §8 and unavailable anyway.
- Every item is a fact about **the work**, not about **the market**. Coverage is measured and gated
  in CI (`CHANGELOG.md`); the type and mode counts are implemented and tested.
- Once a star count exists and is worth printing, it may join this strip **as a project-activity
  signal**, never captioned as adoption.

This strip is what satisfies the one standard the current page fails for free: repo and quality
signals within the first two scrolls (`research-03` §1 item 15).

---

## 5. Band 3 — The problem

**Heading**

> Three hundred candidates, one week, and no budget.

**Copy**

> A placement cell screening a graduating class. A training institute certifying a cohort. A
> sixty-person company that needs a shortlist by Friday. All three need the same four things: a
> different paper for every candidate, a clock nobody can edit, some idea of who was looking at
> another window, and a spreadsheet at the end.
>
> A form tool gives you none of them. An assessment platform gives you all four and charges by the
> candidate, on its own servers, under its own terms. Pariksha is the third option: the same four
> things, running in an account you already have, for nothing.

*Sources: PRD `:34`, `:36`; `content-inventory.md` §2.*

Why this band exists: every converging teardown puts a problem statement between the hero and the
solution (`research-03` §3), and StoryBrand's hero/guide structure requires the buyer's situation
to be named before the product is. The current page has no such band — it moves from "what is it"
straight to "how it works".

---

## 6. Band 4 — A form shows everyone the same paper

**Heading**

> A form shows everyone the same paper. An exam should not.

**Copy**

> Pariksha draws each candidate's paper from a pool you tag and filter — *four questions tagged
> `quantitative`, medium difficulty* — or hands out fixed sets A, B and C round-robin by
> registration order, so neighbours never sit the same questions. Options shuffle underneath,
> except the ones you pin.
>
> The answer key never leaves the server. The clock is the server's, so changing the computer's
> time does nothing, and an answer arriving thirty seconds after the deadline is refused. A field
> marked unique refuses a second registration with the same roll number.

**Proof object: the candidate's screen.** The three-question demo from today's hero lands here,
captioned for what it now proves:

> This is what a candidate sees — and the options are shuffled per candidate, so 127 is not always
> second.

**Plain-mechanism naming.** The forms and quiz category sells anti-cheating in plain verbs —
*"Block tab switching and disable copy-paste"*, *"Randomize questions so no two exams are the
same"* (`research-04`). Match that register. Avoid "integrity architecture" and "proctoring
profile" in this band; those belong in band 6 where they are defined.

*Sources: PRD `T-08`–`T-10`, `T-17`, `S-10`; `docs/test-format.md:59`, `:61`;
`packages/core/src/select.ts`.*

---

## 7. Band 5 — What you get

**Heading**

> Twelve question types, five scoring modes, one open file.

Six cards, grouped by the organiser's job, each with a plain status tag — the Budibase/Documenso
pattern: a noun-phrase label beside the feature, never a sentence of apology (`research-02` §4).

| Card | Tag | One line |
| --- | --- | --- |
| **Write questions worth asking** | `LIVE` | Twelve types including matching, multi-matching, ordering and numeric with tolerance. Markdown, LaTeX, code and images in every one. |
| **Score them your way** | `LIVE` | All-or-nothing, partial credit, negative marking, position-based ordering, rubrics. Change a key afterwards and regrade every attempt. |
| **Give everyone a different paper** | `LIVE` | Pools filtered by tag and difficulty, fixed sets A/B/C, seeded shuffling that survives a refresh. |
| **Build the test** | `v0.1` | A type picker, one editing screen for all twelve types, drag-to-reorder sections, live pool counts and a publish checklist. |
| **Run it and watch it** | `v0.1` | Registration form, access codes, server clock, live monitor, three proctoring profiles. |
| **Get the results** | `v0.1` | One CSV row per candidate, with a column per section and per registration field, rank, pass/fail and integrity flag. |

**The no-code line, promoted out of a footnote:**

> You never write JSON. The format exists so that you *can* — and so that nothing you build is
> trapped.

**The JSON block lands here**, not in the hero: `LOG-001` with its key and explanation, captioned
*the key and the explanation live in the file, never in the candidate's browser.*

*Sources: `content-inventory.md` §1 Jobs A–F and §5; `docs/design.md` UX-06, UX-07, UX-12, UX-17.*

---

## 8. Band 6 — Integrity without surveillance

**Heading**

> Integrity without surveillance: no video, no audio, no verdicts.

**Copy**

> Strict proctoring takes a 320×240 snapshot about every sixty seconds, counts faces on the device
> itself, and stores no biometric template. Nothing is streamed. Nothing is recorded. Snapshots sit
> in your own private bucket behind links that expire in ten minutes, and the default is to delete
> them after ninety days.
>
> Tab switches, fullscreen exits and copy attempts are logged, and the candidate sees a counted
> warning rather than a silent mark against them. At the end Pariksha marks the attempt **clean**,
> **review** or **high risk** — and stops. A person decides what that means.
>
> Browser checks deter and record. They cannot prove: a second phone is invisible to every one of
> them, and our documentation says so. That is precisely why no machine here is allowed to reach a
> verdict.

**Proof object:** three rows of the real results CSV, with the `high_risk` row that was *not*
cancelled, and its caption:

> The app recorded five tab switches and three fullscreen exits and marked the attempt high risk. It
> did not cancel her result. A reviewer looked, wrote a note, and invited her to a supervised
> re-test.

*Sources: PRD `P-06`, `P-07`, `P-09`, `P-10`, `S-13`, `S-16`; `docs/test-format.md:129`; PRD `:674`;
`examples/reasoning-aptitude/README.md:420`.*

**Why this band is the page's most valuable new object.** The category research found the single
best anxiety-defusing line anywhere is Proctorio's *"Institutions decide how AI is used… every
decision stays with the institution"* — a promise about vendor restraint. Pariksha can make the
structurally stronger version of it: there is no vendor in the path at all. And across the whole
assessment category, "we do not record video" is a claim **no proctoring vendor can make**
(`research-01` §4). Today this argument is a bullet inside a band titled "Who is Pariksha not for?".

---

## 9. Band 7 — Your account, your database, your retention rules

**Heading**

> Your account, your database, your retention rules.

Written for the person who will be asked to sign off — short sentences, concrete nouns, no
architecture lecture.

> Candidate data lives in your own Cloudflare account or your own server. There is no Pariksha
> server in the path, no telemetry, and no third-party script anywhere — including on this page,
> which serves its own fonts under a `default-src 'self'` policy.
>
> You choose the database region and the storage jurisdiction where your host allows it. Retention
> defaults to ninety days for snapshots and twelve months for personal data and answers, and a daily
> job deletes and logs it. A candidate can ask for their data to be exported or erased. Every
> sign-in, role change, publish, key change, regrade, export and deletion lands in an append-only
> audit log.
>
> The consent screen is text you write. A data-processing template for GDPR and India's DPDP Act
> 2023 ships with the documentation.

Tag the band's unbuilt half honestly — retention jobs, export/erase and the audit log are `v0.1`
and after; the no-telemetry, no-third-party-script and self-hosting claims are **true today and
demonstrated by this page**.

*Sources: PRD `:43`, `S-11`–`S-19`; `CHANGELOG.md` Unreleased/Added.*

**Why it earns a band:** 80% of the B2B buying journey now happens before any vendor contact, with
roughly nine stakeholders involved (`research-03` §7). The compliance answer has to be findable by
scanning. Today it is split across a FAQ answer, a footer paragraph and a clause in band 6.

---

## 10. Band 8 — Cost

**Heading**

> Five hundred candidates in an hour, for nothing. Here is the arithmetic.

Keep the existing band almost unchanged — it is the best-built section on the page. Three edits:

1. **Lead with the claim, then the table.** Today the band opens with a 50-word qualification.
2. **Keep the `AC-29` caveat**, as one line under the table, not as the band's framing.
3. **State the pricing model in one line**, the way the category does with its models
   (`research-01` §4 item 8) — and note that most competitors publish no price at all:

> **The model, in full:** nothing, ever, to Pariksha. There is no Pariksha billing of any kind and
> no hosted service to bill for. Your only cost is infrastructure you already own — or the free tier
> you already have.

**Named risk stays**: free-tier limits can change; the mitigation is the adapter architecture and
the Docker path.

*Sources: PRD `:70`, `:551-559`, `:63`, `:675`; ADR 0002.*

---

## 11. Band 9 — Comparison

Replace the current table wholesale with the ten-row table in `10-comparison-strategy.md` §3.
Price and data residency become rows one and two; the clock, recording and who-decides are added;
exit cost is added; the methodology paragraph is cut to one dated line; the concession moves to the
status ledger; Moodle becomes a dated footnote that recommends Moodle where Moodle is right.

**Closing line of the band:**

> Nothing here is a benchmark. Every row is either what Pariksha does, or what the other two
> categories publish about themselves, read in October 2026.

---

## 12. Band 10 — The status ledger

**Heading**

> What is live today, and what lands with v0.1.

Two columns, no prose, every feature on the page appearing in exactly one of them.

| Live and tested today | Specified — lands with v0.1 |
| --- | --- |
| The question and test formats, and their JSON Schemas | The authoring UI and the test builder |
| All 12 question types, graded | The candidate runtime |
| All 5 scoring modes | Proctoring |
| Pool draws, set assignment, seeded shuffling | The results CSV, live monitor and grading queue |
| Cross-field import validation | The API and webhooks |
| A 17-question worked example covering all 12 types | Organiser sign-in, roles and workspaces |
| This website | — |

**Beside it, the "today you can" box** — the piece that turns honesty into an offer:

> **What you can do today**
> 1. Write your question bank. The format is published and stable; questions written today import on
>    day one, or into anything else — the schemas are CC BY 4.0.
> 2. Validate it in one command. One `npx ajv` run, no install, no account.
> 3. Read a whole exam, end to end — seventeen questions, three sections, the candidate's screen and
>    the results CSV it produces.
>
> **What you cannot do yet:** run a test. The application lands with v0.1.

**Under the ledger**, two lines moved here from elsewhere, verbatim:

> A paid platform you can buy today will do more than Pariksha does today, because the Pariksha
> application is not built yet. What is built is the format, the schemas and the scoring engine —
> and you can run those today.

Plus the roadmap link, and a dated "last shipped" line — the version-as-freshness mechanic
(`research-02` §4 item 6): *a visible v0.x paired with a changelog reads as alive, not incomplete.*

---

## 13. Band 11 — The filter

**Heading**

> Pariksha is the wrong tool if…

The five-row table from `08-copy-bank.md` §8. No preamble. Four of the current nine items move into
the integrity band, the FAQ and row four rather than disappearing.

**A note on keeping this band at all.** The assessment category uses no such section anywhere
(`research-01` §5 item 5), and no open-source homepage researched apologised in prose for missing
features (`research-02` §4). Two reasons to keep a compressed version regardless:

1. The product genuinely cannot serve several common cases, and a buyer who discovers that after
   investing a week is a worse outcome than one who leaves in ten seconds.
2. It is the clearest expression of the project's actual character, and it is cheap at five rows.

What the research does establish is that **nine paragraphs, mid-page, in prose** has no precedent
and no supporting evidence. Five rows, late, in a table, does the same job at a fraction of the cost.

---

## 14. Band 12 — Built in the open

**Heading**

> Read the code, change it, or sell a service built on it.

> Apache-2.0, with an explicit patent grant: self-host it, modify it, embed it, or offer a paid
> service built on it, including a closed one. Documentation, schemas and example tests are CC BY
> 4.0. There is no contributor licence agreement.
>
> Every architectural decision is a dated record you can disagree with — why Cloudflare with
> adapters, why Apache-2.0 — and the build order is twelve public phases.
>
> **The most useful contribution right now needs no code**: add a question set in your own subject
> under `examples/`, translate interface strings, or write a real test in `pariksha/test@1` and
> report what you could not express.

Links: repository · good first issues · ADRs · roadmap · contributing.

*Sources: ADR 0003; `docs/adr/`; `README.md:165-177`; `docs/ROADMAP.md`.*

---

## 15. Band 13 — FAQ

Keep all nine existing answers **verbatim**. They are the best-executed content on the page and the
most citable by search and by language models (`research-03` §10). Add the five in
`08-copy-bank.md` §11: who it is for, cost per candidate, whether a developer is needed, what
happens if the project stops, and accessibility.

Keep the `FAQPage` JSON-LD identical to the visible copy.

Drop the standfirst — *"These answers describe Pariksha as specified. The application is pre-alpha
as of October 2026"* — because band 10 now carries that, forty words earlier and better.

---

## 16. Band 14 — Closing

**Heading**

> Start your question bank today. It will import on day one.

> The format is published and stable. Questions you write this week load into Pariksha when v0.1
> lands — and into anything else, because the schemas are open and CC BY 4.0.

| Button | Target |
| --- | --- |
| **Start your question bank** (same label as the hero — do not invent a third verb) | Format docs + worked example |
| **Watch the repo for v0.1** (secondary) | The repository |

---

## 17. The gap this blueprint cannot close

The page has **no way to capture intent**. Every action it offers exits to GitHub, which requires an
account most placement officers do not have and which the project cannot measure.

**Recommended, as a small follow-on build:** a first-party form on the project's own domain — three
fields (what you need to run, roughly how many candidates, an email), posting to the project's own
D1, no third-party script, consistent with every privacy promise on the page. It would be the only
mechanism by which the project ever learns who its users are before v0.1 ships, and it is the
difference between a launch with design partners and a launch into silence.

Until it exists, the closing band's secondary CTA is **"Watch the repo for v0.1"**, which is honest
and free.

---

## 18. Measurable definition of done

From `09-scorecard-against-standards.md`:

| Metric | Today | Target |
| --- | --- | --- |
| Primary CTAs | 1 | 3, same label, plus nav |
| Status-hedge tokens in body copy | 40 | ≤ 8; ≤ 2 above the fold |
| Band headings stating a claim | 0 / 8 | 11 / 13 |
| Words before the first benefit statement | ~70 | ≤ 20 |
| Scroll depth to first proof artefact | ~55% | ≤ 25% |
| Named audience above the fold | none | at least one role |
| Repo/quality signals above the fold | 0 | 6, in the signal strip |
| JSON above 50% scroll | yes | no |
| Checklist items met (`research-03` §1) | 4 / 23 | ≥ 18 / 23 |
