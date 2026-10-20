// Invite minting — the organiser half of `invite_only` (#66, P6.2).
//
// This phase's one `workspace`-authority route, in an otherwise
// candidate-facing phase, which is exactly what `ROUTE_AUTH` was built
// for. Phase 5 owns the candidate list an invite is drawn from; Phase 6
// owns the token, because an invite's whole lifecycle — mint, deliver,
// consume, refuse a replay — is the access gate `run/entry.ts` already
// builds, on the `auth_token` table it already uses. Splitting it the
// other way would put `consumeAuthToken`'s single-use semantics in one
// phase and its only producer in another.
//
// Mounted under `/api/v1/workspaces` rather than at the PRD's bare
// `/tests/{id}/invites` for the reason every workspace route is:
// `guard()` reads `c.req.param("id")` and throws without it, and S-09's
// 404-not-403 depends on that segment naming the actor's own membership.
//
// `candidates.manage` — owner and admin, and nobody else. An Author who
// built the whole test cannot mint its invites, which is the permission
// matrix's own "Manage candidate lists and invites" line.

import { Hono } from "hono";
import { z } from "zod";
import {
  appendAudit,
  INVITE_KIND,
  inviteTarget,
  listCandidates,
  listInvitedExternalIds,
  type CandidateRow,
  type InvitePayload,
} from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { randomToken } from "../auth/tokens.js";
import { emailOf } from "../import/candidates.js";
import { inviteHash } from "../run/entry.js";
import { actorOr401, requires } from "../middleware/authorize.js";

/**
 * How long a minted link stays redeemable. Long enough that an organiser
 * can send links out weeks before a placement window; short enough that a
 * forwarded email from last year is not a way in.
 *
 * ponytail: a constant rather than the test's own `closes_at`. The window
 * can move after the links are sent, and an expiry that silently followed
 * it would strand an organiser who extended the test by a day. Re-minting
 * is one request.
 */
export const INVITE_TTL_MS = 90 * 86_400_000;

export interface MintedInvite {
  /** The `candidate` row, `source = "list"`. */
  listEntryId: string;
  /** Its `external_id` — the test's first `unique: true` registration
   *  field, which is what a candidate list is keyed on. */
  identifier: string;
  /** Out of `form_values_json`, keyed by the registration form's first
   *  `type: "email"` field. The `candidate` table has no email column
   *  (reconciliation row 14), so this is resolved, not read. */
  email: string | null;
  /** Absent when the entry already holds a live, unused invite: minting
   *  twice must not leave two links that both work. */
  url?: string;
}

const mintRequest = z.object({
  /** Absent or empty means every entry on the list. */
  identifiers: z.array(z.string().min(1).max(200)).max(5000).optional(),
});

export function inviteRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/:id/tests/:testId/invites", requires("candidates.manage"), async (c) => {
    const actor = actorOr401(c);
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    const now = deps.now();

    const parsed = mintRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Name the candidates to invite, or none for the whole list.");
    }
    const wanted = parsed.data.identifiers ?? [];

    // One statement, and the existence check: a test in another workspace
    // is simply not found, so this is 404 and never 403.
    const target = await inviteTarget(deps.db, workspaceId, testId);
    if (!target) throw new ApiError(404, "not_found", "No such resource.");

    const entries = await listCandidates(deps.db, workspaceId, testId, { source: "list" });
    const byIdentifier = new Map(
      entries.flatMap((entry) => (entry.externalId === null ? [] : [[entry.externalId, entry] as const])),
    );

    // All or nothing. A batch with one unknown identifier writes nothing,
    // so an organiser never half-sends a list and then has to work out
    // which half.
    const unknown = wanted.filter((identifier) => !byIdentifier.has(identifier));
    if (unknown.length > 0) {
      throw new ApiError(422, "unknown_candidates", "Some of those are not on this test's candidate list.", {
        unknown,
      });
    }
    const selected =
      wanted.length === 0 ? entries : wanted.map((identifier) => byIdentifier.get(identifier) as CandidateRow);

    // Keyed by identity, not by row id: a list re-upload re-ids every
    // unregistered row, and an invite that followed the id would be
    // re-minted (a second live link) or orphaned.
    const alreadyInvited = new Set(await listInvitedExternalIds(deps.db, workspaceId, { testId, now }));

    const base = (deps.env.appUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
    const writes: { sql: string; params: unknown[] }[] = [];
    const invites: MintedInvite[] = [];

    for (const entry of selected) {
      const invite: MintedInvite = {
        listEntryId: entry.id,
        identifier: entry.externalId ?? "",
        email: emailOf(entry, target.registrationForm),
      };
      invites.push(invite);
      if (alreadyInvited.has(entry.externalId ?? "")) continue;

      const token = randomToken();
      const payload: InvitePayload = {
        workspaceId,
        testId,
        candidateId: entry.id,
        externalId: entry.externalId ?? "",
        email: invite.email,
      };
      writes.push({
        sql:
          "INSERT INTO auth_token (token_hash, kind, payload_json, created_at, expires_at, used_at) " +
          "VALUES (?, ?, ?, ?, ?, NULL)",
        params: [
          await inviteHash(testId, token),
          INVITE_KIND,
          deps.db.jsonParam(payload),
          now,
          now + INVITE_TTL_MS,
        ],
      });
      // `T-02`: the candidate URL is `/<workspace-slug>/<test-slug>`, and
      // the invite is a query parameter on it rather than a path of its
      // own, so a candidate who loses the token still lands on the right
      // test and is told what to do.
      invite.url = `${base}/${target.workspaceSlug}/${target.testSlug}?invite=${token}`;
    }

    // One `db.batch` however long the list is — the cost is flat in its
    // size, which is what the measured budget pins.
    if (writes.length > 0) {
      await deps.db.batch(writes);
      // S-18. The count and the test, never a token and never the list:
      // an audit row that carried the links would be a second copy of
      // every credential, in a table built to be read.
      await appendAudit(deps.db, workspaceId, {
        actor: actor.userId,
        action: "invites.minted",
        target: testId,
        detail: { count: writes.length },
        now,
      });
    }

    return c.json({ invites });
  });

  return routes;
}
