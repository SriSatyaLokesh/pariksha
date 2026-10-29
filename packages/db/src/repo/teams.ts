// Teams and team-based RBAC repository (Phase 13).
// Every function is guarded with scoped() to enforce strict tenant isolation.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export interface TeamRow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: number;
}

export interface CreateTeamInput {
  name: string;
  description?: string | null;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string | null;
}

export interface TeamMemberRow {
  teamId: string;
  userId: string;
  createdAt: number;
  email?: string | undefined;
}

export interface TeamGrantRow {
  id: string;
  workspaceId: string;
  teamId: string;
  resourceType: string;
  resourceId: string;
  role: string;
  createdAt: number;
}

export interface TeamGrantWithTeamRow extends TeamGrantRow {
  teamName?: string | undefined;
}

export interface GrantTeamResourceInput {
  teamId: string;
  resourceType: string;
  resourceId: string;
  role: string;
}

export const createTeam = scoped(
  "createTeam",
  async (
    db: DbClient,
    workspaceId: string,
    input: CreateTeamInput,
  ): Promise<TeamRow> => {
    const id = newId("team");
    const now = Date.now();
    await db.run(
      "INSERT INTO team (id, workspace_id, name, description, created_at) VALUES (?, ?, ?, ?, ?)",
      [id, workspaceId, input.name, input.description ?? null, now],
    );
    return {
      id,
      workspaceId,
      name: input.name,
      description: input.description ?? null,
      createdAt: now,
    };
  },
);

export const listTeams = scoped(
  "listTeams",
  async (db: DbClient, workspaceId: string): Promise<TeamRow[]> => {
    const rows = await db.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      created_at: number;
    }>(
      "SELECT id, workspace_id, name, description, created_at FROM team WHERE workspace_id = ? ORDER BY created_at ASC",
      [workspaceId],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      description: r.description,
      createdAt: Number(r.created_at),
    }));
  },
);

export const getTeam = scoped(
  "getTeam",
  async (
    db: DbClient,
    workspaceId: string,
    teamId: string,
  ): Promise<TeamRow | null> => {
    const rows = await db.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      created_at: number;
    }>(
      "SELECT id, workspace_id, name, description, created_at FROM team WHERE workspace_id = ? AND id = ?",
      [workspaceId, teamId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      description: r.description,
      createdAt: Number(r.created_at),
    };
  },
);

export const updateTeam = scoped(
  "updateTeam",
  async (
    db: DbClient,
    workspaceId: string,
    teamId: string,
    patch: UpdateTeamInput,
  ): Promise<TeamRow | null> => {
    if (patch.name !== undefined && patch.description !== undefined) {
      await db.run(
        "UPDATE team SET name = ?, description = ? WHERE workspace_id = ? AND id = ?",
        [patch.name, patch.description, workspaceId, teamId],
      );
    } else if (patch.name !== undefined) {
      await db.run(
        "UPDATE team SET name = ? WHERE workspace_id = ? AND id = ?",
        [patch.name, workspaceId, teamId],
      );
    } else if (patch.description !== undefined) {
      await db.run(
        "UPDATE team SET description = ? WHERE workspace_id = ? AND id = ?",
        [patch.description, workspaceId, teamId],
      );
    }
    return getTeam(db, workspaceId, teamId);
  },
);

export const deleteTeam = scoped(
  "deleteTeam",
  async (db: DbClient, workspaceId: string, teamId: string): Promise<void> => {
    const team = await getTeam(db, workspaceId, teamId);
    if (!team) return;

    await db.run(
      "DELETE FROM team_grant WHERE workspace_id = ? AND team_id = ?",
      [workspaceId, teamId],
    );
    await db.run(
      "DELETE FROM team_member WHERE team_id = ?",
      [teamId],
    );
    await db.run(
      "DELETE FROM team WHERE workspace_id = ? AND id = ?",
      [workspaceId, teamId],
    );
  },
);

export const addTeamMember = scoped(
  "addTeamMember",
  async (
    db: DbClient,
    workspaceId: string,
    teamId: string,
    userId: string,
  ): Promise<void> => {
    const team = await getTeam(db, workspaceId, teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found in workspace ${workspaceId}`);
    }

    const existing = await db.query(
      "SELECT 1 FROM team_member WHERE team_id = ? AND user_id = ?",
      [teamId, userId],
    );
    if (existing.length === 0) {
      await db.run(
        "INSERT INTO team_member (team_id, user_id, created_at) VALUES (?, ?, ?)",
        [teamId, userId, Date.now()],
      );
    }
  },
);

export const removeTeamMember = scoped(
  "removeTeamMember",
  async (
    db: DbClient,
    workspaceId: string,
    teamId: string,
    userId: string,
  ): Promise<void> => {
    const team = await getTeam(db, workspaceId, teamId);
    if (!team) return;

    await db.run(
      "DELETE FROM team_member WHERE team_id = ? AND user_id = ?",
      [teamId, userId],
    );
  },
);

export const listTeamMembers = scoped(
  "listTeamMembers",
  async (
    db: DbClient,
    workspaceId: string,
    teamId: string,
  ): Promise<TeamMemberRow[]> => {
    const team = await getTeam(db, workspaceId, teamId);
    if (!team) return [];

    const rows = await db.query<{
      team_id: string;
      user_id: string;
      created_at: number;
      email: string | null;
    }>(
      'SELECT tm.team_id, tm.user_id, tm.created_at, u.email ' +
        'FROM team_member tm ' +
        'LEFT JOIN "user" u ON u.id = tm.user_id ' +
        'WHERE tm.team_id = ? ' +
        'ORDER BY tm.created_at ASC',
      [teamId],
    );
    return rows.map((r) => ({
      teamId: r.team_id,
      userId: r.user_id,
      createdAt: Number(r.created_at),
      email: r.email ?? undefined,
    }));
  },
);

export const grantTeamResource = scoped(
  "grantTeamResource",
  async (
    db: DbClient,
    workspaceId: string,
    input: GrantTeamResourceInput,
  ): Promise<TeamGrantRow> => {
    const team = await getTeam(db, workspaceId, input.teamId);
    if (!team) {
      throw new Error(`Team ${input.teamId} not found in workspace ${workspaceId}`);
    }

    if (input.resourceType === "test") {
      const rows = await db.query<{ id: string }>(
        "SELECT id FROM test WHERE workspace_id = ? AND id = ?",
        [workspaceId, input.resourceId],
      );
      if (!rows[0]) {
        throw new Error(`Test ${input.resourceId} not found in workspace ${workspaceId}`);
      }
    } else if (input.resourceType === "bank") {
      const rows = await db.query<{ id: string }>(
        "SELECT id FROM bank WHERE workspace_id = ? AND id = ?",
        [workspaceId, input.resourceId],
      );
      if (!rows[0]) {
        throw new Error(`Bank ${input.resourceId} not found in workspace ${workspaceId}`);
      }
    }

    const existing = await db.query<{ id: string; created_at: number }>(
      "SELECT id, created_at FROM team_grant WHERE workspace_id = ? AND team_id = ? AND resource_type = ? AND resource_id = ?",
      [workspaceId, input.teamId, input.resourceType, input.resourceId],
    );

    if (existing[0]) {
      await db.run(
        "UPDATE team_grant SET role = ? WHERE workspace_id = ? AND id = ?",
        [input.role, workspaceId, existing[0].id],
      );
      return {
        id: existing[0].id,
        workspaceId,
        teamId: input.teamId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        role: input.role,
        createdAt: Number(existing[0].created_at),
      };
    }

    const id = newId("tgr");
    const now = Date.now();
    await db.run(
      "INSERT INTO team_grant (id, workspace_id, team_id, resource_type, resource_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, workspaceId, input.teamId, input.resourceType, input.resourceId, input.role, now],
    );
    return {
      id,
      workspaceId,
      teamId: input.teamId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      role: input.role,
      createdAt: now,
    };
  },
);

export const revokeTeamResource = scoped(
  "revokeTeamResource",
  async (
    db: DbClient,
    workspaceId: string,
    grantIdOrTeamId: string,
    maybeGrantId?: string,
  ): Promise<void> => {
    if (maybeGrantId !== undefined) {
      await db.run(
        "DELETE FROM team_grant WHERE workspace_id = ? AND team_id = ? AND id = ?",
        [workspaceId, grantIdOrTeamId, maybeGrantId],
      );
    } else {
      await db.run(
        "DELETE FROM team_grant WHERE workspace_id = ? AND id = ?",
        [workspaceId, grantIdOrTeamId],
      );
    }
  },
);

export const listTeamGrants = scoped(
  "listTeamGrants",
  async (
    db: DbClient,
    workspaceId: string,
    teamId: string,
  ): Promise<TeamGrantRow[]> => {
    const rows = await db.query<{
      id: string;
      workspace_id: string;
      team_id: string;
      resource_type: string;
      resource_id: string;
      role: string;
      created_at: number;
    }>(
      "SELECT id, workspace_id, team_id, resource_type, resource_id, role, created_at FROM team_grant WHERE workspace_id = ? AND team_id = ? ORDER BY created_at ASC",
      [workspaceId, teamId],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      teamId: r.team_id,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      role: r.role,
      createdAt: Number(r.created_at),
    }));
  },
);

export const listTeamGrantsForResource = scoped(
  "listTeamGrantsForResource",
  async (
    db: DbClient,
    workspaceId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<TeamGrantWithTeamRow[]> => {
    const rows = await db.query<{
      id: string;
      workspace_id: string;
      team_id: string;
      resource_type: string;
      resource_id: string;
      role: string;
      created_at: number;
      team_name: string | null;
    }>(
      "SELECT g.id, g.workspace_id, g.team_id, g.resource_type, g.resource_id, g.role, g.created_at, t.name as team_name " +
        "FROM team_grant g " +
        "JOIN team t ON t.id = g.team_id " +
        "WHERE g.workspace_id = ? AND g.resource_type = ? AND g.resource_id = ? " +
        "ORDER BY g.created_at ASC",
      [workspaceId, resourceType, resourceId],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      teamId: r.team_id,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      role: r.role,
      createdAt: Number(r.created_at),
      teamName: r.team_name ?? undefined,
    }));
  },
);

export const listUserTeamGrantsForResource = scoped(
  "listUserTeamGrantsForResource",
  async (
    db: DbClient,
    workspaceId: string,
    userId: string,
    resourceType?: string,
    resourceId?: string,
  ): Promise<TeamGrantWithTeamRow[]> => {
    if (resourceType && resourceId) {
      const rows = await db.query<{
        id: string;
        workspace_id: string;
        team_id: string;
        resource_type: string;
        resource_id: string;
        role: string;
        created_at: number;
        team_name: string | null;
      }>(
        "SELECT g.id, g.workspace_id, g.team_id, g.resource_type, g.resource_id, g.role, g.created_at, t.name as team_name " +
          "FROM team_grant g " +
          "JOIN team_member tm ON tm.team_id = g.team_id " +
          "JOIN team t ON t.id = g.team_id " +
          "WHERE g.workspace_id = ? AND tm.user_id = ? AND g.resource_type = ? AND g.resource_id = ? " +
          "ORDER BY g.created_at ASC",
        [workspaceId, userId, resourceType, resourceId],
      );
      return rows.map((r) => ({
        id: r.id,
        workspaceId: r.workspace_id,
        teamId: r.team_id,
        resourceType: r.resource_type,
        resourceId: r.resource_id,
        role: r.role,
        createdAt: Number(r.created_at),
        teamName: r.team_name ?? undefined,
      }));
    }

    const rows = await db.query<{
      id: string;
      workspace_id: string;
      team_id: string;
      resource_type: string;
      resource_id: string;
      role: string;
      created_at: number;
      team_name: string | null;
    }>(
      "SELECT g.id, g.workspace_id, g.team_id, g.resource_type, g.resource_id, g.role, g.created_at, t.name as team_name " +
        "FROM team_grant g " +
        "JOIN team_member tm ON tm.team_id = g.team_id " +
        "JOIN team t ON t.id = g.team_id " +
        "WHERE g.workspace_id = ? AND tm.user_id = ? " +
        "ORDER BY g.created_at ASC",
      [workspaceId, userId],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      teamId: r.team_id,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      role: r.role,
      createdAt: Number(r.created_at),
      teamName: r.team_name ?? undefined,
    }));
  },
);

export const listUserTeams = scoped(
  "listUserTeams",
  async (
    db: DbClient,
    workspaceId: string,
    userId: string,
  ): Promise<TeamRow[]> => {
    const rows = await db.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      created_at: number;
    }>(
      "SELECT t.id, t.workspace_id, t.name, t.description, t.created_at " +
        "FROM team t " +
        "JOIN team_member tm ON tm.team_id = t.id " +
        "WHERE t.workspace_id = ? AND tm.user_id = ? " +
        "ORDER BY t.created_at ASC",
      [workspaceId, userId],
    );
    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      name: r.name,
      description: r.description,
      createdAt: Number(r.created_at),
    }));
  },
);
