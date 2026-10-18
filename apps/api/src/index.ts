// Workers entry. Binding code only: it turns the Worker's env into AppDeps
// and hands them to createApp. Anything worth a test lives in app.ts.

import type {
  D1Database,
  ExecutionContext,
  Fetcher,
  R2Bucket,
} from "@cloudflare/workers-types";
import { d1Client } from "@pariksha/db";
import { r2BindingAdapter } from "@pariksha/storage";
import { createApp, type AppDeps } from "./app.js";
import { parseEnv } from "./env.js";

interface WorkerEnv {
  DB: D1Database;
  FILES: R2Bucket;
  SESSION_SECRET: string;
  /** The built web app. One Worker serves both halves — see wrangler.toml. */
  ASSETS: Fetcher;
}

// Built once per isolate rather than once per request: the bindings are
// stable for the isolate's life, and routing tables are not free to rebuild.
let app: ReturnType<typeof createApp> | undefined;

function boot(env: WorkerEnv): ReturnType<typeof createApp> {
  const deps: AppDeps = {
    db: d1Client(env.DB),
    storage: r2BindingAdapter(env.FILES),
    now: () => Date.now(),
    env: parseEnv(env as unknown as Record<string, unknown>, "workers"),
  };
  return createApp(deps);
}

export default {
  fetch(
    request: Request,
    env: WorkerEnv,
    ctx: ExecutionContext,
  ): Response | Promise<Response> {
    // Asset requests that matched a file never reach here (`run_worker_first`
    // covers `/api/*` only). The ones that do are paths with no file, and
    // handing them back to the binding is what evaluates
    // `not_found_handling` and serves `404.html`. Without this they fall
    // through to Hono and a visitor to a mistyped URL gets the API's JSON
    // error envelope instead of a page — verified against Miniflare, not
    // assumed, in `test/worker.test.ts`.
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      // The cast is the seam between two declarations of the same runtime
      // type: `@cloudflare/workers-types` and @types/node each define
      // `Request` and `Response`, and this file is compiled with both.
      return env.ASSETS.fetch(request as never) as unknown as Promise<Response>;
    }
    app ??= boot(env);
    return app.fetch(request, env, ctx);
  },
};
