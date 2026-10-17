// The whole application, built from injected dependencies and nothing else.
// There is no module-level database, clock or bucket here, which is why every
// route is testable over in-memory adapters with no network and no fake
// timers — and why the Workers and Node entry points are binding code only.

import { Hono } from "hono";
import { requestId, type RequestIdVariables } from "hono/request-id";
import type { DbClient } from "@pariksha/db";
import type { StorageAdapter } from "@pariksha/storage";
import type { AppEnv } from "./env.js";
import { securityHeaders } from "./middleware/security.js";
import { logging } from "./middleware/logging.js";
import { errorEnvelope, notFoundEnvelope } from "./middleware/errorEnvelope.js";
import { health } from "./routes/health.js";

export interface AppDeps {
  db: DbClient;
  storage: StorageAdapter;
  /**
   * Injected for the same reason it is in storage: the server timer (AC-13)
   * and every expiry check read one clock, and a test moves it without
   * faking a global.
   */
  now: () => number;
  env: AppEnv;
}

export type AppBindings = { Variables: RequestIdVariables };

export function createApp(deps: AppDeps): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // Order matters: the ID exists before anything can log it, and the security
  // headers are set before a handler runs so they are on error responses too.
  app.use(requestId());
  app.use(securityHeaders);
  app.use(logging(deps.now));

  app.notFound(notFoundEnvelope);
  app.onError(errorEnvelope);

  app.get("/api/v1/health", health(deps));

  return app;
}
