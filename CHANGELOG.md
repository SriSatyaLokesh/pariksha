# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `validateTest` in `@pariksha/core` — cross-field import validation for `pariksha/test@1` documents, alongside the existing `validateBank`. It checks a test's `scoring.default_mode` against every question type its sections can draw (the mode most questions grade under, since a question's own `scoring` block is optional), a pool whose filter matches fewer questions than its `count`, sets of unequal total points, `release.when: "on_date"` without `at`, and `access.mode: "link_code"` without `access_code`. Line-by-line and all-or-nothing, like the bank importer. Closes #132.

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
- Grading memoises each `fill_blank` regex pattern by pattern string — both the `assertSafeRegex` verdict and the compiled `RegExp` — instead of re-parsing and recompiling it for every candidate, every blank and every attempt. The cache is a plain `Map` capped at 500 distinct patterns; past the cap nothing is evicted and nothing is cached, so an uncached pattern grades exactly as it did before.
- CI enforces test coverage on `packages/core/src` with `@vitest/coverage-v8` instead of the figure being re-measured by hand: 97% statements, 93% branches, 100% functions, 98% lines, each the measured value rounded down so the gate fails on a real drop rather than on rounding.

### Fixed

- A `short_answer` question can now score above zero. `rubric` is the only scoring mode applicable to it, and rubric scoring sums the levels a reviewer picks — but only `long_answer` declared a `rubric` field, so every `short_answer` scored 0 for every candidate and the type was inert ([#130](https://github.com/SriSatyaLokesh/pariksha/issues/130)). `short_answer` now takes the same **optional** `rubric` that `long_answer` takes, in `schemas/question-1.json` (as a shared `$defs/rubric` both types reference), in `docs/question-format.md`'s type table and in `@pariksha/core`'s `ShortAnswerQuestion`. The change is strictly additive — nothing is renamed, removed or made required — so it stays inside `pariksha/question@1` and every existing bank file keeps validating.
- The two worked `short_answer` examples (`WRI-001`, `GEN-002`) now carry a rubric, so they can be marked for the points they advertise.
- An `ordering` position the candidate never supplied no longer counts as a wrong part. A 1-of-3 ordering under `negative` scored −0.75 where the equivalent partial submission in `matching` (omitted left items) or `fill_blank` (unfilled blanks) scored 0; all three graders now answer "an unanswered part is not a wrong part" the same way.
- `assertSafeRegex` no longer rejects `(`, `?` and `=` as literal members of a character class — `[(?=]` was read as a lookahead. The lookaround check is now `inClass`-aware like the rest of the scanner.
