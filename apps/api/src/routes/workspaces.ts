// Workspaces and their members.
//
// Every route under `/:id` is mounted behind `requireMember` or
// `requires(...)`, so by the time a handler runs the actor is known to hold
// a membership in that workspace and S-09 has already been answered — a
// handler here never has to remember to check, and one that forgets cannot,
// because `ROUTE_ACTIONS` is asserted against the live route table.
//
// Role changes and removals call `revokeAllSessions` for the affected member
// (Review Focus 4). The session row is the only thing that grants anything,
// so dropping it is what makes a demotion take effect on the member's next
// request rather than at the end of their twelve-hour idle window.

import { Hono } from "hono";
import { z } from "zod";
import {
  addMembership,
  appendAudit,
  createWorkspace,
  findUserByEmail,
  createUser,
  getWorkspace,
  listMemberships,
  listUserWorkspaces,
  newId,
  removeMembership,
  setMembershipRole,
  updateWorkspace,
} from "@pariksha/db";
import { CREAM, EXAMPLE_BRAND_COLOUR, HEX_COLOUR, ROLES, contrastRatio, meetsAA } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { revokeAllSessions } from "../auth/session.js";
import { ApiError } from "../errors.js";
import { actorOnly, actorOr401, requireMember, requires } from "../middleware/authorize.js";

const newWorkspace = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}$/, "is not a usable slug"),
  name: z.string().min(1).max(200),
});

/**
 * T-23's workspace half (Task 10, #61, P5.8). `logo`, `logo_alt`,
 * `primary_colour` and `footer_text` are per workspace; `start_message`
 * and `finish_message` are per test and go through `PATCH .../draft`
 * instead. Only the four are accepted here, so an organiser cannot
 * smuggle a per-test field into workspace settings and wonder why no test
 * shows it.
 */
const brandingPatch = z
  .object({
    logo: z.string().max(200).optional(),
    logo_alt: z.string().max(300).optional(),
    primary_colour: z.string().optional(),
    footer_text: z.string().max(500).optional(),
  })
  .strict();

const workspacePatch = z
  .object({
    name: z.string().min(1).max(200).optional(),
    branding: brandingPatch.optional(),
    settings: z.unknown().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, "names nothing to change");

/**
 * **Save-time, deliberately.** An unchosen release date or a half-typed
 * access code is a draft; a stored brand colour below 4.5:1 is not — it is
 * a setting that makes candidate-facing text unreadable the moment any
 * page renders with it, the preview on the screen that set it included,
 * and `workspace.branding_json` has no draft state to be half-built in.
 *
 * The ground is `CREAM`, the candidate page's own background, and not "the
 * worse of cream and ink". The plan asked for "below 4.5:1 against cream
 * **and** ink", which measures nothing useful: its own example, `#f59a6e`,
 * reaches 7.57:1 against ink and would have passed, while being 2.09:1 —
 * illegible — on the page a candidate actually sees. `--brand-primary` is
 * accent text and link colour on cream; cream is the ground that matters.
 */
function refuseUnreadableBrandColour(branding: z.infer<typeof brandingPatch> | undefined): void {
  const colour = branding?.primary_colour;
  if (colour === undefined) return;
  if (!HEX_COLOUR.test(colour)) {
    throw new ApiError(422, "invalid_colour", `"${colour}" is not a colour. Use a hex value like ${EXAMPLE_BRAND_COLOUR}.`);
  }
  if (meetsAA(colour, CREAM)) return;
  const ratio = Math.round(contrastRatio(colour, CREAM) * 100) / 100;
  throw new ApiError(
    422,
    "unreadable_colour",
    `${colour} reaches only ${ratio}:1 against cream, and candidate text in the brand colour needs at least 4.5:1. Choose a darker shade.`,
  );
}

const memberInput = z
  .object({
    userId: z.string().optional(),
    email: z.string().min(3).max(320).optional(),
    role: z.enum(ROLES),
  })
  .refine(
    (input) => (input.userId === undefined) !== (input.email === undefined),
    "names either a user or an email address, not both",
  );

export function workspaceRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // CRITICAL (whole-branch review): `actorOnly()` on both — neither names a
  // workspace, so neither has an action for a key's scopes to be checked
  // against, which before this fix meant a key of any scope could list
  // every workspace its creator belongs to, or create a brand new one and
  // write an orphan `membership` row under its own key id.
  routes.get("/", actorOnly(), async (c) => {
    const actor = actorOr401(c);
    return c.json({ workspaces: await listUserWorkspaces(deps.db, actor.userId) });
  });

  // Not guarded by an action: creating a workspace is what someone with no
  // membership anywhere does first, so there is no role to consult.
  routes.post("/", actorOnly(), async (c) => {
    const actor = actorOr401(c);
    const input = parse(newWorkspace, await json(c.req.raw));
    const id = newId("wsp");
    const now = deps.now();

    try {
      await createWorkspace(deps.db, id, { ...input, now });
    } catch {
      // `slug` is unique, and the only way this statement fails in practice.
      throw new ApiError(409, "slug_taken", "That workspace address is in use.");
    }
    await addMembership(deps.db, id, { userId: actor.userId, role: "owner", now });

    return c.json({ id, slug: input.slug, name: input.name }, 201);
  });

  routes.get("/:id", requireMember(), async (c) => {
    const workspace = await getWorkspace(deps.db, c.req.param("id"));
    // The membership was proved by the guard, so a null here is a row that
    // vanished between the session read and this one.
    if (!workspace) throw new ApiError(404, "not_found", "No such resource.");
    return c.json(workspace);
  });

  routes.patch("/:id", requires("workspace.settings"), async (c) => {
    const actor = actorOr401(c);
    const id = c.req.param("id");
    const patch = parse(workspacePatch, await json(c.req.raw));
    refuseUnreadableBrandColour(patch.branding);

    await updateWorkspace(deps.db, id, patch);
    await appendAudit(deps.db, id, {
      actor: actor.userId,
      action: "workspace.settings",
      target: id,
      // The keys that changed, not the values: a workspace setting can carry
      // a contact address, and the audit log is read by more people than the
      // settings page is.
      detail: { fields: Object.keys(patch).sort() },
      now: deps.now(),
    });

    return c.json(await getWorkspace(deps.db, id));
  });

  routes.get("/:id/members", requires("members.manage"), async (c) =>
    c.json({ members: await listMemberships(deps.db, c.req.param("id")) }),
  );

  routes.post("/:id/members", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const input = parse(memberInput, await json(c.req.raw));

    const userId = input.userId ?? (await invitee(deps, input.email ?? ""));
    const members = await listMemberships(deps.db, workspaceId);
    const existing = members.find((member) => member.userId === userId);

    if (!existing) {
      await addMembership(deps.db, workspaceId, {
        userId,
        role: input.role,
        now: deps.now(),
      });
      await audit(deps, workspaceId, actor.userId, "member.invite", userId, {
        role: input.role,
      });
      return c.json({ userId, role: input.role }, 201);
    }

    if (existing.role === input.role) return c.json({ userId, role: input.role });
    refuseIfLastOwner(members, existing.role, input.role);

    await setMembershipRole(deps.db, workspaceId, { userId, role: input.role });
    // Before the audit row, not after: a demotion that is logged but not
    // enforced is the failure this ordering makes impossible to ship.
    await revokeAllSessions(deps, userId);
    await audit(deps, workspaceId, actor.userId, "member.role_change", userId, {
      from: existing.role,
      to: input.role,
    });

    return c.json({ userId, role: input.role });
  });

  routes.delete("/:id/members", requires("members.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const userId = c.req.query("userId") ?? "";

    const members = await listMemberships(deps.db, workspaceId);
    const existing = members.find((member) => member.userId === userId);
    if (!existing) throw new ApiError(404, "not_found", "No such resource.");
    refuseIfLastOwner(members, existing.role, null);

    await removeMembership(deps.db, workspaceId, userId);
    await revokeAllSessions(deps, userId);
    await audit(deps, workspaceId, actor.userId, "member.remove", userId, {
      role: existing.role,
    });

    return c.body(null, 204);
  });

  return routes;
}

/**
 * A workspace whose last owner is demoted or removed can never be
 * administered again by anyone, and nothing in the product undoes it — the
 * remaining members cannot grant themselves `members.manage`, because that
 * is the permission they just lost access to.
 */
function refuseIfLastOwner(
  members: { role: string }[],
  from: string,
  to: string | null,
): void {
  if (from !== "owner" || to === "owner") return;
  if (members.filter((member) => member.role === "owner").length > 1) return;
  throw new ApiError(
    409,
    "last_owner",
    "A workspace keeps at least one owner. Make someone else an owner first.",
  );
}

/**
 * An invitation names an address that may have no account yet, so one is
 * created: the row is what the membership points at, and the person still
 * has to pass a sign-in flow before it means anything.
 */
async function invitee(deps: AppDeps, email: string): Promise<string> {
  const address = email.trim().toLowerCase();
  return (
    (await findUserByEmail(deps.db, address)) ??
    (await createUser(deps.db, {
      email: address,
      authProvider: "invite",
      now: deps.now(),
    }))
  );
}

function audit(
  deps: AppDeps,
  workspaceId: string,
  actor: string,
  action: string,
  target: string,
  detail: Record<string, unknown>,
): Promise<string> {
  return appendAudit(deps.db, workspaceId, {
    actor,
    action,
    target,
    detail,
    now: deps.now(),
  });
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
