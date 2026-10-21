# D10 — what `signal.css` gives up

Phase 6.5e Task 7. 2026-10-21.

**Verdict: nothing moves. `signal.css` keeps all twenty-one candidates, and
`primitives.css` is unchanged.**

`D10` moves a construct "only when the organiser needs the same structure". The
measurement below says the organiser needs none of them: for every candidate it
already has its own construct doing that job, and no organiser source renders a
`.signal-*` class. Moving one would therefore ship bytes to the organiser bundle
that nothing in the organiser would ever select — `ponytail`'s first rung, and
`D10`'s own "over-moving is worse" read in the direction it was written for.

## How each verdict was reached

Three checks, in order. A candidate had to pass all three to move.

1. **Does the organiser render an equivalent today?** If it already has a
   construct for that job, the move adds a second vocabulary rather than sharing
   one — which is precisely the warning `D10` cites.

   _Citation correction._ `D10` and the task brief both attribute that warning
   to `admin.css` (the brief to `admin.css:99-101`). It is no longer there:
   `9c7919c` (6.5e Task 1b) rewrote that header and dropped the quotation, and
   `admin.css:99-101` is now a note about specificity. The warning itself is
   alive at **`docs/design.md:326`** — "The authoring side is an editing tool,
   not a marketing page" — which is where it always came from, and
   `primitives.css`'s own header carries the same argument in the form that
   matters here: importing a landing stylesheet into the organiser entry "would
   have shipped the whole landing page to an admin screen to reuse a button".

2. **Is the construct's reason for existing the marketing page?** `D10`'s own
   line. Purpose beats geometry.
3. **Is the residue after the colour comes off still a construct?** Every rule
   below reads `var(--color-signal-*)` and most set a landing-only type size
   (10.5px, 12.5px, 13.5px, 15.5px) rather than a `--type-*` token. What is left
   when both come off is sometimes one declaration.

**Measured, 2026-10-21.** `grep -rl 'signal-' apps/web/src --include=*.tsx
--include=*.ts` returns exactly four renderers — `routes/landing.tsx`,
`sections/signal/{Head,Body,Tail}.tsx` — plus `island/exam-demo.ts` and the
token file. **No organiser route or component renders one.** Check 1 therefore
has the same answer for all twenty-one, and checks 2 and 3 are what separate
them.

## The table

### Candidates by structure — all stay

| Construct              | Verdict | Reason                                                                                                                                                                                                                        |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.signal-btn`          | stays   | The organiser's button is `.button-primary` (primitives.css), already shared by both chains. A second pill would be two buttons, not one.                                                                                     |
| `.signal-btn--ghost`   | stays   | Same, against `.button-secondary`. Its `box-shadow: 0 0 0 6px` glow and `translateY(-1px)` lift are marketing hover, which `.button-secondary` deliberately does not have.                                                    |
| `.signal-chip`         | stays   | The exam demo's filter chip. The organiser's are `.bank-browser__tag-chip` and `.home__pill`, both already built against the organiser's own type scale.                                                                      |
| `.signal-field`        | stays   | Not a form field: it is the hero's background — a two-stop radial accent glow and a 74px masked grid in `::before`/`::after`. Purpose is the marketing page, whole.                                                           |
| `.signal-panel`        | stays   | `.card-hairline` is the organiser's panel and is already in `primitives.css`. `.signal-panel` differs only in a hard-coded `border-radius: 14px` and `--edge-2`-weight line, both landing choices.                            |
| `.signal-card`         | stays   | Same as `.signal-panel`, plus a `translateY(-2px)` hover lift. `.card-hairline` is the shared one.                                                                                                                            |
| `.signal-row`          | stays   | The demo's draw row — a two-track grid whose `b`/`span`/`em` children are the demo's own markup. The organiser's rows are `.home__row`, `.section-row`, `.setting-row` and real `<table>`s under `D18`/`D21a`.                |
| `.signal-pill`         | stays   | The organiser's status badges are `.test-badge`, `.test-state`, `.home__pill`.                                                                                                                                                |
| `.signal-pill--clean`  | stays   | Colour-only rule.                                                                                                                                                                                                             |
| `.signal-pill--review` | stays   | Colour-only, and signal.css:677-686 records _why_ it is signal-native: the shared `--color-flag-review` was tuned for a light canvas and falls under 4.5:1 on this dark surface. That note is the argument against moving it. |
| `.signal-pill--risk`   | stays   | Same.                                                                                                                                                                                                                         |
| `.signal-scroll-x`     | stays   | One declaration, `overflow-x: auto`. A shared file is not where a one-declaration utility earns its keep; the organiser's scrollers (`.home__scroll`, the bank-browser table wrapper) set their own.                          |
| `.signal-eyebrow`      | stays   | An accent-coloured, 0.14em-tracked marketing eyebrow with an accent rule in `::before`. The organiser's small-caps label is `.mono-caption`, already in `primitives.css`.                                                     |
| `.signal-fine`         | stays   | 13.5px fine print at `--color-signal-text-3`. The organiser's are `.field-help` (registration.css) and `.mono-caption`.                                                                                                       |
| `.signal-list`         | stays   | The landing page's hairline-separated prose list, whose `b` is the lede. The organiser's lists are `.bank-list` and `.home__rows`.                                                                                            |

### Stay-put by purpose — unchanged from the brief

`.signal-hero`, `.signal-metric`, `.signal-metrics`, `.signal-cmp`,
`.signal-faq`, `.signal-split`, `.signal-footer`, `.signal-nav`. Each exists for
a marketing band. No argument was needed and none was made.

## Why "move it and rewrite the colour" is not available

The three answers the controller offered, measured rather than reasoned:

- **Rewrite onto `theme.css` names, and import `theme.css` into
  `landing.css`.** `theme.css:78-79` opens a bare `:root` block with
  `color-scheme: dark`, and `theme.css:63-64` records why that is decisive:
  `base.css:11` sets `html { color-scheme: light }` unconditionally and
  signal.css's own `color-scheme: dark` is **scoped to `.signal`**, deliberately
  leaving the page root light. Importing `theme.css` would put `dark` on the
  root and change the landing page's native scrollbar and form chrome. The
  landing page must not change, so this is closed.
- **A per-chain semantic pair, the `--control-accent` shape.** That shape works
  because one _rule_ serves two chains with two different accents. Here there is
  no second consumer: no organiser markup selects any of these classes, so the
  pair would have exactly one chain reading it.
- **Leave it in `signal.css`.** The direction `D10` points, and the one the
  measurement supports.

There is a fourth: **move the rule with its `--color-signal-*` tokens intact.**
Those tokens are defined in `tokens.css` (`base.css:1`), which both chains load,
so nothing would go undefined — and the organiser bundle would be carrying the
landing page's palette read directly, bypassing `theme.css`, which
`theme.css:10` names as "the whole mechanism".

**This note's first draft called that the move "that does not announce itself",
and the probe disproved it.** `.signal-card` moved into `primitives.css` with
its tokens intact reddens `contrast-usage.test.ts`'s "reads no Signal palette
token directly, on either ground" (`:1553`) — `primitives.css` is in
`ORGANISER_CSS`, so that guard already holds the colour half. A second guard for
it was written, measured as redundant against exactly that probe, and deleted
rather than kept.

The move that really announces nothing is the **structure-only** one: a
construct whose rule names no colour at all. `.signal-scroll-x`
(`overflow-x: auto`, one declaration) moved into `primitives.css` reddens
**nothing** in the 2,046-test suite. That is the gap
`apps/web/test/signal-boundary.test.ts` exists to close, and it is the only
thing it asserts.

## The seam, re-measured

`primitives.css` is imported by `admin.css:32` (with `theme.css`) and by
`landing.css:9` (without). Every top-level selector in it today is class-scoped
and **no landing- or exam-reachable source renders one** — verified again here,
and the property `theme.test.ts`'s chain-seam guard asserts off disk.

The controller's warning that "if your construct _is_ rendered by the landing
page, the whole calculation inverts" is the finding of this task, not a caveat
to it: **every candidate is in the inverted case.** All twenty-one are rendered
by `sections/signal/` today. So a move does not relocate a construct the two
chains share — it takes one the landing page renders and pushes it into the file
whose safety rests on the landing page rendering none of what it paints. The
guard that makes `primitives.css` safe would still be green (signal tokens are
not semantic names), which is exactly why this needed to be decided by reading
selectors rather than by watching tests.
