# Design contract: landing page v2

| | |
| --- | --- |
| **Status** | Built, fix-first corrections applied — **revision 3**, against five adversarial reviews total ([§14](#14-review)) |
| **Date** | 2026-10-17 |
| **Branch** | `phase-3/landing-page-v2`, worktree `pariksha-landing` |
| **Rebuilds** | `apps/web/src/routes/landing.tsx`, `apps/web/src/styles/landing.css`, `apps/web/index.html`, the build step |
| **Reads from** | [`DESIGN.md`](../../../DESIGN.md) · [`.planning/landing/ui-direction.md`](../../../.planning/landing/ui-direction.md) · [`.planning/landing/seo-mechanics.md`](../../../.planning/landing/seo-mechanics.md) · [`.planning/landing/content-inventory.md`](../../../.planning/landing/content-inventory.md) · [`.planning/landing/constraints.md`](../../../.planning/landing/constraints.md) |
| **House style** | [`docs/design.md`](../../design.md) |
| **Closes** | Issue 137 (most items), the SEO/AEO/GEO/AIO requirement |

This is the whole contract. A competent implementer should be able to build the page from this
file and the four research reports it cites, without asking the owner anything except the two
questions in [§10](#10-open-questions-for-the-owner). It has been through three adversarial reviews
— one on taste, one on discoverability, one on accuracy — and [§12](#12-where-the-reviews-conflict-and-the-call)
through [§14](#14-review) record what they changed, where they contradicted each other and what was
turned down.

The four research reports are inputs, not rivals. Where this document and a report disagree, this
document is the decision and says why. Where it is silent, the report governs — in particular
`ui-direction.md` §3 (the code-block object), §4 (the comparison table's reflow) and §5 (motion)
are quoted by reference rather than restated, and `constraints.md` §2 is the invariant list the
build is judged against.

## Contents

1. [Intent, goals, non-goals, anti-goals](#1-intent-goals-non-goals-anti-goals)
2. [Three readers, and the first screenful](#2-three-readers-and-the-first-screenful)
3. [The page, section by section](#3-the-page-section-by-section)
4. [Every code block and example](#4-every-code-block-and-example)
5. [SEO, AEO, GEO, AIO as a numbered list](#5-seo-aeo-geo-aio-as-a-numbered-list)
6. [Component inventory](#6-component-inventory)
7. [Accessibility and performance acceptance](#7-accessibility-and-performance-acceptance)
8. [The test plan](#8-the-test-plan)
9. [Left to the implementer](#9-left-to-the-implementer)
10. [Open questions for the owner](#10-open-questions-for-the-owner)
11. [What was rejected and why](#11-what-was-rejected-and-why)
12. [Where the reviews conflict, and the call](#12-where-the-reviews-conflict-and-the-call)
13. [Rejected review findings](#13-rejected-review-findings)
14. [Review](#14-review)

---

## 1. Intent, goals, non-goals, anti-goals

### Intent

One page that teaches a stranger how running an exam on Pariksha works, shows them the real
artefacts it is made of, argues once against the two things they would otherwise use, and admits
in the first screenful that the application does not exist yet — and is still the most convincing
page in the category.

The page's unfair advantage is that it has nothing to hide. Every competitor's landing page is
written by someone who must not show you the product's data model. This one can show the exact
JSON, the exact CSV, the exact schema command, the exact free-tier arithmetic and the exact list
of people it is wrong for. **Specificity is the design.**

### Goals

| # | Goal | How it is judged |
| --- | --- | --- |
| G1 | A reader who knows nothing can describe, after one pass, what an organiser does in three steps | S3 reads as a sequence, each step carrying a real artefact |
| G2 | A reader can hand-author a question today and know it will import | S6 carries the schema contract and a command that runs with no install |
| G3 | The comparison is settled before the reader has to scroll for it | S4 is the fourth band, inside two screens on a laptop |
| G4 | An answer engine fetching the URL with no JavaScript gets the full text | Build-time prerender, [§5](#5-seo-aeo-geo-aio-as-a-numbered-list) |
| G5 | Nothing on the page can be quoted six months from now and be a lie | Every claim dated, every status labelled, every estimate marked |
| G6 | The page is visibly more designed than v1 without one keyframe of motion | Scale, field, measure and rendered product surfaces, [§3](#3-the-page-section-by-section) |

### Non-goals

Things the page deliberately does not attempt, each of which would be reasonable on a different
project.

- **A sign-up, a waitlist, an email capture.** There is no product to sign up for and no list the
  project intends to mail. Every call to action resolves to a file in the repository.
- **Social proof.** No stars, no user counts, no logos, no testimonials. None exist, and
  `seo-mechanics.md` §5.1 makes inventing structured-data proof a policy violation.
- **A pricing table.** There is no billing of any kind (PRD `:57-63`, the v1 non-goals list, as
  `content-inventory.md` §2(c) cites it). The earlier draft cited PRD `:63` alone, which reads "A
  hosted SaaS run by the project." — that supports "no hosted service", not "no billing". The cost
  section is arithmetic, not tiers.
- **A second page.** One URL, prerendered. `/vs/<competitor>` pages are scaled content abuse
  (`seo-mechanics.md` §5.7).
- **Client-side interactivity.** No tabs, no accordions, no carousel, no copy button, no scroll
  reveal. See [§11](#11-what-was-rejected-and-why).

### Anti-goals

An anti-goal is a way of failing while technically meeting the brief. If a reviewer can say any
of these sentences about the finished page, the page is wrong and ships again.

| # | Anti-goal | The tell |
| --- | --- | --- |
| X1 | **It reads like vendor marketing.** | Adjectives doing the work of nouns: "powerful", "seamless", "enterprise-grade", "effortlessly". A sentence that would be equally true of any competitor. |
| X2 | **The pre-alpha disclosure reads as a correction.** | The honesty sits in a band *below* the claim, or in small grey type at the bottom, rather than in the first screenful beside the headline. |
| X3 | **The code blocks are decoration.** | A block that is cropped to look like code rather than to be read; a sample not lifted verbatim from `examples/`; a block with no caption naming its file. |
| X4 | **The comparison column is a brag.** | Ticks, crosses, badges, a voltage-filled column, or a row Pariksha wins that is not sourced in `content-inventory.md` §2. |
| X5 | **The no-code claim contradicts the open-format claim.** | Either "you never touch JSON" written as if no JSON exists, or six code blocks that leave a reader thinking they must write them. |
| X6 | **BYOK reads as shipped.** | "AI-powered", "generate a test with AI", or any AI claim without its phase label and "not built". |
| X7 | **It is long rather than dense.** | A section that repeats a claim made two bands earlier in different words. Twelve bands, each with a job; a band without a job is deleted, not shortened. |
| X8 | **The design ambition arrives as motion.** | Any fade-up, counter, parallax or hover lift. Ambition here is 56px type on a saturated field, an asymmetric hero, rendered product surfaces and a typographic table. |

---

## 2. Three readers, and the first screenful

The first screenful is the voltage hero plus the top edge of S2. These three have to be served by
it simultaneously, and the hero is laid out as it is because of them.

### R1 — The organiser

A placement officer, a training lead, a 40-person company's hiring manager, a lecturer. Not a
developer. Arrives from a search like "free online exam software self hosted" or from a
recommendation.

**Needs in the first screenful:** what category this is (an exam platform), that it is free and
self-hosted, that it is not a form tool, and *that it does not run today* — before investing ten
minutes. Gets: the `h1` naming the product and the category verb, the 24px lead sentence naming
pools, types, proctoring and CSV, the `PRE-ALPHA · APACHE-2.0` chip above the headline, and a
rendered picture of the candidate's screen that makes the thing concrete in one glance.

### R2 — The self-hosting developer

Evaluating whether to deploy it, contribute to it, or lift the format. Arrives from GitHub, Hacker
News, or an LLM that cited the repository.

**Needs in the first screenful:** the licence, the hosting target, and a reason to believe the
project is real work rather than a README. Gets: `APACHE-2.0` in the chip, the secondary link
straight to the repository, and the rendered runner surface — which is evidence that the design
system exists, because it is drawn by the same tokens that will draw the product.

### R3 — The machine reader

`OAI-SearchBot`, `Claude-SearchBot`, `PerplexityBot`, `Googlebot`, and any agent a developer points
at the URL. Does not scroll; reads source order and lifts passages.

**Needs in the first screenful of HTML, not of pixels:** one self-contained definitional sentence
with the subject named, a date, and a status. Gets: the `h1` as a complete sentence beginning with
the product name, the chip, the lead, and — critically — **S2's definitional paragraph within the
first 30% of the document**, which `seo-mechanics.md` §3.5 identifies as the band ~44% of AI
citations are drawn from.

The three readers do not conflict. The honest status is the organiser's decision input, the
developer's credibility signal and the machine's dateable fact, and one chip serves all three.

---

## 3. The page, section by section

### 3.0 The spine, and why the comparison sits where it does

The owner chose teach-first with the comparison one notch up ("A with B's table one notch up").
This resolves to: define, teach the three steps, *then* argue, then go back to teaching. The
comparison is S4, the fourth band, not the ninth.

`ui-direction.md` §2.1 proposed the comparison at band nine, after seven teaching bands. That
ordering is better for a reader who has already decided to read the whole page, and worse for the
one who has not. The owner's instruction is the deciding input and it is also the stronger
argument for this page: a reader arriving from a search for "Google Forms exam" has one question
and will not read seven bands to reach it. Placing the comparison immediately after the three
steps means the table is read by someone who now knows what a question pool is — which is exactly
what makes the "Question pools: No / Yes / Yes" row land. The argument needs the teaching; it does
not need all of it.

Everything else in `ui-direction.md` §2 survives: the three-tier spacing escalation, the
"no two consecutive bands share both surface and density" rule, voltage appearing exactly three
times, and the deliberate rest points. The table below is that system re-derived for this order.

| # | id | Section | Surface | **Heading** | **Measure** | Density | Padding | Voltage? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | — | Hero | **voltage** | `display-xl` **(h1, once)** | 7fr / 5fr, mock bleeds right | generous | 96 | yes (1 of 3) |
| S2 | `what-it-is` | What is Pariksha? | cream | `heading-md` + eyebrow | 760 | sparse | 64 | — |
| S3 | `how-it-works` | How running an exam works | cream | `display-lg` | 680 text column per step | dense | 96 | — |
| S4 | `comparison` | Why not a form tool, why not a vendor | canvas | `display-lg` | wrap; table may run wider inside its scroll region | dense | 96 | — |
| S5 | `features` | What it does, by the job it does | cream | `heading-md` + eyebrow | wrap, 3-col grid, first cell spans 2 | medium | 64 | — |
| S6 | `no-code` | You never write JSON. It is all here anyway | canvas | `heading-md` + eyebrow | two columns | medium | 64 | — |
| S7 | `cost` | What it costs, and where it runs | cream | `display-lg` | wrap | generous | 96 | yes (2 of 3, `card-voltage`) |
| S8 | `not-for` | Who it is not for | cream | `heading-md` + eyebrow | **680** | **sparse** | 64 | — |
| S9 | `status` | What is built, what is not | canvas | `heading-md` + eyebrow | wrap, ledger full width | medium | 64 | — |
| S10 | `faq` | Questions and answers | cream | `heading-md` + eyebrow | wrap, 2-col grid ≥900px | dense | 64 | — |
| S11 | — | Closing | **voltage** | `display-lg` | 6fr / 6fr | generous | 96 | yes (3 of 3) |
| S12 | `docs` | Footer | canvas | `heading-sm`, visually hidden | wrap | dense | 64 / 24 | — |

**The heading tier, decided here, because `DESIGN.md` does not decide it for a marketing page.**
`DESIGN.md:148-150` sets the `section-heading` component to `{typography.display-xl}` — 56px / 500
/ -1.4px, byte-identical to `hero-heading`. That is right for the application, where a screen has
one section title and no `h1` competing with it. On a twelve-band page it produces eleven objects
at the page's largest size and therefore no hierarchy at all, and it collides head-on with SEO-26's
question-shaped headings: `Why not a form tool, and why not a paid assessment platform?` is 60
characters and sets to two full lines of 56px display type. It also falsifies the claim three
paragraphs below it that the hero keeps the page's largest type alone.

So the landing page takes a **named extension of `SectionHeading`** ([§6](#6-component-inventory))
with two scale variants, and the mapping is mechanical — it is the padding column, re-read:

- **96px chapter openings take `display-lg` (44px)**: S3, S4, S7, S11.
- **64px bands take `heading-md` (22px)** with the `eyebrow` prop carrying a `mono-sm` label above
  them, which is what that prop was added for: S2, S5, S6, S8, S9, S10.
- **`display-xl` (56px) belongs to the `h1`, once, on the whole page.** No second object is set at
  56px — including S7's `$0`, which takes `display-lg` for this reason alone.

No new token, no new size, no hand-edit of `tokens.css`: `display-lg` and `heading-md` already
exist and are already generated. The deviation is from `DESIGN.md`'s *component* spec, not from its
type scale, and it is recorded here rather than in `DESIGN.md` because it is a property of this
page and not of the design system.

Checks on that table, each of which the implementer should be able to verify by reading it:

- No two adjacent rows share both surface and density. S3→S4 share density, surface flips.
  S5→S6 share density, surface flips. S7→S8 share surface, density flips. S8→S9 both flip.
- **Surface alternation is bookkeeping, not a felt device, and the table should be read that way.**
  Cream `#fffbf5` and canvas `#ffffff` are about 1% apart in luminance; no reader perceives the
  flip, and auditing a rhythm rule against a difference nobody can see is how a page satisfies its
  own rule and still reads as a stack of equal boxes. The surface column is kept because it is what
  `contrast-usage.test.ts`'s `SURFACE` map is built from — it earns its place as a contrast input,
  not as rhythm. **Rhythm on this page is carried by the three columns that actually vary: heading
  scale, measure and density.**
- Voltage appears three times across twelve bands: the hero, one `card-voltage` inside S7, and
  the closing band. `DESIGN.md`'s "`card-voltage`: one per page, at most" holds; the closing band
  is a second `hero-section`, which `ui-direction.md` §2.2 argues for and this document adopts.
  Its headline sets at `display-lg` (44px), which is now true of every chapter opening and leaves
  the `h1` alone at 56px.
- Chapter openings at 96px: S1, S3, S4, S7, S11. S9 (roadmap) takes 64 rather than the 96
  `ui-direction.md` suggested, because at this order it follows the page's rest point and does not
  need a second signal of arrival.
- Rest points: S2 (sparse, four sentences and one numeral row, opening the body), S8 (sparse, at a
  680px measure, immediately after the page's two densest reading tasks), and the mono chip line in
  the hero. Three, roughly evenly spaced.
- **One element on the whole page leaves the 1080px wrap: the hero mock, which bleeds right to the
  viewport edge.** One deliberate width exception in twelve bands buys more rhythm than six
  imperceptible surface flips, and it is the page's one memorable image — see [S1](#s1--hero).
- Hairline top rules on every section **except** where the surface colour changes — S2's top edge
  (against the hero's voltage), S11's and S12's. The colour change is the divider there.

### S1 — Hero

**Purpose.** Name the product, state the category, prove the product is real, disclose the status,
and send the reader to the one thing that exists today.

**Heading, verbatim.** The `h1`:

> Pariksha — run real exams you host yourself.

**The constraint is binding; the string above is the copy that currently satisfies it.** At most
**45 characters, setting to no more than three lines at the 7fr measure**, with `Pariksha` first, a
category verb, and no present-tense claim that the application runs today. It is written as a
budget rather than only as a fixed string so that a later copy edit cannot silently reintroduce a
four-line wall; `T19` asserts the string, this paragraph governs any replacement for it.

The earlier draft of this heading — *Pariksha — run real exams on the internet, on infrastructure
you own.* — was 69 characters carrying two stacked prepositional phrases, and at `display-xl`
(56px, -1.4px tracking) in the 7fr column's ~600px measure it set to four lines with its first
break falling inside `Pariksha — run real`. `DESIGN.md:545` records the display register as
"confidence through tracking and scale"; a four-line headline whose product name shares a line with
a verb fragment is the opposite of that. `on the internet` was also doing no work on a page that
has already said Cloudflare Workers and browser runner, and it moves into the lead sentence, which
has room inside its 45 words.

The heading takes `text-wrap: balance`. **It does not take a hard `<br>`**: a `<br>` inside the
page's single highest-value extraction string risks an engine lifting `Pariksha —run real exams`,
and that cost is larger than the benefit of guaranteeing the product name a line of its own. Three
balanced lines under 45 characters is the guarantee; `Pariksha` alone on line one is a preference.

This moves the product name into the `h1`, reversing the Phase 3
controller decision recorded in `apps/web/test/landing.test.tsx`. Three reasons, from
`ui-direction.md` §1.4: a cream wordmark on voltage would have to be set at 24px or larger to be
legal and would then compete with the headline; the nav and footer already carry the wordmark
lockup with its Telugu and Devanagari sublabel, and a third instance makes the page introduce
itself twice; and an `h1` that opens with the product name and continues with the category verb is
the single highest-value string on the page for an answer engine asked "what is Pariksha".

The imperative is kept from `README.md`'s own tagline rather than rewritten to "Pariksha runs real
exams", which would read as a present-tense claim that the application works today.

**The argument.** Chip, then claim, then qualification, then action. The chip reads
`PRE-ALPHA · APACHE-2.0` — twenty-two characters of mono that make the status a stance rather than
a disclaimer. The lead sentence does two jobs in 24px: it lists the four capability nouns an
organiser is scanning for (question pools, twelve question types **in the format**, browser
proctoring, CSV results), says the exams run on the internet on infrastructure the reader owns, and
it dates the status. Approximately 45 words, which is also the extraction unit an answer
engine lifts.

The lead's second sentence must carry, in substance: *as of October 2026 the formats, the schemas,
a worked example and the scoring engine are published; the application lands with v0.1.* The date
is not optional — `seo-mechanics.md` §3.5e: "currently pre-alpha" becomes a lie when quoted six
months later, "as of October 2026" does not.

**Visual artefact.** The product's own test screen, rendered in real tokens, standing as a cream
plane on the voltage field. No photograph, no illustration, no gradient, no abstract shape. This
is `ui-direction.md` §1.6 and it is the page's central move: the marketing canvas is voltage, the
exam canvas is cream and ink, and putting one inside the other stages the design system's whole
inversion in a single picture. It also answers the pre-alpha problem without claiming anything —
the reader sees the screen the project has designed, drawn by the CSS that will draw the real one.

Layout: two-column asymmetric canvas inside the 1080px wrap, left `7fr` / right `5fr`,
`--space-3xl` gap, `align-items: start`, `96px`/`24px` padding, square corners. Full element
order, treatment and the responsive ladder are `ui-direction.md` §1.2, §1.3 and §1.7, adopted
unchanged. The mock's contents and its hard constraints are §3.3, adopted unchanged — true token
sizes, no `transform: scale`, no live clock, nothing interactive, content lifted from
`examples/reasoning-aptitude`.

**The mock bleeds, and that is the primary treatment rather than a contingency.** Inside the wrap
the 5fr column is about 433px at the 1080px breakpoint, and minus its own `--space-xl` padding it
holds roughly 385px of content. The mock's parts at true token sizes — two timer chips, an 18px
question stem whose design measure is 680px, four option rows at a 48px minimum, an eight-square
palette strip at 36px plus gaps, a save line — fit inside 385px, and they fit as a cramped
postcard holding 40% of the width while 56px display type holds the other 60%. The device the
whole hero argument rests on cannot be specified at thumbnail scale.

So: **the mock begins at the 7fr column's right edge and runs past the 1080px wrap to the
viewport's right edge**, roughly 640–760px of rendered surface at 1440px, cropped mid-palette. It
reads as a window onto a larger screen, which is `ui-direction.md` §3.3 constraint 1's own stronger
instruction — *"Cropping is a design decision; scaling is an accident"* — promoted here from
fallback to default. Every §3.3 constraint is intact: true sizes, no scale transform, no clock,
nothing interactive, `aria-hidden="true"` plus the adjacent `visually-hidden` sentence.

**The bleed is implemented as a negative margin on the grid item, guarded by `min()`, inside the
hero section's `overflow: hidden` clip — never as a negative margin outside an overflow-clipped
section.** A negative margin outside such a clip produces a document-level horizontal scrollbar at
some width, which P6 forbids; `P10` makes that explicit. Below the two-column breakpoint the mock
returns inside the wrap and crops from the right there too, per `ui-direction.md` §1.7.

**Source order: the mock's markup follows the hero's text block**, not the other way round, even
though it renders to the right. It is a ~60-element DOM subtree sitting inside the first 30% of the
document ([R3](#r3--the-machine-reader)), and `aria-hidden` hides it from assistive technology
without removing it from the HTML a passage extractor reads. Its text is also capped for the same
reason: the palette renders as bare numbers, and the candidate line reads `Candidate · 21CS0147`
rather than carrying a person's name, so no name-shaped string sits between the `h1` and S2's
definitional paragraph where a chunker can lift it as though it described the product.

**Calls to action.** Primary: `ButtonPrimary`, cream pill, the page's only shadow, label
**"Start with the worked example"** with the `→` inside `<span aria-hidden="true">`, href
`https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude`. The href is
unchanged from v1 deliberately — it is the one URL on the page that is both the highest-value
destination and already asserted by a passing test. Secondary: **a cream `--rounded-md` rectangle with an ink label at
`button-md`**, "Read the code on GitHub", to the repository.

That is `ui-direction.md` §1.5's fallback, **taken now rather than deferred to build**, and the
reason is arithmetic. `ButtonPrimary`'s label is `{typography.button-md}` — 16px (`DESIGN.md:537`).
§1.5's first choice, a 24px cream text link, is 50% larger than the primary it sits beside; the
page's single shadow does not outweigh an eight-point type difference at touching distance, so the
pair that was meant to read primary-then-secondary reads secondary-then-primary by size. §1.5's own
reasoning for avoiding a second *filled pill* is correct and is preserved: **shape carries the
hierarchy** — the pill means press this and stays scarce, the rectangle does not — the shadow stays
on the primary alone, and both labels sit at 16px. A ghosted or outlined button is still out: it
would need a sub-24px cream label on voltage, which is illegal. A hierarchy decision is not left to
whoever is nearest the keyboard.

**Components.** `HeroSection` (extended), `ButtonPrimary`, `ProductMock`.

**SEO/AEO role.** The `h1` is the canonical answer to "what is Pariksha". The chip supplies the
status token. First in source order, which is where ~44% of AI citations are drawn from.

### S2 — What is Pariksha?

**Purpose.** One paragraph a machine can lift whole, and a human can read in fifteen seconds. The
page's only band whose job is to be quoted.

**Heading, verbatim.** `What is Pariksha?`

**The argument.** Answer-first, no build-up. The paragraph opens "Pariksha is a free, open-source
exam platform that…" and names its subject in every sentence — never "it" (`seo-mechanics.md`
§3.5c: a lifted passage carries no context with it). 40–60 words. Substance, from
`content-inventory.md` §7 Q1: one deployment hosts many tests, each with its own URL, question
sets, registration form, access rules and proctoring policy; candidates sit tests in a browser;
organisers get scores and integrity reports as CSV.

Under it, the page's most quotable line — a **numeral row**, not a card grid and not a 12px mono
string. Three numerals at `display-lg` (44px), each with a `mono-sm` label beneath it:

| `12` | `5` | `3` |
| --- | --- | --- |
| `QUESTION TYPES` | `SCORING MODES` | `PROCTORING PROFILES · SPECIFIED` |

and one `mono-sm` line under the row: `Apache-2.0 · pre-alpha, October 2026`.

**The status words and the date are not optional, and the earlier draft of this line got the
sourcing wrong.** `content-inventory.md` §8 marks **12** and **5** as *Measured* — implemented and
tested in `packages/core` — and may print them bare. It marks **3 proctoring profiles** as
*Specified* (PRD `:288`): nothing is built. A line that exports an unbuilt capability as a measured
fact, undated, in the band this document designates "the page's only band whose job is to be
quoted", is exactly the G5 failure. So the third label carries the word `SPECIFIED`, and the line
beneath carries the date.

The design improvement and the accuracy correction turn out to be one edit: a numeral set at 44px
with its qualifier in the label is both the band's one image and its honest form. It is a numeral
row, not the card grid this section correctly rejects, and it gives the page's rest point something
to look at without adding a component.

**Visual artefact.** The numeral row, and nothing else. This is a rest point: four sentences,
generous leading, a 760px measure, no cards, no rules, no code. The restraint is the design — it is
the only band with nothing to parse, and it sits immediately under the page's loudest surface.

**Components.** `SectionHeading` (`heading-md` + `eyebrow`), `MonoCaption`.

**SEO/AEO role.** The highest-value extraction unit on the page after the `h1`. Must be within the
first 30% of the rendered HTML — asserted by `T32`, not assumed, because the hero's mock is ~60
elements of markup sitting above it.

### S3 — How running an exam works

**Purpose.** The teach spine. Three steps along the organiser's path, each carrying the real
artefact it produces. This is the section that earns the word "teach-first".

**Heading, verbatim.** `How does running an exam on Pariksha actually work?`

**The answer-first paragraph, written here rather than left to the implementer.** The `h2` is the
literal query, so the first child under it is the answer, not a step list. An engine that asks this
question and finds a heading followed immediately by step markup has been given nothing to lift.
This paragraph is the second most valuable sentence set on the page after S2's, and it is binding
copy at 40–60 words:

> Running an exam on Pariksha is three steps. An organiser writes questions as small documented
> objects, assembles them into a test whose sections draw from pools or hand out fixed sets, and
> publishes a URL. Candidates sit the test in a browser under a server-enforced clock. The
> organiser downloads one CSV row per candidate, with scores and integrity flags.

**The argument.** Three steps, no more. Each step is a `StepRow`: a mono step label, a
`heading-sm` title, two or three sentences, and one artefact.

**The ordinal, decided here** (it was previously left open in [§9](#9-left-to-the-implementer)).
`01 / 02 / 03` set large in `mono-sm`'s face but at `display-lg`'s scale, in `--color-muted`, in
the left margin of the row. S3 is the teach spine and the ordinals are the one place on this page a
number can be big without becoming a badge; left open, the default is a 12px label and three steps
read as three paragraphs. Not an icon, not a number in a coloured circle, not voltage.

| Step | Title | The argument | Artefact |
| --- | --- | --- | --- |
| 01 | Write the questions | A question is a small documented object: a prompt, options, a key, a score and an explanation. The key and the explanation live in the file and are stated never to reach a candidate's browser (PRD `S-10`). One sentence forward-references S6: an organiser builds this in a UI. | [CB-1](#4-every-code-block-and-example) |
| 02 | Assemble the test into sections | A section names where its questions come from: a fixed list, a random draw from a tagged pool, or fixed sets A/B/C handed out round-robin by registration order so neighbours never match. This is the single capability a form tool cannot have, and it is introduced here so the comparison table's row lands. | CB-2 |
| 03 | They sit it; you download the results | Server-enforced clock, answers queued and synced, one row per candidate out. Integrity comes out as a flag, never a verdict. | CB-3, plus the rendered results table |

Step 03's rendered results table is a real `<table class="results-table">` using
`DESIGN.md`'s `results-table` tokens, with the three rows from CB-3 and an `integrity-badge-*`
pill in the flag column. It is the page's second rendered product surface and its job is the
caption that goes under it — `content-inventory.md` §4.3, near-verbatim:

> Divya's row is the whole design in one line. The app recorded five tab switches and three
> fullscreen exits and marked the attempt `high_risk`. It did not cancel her result. A reviewer
> looked, wrote a note, and invited her to a supervised re-test.

That paragraph does more work than any feature list on the page. It is the product's ethic stated
as an anecdote with a name in it, and it is sourced.

**Components.** `SectionHeading` (`scale="chapter"`), `StepRow` ×3, `CodeBlock` ×3, plain
`results-table` markup.

**SEO/AEO role.** Question-shaped `h2`; three `h3`s that are the procedural spine. The visible
prose that `HowTo` JSON-LD would have described — and which, per `seo-mechanics.md` §5.2, is the
valuable half of it now that `HowTo` renders nothing anywhere.

### S4 — Why not a form tool, why not a paid platform

**Purpose.** Settle the comparison once, in the one format answer engines parse best, early enough
that a reader who came only for this gets it.

**Heading, verbatim.** `Why not a form tool, and why not a paid assessment platform?`

**The argument.** A real `<table>` with a `<caption>` and `scope` attributes — both because screen
readers need it and because a table is the single most liftable asset the project owns
(`seo-mechanics.md` §3.5d). Three compared categories, never named products.

The seven rows are `README.md`'s, with **three cells re-worded so that every row is true standing
alone**. A table ships at all because `seo-mechanics.md` §3.5d says a single row is the unit that
gets lifted; a row that is false or misleading on its own defeats the only reason for the format.
Three defects in the README's wording, each fixed:

| Row | README today | On the page | Why |
| --- | --- | --- | --- |
| Cost | `Free` / `Per candidate, per month` / **`Free`** | **`Cost to run`** — `Free` / `Per candidate or per month` / **`Free hosting tier, arithmetic published`** | Lifted alone, `Pariksha — Cost: Free` is a stronger claim than [S7](#s7--what-it-costs-and-where-it-runs) itself makes, where the same number is carefully an estimate. That is the G5 failure: quotable in six months, and a lie |
| Rich question types | `3–4` / `Yes` / **`12`** | **`—`** / **`Varies by vendor`** / **`12, including matching, ordering and numeric with tolerance`** | `3–4` is a quantitative claim about a named competitor category whose only citation chain is `README.md:34` restating itself, and `Multiple choice and free text` is the same defect in prose rather than digits — neither has a row in `content-inventory.md` §8 carrying an external source, which breaks [§9.1](#9-left-to-the-implementer)'s own rule, and `3–4` is wrong on the obvious reading — Google Forms offers roughly a dozen answer formats. Per the controller's D2 decision the free-form-tools cell makes no capability claim at all rather than a smaller uncited one; the row now claims only what the project can defend about itself |
| The corner cell | *(empty)* | **`What you need`** | An unlabelled first column parses as a stray data column in some extractors, and a lifted row keeps its axis from the first cell |

The four remaining rows stand: Question pools and sets · Camera, fullscreen and tab-switch checks ·
Where candidate data lives · Answer keys hidden from the browser · You can read and change the code.

**Three of those rows read `Yes` for Pariksha against `Yes` for assessment platforms**, and lifted
alone each one shows Pariksha matching a paid vendor and differentiating on nothing. They are kept
rather than dropped, because dropping them would leave a table that only lists wins — the X4 brag —
and the Pariksha cell carries the differentiator instead: pools and sets *with the selection code
readable and seeded*; camera, fullscreen and tab-switch checks *with no video or audio recorded*;
answer keys hidden from the browser *and the grading code open*. Each is sourced in
`content-inventory.md` §1 and §2.

**`README.md`'s own table should be brought into line in the same pull request.** Two wordings of
one sourced claim in one repository is precisely the maintenance hazard this page exists to avoid.

**No number about a competitor category appears anywhere on the page without a `content-inventory.md`
§8 row carrying an external source.** Add that sentence to §9.1's sourcing rule.

The device is `ui-direction.md` §4.1 and it is adopted without modification: the Pariksha column's
facts are set in `body-sm` ink on a continuous cream fill at 15.85:1; the two alternative columns
are `mono-sm` in muted at 5.18:1. **The argument is made typographically, not chromatically.** No
tick, no cross, no badge, no voltage fill. It survives greyscale, 200% zoom and reader mode,
because it was never colour. The 640px reflow to stacked cards, including the real
`<span class="cell-label">` rather than a `::before`, is §4.2, adopted unchanged.

Two things sit under the table, and they are **two different objects, not one block of small
print**. A `mono-sm` footnote stating that the comparison is against product categories rather than
named products, carrying the date it was written. And, set as **body text at the table's full
width and visually separated from that footnote**, the two sentences the table cannot carry — the
honest ones. They are the argument's conclusion; typeset as a footnote they read as a disclaimer.

> Moodle is the nearest open-source comparison and is more capable today than Pariksha is.
> Pariksha is not trying to replace it — it is trying to be lighter to run and to keep the test
> itself in one portable JSON file.

> A paid platform you can buy today will do more than Pariksha does today, because the Pariksha
> application is not built yet. What is built is the format, the schemas and the scoring engine —
> and you can run those today.

Both sentences are corrections of an earlier draft and both corrections matter.

The first draft of the Moodle sentence read *"Moodle comes closest among open-source tools and is
more capable today, but it is heavy to run and needs Safe Exam Browser installed"*, attributed to
PRD `:38` as "the PRD's own words". It was not the PRD's words — `docs/PRD.md:38` reads *"No
maintained open-source app combines modern proctoring, rich question types and zero-cost hosting.
Moodle comes closest, but it is heavy to run and needs Safe Exam Browser installed."* — and the
inventory's framing had been merged inside the attributed quotation. Worse, the Safe Exam Browser
clause is a factual claim about a named third-party product that cannot be defended: Moodle's Quiz
activity ships its own access rules and SEB is one optional quiz access rule, not a requirement. It
is the one sentence on this page a Moodle user would correct in public, and [§11](#11-what-was-rejected-and-why)
rejects naming competitors precisely to avoid that surface. The clause is deleted, the attribution
is dropped, and the PRD line stays in the PRD.

The second sentence is the page's **credibility hinge** and it was over-corrected. *"Pariksha does
nothing today"* is literally false, and this page disproves it twice: [S6](#s6--you-never-write-json-it-is-all-here-anyway)
calls CB-4 the only command on the page a visitor can run today that does something real, and
[S9](#s9--what-is-built-what-is-not) lists a tested scoring engine at 97/93/100/98 % coverage. A
reader who believes the sentence has no reason to run the command. The hinge is kept — a comparison
table on a pre-alpha project that does not say what it is not yet reads as a brag; one that says it
immediately underneath reads as a plan — and the page stops arguing against its own best evidence.
**Both of these strings are asserted by a test** (`T24b`), because either can be copy-edited away
without anything going red.

**Components.** `SectionHeading`, `ComparisonTable` (new), `MonoCaption`.

**SEO/AEO role.** The extraction target. Question-shaped heading, real table markup, categories
not names, dated footnote.

### S5 — What it does, by the job it does

**Purpose.** The feature catalogue, grouped the way an organiser's problem is grouped rather than
the way the codebase is. Structural rest after the comparison's reading load.

**Heading, verbatim.** `What does Pariksha do?`

**The argument.** Six `FeatureCell`s, each a job from `content-inventory.md` §1 (A–G), each
carrying the job's number and its status. The grouping is the argument: a reader does not want a
feature list, they want to know whether their problem is covered.

| Cell label | Title | Carries |
| --- | --- | --- |
| `TWELVE TYPES` | Every type a paper needs | The 12 named types; Markdown, code, LaTeX, images in every one; 5 scoring modes; the type/mode constraint is enforced, not left to arithmetic. Body, binding: *twelve types are defined in the format and graded today in `packages/core`. All twelve ship with v0.1 (`docs/ROADMAP.md:203`).* |
| `PER CANDIDATE` | A different paper for everyone | Pools filtered by tag and difficulty, fixed sets round-robin, seeded shuffle that survives a refresh |
| `REGISTRATION` | A form you design per test | 11 field types, `unique: true` blocking repeat registration, every rule re-checked on the server |
| `PROCTORING` | Off, Standard or Strict | The escalation; **no video and no audio are ever recorded**; on-device face counting, no biometric template stored |
| `FLAGS, NOT VERDICTS` | The app flags, a person decides | `clean` / `review` / `high_risk` with the events behind it |
| `RESULTS` | Results that fit your spreadsheet | Live monitor, grading queue, item analysis, CSV with a column per form field and section, REST API, signed webhooks |

**The grid is asymmetric.** Three columns at the full wrap, stacking below; **the first cell
(`TWELVE TYPES`) spans two columns**, because it carries the twelve names as a real list and is the
longest. Grid asymmetry costs nothing and it is what stops a six-cell catalogue reading as tile,
tile, tile.

One `CodeBlock` ([CB-6](#4-every-code-block-and-example)) sits under the grid as a single line,
captioned *scoring, as the example test declares it* — the proof that "five scoring modes" is
arithmetic in a file rather than a bullet.

**Status discipline, binding, and the lead line must name the release.** Of those six, only the
twelve types, the five modes and the selection logic are **SHIPPED** today; registration,
proctoring, flags and results are **SPECIFIED**. The cells may not be written in a present tense
that implies a running application. The section's lead line carries the distinction once, so no
cell needs a badge:

> The scoring and selection engines are built and tested; everything else on this page is
> specified. v0.1 ships all twelve question types, the test builder and the candidate runtime;
> proctoring and results follow in v0.2.

The earlier draft ended *"...is specified and lands with the application"*, which the first revision
walked back to a six-in-v0.1 split on the strength of `README.md:156-159` — and that split was
itself wrong. `docs/ROADMAP.md` is authoritative over `README.md` on phasing (`docs/ROADMAP.md`'s
own header: "the PRD wins on what and this file wins on when"), and `docs/ROADMAP.md:203` states
plainly that all 12 question types land in Phase 1, not spread to v0.3; its milestone mapping
(`:214-215`) puts the test builder (Phase 5) and the candidate runtime (Phase 6) in v0.1 too, with
proctoring and results (Phases 7–8) following in v0.2. `README.md:156` is corrected in the same pull
request that corrects this document. Only BYOK (Phase 9) stays off the v0.1 list. A reader finishing
this page should believe the first shipped release gives them twelve types, a test builder and a
candidate runtime — because it does.

The twelve are real in `packages/core` today and [S9](#s9--what-is-built-what-is-not) says so
correctly. **So "12 question types" is a format-and-engine fact everywhere it appears, and the page
says so**: the hero lead reads "twelve question types in the format", S2's numeral row carries
`QUESTION TYPES` under a measured `12`, and the one place it is allowed to stand bare is the meta
description, which has no room for the qualifier and carries the date and the status instead
(SEO-9). `T26b` enforces the rest mechanically.

**Components.** `SectionHeading`, `FeatureCell` ×6, `CodeBlock`.

**SEO/AEO role.** Proper-noun density (`seo-mechanics.md` §3.5f) and the "how many question types"
query. The twelve type names appear as a real list, not an image.

### S6 — You never write JSON. It is all here anyway.

**Purpose.** Resolve the tension the previous three sections created. Six code blocks on a page
can leave a reader thinking they must write them; this band says they never will, and then says
why the format is published anyway.

**Heading, verbatim.** `Does an organiser ever have to write JSON?`

**The argument.** An answer-first paragraph, then the sentence the band exists for, then two
columns. The 40–60 word answer comes **first**, as the `h2`'s direct answer; the quote follows it
rather than replacing it, because a 25-word quotation opening with "You will never have to write
this" has no subject and cannot be lifted (SEO-28).

> No. Organisers build questions and tests in a Pariksha UI: one editing screen for all twelve
> types, a type picker, a drag-to-reorder section list, live pool counts and a publish checklist.
> The JSON exists so that you can hand-author, script, diff or export a test if you want to — and
> so that nothing you build is locked into Pariksha.

Then, set as the band's pull quote, the sentence from `content-inventory.md` §5 verbatim:

> You will never have to write this. It is here so that you can — and so that nothing you build is
> trapped.

**Left column — the builder.** A rendered mock of the question editor: `category-tab` pills for the
type picker, `field-label` plus `text-input` for the prompt, option rows with correct and pin
toggles, a numeric points field. Real components at real sizes, the same four constraints as the
runner mock (`ui-direction.md` §3.3). Beside it, three of the UX decisions from `docs/design.md`
that are concrete enough to be convincing: one editing screen for all twelve types with only the
answer block changing (UX-07); only the scoring modes the type supports are offered, so an invalid
combination cannot be entered (UX-07); typing `{{1}}` in the prompt grows a blank row underneath
(UX-21).

**Honesty, binding.** Every screen in that column is **ROADMAP** — Phases 4 and 5, none of it
built. The column header says so in plain words, once: *the authoring interface is designed and
not yet built; this is the design.* The mock carries the same statement in its visually-hidden
description.

**Right column — the format.** Why it is published: hand-author in a text editor against a
documented schema; generate a bank from a script and import it all-or-nothing with a line-by-line
error report; export a whole test as one file and import it into a different installation; diff a
test in git and review a question set in a pull request; a breaking change requires `@2`, a new
schema file and a converter. Carries [CB-4](#4-every-code-block-and-example), the `npx ajv`
command — which is, per `content-inventory.md` §4.4, **the only command on this page a visitor can
run today that does something real.**

**Components.** `SectionHeading`, `ProductMock`, `CodeBlock`, `CardHairline`.

**SEO/AEO role.** Answers "do I have to write JSON" directly; this heading is why FAQ question Q12
is dropped from S10 rather than duplicated.

### S7 — What it costs, and where it runs

**Purpose.** The bridge from teaching to decision, and the page's one in-body voltage object.

**Heading, verbatim.** `What does it cost to run an exam on Pariksha?`

**The argument.** `CardVoltage` carrying the claim alone, beside a `CardHairline` carrying the
arithmetic. **The claim is set as one numeral and one sentence** — `$0` at `display-lg` (44px) in
cream on voltage, with the rest at `hero-lead` beneath it:

> **$0**
> of hosting for a 500-candidate hour — by arithmetic, not by measurement.

That is the page's one big numeral in the body, which is what a reader quotes, and it is at 44px
rather than 56px so that the `h1` keeps `display-xl` alone across the whole page.

**Both qualifications are binding, not one.** The earlier draft read `$0 to run a test for 500
candidates in one hour.` and required only that the adjacent card call the `$0` an estimate. It
missed that **500 is a second unproven number inside the same sentence**, and that the budget table
beside it is arithmetic about *cost*, not evidence about *capacity*. `content-inventory.md` §8
marks 500 an "**Estimated** capacity target; `AC-29` is the k6 run that would measure it (Phase
12)", and its "Numbers NOT to print" list bans "500 candidates, proven". Set in the page's largest
in-body type on its loudest surface, the earlier sentence read as a capacity claim for an
application that has not been written, let alone load-tested. So the `CardHairline` beside it
**opens** with both, in these words:

> An estimate with published arithmetic. The 500-candidate figure is a design target; the load test
> that would prove it (`AC-29`) is a Phase 12 gate and has not been run.

That sentence is binding copy in the same way CB-5's footer line is. The budget table is v1's, unchanged: Worker requests
100,000/day against about 55,000; D1 rows written 100,000/day against about 55,000; R2 storage
10 GB/month against about 0.75 GB.

Two deploy cards below: Cloudflare free plan (Workers, D1, R2, Cron) and Docker on any server
(Node 22, SQLite or Postgres 16, MinIO/S3/disk, Caddy), with the one-line architecture claim —
written as the **decision** it is, not as a property the software has:

> The architecture is three adapter seams — database, object storage, identity — so moving between
> them is configuration, not a rewrite. ADR 0002; the adapters are Phase 2 and not built.

`docs/ROADMAP.md:30-35` records Phase 2 as **Not started**; `packages/db` and `packages/storage` do
not exist yet. A seam that has not been cut is a design decision, and the sentence says which.

Then the honest ones, which this section must carry rather than bury: free-tier limits can change,
and that is the named risk against the zero-cost promise (PRD `:675`); password sign-in is not
available on the Cloudflare free plan because a Worker gets 10 ms of CPU per request, too little
for safe Argon2id, so organiser sign-in there is OIDC or magic links (PRD `S-01`).

[CB-5](#4-every-code-block-and-example) closes the band, with its caveat attached rather than
nearby: the three-line deploy shown is how *this website* is published; the exam API is Phase 2.
The organiser's five-step deploy is specified, not built, and is labelled as such if mentioned.

**Components.** `SectionHeading`, `CardVoltage`, `CardHairline` ×3, `CodeBlock`, `ButtonSecondary`
×2.

**SEO/AEO role.** "How much does it cost to run" is a literal query string; the heading is it. The
table is a second liftable structure.

### S8 — Who it is not for

**Purpose.** The page's strongest trust signal, and its rest point. Immediately after the cost
claim, which is where a sceptical reader is at their most sceptical.

**Heading, verbatim.** `Who is Pariksha not for?`

**The argument.** One 40–60 word answer paragraph naming Pariksha, then eight sourced sentences
from `content-inventory.md` §3, as prose rows — no cards, no rules, no code, no icons, generous
leading.

**The measure is 680px, narrower than every other band on the page.** This is the page's rest
point, and a letter-width column is how a rest point is signalled without reaching for a card. It
is also the only place measure is used as a deliberate signal rather than as a default, which is
what makes it legible as one.

Nothing else about this band changes. Do not shorten it, do not turn it into cards, do not soften
one of the eight, and do not let the FAQ's answer-first rewrite sand the same quality off: these
are eight definitive, unhedged, self-contained sentences, and `seo-mechanics.md` §3.5 measures
definitive language as roughly twice as likely to be cited as hedged marketing prose. It is the
most citable passage this project will own. The first is the one that matters most:
**anyone who needs to run a test this week.** Then: anyone who wants somebody else to host it;
high-stakes examinations that must be invigilated; anyone needing live human proctoring or a
lockdown browser; tests candidates will sit on a phone; coding interviews needing a code runner;
organisations whose policy requires a vendor to carry the liability; anyone who wants an AI to
decide who cheated — *and that last one is not a limitation to be lifted later, it is the design.*

**Components.** `SectionHeading`, plain markup.

**SEO/AEO role.** A high-density passage of definitive language, which `seo-mechanics.md` §3.5
identifies as roughly twice as likely to be cited as hedged marketing prose. It will be quoted.
That is the point.

### S9 — What is built, what is not

**Purpose.** Convert the status from a disclaimer into a plan, and place BYOK where it cannot be
mistaken for a feature.

**Heading, verbatim.** `What is built today, and what is not?`

**The answer-first paragraph, and the query it is shaped for.** Nothing else on the page is shaped
like "when will Pariksha be released", which is what a reader types at this point, so this band's
first paragraph opens on the release framing before it opens on the status: *Pariksha has not been
released yet. As of October 2026 the formats, their JSON Schemas, a worked example and the scoring
engine are published and tested; the application lands with v0.1...* 40–60 words, naming Pariksha
in the first sentence.

**The argument.** Three plain lists under three `h3`s, using the inventory's own vocabulary:

- **Built and tested** — the question and test formats, their JSON Schemas, a worked example of 17
  questions covering all 12 types, and `packages/core`: all 12 types graded, all 5 scoring modes,
  cross-field import validation, seeded selection and shuffling. Phase 1 landed with 173 tests and
  97/93/100/98 % coverage of `packages/core/src`, gated in CI. (Quote "Phase 1 landed with 173
  tests" — never a bare present-tense "173 tests"; `content-inventory.md` §8 explains why.)
- **Specified, not built** — the application: the authoring UI, the test builder, the candidate
  runtime, proctoring, results and the API. Links to the PRD and the roadmap.
- **Roadmap** — **twelve build phases under four product milestones. One complete, a second part
  done — this website is its output.** `docs/ROADMAP.md:30-35` records Phase 1 **Done** and Phase 3
  **Part done**; "one of twelve complete" was correct and undersold the project in the other
  direction, which is its own kind of dishonesty on a page whose whole argument is calibration.
  BYOK is here, in its own `CardHairline`, carrying `content-inventory.md` §6's short phrasing
  verbatim:

> **BYOK question drafting · Phase 9, not built.** Your own Anthropic or OpenAI key, encrypted per
> workspace, never sent to the browser. Drafts questions into a bank, never whole tests. Validated
> like an import, rejected whole if it fails, reviewed by a human before use. You set a spend cap.

Two sentences follow it, also sourced: Pariksha ships no model keys and makes no outbound AI
request on its own behalf, and a deployment with no key configured behaves exactly as it does now;
the decision record comes before any of it is written.

**Phrases that may not appear anywhere on the page:** "AI-powered", "generate a test with AI", "AI
question generation" without a status label, anything implying Pariksha calls a model for you, any
pricing claim for it, any suggestion the key store exists.

**The roadmap is a typographic ledger, and it is the band's one designed object.** The twelve
phases are the most informative thing this project can draw, and leaving them as an unstyled list
wastes them. Twelve `<li>`s in an `<ol>`, laid out on a grid, full width:

- a `mono-sm` ordinal per row — `01` … `12`;
- a hairline rule per row, so the twelve read as a ledger rather than as a list;
- **the complete phase set in `--color-ink`, the part-done phase in ink with a `mono-sm` `PART
  DONE` label, the ten not-started phases in `--color-muted`** — state carried by weight and tone,
  never by a badge or a fill;
- the four product milestones (v0.1, v0.2, v0.3, v1.0) labelled in the left margin, grouping the
  rows they contain.

No new component: [§6](#6-component-inventory) declines a `Timeline` in favour of "an ordered list
with a `mono-sm` label per row", and this is exactly that list, styled. It is twelve `<li>`s and a
grid, it is the page's only picture of the project's real shape, and it is what makes the pre-alpha
status read as a plan rather than as an apology — which is this band's stated purpose.

**Components.** `SectionHeading`, `CardHairline`, `MonoCaption`, the roadmap `<ol>`, plain lists.

**SEO/AEO role.** The dated status paragraph that keeps every lifted quotation of this page honest.
Must contain the literal string `pre-alpha` and the literal date.

### S10 — Questions and answers

**Purpose.** Cover the queries no section owns, in the shape an answer engine extracts.

**Heading, verbatim.** `Questions and answers`

**The argument.** **Thirteen** `h3`s, each a literal question, each followed by one 40–60 word
answer. The copy is sourced from `content-inventory.md` §7 — already written to that length and
already cited. Drop Q12 (do I have to write JSON) because S6's heading is that question, and drop
Q1 (what is Pariksha) because S2 is. From the remaining eighteen take the thirteen with the
highest query value: **Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q13, Q14, Q15.**

**Q11 is restored, and it is the most important addition in this revision.** *"How is it different
from Mettl, HackerEarth or Testlify?"* is the highest-intent answer this project has already
written and sourced, and the earlier draft dropped it. The consequence was that the strings
`Mettl`, `HackerEarth`, `Testlify` and `Testportal` appeared nowhere in `dist/index.html`, so the
page won nothing for "open source Mettl alternative", "self-hosted HackerEarth alternative" or
"Testlify alternative free" — the exact query class a self-hosted competitor exists to capture, and
the class where an answer engine must name a product to answer at all. [§11](#11-what-was-rejected-and-why)
justified the omission by citing `seo-mechanics.md` §5.7, but §5.7 forbids scaled `/vs/<product>`
pages; it does not forbid naming a product once, in one dated, sourced sentence. The page had
already crossed the naming line twice — Google Forms in Q10's heading, Moodle under the table — for
the lower-intent half of the market.

**The table stays category-only.** That is the maintenance surface and the legal surface, and it
does not move. Four proper nouns inside one 40–60 word answer under an `h3` that is the literal
query is where an extractor looks for a named comparison, and it carries no obligation beyond a
dated sentence.

**Microsoft Forms goes in Q10's body, not in its heading.** A heading is "the string people type"
(SEO-26), and nobody types two form products at once; the body is where the second proper noun
belongs, and Q10's body has to be rewritten anyway — see the next rule. The string still reaches
`dist/index.html`, which is what naming it is for.

**Per the controller's D2 decision, two specific phrasings are barred from Q10's and Q11's bodies.**
*"Microsoft Forms offers none of those either"* is a capability assertion about a named competitor
with no `content-inventory.md` §8 row carrying an external source, so it does not appear at all —
Q10 needs no second negative sentence once the first already names Google Forms. And *"twelve
question types rather than a form's handful"* is not a claim this project can defend about either
Forms product; it becomes a claim about Pariksha alone, stated as Pariksha's own fact with no
implied count for the competitor. **Any sentence naming a vendor carries a dated qualifier** — "as
published in October 2026" or equivalent — so it is defensible as a snapshot rather than a standing
comparison. Testportal is named once, in Q11, so its query class is captured too.

**Binding: every answer's first sentence names Pariksha and restates enough of the question to
stand alone.** `content-inventory.md` §7 is a *source*, not a style guide. Six of its answers never
contain the word Pariksha, and five open on a bare negation — "Not as an application.", "Nothing on
the reference deployment.", "No. No video and no audio are ever recorded.", "Not yet." Lifted as a
chunk, *"No video and no audio are ever recorded"* has no subject and can be attributed to
anything; *"Nothing on the reference deployment"* is unparseable alone. Q10 was the worst case: the
one answer targeting the page's most-wanted comparison query named neither Pariksha nor Google
Forms in its body. This is the page's densest extraction band and it was written in the one shape
`seo-mechanics.md` §3.5c says does not survive extraction.

So: *"Pariksha does not record video or audio of candidates."* then the detail. Keep the sourcing,
keep the word count, keep every verb exactly as definitive as it is — **the fix is to add the
subject, never to hedge the verb.** `T23b` asserts it mechanically.

**Form: a two-column question grid at ≥900px, stacking below.** Thirteen stacked heading-and-
paragraph units at the full 1080px measure is the most monotonous run of markup the page could
contain, and it is where "it is long rather than dense" ([X7](#anti-goals)) actually bites. Two
columns is the same markup and the same crawler surface at half the scroll, and it makes the
question set scannable as a *set* rather than read as a queue.

Plain headings and paragraphs. **Not** `<details>`, not an accordion: content a crawler has to
open is content it may never see, and the page has nothing worth hiding.

**If `P2`'s 100 KB budget is exceeded, the deletion order is decided here** rather than panicked
over at build time: Q3 (what the name means), then Q15 (licence), then Q5 (where data is stored,
which S7 and S4 both already carry), then Q9. Then S5's sixth `FeatureCell`. Q11, Q10, Q2, Q4, Q6
and Q13 are not deletable — they are the band's whole query value.

**Components.** `SectionHeading`, plain markup.

**SEO/AEO role.** The question-shaped heading set. The `FAQPage` JSON-LD is deliberately not
shipped — see [§11](#11-what-was-rejected-and-why) — but the prose it would have wrapped is here,
which is the half that still works.

### S11 — Closing

**Purpose.** One sentence and one action, on the canvas the page opened with.

**Heading, verbatim.** `Read one real test, end to end.`

**The argument.** Two columns, `6fr / 6fr`. Left: the `h2` at `display-lg` (44px), one lead
sentence at `hero-lead` saying what the folder contains, one `ButtonPrimary` to
`examples/reasoning-aptitude`. **Right: the folder itself, rendered as a cream plane on voltage** —
a file listing with a line count against each name (M-4):

```
questions.json    260 lines    17 questions, all 12 types
test.json         213 lines    3 sections: pool, fixed sets A/B, fixed list
candidates.csv      7 lines    6 candidates
results.csv         7 lines    29 columns per row
README.md         451 lines    what the organiser writes, what the candidate sees
```

**Why this and not a second headline.** The earlier draft made S11 `HeroSection` again, on voltage
again, with `ButtonPrimary` again, pointing at the same URL as the hero's CTA, under a headline
12px smaller — and defended it as the reader *returning* to the voltage. A reader does not
experience a return; they experience the same object twice with a smaller headline. That is
anti-goal [X7](#anti-goals) applied to this document's own band, and it spends the page's scarcest
asset twice on one picture.

The three-instance voltage count is unchanged; the picture is not. **The page opens on the
candidate's screen and closes on the organiser's folder** — two different cream planes on the same
field, bookending the argument instead of repeating it. It is also the page's third and last
rendered surface, and the cheapest: a `<ul>` of five rows in a cream plane.

**M-4 is not a `ProductMock` and is not `aria-hidden`.** It is a real listing of real files with
real line counts, which a screen-reader user should read exactly as a sighted one does. Line counts
are verified against the repository as of 2026-10-17 and must be re-checked if the example changes;
`T22` asserts the band, not the integers.

**Components.** `HeroSection` (second instance, `display-lg` variant), `ButtonPrimary`, plain list
markup on a cream plane.

### S12 — Footer

**Purpose.** Unchanged from v1 and deliberately so. Three columns — Documentation, Project, Licence
— and the closing mono gloss with the Telugu and Devanagari forms and their `lang` attributes.

**Change.** Add the schemas directory and the roadmap to the Documentation column; everything else
stands. The `<h2 class="visually-hidden">Footer</h2>` stays — it is load-bearing for the heading-
order test.

---

## 4. Every code block and example

Every block is lifted from a file in this repository, is already covered by CI's schema-validation
job, and carries a caption bar naming its source file. The caption bar is not decoration: it tells
a reader what they are looking at and tells a crawler what the block is. The block object's three
parts, its fills, its border tone and its syntax-colour roles are `ui-direction.md` §3.1–§3.2,
adopted unchanged. **Four syntax roles, no more, no new hex, no highlighting dependency** — the
spans are written by hand at author time.

### CB-1 — A question (S3, step 01)

Source: `examples/reasoning-aptitude/questions.json`, verbatim, lines 85–100. Verified against the
file on 2026-10-17. This is the same question the hero's runner mock renders, so the page shows the
input and the output of one artefact.

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

Caption bar: `examples/reasoning-aptitude/questions.json`.
Footer line: `16 more questions, covering all 12 types · read the whole file →`.
Prose caption beside it: *the `key` and the `explanation` live in the file, never in the
candidate's browser.* (PRD `S-10`.)

### CB-2 — A section that draws from a pool (S3, step 02)

Source: `examples/reasoning-aptitude/test.json`, the `quant` section. The `instructions` string is
removed to keep the block phone-sized; **nothing else is changed, and the footer line says so.**

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

Caption bar: `examples/reasoning-aptitude/test.json`.
Footer line: `instructions trimmed · two more sections: fixed sets A/B, and a fixed list →`.
Prose caption: *four questions drawn at random, for each candidate, from everything tagged
`quantitative`.*

### CB-3 — The results CSV (S3, step 03)

Source: `examples/reasoning-aptitude/README.md:414-418`, the README's own trimmed form. The real
file at `examples/reasoning-aptitude/results.csv` has 29 columns.

```csv
Full name,...,Set,...,Score,Max score,Percent,Rank,Result,...,Integrity flag,Reviewer verdict,...
Fatima Sheikh,...,A,...,24.00,27,88.9,1,Pass,...,clean,,...
Ananya Rao,...,A,...,21.50,27,79.6,2,Pass,...,review,Clear,...
Divya Menon,...,A,...,9.50,27,35.2,6,Fail,...,high_risk,Suspicious,...
```

Caption bar: `examples/reasoning-aptitude/results.csv`.
Footer line: `29 columns in the real file — one per registration field, one per section →`.
Prose caption: the Divya paragraph quoted in [S3](#s3--how-running-an-exam-works).

### CB-4 — Validate your own questions today (S6)

Source: **the first of the two commands at `README.md:139-148`**, verbatim. The README shows two
ajv invocations; this block shows the first, and saying so keeps the verbatim claim exactly true —
the same discipline CB-2 already applies to its trimmed `instructions`. It is the only command on
the page a visitor can run today.

```bash
git clone https://github.com/SriSatyaLokesh/pariksha.git
cd pariksha

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"
```

Caption bar: `Validate questions against the schema — no install`.
Prose caption, from `README.md:150`: *write your own questions, validate them, and they will import
into Pariksha on day one.*

This block overflows horizontally at every width. It is one of the three things on the page
permitted to be wider than the body measure, inside its own `overflow-x: auto`,
`tabIndex={0}`, `role="region"`, `aria-labelledby` container.

### CB-5 — How this website is deployed (S7)

Source: `deploy/cloudflare/README.md`, verbatim.

```bash
pnpm install && pnpm build
pnpm --filter @pariksha/web exec wrangler login
pnpm --filter @pariksha/web deploy
```

Caption bar: `deploy/cloudflare/README.md`.
Footer line, **binding and not optional**: `this deploys the site you are reading. The exam API is
Phase 2.` The two deploys in this repository must never be blurred; a reader who thinks these three
lines deploy an exam platform has been misled by the page.

### CB-6 — Scoring, as the test declares it (S5)

Source: `examples/reasoning-aptitude/test.json`, the `scoring` object, re-flowed to one line.

```json
"scoring": { "default_mode": "negative", "negative_fraction": 0.25, "pass_mark_percent": 50 }
```

Caption bar: `examples/reasoning-aptitude/test.json`.
Prose caption: *a wrong answer costs a quarter of the question's points; a blank costs nothing.*

### Rendered surfaces, not code blocks

| # | Where | What | Source of content |
| --- | --- | --- | --- |
| M-1 | S1 hero | The candidate's test screen: section line, two timer chips, question stem, four option rows with one selected, the palette strip in all four states, the save line. **Bleeds past the wrap to the viewport's right edge, cropped mid-palette** | `examples/reasoning-aptitude`, question `LOG-001`; candidate line reads `Candidate · 21CS0147`, palette renders as bare numbers |
| M-2 | S6 left | The question editor: type pills, prompt field, option rows with correct and pin toggles, points field | `docs/design.md` UX-06, UX-07 |
| M-3 | S3 step 03 | A real `results-table` of three rows with integrity badges | CB-3's three rows |
| M-4 | S11 right | The worked example's file listing on a cream plane: five filenames, line counts, one phrase each | `examples/reasoning-aptitude/`, line counts verified 2026-10-17 |

M-1 and M-2 are wrapped in `ProductMock`, which supplies `aria-hidden="true"` and the adjacent
`visually-hidden` sentence. M-3 and M-4 are **not** `aria-hidden`: M-3 is genuine tabular content
and M-4 is a genuine file listing, and a screen-reader user should read both exactly as a sighted
reader does.

**M-1's text is capped, and the reason is extraction, not taste.** `aria-hidden="true"` removes the
mock from the accessibility tree; it does not remove it from the HTML, and passage extractors do
not honour it. M-1 renders roughly sixty elements of fictional content inside the first 30% of the
document — the band `seo-mechanics.md` §3.5 identifies as the source of ~44% of AI citations — so
its markup follows the hero's text block in source order, its palette renders as numbers rather
than state words, and the candidate line carries a roll number with no name. A chunker reading the
top of this page must not be able to lift a person's name and a series puzzle as though they
described the product. `T32` asserts the placement claim that this rule exists to protect.

**The ASCII test screen from `README.md:71-85` does not appear on the page.** It was the obvious
candidate and it is the wrong one: it contains a lock emoji against the project's no-emoji rule,
it cannot reflow at 400px, and a rendered surface drawn by the real tokens is strictly better
evidence than a drawing of one. The lock state in M-1 is carried by the word `locked` plus the
`state-locked` token — two carriers, no glyph, and `DESIGN.md` records that no icon set has been
chosen yet. This closes the open question `content-inventory.md` §4.5 raised.

---

## 5. SEO, AEO, GEO, AIO as a numbered list

Each item is testable. The test that proves it is in [§8](#8-the-test-plan). The research is
`seo-mechanics.md`; this section is the decisions taken from it, including the three it left open.

### Prerendering — the item everything else depends on

- **SEO-1. The landing page prerenders to static HTML at build time.** New
  `apps/web/src/entry-prerender.tsx` exporting `renderToStaticMarkup(<Landing />)`; new
  `scripts/prerender.mjs` at the repository root; `apps/web/package.json`'s build becomes
  `vite build && node ../../scripts/prerender.mjs`. The script's shape is `seo-mechanics.md` §1.3,
  including the `includes("<h1")` guard that fails the build if the string replace ever silently
  no-ops. Keep that guard — a silent no-op shipping an empty page is the exact failure this task
  exists to stop. No new dependency: `react-dom/server` already ships with `react-dom`.
- **SEO-2. `/` ships zero client JavaScript.** `renderToStaticMarkup`, not `renderToString`; the
  `<script type="module" src="/src/main.tsx">` is removed from `apps/web/index.html`. The page has
  no state, no handler and no effect, and under this contract it never gains one. The consequence
  is accepted deliberately: the issue-137 "`TopNav` marks no current section" item is **deferred**,
  because `aria-current` on a one-page scroll nav is a nicety and client state on a page whose
  entire crawler strategy is static HTML is a contradiction. Upgrade path if it is ever wanted: a
  ~15-line vanilla `IntersectionObserver` module in its own entry, not React.
- **SEO-3. The stylesheet is linked from the HTML entry.** `landing.css` must `@import` `base.css`,
  `fonts.css` and `tokens.css`, or `index.html` lists all four `<link>`s. Vite hashes
  `<link href>` in an HTML entry exactly as it does a script. Without this the page ships unstyled,
  because `main.tsx` was what pulled the CSS into the module graph (`seo-mechanics.md` §1.4b).
- **SEO-4. `dist/404.html` is emitted by the prerender**, carrying the same shell, a short message
  and `<meta name="robots" content="noindex">`; `apps/web/wrangler.jsonc` gains
  `"not_found_handling": "404-page"`. Never `"single-page-application"` — that serves the landing
  page with HTTP 200 at every bogus URL, which is soft-404 spam at scale. The file is scanned by
  the hex guard, so no hex in it.
- **SEO-5. `admin.html` stays out of the index.** `<meta name="robots" content="noindex, nofollow">`
  in the file, and an `/admin.html` block in `public/_headers` carrying
  `X-Robots-Tag: noindex`.

### The origin

- **SEO-6. One build-time origin, `SITE_URL`, defined once in `scripts/prerender.mjs`** and read by
  everything that emits an absolute URL: canonical, `og:url`, JSON-LD `@id`s, `sitemap.xml`,
  `robots.txt`'s `Sitemap:` line, `llms.txt`. **Read from `process.env.SITE_URL`, and `scripts/prerender.mjs`
  throws when it is unset or does not parse as an absolute `https` origin**, with the message
  naming [OQ-1](#10-open-questions-for-the-owner). There is no placeholder fallback. This is the
  same class of guard as SEO-1's `includes("<h1")` check and it exists for the same reason: the
  failure mode to stop is the silent one. With a fallback, every test that touches `SITE_URL`
  (T7, T9, T14, T16) compares `dist/` against that same constant, so the suite is self-consistent
  and verifies nothing about reality — the build ships green with a canonical, an `og:url`, five
  JSON-LD `@id`s, `sitemap.xml`, `robots.txt`'s `Sitemap:` line and `llms.txt` all pointing at an
  origin that does not serve the page. A canonical pointing at a non-serving host is worse than no
  canonical: it is a self-reported duplicate that can keep the real URL out of the index entirely,
  and it is the one failure here that is expensive to unwind once an engine has cached it. Local
  and CI builds set `SITE_URL` to the real `workers.dev` URL. If a preview build ever needs its
  own value it must be a real reachable origin, and the canonical is checked against the serving
  host before the first public deploy. No second hard-coded origin anywhere in `dist/` except
  `github.com` links.
- **SEO-7.** When a custom domain is added, `apps/web/wrangler.jsonc` sets `"workers_dev": false`
  and `"preview_urls": false`, or the same page indexes on two hosts plus every preview URL. The
  file must stay comment-free and trailing-comma-free; two existing tests `JSON.parse` it.

### Head metadata

All static in `apps/web/index.html` except where noted. There is no runtime to compute them.

- **SEO-8. `<title>`** — `Pariksha — run real exams you host yourself` (43 characters), matching
  the `h1`. v1's title was `Pariksha — run real exams on infrastructure you own`; it moves with the
  headline so that the page's two most-lifted strings do not say two different things.
- **SEO-9. `<meta name="description">`**, 110–160 characters, carrying the status **and its date**:
  `Pariksha is an open-source, self-hosted exam platform: question pools, 12 question types, browser proctoring, CSV results. Pre-alpha as of October 2026.`
  (152 characters.)

  The earlier draft read `Open-source, self-hosted exam platform. Question pools, 12 question types,
  browser proctoring and CSV results, at zero hosting cost. Apache-2.0, pre-alpha.` and broke this
  document's own rules in the one string SEO-32 says gets lifted verbatim and repeated for months.
  It named no subject (SEO-28). Its status was undated and sat last, after a full stop — the clause
  an answer engine drops first when it trims to fit — which is precisely what SEO-29 forbids. And
  `at zero hosting cost` stated [S7](#s7--what-it-costs-and-where-it-runs)'s estimate as a flat
  fact in the one string that is never read beside its arithmetic. The replacement keeps the
  literal `pre-alpha` (SEO-32), dates it (SEO-29), names its subject (SEO-28), and drops the one
  claim that cannot travel without its qualifier. `12 question types` stands bare here and nowhere
  else on the page: there is no room for the format-and-engine qualifier inside 160 characters, and
  the date and status that *are* in the string are the more load-bearing pair.

- **SEO-9b. The four long-lived description strings come from one constant.** The meta description,
  `og:description`, `SoftwareApplication.releaseNotes` and `llms.txt`'s opening blockquote are
  derived in `scripts/prerender.mjs` from a single `DESCRIPTION` / `STATUS_LINE` pair, so they
  cannot drift apart. Today `releaseNotes` hard-codes `2026-10-17` while `dateModified` is computed
  from git; by spring they disagree.
- **SEO-10. `<link rel="canonical" href="SITE_URL/">`** — absolute, trailing slash, matching
  Cloudflare's `html_handling`.
- **SEO-11. Open Graph** — `og:type` `website`, `og:site_name` `Pariksha`, `og:title`,
  `og:description`, `og:url` equal to the canonical, `og:image` absolute, `og:image:width` `1200`,
  `og:image:height` `630`, `og:image:alt`, `og:locale` `en_GB`.
- **SEO-12. Twitter card** — `summary_large_image`, title, description, absolute image, image alt.
  No `twitter:site`: the project has no account, and a dangling handle is worse than none.
- **SEO-13. `apps/web/public/og.png`, 1200 × 630**, built from the DESIGN.md tokens, with the
  wordmark and one line inside the centre 600 × 315 so X, Slack and Discord crops all survive. A
  committed PNG. No runtime image service, no third-party generator.
- **SEO-14. Icons** — `public/favicon.svg` plus a `favicon.ico` fallback and
  `apple-touch-icon.png` at 180 × 180. `DESIGN.md` records that no mark exists; the favicon is the
  wordmark's first letter in cream on voltage, and that is enough.
- **SEO-15. `<meta name="theme-color">` twice**, with `media="(prefers-color-scheme: light)"` and
  `dark`. **Injected into `dist/index.html` by the prerender from `tokens.ts`** — the source
  `index.html` stays hex-free so the colour guard keeps working, and the shipped value cannot drift
  from `DESIGN.md`. This resolves `constraints.md` §4.4's first collision; the alternative, adding
  `index.html` to the hex guard's exclusions, removes a guard the page needs.
- **SEO-16. `<html lang="en-GB">`.** British spelling is a project rule; the attribute should say
  so. This changes `landing.test.tsx`'s existing `lang="en"` assertion for `index.html` only —
  `admin.html` keeps `en` or moves with it, implementer's choice, but the test must match.
- **SEO-17. No `<meta name="keywords">`.** Ignored by every engine for over a decade.
- **SEO-18. HTML caching.** `/index.html` gets `Cache-Control: public, max-age=0, must-revalidate`
  in `public/_headers`, so a redeploy is visible. Hashed assets keep their immutable year. Drop
  `immutable` from the `/fonts/*` block — those filenames are not content-hashed (issue 137).

### Structured data

- **SEO-19. One `<script type="application/ld+json">` block, emitted by the prerender into
  `dist/index.html`.** One `@graph` with five cross-linked nodes, not five blocks.

  `constraints.md` §4.4 flagged this against `script-src 'self'`. **Decision: ship the inline
  JSON-LD, change nothing about the CSP, and do not compute a hash.** An `application/ld+json`
  element is a data block; the HTML spec stops processing it before the script is ever executed,
  so there is nothing for `script-src` to block, and every consumer reads it out of the source or
  the DOM rather than running it. The worst case is console noise, and the fix for console noise is
  a hash in `dist/_headers` — a base64 hash contains no `'unsafe-inline'` and no `https://`, so it
  would pass `hosting.test.ts`. Add it if the manual check in [§8](#8-the-test-plan) finds a
  violation report; do not add it first. Microdata was the other option and is rejected in
  [§11](#11-what-was-rejected-and-why).

  `SITE_URL`, `DESCRIPTION`, `STATUS_LINE` and `DATE_MODIFIED` are substituted by the script.
  `DESCRIPTION` and `STATUS_LINE` are the same two constants SEO-9b derives the meta description
  and `llms.txt` from, so the machine-readable record of what Pariksha *is* cannot drift from the
  prose record of it. `DATE_MODIFIED` comes from `git log -1 --format=%cs -- src index.html`,
  **wrapped in a try/catch that falls back to the build date**: `execFileSync("git", …)` throws
  where `.git` is absent — a source tarball, some build containers — and `dateModified` is a hint,
  not a fact worth failing a deploy over.

  Four changes from the first draft of this graph, each small and each load-bearing:

  - **`offers` is deleted.** `"offers": { "price": "0", … }` is a machine-readable statement that
    the software is available for acquisition, addressed at [R3](#r3--the-machine-reader), the
    audience this whole section exists for. It was there because Google's Software app rich result
    wants a rating *or* an offer — which is the same reasoning SEO-20 correctly rejects for
    `aggregateRating`. `license` already carries Apache-2.0 and `releaseNotes` already says the
    application lands with v0.1. T13 is widened to guard `offers` and `price` alongside
    `aggregateRating`, so it cannot return.
  - **`operatingSystem` is deleted.** It asserted three runtime platforms — "Web browser; Docker on
    Linux; Cloudflare Workers" — that run nothing today, and `softwareVersion: "pre-alpha"` does
    not qualify a sibling property for a machine reader. `SoftwareSourceCode.runtimePlatform` is
    the honest home for that list and keeps it.
  - **`description` is added to `SoftwareApplication` and `WebPage`, and `datePublished` beside
    `dateModified`.** The graph previously carried `releaseNotes` but no definitional sentence, so
    the machine-readable record of what Pariksha is existed only as prose.
  - **`alternateName` moves onto `Organization` and `SoftwareApplication` too**, not only
    `WebSite`. Entity reconciliation is done per node.
  - **`Organization.logo` points at a square `icon-512.png`**, not at `og.png`. Google's
    Organization logo guidance expects a logo; `og.png` is a 1200 × 630 social banner. Ship the
    favicon letterform at 512 × 512 (SEO-14 already draws it) and keep `og.png` for `og:image`.
    `T10` reads its IHDR the same way it reads `og.png`'s.

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "SITE_URL/#website",
      "name": "Pariksha",
      "alternateName": ["పరీక్ష", "परीक्षा"],
      "url": "SITE_URL/",
      "inLanguage": "en-GB",
      "publisher": { "@id": "SITE_URL/#organization" }
    },
    {
      "@type": "Organization",
      "@id": "SITE_URL/#organization",
      "name": "Pariksha",
      "alternateName": ["పరీక్ష", "परीक्षा"],
      "url": "SITE_URL/",
      "logo": "SITE_URL/icon-512.png",
      "sameAs": ["https://github.com/SriSatyaLokesh/pariksha"]
    },
    {
      "@type": "SoftwareApplication",
      "@id": "SITE_URL/#software",
      "name": "Pariksha",
      "alternateName": ["పరీక్ష", "परीक्षा"],
      "description": "DESCRIPTION",
      "applicationCategory": "BusinessApplication",
      "applicationSubCategory": "Online examination and assessment software",
      "softwareVersion": "pre-alpha",
      "releaseNotes": "STATUS_LINE",
      "license": "https://www.apache.org/licenses/LICENSE-2.0",
      "url": "SITE_URL/",
      "sameAs": "https://github.com/SriSatyaLokesh/pariksha",
      "publisher": { "@id": "SITE_URL/#organization" },
      "isBasedOn": { "@id": "SITE_URL/#sourcecode" }
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": "SITE_URL/#sourcecode",
      "name": "Pariksha",
      "codeRepository": "https://github.com/SriSatyaLokesh/pariksha",
      "programmingLanguage": ["TypeScript", "React"],
      "license": "https://www.apache.org/licenses/LICENSE-2.0",
      "runtimePlatform": ["Cloudflare Workers", "Node.js", "Docker"]
    },
    {
      "@type": "WebPage",
      "@id": "SITE_URL/#webpage",
      "url": "SITE_URL/",
      "name": "Pariksha — run real exams on infrastructure you own",
      "description": "DESCRIPTION",
      "isPartOf": { "@id": "SITE_URL/#website" },
      "about": { "@id": "SITE_URL/#software" },
      "inLanguage": "en-GB",
      "datePublished": "2026-10-17",
      "dateModified": "DATE_MODIFIED"
    }
  ]
}
```

- **SEO-20. No `aggregateRating`, no `review`, no `ratingValue`, no `offers`, ever.** Google's
  Software app rich result wants a rating or an offer, and this page ships neither: Pariksha has no
  users, and an `Offer` is a machine-readable claim that the software is available for acquisition,
  which it is not. **The page forgoes the rich result rather than earn it with a claim it cannot
  make** — the same reasoning that rules out `aggregateRating`, applied consistently. Fabricated
  review markup is additionally a structured-data policy violation with a manual-action path, and
  it would contradict the page it sits on. T13 guards all five keys permanently.
- **SEO-21. No `HowTo`, no `BreadcrumbList`, no `SearchAction`, no `FAQPage`.** All four are
  retired, removed or valueless as of 2026 (`seo-mechanics.md` §2.1, §5.2–5.4). The prose each
  would have wrapped is on the page; the markup is not.

### Agent-facing files

- **SEO-22. `robots.txt`, emitted by the prerender** (it needs `SITE_URL`), not committed to
  `public/`. Allow everything; name the eight tokens explicitly so the decision is documented and
  the test is assertable. Named groups replace the `*` group, so `admin.html` is kept out of the
  index by the `X-Robots-Tag` header of SEO-5 rather than by repeating `Disallow:` in each block.

```
User-agent: *
Allow: /
Disallow: /admin.html

# Answer and generative engines — explicitly welcome.
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: GPTBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /

Sitemap: SITE_URL/sitemap.xml
```

- **SEO-23. `llms.txt`, emitted by the prerender.** Twelve lines, pointing at the formats, the
  schemas and the worked example — the material an agent can act on. Content is
  `seo-mechanics.md` §3.4, with one change: **the canonical page is the first entry**, as
  `- [Pariksha](SITE_URL/): what it is, how running an exam works, what it costs`, before the
  GitHub material. Every link in the research draft was a `github.com` URL, which routes an agent
  that reads the file entirely off-site and has it cite GitHub rather than the page. Honest framing for the record: no major provider has confirmed
  that their production answering systems read third-party `llms.txt`, and measurement is bleak;
  it is shipped because a developer-tool audience is exactly the population that points an agent at
  a repository, it costs twelve lines, and it is the one case where the convention has demonstrated
  use. **`llms-full.txt` is not shipped** — its content is already public as raw Markdown on
  GitHub, which is the most LLM-legible format there is, and a concatenated copy is duplicate
  content with a maintenance cost.
- **SEO-24. `sitemap.xml`, emitted by the prerender.** One `<loc>` equal to `SITE_URL/`, one
  `<lastmod>` from the same git date as the JSON-LD. No `<priority>`, no `<changefreq>` — Google
  ignores both.
- **SEO-25. Search Console verification by DNS TXT record or a static file in `public/`.** Never
  the `<script>` method; `public/_headers` pins `default-src 'self'` and a test forbids weakening
  it. Record the chosen method in `deploy/cloudflare/README.md`.

### Prose shape — a constraint on every line, not a step

- **SEO-26. Question-shaped `h2`s.** Every section heading in [§3](#3-the-page-section-by-section)
  is already either a literal question or on the allow-list (`Questions and answers`,
  `Read one real test, end to end.`, `Footer`). These are the strings people type.
- **SEO-27. Answer-first paragraphs, 40–60 words, as a stated element of every section.** The
  40–60 words immediately under each `h2` answer the heading completely before any build-up. That
  paragraph is the extraction unit, and it is **not only a test**: [§3](#3-the-page-section-by-section)
  now specifies it as the first child under the `h2` in S3, S5, S6, S8, S9 and S10, with each
  band's quote, lead line or list following it rather than replacing it. The earlier draft
  specified a test (T23) that four sections as designed could not satisfy — S3's heading is the
  literal query "How does running an exam on Pariksha actually work?" and was followed directly by
  step markup, so an engine asking that question found a heading and no answer. An implementer
  building to §3 failed T23; one building to T23 contradicted §3. **The number is 40–60 in both
  SEO-27 and T23**, matching `seo-mechanics.md` §3.5b; the earlier 30–70 was a second number for
  one rule.
- **SEO-27b. Every answer-first paragraph's first sentence contains the word `Pariksha`.** This is
  SEO-28 made mechanical across the whole page rather than only the FAQ, and it is the cheapest
  guard in the plan (T23).
- **SEO-28. Self-contained claims.** Every extractable sentence names its subject. "Pariksha
  supports 12 question types", never "It supports 12 types".
- **SEO-29. Explicit dates and numbers.** "As of October 2026, Pariksha is pre-alpha" beats
  "currently pre-alpha"; the first survives being quoted in April, the second becomes a lie.
- **SEO-30. Proper-noun density.** Name things: Cloudflare Workers, D1, R2, Docker, SQLite,
  Postgres, JSON Schema, Apache-2.0, Anthropic, OpenAI, Moodle. Cited passages run far higher in
  proper nouns than generic prose.
- **SEO-31. No keyword stuffing, no cloaking.** The prerender renders the same `Landing` component
  a browser would. No `display:none` SEO text, no crawler-only paragraph, no repeated "online exam
  software". Both are explicit spam policies enforced at domain level.
- **SEO-32. `pre-alpha` appears literally in the meta description, in
  `SoftwareApplication.releaseNotes`, and in `llms.txt`.** These are the strings that get lifted
  verbatim and repeated for months.

---

## 6. Component inventory

Nine components exist today under `apps/web/src/components/`. The rebuild reuses five unchanged,
extends four, adds four, and declines seven.

### Reused unchanged — 5

| Component | Used by | Why it holds |
| --- | --- | --- |
| `ButtonSecondary` | S7 deploy cards, S9 doc links | Already exactly what those need |
| `CardHairline` | S6, S7 ×3, S9 | The page's default container |
| `CardVoltage` | S7, once | Already correctly headline-only |
| `MonoCaption` | Chip, footnotes, table footnote, footer closing | The label tier, unchanged |
| `FeatureCell` | S5 ×6 | Its label / title / body shape is exactly S5's |

### Extended — 4

| Component | Change | Why |
| --- | --- | --- |
| `HeroSection` | Two-column layout, a status chip, a secondary link, a slot for a product mock, and a `display-lg` variant for S11 | S1 and S11; the same component doing more, not a different one |
| `TopNav` | `position: sticky`; `scroll-margin-top` on every section target; nav link block padding raised to `--space-md` so the rendered box reaches `DESIGN.md`'s stated 40px and a 44px hit area | A twelve-band page needs its nav. Without the scroll margin every anchor jump hides its own heading under the 64px bar — a real bug. The padding fixes two issue-137 findings in one edit |
| `SectionHeading` | Optional `eyebrow` prop rendering a `mono-sm` muted label above the `h2`, **and a required `scale` prop — `"chapter"` (`display-lg`, 44px) or `"band"` (`heading-md`, 22px, always with an eyebrow)** | Chapter sections need a label, and the page needs a heading hierarchy `DESIGN.md`'s `section-heading` component does not supply: it sets every `h2` at `display-xl`, which is the `h1`'s size. The mapping is [§3.0](#30-the-spine-and-why-the-comparison-sits-where-it-does)'s padding column. Two existing tokens, no new size, one required prop so the default cannot silently be 56px |
| `ButtonPrimary` | The `→` moves into `<span aria-hidden="true">`; optional `surface` variant inverting to `voltage-deep` fill with a cream label (5.66:1, the already-sanctioned hover state) for a CTA on a light band | Issue 137; and a cream pill on a cream band is invisible |

### New — 4

| Component | Instances | Why it earns existence |
| --- | --- | --- |
| `CodeBlock` | 6 | It carries the light/on-voltage contrast split from `ui-direction.md` §3. That rule must live in one place or it will be got wrong on the sixth use |
| `ComparisonTable` | 1 | Substantial markup plus a two-layout reflow. One instance, but the cell-label spans and the breakpoint rules are forty lines that would otherwise sit in the route, and the reflow is the thing most likely to be broken by a later edit |
| `StepRow` | 3 | Four-part rows — step label, title, body, artefact slot — repeated three times. Without it the route repeats a twenty-line block three times |
| `ProductMock` | 2 (M-1, M-2) | The `aria-hidden="true"` plane plus its adjacent `visually-hidden` description must not be re-derived per instance; a mock that loses its description is a screen-reader user hearing a fake question, four fake options and a fake timer. The mock markup itself stays at its call site. **M-3 and M-4 are not `ProductMock`s** — a results table and a file listing are real content, read aloud as written |

### Declined — 7

- **`RunnerMock` / `BuilderMock` as separate components.** Two one-instance components whose only
  content is literal markup. `ProductMock` carries the part that must not be re-derived; the markup
  stays where it is read.
- **`IntegrityBadge`** — three instances of a three-line span. Use the CSS class inline.
- **`Timeline`** for the roadmap — an ordered list with a `mono-sm` label per row, which is exactly
  what [S9](#s9--what-is-built-what-is-not)'s ledger is: twelve `<li>`s, a grid, an ordinal, a
  hairline rule and two text tones. The styling is the design; the component would be the overhead.
- **`Tabs` / `Accordion` / `<details>`** anywhere — hides content from crawlers and answer engines,
  needs client state, and the page has nothing that deserves to be hidden.
- **`CopyButton`** — needs a 44px target, a live region for "Copied", and client JavaScript on a
  page that otherwise needs none. Add it when someone asks.
- **`Section` wrapper** — the existing `.section .wrap` class pair already does it.
- **`PullQuote`** — a `<p>` with a class.

---

## 7. Accessibility and performance acceptance

Each line is true or false on the finished page. A failing line is a bug, not a preference. The
rule source is named so a reviewer can check the standard rather than the opinion: `C` =
`constraints.md`, `U` = `ui-direction.md`, `X` = the ui-ux-pro-max rule pass.

### Accessibility

| # | Acceptance | Source |
| --- | --- | --- |
| A1 | Every selector in `landing.css` that declares `color:` appears in `contrast-usage.test.ts`'s `SURFACE` map or in the documented wrapper exclusions, and clears its real WCAG threshold: 4.5:1 under 24px, 3:1 at 24px or 18.66px bold | C §2.2, X `color-contrast` |
| A2 | `--color-voltage` colours no text below 24px anywhere. Links and small accents take `--color-voltage-deep` (5.66:1). Cream on voltage appears only at 24px and above | `DESIGN.md`, C §2.2 |
| A3 | The four syntax-colour roles are checked independently on **both** white and cream fills — the stated ratios are against white and cream is warmer. **This includes the hero's on-voltage code block**, which `ui-direction.md` §3.3 makes a *cream* plane: its `--color-voltage-deep` strings and `--color-data-blue` numbers need the cream check too. A3 is not a body-bands-only rule, and the hero's block must not ship unchecked | U §7 |
| A4 | Exactly one `h1`; `h1 → h2` per section `→ h3` inside cards and FAQ rows, no level skipped. Visually-hidden headings count | C §1 test 9, X `heading-hierarchy` |
| A5 | Every `<section>` is labelled by its heading via `aria-labelledby`; the nav has an accessible name; every `role="region"` has one; all content sits inside a landmark; exactly one `main` | C §2.5, X `aria-labels` |
| A6 | The skip link survives: `Skip to content` → `#main-content`, and `#main-content` exists | C §1 test 8, X `skip-links` |
| A7 | Every horizontally scrolling container — each code block, the comparison table, the runner mock — carries `tabIndex={0}`, `role="region"` and `aria-labelledby`. A scroll region reachable only by pointer is WCAG 2.1.1; a `role="region"` without a name is itself an axe finding, so the label is not optional | issue 137, X `keyboard-nav` |
| A8 | Every mock and decorative surface is `aria-hidden="true"` with a one-sentence `visually-hidden` description beside it. Every table has a `<caption>`. Every code block's caption bar is real text | U §3.3, X `alt-text` |
| A9 | Visible focus style on every interactive element, never `outline: none` without a replacement; tab order matches visual order | X `focus-states`, `keyboard-nav` |
| A10 | Nav links and `ButtonSecondary` reach a 44px hit area through block padding without changing the visual box | U §7, X `touch-target-size` |
| A11 | No information is carried by colour alone. The comparison table's argument is typographic; the integrity badges carry the word; the palette's locked state carries the word `locked` | `DESIGN.md`, X `color-not-only` |
| A12 | Zero axe violations on the rendered `Landing` under jsdom — with the limit recorded, not forgotten: jsdom has no layout engine and no canvas, so axe contributes **zero** contrast coverage and says nothing about 400px. A1 is the only contrast gate | C §2.5 |
| A13 | No emoji anywhere — prose, mocks, or quoted artefacts. The README's ASCII screen is not used, for this reason among others | project rule, X `no-emoji-icons` |
| A14 | The page renders correctly at 200% browser zoom and under `prefers-reduced-motion: reduce`. Because nothing animates, the reduced-motion page is **pixel-identical** to the default page — and that identity is the test that the motion budget is right | U §5.3, X `reduced-motion` |

### Performance

| # | Acceptance | Source |
| --- | --- | --- |
| P1 | `dist/index.html` contains no `<script type="module">` and no `<script src="/assets/`. The landing page ships **0 bytes of JavaScript** | SEO-2 |
| P2 | `dist/index.html` is under 100 KB uncompressed. If it is not, the page is long rather than dense — see anti-goal X7 — and content is deleted, not minified. **The deletion order is decided in advance**, in [S10](#s10--questions-and-answers): FAQ Q3, then Q15, then Q5, then Q9, then S5's sixth `FeatureCell`. With twelve bands, six code blocks, four rendered surfaces and thirteen FAQ pairs this will be close, and a budget with a named deletion order is a decision already taken rather than a panic at build time | X7 |
| P3 | Exactly one stylesheet request, hashed, from `/assets/`, referenced by `<link rel="stylesheet">` in the HTML entry | SEO-3, X `critical-css` |
| P4 | All four font faces self-hosted WOFF2 under `/fonts/`, `font-display: swap`, no CDN. No `url()` in `fonts.css` starts `http` | C §2.7, X `font-loading` |
| P5 | No `<img>` in the page body at all; the only raster asset is `og.png`, which the page never loads. Cumulative layout shift from images is therefore structurally zero rather than merely small | X `image-dimension`, `content-jumping` |
| P6 | The page body has **no horizontal scrollbar at 320px, 400px or 768px**. The three wide objects each scroll or reflow inside their own container | U §3.5, X `horizontal-scroll` |
| P7 | No third-party origin is fetched by the built page. `public/_headers` keeps `default-src 'self'` on `/*` and contains no `'unsafe-inline'`, no `'unsafe-eval'` and no `https?://` substring | C §2.7, X `third-party-scripts` |
| P8 | The only CSS transitions are 120ms colour and border on interactive elements, declared inside `@media (prefers-reduced-motion: no-preference)` with `transition: none` as the base. Smooth scroll on in-page anchors sits in the same guard | U §5, X `duration-timing` |
| P9 | No transform, no keyframe, no scroll-triggered reveal, no counter, no parallax, no hover lift. The motion budget and the prerender constraint are the same constraint: content that appears only after a scroll event is content an answer engine may never see | U §5.2 |
| P10 | **The hero mock's bleed creates no body-level horizontal scrollbar at any width.** It is implemented as a negative margin on the grid item, guarded by `min()`, inside the hero section's `overflow: hidden` clip — no negative margin outside an overflow-clipped section. P6 is the acceptance; this line names the only construction that satisfies it | S1, U §3.3 |

### The invariants this page must not break

Restated from `constraints.md` §2 because they are the difference between a passing build and a
red one: no colour literal in authored source (`rgb(from var(--color-NAME) r g b / α)` is the one
legal colour function); no inline `style={}` and no CSS-in-JS, including for custom properties;
no colour rule wrapped in `@supports`, `@layer` or `@container`, which would silently bypass the
contrast guard; the first `.hero-section { … }` rule stays flat and keeps the literal declaration
`background: var(--color-voltage)`; the token files are never hand-edited; no admin-shaped module
is reachable from the landing tree; and nothing on the page asserts the application ships today.

---

## 8. The test plan

**This is a TDD build. Tests first.** Write the failing assertion for a section before writing the
section. The order below is also the build order, and it is chosen so that the single most
important test — a non-JS fetch of `/` returns the page text — is green before any copy is written.

### Wave 1 — the prerender, before anything else

| # | File | Assertion |
| --- | --- | --- |
| T1 | **new** `apps/web/test/prerender.test.ts` | Runs `vite build` plus `scripts/prerender.mjs` into a temp outDir; `dist/index.html` contains the `h1` text, the word `Pariksha`, and at least one `<section`. The most important test in the suite |
| T2 | T1 | `dist/index.html` contains no `<script type="module"` and no `<script src="/assets/` |
| T3 | T1 | `dist/index.html` contains a `<link rel="stylesheet" href="/assets/` whose target exists in `dist/` and is non-empty |
| T4 | **rewrite** `apps/web/test/bundle.test.ts` | Builds with `{ ssr: "src/entry-prerender.tsx", write: false }` and asserts no module id matches `/src[\\/](routes[\\/])?admin/i`. A second block builds the normal two-HTML config and asserts the `admin` entry chunk still exists. Re-pointing this test at the prerender graph is a **stronger** guard than the one it replaces: admin code leaking into the prerender graph puts admin markup on the public page |
| T5 | T1 | `dist/404.html` exists and contains `noindex` |

### Wave 2 — head, origin and hosting

| # | File | Assertion |
| --- | --- | --- |
| T6 | T1 | Exactly one `<title>`, 15–60 characters, containing `Pariksha`; exactly one description meta, 110–160 characters, containing both `pre-alpha` and `October 2026`; **two `theme-color` metas present with their `media` attributes**, which SEO-15 injects from `tokens.ts` and which no test previously asserted arrived — every other injected head value has one |
| T7 | T1 | Exactly one canonical, absolute `https://`, equal to `SITE_URL + "/"`; all nine `og:*` tags present; `og:url` equals the canonical; `twitter:card === "summary_large_image"` and `twitter:image` absolute |
| T8 | T1 | `dist/index.html` matches `<html lang="en-GB"` |
| T9 | T1 | No `https://` origin anywhere in `dist/` that is neither `SITE_URL` nor `github.com` nor a schema.org/SVG namespace |
| T10 | T1 | `dist/og.png`'s IHDR chunk reads width 1200, height 630 — six lines of byte reading, no image library. Every icon `href` resolves to a file in `dist/` |
| T11 | **update** `apps/web/test/hosting.test.ts` | `_headers` has an `/index.html` block with `max-age=0`; an `/admin.html` block with `X-Robots-Tag: noindex`; the `/fonts/*` block no longer says `immutable`. `admin.html` contains `name="robots"` with `noindex`. `wrangler.jsonc` has `not_found_handling === "404-page"` and, if `routes` is present, `workers_dev === false` and `preview_urls === false`. The existing CSP assertions stay exactly as they are |

### Wave 3 — structured data and agent files

| # | File | Assertion |
| --- | --- | --- |
| T12 | T1 | Exactly one `application/ld+json` block; it `JSON.parse`s; `@context` is `https://schema.org`; the graph holds all five `@type`s; `dateModified` parses as a date that is not in the future |
| T13 | T1 | **No node anywhere in the graph has an `aggregateRating`, `ratingValue`, `review`, `offers` or `price` key.** A permanent guard against fake social proof, and against the availability claim `offers` makes on behalf of an application that is not built |
| T14 | T1 | `dist/robots.txt` names all eight agent tokens in `User-agent:` lines; contains no bare `Disallow: /` on its own line; the `Sitemap:` line is an absolute `https://` URL ending `/sitemap.xml` |
| T15 | T1 | `dist/llms.txt` starts `# Pariksha`, contains `pre-alpha`, holds at least five Markdown links, and no link is a relative path |
| T16 | T1 | `dist/sitemap.xml` parses as XML, has exactly one `<loc>` equal to `SITE_URL + "/"`, and a `<lastmod>` matching `^\d{4}-\d{2}-\d{2}$` |
| T17 | T1 | The literal string `pre-alpha` appears in the meta description, in `SoftwareApplication.releaseNotes`, and in `dist/llms.txt` |
| T18 | manual, recorded in `seo-mechanics.md` | Serve `dist/` with the production `_headers` and confirm the browser console reports no `securitypolicyviolation` for the ld+json block. Record the result rather than writing a headless-browser test. If it fires, add a `'sha256-…'` to `script-src` and nothing else |

### Wave 4 — the page itself

| # | File | Assertion |
| --- | --- | --- |
| T19 | **update** `apps/web/test/landing.test.tsx` #1 | Exactly one `h1`, with text content exactly `Pariksha — run real exams you host yourself.`, **and at most 45 characters long**. The length assertion is the one that survives a copy edit: the string can legitimately change, the budget cannot. `getAllByText("Pariksha").length > 0` stays. The stale comment above it, which records the superseded controller decision, is replaced with one naming this document |
| T20 | **replace** `landing.test.tsx` #2 | The old "exactly one CTA-shaped link" claim cannot survive a page with a hero CTA, two deploy CTAs and a closing CTA. Two narrower assertions, both still falsifiable: (a) the **first** link inside `.hero-section` has accessible name `Start with the worked example` — no arrow, it is `aria-hidden` — and href `https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude`; (b) **every** CTA-shaped link on the page points at a `github.com/SriSatyaLokesh/pariksha` URL, so nothing is fabricated and nothing points at a product that does not ship |
| T21 | `landing.test.tsx` #3–#11 | Unchanged and binding: the `.hero-section` class; the voltage token in `tokens.css`; the flat `.hero-section` rule carrying `background: var(--color-voltage)`; self-hosted fonts; the skip link; heading order; **zero `[style]` attributes**; zero axe violations |
| T22 | **new** `apps/web/test/landing-content.test.tsx` | One assertion per section S1–S12: the section exists with its stated `id`, and its `h2` text content is exactly the verbatim heading in [§3](#3-the-page-section-by-section). Twelve assertions, each of which fails loudly when a section is dropped or silently reworded |
| T23 | T22 | For every `h2` **not** in the allow-list `["Questions and answers", "Read one real test, end to end.", "Footer"]`: the heading ends in `?`; the first following `<p>` has a word count between **40 and 60**; and **that paragraph's first sentence contains the string `Pariksha`**. The three allow-listed headings are exempt from this rule entirely — a heading that does not ask a question gets no manufactured answer-shaped paragraph underneath it, which is what lets the footer's visually-hidden paragraph (which existed only to satisfy this test) be deleted. Blunt, and the one mechanical proxy for answer-first writing — it fails the moment someone adds a 200-word preamble, and the `Pariksha` clause enforces SEO-28 across the whole page for one line of test code. [§3](#3-the-page-section-by-section) now specifies the paragraph this asserts, so the test and the design agree |
| T23b | T22 | Every `h3` inside `#faq` is followed by a `<p>` whose **first sentence contains `Pariksha`**. S10 is the page's densest extraction band; a lifted answer with no subject can be attributed to anything |
| T24 | T22 | S4 renders a real `<table>` with a `<caption>` and `scope` on every header cell, with four columns and seven body rows, and a **non-empty corner header cell** |
| T24b | T22 | S4's two prose strings are present verbatim: the dated category-not-product footnote, and the credibility hinge beginning `A paid platform you can buy today`. Both are what keep the table from reading as the X4 brag, and both can be copy-edited away without anything else going red |
| T25 | T22 | Every code block renders inside a container with `role="region"`, a non-empty accessible name and `tabindex="0"`; every `ProductMock` renders `aria-hidden="true"` and a sibling `visually-hidden` paragraph of at least ten words |
| T26 | T22 | The strings `AI-powered`, `AI question generation` and `generate a test with AI` appear **nowhere** in the rendered text, and the BYOK block contains both `Phase 9` and `not built` |
| T26b | T22 | **Every occurrence of `500`, of `zero hosting cost` and of `12 question types` in the rendered text falls within 200 characters of one of `estimate`, `target`, `specified`, `v0.1`, `v0.3` or `pre-alpha`.** Blunt in the same way T23 is, and it catches the whole class of defect that produced three of this revision's blocking items: a number lifted out of its qualifier by a later edit. The one sanctioned exception is the meta description, which is not rendered text |
| T32 | T22 | **The byte index of S2's definitional sentence in `dist/index.html`, divided by the file length, is under 0.30.** [R3](#r3--the-machine-reader) makes the first-30%-of-document band a design driver and S1's mock is ~60 elements of markup sitting inside it; this is the one SEO claim the earlier draft asserted rather than verified |
| T27 | **rewrite** `apps/web/test/contrast-usage.test.ts` | The `SURFACE` map is rewritten wholesale, not patched — the stylesheet is being rewritten and every key must name the background its selector really renders on. Budget for this as a real task. Its three structural tests and its per-selector WCAG test are unchanged in shape |

### Wave 5 — the guards issue 137 asked for

| # | File | Assertion |
| --- | --- | --- |
| T28 | **update** `apps/web/test/no-hex-colors.test.ts` and `scripts/tokens.mjs` | Widen both colour regexes **together** to `rgb()/rgba()/hsl()/hsla()/oklch()/lab()` and the named-colour set, with the carve-out `constraints.md` §2.1 states: a colour function whose first argument is **not** `from var(--color-…)` is a failure. The existing `rgba(35, 31, 29, 0.08)` in `landing.css:141` must be fixed to that legal form **before** the guard is widened, or landing fails its own gate |
| T29 | `bundle.test.ts` | Widen the admin path regex to `/src[\\/](routes[\\/])?admin/i` so `src/admin-main.tsx` and any `src/components/AdminNav.tsx` are caught |
| T30 | **new** `apps/web/test/component-dimensions.test.ts` | Compare `.button-primary` height, `.button-secondary` padding and height, and `.top-nav` padding and height against `tokens.components`, which is already exported and already resolved. This is what catches the `.top-nav__inner` drift to `padding-block: var(--space-sm)` against `DESIGN.md`'s stated `12px 32px` |
| T31 | `eslint.config.js` | Widen type-aware linting to `files: ["**/src/**/*.{ts,tsx}"]`. **Do this first, before writing any new component**, so the new code is written under the rules it will be judged by — `no-explicit-any`, the five `no-unsafe-*` rules, `restrict-template-expressions` and `no-floating-promises` all begin applying to `apps/web/src` |

### Not covered by any test, and said out loud

- **Pre-alpha honesty** is a review gate, not an assertion. T26 catches the AI phrases; nothing
  catches a sentence that quietly implies the application runs. The reviewer who filed issue 137
  checks it.
- **A real-browser axe run and the 400px render** need Playwright — issue 33. T21's jsdom axe pass
  is not a substitute and this document does not pretend it is.
- **Live deployment and the headers as actually served** — issue 135.

### The commands CI runs, unchanged

```
pnpm lint && pnpm typecheck && pnpm build && pnpm test
```

`pnpm build` regenerates the token files first, so run it locally and check `git status`; a dirty
`tokens.css` means a hand-edit that test 33 would have caught. `pnpm install --frozen-lockfile`
fails on a stale lockfile, which is one more reason this rebuild adds **no dependency**:
`react-dom/server` already ships with `react-dom`.

---

## 9. Left to the implementer

Decided here, so nobody asks: everything in [§3](#3-the-page-section-by-section) through
[§8](#8-the-test-plan). Left open on purpose, because a competent implementer will do it better at
the keyboard than this document can at a distance:

1. **Every sentence not quoted verbatim.** This document gives each section's argument, its
   heading and the claims it may make with their sources. The copy is written against
   `content-inventory.md`, which is the rule: *if a claim is not in that file with a file path
   beside it, it does not go on the page.* **And, added by this revision: no number about a
   competitor category appears on the page at all without a `content-inventory.md` §8 row carrying
   an external source.** Every blocking item in the three reviews was a one-line copy fix rather
   than a rewrite precisely because this sourcing spine was already built; each failure was a
   sentence that had escaped it. The spine does not get weakened — "lifted verbatim" never softens
   into "representative sample".
2. **Class names and the CSS.** Follow the existing BEM-ish convention (`.step-row__label`). The
   tokens are fixed; the selectors are not.
3. **Grid implementation.** Two-column hero, the feature grid, the S6 split, the S7 card pair —
   flex or grid, the implementer's call, subject to P6.
4. **The OG image composition**, within SEO-13's constraints.
5. **Where `scroll-margin-top` is set** — on the section elements or on `:target` — provided
   anchors do not hide their heading under the 64px sticky nav.
6. **The `404.html` message.** One sentence and a link home.
7. **Whether `admin.html` moves to `lang="en-GB"`** alongside `index.html`. Either is fine; the
   test must match whichever is chosen.

---

## 10. Open questions for the owner

Two. Both genuinely change what gets built; everything else in the brief is decided above.

**OQ-1 — What is the canonical origin?** `deploy/cloudflare/README.md` says the app goes live at
`https://pariksha-web.<your-subdomain>.workers.dev`, and `apps/web/wrangler.jsonc` declares no
`routes`. The canonical link, `og:url`, every JSON-LD `@id`, `sitemap.xml`, `robots.txt`'s
`Sitemap:` line and `llms.txt` all need one absolute origin, and an answer engine that indexes the
wrong one has to be told twice. **The build does not proceed without it**: SEO-6 makes
`scripts/prerender.mjs` throw when `SITE_URL` is unset or is not an absolute `https` origin, with
a message naming this question. A placeholder fallback would let the whole suite pass against a
constant that serves nothing, which is the one failure here that is expensive to unwind once an
engine has cached it. If the answer is a custom domain then SEO-7 applies in the same change.

**OQ-2 — How should Search Console ownership be verified: a DNS TXT record, or a static file in
`public/`?** Both are free and neither breaks the no-third-party-scripts rule; the `<script>`
method is out. DNS is the cleaner one and needs the owner's registrar access. This is the only way
to find out whether any of [§5](#5-seo-aeo-geo-aio-as-a-numbered-list) worked, so it is worth
answering before the deploy rather than after.

Two questions the research raised and this document closes rather than forwards: the lock glyph in
the README's ASCII mock is moot, because the ASCII mock does not appear on the page
([§4](#4-every-code-block-and-example)); and the JSON-LD-versus-CSP collision is resolved at SEO-19
with the upgrade path named.

---

## 11. What was rejected and why

**`FAQPage` JSON-LD.** Google dropped the rich result on 7 May 2026; the Rich Results Test drops it
in June and the Search Console API in August. The markup is not deprecated at schema.org and would
earn no penalty — it simply renders nothing, in exchange for ten lines that must be kept
byte-identical to the visible prose forever, since JSON-LD that does not match visible content is
cloaking. Ship the prose, skip the markup, add it when something measurable asks.

**Microdata or RDFa instead of inline JSON-LD.** It was the smaller diff and it needed no CSP
thought at all. Rejected because it spreads the structured data across the markup, where every
future copy edit can silently break it, and because JSON-LD is what answer engines read most
reliably. The collision it was meant to avoid turns out not to exist (SEO-19).

**`react-dom/static`'s `prerender` / `prerenderToNodeStream`.** They exist to wait on Suspense data
before resolving. This page fetches nothing, and the stream plumbing buys nothing.

**Hydration.** `renderToStaticMarkup` output is deliberately not hydratable, and that is the point:
with no client entry on `/`, an entire class of hydration-mismatch bug does not exist. The cost is
real and accepted — any future interactive element needs a plan, and the native-first answers are
`<details>` for disclosure, `:target` or a hidden radio group for tabs, and CSS `scroll-snap` for
carousels. Only `navigator.clipboard.writeText` genuinely needs JavaScript, and that is fifteen
lines of vanilla in its own entry, not React.

**A copy-to-clipboard button on the code blocks.** Needs a 44px target, a live region announcing
"Copied", and the only client JavaScript on the page. Deferred until someone asks.

**Scroll-triggered reveals, counters, parallax, hover lift, a shrinking sticky nav.** Two reasons,
and the second is the stronger. `DESIGN.md` already bans transforms on hover and every form of
motion inside an attempt — a marketing page that fades and counts up while claiming the product
animates nothing is arguing against itself. And every one of those effects requires client state on
a page whose entire crawler strategy is static HTML. The motion budget and the prerender constraint
are the same constraint, which is why neither is a compromise. Design ambition here is carried by
56px display type on a full-bleed saturated field, an asymmetric hero, two rendered product
surfaces, a type-driven comparison table and a disciplined spacing escalation. None of that needs
a keyframe.

**Naming competitors in the comparison table — still rejected, and only there.** The row content
is identical either way, and naming them in the table invites a maintenance obligation (their
pricing changes), a legal surface, and the `/vs/<product>` page-farm temptation that Google has
enforced against hardest since 2024. One honest table against three categories, dated, with the
"they can do more than we can today" admission underneath.

**This revision narrows that rejection to the table, which is all it was ever load-bearing for.**
`seo-mechanics.md` §5.7 forbids scaled `/vs/<product>` pages; it does not forbid naming a product
once in a sentence, and the page had already named Google Forms and Moodle. Mettl, HackerEarth,
Testlify and Testportal are now named exactly once, inside S10's restored Q11 — one dated, sourced,
40–60 word answer under an `h3` that is the literal query — because that is the query class a
self-hosted competitor exists to capture, and an answer engine cannot answer it without a product
name. The table does not change and `/vs/` pages are still out.

**A `Tabs` component for the code blocks.** It would have let S3 carry six samples in the space of
two. It also hides four of them from every crawler and needs client state. The page shows three,
each at full height, and links the rest.

**A standalone 56px "Pariksha" wordmark above the headline.** Argued at
[S1](#s1--hero): illegal under 24px in cream on voltage, competes with the `h1` at 56px, and makes
the page introduce itself three times. The name goes in the `h1`, where it is also the single most
useful string on the page for an answer engine.

**`llms-full.txt`.** Duplicate content with a maintenance cost; the same material is already public
on GitHub as raw Markdown. Add it when the docs move off GitHub or a docs site exists at `/docs/`.

---

## 12. Where the reviews conflict, and the call

Three reviewers read this document and pulled in three directions. Taste wanted ambition — more
scale, more objects, a bleed. Discoverability wanted quotable plainness — a named vendor, a subject
in every sentence, a dated string. Accuracy wanted hedging — a qualifier on every number and a
release name on every capability. Those are not the same page, and the places they collided are
decided here, each in one sentence, with the reason.

| # | The collision | The call | Why |
| --- | --- | --- | --- |
| 1 | Taste asked for `display-xl` to belong to the `h1` alone, and in the same review asked for S7's `$0` at `display-xl` | **`$0` sets at `display-lg` (44px)** | The point of the first request is that the page has exactly one object at its largest size; granting the second would defeat the first while quoting it, and a 44px numeral is still the only big number on the page |
| 2 | Taste wanted S7's voltage card to carry one quotable number; accuracy wanted the same card to stop asserting an unproven capacity | **Both, composed: `$0` as the numeral, "by arithmetic, not by measurement" as the sentence, and the `AC-29` caveat binding in the card beside it** | A number with its qualifier in the same breath is more quotable than a number alone, not less — a reader repeats the whole line |
| 3 | Discoverability wanted Mettl, HackerEarth, Testlify and Testportal named; [§11](#11-what-was-rejected-and-why) rejected naming competitors | **Named once, in S10's Q11 only; the table stays category-only** | The rejection was load-bearing for the *table*, where names create a maintenance and legal surface; one dated sourced sentence creates neither, and the page had already named Google Forms and Moodle |
| 4 | Discoverability wanted the FAQ's bare-negation openings rewritten to name their subject; the same review named S8's unhedged definitive prose as the best thing in the document | **Add the subject, never hedge the verb** — binding on both bands | The two requests only conflict if "self-contained" is confused with "qualified"; "Pariksha does not record video or audio of candidates" is both more extractable and more definitive than "No." |
| 5 | Accuracy wanted the comparison table's cells re-worded; the sourcing rule said the rows are README's "unchanged, because it is already the sourced form" | **Re-word three cells on the page, and bring `README.md` into line in the same pull request** | Being the sourced form is only a defence while the source is right; two wordings of one claim in one repository is the hazard, so the fix propagates rather than forks |
| 6 | Taste wanted the roadmap drawn as a ledger; [§6](#6-component-inventory) declines a `Timeline` component | **Ledger, no component** | The decline already prescribed "an ordered list with a `mono-sm` label per row"; the ledger is that list with a grid and two text tones, which is styling, not a component |
| 7 | Taste wanted the `h1` cut so `Pariksha` owns line one; the `h1` is the page's highest-value extraction string | **Cut to ≤45 characters with `text-wrap: balance`; no hard `<br>`** | The four-line wall was the real defect and the length budget fixes it; a `<br>` inside that string risks an engine lifting `Pariksha —run real exams`, which costs more than the line break buys |
| 8 | Accuracy wanted "Pariksha does nothing today" corrected; the same sentence is the page's credibility hinge | **Keep the hinge, correct the clause** | The page disproves "nothing" twice — CB-4 runs today and `packages/core` is tested — and a reader who believes the overstatement has no reason to run the command |

## 13. Rejected review findings

Every blocking item from the three reviews is fixed above. Six sub-requirements inside those items
are **not** taken, and they are listed here rather than dropped quietly.

- **A hard line break in the `h1` so that `Pariksha` sits alone on line one.** Rejected; the
  length budget and `text-wrap: balance` are taken instead. Collision 7 above.
- **`display-xl` for S7's `$0`.** Rejected in favour of `display-lg`. Collision 1 above.
- **Microsoft Forms added to S10 Q10's heading.** Rejected; the proper noun goes in Q10's body,
  which is being rewritten anyway. SEO-26 says a heading is the string people type, and nobody
  types two form products at once. The string still lands in `dist/index.html`, which is what the
  finding was actually for.
- **Changing S11's CTA destination so the hero and the closing band ask for different things.**
  This was offered as the cheaper alternative if the file-listing picture were refused. The
  picture is taken, and with it the closing band's CTA pointing at the folder the listing shows is
  the correct destination, not a repetition.
- **"12, including matching, ordering, numeric with tolerance and rubrics" as the comparison
  table's Pariksha cell.** Taken with one word removed: **there is no `rubrics` question type.**
  The twelve are single choice, multiple choice, select exactly K, true/false, assertion–reason,
  matching, multi-matching, ordering, fill in the blank, numeric with tolerance, short answer and
  long answer (`docs/question-format.md:35-50`). The cell names three real ones.
- **Four further query gaps named in one review** — "is Pariksha free", "online exam software for
  colleges", "placement test software", "Safe Exam Browser alternative". Not taken, and recorded
  as a known gap rather than fixed. The first three would each need a heading, and a band or
  heading without a job is deleted rather than added ([X7](#anti-goals)); S7's heading already asks
  the better question, which is what it costs to run. The fourth is moot and must stay moot: the
  Safe Exam Browser claim is deleted from the page as indefensible ([S4](#s4--why-not-a-form-tool-why-not-a-paid-platform)),
  and it would be perverse to re-introduce the product name in order to rank for it.

## 14. Review

Three adversarial reviews, 2026-10-17, against revision 1 of this document. All three returned
**revise**. Eighteen blocking items; all eighteen are fixed above and none is rejected outright.

### What each review was for, and what it caught

| Review | Angle | Blocking items | The one thing it got most right |
| --- | --- | --- | --- |
| A | Taste and visual hierarchy | 6 | That `DESIGN.md:148-150` sets `section-heading` to `display-xl` — so the page as specified had eleven objects at 56px, no heading hierarchy, and a sentence about the hero keeping the largest type that was false the moment S2 rendered |
| B | SEO, AEO, GEO, AIO | 6 | That dropping FAQ Q11 kept `Mettl`, `HackerEarth`, `Testlify` and `Testportal` out of `dist/index.html` entirely, losing the exact query class a self-hosted competitor exists to capture |
| C | Factual accuracy against the repository | 6 | That the page's loudest cost claim carried a second unproven number — 500 — which `content-inventory.md` §8 explicitly bans printing as proven, and that v0.1 ships six question types, not twelve |

### What the reviews named as the best thing, and which is preserved unchanged

- **S4's typographic comparison table** (review A). The Pariksha column's facts in `body-sm` ink on
  a continuous cream fill at 15.85:1 against `mono-sm` muted at 5.18:1 — the argument made in
  weight, face and measure rather than in ticks, crosses, badges or a voltage column. **Not one
  tick, glyph, badge or fill has been added.** Three cell *wordings* changed for accuracy; the
  chromatic restraint, the category-only columns, the dated footnote and the admission underneath
  are untouched, and T24b now asserts the two prose strings so a copy edit cannot sand them off.
- **S8, "Who it is not for"** (review B). Eight sourced, definitive, unhedged sentences. Not
  shortened, not carded, not softened; it gains a 680px measure, which makes it more of a rest
  point rather than less. The FAQ rewrite carries an explicit instruction not to sand the same
  quality off the answers it touches.
- **The sourcing spine** (review C): §9.1's *if a claim is not in `content-inventory.md` with a
  file path beside it, it does not go on the page*, and §4's every-block-lifted-verbatim rule.
  Strengthened rather than weakened — §9.1 gains the competitor-number clause, CB-4's verbatim
  claim is narrowed to the first of the README's two commands, and "lifted verbatim" is explicitly
  barred from softening into "representative sample". Review C verified CB-1 against
  `questions.json:85-100` and CB-2 against `test.json:163-174` independently; both hold.

### What changed, by section

| Where | Change |
| --- | --- |
| §3.0 | Heading-scale and measure columns added to the spine table; the heading tier decided (`display-xl` for the `h1` alone, `display-lg` for 96px chapters, `heading-md` + eyebrow for 64px bands); surface alternation demoted to bookkeeping and named as such; the hero mock's bleed recorded as the page's one width exception |
| S1 | `h1` cut from 69 to 44 characters with a ≤45 budget and `text-wrap: balance`; secondary CTA becomes a cream rectangle at `button-md` so it is no longer 50% larger than the primary; the mock bleeds to the viewport edge as the primary treatment, with `overflow: hidden` named and `P10` added; mock markup moved after the hero text in source order and its text capped (`Candidate · 21CS0147`, numeric palette); chip arithmetic corrected to twenty-two characters |
| S2 | The fact line becomes a numeral row at `display-lg`; `3 proctoring profiles` carries `SPECIFIED` (it is *Specified* in §8, not *Measured*); the line carries the date |
| S3 | A 40–60 word answer-first paragraph written into the document; the `StepRow` ordinal decided |
| S4 | Three table cells re-worded so each row survives a single-row lift, plus the corner header; the Safe Exam Browser claim and its false attribution deleted; the credibility hinge corrected and promoted to body text at full width, separated from the footnote |
| S5 | Lead line names v0.1's six types and v0.3's twelve; the `TWELVE TYPES` cell says the same; first cell spans two columns |
| S6 | Answer-first paragraph added before the pull quote |
| S7 | `$0` set as a `display-lg` numeral; "by arithmetic, not by measurement"; the `AC-29` caveat made binding; the adapter seams labelled as an architecture decision with Phase 2 not built |
| S8 | 680px measure; answer-first paragraph; an explicit do-not-touch note |
| S9 | Release-framed answer-first paragraph; the roadmap becomes a typographic ledger; "one of twelve complete" corrected to "one complete, a second part done" |
| S10 | Twelve questions become thirteen with Q11 restored; every answer's first sentence must name Pariksha; two-column grid at ≥900px; deletion order named |
| S11 | The closing band's picture becomes the worked example's file listing (M-4) instead of a second headline |
| §4 | CB-4's verbatim claim narrowed; M-1's content capped and its source order fixed; M-4 added |
| §5 | `SITE_URL` placeholder fallback deleted and replaced with a throwing guard; title aligned to the `h1`; meta description replaced with a dated, subject-named 152-character string; SEO-9b added so four long-lived strings come from one constant; `offers` and `operatingSystem` removed from the JSON-LD, `description`, `datePublished` and per-node `alternateName` added, `Organization.logo` pointed at a square raster; `DATE_MODIFIED` wrapped against a missing `.git`; `llms.txt` leads with the canonical page; SEO-27 settled at 40–60 and made a design element, SEO-27b added |
| §6 | `SectionHeading` gains a required `scale` prop; `ProductMock` scoped to M-1 and M-2; the `Timeline` decline annotated |
| §7 | A3 extended to the on-voltage code block's cream plane; P2's deletion order named; P10 added |
| §8 | T6 gains the dated description and `theme-color`; T13 guards `offers` and `price`; T19 asserts the 45-character budget; T23 settles at 40–60 and asserts the subject; T23b, T24b, T26b and T32 added |
| §9 | Two items closed (the ordinal, the FAQ drops); the sourcing rule extended to competitor numbers |
| §10 | OQ-1 restated: the build now fails rather than shipping a placeholder origin |
| §11 | The competitor-naming rejection narrowed to the table |

### Internal consistency, verified after the revision

- Every section the test plan names exists: T22 asserts S1–S12, all twelve are in §3, and §3.0's
  table lists the same twelve ids.
- Every code block has a source file and a caption bar: CB-1 to CB-6 in §4, each naming a path;
  M-1 to M-4 each name their content source.
- Every component in §6's inventory is used somewhere in §3, and every component §3 names is in the
  inventory. M-3 and M-4 are explicitly not components, which is why they do not appear in it.
- Every test from T1 to T32 names a file and an assertion, and every `§5` item has a test or is
  marked manual (T18) or a review gate.
- The reviews' three "best things" are each named in §14 and each unchanged in substance.

### Revision 3 — fix-first corrections (2026-10-17)

Two further adversarial reviews, 2026-10-17, against the built page and this document together,
returned fix-first. The findings below are contract or repository defects rather than page defects;
each is a surgical amendment, not a rewrite. Controller decisions D1–D5 referenced here are recorded
in the branch's task log and are settled, not reopened.

- **§3 S5's v0.1 sentence corrected (D1).** The lead-line quote and the `TWELVE TYPES` cell body
  said v0.1 ships six question types with the rest arriving at v0.3, derived from `README.md:156-159`
  rather than from `docs/ROADMAP.md`. `docs/ROADMAP.md` is authoritative on phasing and `:203`
  explicitly supersedes the older split: all 12 types, the test builder and the candidate runtime
  land with v0.1; proctoring and results follow in v0.2. This was the page's worst factual defect,
  and `README.md:156` is corrected in the same pull request so the two documents agree.
- **P10's wording corrected (D3).** It read "never as a negative margin on the page", which
  contradicts the kept implementation — a negative margin on the hero grid item, guarded by `min()`,
  inside the section's `overflow: hidden` clip. The implementation was always correct; only the
  sentence was imprecise. Reworded to "no negative margin outside an overflow-clipped section" in
  both the S1 narrative and the P10 acceptance row, so the rule now describes what is actually built.
- **T23 amended to exempt the three allow-listed headings (D4).** The 40–60-word paragraph assertion
  previously applied even to non-question headings once they cleared the allow-list's "ends in `?`"
  exemption, which is what forced a visually-hidden paragraph to be invented under the footer heading
  purely to satisfy the test — exactly the gaming SEO-31 forbids. The allow-listed headings are now
  exempt from the whole rule, and the footer's fake paragraph is deleted.
- **§3 S4's free-form-tools cell amended (D2).** "Multiple choice and free text" was an uncited
  capability claim about a competitor category with no `content-inventory.md` §8 row carrying an
  external source — the same defect as the `3–4` it already replaced, just in prose. The cell now
  makes no claim about the competitor category at all.
- **§3 S10's Q10/Q11 wording amended (D2).** "Microsoft Forms offers none of those either" and
  "twelve question types rather than a form's handful" are barred from the built page's FAQ body for
  the same reason — uncited competitor capability claims. The twelve-types claim becomes a standalone
  fact about Pariksha; any sentence naming a vendor now carries a dated qualifier.
- **§9.1's sourcing rule, checked against D2 — no change needed.** The rule already reads "no number
  about a competitor category appears on the page at all without a `content-inventory.md` §8 row
  carrying an external source" (added in revision 2, above). This revision's findings are violations
  of that existing rule, not gaps in the rule's wording, so §9.1 itself is left as written.
