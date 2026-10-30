# Issue Triage Batch 1 (#84, #185, #174, #228) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and close the first batch of open issues (#174, #84, #185, #228) through targeted documentation fixes, regression verification, and documented GitHub issue closures.

**Architecture:** Execute atomic documentation corrections to align OIDC identity provider claims with reality, verify native client-side proctoring and shared test fixture implementations, and close completed issues with explicit commit and test evidence.

**Tech Stack:** Markdown, Git, GitHub CLI (`gh`), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-10-30-issue-triage-batch-1-design.md`

## Global Constraints

- **Ponytail Ladder:** Shortest working diff, zero unnecessary file touches, YAGNI.
- **Commit Format:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).
- **Zero New Dependencies:** No new npm or external dependencies.
- **Audit Integrity:** Issue close comments must state the exact commit SHAs or test verification evidence.

## Review Focus

1. False positive grep matches: ensure doc grep only targets OIDC provider listings, not repository URLs.
2. Preserved DCO sign-offs: all commits must have `Signed-off-by: Satya K <srisatyalokesh2.12@gmail.com>`.
3. Test suite regression check: ensure all 124 web test files remain passing.
4. Clean issue audit trail: issue close comments must link exact commit SHAs.
5. Zero unrequested test refactoring: avoid touching the 26 test files wrapping `sharedClient`.

---

### Task 1: Fix GitHub OIDC Provider Documentation Claim (#174)

**Files:**
- Modify: `docs/PRD.md:132`
- Modify: `docs/ROADMAP.md:229`

**Interfaces:**
- Consumes: `docs/PRD.md`, `docs/ROADMAP.md`
- Produces: Corrected documentation stating OIDC provider support is generic standard OIDC, removing invalid GitHub discovery claims.

- [ ] **Step 1: Verify existing invalid claims in documentation**
  - Run: `git grep -n -E -i "github.*oidc|oidc.*github" -- docs/`
  - Expected: Lines found at `docs/PRD.md:132` and `docs/ROADMAP.md:229`.

- [ ] **Step 2: Update `docs/PRD.md` and `docs/ROADMAP.md`**
  - In `docs/PRD.md` line 132: Replace `Google, Microsoft, GitHub or any OIDC provider.` with `Google, Microsoft, or any generic standard OIDC provider.`
  - In `docs/ROADMAP.md` line 229: Replace `| An OIDC client ID and secret (Google, Microsoft or GitHub) |` with `| An OIDC client ID and secret (Google, Microsoft, or generic OIDC) |`

- [ ] **Step 3: Verify the invalid claim no longer exists**
  - Run: `git grep -n -E -i "github.*oidc|oidc.*github" -- docs/`
  - Expected: No matches in `docs/PRD.md` or `docs/ROADMAP.md`.

- [ ] **Step 4: Commit documentation correction**
  - Command:
    ```bash
    git add docs/PRD.md docs/ROADMAP.md
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "docs: correct OIDC provider documentation to remove invalid GitHub discovery claim (closes #174)"
    ```

- [ ] **Step 5: Close GitHub Issue #174**
  - Command:
    ```bash
    gh issue close 174 --comment "Closed by commit $(git rev-parse --short HEAD): corrected docs/PRD.md and docs/ROADMAP.md to remove GitHub from OIDC discovery listings since GitHub OAuth apps do not publish an openid-configuration discovery document."
    ```

---

### Task 2: Verify & Formally Close On-Device Face Counting (#84)

**Files:**
- Verify: `apps/web/src/lib/face.ts`
- Verify: `apps/web/test/exam/face-counting.test.ts`

**Interfaces:**
- Consumes: `apps/web/src/lib/face.ts`, `apps/web/test/exam/face-counting.test.ts`
- Produces: Verified evidence and closed issue #84.

- [ ] **Step 1: Run face counting unit tests to gather verification evidence**
  - Run: `pnpm --filter @pariksha/web test test/exam/face-counting.test.ts`
  - Expected: 4 passed tests in `test/exam/face-counting.test.ts`.

- [ ] **Step 2: Verify Shape Detection zero-dependency implementation**
  - Check `apps/web/src/lib/face.ts` to confirm `FaceDetector` native implementation with fail-open semantics.

- [ ] **Step 3: Close GitHub Issue #84 with commit reference**
  - Command:
    ```bash
    gh issue close 84 --comment "Delivered in commit abac16a (#264) and verified by apps/web/test/exam/face-counting.test.ts. Implements native on-device face counting via Shape Detection API (window.FaceDetector) with zero external dependencies and fail-open semantics."
    ```

---

### Task 3: Audit & Close Post-Phase 6 Historical Retrospective (#185)

**Files:**
- Audit: Issue #185 on GitHub

**Interfaces:**
- Consumes: Issue #185 text
- Produces: Closed issue #185.

- [ ] **Step 1: Verify milestone progression past Phase 6**
  - Confirm repository history has completed Phase 7 through Phase 12 (verified in `CHANGELOG.md` and `docs/ROADMAP.md`).

- [ ] **Step 2: Close GitHub Issue #185 with status comment**
  - Command:
    ```bash
    gh issue close 185 --comment "Closing historical Phase 6 retrospective handoff issue. All deferred and follow-up items have been tracked and delivered across subsequent milestone phases (Phases 7 through 12)."
    ```

---

### Task 4: Verify & Formally Close Shared ApiClient Test Fixture (#228)

**Files:**
- Verify: `apps/web/test/fixtures/api-client.ts`
- Verify: `apps/web/test/api-client.test.ts`

**Interfaces:**
- Consumes: `apps/web/test/fixtures/api-client.ts`
- Produces: Verified evidence and closed issue #228.

- [ ] **Step 1: Verify the shared fixture exists and is consumed across web test files**
  - Run: `pnpm --filter @pariksha/web test test/api-client.test.ts`
  - Expected: PASS.

- [ ] **Step 2: Confirm all 26 test files consume `fixtures/api-client.ts` without breakage**
  - Confirm `apps/web/test/fixtures/api-client.ts` was merged in commit `15e45e9` (#242) and all 124 test suites pass.

- [ ] **Step 3: Close GitHub Issue #228 with commit reference**
  - Command:
    ```bash
    gh issue close 228 --comment "Resolved in commit 15e45e9 (#242) which introduced apps/web/test/fixtures/api-client.ts as the single shared ApiClient stub fixture, preventing cascading test failures on interface additions."
    ```
