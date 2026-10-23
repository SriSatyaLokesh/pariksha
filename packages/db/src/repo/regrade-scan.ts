// The regrade cron's one cross-workspace read (Phase 8b Task 4, `K18`).
//
// Deliberately **outside** `scoped()` and outside `repo/index.js`'s barrel —
// same reasoning as `shortlink.ts` and `candidate-entry.ts`: a cron tick has
// no single workspace to run inside (`scheduled.ts`'s `ScheduledJob.run`
// takes an `AppDeps`, never a `workspaceId`), so there is nothing for
// `scoped()` to check. `scoping.test.ts` would otherwise flag this file for
// reading `audit_log` with no workspace guard — which is exactly right for
// every *other* file under `repo/`, and exactly wrong here.
//
// ponytail: bounded by `audit_log_at_idx` (a seek to `since`, not a scan of
// the table's full history) but still reads every row written in that
// window regardless of `action` — `action` carries no index of its own,
// and `K10` forbids a migration on this branch to add one. At this phase's
// audit volume (organiser actions plus one `attempt.submitted` row per
// candidate) that is at most a few hundred rows per tick; `apps/api/src/
// grade/regrade.ts`'s own header does the arithmetic and names the ceiling.
// If `attempt.submitted` volume ever makes that window too wide, the fix is
// an index on `(action, at)` — stop and ask before adding it, the same rule
// `K17`'s own text already states for the per-version completion check.

import type { DbClient } from "../client.js";

export interface RegradeAuditRow {
  workspaceId: string;
  action: string;
  target: string;
  detail: unknown;
  at: number;
}

/** Every audit row at or after `since`, oldest first, across every
 *  workspace. Filtered to `regrade.*` actions in JS, not SQL — a `LIKE`
 *  predicate reads the same rows either way with no index to prune on. */
export async function recentAuditRows(db: DbClient, since: number): Promise<RegradeAuditRow[]> {
  const rows = await db.query<{
    workspace_id: string;
    action: string;
    target: string;
    detail_json: unknown;
    at: number;
  }>("SELECT workspace_id, action, target, detail_json, at FROM audit_log WHERE at > ? ORDER BY at ASC", [since]);
  return rows
    .filter((row) => row.action.startsWith("regrade"))
    .map((row) => ({
      workspaceId: row.workspace_id,
      action: row.action,
      target: row.target,
      detail: row.detail_json == null ? null : db.jsonValue(row.detail_json),
      at: Number(row.at),
    }));
}
