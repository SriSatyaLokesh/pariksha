# Design contract: landing page v3 — the interactive hero

| | |
| --- | --- |
| **Status** | Binding amendment |
| **Date** | 2026-10-17 |
| **Author** | Satya K |
| **Amends** | [`2026-10-17-landing-page-v2-design.md`](2026-10-17-landing-page-v2-design.md), which stays in force except where this document names a change by id |
| **Implements** | The owner's v3 brief (V1–V4) and controller decisions D1–D5 |
| **Inputs** | `.planning/landing/v3-hero-demo.md`, `.planning/landing/v3-cull.md`, `.planning/landing/v3-saas-craft.md`, `.planning/landing/content-inventory.md`, `.planning/landing/constraints.md`, `.planning/landing/seo-mechanics.md`, `.planning/landing/ui-direction.md`, `DESIGN.md` |
| **Visual language** | `DESIGN.md` — tokens, type scale, component specs. Unchanged by this document |

This is not a new contract. The v2 design contract is the page's specification and a reader who
has it needs only this file to know what v3 is. Everything here is stated as a change to something
v2 already said, addressed by v2's own identifiers — `S1`–`S12`, `CB-1`–`CB-6`, `M-1`–`M-4`,
`P1`–`P10`, `A1`–`A14`, `SEO-1`–`SEO-32`, `T1`–`T32` — so that a reviewer can reject one line
rather than argue with a redesign. Where v2 is silent, v2 still governs: the token rules, the
sourcing rule, the prose shape, the invariants.

## Contents

1. [What changes, and why](#1-what-changes-and-why)
2. [The island](#2-the-island)
3. [The hero](#3-the-hero)
4. [The new spine](#4-the-new-spine)
5. [Amendments to v2, by id](#5-amendments-to-v2-by-id)
6. [The test plan](#6-the-test-plan)
7. [Honesty acceptance for the demo](#7-honesty-acceptance-for-the-demo)
8. [Left to the implementer](#8-left-to-the-implementer)
9. [Where the three plans conflict, and the call](#9-where-the-three-plans-conflict-and-the-call)
10. [Rejected review findings](#10-rejected-review-findings)
11. [v4 amendment — the three-card hero](#11-v4-amendment--the-three-card-hero)

---

## 1. What changes, and why

The hero's cream plane stops being a picture of an exam and becomes one: three real questions from
`examples/reasoning-aptitude/questions.json`, prerendered as real HTML with real form controls,
upgraded in place by a single vanilla TypeScript module that grades the answers with
`@pariksha/core` — the one part of this product that is actually built — and shows a score that
nothing in the page could have faked, with no network call, no storage and no telemetry of any
kind. That demonstration does work four other bands were doing by description, so the page loses
three of them: the feature catalogue and the no-code apology fold into the how-it-works band as
sub-headings, the twelve-row roadmap ledger is deleted outright and its honesty is re-carried in
three better places, the closing band's directory listing goes, and the FAQ drops from thirteen
pairs to nine. Twelve bands become eight plus the footer, the HTML budget falls from 100 KB to
46 KB against a measured 53.4 KB today, and the one thing the page gives up in return — "zero bytes of JavaScript" — is spent on
the only interaction this product can honestly offer a stranger today, which is to let them check
the central claim themselves in under thirty seconds without typing an address, making an account
or trusting a word of the prose around it.

**The one sentence a v2 reader can act on:** build the hero demo as a progressively-enhanced
island, delete S5, S6, S9's ledger and S11's artefact, merge what survives of them, and cut the
FAQ to nine.

---

## 2. The island

### 2.1 What it is, and what it is not

One file, `apps/web/src/island/exam-demo.ts`, compiled by the existing Vite build to a hashed ES
module under `/assets/` and loaded by exactly one `<script type="module" src="/assets/…">` tag in
`dist/index.html`. It is plain TypeScript: a state object, a handful of pure functions, one render
function that writes the DOM, and three `addEventListener` calls. No framework runtime reaches the
browser — React remains a build-time renderer and nothing else changes about that (D1). There is
no hydration: the island never re-creates markup the prerender already produced, it only upgrades
it (D2).

It is not a component, not a micro-frontend, and not a pattern to be repeated. It is one module
for one surface, and if a second interactive surface is ever wanted on this page the right move is
to re-open D1 rather than to generalise this file.

### 2.2 Files

| Path | What it is | Ships to the browser |
| --- | --- | --- |
| `apps/web/src/island/exam-demo.ts` | The island. Entry point, state machine, renderer, listeners | **yes** |
| `apps/web/src/island/questions.ts` | The three demo questions, lifted verbatim from `examples/reasoning-aptitude/questions.json`. Two named exports: `PROMPTS` (stems, option text, labels — imported by the React section at build time only) and `GRADING` (`id`, `type`, `key`, `scoring`, `explanation` — imported by the island) | **`GRADING` only**, by tree-shaking |
| `apps/web/src/sections/s1-s3/Hero.tsx` | Rewritten. Renders the demo's prerendered markup from `PROMPTS` | no — build time |
| `packages/core/src/index.ts` | Amended: `gradeChoice`, `ChoiceQuestion` and `round2` promoted to the public surface | the two functions only |

**Why two named exports rather than two files.** Rollup drops an unused named export from a module
it has otherwise pulled in, so one file is enough to keep the questions in one place while shipping
the island only the half it needs. The alternative — a generator that writes two files from
`questions.json` at build time — is a build step for a three-row table that changes never. If the
demo ever grows past five questions, revisit it.

**Why not read the keys from the DOM.** The island could take each question's key from a data
attribute and carry no question data at all, which would be a smaller module. It is forbidden:
`v3-cull.md` §1 makes it a hard rule that no demo question's `key` or `explanation` is reachable in
the prerendered markup, because the page's strongest differentiator is that a real Pariksha attempt
never ships a key to a candidate's browser, and printing three keys in the first screenful would
refute it in the one place a sceptic looks. The keys live in the island's bundle, which is the
honest analogue of "on the server" available to a page with no server, and the result panel says so
in words.

### 2.3 The public contract with the prerendered markup

The island binds to data attributes, never to class names — class names are the implementer's
(v2 §9.2) and a renamed block must not break the demo. Every hook below is a contract term: the
prerender emits it, the island reads it, and `T34` asserts the markup carries all of them.

| Hook | On | The island's use |
| --- | --- | --- |
| `data-demo` | the demo root `<div>` | the one query the module makes. Absent → the island returns, having touched nothing |
| `data-demo-q` + `data-qid="LOG-001"` | each question `<li>` | identifies the question; `data-qid` is the key into `GRADING` |
| `data-demo-live` | the empty `visually-hidden` `<p aria-live="polite">` | announcements (§3.6) |
| `data-demo-palette` | the palette `<div>` | replaced wholesale with `<button>`s on init |
| `data-demo-controls` | the control row `<div>` | **not replaced wholesale.** On init the island removes the row's no-JavaScript sentence, inserts its four buttons ahead of the fallback link, and **leaves the link in place** as the row's last element, so the route to the worked example survives the upgrade (`I-9`). Its original `innerHTML` is captured first and is the error fallback |
| `data-demo-result` | an empty `<div hidden>` after the control row | the result panel is written here on Finish |
| `id="demo-q-N"`, `id="demo-stem-N"` | the `<li>` and its `<legend>` | focus target and `aria-labelledby` |
| `name="<qid>"` / `value="<option id>"` | every `<input>` | the island reads a response straight off the DOM; the option ids are the file's own (`a`, `b`, `c`, …) |

The island **writes** only: `hidden` on the question `<li>`s and the result `<div>`; the contents of
the palette, control and result containers; the text of the live region; `aria-current`,
`aria-pressed` and `aria-label` on controls it created; `class` on palette squares. It sets no
`style` attribute and no `element.style` property, ever — a colour outside
`rgb(from var(--color-NAME) r g b / α)` in authored source is already forbidden
(`constraints.md` §2.1) and an island that reached for an inline colour would bypass the contrast
guard entirely (`A1`, `T27`).

### 2.4 The state machine

```
state = {
  phase:    "answering" | "finished",
  current:  0 | 1 | 2,
  answers:  Record<QuestionId, ResponseValue | null>,
  marked:   Set<QuestionId>,
}
```

`ResponseValue` is the real `@pariksha/core` type, not a local shape.

| From | Event | To | Side effect |
| --- | --- | --- | --- |
| `answering(n)` | init | `answers` seeded **from the DOM's current checked state** | one render |
| `answering(n)` | `change` on any input | `answers[qid]` updated | palette square → answered; Finish label count |
| `answering(n)` | `Next`, or `Enter` **when the guard passes** on `n < 2` | `answering(n+1)` | focus moves to the new `<li>`; live region announces |
| `answering(n)` | `Back` on `n > 0` | `answering(n-1)` | as above |
| `answering(n)` | palette square `k` | `answering(k)` | as above |
| `answering(n)` | `Mark` | `marked` toggled for the current id | live region announces; square restyled |
| `answering(n)` | `Finish`, or `Enter` **when the guard passes** on `n = 2` | `finished` | three `gradeChoice` calls; result panel written; focus to its `<h3>`; live region **silent** |
| `finished` | `Try again` | `answering(0)`, `answers` cleared, `marked` cleared | every input unchecked; result panel emptied and `hidden`; focus to question 1 |

**The Enter guard**, stated here as a condition on both `Enter` transitions because a review found
the unguarded version live: the panel's `keydown` handler returns immediately when
`event.target.closest("button, a")` is non-null. A native `<button>` already activates on `Enter`,
so an unguarded panel listener fires twice over — `Enter` on `Back` goes back one and forward one
(which reads as a broken control), `Enter` on `Mark for review` toggles the mark and silently
advances, and `Enter` on palette square 3 jumps to question 3 and ends the attempt in a single
keypress on a control a keyboard visitor reaches by tabbing. The custom binding applies only when
focus is on a question `<li>` or on a form control inside it. `T33i` asserts the three negative
cases as well as the positive one.

`Finish` is reachable from any question, including with nothing answered. Selecting an answer never
advances the question. There is no confirmation dialog: the Finish label carries the count —
`Finish (2 of 3 answered)` — which is the same information for no modal. **At rest the label reads
`Finish` and nothing else**; the count arrives with the first answer and stays. `Finish (0 of 3
answered)` as an initial state makes the page's one primary control scold a visitor who has not yet
done anything, and the zero carries no information the empty palette is not already carrying.

Scoring, in full, and this is the only arithmetic the island is permitted to contain:

```
results = GRADING.map(q => gradeChoice(q, answers[q.id] ?? null, DEFAULTS))
total   = round2(results.reduce((sum, r) => sum + r.points, 0))
```

`DEFAULTS` is `{ mode: "all_or_nothing", negativeFraction: 0.25 }` and never applies, because every
demo question declares its own `scoring.mode`; it is passed because the signature requires it. **No
`passMarkPercent` is passed anywhere.** If any line of the island computes a point value by any
other means, it is a bug (`I-5`).

### 2.5 Reaching the real scoring

`packages/core/src/index.ts` gains three exports, with a comment naming the landing demo as the
consumer:

```ts
export { gradeChoice } from "./grade/choice.js";
export type { ChoiceQuestion } from "./grade/choice.js";
export { round2 } from "./grade/result.js";
```

and `packages/core/package.json` gains `"sideEffects": false` so Rollup can drop `validate.js` (and
with it `ajv`), `select.js` and `rng.js` from the barrel. The comment above the existing
`export type { GradeResult, ScoringDefaults }` block — which currently says `round2` stays internal
because no consumer needs it — is corrected in the same edit; a stale comment next to a changed
export is how the next reader is misled.

The demo must not deep-import `@pariksha/core/src/...`; `packages/core/test/acceptance.test.ts`
forbids it and a declared public export is the legitimate route.

**The measurement order, decided here so it is not re-litigated at the keyboard.** Try
`gradeQuestion` + `scoreAttempt` from the barrel first and record the number in the PR even though
it is expected to miss the budget (`grade/text.ts` carries a ReDoS-safe pattern compiler that
`gradeQuestion` references statically, about 4–5 KB minified that a choice-only demo can never
reach). Then the three exports above, which is the expected shipping path. If that still misses,
cut **the palette's navigation behaviour first** — keeping the inert strip as status — and
`Mark for review` second. This reverses an earlier order. On a three-question set `Back` and `Next`
reach every question in at most two presses, so three jump targets beside them are the most
redundant interaction in the panel, while `Mark for review` is the clearest signal in the design
that this is an exam runner rather than a quiz widget. Do not
reshape `packages/core/src/grade/text.ts` to make a marketing page smaller.

### 2.6 Size budget

| Artefact | Budget | Measured where |
| --- | ---: | --- |
| The island, minified | **≤ 14 KB** (v4, §11 — was ≤ 10 KB) | CI, printed in the build log (`I-2`) |
| …of which `@pariksha/core` | ~2.2 KB | informational; recorded in the PR |
| `dist/index.html`, uncompressed | **≤ 46 KB** | `P2`, amended (§5); derived in §4.9 |
| HTML + island + CSS | **≤ 86 KB** | informational budget; fonts excluded |

### 2.7 Build and serving under `default-src 'self'`

`apps/web/vite.config.ts` gains a third Rollup input:

```
island: resolve(__dirname, "src/island/exam-demo.ts")
```

Vite emits it to `dist/assets/exam-demo-<hash>.js` and records it in `dist/.vite/manifest.json`,
which the build already writes (`manifest: true`).

`scripts/prerender.mjs` keeps its existing strip of every `<script type="module">` and
`<link rel="modulepreload">` — that regex is the guard that the React client entry never ships —
and then **injects one tag**, built from the manifest's entry for `src/island/exam-demo.ts`,
immediately before `</body>`:

```
<script type="module" src="/assets/exam-demo-<hash>.js"></script>
```

Injecting from the manifest rather than leaving a tag in `index.html` keeps one rule in one place:
the prerender owns which scripts reach the public page, and the strip-then-inject order means a
second script can never arrive by accident.

The tag is external and same-origin, which is what `public/_headers`' `script-src 'self'` permits.
It cannot be inline — there is no `'unsafe-inline'` and none is being added — and it cannot come
from a CDN. **`public/_headers` is not modified by this change, and `P7` and `T11` are unchanged.
That is the test that this construction is the right one**: a design that needed a CSP relaxation
would be the wrong design.

`type="module"` is deferred by specification, so the island runs after the document is parsed. No
`defer` attribute, no `DOMContentLoaded` listener, no `async`.

### 2.8 With no JavaScript, and on failure

These are the same requirement stated twice, and the second is the one implementers forget.

**With JavaScript off, blocked, or still in flight**, the visitor sees question 1 complete —
stem, legend, four real radios, four real labels, the chrome row, the palette as inert status, and,
where the buttons will be, **one sentence and a real link**. Questions 2 and 3 are in the HTML
inside `<li hidden>`, so a crawler reads all three and a screen-reader user hears one complete,
operable question rather than three overlapping ones. The radios are selectable. Nothing is
disabled and nothing is a button that does not work.

**The sentence is not optional, and an earlier draft both omitted it and forbade it.** Without it
the panel states a count it cannot deliver — `DEMO · 3 QUESTIONS` above a palette whose three
squares do not navigate and a radio group that can be ticked and is never graded — while the chrome
row promises *Scored in your browser by Pariksha's own scoring engine*. A sceptic with scripts
blocked is then told the page scores and finds that it does not, which is the worst available
outcome on the one surface the whole redesign rests on. So the control row prerenders, before the
link and in the same `mono-sm` register as the chrome:

> Scoring, and questions 2 and 3, need JavaScript.

followed by the existing link — *These three questions, and fourteen more, are in the worked
example*. That turns `D2`'s claim from nearly-true to true: the panel says what it can and cannot
do, and it hands the visitor the three questions plus fourteen more in a file they can open.
`T34` asserts the literal sentence; the palette stays as inert status because the sentence now
explains it, and because it is the clearest signal in the panel that this is an exam runner rather
than a quiz widget.

The page is then whole without a byte of script: the demo's sentence and link, the hero's two text
links, and the bridge band's JSON and prose all carry the visitor onward. **If the island cannot do
this, it does not ship** (D2).

**On an island error**, the demo must fail to the static markup, never to a broken hero. Four
rules:

1. **Nothing is mutated before everything is found.** `init()` resolves every hook in §2.3 first;
   a single missing node means an immediate `return` with the DOM untouched.
2. **The original markup is captured before the first write.** The control row's and the palette's
   `innerHTML` are read into two local strings at the top of `init()`.
3. **The whole of `init()` and every listener body is wrapped in `try`/`catch`.** On a throw, the
   handler restores those two strings — which brings back the no-JavaScript sentence and the
   fallback link together — clears the live region, un-`hidden`s question 1, re-hides the result
   panel, removes its own listeners, and returns. The visitor is left with exactly the
   no-JavaScript page, which is a working page.
4. **Nothing is reported.** No `console.error` payload containing visitor input, no error beacon,
   no retry loop. D3 is absolute and an error path is where it is usually broken.

A parse error or a 404 on the module needs no handling at all: the tag fails, nothing runs, and the
static markup is what remains. That is the design working, not a gap in it.

### 2.9 What the island must never contain

`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `localStorage`,
`sessionStorage`, `document.cookie`, `indexedDB`, `caches`, `PerformanceObserver`,
`navigator.clipboard`, `setInterval`, `requestAnimationFrame`, or `setTimeout` with a non-zero
delay. `T36` and `T39` grep the built bundle for all of them. The prohibition is not "do not call
the network"; it is "the identifier does not appear", because a reviewer who can grep does not have
to read.

**The island's invariants, numbered, because the rest of this document cites them.** These are the
`I-` ids used in §3 and §6; they are new, outside v2's id space, and they do not collide with
`P`, `A`, `SEO` or `T`.

| # | Invariant | Gate |
| --- | --- | --- |
| `I-1` | `dist/index.html` references exactly one `<script type="module" src="/assets/…">` and no inline script other than the one `application/ld+json` block | `T2` |
| `I-2` | The island's chunk is ≤ 10 KB minified, printed in the build log pass or fail | `T35` |
| `I-3` | No network, storage, cookie or telemetry identifier appears in the built island | `T36` |
| `I-4` | No `setInterval`, no `requestAnimationFrame`, no `setTimeout` with a non-zero delay | `T39` |
| `I-5` | Every point value the island renders originates in `gradeChoice`; the only arithmetic in the island is `round2(sum)` | `T33e` |
| `I-6` | `public/_headers` is unchanged — still `default-src 'self'`, no `'unsafe-inline'`, no `https?://` substring | `T11`, `P7` |
| `I-7` | The island sets no `style` attribute, no `element.style` property and no colour literal | `T40`, `T21` |
| `I-8` | The island uses none of the page's component class names — in particular not `ButtonPrimary`'s — so `T20`'s selector cannot be satisfied by a control the island created at runtime | `T20` |
| `I-9` | The fallback link to the worked example is present in the control row **before and after** the upgrade, and after an island error | `T33a`, `T38` |
| `I-10` | On any island failure the DOM returns to the no-JavaScript page: original control row restored, question 1 visible, result panel empty and `hidden`, live region empty | `T38` |

---

## 3. The hero

Amends v2 [§3 S1](2026-10-17-landing-page-v2-design.md#s1--hero). Everything S1 said about the
`h1` — the 45-character budget, `text-wrap: balance`, no hard `<br>`, the product name first — is
unchanged and binding. The chip is unchanged. What changes is the lead, the artefact, the calls to
action and the band's foot.

### 3.1 Source order and shape

At every width: **chip → `h1` → demo panel → lead → the two text links → the bridge band.**
The DOM is never reordered by CSS; at the two-column breakpoint the grid places the demo in the
5fr column and the chip, `h1`, lead and links in the 7fr column, and the column split stays
**7fr / 5fr**.

**The lead sits after the panel, not before it, and this is the change that makes V1 true.** An
earlier draft put the lead above the panel and the fold arithmetic below it did not survive review
(§10, review 1 item 1): counted to the top of the panel rather than to the first thing a visitor
can press, it stopped about 250px short. `A9` is not weakened by the move, and the reason is worth
stating so nobody re-derives it: **the only focusable elements in the hero are the demo's controls
and the two text links**, and their order relative to each other is identical in both layouts. The
chip, the `h1` and the lead are not in the tab order at all, so there is no focus-order mismatch to
create. What the move buys is the headline requirement — a visitor on a phone sees the headline and
then a question they can answer, which is what the brief asked for.

**The demo panel does not bleed.** This amends S1's bleed and vacates `P10`. The bleed existed to
stop a static postcard looking cramped at 433px; an interactive panel has the opposite
requirement, because a control cropped by the viewport edge is a control nobody can press, and
every escape clause — "bleed, but keep the interactive parts inside" — is a rule an implementer
re-derives at every breakpoint. The panel sits wholly inside the 1080px wrap and absorbs the
narrower column by dropping its inner padding from `--space-xl` (24px) to `--space-lg` (16px) in
the two-column state, giving 401px of content at the wrap. At `question-stem` (18px/29) that is a
~47-character measure, tight against `line-length-control`'s desktop guidance and acceptable
because the stems are one or two sentences rather than prose.

**The lead stays one sentence of at most 30 words**, and now that it is below the panel it is no
longer under fold pressure, so it keeps the dated status clause (`seo-mechanics.md` §3.5e,
`SEO-29`, `SEO-32`) comfortably and still does not claim the application ships today. The four
capability nouns the old lead carried — question pools, twelve question types, browser proctoring,
CSV results — move to B2 and B3, which is where the demo has made them evidence rather than
assertion.

**The fold, counted to the first radio and held against a stated viewport.** This is the arithmetic
the design turns on, so it is stated as a stack and as an acceptance criterion rather than as a
sentence. At 400px wide (16px wrap padding → 368px available) with a 64px sticky nav, measured from
the top of the document:

| | px | running |
| --- | ---: | ---: |
| hero `padding-block-start` at 400px | 48 | 48 |
| chip | 28 | 76 |
| gap | 24 | 100 |
| `h1` at its clamp floor, three lines | 110 | 210 |
| gap | 24 | 234 |
| panel `padding-block-start` (`--space-lg`) | 16 | 250 |
| panel `h2` | 28 | 278 |
| gap | 8 | 286 |
| chrome row, three lines of `mono-sm` (§3.9) | 54 | 340 |
| gap | 12 | 352 |
| stem row — `Question 1 of 3`, `single · 2 pts` | 20 | 372 |
| gap | 8 | 380 |
| `LOG-001`'s stem, two lines at `question-stem` 18/29 | 58 | 438 |
| gap | 12 | 450 |
| **top of the first option** | | **450** |

With the sticky nav over it that is **514px into the viewport at scroll 0**, which clears an iPhone
SE's roughly 535px of usable height with question 1's first two options visible, and shows all four
on anything taller. Three things in that stack are the ones that were cut to get there: the panel's
separate subline (three lines plus a gap, folded into the chrome row — §3.9), the lead (moved
below), and `LOG-001`'s two-line stem, which is the shortest of the three questions and is the
reason §3.3 keeps it first.

> **`E-9`, acceptance.** At 400 × 667 CSS px with the sticky nav rendered, the top of question 1's
> first option control is within the first **600px** of the viewport at scroll 0. jsdom cannot
> check this; `T44` does, in a real browser.

**If `E-9` misses at build time**, the cut order is decided here: the hero's `padding-block-start`
below 480px drops one step on the spacing scale; then the chip loses its bottom gap; then the panel
`h2` is deleted and the panel takes its accessible name from the chrome row's first span — which
also costs the hero its only `h2` and therefore moves the bridge band's heading from `h3` to `h2`
to keep `A4`, and adds that string to `T23`'s allow-list. Do not shrink the stem; `question-stem`
is the loosest leading in the system and it is the thing being read under time pressure in the real
product.

**The primary call to action leaves the hero.** This amends S1's CTA block and `T20`(a). Above the
fold there is exactly one filled control and it belongs to the demo's `Finish`; `Start with the
worked example` relocates to the closing band, which is the one place on the page where it is the
right ask — after the argument, not before it. The hero keeps two secondary text links, `Read the
code on GitHub` and `What is built today` (an in-page anchor to `#status`). The demo is the
conversion the hero asks for: it costs no navigation, no account and no email, and a visitor who
answers a question has learned more about Pariksha than one who clicks through to a repository they
will not read.

### 3.2 The prerendered markup

The rule that decides what is prerendered: **content is prerendered; anything that only works with
JavaScript is created by the island.**

| Prerendered | Island-created |
| --- | --- |
| the panel's `h2` | `Back` / `Mark for review` / `Next` / `Finish` |
| chrome row, three lines: `DEMO · 3 QUESTIONS · ABOUT 30 SECONDS`, `Timer off`, and the privacy clause (§3.9) | the palette as navigation (`<button>`s with labels) |
| all three questions — stem, legend, every `<input>` and `<label>`, "Question n of 3", type and points | the entire result panel |
| the palette as inert status (`<span>`s, `aria-hidden`), **at the same 44px strip height it has after the upgrade** | — |
| the empty `aria-live` region | — |
| the control row's no-JavaScript sentence **and** the fallback link | — (the sentence is removed on init; the link stays — `I-9`) |
| the bridge band (§3.8), including `CB-1a` and the prerendered carrier of `H-3`/`H-4` | — |

Indicative shape — class names are the implementer's, the `data-` hooks are not:

```html
<div class="runner-mock runner-mock--demo" data-demo>
  <h2 class="runner-mock__title" id="demo-heading">Try three questions</h2>

  <div class="runner-mock__panel" role="group" aria-labelledby="demo-heading">
    <div class="runner-mock__header">
      <span class="runner-mock__section">DEMO · 3 QUESTIONS · ABOUT 30 SECONDS</span>
      <span class="runner-mock__timer">Timer off</span>
      <span class="runner-mock__privacy">Scored in your browser by Pariksha's own scoring
        engine. Nothing you type leaves this page.</span>
    </div>

    <p class="visually-hidden" aria-live="polite" data-demo-live></p>

    <ol class="runner-mock__questions">
      <li class="runner-mock__q" id="demo-q-1" data-demo-q data-qid="LOG-001"
          tabindex="-1" aria-labelledby="demo-stem-1">
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
          …
        </fieldset>
      </li>
      <li … id="demo-q-2" data-qid="LOG-007" hidden> … </li>
      <li … id="demo-q-3" data-qid="QNT-004" hidden> … </li>
    </ol>

    <div class="runner-mock__palette" aria-hidden="true" data-demo-palette>
      <span class="runner-mock__square runner-mock__square--current">1</span>
      <span class="runner-mock__square">2</span>
      <span class="runner-mock__square">3</span>
    </div>

    <div class="runner-mock__controls" data-demo-controls>
      <p class="runner-mock__nojs">Scoring, and questions 2 and 3, need JavaScript.</p>
      <a class="runner-mock__fallback" href="https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude">
        These three questions, and fourteen more, are in the worked example
      </a>
    </div>

    <div class="runner-mock__result" data-demo-result hidden></div>
  </div>
</div>
```

Every control is a native form control. Nothing is a `div` with a click handler. There is **no
`<form>` element**: a form with no action is a submit-on-Enter trap on a page with nowhere to
submit to; the three `<fieldset>`s stand on their own.

**The prerendered HTML must not contain the result panel in any form** — no score, no verdict word,
no "You scored" string. An answer engine lifting a result from the HTML would be lifting a claim
about an application that does not run yet (D5), and the bytes belong to the bridge band.

**The upgrade carries no flash and no layout shift.** The control row ships containing a sentence
and the fallback link, not disabled buttons and not hidden ones; the island removes the sentence
and inserts four buttons ahead of the link in one mutation, and replaces the palette's contents in
a second.

**Three containers hold a `min-height` across the swap, not two.** The earlier draft named the
control row and the question area and omitted the element the rest of this document says changes
height — the palette strip, which ships as bare 36px `<span>`s and becomes 44px once the island's
buttons reach their hit area through padding (§3.6). Eight pixels on the panel's most-watched
element at the moment the island loads is a visible shift on everything below it, including, at
single-column widths, the whole page. So:

| `E-` | Container | Requirement |
| --- | --- | --- |
| `E-6` | the control row | `min-height` equal to the upgraded row at that breakpoint — `44px` at ≥480px and `2 × 44 + 8 = 96px` below it, where the button row wraps to two lines. The prerendered sentence-plus-link must be allowed to occupy that height rather than fight it |
| `E-7` | the palette strip | `44px` in **both** states; the inert `<span>`s take the same strip height as the buttons that replace them |
| `E-8` | the question area | a `min-height` **per question** below the two-column breakpoint, and the tallest-question `min-height` only at ≥900px. A single global value sized to `QNT-004` (two stem lines plus five 48px rows ≈ 298px) leaves `LOG-001` with ~48px of dead space under its four options and pushes the palette and the control row down for no reason. Vertical budget is scarce at 400px and not at 1080px, so the rule differs by breakpoint |

`E-6`–`E-8` are what `T44` measures in a real browser; jsdom has no layout engine and cannot see any
of them. The `Finish` label's initial width is part of the same check: it ships as `Finish` and
gains its count only after the first answer (§3.5), so the row must be sized for the longest label
it will ever hold, not for the shortest. On init the island
**reads the DOM's current checked state into its model rather than resetting it**, so a visitor who
ticks an option before the module arrives keeps that answer. That is two lines of code and it is
the difference between progressive enhancement and hydration.

### 3.3 The questions

Three. Maximum 5 points. Expected answering time 28 seconds, which the chrome row rounds to
`ABOUT 30 SECONDS` (§3.9) — the one place the figure is shown to anybody. Lifted verbatim from
`examples/reasoning-aptitude/questions.json`, in the file's own option order, with markdown in a
prompt rendered as real markup (`**Statement:**` → `<strong>`), never as literal asterisks.

| # | id | type | mode | points | control | `ResponseValue` |
| --- | --- | --- | --- | ---: | --- | --- |
| 1 | `LOG-001` | `single` | `all_or_nothing` | 2 | four radios sharing `name="LOG-001"` | `{ kind: "option", option: "c" }` |
| 2 | `LOG-007` | `true_false` | `all_or_nothing` | 1 | two radios, True / False | `{ kind: "boolean", value: true }` |
| 3 | `QNT-004` | `multiple` | `partial` | 2 | five checkboxes | `{ kind: "options", options: ["a","c"] }` |

**The order changed under review, and only half way.** Review 1 asked for `LOG-007`, `LOG-001`,
`QNT-004`, on the grounds that the true/false question is a near-certain correct answer that gets
the visitor moving and that the set should end on the fractional score. The second half is right
and is adopted. The first half is declined on its own evidence: `LOG-007`'s prompt is 136
characters — *"In a certain code, EARTH is written as FBSUI. **Statement:** each letter has been
replaced by the letter that follows it in the alphabet."* — which sets to four lines at 320px of
content, against `LOG-001`'s two. Opening on it would push the first option 58px further down and
break `E-9`, the criterion the same review's first item exists to establish. Where the two findings
collide the fold wins, because a question nobody can see is worse than a question that takes eight
seconds.

`LOG-001` is therefore first, and the reason is now the visitor's rather than the repository's: it
has the shortest stem in the set, so it is the only one of the three whose first option clears the
fold on a small phone. Its cost is real and recorded — it is an arithmetic puzzle, priced at eight
seconds, for an audience of organisers rather than candidates. That cost is paid down by the chrome
row saying `about 30 seconds` before the visitor starts (§3.9), not by reordering.

`QNT-004` moves last. It is the load-bearing question: five options, a three-option key and
`partial` mode, so `applyMode`'s `points × (correct − wrong) / total` reaches 0.67 and 1.33 on
realistic answers, and a fractional score is the single artefact on this page that a static mock
could not have faked — which is why it belongs in the last position before `Finish`, freshest when
the result panel explains the decimal. `LOG-007` sits in the middle, takes five seconds, and is
worth 1 point rather than 2, which
is the cheapest available demonstration that a test author sets points per question. Three
question types, two scoring modes, three control shapes, and a maximum of 5 — a number that is not
round, which is itself evidence that points are configuration rather than a fixed scheme.

**Every demo question is in the choice family.** This is a byte decision, not an editorial one:
`gradeChoice` alone serves `single`, `multiple`, `select_k`, `true_false` and `assertion_reason`,
and one `fill_blank` or `numeric` question would pull `grade/text.ts`'s pattern compiler —
roughly 4–5 KB minified that the demo can never reach. If the controller ever raises the island
budget to 16 KB, the best fourth question is `QNT-005` (`fill_blank`, `partial`, 2 points, blanks
`56` and `224`) inserted **immediately before `QNT-004`**, so the set still ends on the fractional
score, and nothing else in this section changes.

**No shuffling.** `shuffleOptions` and `layoutForAttempt` would pull `rng.js` and `select.js` into
the bundle to deliver a benefit no single visitor can perceive, and would make the prerendered
option order a build artefact that a reader comparing it to `questions.json` would find reordered.
Shuffling is named instead in the result panel's prose, where it is free. Note that this changes
today's static mock, which reorders `LOG-001`'s options to place the selected row second.

### 3.4 The timer

Amends S1 and `ui-direction.md` §3.3 constraint 2, which specify a static timer string (`08:41`).
A frozen number on a surface that is now interactive is a lie with a face on it. The timer slot
reads **`Timer off`**, and the result panel explains it in one sentence.

A countdown in a marketing hero is a pressure device and artificial urgency is the canonical dark
pattern; it would also cost the motion budget its zero, because a repainting digit needs an
interval and `A14`'s pixel-identical reduced-motion page is the test that the motion budget is
right. The strongest reason is the third: the real timer is enforced on the server (PRD `C-07`;
PRD `:45` — "every rule is enforced on the server"), so a client countdown here would misrepresent
the one property that makes the real timer trustworthy. Saying `Timer off`, and then *"a real
attempt runs its clock on the server, not in your browser"*, converts a missing feature into the
clearest statement of the product's architecture anywhere in the hero.

### 3.5 The palette and the control row

Three squares, numbered 1–3, in the existing `palette-square` token family, below the question and
above the controls — the position it occupies in the real runner. States: `current`
(`palette-square-current`), `answered` (`--color-state-answered`), `marked`
(`--color-state-marked`), default. A square is a jump target. Marked and answered compose: a marked
and answered question takes the marked fill and keeps its answered state in the accessible label,
which is how the real palette behaves and is why `A11` matters here.

The `locked` state is cut. It means "this section's time has ended and you cannot return", and
there are no sections and no clock in a three-question demo. Its absence is named in the result
panel's prose, where it costs nothing.

| Control | Element | Weight | Behaviour |
| --- | --- | --- | --- |
| `Back` | `<button type="button">` | secondary | previous question; `disabled` on question 1 |
| `Mark for review` | `<button type="button" aria-pressed>` | tertiary, text only | toggles the marked flag |
| `Next` | `<button type="button">` | secondary | next question; `disabled` on question 3 |
| `Finish` → `Finish (n of 3 answered)` | `<button type="button">` | **primary** — the page's one filled control above the fold. It is **not** the `ButtonPrimary` component and must not carry its class (`I-8`) | scores, shows the result panel |

`Clear answer` (PRD `C-04`) is cut and named as cut: the only un-clearable responses in this set are
two radio groups, which is not worth a fifth button and a fifth keyboard target.

### 3.6 Keyboard, focus and announcements

| Action | Keys | Mechanism |
| --- | --- | --- |
| move within a radio group, selecting as you go | arrows | **native**, from `<input type="radio">` sharing a `name` in a `<fieldset>`. Do not reimplement, do not add `role="radiogroup"`, do not manage `tabindex` |
| toggle a checkbox | Space | native |
| move between controls | Tab / Shift+Tab | native. A radio group is one tab stop; each checkbox is its own |
| advance, or Finish on the last question | Enter | the one custom binding — a `keydown` listener on the panel, **guarded** (below) |
| press a button or a palette square | Enter / Space | native `<button>` |

**The guard is a contract term, not an implementation note.** The panel's `keydown` handler
returns immediately when `event.target.closest("button, a")` is non-null. Without it the custom
binding doubles every native button activation — `Enter` on `Back` goes back and forward, `Enter`
on `Mark for review` marks and advances, and `Enter` on palette square 3 jumps and finishes in one
keypress — and since the page advertises `Enter` as the shortcut, the visitors it recruits onto
that path are exactly the keyboard-only ones. The binding applies only when focus is on a question
`<li>` or on a form control inside it. `T33i` asserts all three negative cases.

`Enter` is announced rather than hidden: the control row carries `Enter →` as a `mono-sm` muted
hint beside `Next`. An undiscoverable shortcut is not an accessibility feature. Nothing in the demo
is pointer-only and nothing depends on hover — correctness is never revealed on hover.

**Focus.** On navigation, focus moves to the newly shown `<li>`, which carries `tabindex="-1"` and
`aria-labelledby` pointing at its stem, so a screen reader announces the number, the stem and the
group before the visitor reaches the first option; focus does **not** go to the first input, which
would skip the stem and hijack the arrow-key semantics the radio group owns. On Finish, focus moves
to the result panel's `<h3>` (`tabindex="-1"`), whose text is the score sentence — that single move
does the announcing. On `Try again`, focus returns to question 1's `<li>`. The focus ring is the
voltage ring, unchanged; `outline: none` without a replacement appears nowhere (`A9`).

**Live regions.** Exactly one, `aria-live="polite"`, visually hidden, present in the prerendered
HTML and empty. It receives the question line on navigation — `Question 2 of 3. True or false. 1 point.` for
`LOG-007`, `Question 3 of 3. Select all that apply. 2 points.` for `QNT-004` — and the mark toggle
(`Question 2 marked for review.`). **On Finish it receives
nothing** — the focus move announces the score, and two mechanisms firing on one event is a double
announcement, which is worse than neither.

**Accessible names that colour would otherwise carry.** Each palette button:
`aria-label="Question 2, answered"` / `", not answered"` / `", marked for review"`, with
`aria-current="true"` on the current one. `Mark for review` carries `aria-pressed`. Every verdict
in the result panel is a word in the DOM.

**Touch targets.** Option rows keep their existing 48px minimum. Palette squares keep their 36 × 36
visual box — it is a design-system token — and reach a 44 × 44 hit area through padding on the
button, the pattern `A10` already applies to nav links, so the palette strip is 44px tall rather
than 36px — **in both states, prerendered and upgraded** (`E-7`). Every control-row button is at least 44px tall with at least 8px between adjacent
targets. A checkbox's hit area is the whole 48px label row, not the 16px control.

**Motion.** The demo introduces none. The only transitions anywhere in it are the page's existing
120ms colour-and-border transitions on interactive elements, already inside the
`prefers-reduced-motion: no-preference` guard with `transition: none` as the base (`P8`). No fade
between questions, no slide, no progress fill, no count-up on the score. `A14` survives unamended.

### 3.7 The end state

Top to bottom, inside the same panel — the question list, palette and control row are replaced in
place, so the voltage-and-cream composition does not change and the page above does not move. One
press, no confirmation, no spinner, no artificial delay: three `gradeChoice` calls return in
microseconds and the result renders in the same frame.

**The reading order, fixed, because an earlier draft got it wrong.** It read: score → three key
rows → ninety-five words of prose → a source link → `Try again`. That puts two paragraphs of
disclaimer between the reward and the only two things a visitor can do, at the highest-intent
second on the page, and the two things were a source directory and a restart. The order is now:

1. the score `<h3>`
2. the three per-question rows
3. **the forward action** — one secondary text link, *Read the whole test — seventeen questions,
   three sections, the scoring* → `examples/reasoning-aptitude`. A text link, not a second
   `ButtonPrimary`, so `T20`'s single-primary rule survives
4. the two prose lines
5. *See how that was scored* → `packages/core`, and the in-page anchor **down to the bridge band**
6. *How you would run this yourself* → an in-page anchor to `#how-it-works`
7. `Try again`

Item 6 answers a question an earlier draft left open: the result panel does **not** carry a
three-line "clone, edit `questions.json`, run" recipe. B3's three steps are that content, they are
better there, and the panel links to them rather than assuming the visitor will keep scrolling.

**The score.** `You scored 3.67 out of 5` as an `<h3>` at `heading-sm`, with the figures in
`timer-numeric` (tabular, which is what that token exists for), then `73% · this demo sets no pass
mark`. There is no pass or fail and the word "Fail" appears nowhere: the demo passes no
`passMarkPercent`, which in the real engine makes `AttemptScore.passed` `null`, so the absence is
not a softening but what the API returns when a test declares no pass mark. If nothing was
answered the second line reads instead: *"You did not answer any of them. Try again, or read the
file below."* If everything was answered correctly it reads instead: *"All three. The worked
example has fourteen more."* — one sentence, because the clean sweep otherwise earns the thinnest
panel in the design (no explanations are rendered, by rule) at the moment of highest goodwill, and
because that sentence is itself a forward action in words.

**The per-question key.** Three rows, each carrying the type name in `mono-sm` verbatim from the
format (`single`, `multiple`, `true_false` — not a friendly paraphrase; the format's own vocabulary
is the thing being sold), points over max in `timer-numeric` at two decimal places always so `2.00`
and `0.67` align, and **the verdict as a word**: `Correct` / `Partly correct` / `Wrong` /
`Not answered`. Colour is a second carrier, never the only one (`A11`). `Partly correct` is shown
when `0 < points < max` and is reachable only on `QNT-004`, which is the point of `QNT-004`.
`Not answered` is distinguished from `Wrong` by the island's own `answers[id] === null` check, not
by `GradeResult.correct` — `applyMode` returns `correct: false` for a blank, correctly, and the
distinction is presentation.

**The explanation is shown when the question was attempted and is not fully correct**, and is
otherwise omitted: a correct answer needs no explanation, and an unanswered question must not be
handed its answer. The text is the `explanation` string from `questions.json`, verbatim. It
explains rather than scolds, which is what that string already does.

**Two prose lines**, in `body-sm`, as prose — not a banner, not a callout box, not an asterisk.
Substance fixed, sentences the copy owner's:

> **What just happened.** The scoring is real: `@pariksha/core`, the module that will grade every
> attempt, is bundled into this page, and it is the part of Pariksha that is built and tested
> today. Questions 1 and 2 are all-or-nothing; question 3 is partial-credit, which is why its score
> has a decimal. A question left blank scores zero and never loses points, and the options are not
> shuffled here.

The negative-marking claim that used to sit in this paragraph — *the worked example's own test adds
negative marking at a quarter of a question's points* — **moves to B3 step 02**, beside `CB-2`.
Review 1 was right that it was the one claim in the panel told rather than shown, sitting under
three numbers that were shown; it was wrong about the destination, because the file that configures
negative marking is `test.json`, which is `CB-2`, not the `questions.json` object in the bridge
band. It is demonstrated nowhere, so it belongs next to the JSON that sets it.

> **What is not real.** This demo scores in your browser because there is nothing to call. A real
> Pariksha test does the opposite: the answer key stays on the server and never reaches a
> candidate, every rule is re-checked there, and the clock runs there too. The scoring engine, the
> formats, the schemas and this worked example are published today; the runner, the server,
> proctoring and the results CSV land with v0.1.

**`H-3` and `H-4` do not live here.** The substance of both — the key stays on the server; this is
built and that is not — is **prerendered in the bridge band** (§3.8), and the result panel's second
line echoes it in short form. An earlier draft had the only carrier of the page's central
architectural claim inside the island, where `T34b` greps `dist/index.html` to prove it is absent:
a crawler, an answer engine, and every visitor with JavaScript off saw none of it, and the deleted
ledger it replaced was 2,964 prerendered, extractable bytes. `SEO-2` as amended says the island
"creates no content a crawler or an answer engine needs"; that sentence is only true because
`H-3`/`H-4` were moved out of it.

Sources, for the sourcing rule: PRD `:45` and `S-10` (keys never reach the browser, server-enforced
rules), PRD `C-07` (server timer), `README.md:22` and `content-inventory.md` §"The application does
not exist yet" (what ships today), `examples/reasoning-aptitude/test.json` (`default_mode:
"negative"`, `negative_fraction: 0.25`, `pass_mark_percent: 50`),
`packages/core/src/grade/result.ts` (`applyMode`'s blank-scores-zero rule),
`content-inventory.md:112` and `:157` (the key-never-reaches-the-browser claim and its comparison
row).

The second line is the best sentence the page will own, and it exists only because the demo creates
the problem it answers. That is the right shape for a disclosure: the compromise admitted in the
same breath as the architecture that makes it unnecessary in production.

**One source link**, appearing only now: *See how that was scored* → `packages/core` on GitHub.
It arrives at the exact second the visitor is wondering whether the scoring was real, and it points
at the one part of the product that exists. This is the only repository path that survives anywhere
in the page body (§4, T2).

**`Try again`** is last and lowest weight, a tertiary text button: question 1, every answer
cleared, every mark cleared, palette reset. Answers are not preserved across a retry — preserving
them means the second run produces the same score, which is a dead end — and there is nothing to
preserve them in anyway (D3), so a page reload is also a clean run and the implementer must not
reach for `sessionStorage` to "improve" it. No retry limit, no "sign up to try again", no change in
the questions between runs.

**What the result panel does not contain.** No share control, no "you beat n% of visitors" (there
is no data — D3 — so any such number would be invented), no streak, no email capture, no detailed
report, no certificate, no confetti, no sound.

### 3.8 The bridge band

Beneath the demo panel, closing the hero on cream, sits **`CB-1a`** — the four lines of `LOG-001`
that carry the argument, as they appear in `examples/reasoning-aptitude/questions.json`, with the
intervening lines elided and the elision marked:

```
{
  "id": "LOG-001",
  …
  "key": "c",
  "scoring": { "mode": "all_or_nothing", "points": 2 },
  "explanation": "Each term is double the previous term plus one: 63 × 2 + 1 = 127."
}
```

captioned `examples/reasoning-aptitude/questions.json · LOG-001`, under the heading:

> ### The three questions above are this file.

then one sentence — *"Seventeen questions like it are in the worked example, together with the test
that draws from them, the candidate list, and the results CSV it produces."* — then an in-page link
down to **`CB-1` in full**, in B3 step 01, and then the prerendered prose carrying `H-3` and `H-4`
(§3.7): the key is in this page because there is nothing to call; a real Pariksha test keeps it on
the server where it never reaches a candidate, re-checks every rule there and runs the clock there;
the scoring engine, the formats, the schemas and this worked example are published today, and the
runner, the server, proctoring and the results CSV land with v0.1.

**Why an excerpt and not the whole object, and why the whole object is still on the page.** The
measured cost settles it. `CB-1` in the built page is **3,780 bytes**, not the ~900 an earlier draft
assumed — syntax-highlighting spans are most of it — and head and nav measure 6,632, so `T32`'s
absolute ceiling of 13,500 leaves **6,868 bytes for all of B1**. The rest of B1 spends 5,810 of
them: ~900 of copy (chip, `h1`, lead, two links) and 3,906 of prerendered demo markup — 3,786
measured by rendering the three questions, plus the chrome's third line and the no-JavaScript
sentence — and ~1,004 for this band's heading, sentence, anchor and `H-3`/`H-4` prose. That leaves
**1,058 bytes**. `CB-1a` fits in ~980; `CB-1` entire would overrun by 2,722, and the demo cannot be
the thing that is cut. The four lines carry the whole
of the argument — the key and the explanation the visitor has just read, in the file's own
punctuation — at ~900 bytes, and `CB-1` entire is one scroll away in B3 step 01, where the two
files that sit beside it in the repository sit beside it on the page. This is a teaser and a
listing, not a duplicate, and §9 conflict 4 is reversed accordingly.

This is the bridge from "I just took an exam" to "I could run one", and it is the conversion the
hero actually has. It answers the question the visitor is holding at that moment — *how did it
know?* — and the honest answer is *because somebody wrote the key*. Seeing the key sitting in a
JSON object beside the `explanation` they just read reframes them from candidate to organiser in
one artefact. A feature list cannot do that; a pricing table cannot; a "Get started" button
certainly cannot. It costs no new component: `CodeBlock` is already in the inventory, already
styled, already contrast-checked.

**It is prerendered and always visible**, not built by the island and not inside the result panel,
and a revision must not move it inside the result panel or trade it for a conversion widget.
A crawler and an answer engine must see it, the island's output being invisible to both; a visitor
who skips the demo still gets it; and it is the best prose in the hero region, which is where ~44%
of AI citations are drawn from. The result panel's last link is an in-page anchor down to it.

**On the key being visible before the visitor answers.** It is, and that is deliberate. `v3-cull.md`
§1's hard rule governs the demo panel's own markup, which prints no key and no explanation; the
bridge band prints one key openly, labelled, outside the panel, as the demonstration that the disclosure in §3.7 is
literal rather than rhetorical. Nothing is at stake in a demo that stores nothing and reports
nothing (D3), so there is no score to defend, and a reader who scrolls down to find the answer to
question 1 has understood the page's argument faster than one who did not.

**It sits on cream, below the voltage field, opening the hero's foot** — because a `CodeBlock` on
voltage must become a cream plane with its caption at 24px (`ui-direction.md` §3.3) and the hero
already carries one cream plane. Its `h3` is a sub-heading of the hero's `h1`, which keeps `A4`
intact.

### 3.9 Honesty in the chrome

D5 says a visitor who has just taken an exam will assume the product exists. Three placements, in
increasing depth, so the correction is never a single dismissible object.

**Two placements, not five.** An earlier draft carried honesty five times before the visitor read a
word of question 1 — the `PRE-ALPHA · APACHE-2.0` chip, the `h2`, a seventeen-word subline, `DEMO ·
3 QUESTIONS`, and `Timer off` — and twice more in the result panel. Each was individually right;
stacked, they read as anxiety rather than stance, and they diluted the one that must never be
missed. One carrier before, one after.

1. **The panel chrome, always on screen, three lines of `mono-sm`.** Line 1: `DEMO · 3 QUESTIONS ·
   ABOUT 30 SECONDS`, where the real runner reads `Section 2 of 3 · Logical reasoning`. Line 2:
   `Timer off`, where the clock would be. Line 3, the privacy clause folded up out of the deleted
   subline: *Scored in your browser by Pariksha's own scoring engine. Nothing you type leaves this
   page.* All three are muted, in the same register as the hero's chip. A visitor cannot look at
   the panel without reading the word DEMO, and that includes the result state.

   `ABOUT 30 SECONDS` replaces a bare count. The earlier chrome said `3 QUESTIONS` — a number where
   a recruiting signal should be, and the document computed 28 seconds and then showed the figure
   to nobody. It answers the question a visitor actually asks before starting and it does the same
   honesty job.

   The privacy clause keeps its position above the first control, which is the only thing about it
   that was load-bearing: it discharges D3 **before** the visitor can type anything, which is the
   only moment at which a privacy promise is worth making, and it is the rare claim that is
   self-proving — a reader who opens the network tab sees nothing. `H-6` names the chrome row as
   its carrier.

2. **The bridge band's prerendered prose and the result panel's two lines**, §3.7 and §3.8.

The panel `h2` keeps `Try three questions` and carries no honesty load; it exists for `A4` and for
the panel's accessible name. If `E-9` ever forces it out, §3.1 says what moves with it.

**What the honesty must not be.** Not a modal, not a dismissible banner, not an asterisk with a
footnote, not a tooltip, not italics in parentheses. All five read as a disclaimer bolted onto a
pitch; chrome and prose read as a stance.

### 3.10 400px and 320px

**400px** (16px wrap padding → 368px available):

- Single column, source order. Panel padding `--space-xl` → **320px of content**.
- The chrome row wraps to two lines if `DEMO · 3 QUESTIONS` and `Timer off` do not fit on one.
- The stem stays at `question-stem` 18px/29 and **does not shrink** — it is the loosest leading in
  the system and the thing being read under time pressure in the real product.
- Option rows full width, 48px minimum height, 16px inline padding. The longest option text in the
  set is three characters, so nothing wraps.
- Palette: 3 × 36px + 2 × 6px = 120px on one line, inside a 44px-tall strip.
- The control row wraps to two lines: `Back` and `Next` pushed apart on line 1, `Mark for review`
  left and `Finish (2/3)` right on line 2, with the fallback link below them as a third line
  (`I-9`). The Finish label shortens from `Finish (2 of 3 answered)` to `Finish (2/3)` below 480px
  and reads `Finish` until the first answer lands. Row height 2 × 44 + 8 = 96px plus the link,
  held by `min-height` across the upgrade (`E-6`).
- Result key rows stack to two lines each — `Q3  multiple`, then `0.67 / 2  Partly correct`.
- **The panel reflows; it never scrolls horizontally.** Unlike the code blocks and the comparison
  table, the demo is not one of the objects permitted to exceed the body measure.

**320px** (→ 288px available): panel padding drops to `--space-md` (12px) → **264px of content**;
`h1` at its existing `clamp()` floor, unchanged; `LOG-007`'s stem — the longest in the set at 136
characters — sets to about five lines and `QNT-004`'s to three, which is acceptable at positions 2
and 3 because `E-9` is a claim about question 1 only; palette unchanged at 120px inside its 44px
strip; `Mark` and `Finish (2/3)` fit on one line together at
~180px; no body-level horizontal scrollbar (`P6`).

### 3.11 What the demo must never do

Each is a failure mode this design is actively shaped against. An implementer building one of them
has lost the thread.

1. **No score wall.** The score appears on Finish, unconditionally. No email, no sign-up, no
   "unlock your full report", no account. This is the most common pattern in this exact genre and
   it would destroy the page's argument in one interaction.
2. **No fake loading.** No spinner, no "Grading…", no artificial delay, no progress bar. A
   simulated round-trip on a page that has just promised nothing leaves the browser is a lie with
   a moving part.
3. **No urgency.** No countdown, no "1 question left", no red state, no auto-submit, no
   time-pressure copy.
4. **No fabricated social proof.** No percentile, no leaderboard, no streak, no share-your-score.
5. **No network, no storage, no telemetry.** §2.9.
6. **No auto-advance on selection.** It feels slick, it steals the chance to change an answer, it
   fires once per arrow-key press inside a radio group, and it leaves a visitor who mis-tapped on a
   phone with no way back to the thing they just got wrong. Answers can be changed freely until
   Finish — by re-selecting, by unticking, or by navigating back — which is what the real runner
   allows within a section (PRD `C-04`).
7. **No pass or fail.**
8. **No answer-key leak presented as a feature.** The key is in the page because there is no
   server; say so once, plainly, and never imply that client-side grading is the product's design.
9. **No retry gate.**
10. **No `transform: scale()`** on the panel to make it fit — and here, not even cropping.
11. **No emoji, and no glyph as the only carrier.** Correctness is a word; `✓` and `✗` are not
    permitted even as decoration beside it (`A13`).
12. **No confetti, no sound, no haptics.**
13. **No reimplementation of grading.** If a line of the island computes a point value, it is
    wrong.
14. **No nag.** The demo never demands dismissal, so it never needs a dismiss control: no modal, no
    sticky prompt, no scroll-triggered nudge, no auto-start, no "you did not finish" interstitial,
    no re-prompt on a second scroll past. A visitor may scroll straight past it to B2 and the page
    works exactly as well. This is recorded as an invariant rather than left implicit, because
    "engagement" is the name under which a later revision adds the scroll-triggered version.

---

## 4. The new spine

Amends v2 [§3.0](2026-10-17-landing-page-v2-design.md#30-the-spine-and-why-the-comparison-sits-where-it-does).
Twelve bands become **eight plus the footer**. Voltage still appears exactly three times — the
hero, one `card-voltage` in B5, the closing band — so `DESIGN.md`'s "`card-voltage`: one per page,
at most" holds.

**The target column is derived from measured bytes, not estimated.** An earlier draft's column
summed to 38,051 against a 40 KB gate; three of its rows were under-measured by a total of about
5.5 KB and the gate passed only on paper. Every figure below is either measured in
`apps/web/dist/index.html` as built today or derived from one that is, and the derivation is in
§4.9 so it can be checked rather than believed.

| # | id | Band | `h2`, verbatim | Carries | Surface | Heading | Density | Pad | Target |
| --- | --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| B1 | — | Hero, with the exam in it | `h1` — *Pariksha — run real exams you host yourself.* | chip, the demo, one-sentence lead, two text links, the bridge band (`CB-1a` + the `H-3`/`H-4` prose) | **voltage** → cream foot | `display-xl` (h1, once) | generous | 96 | **6,790** |
| B2 | `what-it-is` | What is Pariksha? | `What is Pariksha?` | the definitional paragraph and the `12 / 5 / 3` numeral row, unchanged, plus the three-item verification strip (§4.2) | cream | `heading-md` + eyebrow | sparse | 64 | **1,550** |
| B3 | `how-it-works` | How running an exam works | `How does running an exam on Pariksha actually work?` | the answer-first paragraph, three steps, **CB-1**, CB-2, M-3, and two absorbed `h3`s (§4.3) | cream | `display-lg` + eyebrow | dense | 96 | **9,750** |
| B4 | `comparison` | Why not a form tool, why not a paid platform | `Why not a form tool, and why not a paid assessment platform?` | unchanged in every particular | canvas | `display-lg` + eyebrow | dense | 96 | 3,850 |
| B5 | `cost` | What it costs, and where it runs | `What does it cost to run an exam on Pariksha?` | the `$0` `card-voltage`, both qualifications, the budget table, the interoperability strip and CB-4 (§4.4) | cream | `display-lg` + eyebrow | medium | 96 | **3,580** |
| B6 | `not-for` | Who it is not for, and what is built | `Who is Pariksha not for?` | S8's nine sentences, then an `h3` on `#status` carrying S9 minus the ledger (§4.5) | canvas | `heading-md` + eyebrow | sparse → medium | 64 | **4,250** |
| B7 | `faq` | Questions and answers | `Questions and answers` | nine pairs (§4.6) | cream | `heading-md` + eyebrow | dense | 64 | **4,620** |
| B8 | — | The ask | `Read one real test, end to end.` | one filled button, one secondary link, one mono honesty line. **No artefact** (§4.7) | **voltage** | `display-lg` | generous | 96 | **1,500** |
| B9 | `docs` | Footer | visually hidden | unchanged, plus the licence sentence and the displaced citations | canvas | `heading-sm`, hidden | dense | 64 / 24 | **2,450** |
| — | — | head, nav, skip link | — | `#status`, `#not-for`, `#comparison`, `#cost`, `#how-it-works`, `#what-it-is`, `#faq`, `#docs` all still resolve; `#features` and `#no-code` resolve too (§4.3) | — | — | — | — | 6,632 |
| | | | | | | | | **sum** | **44,972** |

Rhythm, re-derived for eight bands: no two adjacent rows share both surface and density (B3→B4
share density and flip surface; B5→B6 flip both; B6→B7 flip both). v2's own note stands — surface
alternation is a contrast-test input, not a felt device, and rhythm is carried by the three columns
that actually vary: heading scale, measure and density. Rest points are now two rather than three,
B2 and B6's opening, which is correct for a page two thirds the length.

**Eyebrows go on every band, including the 96px chapter openings.** This is the one change v3 makes
to v2's heading tier, and it is the resolution of the "every heading is a question" complaint
(`v3-saas-craft.md` T1). The complaint is real — a product page asserts in its loudest lines — but
the fix proposed for it, converting the `h2`s to declaratives, would delete the exact strings
`SEO-26` and `seo-mechanics.md` §3.5 paid for, and five of the six surviving `h2`s are literal
high-volume queries. A `mono-sm` eyebrow of two to four declarative words above each interrogative
`h2` gives the eye a product label to land on and leaves the extractable string a question. It
costs about twenty bytes a band and it is the whole of T1 that can be adopted without paying for it
twice.

### 4.1 What was deleted or merged, and what it costs

| Band | Verdict | What is lost | Query cost |
| --- | --- | --- | --- |
| **S5 — What it does, by the job it does** | **merged into B3** as an `h3` | four `FeatureCell`s of prose, the asymmetric grid, CB-6 as a standalone block | **One paragraph rewritten under the sourcing rule, not "same strings".** `What does Pariksha do?` survives as an `h3` with the twelve type names still a real `<ul>`, which is what the "how many question types" query ranks on. But S5's surviving answer-first paragraph *describes the structure the merge deletes* — verbatim in the built page: *"Six cells below answer six different problems: worthwhile questions, a different paper for everyone, clean registration, proctoring that never records, flags instead of verdicts, and results that land in a spreadsheet already."* v3 keeps four one-line statements, not six cells, so that sentence cannot be reprinted. §4.3 item 5 specifies its replacement. Four of six cells described software that is specified and not built, and a weak catalogue of unbuilt features reads worse beside a working demo than it did beside a static mock |
| **S6 — You never write JSON** | **merged into B3** as an `h3`; **M-2 deleted** | the question-editor mock, the three UX decisions beside it, and one sentence | **One sentence deleted, the rest unchanged.** `Does an organiser ever have to write JSON?` survives as an `h3` with its binding 40–60 word answer and `content-inventory.md` §5's pull quote verbatim. S6 carries the same drift as S5 in miniature and it was missed: its closing sentence *"The authoring interface is designed and not yet built; this is the design."* points at M-2, which is being deleted. The clause before the semicolon is a binding honesty claim and survives; **"this is the design" goes with the mock it referred to**. M-2 is a hand-drawn mock of an authoring UI that does not exist, and per D5 a fictional screen beside a working one is the page's largest overclaim risk; deleting it improves honesty and size in one edit |
| **S9's roadmap ledger** | **deleted**; the band merges into B6 as an `h3` on `#status` | the twelve-row typographic ledger, the four milestone labels, the band | **Real and small.** The page loses "Phase 4", "Phase 7", "candidate runtime" as a scannable set, and keeps every string with query value: `pre-alpha`, the literal date, `Apache-2.0`, `BYOK`, `packages/core`. `What is built today, and what is not?` survives as an `h3` on `#status`, so the nav anchor and any inbound link still resolve — zero link rot. The ledger was also a second copy of `docs/ROADMAP.md` living in a marketing page's JSX, re-verified on every deploy and stale the moment a phase lands |
| **CB-3 — the results CSV** | **deleted** | a code block | **None.** CB-3 and M-3 are the same three rows, and M-3 is the accessible one with the `<caption>` |
| **CB-5 — how this website is deployed** | **deleted** | a three-line deploy snippet | **None.** It deploys the *landing page*, not the product, and needed a binding footnote saying so. A code block that requires a disclaimer to avoid misleading the reader is not earning 400 bytes. Its binding truth — the exam API is Phase 2 — survives as a sentence beside the Cloudflare line in B5 |
| **M-4 — the closing file listing** | **deleted** | five filenames with line counts | **None.** Line counts are the output of `wc -l`, not a product claim, and a directory index answers a question only a reader who has already decided to clone would ask. The one thing in that band worth keeping — the no-install validate command, which v2's success criterion G2 depends on — moves to B5's interoperability strip, where it proves the open-format claim at the moment the claim is made |
| **FAQ Q3, Q4, Q9, Q15** | **deleted** | four `h3`s | **Three strings, not four** (§4.6) |

**The SEO arithmetic, stated plainly, because v2 §5 was expensive.** The page carried eight
question-shaped `h2`s and thirteen question-shaped `h3`s — twenty-one extractable question strings.
It now carries **five** question-shaped `h2`s, three absorbed `h3`s and nine FAQ `h3`s:
**seventeen**, not eighteen — the earlier figure counted the hero's declarative panel `h2` as
question-shaped. All four losses are FAQ pairs, and one of the four (Q4) is a pure duplicate of a
surviving `h2`, so the real loss is three. Against it the page gains an interactive surface for a
demo-intent query class it won nothing for before, three fewer bands, and a document about 16%
smaller — 53.4 KB to a derived 45.0 KB, not the 25% an earlier draft claimed against an unmeasured
band table — in which the surviving strings sit at higher density.

**The claim that B2's paragraph and B4's table move "from 40% to roughly 25%" is withdrawn; it is
wrong in the wrong direction.** Measured, B4 starts at byte 21,354 of 53,442 today — 40.0% — and in
v3 it starts at 24,722 of 44,972, which is **55%**, because B3 absorbed two bands that used
to sit *after* the comparison. B2's definitional paragraph moves from 9,322 to 13,422. Two
things are true about that and both should be said: the proportional figures get worse mostly
because the denominator shrank, which is the cull working; and the absolute figures get worse by
2.9 KB and 4.1 KB respectively, which is the real cost, and it is the price of putting an exam and
its source file in the hero. `T32` is restated as an absolute byte offset for exactly this reason
(§5) — a ratio punishes every later deletion, which is the opposite of what this page is being
asked to do.

**The four liftable structures all survive untouched**: B2's paragraph and numeral row, B4's
`<table>` with its `<caption>` and `scope` attributes, B5's budget table, and B6's definitive
sentences. What was deleted is narration, duplicate renderings, and a mock of software that does
not exist.

### 4.2 B2 — the verification strip

B2's paragraph and numeral row are untouched. It gains a **three**-item text strip, which is the
re-tenanting of the social-proof slot a product with no users cannot fill: Apache-2.0 with its
explicit patent grant (ADR 0003); a worked example of seventeen questions covering all twelve
types; the published JSON Schemas.

**The coverage tuple is cut, and §4.8 is the reason.** An earlier draft listed
`97/93/100/98% coverage of packages/core/src, gated in CI` as a fourth item, which contradicts
§4.8's own rule in the same document: a four-figure line-coverage tuple is the most
contributor-facing string available, and §4.8 exists to move exactly that register off the page.
It was also new content added to a band being culled, in the one band whose byte position `T32`
measures — B2 would have gone from 1,146 to ~1,700 and pushed the definitional sentence down the
document this contract is already struggling to keep it high in. The figure stays sourced at
`content-inventory.md:674` and stays available to the README; it does not go on the landing page.
The surviving three are artefacts a reader can open, which is what carries the strip's line. Each is one line, each links to the artefact, and the strip's
line is *you do not have to take our word for any of this* — which is the one sentence a page with
users cannot credibly write.

**Standing prohibition in this slot, for v3 and after:** no star counts, fork counts, contributor
counts, download counts, "used by", "trusted by", waitlist counts, Product Hunt or similar badges,
and no sentence using the word "community" as a proxy for adoption. An empty slot beats a badly
filled one, decisively; if the strip ever has to go, it goes rather than degrades. `T13`'s guard
against `aggregateRating` and `offers` in the JSON-LD is the machine-readable half of the same
rule and is unchanged.

### 4.3 B3 — the band doing the absorbing

One chapter, in this order:

1. The binding 40–60 word answer-first paragraph, verbatim from v2 §3 S3.
2. **Step 01 — Write the questions.** Prose, then **`CB-1` in full** — `LOG-001` exactly as it
   appears in `examples/reasoning-aptitude/questions.json`, with `id`, `type`, `prompt`, `options`,
   `key`, `difficulty`, `tags`, `scoring` and `explanation`. The hero's bridge band carries the
   four-line `CB-1a` excerpt and links down to this block; this block links back up to the demo.
   §9 conflict 4 is reversed here on measured bytes — see §3.8 and §9.
3. **Step 02 — Assemble the test into sections**, with **CB-2**, untouched. This is the pool and
   fixed-set mechanic, the one capability a form tool cannot have, and B4's table depends on the
   reader having met it. **The negative-marking sentence lands here**, beside `CB-2`, because
   `test.json` is the file that configures it: the worked example's own test deducts a quarter of a
   question's points for a wrong answer and a blank costs nothing
   (`examples/reasoning-aptitude/test.json:157`). It was previously asserted in the demo's result
   panel, where it was the one claim told rather than shown, sitting under three numbers that were
   shown.
4. **Step 03 — They sit it; you download the results.** Step prose cut to nothing. **M-3**, the
   rendered results table, and the Divya paragraph verbatim. The demo showed the sitting; this
   shows the organiser's output, which the demo cannot.
5. `h3` — **`What does Pariksha do?`**, on an element carrying **`id="features"`**, so the deleted
   band's anchor still resolves. Three parts, in order:

   a. **A new answer paragraph**, replacing S5's, because S5's describes six cells that no longer
      exist (§4.1). Binding substance: 40–60 words; first sentence contains `Pariksha`; it says
      that Pariksha groups what it does by the organiser's job rather than by the shape of the
      codebase, and names the four problems the statements below answer — **clean registration,
      proctoring that never records, flags instead of verdicts, and results that land in a
      spreadsheet already**. It must not say "six", must not say "the cells below", and must not
      name per-candidate papers, which B3 step 02 and B4 now carry. Every claim traces to
      `content-inventory.md`. The sentences are copy's; the count is not.
   b. v2 §3 S5's binding lead line about shipped versus specified, once, unchanged.
   c. The twelve type names as a real `<ul>`, then the four one-line statements: registration,
      proctoring (*no video and no audio are ever recorded*), flags not verdicts, results and CSV.
6. `h3` — **`Does an organiser ever have to write JSON?`**, on an element carrying
   **`id="no-code"`**, for the same reason. The binding "No. Organisers build questions and tests
   in a Pariksha UI…" paragraph, then `content-inventory.md` §5's pull quote verbatim, then two
   sentences of reasons — hand-author, script, diff, export; nothing is locked in. The closing
   clause *"The authoring interface is designed and not yet built"* survives; the half-sentence
   after it, *"this is the design"*, goes with M-2 (§4.1).

Both `h3`s sit under B3's `h2`, so `A4` is intact and no level is skipped. Their two `id`s cost
about forty bytes and make §9 conflict 1's "nothing link-rots" literally true: `#features` and
`#no-code` are real section ids in the page as built, and without them the claim was false, even
though the nav links only four anchors and the page is a week old.

### 4.4 B5 — cost, and where it runs

The `$0` `card-voltage`, both binding qualifications and the budget table are unchanged. The two
deploy cards collapse to one line each and CB-5 is deleted. The band gains the interoperability
strip, which is the re-tenanting of the integration-logo slot: four text labels with one line
each — JSON Schema in, CSV out, Cloudflare free plan, Docker (planned, Phase 11) — and **no logos
and no brand marks**. **The `(planned, Phase 11)` parenthetical is binding copy, not a note to the
writer**: the JSON-LD already dropped Docker from `runtimePlatform` because structured data is read
literally, and the prose and the graph must not drift back apart. The strip carries no mark,
because a third-party logo is a third-party asset, which `P7` and `constraints.md` §2.7 forbid
outright, and because a vendor's mark beside a product claim reads as
an endorsement that was never given. **CB-4** (`npx ajv`) lands here: it is the only command on the
page a visitor can run today that does something real, and it proves the open-format claim at the
moment the claim is made.

What the band must not become: no free/pro/enterprise column grid — there is one plan, and
inventing tiers to fill a layout is the most dishonest thing available on this page. No "contact
sales". No "free forever" as a promise; the arithmetic is an estimate with a named risk and the
copy says so. No dollar figure for what a paid platform would have cost — that number does not
exist in the repository, and `content-inventory.md` §8 forbids printing one.

### 4.5 B6 — who it is not for, and what is built

S8's eight sourced sentences survive **unshortened, uncarded and unsoftened**, as v2 §3 S8
requires, and gain a ninth absorbing FAQ Q9's substance: *anyone who believes browser proctoring
prevents cheating; our own documentation says it does not.* Order them with the four that actually
disqualify a buyer in the first thirty seconds first — needs to run a test this week; wants
somebody else to host it; a legally contestable high-stakes examination; candidates who will sit it
on a phone — which answers the "eight paragraphs at identical weight" complaint without moving a
single admission off the page or into an accordion.

Then an `h3` on `#status`: **`What is built today, and what is not?`** carrying, in order, S9's
existing dated release paragraph unchanged (it must still contain the literal strings `pre-alpha`
and `October 2026` — `seo-mechanics.md` §3.5e, `SEO-32`); the **Built and tested** list (the
formats, the JSON Schemas, the seventeen-question worked example, `packages/core` with all twelve
types and all five modes, "Phase 1 landed with 173 tests" — never a bare present-tense "173
tests"); the **Specified, not built** list with its PRD link; the BYOK `CardHairline` verbatim from
`content-inventory.md` §6 with its `Phase 9, not built` label; and, in place of the ledger, one
sentence — *twelve build phases under four milestones; one is complete and a second part done —
this website is its output* — followed by a link to `docs/ROADMAP.md`. Every barred phrase in v2
§3 S9 stays barred.

### 4.6 B7 — the FAQ at nine

Form unchanged: plain `h3` + `p`, two-column grid at ≥900px, stacking below. Not `<details>`, not
an accordion. Nine pairs at two columns is four and a half rows, which is a scannable set rather
than a queue. Every surviving answer still obeys `SEO-27b` and `T23b` — first sentence names
Pariksha.

**Surviving (nine):** Q2 (can I use it today — *more* valuable after v3, since it is the literal
query of someone who has just been scored by a demo), Q5 (where candidate data is stored — kept
against v2's own deletion order, deliberately, because its two other carriers are being compressed
in this same change and cutting it would have removed the privacy claim from the page by accident),
Q6, Q7, Q8, Q10, Q11, Q13, Q14.

**Cut (four):** Q3 (what "Pariksha" means — near-zero commercial intent; the Telugu `పరీక్ష` and
Devanagari `परीक्षा` forms survive in the footer's mono gloss with their `lang` attributes and in
`llms.txt`); Q4 (how much it costs to run — a pure duplicate of B5's `h2`, which is the same
literal query at a higher heading level with the `$0` numeral under it); Q9 (whether browser
proctoring prevents cheating — its substance moves to B6's ninth sentence, which is the better
home: that passage is the page's most-cited surface by `seo-mechanics.md` §3.5's own measure of
definitive language, so the sentence gains readers while the heading loses a query); Q15 (licence
and commercial use — **the one genuinely bad trade in this cull, made with eyes open**, because
"can I sell a service built on it" is decision-grade for the self-hosting developer; mitigated by a
sentence in the footer's licence column carrying Apache-2.0, the explicit patent grant, self-host,
modify, embed or sell a hosted service, documentation and schemas CC BY 4.0, and the name not
licensed with the code).

**`SEO-21` is unchanged and binding: there is no `FAQPage` JSON-LD, and there never was.** Any plan
that speaks of moving content "into the `FAQPage` JSON-LD where it keeps its AEO value" is
describing a structure this page does not have; the FAQ's AEO value comes from its `h3` + `p`
shape in the HTML, which is what `T23b` asserts.

### 4.7 B8 — the ask

Four elements, in this order, and nothing else: a declarative heading that converts the argument
into an instruction; **one filled button**, `Start with the worked example`, which is now the
page's only one below the fold and the second of two on the page; one secondary text link, *watch
the repository for v0.1*, which is the closest honest equivalent to a waitlist and collects
nothing; and one mono line of honesty as the last thing above the footer — pre-alpha, the formats
are ready to write against, the application lands with v0.1. It belongs at the end because by now
the reader has evidence to weigh it against.

**No artefact in the closing band.** No file listing, no code block, no mock. This is the one band
allowed to be mostly empty, and the emptiness is the signal that the argument is over and a
decision is being asked for; every pixel of evidence in the closer competes with the button.

**No email capture, no waitlist form, no newsletter, anywhere on the page.** Three reasons, each
disqualifying alone: the project has no list and no sending infrastructure (the API is Phase 2); a
form on a page whose central promise is that nothing leaves your browser contradicts itself in the
most visible slot available; and D3 forbids the network call the form would need.

### 4.8 Repository identifiers in body prose

`packages/core` survives in exactly one place in the page body — the demo's result panel, where it
is the point. `AC-29`, `ADR 0002`, `validateTest`, `PoolTooSmallError` and every other internal
identifier move to the footer's documentation column, which is the correct home for citations and
already exists. Where an inline source is genuinely load-bearing — the cost estimate's status, for
instance — say it in words (*a design target; the load test that would prove it has not been run*)
rather than in a code. The FAQ may keep sourced references in its answers. A page that cites its
own acceptance-criterion numbers is talking to a contributor, not a reader.

### 4.9 Weight targets

| Artefact | v3 | v2 / today | Rule |
| --- | ---: | ---: | --- |
| `dist/index.html`, uncompressed | **≤ 46 KB** | 100 KB / 53.4 KB | `P2` amended. See the note below: 40 KB was set before anyone measured what a three-question exam costs in prerendered HTML |
| The island, minified | **≤ 14 KB** (v4, §11) | — | D1 |
| HTML + island + CSS | **≤ 86 KB** | 83.8 KB | CSS should shrink — M-1's and M-2's mock rules and S9's ledger grid rules all go — against new rules for the demo's interactive states, which are the most stateful thing on the page. Fonts excluded |
| Content bands | **8** + footer | 11 + footer | V2 |
| Code blocks | **4** — `CB-1a` (hero), CB-1, CB-2, CB-4 | 6 | CB-3 and CB-5 deleted; CB-6 dissolves into one prose sentence in the demo's result panel; `CB-1a` is the hero's four-line excerpt (§3.8) |
| Rendered surfaces | **2** — the live demo, M-3 | 4 | M-1 becomes the demo; M-2 and M-4 deleted |
| FAQ pairs | **9** | 13 | §4.6 |
| **Syntax-highlight spans** | **`.tok-punct` deleted** | 71 spans, 2,201 bytes | New rule, below |

**The 40 KB gate does not survive measurement, and saying so is cheaper than discovering it at
build time.** The band table in §4 sums to **44,972 bytes**. Three rows drove the earlier 38,051:
B1 was costed at ~5,200 when the demo's prerendered markup alone measures 3,786 and `CB-1` measures
3,780 rather than the ~900 §9 assumed; B3 was costed at ~7,000 when today's `how-it-works` already
measures 10,884 before absorbing two bands; B6 was costed at ~3,000 against S8's 1,819 plus S9's
2,266 after the ledger goes. Reaching 40 KB from 45 would mean deleting about 5 KB that the cull
argued was undeletable — `CB-1`, M-3, two more FAQ pairs and both new strips — which is a worse
page than a 46 KB one. The gate is **46 KB**, about a KB of headroom over the derived sum because
six of the ten rows are derived rather than measured, and 14% below today's 53.4 KB. The length the
owner complained about was eleven bands, and eleven bands become eight.

**The `.tok-punct` rule, which is the cheapest 1,860 bytes on the page.** `CodeBlock`'s syntax
colour is four hand-written span classes. Measured across the built page they cost 4,316 bytes, of
which **`tok-punct` alone is 2,201 across 71 spans** — braces, brackets, colons and commas, each
individually wrapped, carrying no information whatsoever. `.tok-punct` is deleted; punctuation
takes the block's default code colour. `tok-key`, `tok-string` and `tok-number` stay, because they
carry JSON's own type distinction. On the blocks that survive into v3 this saves 1,271 bytes on
`CB-1` and 589 on `CB-2`, it removes one selector from `T27`'s `SURFACE` map, and it deletes no
content, no heading, no query string and no honesty. Under a brief that says *remove unnecessary
content*, per-character punctuation colouring is the most unnecessary content on the page.

**If the build comes in over 46 KB**, the deletion order is decided here and not at build time, and
it drains the bands that overran rather than the FAQ: **B2's verification strip** → **B5's
interoperability strip** → **FAQ Q13** (*Can I write questions before the app exists?* — answered
three times over now by the demo, the bridge band and CB-4, and the only surviving pair the demo
genuinely made redundant) → B3's four one-line specified statements collapse to two → B5's budget
table collapses to one sentence of arithmetic. **FAQ Q14 and Q6 are at the bottom of that list, not
at positions two and three**: §4.6 says in terms that with S9's band gone, Q14 and the BYOK card
are the only places AI is answered on the page, and an overflow valve that deletes the AI answer to
pay for a hero code block is a valve pointed at the wrong thing.

**If it comes in under 42 KB**, the restore order is: the `H-3`/`H-4` prose in the bridge band
restored to full length first — it buys machine-readable honesty rather than one more query
string — then FAQ Q15, then FAQ Q9. This replaces `P2`'s order.

**If the owner reinstates 40 KB as binding**, the first cut is `CB-1` in B3 step 01 (−2,513 with
`.tok-punct` gone), which lands the page at ~42.5 KB and leaves `CB-1a` in the hero as the only
JSON on the page; the second and third are FAQ Q13 and M-3. That trade is recorded rather than
taken, because `CB-1` is the format this product sells and a landing page for a JSON-format product
should print it once in full.

---

## 5. Amendments to v2, by id

Anything not listed is unchanged and binding.

### Performance

| id | Change |
| --- | --- |
| **P1** | **Amended.** Was: `dist/index.html` contains no `<script type="module">` and no `<script src="/assets/`; the page ships 0 bytes of JavaScript. Now: `dist/index.html` contains **exactly one** `<script type="module" src="/assets/…">`, which is the exam-demo island, and **no inline script of any kind**. The island is ≤ 14 KB minified (v4, §11 — was ≤ 10 KB). Nothing else about P1's reasoning changes: no framework runtime reaches the browser, no third-party origin is contacted, and the page's content is still entirely in the prerendered HTML |
| **P2** | **Amended.** 100 KB → **46 KB** uncompressed, island counted separately against its own budget. 40 KB was the figure before the band table was measured; §4.9 shows the derivation and the deletion order that replaces `P2`'s |
| **P3** | Unchanged. One stylesheet, hashed, from `/assets/`. The island is a script, not a stylesheet |
| **P4, P5** | Unchanged |
| **P6** | Unchanged, **re-scoped**: the three wide objects are now the demo panel, CB-1/CB-2/CB-4, and B4's table. The demo reflows rather than scrolls (§3.10), so it is the one of the three that must not have a scroll region |
| **P7** | **Unchanged, and load-bearing.** `public/_headers` keeps `default-src 'self'` with no `'unsafe-inline'`, no `'unsafe-eval'` and no `https?://` substring. The island is specified to need no change to this file; a design that needed one would be the wrong design |
| **P8** | Unchanged. The island adds no transition and no animation |
| **P9** | **Extended.** No transform, no keyframe, no scroll-triggered reveal, no counter, no parallax, no hover lift — **and, now, no `setInterval`, no `requestAnimationFrame`, and no `setTimeout` with a non-zero delay anywhere in the island.** The island's DOM swaps are state changes, not motion |
| **P10** | **Vacated.** Nothing bleeds past the wrap. The acceptance is now trivially satisfied, which is a strictly safer state for `P6`. The negative-margin construction it specified is deleted along with the bleed |

### Accessibility

| id | Change |
| --- | --- |
| **A1** | **Extended, not changed.** Every new selector that declares `color:` — the demo's question, fieldset, controls, fallback, result, key and score blocks — must be added to `contrast-usage.test.ts`'s `SURFACE` map or `T27` fails the build. **The panel is a cream plane, so the surface for all of them is cream, not white**, which is the stricter check |
| **A2, A3** | Unchanged. A3 still covers the hero's cream code plane, which is now CB-1 in the bridge band |
| **A4** | Unchanged, and now load-bearing in two new places: B3's two absorbed `h3`s and B6's `#status` `h3` sit under their band's `h2`, and the bridge band's `h3` sits under the `h1`. No level is skipped |
| **A5, A6** | Unchanged |
| **A7** | **Amended.** The demo is no longer a horizontally scrolling container, so A7's `tabIndex={0}` / `role="region"` / `aria-labelledby` requirement no longer applies to it. A7 continues to govern every code block and B4's table |
| **A8** | **Amended.** The demo panel is **not** `aria-hidden`, and the adjacent `visually-hidden` description is replaced by the panel's visible `h2` and subline. A8 continues to govern M-3, the one remaining mock, and every table's `<caption>` and every code block's caption bar |
| **A9** | Unchanged, and the demo is where it is tested hardest: visible focus on every control, tab order following source order, `outline: none` nowhere without a replacement |
| **A10** | **Extended.** Palette squares reach a 44 × 44 hit area through button padding while the visual square stays 36 × 36 |
| **A11** | **Extended.** No information by colour alone, now including: every result verdict is a word in the DOM; every palette button carries its state as a word in its `aria-label`; `Mark for review` carries `aria-pressed` |
| **A12** | Unchanged, and its recorded limit matters more now: jsdom has no layout engine, so axe says nothing about the demo at 400px. `A1` remains the only contrast gate |
| **A13** | Unchanged. No emoji, and no glyph as the only carrier of correctness |
| **A14** | Unchanged. The `prefers-reduced-motion` page stays **pixel-identical** to the default page, which is only true because §3.6 adds no motion. This is the test that the motion budget is right and the demo must not be the thing that breaks it |
| **A15+** | **None.** v3 adds no new `A`-numbered criterion; every accessibility change above is an extension of an existing one. The new ids this document introduces are `H-1`–`H-9` (honesty, §7), `I-1`–`I-10` (the island, §2.9) and `E-6`–`E-9` (layout and enhancement, §3.1–§3.2), none of which collide with v2's `P`, `A`, `SEO` or `T` space |

### SEO, AEO, GEO, AIO

| id | Change |
| --- | --- |
| **SEO-1** | Unchanged and still the item everything else depends on. The page prerenders to static HTML |
| **SEO-2** | **Amended.** Was: `/` ships zero client JavaScript. Now: `/` ships exactly one client module, the exam-demo island, which **creates no content a crawler or an answer engine needs**. Every extractable string on the page — all three questions, every heading, every answer-first paragraph, CB-1 — is in the prerendered HTML. The island's output is invisible to machine readers by design, and that is why the bridge band is prerendered rather than built |
| **SEO-3 – SEO-25** | Unchanged. `SEO-21` in particular: still no `HowTo`, no `BreadcrumbList`, no `SearchAction`, **no `FAQPage`** |
| **SEO-26** | **Re-affirmed, with the eyebrow resolution** (§4). Question-shaped `h2`s stay; a declarative `mono-sm` eyebrow sits above each |
| **SEO-27, SEO-27b** | Unchanged, now applying to six `h2`s and the three absorbed `h3`s rather than eleven `h2`s |
| **SEO-28 – SEO-32** | Unchanged. The hero's shortened lead must still carry the dated status clause |

### Tests

| id | Change |
| --- | --- |
| **T1, T3, T5 – T19, T21, T23b, T24, T24b, T26, T26b, T28 – T31** | Unchanged |
| **T2** | **Inverted.** Was: `dist/index.html` contains no `<script type="module"` and no `<script src="/assets/`. Now: it contains **exactly one** `<script type="module" src="/assets/…">`, that file exists in `dist/` and is non-empty, and the document contains **no inline `<script>` other than the single `application/ld+json` block** |
| **T4** | **Extended.** The admin-path assertion now runs against the island entry's module graph as well as the prerender entry's. Admin code in the island would be admin code on the public page by a different route |
| **T20** | **Amended.** (a) dies: the first link inside `.hero-section` is no longer `Start with the worked example`, because the primary CTA has moved to B8. It is replaced by: the hero contains **no `ButtonPrimary`**, and the **only** `ButtonPrimary` on the page is in B8. Note `I-8`: the demo's `Finish` is a filled control but is **not** the `ButtonPrimary` component and must not carry its class, so the island cannot satisfy this selector at runtime either with accessible name `Start with the worked example` and href `https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude`. (b) survives unchanged and is now more valuable: **every** CTA-shaped link on the page points at a `github.com/SriSatyaLokesh/pariksha` URL |
| **T22** | **Amended.** Twelve section assertions become **nine** — B1 through B9, each by its verbatim `h2`, and by `id` for the seven that have one (B1 and B8 have no `id`; the earlier wording said "nine bands by id", which was never true of those two). Three new assertions replace the three deleted ones: the `h3`s `What does Pariksha do?` and `Does an organiser ever have to write JSON?` exist inside `#how-it-works` **carrying `id="features"` and `id="no-code"` respectively** (§4.3), and `What is built today, and what is not?` exists inside `#not-for` on an element whose `id` is `status`. The hero's panel `h2` `Try three questions` is asserted too, since it is the ninth `h2` and the one `T23`'s allow-list newly covers |
| **T23** | **Amended.** The allow-list becomes `["Try three questions", "Questions and answers", "Read one real test, end to end.", "Footer"]`. `Try three questions` is new on the list and must be on it: the hero's demo panel carries an `h2`, it is declarative, and an earlier draft both omitted it and miscounted the page's `h2`s as six. The page carries **nine** `h2`s, of which four are allow-listed and **five** are question-shaped. The rule is **extended to the three absorbed `h3`s**: each ends in `?` and is followed by a `<p>` of 40–60 words whose first sentence contains `Pariksha` — including `What does Pariksha do?`, whose paragraph is **new copy** written to §4.3 item 5a, not S5's reprinted one |
| **T25** | **Amended.** "Every code block" now means four, not six — `CB-1a`, `CB-1`, `CB-2`, `CB-4`. The `ProductMock` clause applies to **M-3 only**; M-1, M-2 and M-4 no longer exist, and the demo panel is explicitly exempt because `A8` no longer applies to it |
| **T27** | **Amended in scope, not in shape.** The `SURFACE` map is rewritten again, wholesale: the demo's new selectors arrive (on cream) and M-1's, M-2's, M-4's and the ledger's leave. Budget for it as a real task; its three structural tests and its per-selector WCAG test are unchanged |
| **T32** | **Amended, and converted from a ratio to an absolute offset.** Was: the byte index of B2's definitional sentence divided by the file length stays under 0.30. Now: **that byte index is under 13,500**, full stop. A ratio is the wrong instrument for this change and would have failed for the reason v3 exists — the numerator necessarily grows (V1 puts a 3,786-byte exam in the hero) while the denominator necessarily shrinks (V2 cuts three bands), so every later deletion pushes the test redder. The absolute figure is derived and stated: head and nav measure 6,632 today and do not change, which leaves **6,868 bytes for all of B1** against §4's derived 6,790, with 78 bytes of margin. Today the sentence sits at 9,322; 13,500 is 4.2 KB later, and that 4.2 KB is the measured cost of putting an exam and its source file in the hero. **T32 is still the hero's byte ceiling** and the test's comment should say so. If B1 grows, the cut order is §3.8's: the bridge band's `H-3`/`H-4` prose shortens first, then `CB-1a` loses its `scoring` line. **v4 (§11): the 6,790-byte B1 target this derivation rests on no longer describes the three-card hero** — the number is left unmoved pending a real measurement (not a guess) against the built Hero.tsx/CSS; §11 names the deletion order if it is breached |
| **T33 – T40** | **New.** §6 |

**Tests that die with their sections.** No `T`-numbered test disappears outright, but four existing
files lose blocks and the implementer should expect red before green:
`apps/web/test/sections-s4-s6.test.tsx` loses every S5 and S6 assertion and gains the two `h3`s in
B3; `apps/web/test/sections-s7-s9.test.tsx` loses the twelve-row ledger assertions and gains the
`#status` `h3`; `apps/web/test/blocks.test.tsx` loses CB-3 and CB-5 and keeps CB-1, CB-2, CB-4;
`apps/web/test/components.test.tsx` loses M-2 and M-4; `apps/web/test/sections-s1-s3.test.tsx` is
substantially rewritten, since the hero is the band that changed most. `apps/web/test/landing.test.tsx`
keeps all of `T21`, including **zero `[style]` attributes**, which the island must also respect at
runtime (`I-7`).

---

## 6. The test plan

**This is a TDD build and the order below is the build order.** Write the failing assertion before
the thing it asserts. The order is chosen so that the two tests that can kill the design — the
prerendered markup is complete without the island (`T34`), and the island is under budget
(`T35`) — are green before any of the island's behaviour is written.

### Wave 0 — the island's contract, before the island

| # | File | Assertion |
| --- | --- | --- |
| **T34** | **new** `apps/web/test/demo-static.test.tsx` | Render `Landing` with no island whatsoever. The demo root carries `data-demo`; all three questions are present with `data-demo-q` and their `data-qid`; question 1 is visible and questions 2 and 3 carry `hidden`; every `<input>` for all three questions exists with its `name` and `value`; the `aria-live` region exists and is empty; **the control row contains the literal sentence `Scoring, and questions 2 and 3, need JavaScript.` followed by an `<a>` to the worked example, and no `<button>` anywhere in the demo**; the palette strip is present as `aria-hidden` `<span>`s; `data-demo-result` exists and is `hidden`. The earlier form of this assertion — "exactly one element" — forbade the sentence that `D2` needs, and asserted a shape instead of the property it was protecting; "the fallback link, the sentence, and no `<button>`" is what actually makes the no-JavaScript page whole. **This is the most important test of the v3 build** — it is D2 made mechanical |
| **T37** | **new** `apps/web/test/demo-questions.test.ts` | `src/island/questions.ts` agrees with `examples/reasoning-aptitude/questions.json`, read from disk: for each of `LOG-001`, `QNT-004`, `LOG-007`, every prompt, option id, option text, key, `scoring.mode`, `scoring.points` and `explanation` is byte-identical, and the option order matches the file's. Catches the whole class of defect where a stem is "improved" on the landing page and silently diverges from the product's own worked example |
| **T34b** | `demo-static.test.tsx` | **Scoped to the subtree under `data-demo`, exactly as `T34c` is**, and then: no `You scored`, no `/ 2 Partly correct`, no `Not answered`, no verdict word, no `%` adjacent to a score. Runs against the built file, not the component. Scoping is not optional — a whole-document grep for the bare strings `Correct` and `Wrong` would fail the build the first time a surviving sentence in B6 or the FAQ began with either word, and both bands are full of definitive prose by design |
| **T34c** | `demo-static.test.tsx` | `dist/index.html` contains **no** demo question's `key` or `explanation` string inside the demo panel's markup. `CB-1a` in the bridge band and `CB-1` in B3 step 01 are the two sanctioned occurrences of `LOG-001`'s key and explanation; both sit outside the panel, and the assertion is scoped to the subtree under `data-demo` |

### Wave 1 — the island as an artefact

| # | File | Assertion |
| --- | --- | --- |
| **T35** | **new** `apps/web/test/island.test.ts` | Builds, reads `dist/.vite/manifest.json`, and asserts: exactly one entry chunk is referenced by a `<script>` in `dist/index.html`; its file exists; **its minified size is ≤ 10 KB**, with the number printed to the build log whether it passes or fails; and no other `/assets/*.js` file is referenced anywhere in `dist/index.html` |
| **T36** | `island.test.ts` | A grep of the **built** island source finds none of: `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `localStorage`, `sessionStorage`, `document.cookie`, `indexedDB`, `caches`, `PerformanceObserver`, `navigator.clipboard`. D3, made mechanical. The test greps the build output rather than the source so a dependency cannot smuggle one in |
| **T39** | `island.test.ts` | The same grep finds no `setInterval`, no `requestAnimationFrame`, and no `setTimeout` whose second argument is a non-zero literal. `P9` extended |
| **T40** | `island.test.ts` | The built island contains no `.style` assignment, no `setAttribute("style"`, and no colour literal — the same regex set `no-hex-colors.test.ts` uses after `T28` widened it. The island must not route around `A1` |
| **T2** | `prerender.test.ts` | As amended in §5: exactly one module script, from `/assets/`, whose target exists; no inline script other than the one `application/ld+json` block |

### Wave 2 — the island's behaviour

All in **new** `apps/web/test/island-machine.test.ts`, under jsdom, against the real prerendered
markup rendered by `renderToStaticMarkup` so the test and the page cannot drift.

| # | Assertion |
| --- | --- |
| **T33a** | After `init()`, the control row holds four buttons in order — Back, Mark for review, Next, Finish — the fallback link is gone, `Back` is `disabled`, and the palette holds three `<button>`s each with an `aria-label` carrying a state word and `aria-current="true"` on the first |
| **T33b** | Checking `LOG-001`'s option `c` sets palette square 1 to answered, updates the Finish label to `Finish (1 of 3 answered)`, and **does not advance the question** |
| **T33c** | `Next` shows question 2, hides question 1, moves focus to question 2's `<li>`, and writes `Question 2 of 3. True or false. 1 point.` to the live region; a second `Next` writes `Question 3 of 3. Select all that apply. 2 points.` `Back` reverses it. A palette click jumps |
| **T33d** | `Mark for review` toggles `aria-pressed`, restyles the square, and announces; a marked and answered square keeps both facts in its `aria-label` |
| **T33e** | **The scoring is the real scoring.** With `c` on `LOG-001`, `False` on `LOG-007` and `a`+`c`+`b` on `QNT-004`, Finish renders the three rows **in question order** — `2.00 / 2 Correct`, `0.00 / 1 Wrong`, `0.67 / 2 Partly correct` — and a total of `2.67 out of 5`. The expected values are computed in the test by calling `gradeChoice` directly, not hard-coded, so the test asserts *the island calls the engine* rather than *the island knows these numbers* |
| **T33f** | Finish with nothing answered scores `0.00 out of 5`, every row reads `Not answered`, **no explanation is rendered for any row**, and the second line is the non-punitive string. Finish with everything correct renders no explanations either |
| **T33g** | On Finish, focus moves to the result `<h3>` and **the live region is empty** — the one place where silence is the assertion |
| **T33h** | `Try again` returns to question 1 with every input unchecked, every mark cleared, the palette reset, the result panel emptied and `hidden`, and focus on question 1 |
| **T33i** | `Enter` on questions 1 and 2 advances; `Enter` on question 3 finishes. **And the three negative cases, which are the reason the guard exists**: `Enter` with focus on `Back` moves back exactly one question and not forward again; `Enter` with focus on `Mark for review` toggles the mark and does **not** advance; `Enter` with focus on palette square 3 jumps to question 3 and does **not** finish the attempt |
| **T33j** | **Pre-init state is preserved.** Check `LOG-001`'s option `b` in the DOM *before* calling `init()`; after init, `b` is still checked, the palette shows question 1 answered, and the Finish label reads `1 of 3` |
| **T38** | **Failure falls back to the static markup.** Three cases: (a) `data-demo` absent — `init()` returns and the DOM is byte-identical to the input; (b) a required hook missing — same; (c) a listener throws (injected by stubbing `gradeChoice` to throw) — the control row's original sentence **and** `<a>` are both restored, no button remains, question 1 is visible, the result panel is `hidden` and empty, and the live region is empty. **In no case is a broken hero left on screen** |
| **T33k** | Zero axe violations on the demo in each of four states: question 1, question 2, question 3, and the result panel. Extends `T21`'s axe pass, with `A12`'s limit recorded — jsdom contributes no contrast coverage |

### Wave 3 — the page

| # | File | Assertion |
| --- | --- | --- |
| **T22** | `landing-content.test.tsx` | Nine bands by id and verbatim `h2`, plus the three absorbed `h3`s (§5) |
| **T23** | `landing-content.test.tsx` | As amended: six `h2`s and three `h3`s under the question-shape and 40–60-word rules, with the `Pariksha` clause |
| **T41** | **new**, in `landing-content.test.tsx` | **The deleted things stay deleted.** The rendered text contains no `Phase 4`…`Phase 12` ledger row shape, no `.md · NNN lines` file-listing shape, and the page contains exactly four code blocks — `CB-1a`, `CB-1`, `CB-2`, `CB-4` — and exactly one `ProductMock` |
| **T42** | **new**, in `landing-content.test.tsx` | The FAQ contains exactly nine `h3`s, and none of them is one of the four deleted questions |
| **T43** | **new**, in `landing.test.tsx` | `dist/index.html` is **≤ 46 KB**, with the byte count printed. `P2` amended; §4.9 derives the figure from the measured band table and names what is cut if the build lands over it |
| **T32** | `landing-content.test.tsx` | As amended: B2's definitional sentence sits under 30% of the file, stated in the comment as the hero's byte ceiling |
| **T27** | `contrast-usage.test.ts` | The `SURFACE` map covers every new demo selector, on **cream**, and loses the `.tok-punct` entry (§4.9) |
| **T44** | **new**, a real-browser pass — not jsdom | At **400 × 667** and **320 × 568**, over all four demo states (questions 1, 2, 3 and the result panel): `E-9` — question 1's first option is within the first 600px of the viewport at scroll 0; `E-6`, `E-7`, `E-8` — no layout shift when the island initialises, measured as the panel's and the palette strip's height before and after `init()`; the focus ring is visible on every control; no body-level horizontal scrollbar (`P6`). This is the one test that costs a browser, and it is cheaper than any three of the tests above it: §6's own "not covered" note records that jsdom has no layout engine, and three of the six findings that revised this document were layout-at-width problems that no existing test could have caught |

### Not covered by any test, and said out loud

- **Contrast, and anything else needing a layout engine beyond `T44`'s four checks.** jsdom gives
  axe no layout, so `T33k` contributes nothing on contrast; `A1` and `T27` remain the only contrast
  gate. `T44` now covers the three things that were previously listed here as uncovered — `E-9`'s
  fold, `E-6`–`E-8`'s zero layout shift, and the visible focus ring — because three of the six
  blocking findings against this document were layout-at-width problems and leaving them to a
  future issue is how they ship.
- **The minified-size measurement is the build's, not a simulation.** `T35` measures what Vite
  emitted. If the bundler's settings change, the number changes, which is correct.
- **Pre-alpha honesty remains a review gate** (§7), not an assertion. `T26` catches the AI phrases
  and `T26b` catches an unqualified number; nothing catches a sentence that quietly implies the
  application runs.
- **Live deployment and the headers as actually served** — issue 135, unchanged.

### The commands CI runs

Unchanged: `pnpm lint && pnpm typecheck && pnpm build && pnpm test`. `pnpm build` now also builds
the island; a dirty `tokens.css` after a build still means a hand-edit.

---

## 7. Honesty acceptance for the demo

D5 in full: **nothing on this page claims the application ships today, and the demo makes that
harder rather than easier.** A visitor who has just taken an exam will assume the product exists.
The correction must be carried by the demo itself, continuously, and in the product's own voice —
not by a disclaimer attached to it.

| # | Acceptance |
| --- | --- |
| **H-1** | The word `DEMO` is visible in the panel chrome in **every** state, including the result panel |
| **H-2** | No running clock anywhere on the page; the timer slot reads `Timer off`, and the result panel says in prose that a real attempt runs its clock on the server |
| **H-3** | **The bridge band's prerendered prose** states that the answer key is in this page because there is nothing to call, and that a real Pariksha test keeps the key on the server where it never reaches a candidate, re-checks every rule there and runs the clock there. The result panel echoes it in short form. **The prerendered carrier is the binding one**: the island's output is absent from `dist/index.html` by design and `T34b` proves it, so a criterion carried only by the result panel would be invisible to `R3`, to every answer engine, and to every visitor with JavaScript off — and the ledger it replaced was 2,964 extractable bytes |
| **H-4** | **The bridge band's prerendered prose** states which part of what just happened is built — `@pariksha/core`, the scoring engine, the formats, the schemas, this worked example — and which parts are specified and not built: the runner, the server, proctoring, the results CSV. The result panel echoes it. Same binding rule as `H-3` |
| **H-5** | Nothing in the demo, the bridge band or the hero's lead asserts the application ships today, in any tense. The hero's shortened lead still carries the dated status clause and the literal string `October 2026` |
| **H-6** | **The chrome row's third line** promises that nothing the visitor types leaves the page, and it appears **before** the visitor can type anything (the subline it used to sit in is folded into the chrome — §3.9). `T36` is the machine-readable proof of that promise and the two must never disagree |
| **H-7** | Every factual claim in the demo's prose and in the bridge band traces to a row in `.planning/landing/content-inventory.md` with a file path beside it (D4, the sourcing rule). No claim is added to the page by the demo that was not already sourced for v2, with the single exception of the coverage figure in B2's verification strip, which is sourced at `content-inventory.md:674` |
| **H-8** | The demo renders no number that was not produced by `gradeChoice` or `round2`, and no number about a visitor population, a competitor or an adoption figure at all |
| **H-9** | With JavaScript off, the panel says so: the control row carries the literal sentence `Scoring, and questions 2 and 3, need JavaScript.` A panel that announces three questions and a browser-side score, and then delivers one question and no score, is the one honesty failure the demo creates that the static page never had. `T34` asserts the string |

**And the standing review gate**, unchanged from v2 and more important now: a human reads the
finished page once, asking only "does any sentence here imply the application runs today". The
tests cannot do it. The reviewer who filed issue 137 does it.

---

## 8. Left to the implementer

Decided above, so nobody asks: everything in §2 through §7. Left open on purpose, because a
competent implementer will do it better at the keyboard than this document can at a distance.

1. **Every sentence not quoted verbatim.** The copy is written against `content-inventory.md`, and
   the rule is unchanged: if a claim is not in that file with a file path beside it, it does not go
   on the page. This includes the result panel's two prose lines (§3.7), the panel subline (§3.9),
   the hero's shortened lead, B2's verification-strip line, B5's interoperability lines, B6's
   ninth not-for sentence, B8's heading and honesty line, and the footer's licence sentence. The
   substance of each is fixed here; the sentences are copy's.
2. **Class names and the CSS**, following the existing BEM-ish convention. Two notes the
   implementer will otherwise hit: `<legend>` needs
   `display: block; width: 100%; padding: 0; float: none;` to lay out as a normal block, and the
   selected-option styling now comes from `:has(input:checked)` on the `<label>` rather than from a
   server-rendered modifier class.
3. **The precise `min-height` values** for the question area and the control row at each
   breakpoint. The requirement is zero shift; the numbers are measured, not specified.
4. **Whether `Mark for review` ships**, decided by the measured island size (§2.5).
5. **The island's internal shape** — how many functions, where the renderer splits — provided the
   state is §2.4's, the hooks are §2.3's, and the failure behaviour is §2.8's.
6. **The eyebrow strings** (§4), two to four declarative words per band. One thing about them is
   not left open, because it would quietly break `SEO-27`: the eyebrow is a **sibling** of the
   `h2`, never a child of it. An eyebrow inside the `<h2>` changes the extractable heading string
   from a literal query to a label plus a query, which is the exact asset `SEO-26` and
   `seo-mechanics.md` §3.5 paid for.
7. **Where `scroll-margin-top` is set**, unchanged from v2 §9.5, and now also covering the
   `#status` `h3` inside B6 — the anchor must not hide its heading under the 64px sticky nav.
8. **The nav labels.** Five items with two repository destinations reads as a repository's nav;
   product surfaces come first and source goes last or into the footer. The anchors themselves are
   fixed by §4's id column.
9. **The 404 message and `admin.html`'s `lang`**, unchanged from v2 §9.

---

## 9. Where the three plans conflict, and the call

Four conflicts, each resolved above; recorded here so the resolution is reviewable rather than
buried.

**1. The spine.** `v3-cull.md` §5 gives a nine-band spine derived from measured byte counts and
query costs; `v3-saas-craft.md` §7 gives an eight-band spine that merges the comparison table into
the feature band. **The cull wins.** Its own §2 refuses that merge for the right reason —
`seo-mechanics.md` §3.5d names the comparison table the single most liftable asset the project
owns, and a cull does not spend its most liftable asset to save 3.8 KB — and the cull's spine
preserves every existing anchor. **It does not quite preserve them for free, and the earlier
"nothing link-rots" was a claim rather than a fact**: `#features` and `#no-code` are real section
ids in the page as built, and both bands disappear. The nav links only four anchors, so in-page
navigation survives untouched and the page is a week old, which makes the real cost near zero —
but the fix is cheaper than the caveat, so §4.3 gives the two absorbed `h3`s those two ids for
about forty bytes and the claim becomes true. What `v3-saas-craft.md` contributes is
adopted into the cull's bands rather than as a different spine: the primary-action hierarchy (§3.1,
§4.7), the social-proof and integration re-tenanting (§4.2, §4.4), the pricing card's true
contents (§4.4), and the artefact-free closer (§4.7).

**2. Declarative headings.** `v3-saas-craft.md` T1 wants the interrogative `h2`s converted; `SEO-26`
and `v3-cull.md`'s governing rule both forbid deleting a question-shaped heading. **Resolved by
the eyebrow** (§4): the eye gets a declarative label, the extractor keeps the question. T1's
complaint is answered; its proposed fix is declined, with the reason stated.

**3. The key in the page.** `v3-cull.md` §1 makes it a hard rule that no demo question's key or
explanation is reachable before the visitor answers; `v3-hero-demo.md` §3.4 prerenders `LOG-001`'s
complete JSON — key and explanation included — as the bridge band. **Both survive, scoped**
(§3.8): the rule governs the demo panel's markup, which prints neither, and `T34c` asserts it; the
bridge band prints one key openly as the demonstration that the §3.7 disclosure is literal. Nothing
is at stake in a demo that stores nothing.

**4. CB-1 printed twice. Reversed on measurement.** `v3-hero-demo.md` §3.4 puts `LOG-001`'s JSON
in the hero's bridge band; `v3-cull.md` §5 keeps `CB-1` in B3's step 01. The earlier resolution —
*printed once, in the hero, saves ~900 bytes* — rested on a number that is wrong by a factor of
four: `CB-1` in the built page is **3,780 bytes**, measured, because syntax-highlighting spans are
most of it. With head and nav at 6,632 and `T32`'s hero ceiling at 13,500, B1 has 6,868 bytes, and
copy plus the demo's 3,906 bytes of prerendered markup plus the band's prose already spends 5,810
of them, leaving 1,058. The hero and the full file cannot both sit above the fold.

**The resolution, in one sentence, because the two reviews pull opposite ways here** — the demo
lens calls the bridge band the best thing in the document and wants the artefact under the exam;
the discoverability lens has the arithmetic and wants `CB-1` in B3: **the hero prints `CB-1a`, the
four lines that carry the argument — `id`, `key`, `scoring`, `explanation` — at about 900 bytes,
and B3 step 01 prints `CB-1` entire**, because those four lines are the whole of what the first
review named (the key and the explanation sitting under the exam the visitor has just answered,
as an artefact rather than a claim) and the rest of the object is a listing, which belongs beside
the two files that sit next to it in the repository. Nothing the first review asked to preserve is
lost; the 3,780 bytes are.

**One thing both plans got wrong, corrected in passing.** `v3-saas-craft.md` §6 T5 proposes moving
four of S8's admissions "into the `FAQPage` JSON-LD where they keep their AEO value". There is no
`FAQPage` JSON-LD on this page and `SEO-21` forbids adding one. The move is declined on its own
merits as well (§4.5) — S8 is 1,820 bytes of the cheapest trust the project owns, v2 §3 S8 says do
not shorten it, and moving four admissions into an FAQ that is itself being cut from thirteen pairs
to nine would be a strange way to make a page shorter.

---

## 10. Rejected review findings

Two adversarial reviews were run against the draft of this document — one through the demo and
interaction lens, one through the discoverability and byte lens. Eleven of their twelve blocking
items are fixed above, in the section each names. The ones below are declined, or adopted in a
different form than proposed, with the reason. Where the two lenses pulled against each other the
call is stated in one sentence and the reason with it.

**1. "Reorder the questions to `LOG-007`, `LOG-001`, `QNT-004`." Half adopted, half declined.**
The ending is adopted — `QNT-004` moves last, so the fractional score is freshest when the result
panel explains it. The opening is declined on the review's own evidence: `LOG-007`'s prompt is 136
characters and sets to four lines at 320px of content, against `LOG-001`'s two, so opening on it
moves the first option 58px *down* and breaks `E-9`, the criterion the same review's first blocking
item exists to establish. The review argued the true/false question "is one line" and "shortens the
stack"; it is neither. Where the two findings collide the fold wins. §3.3 now carries a
visitor-side reason for `LOG-001` first — it is the only stem in the set short enough to clear the
fold on a small phone — rather than the two repository-side reasons the review rightly rejected.

**2. "Print `CB-1` once, in B3, and leave the hero's bridge band as a heading, a sentence and an
anchor."** The arithmetic is accepted in full and the conclusion is adopted in part. The hero keeps
a four-line excerpt (`CB-1a`, ~900 bytes) so that the key and the explanation still sit under the
exam the visitor has just answered — which the other review named as the best thing in the document
and asked specifically not to be traded away — and `CB-1` entire moves to B3 step 01. §9 conflict 4
carries the one-sentence call.

**3. "Show the explanation on correct answers too."** Declined in favour of the cheaper half of the
same finding. The complaint is right — a clean sweep earns the thinnest panel in the design at the
moment of highest goodwill — and the fix is one sentence (*"All three. The worked example has
fourteen more."*), not three explanations the visitor has just demonstrated they do not need.
`T33f` stands.

**4. "Move the negative-marking claim to the bridge band."** Adopted, relocated. The claim is
indeed the one thing in the result panel told rather than shown, sitting under three numbers that
were shown. But the bridge band prints `questions.json`, which does not configure negative marking;
`test.json` does, and `test.json` is `CB-2`. The sentence moves to B3 step 02, beside the JSON that
sets it (§4.3).

**5. "Drop the inert palette from the prerendered markup."** Declined, of the two options that
review offered. The palette stays as inert status and the new no-JavaScript sentence explains it,
because it is the clearest signal in the panel that this is an exam runner rather than a quiz
widget — which is the same reason §2.5 now cuts the palette's *behaviour* before `Mark for review`
under byte pressure, reversing the earlier order on the same review's advice.

**6. The 40 KB gate.** Neither review asked for this and both assumed it; it is raised to 46 KB
(§4.9) because the band table, re-derived from measured bytes as the second review demanded, sums
to 44,972. This is the one change in this revision that goes beyond what either review asked for,
and it is the one most likely to be overruled. The alternative — deleting `CB-1`, M-3, two more FAQ
pairs and both new strips to reach 40 — is recorded in §4.9 so the owner can take it in one
instruction.

**What each review named as the best thing, and where it now lives.** The first named §3.8, the
bridge band, and §3.7's *"What is not real"* paragraph — the compromise admitted in the same breath
as the architecture that makes it unnecessary in production. Both survive: the bridge band keeps
`CB-1a` and gains the prerendered `H-3`/`H-4` prose, which makes it *more* load-bearing than it
was, and §3.8 now says in terms that a revision must not move it inside the result panel or trade
it for a conversion widget. The second named the FAQ at nine, and in particular keeping Q5 against
v2's own deletion order because the two other carriers of the privacy claim were being thinned in
the same change. §4.6 is unchanged by this revision; the only FAQ movement is in §4.9's overflow
order, which now drains Q13 — the one pair the demo genuinely made redundant — and puts Q14 and Q6
at the bottom of the list where that review said they belong.

---

## 11. v4 amendment — the three-card hero

This section amends §3 (the hero) by id, the same way §1–§10 amend v2. Everything in §3 not named
below stays as written — the chip, the lead's 30-word budget and dated status clause, the two
secondary text links, the demo's state machine, scoring, keyboard and honesty rules (§2.4, §3.4–§3.9,
§7). What changes is the hero's **layout**: one question stacked vertically becomes three questions
side by side, and the product name moves out of the `h1` into a dedicated masthead.

**Reference.** The owner reviewed a working, clickable prototype and approved it as-is:
`.planning/landing/v4-hero-prototype.html`. Where this section and that file disagree, the
prototype is the specification — it is a real document with real tokens, real questions from
`examples/reasoning-aptitude/questions.json` and working scoring, not a sketch. The prototype
carries chrome that does not ship: the font switcher, the `PROTOTYPE` badge, the next-band stub and
its inline `<script>` scoring (real builds grade through `@pariksha/core` in the island, never
inline — `P1`, `I-1`).

### 11.1 Three cards, not one question

The demo panel's single `<ol>` of three sequential questions (§3.2) becomes three cards in a row,
each one question, answerable independently and all visible at once — no `Next`/`Back`/`Finish`
sequencing, no palette as a jump list. Verbatim from `questions.json`, six points total:

| Card | id | type | mode | points | control |
| --- | --- | --- | --- | ---: | --- |
| 1 | `LOG-001` | `single` | `all_or_nothing` | 2 | four radios, `name="LOG-001"` |
| 2 | `QNT-004` | `multiple` | `partial` | 2 | five checkboxes |
| 3 | `LOG-003` | `matching` | `partial` | 2 | four `<select>` rows, one per left item |

This replaces §3.3's three-question table for the hero (`LOG-007` leaves the hero entirely — it was
never load-bearing to any id outside §3.3, and nothing elsewhere cites it by number). The scoring
rules of §2.4 still apply per card; a `Score my answers` control replaces `Finish` and scores all
three at once rather than gating on a current question. **Two grading paths, not one**: `LOG-001`
and `QNT-004` still go through `gradeChoice` (§2.5) unchanged, but `LOG-003` is a `matching`
question, which `gradeChoice`/`ChoiceQuestion` cannot grade — it needs `gradeStructured` and
`StructuredQuestion` from `packages/core/src/grade/structured.ts`. **`packages/core/src/index.ts`
must export both, the same way §2.5 added `gradeChoice`/`ChoiceQuestion`**; this is the island
assignment's change, not this document's, and is named here so the island budget rationale below is
traceable to a real cause. `packages/core/package.json`'s `"sideEffects": false` (§2.5) already lets
Rollup tree-shake `grade/choice.ts` and `grade/structured.ts` independently of `grade/text.ts`, so
adding the second grading path does not reopen the door to `grade/text.ts`'s pattern compiler.

### 11.2 One screen, never scrolling inside itself

The hero is exactly one screen and does not scroll internally: `height: calc(100dvh - 64px)`
(64px being the sticky nav), `min-height: 600px`, `overflow: hidden`, laid out as a three-row grid
— head / cards / control bar — with the first scroll the visitor makes landing on the next band,
not inside the hero. This replaces §3.1's fold arithmetic (the 400px stack counted "to the top of
the first option"): with three cards and no scrolling, every card's content must fit the hero's
fixed height at once rather than clearing a scroll-fold, which is a stricter constraint than §3.1's
and supersedes it for the hero specifically. `scroll-snap-type: y proximity` on `body` (not
`mandatory` — mandatory hijacks the wheel, and the owner saw and approved proximity), with
`scroll-snap-align: start` on the hero `<section>` and on every band `<section>` after it.

### 11.3 The masthead, and where the two scripts live now

"Pariksha" moves out of the voltage-on-cream running text and becomes its own object: large, in the
right-hand voltage space, set in **Kalam 700** — the owner's choice from eleven typeface candidates
trialled in the prototype's font switcher (chunky, handwritten and brush families, plus the earlier
drawn-shirorekha treatment). `apps/web/public/fonts/kalam-wordmark-700.woff2` (Kalam v18 weight 700,
text-subset to the eight letters of "Pariksha", `unicode-range: U+50, U+61, U+68-69, U+6B, U+72-73`)
and `apps/web/public/fonts/OFL-kalam.txt` (SIL OFL 1.1) ship alongside the existing Telugu and
Devanagari wordmark slices, built the same way.

**Telugu and Devanagari are not in the masthead.** The product name stands alone in English there.
The two scripts are unchanged everywhere else they already appear — the nav wordmark
(`పరీక్ష · परीक्षा` beside "Pariksha") and the footer — because A4's heading-order guarantee and the
entity-reconciliation `alternateName`s in `jsonld.ts` (unaffected by this section; neither name the
hero) have no dependency on where in the hero the English name sits.

**The h1 stepped down, not away.** `h1` drops from v3's size to `clamp(24px, 1.6vw + 12px, 32px)` so
the masthead leads visually; the element keeps its one-`h1`-per-page semantics and its SEO weight —
`T19`'s budget and heading-order assertions are unaffected by a `font-size` change. The prototype's
own `h1` text, `Run real exams you host yourself.` (33 characters, well under `T19`'s 45), drops the
leading `Pariksha — ` the written contract's "product name first" rule (§3, opening paragraph) had
required, on the reasoning that the name is now the loudest object on the screen half a second to
its right rather than absent — but **that is a copy decision for whoever implements `Hero.tsx`, not
settled here**: see `needs_from_others` in this assignment's report. `apps/web/test/landing.test.tsx`'s
`HERO_HEADING` constant must match whatever is actually shipped, verbatim, the day the hero lands.

### 11.4 Below 860px: a carousel, not a stack

Below 860px the three cards stop being a grid row and become a horizontal, `x`-snap carousel at 86%
of the column's width per card, so the next card's edge peeks (the visitor's cue that there is one).
The palette pips (§3.5's three squares, now status dots rather than a jump list — §11.1 removes
their navigation role) double as the carousel's pager. The masthead moves above the `h1` and its
rule, and the stats line (question-type count, cost) drops rather than wrapping. This section
replaces §3.10's 400px/320px rules for the hero; §3.10 continues to govern every other band.

### 11.5 Size budget: the island moves from 10 KB to 14 KB

`I-2`'s ceiling (§2.6, §4.9, §5 `P1`) moves from **≤ 10 KB minified to ≤ 14 KB minified**. The cause
is §11.1, stated plainly so the number is never re-derived from nothing: three question types
instead of one, rendered as three independent interactive cards instead of one sequential panel,
graded through **two** grading functions (`gradeChoice` and, newly, `gradeStructured`) instead of
one, with a third control shape — four bound `<select>` elements for the matching card — that v3's
island never had to construct or read. `apps/web/test/prerender.test.ts`'s `T2` and `I-2` assertions
are raised to 14 KB accordingly (this assignment). **`apps/web/test/island-artefact.test.ts` carries
the same 10 KB ceiling and is not owned by this assignment** — see `needs_from_others`. If the built
island lands under 14 KB, per this document's standing instruction (§2.5) the number should be
tightened to the measured size plus 1 KB rather than left at the round figure; that measurement can
only be taken once `exam-demo.ts` grades all three cards, so it is not taken here.

### 11.6 What could not be verified here, and why

`T32`'s 13,500-byte ceiling and `P2`'s 46 KB page-size gate (§4.9, §5) are **left numerically
unchanged** by this amendment, not because they are known to still hold but because neither can be
measured without the real three-card `Hero.tsx`, its CSS and the island's final size, none of which
this assignment owns or built. Measured today, against the unmodified v3 (single-question) hero:
`dist/index.html` is 43,705 bytes (42.68 KB, under the 46 KB gate with 2.3 KB to spare) and the
island is 9.78 KB (under even the old 10 KB ceiling). Neither number says anything about the
three-card hero — both are expected to grow, the first substantially, once the masthead, three
cards and carousel CSS land. Whoever lands `Hero.tsx`/CSS/the island must run
`pnpm --filter @pariksha/web exec vitest run test/prerender.test.ts` and either come in under both
ceilings or report the measured figures and apply §4.9's fixed deletion order (B2's verification
strip → B5's interoperability strip → FAQ Q13 → …) — never relax either number on an estimate.

### Review

- **2026-10-17.** The owner reviewed the three-card hero as a working, clickable prototype —
  `.planning/landing/v4-hero-prototype.html` — rather than as a document, and approved it for
  implementation as specified in A1–A6 of the build task. This section records that approval and
  amends §3 accordingly; the prototype remains the reference for any point where this section and it
  disagree.
