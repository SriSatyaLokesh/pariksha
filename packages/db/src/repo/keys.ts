// Scoped API keys: the organiser's second credential, alongside the session
// cookie (Phase 8d Task 2, `K25`, `K26`, `KG5`).
//
// `resolveApiKey` is deliberately **not** wrapped in `scoped()` and is
// exported from the package root instead of this barrel's entry in
// `repo/index.ts` — see that file's own comment. It takes no workspace ID:
// which workspace a presented secret belongs to is what it *produces*, not
// an argument it can take, the same reason `candidate-entry.ts` sits
// outside `repo/index.ts` (ADR 0006's same shape, one credential earlier).

import { ACTIONS, type Action } from "@pariksha/core";
import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

/**
 * `K26`: refused at creation, not merely at use. A leaked key able to mint
 * more keys, or to add or remove members, is not revocable by revoking it
 * — so no key may ever hold either action, whatever role minted it.
 * Checked inside `createApiKey` itself, not only by the route that calls
 * it, so the rule holds for every future caller.
 */
export const KEY_FORBIDDEN_ACTIONS: readonly Action[] = ["keys.manage", "members.manage"];

const ALL_ACTIONS: ReadonlySet<Action> = new Set(ACTIONS);
const FORBIDDEN_ACTIONS: ReadonlySet<Action> = new Set(KEY_FORBIDDEN_ACTIONS);

/** The organiser-facing shape. **Never** the secret or its hash (`KG5`) —
 * the one response that ever carries the secret is `createApiKey`'s own
 * return value, read once by the route and never again. */
export interface ApiKeyRow {
  id: string;
  name: string;
  scopes: Action[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdBy?: string | null | undefined;
}

interface ApiKeyRecord {
  id: string;
  name: string;
  scopes_json: unknown;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  created_by?: string | null | undefined;
}

const API_KEY_COLUMNS = "id, name, scopes_json, created_at, last_used_at, revoked_at, created_by";

function toApiKeyRow(db: DbClient, row: ApiKeyRecord): ApiKeyRow {
  return {
    id: row.id,
    name: row.name,
    scopes: db.jsonValue<Action[]>(row.scopes_json),
    createdAt: Number(row.created_at),
    lastUsedAt: row.last_used_at === null ? null : Number(row.last_used_at),
    revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
    createdBy: row.created_by ?? null,
  };
}

/** `pk_` plus 32 random bytes, hex — the same `crypto.getRandomValues`
 * source `ids.ts`'s `newId` and `webhooks.ts`'s signing secret both draw
 * from. Not an `IdPrefix`: this is a bearer secret handed to the organiser
 * once, never a row this database addresses by it — `api_key.id` (a
 * `key_` id, newId's own alphabet) is. */
function generateApiKeySecret(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return `pk_${hex}`;
}

/**
 * SHA-256 of the presented secret, hex. Stored and looked up by this,
 * never by the secret itself — `api_key.secret_hash` carries the unique
 * index (`api_key_secret_hash_uq`, since migration `0000`) this looks up
 * through, so resolution is one indexed equality read, never a scan, and
 * never an app-code comparison of the secret's own bytes. SHA-256 and not
 * a password hash, for the reason `apps/api/src/auth/session.ts` already
 * documents for the session token this mirrors: 256 bits of CSPRNG output
 * has nothing to brute-force and nothing a salt would buy.
 */
async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Mints a key and returns its secret — the one and only time this database
 * hands it back (`KG5`). `listApiKeys` below reads the same row and never
 * includes it.
 *
 * Refuses `KEY_FORBIDDEN_ACTIONS` outright (`K26`), before the row is
 * written. "A key may never widen what its creator could do" — scopes a
 * subset of the creator's own actions at creation time — is the route's
 * own check (`apps/api/src/routes/keys.ts`): it alone knows who the
 * creator is and what role they hold in this workspace. This function
 * knows neither, and enforces the one rule that holds regardless: nobody,
 * of any role, may mint a key that can manage keys or members.
 */
export const createApiKey = scoped(
  "createApiKey",
  async (
    db: DbClient,
    workspaceId: string,
    input: { name: string; scopes: readonly Action[]; now: number; createdBy?: string | null },
  ): Promise<{ apiKeyId: string; secret: string }> => {
    for (const scope of input.scopes) {
      if (!ALL_ACTIONS.has(scope)) {
        throw new Error(`createApiKey: "${scope}" is not an action.`);
      }
      if (FORBIDDEN_ACTIONS.has(scope)) {
        throw new Error(`createApiKey: "${scope}" may never be a key's scope (K26).`);
      }
    }

    const id = newId("key");
    const secret = generateApiKeySecret();
    const secretHash = await sha256Hex(secret);
    await db.run(
      "INSERT INTO api_key (id, workspace_id, name, secret_hash, scopes_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, workspaceId, input.name, secretHash, db.jsonParam(input.scopes), input.now, input.createdBy ?? null],
    );

    return { apiKeyId: id, secret };
  },
);

/** Every key in the workspace, active or revoked — the organiser's own
 * list. Never the secret or its hash (`KG5`). */
export const listApiKeys = scoped(
  "listApiKeys",
  async (db: DbClient, workspaceId: string): Promise<ApiKeyRow[]> => {
    const rows = await db.query<ApiKeyRecord>(
      `SELECT ${API_KEY_COLUMNS} FROM api_key WHERE workspace_id = ? ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map((row) => toApiKeyRow(db, row));
  },
);

/**
 * MINOR-6 (whole-branch review): a named error, not a plain `Error` — so
 * the route can tell "nothing to revoke" apart from a genuine D1 failure
 * (which also throws, from the `db.run` call above it) and turn only the
 * first into a 404. A blanket `catch {}` around this call would turn a
 * real outage into a silent 404, the exact shape `webhooks.ts`'s own
 * MINOR-3 lesson warns against for the opposite case (a real failure
 * reported as a refusal that never happened).
 */
export class ApiKeyNotFoundError extends Error {
  constructor(apiKeyId: string) {
    super(`revokeApiKey: no such active key "${apiKeyId}" in this workspace.`);
    this.name = "ApiKeyNotFoundError";
  }
}

/** Revokes the key outright. Throws `ApiKeyNotFoundError` when no such
 * *active* key exists in this workspace — already revoked, or never there
 * — which the route turns into its own 404, the same "existence is not
 * disclosed across a workspace boundary" shape `setWebhookActive`'s caller
 * already follows; any other throw (a genuine driver failure) is a
 * different error entirely and the route lets it surface as one. */
export const revokeApiKey = scoped(
  "revokeApiKey",
  async (db: DbClient, workspaceId: string, apiKeyId: string, now: number): Promise<void> => {
    const { changes } = await db.run(
      "UPDATE api_key SET revoked_at = ? WHERE workspace_id = ? AND id = ? AND revoked_at IS NULL",
      [now, workspaceId, apiKeyId],
    );
    if (changes === 0) throw new ApiKeyNotFoundError(apiKeyId);
  },
);

export const revokeApiKeysByCreator = scoped(
  "revokeApiKeysByCreator",
  async (db: DbClient, workspaceId: string, userId: string, now: number): Promise<number> => {
    const { changes } = await db.run(
      "UPDATE api_key SET revoked_at = ? WHERE workspace_id = ? AND created_by = ? AND revoked_at IS NULL",
      [now, workspaceId, userId],
    );
    return changes;
  },
);

/**
 * Resolves a presented `pk_…` secret to the workspace and scopes it
 * carries. `null` for anything that is not a live, unrevoked key —
 * malformed, unknown and revoked all fail exactly the same way (fail
 * closed; `authenticate.ts` turns `null` into "no actor", never a session
 * fallback). Looked up by the unique `secret_hash` index, never a scan.
 *
 * Stamps `last_used_at` on the **first** successful resolution of a UTC
 * day, not every one (MAJOR-2, whole-branch review) — unlike a session's
 * `touchSession`, this column is informational only (`ApiKeyPanel.tsx`
 * renders it as "Never used" / "Last used <date>", and nothing expires off
 * it), while a key exists precisely to be called in a loop a human session
 * never would; a write every request is
 * 86,400 of the account's 100k-writes-a-day allowance from one key polled
 * once a second, shared with every candidate attempt submission in the
 * product. `now` defaults to `Date.now()` only so the two-argument shape
 * callers outside `apps/api` would use still works; `authenticate.ts`
 * always passes `deps.now()`, the one clock every other expiry and
 * timestamp in this product reads (AC-13).
 *
 * `apiKeyId` rides along beyond the brief's own two-field shape: it is
 * what lets a key-authenticated request's audit row name *which* key
 * acted, the same way a session's audit rows name the user — without it
 * every key in a workspace would write audit rows indistinguishable from
 * one another, which is its own small hole in `K25`'s guarantee that a key
 * is an ordinary, accountable member of the authority it satisfies.
 */
export async function resolveApiKey(
  db: DbClient,
  presented: string,
  now: number = Date.now(),
): Promise<{ apiKeyId: string; workspaceId: string; scopes: Action[] } | null> {
  if (!presented.startsWith("pk_")) return null;

  const secretHash = await sha256Hex(presented);
  const rows = await db.query<{
    id: string;
    workspace_id: string;
    scopes_json: unknown;
    revoked_at: number | null;
    last_used_at: number | null;
  }>(
    "SELECT id, workspace_id, scopes_json, revoked_at, last_used_at FROM api_key WHERE secret_hash = ?",
    [secretHash],
  );
  const row = rows[0];
  if (!row || row.revoked_at !== null) return null;

  // MAJOR-2 (whole-branch review): a write every request is 86,400 writes a
  // day from one key polled once a second, against a 100k-write-a-day
  // account-wide allowance shared with every candidate attempt submission
  // in the product — for a column `ApiKeyPanel.tsx` renders as "Never
  // used" / "Last used <date>", not a security control a tighter write
  // schedule would strengthen. `last_used_at` is already in the SELECT
  // above (free — same row, same index read), so a day boundary is checked
  // in memory and the write only happens at most once per key per day:
  // 86,400 -> at most 1.
  const DAY_MS = 86_400_000;
  if (row.last_used_at === null || Math.floor(row.last_used_at / DAY_MS) !== Math.floor(now / DAY_MS)) {
    await db.run("UPDATE api_key SET last_used_at = ? WHERE secret_hash = ?", [now, secretHash]);
  }

  return {
    apiKeyId: row.id,
    workspaceId: row.workspace_id,
    scopes: db.jsonValue<Action[]>(row.scopes_json),
  };
}
