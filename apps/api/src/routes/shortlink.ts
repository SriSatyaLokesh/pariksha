// T-02's public short link: `GET /t/:code`. The one route in this
// application outside the workspace guard (`apps/api/src/app.ts`'s header),
// following ADR 0006's precedent for identity reads — a short code names no
// workspace, so there is no `:id` for `requires()`/`requireMember()` to read
// in the first place.
//
// It answers with a redirect and nothing else: a 404 for an unknown code
// names no workspace (`resolveShortCode` returns `null` either for "no such
// code" or implicitly for a workspace that is itself gone), and a 302 for a
// live one carries only the public candidate path — never the row's own
// `tst_`/`wsp_` IDs, which would leak internal identifiers to an
// unauthenticated caller.

import type { Handler } from "hono";
import { resolveShortCode } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { limitOrThrow } from "../run/limit.js";

export function shortlinkRoute(deps: AppDeps): Handler<AppBindings> {
  return async (c) => {
    const code = c.req.param("code") ?? "";
    const resolved = await resolveShortCode(deps.db, code);
    // `S-07`, carried here from Phase 5's handoff by way of the Phase 6
    // reconciliation: six characters is the one thing on this instance a
    // stranger can guess at, so a code that resolved to **nothing** is
    // charged. A code that resolved is not — a hall of candidates opening
    // the one link on the projector is the expected load, not an attack,
    // and charging it would turn the busiest minute of a live test into a
    // lockout. Keyed on the code, never on an address: a campus shares one.
    if (!resolved) {
      await limitOrThrow(deps, "short_link", code);
      throw new ApiError(404, "not_found", "No such resource.");
    }
    return c.redirect(`/${resolved.workspaceSlug}/${resolved.testSlug}`, 302);
  };
}
