// Liveness plus the two facts that tell an operator which deployment they are
// looking at: the dialect this instance opened, and how many migrations it
// has applied. An unmigrated or unreachable database fails the query, which
// is the 500 a health check is supposed to give.

import type { Handler } from "hono";
import { MIGRATIONS_TABLE } from "@pariksha/db";
import type { AppDeps } from "../app.js";

export function health(deps: AppDeps): Handler {
  return async (c) => {
    // One query, not one per migration: the Workers subrequest budget is 50
    // per invocation and a health check must not be the thing that spends it.
    const applied = await deps.db.all<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_TABLE}`,
    );
    return c.json({
      status: "ok",
      dialect: deps.db.dialect,
      migrations: applied.length,
    });
  };
}
