# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Design tokens generated from `DESIGN.md`'s front matter by `scripts/tokens.mjs` into committed `tokens.css` and `tokens.ts`, including a `contrastPairs` export of every ratio the design system states. The build regenerates them and the test suite fails if the committed files are stale or if a hex colour literal appears anywhere in `apps/web/src`.
- `apps/web` — a Vite + React application with the candidate and admin bundles split from the first commit, the design-system components `DESIGN.md` names, and the public landing page. Fonts (Anek Latin, Anek Telugu, Anek Devanagari, JetBrains Mono) are self-hosted, subset and SIL OFL, so the page makes no third-party request. Candidate bundle 75.7 KB gzipped against a 300 KB budget.
- A contrast test that reads each selector's real `color` and `font-size` declarations out of the stylesheet and asserts the computed WCAG ratio clears its threshold, because axe under jsdom cannot evaluate contrast at all.
- Cloudflare hosting for the web app on Workers Static Assets, with a strict `default-src 'self'` Content-Security-Policy, immutable caching for hashed assets and fonts, and a deploy workflow that runs only on the upstream repository.
- Product requirements document (`docs/PRD.md`) with Mermaid diagrams and PNG exports.
- Open question format `pariksha/question@1` and bank format `pariksha/bank@1`, with JSON Schemas and a written spec.
- Open test format `pariksha/test@1` — timing, access, registration form, proctoring, scoring, sections and release — with `schemas/test-1.json` and `docs/test-format.md`.
- Worked example `examples/reasoning-aptitude/`: a complete 45-minute test with 17 questions covering all 12 types, a registration form using every field type, a candidate list, a results CSV, and a walkthrough of every screen.
- Question-set example `examples/technical-screening/` (SQL, Python, AI basics), one question per type.
- `DESIGN.md` — the design system as machine-readable tokens plus the reasoning: 20 colours with measured contrast ratios, 13 type tokens, 43 components spanning marketing surfaces, the registration form, the test runner and the admin tables, a high-contrast mode, and motion rules that keep a live attempt still.
- `CONTRIBUTORS.md`, recognising every kind of contribution, not only commits.
- Repository scaffolding: contribution guide, code of conduct, security policy, maintainers list, issue and pull-request templates, Dependabot, and CI that validates every schema and example.

### Changed

- `docs/PRD.md` no longer lists ordering under partial credit. `ordering` is scored by `position` ("points × items in the right position ÷ items"), which already is partial credit for a sequence; `docs/question-format.md` and `APPLICABLE_MODES` always said so.
- `docs/PRD.md` T-10 no longer promises section shuffling. Nothing expressed it — there is no `shuffle_sections` field — and per-section time limits (T-12) and `per_section` navigation (T-13) both assume a stable section order. Shuffling questions within a section stays.
- `DESIGN.md` gains a `hero-lead` typography token (24px). Cream on the voltage canvas measures 3.86:1, which WCAG AA permits only at 24px and above, so the hero's lead sentence has a size floor rather than a tint exception.
- Licence is **Apache-2.0**, replacing the proposed AGPL-3.0. Reasoning recorded in `docs/adr/0003-license-apache-2-0.md`. Documentation, schemas and examples remain CC BY 4.0.
- `examples/` is organised one folder per subject, each holding its own questions, test and README, replacing the single `examples/banks/` directory.
