# v3 — the cull

> **Superseded in part.** `docs/superpowers/specs/2026-10-17-landing-page-v3-interactive.md` is the
> binding contract and it was revised against two adversarial reviews after this plan was written.
> Where this file and the contract disagree, **the contract wins** — notably on the hero's source
> order and fold arithmetic, the question order, the control row's no-JavaScript sentence, where
> `CB-1` is printed, the carriers of `H-3`/`H-4`, and the HTML byte budget. The contract's §10
> records what was rejected and why. Read this file for its reasoning, not for its tables.

What goes, what merges, what survives, and the defence for every deletion.

Companion to `docs/superpowers/specs/2026-10-17-landing-page-v2-design.md`, which stays binding
except where this file overrides it. Written against the built page as of 2026-10-17:
`apps/web/dist/index.html`, 53,442 bytes, twelve bands, six code blocks, four rendered surfaces,
thirteen FAQ pairs.

Controller decisions D1–D5 are settled and are not re-opened here. This file answers one question:
with a working exam in the hero, which of the other eleven bands still earns its scroll.

---

## 0. The measurement this cull is built on

Not estimates. Byte counts taken from the built `dist/index.html`, section open tag to section
open tag, in document order.

| Band | id | Bytes | Share |
| --- | --- | ---: | ---: |
| head, `<nav>`, skip link | — | 6,608 | 12.4% |
| S1 hero | — | 2,714 | 5.1% |
| S2 what is Pariksha | `what-it-is` | 1,147 | 2.1% |
| **S3 how it works** | `how-it-works` | **10,885** | **20.4%** |
| S4 comparison | `comparison` | 3,851 | 7.2% |
| S5 features | `features` | 3,839 | 7.2% |
| S6 no-code | `no-code` | 3,894 | 7.3% |
| S7 cost | `cost` | 3,281 | 6.1% |
| S8 who it is not for | `not-for` | 1,820 | 3.4% |
| **S9 status + roadmap ledger** | `status` | **5,231** | **9.8%** |
| S10 FAQ (13 pairs) | `faq` | 6,607 | 12.4% |
| S11 closing | — | 1,765 | 3.3% |
| S12 footer | `docs` | 1,800 | 3.4% |
| **Total** | | **53,442** | |

Three facts fall straight out of that table and they decide most of this document.

1. **S3 is a fifth of the page on its own.** It is three steps, three code blocks and a rendered
   results table. It is also the band the hero demo most directly duplicates.
2. **S3 + S5 + S6 are 18,618 bytes — 35% of the page — and all three teach the same thing.** S3
   teaches the mechanism, S5 catalogues it, S6 apologises for the code blocks the other two
   printed. A demo that performs the mechanism makes two of those three redundant rather than one.
3. **S9's ledger is 9.8% of the page and the owner named it.** But S9 is not only the ledger; the
   dated release paragraph inside it is the string that keeps every quotation of this page honest.
   The cull has to separate the two, which §3 does.

FAQ pairs cost about 508 bytes each. That is the exchange rate for every argument below about
whether a question is worth keeping.

---

## 1. The finding that outranks the cull

**The demo grades in the visitor's browser. The page's strongest differentiator is that Pariksha
does not do that.**

The claim "answer keys and explanations never reach a candidate's browser" appears four times in
the built page and is sourced four times in `content-inventory.md` — PRD `S-10` and `AC-22` at
`content-inventory.md:112`, the comparison's strongest row at `:157` (*"A form's answer key is in
the page you send"*), FAQ Q10's body at `:567`, and CB-1's prose caption at `:265`. It is the one
sentence that beats Google Forms outright and it is the reason S4's table lands.

A client-side demo that scores an answer has the key in the browser. There is no server; D3 forbids
one. So the page would, in its first screenful, ship the exact artefact it spends its fourth band
condemning — and a reader who opens devtools finds it.

**This is not a reason to drop the demo. It is the demo's caption.** The line under the result,
binding copy, substance:

> This demo scores in your browser because there is nothing to call. A real Pariksha test does the
> opposite: the key stays on the server and never reaches a candidate (PRD `S-10`).

That converts the contradiction into the page's clearest statement of the thing it is selling, at
the moment the visitor is most receptive — they have just been scored. It is strictly better than
the comparison-table row that currently carries the claim alone, and it costs one sentence.

**Hard rule for the build: no demo question's `key` or `explanation` may be reachable before the
visitor answers it.** Shipping all three questions' keys in the island's initial payload would make
the caption above false in the one way that matters. The island may hold them; the markup
prerendered above the fold may not print them.

---

## 2. Section by section

Verdicts: **KEEP** (ships unchanged), **COMPRESS** (survives as its own band, smaller),
**MERGE** (survives as an `h3` inside another band), **DELETE** (goes).

**The governing rule of this cull: no question-shaped heading is deleted.** `seo-mechanics.md` §3.5
and SEO-26 value the heading because it is the string a person types, and an `h3` is as extractable
as an `h2` — S10 has always proved that with thirteen of them. So a band that loses its scroll
keeps its query: its `h2` becomes an `h3` in the band that absorbs it. Every merge below is a
demotion, not a deletion, and the answer coverage §5 of the contract paid for survives it.

| # | Section | Verdict | Justification (one sentence) | What the page loses | Who notices | Query cost |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Hero | **KEEP, rebuilt** | The static mock M-1 becomes the live exam; the chip, `h1`, lead and both CTAs stand exactly as §3 S1 specifies them. | M-1's decorative `aria-hidden` subtree and its sixty elements of fictional content above S2. | Nobody — the same content is now real and interactive. | None; gains "try an exam online free", "exam demo", which the page won nothing for before. |
| S2 | What is Pariksha? | **KEEP AS IS** | 1,147 bytes for the page's single most liftable paragraph plus the `12 / 5 / 3` numeral row is the best byte-for-value on the page and the cull does not touch it. | — | — | — |
| S3 | How running an exam works | **COMPRESS** 10,885 → ~4,200 | The demo performs step 03, so the band keeps the two things the demo cannot show — the pool mechanic and the organiser's output — and drops the narration around them. | CB-3 (the CSV code block); step 01's and step 03's step prose; one of the three large ordinals. | Nobody: CB-3 and the rendered results table M-3 are the same three rows, and M-3 is the accessible one with the `<caption>`. | None. The `h2` is the literal query and stays; CB-3 was a duplicate rendering of M-3's data. |
| S4 | Why not a form tool, why not a paid platform | **KEEP AS IS** | `seo-mechanics.md` §3.5d names the table row as the single most liftable asset the project owns, and the cull does not spend its most liftable asset to save 3.8 KB. | — | — | — |
| S5 | What it does, by the job it does | **MERGE into B3** | Of six cells, one duplicates S3 step 02 and four describe software that is specified and not built — a weak catalogue of unbuilt features reads worse beside a working demo than it did beside a static mock. | Four `FeatureCell`s of prose; the asymmetric grid; CB-6 as a standalone block. | An organiser scanning for "does it do registration" — mitigated: the four become four one-line statements under the `h3`, same strings, a quarter of the bytes. | None. `What does Pariksha do?` survives as an `h3` with the twelve type names still a real `<ul>`, which is what the "how many question types" query actually ranks on. CB-6 moves to the demo, where "a wrong answer costs a quarter of the question's points" is now something the visitor watches happen. |
| S6 | You never write JSON | **MERGE into B3**, M-2 **DELETED** | The answer paragraph and the pull quote are the band; the left column is a hand-drawn mock of an authoring UI that does not exist, and per D5 a fictional screen beside a working one is the page's biggest overclaim risk. | M-2, the question-editor mock, and the three UX decisions beside it. | A reader who wanted to see the builder — and D5 says that reader is precisely the one being misled, because the builder is Phases 4–5 and nothing is built. | None. `Does an organiser ever have to write JSON?` survives as an `h3` with its binding 40–60 word answer and the `content-inventory.md` §5 pull quote verbatim. Deleting M-2 improves honesty and size in the same edit. |
| S7 | What it costs, and where it runs | **COMPRESS** 3,281 → ~2,300 | The `$0` card, both binding qualifications and the budget table stay; the two deploy cards collapse to one line each and CB-5 goes. | CB-5, the three-line deploy of this website. | Nobody. CB-5 deploys the *landing page*, not the product, and needed a binding footnote saying so — a code block that requires a disclaimer to avoid misleading the reader is not earning 400 bytes. | None. CB-5's binding truth ("the exam API is Phase 2") survives as a sentence beside the Cloudflare line. The `h2` is the literal query and stays. |
| S8 | Who it is not for | **KEEP AS IS**, +1 sentence | §3 S8 says do not shorten it, do not card it, do not soften one of the eight — and it is the most citable passage the project will own at 1,820 bytes. | — | — | Gains one: it absorbs FAQ Q9's substance as a ninth sentence (see §4). |
| S9 | What is built, what is not | **LEDGER DELETED; truth MERGED into B6** | V3 names the ledger, and the ledger is also a twelve-row copy of `docs/ROADMAP.md` that must be re-verified against the repository on every deploy — a second source of truth on a marketing page. | The twelve-row typographic ledger, the four milestone labels, the band itself. | A reader tracking the project's shape — mitigated by linking `docs/ROADMAP.md`, which is where that reader should be and where the rows cannot go stale. | **Real, and small.** The page loses the strings "Phase 4", "Phase 7", "candidate runtime" and so on as a scannable set. It keeps every string that has query value: `pre-alpha`, the literal date, `Apache-2.0`, `BYOK`, `packages/core`. `What is built today, and what is not?` survives as an `h3` on `#status`, so the existing in-page nav anchor and any inbound link to `#status` still resolves — zero link rot. |
| S10 | Questions and answers | **COMPRESS** 13 → 9 pairs | The densest answer surface on the page stays, four pairs go: two are now duplicates of band headings, one is near-zero intent, one has a better home. | Q3, Q4, Q9, Q15. | See §4 — Q15 is a real loss and is mitigated, not pretended away. | See §4, costed pair by pair. |
| S11 | Closing | **KEEP**, absorbs CB-4 | The folder listing M-4 bookends the demo perfectly — the page opens on the candidate's screen and closes on the organiser's folder — and CB-4 belongs beside the folder it validates. | — | — | Gains. CB-4 (`npx ajv`) and the demo are now the page's two runnable things, and both sit at its ends. |
| S12 | Footer | **KEEP**, +1 licence sentence | Unchanged by design, plus the one sentence that mitigates dropping FAQ Q15. | — | — | Gains the Apache-2.0 patent-grant and commercial-use strings back into the HTML. |

### The SEO trade, stated plainly, because §5 of the contract was expensive

**It is not a bad trade, and here is the arithmetic.** The page carries eight question-shaped `h2`s
and thirteen question-shaped `h3`s, twenty-one extractable question strings in total. After the
cull it carries six `h2`s, three absorbed `h3`s and nine FAQ `h3`s — **eighteen**. Four question
strings are lost, all four from the FAQ (Q3, Q4, Q9, Q15), and one of those four, Q4, is a pure
duplicate of a surviving `h2`, so the real loss is three.

Against that the page gains: an interactive surface for the demo-intent query class it previously
won nothing for, a 29% smaller HTML document in which the surviving strings sit at a higher
density, and — the item `seo-mechanics.md` §3.5 weights most — S2's lifted paragraph and the
comparison table move from 40% to roughly 25% of the way down the document, deeper inside the band
that produces ~44% of AI citations.

**The one thing the cull must not do is quietly drop a liftable structure, and it does not.** All
four survive untouched: S2's paragraph and numeral row, S4's `<table>` with its `<caption>` and
`scope` attributes, S7's budget table, and S8's eight definitive sentences. The deletions are
narration, duplicate renderings, and a mock of software that does not exist.

---

## 3. S9 — where the honesty goes when the ledger goes

V3 kills the ledger. It does not kill the page's honesty spine, and D5 raises the stakes: a visitor
who has just sat an exam will assume the product exists. The truth now needs to be carried **more**
prominently than S9's ninth band carried it, not less. Four carriers, in the order the visitor
meets them.

| # | Carrier | Where | Exact substance |
| --- | --- | --- | --- |
| 1 | **The chip** | Hero, first screenful, unchanged | `PRE-ALPHA · APACHE-2.0` — twenty-two characters of mono, status as a stance. |
| 2 | **The demo's own caption** | Directly under the demo's result, where every reader who interacts lands | *The scoring you just watched is `packages/core` — built, tested, 173 tests in Phase 1. The application that would serve this test to a room of candidates is specified and not built.* **This is the single most important line added by v3** and it is the one the cull trades the ledger for: it is read by everyone who takes the demo, which is far more readers than a band at 80% scroll depth ever reached, and the one part of the product that IS built is the part the demo just ran. |
| 3 | **The dated release paragraph** | `h3` on `#status` inside B6, opening the sub-band | S9's existing 40–60 word paragraph, unchanged, naming Pariksha in the first sentence. **It must still contain the literal string `pre-alpha` and the literal date `October 2026`** — `seo-mechanics.md` §3.5e, and the reason is unchanged: "currently pre-alpha" becomes a lie when quoted in six months. |
| 4 | **The ledger's replacement, one sentence** | Same `h3`, after the built/specified lists | *Twelve build phases under four milestones; one is complete and a second part done — this website is its output.* Followed by the link to `docs/ROADMAP.md`. One sentence and one link in place of twelve rows and four milestone labels. |

Also surviving inside that `h3`, because none of it is the ledger: the **Built and tested** list
(the formats, the JSON Schemas, the 17-question worked example, `packages/core` with all 12 types
and all 5 modes, "Phase 1 landed with 173 tests" — never a bare present-tense "173 tests"), the
**Specified, not built** list (authoring UI, test builder, candidate runtime, proctoring, results,
API) with its PRD link, and the **BYOK `CardHairline`** verbatim from `content-inventory.md` §6
with its `Phase 9, not built` label. Every barred phrase in §3 S9 stays barred.

**Why one sentence beats twelve rows, beyond length.** The ledger was a second copy of
`docs/ROADMAP.md` living in a marketing page's JSX — `apps/web/src/sections/s7-s9/StatusSection.tsx`
currently holds all twelve phase titles and their states as a literal array, and it drifts the
moment a phase lands. The repository is the canonical place for that table and it is one click
away.

---

## 4. The FAQ — nine of thirteen, named

The contract's own pre-decided deletion order (§3 S10, P2) is **Q3, Q15, Q5, Q9**. This cull takes
three of those four, **declines Q5**, and adds **Q4** which the contract did not list. Numbering is
`content-inventory.md` §7's.

### Surviving — 9

| # | Question | Why it is not deletable |
| --- | --- | --- |
| Q2 | Can I use Pariksha today? | **More valuable after v3, not less.** It is the literal query of a visitor who has just been scored by a demo and wants to know whether the product exists. The demo makes this the page's most-asked question. |
| Q5 | Where is candidate data stored? | **Kept against the contract's deletion order, deliberately.** §3 S10 justified cutting it because "S7 and S4 both already carry it" — but S7 is being compressed in this same cull and now carries jurisdiction only glancingly, and the answer's real content (your D1 and your R2, *no Pariksha server in the path*, no telemetry) is the privacy-first product's core claim. Cutting it while compressing its two carriers would have removed the claim from the page by accident. |
| Q6 | How many question types does it support? | Literal high-volume query; the 40–60 word form is the extractable one even though the twelve names are also a `<ul>` in B3. |
| Q7 | How does it stop candidates copying from each other? | The query form of the one capability a form tool cannot have. Pairs with S4's row and B3's CB-2. |
| Q8 | Does Pariksha record video of candidates? | Definitive, unhedged, privacy-decisive, heavily citable. Never deletable. |
| Q10 | Is Pariksha better than Google Forms for an exam? | §3 S10: not deletable. The page's most-wanted comparison query. |
| Q11 | How is it different from Mettl, HackerEarth or Testlify? | §3 S10: not deletable, and the only place four competitor proper nouns reach `dist/index.html`. This is the query class a self-hosted competitor exists to capture. |
| Q13 | Can I write questions before the app exists? | §3 S10: not deletable. The "what can I do today" answer, and it now points at the closing band's CB-4. |
| Q14 | Can Pariksha generate questions with AI? | High query volume, and with S9's band gone this and the BYOK card are the only places AI is answered — deleting it while deleting S9 would take AI off the page entirely. |

### Cut — 4, and what each costs

| # | Question | Contract's order | Cost | Mitigation |
| --- | --- | --- | --- | --- |
| Q3 | What does "Pariksha" mean? | 1st | **Near zero.** A brand-definition query with no commercial intent, asked by people who already found the page. | The Telugu `పరీక్ష` and Devanagari `परीक्षा` forms survive in the footer's mono gloss with their `lang` attributes, so the strings still reach the HTML and the `llms.txt` definition still carries the meaning. |
| Q4 | How much does it cost to run? | not listed | **Zero.** It is a duplicate of B5's `h2`, `What does it cost to run an exam on Pariksha?`, which is the same literal query at a higher heading level with the `$0` numeral and the budget table under it. The contract already cut Q1 and Q12 for exactly this reason; Q4 was missed. | None needed. The `h2` outranks the `h3` for the same string. |
| Q9 | Can browser proctoring actually prevent cheating? | 4th | **Real but recoverable.** This is the most trust-building answer the project owns — the project's own documentation saying its proctoring cannot prevent cheating. Losing the heading loses the "can browser proctoring prevent cheating" query. | **Its substance moves to the better home it always deserved: a ninth sentence in S8's not-for list** — *anyone who believes browser proctoring prevents cheating; our own documentation says it does not.* That passage is the page's most-cited surface by `seo-mechanics.md` §3.5's own measure of definitive language, so the sentence gains readers while the heading loses a query. Net positive on citation, net negative on one query string, and the trade is worth it. |
| Q15 | What licence is it under, and can I sell a service built on it? | 2nd | **The one genuinely bad trade in this cull, and it is being made with eyes open.** "Can I sell a service built on it" is a decision-grade question for R2, the self-hosting developer, and Apache-2.0's explicit patent grant is a real differentiator over AGPL competitors. Losing the `h3` loses "pariksha licence" and "pariksha commercial use". | One sentence added to the footer's Licence column: Apache-2.0 with its explicit patent grant, self-host, modify, embed or sell a hosted service; documentation and schemas CC BY 4.0; the name is not licensed with the code. Strings preserved, question-shaped heading lost. `llms.txt` carries the licence too. **If the finished build comes in under the §5 weight target with room to spare, Q15 is the first thing to restore** — it is the cheapest 400 bytes on the restore list. |

**Form unchanged:** plain `h3` + `p`, two-column grid at ≥900px, stacking below. Not `<details>`,
not an accordion — §3 S10's rule stands and the demo island does not change it. Nine pairs at two
columns is four and a half rows, which is a scannable set rather than a queue.

---

## 5. The new spine

Nine bands including the footer — **eight content bands, down from eleven**. Voltage still appears
exactly three times: the hero, one `card-voltage` in B5, the closing band. `DESIGN.md`'s
"`card-voltage`: one per page, at most" holds.

| # | id | Band | `h2` | Absorbs | Surface | Heading | Density | Pad | Target bytes | Now |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| B1 | — | **Hero, with the exam in it** | `h1` — *Pariksha — run real exams you host yourself.* | S1 + the island + CB-6 as the scoring caption | **voltage** | `display-xl` (h1, once) | generous | 96 | ~5,200 | 2,714 |
| B2 | `what-it-is` | What is Pariksha? | `What is Pariksha?` | unchanged | cream | `heading-md` + eyebrow | sparse | 64 | 1,147 | 1,147 |
| B3 | `how-it-works` | How running an exam works | `How does running an exam on Pariksha actually work?` | S3 (compressed) + S5 (`h3`) + S6's surviving half (`h3`) | cream | `display-lg` | dense | 96 | ~7,000 | 18,618 |
| B4 | `comparison` | Why not a form tool, why not a paid platform | `Why not a form tool, and why not a paid assessment platform?` | unchanged | canvas | `display-lg` | dense | 96 | 3,851 | 3,851 |
| B5 | `cost` | What it costs, and where it runs | `What does it cost to run an exam on Pariksha?` | S7 compressed; CB-5 deleted | cream | `display-lg` | medium | 96 | ~2,300 | 3,281 |
| B6 | `not-for` | Who it is not for | `Who is Pariksha not for?` | S8 unchanged + S9's truth as an `h3` on `#status` | canvas | `heading-md` + eyebrow | sparse → medium | 64 | ~3,000 | 7,051 |
| B7 | `faq` | Questions and answers | `Questions and answers` | 9 pairs | cream | `heading-md` + eyebrow | dense | 64 | ~4,700 | 6,607 |
| B8 | — | Closing | `Read one real test, end to end.` | S11 + CB-4 | **voltage** | `display-lg` | generous | 96 | ~2,400 | 1,765 |
| B9 | `docs` | Footer | visually hidden | S12 + the licence sentence | canvas | `heading-sm`, hidden | dense | 64 / 24 | ~1,900 | 1,800 |
| | | head, nav, skip link | | `#status` and `#not-for` both still resolve | | | | | ~6,300 | 6,608 |

Rhythm, re-derived for eight bands rather than twelve: no two adjacent rows share both surface and
density (B3→B4 share density, surface flips; B5→B6 both flip; B6→B7 both flip). The contract's own
note stands — surface alternation is a contrast-test input, not a felt device — so rhythm is still
carried by the three columns that vary: heading scale, measure and density. Rest points are now
two rather than three, B2 and B6's opening, and that is correct for a page two thirds the length.

### B3 in detail, because it is the band doing the absorbing

One chapter, three sub-headings, in this order:

1. The binding 40–60 word answer-first paragraph (§3 S3, verbatim — "Running an exam on Pariksha
   is three steps…").
2. **Step 01 — Write the questions**, with **CB-1**. CB-1 is kept, and its value went *up*: the
   hero demo renders `LOG-001` and CB-1 is `LOG-001`'s source. *You just answered this; here is the
   file it came from* is the best transition the page has ever had, and it costs ~900 bytes.
   CB-1's prose caption about the key and the explanation now cross-references the demo caption in
   §1 rather than contradicting it.
3. **Step 02 — Assemble the test into sections**, with **CB-2**. Untouched. This is the pool and
   fixed-set mechanic, the single capability a form tool cannot have, and S4's table depends on the
   reader having met it.
4. **Step 03 — They sit it; you download the results.** Step prose cut to nothing; **M-3**, the
   rendered `results-table`, and the Divya paragraph verbatim. The demo showed the sitting; this
   shows the organiser's output, which the demo cannot. CB-3 deleted as a duplicate of M-3.
5. `h3` — **`What does Pariksha do?`** The twelve type names as a real `<ul>`, then four one-line
   statements: registration, proctoring (*no video and no audio are ever recorded*), flags not
   verdicts, results and CSV. §3 S5's binding lead line about what is shipped versus specified
   stays, once, above them.
6. `h3` — **`Does an organiser ever have to write JSON?`** The binding "No. Organisers build
   questions and tests in a Pariksha UI…" paragraph, then `content-inventory.md` §5's pull quote
   verbatim. M-2 deleted; the right column's reasons compress to two sentences (hand-author,
   script, diff, export; nothing is locked in). CB-4 moves to B8.

### Weight targets

| Artefact | Target | Today | Rule |
| --- | ---: | ---: | --- |
| `dist/index.html` | **≤ 46 KB uncompressed** | 53.4 KB | **Superseded.** This file said 40 KB; the contract's §4.9 re-derived the band table from measured bytes, found it sums to 44,972, and set the gate at 46 KB with a named deletion order. |
| The island, minified | **≤ 10 KB** | — | D1, unchanged. One vanilla TS module from `/assets/`, no framework runtime, external (CSP `default-src 'self'`). |
| HTML + island + CSS | **≤ 80 KB** | 83.8 KB | CSS is 30,426 bytes today and this cull should shrink it: M-1's and M-2's mock rules and S9's ledger grid rules all go, against new rules for the demo's interactive states. Fonts excluded — self-hosted WOFF2, `font-display: swap`, unchanged. |
| Bands | **8 + footer** | 11 + footer | V2. |
| Code blocks | **4** — `CB-1a` (hero excerpt), CB-1 (B3 step 01), CB-2, CB-4 | 6 | **Superseded.** CB-3 and CB-5 deleted; CB-6 dissolves into one prose sentence, not a caption artefact; the hero carries a four-line excerpt of `LOG-001` and B3 step 01 carries `CB-1` entire (contract §3.8, §4.3, §9 conflict 4). |
| Rendered surfaces | **2** — the live demo, M-3 | 4 | **Superseded.** M-1 becomes the demo; M-2 **and M-4** are deleted — this file kept M-4, the contract deletes it (§4.1, §4.7). |
| FAQ pairs | **9** | 13 | §4. |

**Superseded by the contract's §4.9.** This file's overflow order spent the FAQ to pay for a hero
code block, and its second and third entries (Q14, Q6) are the only places AI is answered on the
page once S9's band goes. The binding order drains the bands that overran first — B2's verification
strip, then B5's interoperability strip, then FAQ Q13 — and puts Q14 and Q6 last.

### Invariants re-asserted, because a cull is where they get dropped by accident

Every item in D4 survives this cull unchanged, and three deserve naming because this cull touches
the files that carry them: **the sourcing rule** — every string the demo renders comes from
`examples/reasoning-aptitude/questions.json` and has a row in `content-inventory.md`, including any
second or third demo question; **`#status` and `#not-for` both still resolve** after the merge, so
no inbound or in-page link breaks; and **P6/P10** — the hero now contains an interactive grid at
the bleed, so "no body-level horizontal scrollbar at 320, 400 or 768" needs re-checking against the
demo's option rows and palette, not just the old mock's.
