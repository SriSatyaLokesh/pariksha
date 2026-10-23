// Webhook CRUD, the secret shown once, SSRF refusal, and the closed event
// set (Phase 8d Task 1, `K35`, `K36`, `KG5`).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import * as repo from "../../src/repo/index.js";

const T = 1_700_000_000_000;
const url = "https://example.test/hook";

let db: DbClient;
let wsp: string;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);
});

afterAll(() => closeClient(db));

beforeAll(async () => {
  wsp = newId("wsp");
  await repo.createWorkspace(db, wsp, { slug: "alpha", name: "Alpha" });
});

describe("createWebhook", () => {
  it("returns the signing secret exactly once, on creation", async () => {
    const { signingSecret } = await repo.createWebhook(db, wsp, { url, events: ["attempt.submitted"], now: T });
    expect(signingSecret).toMatch(/^whsec_/);
    expect(JSON.stringify(await repo.listWebhooks(db, wsp))).not.toContain(signingSecret);
  });

  it("refuses a URL pointing at a private address", async () => {
    await expect(
      repo.createWebhook(db, wsp, { url: "http://169.254.169.254/latest", events: ["attempt.submitted"], now: T }),
    ).rejects.toThrow();
  });

  it("accepts an ordinary public URL — control for the test above", async () => {
    await expect(
      repo.createWebhook(db, wsp, { url: "https://example.test/hook", events: ["attempt.submitted"], now: T }),
    ).resolves.toBeDefined();
  });

  it("refuses an event outside the closed set", async () => {
    await expect(
      repo.createWebhook(db, wsp, { url, events: ["attempt.invented"] as never, now: T }),
    ).rejects.toThrow();
  });

  // `K43`: the shipped list is three events, and `attempt.flagged` — 8g's
  // deferred integrity recompute — is deliberately not one of them.
  it("WEBHOOK_EVENTS names exactly the three shipped events", () => {
    expect(repo.WEBHOOK_EVENTS).toEqual(["attempt.started", "attempt.submitted", "test.closed"]);
  });

  it("mints a whk_-prefixed id", async () => {
    const { webhookId } = await repo.createWebhook(db, wsp, { url, events: ["test.closed"], now: T });
    expect(webhookId).toMatch(/^whk_/);
  });
});

describe("listWebhooks", () => {
  it("never carries signingSecret, on a workspace with more than one webhook", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "list-ws", name: "List" });
    await repo.createWebhook(db, ws, { url, events: ["attempt.started"], now: T });
    await repo.createWebhook(db, ws, { url: "https://example.test/second", events: ["test.closed"], now: T });

    const rows = await repo.listWebhooks(db, ws);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("signingSecret");
    }
  });

  it("a workspace cannot see another workspace's webhooks", async () => {
    const wsA = newId("wsp");
    const wsB = newId("wsp");
    await repo.createWorkspace(db, wsA, { slug: "scope-a", name: "Scope A" });
    await repo.createWorkspace(db, wsB, { slug: "scope-b", name: "Scope B" });
    await repo.createWebhook(db, wsA, { url, events: ["attempt.started"], now: T });

    expect(await repo.listWebhooks(db, wsA)).toHaveLength(1);
    expect(await repo.listWebhooks(db, wsB)).toHaveLength(0);
  });
});

describe("setWebhookActive", () => {
  it("toggles active off and back on", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "toggle-ws", name: "Toggle" });
    const { webhookId } = await repo.createWebhook(db, ws, { url, events: ["attempt.started"], now: T });

    await repo.setWebhookActive(db, ws, webhookId, false);
    expect((await repo.listWebhooks(db, ws))[0]?.active).toBe(false);

    await repo.setWebhookActive(db, ws, webhookId, true);
    expect((await repo.listWebhooks(db, ws))[0]?.active).toBe(true);
  });

  it("throws for a webhook id that does not exist in this workspace", async () => {
    await expect(repo.setWebhookActive(db, wsp, newId("whk"), false)).rejects.toThrow();
  });
});

describe("deleteWebhook", () => {
  it("removes the row", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "delete-ws", name: "Delete" });
    const { webhookId } = await repo.createWebhook(db, ws, { url, events: ["attempt.started"], now: T });

    await repo.deleteWebhook(db, ws, webhookId);
    expect(await repo.listWebhooks(db, ws)).toHaveLength(0);
  });

  it("throws for a webhook id that does not exist in this workspace", async () => {
    await expect(repo.deleteWebhook(db, wsp, newId("whk"))).rejects.toThrow();
  });
});

// Task 3's own read: not called by any route in this task, which is why
// this file — not an API test — is the one place that exercises it.
describe("listActiveWebhooksForEvent", () => {
  it("returns only active webhooks subscribed to the named event, secret included", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "deliver-ws", name: "Deliver" });

    const subscribed = await repo.createWebhook(db, ws, {
      url,
      events: ["attempt.submitted", "test.closed"],
      now: T,
    });
    const notSubscribed = await repo.createWebhook(db, ws, { url, events: ["test.closed"], now: T });
    const inactive = await repo.createWebhook(db, ws, { url, events: ["attempt.submitted"], now: T });
    await repo.setWebhookActive(db, ws, inactive.webhookId, false);

    const deliverable = await repo.listActiveWebhooksForEvent(db, ws, "attempt.submitted");
    expect(deliverable.map((d) => d.id)).toEqual([subscribed.webhookId]);
    expect(deliverable[0]?.signingSecret).toBe(subscribed.signingSecret);
    expect(deliverable.map((d) => d.id)).not.toContain(notSubscribed.webhookId);
  });

  it("returns nothing for a workspace with no matching subscription", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "empty-ws", name: "Empty" });
    expect(await repo.listActiveWebhooksForEvent(db, ws, "attempt.started")).toEqual([]);
  });
});

// Phase 8d Task 3 (K23): the row `fireWebhooks` (apps/api) writes for
// Task 4's drain when the inline attempt is skipped or fails.
describe("queueWebhookDelivery", () => {
  it("mints a whd_-prefixed id and stores the payload, never the signing secret", async () => {
    const ws = newId("wsp");
    await repo.createWorkspace(db, ws, { slug: "queue-ws", name: "Queue" });
    const { webhookId } = await repo.createWebhook(db, ws, { url, events: ["attempt.submitted"], now: T });

    await repo.queueWebhookDelivery(db, ws, {
      webhookId,
      event: "attempt.submitted",
      payload: { attemptId: "att_x" },
      attemptCount: 1,
      lastStatus: 500,
      lastError: null,
      now: T,
    });

    const rows = await db.query<{
      id: string;
      webhook_id: string;
      event: string;
      payload_json: unknown;
      attempt_count: number;
      next_attempt_at: number;
      last_status: number | null;
      last_error: string | null;
      delivered_at: number | null;
    }>("SELECT * FROM webhook_delivery WHERE workspace_id = ?", [ws]);

    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toMatch(/^whd_/);
    expect(row.webhook_id).toBe(webhookId);
    expect(row.event).toBe("attempt.submitted");
    expect(db.jsonValue(row.payload_json)).toEqual({ attemptId: "att_x" });
    expect(row.attempt_count).toBe(1);
    expect(row.next_attempt_at).toBe(T);
    expect(row.last_status).toBe(500);
    expect(row.last_error).toBeNull();
    expect(row.delivered_at).toBeNull();
    expect(JSON.stringify(row)).not.toContain("whsec_");
  });
});
