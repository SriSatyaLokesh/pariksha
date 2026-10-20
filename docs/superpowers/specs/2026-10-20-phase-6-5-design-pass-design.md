# Design: Phase 6.5 — the design pass

| | |
| --- | --- |
| **Status** | **Prototypes approved — `D11`'s three gates are closed.** `screens.html` locked at revision 5, `test-builder.html` at revision 4. `superpowers:writing-plans` is now unblocked; no code until a plan exists. |
| **Date** | 2026-10-20 |
| **Author** | Satya K |
| **Implements** | [#187](https://github.com/SriSatyaLokesh/pariksha/issues/187), folding in [#181](https://github.com/SriSatyaLokesh/pariksha/issues/181), [#186](https://github.com/SriSatyaLokesh/pariksha/issues/186) and [#179](https://github.com/SriSatyaLokesh/pariksha/issues/179) |
| **Visual language** | [`DESIGN.md`](../../../DESIGN.md) — **rewritten** by `D1` and `D2`, not extended |
| **Interaction design** | [`docs/design.md`](../../design.md) — `UX-01`–`UX-21` stay in force; `D7` changes how `UX-12`–`UX-17` are presented, not what they require |
| **Needs an ADR** | `D1`, as ADR 0010, before implementation starts — now covering **both grounds** (`D20`) |
| **Prototypes** | `.prototypes/` (gitignored, never committed, never an Artifact) — see §14 |

Phase 6.5 sits between Phase 6 (candidate runtime, shipped and deployed) and Phase 7
(proctoring). **It ships no new capability.** It makes Pariksha look and behave like one
designed product and fixes flows that are technically correct and unpleasant to use.

Every decision is addressed by an identifier so a reviewer can reject one line rather than argue
with a redesign, and carries the reasoning and the cost of being wrong, in the form the execution
ledger uses: `Ruling — why — cost if wrong`.

## Contents

1. [Intent](#1-intent)
2. [Goals, non-goals, anti-goals](#2-goals-non-goals-anti-goals)
3. [D1 — the organiser moves to the Signal ground](#3-d1--the-organiser-moves-to-the-signal-ground)
4. [D2 — typefaces follow the ground](#4-d2--typefaces-follow-the-ground)
5. [D3–D6 — the organiser shell](#5-d3d6--the-organiser-shell)
6. [D7 — the test builder](#6-d7--the-test-builder)
7. [D8 — the candidate runtime](#7-d8--the-candidate-runtime)
8. [D9 — the two UX defects](#8-d9--the-two-ux-defects)
9. [D10 — what signal.css gives up](#9-d10--what-signalcss-gives-up)
10. [D11 — prototype first, then code](#10-d11--prototype-first-then-code)
11. [D12–D21 — component and screen rulings](#11-d12d21--component-and-screen-rulings)
12. [Constraints the builder must respect](#12-constraints-the-builder-must-respect)
13. [Left to the builder](#13-left-to-the-builder)
14. [Prototype inventory](#14-prototype-inventory)
15. [Cut order, and what this phase does not fix](#15-cut-order-and-what-this-phase-does-not-fix)

---

## 1. Intent

Every screen the product will have for a while now exists: twelve organiser screens from Phases 4
and 5, and the candidate runtime from Phase 6. That is the first moment a redesign can be done
**once**, against the real thing. It is also the last cheap moment — Phase 7 adds proctoring UI,
Phase 8 adds the monitor, the grading queue and analytics, and every screen added before the
redesign is a screen redesigned twice. It must land **before** Phase 12's WCAG 2.1 AA audit, or
that audit is invalidated by the work that follows it.

Three problems, as reported in #187, and the corrections found while measuring them.

1. **The design system has forked.** `DESIGN.md` describes a single saturated vermilion, Voltage
   `#e24c18`, as the identity. #165 rebuilt the landing page on green `signal-accent #19e68c` and
   added the token *beside* voltage. No document records which is intended.
2. **Test creation is endless form filling.** `apps/web/src/routes/test.tsx` renders the section
   list plus six always-mounted panels down one 1080px column, with the publish checklist — the
   only thing separating required from optional — arriving last.
3. **The organiser side looks unstyled.** `admin.css` is 196 lines for twelve screens with no
   persistent navigation. `admin.css:99-101` explains why and that reason has expired.

**Corrections to the issue's own measurements**, verified by counting `var(--color-voltage*)` and
`var(--color-signal-accent*)`:

| stylesheet | `voltage` | `signal-accent` |
| --- | --- | --- |
| `signal.css` | 0 | 27 |
| `exam.css` | 29 | 0 |
| `primitives.css` | 6 | 0 |
| `base.css` | 5 | 0 |
| `admin.css` + `authoring.css` + `testbuilder.css` + `registration.css` | 11 | 0 |
| `tokens.css` (generated — both families by construction, not a fork) | 4 | 3 |

`base.css`'s five were uncounted, so the light-side total is **51**, not 43. `exam.css` is
**1,399** lines, not 1,212. And the fork is not only colour: #165 also moved display type to
Bricolage Grotesque and body to Inter while the product kept Anek Latin and JetBrains Mono.

*Pointer, not an amendment — the corrections above stand, and nothing here changes a ruling.*
**The table's figures are not the `var()` counts the sentence above it claims** (6.5f Task 1,
2026-10-21): every one of them reproduces exactly as `grep -o 'voltage' | wc -l` — comments, class
names such as `.card-voltage`, and `tokens.css`'s own definitions included — and **not one**
reproduces as a count of `var(--color-voltage*)`. By that pattern the figures are `exam.css` **13**,
`primitives.css` **3**, `base.css` **2**, and the four grouped organiser sheets **6**. The
difference is a word count versus a usage count, so the table still ranks the files correctly and
its argument is unaffected. The guard added by 6.5f
(`apps/web/test/theme.test.ts`, "voltage stays in the candidate runtime and does not spread")
deliberately pins the **set of files** rather than any count, which is what keeps this discrepancy
harmless in practice: a figure can drift, a surface appearing cannot.

## 2. Goals, non-goals, anti-goals

### Goals

| id | Goal |
| --- | --- |
| `G1` | One written rule for which accent applies where, as ADR 0010, reflected in `DESIGN.md`. |
| `G2` | The organiser gets a persistent shell: sidebar, a top bar that carries something, shared page chrome across all twelve screens (#181). |
| `G3` | The builder's information architecture changes so what is required is visible from the first minute rather than at the gate. |
| `G4` | The two UX defects ship: #186's unread finish message and #179's 0-minute test. |
| `G5` | The twelve organiser screens are dressed in the resulting language. |
| `G6` | The candidate runtime takes the type-scale sweep, geometry frozen (`D8`). |
| `G7` | **Both grounds ship.** The organiser runs on the Signal dark *and* light palettes, switchable, with the contrast suite asserting both (`D20`). |

### Non-goals

New capability. Schema changes. Phase 7's proctoring surface. Question-bank templates (#178). ADR
0007's deferred half (comment table, approvals). A router library (`D5`). A command palette.
A *third* ground, and a per-screen ground override — `D20` ships two palettes and one switch.
Shuffling the *order of sections* (`D19`). Reopening `docs/design.md`'s rejected list — Course →
Module → Topic stays rejected and hierarchical tags (`UX-03`) stay the answer.

### Anti-goals

| id | Anti-goal | Defence |
| --- | --- | --- |
| `AG1` | **A scanning surface becomes slower to work in** — more clicks, more scrolling, fewer rows visible. | A committed Playwright measurement spec (`D13`). **Scope: scanning surfaces only** — see `D12`. |
| `AG2` | A gate made green by moving a bar — raised timeout, lowered threshold, weakened assertion. | Forbidden. `maxWorkers` and the 1 s `asyncUtilTimeout` are not knobs. |
| `AG3` | A guard asserting a file's text where it could assert behaviour (#183). | Every guard exercises behaviour or asserts an invariant. Never "the rule is present, therefore the behaviour happens". |

## 3. D1 — the organiser moves to the Signal ground

> **Ruling.** The organiser adopts the landing page's world: the `signal-*` dark ground, the single
> green accent, Bricolage/Inter/JetBrains Mono. **Voltage retreats to the candidate runtime alone**,
> where it keeps its existing job — the "you are here" square in the question palette and the focus
> ring. `DESIGN.md`'s "voltage as canvas" opening is **rewritten**, not extended.
>
> **Why.** The owner chose continuity of identity from marketing through to product, after seeing
> both built. An accent cannot cross grounds: `signal-accent` is **1.60:1** on cream — illegal as
> text and as a border — so taking the landing's accent means taking its ground.
>
> **Cost if wrong.** A long-dwell editing tool on a dark ground is a preference, not a fact, and
> `DESIGN.md` itself uses the long-dwell argument against orange behind a question stem. This cost
> is now **paid rather than carried**: under `D20` the light palette ships alongside the dark one,
> so an organiser who cannot work on a dark ground has a switch instead of a bug report. `D1-alt`
> is therefore no longer a fallback plan — it is the second half of the deliverable, and the
> open question it leaves is only which ground is the **default**.

**Measured, and the reason for every number below being in the document rather than in someone's
head.** Ratios computed, not estimated:

| pair | ratio | verdict |
| --- | --- | --- |
| `signal-text #eaf2ed` on `signal-bg` / `surface` | 17.37 / 15.99 | AA |
| `signal-text-2 #9db0a6` on `signal-bg` / `surface` | 8.67 / 7.98 | AA |
| `signal-text-3 #76887f` on `signal-bg` / `surface` | 5.28 / 4.86 | AA |
| `signal-accent #19e68c` on `signal-bg` / `surface` | 12.01 / 11.06 | AA |
| `signal-accent-ink #04140c` on `signal-accent` | 11.47 | AA — button labels |
| `signal-accent #19e68c` on cream `#fffbf5` | **1.60** | **illegal — this is why the ground moves** |
| `voltage #e24c18` on `signal-bg` | 4.98 | legal, but rejected on hue (§ below) |

**Why not voltage on the dark ground.** It is legal at 4.98:1, so it was not refused on contrast.
It was refused on hue: `signal-flag-review #f59e0b` (amber) and `signal-flag-risk #f87171` sit
beside the accent on the integrity band, and an orange accent between them is three warm hues doing
three unrelated jobs.

**One new token per mode is required — an earlier claim that none was needed was wrong.** The
landing's `signal-line-2` measures **1.54:1** on its own surface: fine for decoration, illegal for
an input outline or a table rule, which `DESIGN.md` puts at 3:1.

| new token | value | on `bg` / `surface` |
| --- | --- | --- |
| `signal-line-strong` | `#5a7465` | 3.88 / 3.58 |

**No "pass" colour on the organiser.** A light-legal green (`#07744a`) is **1.09:1** from
`state-answered #0d7a51` — the same colour to the eye. The accent itself carries positive meaning
on the organiser; `state-answered` stays in the candidate runtime on cream, where the two never
appear on one screen. On the dark ground every structural token fails anyway — `state-answered`
3.4:1, `state-marked` 3.2:1, `flag-risk` 2.8:1, `data-blue` 3.7:1 — and none is needed, because
test state carries no hue today (`.test-state` is glyph plus label on inherited ink) and does not
gain one.

**ADR 0010** records this ruling verbatim: the rule, every ratio above, the `state-answered`
collision, the hue argument against voltage-on-dark, and `D1-alt` as the named fallback.

## 4. D2 — typefaces follow the ground

> **Ruling.** The organiser takes Bricolage Grotesque (display, on its `opsz` axis), Inter (body)
> and JetBrains Mono (every id, count, label and code sample). Anek Latin stays for the candidate
> runtime and for the Telugu and Devanagari wordmark. All four remain subsetted and self-hosted
> under `apps/web/public/fonts/`; nothing is added and nothing is retired.
>
> **Why.** One rule covering colour and type is a system; two unrelated rules are a coincidence.
> Anek cannot be retired — it carries Telugu and Devanagari on a shared skeleton, which Phase 12's
> translations need and Bricolage cannot do.
>
> **Cost if wrong.** Four families is more bytes than two, bounded because no page loads both
> pairs and `bundle.test.ts` already enforces that separation.

## 5. D3–D6 — the organiser shell

`organiser.tsx` is a state machine over a `View` union with no router, and each screen renders its
own `OrganiserHeader`. Twelve screens, no persistent navigation, no "you are here".

### D3 — the shell is hoisted into `OrganiserApp`

> **Ruling.** Chrome moves up into `OrganiserApp`; screens stop rendering their own and supply a
> title and a primary action instead. Sidebar carries Home, then Banks and Tests, with Phase 8's
> Results and Grading **absent until those phases** (shown dimmed in the prototype only to convey
> the eventual shape). Collapsible to 56px, and it survives 400px.
>
> **Why.** `OrganiserHeader` exists because four screens needed identical chrome; twelve now do.
> Hoisting deletes the `onSignOut`/`onBack`/`backLabel` props every screen threads.
>
> **Cost if wrong.** Every screen's test touches the chrome — see `D14`.

**`D3a` — below 719px the shell is one column, never a zero column.** The rail leaves the grid
(`display:none`) and `grid-template-columns` becomes a single `minmax(0,1fr)`. Writing `0 1fr`
instead reproduces the trap `D18` records: with the rail gone, auto-placement drops `.page` into the
0-wide first track and the screen renders empty. It was reproduced once more while building the
narrow pass, which is the second time this exact mistake has been made — hence a ruling rather than
a note. At that width every panel becomes its own scroll container, so a table wider than the
screen scrolls inside its panel and **the page itself never scrolls sideways**.

Rules: "you are here" is **three signals, never hue alone** — an accent left bar, a heavier label,
and `aria-current`. Nav items carry icon and label. Nothing in the sidebar is a primary action.
The sidebar is **not rendered** during sign-in or the first-run wizard (builder's call): a nav with
nothing behind it is the lie `admin.css:99-101` refused.

### D4 — workspace in the top bar, switcher only at two

> **Ruling.** The top bar always names the workspace, the person, and sign-out. It becomes a
> *switcher* only when the actor holds more than one membership.
>
> **Why.** Most people have one workspace and an always-no-op control is noise. `OrganiserApp`
> already fetches the list to pick `workspaces[0]`, so the count is free.
>
> **Cost if wrong.** Two shapes to test; `organiser.test.tsx` already fakes memberships.

**`D4a` — switching workspace resets the view to `?view=home`.** This is the part of `D4` that can
ship broken, and no prototype can show it. Under `D5` the view lives in the query string as
`?view=tests&test=tst_8c21a4`; a switch that keeps that string asks workspace B for a test id
belonging to workspace A — a 404 if the route checks membership and a cross-tenant read if it does
not. The switch therefore clears every id-bearing parameter (`test`, `bank`, `section`, `panel`)
and lands on `?view=home`. **A test asserts this by switching with a test id in the URL**, not by
reading the reducer.

**`D4b` — the control is a native `<select>`.** It carries the keyboard, the mobile picker and an
accessible name for free; a custom menu is focus-management work for no gain. The visible
"Workspace" label becomes the `<label>`, and below 719px it is clipped to the accessibility tree
rather than removed, so the select keeps its name while the bar keeps Sign out whole.

### D5 — view state in the query string, no router

> **Ruling.** `?view=tests&test=…&bank=…&section=…&panel=…`, read on first paint and on `popstate`,
> exactly as `sectionFromUrl()` does today. No router library.
>
> **Why.** A persistent nav makes "you are here" and Back visible problems. A path router needs a
> server rewrite the static host does not have — and #183 is what happens when we assume a platform
> rewrite behaves as modelled.
>
> **Cost if wrong.** Manual nesting; contained in one file, because routing is one `switch`.

### D6 — Home becomes a real screen, from reads that already exist

> **Ruling.** `Dashboard` becomes **Home** and gains content. It may call **no endpoint that does
> not already exist.** `client.tests(workspaceId)` returns `state`, `reviewRequested`,
> `draftVersion`, `currentVersion` and `updatedAt`; `client.listBanks(workspaceId)` returns
> `questionCount`. Two calls answer every figure on the page.
>
> **Why.** The owner chose this over deleting the screen after I flagged a home page as new
> capability. The endpoint constraint is what keeps it inside #187's scope line.
>
> **Cost if wrong.** A home page is a surface that grows. If it wants an aggregate endpoint, that
> is Phase 8's analytics work and the answer is no.

**`D6a` — Home leads with an agenda, not a tile grid.** *(Amended by `D21`: a tile strip returns,
at the foot, as a control rather than a readout.)* Four look-alike cards with a label, a number and a
sentence is the metric-tile cliché and it tells an organiser nothing actionable. Home groups items
by **time horizon** — Today / This week / Whenever you like — as 40px single-line rows: time in mono
on the left, a 7px urgency dot, subject in bold with the reason muted on the same line, action
revealed on hover and focus. A group header carries its count; a horizon with nothing in it is not
rendered; overflow collapses to "N more in this week". The shape is identical at four items and at
forty, and its height is bounded.

**`D6b` — the agenda's rows are derived, and one payload field is required.** Derivable from
`tests()` today: drafts never published (`currentVersion === null`), awaiting review
(`reviewRequested`), changes since publish (`draftVersion > currentVersion`). **Not** derivable:
"closes at", because `opens_at`/`closes_at` live in `TestTiming` inside the version body.

> **Ruling.** `GET …/tests` gains `closesAt` on the wire. `toWire` in
> `apps/api/src/routes/tests.ts:450` already destructures `publishedTiming`, uses it to derive
> `state`, and throws it away. This is one field of data the route already holds — not a new query,
> not a new endpoint, not a schema change.
>
> **Why.** Without it the agenda cannot say the one thing that matters most.
>
> **Cost if wrong.** It is the same defect shape as #186 — a value the server has and the client
> cannot see — so the fix also closes a latent instance of that class.

**"Blocking publish" is not an agenda row.** It needs one checklist computation per test. It lives
in the builder's rail (`D7`), where the checklist already runs.

## 6. D7 — the test builder

> **Ruling.** Sections stay the spine. The five settings — timing, access, registration form,
> results, branding — collapse into **one panel of rows that each state their own setting**
> ("Timing — 60 minutes · opens 24 Oct 09:00 IST · closes 24 Oct 18:00 IST"), opening in place, one
> at a time, addressable as `?panel=`. The publish checklist moves from last to **always present**
> in a right rail with a readiness figure.
>
> **Why.** #187's substantial part, and an information-architecture problem. The checklist already
> computes blocking and advisory rows from one function shared by `GET …/checklist` and
> `POST …/publish` (#64); it was simply shown at the wrong moment. Collapsing to summary rows is
> mostly deletion plus one disclosure pattern and keeps `UX-13` as written.
>
> **Why not a wizard.** It fights `UX-13` and fights re-editing a published test, which is never
> linear. Offered and refused.
>
> **Cost if wrong.** A collapsed panel is one an organiser must find. The defence is that each row
> states its current setting, so the collapsed state answers "what is timing set to" without being
> opened.

**`D7a` — both sides collapse, and editing collapses them.** The rail drops to 56px of icons; the
checklist rail drops to a **52px strip of indicator lights**, one per row — red for blocking, amber
for advisory, dimmed green for passing, with the readiness figure above them. Hovering the strip or
tabbing into it floats the full panel **over** the page (absolutely positioned — it must never
reflow what is being edited); a pin button docks it back. Opening a section or a setting retracts
both sides automatically, and both toggles stay operable while a panel is open — auto-collapse is a
convenience, never a lock.

Each light needs a real accessible name — "Blocking — a pool cannot fill. Go to Section B." An icon
plus a colour would fail both the contrast rule and colour-not-alone.

**`D7b` — rail freshness.** The rail refetches `GET …/checklist` once per settled save burst,
riding the follow-up draft read the builder already fires. A rail that reads only on mount lies
while the author works.

**`D7c` — the readiness meter lives in the builder, not in the test list.** The list route loads
version heads, not draft bodies, so a real "5 / 7" there is one checklist call per row — thirteen
round trips to decorate a list, or a budget raise that sits too close to `AG2`. The list instead
distinguishes "Draft · never published" from "Draft · changes since v1", which the wire already
supports. If Phase 8 adds an aggregate, the meter moves into the list for free.

**`D7d` — rail and panel state are per-viewer.** `localStorage`, not server state, and the page
must render correctly when the read throws (private window, cleared storage).

## 7. D8 — the candidate runtime

> **Ruling.** `exam.css` keeps its geometry frozen — nothing moves that a candidate's hand is
> already on — and takes the **type-scale sweep**: converting literal sizes to scale tokens.
> `exam.css` carries **63 literal `font-size:`** against 158 `var(--type-*)`. Front-matter scale
> entries are added only where no existing step fits. `signal.css`'s own 36 literals are **out of
> scope** — the landing is not in #187's scope list.
>
> **Why.** The earlier wording — "takes the regenerated tokens and the type scale" — was a no-op,
> caught by the builder check: `DESIGN.md` already carries both colour families and the whole
> typography scale, and `tokens.css` is already generated from them, so nothing regenerates. The
> literal sweep is the real work.
>
> **Cost if wrong.** A runtime mistake falls on the user who cannot report a bug mid-attempt. That
> asymmetry is why this is cut first (§15) and why the layout is frozen rather than "carefully
> changed".

*Pointer, not an amendment — `D8` stands as written.* **The "63 literal `font-size:`" figure above
was disproved by measurement** (6.5f Task 1, 2026-10-21): all 63 are themselves `var(--type-*-size)`
uses — they are 63 of the same 158 this sentence counts separately — so `exam.css` holds **zero**
type literals and the sweep is **closed as already satisfied**, `G6` met before the phase began. The
irony is worth naming: this section already replaced one no-op ("takes the regenerated tokens and
the type scale") and put another in its place, both times because a figure was produced by a method
(`grep -c "font-size:"`, which counts *declarations*) that was never checked against the thing it
claimed to measure. See `docs/superpowers/notes/2026-10-20-exam-css-type-inventory.md` for the 63
rows, the untouchables, and the `calc(… * var(--exam-font-scale, 1))` hazard a sweep would have
walked into.

**Voltage stays here, and only here.** Under `D1` the runtime is the sole surface still using the
vermilion family, which makes the palette square and the focus ring read as singular again.

## 8. D9 — the two UX defects

> **`#186` — the finish message.** `branding.finish_message` has a writer
> (`BrandingPanel.tsx:267`), storage, export and re-import, and **no reader**. It joins the
> `Receipt` in `apps/api/src/run/submit.ts` and renders in
> `apps/web/src/components/exam/Receipt.tsx` the way `exam.tsx:183` renders the start message. Test
> content, not candidate data, so no scrub exception — confirmed against
> `apps/api/test/run/scrub-scan.test.ts` rather than assumed. **Tested from `ExamApp`, clicked
> through to submission.**
>
> Same breath: walk every field an organiser can set in `branding` and ask which reach a candidate.
> `branding.logo` is known-unread and deliberately deferred. Anything else with a writer and no
> reader is reported, not quietly wired.
>
> **`#179` — the 0-minute test, narrower than first written.** `buildChecklist`
> (`apps/api/src/publish/checklist.ts:161`) already has a blocking `timing_missing` row for absent
> `settings.timing`. What leaks is `timing` **present with no `duration_minutes`** — a two-line
> extension of that row, not a new one. The fix stays out of `run.ts`. `questionCount` summing to 0
> over empty sections is checked for the same shape.
>
> *Pointer, not an amendment — the ruling above stands as written.* **The `#179` premise was
> disproved by measurement** (6.5a Task 1, 2026-10-21): neither shape is reachable through any API
> write path, and **the `questionCount`-summing-to-0 row named above was deliberately not shipped** —
> a `fixed` or `sets` section with no questions is already refused by `section_empty` and a
> zero-count `pool` is refused at save, so the row would duplicate a refusal. (A `pool` matching
> fewer questions than its `count` is *not* refused — that is `pool_short`, advisory — and a row on
> the shape above would not have closed it either.) See
> `apps/api/src/publish/checklist.ts`'s `timing_missing` and `#179's other half` notes, which carry
> the reasoning for both, and commit `dd75d32`.
>
> **Already-published versions:** new publishes only. The builder runs one read-only check of the
> deployed instance for an existing 0-duration published version and **reports** it rather than
> silently repairing it. (My call; the instance is days old and none is known to exist.)

## 9. D10 — what signal.css gives up

> **Ruling.** A construct moves from `signal.css` to `primitives.css` only when the organiser needs
> **the same structure**. A construct whose *reason for existing* is the marketing page — the hero
> field, the demo, the metric tiles, the comparison band, the FAQ accordion — stays put even where
> its geometry would be reusable.
>
> **Why.** #181 names deciding this wrong in either direction as expensive. Structure-versus-purpose
> is the only line checkable by reading one selector.
>
> **Cost if wrong.** Over-moving is worse: it is `admin.css`'s own warning about marketing styling
> in an editing tool.

## 10. D11 — prototype first, then code

> **Ruling.** Every visual task ships a **throwaway HTML prototype first**, written to
> `.prototypes/` (gitignored), approved by the owner before any implementer starts. Never
> committed, never published as an Artifact.
>
> **Why.** The owner asked for it, and it is the path #165 took — the one visual change in this repo
> that landed without rework. A redesign argued in prose is approved blind.
>
> **Cost if wrong.** Prototypes are thrown away by definition; bounded by the rules below.

- One file per surface; the HTML is **never pasted into the conversation** — the handover is the
  path plus a few lines on what to look at and what is unfinished.
- Static markup and the smallest possible inline script. No framework, no build step, no tests. A
  prototype that grows those has stopped being a prototype.
- Side-by-side options live in one file as sibling sections.
- **Amendment, learned in practice:** a prototype exploring a *new* palette cannot link `tokens.css`
  for colour, because the tokens do not exist yet. Candidate palettes are declared in one block at
  the top, clearly marked as the proposal that becomes front matter. Prototypes applying an
  *existing* palette still link `tokens.css`.
- Fonts: a prototype may load from a CDN to evaluate; shipping cannot (PRD S-11). Anything locked
  must be OFL, subsetted and self-hosted.
- **Three prototype gates, not ten** (owner's choice): shell, builder, remaining screens. The
  remaining-screens sheet is the single approval for ~1,350 lines of restyling.
- **All three are now closed** (2026-10-20). The shell gate is satisfied by the shared chrome, which
  both locked files render from the same `shell()`/`screen()` rather than from two drawings of it.
- **Cadence (owner's choice):** work needing no visual approval proceeds while a prototype waits —
  the UX defects, URL-state plumbing, the token-literal sweep. Nothing visual ships unapproved.
- `AG1`'s measurement is taken on the prototype as well as the shipped screen.

## 11. D12–D21 — component and screen rulings

These came out of prototype review and are binding on implementation.

### D12 — `AG1` governs scanning surfaces, not editing surfaces

> **Ruling.** The rows-visible gate applies to **scanning** surfaces — test list, bank list, bank
> browser, question picker. It does **not** apply to **editing** surfaces — the builder, the
> question editor, the wizard, sign-in — which show a handful of rows and get air.
>
> **Why.** Treating the builder as a table is what produced an airless first revision. Without this
> written down, someone later re-crowds an editing screen and cites `AG1` to justify it.
>
> **Cost if wrong.** An editing screen drifts roomy enough to need scrolling for eight rows. The
> page-scale numbers in `D15` bound it.

### D13 — `AG1` is enforced by a committed Playwright spec

> **Ruling** (owner's choice over a ledger-recorded number). A committed spec seeds banks,
> questions and tests through the API, loads each scanning surface at 1440×900 in a real browser,
> and counts primary rows. It must land **before the first restyling commit**, and the before-figures
> are captured on `main`.
>
> **Why.** `apps/web`'s suite is jsdom — no layout, `getBoundingClientRect()` returns zeros — and
> `component-dimensions.test.ts` parses CSS text and cannot count what fits in a viewport. The only
> real browser is `apps/web/e2e/first-run.spec.ts`: 4 tests, `workers: 1`, `:memory:`, against an
> empty instance.
>
> **Cost if wrong.** Plausibly the largest single task in the phase, and it is scaffolding rather
> than product. It is also the only thing that catches a density regression after this phase ends.

**The first question `D13` answers.** The test list and the bank list both run **56px rows**, of
which the id line under the name is **16.5px**, so **11 rows** are visible at 1440×900 where **15**
would be without it. Whether that is a regression is unknown until the before-figure is captured on
`main`, which is `D13`'s own first step — so the id stays for now and the spec decides. Inlining the
id rather than dropping it is **not** the cheap escape it looks: the test-list table already fills
its panel exactly (measured slack: **0px**), so Name would grow and `Version` or `Window` would
compress, and every cell is `nowrap`.

*Pointer, not an amendment — `D12` and `D13` stand as written.* **The 56px/11-rows figures above
were superseded by measurement** (6.5a Task 4, 2026-10-21): they do not match the shipped screens,
and the open question they frame cannot be answered as posed. Before building on them, see
`docs/superpowers/notes/2026-10-20-density-before.md`.

### D14 — tests this phase touches migrate to reachability

> **Ruling** (owner's choice). Any test file this phase edits is rewritten to click from
> `OrganiserApp` rather than rendering a component directly. `apps/web/test/authoring/` and
> `apps/web/test/testbuilder/` are **7,551 lines**; `bank-browser.test.tsx` renders `BankBrowser`
> directly 13 times.
>
> **Why.** §12's reachability rule exists because three defects shipped in Phase 6 behind
> component-level tests. `D3` deletes props those tests pass, so they must be touched anyway.
>
> **Cost if wrong.** Roughly a week of test work dragged behind `D3`. The lighter reading —
> mechanical prop-drop only — was offered and refused.

### D15 — two spacing scales

> **Ruling.** **Inside** a component: 4 / 6 / 8 / 12 / 16. **Between** the page and its edges:
> 20 / 28 / 36 / 56. Declared once, no ad-hoc values. The existing `--space-*` tokens cover both
> ranges, so this is a usage rule, not new tokens.
>
> **Why.** One scale produced 24px between a label and its own field while blocks that belong
> together sat 48px apart. Crowding and emptiness are not the same axis.
>
> **Cost if wrong.** Two scales is one more thing to remember. The alternative was measurably worse
> in both directions.

### D16 — the field-row rule

> **Ruling, structure.** A row of fields is **one grid with three tracks** — label, control, help.
> Each field is a `subgrid` spanning all three; controls are `align-self: start`. Where `subgrid` is
> unavailable, the help track is reserved instead (`@supports not`): one empty line, never a
> misalignment.
>
> **Ruling, content — secondary text has exactly three homes.** A **unit** ("min", "IST", "pts")
> goes *inside* the control as an affix. A **constraint or consequence** goes in the help track. An
> explanation of the **whole group** is one note under the row, never repeated per field.
>
> **Why.** With each field its own grid, a column without help let its control stretch into the
> space its neighbours spent on text — controls landed on different lines. Padding fixes would have
> moved the bug, and "give every field help" degrades the copy into filler.
>
> **Cost if wrong.** `subgrid` needs Chrome 117+/Safari 16+/Firefox 71+; the `@supports` fallback
> covers the rest. Applies to the registration form builder and the question editor, which have the
> same shape and the same latent bug.

**`D16a` — a field id is scoped to its instance, never a literal.** Found by measurement, not by
reading: with three frames rendering one `screen()`, `d1`–`d5`, `st`, `sl`, `ss` and `why` each
existed three times and **every `<label for>` resolved to the first one** — clicking a label in one
panel focused an input in another. `D16` is a rule about label-to-control association, so a
duplicate id defeats it before the grid is involved. The builder uses `useId()` (or an explicit
per-panel prefix) for every `id`, `for` and `aria-describedby`; a section panel and a settings panel
are both repeated constructs, so this is not hypothetical.

**Verified against both branches.** Every live row measures **0px** spread on labels and on control
tops; the deliberately broken proof row measures **20.4px**. The `@supports not (subgrid)` path was
forced on and re-measured: still 0px on every live row. A row whose fields all lack help resolves its
tracks to `15px 36px 0px` — the reserved help track collapses rather than costing an empty line.

### D17 — one checkbox and one radio for the whole product

> **Ruling.** `appearance: none`, drawn in the accent with `accent-ink` glyphs, 17px, custom focus
> ring, 4px radius for checkbox and full round for radio. No browser default anywhere.
>
> **Why.** Native controls rendered in the UA's blue, which belongs to no palette this product has.
>
> **Cost if wrong.** Custom controls must keep real `<input>` semantics — they do; only the painting
> changes.

### D18 — screen-level rulings

- **Bank browser opens with the rail collapsed.** Browsing is where the page wants width; the toggle
  still restores it.
- **Row actions live in their own cell with reserved width** (`td.acts`, `width:1%`) and reveal with
  `visibility` plus `opacity`. Revealing an action must never widen a row.
- **Type picker cards are `align-content: start`** and open a **drawn miniature** of that question
  type on hover *and* keyboard focus, animated `0fr→1fr` so nothing jumps. Twelve distinct examples
  — a description is not an example.
- **Import is a page, not a modal** (owner's preference): linkable, no focus trap, room for a long
  report, sticky action bar. It carries **"Download a sample"** — generated from
  `schemas/question-1.json`, one question of every type, so it cannot drift from what the importer
  accepts.
- **The question picker docks as a right-hand column** beside the paper rather than floating over
  it, which serves `UX-14` better. Prompts **wrap and clamp to two lines**; the overflow bug was
  `white-space: nowrap` inherited from the table rules.
- **Sign-in and the first-run wizard use a split layout** — the Signal field quieted to one masked
  radial glow plus a grid, carrying the wordmark, a headline and three checkable facts; the form on
  the right. Below 900px the brand half drops and the form stands alone. A bare screen is a
  **block**, not a grid with zero-width columns: with the bar and rail `display: none`, auto-placement
  put `.page` in the 0-wide first column and the screen rendered empty.
- **The review panel is not designed.** `docs/design.md` lists it as screen 10, but
  `grep -rln "ReviewPanel\|reviewers" apps/web/src` returns nothing — only `review_requested` and
  the badge shipped. Designing it would invent a feature ADR 0007's deferred half is not delivering.
  The builder's rail shows the flag and says so.

### D21 — Home is a glance surface, and the strip at its foot is a control

> **Ruling** (owner's choice, after seeing the agenda alone). Home **never scrolls**. Its chrome and
> its status strip are always on screen; the two panes between them — the agenda and Recently
> edited — scroll inside themselves. A strip of four pills sits at the foot. **Each pill selects**:
> pressing one marks every row it counts in both panes above, in the pill's own tone; pressing it
> again, pressing Clear, or pressing Escape puts them back. One at a time.
>
> **Why.** `D6a` refused four look-alike tiles because a label, a number and a sentence told an
> organiser nothing actionable. That argument was about tiles as a *readout*. A tile that selects
> is a different object: the figure is the handle, and clicking it answers "which ones?" — which is
> the question a count always provokes and never answers. The agenda keeps the lead position
> because it is still the thing that says what to do next.
>
> **Cost if wrong.** A pill that counts a set with no rows on this page would be dead on click,
> which is why the two scale figures — 14 tests, 412 questions — are **not** pills; they are the
> page lead. If a future pill has no rows to mark, it does not become a pill.

**Marking, not filtering.** Nothing moves, nothing is hidden. Unmatched rows recede to `opacity:
0.8` and no further: past that, secondary text drops under the 3:1 `DESIGN.md` requires, so the
recession is bounded by the contrast rule rather than by taste. A live region reports the count.

**`D21a` — a row action can never be clipped, in any table.** The reported defect was an action
button cut off at a bank row's edge. The cause was two things at once: the action cell had no
reserved width, and the table was wider than the page. Both are fixed as rules, so every table
inherits them — `th.acts, td.acts` are `position: sticky; right: 0` inside their own scroll
container with width always reserved, and the reveal is `opacity` alone, **never** `visibility`, so
the buttons stay tabbable and tabbing onto one reveals the set. Where a table still does not fit,
the fix is the table (fold the id under the name, let one column wrap), not the gutter.

**`D21b` — the tone on a pill is a round dot, not a rail.** A straight 3px bar inside a `9999px`
capsule put the component's only square edge 12px from its roundest one. The dot is the same
construct the agenda already uses for urgency, so the strip and the list speak one language.

### D20 — both grounds ship, and the switch is per-viewer

> **Ruling** (owner's choice, taken after prototype 3 was locked). The light Signal palette ships in
> **this** phase, not a later one. `DESIGN.md` front matter carries both organiser families;
> `tokens.css` and `tokens.ts` generate both; a control in the top bar switches them; the choice is
> per-viewer in `localStorage` seeded from `prefers-color-scheme`, under the same rule as `D7d` —
> the page must render correctly when the read throws.
>
> **Why.** The palette was already specified and measured in `signal-variants.html` and sitting
> unused, and the prototype now demonstrates the claim rather than asserting it: with every rule
> reading tokens, one swap re-grounds nine screens. Shipping it later means a second pass over every
> organiser `SURFACE` entry, which is the single largest mechanical cost already in this phase.
>
> **Cost if wrong.** The contrast suite doubles on the organiser, and every ground-sensitive
> assertion must name which ground it is asserting. That is the whole cost — see §15.

**Measured on the prototypes, not estimated.** Both files were rendered in a real browser on the
light ground and every colour-setting pair was composited down through its ancestors and scored:

| file | pairs measured | failing | tightest |
| --- | --- | --- | --- |
| `screens.html` | 21 | 0 | `text-3` on the wash, **4.81** |
| `test-builder.html` | 12 | 0 | `tag` label, **4.78** |

The graphic-only pair (`usebar--low`, amber on the track) sits at **3.17** against the 3:1 that
non-text requires. The light values are `signal-variants.html`'s, unchanged: accent `#07744a`
(5.82:1 on white), edge `#73907f` (3.28:1 on `bg`), warn `#8a5f00`, risk `#b3261e`.

**`D20a` — the field is a dark-ground device, and is allowed to disappear.** The sign-in glow and
the rail glow are now the tokens `--glow` and `--glow-strong`. On the light ground they resolve to
a near-invisible wash. That is the ruling, not an oversight: a green bloom on cream is the same
illegal-adjacent move `D1` refused, and inventing a light-mode ornament to replace it would make
the two grounds two designs.

**`D20b` — which ground is the default is still open.** Not decided here. The prototype opens on
dark. Seeding from `prefers-color-scheme` and letting the viewer override is the cheapest answer
and the one the builder takes unless the owner rules otherwise.

### D19 — shuffling: one half exists, one half is a feature

> **Verified in the code, not assumed.**
> - **Questions within a section: already supported and already built.** `shuffle_questions` is a
>   per-section boolean defaulting to `true` (`schemas/test-1.json:235`), and `SectionList.tsx:681`
>   renders a `ShuffleFieldset`. The redesign surfaces it as a chip on each section row.
> - **Options within a question: supported.** `shuffle_options` per question, written by
>   `QuestionEditor.tsx:39`.
> - **Order of the sections themselves: NOT supported.** No `shuffle_sections` anywhere. Giving one
>   candidate Verbal first needs a new field in `pariksha/test@1`, a format version bump, and a
>   decision about whether per-section time limits still hold when order varies.
>
> **Ruling.** Section-order shuffling is **out of scope** — a feature and an ADR, not a design
> control. The prototype renders the control **disabled**, saying exactly that, so the control has a
> home when it lands and nobody draws a toggle that does nothing.

**Also verified: type conversion already exists.** `QuestionEditor.tsx:382` has "Change type"
behind a confirm, and `select_k` requires an integer `k` (`schemas/question-1.json:48`). The editor
surfaces Single / Multiple / Select k as a segmented control with an "Answers required" field that
becomes editable only under Select k; other types still go through "Change type…", which names what
will be lost first.

## 12. Constraints the builder must respect

**The guards that make this safe.**

- `DESIGN.md` front matter is the only place a colour may be declared; `scripts/tokens.mjs`
  generates `tokens.css` and `tokens.ts`; `apps/web/test/no-hex-colors.test.ts` fails a raw hex
  anywhere else. A palette decision propagates by regeneration.
- `apps/web/test/contrast-usage.test.ts` demands a `SURFACE` entry per colour-setting selector and
  recomputes real ratios. **Under `D1` every organiser `SURFACE` entry changes ground, and under
  `D20` every one of them gains a second entry** — this is a re-ground on two palettes, not a
  reskin, and it is the largest mechanical cost in the phase by a wide margin.
- `apps/web/test/component-dimensions.test.ts` pins sizing.
- 35 test files carry `axe` assertions.

**Repo facts that have cost previous sessions real time.**

- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`.
- `pnpm test --force` does not work. Use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one** — pnpm junctions have twice deleted
  `packages/core/**` and `packages/db/**`. Read a frozen commit with `git show <sha>:<path>`.
- `no-hex-colors.test.ts` strips only `/* */` comments, so a `//` comment containing a colour word
  or an issue reference like `#155` fails it. Issue references in CSS go in block comments.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`. Not a knob.
- `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`, independent of the 10 s
  `testTimeout`. Not a knob either.
- Every merge to `main` needs `node deploy/cloudflare/setup.mjs` afterwards.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A` where untracked
  phase notes live.

**How work is proved.**

- **Reachability** — every assertion starts at `OrganiserApp` or `ExamApp` and clicks its way there
  (`D14`).
- **Behaviour over text** (`AG3`). Where behaviour cannot be exercised, assert the invariant, never
  the mechanism.
- **Never make a gate green by moving a bar** (`AG2`).
- Every ruling recorded as `Ruling: … — why — cost if wrong` in the execution ledger at
  `.superpowers/sdd/<plan-name>/progress.md`.
- Stop for the four classes: an irreversible operation, a security-sensitive action, a side effect
  outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a
  guess.

## 13. Left to the builder

- Final shell proportions within `D15`'s scales: rail width (prototype uses 236px / 56px
  collapsed), top bar height (56px), checklist rail (320px / 52px collapsed).
- The named list of constructs moving under `D10`, one line of reason each.
- Summary-row wording for each of the five settings — each must state its current setting.
- The icon set. One family, consistent stroke, SVG, self-hosted or inline — PRD S-11 has no
  iconography exception. Prototype icons are placeholders.
- Whether `D16`'s content clause covers **any control** or only fields inside a row. The Publish
  button carries a constraint ("2 blocking rows must clear first.") via `aria-describedby` and is not
  in a field row — the same shape, outside the rule as written. Left narrow deliberately until the
  builder hits a second instance.
- Test naming and placement, following `apps/web/test/`'s existing shape.
- Whether Phase 8's Results and Grading appear dimmed or are absent from the rail (prototype shows
  dimmed to convey shape; `D3` says absent in the build).

## 14. Prototype inventory

All in `.prototypes/`, gitignored. **One of `D11`'s three gates is now closed.** The owner locked
`screens.html` at revision 4; `test-builder.html` is still iterating, so no plan can be written yet.

| file | what it settles | state |
| --- | --- | --- |
| `admin-directions.html` | Four complete directions (Slate Console, Paper & Ink, **Signal Dark**, Indigo Editorial), each with measured swatches. | **settled — C chosen**, no further work |
| `signal-variants.html` | Signal in light and dark side by side, plus four UX variants (Faithful, **Attentive**, Command, Guided). | **settled — C2 chosen; dark ships, light designed and tokenised but not wired** |
| `shell.html` | Organiser shell — sidebar, top bar, page chrome, Tests dressed in it, 400px. | superseded by the later files' language; kept only for comparison |
| `test-builder.html` | `D7` — spine, setting rows, live checklist, collapsible both sides, lights strip, the field-alignment proof block. Carries the `D20` ground and `D3a` width toggles. | **LOCKED at revision 4** |
| `screens.html` | Home (glance surface), test list, bank list, bank browser, type picker, question editor, import page, question picker, sign-in, wizard. Carries the `D20` ground and `D3a` width toggles. | **LOCKED at revision 5** |

**What revision 4 settled on `screens.html`**, now locked: Home as a glance surface that never
scrolls, with its two panes scrolling inside themselves and a status strip of four selectable pills
(`D21`); the sticky, width-reserved action gutter that makes a row action unclippable in any table;
the rail carrying the field; the numbered sign-in facts. Measured: Home reports no page scroll at
1480×1000, and both grounds pass every colour pair (`D20`).

**What the `D16` review of `test-builder.html` found**, before it was locked at revision 4. Content
was already compliant — four units inside their controls, four helps carrying real constraints, one
group note, **zero bare controls**. Two structural defects were not:

- **The proof block had never rendered.** `<div class="proof sig">` borrows `sig` for the tokens and
  was also inheriting `.sig`'s `height:100%` and `grid-template-rows:56px 1fr`, so it stood **59px
  tall** with both halves crushed into one 56px row. Present since revision 3 — the centrepiece of
  that file was prose with nothing behind it, and no amount of re-reading the CSS would have found
  it. This is the argument for `D13`: a rule nobody renders is a rule nobody has checked.
- **Duplicate field ids across frames**, now `D16a`.

**Known still open:**
- **Test-list row density**, the one open question on a locked surface. The id under the name costs
  **16.5px** a row, so **11** of fourteen rows are visible at 1440×900 where **15** would be without
  it, and the table has **0px** of horizontal slack so inlining the id is not a free alternative.
  Whether 11 is a regression is unknowable until the before-figure is captured on `main`, which is
  `D13`'s first step. The id stays until then; this is `D13`'s to settle, not a review comment.
- **No candidate-runtime prototype exists.** `D8` is cut first under §15, so one is only built if
  the phase keeps that work.
- Icons are placeholders everywhere; the real set is still `D13`'s listed open item.

**The gate is closed.** Both live prototypes are locked and `superpowers:writing-plans` is
unblocked. The three items above do not reopen it: one is `D13`'s to measure, one is cut first under
§15, and one is an asset list. Nothing further is drawn before the plan is written.

**What is locked is the design, not the markup.** No line of either prototype is a patch to apply —
`D11` says they are thrown away. What carries forward is the set of rulings, the measured figures in
them, and the defects the two files turned up that the product must not repeat: the zero-column trap
(`D3a`), inline styles a breakpoint cannot override, a bleed hard-coded to one padding token, a top
bar that clips its own sign-out, and literal field ids (`D16a`).

### 14a — the three questions `shell.html` leaves behind

`shell.html` was the first shell study and is superseded by the later files' language, but it was
also the only place three things were ever drawn. They are **decisions, not defects** — each needs
an answer before the builder starts, and none of them is expensive:

1. ~~**Where does the test list get prototyped?**~~ **Answered:** a tenth section in `screens.html`,
   added at revision 5. The nine locked screens are untouched by it.
2. ~~**Does any prototype have to prove 400px?**~~ **Answered:** a Width control (1340 / 400) on both
   files. The in-frame breakpoints became `@container` queries against the frame, because a 400px
   frame inside a 1480px page would never fire a viewport `@media`. Same thresholds the shipped
   stylesheet will use as `@media`, but exercised against the **real** screens — and
   `test-builder.html`'s frame 3 now renders `screen()` rather than the hand-written narrow markup
   it used to, which proved a drawing rather than the chrome.
3. ~~**Is the `D4` switcher drawn?**~~ **Answered:** yes, as a native `<select>` on Home only, so both
   top-bar shapes are visible in one file. The ruling that matters is `D4a`, above.

**What the narrow pass found, which is the argument for having done it.** Every `@media` branch in
`screens.html` had been written and never once executed, because every frame was 1340px wide. Running
them surfaced four real defects: the zero-column trap (`D3a`); two inline `style=` attributes that a
breakpoint cannot override, now classes (`.cols--browse`, `.stick--flush`); a sticky import bar whose
negative bleed was hard-coded to `--g3` and overflowed the moment the page padding narrowed; and a top
bar that clipped **Sign out** — the same defect class as the bank-list action button that started this
pass. None was visible at 1340px.

## 15. Cut order, and what this phase does not fix

**Cut order (owner's).** If the phase runs long, the candidate runtime's work goes first — `D8`'s
literal sweep waits; the accent re-ground, the shell, the builder, and the two UX defects ship.
Nothing else has a cut order; a second cut stops and asks.

**Known to be bigger than §1 implies.** Five owner choices each enlarge the phase, and the plan
must size them honestly rather than quietly: `D1` is a re-ground of twelve screens and every
organiser `SURFACE` entry; **`D20` doubles that `SURFACE` work and adds a switch, its persistence
and its seed from `prefers-color-scheme`**; `D13` is a seeding harness plus a browser spec that
must land first; `D14` is a multi-thousand-line test migration; `D11`'s gate means three stops for
approval.

**What `D20` does *not* cost, on the prototype's evidence.** No new screen, no new component, no
new layout rule: both grounds render from one stylesheet because every rule already reads tokens.
The additions are thirteen light tokens, two glow tokens, and the switch. The cost is entirely in
the assertion surface — `contrast-usage.test.ts` and whichever of the 35 `axe` files the plan
decides must run on both grounds rather than one. **That decision is the plan's, and it must be
made explicitly rather than by default**: running all 35 twice is the honest reading of `G7` and
the expensive one.

**Carried out of this phase as new work, not silently dropped:**

- **Section-order shuffling** (`D19`) — needs a `pariksha/test@1` field, a format bump and an ADR.
- **The review panel** — ADR 0007's deferred half; there is no code behind screen 10.
- **The readiness meter in the test list** (`D7c`) — waits for a Phase 8 aggregate.
- **`branding.logo`** — still unread on the candidate side, still needs its own branding-scoped
  route, still must never ride `layout.media`.
