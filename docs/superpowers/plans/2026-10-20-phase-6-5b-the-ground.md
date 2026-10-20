# Phase 6.5b — The Ground: One Accent Rule, Two Palettes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record `D1` as ADR 0010, rewrite `DESIGN.md`'s opening so one written rule says which accent applies where, declare both organiser grounds in front matter, and ship a working light/dark switch with the contrast suite asserting both — before any screen is restyled.

**Architecture:** `DESIGN.md` front matter stays the only place a colour is declared, so the light palette joins the existing flat `colors:` map as a second `signal-l-*` family and `scripts/tokens.mjs` is **not** modified. A new hand-written `theme.css` maps the generated `--color-signal-*` and `--color-signal-l-*` tokens onto one set of semantic names (`--ground`, `--ink`, `--edge`, `--accent`…) under `:root` and `:root[data-theme="light"]`; every organiser stylesheet then reads the semantic names and re-grounds by attribute alone. The switch is per-viewer `localStorage` seeded from `prefers-color-scheme`.

**Tech Stack:** YAML front matter + `scripts/tokens.mjs` (node), CSS custom properties, TypeScript, Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-20-phase-6-5-design-pass-design.md`](../specs/2026-10-20-phase-6-5-design-pass-design.md) — §3 (`D1`), §4 (`D2`), §11 (`D20`, `D20a`, `D20b`), §12.

**Goals covered:** `G1` — one written rule for which accent applies where, as ADR 0010, reflected in `DESIGN.md`. `G7` — both grounds ship.

## Global Constraints

Copied verbatim from the spec's §12. Every task's requirements implicitly include this section.

- **`DESIGN.md` front matter is the only place a colour may be declared.** `scripts/tokens.mjs` generates `tokens.css` and `tokens.ts`; `apps/web/test/no-hex-colors.test.ts` fails a raw hex anywhere else. A palette decision propagates by regeneration.
- `no-hex-colors.test.ts` strips only `/* */` comments, so a `//` comment containing a colour word or an issue reference like `#155` fails it. **Issue references in CSS go in block comments.**
- **`AG2`** — never make a gate green by moving a bar. No raised timeout, lowered threshold or weakened assertion.
- **`AG3`** — behaviour over text. Where behaviour cannot be exercised, assert the invariant, never the mechanism.
- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`.
- `pnpm test --force` does not work. Use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`. Not a knob.
- All four typefaces stay subsetted and self-hosted under `apps/web/public/fonts/`. **Nothing is added and nothing is retired** (`D2`). A prototype may load a font from a CDN; shipping cannot (PRD S-11).
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-6-5b/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **A viewer whose `localStorage` read throws** — a private window, cleared site data, storage blocked. The page must render on the seeded default, not blank. Task 4.
2. **A viewer with no stored choice and `prefers-color-scheme: light`** — the seed path, distinct from an explicit choice. Task 4.
3. **A selector whose colour is set on one ground and inherited on the other** — the SURFACE audit must fail loudly rather than silently skip it. Task 3.
4. **`signal-accent` used as text or as a border on any light surface** — 1.60:1, illegal, and the single mistake this whole phase exists to prevent. Task 3.
5. **A colour added to a stylesheet rather than to front matter** — `no-hex-colors` catches a raw hex, but not a new `rgb()` or `color-mix()` literal. Task 3.

---

### Task 1: ADR 0010 records the accent rule

**Files:**
- Create: `docs/adr/0010-the-organiser-moves-to-the-signal-ground.md`
- Modify: `docs/adr/README.md` (the index)

**Interfaces:**
- Consumes: the spec's §3 and §4, verbatim. Produces: no code.

**Why first:** the spec says ADR 0010 must land "before implementation starts", and every later task cites it.

- [ ] **Step 1: Write the ADR in the house format**

Follow `docs/adr/0009-*.md`'s structure exactly. It must record, verbatim from the spec: the rule (organiser takes the `signal-*` ground and the single green accent; **voltage retreats to the candidate runtime alone**, where it keeps the "you are here" palette square and the focus ring); every measured ratio in §3's table; the `state-answered` collision (a light-legal green `#07744a` is **1.09:1** from `state-answered #0d7a51` — the same colour to the eye); the hue argument against voltage-on-dark (legal at 4.98:1, refused because `signal-flag-review` amber and `signal-flag-risk` sit beside the accent on the integrity band, and an orange accent between them is three warm hues doing three unrelated jobs); `D2`'s typeface rule and why Anek cannot be retired (it carries Telugu and Devanagari on a shared skeleton that Phase 12's translations need); and `D20` — that **both grounds ship**, so `D1-alt` is no longer a fallback but the second half of the deliverable.

- [ ] **Step 2: Add the index row and commit**

```bash
git add docs/adr/0010-the-organiser-moves-to-the-signal-ground.md docs/adr/README.md
git commit -m "docs(adr): the organiser moves to the Signal ground, on both grounds (#187)"
```

---

### Task 2: `DESIGN.md` declares both grounds

**Files:**
- Modify: `DESIGN.md` — the `description:` opening and the `colors:` map
- Regenerate: `apps/web/src/styles/tokens.css`, `apps/web/src/styles/tokens.ts`
- Test: `scripts/tokens.test.mjs`

**Interfaces:**
- Consumes: `scripts/tokens.mjs`, **unmodified** — it reads a flat `colors:` map and emits `--color-<name>` plus a `ColorName` union.
- Produces: new `ColorName` members. Dark gains `signal-line-strong`. Light gains the family below. Later tasks and plans refer to these exact names.

| new token | value | why |
| --- | --- | --- |
| `signal-line-strong` | `#5a7465` | 3.88 on `bg` / 3.58 on `surface`. `signal-line-2` is **1.54:1** — fine for decoration, illegal for an input outline or a table rule, which `DESIGN.md` puts at 3:1. |
| `signal-l-bg` | `#f5f9f7` | |
| `signal-l-bg-2` | `#eef4f1` | |
| `signal-l-surface` | `#ffffff` | |
| `signal-l-surface-2` | `#eef4f1` | |
| `signal-l-line` | `#dde7e2` | |
| `signal-l-line-2` | `#c6d5cd` | |
| `signal-l-line-strong` | `#73907f` | 3.28 on `bg`, 3.49 on `surface` |
| `signal-l-text` | `#0b1a13` | |
| `signal-l-text-2` | `#3b4f46` | |
| `signal-l-text-3` | `#5c6f66` | |
| `signal-l-accent` | `#07744a` | 5.82:1 on white. **A different green, because `#19e68c` is 1.60:1 on any light ground.** |
| `signal-l-accent-deep` | `#0a8f57` | |
| `signal-l-accent-ink` | `#ffffff` | 5.82:1 on the accent, for button labels |
| `signal-l-flag-review` | `#8a5f00` | |
| `signal-l-flag-risk` | `#b3261e` | |

**Why a second flat family and not a `modes:` concept in the generator:** the generator is a working, tested gate. Teaching it theming is new machinery for a value a second prefix already carries, and `theme.css` (Task 3) is where the two families become one set of names. If a third ground ever appears, that is the moment to generalise.

- [ ] **Step 1: Rewrite the `description:` opening**

`D1` says `DESIGN.md`'s "voltage as canvas" opening is **rewritten, not extended**. The new opening states the rule in one paragraph: the organiser and the marketing surface share the `signal-*` ground and the single green accent in two measured palettes; voltage survives **only** in the candidate runtime, as the palette's "you are here" square and the focus ring; and the two never appear on one screen, which is what lets `state-answered` keep the cream runtime while the accent carries positive meaning on the organiser.

- [ ] **Step 2: Add the sixteen tokens to `colors:` and regenerate**

Run: `pnpm tokens`
Expected: `tokens.css` and `tokens.ts` change and nothing else does.

- [ ] **Step 3: Run the generator's own suite and the hex gate**

Run: `npx turbo run test --filter=@pariksha/web -- no-hex-colors` and `node --test scripts/tokens.test.mjs` (or the repo's existing invocation for it)
Expected: PASS. A failure here means a hex was written somewhere other than front matter.

- [ ] **Step 4: Commit**

```bash
git add DESIGN.md apps/web/src/styles/tokens.css apps/web/src/styles/tokens.ts
git commit -m "feat(design): declare both organiser grounds in front matter (ADR 0010)"
```

---

### Task 3: `theme.css` gives the two palettes one set of names

**Files:**
- Create: `apps/web/src/styles/theme.css`
- Modify: `apps/web/test/contrast-usage.test.ts`
- Test: `apps/web/test/theme.test.ts` (create)

**Interfaces:**
- Consumes: the generated `--color-signal-*` and `--color-signal-l-*` custom properties.
- Produces: the semantic names every later plan's CSS reads. **These names are the contract between this plan and 6.5c, 6.5d and 6.5e.**

```
--ground      --ground-2    --surface     --surface-2
--edge        --edge-2      --edge-strong
--ink         --ink-2       --ink-3
--accent      --accent-ink  --accent-wash
--warn        --warn-wash   --risk        --risk-wash
--wash        --wash-2
--glow        --glow-strong
```

`:root` carries the dark mapping; `:root[data-theme="light"]` carries the light one. **No other block may set these.**

**`D20a` — the field is a dark-ground device and is allowed to disappear.** `--glow` and `--glow-strong` resolve to a near-invisible wash on light. That is the ruling, not an oversight: a green bloom on cream is the same illegal-adjacent move `D1` refused, and inventing a light-mode ornament to replace it would make the two grounds two designs.

- [ ] **Step 1: Write the failing theme test**

```ts
it("defines every semantic name on both grounds", () => {
  for (const name of SEMANTIC_NAMES) {
    expect(darkBlock).toHaveProperty(name);
    expect(lightBlock).toHaveProperty(name);
  }
});

it("sets the semantic names nowhere but the two theme blocks", () => {
  expect(selectorsAssigning(SEMANTIC_NAMES, allOrganiserCss))
    .toEqual([":root", ':root[data-theme="light"]']);
});

it("maps every semantic name to a generated token, never to a literal", () => {
  for (const value of Object.values({ ...darkBlock, ...lightBlock })) {
    expect(value).toMatch(/^var\(--color-|^color-mix\(|^rgb\(var\(/);
  }
});
```

Parse with `readResolvedCss` from `apps/web/test/css-chain.ts` — the suite's single `@import` resolver — rather than a new one.

- [ ] **Step 2: Run and verify it fails**

Run: `npx turbo run test --filter=@pariksha/web -- theme`
Expected: FAIL — no `theme.css`.

- [ ] **Step 3: Write `theme.css`**

Two blocks, one mapping each. Washes are alpha over the ground's own ink, so dark uses a light wash and light uses a dark one — a light wash on a light ground is invisible, which is the one mapping that is not a straight rename.

- [ ] **Step 4: Teach `contrast-usage.test.ts` both grounds**

This is the largest mechanical change in the plan. Today `SURFACE` is `Record<string, ColorName | ColorName[]>` and the audit throws `no SURFACE entry for ${selector}` for anything unlisted. Change the value to carry a ground each:

```ts
type SurfaceEntry = { dark: ColorName | ColorName[]; light: ColorName | ColorName[] };
const SURFACE: Record<string, SurfaceEntry> = { /* … */ };
```

Run the whole audit **once per ground**, resolving each selector's declared colour through `theme.css`'s mapping for that ground before computing the ratio. Keep the thrown error — an unlisted selector must still fail loudly (Review Focus 3). **Do not weaken a single threshold** (`AG2`).

- [ ] **Step 5: Add the two standing guards**

```ts
it("never puts signal-accent on a light surface", () => {
  // #19e68c is 1.60:1 on cream — illegal as text and as a border.
  expect(usagesOf("signal-accent", "light")).toEqual([]);
});

it("declares no colour outside DESIGN.md", () => {
  // no-hex-colors catches a raw hex; this catches rgb()/hsl()/color() literals.
  expect(nonTokenColourLiterals(allOrganiserCss)).toEqual([]);
});
```

- [ ] **Step 6: Run the contrast suite on both grounds**

Run: `npx turbo run test --filter=@pariksha/web -- contrast`
Expected: PASS on both grounds, with the same thresholds as before.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/styles/theme.css apps/web/test/theme.test.ts apps/web/test/contrast-usage.test.ts
git commit -m "feat(web): one set of semantic colour names across both grounds (D20)"
```

---

### Task 4: the switch, per viewer

**Files:**
- Create: `apps/web/src/lib/ground.ts`
- Modify: the organiser entry point `apps/web/src/admin-main.tsx`
- Test: `apps/web/test/ground.test.ts`

**Interfaces:**
- Produces: `readGround(): "dark" | "light"` and `writeGround(g: "dark" | "light"): void` from `apps/web/src/lib/ground.ts`. `readGround` never throws. 6.5c mounts the control in the top bar and calls these; it does not reimplement them.
- The attribute is `data-theme` on `document.documentElement`, matching Task 3's selector.

**`D20b` — which ground is the default is still open.** The builder's answer, unless the owner rules otherwise: seed from `prefers-color-scheme` and let an explicit choice win.

**`D7d`'s rule applies here too:** per-viewer, `localStorage`, and the page must render correctly when the read throws.

- [ ] **Step 1: Write the failing tests**

```ts
it("returns the stored choice when there is one", () => { /* localStorage = "light" */ });
it("seeds from prefers-color-scheme when there is no stored choice", () => { /* matchMedia light */ });
it("returns dark and does not throw when localStorage throws", () => {
  stubStorageToThrow();
  expect(readGround()).toBe("dark");
});
it("writeGround does not throw when localStorage throws", () => {
  stubStorageToThrow();
  expect(() => writeGround("light")).not.toThrow();
});
```

- [ ] **Step 2: Run and verify they fail**

Run: `npx turbo run test --filter=@pariksha/web -- ground`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `ground.ts`**

Both functions wrap every storage access in try/catch. `readGround` falls back to `matchMedia("(prefers-color-scheme: light)")`, then to `"dark"`.

- [ ] **Step 4: Apply the attribute before first paint**

In `admin-main.tsx`, set `document.documentElement.dataset.theme = readGround()` before the app mounts, so the page never flashes the wrong ground.

- [ ] **Step 5: Run the tests and the organiser suite**

Run: `npx turbo run test --filter=@pariksha/web -- ground organiser`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/ground.ts apps/web/src/admin-main.tsx apps/web/test/ground.test.ts
git commit -m "feat(web): per-viewer ground, seeded from prefers-color-scheme (D20)"
```

---

## What this plan does not do

It changes **no screen**. The organiser still renders in `admin.css`'s existing language; it simply now has two palettes, one set of names and a switch behind them. 6.5c, 6.5d and 6.5e consume `theme.css`'s semantic names and the `data-theme` attribute, and the per-screen `SURFACE` entries grow as each screen is restyled.
