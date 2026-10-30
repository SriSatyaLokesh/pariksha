# Batch 3 Issue Triage & Background Job Performance Design Document

**Milestone:** Issue Triage & Quality Hardening — Batch 3  
**Target Issues:** [#183](https://github.com/SriSatyaLokesh/pariksha/issues/183), [#231](https://github.com/SriSatyaLokesh/pariksha/issues/231), [#226](https://github.com/SriSatyaLokesh/pariksha/issues/226), [#232](https://github.com/SriSatyaLokesh/pariksha/issues/232)  
**Date:** 2026-10-30  
**Status:** Under Review  
**Applied Skills:** `ponytail` (minimal shortest diffs, sentinel retirement over complex schema), `senior-backend` (multi-tenant queue isolation, index range optimization), `senior-fullstack` (API and web usage projection synchronization).

---

## 1. Intent & Context

Batch 3 tackles background job performance, multi-tenant queue fairness, routing behavioral verification, and resource usage metering:
1. **#183 (Config guarded by its own text, not its behaviour):** Phase 6's fragile text-matching tests failed to detect that Cloudflare dropped `_redirects` self-rewrites. A comprehensive Miniflare behavioral test suite in `apps/api/test/worker.test.ts:348-447` has replaced this. Needs formal audit verification and issue closure.
2. **#231 (Paused webhook backlog stays in the drain's index range):** Pausing a webhook leaves pending deliveries in the `next_attempt_at <= now` range, causing recurring full index scans (5.28 ms vs 0.55 ms). Retiring paused rows to a `PAUSED_SENTINEL` (`Number.MAX_SAFE_INTEGER - 1`) on pause and restoring them on resume cleanly removes them from the drain's scan range without deleting backlogs or needing complex schema.
3. **#226 (Nightly retention sweep starvation across workspaces):** `sweepSnapshots` in `apps/api/src/retention/sweep.ts` performs a global `ORDER BY sn.taken_at ASC LIMIT 500` with a JS filter, allowing a single workspace with a long retention override (e.g. 365 days) to monopolize the batch and permanently starve other workspaces. Pushing the per-row retention cutoff into SQL ensures only genuinely due rows are selected, and adding index `(workspace_id, taken_at)` ensures efficient execution.
4. **#232 (Free-tier meter's warn no longer accounts for spend already incurred today):** `spentToday` was temporarily removed in Phase 8e because unindexed queries scanned every historical row. With composite indexes on `(workspace_id, started_at)`, `(workspace_id, taken_at)`, and `(workspace_id, server_ts)` added in migration `0016`, bounded `spentToday` is restored cheaply, allowing `warn` to accurately reflect both today's incurred spend and forward projection.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Verify behavioral router test coverage in `worker.test.ts` and close #183.
- Implement pause/resume sentinel retirement in `setWebhookActive` (`packages/db/src/repo/webhooks.ts`), excluding paused rows from the drain index range (#231).
- Push snapshot retention cutoff into SQL in `apps/api/src/retention/sweep.ts`, preventing unexpired rows from filling the batch (#226).
- Create migration `0016_retention_and_usage_indexes.sql` across SQLite and Postgres dialects for composite timestamp indexes.
- Restore bounded `spentToday` in `apps/api/src/usage/project.ts` and update `warn` calculation to `(projected + spentToday) / limit >= WARN_AT` (#232).

### Non-Goals
- Do not purge or drop backlogs permanently when pausing webhooks (preserves delivery retry guarantees on resume).
- Do not run unindexed unbounded table scans on Home screen mount.

### Anti-Goals
- Introducing any new external dependencies or breaking existing migrations 0000–0015.

---

## 3. Detailed Technical Strategy

### 1. #183 Behavioral Router Verification
- Audit assertions in `apps/api/test/worker.test.ts:348-447` testing 2-segment candidate URLs, assets, fonts, and 404 fallbacks against Miniflare.
- Close GitHub Issue #183.

### 2. #231 Webhook Pause Range Retirement
- In `packages/db/src/repo/webhooks.ts`:
  - Define `PAUSED_SENTINEL = Number.MAX_SAFE_INTEGER - 1`.
  - In `setWebhookActive(db, workspaceId, webhookId, active)`:
    - If `active === false`:
      ```sql
      UPDATE webhook_delivery SET next_attempt_at = ?
      WHERE workspace_id = ? AND webhook_id = ? AND delivered_at IS NULL AND next_attempt_at < ?
      ```
    - If `active === true`:
      ```sql
      UPDATE webhook_delivery SET next_attempt_at = ?
      WHERE workspace_id = ? AND webhook_id = ? AND delivered_at IS NULL AND next_attempt_at = ?
      ```
  - Test in `packages/db/test/repo/webhooks.test.ts` and `apps/api/test/webhooks/drain.test.ts`.

### 3. #226 SQL Cutoff for Retention Sweep
- In `apps/api/src/retention/sweep.ts`:
  - Update `sweepSnapshots`:
    ```sql
    SELECT sn.id AS id, sn.workspace_id AS workspace_id, sn.taken_at AS at, sn.storage_key AS storage_key,
           tv.settings_json AS settings_json
    FROM snapshot sn
    JOIN attempt a ON a.id = sn.attempt_id
    JOIN test_version tv ON tv.id = a.test_version_id
    WHERE sn.taken_at <= ? - COALESCE(${daysExtract}, ?) * ${DAY_MS}
    ORDER BY sn.taken_at ASC LIMIT ?
    ```
  - Add test in `apps/api/test/retention/sweep.test.ts` with two workspaces: Workspace A with 500 rows under 365-day retention, Workspace B with rows under 30-day retention; verify Workspace B is swept.

### 4. #232 Composite Indexes & Usage Spent Today
- Migration `0016_retention_and_usage_indexes.sql`:
  - `snapshot(workspace_id, taken_at)`
  - `attempt(workspace_id, started_at)`
  - `event(workspace_id, server_ts)`
- In `apps/api/src/usage/project.ts`:
  - Query today's incurred spend bounded by `startOfDay`:
    ```sql
    SELECT
      (SELECT COUNT(*) FROM attempt WHERE workspace_id = ? AND started_at >= ?) * 50 +
      (SELECT COUNT(*) FROM snapshot WHERE workspace_id = ? AND taken_at >= ?) * 1 +
      (SELECT COUNT(*) FROM event WHERE workspace_id = ? AND server_ts >= ?) * 1 AS spent
    ```
  - Include `spentToday` in `UsageProjection` and compute `warn: ((projected + spentToday) / limit) >= WARN_AT`.
- Update `UsagePanel.tsx` in `apps/web` and update tests.
