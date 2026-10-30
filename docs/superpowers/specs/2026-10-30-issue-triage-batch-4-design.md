# Issue Triage Batch 4 Design Spec (#102, #200)

**Date:** 2026-10-30  
**Authors:** Antigravity & Satya K  
**Scope:** Resolve and close Issue #102 (P8.14 Free-tier usage dashboard) and Issue #200 (Spec §13 Icon consistency: replace raw Unicode glyphs with inline SVG Icon family).

---

## 1. Problem Statements & Architecture

### Issue #102: P8.14 Free-Tier Usage Dashboard
- **Problem Statement:** PRD risk table mitigation ensuring zero-bill invariant fails loudly rather than silently with an amber warning at 70% of Cloudflare daily free limits.
- **Architecture & Prior Deliveries:**
  - Delivered initially in Phase 8e Task 3 (`apps/api/src/usage/project.ts`, `apps/web/src/components/organiser/UsagePanel.tsx`).
  - Restored and perfected in Batch 3 (#232): added migration 0016 composite indexes `(workspace_id, started_at/taken_at/server_ts)` for SQLite and Postgres, restored bounded `spentToday` computation in `usageRoute`, factored it into `warn = (projected + spentToday) / limit >= 0.70`, updated route budget to 6, and synchronized `UsagePanel` / `UsageProjection`.
- **Resolution:** Verify all API and web usage tests pass cleanly and formally close GitHub Issue #102 with full implementation and commit citations.

---

### Issue #200: Spec §13 Icon Consistency
- **Problem Statement:** Spec §13 of the design pass requires a single SVG icon family at 1.5 stroke in `currentColor` ("emoji/raw unicode are not icons"). However, 31+ raw Unicode glyphs (primarily `⚠` U+26A0 and `✓` U+2713) remain rendered as icons across 14+ component files in `apps/web/src`.
- **Architecture:**
  - `apps/web/src/components/OrganiserShell.tsx` already exports `ICONS: Record<string, string[]>` and `<Icon name={...} />`.
  - Add missing `check` path to `ICONS`:
    ```ts
    check: ["M4.6 10.4l3.8 3.8 7-7.6"],
    ```
    (and ensure `warn: ["M10 3.6 17.4 16.4H2.6Z", "M10 8.4v3.4", "M10 14h.01"]` is present and available).
  - Export `Icon` or import from `OrganiserShell` so any component can use `<Icon name="warn" />` and `<Icon name="check" />`.
  - Replace `<span aria-hidden="true">⚠</span>` and raw glyph spans across:
    - `TextField.tsx`
    - `Registration.tsx`
    - `ResultView.tsx`
    - `AccessPanel.tsx`
    - `BrandingPanel.tsx`
    - `FormBuilder.tsx`
    - `QuestionPickerDrawer.tsx`
    - `RegistrationForm.tsx`
    - `ReleasePanel.tsx`
    - `SectionList.tsx`
    - `TimingPanel.tsx`
    - `ApiKeyPanel.tsx`
    - `WebhookPanel.tsx`
    - `TeamsPanel.tsx`
    - `CollaboratorsDrawer.tsx`
    - `ByokSettings.tsx`
  - Add an automated guard test `apps/web/test/icon-glyphs.test.ts` scanning `apps/web/src` for raw Unicode icon glyphs in JSX elements (`<span aria-hidden="true">⚠</span>`), preventing regressions.

---

## 2. Verification Plan

1. **#102 Verification:**
   - `pnpm --filter @pariksha/api exec vitest run test/usage/project.test.ts`
   - `pnpm --filter @pariksha/web test test/organiser/usage.test.tsx`
2. **#200 Verification:**
   - `pnpm --filter @pariksha/web test test/icon-glyphs.test.ts`
   - `pnpm --filter @pariksha/web test` (full web suite)
   - `pnpm typecheck`
