// Counting what a request spends against the Workers budget. ADR 0002: the
// free plan allows 50 subrequests per invocation and every D1, R2 and KV call
// is one, so the failure this file exists to catch is a route that issues a
// query per item — correct at ten rows, over the ceiling at sixty, and
// invisible to every other test.

import type { Hono } from "hono";
import type { DbClient } from "@pariksha/db";
import type { StorageAdapter } from "@pariksha/storage";
import type { Action } from "@pariksha/core";
import type { AppBindings, AppDeps } from "./app.js";
import { guardOf } from "./middleware/authorize.js";

/** Cloudflare Workers, free plan. A paid plan raises it; the guard does not. */
export const SUBREQUEST_LIMIT = 50;

export interface SubrequestCounts {
  db: number;
  storage: number;
  total: number;
}

/**
 * Wraps the injected dependencies so every call that costs a subrequest on
 * the platform costs one here too.
 *
 * Counted on the database: `exec`, `all`, `query` and `run` — the four that
 * reach D1. Not `jsonParam` or `jsonValue`, which only encode a value, and
 * not `close`, which releases a local connection and is a no-op on D1, the
 * one dialect the budget applies to.
 *
 * Counted on storage: `put`, `get`, `delete` and `list`. Not `signedUrl`:
 * the S3 and R2 adapters presign locally with `aws4fetch` and issue no
 * request, so counting it would make every budget read higher than the
 * platform charges and push routes toward handing out fewer URLs than they
 * should.
 */
export function countingDeps(deps: AppDeps): {
  deps: AppDeps;
  counts: () => SubrequestCounts;
} {
  let db = 0;
  let storage = 0;
  const inner = deps.db;
  const store = deps.storage;

  const countedDb: DbClient = {
    ...inner,
    exec: (sql: string) => {
      db++;
      return inner.exec(sql);
    },
    all: <T>(sql: string) => {
      db++;
      return inner.all<T>(sql);
    },
    query: <T>(sql: string, params?: unknown[]) => {
      db++;
      return inner.query<T>(sql, params);
    },
    run: (sql: string, params?: unknown[]) => {
      db++;
      return inner.run(sql, params);
    },
  };

  const countedStorage: StorageAdapter = {
    ...store,
    put: (key, body, opts) => {
      storage++;
      return store.put(key, body, opts);
    },
    get: (key) => {
      storage++;
      return store.get(key);
    },
    delete: (keys) => {
      storage++;
      return store.delete(keys);
    },
    list: (prefix, cursor) => {
      storage++;
      return store.list(prefix, cursor);
    },
  };

  return {
    deps: { ...deps, db: countedDb, storage: countedStorage },
    counts: () => ({ db, storage, total: db + storage }),
  };
}

/**
 * The mounted paths, read off Hono's own route table rather than a list kept
 * by hand — a hand-kept list would agree with itself forever and assert
 * nothing.
 *
 * Middleware shares that table, and the only thing separating it from a
 * handler is how it was registered: `app.use` records the method as `ALL`
 * over a wildcard path. Requiring both means an `app.all("/api/v1/x")` route
 * is still counted, so the guard fails closed — a path-exact `app.use` shows
 * up as a route wanting a budget line, which is noisy but visible, where the
 * reverse would be a route that silently escapes the check.
 */
export function mountedRoutes(app: Hono<AppBindings>): string[] {
  const paths = app.routes
    .filter((route) => !(route.method === "ALL" && route.path.includes("*")))
    .map((route) => route.path);
  return [...new Set(paths)].sort();
}

/**
 * The action each guarded route enforces, read off the same live table for
 * the same reason: `app.use` and `app.get` both record handlers there, and
 * the authorization middleware carries the action it was built with, so
 * what comes back is what is mounted rather than what someone wrote down.
 *
 * Keyed by method as well as path, because `GET /workspaces/:id` and
 * `PATCH /workspaces/:id` are one path and two different permissions.
 */
export function routeGuards(
  app: Hono<AppBindings>,
): Record<string, Action | null> {
  const guards: Record<string, Action | null> = {};
  for (const route of app.routes) {
    const guard = guardOf(route.handler);
    if (guard) guards[`${route.method} ${route.path}`] = guard.action;
  }
  return guards;
}

export function guardedRoutes(app: Hono<AppBindings>): string[] {
  return Object.keys(routeGuards(app)).sort();
}
