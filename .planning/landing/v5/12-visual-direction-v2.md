# Visual direction v2 — "Verdict"

| | |
| --- | --- |
| **Supersedes** | `11-visual-direction.md` Direction 1 (Question Paper). The diagnosis in §1 of that document still holds; the genre and the palette do not. |
| **Brief, as given** | Move off orange. Drop the section scaffolding. Better UI/UX. Fonts are not bound by `DESIGN.md`. |
| **Prototype** | `prototypes/e-verdict.html` |

---

## 1. What changed in the brief, and what it unlocks

### 1.1 Fonts are free — and that turns out to be cheap, not expensive

The reason `DESIGN.md` standardised on Anek was multi-script: Latin, Telugu and Devanagari on one
skeleton, so a translated test keeps its voice. That argument is about **the product**, not the
landing page.

Checked the actual font payload: `anek-telugu-wordmark-500.woff2` is **852 bytes** and
`anek-devanagari-wordmark-500.woff2` is **860 bytes** — they are already subsetted to the glyphs of
the word *Pariksha* and nothing else. The landing page needs Telugu and Devanagari for exactly two
words in the masthead.

**So the Latin face can be anything, for about 1.7 KB of Anek kept purely as a wordmark asset.** The
multi-script constraint that justified Anek everywhere does not bind the marketing page at all.

### 1.2 "No sections" — read as a composition instruction

Taken as: stop building the page out of identical stacked slabs with labels on them. The band
scaffolding of the current page and of Prototype D (`SEC 04 / 11`, OMR strip, uniform rules) is
structure made visible, and it makes a page feel like a specification no matter what the words say.

The content spine in `07-content-blueprint.md` does not change. **Its fourteen bands regroup into
seven movements of deliberately unequal size and rhythm** — some full-bleed, some asymmetric, one
that scrolls against a fixed panel. Nothing is deleted; the seams stop being drawn.

---

## 2. The colour decision

### 2.1 What the palette is not allowed to be

The product owns three semantic colours it uses in the app, in the results CSV and in every
integrity report: **clean** green, **review** amber, **high risk** red. A brand accent in any of
those families would collide with meaning the product already assigns — a green button next to a
green "pass" flag teaches the reader the wrong thing.

That rules out green, amber, gold, red and oxblood. Removing orange on top of that leaves blue,
teal, violet and neutral. Violet-to-blue gradients are the single most over-used look in current AI
and SaaS design, so that goes too.

### 2.2 The decision: no brand colour at all

**The page is monochrome. The only chromatic colours anywhere are the three verdict flags, and they
appear exactly once — in the results sheet.**

This is not an absence of a decision. It is the argument the page is making, rendered:

> Pariksha flags an attempt **clean**, **review** or **high risk** — and stops. A person decides what
> that means.

Making those three the only colours on an otherwise black-and-paper page means the single moment of
colour on the whole site *is* the moment the product refuses to pass judgement. The eye goes exactly
where the argument is. No competitor can copy it without also adopting the ethic.

It also answers the practical problem: a monochrome page with a high-contrast call to action is more
arresting than a mid-saturation accent, not less. A solid ink button on paper has a contrast ratio
near 17:1. An orange one had about 3.5:1.

### 2.3 Tokens

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `ground` | `#F1F1EF` | `#0B0C0E` | Page |
| `surface` | `#FFFFFF` | `#15171A` | Panels, tables, the few lifted objects |
| `ink` | `#0C0D0F` | `#F2F3F0` | Headlines, body, buttons |
| `ink-2` | `#55585E` | `#9DA1A6` | Secondary text |
| `ink-3` | `#8A8D92` | `#6E7278` | Captions, labels |
| `rule` | `#D9D9D5` | `#262A2E` | Hairlines |
| `rule-strong` | `#B9B9B4` | `#3A3F45` | Table heads, emphasis rules |
| `clean` | `#0D7A51` | `#4CBF93` | Verdict only |
| `review` | `#8A5F00` | `#D9A43A` | Verdict only |
| `risk` | `#B3261E` | `#F07A70` | Verdict only |

**Escape hatch, one token.** If a chromatic accent is wanted later, `--signal: #3D5AFE` switches on
in one place and applies to links and focus rings. The prototype ships it commented out. Do not
reach for it before seeing the monochrome version in a browser — it is far stronger than it sounds
in a document.

---

## 3. Typography

Free of `DESIGN.md`. One Latin family doing three jobs, one mono, one 1.7 KB wordmark asset.

| Role | Face | Setting |
| --- | --- | --- |
| Display | **Archivo** (variable: `wdth 62–125`, `wght 100–900`) | 700–800 weight, expanded width on the hero, `-0.04em`, line-height 0.9 |
| Body | **Archivo** | 400/500, 17–19 px, line-height 1.6 |
| Data, labels, code | **JetBrains Mono** | 500, `tabular-nums`, `0.1em` tracking uppercase for labels |
| Wordmark Indic | **Anek Telugu / Devanagari** | Kept exactly as subsetted today — 1.7 KB total |

**Why Archivo.** It is a grotesque with institutional bones — it reads as a standards body or a
transit system rather than a startup — and its **width axis** is the reason to pick it over Inter or
Public Sans: the hero can run genuinely expanded while body copy stays normal width, which gives the
page a display register it currently has no way to reach. One variable file covers every weight and
width, so the payload is one subset, not four.

**Alternative if more character is wanted:** Bricolage Grotesque 800 for display only, keeping
Archivo for body. Noted, not recommended — Archivo Expanded is already distinctive and one family is
cheaper and calmer.

Both are OFL and self-hostable, which the CSP requires. The prototype loads them from Google Fonts;
production subsets and self-hosts them exactly as it does today.

---

## 4. Composition — seven movements, no slabs

| # | Movement | Treatment | Carries blueprint bands |
| --- | --- | --- | --- |
| 1 | **Ink hero** | Full-bleed ink ground, paper type, display at `clamp(46px, 9.5vw, 132px)`, the live pool-draw inline | 1 |
| 2 | **Fact line** | One hairline rule carrying six mono facts. Not a card row | 2 |
| 3 | **The argument** | Asymmetric scroll: prose in the left column, a **mark sheet that assembles row by row in a sticky panel** on the right as you pass each claim | 3, 4, 5 |
| 4 | **The statement** | Full-bleed inverted ground, three lines set enormous: *No video. No audio. No verdicts.* Then the results sheet — the only colour on the page | 6 |
| 5 | **The ledger** | One wide comparison table as the visual centrepiece, plus cost as three giant numerals set inside a sentence | 8, 9 |
| 6 | **Where it stands** | Two-up asymmetric: live-vs-v0.1 toggle on one side, *what you can do today* on the other | 10, 11, 12 |
| 7 | **Close** | Ink ground again, one line, two actions | 13, 14 |

Rhythm is the point. Movements 1, 4 and 7 are full-bleed ink; 2 is a single rule; 3 is tall and
asymmetric; 5 is dense data; 6 is two unequal columns. Nothing repeats, so nothing reads as a
template.

---

## 5. Interaction — two, both load-bearing

The page is allowed exactly two interactions, and each must prove a claim rather than decorate.

1. **"Draw again"** in the hero. Press it and three candidates get three new papers from the same
   bank, in front of you. This is the product's central claim — *a form shows everyone the same
   paper; an exam should not* — demonstrated in about a second, by the real selection logic. It is
   the strongest two seconds the page has.
2. **"Live today / Lands with v0.1"** toggle on the capability list. Replaces per-item status tags
   with one honest control, and lets a visitor see exactly what exists without reading nine
   disclaimers.

Everything else is static. The page must be complete and readable with JavaScript off: the draw
renders a real first result server-side, the toggle defaults to showing both lists stacked.

Motion: 180–220 ms, `ease-out` entering, exits at ~65%. The mark sheet's rows fade in as they
assemble. `prefers-reduced-motion` turns all of it off and the page still reads, because nothing
starts invisible.

---

## 6. What this costs, and what it breaks

| | |
| --- | --- |
| **Fonts** | One Archivo variable subset (replacing the Anek Latin subset, ≈ 45 KB today) plus the two Indic wordmark files kept. Net change likely small; measure against the 300 KB budget before merging |
| **`DESIGN.md`** | Unchanged for the product. Add a `marketing` token group for the nine tokens in §2.3 — the generator already resolves references, so no change to `scripts/tokens.mjs`; extend `tokens.test.mjs` to cover the group |
| **The product** | Nothing. The runner and organiser screens keep every token they have. The inversion rule gains a third state: **marketing monochrome**, organiser canvas, candidate quiet |
| **Tests** | `landing.test.tsx` asserts the h1 verbatim — the headline change and this visual change land in one pull request |
| **Kalam** | The handwriting wordmark face is now redundant against an Archivo masthead. Recommend dropping it, 3.2 KB back |

### Checks before it ships

Body text 4.5:1 and large text 3:1 **in both themes** — monochrome makes this easy to pass and easy
to get lazy about, so measure. Focus rings 2 px, visible on ink and on paper. 375 px and landscape.
Reduced motion. Keyboard path through both interactions. No emoji anywhere. Verdict colours checked
against the same contrast bar as text, since they carry meaning.

---

## 7. Open question for the owner

The product's `voltage` vermilion survives in the app — the runner's focus ring, the question
palette's "you are here". **Is the brand still orange, with a monochrome marketing face in front of
it, or does the whole system go monochrome-plus-verdicts?**

Recommendation: let the marketing page run monochrome now and leave the app alone. If the
monochrome reads right in a browser, the app follows later — that is one pull request, not a
rebrand, because the app's chrome already uses tokens.
