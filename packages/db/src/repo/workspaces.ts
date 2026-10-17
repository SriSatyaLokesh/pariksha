// Workspaces and memberships.
//
// `createWorkspace` is the one function that takes the workspace it is
// creating — it still goes through `scoped()`, because the ID it writes is
// the one it is handed, and an unvalidated one would create a row no scoped
// read could ever reach.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  branding: unknown;
  settings: unknown;
  createdAt: number;
}

export interface MembershipRow {
  id: string;
  userId: string;
  role: string;
  testGrants: unknown;
}

export const createWorkspace = scoped(
  "createWorkspace",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      slug: string;
      name: string;
      branding?: unknown;
      settings?: unknown;
      now?: number;
    },
  ): Promise<string> => {
    await db.run(
      "INSERT INTO workspace (id, slug, name, branding_json, settings_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        workspaceId,
        input.slug,
        input.name,
        input.branding === undefined ? null : db.jsonParam(input.branding),
        input.settings === undefined ? null : db.jsonParam(input.settings),
        input.now ?? Date.now(),
      ],
    );
    return workspaceId;
  },
);

export const getWorkspace = scoped(
  "getWorkspace",
  async (db: DbClient, workspaceId: string): Promise<WorkspaceRow | null> => {
    const rows = await db.query<{
      id: string;
      slug: string;
      name: string;
      branding_json: unknown;
      settings_json: unknown;
      created_at: number;
    }>("SELECT * FROM workspace WHERE id = ?", [workspaceId]);

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      branding: row.branding_json == null ? null : db.jsonValue(row.branding_json),
      settings: row.settings_json == null ? null : db.jsonValue(row.settings_json),
      createdAt: Number(row.created_at),
    };
  },
);

export const addMembership = scoped(
  "addMembership",
  async (
    db: DbClient,
    workspaceId: string,
    input: { userId: string; role: string; testGrants?: unknown; now?: number },
  ): Promise<string> => {
    const id = newId("mbr");
    await db.run(
      "INSERT INTO membership (id, workspace_id, user_id, role, test_grants_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        id,
        workspaceId,
        input.userId,
        input.role,
        input.testGrants === undefined ? null : db.jsonParam(input.testGrants),
        input.now ?? Date.now(),
      ],
    );
    return id;
  },
);

export const listMemberships = scoped(
  "listMemberships",
  async (db: DbClient, workspaceId: string): Promise<MembershipRow[]> => {
    const rows = await db.query<{
      id: string;
      user_id: string;
      role: string;
      test_grants_json: unknown;
    }>(
      "SELECT id, user_id, role, test_grants_json FROM membership WHERE workspace_id = ? ORDER BY created_at",
      [workspaceId],
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      role: row.role,
      testGrants:
        row.test_grants_json == null ? null : db.jsonValue(row.test_grants_json),
    }));
  },
);
