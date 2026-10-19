# Visual direction: why the page looks like documentation, and three ways out

| | |
| --- | --- |
| **Question asked** | The landing page's look is basic and code-like. How do we get something more arresting, without being bound by `DESIGN.md` as it stands? |
| **Scope** | Visual direction only. The content spine is `07-content-blueprint.md`; nothing here changes what the page says. |
| **Constraint that is not negotiable** | Self-hosted fonts, `default-src 'self'`, no third-party scripts, 300 KB gzip budget (75.7 KB used). Any direction that needs a font CDN or a motion library is dead on arrival. |

---

## 1. Diagnosis — it is not the design system, it is three settings inside it

`DESIGN.md` is a competent system. Vermilion on cream, Anek across three scripts, JetBrains Mono
for data, a documented inversion rule (marketing is voltage-on-canvas; the running exam goes quiet).
That is a real point of view, and almost none of it is the reason the page looks like a README.

Four specific things are:

### 1.1 There is no bold weight in the building

`apps/web/public/fonts/anek-latin-latin-400-500.woff2` ships **weights 400–500 only**. `DESIGN.md`'s
`display-xl` is therefore 56 px at **weight 500**. A 56 px headline at medium weight, set in a
humanist sans, on cream, cannot command a screen — there is no mass anywhere on the page. Every
other symptom follows from this one.

**It is nearly free to fix.** Anek Latin is a variable font: re-subsetting the same glyph set across
`300 800` instead of `400 500` adds single-digit kilobytes, because the weight axis lives inside the
file already. One re-subset and one `font-weight` range change in `fonts.css` unlock the entire
display register.

### 1.2 The type scale tops out where a hero should start

56 px is a *section heading* on a 2026 marketing page. Heroes in this category run 80–120 px on
desktop. The page has no size contrast: 56 → 44 → 22 → 17 is a gentle ramp, and a gentle ramp reads
as a document.

### 1.3 Every object on the page is the same object

Hairline box, 6 px radius, white fill. Comparison table, cost table, feature card, code block,
status card — all the same treatment. Nothing is lifted, so nothing is important. The design system
has 43 components; the landing page uses about five of them, all at the same visual weight.

### 1.4 There is no imagery, and nothing was put in its place

This is the real design problem, and it is structural rather than aesthetic: **the product does not
exist, so there are no screenshots, and there will be none before v0.1.** Every competitor page in
the research leans on product shots, device frames or customer logos. Pariksha has none of the
three, and the current page responds by simply having no visual anchor at all.

> **The brief, properly stated:** design a landing page whose visual interest comes from type,
> grid, colour and data objects — because there is no photography to carry it, and inventing fake
> product screenshots would break the project's own truth rule.

---

## 2. What any direction must keep

Not preferences — these have consequences elsewhere in the codebase.

| Keep | Why |
| --- | --- |
| **Anek for Telugu and Devanagari** | It is the only widely-available family shipping Latin, Telugu and Devanagari on one skeleton. The wordmark is trilingual and translations ship at v1.0. Dropping it breaks both. |
| **Self-hosted, subsetted fonts** | `default-src 'self'` is a live promise the page makes about itself. A Google Fonts link would make the privacy band a lie. |
| **JetBrains Mono for data, labels and code** | Correct role assignment, already subsetted, and the new directions lean on it harder, not less. |
| **The inversion rule** | Marketing loud, running exam quiet. It is the system's best idea and it stays. |
| **The flag colour family** (`clean` / `review` / `high_risk`) | Semantic, used in product and in results exports. Not brand colour; do not restyle. |
| **Token architecture** | `DESIGN.md` front matter generates `tokens.css` and `tokens.ts` through `scripts/tokens.mjs`. New colours must enter as tokens, not as literals in a stylesheet. |

---

## 3. Three directions

Each is a different genre, not a different palette. Pick a genre first; the tokens fall out of it.

### Direction 1 — **Question Paper** ★ recommended

**Thesis.** The artefact this product produces is a *paper*. Borrow the visual grammar of a real
exam paper and answer sheet — ruled grids, section headers, a candidate number in the corner, marks
written in the margin, OMR bubbles — and translate it into a modern layout rather than imitating it.

**Why it is right for this product.** It is instantly legible to the exact buyer (anyone who has run
or sat an exam in India recognises an OMR sheet at a glance), it is *made of* the things the page
already contains — tables, numbers, status flags, sequences — so the content and the ornament are
the same material, and no competitor in the research is anywhere near it. It also solves §1.4: the
page's visual anchor becomes the mark sheet and the ruled grid, both of which are real artefacts the
project already owns.

**Devices**

- A **visible 12-column grid**: hairline verticals, like a worksheet, at low contrast.
- **Section markers in the left margin** — `SEC 04 / 11` in mono. This encodes something true (the
  spine is a sequence), which is the test for whether a numbering device has earned its place.
- **Marks in the margin**: the band's key number set in examiner red, hanging in the right margin,
  the way marks are written beside an answer.
- **An OMR bubble strip** as the scroll/section indicator: eleven bubbles, filling as you pass each
  band. One decorative device, drawn in CSS, true to the subject, respects `prefers-reduced-motion`.
- **Mark-sheet tables**: ruled rows, tabular figures, no card chrome. The comparison table, the
  free-tier arithmetic and the results CSV all become the same recognisable object — which is good,
  because they are the page's three strongest exhibits.

**Rules that keep it from being twee.** No paper texture. No drop shadows pretending to be sheets.
No handwriting face anywhere except the existing Kalam wordmark. No torn edges, no staples, no
clipboard. The reference is *structure*, never *skeuomorphism*.

### Direction 2 — **Control Room**

**Thesis.** The buyer's real fear is test day. Design the page as the live monitor: dark operational
ground, dense data strips, status chips, counters, telemetry set in mono. Voltage spent once.

**Strength.** It dramatises proctoring, scale and results better than anything else, and it reads as
serious engineering to a CTO.

**Why it is not the main page.** Dark + monospace + dense is exactly the register that produced the
complaint in the first place. It would deepen the code-like problem for the placement officer who is
the primary audience. **Recommended use:** the eventual proctoring or live-monitor sub-page, and the
data objects *inside* Direction 1's integrity and results bands.

### Direction 3 — **Institutional Modern**

**Thesis.** Look like something that survives a procurement file. High-contrast editorial: a deep
authority ground (ink navy or a dark green), generous white, heavy rules, one warm accent, very
large type, almost no ornament. University press, modernised.

**Strength.** Maximum credibility with the executive, ages well, needs no imagery.

**Weakness.** It is the safe answer, and safe here means forgettable — this is roughly where every
"Trust & Authority" template lands, and it would trade a code-like page for a corporate one. Keep
its typographic discipline; do not take its genre.

---

## 4. The recommendation

**Direction 1 for the identity. Direction 3's typographic discipline. Direction 2's data objects,
used only where the page is actually showing data.**

That is one system, not a blend: *paper on the outside, instrument panel where the numbers live.*

---

## 5. Token specification — Question Paper

Proposed as an **additive marketing layer**, not a rewrite. `DESIGN.md` keeps every token it has;
these are new names the app never uses. Blast radius stays at the marketing pages.

### 5.1 Colour

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `paper` | `#ECEDE7` | `#15181A` | Page ground. Cool grey-green in light — an answer booklet, not a warm editorial cream |
| `paper-raised` | `#F6F7F3` | `#1D2124` | Tables, panels, the few lifted objects |
| `ink` | `#14171A` | `#E9EBE4` | Body and headlines. Blue-black, like pen ink, never pure `#000` |
| `ink-soft` | `#474D52` | `#AEB4AC` | Secondary text |
| `rule` | `#D2D6CC` | `#2E3337` | The ruled grid, table rows, dividers |
| `rule-strong` | `#B9BFB2` | `#3E444A` | Section rules, table heads |
| `red-pen` | `#D23B1E` | `#F2673D` | The one accent. Marks, primary action, section markers |
| `graphite` | `#2C3A47` | `#7E95A8` | OMR bubbles, the grid's own marks |
| `flag-clean` / `flag-review` / `flag-risk` | unchanged from `DESIGN.md` | — | Semantic, shared with the product |

Two notes on the palette. **`red-pen` is a deliberate shift of the existing voltage `#e24c18`**, two
steps deeper and less orange: close enough that this reads as the same brand, different enough that
it reads as an examiner's pen rather than a startup orange. And **the dark theme is a blackboard**
— slate ground, chalk text, red kept — which is the same metaphor inverted, so both themes mean
something rather than one being a tint of the other.

### 5.2 Type

**No new font family.** The fix is weight and scale, both already inside Anek.

| Role | Face | Size | Weight | Tracking |
| --- | --- | --- | --- | --- |
| `hero` | Anek Latin | `clamp(44px, 9vw, 104px)` | **800** | `-0.035em` |
| `band` | Anek Latin | `clamp(28px, 4vw, 46px)` | **700** | `-0.025em` |
| `sub` | Anek Latin | 21–23px | 400 | `0` |
| `body` | Anek Latin | 17px / 1.6 | 400 | `0` |
| `marks` | JetBrains Mono | 15–72px | 600 | `-0.02em`, `tabular-nums` |
| `label` | JetBrains Mono | 11px | 500 | `0.12em`, uppercase |
| wordmark | Kalam | unchanged | 700 | — |

Required change, one line each:

```css
/* fonts.css — re-subset the same glyphs across the full weight axis */
@font-face {
  font-family: "Anek Latin";
  src: url("/fonts/anek-latin-latin-300-800.woff2") format("woff2");
  font-weight: 300 800;   /* was 400 500 */
  ...
}
```

Measure the new file before committing; the expectation is a few kilobytes against a 300 KB budget
with 75.7 KB used, but it is a measurement, not a promise.

### 5.3 Layout

- 12 columns, 1180 px maximum, 24 px gutters, **hairline column rules visible** at `rule` contrast.
- Prose measure 62–68 characters — narrower than the grid, hung on columns 2–8, with the right
  margin left free for marks. Asymmetry is the point; a centred column is what the page does now.
- Spacing on a 8 px base; band rhythm 96 / 128 / 160.
- Radius **2 px**, not 6. Paper does not have rounded corners, and the current radius is a large
  part of why everything reads as the same soft card.
- Elevation spent **three times on the whole page**: the hero demo, the results mark sheet, the
  "what you can do today" box. Everything else is ruled, not boxed.

### 5.4 Motion

- Micro-interactions 150–220 ms, `ease-out` in, `ease-in` out, exits at ~65% of entrance.
- The OMR strip fills on scroll; list items stagger 40 ms. Nothing else moves.
- `prefers-reduced-motion: reduce` disables the strip's fill animation and all staggering, and the
  page must be complete and readable at rest — which it is, because nothing starts at `opacity: 0`.

---

## 6. How to land it without destabilising the design system

1. **Re-subset Anek Latin to `300 800`** and update `fonts.css`. One file, one range. Measure the
   delta in CI against the bundle budget.
2. **Add a `marketing` block to `DESIGN.md` front matter** with the colour and type tokens above.
   `scripts/tokens.mjs` already resolves `{colors.*}` and `{typography.*}` references, so the new
   names generate into `tokens.css` and `tokens.ts` with no change to the generator — check that
   `tokens.test.mjs` still passes, and extend it to cover the new group.
3. **Scope the new layer to the landing route.** The runner and the organiser screens keep today's
   tokens exactly. The inversion rule now has three states rather than two: marketing paper,
   organiser canvas, candidate quiet.
4. **Rebuild the landing stylesheet against the new tokens.** `landing.css` and the
   `sections-*.css` files are where the work lands; the component primitives mostly survive.
5. **Re-run the checks**: contrast 4.5:1 for body and 3:1 for large text in *both* themes, focus
   rings visible at 2 px, 375 px and landscape, reduced-motion, and the existing landing tests —
   note that `landing.test.tsx` asserts the h1 string verbatim, so the headline change in
   `08-copy-bank.md` and this visual change should land in the same pull request.

---

## 7. Risks, stated plainly

| Risk | Mitigation |
| --- | --- |
| The paper metaphor goes twee | The §3 rules: structure only, never skeuomorphism. If a device cannot be drawn with a rule, a bubble or a number, it does not ship |
| Two grounds (paper, canvas) confuse the system | They are scoped by route and documented as a third inversion state, not left to taste |
| A heavier Anek subset breaks the performance budget | Measure before merging; CI already gates the gzip budget |
| `red-pen` versus existing `voltage` creates two brand reds | Pick one. Recommendation: move `voltage` itself to `#D23B1E` and keep a single accent across product and marketing |
| The OMR strip reads as decoration | It is a scroll position indicator with eleven real positions. If it ever stops mapping to the spine, delete it |

---

## 8. The prototype

`prototypes/d-question-paper.html` applies this direction to the recommended content spine — hero,
signal strip, problem, the anti-form pillar, integrity with the mark sheet, cost, and the close.
Open it beside `a-executive-first.html`: same words, same structure, different genre. That is the
comparison worth making, because it isolates the visual decision from the content one.
