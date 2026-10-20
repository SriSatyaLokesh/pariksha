# 0010. The organiser moves to the Signal ground

- **Status:** Accepted
- **Date:** 2026-10-21

## Context

The product has been built twice, in two worlds, and the seam between them runs
down the middle of the organiser.

**The first world is `DESIGN.md`'s.** Its opening sentence treats a single
saturated vermilion — Voltage `#e24c18` — as a canvas rather than an accent:
a full-bleed block behind an Anek Latin display headline in cream `#fffbf5`,
inverting to cream and ink the moment an attempt starts, with the voltage
surviving only as the "you are here" marker in the question palette and the
focus ring on an answer row. Everything the candidate sees
([`apps/web/src/styles/exam.css`](../../apps/web/src/styles/exam.css),
[`question.css`](../../apps/web/src/styles/question.css),
[`registration.css`](../../apps/web/src/styles/registration.css)) is that world,
and it works.

**The second world is the landing page's.** `signal-*`
([`apps/web/src/styles/signal.css`](../../apps/web/src/styles/signal.css)) is a
near-black ground with one green accent, `signal-accent #19e68c`, set in
Bricolage Grotesque, Inter and JetBrains Mono. It is what a visitor meets
first, and it is what the product is marketed as looking like.

**The organiser was built in neither, and that is the decision this record
forces.** Twelve organiser screens sit on the cream-and-ink system with the
voltage used as an ordinary accent — which is to say the marketing surface and
the product it sells do not look like the same piece of software, and a design
pass over the organiser has to pick a side before a single rule is written.

**An accent cannot cross grounds.** This is not a preference; it is measured.
`signal-accent #19e68c` on cream `#fffbf5` is **1.60:1** — illegal as text and
illegal as a border. Taking the landing's accent means taking the landing's
ground, or not taking the accent at all.

**Measured, and in the document rather than in someone's head.** Ratios
computed, not estimated:

| pair | ratio | verdict |
| --- | --- | --- |
| `signal-text #eaf2ed` on `signal-bg` / `surface` | 17.37 / 15.99 | AA |
| `signal-text-2 #9db0a6` on `signal-bg` / `surface` | 8.67 / 7.98 | AA |
| `signal-text-3 #76887f` on `signal-bg` / `surface` | 5.28 / 4.86 | AA |
| `signal-accent #19e68c` on `signal-bg` / `surface` | 12.01 / 11.06 | AA |
| `signal-accent-ink #04140c` on `signal-accent` | 11.47 | AA — button labels |
| `signal-accent #19e68c` on cream `#fffbf5` | **1.60** | **illegal — this is why the ground moves** |
| `voltage #e24c18` on `signal-bg` | 4.98 | legal, but rejected on hue |

## Decision

**The organiser adopts the landing page's world: the `signal-*` ground, the
single green accent, and Bricolage / Inter / JetBrains Mono. Voltage retreats
to the candidate runtime alone**, where it keeps the job it already does — the
"you are here" square in the question palette and the focus ring on an answer
row. [`DESIGN.md`](../../DESIGN.md)'s "voltage as canvas" opening is
**rewritten**, not extended.

The reason is continuity of identity from marketing through to product, chosen
by the owner after seeing both grounds built rather than described.

**Why not voltage on the dark ground.** It is legal at 4.98:1, so it was not
refused on contrast. It was refused on hue: `signal-flag-review #f59e0b`
(amber) and `signal-flag-risk #f87171` sit beside the accent on the integrity
band, and an orange accent between them is three warm hues doing three
unrelated jobs.

**No "pass" colour on the organiser.** A light-legal green (`#07744a`) is
**1.09:1** from `state-answered #0d7a51` — the same colour to the eye, so a
reader asked to tell them apart could not. The accent itself carries positive
meaning on the organiser; `state-answered` stays in the candidate runtime on
cream, where the two never appear on one screen. On the dark ground every
structural token fails anyway — `state-answered` 3.4:1, `state-marked` 3.2:1,
`flag-risk` 2.8:1, `data-blue` 3.7:1 — and none is needed, because test state
carries no hue today (`.test-state` is a glyph plus a label on inherited ink)
and does not gain one here.

**One new token per mode is required — an earlier claim that none was needed
was wrong.** The landing's `signal-line-2` measures **1.54:1** on its own
surface: fine for decoration, illegal for an input outline or a table rule,
which `DESIGN.md` puts at 3:1.

| new token | value | on `bg` / `surface` |
| --- | --- | --- |
| `signal-line-strong` | `#5a7465` | 3.88 / 3.58 |

**Typefaces follow the ground.** The organiser takes Bricolage Grotesque
(display, on its `opsz` axis), Inter (body) and JetBrains Mono (every id,
count, label and code sample). Anek Latin stays for the candidate runtime and
for the Telugu and Devanagari wordmark. All four remain subsetted and
self-hosted under [`apps/web/public/fonts/`](../../apps/web/public/fonts/);
nothing is added and nothing is retired. One rule covering colour and type is
a system; two unrelated rules are a coincidence. **Anek cannot be retired** —
it carries Telugu and Devanagari on a shared skeleton, which Phase 12's
translations need and Bricolage cannot do. Four families is more bytes than
two, bounded because no page loads both pairs and
[`apps/web/test/bundle.test.ts`](../../apps/web/test/bundle.test.ts) already
enforces that separation.

**Both grounds ship, and the switch is per-viewer.** The light Signal palette
lands in this phase, not a later one: [`DESIGN.md`](../../DESIGN.md)'s front
matter carries both organiser families,
[`scripts/tokens.mjs`](../../scripts/tokens.mjs) generates both into
`tokens.css` and `tokens.ts`, a control in the top bar switches them, and the
choice is per-viewer in `localStorage` seeded from `prefers-color-scheme` —
under the standing rule that the page must render correctly when the read
throws. The palette was already specified and measured and sitting unused, and
with every rule reading tokens, one swap re-grounds nine screens; shipping it
later would mean a second pass over every organiser surface, which is the
single largest mechanical cost in the phase.

**So the light ground — `D1-alt` — is no longer a fallback plan. It is the
second half of the deliverable.** The long-dwell objection to a dark editing
tool is real, and `DESIGN.md` itself uses the long-dwell argument against
orange behind a question stem. That cost is now **paid rather than carried**:
an organiser who cannot work on a dark ground has a switch, not a bug report.

**The field is a dark-ground device, and is allowed to disappear.** The sign-in
glow and the rail glow become tokens. On the light ground they resolve to a
near-invisible wash. That is the ruling, not an oversight: a green bloom on
cream is the same illegal-adjacent move this record refused above, and
inventing a light-mode ornament to replace it would make the two grounds two
designs.

**Which ground is the default is still open.** It is not decided here. Seeding
from `prefers-color-scheme` and letting an explicit choice win is the cheapest
answer and the one the builder takes unless the owner rules otherwise.

## Consequences

**The contrast suite doubles on the organiser.** Every ground-sensitive
assertion must now name which ground it is asserting, because a pair that
passes on `signal-bg` says nothing about the same pair on `signal-l-bg`.
[`apps/web/test/contrast.test.ts`](../../apps/web/test/contrast.test.ts) and
[`contrast-usage.test.ts`](../../apps/web/test/contrast-usage.test.ts) are
where that cost is paid. That is the whole cost of shipping two grounds, and
it was accepted with the ruling.

**Two accents now exist, and they are different colours on purpose.**
`signal-accent #19e68c` is the dark ground's; `signal-l-accent #07744a`
(5.82:1 on white) is the light ground's. There is no single green that is legal
on both — that is the same measurement, 1.60:1, read from the other side. Any
rule that hard-codes one accent for both grounds is a defect, which is why the
two families resolve to one set of names in a theme layer rather than being
chosen at the call site.

**`DESIGN.md`'s opening paragraph is now a record of a superseded world unless
it is rewritten, so it is rewritten.** The front matter is still the only place
a colour may be declared, and
[`apps/web/test/no-hex-colors.test.ts`](../../apps/web/test/no-hex-colors.test.ts)
still fails a hex written anywhere else. Nothing about that gate changes; what
changes is which palette the prose at the top of the file describes.

**The candidate runtime does not move, and must not drift.** Cream, ink,
hairlines and the voltage marker stay exactly as they are. The separation is
what lets `state-answered` keep its green in the runtime while the accent
carries positive meaning on the organiser: the two never appear on one screen.
A future screen that puts an organiser control inside the runtime, or a runtime
colour on an organiser screen, breaks the argument this record rests on rather
than merely looking odd.

**To watch.**

1. **Which ground is the default** — open, and the one question this ADR
   deliberately leaves to the owner. Until it is ruled on, the seed is
   `prefers-color-scheme` and an explicit choice wins.
2. **A third ground would justify generalising the generator.** A second flat
   `signal-l-*` family in front matter is used precisely so
   [`scripts/tokens.mjs`](../../scripts/tokens.mjs) — a working, tested gate —
   stays untouched. If a third ground ever appears, that is the moment to teach
   it modes, not before.
3. **If the dark ground is measured to cost organiser sessions**, the recovery
   is the default, not a redesign: flip the seed. That is what shipping both
   buys, and it is the reason the light palette is not deferred.
4. **`signal-line-2` must not be used as a rule or an outline.** It is 1.54:1
   and exists for decoration; `signal-line-strong` (and `signal-l-line-strong`)
   is the token for anything a reader has to see the edge of.
