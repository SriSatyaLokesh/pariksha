// The audit log (S-18).
//
// Append-only, and that is enforced by what this module does not export:
// there is no update and no delete. A caller cannot rewrite history through
// the repository layer, because the function to do it does not exist.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  detail: unknown;
  at: number;
}

export const appendAudit = scoped(
  "appendAudit",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      actor: string;
      action: string;
      target: string;
      detail?: unknown;
      now?: number;
    },
  ): Promise<string> => {
    const id = newId("aud");
    await db.run(
      "INSERT INTO audit_log (id, workspace_id, actor, action, target, detail_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        workspaceId,
        input.actor,
        input.action,
        input.target,
        input.detail === undefined ? null : db.jsonParam(input.detail),
        input.now ?? Date.now(),
      ],
    );
    return id;
  },
);

/**
 * `appendAudit`, N times, in one `db.batch()` — Phase 8b Task 4's fix round
 * (`M5`): the regrade route enqueues one `"regrade.requested"` row per
 * published version a key change affects, and N single-row `appendAudit`
 * calls cost N subrequests where one `batch()` costs one regardless of N.
 * Still append-only: every statement in the batch is an `INSERT`, nothing
 * this module does not already allow one row at a time.
 */
export const appendAuditBatch = scoped(
  "appendAuditBatch",
  async (
    db: DbClient,
    workspaceId: string,
    entries: readonly {
      actor: string;
      action: string;
      target: string;
      detail?: unknown;
      now?: number;
    }[],
  ): Promise<string[]> => {
    if (entries.length === 0) return [];
    const ids = entries.map(() => newId("aud"));
    await db.batch(
      entries.map((input, i) => ({
        sql: "INSERT INTO audit_log (id, workspace_id, actor, action, target, detail_json, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params: [
          ids[i],
          workspaceId,
          input.actor,
          input.action,
          input.target,
          input.detail === undefined ? null : db.jsonParam(input.detail),
          input.now ?? Date.now(),
        ],
      })),
    );
    return ids;
  },
);

export const listAudit = scoped(
  "listAudit",
  async (
    db: DbClient,
    workspaceId: string,
    options: { limit?: number } = {},
  ): Promise<AuditEntry[]> => {
    // Newest first, bounded: an audit log grows without limit and no caller
    // has a reason to pull all of it into a Worker's memory.
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000);
    const rows = await db.query<{
      id: string;
      actor: string;
      action: string;
      target: string;
      detail_json: unknown;
      at: number;
    }>(
      "SELECT id, actor, action, target, detail_json, at FROM audit_log WHERE workspace_id = ? ORDER BY at DESC LIMIT ?",
      [workspaceId, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      target: row.target,
      detail: row.detail_json == null ? null : db.jsonValue(row.detail_json),
      at: Number(row.at),
    }));
  },
);
