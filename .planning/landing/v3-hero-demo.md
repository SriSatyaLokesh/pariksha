# v3 — the hero exam demo

> **Superseded in part.** `docs/superpowers/specs/2026-10-17-landing-page-v3-interactive.md` is the
> binding contract and it was revised against two adversarial reviews after this plan was written.
> Where this file and the contract disagree, **the contract wins** — notably on the hero's source
> order and fold arithmetic, the question order, the control row's no-JavaScript sentence, where
> `CB-1` is printed, the carriers of `H-3`/`H-4`, and the HTML byte budget. The contract's §10
> records what was rejected and why. Read this file for its reasoning, not for its tables.

Scope: the interactive "quick try" that becomes the hero's visual device, replacing the static
`ProductMock` runner mock (`apps/web/src/sections/s1-s3/Hero.tsx`). Everything here is design and
specification; no application code is written by this document.

Binding above this document: the owner's v3 brief (V1–V4), the controller decisions D1–D5, the v2
design contract `docs/superpowers/specs/2026-10-17-landing-page-v2-design.md` except where amended
below, `DESIGN.md`, `.planning/landing/constraints.md`, and the sourcing rule (D4): every claim on
the page appears in `.planning/landing/content-inventory.md` with a file path beside it.

This document amends the v2 contract in four named places. Each amendment is flagged **AMENDS**
with its reason, so a reviewer can reject one line rather than argue with the whole design.

---

## 0. The one-paragraph version

The hero's cream plane stops being a picture of a test and becomes a test. A visitor answers three
real questions from `examples/reasoning-aptitude/questions.json` — one single-choice, one
select-all-that-apply, one true/false — presses Finish, and sees a score produced by
`@pariksha/core`, the real grading module, bundled into the page. Nothing is sent anywhere. The
result panel ends by showing the visitor the JSON object that defined the first question, and that
object is the conversion: it turns a candidate into an organiser in one artefact. The timer does
not run, and the panel says so, because the real timer is server-enforced and a countdown in a
marketing hero is a pressure device.

---

## 1. How many questions, and which ones

### 1.1 The answer

**Three questions. Maximum score 5 points. Expected answering time 28 seconds.**

| # | id | type | scoring mode | points | expected time |
|---|----|------|--------------|--------|---------------|
| 1 | `LOG-001` | `single` | `all_or_nothing` | 2 | 8 s |
| 2 | `QNT-004` | `multiple` | `partial` | 2 | 15 s |
| 3 | `LOG-007` | `true_false` | `all_or_nothing` | 1 | 5 s |

Three distinct question types, two distinct scoring modes, three distinct control shapes (one
radio group, one checkbox group, one two-option radio group), and a maximum of 5 — a number that
is not round, which is itself evidence that points are per-question configuration rather than a
fixed scheme.

### 1.2 Why three, and why these three

**Why three.** The brief's own number is thirty seconds. Three questions at 8 + 15 + 5 seconds is
twenty-eight, leaving reading time inside the budget. A fourth question in this bank costs either
a second arithmetic question (the visitor's attention is thinnest at position four, and two
divisibility problems in a row is a chore) or a second question of a type already shown, which
buys nothing.

**Why `LOG-001` first.** It is the question the static mock already carries, so the prerendered
first paint is a near-unchanged version of what ships today — the smallest possible diff on the
page's highest-value HTML, and continuity with the README, which draws the same series. It is
solvable in one thought (double, add one), which is what an on-ramp question has to be: the
visitor must recognise "this is an exam question" and answer it before deciding whether to
participate.

**Why `QNT-004` second, and why it is the load-bearing one.** It is the only question in the set
that can produce a **fractional score**, and a fractional score is the single artefact on the page
that a static mock could not fake. `QNT-004` has five options and a three-option key under
`partial` mode, so `applyMode`'s `points × (correct − wrong) / total` reaches 0.67 and 1.33 on
realistic answers. A visitor who ticks 114, 222 and 128 scores **0.67 out of 2** — two correct,
one wrong, three parts — and that number is the proof that something is doing arithmetic rather
than comparing a string to a string. A visitor who guesses badly still gets a fractional score, so
the demonstration fires either way.

`QNT-003` (`select_k`, k = 2) was considered for this slot and rejected on arithmetic: with two
parts, `partial` collapses to binary — two correct scores 2.00, one correct and one wrong scores
`2 × (1 − 1) / 2 = 0`, floored at 0. "I got one of the two right and scored nothing" is a
confusing first contact with the product, and it wastes the only slot that can show partial
credit. The same objection disqualifies `QNT-005` (`fill_blank`, two blanks), which is also
excluded by §1.3.

**Why `LOG-007` last.** Five seconds, one line, and a small pleasure when the penny drops
(E→F, A→B, R→S, T→U, H→I). The demo should *end* fast. It is also worth **1 point**, not 2, which
is the cheapest possible demonstration that a test author sets points per question.

### 1.3 What the byte budget decided, and why this set is choice-family only

D1 caps the island at **10 KB of JavaScript, minified**. Measured against the built
`packages/core/dist` (comments and whitespace stripped, which tracks minified output within about
25%):

| module | stripped bytes | in the island? |
|--------|---------------:|----------------|
| `grade/choice.js` | 1 384 | **yes** |
| `grade/result.js` (`applyMode`, `round2`) | 1 895 | **yes** |
| `types.js` | 268 | **yes** |
| `grade/text.js` | **6 931** | no |
| `grade/structured.js` | 1 386 | no |
| `grade/manual.js` | 393 | no |
| `grade/index.js` (the dispatcher) | 511 | no |
| `score.js` (`scoreAttempt`) | 1 133 | no |

`grade/text.js` is 6 931 bytes because `fill_blank` carries the ReDoS-safe regex validator — a
recursive pattern parser, a compile cache and four rejection paths. It is excellent code and it is
almost entirely unreachable by a demo whose blanks would use `"match": "exact"`, but a bundler
cannot know that: `matchBlank` references `compilePattern` statically. Including one `fill_blank`
or one `numeric` question therefore costs roughly 4–5 KB minified, and including the dispatcher
(`gradeQuestion`) or `scoreAttempt` pulls `text.js`, `structured.js` and `manual.js` whether the
demo uses them or not — about 10.4 KB minified of core before a single line of UI.

So: **every demo question is in the choice family** (`single`, `multiple`, `select_k`,
`true_false`, `assertion_reason`), which is the family `gradeChoice` alone serves. Core bytes in
the island: 3 547 stripped, roughly **2.2 KB minified**, leaving about 7.8 KB for the UI.

This is the measured reason the set is not more varied, and it belongs in the implementation PR
rather than being discovered by a reviewer. It also sets the escape hatch: **if the controller
raises the island budget to 16 KB, insert `QNT-005` (`fill_blank`, `partial`, 2 pts, blanks `56`
and `224`) as question 2** — six seconds, a typed answer rather than a click, and the best fourth
question in the bank. Nothing else in this document changes.

Rejected: splitting the regex machinery out of `packages/core/src/grade/text.ts` so the demo can
tree-shake it. Reshaping a graded, tested, security-relevant module in the product's core to make
a marketing page 4 KB smaller is exactly backwards.

### 1.4 How the island reaches the real scoring

Try in this order and stop at the first that measures under 10 KB minified:

1. **`gradeQuestion` + `scoreAttempt` from the public barrel.** Maximum fidelity, zero changes to
   `packages/core`. Expected ~12 KB total; expected to fail the budget. Measure it anyway so the
   number is in the PR.
2. **`gradeChoice` + `round2`, promoted to the public surface.** Add to
   `packages/core/src/index.ts`:
   ```ts
   export { gradeChoice } from "./grade/choice.js";
   export type { ChoiceQuestion } from "./grade/choice.js";
   export { round2 } from "./grade/result.js";
   ```
   with a comment naming the landing demo as the consumer, and add `"sideEffects": false` to
   `packages/core/package.json` so Rollup drops `validate.js` (and with it `ajv`), `select.js` and
   `rng.js` from the barrel. **This is the expected shipping path.**
   `packages/core/test/acceptance.test.ts` forbids importing `@pariksha/core/src/...`; a declared
   public export is not that, and the demo must not deep-import.
3. If even (2) misses the budget: cut the Mark-for-review control (§2.5), then the palette's
   navigation behaviour, in that order.

Under (2) the island sums the three results itself:

```ts
const results = QUESTIONS.map((q) => gradeChoice(q, answers[q.id] ?? null, DEFAULTS));
const total = round2(results.reduce((sum, r) => sum + r.points, 0));
```

This is **not** a reimplementation of grading: every point value comes out of `gradeChoice`, and
the rounding is `round2`, the real function. `scoreAttempt`'s own extra jobs — per-section
aggregation and a pass mark — do not exist in a one-section demo with no pass mark.

`DEFAULTS` is `{ mode: "all_or_nothing", negativeFraction: 0.25 }`. Every demo question declares
its own `scoring.mode`, so the default never applies; it is passed because the signature requires
it. **No pass mark is passed**, anywhere — see §3.1.

---

## 2. The exact interaction

### 2.1 Landing — before the visitor touches anything

Question 1 is on screen, fully rendered, already answerable. **There is no Start button.** A start
button costs a click and buys nothing; "quick try" means the visitor can answer before deciding to
participate. There is no overlay, no "click to begin", no blurred preview.

The panel's chrome row carries two strings, in `mono-sm` muted, at the same positions the real
runner's section line and timer occupy:

```
DEMO · 3 QUESTIONS                                              Timer off
```

### 2.2 Answering

| Question | Control | `ResponseValue` the island builds |
|---|---|---|
| `LOG-001` | four `<input type="radio" name="LOG-001">` in a `<fieldset>` | `{ kind: "option", option: "c" }` |
| `QNT-004` | five `<input type="checkbox">` in a `<fieldset>` | `{ kind: "options", options: ["a","c"] }` |
| `LOG-007` | two `<input type="radio" name="LOG-007">` — True, False | `{ kind: "boolean", value: true }` |

Every control is a native form control. Nothing is a `div` with a click handler. Native radio
groups give arrow-key selection, roving focus and a single tab stop for free; native checkboxes
give Space-to-toggle; both announce their state to a screen reader without a single ARIA
attribute. §5 is mostly a list of things not to reimplement.

There is **no `<form>` element**: a form with no action is a submit-on-Enter trap on a page with
nowhere to submit to. The three `<fieldset>`s stand on their own.

**Selecting an answer never advances the question.** This is the easiest mistake to make here and
it feels slick, which is why it is named again in §7: auto-advance steals the chance to change an
answer, fires once per arrow-key press inside a radio group, and leaves a visitor who mis-tapped
on a phone with no way back to the thing they just got wrong.

**Answers can be changed freely**, at any time, until Finish — by re-selecting, by unticking a
checkbox, or by navigating back. The real runner allows this within a section (`PRD` C-04;
`examples/reasoning-aptitude/test.json` sets `navigation: "per_section"`), and a demo that locked
answers would teach a falsehood about the product.

### 2.3 The timer — present, labelled, and not running

**AMENDS** the v2 contract's S1 and `ui-direction.md` §3.3 constraint 2, which specify a static
timer string (`08:41`). A frozen number on a surface that is now interactive is a lie with a face
on it. The timer slot instead reads **`Timer off`**, and the result panel explains it in one
sentence.

Three reasons, strongest last.

1. A countdown in a marketing hero is a pressure device. The brief names dark patterns as a thing
   to design against, and artificial urgency is the canonical one.
2. It keeps the motion budget at zero. No `setInterval`, no `requestAnimationFrame`, no repainting
   digit. `ui-direction.md` §5.2 survives intact and the `prefers-reduced-motion` page stays
   pixel-identical to the default page, which §5.3 makes the test that the motion budget is right.
3. The real timer is **enforced on the server** (`PRD` C-07: "Start: fullscreen, server timer";
   `PRD`:45 "every rule is enforced on the server"). A client-side countdown in the demo would
   misrepresent the one property that makes the real timer trustworthy. Saying `Timer off`, and
   then on the result panel *"a real attempt runs its clock on the server, not in your browser"*,
   converts a missing feature into the clearest statement of the product's architecture available
   anywhere in the hero. That is the best trade on the page.

### 2.4 The palette

Three squares, numbered 1–3, in the existing `palette-square` token family, below the question and
above the controls — the position it occupies in the real runner.

| State | Token | When |
|---|---|---|
| current | `palette-square-current` — 2 px `--color-voltage` border, `--color-voltage-deep` figure | the question on screen |
| answered | `palette-square-answered` — `--color-state-answered` fill, cream figure | the question has any response |
| marked | `palette-square-marked` — `--color-state-marked` fill, cream figure | the visitor pressed Mark |
| default | `palette-square` — hairline border, ink figure | untouched |

A square is a jump target: pressing it shows that question. Marked and answered compose — a marked
and answered question takes the marked fill and keeps its answered state in the accessible label,
which is how the real palette behaves and is why `color-not-only` (§5.4) matters here.

The `locked` state is **cut**. It means "this section's time has ended and you cannot return", and
there are no sections and no clock in a three-question demo; rendering it would be decoration. Its
absence is named in the result panel's "what the real runner also has" line, where it costs
nothing.

### 2.5 The control row

Four controls, in this order and at these weights:

| Control | Element | Weight | Behaviour |
|---|---|---|---|
| `Back` | `<button type="button">` | secondary | previous question; `disabled` on question 1 |
| `Mark for review` | `<button type="button" aria-pressed>` | tertiary, text only | toggles the marked flag on the current question |
| `Next` | `<button type="button">` | secondary | next question; `disabled` on question 3 |
| `Finish (n of 3 answered)` | `<button type="button">` | **primary** | scores and shows the result panel |

**Finish is available from question 1.** A visitor who answers one question and stops gets a real
score for one question. Nothing is gated behind completing the set.

**The Finish label always carries the count** — `Finish (0 of 3 answered)`, `Finish (2 of 3
answered)` — so the score is never a surprise and no confirmation dialog is needed. The real runner
does show a confirmation with unanswered and marked counts (`PRD` C-08); a modal in a hero is a
tax, and putting its content in the button label is the same information for nothing.

**Mark for review** is the one element an implementer may cut under byte pressure (§1.4 step 3). It
earns its place otherwise: `PRD` C-04 lists it, `DESIGN.md` already defines
`palette-square-marked`, the CSS for it already exists in
`apps/web/src/styles/sections-s1-s3.css`, and it costs one boolean per question. It is also the
clearest "this is an exam runner, not a quiz widget" signal in the panel.

Cut, and named as cut: **Clear answer** (`PRD` C-04). In a three-question demo the only
un-clearable responses are the two radio groups, and a dedicated control for that is not worth a
fifth button and a fifth keyboard target.

### 2.6 Finish

One press. No confirmation, no delay, no spinner (§7.2). `gradeChoice` runs three times in
microseconds and the result panel replaces the question list, the palette and the control row
**inside the same panel**, so the voltage-and-cream composition of the hero does not change and the
page above does not move.

### 2.7 A second run in the same page view

The result panel's last control is **`Try again`**, a tertiary text button. It returns to question
1 with **every answer cleared and every mark cleared**. The palette resets to one current and two
default.

Answers are not preserved across a retry: preserving them means the second run produces the same
score, which is a dead end. There is nothing to preserve them in anyway (D3 — no storage of any
kind), so a page reload is also a clean run, and the implementer should not reach for
`sessionStorage` to "improve" this.

There is no retry limit, no "sign up to try again", and no change in the questions between runs (no
shuffling — §8.6).

---

## 3. The end state

The result panel, top to bottom.

### 3.1 The score

```
You scored 3.67 out of 5
73% · this demo sets no pass mark
```

`timer-numeric` for the figures (tabular, which is what that token exists for), `heading-sm` for
the sentence. **There is no pass or fail, and the word "Fail" appears nowhere.** The demo passes no
`passMarkPercent`, which in the real engine makes `AttemptScore.passed` `null` — so the absence is
not a softening, it is what the API returns when a test declares no pass mark. The worked example's
own test does set one (`pass_mark_percent: 50`, `test.json`), and the result panel's closing prose
may say so; the demo does not.

If nothing was answered, the second line instead reads: *"You did not answer any of them. Try
again, or read the file below."* Punitive framing is not available and not wanted.

### 3.2 The per-question key

Three rows, one per question, each carrying four fields and — conditionally — a fifth.

```
Q1   single        2.00 / 2    Correct
Q2   multiple      0.67 / 2    Partly correct
     A number is divisible by 6 when it is even and its digits add to a multiple of 3.
     128 fails the digit test (1+2+8 = 11) and 345 is odd.
Q3   true_false    0.00 / 1    Wrong
     E→F, A→B, R→S, T→U, H→I.
```

- The type name is in `mono-sm`, verbatim from the format (`single`, `multiple`, `true_false`) —
  not a friendly paraphrase. The format's own vocabulary is the thing being sold.
- Points over max in `timer-numeric`, two decimal places always, so `2.00` and `0.67` align.
- **The verdict is a word**, and the word is mandatory: `Correct` / `Partly correct` / `Wrong` /
  `Not answered`. Colour (`--color-state-answered`, `--color-flag-risk`, `--color-muted`) is a
  second carrier, never the only one (A11, `color-not-only`).
- `Partly correct` is shown when `0 < points < max`. It is reachable only on `QNT-004`, which is
  the point of `QNT-004`.
- `Not answered` is distinguished from `Wrong` by the island's own `answers[id] === null` check,
  not by `GradeResult.correct` — `applyMode` returns `correct: false` for a blank, correctly, and
  the distinction is presentation.

**The explanation is shown when the question was attempted and is not fully correct**, and is
otherwise omitted. A correct answer needs no explanation; an unanswered question must not be handed
its answer. The text is the `explanation` string from `questions.json`, verbatim.

### 3.3 The two honesty lines

Directly beneath the key, as prose, in `body-sm` — not a banner, not a callout box, not an
asterisk. Substance, which copy may polish:

> **What just happened.** The scoring is real: `@pariksha/core`, the module that will grade every
> attempt, is bundled into this page. Questions 1 and 3 are all-or-nothing; question 2 is
> partial-credit, which is why its score has a decimal. A question left blank scores zero and never
> loses points. The worked example's own test adds negative marking at a quarter of a question's
> points for a wrong answer.

> **What is not real.** In this demo the answer key is in the page — there is no server here, and
> nothing is at stake. In a real attempt the key never reaches the browser, grading happens on the
> server, and the clock runs there too. The scoring engine, the formats, the schemas and this
> worked example are published today; the runner, the server, proctoring and the results CSV land
> with v0.1.

Sources, for the sourcing rule: `PRD`:45 (keys never reach the browser, server-enforced rules),
`PRD` C-07 (server timer), `README.md`:22 and `content-inventory.md` §"The application does not
exist yet" (what ships today), `examples/reasoning-aptitude/test.json` (`default_mode: "negative"`,
`negative_fraction: 0.25`, `pass_mark_percent: 50`), `packages/core/src/grade/result.ts`
(`applyMode`'s blank-scores-zero rule).

The second line is, on the merits, the most quotable sentence on the page, and it exists because
the demo creates the problem it answers. That is the best possible shape for a disclosure: the
compromise is admitted in the same breath as the architecture that makes it unnecessary in
production.

### 3.4 The bridge — "I just took an exam" → "I could run one"

**The bridge is the JSON.** Beneath the demo panel, as its own prerendered band, sits a code block
containing `LOG-001` exactly as it appears in `examples/reasoning-aptitude/questions.json` — `id`,
`type`, `prompt`, `options`, `key`, `difficulty`, `tags`, `scoring`, `explanation` — with the
heading:

> ## The three questions above are this file.

and, beneath the block, one sentence: *"Seventeen questions like it are in the worked example,
together with the test that draws from them, the candidate list, and the results CSV it produces."*
Then the primary CTA (`Start with the worked example`, unchanged href) and the secondary (`Read the
code on GitHub`).

Why this is the bridge, against the alternatives:

- It answers the question the visitor is actually holding at that moment, which is *"how did it
  know?"*. The honest answer is *"because somebody wrote the key"*, and seeing the key sitting in a
  JSON object next to the `explanation` they just read **reframes them from candidate to organiser
  in one artefact**. That reframing is the conversion. A feature list cannot do it; a pricing table
  cannot do it; a "Get started" button certainly cannot.
- It is the shortest path from the experience they just had to the artefact they would have to
  produce. No abstraction layer in between.
- It costs no new component — `CodeBlock` is already in the page's inventory, already styled,
  already syntax-coloured, already contrast-checked.
- It carries the disclosure of §3.3's second line as a *demonstration* rather than a claim: the key
  is visibly right there in the object.

**The bridge band is prerendered and always visible**, not built by the island and not inside the
result panel. Three reasons: a crawler and an answer engine must see it (D4 — the island's output
is invisible to both); a visitor who skips the demo entirely still gets it; and it is the best
prose in the hero region, which is where ~44% of AI citations are drawn from (v2 contract §5). The
result panel's last link is an in-page anchor down to it.

### 3.5 `Try again`

Last, lowest weight, a text button. §2.7.

### 3.6 What the result panel does not contain

No share control, no "you beat n% of visitors" (there is no data — D3 — so any such number is a
fabrication), no streak, no email capture, no "see your detailed report", no certificate, no
confetti, no sound.

---

## 4. The first paint

D2 is the hard constraint: the prerendered HTML carries a real question, and with JavaScript off,
blocked or still loading, the visitor sees a genuine question and the page is whole.

### 4.1 The rule that decides what is prerendered

> **Content is prerendered. Anything that only works with JavaScript is created by the island.**

| Prerendered | Island-created |
|---|---|
| panel chrome (`DEMO · 3 QUESTIONS`, `Timer off`) | `Back` / `Mark` / `Next` / `Finish` buttons |
| all three questions: stem, legend, every `<input>` and `<label>`, "Question n of 3", type and points | the palette as navigation (`<button>`s with labels) |
| the palette as inert status (`<span>`s, `aria-hidden`) | the entire result panel |
| the empty `aria-live` region | — |
| the fallback link (§4.3) | — |
| the bridge band (§3.4) | — |

The radio and checkbox inputs are the deliberate exception: they are prerendered **and they work**
with JavaScript off. Selecting an option with no grader attached is an inert form, not a dead end —
**provided the page says so, which this plan asserted and never specified.** §4.3 below contains no
such words and neither does the fallback link's text. The contract closes the gap (§2.8, `H-9`,
`T34`): the control row prerenders the literal sentence *Scoring, and questions 2 and 3, need
JavaScript.* before the link, and the test asserts the string.

### 4.2 Markup shape

Indicative, not final — class names reuse the existing `.runner-mock` block (§8.1).

```html
<div class="runner-mock runner-mock--demo" data-demo>
  <h2 class="runner-mock__title" id="demo-heading">Try three questions</h2>
  <p class="runner-mock__sub">
    Scored in your browser by Pariksha's own scoring engine. Nothing you type leaves this page.
  </p>

  <div class="runner-mock__panel" role="group" aria-labelledby="demo-heading">
    <div class="runner-mock__header">
      <span class="runner-mock__section">DEMO · 3 QUESTIONS</span>
      <span class="runner-mock__timer">Timer off</span>
    </div>

    <p class="visually-hidden" aria-live="polite" data-demo-live></p>

    <ol class="runner-mock__questions">
      <li class="runner-mock__q" id="demo-q-1" data-qid="LOG-001" tabindex="-1"
          aria-labelledby="demo-stem-1">
        <div class="runner-mock__stem-row">
          <span class="runner-mock__question-of">Question 1 of 3</span>
          <span class="runner-mock__points">single · 2 pts</span>
        </div>
        <fieldset class="runner-mock__fieldset">
          <legend class="runner-mock__stem" id="demo-stem-1">
            What comes next in the series?<br />3, 7, 15, 31, 63, ?
          </legend>
          <label class="runner-mock__option">
            <input type="radio" name="LOG-001" value="a" /><span>95</span>
          </label>
          <label class="runner-mock__option">
            <input type="radio" name="LOG-001" value="b" /><span>117</span>
          </label>
          <label class="runner-mock__option">
            <input type="radio" name="LOG-001" value="c" /><span>127</span>
          </label>
          <label class="runner-mock__option">
            <input type="radio" name="LOG-001" value="d" /><span>131</span>
          </label>
        </fieldset>
      </li>

      <li class="runner-mock__q" id="demo-q-2" data-qid="QNT-004" tabindex="-1" hidden> … </li>
      <li class="runner-mock__q" id="demo-q-3" data-qid="LOG-007" tabindex="-1" hidden> … </li>
    </ol>

    <div class="runner-mock__palette" aria-hidden="true" data-demo-palette>
      <span class="runner-mock__square runner-mock__square--current">1</span>
      <span class="runner-mock__square">2</span>
      <span class="runner-mock__square">3</span>
    </div>

    <div class="runner-mock__controls" data-demo-controls>
      <a class="runner-mock__fallback"
         href="https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude">
        These three questions, and fourteen more, are in the worked example
      </a>
    </div>
  </div>
</div>
```

Questions 2 and 3 ship **in the HTML**, each in a `<li hidden>`. `hidden` keeps them out of the
accessibility tree and off the screen while leaving their text in the document, which is exactly
what is wanted: a crawler reads three real questions, a screen-reader user with JavaScript off
hears one complete, operable question rather than three overlapping ones.

### 4.3 The upgrade, without a flash and without a dead control

The control row ships containing **only** the fallback link — a real `<a>` to the worked example.
It is not a disabled button, and no button ships hidden-then-shown. On init the island replaces
that row's contents with the four buttons, in **one** DOM mutation, and replaces the inert palette
`<span>`s with labelled `<button>`s in a second.

Why this construction rather than shipping the buttons `hidden`:

- A `disabled` button that lights up a moment later is a flash of a different kind.
- A visible button that does nothing because the module has not loaded is the dark pattern this
  whole design is avoiding.
- A dead end for a no-JavaScript visitor is forbidden by D2, and a link onward is not a dead end.

**No layout shift.** The control row and the fallback link occupy the same row with the same
`min-height`, so even a visible swap costs no reflow of anything below. The question area carries a
`min-height` sized to the tallest question (question 2, five option rows) so that moving between
questions does not move the page under a reader's thumb — one declaration, and it is the whole
anti-CLS measure. Nothing else in the panel changes size at any point in the flow.

**No flash of unanswered state.** On init, the island **reads the DOM's current checked state into
its model** rather than resetting it. A visitor on a slow connection who ticks an option before the
module arrives keeps that answer. This is a two-line requirement and it is the difference between
progressive enhancement and hydration.

The island is a deferred ES module from `/assets/`, loaded with `<script type="module" src="…">`.
It cannot be inline (CSP `default-src 'self'`, `script-src 'self'`, no `'unsafe-inline'`) and it
cannot come from a third-party origin. `public/_headers` needs no change — which is the test that
this construction is the right one.

### 4.4 What the prerendered HTML must not contain

The result panel, in any form. No score, no verdict words, no "You scored" string. An answer engine
lifting a result from the HTML would be lifting a claim about a product that does not run yet (D5),
and the bytes are better spent on the bridge band.

---

## 5. State and keyboard

### 5.1 The island's state

```ts
{
  current: 0 | 1 | 2,
  answers: Record<string, ResponseValue | null>,   // the real @pariksha/core type
  marked: Set<string>,
  finished: boolean,
}
```

Plain object, plain functions, one render function that reads the state and writes the DOM. No
framework, no reactive library, no state-machine library, no virtual DOM. React stays a build-time
renderer (D1).

### 5.2 Keyboard, in full

| Action | Keys | Mechanism |
|---|---|---|
| Move within a radio group, selecting as you go | `↑` `↓` `←` `→` | **native**, from `<input type="radio">` sharing a `name` inside a `<fieldset>`. Do not reimplement, do not add `role="radiogroup"`, do not manage `tabindex`. |
| Toggle a checkbox | `Space` | **native** |
| Move between controls | `Tab` / `Shift+Tab` | native. A radio group is one tab stop; each checkbox is its own. |
| Advance to the next question, or Finish on the last | `Enter` | the one custom binding — a `keydown` listener on the panel |
| Press a button, jump to a palette square | `Enter` / `Space` | native `<button>` |

`Enter` is announced, not hidden: the control row carries `Enter →` as a `mono-sm` muted hint beside
`Next`. An undiscoverable shortcut is not an accessibility feature.

There is **no pointer-only interaction anywhere in the demo**, and nothing depends on hover.

### 5.3 Focus

- **On navigation** (Next, Back, or a palette jump) focus moves to the newly shown `<li>`, which
  carries `tabindex="-1"` and `aria-labelledby` pointing at its stem. A screen reader then
  announces the question number, the stem and the group before the visitor reaches the first
  option. Focus does **not** go to the first input: that would skip the stem and would hijack the
  arrow-key semantics the radio group owns.
- **On Finish** focus moves to the result panel's `<h3>`, which carries `tabindex="-1"` and whose
  text is `You scored 3.67 out of 5`. That single move does the announcing.
- **On Try again** focus moves to question 1's `<li>`.
- **The focus ring is the voltage ring**, unchanged — `DESIGN.md` makes voltage the focus ring in
  the runner, and this is the runner's surface. `outline: none` without a replacement appears
  nowhere (A9).

### 5.4 Announcements

**One** `aria-live="polite"` region, visually hidden, present in the prerendered HTML and empty.

- On navigation it receives: `Question 2 of 3. Select all that apply. 2 points.`
- On Mark: `Question 2 marked for review.` / `Mark removed from question 2.`
- On Finish it receives **nothing** — the focus move to the score heading announces it. Two
  mechanisms firing on one event is a double announcement, which is worse than neither.

Accessible names that colour would otherwise carry:

- Each palette button: `aria-label="Question 2, answered"` / `", not answered"` / `", marked for
  review"`, and `aria-current="true"` on the current one. The visible text is a bare numeral; the
  state is a fill colour; the label is the second carrier (A11).
- `Mark for review` carries `aria-pressed`.
- Each key row in the result carries its verdict as a word in the DOM, not as a colour or a glyph.

### 5.5 Touch targets

- Option rows: `min-height: 48px` — already in `sections-s1-s3.css`, unchanged.
- Palette squares: the visual box stays **36 × 36** (it is a design-system token). Each is wrapped
  so the button's hit area reaches **44 × 44** through padding without changing the visual box — the
  same pattern A10 already applies to nav links and `ButtonSecondary`. The palette strip is
  therefore 44px tall, not 36px.
- Every button in the control row: `min-height: 44px`, `8px` minimum gap between adjacent targets.
- Checkbox and radio hit areas are the whole 48px `<label>` row, not the 16px control.

### 5.6 Motion

The demo introduces **no new motion**. The only transitions anywhere in it are the page's existing
120 ms colour-and-border transitions on interactive elements, already declared inside the
`@media (prefers-reduced-motion: no-preference)` guard with `transition: none` as the base (P8). No
fade between questions, no slide, no progress-bar fill, no count-up on the score. The
reduced-motion page stays pixel-identical to the default page, and P9 survives unamended.

---

## 6. Honesty in the UI itself

D5: a visitor who has just taken an exam will assume the product exists. Three placements, in
increasing depth, so the correction is never a single dismissible object.

**1. Panel chrome, always on screen.** `DEMO · 3 QUESTIONS` sits where the real runner reads
`Section 2 of 3 · Logical reasoning`, and `Timer off` sits where the clock would be. `mono-sm`,
muted, in the same register as the hero's existing `PRE-ALPHA · APACHE-2.0` chip. A visitor cannot
look at the panel without reading the word DEMO.

**2. The panel's own label, above it.** The `h2` reads **"Try three questions"**, and beneath it, in
`mono-sm`: **"Scored in your browser by Pariksha's own scoring engine. Nothing you type leaves this
page."**

That subline is the most important string in this design. It does three jobs in seventeen words: it
says this is a demonstration; it says which part is real (the engine — D5's "much better story");
and it discharges D3 **before** the visitor types anything, which is the only moment at which a
privacy promise is worth making.

**3. The result panel's two prose lines**, §3.3 — what just happened, and what is not real.

**What the honesty must not be.** Not a modal. Not a dismissible banner. Not an asterisk with a
footnote. Not a tooltip. Not italics-in-parentheses. All five read as a disclaimer bolted onto a
pitch; chrome and prose read as a stance. That is D5's "without deflating the demo", and it is the
same move the v2 contract already made when it promoted the pre-alpha caption out of an orphan band
and into a cream chip in the hero.

---

## 7. What it must not do

Each of these is a failure mode this design is actively shaped against. An implementer who finds
themselves building one of them has lost the thread.

1. **No score wall.** The score appears on Finish, unconditionally. No email, no sign-up, no
   "unlock your full report", no account. This is the single most common pattern in this exact
   genre and it would destroy the page's entire argument in one interaction.
2. **No fake loading.** No spinner, no "Grading…", no artificial delay, no progress bar. Three
   `gradeChoice` calls return in microseconds; the result renders in the same frame. A simulated
   round-trip on a page that has just promised nothing leaves the browser is a lie with a moving
   part.
3. **No urgency.** No countdown, no "1 question left!", no red state, no auto-submit, no
   time-pressure copy.
4. **No fabricated social proof.** No "you beat 73% of visitors", no leaderboard, no streak, no
   share-your-score. There is no data (D3), so any such number would be invented.
5. **No network, no storage, no telemetry.** No `fetch`, `XMLHttpRequest`, `WebSocket`,
   `navigator.sendBeacon`, `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, or
   `PerformanceObserver` reporting anywhere in the island. Expect — and write — a test that greps
   the built bundle for every one of those identifiers. D3 is absolute.
6. **No auto-advance on selection.** §2.2.
7. **No pass or fail.** No `passMarkPercent`, no "Fail", no red "did not pass". §3.1.
8. **No answer-key leak presented as a feature.** The key is in the page because there is no server;
   say so once, plainly (§3.3), and never imply that client-side grading is the product's design.
9. **No retry gate.** `Try again` is unlimited, immediate and free.
10. **No `transform: scale()`** on the panel to make it fit. `ui-direction.md` §3.3 constraint 1
    survives: *cropping is a design decision; scaling is an accident* — and here, not even cropping
    (§8.2).
11. **No emoji, and no glyph as the only carrier.** Correctness is a word. `✓` and `✗` are not
    permitted even as decoration beside the word (A13).
12. **No confetti, no sound, no haptics.**
13. **No reimplementation of grading.** If a line of the island computes a point value, it is wrong.
    Every number on the result panel comes out of `gradeChoice` or `round2`.

---

## 8. Responsive

### 8.1 Reuse before new CSS

The demo reuses the existing `.runner-mock__*` block — `__header`, `__section`, `__timer`, `__stem`,
`__option`, `__option--selected`, `__palette`, `__square` and its state modifiers are already
defined at true token sizes in `apps/web/src/styles/sections-s1-s3.css` and already pass the
contrast gate. New selectors are needed only for `__questions`, `__q`, `__fieldset`, `__controls`,
`__fallback`, `__title`, `__sub`, `__result`, `__key` and `__score`.

**Every new selector that declares `color:` must be added to `contrast-usage.test.ts`'s `SURFACE`
map, or A1 fails the build.** The panel is a cream plane, so the surface for all of them is cream,
not white — which is the stricter check.

Two CSS notes the implementer will otherwise hit: `<legend>` needs
`display: block; width: 100%; padding: 0; float: none;` to lay out as a normal block, and the
selected-option styling now comes from `:has(input:checked)` on the `<label>` rather than from a
server-rendered modifier class.

### 8.2 Desktop — and the bleed is withdrawn

**AMENDS** the v2 contract's S1 ("the mock begins at the 7fr column's right edge and runs past the
1080px wrap to the viewport's right edge, cropped mid-palette") and acceptance **P10**.

**The demo panel does not bleed. It sits wholly inside the wrap.**

The bleed existed to stop a static postcard at true token sizes looking cramped in a 433px column.
An interactive panel has the opposite requirement: **a control cropped by the viewport edge is a
control nobody can press.** Cropping an exam is a worse picture than showing a whole one, and every
escape — "bleed, but keep interactive elements inside" — produces a rule an implementer has to
re-derive at every breakpoint.

The column split stays **7fr / 5fr**. Widening to 6fr/6fr was considered and rejected: it pushes the
56px `h1` to four lines at the ~520px measure, and the v2 contract spent two paragraphs establishing
that three balanced lines is the register `DESIGN.md` asks for.

The panel absorbs the narrower column by dropping its own inner padding from `--space-xl` (24px) to
`--space-lg` (16px) in the two-column state, giving **401px of content** at the 1080px wrap. At
`question-stem` (18px/29) that is roughly a 47-character measure — tight against
`line-length-control`'s 60–75 desktop guidance, and acceptable here because the stems are one or two
sentences, not prose. Option rows, palette and controls all fit comfortably.

P10 becomes vacuous — nothing bleeds — which is a strictly safer state for **P6** (no body-level
horizontal scrollbar at any width). Below the two-column breakpoint the panel returns to
`--space-xl` padding.

### 8.3 Hero order, and one consequence for the hero copy

Source order, at every width: **chip → h1 → lead → demo panel → CTA row.** At desktop the grid
places the demo in the 5fr column and the rest in the 7fr column; the DOM is never reordered by CSS,
so tab order follows source order (A9).

**The consequence, flagged for whoever owns the hero copy.** The brief requires the demo to be the
first thing on a phone screen. At 400px the stack above it measures roughly: chip 28px, gap 24px,
`h1` at its clamp floor over three lines ≈ 110px, gap 24px, lead. The v2 contract's lead is ~45
words, which at 24px/34 across 368px is nine lines ≈ 306px — putting the panel's first option at
about 560px, below the fold on a typical phone.

**The lead must shorten to one sentence of no more than 30 words**, which at ~5 lines puts the stem
and first option on screen. The sentence must keep the dated status clause (*as of October 2026…*,
mandated by `seo-mechanics.md` §3.5e) and must still not claim the application ships today. The four
capability nouns the old lead carried — question pools, twelve question types, browser proctoring,
CSV results — move to S2, which is V2's direction anyway: the demo demonstrates where the lead used
to describe.

This is a copy decision, not a design one; it is recorded here because it is a **consequence of this
design**, and a copy owner who does not know that will reinstate the long lead.

### 8.4 400px (wrap padding 16px → 368px available)

- Single column. Panel padding `--space-xl` (24px) → **320px of content**.
- Chrome row wraps to two lines if `DEMO · 3 QUESTIONS` and `Timer off` do not fit on one.
- Stem stays at `question-stem` 18px/29. **It does not shrink** — it is the loosest leading in the
  system and the thing being read under time pressure in the real product.
- Option rows full width, 48px minimum height, 16px inline padding. The longest option text in the
  set is three characters (`432`), so nothing wraps.
- Palette: 3 × 36px + 2 × 6px gaps = 120px on one line, inside a 44px-tall strip.
- Control row wraps to two lines: line 1 `Back` and `Next` pushed apart (`justify-content:
  space-between`); line 2 `Mark for review` left, `Finish (2/3)` right. The Finish label shortens
  from `Finish (2 of 3 answered)` to `Finish (2/3)` below 480px. Row height 2 × 44 + 8 = 96px.
- Result panel: key rows stack to two lines each — `Q2  multiple` on line 1, `0.67 / 2  Partly
  correct` on line 2 — rather than scrolling horizontally.
- **The panel reflows; it never scrolls horizontally.** Unlike the code blocks and the comparison
  table, the demo is *not* one of the objects permitted to exceed the body measure.

### 8.5 320px (wrap padding 16px → 288px available)

- Panel padding drops to `--space-md` (12px) → **264px of content**.
- `h1` at its existing `clamp()` floor, unchanged.
- Question 2's stem ("Which of these numbers are divisible by 6? (Select all that apply.)") sets to
  about four lines at 264px. Acceptable.
- Palette unchanged at 120px.
- Control row as at 400px; `Mark` and `Finish (2/3)` fit on one line together at ~180px.
- Body has no horizontal scrollbar (P6).

### 8.6 Question ordering and option ordering

**No shuffling.** `shuffleOptions` and `layoutForAttempt` are real, seeded and good, and using them
here would pull `rng.js` and `select.js` into the bundle to deliver a benefit no single visitor can
perceive — and would make the prerendered HTML's option order a build-time artefact that a reader
comparing it to `questions.json` would find reordered. Options render in the file's own order
(`LOG-001`: 95, 117, 127, 131 — note this differs from today's static mock, which reorders them to
place the selected row second). Shuffling is named in the result panel's "what the real runner also
does" line instead, where it is free.

---

## 9. The content, verbatim

Lifted from `examples/reasoning-aptitude/questions.json` without alteration. Markdown in a prompt
renders as real markup (`**Statement:**` → `<strong>Statement:</strong>`), never as literal
asterisks.

### Q1 — `LOG-001`

- **type** `single` · **scoring** `{ "mode": "all_or_nothing", "points": 2 }` · **difficulty**
  `easy` · **tags** `["reasoning", "series"]`
- **prompt** — rendered with a line break at the `\n\n`:
  > What comes next in the series?
  >
  > 3, 7, 15, 31, 63, ?
- **options**, in this order: `a` → `95`, `b` → `117`, `c` → `127`, `d` → `131`
- **key** `"c"`
- **explanation** — *Each term is double the previous term plus one: 63 × 2 + 1 = 127.*

### Q2 — `QNT-004`

- **type** `multiple` · **scoring** `{ "mode": "partial", "points": 2 }` · **difficulty** `easy` ·
  **tags** `["quantitative", "divisibility"]`
- **prompt**:
  > Which of these numbers are divisible by 6? (Select all that apply.)
- **options**, in this order: `a` → `114`, `b` → `128`, `c` → `222`, `d` → `345`, `e` → `432`
- **key** `["a", "c", "e"]`
- **explanation** — *A number is divisible by 6 when it is even and its digits add to a multiple of
  3. 128 fails the digit test (1+2+8 = 11) and 345 is odd.*

### Q3 — `LOG-007`

- **type** `true_false` · **scoring** `{ "mode": "all_or_nothing", "points": 1 }` · **difficulty**
  `easy` · **tags** `["reasoning", "coding-decoding"]`
- **prompt** — the bold renders as `<strong>`:
  > In a certain code, EARTH is written as FBSUI. **Statement:** each letter has been replaced by
  > the letter that follows it in the alphabet.
- **controls** — `true_false` declares no `options` array; the panel renders two radios labelled
  `True` and `False`, producing `{ kind: "boolean", value: true | false }`.
- **key** `true`
- **explanation** — *E→F, A→B, R→S, T→U, H→I.*

### The bridge block (§3.4) — `LOG-001` as it appears in the file

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

---

## 10. Acceptance

Each line is true or false on the finished page. Added to the v2 contract's §7 tables.

### The island

| # | Acceptance |
|---|---|
| D-1 | `dist/index.html` references exactly one `<script type="module" src="/assets/…">`, and no inline script. `public/_headers` is unchanged — still `default-src 'self'`, no `'unsafe-inline'`, no `https?://` substring |
| D-2 | The island's chunk is **≤ 10 KB minified**, measured in CI and printed in the build log. Amends **P1** — the page no longer ships 0 bytes of JavaScript — and nothing else about P1's reasoning changes |
| D-3 | `dist/index.html` is under **100 KB** uncompressed, as P2 already requires; the island is counted separately against D-2 |
| D-4 | A grep of the built island finds none of: `fetch(`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB` |
| D-5 | Every point value rendered by the island originates in `gradeChoice`; the island contains no arithmetic on points other than `round2(sum)` |
| D-6 | No `setInterval`, no `setTimeout` with a non-zero delay, no `requestAnimationFrame` anywhere in the island |

### Progressive enhancement

| # | Acceptance |
|---|---|
| D-7 | With JavaScript disabled, question 1 renders complete and its radios are selectable; the control row shows the fallback link to the worked example; no button is visible, disabled or otherwise |
| D-8 | All three questions' prompts, options and "Question n of 3" strings are present in `dist/index.html` |
| D-9 | No result-panel text — no score, no verdict word — appears in `dist/index.html` |
| D-10 | Upgrading produces zero layout shift: the control row and the question area each hold a `min-height` across the swap |
| D-11 | An option selected before the island initialises is still selected after it initialises |

### Accessibility — extending §7's A-table

| # | Acceptance |
|---|---|
| D-12 | Amends **A8**: the demo panel is **not** `aria-hidden`, and the adjacent `visually-hidden` description is replaced by the panel's visible `h2` and subline. A8 continues to govern every other mock on the page |
| D-13 | Amends **A7**: the demo is no longer a horizontally scrolling container, so A7's `tabIndex={0}` / `role="region"` requirement no longer applies to it |
| D-14 | The whole demo, start to score to retry, is operable by keyboard alone: arrow keys within each radio group, Space on checkboxes, Enter to advance, Tab to every button, visible focus throughout |
| D-15 | Exactly one `aria-live` region in the demo; the score is announced by a focus move, not by the live region |
| D-16 | Every palette button has an `aria-label` carrying its state as a word; the current one carries `aria-current="true"` |
| D-17 | Every verdict in the result panel is a word in the DOM; removing all colour from the page loses no information |
| D-18 | Palette buttons reach a 44 × 44 hit area while the visual square stays 36 × 36 |
| D-19 | Zero axe violations on the demo in each of its states: question 1, question 2, question 3, and the result panel |
| D-20 | **A14** is unchanged: the `prefers-reduced-motion` page remains pixel-identical to the default page |

### Honesty

| # | Acceptance |
|---|---|
| D-21 | The word `DEMO` is visible in the panel chrome in every state, including the result panel |
| D-22 | No running clock anywhere; the timer slot reads `Timer off` |
| D-23 | The result panel states, in prose, that the answer key is in the page and that a real attempt keeps it on the server |
| D-24 | Nothing in the demo or the bridge band asserts the application ships today |
| D-25 | Every factual claim in the demo's prose traces to a file path in `content-inventory.md` (D4) |

---

## 11. Left to the implementer

- The exact wording of the result panel's two prose lines (§3.3) and the subline (§6.2) — the
  substance is fixed, the sentences are copy's.
- Whether `Mark for review` ships, decided by the measured island size (§1.4 step 3).
- The precise `min-height` values for the question area and the control row at each breakpoint.
- Whether the bridge band sits inside the hero's voltage field or opens the first cream band below
  it. Design preference: **below**, on cream, because a `CodeBlock` on voltage must become a cream
  plane with its caption at 24px (`ui-direction.md` §3.3), and the hero already carries one cream
  plane.

## 12. Notes for the rest of the v3 redesign

Not this assignment; recorded because this design changes their inputs.

- **V3 (the roadmap ledger goes).** The demo now carries the pre-alpha honesty at the top of the
  page, in chrome and in the result panel's prose, at the moment it is most needed. S9 can shrink to
  a short "what is built, what is not" paragraph without the twelve-row changelog and lose nothing.
- **V2 (the page gets shorter).** The demo does S3's ("how running an exam works") first step and
  part of S5's ("what it does") argument by demonstration. Both are the first candidates for
  compression.
- **The hero's lead shortens to ≤ 30 words.** §8.3, with its reason.
