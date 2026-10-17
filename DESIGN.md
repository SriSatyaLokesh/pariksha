---
version: alpha
name: Pariksha
website: "https://github.com/SriSatyaLokesh/pariksha"
description: >-
  An open-source exam platform whose design system treats a single saturated vermilion (Voltage #e24c18) as a canvas rather than an accent — but only where a candidate is not under a running clock. Marketing, landing and finish pages put the full-bleed voltage block behind a 56px / weight 500 Anek Latin display headline in cream #fffbf5, with a fully-rounded cream pill CTA beneath. The moment an attempt starts, the system inverts: the test runner is cream and ink, hairline-ruled, and the voltage survives only as the "you are here" marker in the question palette and the focus ring on an answer row. JetBrains Mono carries every label, timer, attempt reference and code sample; Anek ships Latin, Telugu and Devanagari on one skeleton, so a translated test keeps the same typographic voice. Attempt state (answered, marked, current, locked) and integrity state (clean, review, high risk) each get their own structural colour token family, letting a palette square or a results row self-colour without ever reaching for the brand voltage.

colors:
  voltage: "#e24c18"
  voltage-hover: "#f06a38"
  voltage-soft: "#f59a6e"
  voltage-deep: "#b63a10"
  cream: "#fffbf5"
  canvas: "#ffffff"
  ink: "#231f1d"
  ink-soft: "#413c39"
  muted: "#6f6a66"
  hairline: "#efebe6"
  hairline-strong: "#ddd6ce"
  state-answered: "#0d7a51"
  state-marked: "#6a4ddb"
  state-locked: "#6f6a66"
  flag-clean: "#0d7a51"
  flag-review: "#8a5f00"
  flag-risk: "#b3261e"
  data-blue: "#0a6fd4"
  scrim: "rgba(35, 31, 29, 0.55)"
  shadow: "#231f1d"

typography:
  display-xl:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 56px
    fontWeight: 500
    lineHeight: 56px
    letterSpacing: "-1.4px"
  display-lg:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 44px
    fontWeight: 500
    lineHeight: 46px
    letterSpacing: "-1.1px"
  heading-md:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 22px
    fontWeight: 500
    lineHeight: 28px
    letterSpacing: "-0.4px"
  heading-sm:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 18px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: "-0.2px"
  hero-lead:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 24px
    fontWeight: 400
    lineHeight: 34px
    letterSpacing: "-0.2px"
  question-stem:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 18px
    fontWeight: 400
    lineHeight: 29px
    letterSpacing: "0"
  option-label:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 25px
    letterSpacing: "0"
  body-md:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 16px
    fontWeight: 400
    lineHeight: 25px
    letterSpacing: "-0.04px"
  body-sm:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 14px
    fontWeight: 400
    lineHeight: 21px
    letterSpacing: "-0.1px"
  button-md:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: "-0.16px"
  nav-link:
    fontFamily: '"Anek Latin", "Anek Telugu", "Anek Devanagari", sans-serif'
    fontSize: 16px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: "0"
  timer-numeric:
    fontFamily: '"JetBrains Mono", monospace'
    fontSize: 20px
    fontWeight: 500
    lineHeight: 24px
    letterSpacing: "0"
    fontVariantNumeric: "tabular-nums"
  mono-md:
    fontFamily: '"JetBrains Mono", monospace'
    fontSize: 15px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: "0"
  mono-sm:
    fontFamily: '"JetBrains Mono", monospace'
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: "0.3px"

rounded:
  none: "0px"
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
  full: "9999px"

spacing:
  xs: "4px"
  sm: "6px"
  base: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
  4xl: "64px"
  5xl: "96px"

components:
  hero-section:
    backgroundColor: "{colors.voltage}"
    textColor: "{colors.cream}"
    typography: "{typography.display-xl}"
    rounded: "{rounded.none}"
    padding: "96px 24px"
  hero-heading:
    backgroundColor: transparent
    textColor: "{colors.cream}"
    typography: "{typography.display-xl}"
  section-heading:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.display-xl}"
  body-paragraph:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
  body-paragraph-muted:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
  mono-caption:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.mono-sm}"
  button-primary:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "12px 24px"
    height: 46px
    border: "0"
  button-primary-hover:
    backgroundColor: "{colors.voltage-deep}"
    textColor: "{colors.cream}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "12px 24px"
    height: 46px
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: 40px
    borderColor: "{colors.hairline-strong}"
  button-danger:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.flag-risk}"
    typography: "{typography.button-md}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: 40px
    borderColor: "{colors.flag-risk}"
  top-nav:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.none}"
    padding: "12px 32px"
    height: 64px
    borderColor: "{colors.hairline}"
  nav-link:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: 40px
  card-hairline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "24px"
    borderColor: "{colors.hairline}"
  card-voltage:
    backgroundColor: "{colors.voltage}"
    textColor: "{colors.cream}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.lg}"
    padding: "40px"
  category-tab:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
    height: 36px
    borderColor: "{colors.hairline-strong}"
  category-tab-active:
    backgroundColor: "{colors.voltage}"
    textColor: "{colors.cream}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
    height: 36px
  feature-cell:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.none}"
    padding: "32px 24px"
    borderColor: "{colors.hairline}"
  field-label:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.heading-sm}"
  field-help:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  field-error:
    backgroundColor: transparent
    textColor: "{colors.flag-risk}"
    typography: "{typography.body-sm}"
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: "10px 12px"
    height: 44px
    borderColor: "{colors.hairline-strong}"
  text-input-focus:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: "10px 12px"
    height: 44px
    borderColor: "{colors.voltage}"
  text-input-error:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.xs}"
    padding: "10px 12px"
    height: 44px
    borderColor: "{colors.flag-risk}"
  consent-row:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "16px"
    borderColor: "{colors.hairline-strong}"
  question-stem:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.question-stem}"
  option-row:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.option-label}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
    borderColor: "{colors.hairline-strong}"
  option-row-selected:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.option-label}"
    rounded: "{rounded.md}"
    padding: "14px 16px"
    borderColor: "{colors.voltage}"
  palette-square:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    height: 36px
    borderColor: "{colors.hairline-strong}"
  palette-square-answered:
    backgroundColor: "{colors.state-answered}"
    textColor: "{colors.cream}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    height: 36px
  palette-square-marked:
    backgroundColor: "{colors.state-marked}"
    textColor: "{colors.cream}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    height: 36px
  palette-square-current:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.voltage-deep}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    height: 36px
    borderColor: "{colors.voltage}"
  timer-chip:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.timer-numeric}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: 36px
    borderColor: "{colors.hairline-strong}"
  timer-chip-urgent:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.flag-risk}"
    typography: "{typography.timer-numeric}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
    height: 36px
    borderColor: "{colors.flag-risk}"
  save-status:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.mono-sm}"
  save-status-offline:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.flag-review}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    borderColor: "{colors.flag-review}"
  violation-modal:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    padding: "32px"
    borderColor: "{colors.flag-review}"
  modal-scrim:
    backgroundColor: "{colors.scrim}"
  proctor-banner:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    borderColor: "{colors.voltage}"
  integrity-badge-clean:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.flag-clean}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    height: 24px
    borderColor: "{colors.flag-clean}"
  integrity-badge-review:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.flag-review}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    height: 24px
    borderColor: "{colors.flag-review}"
  integrity-badge-risk:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.flag-risk}"
    typography: "{typography.mono-sm}"
    rounded: "{rounded.full}"
    padding: "4px 10px"
    height: 24px
    borderColor: "{colors.flag-risk}"
  results-table:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.none}"
    padding: "10px 12px"
    borderColor: "{colors.hairline}"
  watermark:
    backgroundColor: transparent
    textColor: "{colors.hairline-strong}"
    typography: "{typography.mono-sm}"
---

# Pariksha design system

Machine-readable tokens plus the reasoning behind them. Feed this file to Claude, Cursor or any agent that reads structured design tokens; every hex, font, radius and spacing value below resolves without invention.

## Overview

Pariksha runs on one disciplined inversion and one hard rule that limits it.

**Voltage as canvas.** The brand colour, Voltage `{colors.voltage}` (#e24c18), is not held in reserve for a CTA fill. On the landing page, the test start page and the finish page, it _is_ the surface — a full-bleed vermilion block carrying a 56px display headline in cream `{colors.cream}` (#fffbf5, never pure white) with a fully-rounded cream pill CTA beneath. The confidence comes from one saturated field and one sentence, not from a gradient mesh or a hero illustration.

**The clock kills the canvas.** The moment an attempt starts, the system inverts. The test runner is cream and ink, hairline-ruled, and the voltage survives only as the "you are here" square in the question palette and the focus ring on a selected answer row. A candidate sits inside that screen for 45 minutes under a running timer, often already nervous; a saturated orange field behind a reading task is a stress surface, and cream-on-voltage only reaches 3.86:1, which is legal for a 56px headline and illegal for a question stem. The marketing canvas and the exam canvas are deliberately different places.

**Editorial display, monospace instrumentation.** Display is Anek Latin at weight 500 — not 700 — 56px with -1.4px tracking, closer to a magazine dek than a SaaS hero. Every label, timer, attempt reference, snapshot timestamp and code sample is JetBrains Mono. The sans speaks; the mono instruments. There is no uppercase-tracked sans label tier anywhere in the system — small-caps duty belongs entirely to `{typography.mono-sm}`.

**One skeleton, three scripts.** Anek ships Latin, Telugu and Devanagari drawn on a shared skeleton, so a test translated into Telugu or Hindi keeps the same typographic voice instead of falling back to a mismatched Noto face mid-sentence. Both families are SIL OFL and self-hosted — the PRD forbids third-party scripts and fonts loaded from someone else's CDN (S-11), and that rule has no exceptions for typography.

**State colour is structural, not decorative.** Attempt state (answered, marked, current, locked) and integrity state (clean, review, high risk) each own a token family. A palette square or a results row colours itself from that family and never borrows the brand voltage — which is why the voltage still reads as singular after a page shows forty coloured squares.

**Key characteristics**

- Single brand voltage `{colors.voltage}` fills marketing and transition surfaces, then withdraws to a focus ring and one palette square inside a live attempt.
- Cream `{colors.cream}` (#fffbf5), not `#ffffff`, carries every "white" element that touches the voltage. Pure `{colors.canvas}` is the below-fold body and the inside of cards.
- Two hairline tones, not one: `{colors.hairline}` for decoration, `{colors.hairline-strong}` for anything a candidate must perceive as an edge — input outlines, answer rows, palette squares, table rules.
- Display weight 500 at 44–56px with tight tracking. Never 700.
- Reading line-height is 1.55–1.6, not the 1.2 a marketing display uses. A question stem is read under time pressure.
- Binary radius: small-step 3 / 4 / 6 / 8px, plus a full pill for exactly two surfaces (primary CTA, category tab). No 12 / 16 / 20px middle tier.
- Hairlines carry elevation; shadows appear on exactly two things — the hero CTA and a modal.
- 8px base spacing unit, with 96px hero bands and 64px section rhythm.
- Every pair in this file has a measured contrast ratio, and every ratio is stated. WCAG 2.1 AA is a product requirement, not an aspiration.

## Colors

Ratios below are measured against `{colors.cream}` (#fffbf5) unless stated. AA needs **4.5:1** for text under 24px, **3:1** for text at 24px+ or 18.66px bold, and **3:1** for a UI boundary a user must see.

### Brand

| Token                    | Hex     | On cream   | Allowed use                                                                                                   |
| ------------------------ | ------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `{colors.voltage}`       | #e24c18 | **3.86:1** | Canvas fills, borders, focus rings, icons, display text at 24px+. **Never body text.**                        |
| `{colors.voltage-hover}` | #f06a38 | 2.99:1     | Hover fills only. Never text, at any size.                                                                    |
| `{colors.voltage-soft}`  | #f59a6e | —          | Illustration and gradient end-stop only.                                                                      |
| `{colors.voltage-deep}`  | #b63a10 | **5.66:1** | The only voltage permitted as running text, and the fill under cream button labels (cream on it: **5.66:1**). |

That four-step split is the system's main departure from the brand colour it descends from. A single orange cannot be both a canvas and a link colour and stay legal; `{colors.voltage-deep}` exists so the voltage can appear in a sentence without failing AA.

### Surface

| Token             | Hex     | Use                                                                                                                                           |
| ----------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `{colors.cream}`  | #fffbf5 | Every "white" that sits over or beside the voltage: hero display text, CTA pill fill, consent block, timer chip, the test-runner body canvas. |
| `{colors.canvas}` | #ffffff | Card interiors, table bodies, the top-nav, answer rows. Used where cream's warmth would compete with content.                                 |

The cream/white difference is small enough that most people never name it and consistent enough that mixing the two reads as a bug.

### Text

| Token               | Hex     | On cream    | Use                                                                                                          |
| ------------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `{colors.ink}`      | #231f1d | **15.85:1** | Display below the fold, question stems, answer labels, table cells. Never pure black.                        |
| `{colors.ink-soft}` | #413c39 | **10.55:1** | Long-form running copy where ink feels heavy.                                                                |
| `{colors.muted}`    | #6f6a66 | **5.18:1**  | Help text, captions, inactive nav, "View all" links. Still passes AA — a form's help text is not decoration. |

### Hairline

| Token                      | Hex     | On cream | Use                                                                                                                   |
| -------------------------- | ------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `{colors.hairline}`        | #efebe6 | 1.15:1   | Decorative rules: section dividers, nav underline, table row separators, card outlines whose edge carries no meaning. |
| `{colors.hairline-strong}` | #ddd6ce | 1.4:1    | **Every boundary a candidate must perceive**: input outlines, answer rows, palette squares, secondary-button borders. |

Neither tone reaches 3:1, so neither may be the _only_ signal that a control exists. An input is recognisable by its outline plus its label plus its 44px height; a palette square by its outline plus its number. Where a border alone must carry meaning — focus, error, selection — the colour steps up to `{colors.voltage}`, `{colors.flag-risk}` or a state token.

### Attempt state

The question palette is the densest colour surface in the product. These four tokens own it.

| Token                      | Hex     | On cream   | Meaning                                                                                                                                        |
| -------------------------- | ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `{colors.state-answered}`  | #0d7a51 | **5.2:1**  | Answered. Cream on it: **5.2:1**.                                                                                                              |
| `{colors.state-marked}`    | #6a4ddb | **5.51:1** | Marked for review. Violet, deliberately far from the voltage — an amber "marked" state beside an orange "current" state is unreadable at 36px. |
| `{colors.voltage}`         | #e24c18 | 3.86:1     | Current question — rendered as a 2px outline with `{colors.voltage-deep}` text, never as a fill.                                               |
| `{colors.hairline-strong}` | #ddd6ce | —          | Not answered.                                                                                                                                  |
| `{colors.state-locked}`    | #6f6a66 | 5.18:1     | A section the candidate has left and cannot return to.                                                                                         |

Colour is never the only carrier here. Answered squares are filled, marked squares carry a corner notch, the current square carries a ring, locked squares carry a lock glyph — a candidate with deuteranopia reads the palette from shape alone.

### Integrity state

| Token                  | Hex     | On cream   | Meaning                                                                            |
| ---------------------- | ------- | ---------- | ---------------------------------------------------------------------------------- |
| `{colors.flag-clean}`  | #0d7a51 | **5.2:1**  | `clean` — nothing to look at.                                                      |
| `{colors.flag-review}` | #8a5f00 | **5.48:1** | `review` — a person should look. Also the offline-sync and violation-warning tone. |
| `{colors.flag-risk}`   | #b3261e | **6.34:1** | `high_risk`, destructive actions, field errors, final-two-minutes timer.           |

Three states, three colours, and every one of them legible as text at 12px — these appear in results tables and CSV-shaped views where a badge is often the only cell content.

### Data

`{colors.data-blue}` (#0a6fd4, **4.81:1**) joins `{colors.flag-clean}`, `{colors.state-marked}` and `{colors.flag-review}` as the four-series analytics palette for score distributions, item-analysis charts and per-set comparisons. The voltage is never a data series — a chart with a brand-coloured bar reads as if that bar is the recommended answer.

### Semantic

- `{colors.scrim}` — `rgba(35, 31, 29, 0.55)`, warm ink at 55%, behind every modal.
- `{colors.shadow}` — #231f1d, used only with alpha. The system has no tinted shadow.

## Typography

### Families

**Anek** (Latin / Telugu / Devanagari) for everything spoken: display, headings, question stems, answer labels, body, buttons, nav. **JetBrains Mono** for everything instrumented: labels, timers, attempt references, scores, snapshot timestamps, code samples inside questions. Both SIL OFL, both self-hosted, subset per script and loaded with `font-display: swap`.

The fallback stack walks Anek Latin → Anek Telugu → Anek Devanagari → `sans-serif`, so a Telugu glyph in an otherwise-Latin sentence is drawn by a sibling face rather than by whatever the operating system volunteers.

### Hierarchy

| Token                        | Size | Weight | Line height | Tracking | Use                                                                                                         |
| ---------------------------- | ---- | ------ | ----------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `{typography.display-xl}`    | 56px | 500    | 56px        | -1.4px   | Hero h1 on the voltage canvas; section h2 below the fold                                                    |
| `{typography.display-lg}`    | 44px | 500    | 46px        | -1.1px   | Split-panel headlines, finish-page confirmation                                                             |
| `{typography.heading-md}`    | 22px | 500    | 28px        | -0.4px   | Section titles inside the admin app, test names                                                             |
| `{typography.heading-sm}`    | 18px | 500    | 24px        | -0.2px   | Card titles, form field labels                                                                              |
| `{typography.hero-lead}`     | 24px | 400    | 34px        | -0.2px   | The hero lead sentence on the voltage canvas; 24px is the smallest size at which cream on voltage clears AA |
| `{typography.question-stem}` | 18px | 400    | 29px        | 0        | **The question itself.** 1.6 line-height, the loosest in the system                                         |
| `{typography.option-label}`  | 16px | 400    | 25px        | 0        | Answer options, matching rows, ordering items                                                               |
| `{typography.body-md}`       | 16px | 400    | 25px        | -0.04px  | Default running text                                                                                        |
| `{typography.body-sm}`       | 14px | 400    | 21px        | -0.1px   | Help text, captions, table cells                                                                            |
| `{typography.button-md}`     | 16px | 500    | 24px        | -0.16px  | Button labels                                                                                               |
| `{typography.nav-link}`      | 16px | 500    | 24px        | 0        | Nav labels                                                                                                  |
| `{typography.timer-numeric}` | 20px | 500    | 24px        | 0        | **Tabular numerals.** Countdowns, scores, attempt references                                                |
| `{typography.mono-md}`       | 15px | 400    | 24px        | 0        | Code blocks inside question prompts                                                                         |
| `{typography.mono-sm}`       | 12px | 400    | 18px        | 0.3px    | Small-caps labels, palette numbers, footnotes, badges                                                       |

### Principles

**Display stays at 500.** 56px with -1.4px tracking is confidence through tracking and scale, not weight. Pushing to 700 turns an editorial dek into a SaaS hero and loses the whole register.

**Reading text is not display text.** The display tier sets line-height equal to font size (56/56). The reading tier does not: `{typography.question-stem}` runs 18/29 — a ratio of 1.6, the loosest value in the system, because a candidate reads it once, under a clock, possibly at 200% zoom. Copying the display's tight leading onto a question stem is the single easiest way to make this product feel hostile.

**Numbers never jitter.** `{typography.timer-numeric}` sets `font-variant-numeric: tabular-nums`. A countdown whose digits change width every second pulls the eye away from the question — which is the one thing a timer must not do.

**The mono voice does label duty.** No uppercase-tracked sans tier exists. If you reach for `letter-spacing: 0.08em; text-transform: uppercase` on Anek, you have broken the split.

**Cream on voltage has a size floor.** The Brand colour table sanctions `{colors.cream}` on `{colors.voltage}` only at 24px and above (3:1, the large-text AA threshold); under 24px it drops to 3.86:1 and fails. `{typography.hero-lead}` exists so the hero's lead sentence can sit on the voltage canvas at a legal size instead of being re-tinted — nothing smaller than 24px may set cream text on the voltage fill.

### Substitutes

Anek is the intended family precisely because of its multi-script coverage; substituting it costs the Telugu and Devanagari skeleton match. If you must: **Inter** for Latin at 95% line-height with -0.04em display tracking, plus **Noto Sans Telugu** and **Noto Sans Devanagari** — and accept that the three scripts will no longer share a skeleton. For JetBrains Mono, **IBM Plex Mono** transfers at the same sizes.

## Layout

### Spacing

Base unit 8px. `{spacing.xs}` 4 · `{spacing.sm}` 6 · `{spacing.base}` 8 · `{spacing.md}` 12 · `{spacing.lg}` 16 · `{spacing.xl}` 24 · `{spacing.2xl}` 32 · `{spacing.3xl}` 40 · `{spacing.4xl}` 64 · `{spacing.5xl}` 96.

- Hero band: `{spacing.5xl}` (96px) vertical.
- Section rhythm below the fold: `{spacing.4xl}` (64px).
- `{component.card-hairline}` interior: `{spacing.xl}` (24px). `{component.card-voltage}`: `{spacing.3xl}` (40px) — the emphasis block breathes more.
- Answer rows: `{spacing.md}` (12px) between rows, `{spacing.lg}` (16px) horizontal padding inside one.
- Form fields: `{spacing.xl}` (24px) between fields, `{spacing.sm}` (6px) between a label and its input, `{spacing.xs}` (4px) between an input and its help or error line.

### Grid

- Max content width 1080px for display and feature rows; 1280px for admin tables and the live monitor.
- Hero content centres at 720px.
- **Test runner: a two-column split.** Question column 1fr with a 680px max-width (about 70 characters at `{typography.question-stem}` — a measure, not a full-bleed line), palette rail a fixed 240px. Below 1024px the test is blocked entirely by the device rule (P-01), so the runner has no mobile layout to design.
- Registration form: single column, 560px max-width. Never two columns — a form that reflows mid-fill loses answers.

### Rhythm

Marketing pages alternate generous and dense bands: hero generous, feature strip dense, split panel generous. The test runner does the opposite and holds **one tempo for the whole attempt** — identical spacing on every question, no section that breathes differently from another. A layout that shifts between questions reads as the page reloading, and a candidate who thinks the page reloaded thinks their answer was lost.

## Elevation

Hairlines carry depth; shadows are nearly absent.

- **Flat, no shadow:** every band, card, feature cell, answer row, palette square, table — about 99% of surfaces. Depth comes from surface contrast (cream over voltage, white over cream) and from `{colors.hairline-strong}`.
- **CTA:** `{component.button-primary}` carries `0 2px 4px rgba(35,31,29,0.08)` — the single lifted element on a marketing page.
- **Modal:** `{component.violation-modal}` carries `0 8px 32px rgba(35,31,29,0.18)` over `{component.modal-scrim}`. A violation warning must read as being in front of the test, not beside it.

Nothing else gets a shadow. No hover lifts, no card elevation on focus.

## Shapes

Binary: small-step everywhere, full pill for two surfaces.

- `{rounded.xs}` 3px — inputs, small chips.
- `{rounded.sm}` 4px — palette squares, dropdowns, popovers.
- `{rounded.md}` 6px — answer rows, secondary buttons, timer chip, banners.
- `{rounded.lg}` 8px — cards, the voltage split panel, modals.
- `{rounded.full}` — `{component.button-primary}` and `{component.category-tab}` only, plus integrity badges.

No 12 / 16 / 20px tier. The pill is the warmest shape in the system and it stays scarce, so it keeps meaning "press this".

## Modes

### Default (light)

As specified above. The only mode the marketing site ships.

### High contrast

Required by the PRD (C-04) as a candidate-facing toggle, alongside font size. It is a token swap, not a separate design:

| Token                        | Default | High contrast       |
| ---------------------------- | ------- | ------------------- |
| `{colors.ink}`               | #231f1d | #000000             |
| `{colors.muted}`             | #6f6a66 | #3d3935 (**9.2:1**) |
| `{colors.hairline}`          | #efebe6 | #231f1d             |
| `{colors.hairline-strong}`   | #ddd6ce | #231f1d             |
| `{colors.cream}`             | #fffbf5 | #ffffff             |
| `{colors.voltage}` as border | #e24c18 | #b63a10             |

Borders go to 2px, focus rings to 3px, and the voltage canvas on the start page drops to a cream canvas with a `{colors.voltage-deep}` rule. Every state keeps its non-colour carrier (fill, notch, ring, glyph), so the palette stays readable with no colour at all.

### Dark

Deliberately deferred. A candidate-facing dark mode has to be designed against camera-lit faces and a cream watermark; doing it badly is worse than not shipping it. Admin dark mode comes with the dashboard, after v1.

## Motion

- Default transition: 120ms `ease-out` on colour and border only. No transform on hover.
- Page and question transitions: **none.** Moving between questions is instant. A 200ms slide between questions costs nothing on a marketing page and reads as lag under a clock.
- The timer never animates, pulses or flashes. At the configured warnings it swaps to `{component.timer-chip-urgent}` once, and an accompanying text line states the remaining time for screen readers.
- `{component.violation-modal}` fades its scrim over 120ms. It does not bounce or scale.
- Every animation is wrapped in `@media (prefers-reduced-motion: no-preference)`. Nothing in the test runner depends on motion to be understood.

## Components

### Marketing and transition surfaces

**`hero-section`** — Full-bleed `{colors.voltage}` canvas, 96×24px padding, square corners. Holds the h1 in cream, one lead sentence, and the cream pill CTA. Used on the landing page, the test start page and the finish page — never behind a running attempt.

**`hero-heading`** — Cream on voltage at `{typography.display-xl}`. At 56px the 3.86:1 ratio clears AA for large text; this is the only place cream-on-voltage is legal.

**`section-heading`** — The same display token in `{colors.ink}` on white, below the fold.

**`body-paragraph`** / **`body-paragraph-muted`** — Workhorse running text in ink and muted.

**`mono-caption`** — `{typography.mono-sm}` in muted. Small-caps labels above feature cells, footnotes under diagrams, timestamps.

**`button-primary`** — Cream fill, ink label, full pill, 46px tall, no border, one soft shadow. "Start the test →" is the canonical instance. Highest-contrast element on the hero (15.85:1) by inverting the figure-ground.

**`button-primary-hover`** — Flips to `{colors.voltage-deep}` with a cream label (**5.66:1**). The flip to the _deep_ step, not the hover step, is what keeps the label legal.

**`button-secondary`** — White fill, ink label, 1px `{colors.hairline-strong}`, 6px radius, 40px.

**`button-danger`** — White fill, `{colors.flag-risk}` label and border. Force-submit, reset attempt, delete candidate data. Always paired with a confirmation naming what is about to happen.

**`top-nav`** — White, 64px, 1px `{colors.hairline}` bottom rule. **Absent during an attempt** — a live test has no navigation to offer.

**`nav-link`** — Muted label, 6px hover pill in near-white. Never the voltage.

**`card-hairline`** — White, 1px `{colors.hairline}`, 8px radius, 24px padding, no shadow.

**`card-voltage`** — Voltage fill, cream text, 8px radius, 40px padding. The in-body emphasis block, usually half of a 50/50 split beside a `{component.card-hairline}`. One per page, at most.

**`category-tab`** / **`category-tab-active`** — Pill tabs, 36px. Inactive is white with a `{colors.hairline-strong}` border; active takes the voltage fill with cream text. Used for question-type filters in the bank browser and section tabs in results.

**`feature-cell`** — White, 32×24px padding, separated by 1px `{colors.hairline}` rules. A `{typography.mono-sm}` label, a `{typography.heading-sm}` title, one or two lines of body.

### Registration form

**`field-label`** — `{typography.heading-sm}` in ink, above its input, always visible. No placeholder-as-label: the label must survive the field being filled.

**`field-help`** — `{typography.body-sm}` in muted, below the input. Says what the field wants before it is wrong.

**`field-error`** — `{typography.body-sm}` in `{colors.flag-risk}`, below the input, prefixed with a ⚠ glyph so the error does not depend on colour. Carries the field's `pattern_message` — "Format: 21CS0147 — two digits, two letters, four digits", never "Invalid format".

**`text-input`** — White, 44px tall (not 40 — a thumb and a nervous hand both need the target), 3px radius, 1px `{colors.hairline-strong}`.

**`text-input-focus`** — Border swaps to `{colors.voltage}` at 2px plus a 3px voltage ring at 25% alpha. The focus state is the only place the voltage appears in the registration form.

**`text-input-error`** — Border swaps to `{colors.flag-risk}` at 2px, paired with `{component.field-error}`. Never colour alone.

**`consent-row`** — Cream fill, `{colors.hairline-strong}` border, 16px padding, 6px radius. Holds the consent checkbox, its label and the link that opens the consent text. Visually heavier than the fields above it on purpose: this is the one row where a candidate is agreeing to something.

### Test runner

**`question-stem`** — `{typography.question-stem}` in ink, 680px measure. Markdown, code blocks (`{typography.mono-md}`), LaTeX and images render inside it.

**`option-row`** — White, 1px `{colors.hairline-strong}`, 6px radius, 14×16px padding. **The entire row is the hit target**, not just the radio or checkbox. Minimum height 48px.

**`option-row-selected`** — Cream fill, 2px `{colors.voltage}` border, plus the filled control. Two carriers, so selection survives a colour-blind reading and a greyscale print.

**`palette-square`** — 36px, 4px radius, `{typography.mono-sm}` number. Four variants: default (outline only), `answered` (`{colors.state-answered}` fill, cream number), `marked` (`{colors.state-marked}` fill plus a corner notch), `current` (white fill, 2px voltage ring, `{colors.voltage-deep}` number). A locked section dims to `{colors.state-locked}` with a lock glyph.

**`timer-chip`** — Cream fill, `{colors.hairline-strong}` border, `{typography.timer-numeric}` tabular digits. Section and total clocks sit side by side.

**`timer-chip-urgent`** — Swaps text and border to `{colors.flag-risk}` at the configured warning marks. One swap, no pulse.

**`save-status`** — `{typography.mono-sm}` in muted: "✓ Saved 2 seconds ago". The quietest element on screen while everything is fine.

**`save-status-offline`** — Steps up to a `{colors.flag-review}` chip on cream: "Offline — your answers are kept and will be sent when you reconnect." Reassurance first, status second.

**`violation-modal`** — White, 8px radius, 32px padding, 2px `{colors.flag-review}` border, over `{component.modal-scrim}`. States what happened, that the clock kept running, the warning count, and what happens at the limit. `{colors.flag-risk}` is reserved for the final warning before the configured action fires — a first tab switch is not an emergency.

**`modal-scrim`** — `{colors.scrim}`, warm ink at 55%. Dark enough to stop the candidate reading the question behind it, which is the point.

**`proctor-banner`** — Cream fill, 1px `{colors.voltage}` border, 12×16px padding, pinned above the question column. Carries proctor broadcasts ("5 more minutes added"). The one voltage-bordered element inside a live attempt, because it is the only time a human is speaking to the candidate.

**`watermark`** — `{typography.mono-sm}` in `{colors.hairline-strong}`, candidate name and roll number, tiled at low opacity over the question area. Must stay under 1.3:1 against its surface — a watermark that can be read comfortably is a watermark that is being read instead of the question.

### Admin and results

**`integrity-badge-clean` / `-review` / `-risk`** — Pill, 24px, `{typography.mono-sm}`, outline plus coloured text on white. Text reads `clean` / `review` / `high risk` — the word, not only the colour, because this badge is often the only content in its table cell.

**`results-table`** — White, `{typography.body-sm}`, 10×12px cells, 1px `{colors.hairline}` row rules, no zebra striping. Score and percent columns use `{typography.timer-numeric}` at 15px for tabular alignment. Sticky header with a `{colors.hairline-strong}` bottom rule.

## Do's and don'ts

**Do** give the voltage the whole canvas on marketing, start and finish pages. Holding it back for a button misses the one move this system has.

**Do** take the voltage _away_ the moment the clock starts. The test runner is cream, ink and hairlines, with voltage only on the current-question ring, the input focus ring and the proctor banner.

**Do** use `{colors.cream}`, never `#ffffff`, for any white that touches the voltage.

**Do** use `{colors.voltage-deep}` whenever the brand colour has to be a word rather than a field. #e24c18 at 3.86:1 is not a text colour under 24px.

**Do** give every state a second carrier — a fill, a notch, a ring, a glyph, a word. The palette, the badges and the option rows must all survive greyscale.

**Do** let JetBrains Mono carry every label, number and reference. There is no uppercase sans label tier to reach for.

**Don't** set display headlines at 700. The system sits at 500 with tight tracking.

**Don't** reuse the display's 1.0 line-height on reading text. Question stems run 1.6, body 1.55.

**Don't** animate anything inside a live attempt — no question transitions, no timer pulse, no row lift. Motion under a clock reads as lag or as a reload.

**Don't** use `{colors.hairline}` or `{colors.hairline-strong}` as a fill or as text; both are border tokens, and neither reaches 3:1.

**Don't** put `{colors.voltage}` in a chart. Analytics series come from the data palette; a brand-coloured bar looks like an endorsement.

**Don't** place `{colors.flag-risk}` next to the voltage in one composition. One is an emergency, the other is the brand, and adjacency makes both ambiguous.

**Don't** add a 12 / 16 / 20px radius tier. Small-step or pill; the scarcity is what makes the pill mean something.

**Don't** show a candidate a destructive control without a confirmation that names the consequence. `{component.button-danger}` is never a one-click action.

## Known gaps

- **Dark mode.** Deferred by decision, not oversight. See _Modes_.
- **Charts.** The four-series data palette is specified; axis treatment, grid-line weight, tooltip surface and the item-analysis chart types (distribution, discrimination scatter, option pick rates) are not yet designed.
- **Live monitor.** The 15-second-refresh proctor table needs a specification for how a row changes without stealing focus from the proctor's current action. Not yet written.
- **Snapshot timeline.** The review screen's snapshot strip — thumbnail size, flagged-frame treatment, scrub behaviour — is unspecified.
- **Email.** Invite links, one-time codes and result notifications need a constrained token subset that survives Outlook. Not started.
- **Right-to-left.** The PRD commits to RTL layout. Mirroring rules for the palette rail, the timer pair and the progress indicators are not yet defined.
- **Logo and mark.** No wordmark, favicon or app icon exists. The type is specified; the identity is not.
- **Icons.** No icon set chosen. It must be self-hosted SVG, stroke-based, and legible at 16px to match the mono label tier.
