# Phase 8d — The Perimeter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let another system learn that something happened, and let another system ask — a signed webhook that retries for 24 hours, and a scoped, revocable, hashed API key.

**Architecture:** Delivery is a table drained by a second cron, because `AC-28` wants the signature at the endpoint within 10 s (only an inline first attempt meets that) and `D-03` wants backoff out to 24 hours (the one nightly cron cannot express that). An API key is **not** a sixth request authority: it is a second way to satisfy the existing `workspace` authority, resolved to a workspace and a scope set and checked by the same `can()` against the same `ROUTE_ACTIONS` entry.

**Tech Stack:** TypeScript (strict), Vitest, Hono, Preact/React, Web Crypto (HMAC-SHA256).

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K22`, `K23`, `K24`, `K25`, `K26`, `K27`, `K35`, `K36`, `K37`, **`K43`**, `KG2`, `KG5`.

**Depends on:** **8a** — `0009`'s `webhook_delivery` table, the `SCHEDULED_JOBS` registry, and `estimateCost` for the webhook cost line. **Starts only once 7d merges** (`K43`).

**Goals covered:** `G3`'s machine half, and `S-05`.

**Issues:** #99 (`P8.11`), #100 (`P8.12`).

## Scope warning, read before sizing this plan

**The pre-flight said the `webhook` and `api_key` *tables* exist. Nothing else does.** Grepping `apps/` and `packages/` outside `packages/db` finds no repo function, no route and no organiser screen for either — only the landing page's marketing copy. This plan builds **both CRUD surfaces, both secret-shown-once flows, the event selector and the scope selector**, as well as HMAC, `webhook_delivery` and the drain. It is two plans' worth of work in one. **Split it at execution if the task list runs long; do not quietly drop the CRUD.**

## Global Constraints

**8a's Global Constraints apply in full and are not repeated.** These are this plan's additions.

- **`keys.manage` gets its first production caller here.** `ROUTE_AUTH` + `ROUTE_ACTIONS` + a measured `ROUTE_BUDGETS` entry on every route, each 403 test with a 200 beside it (`KG2`).
- **`KG5`** — no response body anywhere contains `secret_hash`, `signing_secret`, or a key's plaintext after the one creation response. Source-scanned, with a positive control.
- **`K36`** — the webhook cost line is absent on `env.target === "node"`. The API omits the field.
- **An outbound `fetch` is one subrequest** against the 50 ceiling, and `instrument.ts` counts every one. The submit route's budget must grow to include it (`K23`).
- Record each ruling in `.superpowers/sdd/phase-8d/progress.md`.

## Review Focus

1. **A webhook endpoint that hangs rather than failing.** `K23` covers a timeout, a 500 and a DNS failure; a socket that accepts and never answers is the one that takes the candidate's submission down with it, because it consumes the invocation rather than erroring. An explicit `AbortSignal.timeout` is the only thing that bounds it. Task 3.
2. **A receiver recomputing the signature over a re-serialised body.** `K24` signs the exact bytes sent. If the route serialises once for signing and again for sending, key order or whitespace can differ and every receiver fails. The test must sign, send through the real route, and verify with an **independently written** verifier. Task 2.
3. **An API key presented on a route whose action it does not hold.** The whole of `K25` is that the same `can()` answers. A key scoped to `results.export` reaching a `tests.edit` route must be 403 — and a key that *does* hold the action must be 200 in the same file, or a typo makes both pass. Task 5.
4. **A revoked key, and a key belonging to another workspace.** `api_key` has `revoked_at` and a `workspace_id`; a lookup by `secret_hash` alone finds both. Revocation that does not take effect immediately is the failure that makes a key not really revocable. Task 5.
5. **A delivery row retried past 24 hours.** Exponential backoff must terminate, mark the row dead, and stop — not retry forever at the ceiling, which would make one permanently broken endpoint a standing cost on every tick for the life of the workspace. Task 4.

---

### Task 1: Webhook CRUD and the secret shown once

**Files:**
- Create: `packages/db/src/repo/webhooks.ts`
- Create: `apps/api/src/routes/webhooks.ts`
- Create: `apps/web/src/components/organiser/WebhookPanel.tsx`
- Modify: `apps/api/src/app.ts`, `apps/web/src/routes/organiser.tsx`
- Test: `packages/db/test/repo/webhooks.test.ts`, `apps/api/test/webhooks.test.ts`

**Interfaces:**
- Produces:

```ts
// `K43`: "attempt.flagged" is NOT a member. Its only trigger is 8g's
// integrity recompute and 8g is deferred with 7e — an event a selector
// offers but nothing can ever fire is the `Q1b` defect. It returns with
// 8g, as one more member here plus its caller. The delivery machinery
// below is event-agnostic and needs no change for it.
export const WEBHOOK_EVENTS = [
  "attempt.started", "attempt.submitted", "test.closed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const createWebhook: Scoped<(input: {
  url: string; events: readonly WebhookEvent[]; now: number;
}) => Promise<{ webhookId: string; signingSecret: string }>>;   // secret returned ONCE

export const listWebhooks: Scoped<() => Promise<WebhookRow[]>>;  // never carries signingSecret
export const setWebhookActive: Scoped<(webhookId: string, active: boolean) => Promise<void>>;
export const deleteWebhook: Scoped<(webhookId: string) => Promise<void>>;
```

Routes under `/api/v1/workspaces/:id/webhooks` — `workspace`, `workspace.settings`.

**Ruling to take and record:** webhooks are guarded by `workspace.settings` rather than a new action. The permission matrix is transcribed cell-for-cell from `docs/PRD.md` and adding a row is a PRD change; a webhook is workspace configuration and Owner and Admin are exactly who should hold it. *Cost if wrong:* a role that should configure webhooks without touching other settings cannot.

**The URL is validated against SSRF at the trust boundary.** `apps/api/src/net/` already holds the reachability work from `T-19`; reuse its refusal rules rather than writing a second allowlist. A webhook URL is organiser-supplied and the Worker fetches it — that is the same hazard `check_reachable` was cut over.

- [ ] **Step 1: Write the failing tests**

```ts
it("returns the signing secret exactly once, on creation", async () => {
  const { signingSecret } = await createWebhook(db, wsp, { url, events: ["attempt.submitted"], now });
  expect(signingSecret).toMatch(/^whsec_/);
  expect(JSON.stringify(await listWebhooks(db, wsp))).not.toContain(signingSecret);
});

it("refuses a URL pointing at a private address", async () => {
  await expect(createWebhook(db, wsp, { url: "http://169.254.169.254/latest", events: ["attempt.submitted"], now }))
    .rejects.toThrow();
});

it("accepts an ordinary public URL — control for the test above", async () => {
  await expect(createWebhook(db, wsp, { url: "https://example.test/hook", events: ["attempt.submitted"], now }))
    .resolves.toBeDefined();
});

it("refuses an event outside the closed set", async () => {
  await expect(createWebhook(db, wsp, { url, events: ["attempt.invented"] as never, now })).rejects.toThrow();
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement the repo, the routes and the panel**

The panel shows the secret once, with copy-to-clipboard and a sentence saying it will not be shown again. The event selector offers exactly `WEBHOOK_EVENTS`.

- [ ] **Step 4: Add the cost line (`K35`), absent on `node` (`K36`)**

`estimateCost`'s `webhooks` line: one delivery per subscribed hook per candidate. The panel renders it beside the event selector, before the webhook is saved.

- [ ] **Step 5: Write the `KG5` source scan with its positive control**

```ts
it("no route serialises signingSecret or secret_hash", () => {
  expect(grepSource(["signingSecret", "secret_hash"], "apps/api/src/routes")).toEqual([]);
});

it("the scan finds one when planted — control", () => {
  expect(grepSource(["signingSecret"], FIXTURE_WITH_ONE)).not.toEqual([]);
});
```

- [ ] **Step 6: Authorisation tests, each 403 with its 200. Run both api configs.**

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repo/webhooks.ts apps/api/src/routes/webhooks.ts apps/web/src/components/organiser/WebhookPanel.tsx apps/api/src/app.ts apps/web/src/routes/organiser.tsx packages/db/test apps/api/test
git commit -m "feat(db,api,web): webhook CRUD, the secret shown once, and the cost line (K35, K36, KG5, #99)"
```

---

### Task 2: The HMAC signature

**Files:**
- Create: `apps/api/src/webhooks/sign.ts`
- Test: `apps/api/test/webhooks/sign.test.ts`

**Interfaces:**
- Produces:

```ts
/** `t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256("<t>.<raw body>"). */
export function signatureHeader(rawBody: string, secret: string, nowSeconds: number): string;
export const SIGNATURE_HEADER = "X-Pariksha-Signature";
```

**`K24`** — the signature covers the **exact bytes sent**, with the timestamp inside the signed string. Signing a re-serialised object is how a signature verifies on the sender and fails on the receiver; `t` inside the string is what makes a replay window enforceable.

- [ ] **Step 1: Write the failing test with an independent verifier**

Review Focus item 2. The verifier is written from the documented format, not by calling `signatureHeader` — a test that signs and verifies with the same function proves only that the function is deterministic.

```ts
function verifyIndependently(header: string, rawBody: string, secret: string): boolean {
  const t = /t=(\d+)/.exec(header)![1];
  const v1 = /v1=([0-9a-f]+)/.exec(header)![1];
  const mac = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(mac), Buffer.from(v1));
}

it("produces a signature an independent verifier accepts", () => {
  const body = JSON.stringify({ event: "attempt.submitted", attemptId: "att_1" });
  expect(verifyIndependently(signatureHeader(body, "whsec_x", 1_700_000_000), body, "whsec_x")).toBe(true);
});

it("fails verification when one byte of the body changes", () => {
  const header = signatureHeader('{"a":1}', "whsec_x", 1_700_000_000);
  expect(verifyIndependently(header, '{"a":2}', "whsec_x")).toBe(false);
});

it("fails verification under a different secret", () => {
  const header = signatureHeader('{"a":1}', "whsec_x", 1_700_000_000);
  expect(verifyIndependently(header, '{"a":1}', "whsec_y")).toBe(false);
});

it("changes when only the timestamp changes, so t is inside the signed string", () => {
  expect(signatureHeader('{"a":1}', "whsec_x", 1_700_000_000))
    .not.toBe(signatureHeader('{"a":1}', "whsec_x", 1_700_000_001));
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement with Web Crypto**

`crypto.subtle.importKey` + `sign`. Workers has no `node:crypto` `createHmac` at runtime — the **test** may use it (that is what makes the verifier independent), the implementation may not.

- [ ] **Step 4: Run, then document the format**

Write the verification recipe into `docs/` — a receiver cannot verify a format nobody published, and `AC-28` is validated by hand against a real endpoint.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/webhooks/sign.ts apps/api/test/webhooks/sign.test.ts docs
git commit -m "feat(api): HMAC-SHA256 over the exact bytes sent, timestamp inside the string (K24)"
```

---

### Task 3: Inline first delivery, fail-open

**Files:**
- Create: `apps/api/src/webhooks/deliver.ts`
- Modify: `apps/api/src/run/submit.ts` (fire `attempt.submitted`)
- Modify: `apps/api/src/routes/tests.ts` (fire `test.closed`)
- Modify: `apps/api/src/app.ts` (the submit route's budget grows by one)
- Test: `apps/api/test/webhooks/deliver.test.ts`

**Interfaces:**
- Consumes: `signatureHeader` (Task 2), `0009`'s `webhook_delivery`.
- Produces:

```ts
/** Attempts once inline. NEVER throws to its caller. On any failure it
 *  writes a webhook_delivery row for the drain. `K23`. */
export async function fireWebhooks(deps: AppDeps, input: {
  workspaceId: string; event: WebhookEvent; payload: unknown; now: number;
}): Promise<{ delivered: number; queued: number }>;

export const DELIVERY_TIMEOUT_MS = 5_000;
```

**`K37` as revised by `K43`** — three events, not four. **Only `attempt.submitted` delivers inline.** `attempt.started` and `test.closed` write a row and the drain sends them. `attempt.started` fires on a candidate hot path 300 times per test; an inline fetch there is one more subrequest and one more failure mode to save a receiver five minutes on an event nobody waits for.

**`attempt.flagged` is cut**, because the only thing that writes `attempt.integrity_flag` is 7e's recompute and 7e is out of scope. Ship no member and no selector entry — a control that does nothing is the defect 7c's branch review corrected three times.

- [ ] **Step 1: Write the failing tests**

Review Focus item 1 is the second.

```ts
it("delivers attempt.submitted inline and queues nothing", async () => {
  expect(await fireWebhooks(deps, { workspaceId: wsp, event: "attempt.submitted", payload, now }))
    .toEqual({ delivered: 1, queued: 0 });
});

it("does not hang the request on an endpoint that never answers", async () => {
  const started = Date.now();
  await fireWebhooks(hangingDeps, { workspaceId: wsp, event: "attempt.submitted", payload, now });
  expect(Date.now() - started).toBeLessThan(DELIVERY_TIMEOUT_MS + 500);
});

it("queues rather than throwing on a 500", async () => {
  expect(await fireWebhooks(failingDeps, { workspaceId: wsp, event: "attempt.submitted", payload, now }))
    .toEqual({ delivered: 0, queued: 1 });
});

it("lets the candidate's submission succeed when every endpoint is down", async () => {
  const res = await submitAttempt(failingDeps, submitInput);
  expect(res.receipt).toBeDefined();
});

it("queues attempt.started without attempting it inline", async () => {
  expect(await fireWebhooks(deps, { workspaceId: wsp, event: "attempt.started", payload, now }))
    .toEqual({ delivered: 0, queued: 1 });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("offers no attempt.flagged event — K43, nothing can fire it", () => {
  expect(WEBHOOK_EVENTS).not.toContain("attempt.flagged");
  // Control: the negative above is vacuous if the constant is empty or renamed.
  expect(WEBHOOK_EVENTS).toContain("attempt.submitted");
});

it("sends nothing to a hook that did not subscribe to the event", async () => {
  expect(await fireWebhooks(deps, { workspaceId: wsp, event: "test.closed", payload, now }))
    .toEqual({ delivered: 0, queued: 0 });
});

it("keeps the submit route inside its declared budget with a webhook firing", async () => {
  const counting = countingDeps(deps);
  await submitAttempt(counting.deps, submitInput);
  expect(counting.counts().total).toBeLessThanOrEqual(ROUTE_BUDGETS["/api/v1/run/attempt/submit"]);
});
```

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement with an explicit timeout, and grow the submit budget**

`AbortSignal.timeout(DELIVERY_TIMEOUT_MS)`. Measure the new submit budget with `countingDeps`; do not estimate it.

- [ ] **Step 4: Run both api configs**

- [ ] **Step 5: Probe — prove the fail-open test can fail**

Let `fireWebhooks` rethrow. Run the "candidate's submission succeeds" test. Record the verbatim failure. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/webhooks/deliver.ts apps/api/src/run/submit.ts apps/api/src/routes/tests.ts apps/api/src/app.ts apps/api/test/webhooks
git commit -m "feat(api): inline first delivery for attempt.submitted, fail-open, the rest queued (K23, K37)"
```

---

### Task 4: The drain, the backoff, and the second cron

**Files:**
- Create: `apps/api/src/webhooks/drain.ts`
- Modify: `apps/api/src/scheduled.ts` (register, and its `toEqual([])` test)
- Modify: `deploy/cloudflare/wrangler.toml` (the second cron entry)
- Test: `apps/api/test/webhooks/drain.test.ts`

**Interfaces:**
- Produces: `export const webhookDrainJob: ScheduledJob;` under `*/5 * * * *`.

**`K22`** — exponential backoff out to 24 hours. The second cron entry is added **here**, beside the drain it exists for, with a comment giving its cost: 288 invocations a day of a handler that usually finds nothing and exits.

- [ ] **Step 1: Write the failing tests**

Review Focus item 5 is the third.

```ts
it("retries a queued delivery and marks it delivered on success", async () => {
  await webhookDrainJob.run(deps);
  expect((await getDelivery(db, wsp, deliveryId))!.deliveredAt).not.toBeNull();
});

it("backs off exponentially on each failure", async () => {
  await webhookDrainJob.run(failingDeps);
  const first = (await getDelivery(db, wsp, deliveryId))!.nextAttemptAt;
  await webhookDrainJob.run({ ...failingDeps, now: () => first });
  const second = (await getDelivery(db, wsp, deliveryId))!.nextAttemptAt;
  expect(second - first).toBeGreaterThan(first - now);
});

it("stops after 24 hours rather than retrying forever", async () => {
  const row = await deliveryAged(25 * 3600_000);
  await webhookDrainJob.run(failingDeps);
  expect((await getDelivery(db, wsp, row.id))!.lastError).toMatch(/gave up/);
  await webhookDrainJob.run(failingDeps);
  expect(fetchSpy).toHaveBeenCalledTimes(1);   // not attempted a second time
});

it("takes nothing that is not yet due", async () => {
  await webhookDrainJob.run(deps);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("stays inside the ceiling with many due deliveries", async () => {
  const counting = countingDeps(depsWith300Due);
  await webhookDrainJob.run(counting.deps);
  expect(counting.counts().total).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
});
```

The last bounds the batch: each delivery is one outbound fetch, so a tick can send at most a few dozen. Bound it explicitly and resume on the next tick.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement, register, and add the cron entry**

Registering changes 8a Task 6's `toEqual([])` test — update it to name this job.

- [ ] **Step 4: Run both api configs**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/webhooks/drain.ts apps/api/src/scheduled.ts deploy/cloudflare/wrangler.toml apps/api/test
git commit -m "feat(api): the webhook drain, backoff to 24h, and the second cron (K22)"
```

---

### Task 5: Scoped API keys

**Files:**
- Create: `packages/db/src/repo/keys.ts`
- Create: `apps/api/src/routes/keys.ts`
- Modify: `apps/api/src/middleware/authenticate.ts` (resolve a `Bearer pk_…` to a workspace and scopes)
- Modify: `apps/api/src/middleware/authorize.ts` (the same `can()` answers for a key)
- Create: `apps/web/src/components/organiser/ApiKeyPanel.tsx`
- Modify: `apps/api/src/app.ts`, `apps/web/src/routes/organiser.tsx`
- Test: `apps/api/test/keys.test.ts`, `apps/api/test/authorization.test.ts`

**Interfaces:**
- Produces:

```ts
export const createApiKey: Scoped<(input: {
  name: string; scopes: readonly Action[]; now: number;
}) => Promise<{ apiKeyId: string; secret: string }>>;   // secret returned ONCE

export const resolveApiKey: (db: DbClient, presented: string)
  => Promise<{ workspaceId: string; scopes: Action[] } | null>;

export const revokeApiKey: Scoped<(apiKeyId: string, now: number) => Promise<void>>;

/** K26: refused at creation, not merely at use. */
export const KEY_FORBIDDEN_ACTIONS: readonly Action[] = ["keys.manage", "members.manage"];
```

**`K25`** — **`ROUTE_AUTH` keeps its five values.** A key satisfies the existing `workspace` authority. `route-authority.test.ts` asserts the `workspace` key set is exactly `Object.keys(ROUTE_ACTIONS)` — that assertion must stay true and unchanged, which is the structural proof no sixth authority was added.

**`K26`** — a key may never hold `keys.manage` or `members.manage`. A leaked key that mints keys is not revocable by revoking it.

The secret is stored as a **hash** (`api_key.secret_hash`, unique). Look up by hash, never by scanning.

- [ ] **Step 1: Write the failing tests**

Review Focus items 3 and 4 are tests 3–6.

```ts
it("returns the secret once and stores only a hash", async () => {
  const { secret } = await createApiKey(db, wsp, { name: "ATS", scopes: ["results.export"], now });
  expect(secret).toMatch(/^pk_/);
  expect(JSON.stringify(await listApiKeys(db, wsp))).not.toContain(secret);
});

it("refuses keys.manage at creation", async () => {
  await expect(createApiKey(db, wsp, { name: "bad", scopes: ["keys.manage"], now })).rejects.toThrow();
});

it("admits a key holding the route's action", async () => {
  expect((await get(exportUrl, withKey(exportKey))).status).toBe(200);
});

it("refuses a key that does not hold it", async () => {
  expect((await get(testsEditUrl, withKey(exportKey))).status).toBe(403);
});

it("refuses a revoked key immediately", async () => {
  await revokeApiKey(db, wsp, apiKeyId, now);
  expect((await get(exportUrl, withKey(exportKey))).status).toBe(401);
});

it("refuses a key against another workspace's URL", async () => {
  expect((await get(otherWorkspaceExportUrl, withKey(exportKey))).status).toBe(404);
});

it("adds no sixth authority", () => {
  expect(new Set(Object.values(ROUTE_AUTH)))
    .toEqual(new Set(["public", "entry", "attempt", "actor", "workspace"]));
});
```

The last is `K25` as an assertion, and it is the cheapest guard in the plan.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement resolution, the routes and the panel**

`resolveApiKey` hashes the presented secret and looks up by the unique `secret_hash`, rejecting a row with a non-null `revoked_at`. It stamps `last_used_at` — note that this is a **write on every authenticated key request**; measure its budget impact and record the ruling if it proves too costly (a coarser "today" stamp is the cheap alternative).

- [ ] **Step 4: Run both api configs, and the whole branch**

Run: `npx turbo run test --force --concurrency=1`

- [ ] **Step 5: Probe — prove the scope check can fail**

Make `resolveApiKey` return every action. Run the 403 test. Record the verbatim failure. Restore.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repo/keys.ts apps/api/src/routes/keys.ts apps/api/src/middleware apps/web/src/components/organiser/ApiKeyPanel.tsx apps/api/src/app.ts apps/web/src/routes/organiser.tsx apps/api/test
git commit -m "feat(db,api,web): scoped API keys on the existing workspace authority (K25, K26, #100)"
```
