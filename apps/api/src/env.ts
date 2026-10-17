// Environment parsing, one schema per runtime target. The two targets differ
// in kind, not in degree: on Workers the database and bucket arrive as
// bindings the platform injects, so there is nothing to configure, while Node
// has to be told where both live. A union rather than one interface with
// empty strings on Workers, so a Node-only setting cannot be read on Workers
// at all.

import { z } from "zod";

const secret = z.string().min(1);

const workers = z.object({ SESSION_SECRET: secret });

const node = z.object({
  SESSION_SECRET: secret,
  /** A better-sqlite3 path, or a `postgres://` URL. */
  DATABASE_URL: z.string().min(1),
  /** Directory the disk storage adapter writes to. */
  STORAGE_DIR: z.string().min(1),
  /** Where signed disk URLs point, so a browser can fetch what was signed. */
  PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(8787),
});

export type AppEnv =
  | { target: "workers"; sessionSecret: string }
  | {
      target: "node";
      sessionSecret: string;
      databaseUrl: string;
      storageDir: string;
      publicUrl: string;
      port: number;
    };

export function parseEnv(
  raw: Record<string, unknown>,
  target: "workers" | "node",
): AppEnv {
  if (target === "workers") {
    const { SESSION_SECRET } = take(workers, raw);
    return { target, sessionSecret: SESSION_SECRET };
  }

  const parsed = take(node, raw);
  return {
    target,
    sessionSecret: parsed.SESSION_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    storageDir: parsed.STORAGE_DIR,
    publicUrl: parsed.PUBLIC_URL,
    port: parsed.PORT,
  };
}

/**
 * Fails with the variable names, not Zod's issue dump: the message is read by
 * someone staring at a container that will not boot, and the only thing they
 * need is which secret is missing.
 */
function take<T extends z.ZodType>(
  schema: T,
  raw: Record<string, unknown>,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const named = result.error.issues
    .map((issue) => `${issue.path.join(".")} (${issue.message})`)
    .join(", ");
  throw new Error(`Invalid environment: ${named}`);
}
