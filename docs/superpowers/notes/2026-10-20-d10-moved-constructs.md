# D10 — what `signal.css` gives up

Phase 6.5e Task 7. 2026-10-21.

**Verdict: nothing moves. `signal.css` keeps all twenty-one candidates, and
`primitives.css` is unchanged.**

`D10` moves a construct "only when the organiser needs the same structure". No
organiser source renders a `.signal-*` class, so moving any of them today ships
bytes to the organiser bundle that nothing in the organiser selects —
`ponytail`'s first rung, and `D10`'s own "over-moving is worse" read in the
direction it was written for.

**Two independent arguments carry the verdict, and the table says which one
carries each row.** For most candidates it is **purpose**: the construct exists
for a marketing band. For the three that are genuine structural duplicates —
`.signal-btn`, `.signal-card`, `.signal-panel` — purpose does not apply, and the
blocker is **scope**: unifying them means the landing page renders the
organiser's construct, and #187 puts the landing page out of this phase. That
second answer is a scope answer. It is the one a later phase could reopen.

## How each verdict was reached

Four checks, in order. A candidate had to pass all of them to move.

1. **Does the organiser render an equivalent today?** If it already has a
   construct for that job, the move does not give it structure it lacked — it
   adds a second vocabulary for structure it has, which is the warning `D10`
   cites. **This check alone never closes the question**, and three rows below
   say so: where the two really are the same structure (`.signal-btn`,
   `.signal-card`, `.signal-panel`) the blocker is check 1' below, not this one.

   1'. **Would unifying them change the landing page?** For a genuine duplicate
   this is the decisive question, because unification means the landing page
   renders the organiser's construct — and issue #187 puts the landing page out
   of scope. It is a scope answer, not a permanent one.

   _Citation correction._ `D10` and the task brief both attribute that warning
   to `admin.css` (the brief to `admin.css:99-101`). It is no longer there:
   `9c7919c` (6.5e Task 1b) rewrote that header and dropped the quotation, and
   `admin.css:99-101` is now a note about specificity. The warning itself is
   alive at **`docs/design.md:325-326`** — "The authoring side is an editing
   tool, not a marketing page" — which is where it always came from, and
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
--include=*.ts` returns **six paths: five renderers and one token map.** The
five are `routes/landing.tsx`, `sections/signal/Head.tsx`,
`sections/signal/Body.tsx`, `sections/signal/Tail.tsx` and
`island/exam-demo.ts` — every one of them a landing-chain source. The sixth is
`styles/tokens.ts`, which renders nothing. **No organiser route or component
renders a `.signal-*` class.** Check 1 therefore has the same answer for all
twenty-one, and checks 2 and 3 are what separate them.

## The table

### Candidates by structure — all stay

| Construct              | Verdict | Reason                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.signal-btn`          | stays   | **A real structural duplicate of `.button-primary`** (`signal.css:134-147` against `primitives.css:56-80`), and the reason it cannot be unified is SCOPE, not ownership: unifying means the landing page renders the organiser's construct, and #187 forbids the landing page changing. The glow (`:149-152`) and the lift are the landing's own hover besides. |
| `.signal-btn--ghost`   | stays   | Same scope argument against `.button-secondary`. Note it **drops** the glow (`signal.css:160-163` sets `box-shadow: none`) — the glow belongs to the base rule, not the ghost.                                                                                                                                                                                  |
| `.signal-chip`         | stays   | The exam demo's filter chip. The organiser's are `.bank-browser__tag-chip` and `.home__pill`, both already built against the organiser's own type scale.                                                                                                                                                                                                        |
| `.signal-field`        | stays   | Not a form field: it is the hero's background — a two-stop radial accent glow and a 74px masked grid in `::before`/`::after`. Purpose is the marketing page, whole.                                                                                                                                                                                             |
| `.signal-panel`        | stays   | **A real structural duplicate of `.card-hairline`** (`signal.css:587-592` against `primitives.css:163-169`), differing in a hard-coded `border-radius: 14px` and a `--color-signal-line-2` border where the shared rule takes `--edge`. Blocked on SCOPE, as `.signal-btn` is: unifying would change the landing page.                                          |
| `.signal-card`         | stays   | Same duplicate and the same scope block (`signal.css:516-524`), plus a `translateY(-2px)` hover lift the organiser's panel does not have.                                                                                                                                                                                                                       |
| `.signal-row`          | stays   | The demo's draw row — a two-track grid whose `b`/`span`/`em` children are the demo's own markup. The organiser's rows are `.home__row`, `.section-row`, `.setting-row` and real `<table>`s under `D18`/`D21a`.                                                                                                                                                  |
| `.signal-pill`         | stays   | The organiser's status badges are `.test-badge`, `.test-state`, `.home__pill`.                                                                                                                                                                                                                                                                                  |
| `.signal-pill--clean`  | stays   | Colour-only rule.                                                                                                                                                                                                                                                                                                                                               |
| `.signal-pill--review` | stays   | Colour-only, and signal.css:680-686 records _why_ it is signal-native: the shared `--color-flag-review` was tuned for a light canvas and falls under 4.5:1 on this dark surface. That note is the argument against moving it.                                                                                                                                   |
| `.signal-pill--risk`   | stays   | Same.                                                                                                                                                                                                                                                                                                                                                           |
| `.signal-scroll-x`     | stays   | One declaration, `overflow-x: auto`. A shared file is not where a one-declaration utility earns its keep; the organiser's scrollers (`.home__scroll`, the bank-browser table wrapper) set their own.                                                                                                                                                            |
| `.signal-eyebrow`      | stays   | An accent-coloured, 0.14em-tracked marketing eyebrow with an accent rule in `::before`. The organiser's small-caps label is `.mono-caption`, already in `primitives.css`.                                                                                                                                                                                       |
| `.signal-fine`         | stays   | 13.5px fine print at `--color-signal-text-3`. The organiser's are `.field-help` (registration.css) and `.mono-caption`.                                                                                                                                                                                                                                         |
| `.signal-list`         | stays   | The landing page's hairline-separated prose list, whose `b` is the lede. The organiser's lists are `.bank-list` and `.home__rows`.                                                                                                                                                                                                                              |

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
- **A per-chain semantic pair, the `--control-accent` shape.** Not "there is no
  second consumer" — that was circular, since the move is what would create
  one. The real objection is that the pair solves the wrong problem. It exists
  so **one rule** can take **two different values** of the same role on two
  grounds, which is why `registration.css`'s checkbox works in both the
  organiser and the candidate runtime. The landing page and the organiser do
  not disagree about a _value_ here: they disagree about **geometry and type**,
  which a colour indirection does not move.

  Measured against the right comparator — `.button-primary`, not
  `.button-secondary` (review round 2, N4). `.signal-btn` is `15.5px`,
  `padding: 13px 24px`, `--rounded-full`. `.button-primary`
  (`primitives.css:62-70`) is `--type-button-md-size` (**16px**),
  `var(--space-md) var(--space-xl)` (**12px/24px**), `--rounded-full`, **plus
  `height: 46px`**. So the radius and the inline padding already agree, and
  what is left is 0.5px of type, 1px of block padding, and a pinned height the
  landing pill does not carry.

  **Those differences being small is the point, not a weakness in the
  argument.** They are near-identical, which is why the row above calls them a
  real duplicate — and why the blocker is scope rather than difference:
  unifying them would change the landing page's primary button by a measurable
  amount, and #187 forbids that. A per-chain colour pair would not help,
  because none of the three differences is a colour.

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

## The seam, re-measured — and what it does and does not prove

`primitives.css` is imported by `admin.css:32` (with `theme.css`) and by
`landing.css:9` (without), so a `theme.css` semantic name written here is
undefined on the landing page.

**This note's first draft over-drew the conclusion, and review round 1 (I1) was
right to call it.** The draft read the seam as "nothing should move". It proves
something narrower and more useful:

> **Nothing can move while naming a semantic or a Signal colour.**

The difference is not pedantry, because `primitives.css` **already holds rules
the landing page does reach**, and holds them safely: its own header
(`primitives.css:36-38`) names them — "the field row, the field affix's
geometry and the row-action gutter are layout and nothing else". And
`theme.test.ts`'s seam guard scopes itself to classes painted by rules reading a
**semantic** name (`:473-485`), so a colour-free rule here is outside its
subject by construction. A colour-free construct can live in this file whether
or not the landing page renders it.

So the seam closes the _coloured_ half of `D10`'s question and leaves the
structure-only half open — and the structure-only half is decided by the two
arguments above it, purpose and scope, neither of which depends on the seam at
all. `apps/web/test/signal-boundary.test.ts`'s failure message states the same
boundary; this section and that message should keep agreeing.

What remains true, and is the finding of this task rather than a caveat to it:
the controller's warning that "if your construct _is_ rendered by the landing
page, the whole calculation inverts" applies to **every candidate**. All
twenty-one are rendered by `sections/signal/` today, so no move here relocates a
construct the two chains already share — each one takes a construct the landing
page renders and _adds_ the organiser to it.
