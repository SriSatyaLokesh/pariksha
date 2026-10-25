// Ephemeral demo workspace provisioning endpoint.
//
// Public endpoint for prospective evaluators. Rate-limited to max 5 per IP /
// hour, seeds a showcase workspace with a question bank, published test with 3
// sections, and 5 attempt rows with realistic flags (clean, review, scoring_blocked)
// via a single D1 db.batch() call. Issues an Owner session cookie.

import { Hono } from "hono";
import { newId, seedDemoWorkspace, takeRateToken } from "@pariksha/db";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { issueSession } from "../auth/session.js";
import { setSessionCookie } from "../middleware/authenticate.js";
import { clientIp } from "../run/net.js";

const RATE_LIMIT_WINDOW_MS = 3600_000; // 1 hour
const RATE_LIMIT_MAX = 5;

export function demoRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.post("/provision", async (c) => {
    const ip = clientIp(c) ?? "127.0.0.1";
    const bucket = `demo_provision:${ip}`;
    const now = deps.now();

    const count = await takeRateToken(deps.db, bucket, RATE_LIMIT_WINDOW_MS, now);
    if (count > RATE_LIMIT_MAX) {
      throw new ApiError(429, "too_many_requests", "Rate limit exceeded. Maximum 5 demo workspaces per hour.");
    }

    const workspaceId = newId("wsp");
    const seed = await seedDemoWorkspace(deps.db, workspaceId, { now });

    const { token } = await issueSession(deps, seed.userId);
    await setSessionCookie(c, deps, token);

    return c.json(
      {
        ok: true,
        workspace: {
          id: seed.workspace.id,
          slug: seed.workspace.slug,
          isDemo: true,
        },
      },
      201,
    );
  });

  return routes;
}
