# The comparison band: what it may claim, and how

| | |
| --- | --- |
| **Problem** | The current comparison band compares against *categories*, explains at length why it will not name products, and closes on a concession. It is the page's strongest argument, delivered apologetically. |
| **Constraint that produced it** | *"The project can defend format and scoring claims about itself but not performance claims about someone else's product"* (`S4Comparison.tsx`). This is a sound instinct applied too broadly. |
| **Recommendation** | Keep the rule for *performance*. Drop it for *published, dated, verifiable facts*. Name products in a separate, dated page — not the homepage band. |

---

## 1. The distinction the current rule misses

There are three kinds of claim about a competitor, and they carry completely different risk:

| Kind | Example | Defensible? | Where it may appear |
| --- | --- | --- | --- |
| **A — Performance claim** | "Pariksha is faster than Mettl" · "more accurate proctoring than Proctorio" | **No.** The repository holds no such measurement, and none can be made honestly | Nowhere |
| **B — Published-fact claim** | "Their published pricing is per candidate or per month, as of October 2026" · "they host candidate data on their own servers" | **Yes**, if dated, sourced to the vendor's own page, and re-checked | A dated comparison page; a footnoted homepage row |
| **C — Capability-gap claim about ourselves** | "A form tool cannot hide the answer key from the browser" | **Yes**, and it is really a claim about what Pariksha does | The homepage band |

The page currently treats B as if it were A. The FAQ, meanwhile, already makes B-type claims by
name — *"Mettl, HackerEarth, Testlify and Testportal, whose pricing, as published in October 2026,
is per candidate or per month"* — so the project has in practice already accepted the B standard.
**The homepage band and the FAQ are governed by two different rules today.** That is the actual
defect: not the caution, but the inconsistency.

---

## 2. The evidence standard to adopt

A competitor fact may be printed when **all four** hold:

1. It comes from the vendor's own public page, not a review site or a blog.
2. It is quoted or paraphrased without characterisation ("per-candidate pricing", not "expensive").
3. It carries the date it was read.
4. It is about **what the vendor publishes**, never about how well their product performs.

That is the standard journalism uses, it is cheap to re-verify, and it survives a hostile reader.

**Worth noting from the category research** (`research-01-exam-platforms.md`): most competitors do
not publish a price at all — Codility, CoderPad, iMocha, Talview, Mercer Mettl, HackerEarth and
Questionmark all gate pricing behind a sales conversation. "They will not tell you the price until
you talk to someone" is itself a B-type fact, it is true of most of the category, and it is a
sharper argument than any number Pariksha could quote.

---

## 3. The homepage band: three columns, claims not hedges

Keep the three-column shape. Change the framing, the row order and the ending.

| What you need | A form tool | A paid assessment platform | **Pariksha** |
| --- | --- | --- | --- |
| **Price per candidate** | None | Published per candidate or per month, where published at all | **None, and no Pariksha billing of any kind** |
| **Where candidate data lives** | Their servers | Their servers | **Your account — there is no Pariksha server in the path** |
| **A different paper per candidate** | No | Yes | **Pools, fixed sets A/B/C, and per-candidate shuffling** |
| **Question types** | Three or four | Varies by vendor | **Twelve, including matching, ordering and numeric with tolerance** |
| **Answer key hidden from the browser** | No | Yes | **Yes, enforced on the server** |
| **The clock** | The browser's | The server's | **The server's — late answers refused after 30 seconds** |
| **Video or audio recorded** | — | Varies by vendor | **Never. Snapshots only, face counting on-device** |
| **Who decides a candidate cheated** | — | Varies by vendor | **A person. Pariksha flags; it never concludes** |
| **If you want to leave** | Export a spreadsheet | Ask them | **One JSON file. Open format, CC BY 4.0** |
| **Read and change the code** | No | No | **Apache-2.0, with a patent grant** |

Four changes from today's table, each deliberate:

1. **Price and data residency move to rows one and two.** They are the two facts that decide the
   purchase, and they are currently rows one and five.
2. **Three rows are added** — the clock, recording, and who decides — because they are the project's
   strongest and least-copyable positions and the current table omits all three.
3. **"Where you leave" is a row.** Exit cost is the question the executive asks and the current
   table does not answer.
4. **"Varies by vendor" is used honestly** rather than avoided. It is accurate, it is not a
   characterisation, and it quietly makes the point that the category is inconsistent while Pariksha
   is not.

### 3.1 How the band should end

Today it ends on *"a paid platform you can buy today will do more than Pariksha does today."*
That sentence is true and must stay on the page. **Move it to the status ledger**, where the reader
is already being told what is and is not built, and end the comparison band on the row that only
Pariksha can occupy:

> Nothing here is a benchmark. Every row above is either what Pariksha does, or what the other two
> categories publish about themselves, read in October 2026.

One line, dated, no methodology essay.

---

## 4. The Moodle problem

Moodle is the only real open-source comparable, it is more capable today, and the PRD says so in its
own words. Three options:

| Option | Effect | Verdict |
| --- | --- | --- |
| Omit Moodle | Looks evasive to anyone who knows the space — and they are exactly the people who would adopt | **No** |
| Current approach: a paragraph conceding Moodle is more capable, inside the comparison band | Honest, but spends the band's closing position on a competitor's strength | **No** |
| A dated footnote under the table plus a fuller answer in the FAQ | Honest, findable, and does not surrender the band | **Yes** |

Suggested footnote, derived from the PRD's own sentence:

> **Moodle** is the nearest open-source comparison and is more capable today. Pariksha is not trying
> to replace it: it is trying to be lighter to run, and to keep the whole test in one portable file.
> *(PRD `:38`)*

That is a positioning statement, not a concession. It tells the reader which tool to pick and why,
which is what a comparison is for.

---

## 5. A separate, dated "alternatives" page — recommended, not urgent

The homepage band should stay category-level. A **separate page** can name products under the §2
standard and do three jobs the homepage cannot:

1. **Capture search demand.** "Mettl alternative", "HackerEarth alternative", "open source Google
   Forms for exams", "self-hosted exam software" are the queries this product's buyers actually
   type. The category's own pages (`research-02-open-source.md` covers how Plausible and Cal.com do
   this) show comparison pages are among the highest-converting assets an open-source project owns.
2. **Answer the executive's shortlist question** without a sales call — which matters because 80%
   of the B2B buying journey now happens before any vendor contact
   (`research-03-saas-standards.md` §7).
3. **Contain the risk.** One page, one date stamp, one review cadence, clearly marked as read-on-a-
   date rather than maintained-continuously.

**Decision required from the owner, flagged not assumed:** naming competitors is a business and
legal posture, not a copy choice. The recommendation here is to do it on a dated separate page under
the §2 standard, and to keep the homepage band category-level either way.

---

## 6. What this band must never do

- Claim any speed, accuracy or reliability figure about another product.
- Characterise a competitor ("expensive", "invasive", "clunky") rather than quote them.
- Print an undated competitor fact.
- Compare against a vendor the project has not actually read the page of.
- End on a concession.
