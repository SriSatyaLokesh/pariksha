# Positioning, audience and message strategy

| | |
| --- | --- |
| **Written as** | Marketing strategist + business analyst, independent of the build team |
| **Date** | 19 October 2026 |
| **Inputs** | `docs/PRD.md`, `README.md`, `docs/ROADMAP.md`, `.planning/landing/content-inventory.md` |
| **Rule inherited** | Every claim traceable to `content-inventory.md`. This document changes *emphasis and sequence*, never truth. |

---

## 1. The strategic problem, stated honestly

Pariksha cannot be used as an application today. A landing page for a product nobody can run has
exactly one legitimate job:

> **Convert attention into commitment that survives until v0.1.**

Not "sign up". Not "start free trial". The page is a **pre-launch page**, and it must be designed as
one. Every page that tries to look like a mature SaaS homepage while hiding that it has no product
reads as either confusing or dishonest. Every page that leads with *"we have no product"* converts
nobody. The whole craft of this rewrite sits between those two failures.

### 1.1 The reframe that resolves it

The current page treats the missing application as a **deficit to disclose**. It is also a
**sequencing decision to defend** — and defending it converts, where disclosing it does not:

> **Pariksha built the file format before it built the software, on purpose. That means the work you
> do now outlives any tool — including this one.**

This is true (`docs/question-format.md`, `schemas/`, ADR 0003, CC BY 4.0 content licence), it is
unusual, and it turns the project's weakest fact into its most distinctive one.

It also unlocks the only honest call to action the project currently has:

> **Your question bank is the part you need first, and it is the part that already works.**
> Write it today against a published schema, validate it with one command, and it imports into
> Pariksha on day one — or into anything else, because the format is open and CC BY 4.0.

A placement officer's February problem is not the absence of exam software. It is the absence of a
question bank, which takes weeks of subject-expert time and is the long pole in every exam project.
Pariksha serves that need **today, with zero application**. That is a real offer, not a waitlist.

**Name for the strategy, used throughout this folder: "the format is the product today."**

---

## 2. Positioning statement

Built on April Dunford's components, so each line is falsifiable.

| Component | Pariksha |
| --- | --- |
| **Competitive alternatives** (what they'd do otherwise) | 1. A Google or Microsoft Form. 2. A paid assessment platform (Mettl, HackerEarth, Testlify, Testportal). 3. Moodle plus Safe Exam Browser. 4. Pen and paper in a hall. |
| **Unique attributes** (only we have) | Open, versioned JSON test and question formats with published schemas · Apache-2.0 scoring engine you can read and change · runs on free-tier infrastructure in the organiser's own account · proctoring that never records video or audio · flags, never verdicts · no telemetry, no third-party script anywhere |
| **Value those enable** | Zero marginal cost per candidate · candidate data never leaves your account · no lock-in — a whole test is one portable file · an integrity story that survives a privacy review · an exam you can audit line by line |
| **Who cares most** | Organisations that (a) run tests repeatedly, (b) have little or no budget for them, and (c) answer to someone about where candidate data lives |
| **Market category** | Self-hosted exam and assessment platform — the open-source alternative to per-candidate assessment vendors |

### 2.1 The one-paragraph positioning

> For placement cells, training institutes and small companies that must test hundreds of people and
> cannot pay per candidate, Pariksha is a free, open-source exam platform you run on your own
> Cloudflare account or server. Unlike form tools, it gives every candidate a different paper, hides
> the answer key from the browser and runs the clock on the server. Unlike paid assessment
> platforms, it costs nothing per candidate, keeps the data in your account, and exports a whole
> test as one open file — so nothing you build is ever trapped.

---

## 3. Audiences, and what each one must be able to do

Three audiences, one page. Trying to serve all three equally is how the current page ended up
serving only one.

| | **Priya** — the organiser | **Arjun** — the engineer | **Meera** — the executive |
| --- | --- | --- | --- |
| Role | Placement cell head, training manager, professor, HR lead | Developer evaluating or contributing | CTO, dean, director, procurement |
| Arrives from | Search: "free online exam software", "Google Forms alternative for exams" | GitHub, Hacker News, a colleague | A forwarded link from Priya or Arjun |
| Reads | First screen, then headings, then one table | The code block, the repo, the roadmap | Headings only, then the risk sections |
| Wants to know | "Can this run my February exam, and what will it cost me?" | "Is this real, is it well built, is it worth my time?" | "Is this safe, is it serious, and what does it commit us to?" |
| Decides on | Capability + effort + cost | Code quality + licence + architecture | Data control + credibility + exit risk |
| **Must be able to do** | Understand the offer in 10 seconds; see what it produces; learn how to start now | Reach the repo, the formats and a good first issue in two clicks | Scan headings and get a complete argument; find privacy, licence and status without digging |
| **Page priority** | **Primary** — the page is written for her | Secondary — served by a dedicated rail and band | Secondary — served by heading discipline and two bands |

**Design consequence.** Write the body copy for **Priya**, keep a persistent **developer rail** (nav
links to Docs / GitHub, a "Built in the open" band, code where it proves something), and serve
**Meera** by making every band heading a claim she can read in sequence without reading a paragraph.

### 3.1 The heading-only test

The page passes when its headings, read alone, form a complete argument. Target sequence:

1. Run real exams on infrastructure you own — free, open source, no per-candidate fee.
2. A form shows everyone the same paper. An exam shouldn't.
3. Twelve question types, five scoring modes, one open file.
4. Integrity without surveillance: no video, no audio, flags never verdicts.
5. Your account, your data, your retention rules.
6. Five hundred candidates in an hour, for nothing — here is the arithmetic.
7. What is live today, and what lands with v0.1.
8. Who Pariksha is not for.
9. Start your question bank today; it will import on day one.

That is a complete pitch with zero body text read. The current page's heading-only pass yields four
questions and no claims.

---

## 4. Message hierarchy

### 4.1 The primary claim (the one thing)

> **Run real exams for hundreds of candidates, on infrastructure you already own, at zero cost per
> candidate — with the data and the code in your hands.**

### 4.2 The three pillars

Each pillar is chosen to defeat a *different* competitive alternative. That is deliberate: a pillar
that beats nobody is a feature list.

| Pillar | Defeats | Headline claim | Proof on the page |
| --- | --- | --- | --- |
| **P1 — A real exam, not a form** | Google Forms, Microsoft Forms | Every candidate gets a different paper, the key never reaches the browser, and the clock belongs to the server | Pool draws and A/B/C sets (shipped); 12 types vs 3; `S-10`/`AC-22`; 30 s late-sync rule |
| **P2 — Your account, your data, no bill** | Mettl, HackerEarth, Testlify, Testportal | $0 for 500 candidates in an hour, with the arithmetic published — and the whole test exports as one open file | Free-tier budget table; Apache-2.0 + patent grant; `pariksha/test@1`; no telemetry, no third-party scripts |
| **P3 — Integrity without surveillance** | Every proctoring vendor | No video. No audio. Snapshots only, face counting on-device, and the software never decides who cheated | `P-06`, `P-07`, `P-10`; "flags, never verdicts"; the `high_risk` row in the real results CSV |

**P3 is the project's most defensible and least-used asset.** It is an ethical architecture
competitors cannot copy without rebuilding, it is exactly what a school's privacy reviewer asks
about, and today it is a bullet point in a band titled "Who is Pariksha not for?".

### 4.3 The supporting claims (second tier)

- Twelve question types including matching, multi-matching, ordering and numeric-with-tolerance.
- Five scoring modes, including partial credit and negative marking, implemented and unit-tested.
- A registration form you design, with fields that block a second registration.
- One deployment, many tests, each with its own URL, QR code and access rules.
- Results as a CSV your spreadsheet already understands.
- You never write JSON — the format exists so that you *can*, not so that you must.

---

## 5. The honesty system: 40 tokens become 4 objects

The constraint is non-negotiable: nothing unbuilt may be written in the present tense. The *method*
of honouring it is what changes.

**Replace scattered prose hedging with four discrete, designed objects:**

| # | Object | Where | Content |
| --- | --- | --- | --- |
| **H1** | **One status chip** | Hero, beside the wordmark | `PRE-ALPHA · v0.1 IN PROGRESS` — linked to the status band |
| **H2** | **One "Today / v0.1" ledger** | Its own band, two-thirds down | Two columns: *Live and tested today* / *Specified, lands with v0.1*. No prose. Every feature in the page appears in exactly one column. |
| **H3** | **Per-feature status chips** | In the feature grid only | A small `LIVE` or `SPEC` chip on each card. One word, not a sentence. |
| **H4** | **One "not for" filter** | Late, after the FAQ's work is done | Reduced from nine paragraphs to a table of five, each one line |

Everywhere else, status disappears from prose. The rule becomes mechanical and testable:

> **A feature may be described in the present tense anywhere on the page if and only if it carries a
> status chip, or appears in the H2 ledger.** No sentence contains both a feature and a disclaimer.

This preserves every admission in `content-inventory.md` §2(c) and §3 while cutting the *number of
times the reader is told the product is unfinished* from nine to **two** (the hero chip and the
ledger).

### 5.1 Where the admissions go

| Admission (from `content-inventory.md` §2c) | New home |
| --- | --- |
| The application does not exist yet | H1 chip + H2 ledger headline |
| You cannot click a button and run a test today | H2 ledger, and the "Today you can" box beside it |
| Browser proctoring is beatable | **P3's own band** — stated as the reason flags are not verdicts. It is a *strength* argument when it stands next to "and that is why no machine decides". |
| No live proctoring, no lockdown browser, no code runner | H4 "not for" table |
| Phones and tablets blocked | H4 table + FAQ |
| Password sign-in unavailable on Cloudflare free plan | FAQ only |
| Accessibility is a target, not a measured result | Status ledger footnote |
| Moodle is more capable today | Comparison band footnote, not conclusion |
| Free-tier limits can change | Cost band, as the named risk with its mitigation (the adapters) |
| Small maintainer team | Contribute band, as a *reason to join*, not a warning |

Nothing is deleted. Nine things move, and the page stops repeating them.

---

## 6. Conversion model

The page cannot "sign up" anyone. It must still convert, so define what conversion *is*:

| Priority | Action | Audience | Friction | Measurable without trackers? |
| --- | --- | --- | --- | --- |
| **1** | **Start a question bank today** — clone the example, write questions, validate | Priya + Arjun | Medium | No (GitHub-side) |
| **2** | **Watch / star the repository** for v0.1 | All | Low | Yes (GitHub's own count, read manually) |
| **3** | **Tell us what you need to run** — a short, self-hosted intent form | Priya + Meera | Low | Yes, first-party |
| **4** | **Read the worked example** end to end | All | Low | No |
| **5** | **Take a good first issue** | Arjun | High | Yes (GitHub) |

**Recommendation:** adopt #1 as the page's primary CTA and #2 as the secondary, because both are
honest, available today, and need no infrastructure. Treat #3 as a near-term build: a
first-party form on the project's own domain, no third-party script, storing to the project's own
D1 — consistent with the privacy promise and the only way the project will ever learn who its users
are. It is the single highest-value addition the page could make.

### 6.1 CTA wording

| Slot | Label | Why |
| --- | --- | --- |
| Hero primary | **Start your question bank** | Action available today, specific, implies ownership |
| Hero secondary | **See a real exam, end to end** | Zero-commitment, points at the project's best asset |
| Nav | **GitHub** (with star count once it is worth showing) | Convention for the category |
| Mid-page repeat | **Validate your first question in one command** | Proof-shaped, for the engineer |
| Closing primary | **Start your question bank** | Repeat the same label; do not invent a third verb |
| Closing secondary | **Watch the repo for v0.1** | The honest "notify me" |

Avoid: "Get started free" (implies a running product), "Try it now" (there is nothing to try),
"Book a demo" (there is no demo and no sales team), "Sign up" (there is nothing to sign up to).

---

## 7. What the page must stop doing

1. Stop asking the visitor to take a quiz before telling them what the product is.
2. Stop spending the H1 on the brand name.
3. Stop putting status in the subhead.
4. Stop printing JSON above the 50% scroll line.
5. Stop writing headings as questions.
6. Stop explaining the page's own methodology inside the page.
7. Stop closing the comparison band on a concession.
8. Stop ending the page without a repeated primary action.

## 8. What the page must start doing

1. Name the buyer in the first two lines.
2. Put a primary button above the fold, and repeat it twice more.
3. Give P3 (integrity without surveillance) its own band.
4. Give privacy and data control its own band, written for a reviewer, not a developer.
5. Show the *organiser's* artefacts — the results CSV, the live monitor's shape, the candidate
   screen — rather than the candidate's radio buttons.
6. Compress status into four designed objects.
7. Offer a way to be told when v0.1 lands that does not require a GitHub account.
8. Treat "we build the format before the software" as a thesis to argue, not a gap to apologise for.
