// Workers entry. Binding code only: it turns the Worker's env into AppDeps
// and hands them to createApp. Anything worth a test lives in app.ts.

import type {
  D1Database,
  ExecutionContext,
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
    app ??= boot(env);
    return app.fetch(request, env, ctx);
  },
};
