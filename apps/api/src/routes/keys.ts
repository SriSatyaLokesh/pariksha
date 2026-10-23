// Scoped API key endpoints: the organiser's CRUD surface for its second
// credential (Phase 8d Task 2, `K25`, `K26`, `KG5`).
//
// Guarded by `keys.manage` throughout, the same action `webhooks.ts` is
// guarded by (`docs/PRD.md:106`'s "Create API keys and webhooks" row is
// Owner+Admin, one permission for both). `K26` holds transitively through
// this guard: `createApiKey` refuses `keys.manage` as a scope outright, so
// no key this route ever mints can hold `keys.manage` itself — a key can
// never reach this route to mint, list or revoke another key.

import { Hono } from "hono";
import { z } from "zod";
import { ACTIONS, can, type Action } from "@pariksha/core";
import { appendAudit, createApiKey, listApiKeys, revokeApiKey, KEY_FORBIDDEN_ACTIONS } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, membershipOr404, requires } from "../middleware/authorize.js";

const newApiKey = z.object({
  name: z.string().min(1).max(200),
  scopes: z.array(z.enum(ACTIONS)).min(1).max(ACTIONS.length),
});

const FORBIDDEN_SCOPES: ReadonlySet<Action> = new Set(KEY_FORBIDDEN_ACTIONS);

function notFound(): never {
  throw new ApiError(404, "not_found", "No such resource.");
}

export function keyRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/keys", requires("keys.manage"), async (c) => {
    const keys = await listApiKeys(deps.db, c.req.param("id"));
    return c.json({ keys });
  });

  routes.post("/:id/keys", requires("keys.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    // The creator's own role in this workspace — never a key's own
    // membership, which carries no role `can()` can answer for and, by
    // `K26`, could never have reached `requires("keys.manage")` in the
    // first place.
    const membership = membershipOr404(actor, workspaceId);
    const input = parse(newApiKey, await json(c.req.raw));
    const now = deps.now();

    // `K26`, checked here as its own clean refusal rather than left to
    // fall through to `createApiKey`'s internal, defense-in-depth throw
    // (which would surface as an undifferentiated 500 — `webhooks.ts`'s
    // own MINOR-3 lesson in reverse: an *expected* business refusal
    // deserves its own status, the same way a genuine failure must never
    // borrow one). Independent of role: `can()` would pass this for an
    // Owner or an Admin, since both hold `keys.manage` themselves — K26 is
    // not "do you hold it", it is "no key may ever hold it, whoever asks".
    for (const scope of input.scopes) {
      if (FORBIDDEN_SCOPES.has(scope)) {
        throw new ApiError(422, "scope_forbidden", `"${scope}" may never be a key's scope.`);
      }
    }

    // "A key may never widen what its creator could do": each remaining
    // requested scope must be one this organiser's own role already
    // holds, checked with no `testId` — a key is workspace-wide, so a
    // grant narrowed to one test must never become workspace-wide
    // through a key.
    for (const scope of input.scopes) {
      if (!can({ role: membership.role, action: scope })) {
        throw new ApiError(
          403,
          "forbidden",
          `A ${membership.role} may not grant a key the "${scope}" scope — they do not hold it themselves.`,
        );
      }
    }

    const created = await createApiKey(deps.db, workspaceId, { name: input.name, scopes: input.scopes, now });

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "key.create",
      target: created.apiKeyId,
      detail: { name: input.name, scopes: input.scopes },
      now,
    });

    // The one response that ever carries the secret (`KG5`) — `GET
    // .../keys` reads the same row and never includes it.
    return c.json({ id: created.apiKeyId, name: input.name, scopes: input.scopes, secret: created.secret }, 201);
  });

  routes.delete("/:id/keys/:keyId", requires("keys.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const keyId = c.req.param("keyId");
    const now = deps.now();

    try {
      await revokeApiKey(deps.db, workspaceId, keyId, now);
    } catch {
      // `revokeApiKey` throws only when the row is not an active key in
      // this workspace — S-09's 404, not a 403 that would confirm the id.
      notFound();
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "key.revoke",
      target: keyId,
      detail: {},
      now,
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

/** A body that is absent or not JSON is a bad request, not a 500. */
async function json(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
