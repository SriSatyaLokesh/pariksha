// Phase 8d Task 3: the inline first attempt, fail-open (K23, K37 as revised
// by K43).
//
// Only `attempt.submitted` is ever tried inline, from the submit path
// itself. `attempt.started` and `test.closed` go straight to
// `webhook_delivery` with no `fetch` at all — `attempt.started` fires on a
// candidate hot path up to the attempt limit times per test, and a dead
// receiver there would be one more subrequest and one more failure mode to
// save someone five minutes on an event nobody is waiting on.
//
// `K24`: the body is serialised exactly once, held in `rawBody`, and that
// same string is what `signatureHeader` signs and what `fetch` sends — the
// one thing this module must never do twice (key order or whitespace can
// differ between two `JSON.stringify` calls, and then every receiver's
// check fails, including correct ones).
//
// Fail-open is absolute (`AG1`'s sibling): nothing here may delay or fail
// the candidate's own submission. `DELIVERY_TIMEOUT_MS` bounds the one
// failure a `catch` cannot — a receiver that accepts the connection and
// never answers, which would otherwise consume the invocation along with
// the submit request riding it. The outer `try` in `fireWebhooks` bounds
// everything else: a thrown read, a thrown insert, anything.
//
// **Fix round 1, F1**: the candidate-facing half of the same principle.
// Fail-open bounds *how a single webhook can fail*; `INLINE_FANOUT_LIMIT`
// bounds *how many of them the submit path will ever touch*, because an
// organiser's own webhook count must never be able to turn the candidate's
// submit request into an open-ended sequence of outbound `fetch`es. Past
// the limit, a hook is written straight to `webhook_delivery` — exactly
// the `attempt.started`/`test.closed` path above, just reached by a
// different hook instead of a different event.

import {
  listActiveWebhooksForEvent,
  queueWebhookDeliveries,
  type QueuedWebhookDelivery,
  type WebhookEvent,
} from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { signatureHeader, SIGNATURE_HEADER } from "./sign.js";

/** How long one outbound delivery may hang before it is treated as a
 *  failure and queued for the drain (Task 4) instead. */
export const DELIVERY_TIMEOUT_MS = 5_000;

/**
 * The most hooks one `fireWebhooks` call will ever `fetch` inline, on
 * `attempt.submitted` — the one event reachable from the candidate's own
 * submit request. The arithmetic (`K23`, fix round 1 `F1`):
 *
 * - The submit route's own worst case before any webhook cost is 8
 *   subrequests (`ROUTE_BUDGETS["/api/v1/run/attempt/submit"]` minus this
 *   module's own contribution — see `app.ts`).
 * - Each hook inside the limit costs at most one `fetch` subrequest; the
 *   whole overflow — every hook past the limit, plus every one inside it
 *   that failed — is written in **one** `db.batch()` call (`K23`'s sibling
 *   fix: one subrequest no matter how many rows), never one `INSERT` per
 *   row. So this module's worst-case contribution is a flat
 *   `INLINE_FANOUT_LIMIT + 1`, independent of how many webhooks the
 *   workspace has registered — the 50-subrequest Workers ceiling is a
 *   function of this constant, not of an organiser's integration count.
 * - Each inline hook can also hang for the full `DELIVERY_TIMEOUT_MS`
 *   (sequential, not parallel — concern (2), accepted, see the task
 *   report): worst-case added latency is `INLINE_FANOUT_LIMIT *
 *   DELIVERY_TIMEOUT_MS`. At 3, that is 15s on top of the route's own
 *   work — real, but bounded, and never open-ended.
 * - `AC-28` (signature at the endpoint within 10s) still holds for the
 *   ordinary case this product expects — one or two integrations per
 *   workspace, both inside the limit. Only a workspace that has
 *   registered *more* than `INLINE_FANOUT_LIMIT` hooks on the same event
 *   trades the overflow ones for the drain instead, which runs seconds
 *   behind the inline attempt, not hours. Do not raise this number to
 *   "optimise away" that trade without re-deriving the arithmetic above.
 */
export const INLINE_FANOUT_LIMIT = 3;

export interface Attempt {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** `K24`, the one place this exact string is built — the drain (Task 4)
 *  reconstructs the same `rawBody` from the stored `payload_json` through
 *  this function rather than re-deriving the format, so the two callers
 *  can never drift on key order or whitespace. */
export function deliveryRawBody(event: WebhookEvent, payload: unknown): string {
  return JSON.stringify({ event, ...(payload as Record<string, unknown>) });
}

/** One `fetch`, signed and timed out. Never throws — every failure shape
 *  (a thrown signer, a refused connection, a timeout, a non-2xx response)
 *  comes back as `{ ok: false }` so the caller always has something to
 *  queue. Exported for the drain (Task 4) to call directly — a second
 *  delivery implementation there is how the two paths would drift apart. */
export async function tryDeliver(
  http: typeof globalThis.fetch,
  url: string,
  rawBody: string,
  secret: string,
  nowSeconds: number,
): Promise<Attempt> {
  try {
    const signature = await signatureHeader(rawBody, secret, nowSeconds);
    const response = await http(url, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signature },
      body: rawBody,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status, error: null };
  } catch (error) {
    // A hang surfaces here as `AbortSignal.timeout`'s own `TimeoutError`;
    // a refused connection, a DNS failure and a thrown signer are every
    // other shape. All of them are "try again later" to the drain, and
    // none of them is ever the secret or the URL — just the error's name.
    return { ok: false, status: null, error: error instanceof Error ? error.name : "error" };
  }
}

async function deliverAll(
  deps: AppDeps,
  input: { workspaceId: string; event: WebhookEvent; payload: unknown; now: number },
): Promise<{ delivered: number; queued: number }> {
  const hooks = await listActiveWebhooksForEvent(deps.db, input.workspaceId, input.event);
  if (hooks.length === 0) return { delivered: 0, queued: 0 };

  // Serialised once (K24) — every hook's signature covers this exact
  // string, and every hook's request body, inline or queued, carries it.
  const rawBody = deliveryRawBody(input.event, input.payload);
  const nowSeconds = Math.floor(input.now / 1000);
  const http = deps.http ?? globalThis.fetch;
  const attemptInline = input.event === "attempt.submitted";

  let delivered = 0;
  const toQueue: QueuedWebhookDelivery[] = [];

  // Fix round 1, F1: at most `INLINE_FANOUT_LIMIT` hooks ever reach
  // `fetch`, by position in the list — everything past it is written
  // straight to the queue, same as a non-inline event. `index` (not the
  // hook itself) decides "inside the limit", so this reads the same way
  // whichever hooks happen to be first.
  for (const [index, hook] of hooks.entries()) {
    const withinLimit = attemptInline && index < INLINE_FANOUT_LIMIT;
    const attempt: Attempt = withinLimit
      ? await tryDeliver(http, hook.url, rawBody, hook.signingSecret, nowSeconds)
      : { ok: false, status: null, error: null };

    if (attempt.ok) {
      delivered++;
      continue;
    }

    toQueue.push({
      webhookId: hook.id,
      event: input.event,
      payload: input.payload,
      // `1` only for a hook that was actually tried; a limit-overflow hook
      // (like a non-inline event's) was never attempted at all.
      attemptCount: withinLimit ? 1 : 0,
      lastStatus: attempt.status,
      lastError: attempt.error,
      now: input.now,
    });
  }

  // One `db.batch()` call for everything that did not deliver — the
  // overflow past `INLINE_FANOUT_LIMIT` included — so this module's queue
  // cost is one subrequest regardless of how many rows it is writing
  // (`K23`'s own "N rows, one batch" rule, `client.ts`'s `batch()`).
  if (toQueue.length > 0) {
    await queueWebhookDeliveries(deps.db, input.workspaceId, toQueue);
  }

  return { delivered, queued: toQueue.length };
}

/**
 * Attempts once inline. NEVER throws to its caller. On any failure it
 * writes a `webhook_delivery` row for the drain (Task 4). `K23`.
 */
export async function fireWebhooks(
  deps: AppDeps,
  input: { workspaceId: string; event: WebhookEvent; payload: unknown; now: number },
): Promise<{ delivered: number; queued: number }> {
  try {
    return await deliverAll(deps, input);
  } catch {
    // Fail-open no matter what broke inside this module — a webhook is an
    // integration convenience, and the candidate's own submission must
    // succeed whether or not anyone is listening (`AG1`'s sibling).
    return { delivered: 0, queued: 0 };
  }
}
