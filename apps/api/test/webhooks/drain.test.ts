// Phase 8d Task 4: the drain, the backoff, and the second cron (K22).
//
// Review Focus item 5: "a row retried past 24 hours must terminate" is
// proved by the drain returning zero work on a second tick, not just by
// one row's `lastError` reading right once — a queued row nothing retries
// is recoverable; a dead endpoint retried forever is not.

import { afterAll, describe, expect, it, vi } from "vitest";
import { closeClient, createWebhook, newId, queueWebhookDeliveries, setWebhookActive } from "@pariksha/db";
import type { AppDeps } from "../../src/app.js";
import { countingDeps, SUBREQUEST_LIMIT } from "../../src/instrument.js";
import { DRAIN_BATCH_LIMIT, NEVER_AGAIN, webhookDrainJob } from "../../src/webhooks/drain.js";
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
async function seedDue(
  dueAt: number = FIXED_NOW,
): Promise<{ workspaceId: string; webhookId: string; deliveryId: string; url: string }> {
  const workspaceId = newId("wsp");
  const url = "https://example.test/drain-hook";
  // `test.closed`, not `attempt.started`: branch review MAJOR-3 drops
  // `attempt.started` from `WEBHOOK_EVENTS` (nothing ever fired it) — any
  // queue-only, never-inline event demonstrates the drain's own behaviour
  // equally well, and `test.closed` is the one that still ships.
  const { webhookId } = await createWebhook(deps.db, workspaceId, {
    url,
    events: ["test.closed"],
    now: FIXED_NOW,
  });
  await queueWebhookDeliveries(deps.db, workspaceId, [
    {
      webhookId,
      event: "test.closed",
      payload: { testId: "tst_x" },
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
  return { workspaceId, webhookId, deliveryId: row!.id, url };
}

describe("webhookDrainJob", () => {
  it("retries a queued delivery and marks it delivered on success", async () => {
    const { workspaceId, deliveryId } = await seedDue();

    await webhookDrainJob.run({ ...deps, http: okHttp() });

    const row = await getDelivery(workspaceId, deliveryId);
    expect(row!.deliveredAt).not.toBeNull();
    expect(row!.lastStatus).toBe(200);
  });

  // CRITICAL-1 (whole-branch review): the success branch used to leave
  // `next_attempt_at` where it was — a past timestamp — so a delivered row
  // stayed inside the due-row index range forever and was re-read on every
  // tick for the life of the row. Nothing else ever deletes a
  // `webhook_delivery` row, so this is unbounded D1 rows-read growth on a
  // metered account. The guard that would have caught it: the drain
  // returns zero work on a row it already delivered, the same shape the
  // 24h give-up test already uses.
  it("retires a delivered row so it is never rescanned (CRITICAL-1)", async () => {
    const { workspaceId, deliveryId } = await seedDue();
    const fetchSpy = okHttp();

    await webhookDrainJob.run({ ...deps, http: fetchSpy });
    const delivered = await getDelivery(workspaceId, deliveryId);
    expect(delivered!.deliveredAt).not.toBeNull();
    // The sentinel itself: a delivered row now reads the same "never due
    // again" marker the 24h give-up branch already used, not its old
    // past-dated `next_attempt_at`.
    expect(delivered!.nextAttemptAt).toBe(NEVER_AGAIN);

    await webhookDrainJob.run({ ...deps, http: fetchSpy });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // not re-attempted, not re-read as due
  });

  // MAJOR-2 (whole-branch review): the inline path reads hooks through
  // `listActiveWebhooksForEvent` (`active = 1`); the drain's join had no
  // such filter, so Pause did nothing for a row already queued — it kept
  // being retried for up to 24h after the organiser paused it.
  it("does not drain a paused webhook's queued rows (MAJOR-2)", async () => {
    const { workspaceId, webhookId } = await seedDue();
    await setWebhookActive(deps.db, workspaceId, webhookId, false);
    const http = failingHttp();

    await webhookDrainJob.run({ ...deps, http });

    expect(http).not.toHaveBeenCalled();
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

  // MINOR-2 (whole-branch review): two samples cannot separate exponential
  // from linear growth — `BACKOFF_BASE_MS * attemptCount` (linear) produces
  // the identical 60s/120s pair and would have passed here too. A third
  // sample does: linear growth has a CONSTANT gap between gaps
  // (120-60 === 180-120); exponential (doubling) does not
  // (120-60 = 60 < 240-120 = 120).
  it("backs off exponentially, not linearly, on each failure", async () => {
    const { workspaceId, deliveryId } = await seedDue();
    const failingDeps: AppDeps = { ...deps, http: failingHttp() };

    await webhookDrainJob.run(failingDeps);
    const first = (await getDelivery(workspaceId, deliveryId))!.nextAttemptAt;

    await webhookDrainJob.run({ ...failingDeps, now: () => first });
    const second = (await getDelivery(workspaceId, deliveryId))!.nextAttemptAt;

    await webhookDrainJob.run({ ...failingDeps, now: () => second });
    const third = (await getDelivery(workspaceId, deliveryId))!.nextAttemptAt;

    const gap1 = first - FIXED_NOW;
    const gap2 = second - first;
    const gap3 = third - second;
    expect(gap2).toBeGreaterThan(gap1);
    expect(gap3).toBeGreaterThan(gap2);
    // The assertion a linear backoff would also satisfy up to here, and
    // fail on: the gap between gaps must itself grow.
    expect(gap3 - gap2).toBeGreaterThan(gap2 - gap1);
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

  // MINOR-1 (whole-branch review): `toBeLessThanOrEqual` on both sides is
  // satisfied by a drain that attempts ZERO rows — this project's own
  // signature broken-test shape (a regression that breaks the due-row
  // filter entirely would pass this test just as well as working code).
  // With 300 due rows the drain must attempt exactly the limit; the upper
  // bound on `total` is then implied, not separately asserted.
  it("stays inside the ceiling with many due deliveries", async () => {
    const workspaceId = newId("wsp");
    const { webhookId } = await createWebhook(deps.db, workspaceId, {
      url: "https://example.test/drain-hook-many",
      events: ["test.closed"],
      now: FIXED_NOW,
    });
    await queueWebhookDeliveries(
      deps.db,
      workspaceId,
      Array.from({ length: 300 }, (_, i) => ({
        webhookId,
        event: "test.closed" as const,
        payload: { testId: `tst_${String(i)}` },
        attemptCount: 0,
        lastStatus: null,
        lastError: null,
        now: FIXED_NOW,
      })),
    );

    const counting = countingDeps({ ...deps, http: okHttp() });
    await webhookDrainJob.run(counting.deps);

    expect(counting.counts().http).toBe(DRAIN_BATCH_LIMIT);
    expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
  });
});
