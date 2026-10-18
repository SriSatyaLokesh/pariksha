# Scorecard: the current page against the 2026 standard

The checklist is `research-03-saas-standards.md` §1 (27 items, each sourced). The page scored is
`apps/web/src/routes/landing.tsx` and its eight sections at `main` / `90d9fed`, 19 October 2026.

**Scoring:** ✅ met · ⚠️ partial · ❌ failed · ➖ not applicable to this product

| # | Standard (abbreviated) | Score | Evidence from the page |
| --- | --- | --- | --- |
| 1 | H1 + subhead give audience, outcome, differentiator in under 5 s | ❌ | H1 names the brand and a generic verb; subhead is a status disclosure. No audience anywhere above the fold |
| 2 | Design for scanning — layer-cake headings, not dense body text | ❌ | All eight band headings are questions; body is specification-grade prose. A heading-only read yields no claims |
| 3 | Highest-value content in the first two screenfuls (74% of viewing time) | ❌ | Screens one and two contain a quiz and a JSON file. The comparison table, the cost arithmetic and the FAQ — the page's three best assets — are all below screen four |
| 4 | Do not assume the fold is dead | ❌ | The only button on the page is in the final band |
| 5 | H1 as audience + outcome + differentiator formula | ❌ | 45-character typographic budget is governing a positioning decision |
| 6 | Positioning decided before copy | ⚠️ | `content-inventory.md` is an outstanding *truth* input; no positioning document existed until `06-positioning-and-strategy.md` |
| 7 | Buyer is the hero, product is the guide | ❌ | The hero demo casts the visitor as a *candidate* — the one role that is not the buyer |
| 8 | Lead with the job, not the feature list | ⚠️ | "How it works" is job-shaped; everything around it is feature- and format-shaped |
| 9 | Canonical spine: hero → trust → problem → solution → proof → features → security → FAQ → CTA | ❌ | Actual spine has no problem band, no proof band, no security band, and no CTA band until the end |
| 10 | Trust signals directly below the hero | ❌ | Below the hero is a JSON code block |
| 11 | One primary CTA, repeated at every scroll stop, plus a secondary | ❌ | **One button on the entire page.** Hero has two plain text links |
| 12 | CTA label matches the buying motion | ⚠️ | "Start with the worked example" is honest and correctly self-serve, but it appears once, at the bottom |
| 13 | Lead-capture forms 3–5 fields | ➖ | No form exists. See the finding below the table |
| 14 | Social proof stacked by skepticism-reduction | ➖/❌ | No users exist, so logos and testimonials are unavailable — but the *substitutes* the project owns (CI coverage, published arithmetic, the real results CSV, its own no-tracker CSP) are unused |
| 15 | Repo signals in the first two scrolls, for an open-source product | ❌ | No star count, no contributor count, no commit activity, no licence badge above the fold. A plain text link to GitHub is the whole signal |
| 16 | Set your own conversion goal | ❌ | The page has no defined conversion goal, and by design no way to measure one |
| 17 | Expect low-single-digit conversion | ➖ | Unmeasurable today |
| 18 | Surface security, compliance, data residency and TCO before being asked | ⚠️ | All of it is *present* and all of it is *scattered*: data residency in a FAQ answer, retention in no band at all, TCO in band 6, licence in the footer. An executive cannot assemble the argument by scanning |
| 19 | Satisfy the executive and the technical evaluator in the same scroll | ❌ | The technical evaluator is served well. The executive is served by nothing before band 5 |
| 20 | Grade 6–9 reading level | ❌ | Representative sentence from band 7 runs 56 words across five clauses |
| 21 | Benefits first, proved with features and numbers | ⚠️ | Numbers are excellent and sourced; benefits are implied rather than stated |
| 22 | One disclosed limitation raises credibility | ❌ **inverted** | Not a failure of honesty — a failure of dosage. Forty status-hedge tokens; the reader is told the product is unusable nine separate times, including in the closing band |
| 23 | Page speed as a conversion lever | ✅ | 75.7 KB gzipped against a 300 KB budget, measured in CI. Self-hosted fonts. Genuinely excellent |
| 24 | Do not over-index on mobile for B2B | ✅ | Responsive and sound at every width |
| 25 | Answer-first copy and schema markup for LLM citation | ✅ | The FAQ's answer-first 40–60-word discipline and `FAQPage` JSON-LD are the single best-executed part of the page |
| 26 | Interactive demo instead of static screenshots | ⚠️ | An interactive demo exists and is well built — pointed at the wrong audience and the wrong claim |
| 27 | "No sales call required" self-serve pattern | ✅ | True by construction, and correctly never contradicted |

**Totals: 4 met · 7 partial · 12 failed · 4 not applicable.**

---

## The shape of the result

Read the column vertically and a clear pattern appears:

- **Everything the page builds, it builds well.** Performance, accessibility, progressive
  enhancement, structured data, answer-first FAQ copy, sourced numbers — items 23, 24, 25, 27 are
  met outright and several of the partials fail on *placement*, not on *content*.
- **Everything the page fails is a sequencing or framing decision.** Items 1–5, 7, 9–11, 15, 19, 20,
  22. Not one of them requires new infrastructure, a redesign, or a claim the project cannot defend.

That is a good position to be in. **The rewrite is an editing job, not a rebuild.**

---

## Three findings the checklist produced that the teardown had not

### F1 — The page has no conversion goal, so item 16 cannot even be failed properly

Items 11, 12, 13, 16 and 17 all assume the page knows what it wants. This one does not. Before any
copy is written, the owner must pick: *is the primary action "start a question bank", "watch the
repo", or "tell us what you need"?* Everything downstream — the CTA label, its repetition, the
closing band, the nav — resolves from that single choice. The recommendation in
`06-positioning-and-strategy.md` §6 is **"Start your question bank"** primary, **"Watch the repo for
v0.1"** secondary.

### F2 — Item 15 is a free win the project is declining

Open-source repo signals — stars, contributors, commit cadence, CI status, licence, latest release —
are exactly what a technical evaluator scans for, they require no users, no telemetry and no claims,
and they are already true. A small, honest signal strip near the top (licence badge, CI passing,
coverage percentage, last commit, open issues) would satisfy item 15 and item 14's substitute-proof
problem simultaneously, without printing a single adoption figure.

The constraint in `content-inventory.md` §8 forbids printing a *star count as an adoption claim*. It
does not forbid showing that the project has continuous integration, 97% test coverage and a
dated decision record. Those are statements about the work, not about the market.

### F3 — Item 22 is the finding most likely to be argued with, so it is stated as a measurement

The pratfall research the checklist cites compares ads with **one** disclosed negative against
all-positive ads. It does not license thirty.

Measured, in the two bands that carry the most status language: `CostSection.tsx` and
`NotForSection.tsx` hold **911 words of body copy and 22 status-hedge tokens** between them —
*pre-alpha*, *not built*, *specified*, *Phase n*, *roadmap*, *planned*, *not yet*, *has not been*.
That is **one hedge every 41 words**, or roughly one in every two sentences.

Whatever the correct dose is, the evidence base does not support that one — and the same admissions,
placed once and well, would score item 22 as met rather than inverted.

---

## What "fixed" looks like, measured

A testable definition of done for the rewrite:

| Metric | Today | Target |
| --- | --- | --- |
| Primary CTAs on the page | 1 | 3 (hero, mid, close — same label) |
| Status-hedge tokens in body copy | 40 | ≤ 8, of which ≤ 2 above the fold |
| Band headings that state a claim | 0 of 8 | 8 of 11 |
| Words before the first benefit statement | ~70 (and it is a disclaimer) | ≤ 20 |
| Scroll depth to the first proof artefact | ~55% | ≤ 25% |
| Named audience above the fold | none | at least one, by role |
| Repo/quality signals above the fold | 0 | 3 (licence, CI/coverage, activity) |
| JSON visible above 50% scroll | yes | no |
| Checklist items met | 4 / 23 applicable | ≥ 18 / 23 |
