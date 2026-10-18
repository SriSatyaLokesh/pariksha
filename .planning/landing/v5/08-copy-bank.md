# Copy bank: every line, with alternates and a truth check

| | |
| --- | --- |
| **Purpose** | Ready-to-use wording for the rebuilt page, with alternates so the owner can choose rather than rewrite |
| **Truth rule** | Every line carries a source. A line with no source does not ship. Sources are file paths in this repo, as `content-inventory.md` requires. |
| **Convention** | ★ = recommended. Lines marked **UNTRUE TODAY** are listed only to be rejected explicitly. |

---

## 1. The H1

Constraints: must name the outcome, imply the audience, carry one differentiator, read in under two
seconds, and survive at 56 px in Anek Latin (`DESIGN.md` `display-xl`) without wrapping past three
lines on a phone.

| # | Headline | Chars | Carries | Source |
| --- | --- | --- | --- | --- |
| ★ **A** | **Run real exams on the internet, for free, on infrastructure you own.** | 68 | outcome + price + ownership | `README.md:5` — the project's own line, already written and already true |
| B | Exams you own — the code, the data, and the bill. | 48 | ownership ×3, wit | ADR 0003; PRD `:43`; PRD `:70` |
| C | Three hundred candidates. Three hundred different papers. No bill. | 66 | specificity + the anti-form claim + price | PRD `T-08`–`T-10`; PRD `:70` |
| D | An exam platform that never sees your candidates. | 48 | the privacy claim, stated structurally | PRD `:43` — there is no Pariksha server in the path |
| E | Everything a Google Form cannot do, on a server you already pay for. | 67 | the category-replacement claim | `content-inventory.md` §2(a) |
| F | Real exams for hundreds of people, hosted by you, free per candidate. | 68 | scale + ownership + price | PRD `:537`, `:70` |

**Recommendation: A.** It is the project's own sentence, it is already defended line by line in the
README, and it does the three jobs (outcome / price / ownership) in one clause each. The current
page's headline is a strictly weaker rewrite of it that dropped "for free".

**Challenger: D**, if the page wants to lead on privacy rather than price. Reserve it for a possible
education-sector variant of the page.

### 1.1 Rejected H1s, and why

| Headline | Why it does not ship |
| --- | --- |
| "Pariksha — run real exams you host yourself." (current) | Spends the first word on a brand nobody knows, directly below a wordmark that already says it; drops "free" |
| "The open-source assessment platform" | Category label, not a claim. No outcome, no reason to read line two |
| "AI-powered exams, reimagined" | **UNTRUE TODAY** — BYOK drafting is Phase 9 and unbuilt (`docs/ROADMAP.md:119-125`) |
| "The Mettl alternative" | Benchmarks a named competitor the repo has no measurement of (`content-inventory.md` §8, "numbers not to print") |
| "Trusted by thousands of institutions" | **UNTRUE TODAY** — there are no users, and no telemetry exists to count them |

---

## 2. The subhead / lead

Job: name the buyer, list what they get, state how it runs. Target 25–45 words.

**★ Recommended**

> For placement cells, training institutes and teams that have to test hundreds of people: twelve
> question types, a different paper for every candidate, proctoring that records no video, and a
> results CSV. Apache-2.0, on your own Cloudflare account or server.

*Sources: PRD `:34` (the buyer); `docs/question-format.md:35-50` (12 types); PRD `T-08`–`T-10`
(different paper); PRD `P-06` (no video); PRD `R-08` (CSV); ADR 0003 (licence); PRD `:449-458`
(deployment).*

**Alternate B — shorter, price-forward**

> Twelve question types, a different paper per candidate, and proctoring that records no video —
> running in your own account, for nothing. Open source, Apache-2.0.

**Alternate C — buyer-named first**

> Built for the placement cell with three hundred students and no budget: question pools, a
> server-enforced clock, an answer key the browser never sees, and one CSV at the end.

**Alternate D — contrarian / thesis-forward** (pairs with the "format is the product today" strategy)

> Pariksha publishes the exam *format* before the software, so the questions you write today outlive
> any tool — including this one. Twelve types, five scoring modes, open schemas, Apache-2.0.

---

## 3. The status chip (the hero's entire honesty budget)

One object. Replaces nine scattered "pre-alpha" mentions.

| # | Chip text | Notes |
| --- | --- | --- |
| ★ A | `PRE-ALPHA · SCORING ENGINE AND FORMATS LIVE · v0.1 IN PROGRESS` | States the stage *and* what is real, in one line. Links to the status band |
| B | `PRE-ALPHA · APACHE-2.0 · WHAT IS BUILT →` | Current chip plus a link; minimal change |
| C | `BUILDING IN THE OPEN · PHASE 2 OF 12 · v0.1 NEXT` | Confident framing; needs the ledger band right below to stay honest |

Set in JetBrains Mono, small caps scale (`DESIGN.md` `mono-caption`), beside the wordmark — not
inside the headline, and never in the subhead.

---

## 4. Band headings — claims, not questions

The heading-only read must be a complete argument (`06-positioning-and-strategy.md` §3.1).

| Band | Current heading | ★ Replacement | Alternate |
| --- | --- | --- | --- |
| Who it is for | *(none exists)* | **Built for the people who run the test, not the people who sell them** | Who runs exams on Pariksha |
| Anti-form | *(folded into "How it works")* | **A form shows everyone the same paper. An exam should not.** | Why a Google Form is not an exam |
| Features | "How does running an exam on Pariksha actually work?" | **Twelve question types, five scoring modes, one open file** | What you can ask, and how it is scored |
| How it works | *(same band)* | **Write questions. Publish a URL. Download the results.** | Three steps, start to finish |
| Integrity | *(bullet in "not for")* | **Integrity without surveillance: no video, no audio, no verdicts** | How Pariksha watches an exam — and what it refuses to do |
| Privacy / data | *(scattered)* | **Your account, your database, your retention rules** | Where candidate data lives |
| Comparison | "Why not a form tool, and why not a paid assessment platform?" | **Against a form tool, and against a paid platform** | How Pariksha compares |
| Cost | "What does it cost to run an exam on Pariksha?" | **Five hundred candidates in an hour, for nothing — here is the arithmetic** | What it costs to run |
| Status ledger | "What is built today, and what is not?" | **What is live today, and what lands with v0.1** | Build status |
| Not for | "Who is Pariksha not for?" | **Pariksha is the wrong tool if…** | When not to use Pariksha |
| Open source | *(none exists)* | **Read the code, change it, or sell a service built on it** | Apache-2.0, with a patent grant |
| Contribute | *(none exists)* | **The most useful thing you can contribute needs no code** | Help build v0.1 |
| FAQ | "Questions and answers" | *(keep)* | — |
| Closing | "Read one real test, end to end." | **Start your question bank today. It will import on day one.** | Begin before the software does |

---

## 5. Pillar copy

### P1 — A real exam, not a form

> **A form shows everyone the same paper. An exam should not.**
>
> Pariksha draws each candidate's paper from a pool you tag and filter, or hands out fixed sets A, B
> and C round-robin by registration order, so neighbours never sit the same questions. Options
> shuffle underneath, except the ones you pin. The answer key stays on the server, the clock is the
> server's, and an answer that arrives thirty seconds after the deadline is refused.

*Sources: PRD `T-08`, `T-09`, `T-10`; `packages/core/src/select.ts`; PRD `S-10`;
`docs/test-format.md:59`, `:61`.*

### P2 — Your account, your data, no bill

> **Five hundred candidates in an hour, for nothing.**
>
> The reference deployment is designed to fit inside Cloudflare's free tier — about 55,000 Worker
> requests against a limit of 100,000 a day, 55,000 database writes against 100,000, and 0.75 GB of
> snapshots against 10 GB. The arithmetic is published rather than asserted. Candidate data sits in
> your own account, and there is no Pariksha server anywhere in the path.

*Sources: PRD `:551-559`; ADR 0002; PRD `:43`.*
*Mandatory adjacent line:* the 500-candidate figure is a design target; the load test that would
prove it (`AC-29`) is a Phase 12 gate and has not been run (`content-inventory.md` §8).

### P3 — Integrity without surveillance

> **No video. No audio. No verdicts.**
>
> Strict proctoring takes a 320×240 snapshot about every sixty seconds, counts faces on the device
> itself, and stores no biometric template. Nothing is streamed and nothing is recorded. Tab
> switches, fullscreen exits and copy attempts are logged and shown to the candidate as a counted
> warning — and at the end Pariksha marks the attempt **clean**, **review** or **high risk**, and
> stops. A person decides what that means.
>
> Browser checks deter and record. They cannot prove. A second phone is invisible to every one of
> them, and the documentation says so — which is exactly why no machine here is allowed to reach a
> verdict.

*Sources: PRD `P-06`, `P-07`, `P-09`, `P-10`; `docs/test-format.md:129`; PRD `:674`.*

**Note on this band:** it is the only place where an admission is used *as* the argument rather than
beside it. That is why the "browser proctoring is beatable" line belongs here and nowhere else.

---

## 6. CTA labels

| Slot | ★ Label | Alternates | Reject |
| --- | --- | --- | --- |
| Hero primary | **Start your question bank** | "Write your first question" · "Clone the worked example" | "Get started free" (implies a running app) · "Sign up" (nothing to sign up to) |
| Hero secondary | **See a real exam, end to end** | "Read one whole test" · "Open the worked example" | "Watch a demo" (no video exists) |
| Nav | **GitHub** | "Star on GitHub" once a count is worth printing | "Login" (there is nothing to log into publicly) |
| Mid-page | **Validate a question in one command** | "Check your questions against the schema" | — |
| Status band | **Read the roadmap** | "Follow the twelve phases" | — |
| Contribute band | **Take a good first issue** | "Add an example in your subject" | — |
| Closing primary | **Start your question bank** *(repeat — same verb)* | — | Inventing a third verb at the bottom |
| Closing secondary | **Watch the repo for v0.1** | "Tell us what you need to run" *(once the form exists)* | "Join the waitlist" (there is no list yet) |

**Microcopy under the hero CTA pair:**

> No account. No install. One `git clone` and a schema.

*Source: `README.md:135-150`.*

---

## 7. The "today you can" box

Sits beside the status ledger. It is the piece that converts honesty into an offer.

> **What you can do today**
>
> 1. **Write your question bank.** `pariksha/question@1` is published and stable. Questions written
>    today import on day one — or into anything else, because the format is CC BY 4.0.
> 2. **Validate it in one command.** One `npx ajv` run against the schemas in `schemas/`. No install,
>    no account.
> 3. **Read a whole exam.** Seventeen questions, three sections, the candidate's screen and the
>    results CSV it produces — the complete worked example.
>
> **What you cannot do yet:** run a test. The application lands with v0.1.

*Sources: `README.md:135-150`; `docs/question-format.md`; `examples/reasoning-aptitude/`;
`README.md:22`.*

---

## 8. The "wrong tool" filter — nine paragraphs become five rows

| Pariksha is the wrong tool if… | Use instead |
| --- | --- |
| You need to run a test this week | Anything that already ships — the application lands with v0.1 |
| Your exam must be invigilated or legally contestable | A supervised centre, or a vendor who carries the liability |
| Candidates will sit it on a phone | A mobile-first form tool — Standard and Strict block phones and tablets by design |
| You need live human proctoring, a lockdown browser, or a code runner | A proctoring vendor; the first two are permanent non-goals and the third is a later plugin |
| You want somebody else to host it | There is no Pariksha SaaS, by design — you bring a Cloudflare account or a server |

*Sources: `README.md:22`; PRD `:674`, `:59`, `:61`, `:60`, `:63`, `P-01`.*

Four items from the current nine move elsewhere rather than disappearing: *AI deciding who cheated*
and *browser proctoring does not prevent cheating* become the argument of the integrity band;
*vendor liability* becomes an FAQ answer; *no code runner* folds into row four above.

---

## 9. Social proof, for a project that has none

Hard rule from `content-inventory.md` §8: **no user count, install count, star count or adoption
figure may be printed.** The category's standard proof devices — logo walls, named case studies,
"2.5M users" — are all unavailable. These five are available, true, and unusual enough to work:

| # | Device | The line | Source |
| --- | --- | --- | --- |
| 1 | **Coverage, printed** | 97% statements, 93% branches, 100% functions, 98% lines on the scoring engine — gated in CI | `CHANGELOG.md` Unreleased/Changed |
| 2 | **The arithmetic, not the claim** | The free-tier budget table, with limits and usage side by side | PRD `:551-559` |
| 3 | **The artefact, not the screenshot** | The real results CSV, including the `high_risk` row that was *not* cancelled | `examples/reasoning-aptitude/results.csv` |
| 4 | **The promise this page already keeps** | No telemetry, no third-party script, self-hosted fonts, `default-src 'self'` — on the page you are reading | `CHANGELOG.md` Unreleased/Added; PRD `S-11` |
| 5 | **The decisions, in public** | Every architectural choice has a dated ADR you can disagree with | `docs/adr/` |

Device 4 is the strongest and is currently unclaimed anywhere on the page. A privacy claim that the
marketing site itself demonstrably honours is rarer and more persuasive than any badge row.

---

## 10. Lines to retire

| Current line | Problem | Do instead |
| --- | --- | --- |
| "Open source, self-hosted, pre-alpha as of October 2026." (hero lead) | Status where the value proposition belongs | Replace with §2 |
| "Pariksha is compared here against two categories of tool, never named competitors, because…" | Explains the page's own methodology to a reader who did not ask | Keep the dated footnote only |
| "A paid platform you can buy today will do more than Pariksha does today…" | True, but ends the preference band on a concession | Move verbatim into the status ledger |
| "Pariksha is not for every exam, and the product says so without hedging. It is pre-alpha software with nine specific situations where…" | Announces the list before giving it; counts its own items | Replace with the §8 table, no preamble |
| "…and this page is itself that second phase's output." | Self-referential; the reader is not building the project | Cut |
| "Scoring needs JavaScript. Every question above reads without it." | Excellent engineering, wrong audience, top of page | Keep the behaviour; move the sentence to a caption |

---

## 11. FAQ additions

The nine existing answers stay verbatim — they are the most search- and LLM-citable asset on the
page. Add five, written to the same 40–60 word answer-first rule:

**Q. Who is Pariksha for?**
Pariksha is for placement cells, training institutes, certification bodies and small companies that
must test hundreds of people, have little or no budget for it, and need candidate data to stay in
their own account. One deployment hosts many tests, each with its own URL, access rules and
proctoring policy. *(PRD `:34`, `:31`)*

**Q. What does it cost per candidate?**
Nothing. Pariksha charges nothing of any kind — there is no Pariksha billing and no hosted service
to bill for. Your only cost is the infrastructure you already own or the free tier you already have;
five hundred candidates in one hour is designed to fit inside Cloudflare's free plan. *(PRD `:63`,
`:551-559`)*

**Q. Do I need a developer to run it?**
You need someone who can create a Cloudflare account or run Docker, once. The target is under thirty
minutes from clone to a first live test with no paid service, and that target is written into the
acceptance criteria as `AC-01`. Everyday use — writing questions, building tests, reading results —
needs no code at all. *(PRD `:55`, `AC-01`; `docs/design.md` UX-06)*

**Q. What happens to my tests if the project stops?**
They keep working. The code is Apache-2.0 with a patent grant, so you may run, modify or fork it
without permission, and every test exports as one documented JSON file under CC BY 4.0. Nothing you
build depends on this project continuing to exist. *(ADR 0003; `docs/test-format.md:3`)*

**Q. Is Pariksha accessible?**
WCAG 2.1 AA is a v1.0 commitment, audited in Phase 12 — a target, not a measured result, and the
page says so rather than claiming a conformance it has not tested. The interface language at v1 is
English, with translation files for others. *(`docs/ROADMAP.md:145`; PRD `:544`, `T-24`)*
