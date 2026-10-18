// Banks, and the workspace's tag vocabulary.
//
// Mounted under `/api/v1/workspaces` — like every other workspace-scoped
// route in this app — rather than flat at `/api/v1/banks`, because
// `requires()`/`requireMember()` (middleware/authorize.ts) read the
// workspace out of the path's own `:id` segment and have no other way to
// learn it; S-09 (a cross-workspace resource is 404, not 403) depends on
// that segment naming the actor's own membership.
//
// `banks.edit` is the one bank-shaped action (docs/design.md, the
// permission matrix) — there is no `banks.view` — so every route here,
// reads included, is guarded by it. A Viewer is 403 on all of them, which
// is intended, not an oversight.

import { Hono } from "hono";
import { z } from "zod";
import {
  appendAudit,
  createBank,
  deleteBank,
  getBank,
  listBanks,
  listWorkspaceTags,
  updateBank,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

const newBank = z.object({ name: z.string().min(1).max(200) });

const bankPatch = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    license: z.string().max(200).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "names nothing to change");

export function bankRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/banks", requires("banks.edit"), async (c) =>
    c.json({ banks: await listBanks(deps.db, c.req.param("id")) }),
  );

  // UX-02: a name and nothing else is required.
  routes.post("/:id/banks", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const input = parse(newBank, await json(c.req.raw));
    const now = deps.now();

    const id = await createBank(deps.db, workspaceId, { name: input.name, now });
    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "bank.create",
      target: id,
      detail: { name: input.name },
      now,
    });

    return c.json(await getBank(deps.db, workspaceId, id), 201);
  });

  routes.get("/:id/banks/:bankId", requires("banks.edit"), async (c) => {
    const bank = await getBank(deps.db, c.req.param("id"), c.req.param("bankId"));
    if (!bank) throw new ApiError(404, "not_found", "No such resource.");
    return c.json(bank);
  });

  routes.patch("/:id/banks/:bankId", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");
    const patch = parse(bankPatch, await json(c.req.raw));

    const updated = await updateBank(deps.db, workspaceId, bankId, patch);
    if (!updated) throw new ApiError(404, "not_found", "No such resource.");

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "bank.update",
      target: bankId,
      detail: { fields: Object.keys(patch).sort() },
      now: deps.now(),
    });

    return c.json(await getBank(deps.db, workspaceId, bankId));
  });

  routes.delete("/:id/banks/:bankId", requires("banks.edit"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const bankId = c.req.param("bankId");

    const bank = await getBank(deps.db, workspaceId, bankId);
    if (!bank) throw new ApiError(404, "not_found", "No such resource.");

    const result = await deleteBank(deps.db, workspaceId, bankId);
    if (!result.deleted) {
      // UX-05's bank-level sibling: a bank holding a question a published
      // version references cannot be gutted out from under it either.
      throw new ApiError(
        409,
        "bank_in_use",
        `This bank has questions used by: ${result.blockedBy.join(", ")}.`,
        { blockedBy: result.blockedBy },
      );
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "bank.delete",
      target: bankId,
      now: deps.now(),
    });

    return c.body(null, 204);
  });

  routes.get("/:id/tags", requires("banks.edit"), async (c) =>
    c.json({ tags: await listWorkspaceTags(deps.db, c.req.param("id")) }),
  );

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
