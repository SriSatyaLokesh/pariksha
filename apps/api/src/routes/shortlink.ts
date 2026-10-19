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

export function shortlinkRoute(deps: AppDeps): Handler<AppBindings> {
  return async (c) => {
    const resolved = await resolveShortCode(deps.db, c.req.param("code") ?? "");
    if (!resolved) throw new ApiError(404, "not_found", "No such resource.");
    return c.redirect(`/${resolved.workspaceSlug}/${resolved.testSlug}`, 302);
  };
}
