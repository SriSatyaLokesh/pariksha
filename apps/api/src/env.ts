// Environment parsing, one schema per runtime target. The two targets differ
// in kind, not in degree: on Workers the database and bucket arrive as
// bindings the platform injects, so there is nothing to configure, while Node
// has to be told where both live. A union rather than one interface with
// empty strings on Workers, so a Node-only setting cannot be read on Workers
// at all.

import { z } from "zod";

const secret = z.string().min(1);

/**
 * One OIDC provider as it is registered. `redirectUri` is per provider rather
 * than derived from a base URL: it has to match what was entered in the
 * provider's own console byte for byte, so configuring it anywhere else just
 * moves where the mismatch is discovered.
 */
const oidcProvider = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  issuer: z.url(),
  clientId: z.string().min(1),
  clientSecret: secret,
  redirectUri: z.url(),
  scopes: z.array(z.string().min(1)).default(["openid", "email", "profile"]),
  // `email_verified` is OPTIONAL in OpenID Connect, so a provider may simply
  // stay silent about it. Since the account is keyed by email, a silent
  // provider is indistinguishable from an unverified address, and sign-in
  // fails closed. An operator who knows their provider verifies addresses
  // out of band sets this deliberately, per provider — it is never a default,
  // because the cost of guessing wrong is signing someone in as the owner.
  allowUnverifiedEmail: z.boolean().default(false),
});

export type OidcProvider = z.infer<typeof oidcProvider>;

/** A transactional-email endpoint: one adapter, any provider, no SDK. */
export interface EmailConfig {
  endpoint: string;
  token: string;
  from: string;
}

/** A hosted captcha an operator turned on for their own instance. */
export interface CaptchaConfig {
  secret: string;
  verifyUrl: string;
}

const json = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((raw, ctx) => {
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "is not valid JSON" });
        return z.NEVER;
      }
    })
    .pipe(schema);

/**
 * Sign-in configuration, identical on both targets: neither OIDC nor the
 * email sender is a binding the platform injects, so there is nothing for
 * Workers and Node to disagree about. Every field is optional — an instance
 * may ship magic link only, OIDC only, or (in development) neither.
 */
const auth = z.object({
  OIDC_PROVIDERS: json(z.array(oidcProvider)).optional(),
  EMAIL_ENDPOINT: z.url().optional(),
  EMAIL_TOKEN: secret.optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  /** Lets an operator keep the console sender past a production deploy. */
  EMAIL_CONSOLE: z.literal("true").optional(),
  NODE_ENV: z.string().min(1).optional(),
  /** Origin the magic-link URL is built against. */
  APP_URL: z.url().optional(),
  /**
   * The hosted-captcha opt-in (ADR 0009). Both or neither: an endpoint
   * with no secret is a verification that fails on the first real
   * registration rather than at boot, and a secret with no endpoint is a
   * setting that silently does nothing. The provider's URL is
   * configuration rather than a constant, which is what keeps a
   * third-party origin out of this source tree — `S-11`.
   */
  CAPTCHA_SECRET: secret.optional(),
  CAPTCHA_VERIFY_URL: z.url().optional(),
  /** Controls email-and-password authentication on Node/Docker (S-01). */
  PASSWORD_AUTH: z.enum(["true", "false"]).optional(),
});

const workers = auth.extend({ SESSION_SECRET: secret });

const node = auth.extend({
  SESSION_SECRET: secret,
  /** A better-sqlite3 path, or a `postgres://` URL. */
  DATABASE_URL: z.string().min(1),
  /** Directory the disk storage adapter writes to. */
  STORAGE_DIR: z.string().min(1).default("./data/storage"),
  /** Where signed disk URLs point, so a browser can fetch what was signed. */
  PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(8787),
  /** Optional directory serving the built web app. */
  STATIC_DIR: z.string().min(1).optional(),
  /** Optional S3 / MinIO storage configuration (S-02). */
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
});

/**
 * Unset sign-in settings stay `undefined` rather than becoming an empty
 * array or a `false`: "no provider configured" and "a provider list that
 * happens to be empty" are the same thing to every reader, and an absent key
 * is the shape the Workers target's existing contract already asserts.
 */
interface AuthEnv {
  oidcProviders?: OidcProvider[] | undefined;
  email?: EmailConfig | undefined;
  allowConsoleEmail?: true | undefined;
  passwordAuth?: boolean | undefined;
  nodeEnv?: string | undefined;
  appUrl?: string | undefined;
  /** Absent on every default deployment, which is the shipped answer to
   *  `S-07`'s first half (ADR 0009). */
  captcha?: CaptchaConfig | undefined;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string | undefined;
}

export type AppEnv =
  | ({ target: "workers"; sessionSecret: string } & AuthEnv)
  | ({
      target: "node";
      sessionSecret: string;
      databaseUrl: string;
      storageDir: string;
      publicUrl: string;
      port: number;
      staticDir?: string | undefined;
      s3?: S3Config | undefined;
    } & AuthEnv);

export function parseEnv(
  raw: Record<string, unknown>,
  target: "workers" | "node",
): AppEnv {
  if (target === "workers") {
    const parsed = take(workers, raw);
    return {
      target,
      sessionSecret: parsed.SESSION_SECRET,
      ...authEnv(parsed),
    };
  }

  const parsed = take(node, raw);
  const s3 =
    parsed.S3_ENDPOINT &&
    parsed.S3_BUCKET &&
    parsed.S3_ACCESS_KEY &&
    parsed.S3_SECRET_KEY
      ? {
          endpoint: parsed.S3_ENDPOINT,
          bucket: parsed.S3_BUCKET,
          accessKeyId: parsed.S3_ACCESS_KEY,
          secretAccessKey: parsed.S3_SECRET_KEY,
          region: parsed.S3_REGION,
        }
      : undefined;

  return {
    target,
    sessionSecret: parsed.SESSION_SECRET,
    databaseUrl: parsed.DATABASE_URL,
    storageDir: parsed.STORAGE_DIR,
    publicUrl: parsed.PUBLIC_URL,
    port: parsed.PORT,
    staticDir: parsed.STATIC_DIR,
    s3,
    ...authEnv(parsed),
  };
}

function authEnv(parsed: z.infer<typeof auth>): AuthEnv {
  // All three or none: an endpoint with no bearer token is a sender that
  // fails on the first real sign-in rather than at boot.
  const email =
    parsed.EMAIL_ENDPOINT && parsed.EMAIL_TOKEN && parsed.EMAIL_FROM
      ? {
          endpoint: parsed.EMAIL_ENDPOINT,
          token: parsed.EMAIL_TOKEN,
          from: parsed.EMAIL_FROM,
        }
      : undefined;

  const captcha =
    parsed.CAPTCHA_SECRET && parsed.CAPTCHA_VERIFY_URL
      ? { secret: parsed.CAPTCHA_SECRET, verifyUrl: parsed.CAPTCHA_VERIFY_URL }
      : undefined;

  return {
    oidcProviders: parsed.OIDC_PROVIDERS,
    email,
    captcha,
    allowConsoleEmail: parsed.EMAIL_CONSOLE === "true" ? true : undefined,
    passwordAuth: parsed.PASSWORD_AUTH === "false" ? false : undefined,
    nodeEnv: parsed.NODE_ENV,
    appUrl: parsed.APP_URL,
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
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== "") {
      cleaned[k] = v;
    }
  }
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;
  const named = result.error.issues
    .map((issue) => `${issue.path.join(".")} (${issue.message})`)
    .join(", ");
  throw new Error(`Invalid environment: ${named}`);
}
