# Landing page v5 — executive brief

| | |
| --- | --- |
| **Date** | 19 October 2026 |
| **Branch** | `research/landing-v5-content` in the `pariksha-landing` worktree |
| **Scope** | Independent research, teardown, strategy, content blueprint and three prototypes. **Content only — no design decisions, no code changed.** |
| **Research base** | 70+ marketing pages fetched and read across four categories, plus the published evidence base on B2B homepage conversion. Everything is in this folder with URLs and fetch dates. |
| **Truth rule honoured** | Every claim proposed here traces to `.planning/landing/content-inventory.md`. Nothing unbuilt is written in the present tense. |

---

## 1. The verdict in one paragraph

The current page is a technically excellent, intellectually honest **disclosure document**, competing
for the attention of a placement officer who has eleven minutes between meetings. Its engineering —
performance, accessibility, progressive enhancement, structured data, sourced claims — is better
than most funded startups manage. Its *marketing* fails on twelve of the twenty-three applicable
items in the 2026 B2B homepage standard, and every one of those twelve is a **sequencing or framing**
failure rather than a missing capability. **This is an editing job, not a rebuild.**

### The two numbers that contain the whole problem

| | |
| --- | --- |
| Primary call-to-action buttons on the entire page | **1** — in the last band |
| Status-hedge tokens in the body copy (*pre-alpha*, *not built*, *specified*, *Phase n*, *roadmap*) | **40** — one every 41 words in the cost and scope bands |

The page tells a visitor the product is unusable **nine separate times**, including inside the band
whose job is to close.

---

## 2. What the research says, in five findings

### F1 — Nobody in the category apologises in prose. They tag the feature.

Across **31 open-source homepages** (Supabase, PostHog, Cal.com, n8n, Plausible, Metabase, Documenso,
Budibase, Rowy, Coolify, Nextcloud, BookStack, Jitsi…), **not one** used the words "pre-alpha",
"pre-1.0" or "experimental" anywhere on its homepage, and **not one** apologised in a sentence for a
missing feature. The universal pattern is a plain noun-phrase tag beside the specific unfinished
thing — Budibase's `Agents Beta`, Documenso's `Coming Soon` sitting inline next to finished features
with no explanatory copy at all.

**This does not require Pariksha to be less honest.** It requires the same admissions to be *objects*
rather than *prose*: one status chip in the hero, one two-column ledger, per-feature tags, one
five-row filter. The disclosure rate drops from nine times to two. Nothing is deleted.

### F2 — No open-source homepage puts code in the hero. Pariksha's fourth screen is a JSON file.

Zero of 31. The current page's bridge band — a syntax-highlighted `questions.json` — sits at roughly
15% scroll, before any argument about value has been made. The same artefact is *persuasive* at 60%,
as proof of the no-lock-in claim, and fatal at 15%.

### F3 — The hero demo is pointed at the wrong person.

The visitor is made to **sit an exam**. The buyer is the person who **runs** exams. The demo inverts
the role at the exact moment the page establishes who it is talking to, and it demonstrates the
least differentiated surface in the product — a multiple-choice question with radio buttons, which
every competitor and every form tool also has.

The engineering is genuinely ahead of the category: across the whole forms and quiz sector only one
site (OpnForm) ships a genuinely live hero demo; even Kahoot and Mentimeter fake it with static
imagery. And
interactive demos are the strongest-converting hero device currently measured — Storylane reports
7.9× baseline. **Keep the mechanism. Repoint it at the organiser's side: pick a tag and a count, and
watch three candidates get three different papers.** That claim is both shipped today and impossible
in a Google Form — the exact intersection a hero should occupy.

### F4 — The page's most valuable asset is buried in its least valuable band.

*"No video. No audio. Flags, never verdicts."* is a position **no proctoring vendor in the category
can copy** without re-architecting. The best anxiety-defusing line found anywhere in the research is
Proctorio's *"every decision stays with the institution"* — a promise about vendor restraint.
Pariksha can make the structurally stronger version: there is no vendor in the path at all.

Today that argument is a bullet point inside a band titled **"Who is Pariksha not for?"**. It should
be its own band, and it is the band most likely to win an institutional privacy review.

### F5 — The honest status is a thesis, not a deficit — and it is the only CTA the project has.

The current page treats the missing application as something to disclose. It is also a **sequencing
decision worth defending**: Pariksha published the file format, the schemas, a worked example and a
validator *before* the software, so the questions an organiser writes today outlive any tool —
including this one.

That reframe produces the page's first honest call to action. A placement officer's February problem
is not the absence of exam software; it is the absence of a **question bank**, which costs weeks of
subject-expert time and is the long pole in every exam project. Pariksha serves that need **today,
with zero application**:

> **Start your question bank. It will import on day one.**

---

## 3. The recommendation

**Re-sequence and re-write. Keep the components, the design system, the accessibility work and the
truth discipline.**

| # | Band | Heading |
| --- | --- | --- |
| 1 | Hero | Run real exams on the internet, for free, on infrastructure you own. |
| 2 | Signal strip | *(Apache-2.0 · CI green · 97% coverage · 12 types · 5 modes · $0 per candidate)* |
| 3 | The problem | Three hundred candidates, one week, and no budget. |
| 4 | Not a form | A form shows everyone the same paper. An exam should not. |
| 5 | What you get | Twelve question types, five scoring modes, one open file. |
| 6 | Integrity | Integrity without surveillance: no video, no audio, no verdicts. |
| 7 | Privacy | Your account, your database, your retention rules. |
| 8 | Cost | Five hundred candidates in an hour, for nothing. Here is the arithmetic. |
| 9 | Comparison | Against a form tool, and against a paid platform. |
| 10 | Status ledger | What is live today, and what lands with v0.1. |
| 11 | The filter | Pariksha is the wrong tool if… |
| 12 | Open source | Read the code, change it, or sell a service built on it. |
| 13 | FAQ | Questions and answers *(nine kept verbatim, five added)* |
| 14 | Closing | Start your question bank today. It will import on day one. |

Read those headings alone and they form a complete pitch. Read the current eight alone and they form
four questions and no claims — which is exactly what the NN/g layer-cake research says a scanning
reader will take away.

**Shorter, not longer:** roughly 1,650 words against roughly 1,900 today.

---

## 4. Definition of done, measured

| Metric | Today | Target |
| --- | --- | --- |
| Primary CTAs | 1 | 3 (hero, mid, close — same label) plus one in the nav |
| Status-hedge tokens in body copy | 40 | ≤ 8, of which ≤ 2 above the fold |
| Band headings stating a claim | 0 of 8 | 11 of 13 |
| Words before the first benefit statement | ~70 (and it is a disclaimer) | ≤ 20 |
| Scroll depth to the first proof artefact | ~55% | ≤ 25% |
| Named audience above the fold | none | at least one, by role |
| Repo and quality signals above the fold | 0 | 6, in the signal strip |
| JSON visible above 50% scroll | yes | no |
| 2026 homepage checklist items met | 4 / 23 | ≥ 18 / 23 |

---

## 5. Six decisions only the owner can make

Flagged rather than assumed. Each changes the work materially.

1. **What counts as a conversion?** Recommended: *start a question bank* primary, *watch the repo*
   secondary. Everything downstream resolves from this single choice.
2. **Build a first-party intent form?** Three fields on the project's own domain, posting to its own
   D1, no third-party script. It is the **only** way the project learns who its users are before
   v0.1 ships, and the difference between launching with design partners and launching into silence.
3. **May competitors be named?** Recommended: category-level on the homepage; named products only on
   a separate, dated page, and only for facts the vendor publishes about itself — never performance.
   Note that the FAQ already names Mettl, HackerEarth, Testlify and Testportal, so the homepage band
   and the FAQ run on two different rules today.
4. **How much "pre-alpha" survives?** Recommended: exactly one whole-product statement (the hero
   chip) plus per-feature tags. The research found zero precedent for more.
5. **Does the hero demo get repointed to the organiser's side?** Recommended yes; it is the single
   highest-leverage change on the page after the headline.
6. **Keep the "not for" band at all?** The category has no precedent for it. Recommended: keep it —
   it is the clearest expression of the project's character — but at five table rows, late, not nine
   paragraphs mid-page.

---

## 6. One idea beyond the page

The forms and quiz research turned up a pattern worth more than any copy change: **template
galleries as the acquisition engine.** Typeform's 1,000+ template pages are reported as a
$3M-a-year channel; every major form tool uses the same mechanism.

Pariksha has the beginnings of one and does not know it. A public, CC BY 4.0 **question bank
library** — reasoning and aptitude, SQL, basic Python, English comprehension, electrical
fundamentals, each a validated `pariksha/question@1` file — would be:

- the **product you can actually use today**, which the project otherwise lacks;
- a search surface per subject, which is how placement cells and trainers actually search;
- a **contribution path that needs no TypeScript**, which the README already asks for;
- proof the format works, written by people other than the author.

It costs no application code. It is the highest-leverage non-page work this research surfaced, and
it makes the recommended CTA — *start your question bank* — land on something, instead of on a
schema file.

---

## 7. What is in this folder

| File | What it is |
| --- | --- |
| `00-executive-brief.md` | This document |
| `05-teardown-current-page.md` | Twelve specific defects in the current page, walked as three personas, plus what must survive |
| `06-positioning-and-strategy.md` | Positioning statement, the three audiences, message hierarchy, the honesty system, the conversion model |
| `07-content-blueprint.md` | The recommended spine, band by band, with copy, proof objects, sources and word budgets |
| `08-copy-bank.md` | Every line with alternates: headlines, subheads, CTAs, band headings, pillar copy, the filter, FAQ additions, lines to retire |
| `09-scorecard-against-standards.md` | The current page scored against the 27-item 2026 standard, with a measured definition of done |
| `10-comparison-strategy.md` | What the comparison band may claim, the evidence standard for naming competitors, the new table, the Moodle answer |
| `research-01-exam-platforms.md` | 18 assessment and proctoring platforms, verbatim headlines, spines, proof devices, pricing, what to steal and reject |
| `research-02-open-source.md` | 31 open-source homepages, the modal spine, self-host framing, and every example found of early-stage honesty handled with confidence |
| `research-03-saas-standards.md` | The 27-item evidence-based checklist, conversion benchmarks with sources and sample sizes, and a list of widely repeated unsourced claims to avoid |
| `research-04-forms-quiz.md` | Form, quiz and edtech pages; template-gallery strategy; what actually beats "I'll just use a Google Form" |
| `prototypes/` | Three runnable HTML content prototypes — executive-first, open-source-first, story-first — plus a README comparing them |

**Start with the prototypes.** Open `prototypes/a-executive-first.html` in a browser; it is the
recommendation in a form you can read in four minutes.
