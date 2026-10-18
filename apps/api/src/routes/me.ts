// Who the browser is signed in as, and what it may act on. Everything here
// is already on `c.var.actor`, so the route costs no subrequest beyond the
// one authentication spends — which is what lets the web application ask on
// every page load.

import type { Handler } from "hono";
import type { AppBindings } from "../app.js";
import { actorOr401 } from "../middleware/authorize.js";

export function me(): Handler<AppBindings> {
  return (c) => {
    const actor = actorOr401(c);
    return c.json({
      user: { id: actor.userId, email: actor.email },
      memberships: actor.memberships,
    });
  };
}
