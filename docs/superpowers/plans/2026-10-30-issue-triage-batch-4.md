# Issue Triage Batch 4 (#102, #200) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and close Issue #102 (Free-tier usage dashboard) and Issue #200 (Spec §13 iconography consistency: replace raw Unicode glyphs with SVG Icon family).

**Architecture:** Verify and close #102 against established API and Web test suites; update `ICONS` in `OrganiserShell.tsx` to include `check`, replace raw glyphs across component files with `<Icon name="warn" />` and `<Icon name="check" />`, and create an AST/regex scanner test `apps/web/test/icon-glyphs.test.ts` to prevent regressions.

**Tech Stack:** TypeScript, React, Vitest, Git, GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-10-30-issue-triage-batch-4-design.md`

## Global Constraints

- **Ponytail Ladder:** Shortest working diffs, no extra packages or fonts, reuse existing `Icon` component.
- **Commit Format:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).
- **Zero New Dependencies:** No new npm or external dependencies.

---

### Task 1: Verify & Formally Close Free-Tier Usage Dashboard (#102)

**Files:**
- Verify: `apps/api/test/usage/project.test.ts`
- Verify: `apps/web/test/organiser/usage.test.tsx`
- Verify: `apps/api/src/usage/project.ts`
- Verify: `apps/web/src/components/organiser/UsagePanel.tsx`

**Interfaces:**
- Consumes: Usage routes and panels delivered in Phase 8e and Batch 3 (#232).
- Produces: Verified evidence and closed issue #102.

- [ ] **Step 1: Run API and Web usage tests**
  - Run: `pnpm --filter @pariksha/api exec vitest run test/usage/project.test.ts`
  - Run: `pnpm --filter @pariksha/web test test/organiser/usage.test.tsx`
  - Expected: All tests pass cleanly, verifying 70% threshold warning, bounded daily spend, and UI gesture.

- [ ] **Step 2: Close GitHub Issue #102**
  - Command:
    ```bash
    gh issue close 102 --comment "Resolved: P8.14 Free-tier usage dashboard is delivered and verified. Implemented in Phase 8e Task 3 (commit 26c54c0) and finalized in Batch 3 (commit c42502c, closes #232) with migration 0016 composite indexing, GET /api/v1/workspaces/:id/usage, and the UsagePanel on Home enforcing the 70% amber warning threshold."
    ```

---

### Task 2: Spec §13 Icon Consistency: Replace Raw Unicode Glyphs with SVG Icons (#200)

**Files:**
- Modify: `apps/web/src/components/OrganiserShell.tsx`
- Modify: `apps/web/src/components/TextField.tsx`
- Modify: `apps/web/src/components/exam/Registration.tsx`
- Modify: `apps/web/src/components/exam/ResultView.tsx`
- Modify: `apps/web/src/components/testbuilder/AccessPanel.tsx`
- Modify: `apps/web/src/components/testbuilder/BrandingPanel.tsx`
- Modify: `apps/web/src/components/testbuilder/FormBuilder.tsx`
- Modify: `apps/web/src/components/testbuilder/QuestionPickerDrawer.tsx`
- Modify: `apps/web/src/components/testbuilder/RegistrationForm.tsx`
- Modify: `apps/web/src/components/testbuilder/ReleasePanel.tsx`
- Modify: `apps/web/src/components/testbuilder/SectionList.tsx`
- Modify: `apps/web/src/components/testbuilder/TimingPanel.tsx`
- Modify: `apps/web/src/components/organiser/ApiKeyPanel.tsx`
- Modify: `apps/web/src/components/organiser/WebhookPanel.tsx`
- Modify: `apps/web/src/components/organiser/TeamsPanel.tsx`
- Modify: `apps/web/src/components/organiser/CollaboratorsDrawer.tsx`
- Modify: `apps/web/src/components/admin/ByokSettings.tsx`
- Create: `apps/web/test/icon-glyphs.test.ts`

**Interfaces:**
- Consumes: `ICONS`, `Icon` in `OrganiserShell.tsx`.
- Produces: Replaced glyphs with `<Icon name="..." />` and regression test.

- [ ] **Step 1: Write failing regression guard test in `apps/web/test/icon-glyphs.test.ts`**
  - Scan `apps/web/src` for `<span aria-hidden="true">[⚠✓]</span>` or raw glyphs rendered in JSX.
  - Run `pnpm --filter @pariksha/web test test/icon-glyphs.test.ts` -> Expected: FAIL.

- [ ] **Step 2: Add `check` to `ICONS` in `OrganiserShell.tsx`**
  - Add:
    ```ts
    check: ["M4.6 10.4l3.8 3.8 7-7.6"],
    ```

- [ ] **Step 3: Replace raw glyphs across components**
  - In `TextField.tsx`: replace `<span aria-hidden="true">⚠</span>` with `<Icon name="warn" />`.
  - In all listed testbuilder and organiser panels: replace `<span aria-hidden="true">⚠ </span>` with `<Icon name="warn" />` or similar.
  - In `Registration.tsx` and `ResultView.tsx`: replace with SVG icon.

- [ ] **Step 4: Run tests and verify clean pass**
  - Run: `pnpm --filter @pariksha/web test test/icon-glyphs.test.ts`
  - Run: `pnpm --filter @pariksha/web test`
  - Run: `pnpm --filter @pariksha/web typecheck`

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/web/
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "refactor(web): replace raw Unicode icon glyphs with SVG Icon family (closes #200)"
    ```

- [ ] **Step 6: Close GitHub Issue #200**
  - Command:
    ```bash
    gh issue close 200 --comment "Resolved in commit $(git rev-parse --short HEAD): replaced raw Unicode glyphs with SVG Icon family in accordance with Spec §13, and added regression test in apps/web/test/icon-glyphs.test.ts."
    ```
