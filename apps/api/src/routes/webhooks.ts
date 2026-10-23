// Webhook endpoints: the organiser's CRUD surface (Phase 8d Task 1, `K35`,
// `K36`, `KG5`).
//
// Guarded by `workspace.settings` throughout — a webhook is workspace
// configuration, the same bucket branding and the workspace name already
// sit in, not a new row in the permission matrix (`docs/PRD.md` is
// transcribed cell for cell, and widening it is a PRD change). `can()`
// (`@pariksha/core`) gives `workspace.settings` to Owner alone, so every
// route here is 403 to an Admin and everyone below — see the ruling in this
// task's report for the cost if that turns out to be the wrong cell.
//
// `K35`/`K36`: the list response carries `costPerCandidate` — `estimateCost`'s
// "webhooks" line, read with exactly one active hook so the figure answers
// "what does enabling one more webhook cost", which is what the panel shows
// beside the event selector before anything is saved — except on the `node`
// target, where the field is omitted outright (never sent as `null`).

import { Hono } from "hono";
import { z } from "zod";
import {
  appendAudit,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  setWebhookActive,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from "@pariksha/db";
import { estimateCost, resolveProctoring } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { actorOr401, requires } from "../middleware/authorize.js";

const newWebhook = z.object({
  url: z.string().min(1).max(2000),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
});

const webhookPatch = z.object({ active: z.boolean() });

/**
 * `K35`: the per-candidate request figure `estimateCost`'s own "webhooks"
 * line states — one delivery per subscribed hook per candidate. Read with a
 * fixed, camera-off profile and exactly one hook: this screen names no
 * test, so there is no real duration or candidate count to ask about, and
 * the figure answers the one question the panel needs — the marginal cost
 * of turning one more webhook on — not a workspace-wide total.
 * `estimateCost`'s own arithmetic, never re-derived here.
 */
function webhookCostPerCandidate(): number {
  const estimate = estimateCost({
    durationMinutes: 0,
    resolved: resolveProctoring(undefined),
    webhookCount: 1,
    candidates: 1,
  });
  return estimate?.lines.find((line) => line.key === "webhooks")?.requestsPerCandidate ?? 1;
}

function notFound(): never {
  throw new ApiError(404, "not_found", "No such resource.");
}

export function webhookRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/webhooks", requires("workspace.settings"), async (c) => {
    const webhooks = await listWebhooks(deps.db, c.req.param("id"));
    return c.json({
      webhooks,
      // `K36`: omitted on `node`, never sent as `null`.
      ...(deps.env.target !== "node" && { costPerCandidate: webhookCostPerCandidate() }),
    });
  });

  routes.post("/:id/webhooks", requires("workspace.settings"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const input = parse(newWebhook, await json(c.req.raw));
    const now = deps.now();

    let created: { webhookId: string; signingSecret: string };
    try {
      created = await createWebhook(deps.db, workspaceId, {
        url: input.url,
        events: input.events as WebhookEvent[],
        now,
      });
    } catch (cause) {
      // `urlRefusal` (packages/db/src/net.ts) is the only other way this
      // throws — the events array is already narrowed to `WEBHOOK_EVENTS`
      // by the schema above, so a thrown error here is always the SSRF
      // refusal, never the closed-set one zod already enforced.
      throw new ApiError(422, "url_refused", cause instanceof Error ? cause.message : "That URL cannot be used.");
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "webhook.create",
      target: created.webhookId,
      detail: { events: input.events },
      now,
    });

    // The one response that ever carries the secret (`KG5`) — every other
    // route in this file answers the `webhook` shape `listWebhooks` reads,
    // which never includes it.
    return c.json(
      { id: created.webhookId, url: input.url, events: input.events, signingSecret: created.signingSecret },
      201,
    );
  });

  routes.patch("/:id/webhooks/:webhookId", requires("workspace.settings"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const webhookId = c.req.param("webhookId");
    const patch = parse(webhookPatch, await json(c.req.raw));
    const now = deps.now();

    try {
      await setWebhookActive(deps.db, workspaceId, webhookId, patch.active);
    } catch {
      // `setWebhookActive` throws only when the row is not in this
      // workspace — S-09's 404, not a 403 that would confirm the id.
      notFound();
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "webhook.update",
      target: webhookId,
      detail: { active: patch.active },
      now,
    });

    // Echoes the patch rather than re-reading the row: there is no
    // single-row `getWebhook` (nothing else needs one), and a second
    // `listWebhooks` just to hand back what the caller already sent would
    // be a subrequest spent proving the write worked rather than doing
    // anything a client with a 200 doesn't already know.
    return c.json({ id: webhookId, active: patch.active });
  });

  routes.delete("/:id/webhooks/:webhookId", requires("workspace.settings"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const webhookId = c.req.param("webhookId");
    const now = deps.now();

    try {
      await deleteWebhook(deps.db, workspaceId, webhookId);
    } catch {
      notFound();
    }

    await appendAudit(deps.db, workspaceId, {
      actor: actor.userId,
      action: "webhook.delete",
      target: webhookId,
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
