// The first-run wizard, and Review Focus 1 of the Phase 3 plan.
//
// An endpoint that mints an instance owner is an instance takeover if it
// stays reachable one request too long, so two things decide its safety and
// neither is a setting:
//
//   1. **`needed` is computed, never stored.** It is "no workspace row
//      exists", asked of the database on every single call. A flag in
//      configuration, an environment variable or a row in a settings table
//      would all be re-openable by a redeploy or a restore from backup, and
//      re-opening this is handing the instance away.
//   2. **`complete` re-asks it inside the statement that inserts.** The
//      pre-check below is a courtesy that keeps a late caller cheap; the
//      authority is `createFirstWorkspace`, whose `WHERE NOT EXISTS` is
//      evaluated by the database as part of writing the row. Two
//      simultaneous completions cannot both win, because the loser's
//      statement matches nothing.
//
// `complete` also requires a session, and takes the owner's identity from
// it. The operator signs in through OIDC or a magic link first and *that*
// identity becomes the owner; an endpoint that accepted an email in its
// body would mint an owner for an address the caller does not control, and
// an unauthenticated one would hand the instance to the first stranger who
// finds the URL. Anything else the body carries is ignored, including
// `userId`, `email` and `role`.
//
// `status` is deliberately reachable unauthenticated — the sign-in screen
// calls it before anyone has signed in — so it answers two fields and no
// more: no user count, no address, no workspace name.

import { Hono } from "hono";
import { z } from "zod";
import {
  addMembership,
  anyWorkspaceExists,
  appendAudit,
  createFirstWorkspace,
  newId,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { identityProviders } from "../auth/identity.js";
import { ApiError } from "../errors.js";
import { actorOr401 } from "../middleware/authorize.js";

/**
 * `slug` is optional because the wizard screen asks for a name and nothing
 * else. Deriving one is better than generating a random address an operator
 * then has to live with, and a name that yields no usable slug is a 400
 * asking for one rather than a silent placeholder.
 */
const firstWorkspace = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().optional(),
});

/** The same shape `POST /workspaces` accepts, so the two cannot diverge. */
const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function setupRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/status", async (c) =>
    c.json({
      needed: !(await anyWorkspaceExists(deps.db)),
      providers: identityProviders(deps.env),
    }),
  );

  routes.post("/complete", async (c) => {
    const actor = actorOr401(c);
    const input = parse(firstWorkspace, await json(c.req.raw));
    const slug = slugOf(input);

    // Not the gate — the statement below is. This only spares a completed
    // instance the cost of an insert that was always going to be refused.
    if (await anyWorkspaceExists(deps.db)) throw alreadySetUp();

    const id = newId("wsp");
    const now = deps.now();
    if (
      !(await createFirstWorkspace(deps.db, id, {
        slug,
        name: input.name,
        now,
      }))
    )
      throw alreadySetUp();

    await addMembership(deps.db, id, {
      userId: actor.userId,
      role: "owner",
      now,
    });
    // S-18 lists member invites and workspace settings changes, and this is
    // the first and most consequential of both: it is the moment the
    // instance acquires an owner, and the only event in the product that
    // cannot be preceded by one. The row goes in the workspace it created,
    // which is what makes it scopable at all.
    await appendAudit(deps.db, id, {
      actor: actor.userId,
      action: "setup.complete",
      target: id,
      detail: { slug },
      now,
    });

    return c.json({ id, slug, name: input.name });
  });

  return routes;
}

function alreadySetUp(): ApiError {
  // Says nothing about who owns it or what it is called: this answer is
  // reachable by anyone holding any session on the instance.
  return new ApiError(
    409,
    "setup_complete",
    "This instance has already been set up.",
  );
}

function slugOf(input: { name: string; slug?: string | undefined }): string {
  const slug =
    input.slug ??
    input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
  if (SLUG.test(slug)) return slug;
  throw new ApiError(
    400,
    "invalid_request",
    "A workspace address is 2 to 63 characters of a-z, 0-9 and hyphens.",
    { issues: [{ path: "slug", message: "is not a usable slug" }] },
  );
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
