# Landing page rebuild — the constraints it must not break

Scope: `phase-3/landing-page-v2`, rebuilding `apps/web/src/routes/landing.tsx` and its
components, stylesheet, `index.html` and build step. Everything below is derived from the
files as they stand on this branch, not from memory.

Sources read in full: `apps/web/test/*` (7 files), `apps/web/vite.config.ts`,
`apps/web/wrangler.jsonc`, `apps/web/public/_headers`, `apps/web/index.html`,
`apps/web/admin.html`, `apps/web/tsconfig.json`, `apps/web/package.json`,
`scripts/tokens.mjs`, `scripts/tokens.test.mjs`, `scripts/vitest.config.ts`,
`scripts/deploy-workflow.test.mjs`, `eslint.config.js`, `vitest.config.ts`,
`tsconfig.base.json`, `turbo.json`, root `package.json`,
`.github/workflows/ci.yml`, `.github/workflows/deploy-web.yml`,
`DESIGN.md` front matter, `src/styles/base.css`, `src/styles/landing.css`,
`src/main.tsx`, GitHub issues 137 and 135.

---

## 1. Every existing test, and what the rebuild does to it

Verdicts: **UNTOUCHED** (passes unchanged if the rules in §2 hold), **UPDATE** (the test
file itself must be edited as part of the rebuild — this is in the definition of done),
**BREAK** (will fail unless the rebuild deliberately handles it).

### `apps/web/test/landing.test.tsx`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 1 | `renders exactly one h1 with the hero headline, and the product name on the page` | `getAllByRole("heading", {level:1})` has length 1; `toHaveTextContent("Run real exams on the internet, for free, on infrastructure you own.")`; `getAllByText("Pariksha").length > 0` | **UPDATE** — the headline string is hard-coded copy |
| 2 | `has exactly one CTA-shaped link, the hero's worked-example link` | `getAllByRole("link", {name:/start\|deploy\|try/i})` has length **1**; its accessible name is exactly `"Start with the worked example →"`; its `href` is `https://github.com/SriSatyaLokesh/pariksha/tree/main/examples/reasoning-aptitude` | **BREAK + UPDATE** — a richer page will have more than one link matching `/start|deploy|try/i`, and issue 137 requires the `→` to leave the accessible name |
| 3 | `the hero carries the hero-section class from the design system` | `container.querySelector(".hero-section")` is non-null | **UNTOUCHED** — keep the class name |
| 4 | `tokens.css defines the voltage colour the hero is wired to` | `tokens.css` matches `/--color-voltage:\s*#e24c18;/` | **UNTOUCHED** — no palette change |
| 5 | `the stylesheet wires the hero background to the voltage token, not a literal` | first `/\.hero-section\s*\{[^}]*\}/` match in `landing.css` matches `/background:\s*var\(--color-voltage\)/` | **BREAK RISK** — see §2.8. The regex is brace-naive: the `.hero-section` rule must contain **no nested block** and must still carry the literal declaration `background: var(--color-voltage)` |
| 6 | `every font is self-hosted under /fonts/, never a third-party origin` | every `url(...)` in `fonts.css` starts `/fonts/`; none starts `http` | **UNTOUCHED** — no CDN fonts, no new faces unless the file is added to `public/fonts/` |
| 7 | `index.html and admin.html both declare lang=en` | both match `/<html lang="en">/` | **UNTOUCHED** — the prerender must not rewrite the source `index.html`'s `<html>` tag |
| 8 | `provides a skip-to-content link targeting the main landmark` | a link named `/skip to content/i` with `href="#main-content"`, and `#main-content` exists | **UNTOUCHED** — keep both |
| 9 | `has a sane heading order with no skipped level` | headings in DOM order never jump more than +1 level | **BREAK RISK** — every new section's heading level is constrained; visually-hidden headings count (the footer's `<h2 class="visually-hidden">Footer</h2>` is one) |
| 10 | `has no inline style attributes anywhere in the rendered markup` | `container.querySelectorAll("[style]")` is empty | **UNTOUCHED, but binding** — no `style={{}}`, including for CSS custom properties |
| 11 | `is free of axe violations` | `axe(container)` returns no violations (20 s budget) | **UNTOUCHED, but binding** — see §2.5 |

**What #1 and #2 change to.** The spec must name the replacements verbatim, because these
are the only two tests that encode copy:

- #1: assert the new `h1` text content exactly. The product name requirement moves *into*
  the `h1` — the owner asked for "a premium SaaS hero that carries the product name
  Pariksha prominently", which reverses the Phase 3 controller decision recorded in the
  test's own comment. Keep the second assertion (`getAllByText("Pariksha").length > 0`),
  which still holds, and restate the first as the new headline string.
- #2: the "exactly one CTA-shaped link" claim cannot survive a page with a hero CTA, a
  deploy CTA and a docs CTA. Replace it with two narrower assertions that are still
  falsifiable: (a) the **first** link inside `.hero-section` has a stated accessible name
  and a stated `href`; (b) every CTA-shaped link on the page points at a
  `github.com/SriSatyaLokesh/pariksha` URL (nothing fabricated, nothing pointing at a
  product that does not ship yet). The accessible name loses the `→` per issue 137:
  the glyph goes in `<span aria-hidden="true">`, so the expected name is
  `"Start with the worked example"` — with the trailing space trimmed by the accessible
  name computation.

### `apps/web/test/contrast-usage.test.ts`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 12 | `has no selector missing from SURFACE or the documented wrapper exclusions` | every selector in `landing.css` that declares `color:` is a key in `SURFACE` or in `WRAPPER_SELECTORS_WITH_NO_OWN_TEXT` | **BREAK** — fails on the first new colour-setting selector |
| 13 | `has no stale entry in SURFACE for a selector no longer in landing.css` | every `SURFACE` key still exists in `landing.css` | **BREAK** — fails on the first removed/renamed selector |
| 14 | `has no selector that fails to resolve (fails loudly, never skips)` | for each selector: foreground parses as `var(--color-NAME)`, a `SURFACE` entry exists, and a font size resolves | **BREAK RISK** — see the parser limits in §2.2 |
| 15 | `resolved at least one usage` | `resolved.size > 0` | UNTOUCHED |
| 16 | one test *per `SURFACE` key* — `<selector> clears its WCAG threshold` | computed ratio ≥ 3:1 for ≥24px, or ≥18.66px at weight ≥700; else ≥4.5:1 | **BREAK RISK** — every new text colour/surface pairing must clear its real threshold |

**This file is part of the rebuild's diff.** `SURFACE` is a hand-maintained map of
"which background does this selector's text sit on", and the rebuild rewrites
`landing.css` wholesale. Budget for rewriting the map, not patching it.

### `apps/web/test/contrast.test.ts`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 17 | one test per `contrastPairs` entry (≥13) — `<token> computes to <stated>` | each ratio stated in `DESIGN.md`'s colour tables is within 0.01 of the computed value | **UNTOUCHED** — only breaks if `DESIGN.md`'s palette or stated ratios change, which the fixed decisions forbid |

### `apps/web/test/hosting.test.ts`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 18 | `sets a Content-Security-Policy with default-src 'self' on /*` | the `/*` block of `public/_headers` carries `Content-Security-Policy: … default-src 'self' …` | **UNTOUCHED, but binding** |
| 19 | `never weakens the CSP and never points at a third-party origin` | `_headers` contains no `'unsafe-inline'`, no `'unsafe-eval'`, and no `https?://` **anywhere in the file** | **UNTOUCHED, but binding** — see the JSON-LD problem in §4.4 |
| 20 | `serves assets from the same directory Vite builds into` | `resolve(wrangler.assets.directory) === resolve(viteConfig.build.outDir ?? "dist")` | **UNTOUCHED unless the prerender changes `outDir`** — if it does, both move together |
| 21 | `declares no main script, so every request is a free static-asset request` | `wrangler.jsonc` has no `main` | **UNTOUCHED, and it is the fixed decision** — build-time prerender only, never a runtime Worker |
| 22 | `is copied into dist, so _headers is deployed rather than only committed` | `viteConfig.publicDir === "public"` and `public/_headers` exists | UNTOUCHED |
| 23 | `carries every font face the stylesheet asks for` | every `url("…")` in `fonts.css` is root-relative and the file exists under `public/` | UNTOUCHED |

`wrangler.jsonc` is parsed with plain `JSON.parse` on the strength of "no comments or
trailing commas in this file". Adding `not_found_handling` (issue 137) must keep it
comment-free and trailing-comma-free, or test 20/21 throws rather than fails.

### `apps/web/test/no-hex-colors.test.ts`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 24 | one test per scanned file — `<file> has no hex colour literal` | no `/#[0-9a-fA-F]{3,8}\b/` in any `.ts/.tsx/.css/.html` under `apps/web/src`, **plus `index.html` and `admin.html`**, excepting `tokens.css`/`tokens.ts` | **BREAK RISK** — a `<meta name="theme-color" content="#e24c18">` in `index.html` (an issue-137 item) fails this. See §4.3 |
| 25 | one test per `.tsx` — `<file> has no style={} attribute` | no `/\sstyle=\{/` | **UNTOUCHED, but binding** |
| 26 | one test per `.ts/.tsx` — `<file> does not import a CSS-in-JS runtime` | no import from `styled-components` or `@emotion/*` | UNTOUCHED |

New files the rebuild adds under `apps/web/src` are picked up automatically by the
directory walk — including any data module holding the on-page code samples.

### `apps/web/test/bundle.test.ts`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 27 | `produces separate entry chunks for index.html and admin.html` | a real `vite build({write:false})` yields entry chunks named `index` and `admin` with distinct filenames | **BREAK RISK** — the prerender must not replace `rollupOptions.input` or turn the config into an SSR build |
| 28 | `the candidate entry's module graph contains no module under src/routes/admin*` | walking `index`'s transitive chunk imports, no module id matches `/src[\\/]routes[\\/]admin/` | **UPDATE** (issue 137) — widen to `/src[\\/](routes[\\/])?admin/i` so `src/admin-main.tsx` and any `src/components/AdminNav.tsx` are caught |

Note this test runs a full `vite build` inside vitest with a 60 s `beforeAll` budget. A
prerender implemented as a Vite plugin runs here too; it must not write outside `dist/`
when invoked with `write: false`, and must not throw.

### `scripts/tokens.test.mjs` (run by `pnpm vitest run scripts`)

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 29 | `reads every colour from DESIGN.md's front matter` | `voltage === "#e24c18"`, `cream === "#fffbf5"`, ≥20 colours | UNTOUCHED |
| 30 | `resolves component token references to concrete values` | `components["hero-section"].backgroundColor`, `.typography`, `components["button-primary"].rounded` resolve | UNTOUCHED |
| 31 | `emits a CSS custom property per colour and per typography token` | `toCss` output contains `--color-voltage`, `--type-display-xl-size: 56px`, `--rounded-full`, `--space-xl` | UNTOUCHED |
| 32 | `parses every stated ratio from the colour tables` / `skips rows with no stated ratio` | ≥13 pairs, all against cream, `voltage-soft` absent, `data-blue` = 4.81 | UNTOUCHED |
| 33 | **`the committed token files match what the generator produces`** | `tokens.css` and `tokens.ts` are byte-identical to `toCss`/`toTs` output | **UNTOUCHED, but binding** — never hand-edit either file; re-run `pnpm tokens` and commit after any `DESIGN.md` edit |
| 34 | `finds none under apps/web/src` (`filesWithHexLiterals`) | second, independent hex guard over `apps/web/src` only (does **not** scan `index.html`) | **UPDATE** (issue 137) — widen the regex alongside test #24 |
| 35 | `treats a missing apps/web/src tree as zero offending files` | `filesWithHexLiterals` on a missing dir returns `[]` | UNTOUCHED |

### `scripts/deploy-workflow.test.mjs`

| # | Test | What it asserts | Verdict |
|---|---|---|---|
| 36 | `does not run at all until someone opts the repository in` | `deploy.if` contains `vars.DEPLOY_WEB == 'true'` | UNTOUCHED |
| 37 | `never interpolates a secret into a shell script body` | no step's `run:` contains `secrets.` | **UNTOUCHED, but binding** — if the prerender needs a value in CI, pass it via `env:` |
| 38 | `runs the test suite before it deploys` | the `pnpm test` step index < the `wrangler deploy` step index | **UNTOUCHED, but binding** — a new prerender step must not be inserted after `wrangler deploy`, and `pnpm test` must stay before it |

### Support files (not tests)

- `apps/web/test/setup.ts` — registers `toHaveNoViolations` and an explicit `cleanup()`
  (`globals` is off). Any new test file in `apps/web/test/` inherits this automatically
  via `vite.config.ts`'s `test.setupFiles`.
- `apps/web/test/jest-axe.d.ts` — the vitest matcher declaration. Leave it alone.

---

## 2. Invariants — stated so an implementer can test against each one

**2.1 No colour literal of any kind in authored source.**
No `.ts/.tsx/.css/.html` file under `apps/web/src`, nor `apps/web/index.html`, nor
`apps/web/admin.html`, contains a hex colour; `tokens.css` and `tokens.ts` are the only
exceptions and are generated. After the issue-137 widening this extends to `rgb(`,
`rgba(`, `hsl(`, `oklch(` and named colours — with one legal form that the widened regex
**must** keep passing, because `base.css` already uses it twice:
`rgb(from var(--color-NAME) r g b / <alpha>)`. Write the widened guard as "a colour
function whose first argument is not `from var(--color-…)` is a failure".

**2.2 Every bit of text on the page has a proven contrast ratio.**
Every selector in `landing.css` that declares `color:` either appears in
`contrast-usage.test.ts`'s `SURFACE` map with the token name of the background it really
renders on, or is listed as a pure wrapper with no text of its own. For each such
selector the test must be able to resolve, *from the selector's own declarations*:

- foreground — `color:` must be exactly `var(--color-NAME)` with `NAME` in `tokens.colors`
  (the regex is anchored `^var\(--color-…\)$`: no `color-mix()`, no `rgb(from …)`, no
  `inherit`, no shorthand);
- size — `font-size:` must be `var(--type-X-size)` or `clamp(<px|rem>, …, var(--type-X-size))`;
  anything else needs an `INHERITED_SIZE_WEIGHT` entry justified by a comment;
- weight — `font-weight:` must be `var(--type-X-weight)`, else 400 is assumed.

Consequences the rebuild must respect:
- `--color-voltage` (3.86:1 on cream) may never colour text below 24px; use
  `--color-voltage-deep` for links and small accents, as `.status-band__links a` already does.
- `--color-muted` (≈4.97:1 on cream) is fine down to 12px `mono-sm`, which the existing
  captions rely on; `--color-hairline*` is never a text colour.
- Syntax-highlighted code must not multiply colour classes. Each highlight class is a new
  `SURFACE` entry and a new per-selector WCAG test. Keep to at most three roles
  (e.g. ink for code, muted for comments, `voltage-deep` or `data-blue` for keys/strings),
  each ≥4.5:1 on its real surface at `mono-md` 15px.
- **Do not wrap colour rules in `@supports`, `@layer` or `@container`.** `parseRuleBodies`
  recurses into `@media` only; any other at-rule swallows its children and the contrast
  guard silently stops seeing them. That is a guard bypass, not a pass.

**2.3 The DESIGN.md colour tables stay true.**
`contrast.test.ts` recomputes every ratio stated in `DESIGN.md`. If `DESIGN.md` gains
prose (the clamp-floor and `color-scheme` records from issue 137) that is free; if it
gains or edits a colour row, the stated ratio must be the computed one to within 0.01.

**2.4 The token files round-trip.**
`node scripts/tokens.mjs` regenerates `apps/web/src/styles/tokens.css` and `tokens.ts`
byte-identically from `DESIGN.md`'s front matter. Neither file is ever hand-edited; after
any `DESIGN.md` change, `pnpm tokens` runs and both outputs are committed. `pnpm build`
runs `pnpm tokens` first, so a stale committed file shows up as a dirty working tree
rather than a red test — check `git status` after building.

**2.5 The rendered landing page has no axe violation under jsdom.**
`axe(container)` on `<Landing />` returns zero violations. Recorded limits so nobody
over-trusts it: jsdom has no layout engine or canvas, so axe contributes **zero contrast
coverage** (§2.2 is the only contrast gate) and nothing about the 400px render. The rules
that will actually bite a bigger page: every `<nav>` and every `role="region"` needs its
own accessible name; every interactive control needs an accessible name; all content sits
inside a landmark; exactly one `main`; headings never skip a level (also test #9); tables
keep `scope` on header cells; `lang` stays on the Telugu and Devanagari glyphs.
A real-browser axe run and the 400px check remain out of scope here — issue 33.

**2.6 No admin code leaks into the candidate bundle.**
A real `vite build` produces distinct entry chunks named `index` and `admin`, and no
module in `index`'s transitive chunk graph matches `/src[\\/](routes[\\/])?admin/i` after
the issue-137 widening. Put nothing admin-shaped in a module the landing page imports.

**2.7 The served security headers never weaken.**
`public/_headers` keeps `default-src 'self'` on `/*`, contains no `'unsafe-inline'`, no
`'unsafe-eval'` and no `https?://` substring; `wrangler.jsonc` keeps `assets.directory`
pointing at Vite's `outDir` and declares no `main`; `publicDir` stays `"public"`; every
`url()` in `fonts.css` resolves to a real file under `public/`. No third-party script, no
CDN font, no analytics.

**2.8 The hero stays wired to the token, in a flat rule.**
`landing.css`'s first `.hero-section { … }` rule contains the literal declaration
`background: var(--color-voltage)` and no nested block. A gradient, grain or glow may be
layered — but as a *second* declaration in the same flat rule (`background-image:`), or on
a pseudo-element / child rule, never by replacing that `background:` declaration and never
by nesting inside `.hero-section`.

**2.9 No inline styles and no CSS-in-JS.**
Zero `style={` in any `.tsx`, zero `[style]` attributes in the rendered output, no
`styled-components` or `@emotion/*` import. Dynamic visual state is a class name, not a
style property — including CSS custom properties set per element.

**2.10 Pre-alpha honesty survives.**
Nothing on the page asserts the application ships today. Every CTA resolves to something
that exists now: the repo, `examples/reasoning-aptitude`, `schemas/`, `docs/PRD.md`.
BYOK is labelled as roadmap. (No test enforces this — it is a review gate, and the
reviewer who filed issue 137 will check it.)

---

## 3. Issue 137 items the rebuild should close, and how

Thirteen deferred findings plus five UI/UX items. Grouped by whether the rebuild closes
them as a side effect.

### Closed by the rebuild (do these in this PR)

| Item | Fix |
|---|---|
| `landing.css:141` hand-types `rgba(35, 31, 29, 0.08)` | The stylesheet is being rewritten. Use `rgb(from var(--color-shadow) r g b / 0.08)`, the form `base.css:80` already uses |
| Colour guard only matches `#…` (`scripts/tokens.mjs:201`, `no-hex-colors.test.ts:15`) | Widen both regexes together to `rgb()/rgba()/hsl()/hsla()/oklch()/lab()` and the named-colour set, with the `rgb(from var(--color-…) …)` carve-out from §2.1. The line above must be fixed first or the widened guard fails on landing |
| `bundle.test.ts:96` path regex misses `src/admin-main.tsx` | `/src[\\/](routes[\\/])?admin/i` |
| `eslint.config.js:16` type-aware-lints `**/src/**/*.ts` only | `files: ["**/src/**/*.{ts,tsx}"]`. Do this **first**, before writing the new components, so the new code is written under the rules it will be judged by (§4) |
| No guard on component dimensions; `.top-nav__inner` drifted to `padding-block: var(--space-sm)` against `DESIGN.md`'s `12px 32px` | Add one small test comparing `.button-primary` height, `.button-secondary` padding/height and `.top-nav` padding/height to `tokens.components`, and fix the nav padding. `tokens.components` is already exported and already resolved |
| `.nav-link` ≈34px tall against a 44px comfort target | `DESIGN.md`'s `nav-link.height` is already `40px` with `6px 12px` padding — raising block padding to `--space-md` (12px) brings the rendered box to 40px and satisfies the new dimension guard at the same time. Two findings, one edit |
| `vite.config.ts:11` `build.manifest: true` is dead config | Delete it — unless the prerender step reads the manifest, in which case say so in a comment and keep it |
| `index.html` has no description, Open Graph, Twitter card, favicon or `theme-color` | This *is* the SEO/AEO/GEO/AIO requirement. One `<head>` block plus an SVG favicon in `public/`. Mind §4.3 (`theme-color` and the hex guard) and §4.4 (JSON-LD and the CSP) |
| `.table-scroll` is a pointer-only scroll region (WCAG 2.1.1) | `tabIndex={0}`, `role="region"`, `aria-labelledby` pointing at the section heading — on the comparison table **and on every new code block that scrolls horizontally**. A `role="region"` with no accessible name is itself an axe finding, so the label is not optional |
| `TopNav` marks no current section | `IntersectionObserver` setting `aria-current="true"`, or a `:target`-based form. Must behave under `prefers-reduced-motion: reduce` and must not introduce an inline style |
| `HeroSection.tsx:24` CTA accessible name ends with `→` | `<span aria-hidden="true">→</span>`, and update `landing.test.tsx`'s assertion (test #2) to the arrowless name |
| `landing.css` clamp minimums (`2rem`, `1.75rem`, `1.2rem + 4vw`, `1.3rem + 2.5vw`) are recorded nowhere | Record the fluid floors in `DESIGN.md` as prose under the typography section. Prose only — `parseDesignTokens` reads `colors`, `typography`, `rounded`, `spacing`, `components` from the front matter, so a new front-matter key would change `toCss`/`toTs` output and force a token regeneration for no benefit |
| `base.css:11` `color-scheme: light` with no dark pairing and no recorded decision | Record the decision in `DESIGN.md` — one paragraph, same place as the clamp floors |
| `wrangler.jsonc` has no `not_found_handling`, so a mistyped path returns a null-body 404 | Add `public/404.html` and `"not_found_handling": "404-page"`. Keep the file comment-free JSON (test #20/#21 parse it with `JSON.parse`). `404.html` is scanned by the hex guard — no hex in it |
| `_headers:11-12` marks un-hashed `/fonts/*` `immutable` | Drop `immutable` from the `/fonts/*` block (keep it on `/assets/*`, which Vite does content-hash) |
| `README.md:51` still says Cloudflare "Pages" | One-word fix to "Workers Static Assets" |
| `public/fonts/README.md` cites a git-ignored `.superpowers/…` path | Inline the two slice sizes, or add the caveat `docs/ROADMAP.md` already uses |

### Left open deliberately

| Item | Why |
|---|---|
| `_headers:5` `Permissions-Policy` — `display-capture=()` before Phase 7 proctoring | A product decision about the proctoring app, not about this page. Leave the header as it stands and leave the item open |
| Real-browser axe run and a 400px render | Needs Playwright — issue 33 |
| Live deployment and headers as actually served | Issue 135 |

---

## 4. Lint and type-check rules that will bite

**4.1 ESLint, after the issue-137 widening.** `eslint.config.js` today applies
`recommendedTypeChecked` to `**/src/**/*.ts` only — `apps/web/src` is nine `.tsx` files
and two `.ts` files, so almost none of the app is type-aware-linted. Widening to
`{ts,tsx}` (§3) turns these on over the new components:

- `@typescript-eslint/no-explicit-any` — already `error` **everywhere**, typed or not.
- `no-unsafe-assignment` / `-member-access` / `-call` / `-return` / `-argument` — anything
  flowing out of an untyped import or a `JSON.parse` must be typed at the boundary.
  Relevant if the on-page code samples are imported as JSON rather than written as
  template literals in a typed module.
- `no-floating-promises` and `no-misused-promises` — an `async` function passed as a React
  event handler or as an `IntersectionObserver` callback is an error. The nav
  current-section work in §3 is the likely site.
- `restrict-template-expressions` — template literals interpolating anything but a string.
  The existing `blob()`/`tree()` helpers are fine; a `${count}` is not.
- `require-await`, `await-thenable`, `no-unnecessary-type-assertion`, `unbound-method`.

`js.configs.recommended` applies to the `.mjs` build scripts too, with no Node globals
declared — which is why `scripts/tokens.mjs` imports `process` from `node:process`. Any
new `.mjs` script must do the same for `process`, `console` and friends.
Ignored paths: `**/dist/**`, `**/coverage/**`, `**/.turbo/**`. A prerender writing
anywhere else must produce lint-clean output or be added to `ignores`.

**4.2 TypeScript.** `tsconfig.base.json` is strict in ways that shape the code:

- `strict` and `noUncheckedIndexedAccess` — `arr[i]` is `T | undefined`. Map over arrays,
  never index them; the existing tests show the `?? ""` / `?? 0` dance this forces.
- `exactOptionalPropertyTypes` — `{ foo?: string }` will not accept `foo: undefined`.
- `erasableSyntaxOnly` — no `enum`, no parameter properties, no `namespace`. Use `as const`
  object literals, as `tokens.ts` does.
- `isolatedModules` — type-only imports must be written `import type`.
- `module: NodeNext` at the base, overridden to `ESNext` + `moduleResolution: Bundler`
  in `apps/web/tsconfig.json`.

**4.3 `apps/web/tsconfig.json` includes `["src", "test", "vite.config.ts"]` and nothing
else.** A prerender script at `apps/web/scripts/prerender.ts` would be neither
type-checked nor type-aware-linted, and `projectService: true` would have no project for
it. Two clean options: write it as `scripts/prerender.mjs` at the repo root alongside
`tokens.mjs` (no type-checking, consistent with the existing build scripts, covered by
the root `scripts` vitest project), or put it under `apps/web/src` and add it to the
`include`. Either way it must not become reachable from `main.tsx`, or `react-dom/server`
lands in the client bundle.

**4.4 Two collisions between the SEO work and the existing guards.** Both are real; the
spec must pick a resolution rather than discover them in CI.

- **`<meta name="theme-color" content="#e24c18">` fails the hex guard** (test #24 scans
  `index.html`). `content` cannot take a `var()`. Resolve by having the prerender step
  inject `theme-color` into `dist/index.html` from `tokens.ts` — the source `index.html`
  stays hex-free, the shipped one carries the colour, and the value cannot drift from
  `DESIGN.md`. (The alternative — adding `index.html` to `EXCLUDED_FILENAMES` — removes a
  guard the page actually needs, so prefer injection.)
- **Inline `<script type="application/ld+json">` meets `script-src 'self'`.** JSON-LD is
  the standard carrier for AEO/GEO structured data, and the CSP has no `'unsafe-inline'`
  and cannot gain one (test #19). Two routes that keep both: (a) have the prerender
  compute the block's SHA-256 and write `'sha256-…'` into the `script-src` of
  `dist/_headers` — allowed, since test #19 only forbids `'unsafe-inline'`, `'unsafe-eval'`
  and `https?://`, and a base64 hash contains neither; or (b) drop JSON-LD and carry the
  structured data as microdata/RDFa attributes on the existing markup, which needs no
  script and no CSP change. (b) is the smaller diff; (a) is what answer engines read most
  reliably. Decide once, in the spec.

**4.5 Prerender mechanics that touch the guards.** `main.tsx` currently calls
`createRoot(container).render(...)` unconditionally. Against prerendered markup that
throws away the server HTML and re-renders. Switch to `hydrateRoot` when `#root` already
has children, `createRoot` when it does not (so `pnpm dev` still works). The prerender
must write into **`dist/index.html` after the build**, never into the source
`index.html` — tests #7 and #24 read the source file.

---

## 5. The commands that must pass, exactly as CI runs them

From `.github/workflows/ci.yml`. Node 22, `corepack enable`, pnpm 10.18.0.

**Job `schemas` — "Validate schemas and examples".** Only matters if the rebuild adds or
edits anything under `examples/`. The on-page JSON samples should be lifted from
`examples/reasoning-aptitude` precisely so they are already covered by this job.

```
npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/bank-1.json -r schemas/question-1.json -d "examples/*/questions.json"

npx -y -p ajv-cli@5.0.0 -p ajv-formats@2.1.1 ajv validate --spec=draft2020 --strict=false -c ajv-formats \
  -s schemas/test-1.json -d "examples/*/test.json"
```

**Job `build` — "Lint, type-check, build and test", in order:**

```
corepack enable
pnpm install --frozen-lockfile
pnpm lint         # turbo run lint      -> eslint . in each package
pnpm typecheck    # turbo run typecheck -> tsc -p tsconfig.json --noEmit
pnpm build        # pnpm tokens && turbo run build -> node scripts/tokens.mjs, then vite build
pnpm test         # turbo run test && pnpm vitest run scripts
pnpm --filter @pariksha/core exec vitest run --coverage.enabled --coverage.provider=v8 \
  --coverage.include="src/**" --coverage.reporter=text \
  --coverage.thresholds.statements=98 --coverage.thresholds.branches=94 \
  --coverage.thresholds.functions=100 --coverage.thresholds.lines=98
```

Notes that change how the rebuild is done:

- `pnpm install --frozen-lockfile` fails on an out-of-date `pnpm-lock.yaml`. **Prefer
  adding no dependency**: `react-dom/server` is already available through `react-dom`, so
  prerendering needs nothing new. If a dependency is genuinely unavoidable, the lockfile
  change is part of the same commit.
- `pnpm build` regenerates the token files before building. Run it locally and check
  `git status` — a dirty `tokens.css`/`tokens.ts` means test #33 would have caught a
  hand-edit.
- `pnpm test` is two invocations. `turbo run test` runs `vitest run` inside each package
  (`apps/web` and `packages/*`); `pnpm vitest run scripts` covers `scripts/`, which is not
  a workspace package. A change to `scripts/tokens.mjs` is only exercised by the second.
- Root `vitest.config.ts` declares `projects: ["apps/*", "packages/*", "scripts"]`, so
  `npx vitest run` from the repo root covers everything in one go — useful locally, not
  what CI does.

**Local loops while working.**

```
pnpm --filter @pariksha/web exec vitest run                    # the seven apps/web test files
pnpm --filter @pariksha/web exec vitest run test/landing.test.tsx
pnpm --filter @pariksha/web exec vitest run test/contrast-usage.test.ts
pnpm vitest run scripts                                        # tokens + deploy-workflow guards
pnpm tokens                                                    # after any DESIGN.md edit
```

**Job `deploy` in `.github/workflows/deploy-web.yml`** runs the same
lint → typecheck → build → test sequence, then checks the Cloudflare secrets and runs
`pnpm --filter @pariksha/web exec wrangler deploy`. It is gated on
`vars.DEPLOY_WEB == 'true'` and on the repository being `SriSatyaLokesh/pariksha`, so it
does not run today. If the rebuild adds a build step to this workflow, test #38 requires
`pnpm test` to stay before `wrangler deploy`, and test #37 requires any secret to arrive
through `env:` rather than being interpolated into a `run:` body.

---

## 6. Fix-first findings this branch closes (the documents)

Two adversarial reviews on 2026-10-17 returned fix-first against the built page and the design
contract. The items below are contract and repository defects rather than page defects — none maps
to an issue-137 line item (issue 137 is the CSS/lint/accessibility backlog closed by the page
rebuild itself, §3 above); these are separate findings from the taste/SEO/accuracy review pass on
this document and `README.md`. Recorded here so the pull request can cite them precisely.

| Finding | Closed by |
| --- | --- |
| D1 — v0.1 scope contradiction: `README.md:156` claimed six question types in v0.1, when `docs/ROADMAP.md` (authoritative on phasing) puts all twelve, the test builder and the candidate runtime in v0.1 | `README.md`'s roadmap table corrected, plus a pointer to `docs/ROADMAP.md` as authoritative; the design contract's §3 S5 lead line, `TWELVE TYPES` cell and explanatory paragraph corrected to match, with a dated §14 line |
| README/page comparison-table drift: `README.md`'s own table repeated the pre-correction wording the page's S4 table had already moved away from | `README.md`'s Cost and Rich-question-types rows brought into line with the page's (D2-compliant) wording |
| D2 — uncited competitor-capability claims: "Multiple choice and free text", "Microsoft Forms offers none of those either", "twelve question types rather than a form's handful" | §3 S4's free-form-tools cell and §3 S10's Q10/Q11 guidance amended in the contract to bar these phrasings and require a dated qualifier on any vendor-naming sentence; `README.md`'s mirrored table cell corrected the same way |
| D3 — P10's wording contradicted the kept hero-bleed implementation (negative margin inside an overflow-clipped section, guarded by `min()`) | P10 reworded in both the S1 narrative and the acceptance table to "no negative margin outside an overflow-clipped section"; implementation untouched |
| D4 — T23 forced a manufactured 40–60-word paragraph under non-question headings, which is why the footer carried a visually-hidden paragraph that existed only to pass the test | T23 amended to exempt the three allow-listed headings from the whole rule, not just the "ends in `?`" clause |
| §9.1 sourcing rule, checked against D2 | Already carries the external-source clause (added in revision 2); verified, left unchanged |
| `turbo.json` / `.github/workflows/ci.yml` / `.github/workflows/deploy-web.yml` SITE_URL handling | Verified already compliant — `turbo.json` declares `env: ["SITE_URL"]` on `build`; `ci.yml`'s Build step passes a value with no production-path default (the non-serving placeholder the test suite itself uses); `deploy-web.yml`'s Build step passes `vars.SITE_URL` with no fallback. No edit made |
| `apps/web/README.md`'s SITE_URL paragraph | Verified already accurate — it attributes the value to the environment, `turbo.json` and the deploy workflow, and does not claim `package.json`'s build script passes it explicitly. No edit made |
