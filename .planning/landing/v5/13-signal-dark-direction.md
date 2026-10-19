# Visual direction v3 — "Signal" (dark, accent green)

| | |
| --- | --- |
| **Trigger** | Reference supplied: a dark SaaS marketing page — near-black ground, spring-green accent, soft field glow, device frame, product card row, pill buttons, filter chips. |
| **Prototype** | `prototypes/f-signal-dark.html` |
| **Status of the alternatives** | `12-visual-direction-v2.md` (monochrome "Verdict", `prototypes/e-verdict.html`) stays as the alternate — its composition thinking carries into this one. `11-visual-direction.md` (Question Paper, orange) is withdrawn. |

---

## 1. What the reference actually supplies

Stripping the specific brand away, the reference is making six moves:

1. **Dark-committed ground**, not a dark mode — one visual world, no light variant.
2. **One saturated accent** doing every job: eyebrow dot, headline highlight, primary button, data emphasis, icon stroke.
3. **A soft field behind the hero** — radial glow plus a faint grid, masked out at the edges. Depth without imagery.
4. **The product shown inside a frame** — a browser or device chrome containing a real screen.
5. **A card row of categories** with simple line icons, reading as "here is the range of what this handles".
6. **Pills and chips everywhere** — rounded buttons, filter chips, status tags. Soft geometry against hard data.

Five of the six transfer directly. **The fourth does not**, and that is the one real problem: there is no product to screenshot and will not be before v0.1.

**What goes in the frame instead:** the live pool draw. Browser chrome, a plausible URL, tag chips, three candidates receiving three different papers, a *Draw again* button. It is interactive, it is the product's central claim, it runs on real identifiers from the worked example, and it is honest — nothing in that frame is a mock-up of a screen that does not exist.

---

## 2. The colour problem, and the call

The product already assigns meaning to three colours: **clean** green, **review** amber, **high risk** red, used in the app, the results CSV and every integrity report. A green brand accent collides with the first.

Three ways out, and the one taken:

| Option | Effect |
| --- | --- |
| Accent green, verdicts recoloured | Breaks a semantic set shared with the product and the export. No |
| Accent not green — teal, blue, violet | Safe, but violet-to-blue is the most over-used look in the category, and the reference's energy comes from the green specifically |
| **Accent green, and let clean *be* the accent** ★ | Taken. `clean` and the brand are the same token: for an exam product, "the brand colour means passed, correct, in order" is coherent rather than confusing. Amber and red keep their own values and appear only as verdict pills |

So the page runs one accent, and the only two *other* hues on it are the amber and red in the results table — which is still the page's one moment of chromatic tension, in the right place.

### Tokens

| Token | Value | Role |
| --- | --- | --- |
| `bg` | `#070B09` | Page. Near-black with a green bias — chosen, not a default grey |
| `bg-2` / `surface` / `surface-2` | `#0B110E` / `#0F1713` / `#141E19` | Panels, cards, frame interior |
| `line` / `line-2` | `#1C2922` / `#2A3B32` | Hairlines, card edges |
| `text` / `text-2` / `text-3` | `#EAF2ED` / `#9DB0A6` / `#6B7D74` | Body, secondary, captions |
| `accent` / `accent-deep` / `accent-ink` | `#19E68C` / `#0FA968` / `#04140C` | One accent. `accent-ink` is the text on a filled button |
| `glow` | `rgba(25,230,140,0.16)` | The hero field only |
| `clean` / `review` / `risk` | `#19E68C` / `#F2B544` / `#FF6B5E` | Verdicts. `clean` is the accent |

Contrast: `text` on `bg` is ~15:1, `text-2` ~7:1, `accent` on `bg` ~11:1, `accent-ink` on `accent` ~12:1. All pass comfortably; `text-3` is captions only and must not carry body copy.

**Dark-committed, deliberately.** No light variant ships. Every colour is painted explicitly so the page holds whatever ground it sits on. If a light theme is wanted later it is a designed second palette, not an inversion.

---

## 3. Type

Unchanged from `12-visual-direction-v2.md` §3 and still free of `DESIGN.md`:

- **Archivo** (variable, `wdth 62–125` / `wght 100–900`) for display and body. The width axis is the reason to choose it — the hero can run expanded while body copy stays normal.
- **JetBrains Mono** for data, labels, chips, code, and anything with digits (`tabular-nums`).
- **Anek Telugu / Devanagari** kept purely as wordmark assets — **1.7 KB for both**, already subsetted to the glyphs of *Pariksha*. This is what frees the Latin face entirely.
- Kalam can be dropped; the masthead no longer needs a handwriting face. 3.2 KB back.

Display runs lighter here than in the monochrome direction: `clamp(40px, 6.6vw, 82px)` rather than 132px, because the hero now shares its width with the frame.

---

## 4. Composition

Still movements rather than repeated slabs:

| # | Movement | Treatment |
| --- | --- | --- |
| 1 | Hero | Field glow + grid, copy left, live draw in a browser frame right, trust facts as a dotted row |
| 2 | Type rail | Six line-icon cards — the reference's category row, carrying the twelve types |
| 3 | Not a form | Split: claims with ticks on the left, a pool-draw panel on the right |
| 4 | Integrity | Field glow returns. Prose left, the results table right — the only amber and red on the page |
| 5 | Cost | Four metric tiles in one ruled block, then the caveat in full |
| 6 | Compare | One wide table, accent on the Pariksha column head only |
| 7 | Status | Chip toggle between *Live today* and *Lands with v0.1*, beside the "what you can do today" card |
| 8 | Close | Centred, field glow, two actions |

**Interactions, three, all load-bearing:** tag chips re-filter the pool; *Draw again* re-draws three papers; the status chips switch the two lists. Everything renders with JavaScript off — the draw ships a real first result and both status lists render stacked.

---

## 5. What the exam-portal case study contributed

`Student Exam Portal Design — A UX Case study` (UX Planet, 2020) is a **product** case study — question builder, exam paper flow, question bank admin — not landing-page craft. It gave two things worth keeping, neither of them visual:

1. **Its domain model is almost ours.** Course → module → topic → question bank → paper → sections maps onto workspace → bank → tags → test → sections. That is independent evidence the Phase 4/5 interaction design in `docs/design.md` is modelling the problem the way practitioners do.
2. **Its hardest problems are our hardest problems** — one editing screen that absorbs twelve question types, and sections that draw from a bank. Worth re-reading when the authoring UI is designed, not now.

Filed as reference for the authoring phase, not for this page.

---

## 6. Open calls

1. **Does the product follow the marketing page into dark-with-green, or stay vermilion-on-cream?** Recommendation: ship the landing page in Signal now, leave the app alone, and revisit once the authoring screens exist. The app's chrome is token-driven, so following later is one pull request.
2. **`clean` as the brand accent** — this is the one semantic decision in §2 that deserves a second opinion before it hardens into `DESIGN.md`.
3. **E or F.** `e-verdict.html` is monochrome, editorial, and quieter; `f-signal-dark.html` is the reference's register. They are the same words and the same spine, so the choice is purely about which room the product should walk into.
