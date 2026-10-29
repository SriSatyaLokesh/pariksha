import { Hono } from "hono";
import { z } from "zod";
import { ROLES } from "@pariksha/core";
import {
  addTeamMember,
  appendAudit,
  createTeam,
  deleteTeam,
  getTeam,
  grantTeamResource,
  listTeamGrants,
  listTeamMembers,
  listTeams,
  removeTeamMember,
  revokeTeamResource,
  updateTeam,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requireMember, requires } from "../middleware/authorize.js";

const createTeamSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(256).nullable().optional(),
});

const updateTeamSchema = z
  .object({
    name: z.string().min(1).max(64).optional(),
    description: z.string().max(256).nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "names nothing to change");

const addMemberSchema = z.object({
  userId: z.string().min(1),
});

const grantResourceSchema = z.object({
  resourceType: z.enum(["test", "bank"]),
  resourceId: z.string().min(1),
  role: z.enum(ROLES),
});

export function teamRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/", requireMember(), async (c) => {
    const workspaceId = c.req.param("id") ?? "";
    const teams = await listTeams(deps.db, workspaceId);
    return c.json({ teams });
  });

  routes.post("/", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const input = parse(createTeamSchema, await json(c.req.raw));
    const team = await createTeam(deps.db, workspaceId, {
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
    });

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.create",
      target: team.id,
      detail: { name: team.name },
      now: deps.now(),
    });

    return c.json({ team }, 201);
  });

  routes.get("/:teamId", requireMember(), async (c) => {
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";
    const team = await getTeam(deps.db, workspaceId, teamId);
    if (!team) throw new ApiError(404, "not_found", "No such resource.");
    return c.json({ team });
  });

  routes.patch("/:teamId", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";

    const existing = await getTeam(deps.db, workspaceId, teamId);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    const patch = parse(updateTeamSchema, await json(c.req.raw));
    const team = await updateTeam(deps.db, workspaceId, teamId, {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.description !== undefined && { description: patch.description }),
    });

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.update",
      target: teamId,
      detail: { fields: Object.keys(patch).sort() },
      now: deps.now(),
    });

    return c.json({ team });
  });

  routes.delete("/:teamId", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";

    const existing = await getTeam(deps.db, workspaceId, teamId);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");

    await deleteTeam(deps.db, workspaceId, teamId);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.delete",
      target: teamId,
      detail: { name: existing.name },
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  routes.get("/:teamId/members", requireMember(), async (c) => {
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";

    const team = await getTeam(deps.db, workspaceId, teamId);
    if (!team) throw new ApiError(404, "not_found", "No such resource.");

    const members = await listTeamMembers(deps.db, workspaceId, teamId);
    return c.json({ members });
  });

  routes.post("/:teamId/members", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";

    const team = await getTeam(deps.db, workspaceId, teamId);
    if (!team) throw new ApiError(404, "not_found", "No such resource.");

    const input = parse(addMemberSchema, await json(c.req.raw));
    await addTeamMember(deps.db, workspaceId, teamId, input.userId);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.member_add",
      target: teamId,
      detail: { userId: input.userId },
      now: deps.now(),
    });

    return c.json({ ok: true }, 201);
  });

  routes.delete("/:teamId/members/:userId", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";
    const userId = c.req.param("userId") ?? "";

    const team = await getTeam(deps.db, workspaceId, teamId);
    if (!team) throw new ApiError(404, "not_found", "No such resource.");

    await removeTeamMember(deps.db, workspaceId, teamId, userId);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.member_remove",
      target: teamId,
      detail: { userId },
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  routes.get("/:teamId/grants", requireMember(), async (c) => {
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";

    const team = await getTeam(deps.db, workspaceId, teamId);
    if (!team) throw new ApiError(404, "not_found", "No such resource.");

    const grants = await listTeamGrants(deps.db, workspaceId, teamId);
    return c.json({ grants });
  });

  routes.post("/:teamId/grants", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";

    const team = await getTeam(deps.db, workspaceId, teamId);
    if (!team) throw new ApiError(404, "not_found", "No such resource.");

    const input = parse(grantResourceSchema, await json(c.req.raw));
    let grant;
    try {
      grant = await grantTeamResource(deps.db, workspaceId, {
        teamId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        role: input.role,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found in workspace")) {
        throw new ApiError(404, "not_found", "The specified resource was not found in this workspace.");
      }
      throw err;
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.grant_add",
      target: teamId,
      detail: {
        grantId: grant.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        role: input.role,
      },
      now: deps.now(),
    });

    return c.json({ grant }, 201);
  });

  routes.delete("/:teamId/grants/:grantId", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id") ?? "";
    const teamId = c.req.param("teamId") ?? "";
    const grantId = c.req.param("grantId") ?? "";

    await revokeTeamResource(deps.db, workspaceId, teamId, grantId);

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "team.grant_remove",
      target: teamId,
      detail: { grantId },
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  return routes;
}

function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw new ApiError(400, "invalid_request", "The request body is not valid.", {
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
