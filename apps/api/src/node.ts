// Node entry. Binding code only, the mirror of index.ts: the same app over a
// local database and a disk or S3 bucket, so `pnpm dev` and a Docker install run
// exactly what Workers runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { migrate, pgClient, sqliteClient, type DbClient } from "@pariksha/db";
import { diskAdapter, s3Adapter, type StorageAdapter } from "@pariksha/storage";
import { createApp, type AppDeps } from "./app.js";
import { parseEnv, type AppEnv } from "./env.js";
import { runScheduledDue } from "./scheduled.js";

/**
 * T-02's candidate URL, `/<workspace-slug>/<test-slug>`, matching CANDIDATE_URL in index.ts.
 */
const CANDIDATE_URL = /^\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/?$/;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Creates a static file handler for serving built SPA assets from STATIC_DIR.
 */
export function createStaticHandler(staticDir: string) {
  return async function handleStatic(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);

    // Directory traversal guard
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");

    // 1. Admin routes -> admin.html
    if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      const adminPath = path.join(staticDir, "admin.html");
      if (fs.existsSync(adminPath)) {
        return new Response(await fs.promises.readFile(adminPath), {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }
    }

    // 2. Exact file on disk (assets, fonts, icons, etc.)
    const directFile = path.join(staticDir, safePath);
    try {
      const stat = await fs.promises.stat(directFile);
      if (stat.isFile()) {
        const ext = path.extname(directFile).toLowerCase();
        const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
        const isImmutable = pathname.startsWith("/assets/");
        const cacheControl = isImmutable
          ? "public, max-age=31536000, immutable"
          : ext === ".html"
            ? "no-cache"
            : "public, max-age=3600";

        return new Response(await fs.promises.readFile(directFile), {
          status: 200,
          headers: {
            "content-type": contentType,
            "cache-control": cacheControl,
          },
        });
      }
    } catch {
      // not a direct file
    }

    // 3. Candidate test URL -> exam.html
    if (CANDIDATE_URL.test(pathname)) {
      const examPath = path.join(staticDir, "exam.html");
      if (fs.existsSync(examPath)) {
        return new Response(await fs.promises.readFile(examPath), {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }
    }

    // 4. SPA HTML fallback (for non-asset paths without extension)
    if (!path.extname(pathname)) {
      const indexPath = path.join(staticDir, "index.html");
      if (fs.existsSync(indexPath)) {
        return new Response(await fs.promises.readFile(indexPath), {
          status: 200,
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-cache",
          },
        });
      }
    }

    return null;
  };
}

/**
 * Boots the Node server, mounts API and static handlers, and sets up periodic cron worker.
 */
export async function startNodeServer(
  options: {
    env?: AppEnv;
    db?: DbClient;
    storage?: StorageAdapter;
    port?: number;
    enableScheduler?: boolean;
  } = {},
): Promise<{
  server: ReturnType<typeof serve>;
  close: () => Promise<void>;
  port: number;
  deps: AppDeps;
  timer?: NodeJS.Timeout | undefined;
}> {
  const env = options.env ?? parseEnv(process.env, "node");
  if (env.target !== "node") throw new Error("Target must be 'node'");

  const db =
    options.db ??
    (env.databaseUrl.startsWith("postgres")
      ? pgClient(env.databaseUrl)
      : sqliteClient(env.databaseUrl));

  // Run migrations on start
  await migrate(db);

  const storage =
    options.storage ??
    (env.s3
      ? s3Adapter({
          bucket: env.s3.bucket,
          accessKeyId: env.s3.accessKeyId,
          secretAccessKey: env.s3.secretAccessKey,
          endpoint: env.s3.endpoint,
          ...(env.s3.region !== undefined ? { region: env.s3.region } : {}),
        })
      : diskAdapter({
          root: env.storageDir,
          baseUrl: `${env.publicUrl.replace(/\/$/, "")}/files`,
          secret: env.sessionSecret,
        }));

  const deps: AppDeps = {
    db,
    storage,
    now: () => Date.now(),
    env,
  };

  const app = createApp(deps);
  const staticHandler = env.staticDir ? createStaticHandler(env.staticDir) : null;

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/t/")) {
      return app.fetch(request);
    }
    if (staticHandler) {
      const res = await staticHandler(request);
      if (res) return res;
    }
    return app.fetch(request);
  };

  const port = options.port ?? env.port;
  const server = serve({ fetch, port });

  let timer: NodeJS.Timeout | undefined;
  if (options.enableScheduler !== false) {
    timer = setInterval(() => {
      void runScheduledDue(deps).catch((err) => {
        console.error("Scheduled job error:", err);
      });
    }, 60_000);
    timer.unref();
  }

  const close = async () => {
    if (timer) clearInterval(timer);
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return { server, close, port, deps, timer };
}

const isMain =
  !process.env.VITEST &&
  Boolean(
    process.argv[1] &&
      (process.argv[1].endsWith("node.ts") ||
        process.argv[1].endsWith("node.js") ||
        (import.meta.url &&
          path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))),
  );

if (isMain) {
  const env = parseEnv(process.env, "node");
  if (env.target !== "node") throw new Error("unreachable");
  await startNodeServer({ env });
}
