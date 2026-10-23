// Phase 8d Task 4: the drain, the backoff, and the second cron (K22).
//
// Review Focus item 5: "a row retried past 24 hours must terminate" is
// proved by the drain returning zero work on a second tick, not just by
// one row's `lastError` reading right once — a queued row nothing retries
// is recoverable; a dead endpoint retried forever is not.

import { afterAll, describe, expect, it, vi } from "vitest";
import { closeClient, createWebhook, newId, queueWebhookDeliveries } from "@pariksha/db";
import type { AppDeps } from "../../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { DRAIN_BATCH_LIMIT, webhookDrainJob } from "../../src/webhooks/drain.js";
import { FIXED_NOW, testDeps } from "../deps.js";

const { deps } = await testDeps();
afterAll(() => closeClient(deps.db));

function okHttp(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch;
}

function failingHttp(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch;
}

interface DeliveryRow {
  id: string;
  attemptCount: number;
  nextAttemptAt: number;
  lastStatus: number | null;
  lastError: string | null;
  deliveredAt: number | null;
  createdAt: number;
}

async function getDelivery(workspaceId: string, id: string): Promise<DeliveryRow | null> {
  const [row] = await deps.db.query<{
    id: string;
    attempt_count: number;
    next_attempt_at: number;
    last_status: number | null;
    last_error: string | null;
    delivered_at: number | null;
    created_at: number;
  }>(
    "SELECT id, attempt_count, next_attempt_at, last_status, last_error, delivered_at, created_at " +
      "FROM webhook_delivery WHERE workspace_id = ? AND id = ?",
    [workspaceId, id],
  );
  if (!row) return null;
  return {
    id: row.id,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: Number(row.next_attempt_at),
    lastStatus: row.last_status === null ? null : Number(row.last_status),
    lastError: row.last_error,
    deliveredAt: row.delivered_at === null ? null : Number(row.delivered_at),
    createdAt: Number(row.created_at),
  };
}

/** Queues one due delivery in a fresh workspace and returns its id, the
 *  workspace, and its webhook's url (the one URL `http` ever has to
 *  answer for). `dueAt` sets both `created_at` and `next_attempt_at` —
 *  `queueWebhookDeliveries`'s own shape (`deliver.ts`'s Task 3 write) —
 *  which is exactly what lets a single call seed an aged, overdue row. */
async function seedDue(dueAt: number = FIXED_NOW): Promise<{ workspaceId: string; deliveryId: string; url: string }> {
  const workspaceId = newId("wsp");
  const url = "https://example.test/drain-hook";
  const { webhookId } = await createWebhook(deps.db, workspaceId, {
    url,
    events: ["attempt.started"],
    now: FIXED_NOW,
  });
  await queueWebhookDeliveries(deps.db, workspaceId, [
    {
      webhookId,
      event: "attempt.started",
      payload: { attemptId: "att_x" },
      attemptCount: 0,
      lastStatus: null,
      lastError: null,
      now: dueAt,
    },
  ]);
  const [row] = await deps.db.query<{ id: string }>(
    "SELECT id FROM webhook_delivery WHERE workspace_id = ?",
    [workspaceId],
  );
  return { workspaceId, deliveryId: row!.id, url };
}

describe("webhookDrainJob", () => {
  it("retries a queued delivery and marks it delivered on success", async () => {
    const { workspaceId, deliveryId } = await seedDue();

    await webhookDrainJob.run({ ...deps, http: okHttp() });

    const row = await getDelivery(workspaceId, deliveryId);
    expect(row!.deliveredAt).not.toBeNull();
    expect(row!.lastStatus).toBe(200);
  });

  // Fix round 1, MINOR 1: an ordinary non-2xx failure carries no
  // `attempt.error` (only a thrown/aborted fetch sets that), so without
  // the hoisted `reason` fallback in `nextState` this retry's `last_error`
  // was `NULL` — a bare `last_status` and nothing an operator could read.
  // Deliberately NOT the give-up path (seeded fresh, not aged) so this
  // proves the ordinary-retry branch specifically, not the already-covered
  // terminal one.
  it("leaves a readable reason on an ordinary retry, not a bare status code", async () => {
    const { workspaceId, deliveryId } = await seedDue();

    await webhookDrainJob.run({ ...deps, http: failingHttp() });

    const row = await getDelivery(workspaceId, deliveryId);
    expect(row!.lastStatus).toBe(500);
    expect(row!.lastError).not.toBeNull();
    expect(row!.lastError).toContain("500");
  });

  it("takes nothing that is not yet due", async () => {
    const future = FIXED_NOW + 3_600_000;
    await seedDue(future);
    const http = failingHttp();

    await webhookDrainJob.run({ ...deps, http, now: () => FIXED_NOW });

    expect(http).not.toHaveBeenCalled();
  });

  it("backs off exponentially on each failure", async () => {
    const { workspaceId, deliveryId } = await seedDue();
    const failingDeps: AppDeps = { ...deps, http: failingHttp() };

    await webhookDrainJob.run(failingDeps);
    const first = (await getDelivery(workspaceId, deliveryId))!.nextAttemptAt;

    await webhookDrainJob.run({ ...failingDeps, now: () => first });
    const second = (await getDelivery(workspaceId, deliveryId))!.nextAttemptAt;

    expect(second - first).toBeGreaterThan(first - FIXED_NOW);
  });

  it("stops after 24 hours rather than retrying forever", async () => {
    const { workspaceId, deliveryId } = await seedDue(FIXED_NOW - 25 * 3600_000);
    const fetchSpy = failingHttp();
    const failingDeps: AppDeps = { ...deps, http: fetchSpy, now: () => FIXED_NOW };

    await webhookDrainJob.run(failingDeps);
    const row = await getDelivery(workspaceId, deliveryId);
    expect(row!.lastError).toMatch(/gave up/);
    expect(row!.deliveredAt).toBeNull(); // terminal, but never silently "delivered"

    // The assertion that would have caught a backoff that never stops:
    // the drain returns zero work on the row it already gave up on.
    await webhookDrainJob.run(failingDeps);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // not attempted a second time
  });

  it("stays inside the ceiling with many due deliveries", async () => {
    const workspaceId = newId("wsp");
    const { webhookId } = await createWebhook(deps.db, workspaceId, {
      url: "https://example.test/drain-hook-many",
      events: ["attempt.started"],
      now: FIXED_NOW,
    });
    await queueWebhookDeliveries(
      deps.db,
      workspaceId,
      Array.from({ length: 300 }, (_, i) => ({
        webhookId,
        event: "attempt.started" as const,
        payload: { attemptId: `att_${String(i)}` },
        attemptCount: 0,
        lastStatus: null,
        lastError: null,
        now: FIXED_NOW,
      })),
    );

    const counting = countingDeps({ ...deps, http: okHttp() });
    await webhookDrainJob.run(counting.deps);

    expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
    // The bound itself, not just that it happened to fit this run.
    expect(counting.counts().http).toBeLessThanOrEqual(DRAIN_BATCH_LIMIT);
  });
});
