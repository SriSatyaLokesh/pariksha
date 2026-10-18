# Prototypes

Three content prototypes for the landing page rewrite. **Open any `.html` file directly in a
browser** — no build, no server, no dependency. They share `proto.css`.

> These are **content and structure artefacts, not designs.** The styling is deliberately plain so
> that the argument, the ordering and the wording are what gets judged. The small grey rails above
> each band (`Band 4 · Pillar 1 — defeat the status quo · 180 words`) are annotations for the
> reviewer and do not ship.

| File | Variant | Bands | Lead with | Best for |
| --- | --- | --- | --- | --- |
| `a-executive-first.html` | **Executive-first** ★ recommended | 14 | Outcome + audience + price | The main homepage. Serves the organiser and the executive first, the engineer by a persistent rail |
| `b-open-source-first.html` | Open-source-first | 11 | Ownership, then the format thesis | A developer-weighted traffic mix — Hacker News, Reddit, a conference talk. Also the better fit if the project decides contributors matter more than future users before v0.1 |
| `c-story-first.html` | Story-first | 10 | The buyer's February, in scene | A campaign or SEO landing page for "free online exam software", "Google Forms alternative for exams". Shortest, most concrete, least technical |

---

## What is identical in all three

Because these are the findings, not the options:

1. **A primary CTA above the fold**, repeated at the close, same verb both times —
   *Start your question bank*.
2. **A signal strip directly under the hero** — licence, CI, coverage, counts. No adoption claims
   (none exist, and `content-inventory.md` §8 forbids printing them).
3. **Band headings that state a claim**, so a heading-only scan yields the whole argument.
4. **Integrity without surveillance as its own band.** It is the project's most defensible position
   and today it is a bullet inside "who this is not for".
5. **One status ledger** instead of status language scattered through the prose, paired with a
   *"what you can do today"* box that turns the admission into an offer.
6. **The filter compressed** from nine paragraphs to five table rows, placed late.
7. **No JSON above the fold.** Across 31 open-source homepages researched, not one put code in its
   hero (`../research-02-open-source.md` §1).

## What differs, and why

| | A | B | C |
| --- | --- | --- | --- |
| H1 | *Run real exams on the internet, for free, on infrastructure you own.* | *Exams you own — the code, the data, and the bill.* | *Three hundred candidates. Three hundred different papers. No bill.* |
| Hero device | Interactive pool draw — the organiser's side | None; the hero stays text, the terminal command lands in band 3 | None; the scene carries it |
| Audience order | Priya ▸ Meera ▸ Arjun | Arjun ▸ Meera ▸ Priya | Priya ▸ Meera |
| Format thesis | Implicit, in the status band | **Its own band, argued** | Implicit, in the "start before the software" box |
| Architecture | Absent (footer links) | **Its own band with the adapter diagram** | Absent |
| Privacy | Its own band | Merged into cost | Merged into cost |
| Contribution | One band near the end | **A band, and the variant's real conversion** | Footer only |
| Body copy | ~1,650 words | ~1,350 words | ~1,150 words |

---

## The one thing to decide before building any of them

**What counts as a conversion?** Everything else resolves from it. The recommendation in
`../06-positioning-and-strategy.md` §6 is:

- **Primary:** start a question bank (available today, honest, no infrastructure needed)
- **Secondary:** watch the repository for v0.1
- **Worth building:** a three-field, first-party intent form on the project's own domain — the only
  way the project will learn who its users are before v0.1, and the only one of the three that is
  measurable without breaking the no-telemetry promise.

## Known gaps in the prototypes

- The hero pool-draw demo in A is **static markup standing in for an interaction**. The real one
  should reuse the existing island pattern in `apps/web/src/island/` — progressive enhancement,
  works with JavaScript off, prerendered first state.
- FAQ bands are abbreviated. The nine existing answers ship verbatim; the five additions are in
  `../08-copy-bank.md` §11.
- No Anek or JetBrains Mono: the prototypes use system fonts so they open offline with no network
  request. The real page keeps the self-hosted subset fonts and the `default-src 'self'` policy.
- Every claim in these files traces to `.planning/landing/content-inventory.md`. Any new sentence
  added later must do the same.
