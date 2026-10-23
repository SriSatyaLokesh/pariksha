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

import { listActiveWebhooksForEvent, queueWebhookDelivery, type WebhookEvent } from "@pariksha/db";
import type { AppDeps } from "../app.js";
import { signatureHeader, SIGNATURE_HEADER } from "./sign.js";

/** How long one outbound delivery may hang before it is treated as a
 *  failure and queued for the drain (Task 4) instead. */
export const DELIVERY_TIMEOUT_MS = 5_000;

interface Attempt {
  ok: boolean;
  status: number | null;
  error: string | null;
}

/** One `fetch`, signed and timed out. Never throws — every failure shape
 *  (a thrown signer, a refused connection, a timeout, a non-2xx response)
 *  comes back as `{ ok: false }` so the caller always has something to
 *  queue. */
async function tryDeliver(
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
  const rawBody = JSON.stringify({ event: input.event, ...(input.payload as Record<string, unknown>) });
  const nowSeconds = Math.floor(input.now / 1000);
  const http = deps.http ?? globalThis.fetch;
  const attemptInline = input.event === "attempt.submitted";

  let delivered = 0;
  let queued = 0;

  // N active webhooks on this event is N subrequests, sequential: the
  // route's own budget (`ROUTE_BUDGETS`, `app.ts`) is what bounds N in
  // practice, the same way it already bounds every other per-row cost in
  // this codebase.
  for (const hook of hooks) {
    const attempt: Attempt = attemptInline
      ? await tryDeliver(http, hook.url, rawBody, hook.signingSecret, nowSeconds)
      : { ok: false, status: null, error: null };

    if (attempt.ok) {
      delivered++;
      continue;
    }

    await queueWebhookDelivery(deps.db, input.workspaceId, {
      webhookId: hook.id,
      event: input.event,
      payload: input.payload,
      attemptCount: attemptInline ? 1 : 0,
      lastStatus: attempt.status,
      lastError: attempt.error,
      now: input.now,
    });
    queued++;
  }

  return { delivered, queued };
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
