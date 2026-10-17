# Phase 3 (part) — acceptance criteria and handover

Covers what shipped on branch `phase-3/design-tokens-and-landing` ([PR #136](https://github.com/SriSatyaLokesh/pariksha/pull/136)): design tokens (#31), the web shell and landing page (#32), and Cloudflare hosting (#135). Written so the next session — human or agent — can verify the work and pick up where it stopped without re-deriving any of it.

The plan this executes is [`2026-10-16-phase-3-auth-roles-and-landing.md`](2026-10-16-phase-3-auth-roles-and-landing.md), tasks 7 and 8, plus a hosting task added because the landing page is useless unpublished.

## Running it locally

```bash
pnpm install
pnpm --filter @pariksha/web dev --port 5178
```

- Landing page: <http://localhost:5178/>
- Admin placeholder: <http://localhost:5178/admin.html>

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # the full gate, from the repo root
pnpm --filter @pariksha/web exec wrangler deploy --dry-run   # hosting config, no credentials needed
```

## Acceptance criteria

Each line is a statement that is either true or false today. A failing line is a bug, not a preference.

### AC-L1 — Design tokens are generated, never typed

- [x] `pnpm tokens` regenerates `apps/web/src/styles/tokens.css` and `tokens.ts` from `DESIGN.md`'s front matter, and `git diff --exit-code apps/web/src/styles` is clean afterwards.
- [x] Editing a committed token file by hand and running `pnpm test` from the repo root fails.
- [x] A hex colour literal typed into any `.ts`, `.tsx`, `.css` or `.html` file under `apps/web/src` (outside the two generated files) fails `pnpm test`.
- [x] `contrastPairs` in `tokens.ts` carries every ratio `DESIGN.md`'s colour tables state, and each computed ratio matches the stated value.

### AC-L2 — The landing page says what the project is, truthfully

- [x] Every claim on the page is one `README.md` or `docs/PRD.md` already makes. No invented number, no feature that does not exist.
- [x] The page states plainly that the project is pre-alpha and that the application lands with v0.1.
- [x] Exactly one link has an accessible name matching `/start|deploy|try/i` — the hero call to action.
- [x] Every documentation link points at a path that exists on GitHub today.

### AC-L3 — The design system is obeyed, not approximated

- [x] The hero is the full-bleed voltage canvas: 96×24px padding, square corners, 56px display at weight 500 in cream, one lead sentence, one cream pill call to action.
- [x] At most one `card-voltage` on the page; shadows appear on the call to action only.
- [x] The radius tier is binary — no 12/16/20px value anywhere.
- [x] `hairline` and `hairline-strong` appear only as borders, never as a fill or a text colour.
- [x] `voltage` never appears as running text; only `voltage-deep` is legal in a sentence.

### AC-L4 — Accessibility is verified, not asserted

- [x] Zero axe violations on the rendered landing page.
- [x] One `h1`, no skipped heading level, a skip-to-content link, `lang="en"`, a visible focus style on every interactive element.
- [x] Every text/surface pair on the page clears its WCAG threshold — 3:1 at 24px and above, 4.5:1 below — checked by `apps/web/test/contrast-usage.test.ts`, which reads each selector's real `color` and `font-size` declarations out of the stylesheet rather than trusting a hand-written table.
- [x] All motion is wrapped in `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Not yet verified:** a real-browser axe run. jsdom cannot evaluate contrast or layout, so the colour-blindness of the jsdom gate is covered by AC-L4's stylesheet test, and everything layout-dependent is unverified until Task 9 adds Playwright. The surface (background) each selector sits on is still hand-declared in that test — a wrong surface that happens to clear the threshold anyway would pass.
- [ ] **Not yet verified:** rendering at 400px width in a real browser. The responsive rules were read, not seen; two attempts to screenshot the page failed on this machine (the wmux pane produced no frame, chrome-devtools timed out).

### AC-L5 — No third party, ever

- [x] No `http://` or `https://` origin is fetched by the built page. The only absolute URLs in `dist/` are link targets, SVG namespaces and React's error-decoder string.
- [x] All four font faces are self-hosted WOFF2 under `/fonts/`, with their SIL OFL licences and a README recording each file's source, version and subset.
- [x] The candidate bundle is under 300 KB gzipped (currently 75.7 KB).

### AC-L6 — Hosting is free and locked down

**Deferred to a later session, still wanted.** Publishing the site is not this session's work, so nothing below blocks this branch from merging. The configuration is committed and its checks pass; its task review was stopped part-way when the session ran short, so treat the hosting files as unreviewed and finish that review in the session that publishes the site.

- [x] `apps/web/wrangler.jsonc` declares `assets.directory` and no `main`, so no Worker script runs and no request counts against the free plan's 100,000/day.
- [x] `wrangler deploy --dry-run` succeeds with no Cloudflare credentials present.
- [x] `_headers` reaches `dist/` on build and carries `default-src 'self'` with no `'unsafe-inline'` and no `'unsafe-eval'`.
- [x] The deploy workflow never runs on a fork and fails readably when the account secrets are absent.
- [ ] **Not verified — a later session's work:** a real deployment. Nobody has run `wrangler deploy` against a Cloudflare account, so the live URL, the headers as actually served and the workflow's end-to-end behaviour are all untested.

## What the next session should do, in order

1. **Review the whole branch.** The whole-branch review never ran, and the hosting task's review was stopped part-way when that session ran short, so `apps/web/wrangler.jsonc`, `apps/web/public/_headers`, `apps/web/test/hosting.test.ts` and `.github/workflows/deploy-web.yml` have had no review at all. Findings from the reviews that did run are in the ledger at `.superpowers/sdd/2026-10-16-phase-3-auth-roles-and-landing/progress.md` on the machine that ran them; that directory is git-ignored, so if it is gone, re-review rather than assume.
2. **Take PR #136 out of draft** once 1 is clean, and squash-merge it. Publishing the site is not a prerequisite for merging — it is simply a later session's work, and the configuration costs nothing sitting unused until then.
3. **Then Phase 2** ([#15](https://github.com/SriSatyaLokesh/pariksha/issues/15) and its tasks). Everything else in Phase 3 — sign-in, sessions, OIDC, magic link, the permission middleware, the first-run wizard, the dashboard screens — consumes `/api/v1/*` and cannot start before it. Do not attempt Task 9 of the Phase 3 plan first; it will stall.

### Publishing the site — a later session

`pnpm --filter @pariksha/web exec wrangler login`, then `pnpm --filter @pariksha/web deploy`. Then check the live URL against AC-L6: the CSP as served, the fonts loading from `/fonts/`, no console error, and the page rendered at 400px and at 1440px. Put the URL in `deploy/cloudflare/README.md` and in the repository's About field. Review the four hosting files first — they have not been.

## Known deferrals, recorded so they are not rediscovered as bugs

- The "present but empty `apps/web/src`" case has no dedicated test in the token generator's suite (the missing-directory case does).
- `button-secondary`'s `10px 14px` padding is `DESIGN.md`'s literal component spec and reaches the component through the generated tokens; it is not a magic pair, and a reviewer's finding to that effect was declined.
- A Prettier pass reformatted `DESIGN.md` alongside the `hero-lead` token addition — YAML quote style and Markdown table padding only. A word-level diff confirmed no colour, size, weight, line-height, letter-spacing, radius or spacing value changed.
- `admin.html` renders a placeholder shell. There is no router, by decision: one public route does not need one, and Task 9 introduces routing when it has routes to route.
