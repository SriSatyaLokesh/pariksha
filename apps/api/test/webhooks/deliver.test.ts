// Phase 8d Task 3: the inline first attempt, fail-open (K23, K37 as revised
// by K43). First production caller of `listActiveWebhooksForEvent` (Task 1)
// and `signatureHeader` (Task 2) both.
//
// Review Focus item 1 (K24) is proved twice here, deliberately: `sign.test.ts`
// already proves `signatureHeader` signs the bytes it is handed (with an
// independent HMAC, not a second call to the function itself). What that
// test cannot see is whether `deliver.ts` hands `fetch` the *same* bytes it
// signed — a bug where the body is serialised once for signing and again
// for the request would pass every one of `sign.test.ts`'s assertions and
// still break every receiver. The test below captures the literal body
// `http` was called with and verifies the captured signature against it
// independently, so a double-serialisation regression here has somewhere
// to fail.

import { afterAll, describe, expect, it, vi } from "vitest";
import { createHmac, timingSafeEqual } from "node:crypto";
import { closeClient, createWebhook, newId, WEBHOOK_EVENTS } from "@pariksha/db";
import { createApp, ROUTE_BUDGETS, type AppDeps } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { DELIVERY_TIMEOUT_MS, fireWebhooks, INLINE_FANOUT_LIMIT } from "../../src/webhooks/deliver.js";
import { SIGNATURE_HEADER } from "../../src/webhooks/sign.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { seedPublishedTest } from "../run/fixtures.js";
import { seedAttemptTests, startAttemptFor } from "../run/paper-fixtures.js";

const { deps } = await testDeps();
const workspaceId = await seedPublishedTest(deps);
await seedAttemptTests(deps, workspaceId);

// One webhook, registered once, shared by every submit-route test below —
// so N (the active-hook count the route's budget is measured against) is
// pinned at 1 rather than drifting with it/describe execution order.
await createWebhook(deps.db, workspaceId, {
  url: "https://example.test/submit-hook",
  events: ["attempt.submitted"],
  now: FIXED_NOW,
});

afterAll(() => closeClient(deps.db));

// --- http stand-ins -------------------------------------------------------

function okHttp(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch;
}

function failingHttp(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch;
}

/** Accepts the connection and never answers — the one shape a `catch`
 *  cannot save a caller from. Honours the `signal` it is handed exactly as
 *  real `fetch` does: when `AbortSignal.timeout` fires, the pending
 *  promise rejects with the signal's own `TimeoutError`. Without this
 *  listener the promise would hang forever and the "does not hang" test
 *  would hang with it instead of proving anything. */
function hangingHttp(): typeof globalThis.fetch {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      }),
  ) as unknown as typeof globalThis.fetch;
}

const withHttp = (http: typeof globalThis.fetch): AppDeps => ({ ...deps, http });

/** `sign.test.ts`'s own independent verifier, copied rather than imported:
 *  the point is a second implementation of HMAC-SHA256 over the documented
 *  format, not a second call to anything `deliver.ts` or `sign.ts`
 *  exports. */
function verifyIndependently(header: string, rawBody: string, secret: string): boolean {
  const t = /t=(\d+)/.exec(header)?.[1];
  const v1 = /v1=([0-9a-f]+)/.exec(header)?.[1];
  if (!t || !v1) return false;
  const mac = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const expected = Buffer.from(mac, "hex");
  const actual = Buffer.from(v1, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function hookIn(
  wsp: string,
  events: readonly (typeof WEBHOOK_EVENTS)[number][],
): Promise<{ webhookId: string; signingSecret: string }> {
  return createWebhook(deps.db, wsp, { url: "https://example.test/hook", events, now: FIXED_NOW });
}

async function deliveryRows(wsp: string): Promise<{ event: string; webhook_id: string }[]> {
  return deps.db.query("SELECT event, webhook_id FROM webhook_delivery WHERE workspace_id = ?", [wsp]);
}

// --- fireWebhooks, directly ------------------------------------------------

describe("fireWebhooks", () => {
  it("delivers attempt.submitted inline and queues nothing", async () => {
    const wsp = newId("wsp");
    await hookIn(wsp, ["attempt.submitted"]);

    const result = await fireWebhooks(withHttp(okHttp()), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_x" },
      now: FIXED_NOW,
    });

    expect(result).toEqual({ delivered: 1, queued: 0 });
    expect(await deliveryRows(wsp)).toEqual([]);
  });

  it("does not hang the request on an endpoint that never answers", async () => {
    const wsp = newId("wsp");
    await hookIn(wsp, ["attempt.submitted"]);

    const started = Date.now();
    const result = await fireWebhooks(withHttp(hangingHttp()), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_x" },
      now: FIXED_NOW,
    });

    expect(Date.now() - started).toBeLessThan(DELIVERY_TIMEOUT_MS + 500);
    expect(result).toEqual({ delivered: 0, queued: 1 });
  }, DELIVERY_TIMEOUT_MS + 2000);

  it("queues rather than throwing on a 500, and records the row for the drain", async () => {
    const wsp = newId("wsp");
    const { webhookId } = await hookIn(wsp, ["attempt.submitted"]);

    const result = await fireWebhooks(withHttp(failingHttp()), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_x" },
      now: FIXED_NOW,
    });

    expect(result).toEqual({ delivered: 0, queued: 1 });
    expect(await deliveryRows(wsp)).toEqual([{ event: "attempt.submitted", webhook_id: webhookId }]);
  });

  // MAJOR-1 (whole-branch review): without `redirect: "manual"`, `fetch`'s
  // default `"follow"` bypasses `urlRefusal` entirely — a URL that passed
  // the SSRF check once can 307/308 an organiser's own signed payload to
  // loopback, RFC1918 or the cloud metadata endpoint on every retry.
  // `reachable.ts:115` already made this call for the same refusal table
  // (`reachable.test.ts`'s own precedent for how to prove it); this is the
  // one caller of it that had missed the decision.
  it("MAJOR-1: never follows a redirect — the request is sent with redirect: manual", async () => {
    const wsp = newId("wsp");
    await hookIn(wsp, ["attempt.submitted"]);
    let capturedInit: RequestInit | undefined;
    const http = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    await fireWebhooks(withHttp(http), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_x" },
      now: FIXED_NOW,
    });

    expect(capturedInit?.redirect).toBe("manual");
  });

  // A `redirect: "manual"` response surfaces to the WHATWG fetch caller as
  // an opaque, not-ok response (`type: "opaqueredirect"`, `ok: false`) —
  // never an automatic second request. Simulated here as any non-2xx,
  // since `tryDeliver` only ever inspects `response.ok`/`status`, exactly
  // as it does for an ordinary 500: a receiver that redirects is recorded
  // as a failure and queued for the drain, same as any other failure.
  it("MAJOR-1: a redirecting receiver is treated as a failure, not followed a second time", async () => {
    const wsp = newId("wsp");
    const { webhookId } = await hookIn(wsp, ["attempt.submitted"]);
    const http = vi.fn(async () => new Response(null, { status: 0 })) as unknown as typeof globalThis.fetch;

    const result = await fireWebhooks(withHttp(http), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_x" },
      now: FIXED_NOW,
    });

    expect(http).toHaveBeenCalledTimes(1); // never a second call to the redirect target
    expect(result).toEqual({ delivered: 0, queued: 1 });
    expect(await deliveryRows(wsp)).toEqual([{ event: "attempt.submitted", webhook_id: webhookId }]);
  });

  it("queues attempt.started without attempting it inline", async () => {
    const wsp = newId("wsp");
    const http = okHttp();
    const { webhookId } = await hookIn(wsp, ["attempt.started"]);

    const result = await fireWebhooks(withHttp(http), {
      workspaceId: wsp,
      event: "attempt.started",
      payload: { attemptId: "att_x" },
      now: FIXED_NOW,
    });

    expect(result).toEqual({ delivered: 0, queued: 1 });
    expect(http).not.toHaveBeenCalled();
    expect(await deliveryRows(wsp)).toEqual([{ event: "attempt.started", webhook_id: webhookId }]);
  });

  it("offers no attempt.flagged event — K43, nothing can fire it", () => {
    expect(WEBHOOK_EVENTS).not.toContain("attempt.flagged");
    // Control: the negative above is vacuous if the constant is empty or
    // renamed out from under this assertion.
    expect(WEBHOOK_EVENTS).toContain("attempt.submitted");
  });

  it("sends nothing to a hook that did not subscribe to the event", async () => {
    const wsp = newId("wsp");
    await hookIn(wsp, ["attempt.submitted"]); // not test.closed

    const result = await fireWebhooks(withHttp(okHttp()), {
      workspaceId: wsp,
      event: "test.closed",
      payload: { testId: "tst_x" },
      now: FIXED_NOW,
    });

    expect(result).toEqual({ delivered: 0, queued: 0 });
    expect(await deliveryRows(wsp)).toEqual([]);
  });

  it("K24: signs exactly the bytes it sends over the wire", async () => {
    let capturedBody: string | null = null;
    let capturedSignature: string | null = null;
    const http = vi.fn(async (_url: unknown, init?: RequestInit) => {
      capturedBody = init?.body as string;
      capturedSignature = (init?.headers as Record<string, string>)[SIGNATURE_HEADER] ?? null;
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const wsp = newId("wsp");
    const { signingSecret } = await hookIn(wsp, ["attempt.submitted"]);

    await fireWebhooks(withHttp(http), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_captured", note: 'has "quotes" and a space' },
      now: FIXED_NOW,
    });

    expect(capturedBody).not.toBeNull();
    expect(capturedSignature).not.toBeNull();
    // An independent HMAC-SHA256 over the exact body `http` received,
    // never a second call to `signatureHeader` — the whole point is to
    // catch `deliver.ts` signing one string and sending another.
    expect(verifyIndependently(capturedSignature!, capturedBody!, signingSecret)).toBe(true);
  });

  // --- Fix round 1, F1: bounded fan-out -----------------------------------

  it(`F1: caps attempt.submitted at INLINE_FANOUT_LIMIT (${INLINE_FANOUT_LIMIT}) fetches and queues the rest in one call, not dropped`, async () => {
    const wsp = newId("wsp");
    const hookIds: string[] = [];
    for (let i = 0; i < INLINE_FANOUT_LIMIT + 2; i++) {
      hookIds.push((await hookIn(wsp, ["attempt.submitted"])).webhookId);
    }
    const http = failingHttp();

    const result = await fireWebhooks(withHttp(http), {
      workspaceId: wsp,
      event: "attempt.submitted",
      payload: { attemptId: "att_overflow" },
      now: FIXED_NOW,
    });

    // Every registered hook failed or was never attempted — none delivered,
    // and `queued` is the whole set: an overflow hook is still a hook, not
    // a dropped one.
    expect(result).toEqual({ delivered: 0, queued: INLINE_FANOUT_LIMIT + 2 });
    expect(http).toHaveBeenCalledTimes(INLINE_FANOUT_LIMIT);

    const rows = await deps.db.query<{ webhook_id: string; attempt_count: number }>(
      "SELECT webhook_id, attempt_count FROM webhook_delivery WHERE workspace_id = ?",
      [wsp],
    );
    // Not dropped: a row for every one of the hooks that were registered,
    // `INLINE_FANOUT_LIMIT` of them actually tried (attempt_count 1) and
    // the overflow never touched (attempt_count 0) — exactly the shape
    // `attempt.started`/`test.closed` rows already have, so Task 4's drain
    // sees one consistent "never tried yet" state either way.
    expect(rows.map((r) => r.webhook_id).sort()).toEqual([...hookIds].sort());
    expect(rows.filter((r) => r.attempt_count === 1)).toHaveLength(INLINE_FANOUT_LIMIT);
    expect(rows.filter((r) => r.attempt_count === 0)).toHaveLength(2);
  });

  it("F1: the subrequest cost is the same at the limit and past it — the bound ROUTE_BUDGETS relies on", async () => {
    const atLimit = newId("wsp");
    for (let i = 0; i < INLINE_FANOUT_LIMIT; i++) await hookIn(atLimit, ["attempt.submitted"]);
    const pastLimit = newId("wsp");
    for (let i = 0; i < INLINE_FANOUT_LIMIT + 20; i++) await hookIn(pastLimit, ["attempt.submitted"]);

    const atCounting = countingDeps(withHttp(failingHttp()));
    await fireWebhooks(atCounting.deps, {
      workspaceId: atLimit,
      event: "attempt.submitted",
      payload: { attemptId: "att_a" },
      now: FIXED_NOW,
    });

    const pastCounting = countingDeps(withHttp(failingHttp()));
    await fireWebhooks(pastCounting.deps, {
      workspaceId: pastLimit,
      event: "attempt.submitted",
      payload: { attemptId: "att_b" },
      now: FIXED_NOW,
    });

    // 20 more hooks registered, and the same subrequest total: 1 read
    // (`listActiveWebhooksForEvent`) + `INLINE_FANOUT_LIMIT` fetches + 1
    // batched insert for everything that did not deliver, regardless of N.
    expect(pastCounting.counts().total).toBe(atCounting.counts().total);
    expect(atCounting.counts()).toEqual({ db: 2, storage: 0, http: INLINE_FANOUT_LIMIT, total: 2 + INLINE_FANOUT_LIMIT });
  });
});

// --- the submit route -------------------------------------------------------

const SUBMIT_PATH = "/api/v1/run/attempt/submit";

/** Starts a fresh attempt on `alpha/paper` (seeded above) with `http`
 *  wired through `deps`, and hands back the same app and cookie so the
 *  submit call downstream sees the identical injected `fetch`. */
async function startWith(http: typeof globalThis.fetch): Promise<{ app: ReturnType<typeof createApp>; cookie: string }> {
  const appDeps = withHttp(http);
  const app = createApp(appDeps);
  const { cookie } = await startAttemptFor(appDeps, app, "paper");
  return { app, cookie };
}

describe("the submit route, with a webhook registered", () => {
  it("delivers inline, through the real route, with the real signer", async () => {
    const http = okHttp();
    const { app, cookie } = await startWith(http);

    const res = await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie } });

    expect(res.status).toBe(200);
    expect((await res.json()).receipt).toBeDefined();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("lets the candidate's submission succeed when the receiver throws (a 500)", async () => {
    const http = failingHttp();
    const { app, cookie } = await startWith(http);

    const res = await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie } });

    expect(res.status).toBe(200);
    expect((await res.json()).receipt).toBeDefined();
  });

  it("lets the candidate's submission succeed, and return promptly, when the receiver hangs", async () => {
    const http = hangingHttp();
    const { app, cookie } = await startWith(http);

    const started = Date.now();
    const res = await app.request(SUBMIT_PATH, { method: "POST", headers: { cookie } });

    expect(Date.now() - started).toBeLessThan(DELIVERY_TIMEOUT_MS + 500);
    expect(res.status).toBe(200);
    expect((await res.json()).receipt).toBeDefined();
  }, DELIVERY_TIMEOUT_MS + 2000);

  it("keeps the submit route inside its declared budget with a webhook firing", async () => {
    const http = okHttp();
    const { app, cookie } = await startWith(http);
    // `app` above was built over plain `withHttp(http)`; this call rebuilds
    // one more time over `countingDeps` so the attempt-start subrequests
    // are never counted — only the submit request itself is.
    const counting = countingDeps(withHttp(http));

    const res = await createApp(counting.deps).request(SUBMIT_PATH, { method: "POST", headers: { cookie } });

    expect(res.status).toBe(200);
    expect(counting.counts().total, "POST /api/v1/run/attempt/submit, webhook firing").toBe(
      ROUTE_BUDGETS["/api/v1/run/attempt/submit"],
    );
  });
});
