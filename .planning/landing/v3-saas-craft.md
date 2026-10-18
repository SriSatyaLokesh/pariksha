# v3 — what makes this read as a proper SaaS landing page

> **Superseded in part.** `docs/superpowers/specs/2026-10-17-landing-page-v3-interactive.md` is the
> binding contract and it was revised against two adversarial reviews after this plan was written.
> Where this file and the contract disagree, **the contract wins** — notably on the hero's source
> order and fold arithmetic, the question order, the control row's no-JavaScript sentence, where
> `CB-1` is printed, the carriers of `H-3`/`H-4`, and the HTML byte budget. The contract's §10
> records what was rejected and why. Read this file for its reasoning, not for its tables.

| | |
| --- | --- |
| **Status** | Craft brief — input to the v3 design contract. Decides genre, slots, hierarchy and the close |
| **Date** | 2026-10-17 |
| **Scope** | V4 of the owner's brief: "it should read as a proper SaaS landing page, not an open-source README with a stylesheet" |
| **Binds** | The v3 design contract and the v3 build. Where it conflicts with `docs/superpowers/specs/2026-10-17-landing-page-v2-design.md`, this file wins only on the six questions below; everything else in that contract still stands |
| **Does not bind** | D1–D5. Those are settled. Nothing here re-opens the island, progressive enhancement, the no-network rule, the v2 invariants or the no-ships-today rule |
| **Sources** | `.planning/landing/content-inventory.md` (the sourcing rule, D4), `apps/web/src/` as built today, `ui-ux-pro-max` rule content (§1–§10 as listed in the skill; its `search.py` data directory is empty in this install and was not run) |

---

## 0. The premise, in one paragraph

A SaaS landing page is a genre with a fixed set of slots, and a visitor reads the slots before they
read the words. The genre's problem for Pariksha is that four of its seven slots exist to launder
other people's belief — logos, testimonials, counts, certifications — and Pariksha has none of
them and will not have them for a year. The temptation is to fill those slots badly: a "Trusted by"
row of nothing, a star count, a GDPR badge that is a template rather than an audit. The thesis of
this brief is the opposite. **A page with no users has exactly one asset a page with users does not
need: it can be checked.** Every claim on this page is one click from the file that proves it, and
the hero demo lets a visitor verify the central one in eleven seconds without typing anything. So
the genre's belief-laundering slots are not filled and not left as holes — they are **re-tenanted
with verification**. That is the whole of V4, and it is a stronger page than the generic one,
not a weaker one.

---

## 1. The seven conventions, slot by slot

The verdict column is binding. "Re-tenant" means the slot's position in the spine is kept and its
contents replaced; "drop" means the band goes and nothing stands in for it.

| # | SaaS convention | What it is actually doing | Does Pariksha have the raw material? | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Above-the-fold promise | Tells a stranger what this is and whether to keep reading | Yes — PRD `:31`, inventory §7 Q1 | **Keep**, but one sentence, not four. §1.1 |
| 2 | One primary action | Converts attention into a commitment the visitor can afford | Yes, and the demo changes what it is | **Keep**, re-assigned. §3 |
| 3 | Social proof | Borrows someone else's judgement | **No.** No users, no installs, no testimonials, no adoption figure; inventory §8 "Numbers NOT to print" forbids all four | **Re-tenant** as verifiable proof. §1.2 |
| 4 | Pricing | Answers "what will this cost me, and when does it change" | Partly — the arithmetic is published (PRD `:551-559`), the price is not a price | **Re-tenant** as a cost ceiling. §2 |
| 5 | Integration logos | "It fits what you already run" | **No shipped integrations.** Two deploy targets and one file format | **Re-tenant** as interoperability, text only, no logos. §1.3 |
| 6 | Security and compliance strip | "Someone audited this" | **No audit, no certification, no company.** But real commitments exist | **Re-tenant** as "what we never do". §4 |
| 7 | Final CTA | Asks | Yes — and today the page does not ask | **Keep**, rebuilt. §5 |

### 1.1 The above-the-fold promise

The current lead is four sentences and ends on a status disclaimer, which is a README's opening
paragraph with the heading removed. A SaaS promise is one sentence that survives being read at a
glance, and the rest of the fold is evidence rather than more sentences. With the demo arriving, the
fold has a job the prose cannot do, so the prose must get out of its way.

Shape: **chip · one-sentence promise · the demo · one mono line of honesty · two text links.**
Nothing else above the fold. The promise sentence should assert what an organiser gets, not what the
repository contains. The status sentence that currently closes the lead becomes the mono line under
the demo, where it reads as a caption rather than a retraction — and D5 is better served there,
because it sits adjacent to the thing that just worked.

ui-ux-pro-max §5 `content-priority` (show core content first on mobile, fold secondary content) and
§6 `whitespace-balance` both point the same way: at 375px the fold must carry the promise and the
question, and nothing else may compete for that space.

### 1.2 The social-proof slot — what goes in it

Three substitutes, ranked by how hard they are to disbelieve.

1. **Proof by demonstration — the demo itself.** A visitor who has just answered `LOG-001`, been
   told they were right, and been shown that each term is double the previous plus one has verified
   the one claim the product most needs them to believe: that the scoring is real and the formats
   are real. No testimonial achieves that. This is why the demo is not a hero ornament but the
   social-proof slot collapsing into the promise slot — and why it earns the fold.
2. **Proof you can check in one click.** Four facts, all **measured** per inventory §8, all
   verifiable by a reader who does not trust us: Apache-2.0 with an explicit patent grant
   (ADR 0003); coverage of `packages/core/src` at 97/93/100/98%, gated in CI; a worked example of 17
   questions covering all 12 types; the JSON Schemas. Rendered as a four-item strip, not a band.
   Phrase as *"you do not have to take our word for any of this"* — the line a page with users
   cannot credibly write.
3. **Proof by admission.** Inventory §2(c) and §3 are the strongest credibility the page owns. A
   product that publishes who it is wrong for is making a claim that costs it something, which is
   the only kind of claim a stranger has reason to believe. Keep it — compressed; see §6 T5.

**Is an empty slot better than a badly filled one? Yes, decisively, and it is not close.** A
"Trusted by" row with three grey rectangles, a GitHub star count, or "join N developers building the
future of assessment" would each do more damage than leaving the strip out entirely, because every
one of them is the exact tell that the reader is being sold something by someone with nothing to
show. The slot is not left empty here — it is re-tenanted with (1) and (2) — but if the demo ever
has to ship without the strip, ship without the strip.

Explicitly forbidden in this slot, as a standing rule for v3: star counts, fork counts, contributor
counts, download counts, "used by", "trusted by", waitlist counts, Product Hunt or similar badges,
and any sentence using the word "community" as a proxy for adoption.

### 1.3 The integration slot

A SaaS page shows logos because a buyer's real question is "will this fit what I already run". That
question is legitimate here and has a true answer that is better than logos: **one JSON file in, one
CSV out, and nothing in between is ours.** `pariksha/test@1` is what export returns and import
accepts (`docs/test-format.md:3`), the results CSV is UTF-8 with a BOM so non-Latin names open in
Excel (PRD `R-10`), and the schemas are published so a tool that is not Pariksha can read a bank.

Render as four text labels with one line each — JSON Schema · CSV out · Cloudflare free plan ·
Docker, planned — and **no logos, no brand marks**. Two reasons, both hard: a third-party logo is a
third-party asset, which D4 forbids outright; and a Cloudflare mark beside a product claim reads as
an endorsement that was never given. Text labels also let the Docker column carry its "Phase 11, not
built" label, which a logo row cannot do without looking like a disclaimer bolted onto a boast.

---

## 2. The pricing question

### What the block is for

A pricing section does three things, and only one of them is the number. It tells the buyer **what
the price is**, **where the price changes**, and **what happens when it does**. Pariksha's answer to
the first is zero, which is weak on its own — "free" is what every abandoned side project says, and
a sceptical buyer reads it as "unpriced because unfinished". The strength is entirely in the second
and third answers, which almost no SaaS page can give at all.

### The honest block

Keep the pricing card's *shape*, because the shape is what signals the genre, and fill it with the
three things a pricing card actually contains: the plan, the limit, and the overage.

| Pricing card slot | Generic SaaS | Pariksha's true contents | Source |
| --- | --- | --- | --- |
| The plan | "Pro — $49 per seat, per month" | Your own Cloudflare account, or your own server. Pariksha bills nothing and has no billing code | PRD `:63`, `:449`; inventory §1 Job G |
| The price | A number | **$0 of hosting for a 500-candidate exam hour — estimated by arithmetic, not measured** | PRD `:70`, `:551-559` |
| The limit | Seats, API calls | Worker requests 100,000/day against about 55,000 used · D1 rows written 100,000/day against about 55,000 · R2 10 GB/month against about 0.75 GB | PRD `:555-559` |
| The overage | "$0.02 per extra seat" | Workers Paid at $5/month, or Docker on a server you already have. The adapters exist so the move is configuration, not a rewrite | PRD `:538`; ADR 0002 |
| The catch | Buried | Free-tier limits can change, and that is the named risk against this estimate. Password sign-in is not available on the Cloudflare free plan — 10 ms of Worker CPU is too little for safe Argon2id | PRD `:675`, `:565` |

### What it compares against

**Categories, never named products, and never a competitor's number.** Inventory §8 forbids any
benchmark against a named competitor's price, and the project has measured none. The comparison that
is both true and devastating is structural, not numerical: *per-candidate pricing means the cost of
an exam scales with the number of people you want to assess; a free tier plus a published budget
means it does not.* That sentence is defensible from PRD `:551-559` and ADR 0002 alone, and it names
no one.

### Why this is more persuasive than "free"

Four reasons, and the block should make all four legible without argument:

1. **It shows the arithmetic rather than the conclusion.** A budget table with headroom visible —
   55,000 against a 100,000 limit — is a claim the reader can falsify. "Free" is not.
2. **It prices the thing that is actually scarce.** Self-hosting costs time, not money, and the page
   should say so rather than let the reader discover it. The honest figure is PRD `AC-01`: clone to
   first live test in 30 minutes — **a target, not a measurement**, and labelled as one.
3. **It names the failure mode before the buyer does.** A pricing block that volunteers "free tiers
   change, here is what we did about it" is read as a person talking; one that does not is read as a
   pitch.
4. **It makes the exit the feature.** The adapter seams — database, object storage, identity — are
   not an architecture note. They are the answer to "what happens when the free tier moves", which
   is the only pricing question a careful buyer actually has about a free product.

### What the block must not do

No free/pro/enterprise column grid — there is one plan, and inventing tiers to fill a layout is the
single most dishonest thing available on this page. No "contact sales". No "free forever" as a
promise; the arithmetic is an estimate with a named risk and the copy says so (D4's sourcing rule
and inventory §8's measured/estimated marks both apply). No dollar figure for what a paid platform
would have cost — that number does not exist in the repository.

---

## 3. The primary action

### What changed

Today the page's one filled button is "Start with the worked example", pointing at GitHub, and it
appears in the hero and again in the closing band. With a demo in the hero, that hierarchy is wrong
in two ways: it asks a stranger to leave the page before the page has shown them anything, and it
puts a link-out in the slot the demo now occupies.

**The demo is the primary action.** It is the only conversion this product can honestly ask for
today — no email, no account, no install, no navigation — and it is also the highest-information
one: a visitor who answers the question has learned more about Pariksha than one who clicks through
to a repository they will not read.

### The hierarchy, fixed

| Rank | Action | Where | Rendering |
| --- | --- | --- | --- |
| **Primary** | Answer the question, and reveal the scoring | Hero, inside the demo | The one filled voltage control above the fold |
| Secondary | Read the code on GitHub | Hero, under the demo | Text link |
| Secondary | What is built today | Hero, under the demo | Text link, in-page anchor to the status band |
| Contextual | See how that was scored | Appears **after** the answer is revealed, inside the result panel | Text link to `packages/core` |
| **Primary (repeat)** | Start with the worked example | Closing band — the page's second and last filled button | §5 |
| Secondary | Watch the repository for v0.1 | Closing band | Text link |

ui-ux-pro-max §4 `primary-action` says one primary per screen, and this is enforced literally: above
the fold there is exactly one filled control and it belongs to the demo. The worked-example button
does not appear in the hero at all. It is not demoted — it is relocated to the one place on the page
where it is the right ask, which is after the argument, not before it.

### On the "see how that was scored" link

This is the page's best single moment and it should be designed deliberately. It appears only after
the visitor has answered, which is ui-ux-pro-max §8 `progressive-disclosure` doing real work rather
than hiding complexity for its own sake. It converts the demo from a toy into evidence, it points at
`packages/core` — the one part of the product that genuinely exists, which is D5's whole argument —
and it arrives at the exact second the visitor is wondering whether the scoring was real.

### What we do not ask for

**No email capture, no waitlist form, no newsletter.** Three reasons, each disqualifying on its own:
the project has no list and no sending infrastructure (the API is Phase 2); a form on a page whose
central promise is "no telemetry, nothing leaves your browser" contradicts itself in the most
visible slot available; and D3 forbids the network call the form would need. If a "tell me when it
ships" affordance is ever wanted, the honest one already exists and costs nothing — *watch the
repository for releases* — and that is what the closing band's secondary link offers.

### Demo conformance — the UX rules the island must meet

The demo is now the most interactive element the project ships, in the most scrutinised position on
the page. These are not suggestions; they are the acceptance surface for the island, drawn from the
ui-ux-pro-max categories named beside each.

- **Reserve the result panel's height before the answer is revealed**, so revealing it shifts
  nothing. The demo sits in the hero, so a shift here is a Cumulative Layout Shift against the LCP
  element. §3 `content-jumping`, `image-dimension`.
- **Never reveal correctness on hover**, and never make hover the only route to any state. §2
  `hover-vs-tap`.
- **Option rows are at least 44px of touch target with at least 8px between them**, at every width.
  §2 `touch-target-size`, `touch-spacing`.
- **Correct and incorrect are never conveyed by colour alone** — each carries a word. §1
  `color-not-only`; also §6 `color-accessible-pairs` for the 4.5:1 pair in both themes.
- **The result announces itself to screen readers** via a polite live region, and focus is not
  stolen. §8 `aria-live-errors`, `toast-accessibility`.
- **The options are a real radio group** with real labels, keyboard-operable, visible focus ring,
  tab order matching visual order — which the prerendered markup gives for free if D2 is honoured
  properly. §1 `keyboard-nav`, `focus-states`, `form-labels`.
- **Feedback within 100ms, transitions 150–300ms, and nothing animates that is not expressing cause
  and effect**; `prefers-reduced-motion` removes the motion and keeps the information. §7
  `duration-timing`, `motion-meaning`; §1 `reduced-motion`.
- **The incorrect state explains rather than scolds.** The explanation string already exists in the
  file (`examples/reasoning-aptitude/questions.json`) and is the correct copy to show. §8
  `error-clarity` — state the cause and how to get it right, never just "wrong".
- **A way back.** The visitor can change their answer and reveal again. §1 `escape-routes`.

---

## 4. Trust, for a self-hosted privacy product

### The order a sceptical buyer actually asks in

Not the order the product is proud of. The sequence is **catch → control → competence → cost**, and
the page should answer in that order, because a reader who has not had the catch answered is not
listening to the rest.

| Order | The unspoken question | What answers it | Where |
| --- | --- | --- | --- |
| 1 | "What is the catch — why is this free?" | Apache-2.0 with an explicit patent grant; you host it; there is no hosted Pariksha and there is not going to be one | **Above the fold**, in the chip |
| 2 | "What does it do with what I type?" | **Nothing leaves your browser.** No network call, no storage, no analytics — true of the demo, and the page is the proof | **Above the fold**, one line under the demo |
| 3 | "Is there enough here to be worth my time?" | The demo worked; `packages/core` is real; here is the coverage and the worked example | Above the fold as the demo result, then the verification strip |
| 4 | "Where does candidate data live?" | Your Cloudflare account or your server. No telemetry, no third-party scripts, no trackers — and this page keeps that promise today: self-hosted fonts, `default-src 'self'` | Trust band |
| 5 | "Can a candidate cheat the thing?" | Answer keys and explanations never reach the candidate's browser; every rule is re-checked on the server; the clock is the server's | Trust band |
| 6 | "What does it record about people?" | No video, no audio, ever. 320×240 snapshots only, on-device face counting, no biometric template stored | Trust band |
| 7 | "Who decides someone cheated?" | A person. The app flags `clean`, `review` or `high_risk` and stops there | Trust band |
| 8 | "What are you on the hook for?" | A 14-day security fix commitment; retention defaults of 90 days and 12 months; signed URLs expiring in 10 minutes; a data-processing template — **not an indemnity** | Trust band, closing line |

### Which belong above the fold

**Two, and only two: the licence-and-self-host chip (1), and "nothing you type here leaves your
browser" (2).** Everything else is a band. The reason is that (1) and (2) are the only two a visitor
needs *before* they interact — (1) tells them why the page is not selling them something, and (2) is
a precondition for touching the demo at all. The rest answer questions a visitor does not have yet,
and hoisting them turns the fold into a disclaimer wall, which is the README failure mode in its
purest form.

Note that (2) is the rare claim that is self-proving: a reader who opens the network tab sees
nothing. That is why it is worth one line of the most expensive space on the page. Say it plainly
and do not decorate it.

### What the trust band must never contain

No compliance badges or certification marks of any kind. No "GDPR compliant" or "DPDP compliant" —
what exists is a **data-processing template** (PRD `S-19`), and the difference between a template
and compliance is exactly the difference the badge would erase. No SOC 2, no ISO, no shield icons,
no padlock iconography standing in for an audit. Every item carries its SHIPPED / SPECIFIED mark per
D4 and inventory §1, and the band's own lead line should say, once and in the product's voice, which
of its claims are commitments rather than code.

---

## 5. The bottom of the page

### What is there now

A hero-shaped band whose visual is a file listing: five filenames with line counts and a phrase
each — `questions.json`, 260 lines; `README.md`, 451 lines. It is accurate, and it is the output of
`wc -l`. A directory index answers "what is in this folder", which is a question only a reader who
has already decided to clone asks — and the page has not yet asked them to decide anything.

### What it should close with

The closer's job is the ask, and the ask has to be one a stranger can say yes to this minute. Four
elements, in this order, and nothing else:

1. **A heading that converts the argument into an instruction.** Declarative, imperative, short.
   The page has spent eight bands establishing that the formats are real and the application is not;
   the closer's heading is what to do with that.
2. **One filled button — the only other one on the page.** *Start with the worked example.* It is
   the right final ask precisely because it is small: it costs a click, it lands on a real artefact,
   and it is honest about what is there.
3. **One secondary text link — *watch the repository for v0.1*.** This is the closest honest
   equivalent to a waitlist (see §3), it collects nothing, and it converts the visitor who likes the
   project but cannot use it yet — which is most of them.
4. **One line of honesty, in mono, as the last thing above the footer.** Pre-alpha; the formats are
   ready to write against; the application lands with v0.1. It belongs at the end because by now the
   reader has evidence to weigh it against, which is the opposite of how it reads in the hero.

**No artefact in the closing band.** No file listing, no code block, no mock. The closer is the one
band on the page allowed to be mostly empty, and the emptiness is the signal that the argument is
over and a decision is being asked for. ui-ux-pro-max §6 `whitespace-balance` is the rule; the
design reason is that every pixel of evidence in the closer competes with the button.

### Where the file listing goes instead

It does not need to survive, but one thing in it does: the no-install validate command
(`README.md:139-148`) is the only command on the page a visitor can run today that does something
real, and v2's success criterion **G2** depends on it being somewhere. Move it into the
interoperability strip (§1.3), where it proves the open-format claim at the moment the claim is
made. If the owner wants an artefact in the closer after all, that command — one monospace line, no
caption, no block chrome — is the only candidate; the file listing is not.

---

## 6. Five things that make this read as a README, each with its fix

### T1 — Every band heading is a question

`What is Pariksha?` · `How does running an exam on Pariksha actually work?` · `Why not a form tool,
and why not a paid assessment platform?` · `Does an organiser ever have to write JSON?` · `What does
it cost to run an exam on Pariksha?` · `Who is Pariksha not for?` · `What is built today, and what
is not?` — seven of the twelve bands open with a question mark. That is documentation voice. A
product page asserts in its headings and keeps the interrogative for the FAQ, where it belongs and
where the `FAQPage` JSON-LD needs it.

**Fix.** Convert the band headings to declarative. Keep the interrogative only in S10's FAQ, which
already carries thirteen questions in both the copy and the JSON-LD. **This does not cost the AEO
position**: what an answer engine extracts is the answer-first first paragraph, which every band
already has and which the v2 contract requires independently. The heading's question mark is not
what earns the answer, and duplicating the FAQ's interrogatives across the spine spends the page's
seven loudest lines on questions the visitor has not asked yet. The one heading worth keeping as a
question is the cost band's, where the question genuinely is the buyer's own first words.

### T2 — Repository paths and identifiers inline in body prose

`packages/core` in running text, `AC-29` as a bare acceptance-criterion code inside a parenthesis,
`ADR 0002` as a link in a sentence about architecture, `validateTest`, `PoolTooSmallError`. A page
that cites its own internal identifiers is talking to a contributor, not a buyer — nobody outside
the repository knows what `AC-29` is, and its presence signals that the page was written by someone
who forgot there was an outside.

**Fix.** One code path survives on the page: `packages/core`, in the demo's result panel, where it
is the point. Everything else moves to the footer's documentation column, which is the correct home
for citations and already exists. Where an inline source is genuinely load-bearing — the cost
estimate's status, for instance — say it in words ("a design target; the load test that would prove
it has not been run") rather than in a code. The FAQ may keep sourced references in its answers.

### T3 — The twelve-row roadmap ledger

Already condemned by V3, and worth naming the reason precisely: it is a `CHANGELOG.md` rendered in
CSS. Twelve rows of `01 Foundation and scoring core · DONE` is a project-management artefact, it
puts the reader inside the team's build order, and it asks them to care about Phase 7 before they
have decided whether they care about Phase 1.

**Fix.** Delete the ledger entirely. The honest content inside it compresses to two things, both of
which survive: one sentence of status under the demo (D5), and a short built / specified pair in the
status band. Nobody who has not already decided to use Pariksha needs to know there are twelve
phases, and the roadmap is one click away in the footer for the one reader who does.

### T4 — The closing file listing with line counts

`questions.json · 260 lines`. Line counts are the output of a command, not a product claim, and
listing a directory in the page's final band is the most literal possible expression of "this is a
repository with a stylesheet on it". Fixed in §5.

### T5 — The eight-paragraph "who it is not for" band

The content is the best trust asset the page owns and must not be weakened. The *form* is a README's
Limitations section: eight consecutive paragraphs of caveat at full band height, every one weighted
identically, which flattens "the application does not exist yet" to the same emphasis as "no code
runner".

**Fix.** Keep four — the four that actually disqualify a buyer in the first thirty seconds: needs to
run a test this week; wants somebody else to host it; a legally contestable high-stakes examination;
candidates who will sit it on a phone. Render them as a short list with the band's sparse density
intact. The remaining four — live proctoring and lockdown browsers, code runners, vendor liability,
AI deciding who cheated — move into the FAQ, which exists, is the right home for long-tail
objections, and carries them into the `FAQPage` JSON-LD where they keep their AEO value rather than
losing it. Nothing is softened and nothing is deleted: eight admissions in, eight admissions out.

### T6 — Smaller tells, worth fixing in the same pass

- **Nav labels.** `What it is · How it works · Cost · Docs · GitHub` puts two repository
  destinations in a five-item product nav. A SaaS nav names product surfaces; docs and source go to
  the end, or into the footer.
- **The band that argues with itself.** `Does an organiser ever have to write JSON?` exists only
  because the three bands before it showed JSON. That is a README's structure — show the format,
  then reassure. Fold its answer into a caption beside the format artefact and an FAQ entry; the
  band does not need to exist. Its pull quote — "you will never have to write this; it is here so
  that nothing you build is trapped" — is good copy and should survive as the interoperability
  strip's line in §1.3.
- **Status language in the present tense of the roadmap.** "Phase 1 landed with 173 tests" is a
  commit message. The reader-facing version is the coverage figure and the worked example, both of
  which they can check.

---

## 7. The spine this implies — twelve bands to eight

Offered for the v3 contract to ratify or revise; the six answers above are what binds, not this
table. It satisfies V2 (shorter) and V3 (ledger gone) without losing a single sourced claim — every
cut either merges or lands in the FAQ.

| v3 | Band | Absorbs | Note |
| --- | --- | --- | --- |
| B1 | Hero and the demo | S1, S2's numerals, S9's status sentence | One filled control. §1.1, §3 |
| B2 | How an exam runs — three steps | S3 | Steps 1 and 3 keep their artefacts; step 2's code block goes |
| B3 | What it does, and why not the alternatives | S5 + S4 | The comparison is the feature list's argument; two bands said it twice |
| B4 | What it costs | S7 | Reshaped as the cost-ceiling card. §2 |
| B5 | What never happens to your data, and what it talks to | S6's key claims + the privacy set + interoperability | §1.3, §4; carries the validate command |
| B6 | Who it is not for, and what is built | S8 compressed + S9 minus the ledger | §6 T3, T5 |
| B7 | Questions and answers | S10 + four items from S8 + S6's no-code answer | FAQ and `FAQPage` JSON-LD stay identical to each other |
| B8 | The ask | S11 rebuilt | §5. No artefact |
| — | Footer | S12 | Gains the citations displaced by §6 T2 |

Dissolved: S6 as a band (G2 preserved via B5). Deleted: the roadmap ledger, the closing file
listing. Nothing else leaves the page.

---

## 8. Open questions for the owner — raise, do not decide silently

1. **The declarative-heading conversion (T1) touches `seo-mechanics.md`.** The reasoning above is
   that answer extraction follows the answer-first paragraph rather than the heading's question
   mark, but the SEO document is where that was originally argued and it should be re-read before
   the headings change. If an interrogative heading turns out to be load-bearing for a specific
   artefact, keep it on B4 and B6 and convert the rest.
2. **The hero loses the runner mock (M-1) to the demo.** The mock is currently the page's strongest
   image and the thing that bleeds past the wrap to the viewport edge. The demo replaces its content
   but not necessarily its frame — whether the demo is housed inside the same cropped,
   right-bleeding plane or becomes a contained card is a composition decision the v3 contract should
   make explicitly rather than inherit.
3. **The demo question is `LOG-001`, which is also the mock's question and S3's example.** That was
   deliberate in v2 — the same artefact shown as input and as output. With the demo interactive, the
   repetition may now read as a thin library rather than a tight argument. Consider whether the demo
   keeps `LOG-001` and S3 switches to `QNT-003` (`select_k`, partial credit), which would also let
   the demo's result panel demonstrate partial credit — the single most convincing thing
   `packages/core` does.
4. **The emoji question from inventory §4.5 is moot** if the ASCII mock leaves the hero, but confirm
   it is not reintroduced anywhere else before closing it.
