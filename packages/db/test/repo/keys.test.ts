// Scoped API keys: creation, the secret shown once, K26's forbidden
// scopes, listing, revocation and resolution (Phase 8d Task 2, `K25`,
// `K26`, `KG5`).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import { resolveApiKey } from "../../src/index.js";
import * as repo from "../../src/repo/index.js";

const T = 1_700_000_000_000;

let db: DbClient;
let wsp: string;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
  wsp = newId("wsp");
  await repo.createWorkspace(db, wsp, { slug: "alpha", name: "Alpha" });
});

afterAll(() => closeClient(db));

describe("createApiKey", () => {
  it("returns the secret once and stores only a hash", async () => {
    const { secret } = await repo.createApiKey(db, wsp, { name: "ATS", scopes: ["results.export"], now: T });
    expect(secret).toMatch(/^pk_/);
    expect(JSON.stringify(await repo.listApiKeys(db, wsp))).not.toContain(secret);
  });

  it("refuses keys.manage at creation", async () => {
    await expect(
      repo.createApiKey(db, wsp, { name: "bad", scopes: ["keys.manage"], now: T }),
    ).rejects.toThrow();
  });

  // `K26`'s other half: a leaked key able to add or remove members is the
  // identical hazard a leaked key-minting one is.
  it("refuses members.manage at creation", async () => {
    await expect(
      repo.createApiKey(db, wsp, { name: "bad", scopes: ["members.manage"], now: T }),
    ).rejects.toThrow();
  });

  it("accepts an ordinary scope — control for the two refusals above", async () => {
    await expect(
      repo.createApiKey(db, wsp, { name: "ok", scopes: ["results.export"], now: T }),
    ).resolves.toBeDefined();
  });

  it("mints a key_-prefixed id", async () => {
    const { apiKeyId } = await repo.createApiKey(db, wsp, { name: "id-check", scopes: ["tests.edit"], now: T });
    expect(apiKeyId).toMatch(/^key_/);
  });

  it("rejects an action that does not exist, the same way an invented webhook event is", async () => {
    await expect(
      repo.createApiKey(db, wsp, { name: "bogus", scopes: ["invented.action"] as never, now: T }),
    ).rejects.toThrow();
  });
});

describe("listApiKeys", () => {
  it("never carries the secret or its hash, on a workspace with more than one key", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "list-ws", name: "List" });
    await repo.createApiKey(db, ws, { name: "one", scopes: ["results.export"], now: T });
    await repo.createApiKey(db, ws, { name: "two", scopes: ["tests.edit"], now: T });

    const rows = await repo.listApiKeys(db, ws);
    expect(rows).toHaveLength(2);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("secretHash");
    expect(serialized).not.toContain("secret_hash");
    for (const row of rows) {
      expect(row).not.toHaveProperty("secret");
    }
  });

  it("a workspace cannot see another workspace's keys", async () => {
    const wsA = newId("wsp");
    const wsB = newId("wsp");
    await repo.createWorkspace(db, wsA, { slug: "scope-a", name: "Scope A" });
    await repo.createWorkspace(db, wsB, { slug: "scope-b", name: "Scope B" });
    await repo.createApiKey(db, wsA, { name: "a", scopes: ["results.export"], now: T });

    expect(await repo.listApiKeys(db, wsA)).toHaveLength(1);
    expect(await repo.listApiKeys(db, wsB)).toHaveLength(0);
  });
});

describe("revokeApiKey", () => {
  it("sets revoked_at, and a key already revoked cannot be revoked again", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "revoke-ws", name: "Revoke" });
    const { apiKeyId } = await repo.createApiKey(db, ws, { name: "r", scopes: ["results.export"], now: T });

    await repo.revokeApiKey(db, ws, apiKeyId, T + 1);
    expect((await repo.listApiKeys(db, ws))[0]?.revokedAt).toBe(T + 1);

    await expect(repo.revokeApiKey(db, ws, apiKeyId, T + 2)).rejects.toThrow();
  });

  it("throws for a key id that does not exist in this workspace", async () => {
    await expect(repo.revokeApiKey(db, wsp, newId("key"), T)).rejects.toThrow();
  });
});

describe("resolveApiKey", () => {
  it("resolves a live key to its workspace and scopes", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "resolve-ws", name: "Resolve" });
    const { secret } = await repo.createApiKey(db, ws, {
      name: "r",
      scopes: ["results.export", "tests.edit"],
      now: T,
    });

    const resolved = await resolveApiKey(db, secret, T + 1);
    expect(resolved?.workspaceId).toBe(ws);
    expect(resolved?.scopes.sort()).toEqual(["results.export", "tests.edit"].sort());
  });

  it("stamps last_used_at on resolution", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "stamp-ws", name: "Stamp" });
    const { apiKeyId, secret } = await repo.createApiKey(db, ws, { name: "s", scopes: ["results.export"], now: T });

    expect((await repo.listApiKeys(db, ws)).find((k) => k.id === apiKeyId)?.lastUsedAt).toBeNull();
    await resolveApiKey(db, secret, T + 5000);
    expect((await repo.listApiKeys(db, ws)).find((k) => k.id === apiKeyId)?.lastUsedAt).toBe(T + 5000);
  });

  // Fails closed: unknown, malformed and revoked all answer the identical
  // `null` — none of them should ever be told apart by a caller that only
  // checks truthiness, and none of them may fall through to anything else.
  it("returns null for a secret that does not exist", async () => {
    expect(await resolveApiKey(db, "pk_0000000000000000000000000000000000000000000000000000000000000000")).toBeNull();
  });

  it("returns null for a string that is not pk_-shaped at all", async () => {
    expect(await resolveApiKey(db, "not-a-key")).toBeNull();
  });

  it("returns null for a revoked key", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "revoked-resolve-ws", name: "Revoked Resolve" });
    const { apiKeyId, secret } = await repo.createApiKey(db, ws, { name: "rv", scopes: ["results.export"], now: T });
    await repo.revokeApiKey(db, ws, apiKeyId, T + 1);

    expect(await resolveApiKey(db, secret, T + 2)).toBeNull();
  });
});
