# Phase 8g — the frame and the controls: plan index

**Spec:** `docs/superpowers/specs/2026-10-24-phase-8g-the-frame-design.md`
(measured findings `F1`–`F9`, owner walkthrough `O-01`–`O-34`)
**Companion register:** `docs/UI_UX_AUDIT_REPORT.md` (`G1-01`–`G5-19`, code-read, unverified)

Three sources, 98 findings, heavy overlap. This index is the single map:
which plan owns which finding, what order they go in, and what is
deliberately **not** a design plan.

Owner's stated priority: **the test builder, home, banks**.

---

## Not design work — route these elsewhere

| ID | What | Why it is not here |
| --- | --- | --- |
| **`O-17`** | **Focus leaves the field while typing** — attempts allowed, sync/grade fields, Branding, Registration, Access, question editing | A functional bug on at least six surfaces, so the cause is shared: a remount or a changing `key` per keystroke. Needs `superpowers:systematic-debugging`, not CSS. **This is the worst item in the whole walkthrough** — it breaks editing itself, and no amount of spacing matters on a field you cannot type into. |
| **`O-28`** | A **v3 draft nobody created** appears after publishing v3 | Either a real state bug or a misread of the version model. Reproduce first; plan after. |
| **`O-14`** | The **candidate exam screen is not divided into sections** at all | A feature gap, not styling. The builder models sections; the runtime ignores them. Needs its own spec and a decision about per-section timing — the same decision `F5`'s dead control is blocked on. |
| `G2-08` | Change the tests list's 182px row height | Moves a pinned `density.spec.ts` baseline. |

---

## The plans

### 8g-1 — the frame *(written: `2026-10-24-phase-8g-the-frame.md`)*

Page geometry and token consistency. Nine tasks, each leaving a
browser-measured gate.

Owns: `F1` (568px dead scroll — cause located, `grid-row: 1 / span 40` paying
row-gap on 34 empty rows), `F2` (editor gets 47% of the viewport), `F3`
(section-row baselines + every control under 24px), `F4`/`O-15` (settings
read as text), `F5` (dead control), `F6` (three rounding systems), `F7`/`O-32`
(ragged action column), `F8` (home card rows off a shared line), `F9` (no
gate exists).
Also: `G1-05`, `G1-07`, `G2-05`, `G2-07`/`O-09`, `G3-08`, `G5-13`, `G5-15`.

**Extend before executing** with `O-04` (the nav is too tall — it costs the
builder vertical room) and `O-13` (test name, status, Publish and Close
jammed with no spacing).

### 8g-2 — the shell

The chrome every screen wears. Small, self-contained, and it changes the
first impression of all 14 screens.

Owns: `O-02` (nav collapsed by default, expand on hover, titles only while
expanded), `O-03` (drop the collapse button once hover-expand ships), `O-05`
("Pariksha | Pariksha" — the product name twice), `O-06` (email as bare text
→ a profile control holding email and sign-out, the hook RBAC will need),
`O-07` (the light/dark toggle does not change).

Note against `O-02`: hover-expand is a pointer-only affordance. It needs a
keyboard and touch path, or it repeats the mistake `O-10` and `O-25` are
complaints about.

### 8g-3 — controls that look like controls

The widest theme in the walkthrough: links where buttons belong, text where
expanders belong, native elements left unstyled, and adjacent controls with
no space between them.

Owns: `O-12` (View version N is a link), `O-20` (position/section controls
look like unstyled HTML), `O-23` (candidate-list file input), `O-24` (New
question joined to Import; Edit joined to Delete), `O-26` (bank dropdowns),
`O-29` (test name is a link with no View button), `O-30` (Open / All clear /
state "don't load well"), `O-31` (Slug appears as both a column heading and
a per-row label), `O-34` (webhooks and API keys — one straight line, no
styling), `O-08` (workspace · owner is bare text), `O-16` (settings panels
are near-unstyled).
Also: `G2-03`/`O-27` (search, status, sort on three levels), `G4-08`
(unstyled 22px selects beside 44px inputs), `G5-19` (grading controls have
no CSS rule at all).

The fix is probably **one shared row primitive plus a styled native-control
set**, not thirty separate patches. Write the plan that way or it will be
thirty patches.

### 8g-4 — stop hiding primary actions behind hover

Owns: `O-10` (a Needs-you row does not read as a test, and its Open button
is invisible, until hovered), `O-25` (a bank question's Edit / Export /
Delete appear only on hover — the owner wants them visible, as icons, with
labels clarified on hover), `O-33` (Duplicate and Export on the tests list).
Also `G1-01`, which names the cause: `opacity: 0` until `:hover`, which on a
touch device never resolves.

Smallest honest plan here, and it fixes a genuine accessibility failure, not
only a preference.

### 8g-5 — the section editor

The owner's loudest complaint, and the screenshot backs it.

Owns: `O-18` (sections compressed to the left while Add-questions takes the
right; the summary wraps to one word per line; the questions-filled control
pushed out of its section), `O-19` (cause: the "Position of section" label
plus the section name eat the row), `O-21` (selecting questions compresses
everything to unreadable), `O-22` (**Delete section's confirm is below the
fold and carries no distinguishing colour**).
Also: `G3-02` (no modal scrim), `G3-03` (destructive action styled
`.button-primary`), `G3-05` (the 12px rail/panel hover gap).

`O-22` is the one with a real cost: an irreversible action whose confirm you
have to scroll to find, wearing the same colour as everything else.

### 8g-6 — verify the companion register

Before any of its remaining 47 findings are planned against. It scored one
group 7/100 from a code read, and this session's own instrument produced a
false positive (six contrast failures at ratio 1.0 that measure ~16:1).
Three are urgent enough to pull forward if they survive verification:
`G4-01` (question deletion with no confirmation), `G5-01` (text scaling does
nothing for low-vision candidates — WCAG 1.4.4), `G5-05` (a screen reader
announcing every keystroke during an exam).

---

## Suggested order

1. **`O-17`**, the focus bug — debugging, not this phase. Everything else is
   cosmetic next to a field you cannot type in.
2. **8g-1 the frame** — the gate infrastructure lands here, and every later
   plan uses it.
3. **8g-5 the section editor** — the owner's loudest complaint, and `O-22`
   is a safety issue.
4. **8g-4 hover** — small, and an accessibility failure.
5. **8g-3 controls** — the widest, best done once the shared primitive from
   8g-1 exists.
6. **8g-2 the shell** — visible everywhere, but nothing is broken.
7. **8g-6 verification**, then whatever of the register survives it.
