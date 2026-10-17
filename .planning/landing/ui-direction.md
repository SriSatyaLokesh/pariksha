# Landing page v2 — UI and UX direction

Scope: how the rebuilt `apps/web/src/routes/landing.tsx` looks and behaves. Content wording,
copy and SEO text are another agent's assignment; this document decides form, order, surface,
contrast, motion and components. Every value below resolves to a token already in
`apps/web/src/styles/tokens.css`. No new palette, no new typeface, no new radius tier.

Source of truth: `DESIGN.md`. Where this document extends it, the extension is named in an
**Extension** note with its reason, so a reviewer can reject it in one line rather than argue
about the whole page.

---

## 0. The three rules everything below obeys

1. **Nothing under 24px may set cream on the voltage canvas.** `DESIGN.md` sanctions
   cream `#fffbf5` on voltage `#e24c18` at 3.86:1 — legal only at 24px and above. Every small
   element that must appear on a voltage band therefore stands on its own cream or white
   plane, where ink reads at 15.85:1. This single rule generates most of the hero's form.
2. **Depth is surface contrast, not shadow.** Cream over voltage, white over cream, hairline
   rules. Exactly two shadowed objects exist in the system and only one of them appears on
   this page: `button-primary`.
3. **Motion is a product claim.** The runner animates nothing because a candidate is under a
   clock. A marketing page that fades, slides and counts up while saying so is arguing against
   itself. Ambition is carried by scale, field, measure and rendered product surfaces.

---

## 1. The hero

### 1.1 What the hero has to do

Four jobs at once: name the product, say what category it is in, prove the product is real
despite being pre-alpha, and send the reader to the worked example. The current hero does two
of them, and it leaks the third — the `pre-alpha` caption sits in a separate band below the
voltage because 12px cream on voltage is illegal. That caption comes back into the hero by
standing on cream, rather than by shrinking the claim.

### 1.2 Structure

A two-column asymmetric canvas on the full-bleed voltage band, `96px` block padding
(`--space-5xl`), `24px` inline (`--space-xl`), square corners, inside the 1080px wrap.

```
+-- voltage, full bleed -------------------------------------------+
|                                                                  |
|  +- cream chip ----------+          +- cream plane ------------+ |
|  | PRE-ALPHA · APACHE-2.0|          | Section 2 of 3     08:41 | |
|  +-----------------------+          +--------------------------+ |
|                                     | Question 6 of 12    2 pts| |
|  Pariksha runs real                 |                          | |
|  exams on infrastructure            | What comes next in       | |
|  you own.                           | the series?              | |
|                                     |   3, 7, 15, 31, 63, ?    | |
|  An open-source exam platform       |                          | |
|  you deploy yourself — question     | ( ) 95                   | |
|  pools, twelve question types,      | (o) 127   <- voltage      | |
|  proctoring and CSV results.        | ( ) 117      border      | |
|                                     | ( ) 131                  | |
|  ( See a real test -> )  Read the   +--------------------------+ |
|    cream pill            code       | 1 2 3 4 5 6 7 8 · locked | |
|                          24px link  | Saved 2 seconds ago      | |
|                                     +--------------------------+ |
+------------------------------------------------------------------+
```

Left column `7fr`, right column `5fr`, `--space-3xl` (40px) gap, `align-items: start`.
At the 1080px wrap that gives the type column roughly a 600px measure — four or five words
per line at 56px, which is the magazine-dek register `DESIGN.md` asks for, not a SaaS banner.

### 1.3 Order and treatment, top to bottom

| # | Element | Token | Surface | Contrast |
|---|---------|-------|---------|----------|
| 1 | Status chip | `mono-sm` ink | cream fill, `--rounded-md`, `8px 12px` padding, no border | 15.85:1 |
| 2 | `h1` | `display-xl` cream, clamped as today | voltage | 3.86:1, legal at 56px |
| 3 | Lead sentence | `hero-lead` (24px) cream | voltage | 3.86:1, legal at 24px |
| 4 | Primary CTA | `button-primary` | cream pill, ink label, the page's one shadow | 15.85:1 |
| 5 | Secondary link | `hero-lead` (24px) cream, 1px cream underline | voltage | 3.86:1, legal at 24px |
| 6 | Runner surface | see §3.3 | cream plane | ink on cream throughout |

Gaps: chip to `h1` `--space-xl` (24), `h1` to lead `--space-xl`, lead to CTA row `--space-2xl`
(32), CTA row items `--space-xl` apart on a `flex-wrap` row with `align-items: center`.

### 1.4 What the product name does

**The name lives in the `h1`, as its first word.** Not a wordmark lockup over the headline,
not a 56px standalone "Pariksha" with the proposition beneath it.

Three reasons. A cream wordmark on voltage would have to be set at 24px or larger to be legal,
which makes it compete with the headline rather than introduce it. The nav already carries the
wordmark lockup with the Telugu and Devanagari sublabel (`TopNav`), and the footer closes with
the same gloss — a third instance in between makes the page feel like it is introducing itself
twice. And an `h1` that opens with the product name and continues with the category verb is the
single highest-value string on the page for answer engines: asked "what is Pariksha", a crawler
finds a complete sentence rather than a brand word and a separate tagline.

The Telugu and Devanagari sublabel stays where it is — nav and footer. It is a signature, not a
hero element, and a third repetition devalues it.

**Extension:** the status chip. `DESIGN.md`'s `hero-section` "holds the h1 in cream, one lead
sentence and the CTA — nothing else". The chip is a fourth element. Reason: the pre-alpha
disclosure is a stated requirement and currently sits in an orphan band below the voltage,
which reads as a correction rather than as a stance. On its own cream plane it is legal at 12px
and it opens the page with the honesty the project trades on. It is one object, 28px tall, and
it does not touch the headline measure.

### 1.5 The primary and the secondary

**Primary: the worked example.** The product does not ship yet; the highest-value thing a
reader can do is read one real test end to end. The CTA points at
`examples/reasoning-aptitude/` and says so.

**Secondary: the repository.** For a pre-alpha open-source project the compounding action is
the repo, not a document.

The secondary is a 24px cream text link with a cream underline, not a second button. Two filled
objects on the voltage canvas flattens the hierarchy, and any bordered or ghosted button would
need a label under 24px in cream, which is illegal. One filled, shadowed pill and one underlined
sentence is an unambiguous pair.

*Fallback if the 24px link reads too loud in build:* make the secondary a cream-filled
`--rounded-md` rectangle with an ink label. Shape then carries the hierarchy — the pill means
"press this" and stays scarce — and the shadow stays on the primary only. Do not reach for a
cream outline.

### 1.6 The visual device

**The product's own test screen, rendered in real tokens, standing as a cream plane on the
voltage field.** No photograph, no illustration, no abstract shape, no gradient.

This is the strongest device available and it is nearly free. The runner is already cream and
ink and hairline-ruled; the marketing canvas is already voltage. Putting the runner onto the
voltage band stages the system's central inversion in one picture — this is the surface, and
that is what replaces it the moment the clock starts. It also answers the pre-alpha problem
without claiming anything: the reader sees the screen the project has designed, rendered by the
same CSS that will render the real one.

Rules for it in §3.3: true token sizes, no `transform: scale`, no live clock, no motion, content
lifted verbatim from `examples/reasoning-aptitude`.

### 1.7 Responsive

- **>= 1024px:** two columns as above.
- **768–1023px:** single column, type block first, runner surface below at the full 720px hero
  measure. `DESIGN.md`'s "hero content centres at 720px" is the narrow case.
- **< 768px:** single column, `h1` clamps to its existing `clamp(2rem, ...)` floor, the lead
  stays at 24px (it is the smallest legal size on voltage and must not shrink), the chip wraps,
  CTA and secondary stack with `--space-lg` between them.
- **400px:** wrap padding 16px leaves 368px. The runner surface goes full width; its option rows
  keep a 48px minimum height; its palette squares stay 36px and wrap.

---

## 2. Section rhythm

### 2.1 The spine

Teach first, weighted; argue in one designed block after the teaching has done its work; close
on the cost claim and the roadmap. Fifteen bands including hero and footer.

| # | Section | Surface | Density | Block padding | Role |
|---|---------|---------|---------|---------------|------|
| 1 | Hero | **voltage** | generous | 96 | Name, claim, proof, CTA |
| 2 | How running an exam works — the four-step ledger | cream | **dense** | 96 | The teach spine; all four code artefacts |
| 3 | You never write any of that | cream + white card | medium | 64 | The no-code pivot |
| 4 | Twelve question types | white cells on cream | dense, low ink | 64 | Catalogue; structural rest |
| 5 | A different paper for every candidate | cream | medium | 64 | Pools, sets, shuffling |
| 6 | Proctoring: Off, Standard, Strict | white cards | medium | 64 | Escalation, then flags-not-verdicts |
| 7 | What comes out | cream | dense | 64 | Results CSV block + real results table |
| 8 | What it costs | **card-voltage** + card-hairline | generous | 96 | Bridge from teach to argue |
| 9 | Why not a form tool, why not a vendor | white | dense | 96 | The comparison object |
| 10 | Your data stays in your account | cream | **sparse** | 64 | **Rest point** — four sentences, no cards |
| 11 | Two ways to run it | white cards | medium | 64 | Deploy cards + deploy code block |
| 12 | The formats are open | cream | medium | 64 | Schema contract, validator command |
| 13 | What is built, what is not | cream | medium | 96 | Roadmap; BYOK labelled unbuilt |
| 14 | Closing | **voltage** | generous | 96 | One sentence, one pill |
| 15 | Footer | white | dense | 64 / 24 | As today |

### 2.2 Alternation

Voltage appears **exactly three times**: the hero, one `card-voltage` at §8, and the closing
band. Three instances across fifteen bands keeps the colour singular. Bookending with one
interior accent is deliberate — the reader meets the canvas, forgets it through seven cream and
white sections, and meets it again at the decision point.

**Extension:** a second full-bleed `hero-section` as the closing band. `DESIGN.md` sanctions the
component on "the landing page, the test start page and the finish page" without saying once per
page; `card-voltage`'s explicit "one per page, at most" is respected, because the closing band is
a `hero-section`, not a card. Its headline sets at `display-lg` (44px), not `display-xl`, so the
hero keeps the page's largest type to itself.

The governing rule for everything between: **no two consecutive bands share both surface and
density.** Cream after cream is permitted when the density flips (dense ledger into sparse
privacy band); dense after dense is permitted when the surface flips (white comparison into
cream formats). Both the same twice running is what makes a long page read as one undivided
scroll.

### 2.3 Vertical escalation

Three tiers only, all from existing tokens:

- `--space-4xl` (64px) block padding — the default, `DESIGN.md`'s section rhythm.
- `--space-5xl` (96px) block padding — **chapter openings**: the ledger, the cost band, the
  comparison, the roadmap, and both voltage bands.
- Heading-to-content gap: `--space-2xl` (32px) in dense sections, `--space-3xl` (40px) in chapter
  sections. The heading breathing more is what signals a chapter, without a larger type size.

Dividers: a 1px `--color-hairline` top rule on each section, as today — **except** where the
surface colour changes. A hairline against a voltage edge is noise; the colour change is the
divider. So the bands above and below each voltage band carry no rule on that side.

### 2.4 Where the eye rests

Three deliberate rests, roughly evenly spaced:

1. **The status chip line under the hero's headline block** — one short line of mono after the
   largest type on the page.
2. **§4, the twelve types** — high structure, low ink. A grid of short cells after two
   artefact-heavy sections is a visual exhale even though it is dense.
3. **§10, privacy** — four sentences, no cards, no rules, no code, generous leading. The one band
   on the page with nothing to parse. It sits immediately after the comparison, which is the
   page's highest-effort reading.

---

## 3. Code blocks and rendered surfaces

### 3.1 The code block as an object

Not a bare `<pre>`. A three-part object:

```
+- caption bar — cream fill, mono-sm muted -------------+
| examples/reasoning-aptitude/questions.json            |
+- block — canvas white, mono-md ink -------------------+
| {                                                     |
|   "id": "QNT-001",                                    |
|   "type": "numeric",                                  |
|   ...                                                 |
+- footer line — cream fill, mono-sm muted -------------+
| ... 16 more questions · read the whole file ->        |
+-------------------------------------------------------+
```

| Part | Fill | Text | Border | Radius |
|------|------|------|--------|--------|
| Caption bar | `--color-cream` | `mono-sm` `--color-muted` | shares the block's | top corners `--rounded-md` |
| Block | `--color-canvas` | `mono-md` (15px/24) `--color-ink` | 1px `--color-hairline-strong` | — |
| Footer line | `--color-cream` | `mono-sm` `--color-muted` | shares the block's | bottom corners `--rounded-md` |

`--color-hairline-strong`, not `--color-hairline`: a code block's edge is a boundary the reader
must perceive, and `DESIGN.md` assigns that duty to the strong tone. Radius `md` (6px), not
`lg` — `lg` is for cards; a code block sits with answer rows and banners.

The caption bar is not decoration. It names the file, which tells a reader what they are looking
at and tells a crawler what the block is. Every block on the page carries one.

### 3.2 Syntax colour

`DESIGN.md` specifies no syntax palette, so this is the minimum legal set drawn entirely from
existing tokens. **Four roles, no more, no new hex:**

| Role | Token | On white |
|------|-------|----------|
| Property names, identifiers | `--color-ink` | >= 15.85:1 |
| String values | `--color-voltage-deep` | >= 5.66:1 — the only voltage permitted as running text |
| Numbers, booleans, null | `--color-data-blue` | >= 4.81:1 |
| Braces, brackets, commas, colons | `--color-muted` | >= 5.18:1 |

Comments in shell blocks also take `--color-muted`. No green, no highlight backgrounds, no line
numbers (they add noise and break copy-paste), no diff markers.

Colour here is typographic texture, not meaning — a greyscale reading loses nothing, because the
JSON structure is carried by indentation and punctuation. That is why four roles is enough and
why none of them needs a second carrier.

Implementation note: the samples are static, so the spans are written by hand at author time. Do
not add a highlighting dependency — it would also breach the no-third-party-scripts rule the page
advertises.

### 3.3 Code and surfaces on the voltage canvas

**One rule: any text under 24px on the voltage canvas stands on its own cream or white plane.**

So on a voltage band a code block is a cream-filled plane (`--color-cream`), ink text, **no
border** — the cream-against-voltage edge is the strongest boundary on the page and a hairline
would weaken it — `--rounded-md`, `--space-xl` padding. Its caption inverts: on voltage the
caption sits *above* the plane as `hero-lead`-sized cream text at 24px, or is dropped entirely.
It must never be 12px cream on voltage.

The runner surface in the hero follows the same rule and needs no special casing, because the
runner is already cream and ink: a `--color-cream` plane, `--rounded-lg` (8px, it is a card),
`--space-xl` padding, internal rules in `--color-hairline-strong`, every piece of text ink or
muted on cream. Inside it:

- Section line and timers: `mono-sm` muted label, `timer-numeric` ink with tabular figures.
- Question stem: `question-stem` (18px/29), the loosest leading in the system.
- Option rows: `option-label`, white fill, 1px `--color-hairline-strong`, 6px radius, 48px
  minimum height; the selected row takes cream fill, a 2px `--color-voltage` border **and** the
  filled control — two carriers, per `DESIGN.md`.
- Palette strip: 36px squares, `mono-sm`, showing all four states, so the state palette appears
  once on the page in its real form — answered filled, marked filled with its corner notch,
  current outlined in voltage with `--color-voltage-deep` figures, locked with its glyph.
- Save status: `mono-sm` muted, "Saved 2 seconds ago".

Hard constraints on every mock:

1. **True token sizes.** No `transform: scale()`. Scaled type blurs, breaks zoom, and lies about
   the product's real proportions. If it does not fit, crop it — let the surface bleed past the
   wrap's right edge toward the viewport edge, so it reads as a window onto a larger screen.
   Cropping is a design decision; scaling is an accident.
2. **No live clock, no motion, nothing interactive.** The timer is a static string. A ticking
   timer in a hero would be the one animated element on a page whose product animates nothing.
3. **Accessibility:** `aria-hidden="true"` on the mock, plus an adjacent `visually-hidden`
   paragraph describing it in one sentence. The mock's content is fictional; a screen-reader user
   hearing a fake question, four fake options and a fake timer gets noise, while the description
   gives them exactly what a sighted reader takes from it.
4. **Content comes from `examples/reasoning-aptitude`**, verbatim — the same series question the
   README already draws. The repository then tells one story in one voice.

### 3.4 On light surfaces

On a cream band a code block takes the white fill and the hairline-strong border of §3.1 — white
over cream is the body's own depth move. Inside a white card, invert it: cream fill, hairline
border, so the block still separates from its container.

The builder mock in §3 (the no-code section) is a white plane on cream with a 1px
`--color-hairline` border, holding real components at real sizes: `category-tab` pills for the
question-type picker, `field-label` plus `text-input` for the stem, option rows with their remove
controls, a numeric points field. Same four constraints as the runner mock.

### 3.5 Overflow

Horizontal: `overflow-x: auto` on the block element, `white-space: pre`, never wrap JSON —
wrapped JSON is unreadable and misrepresents the format. The code block is one of three things on
this page permitted to be wider than the body measure (the others: the comparison table and the
runner mock). **The page body never scrolls horizontally at any width.**

Vertical: no `max-height`, no inner scrollbar. Trim each sample editorially to 12–18 lines and let
the footer line say what was cut and link the whole file. A scrollable code block hides content
from a reader skimming at speed and gains nothing once the page is prerendered.

Deferred: a copy-to-clipboard button. It needs a 44px target, a live region for "Copied", and
client JavaScript on a page that otherwise needs none. Add it when someone asks.

---

## 4. The comparison table

Three categories, seven rows, and the whole job is making the third column win without shouting.
It stays a real `<table>` with a `<caption>` and `scope` attributes — both because screen readers
need it and because answer engines parse tables well, which is half the reason the section exists.

### 4.1 Desktop

```
                      Free form tools   Assessment platforms  || Pariksha  ||
 --------------------------------------------------------------------------- 
 Cost                 Free              Per candidate,        || Free      ||
                                        per month             ||           ||
 --------------------------------------------------------------------------- 
 Question pools       No                Yes                   || Yes       ||
 --------------------------------------------------------------------------- 
 Rich question types  3–4               Yes                   || 12        ||
 ---------------------------------------------------------------------------
                                                    cream fill, full height
```

- **Column 1** (`<th scope="row">`): `body-sm` ink, left aligned, `1fr` — the widest column.
- **Columns 2 and 3:** `mono-sm` (12px) in `--color-muted`, 5.18:1, fixed equal widths.
- **Column 4, Pariksha:** `body-sm` (14px) in `--color-ink`, >= 15.85:1, on a continuous
  `--color-cream` fill running the table's full height, with 1px `--color-hairline-strong` rules
  on its left and right edges. Its header cell sets the name at `heading-sm` ink.

That is the whole device: **the argument is made typographically, not chromatically.** The
Pariksha column's facts are larger, darker and set in the reading face; the alternatives' are
smaller, greyer and set in the instrument face. The eye reads the dark column first and registers
the other two as footnotes to it, without a single tick, cross, badge or highlight colour. It also
degrades perfectly — in greyscale, at 200% zoom, and in a reader mode the hierarchy survives,
because it was never colour.

Do not fill the Pariksha column with voltage. `DESIGN.md` does not sanction ink on voltage, cream
on voltage fails at 14px, and a brand-filled column reads as an advertisement inside what is meant
to be a factual table.

Rules: 1px `--color-hairline` between rows, 1px `--color-hairline-strong` under the header, no
zebra striping — `results-table` sets that convention and this table should match it. Cell padding
`--space-md` on both axes. A `mono-sm` muted footnote under the table states that the comparison is
against product categories, not named products, and carries the date it was written.

### 4.2 At 400px

A four-column table cannot survive 368px of content width, and pushing it into a horizontal
scroller buries the one column that matters. **It reflows to stacked cards, CSS only, same markup.**

At <= 640px: the header row goes `visually-hidden` (hidden, not removed — the table semantics must
survive), each `<tr>` becomes a card (canvas white, 1px `--color-hairline`, `--rounded-md`,
`--space-lg` padding, `--space-md` between cards), the row header becomes the card's title at
`heading-sm` ink, and each `<td>` becomes a label/value row: label left in `mono-sm` muted, value
right in `body-sm` ink. The Pariksha row inside each card takes the cream fill edge to edge, so the
same visual argument survives the reflow.

The labels at narrow width come from a real `<span class="cell-label">` inside each `<td>`,
displayed only below the breakpoint — **not** from a `::before` with `content:`. Generated content
is announced inconsistently by screen readers and cannot be `aria-hidden`; one extra span per cell
is the honest cost of a layout that works for everyone.

---

## 5. Motion

### 5.1 What moves

Three things, all already in the codebase's pattern:

1. **Colour and border transitions on interactive elements** — 120ms `ease-out`, colour and border
   only, per `DESIGN.md`. Nav links, buttons, footer links, in-block links.
2. **The skip link's top offset** on focus, as today.
3. **Smooth scrolling on in-page anchors** — `scroll-behavior: smooth`, inside the reduced-motion
   guard. A long page with a sticky nav and section anchors is the one case where instant jumps
   genuinely cost orientation.

### 5.2 What does not move

Stated as a ban, so it is not relitigated per section: no scroll-triggered reveals, no fade-up on
entry, no stagger, no parallax, no counting numbers, no carousels, no marquees, no typewriter
effect in the code blocks, no animated gradient or noise on the voltage, no hover lift, scale or
shadow change, no sticky-nav shrink or background swap, no cursor effects, no auto-advancing tabs.

Two reasons, and the second is the stronger one. `DESIGN.md` already bans transforms on hover and
every form of motion inside an attempt. And every one of those effects requires client JavaScript
and client state — on a page whose entire crawler strategy is build-time prerendering to static
HTML, content that appears only after a scroll event is content an answer engine may never see.
**The motion budget and the prerender constraint are the same constraint**, which is why neither
is a compromise.

Design ambition on this page is carried by the 56px display against a full-bleed saturated field,
by the asymmetric hero, by the rendered product surfaces, by a type-driven comparison table and by
a disciplined spacing escalation. None of that needs a keyframe.

### 5.3 Under `prefers-reduced-motion`

Carry the existing pattern: declare `transition: none` as the base and add transitions only inside
`@media (prefers-reduced-motion: no-preference)`. Smooth scroll goes in the same guard.

Because nothing else animates, **the reduced-motion page is visually identical to the default
page.** That identity is the test that the motion budget is right.

---

## 6. Component inventory

### 6.1 Reused unchanged — 5

| Component | Why it holds |
|-----------|--------------|
| `ButtonSecondary` | The deploy cards and docs links need exactly what it already is |
| `CardHairline` | The page's default container; used in §6, §8, §11, §13 |
| `CardVoltage` | One instance, §8, the cost claim. Already correctly headline-only |
| `MonoCaption` | Labels, footnotes, the table footnote, the footer closing |
| `FeatureCell` | The twelve-types grid in §4 is exactly its label / title / body shape |

### 6.2 Extended — 4

| Component | Change | Why |
|-----------|--------|-----|
| `HeroSection` | Two-column layout, status chip, secondary link, a slot for the runner surface | §1; the same component doing more, not a different one |
| `TopNav` | `position: sticky`, plus `scroll-margin-top` on section targets | A fifteen-band page needs its nav; without the scroll margin every anchor jump hides its own heading under the 64px bar — a real bug, not a nicety |
| `SectionHeading` | Optional `eyebrow` prop rendering a `mono-sm` muted label above the `h2` | Chapter sections need a label; one optional prop is cheaper than a second heading component |
| `ButtonPrimary` | Optional `surface` variant: on light bands, invert to `--color-voltage-deep` fill with a cream label (5.66:1 — already the sanctioned hover state) | A cream pill on a cream band is invisible; needed if any CTA lands outside the two voltage bands |

### 6.3 New — 4

| Component | Why it earns existence |
|-----------|------------------------|
| `CodeBlock` | Five or more instances, and it carries the §3 contrast rules — the light / on-voltage split must live in one place or it will be got wrong on the sixth use |
| `RunnerMock` | The hero's entire visual device, reused in the teach ledger. Nothing existing renders a product surface, and the `aria-hidden` plus description pairing must not be re-derived per instance |
| `ComparisonTable` | Substantial markup plus a two-layout reflow; the cell-label spans and the breakpoint rules belong in one file |
| `StepRow` | Four structurally identical rows in the teach ledger (step label, title, body, artefact slot). Without it the route repeats a twenty-line block four times |

### 6.4 Rejected — kept out on purpose

- **`IntegrityBadge`** — three instances of a three-line span. Use the CSS class inline.
- **`Timeline`** for the roadmap — an ordered list with a `mono-sm` label per row. Plain markup.
- **`Tabs` / `Accordion`** anywhere — hides content from crawlers and answer engines, needs client
  state, and the page has no content that deserves to be hidden.
- **`CopyButton`** — see §3.5. Deferred until asked for.
- **`Section` wrapper** — the existing `.section .wrap` class pair already does it.
- **`PullQuote`** — a `<p>` with a class. §6's flags-not-verdicts line does not need a component.

---

## 7. Pre-delivery checks specific to this page

- The sticky nav's links and `ButtonSecondary` sit at a 40px visual height. Give both a
  `min-height: 44px` hit area through block padding, without changing the visual box, so the
  touch-target minimum is met at the narrow widths where the nav is actually tapped.
- Headings run `h1` to `h2` per section to `h3` inside cards, no level skipped, with each `h2` id
  matching its nav anchor.
- Every mock and decorative surface is `aria-hidden` with a `visually-hidden` description beside
  it; every table has a `<caption>`; every code block's caption bar is real text, not a background
  image.
- Check contrast independently for the four syntax roles on both white and cream fills — the §3.2
  ratios are quoted against white, and cream is slightly warmer.
- Test at 400px, at 200% browser zoom, and with `prefers-reduced-motion: reduce`. The third should
  be pixel-identical to the first.
- Verify the page body has no horizontal scrollbar at 320px, 400px and 768px, with the code blocks,
  the comparison table and the runner mock each scrolling or reflowing inside their own container.
- Confirm the rendered page is complete with JavaScript disabled — if any section is empty, the
  prerender and the AEO strategy are both broken.
