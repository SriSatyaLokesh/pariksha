# `exam.css` type inventory — every literal, before the sweep

**Task:** 6.5f Task 1 · **Authority:** `docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md` §7 (`D8`)
**Scope:** `apps/web/src/styles/exam.css` (1,399 lines) · **Date:** 2026-10-21
**Changes no CSS.** This is the mapping Task 2 and Task 3 apply.

---

## Headline: the sweep `D8` describes has nothing to sweep

`D8` states that `exam.css` "carries **63 literal `font-size:`** against 158 `var(--type-*)`".

**It carries 63 `font-size:` declarations and 0 of them are literal.** All 63 are already
`var(--type-*-size)` — they *are* 63 of the 158 `var(--type-*)` uses the same sentence counts
separately. The file has no `px`, `rem`, `em`, `pt` or `%` in any `font-size` position, and no
`clamp()`/`min()`/`max()` in a type position at all.

**Where the 63 came from.** `grep -c "font-size:" apps/web/src/styles/exam.css` returns 63. That is
a count of *declarations*, not of *literals*; the ruling reads the grep count as the literal count.
The same method applied to `signal.css` returns 36, and there it is nearly right by accident —
`signal.css` has 36 `font-size:` declarations of which **33 are genuinely literal**. So the method
was validated against the file where it happened to work, then carried to the file where it does not.

**Corroboration.** `git log -- apps/web/src/styles/exam.css` shows **one commit in the file's
history** (`831fbd2`, Phase 6 — candidate runtime, #173). No later commit touched it, and
`git log -S "font-size: 1"` on the file returns nothing. The file was born tokenised; no prior
sweep removed the literals, because there were never any to remove.

**The two imported runtime stylesheets are clean too.** `exam.css` opens with
`@import "./question.css"` and `@import "./registration.css"` (lines 20–21). Those carry 7 and 6
`font-size:` declarations respectively, **all tokenised, 0 literal**. The whole candidate runtime is
already on the scale.

### What this means for the rest of 6.5f

The type-scale sweep is a **no-op on the candidate runtime**, for the same reason the pre-`D8`
wording was a no-op: the work was already done in Phase 6. Under `D8`'s own cost argument — a
runtime mistake falls on a user who cannot report a bug mid-attempt — **the correct action is to
change nothing**, not to find 63 things to touch. Task 2 has no front-matter entries to add (see
§3), and Task 3's assertions should be written against a file that did not move at all.

What *is* left in `exam.css` that is not on a token is **nine `font-weight:` literals, four
`letter-spacing: 0.08em`, and one unitless `line-height: 2.2`** — all catalogued in §2, none of
them a `font-size`, and several load-bearing in ways a sweep would break (§2.1, §2.3, §2.6).

---

## Method

What was searched, beyond `font-size:`:

| Search | Hits | Verdict |
|---|---|---|
| `grep -n "font-size:"` | 63 | All `var(--type-*-size)`. Rows in §1. |
| `grep -nE "font-size:.*[0-9](px\|rem\|em\|pt\|%)"` | **0** | No raw length in any `font-size`. |
| `grep -n "font:"` (shorthand) | 1 | Line 152, `font: inherit` — resets to the parent, carries no size. Safe; §2.4. |
| `grep -n "clamp(\|min(\|max("` | 2 | Line 383 `grid-template-columns: minmax(…)`, line 1252 `width: min(…)`. **Neither is a type position.** No `clamp()` type sizing in this file. |
| `grep -n "line-height:"` | 17 | 16 are `var(--type-*-line-height)`. One literal: line 1161, `2.2` (unitless). §2.3. |
| `font-weight` / `letter-spacing` / `font-family` / `font-variant` not on a token | 13 | 9 `font-weight`, 4 `letter-spacing`. §2.1, §2.2. |
| `grep -n "@media\|@supports"` | **0** | §4. |
| `font-size:` in the two `@import`ed runtime sheets | 7 + 6 | All tokenised, 0 literal. |

Selectors below were read from the file rather than inferred, so multi-line selector groups
(e.g. lines 626–629) are given in full rather than as their last line. Line numbers were verified
against `cat -n` for every rule quoted in §5.

---

## 1. The 63 `font-size:` declarations

"**Rounds?**" answers the required column — *would rounding to the named step change the rendered
size*. It is **No** on every row for one reason: the declaration already *is* that step, so there is
nothing to round. No row in this table is a candidate for change.

Resolved sizes come from `apps/web/src/styles/tokens.css` (generated from `DESIGN.md`'s typography
front matter): `display-xl` 56px · `display-lg` 44px · `hero-lead` 24px · `heading-md` 22px ·
`heading-sm` 18px · `question-stem` 18px · `option-label` 16px · `body-md` 16px · `button-md` 16px ·
`nav-link` 16px · `body-sm` 14px · `timer-numeric` 20px mono · `mono-md` 15px mono · `mono-sm` 12px mono.

No row has a media-query or `@supports` context — the file has none (§4) — so the context column is
omitted rather than printed as 63 dashes.

| # | Line | Selector | Declared value | Step | px | Rounds? |
|---|---|---|---|---|---|---|
| 1 | 47 | `.exam-landing-hero h1` | `var(--type-display-xl-size)` | display-xl | 56 | No — already the step. **Size is load-bearing**, §2.5 |
| 2 | 59 | `.exam-landing-lede` | `var(--type-heading-md-size)` | heading-md | 22 | No — already the step |
| 3 | 98 | `.exam-facts dt` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 4 | 131 | `.exam-section-count, .exam-section-limit` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 5 | 191 | `.exam-finding-mark` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 6 | 212 | `.exam-landing-footer` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 7 | 236 | `.exam-register h1` | `var(--type-display-lg-size)` | display-lg | 44 | No — already the step |
| 8 | 250 | `.exam-register-notice` | `var(--type-body-md-size)` | body-md | 16 | No — already the step |
| 9 | 280 | `.exam-register-form h2` | `var(--type-heading-md-size)` | heading-md | 22 | No — already the step |
| 10 | 301 | `.exam-consent h2` | `var(--type-heading-md-size)` | heading-md | 22 | No — already the step |
| 11 | 312 | `.exam-register-status` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 12 | 334 | `.exam-register-submit, .exam-register-secondary` | `var(--type-button-md-size)` | button-md | 16 | No — already the step |
| 13 | **393** | `.exam-runner` | `calc(var(--type-body-md-size) * var(--exam-font-scale, 1))` | body-md × scale | 16 × scale | **No — and must not be flattened.** §2.6 |
| 14 | 440 | `.exam-skip` | `var(--type-button-md-size)` | button-md | 16 | No — already the step |
| 15 | 490 | `.exam-timer-label` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 16 | 500 | `.exam-timer-value` | `var(--type-timer-numeric-size)` | timer-numeric | 20 | No — already the step |
| 17 | 511 | `.exam-timer-mark` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 18 | 530 | `.exam-clock-announce` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 19 | 565 | `.exam-save-mark` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 20 | 571 | `.exam-save-banner[data-state="saving"]` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 21 | 577 | `.exam-save-banner[data-state="saved"]` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 22 | 583 | `.exam-save-banner[data-state="offline"]` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 23 | 589 | `.exam-save-banner[data-state="refused"]` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 24 | 615 | `.exam-font-scale legend, .exam-view-choice` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 25 | 637 | `.exam-contrast-switch, .exam-calc-open, .exam-button, .exam-clear` | `var(--type-button-md-size)` | button-md | 16 | No — already the step |
| 26 | 648 | `.exam-contrast-switch[aria-checked="true"]` | `var(--type-button-md-size)` | button-md | 16 | No — already the step (redeclares the base, §6.3) |
| 27 | 655 | `.exam-button[aria-pressed="true"]` | `var(--type-button-md-size)` | button-md | 16 | No — already the step (redeclares the base, §6.3) |
| 28 | 667 | `.exam-button:disabled` | `var(--type-button-md-size)` | button-md | 16 | No — already the step (redeclares the base, §6.3) |
| 29 | 675 | `.exam-clear` (the `button-danger` rule, 672–676) | `var(--type-button-md-size)` | button-md | 16 | No — already the step (redeclares the base, §6.3) |
| 30 | **680** | `.exam-question` | `calc(var(--type-question-stem-size) * var(--exam-font-scale, 1))` | question-stem × scale | 18 × scale | **No — and must not be flattened.** §2.6 |
| 31 | 688 | `.exam-question-stem` | `var(--type-question-stem-size)` | question-stem | 18 | No — already the step |
| 32 | 708 | `.exam-confirm` | `var(--type-body-md-size)` | body-md | 16 | No — already the step |
| 33 | 720 | `.exam-confirm-danger` | `var(--type-button-md-size)` | button-md | 16 | No — already the step |
| 34 | **760** | `.palette-square` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step. **Untouchable, §5.1** |
| 35 | 769 | `.palette-square.is-filled` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step (redeclares the base) |
| 36 | 776 | `.palette-square.has-notch` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step (redeclares the base) |
| 37 | **800** | `.palette-square.has-ring` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step. **Untouchable, §5.1** |
| 38 | 808 | `.palette-square.has-lock` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step (redeclares the base) |
| 39 | 832 | `.exam-palette-reason` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 40 | 860 | `.exam-calc-display` | `var(--type-timer-numeric-size)` | timer-numeric | 20 | No — already the step |
| 41 | 879 | `.exam-calc-key, .exam-calc-close` | `var(--type-mono-md-size)` | mono-md | 15 | No — already the step |
| 42 | 952 | `.exam-assertion-reason dt` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 43 | 974 | `.exam-options-legend` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 44 | 987 | `.exam-answer-status` | `var(--type-body-sm-size)` | body-sm | 14 | No — already the step |
| 45 | 1006 | `.exam-option-row` | `var(--type-option-label-size)` | option-label | 16 | No — already the step |
| 46 | 1020 | `.exam-option-row.is-selected` | `var(--type-option-label-size)` | option-label | 16 | No — already the step |
| 47 | 1033 | `.exam-option-row:has(input:disabled)` | `var(--type-option-label-size)` | option-label | 16 | No — already the step |
| 48 | 1062 | `.exam-match-left` | `var(--type-option-label-size)` | option-label | 16 | No — already the step |
| 49 | 1074 | `.exam-match-caption` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 50 | 1106 | `.exam-select, .exam-text-input, .exam-text-area` | `var(--type-body-md-size)` | body-md | 16 | No — already the step |
| 51 | 1121 | `.exam-select:disabled, .exam-text-input:disabled, .exam-text-area:disabled` | `var(--type-body-md-size)` | body-md | 16 | No — already the step |
| 52 | 1130 | `.exam-field-label` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 53 | 1149 | `.exam-unit` | `var(--type-mono-md-size)` | mono-md | 15 | No — already the step |
| 54 | **1160** | `.exam-blanks` | `var(--type-question-stem-size)` | question-stem | 18 | No — already the step. **But its `line-height` is not the step's — §2.3** |
| 55 | 1179 | `.exam-blank-input` | `var(--type-body-md-size)` | body-md | 16 | No — already the step |
| 56 | 1186 | `.exam-blank-input:disabled` | `var(--type-body-md-size)` | body-md | 16 | No — already the step |
| 57 | 1232 | `.exam-submit` | `var(--type-button-md-size)` | button-md | 16 | No — already the step |
| 58 | 1260 | `.exam-submit-heading` | `var(--type-heading-sm-size)` | heading-sm | 18 | No — already the step |
| 59 | 1285 | `.exam-receipt-ref` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 60 | 1309 | `.exam-score-value` | `var(--type-display-lg-size)` | display-lg | 44 | No — already the step |
| 61 | 1351 | `.exam-result-table caption` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 62 | 1366 | `.exam-result-table thead th` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |
| 63 | 1391 | `.exam-review-number` | `var(--type-mono-sm-size)` | mono-sm | 12 | No — already the step |

**Row count: 63, reconciling exactly with `grep -c "font-size:"` = 63.** The brief's floor was
"63 plus the shorthand hits"; the one shorthand hit (`font: inherit`, line 152) carries no size, so
it is recorded in §2.4 rather than as a 64th size row. Adding it as a row would be padding.

---

## 2. The literals that are not `font-size:` — Review Focus #1

This is where `exam.css`'s remaining non-token type values actually live. None is a size. Several
are load-bearing, and a sweep that "finishes the job" by tokenising them would change the runtime.

### 2.1 `font-weight:` literals — 9, and five are deliberate state carriers

| Line | Selector | Value | Note |
|---|---|---|---|
| 192 | `.exam-finding-mark` | `700` | `mono-sm`'s token weight is 400 |
| 197 | `.exam-finding-label` | `500` | |
| 512 | `.exam-timer-mark` | `700` | |
| 566 | `.exam-save-mark` | `700` | |
| 649 | `.exam-contrast-switch[aria-checked="true"]` | `700` | **Non-colour carrier for the checked state.** |
| 656 | `.exam-button[aria-pressed="true"]` | `700` | **Non-colour carrier for the pressed state.** |
| 801 | `.palette-square.has-ring` | `700` | **Untouchable — part of the "you are here" mark, §5.1.** |
| 1021 | `.exam-option-row.is-selected` | `500` | Non-colour carrier for selection. |
| 1326 | `.exam-verdict` | `600` | |

Every one is a weight the token's own weight does not supply, set so the state reads without colour.
**Tokenising any of them collapses a state's non-colour carrier.** They are not in `D8`'s scope
(`D8` names `font-size:`) and should stay out of it.

### 2.2 `letter-spacing: 0.08em` — 4

Lines **100** (`.exam-facts dt`), **1353** (`.exam-result-table caption`), **1368**
(`.exam-result-table thead th`), **1393** (`.exam-review-number`).

All four sit on `mono-sm` rules that also carry `text-transform: uppercase`. `mono-sm`'s token
letter-spacing is `0.3px`; at 12px, `0.08em` = `0.96px` — **more than triple**. These are a
deliberate tracking-out for small uppercase mono, not drift. Tokenising them tightens four labels.
Out of scope; recorded so nobody "fixes" them.

### 2.3 `line-height: 2.2` — 1, and it must not be tokenised

**Line 1161, `.exam-blanks`.** Unitless, so not a length and invisible to a length-hunting regex.
The rule's own comment (1156–1158) says the loose line-height is what keeps the inline blank fields
from colliding with the line above. At `question-stem`'s 18px, `2.2` ≈ **39.6px**; the step's own
line-height is **29px**. Replacing it with `var(--type-question-stem-line-height)` would shorten
every blanks row by ~10.6px and let the input boxes collide — a geometry change on the question a
candidate is answering, which is exactly what `D8` forbids. **Leave it.**

### 2.4 `font:` shorthand — 1, harmless

**Line 152, `font: inherit;`.** The shorthand resets the element to its parent's full font and
carries no size of its own. It is the one shorthand in the file and the one case a naive
`font-size:` regex misses — but here the miss costs nothing. Recorded so the search is auditable,
not because it needs action.

### 2.5 The one size that is load-bearing for contrast

**Line 47, `.exam-landing-hero h1`, `display-xl` (56px).** The file's own header comment (8–10, and
again at 53) records that cream on voltage is **3.86:1** — below the 4.5:1 body-text bar, legal only
under the large-text exemption, which needs ≥24px (or ≥18.66px bold). At 56px it clears comfortably;
the comment at 53 notes the same pairing would be **illegal at 22px**. **Any future reduction of
`display-xl` is an accessibility regression on the start page**, not a style choice. Nothing in this
task changes it; flagged so Task 3 can assert it.

### 2.6 The two `calc()` rows — the real trap in this file

Lines **393** (`.exam-runner`) and **680** (`.exam-question`) are
`calc(var(--type-*-size) * var(--exam-font-scale, 1))`. `--exam-font-scale` is the candidate's own
text-size control. The comment at 390–392 states the design explicitly: *everything in the runner
inherits from here, so no component measures a font size and no component branches on the setting.*

A sweep that normalises these two to a bare `var(--type-*-size)` — which is exactly what "convert
literals to scale tokens" reads like, since the `calc()` is the odd shape on the page — **silently
disables the text-size control for every candidate who needs it.** It would pass any review that
greps for remaining literals. These two lines are the highest-risk in the file, and the reason the
brief asked for the `clamp()`/`min()`/`max()` search: the dangerous shape here turned out to be
`calc()`, not `clamp()`.

---

## 3. Entries needing a new scale step — Review Focus #3

**Zero.**

Not "zero because everything rounded conveniently" — zero because there is nothing to round. Every
`font-size` already names a step exactly. No declaration in `exam.css` sits between two steps, so
the spec's allowance for new front-matter scale entries ("only where no existing step fits") is
never exercised.

**Task 2 has no front-matter additions to make from this file.** If Task 2 was planned as "add the
new steps the inventory found", it should be re-scoped or dropped.

---

## 4. Media-query and `@supports` context — Review Focus #2

**`exam.css` contains no `@media` and no `@supports` block.** `grep -n "@media\|@supports"` returns
nothing; the only at-rules in the file are the two `@import`s on lines 20–21. There is therefore no
declaration appearing twice at two widths, and no row whose correct step depends on its context.

This is a real answer, not an absent one: the responsive behaviour of the runner is carried by grid
and `min()`/`minmax()` sizing (lines 383, 1252), not by breakpoint-swapped type.

---

## 5. The untouchables — Step 3

Under `D1` the candidate runtime is the **sole** surface still using the vermilion `voltage` family.
These two are the affordances a candidate navigates by. Task 3 should assert each line below is
unchanged after the phase. Line numbers verified against `cat -n`.

### 5.1 The question palette's current-question square

**`.palette-square.has-ring`, lines 795–802:**

| Line | Declaration |
|---|---|
| 795 | `.palette-square.has-ring {` |
| 796 | `border-width: var(--exam-ring, 2px);` |
| 797 | `border-color: var(--color-voltage);` |
| 798 | `background: var(--color-canvas);` |
| 799 | `color: var(--color-voltage-deep);` |
| 800 | `font-size: var(--type-mono-sm-size);` |
| 801 | `font-weight: 700;` |
| 802 | `}` |

The comment at **793–794** states the intent: *the one place the voltage survives inside a live
attempt. The ring is the carrier, not the colour.* The 2px border is the carrier for a greyscale or
colour-blind reader. `--exam-ring` is the high-contrast hook — it is what makes 2px become 3px — so
line 796 must stay expressed as `var(--exam-ring, 2px)` and never be flattened to `2px`.

**Its geometry also depends on the base rule, `.palette-square`, lines 750–763** — `width: 36px`
(752), `height: 36px` (753), `border: var(--exam-edge, 1px) …` (755),
`border-radius: var(--rounded-sm)` (756), `font-size: var(--type-mono-sm-size)` (**760**),
`line-height: var(--type-mono-sm-line-height)` (761). The ring square inherits all of that and
overrides only width/colour/weight, so **a change to line 760 moves the "you are here" mark even
though line 800 is untouched.** Both lines are untouchable; assert both.

### 5.2 The focus ring

**`.exam-runner :focus-visible`, lines 895–898:**

| Line | Declaration |
|---|---|
| 895 | `.exam-runner :focus-visible {` |
| 896 | `outline: var(--exam-ring, 2px) solid var(--color-voltage-deep);` |
| 897 | `outline-offset: 2px;` |
| 898 | `}` |

Assert **896** and **897** unchanged. The comment at **892–894** carries the rule: *focus rings are
2px, 3px in high contrast, and never removed. A candidate driving this screen from the keyboard has
to be able to see where they are.* The same `--exam-ring` note as above applies to line 896.

### 5.3 Three more voltage marks worth the same treatment

Not named in the brief, but they are the rest of what `D1` left in this file and they share the
mechanism:

- **Line 1017, `.exam-option-row.is-selected`** — `border-color: var(--color-voltage)` with the 2px
  selected border (DESIGN.md's `option-row-selected`). This is the mark on the answer a candidate
  has chosen; it is as navigational as the palette square.
- **Line 1093** — `border-inline-start: 4px solid var(--color-voltage)`.
- **Lines 1227–1229, `.exam-submit`** — `var(--exam-edge, 1px)` border and `voltage-deep` fill. The
  comment at 1218 records that `voltage-deep` rather than `voltage` is a *contrast* decision (cream
  on voltage is 3.86:1 and a button label is body text), so the colour is not interchangeable.
- **Line 414** — `--color-voltage: var(--color-voltage-deep)` inside the runtime's inversion block.
  This remap is what makes the whole runtime's voltage legible; changing it changes every mark above
  at once.

---

## 6. Disposition

### 6.1 `D8` is closed as already satisfied

Ruled 2026-10-21 on this evidence: **6.5f performs no sweep.** `G6` — the runtime's type is on the
scale — was met before the phase began. §7 of the spec carries a one-line pointer recording it
("Pointer, not an amendment"), zero deletions, no ruling text changed. The branch ships this note,
the two guards in §7 below, and that pointer.

### 6.2 The nine redeclared sizes stay exactly as they are

Lines 648, 655, 667, 675 restate `button-md` that line 637 already sets; lines 769, 776, 800, 808
restate `mono-sm` that line 760 already sets; line 1121 restates `body-md` from 1106. Each is
harmless, and may well be deliberate — restating the size next to a state's weight or colour change
keeps the rule readable on its own. It could equally be tidied away for **no rendered change**.

**Observed and deliberately untouched.** The reason is the one governing this whole file: nobody can
tell from the source which it is, and *no test would catch a mistake made while tidying a runtime
declaration*. Freezing the geometry under conditions exactly like this is what `D8` is for. Line 800
is inside an untouchable rule in any case (§5.1).

### 6.3 Still open, and not pursued here

**`signal.css`'s 33 real literals.** `D8` puts `signal.css` out of scope explicitly ("the landing is
not in #187's scope list"), so this note goes no further than the count it needed to diagnose the
miscount. But it is the file the sweep's premise actually describes, and it is where a type-scale
sweep is genuinely available. Owner's call, not this phase's.

---

## 7. The two guards this finding left behind

No CSS changed. What changed is that two invariants nobody was asserting now are.

### 7.1 The `--exam-font-scale` guard — `apps/web/test/exam/runner.test.tsx`

Asserts that `.exam-runner` and `.exam-question` each multiply their `font-size` by
`var(--exam-font-scale)` **and** that the multiplied base is still a `var(--type-*-size)` step. It
asserts the *invariant* — the candidate's text-size control reaches the body text and the stem, off
a scale token — not the literal text of lines 393 and 680, so those rules may be renamed, rewritten
or moved as long as the control still arrives.

**Why it had to exist.** Verified by mutation: flattening line 393 to a bare
`var(--type-body-md-size)` — precisely what a sweep or a tidy-up does, since the `calc()` is the odd
shape on the page — **failed nothing in the suite before this guard existed**. The radios still set
`data-font-scale`, the existing attribute tests still passed, and at the default scale of 1 the page
is pixel-identical. Only the candidate who needs 1.5 finds out, mid-attempt, when they cannot report
a bug.

It reads the stylesheet rather than measuring a render, and that is an honest ceiling rather than a
shortcut: `apps/web`'s suite is jsdom, runs with `css: false`, and has no layout engine, so no
render in this workspace can report a computed font size at all.

### 7.2 The voltage containment guard — `apps/web/test/theme.test.ts`

Asserts the set of stylesheets whose own text uses `var(--color-voltage*)`, counted **per source
file** — question.css and registration.css are shared by both entries, so a resolved-bundle count
would blame the runtime for a sheet the organiser also loads. The file list is read off disk, not
written by hand, so a new stylesheet reaching for voltage cannot be invisible to it.

It asserts the set **true today** — `exam.css` and `registration.css`, plus `authoring.css`,
`base.css`, `primitives.css` and `testbuilder.css` — not `D1`'s end state. `D1` leaves the runtime
the sole voltage surface, but that happens as 6.5c, 6.5d and 6.5e re-ground each screen, and none
has merged; a guard written against the end state would be **red on arrival** and would be deleted
rather than believed. What it catches now is the invariant worth having: voltage **spreading** — a
new stylesheet reaching for the vermilion, or one that had given it up taking it back. 6.5e shrinks
the list; growing it is always a failure.
