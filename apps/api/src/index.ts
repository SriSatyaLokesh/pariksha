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

/**
 * T-02's candidate URL, `/<workspace-slug>/<test-slug>`, with the slug
 * charset `routes/workspaces.ts` and `routes/tests.ts` mint and validate
 * (`^[a-z0-9][a-z0-9-]*$`). Narrow on purpose: a built asset is
 * `/assets/index-k5IQwTyP.css` or `/fonts/anek-latin.woff2`, and the dot
 * no slug may contain is what keeps this pattern off them even if
 * `run_worker_first`'s `!/assets/*` exclusion ever stops being honoured.
 * The optional trailing slash matches `slugPairFromPath`, which the shell
 * then reads the pair back out of.
 */
const CANDIDATE_URL = /^\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/?$/;

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
    // `/api/*` and `/t/:code` are the application's own paths — neither has
    // a file under `dist/`, so without `run_worker_first` the asset router's
    // 404 would answer both before Hono ever ran. Phase 5 Task 2 (#54):
    // `/t/:code` is the one route outside `/api/` this application mounts —
    // the public short link (Review Focus 5, ADR 0006's precedent).
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/") || path.startsWith("/t/")) {
      app ??= boot(env);
      return app.fetch(request, env, ctx);
    }

    // Everything else is the static site, and the binding serves it. Handing
    // the request back is what evaluates `not_found_handling` and serves
    // `404.html`; without it a visitor to a mistyped URL would get the API's
    // JSON error envelope instead of a page.
    //
    // The one exception is T-02's candidate URL, which has no file behind it
    // either. The shell is fetched from the binding under the ORIGINAL
    // request's URL — a rewrite, not a redirect, so the address bar keeps the
    // slug pair that `apps/web/src/exam-main.tsx` reads to know which test to
    // load. `_redirects` could not express this: `html_handling` turned its
    // rewrite to `/exam.html` into a redirect that stripped the `.html` and
    // the slug pair with it, which is why those rules were withdrawn in
    // fb42d41. For the same reason the shell is fetched at `/exam`, not
    // `/exam.html` — the binding redirects the latter. All of it is verified
    // against Miniflare, not assumed, in `test/worker.test.ts`.
    //
    // A two-segment path naming no real test gets the shell too, and the
    // shell's own "This test is not available" state after one API call.
    // That is ADR 0008's accepted cost, kept here: the alternative is a D1
    // read on every page view to tell a typo from a real slug pair, and
    // `exam.html` is `noindex` in both its meta tag and `_headers`.
    const served = CANDIDATE_URL.test(path)
      ? new Request(new URL("/exam", request.url), request)
      : request;
    // The cast is the seam between two declarations of the same runtime
    // type: `@cloudflare/workers-types` and @types/node each define
    // `Request` and `Response`, and this file is compiled with both.
    return env.ASSETS.fetch(served as never) as unknown as Promise<Response>;
  },
};
