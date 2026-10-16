# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Product requirements document (`docs/PRD.md`) with Mermaid diagrams and PNG exports.
- Open question format `pariksha/question@1` and bank format `pariksha/bank@1`, with JSON Schemas and a written spec.
- Open test format `pariksha/test@1` — timing, access, registration form, proctoring, scoring, sections and release — with `schemas/test-1.json` and `docs/test-format.md`.
- Worked example `examples/reasoning-aptitude/`: a complete 45-minute test with 17 questions covering all 12 types, a registration form using every field type, a candidate list, a results CSV, and a walkthrough of every screen.
- Question-set example `examples/technical-screening/` (SQL, Python, AI basics), one question per type.
- `CONTRIBUTORS.md`, recognising every kind of contribution, not only commits.
- Repository scaffolding: contribution guide, code of conduct, security policy, maintainers list, issue and pull-request templates, Dependabot, and CI that validates every schema and example.

### Changed

- Licence is **Apache-2.0**, replacing the proposed AGPL-3.0. Reasoning recorded in `docs/adr/0003-license-apache-2-0.md`. Documentation, schemas and examples remain CC BY 4.0.
- `examples/` is organised one folder per subject, each holding its own questions, test and README, replacing the single `examples/banks/` directory.
