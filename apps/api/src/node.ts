// Node entry. Binding code only, the mirror of index.ts: the same app over a
// local database and a disk bucket, so `pnpm dev` and a Docker install run
// exactly what Workers runs.

import { serve } from "@hono/node-server";
import { pgClient, sqliteClient } from "@pariksha/db";
import { diskAdapter } from "@pariksha/storage";
import { createApp } from "./app.js";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env, "node");
if (env.target !== "node") throw new Error("unreachable");

const db = env.databaseUrl.startsWith("postgres")
  ? pgClient(env.databaseUrl)
  : sqliteClient(env.databaseUrl);

const app = createApp({
  db,
  storage: diskAdapter({
    root: env.storageDir,
    baseUrl: `${env.publicUrl.replace(/\/$/, "")}/files`,
    secret: env.sessionSecret,
  }),
  now: () => Date.now(),
  env,
});

serve({ fetch: app.fetch, port: env.port });
