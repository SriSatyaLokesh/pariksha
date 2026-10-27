// BYOK encrypted provider credentials and usage telemetry repository (Phase 12, S-15).
// Every function is guarded with scoped() to enforce strict tenant isolation.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export type ByokProvider = "anthropic" | "openai" | "openrouter" | "gemini";

export interface ByokCredentialRow {
  id: string;
  provider: ByokProvider;
  keyHint: string;
  spendLimitCents: number | null;
  status: "active" | "revoked";
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
}

export interface ByokInternalCredential {
  id: string;
  provider: ByokProvider;
  encryptedKey: string;
  keyHint: string;
  spendLimitCents: number | null;
  status: "active" | "revoked";
}

export interface ByokUsageSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCostCents: number;
}

interface RawCredentialRecord {
  id: string;
  provider: string;
  encrypted_key: string;
  key_hint: string;
  spend_limit_cents: number | null;
  status: string;
  created_at: number;
  updated_at: number;
  last_used_at: number | null;
}

export const setByokCredential = scoped(
  "setByokCredential",
  async (
    db: DbClient,
    workspaceId: string,
    provider: ByokProvider,
    encryptedKey: string,
    keyHint: string,
    spendLimitCents: number | null = null,
  ): Promise<ByokCredentialRow> => {
    const now = Date.now();
    const rows = await db.query<RawCredentialRecord>(
      "SELECT id, created_at FROM byok_credential WHERE workspace_id = ? AND provider = ?",
      [workspaceId, provider],
    );
    const existing = rows[0];

    if (existing) {
      await db.run(
        "UPDATE byok_credential SET encrypted_key = ?, key_hint = ?, spend_limit_cents = ?, status = 'active', updated_at = ? WHERE workspace_id = ? AND id = ?",
        [encryptedKey, keyHint, spendLimitCents, now, workspaceId, existing.id],
      );
      return {
        id: existing.id,
        provider,
        keyHint,
        spendLimitCents,
        status: "active",
        createdAt: Number(existing.created_at),
        updatedAt: now,
        lastUsedAt: null,
      };
    }

    const id = newId("byk");
    await db.run(
      "INSERT INTO byok_credential (id, workspace_id, provider, encrypted_key, key_hint, spend_limit_cents, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)",
      [id, workspaceId, provider, encryptedKey, keyHint, spendLimitCents, now, now],
    );

    return {
      id,
      provider,
      keyHint,
      spendLimitCents,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    };
  },
);

export const listByokCredentials = scoped(
  "listByokCredentials",
  async (db: DbClient, workspaceId: string): Promise<ByokCredentialRow[]> => {
    const rows = await db.query<RawCredentialRecord>(
      "SELECT id, provider, key_hint, spend_limit_cents, status, created_at, updated_at, last_used_at FROM byok_credential WHERE workspace_id = ? ORDER BY provider ASC",
      [workspaceId],
    );
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider as ByokProvider,
      keyHint: r.key_hint,
      spendLimitCents: r.spend_limit_cents === null ? null : Number(r.spend_limit_cents),
      status: r.status as "active" | "revoked",
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at),
    }));
  },
);

export const getByokCredential = scoped(
  "getByokCredential",
  async (
    db: DbClient,
    workspaceId: string,
    provider: ByokProvider,
  ): Promise<ByokInternalCredential | null> => {
    const rows = await db.query<RawCredentialRecord>(
      "SELECT id, provider, encrypted_key, key_hint, spend_limit_cents, status FROM byok_credential WHERE workspace_id = ? AND provider = ?",
      [workspaceId, provider],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider as ByokProvider,
      encryptedKey: row.encrypted_key,
      keyHint: row.key_hint,
      spendLimitCents: row.spend_limit_cents === null ? null : Number(row.spend_limit_cents),
      status: row.status as "active" | "revoked",
    };
  },
);

export const revokeByokCredential = scoped(
  "revokeByokCredential",
  async (db: DbClient, workspaceId: string, provider: ByokProvider): Promise<void> => {
    const now = Date.now();
    await db.run(
      "UPDATE byok_credential SET status = 'revoked', updated_at = ? WHERE workspace_id = ? AND provider = ?",
      [now, workspaceId, provider],
    );
  },
);

export const deleteByokCredential = scoped(
  "deleteByokCredential",
  async (db: DbClient, workspaceId: string, provider: ByokProvider): Promise<void> => {
    await db.run(
      "DELETE FROM byok_credential WHERE workspace_id = ? AND provider = ?",
      [workspaceId, provider],
    );
  },
);

export const recordByokUsage = scoped(
  "recordByokUsage",
  async (
    db: DbClient,
    workspaceId: string,
    provider: ByokProvider,
    model: string,
    promptTokens: number,
    completionTokens: number,
    costCents: number,
  ): Promise<void> => {
    const now = Date.now();
    const usageId = newId("byu");
    await db.batch([
      {
        sql: "INSERT INTO byok_usage (id, workspace_id, provider, model, prompt_tokens, completion_tokens, estimated_cost_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params: [usageId, workspaceId, provider, model, promptTokens, completionTokens, costCents, now],
      },
      {
        sql: "UPDATE byok_credential SET last_used_at = ? WHERE workspace_id = ? AND provider = ?",
        params: [now, workspaceId, provider],
      },
    ]);
  },
);

export const getByokUsageSummary = scoped(
  "getByokUsageSummary",
  async (
    db: DbClient,
    workspaceId: string,
    since: number = 0,
  ): Promise<ByokUsageSummary> => {
    interface AggRecord {
      prompt_sum: number | null;
      completion_sum: number | null;
      cost_sum: number | null;
    }
    const rows = await db.query<AggRecord>(
      "SELECT SUM(prompt_tokens) as prompt_sum, SUM(completion_tokens) as completion_sum, SUM(estimated_cost_cents) as cost_sum FROM byok_usage WHERE workspace_id = ? AND created_at >= ?",
      [workspaceId, since],
    );
    const row = rows[0];
    return {
      totalPromptTokens: Number(row?.prompt_sum ?? 0),
      totalCompletionTokens: Number(row?.completion_sum ?? 0),
      totalCostCents: Number(row?.cost_sum ?? 0),
    };
  },
);
