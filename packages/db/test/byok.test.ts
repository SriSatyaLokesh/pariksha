import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { newId } from "../src/ids.js";
import {
  setByokCredential,
  listByokCredentials,
  getByokCredential,
  revokeByokCredential,
  deleteByokCredential,
  recordByokUsage,
  getByokUsageSummary,
} from "../src/repo/byok.js";
import { createWorkspace } from "../src/repo/workspaces.js";

describe("BYOK Repository (Phase 12, S-15)", () => {
  let db: DbClient;
  let wsp1: string;
  let wsp2: string;

  beforeEach(async () => {
    db = sqliteClient(":memory:");
    await migrate(db);

    wsp1 = newId("wsp");
    wsp2 = newId("wsp");
    await createWorkspace(db, wsp1, { name: "Workspace One", slug: "wsp-one" });
    await createWorkspace(db, wsp2, { name: "Workspace Two", slug: "wsp-two" });
  });

  afterEach(async () => {
    await closeClient(db);
  });

  it("sets, lists, and updates credentials per workspace", async () => {
    const cred = await setByokCredential(
      db,
      wsp1,
      "anthropic",
      "enc_payload_anthropic_1",
      "sk-ant-...1234",
      5000,
    );
    expect(cred.provider).toBe("anthropic");
    expect(cred.keyHint).toBe("sk-ant-...1234");
    expect(cred.spendLimitCents).toBe(5000);
    expect(cred.status).toBe("active");

    const list = await listByokCredentials(db, wsp1);
    expect(list.length).toBe(1);
    expect(list[0]?.provider).toBe("anthropic");
    expect(list[0]?.keyHint).toBe("sk-ant-...1234");
    // Verify encryptedKey is never in the public list
    expect((list[0] as unknown as Record<string, unknown>).encryptedKey).toBeUndefined();

    // Updating existing provider replaces key and hint
    const updated = await setByokCredential(
      db,
      wsp1,
      "anthropic",
      "enc_payload_anthropic_v2",
      "sk-ant-...9999",
      10000,
    );
    expect(updated.id).toBe(cred.id);
    expect(updated.keyHint).toBe("sk-ant-...9999");
    expect(updated.spendLimitCents).toBe(10000);

    const internal = await getByokCredential(db, wsp1, "anthropic");
    expect(internal?.encryptedKey).toBe("enc_payload_anthropic_v2");
    expect(internal?.keyHint).toBe("sk-ant-...9999");
  });

  it("revokes and deletes credentials", async () => {
    await setByokCredential(db, wsp1, "openai", "enc_openai_key", "sk-proj-...4321");
    expect((await getByokCredential(db, wsp1, "openai"))?.status).toBe("active");

    await revokeByokCredential(db, wsp1, "openai");
    expect((await getByokCredential(db, wsp1, "openai"))?.status).toBe("revoked");
    const list = await listByokCredentials(db, wsp1);
    expect(list[0]?.status).toBe("revoked");

    await deleteByokCredential(db, wsp1, "openai");
    expect(await getByokCredential(db, wsp1, "openai")).toBeNull();
    expect(await listByokCredentials(db, wsp1)).toEqual([]);
  });

  it("records usage and aggregates summary", async () => {
    await setByokCredential(db, wsp1, "anthropic", "enc_key", "sk-ant-...1111");

    await recordByokUsage(db, wsp1, "anthropic", "claude-3-5-sonnet", 500, 150, 4);
    await recordByokUsage(db, wsp1, "anthropic", "claude-3-5-sonnet", 300, 200, 5);

    const summary = await getByokUsageSummary(db, wsp1);
    expect(summary.totalPromptTokens).toBe(800);
    expect(summary.totalCompletionTokens).toBe(350);
    expect(summary.totalCostCents).toBe(9);

    const cred = await listByokCredentials(db, wsp1);
    expect(cred[0]?.lastUsedAt).toBeTypeOf("number");
  });

  it("strictly enforces tenant isolation between workspaces", async () => {
    await setByokCredential(db, wsp1, "anthropic", "key_wsp1", "sk-ant-...1111");
    await setByokCredential(db, wsp2, "anthropic", "key_wsp2", "sk-ant-...2222");

    const wsp1Creds = await listByokCredentials(db, wsp1);
    const wsp2Creds = await listByokCredentials(db, wsp2);
    expect(wsp1Creds.length).toBe(1);
    expect(wsp2Creds.length).toBe(1);
    expect(wsp1Creds[0]?.keyHint).toBe("sk-ant-...1111");
    expect(wsp2Creds[0]?.keyHint).toBe("sk-ant-...2222");

    await recordByokUsage(db, wsp1, "anthropic", "claude-3-5-sonnet", 1000, 500, 15);
    const wsp1Summary = await getByokUsageSummary(db, wsp1);
    const wsp2Summary = await getByokUsageSummary(db, wsp2);
    expect(wsp1Summary.totalCostCents).toBe(15);
    expect(wsp2Summary.totalCostCents).toBe(0);
  });
});
