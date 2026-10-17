// The workspace guard.
//
// One missing `WHERE workspace_id = ?` is a cross-tenant data leak, and it
// will be added by someone shipping a feature in Phase 7, not by someone
// editing this file. So the guard is structural: a repository function is
// reachable only through `scoped()`, which refuses a missing or malformed
// workspace ID and registers itself by name. A test then enumerates the
// registry and proves the rule for every function that exists — including
// ones written long after this was.

import { isId } from "../ids.js";
import type { DbClient } from "../client.js";

export type ScopedFn<A extends unknown[], R> = (
  db: DbClient,
  workspaceId: string,
  ...rest: A
) => Promise<R>;

/** Every scoped() result, by name. The suite reads this to prove the rule. */
export const REPO_FUNCTIONS: Record<string, ScopedFn<never[], unknown>> = {};

export class WorkspaceScopeError extends Error {
  constructor(name: string, received: string) {
    super(
      `${name}: a workspace ID is required as the first argument after the database, ` +
        `and must be a wsp_ ID (received ${received === "" ? "an empty string" : `"${received}"`}).`,
    );
    this.name = "WorkspaceScopeError";
  }
}

/**
 * Wraps a repository function so it cannot run without a workspace, and
 * registers it. The name is the exported function's own name.
 */
export function scoped<A extends unknown[], R>(
  name: string,
  fn: ScopedFn<A, R>,
): ScopedFn<A, R> {
  if (name in REPO_FUNCTIONS) {
    throw new Error(`Two repository functions are registered as "${name}"`);
  }

  const wrapped: ScopedFn<A, R> = (db, workspaceId, ...rest) => {
    // A test ID where a workspace ID belongs is the realistic slip: both are
    // strings of the same shape, and only the prefix says which is which.
    if (!isId(workspaceId, "wsp")) {
      return Promise.reject(new WorkspaceScopeError(name, workspaceId));
    }
    return fn(db, workspaceId, ...rest);
  };

  REPO_FUNCTIONS[name] = wrapped as unknown as ScopedFn<never[], unknown>;
  return wrapped;
}
