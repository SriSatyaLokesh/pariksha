# Issue Triage Batch 3 (#183, #231, #226, #232) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and close Batch 3 issues (#183, #231, #226, #232) by verifying behavioral routing against Miniflare, optimizing webhook pause queues, eliminating retention sweep starvation, and restoring accurate free-tier daily usage tracking with composite indexing.

**Architecture:** Use a pause sentinel in `setWebhookActive` to exclude paused deliveries from drain query scans without schema changes, push per-row retention cutoffs into SQL in `sweepSnapshots` to prevent multi-tenant starvation, introduce composite timestamp indexing in migration `0016`, and calculate bounded `spentToday` in `projectUsage`.

**Tech Stack:** TypeScript, SQLite, PostgreSQL, Cloudflare D1/Workers, Hono, Vitest, Git, GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-10-30-issue-triage-batch-3-design.md`

## Global Constraints

- **Ponytail Ladder:** Shortest working diffs, sentinel retirement over complex schema migrations, YAGNI.
- **Commit Format:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).
- **Zero New Dependencies:** No new npm or external dependencies.
- **Audit Integrity:** Issue close comments must state the exact commit SHAs or test verification evidence.

## Review Focus

1. Webhook pause retirement: ensure only pending rows (`next_attempt_at < PAUSED_SENTINEL`) are paused and give-ups (`NEVER_AGAIN`) remain untouched.
2. Webhook resume reactivation: ensure paused rows restore to `now` and immediately enter the drain's due range.
3. Retention fairness: ensure a workspace with a long retention override cannot block other workspaces with expired snapshots.
4. Meter cost safety: ensure `spentToday` queries use the composite index on `(workspace_id, timestamp)` rather than scanning all historical rows.
5. Migration stability: ensure migration `0016` applies cleanly across both SQLite, D1 (Miniflare), and PostgreSQL.

---

### Task 1: Verify & Formally Close Behavioral Router Guard (#183)

**Files:**
- Verify: `apps/api/test/worker.test.ts:348-447`
- Verify: `apps/web/test/hosting.test.ts:220-270`

**Interfaces:**
- Consumes: `apps/api/test/worker.test.ts`
- Produces: Verified evidence and closed issue #183.

- [ ] **Step 1: Run Miniflare worker routing tests**
  - Run: `pnpm --filter @pariksha/api exec vitest run -c vitest.workers.config.ts test/worker.test.ts`
  - Expected: 20 passed tests verifying 2-segment candidate URLs, static assets, fonts, and 404 fallbacks against Miniflare.

- [ ] **Step 2: Confirm `_redirects` withdrawal in web tests**
  - Run: `pnpm --filter @pariksha/web test test/hosting.test.ts`
  - Expected: PASS, confirming `_redirects` carries no active rules that could collide with assets.

- [ ] **Step 3: Close GitHub Issue #183 with verification citation**
  - Command:
    ```bash
    gh issue close 183 --comment "Verified that fragile static _redirects text assertions have been completely replaced by Miniflare behavioral routing integration tests in apps/api/test/worker.test.ts (20 passing tests), testing candidate URLs, static assets, fonts, and 404 responses."
    ```

---

### Task 2: Webhook Pause Range Retirement via Sentinel (#231)

**Files:**
- Modify: `packages/db/src/repo/webhooks.ts:140-160`
- Test: `packages/db/test/repo/webhooks.test.ts`
- Test: `apps/api/test/webhooks/drain.test.ts`

**Interfaces:**
- Consumes: `packages/db/src/repo/webhooks.ts`
- Produces: `setWebhookActive` shifting queued deliveries to `PAUSED_SENTINEL` on pause and restoring on resume.

- [ ] **Step 1: Write failing test in `packages/db/test/repo/webhooks.test.ts`**
  - Add test in `describe("setWebhookActive")`:
    - Queue deliveries for a webhook.
    - Call `setWebhookActive(db, ws, webhookId, false)`.
    - Assert that pending delivery has `next_attempt_at === PAUSED_SENTINEL`.
    - Call `setWebhookActive(db, ws, webhookId, true)`.
    - Assert that pending delivery has `next_attempt_at <= now`.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/db test test/repo/webhooks.test.ts`
  - Expected: FAIL (`PAUSED_SENTINEL not defined / next_attempt_at unchanged`).

- [ ] **Step 3: Implement pause retirement sentinel in `packages/db/src/repo/webhooks.ts`**
  - Export `PAUSED_SENTINEL = Number.MAX_SAFE_INTEGER - 1;`
  - In `setWebhookActive`:
    ```ts
    const now = Date.now();
    const stmts: { sql: string; params?: unknown[] }[] = [
      {
        sql: "UPDATE webhook SET active = ? WHERE workspace_id = ? AND id = ?",
        params: [db.dialect === "pg" ? active : active ? 1 : 0, workspaceId, webhookId],
      },
    ];
    if (!active) {
      stmts.push({
        sql: "UPDATE webhook_delivery SET next_attempt_at = ? WHERE workspace_id = ? AND webhook_id = ? AND delivered_at IS NULL AND next_attempt_at < ?",
        params: [PAUSED_SENTINEL, workspaceId, webhookId, PAUSED_SENTINEL],
      });
    } else {
      stmts.push({
        sql: "UPDATE webhook_delivery SET next_attempt_at = ? WHERE workspace_id = ? AND webhook_id = ? AND delivered_at IS NULL AND next_attempt_at = ?",
        params: [now, workspaceId, webhookId, PAUSED_SENTINEL],
      });
    }
    const results = await db.batch(stmts);
    if (results[0]!.changes === 0) throw new Error("setWebhookActive: no such webhook in this workspace.");
    ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `pnpm --filter @pariksha/db test test/repo/webhooks.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Run drain tests to ensure drain query operates smoothly**
  - Run: `pnpm --filter @pariksha/api exec vitest run test/webhooks/drain.test.ts`
  - Expected: PASS.

- [ ] **Step 6: Commit changes**
  - Command:
    ```bash
    git add packages/db/src/repo/webhooks.ts packages/db/test/repo/webhooks.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "perf(webhooks): exclude paused deliveries from drain query range via sentinel (closes #231)"
    ```

- [ ] **Step 7: Close GitHub Issue #231**
  - Command:
    ```bash
    gh issue close 231 --comment "Resolved in commit $(git rev-parse --short HEAD): updated setWebhookActive to shift undelivered queued items to PAUSED_SENTINEL on pause and restore on resume, excluding paused webhooks from the drain's next_attempt_at index scan range."
    ```

---

### Task 3: Prevent Retention Sweep Workspace Starvation (#226)

**Files:**
- Modify: `apps/api/src/retention/sweep.ts:223-244`
- Test: `apps/api/test/retention/sweep.test.ts`

**Interfaces:**
- Consumes: `apps/api/src/retention/sweep.ts`
- Produces: `sweepSnapshots` with SQL-level retention expiry filter preventing unexpired snapshots from filling the batch.

- [ ] **Step 1: Write failing starvation test in `apps/api/test/retention/sweep.test.ts`**
  - Add test:
    - Seed Workspace A with a test having `snapshots_days: 365`. Seed snapshots taken 100 days ago.
    - Seed Workspace B with a test having `snapshots_days: 30`. Seed snapshots taken 40 days ago.
    - Run `retentionJob.run(deps)`.
    - Assert that Workspace B's expired snapshots are deleted (not starved by Workspace A's unexpired snapshots).

- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/api exec vitest run test/retention/sweep.test.ts`
  - Expected: FAIL (Workspace B's snapshots not deleted due to batch starvation).

- [ ] **Step 3: Update `sweepSnapshots` query in `apps/api/src/retention/sweep.ts`**
  - In `sweepSnapshots`:
    ```ts
    const pg = deps.db.dialect === "pg";
    const daysExtract = pg
      ? "(tv.settings_json #>> '{retention,snapshots_days}')::numeric"
      : "json_extract(tv.settings_json, '$.retention.snapshots_days')";

    const rows = await deps.db.query<SnapshotCandidate>(
      `SELECT sn.id AS id, sn.workspace_id AS workspace_id, sn.taken_at AS at, sn.storage_key AS storage_key,
              tv.settings_json AS settings_json
       FROM snapshot sn
       JOIN attempt a ON a.id = sn.attempt_id
       JOIN test_version tv ON tv.id = a.test_version_id
       WHERE sn.taken_at <= ? - COALESCE(${daysExtract}, ?) * ${DAY_MS}
       ORDER BY sn.taken_at ASC LIMIT ?`,
      [deps.now(), RETENTION_DEFAULTS.snapshotsDays, RETENTION_BATCH],
    );
    ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `pnpm --filter @pariksha/api exec vitest run test/retention/sweep.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/api/src/retention/sweep.ts apps/api/test/retention/sweep.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "fix(retention): evaluate per-row snapshot expiry in SQL to eliminate workspace starvation (closes #226)"
    ```

- [ ] **Step 6: Close GitHub Issue #226**
  - Command:
    ```bash
    gh issue close 226 --comment "Fixed in commit $(git rev-parse --short HEAD): pushed per-row snapshots_days calculation directly into the sweepSnapshots SQL query, preventing long-retention unexpired rows from filling the batch and starving other workspaces."
    ```

---

### Task 4: Add Composite Indexes & Restore Spent Today in Usage Meter (#232)

**Files:**
- Create: `packages/db/migrations/sqlite/0016_retention_and_usage_indexes.sql`
- Create: `packages/db/migrations/pg/0016_retention_and_usage_indexes.sql`
- Modify: `packages/db/src/schema/sqlite.ts`
- Modify: `packages/db/src/schema/pg.ts`
- Modify: `packages/db/src/schema/columns.ts`
- Modify: `packages/db/src/migrations.generated.ts`
- Modify: `apps/api/src/usage/project.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/api/test/usage/project.test.ts`
- Test: `packages/db/test/parity.test.ts`
- Test: `packages/db/test/migrations-bundle.test.ts`

**Interfaces:**
- Consumes: `packages/db`, `apps/api/src/usage/project.ts`
- Produces: Migration 0016 with composite indexes `(workspace_id, timestamp)`, and `projectUsage` computing `spentToday` and incorporating it into `warn`.

- [ ] **Step 1: Create migration 0016 in SQLite and PG**
  - Create `packages/db/migrations/sqlite/0016_retention_and_usage_indexes.sql`:
    ```sql
    CREATE INDEX `snapshot_workspace_taken_idx` ON `snapshot` (`workspace_id`, `taken_at`);--> statement-breakpoint
    CREATE INDEX `attempt_workspace_started_idx` ON `attempt` (`workspace_id`, `started_at`);--> statement-breakpoint
    CREATE INDEX `event_workspace_ts_idx` ON `event` (`workspace_id`, `server_ts`);
    ```
  - Create `packages/db/migrations/pg/0016_retention_and_usage_indexes.sql`:
    ```sql
    CREATE INDEX "snapshot_workspace_taken_idx" ON "snapshot" USING btree ("workspace_id", "taken_at");--> statement-breakpoint
    CREATE INDEX "attempt_workspace_started_idx" ON "attempt" USING btree ("workspace_id", "started_at");--> statement-breakpoint
    CREATE INDEX "event_workspace_ts_idx" ON "event" USING btree ("workspace_id", "server_ts");
    ```
  - Update `packages/db/src/schema/columns.ts`, `packages/db/src/schema/sqlite.ts`, and `packages/db/src/schema/pg.ts`.
  - Run `pnpm --filter @pariksha/db migrations` to regenerate `migrations.generated.ts`.
  - Verify with `pnpm --filter @pariksha/db test test/parity.test.ts` and `test/migrations-bundle.test.ts`.

- [ ] **Step 2: Update `projectUsage` and `UsageProjection` in `apps/api/src/usage/project.ts`**
  - Add `spentToday` calculation querying today's counts bounded by `workspace_id = ? AND timestamp >= startOfDay`.
  - In `projectUsage`:
    ```ts
    const totalToday = projected + (input.spentToday ?? 0);
    return {
      projected,
      spentToday: input.spentToday ?? 0,
      limit,
      warn: totalToday / limit >= WARN_AT,
      estimated: true,
    };
    ```
  - Update `UsageProjection` in `apps/web/src/lib/api.ts` to include `spentToday?: number`.

- [ ] **Step 3: Update and run tests in `apps/api/test/usage/project.test.ts`**
  - Add test verifying that when today's spend pushes `(projected + spentToday) / limit >= 0.70`, `warn` reads `true`.
  - Run: `pnpm --filter @pariksha/api exec vitest run test/usage/project.test.ts`
  - Expected: PASS.

- [ ] **Step 4: Commit changes**
  - Command:
    ```bash
    git add packages/db/ apps/api/ apps/web/
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(db,api): add composite indexes and restore spent today in usage meter (closes #232)"
    ```

- [ ] **Step 5: Close GitHub Issue #232**
  - Command:
    ```bash
    gh issue close 232 --comment "Resolved in commit $(git rev-parse --short HEAD): added composite indexes on (workspace_id, timestamp) in migration 0016 and restored bounded spentToday in usage projection, ensuring warn accounts for today's incurred spend."
    ```
