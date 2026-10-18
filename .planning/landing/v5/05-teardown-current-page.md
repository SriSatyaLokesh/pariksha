# Teardown: the landing page as it stands, 19 October 2026

| | |
| --- | --- |
| **Subject** | `apps/web/src/routes/landing.tsx` and its eight sections, as merged on `main` at `90d9fed` |
| **Reviewer stance** | Marketing strategist, business analyst and UX designer — not the author of the page |
| **Method** | Read every section component in full; counted the page's own vocabulary; walked it as three personas |
| **Verdict** | A technically excellent, intellectually honest document that is not a landing page |

---

## 0. The one-sentence finding

**The page is written as a disclosure document for a sceptical engineer, and it is competing for the
attention of a placement officer who has eleven minutes between meetings.** Everything that is wrong
with it follows from that single mismatch — and almost nothing that is wrong with it is a design
problem.

---

## 1. What the page actually is today

Eight bands plus a footer, in this order:

| # | Band | Heading on the page | What it does for a buyer |
| --- | --- | --- | --- |
| 1 | Hero | "Pariksha — run real exams you host yourself." | Names the product; offers a three-question quiz to answer |
| 2 | What it is | "What is Pariksha?" | Defines the category in one paragraph; three numerals |
| 3 | Hero bridge | "The three questions above are this file." | Shows the question JSON |
| 4 | How it works | "How does running an exam on Pariksha actually work?" | Three steps, a code block, twelve type names, a results table |
| 5 | Comparison | "Why not a form tool, and why not a paid assessment platform?" | Seven-row table against two categories |
| 6 | Cost | "What does it cost to run an exam on Pariksha?" | Free-tier arithmetic, a deploy note, a validate command |
| 7 | Scope | "Who is Pariksha not for?" + "What is built today, and what is not?" | Nine exclusions, then a build-status inventory |
| 8 | FAQ | "Questions and answers" | Nine answer-first Q&As |
| 9 | Closing | "Read one real test, end to end." | The page's only button |
| — | Footer | — | Docs, project, licence |

### The page's own vocabulary, counted

Across the eight section files:

| Token | Occurrences |
| --- | --- |
| "pre-alpha" | 9 |
| "roadmap" | 9 |
| "Phase *n*" | 9 |
| "specified" (as a status label) | 8 |
| "not built" | 5 |
| **Total status-hedge tokens** | **40** |
| **Primary CTA buttons on the whole page** | **1** |

One button. Forty hedges. That ratio *is* the problem, stated numerically.

---

## 2. Walking the page as three people

### 2.1 Priya — head of a college placement cell, 300 students to screen in February

She arrives from a search for "free online exam software for colleges".

| Screen | What she sees | What she thinks |
| --- | --- | --- |
| 1 | A brand name she does not know, a 45-character headline, a quiz asking *her* to answer a number-series question, and the words "pre-alpha" | "Why am I taking a test? I came to buy one." |
| 2 | `{"id": "LOG-001", "key": "c", "scoring": {...}}` | "This is for programmers. Not me." |
| 3 | "Who is Pariksha not for?" — nine paragraphs, the first of which is *"Anyone who needs to run a test this week"* | Leaves. |

She never reaches the comparison table, the cost arithmetic or the FAQ — which are the three bands
that would have convinced her. **The page's best material is behind its worst 400 words.**

**Nothing on the first screen tells her the product is for her.** The PRD has a vivid, specific
buyer — *"a college placement cell, a training institute or a 40-person company that needs to test
300 people"* (`README.md`, Why) — and that sentence appears nowhere on the page.

### 2.2 Arjun — senior engineer, found the repo on Hacker News

He is the audience the page *is* written for, and it broadly works for him: he gets the formats,
the schemas, the free-tier arithmetic and an honest status. Two things still fail him:

- He wants a **star, a watch, or a "tell me when v0.1 lands"**, and the page offers no action other
  than a link out to GitHub placed at the bottom.
- The hero demo asks him to answer three quiz questions, which proves a radio button works. **Nobody
  doubted that.** The thing he would actually find impressive — the scoring engine, the 12 types, the
  validation that refuses a bad bank — is described in prose instead of demonstrated.

### 2.3 Meera — CTO of a 60-person company evaluating hiring tests

She is the executive buyer. She reads headings only, and the headings are **questions, not claims**:
"What is Pariksha?", "How does running an exam actually work?", "Who is Pariksha not for?". A
heading-only scan of this page yields *no statement of value whatsoever*. She gets a quiz, four
questions and a bottom-of-page link.

She also looks for, and does not find: who else uses it, what it looks like to administer, what
happens when 500 people hit it at once, what her legal team will ask about, and a way to talk to
someone.

---

## 3. The twelve specific defects

Ordered by cost to conversion, not by effort to fix.

### D1 — There is no conversion goal, so there is no CTA (critical)

The entire page offers **one** button, in the last band, reading *"Start with the worked example"*,
pointing at a GitHub folder. The hero's only actions are two plain text links.

Every page in the comparison set — SaaS, open-source and assessment — puts a primary action in the
hero, repeats it at least twice, and pairs it with a lower-commitment secondary. This page does none
of the three.

Worse: because the project ships no telemetry and no third-party script by design, **every action
the page does offer is an exit to a domain it cannot measure**. The page has no idea whether it
works, and no mechanism by which it could find out.

### D2 — The highest-value line on the page is spent on the brand name (critical)

> `Pariksha — run real exams you host yourself.`

The H1 is governed in the source by a **45-character budget** (`Hero.tsx`), which is a typographic
constraint being allowed to make a positioning decision. The line contains:

- the brand name (worth nothing to a stranger — it is directly above a wordmark that already says it),
- a verb phrase that could describe Moodle, Google Forms, Testportal or a PHP script,
- no audience, no outcome, no number, no differentiator.

The README's own first line is strictly better marketing than the H1: *"Run real exams on the
internet, for free, on infrastructure you own."* It has the free, the ownership and the credibility
in nine words. The landing page dropped the two strongest words in it.

### D3 — The subhead is a disclaimer where the value proposition belongs (critical)

> `Open source, self-hosted, pre-alpha as of October 2026.`

This is the lead paragraph — the single most-read sentence after the H1 — and it is a status
disclosure. Three of its six words are reasons to leave. The slot's job is to answer *"what do I get,
and why should I care"*; it instead answers *"what stage is your project at"*, a question nobody has
asked yet on screen one.

### D4 — The hero demo casts the visitor as the wrong person (high)

The visitor is made to **sit an exam**. But the buyer is the person who *runs* exams. The demo
inverts the role at the exact moment the page is establishing who it is talking to, and it
demonstrates the least differentiated surface in the product: a multiple-choice question with radio
buttons, which every competitor and every form tool also has.

The interaction is genuinely well-built (progressive enhancement, keyboard-first, works with
JavaScript off). It is pointed at the wrong target.

What would earn that space: *the organiser's side*. Pick a tag and a count and watch a pool draw a
different paper for each of three candidates. Flip a scoring mode and watch the same answer score
differently. Those are the claims that are both **shipped today** and **impossible in a Google Form**
— the exact intersection the hero should occupy.

### D5 — Band 3 is a JSON file (high)

The fourth thing on the page, before any argument about value, is a syntax-highlighted
`questions.json` excerpt. For the engineer it is reassurance. For everyone else it is a closed door,
placed where the door should be open. The same artefact is persuasive 60% of the way down the page
— as proof of the no-lock-in claim — and fatal at 15%.

### D6 — The honesty is correct, and its dosage is wrong (high)

This is the most delicate finding, and the one most likely to be argued with, so it is stated
precisely:

**The honesty policy is right and must survive the rewrite.** The `content-inventory.md` rule — *"if
a claim is not in this file with a file path beside it, it does not go on the page"* — is a genuine
competitive asset in a category full of vendors who overstate proctoring accuracy. It should be
*advertised*, not softened.

**The dosage is wrong.** Research on disclosed weakness (the pratfall / blemishing effect) finds
that an admission raises trust *when it is scarce, specific, and surrounded by strength*. Forty hedge
tokens, nine "not for" paragraphs and a phase label on nearly every feature is past the point where
admission signals confidence; it signals a team that does not believe its own product. A reader
cannot tell the difference between *"we are careful"* and *"this does not work"* when both are said
thirty times.

Concretely, the current page tells the visitor it is unusable **in the hero, in band 2, in band 5's
conclusion, in band 6 twice, in band 7 three times, in the FAQ's standfirst, in FAQ answer 1 and in
the closing band** — nine separate times, including inside the band whose job is to close.

### D7 — The comparison band ends on a loss (high)

Band 5 is the strongest argument on the page. It closes with:

> *"A paid platform you can buy today will do more than Pariksha does today, because the Pariksha
> application is not built yet."*

That sentence is true and belongs on the page. Putting it as the **final line of the comparison
band** means the one band designed to create preference terminates by conceding preference. Move it
to the status band, where the reader has already been told what is built; keep the comparison band
closing on what Pariksha uniquely does.

The band also spends its intro paragraph explaining its own methodology — *"compared here against
two categories of tool, never named competitors, because the project can defend format and scoring
claims about itself but not performance claims about someone else's product"* — which is
disclosure of a kind no reader asked for. Keep the dated footnote; cut the methodology essay into
one clause.

### D8 — Headings are questions, so a scan yields nothing (medium)

Every band heading is interrogative. The page is optimised for a *reading* visitor and penalises a
*scanning* one, which is the majority. Scanning conventions want headings that assert the takeaway:
*"Every candidate gets a different paper"* beats *"How does running an exam actually work?"* — the
first is an argument, the second is a table of contents entry.

The FAQ body already does this correctly (answer-first, 40–60 words). The bands do not.

### D9 — The nine-item "not for" list is a wall, not a filter (medium)

Qualification sections are valuable; nine consecutive paragraphs is not a qualification section, it
is an obstacle course. Three things compound it: it sits *above* the FAQ (so the last thing before
Q&A is nine reasons to go away), its items vary wildly in weight (*"no code runner"* sits beside
*"pre-alpha, cannot run a test this week"*), and it is prose where it should be a two-column
"this / not this" table that a reader resolves in four seconds.

### D10 — No proof surface exists for the organiser's product (medium)

An executive wants to see the thing. The product does not exist yet, so there is nothing to
screenshot — a real constraint, not an oversight. But the page then shows **nothing at all** in its
place, when it owns three legitimate artefacts it is not using:

- the **candidate screen ASCII mock** from the README (currently not on the page),
- the **results CSV** (on the page, as a three-row table — underused; this is the deliverable the
  buyer actually receives, and it should be a full-width, un-hedged exhibit),
- the **design system** — 20 colours, 13 type tokens, 43 components, already measured and in
  `DESIGN.md` — which could legitimately be shown as *"the interface being built, as designed"*
  provided it is labelled.

### D11 — Navigation defects (medium)

- Nav has five links and **no call to action**.
- The nav item **"Docs" points at `#docs`, which is the footer** (`Footer.tsx` carries
  `id="docs"`). A visitor clicking Docs is dropped at the licence column. This is a bug, not a
  style note.
- No anchor for the comparison, the FAQ or the status band — the three things a returning visitor
  wants to re-find.

### D12 — Register and sentence length (medium)

The prose is specification-grade: long sentences, stacked subordinate clauses, heavy em-dash use,
and a preference for precision over momentum. Representative, from band 7:

> *"Pariksha has not been released yet; it is pre-alpha as of October 2026. The formats, their JSON
> Schemas, a worked example and the scoring engine are published and tested, and the application
> itself lands with v0.1, one of twelve build phases complete, a second part done, and this page is
> itself that second phase's output."*

Fifty-six words, five clauses, and a self-referential closing. It is *accurate*. It cannot be
skimmed, and it carries no emphasis a scanning eye can grab.

---

## 4. What must survive the rewrite

A teardown that only subtracts is a bad teardown. These are assets, not debts:

1. **The sourced-claims discipline.** `content-inventory.md` is better than what most funded
   startups have. Keep the rule; change only the *volume and placement* of status labels.
2. **The free-tier cost arithmetic.** Published arithmetic instead of an asserted "free" is a
   genuinely differentiated trust move and should be promoted, not buried in band 6.
3. **"Flags, never verdicts."** This is the single best sentence the project owns. It is an ethical
   position no competitor can copy without re-architecting, and today it is a bullet in band 7.
   It deserves a band.
4. **"No video, no audio is ever recorded."** For a school buyer this is a decisive line and it is
   currently a FAQ answer.
5. **The answer-first FAQ**, verbatim. It is the most LLM-citable and search-visible asset on the
   page.
6. **No telemetry, no third-party scripts, self-hosted fonts, `default-src 'self'` CSP.** The page
   *already keeps the promise the product makes*. That is a proof point and it is not currently
   claimed anywhere on the page.
7. **The worked example** as the primary developer-facing conversion. It genuinely is the fastest
   way to understand the product.
8. **The honest admissions themselves** — all of them. Fewer repetitions, one strong location, same
   content.

---

## 5. The structural diagnosis, in one line each

| Dimension | Today | What the category expects |
| --- | --- | --- |
| Hero job | Prove the product is real | Say what you get and who it is for |
| First CTA | None (two text links) | Primary button above the fold |
| Audience named | Nowhere | In the H1 or the subhead |
| Proof | Formats and arithmetic | Formats, arithmetic **and** a picture of the thing |
| Status handling | 40 tokens across 8 bands | One band, one badge, one line in the hero |
| Headings | Questions | Claims |
| Qualification | 9 paragraphs, mid-page | A short table, late |
| Capture | None | At minimum: watch the repo, and an intent signal |
| Measurement | Impossible by design | Privacy-preserving, first-party, still possible |

---

## 6. Recommendation summary

Do not redesign. **Re-sequence and re-write.** The page's components, design system, accessibility
work and progressive enhancement are all sound and reusable. What changes is:

1. The first screen, entirely — headline, subhead, CTA pair, and what occupies the demo slot.
2. The order of the bands, so that value precedes proof and proof precedes qualification.
3. The status vocabulary, from 40 scattered tokens to one honest, confident band plus one hero badge.
4. The addition of four bands the page does not have: **who it is for**, **the integrity ethic**,
   **privacy and data control as a buyer section**, and **what happens next / how to be told**.

The full replacement spine, with wording, is in `07-content-blueprint.md`; the alternatives are in
`prototypes/`.
