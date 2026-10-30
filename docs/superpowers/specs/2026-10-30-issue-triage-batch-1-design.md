# Batch 1 Open Issues Resolution Design Document

**Milestone:** Issue Triage & Quality Hardening — Batch 1  
**Target Issues:** [#84](https://github.com/SriSatyaLokesh/pariksha/issues/84), [#185](https://github.com/SriSatyaLokesh/pariksha/issues/185), [#174](https://github.com/SriSatyaLokesh/pariksha/issues/174), [#228](https://github.com/SriSatyaLokesh/pariksha/issues/228)  
**Date:** 2026-10-30  
**Status:** Under Review  
**Applied Skills:** `ponytail` (minimal shortest diffs, no unnecessary churn), `senior-backend` (auth/OIDC discovery contract correctness), `senior-fullstack` (web test suite resilience).

---

## 1. Intent & Context

The Pariksha project currently tracks 17 open issues across bug fixes, architectural debt, and features. To systematically burn down the backlog, Batch 1 targets high-leverage quick wins and verified completed items:
1. **#84 (P7.8 On-device face counting):** Native on-device face counting via the browser Shape Detection API (`window.FaceDetector`) was completed in commit `abac16a` on `feat/byok-audio-model-and-face-counting`.
2. **#185 (Post-Phase 6 Retrospective):** A point-in-time handoff document from 2026-10-20; all work items have been spun off into distinct tracked tickets.
3. **#174 (GitHub OIDC Documentation Defect):** GitHub OAuth apps do not support OpenID Connect discovery (`/.well-known/openid-configuration`), making GitHub an invalid OIDC SSO provider in Pariksha's discovery-based auth model.
4. **#228 (Hand-rolled fakeClient Fixtures in Web Tests):** Consolidated shared fixture `apps/web/test/fixtures/api-client.ts` was already built and deployed in PR #242 / commit `15e45e9`, with all 124 test suites actively utilizing it.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Update `docs/PRD.md` and `docs/ROADMAP.md` to remove inaccurate claims of GitHub as a standard OIDC discovery provider (#174).
- Confirm verified passing evidence for on-device face counting tests (#84).
- Confirm test integrity for `fakeClient` fixture across all web tests (#228).
- Close #84, #185, #174, and #228 with audit notes.

### Non-Goals
- Do not refactor the 26 test files that wrap `sharedClient` with default fixtures—the shared fixture already insulates them from interface drift (Ponytail rung 1: YAGNI).
- Do not build custom GitHub OAuth 2.0 exchange pipelines (GitHub is not an OIDC provider).

### Anti-Goals
- Introducing any new npm dependencies.
- Modifying passing product code in `apps/` or `packages/`.

---

## 3. Approaches Considered

### Approach 1: Verification, Atomic Doc Fix & Closure Audit (Chosen)
- Make the exact 2-line correction across `docs/PRD.md` and `docs/ROADMAP.md`.
- Formally verify test suites for face counting and web client fixtures.
- Close the 4 issues on GitHub with explicit commit references.
- **Trade-off:** Minimal diff, zero risk of regressions, immediately clears 4 issues.

### Approach 2: Inline Fixture Flattening Sweep + Closures (Rejected)
- In addition to Approach 1, rewrite all 26 test files in `apps/web/test/` to delete `function fakeClient() { return sharedClient(...) }` delegators in favor of direct imports.
- **Reason for Rejection:** Violates Ponytail principles (26 files modified for zero semantic or functional gain).

### Approach 3: GitHub Triage Only (Rejected)
- Close #84, #185, and #228 while skipping #174.
- **Reason for Rejection:** Leaves known false documentation in the core PRD.

---

## 4. Detailed Changes

### Documentation Fix (#174)
- **`docs/PRD.md:132`**:
  - *Current:* `- **Single sign-on (OIDC):** Google, Microsoft, GitHub or any OIDC provider.`
  - *Updated:* `- **Single sign-on (OIDC):** Google, Microsoft, or any generic standard OIDC provider.`
- **`docs/ROADMAP.md:229`**:
  - *Current:* `| An OIDC client ID and secret (Google, Microsoft or GitHub) | Organiser sign-in | 3 |`
  - *Updated:* `| An OIDC client ID and secret (Google, Microsoft, or generic OIDC) | Organiser sign-in | 3 |`

### Verification & Closure Evidence
- **#84**: Execute `pnpm --filter @pariksha/web test test/exam/face-counting.test.ts`. Reference commit `abac16a` and PR #264.
- **#185**: Reference roadmap progression through Phases 7–12.
- **#228**: Reference commit `15e45e9` / PR #242, noting all 124 suites (3,006 tests) pass cleanly.
