// Ephemeral demo workspace cleanup job (Phase 9 Task 6).
//
// Automatically sweeps expired demo workspaces on the nightly cron trigger
// ("17 3 * * *"). Selects workspaces with `is_demo: true` and `expires_at <= now`
// (or demo- slug older than default duration), cascades deletions across all
// child tables in a single D1 db.batch(), and bounds processing to at most 50
// workspaces per sweep to stay well under the 50-subrequest ceiling.

import type { AppDeps } from "../app.js";
import type { ScheduledJob } from "../scheduled.js";

export const DEMO_SWEEP_CRON = "17 3 * * *";
export const DEMO_SWEEP_BATCH_LIMIT = 50;
export const DEMO_SWEEP_MAX_SUBREQUESTS = 10;

export interface DemoSweepResult {
  deletedWorkspaces: number;
}

export async function demoSweep(deps: AppDeps): Promise<DemoSweepResult> {
  const now = deps.now();

  const isDemoExpr =
    deps.db.dialect === "pg"
      ? "(slug LIKE 'demo-%' OR (settings_json ->> 'is_demo') = 'true')"
      : "(slug LIKE 'demo-%' OR settings_json LIKE '%\"is_demo\":true%' OR settings_json LIKE '%\"is_demo\": true%')";

  // 1. Query potential demo workspaces
  const rows = await deps.db.query<{
    id: string;
    slug: string;
    settings_json: unknown;
    created_at: number;
  }>(
    `SELECT id, slug, settings_json, created_at FROM workspace WHERE ${isDemoExpr} LIMIT ?`,
    [DEMO_SWEEP_BATCH_LIMIT],
  );

  const expiredWorkspaceIds: string[] = [];

  for (const row of rows) {
    const settings = row.settings_json == null
      ? null
      : deps.db.jsonValue<{ is_demo?: boolean; expires_at?: number }>(row.settings_json);

    const isDemo = settings?.is_demo === true || row.slug.startsWith("demo-");
    const expiresAt = settings?.expires_at ?? (Number(row.created_at) + 3600_000);

    if (isDemo && expiresAt <= now) {
      expiredWorkspaceIds.push(row.id);
    }
  }

  if (expiredWorkspaceIds.length === 0) {
    return { deletedWorkspaces: 0 };
  }

  // 2. Build cascading delete statements for all child tables and the workspace row
  const statements: { sql: string; params: unknown[] }[] = [];

  for (const wspId of expiredWorkspaceIds) {
    statements.push(
      { sql: "DELETE FROM response WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM event WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM snapshot WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM review WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM attempt WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM candidate_unique WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM candidate WHERE workspace_id = ?", params: [wspId] },
      { sql: 'DELETE FROM "set" WHERE workspace_id = ?', params: [wspId] },
      { sql: "DELETE FROM test_version WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM test WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM question WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM question_bank WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM webhook_delivery WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM webhook WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM api_key WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM audit_log WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM session WHERE user_id IN (SELECT user_id FROM membership WHERE workspace_id = ?)", params: [wspId] },
      { sql: 'DELETE FROM "user" WHERE id IN (SELECT user_id FROM membership WHERE workspace_id = ?) AND email LIKE \'%@demo.pariksha.test\'', params: [wspId] },
      { sql: "DELETE FROM membership WHERE workspace_id = ?", params: [wspId] },
      { sql: "DELETE FROM workspace WHERE id = ?", params: [wspId] },
    );
  }

  // Execute in a single D1 batch
  await deps.db.batch(statements);

  return { deletedWorkspaces: expiredWorkspaceIds.length };
}

export const demoCleanupJob: ScheduledJob = {
  name: "demo.sweep",
  cron: DEMO_SWEEP_CRON,
  maxSubrequests: DEMO_SWEEP_MAX_SUBREQUESTS,
  async run(deps: AppDeps): Promise<{ summary: string }> {
    const { deletedWorkspaces } = await demoSweep(deps);
    return {
      summary: `demo.sweep: deleted ${deletedWorkspaces} expired demo workspace(s)`,
    };
  },
};
