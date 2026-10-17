# Phase 2 — Data and API Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the persistence and HTTP foundation every later phase sits on — one Drizzle schema that migrates cleanly onto D1, SQLite and Postgres, a repository layer that cannot read across workspaces, object storage behind one adapter interface with short-lived signed URLs, and a Hono API that runs unchanged on Cloudflare Workers and Node — then deploy it.

**Architecture:** Three adapter seams, exactly as [ADR 0002](../../adr/0002-cloudflare-reference-stack-with-adapters.md) specifies. `packages/db` owns the schema in two dialect files kept honest by a parity test, plus a repository layer where every exported function takes a workspace ID as its first argument. `packages/storage` exposes one `StorageAdapter` interface with R2, S3 and disk implementations. `apps/api` is a Hono application with two thin entry points — `index.ts` for the Workers runtime and `node.ts` for Node 22 — sharing one `createApp(deps)` factory, so every route is testable with in-memory adapters and no network.

**Tech Stack:** Hono 4, Drizzle ORM 0.44 with drizzle-kit, `@cloudflare/workers-types`, Wrangler 4, Miniflare via `@cloudflare/vitest-pool-workers`, `better-sqlite3` (Node/dev), `postgres` (Postgres driver), `aws4fetch` (S3 and R2 presigning, works in Workers), Zod 4 for request validation.

**Spec:** [`docs/PRD.md`](../../PRD.md#data-model-question-format-and-api) · [`docs/adr/0002-cloudflare-reference-stack-with-adapters.md`](../../adr/0002-cloudflare-reference-stack-with-adapters.md) · [`docs/ROADMAP.md`](../../ROADMAP.md#phase-2--data-and-api-platform)

## Global Constraints

- Everything from Phase 1's Global Constraints still holds: Node 22, pnpm, strict TypeScript, DCO sign-off on every commit.
- **Subrequest budget.** The Workers free plan allows 50 subrequests per invocation and every D1, R2 and KV call is one. No route may loop over questions issuing a query each. The hot path — saving one answer — is **one D1 write plus at most one R2 call** (ADR 0002).
- **CPU budget.** 10 ms per invocation on the free plan. No password hashing, no large synchronous parsing, no cryptographic work beyond HMAC and random generation in this phase.
- **Every timestamp column is an integer of epoch milliseconds** in every dialect. No `DATETIME`, no `TIMESTAMPTZ`, no dialect-specific date defaults.
- **Every table that holds tenant data carries `workspace_id`**, and every repository function takes it as the first parameter. There is no exported read path without one.
- IDs are `<prefix>_<12 chars>` from a Crockford base32 alphabet over `crypto.getRandomValues`. Prefixes: `wsp_`, `usr_`, `tst_`, `bnk_`, `qst_`, `cnd_`, `att_`, `key_`, `whk_`.
- Snapshot and media URLs are signed and expire in **10 minutes** (PRD `S-16`, `AC-26`).
- API responses use one envelope: success is the payload itself, failure is `{ "error": { "code": string, "message": string, "details"?: unknown } }` with an appropriate status. `code` is a stable machine string; `message` is for a human.
- A cross-workspace resource returns **404, not 403** (PRD `S-09`) — existence is not disclosed.
- No route logs personal data. Logs are structured JSON carrying request ID, route, status and duration only.

## Review Focus

1. **A repository function added later without a workspace filter.** One missing `WHERE workspace_id = ?` is a cross-tenant data leak, and it will be added by someone adding a feature, not by someone editing this phase. The guard has to be structural and automated, not a review habit. — Task 4.
2. **A route that loops over a collection issuing one query per item.** It passes every test at 10 questions and fails in production at 60, because the 50-subrequest ceiling is per invocation and nothing warns before it is hit. — Task 7.
3. **An answer upsert arriving out of order.** The client retries on a flaky network, so a `client_seq` of 4 can land after 5. Last-write-wins silently restores an older answer and the candidate loses work — the one outcome the PRD's durability requirement names as never acceptable. — Task 4.
4. **A signed URL checked against the wrong clock, or with its expiry absent from the signature.** An expiry a client can edit without invalidating the signature is not an expiry, and `AC-26` is the test that catches it. — Task 5.
5. **A migration that applies on SQLite and fails or behaves differently on Postgres.** Boolean storage, `AUTOINCREMENT`, partial indexes and text collation all diverge, and the PRD names dialect drift as a standing risk. Both dialects must migrate in CI on every pull request. — Tasks 2 and 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/db/src/ids.ts` | Prefixed ID generation |
| `packages/db/src/schema/columns.ts` | Shared column shapes and the table manifest both dialects build from |
| `packages/db/src/schema/sqlite.ts` | D1 and SQLite tables |
| `packages/db/src/schema/pg.ts` | Postgres tables |
| `packages/db/src/client.ts` | `DbClient` union and the three constructors |
| `packages/db/src/repo/workspaces.ts` | Workspace and membership reads and writes |
| `packages/db/src/repo/tests.ts` | Tests, versions, sets |
| `packages/db/src/repo/attempts.ts` | Candidates, attempts, responses, events |
| `packages/db/src/repo/audit.ts` | Append-only audit entries |
| `packages/db/src/repo/guard.ts` | `scoped()` — the wrapper every repo function passes through |
| `packages/db/migrations/**` | Generated SQL, one folder per dialect |
| `packages/storage/src/adapter.ts` | `StorageAdapter` interface and errors |
| `packages/storage/src/r2.ts`, `s3.ts`, `disk.ts`, `memory.ts` | Implementations |
| `apps/api/src/app.ts` | `createApp(deps)` — every route mounted here |
| `apps/api/src/index.ts` | Workers entry: binds env to deps, exports default fetch |
| `apps/api/src/node.ts` | Node entry: same, over `@hono/node-server` |
| `apps/api/src/env.ts` | Typed environment parsing, one schema per target |
| `apps/api/src/middleware/*.ts` | Request ID, logging, security headers, error envelope |
| `apps/api/src/routes/health.ts` | `/api/v1/health` |
| `apps/api/test/**` | Route tests against in-memory adapters, plus Miniflare tests |
| `deploy/cloudflare/wrangler.toml` | Worker, D1, R2 and Cron bindings |
| `deploy/cloudflare/setup.mjs` | Creates the D1 database and R2 bucket, writes bindings, runs migrations |

---

## Task 1: Package skeletons and ID generation

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/ids.ts`, `packages/db/src/index.ts`
- Create: `packages/storage/package.json`, `packages/storage/tsconfig.json`, `packages/storage/src/index.ts`
- Create: `packages/db/test/ids.test.ts`

**Interfaces:**
- Produces: `@pariksha/db` and `@pariksha/storage` as workspace packages, and
  ```ts
  export const ID_PREFIXES = ["wsp","usr","tst","bnk","qst","cnd","att","key","whk"] as const;
  export type IdPrefix = (typeof ID_PREFIXES)[number];
  export function newId(prefix: IdPrefix): string;   // `${prefix}_${12 chars}`
  export function isId(value: string, prefix?: IdPrefix): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```ts
it("T-01: a test ID is tst_ followed by 12 characters", () => {
  expect(newId("tst")).toMatch(/^tst_[0123456789abcdefghjkmnpqrstvwxyz]{12}$/);
});

it("produces no collision across 100000 draws", () => {
  const s = new Set(Array.from({ length: 100_000 }, () => newId("att")));
  expect(s.size).toBe(100_000);
});

it("isId checks the prefix when one is given", () => {
  const id = newId("wsp");
  expect(isId(id, "wsp")).toBe(true);
  expect(isId(id, "tst")).toBe(false);
  expect(isId("tst_SHORT", "tst")).toBe(false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/db/test/ids.test.ts`
Expected: FAIL — package not found.

- [ ] **Step 3: Create both packages and implement `ids.ts`**

Use `globalThis.crypto.getRandomValues` (present on Workers and Node 22; do not import `node:crypto`). The alphabet is Crockford base32 lowercase without `i`, `l`, `o` and `u`, so an ID read aloud over a phone is unambiguous. Reject modulo bias by rejecting bytes at or above `256 - (256 % 32)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/db/test/ids.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db packages/storage
git commit -s -m "feat(db): workspace packages and prefixed ID generation"
```

---

## Task 2: Schema for SQLite and Postgres, with a parity test

**Files:**
- Create: `packages/db/src/schema/columns.ts`, `packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/pg.ts`, `packages/db/src/schema/index.ts`
- Create: `packages/db/test/parity.test.ts`
- Create: `packages/db/drizzle.sqlite.config.ts`, `packages/db/drizzle.pg.config.ts`

**Interfaces:**
- Produces: every table in the PRD's data-model section — `workspace`, `user`, `membership`, `question_bank`, `question`, `test`, `test_version`, `set`, `candidate`, `attempt`, `response`, `event`, `snapshot`, `review`, `audit_log`, `api_key`, `webhook`, `session` — exported from both dialect modules under the same names, plus `TABLE_MANIFEST` describing each table's columns, nullability and indexes.

`columns.ts` holds `TABLE_MANIFEST` as plain data. Both dialect files are written by hand against it, and `parity.test.ts` asserts they agree — which is what keeps the PRD's "two databases drift" risk from becoming a bug nobody notices until a Postgres user reports it. This task owns Review Focus item 5.

- [ ] **Step 1: Write the failing test**

```ts
it("both dialects define the same tables", () => {
  expect(tableNames(sqliteSchema)).toEqual(tableNames(pgSchema));
});

it("every table has the same columns, in the same nullability, in both dialects", () => {
  for (const t of TABLE_MANIFEST) {
    expect(columnSpec(sqliteSchema[t.name])).toEqual(columnSpec(pgSchema[t.name]));
  }
});

it("every tenant table carries workspace_id and indexes it", () => {
  for (const t of TABLE_MANIFEST.filter(t => t.tenant)) {
    expect(columnNames(sqliteSchema[t.name])).toContain("workspace_id");
    expect(indexedColumns(sqliteSchema[t.name])).toContain("workspace_id");
  }
});

it("every timestamp column is an integer of epoch milliseconds in both dialects", () => {
  for (const col of timestampColumns()) {
    expect(sqlType(sqliteSchema, col)).toBe("integer");
    expect(sqlType(pgSchema, col)).toBe("bigint");
  }
});

it("response is unique on (attempt_id, question_id)", () => { /* the upsert target */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/db/test/parity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `columns.ts`, then the two dialect schemas**

Field names come from the PRD's entity table verbatim. JSON columns are `text` in SQLite and `jsonb` in Postgres — the one permitted type divergence, declared in `TABLE_MANIFEST` so the parity test expects it. Booleans are `integer` 0/1 in SQLite and `boolean` in Postgres, likewise declared.

- [ ] **Step 4: Generate migrations for both dialects**

Run: `pnpm --filter @pariksha/db drizzle-kit generate --config drizzle.sqlite.config.ts` and the `pg` equivalent.
Expected: SQL files under `packages/db/migrations/sqlite/` and `packages/db/migrations/pg/`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run packages/db/test/parity.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -s -m "feat(db): drizzle schema for sqlite and postgres with a parity test"
```

---

## Task 3: Clients, migration runner and the dual-dialect CI job

**Files:**
- Create: `packages/db/src/client.ts`, `packages/db/src/migrate.ts`
- Create: `packages/db/test/migrate.test.ts`
- Modify: `.github/workflows/ci.yml` (add a `postgres:16` service to the `build` job, or a sibling `db` job)

**Interfaces:**
- Produces:
  ```ts
  export type Dialect = "d1" | "sqlite" | "pg";
  export interface DbClient { dialect: Dialect; /* drizzle instance, narrowed per dialect */ }
  export function d1Client(binding: D1Database): DbClient;
  export function sqliteClient(path: string): DbClient;
  export function pgClient(url: string): DbClient;
  export function migrate(db: DbClient): Promise<{ applied: string[] }>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
it("migrations apply to an empty SQLite database and create every table", async () => {
  const db = sqliteClient(":memory:");
  await migrate(db);
  expect(await tableNamesIn(db)).toEqual(expect.arrayContaining(TABLE_MANIFEST.map(t => t.name)));
});

it("migrations are idempotent: running twice applies nothing the second time", async () => {
  expect((await migrate(db)).applied).toEqual([]);
});

it("the same migrations apply to Postgres and create the same tables", async () => {
  // skipped unless process.env.TEST_POSTGRES_URL is set; CI always sets it
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/db/test/migrate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the clients and `migrate`**

`migrate` records applied migration names in a `_migrations` table it creates itself, so the same function works on D1 (where drizzle-kit's own runner is not available at runtime) as on the other two.

- [ ] **Step 4: Add Postgres to CI**

Add a `services: postgres: image: postgres:16` block with a health check, and set `TEST_POSTGRES_URL` for the test step.

- [ ] **Step 5: Verify both dialects migrate**

Run: `TEST_POSTGRES_URL=postgres://… pnpm vitest run packages/db`
Expected: PASS, including the Postgres case.

- [ ] **Step 6: Commit**

```bash
git add packages/db .github/workflows/ci.yml
git commit -s -m "feat(db): dialect clients, migration runner and postgres in CI"
```

---

## Task 4: Workspace-scoped repository layer

**Files:**
- Create: `packages/db/src/repo/guard.ts`, `workspaces.ts`, `tests.ts`, `attempts.ts`, `audit.ts`, `packages/db/src/repo/index.ts`
- Create: `packages/db/test/repo/isolation.test.ts`, `packages/db/test/repo/responses.test.ts`

**Interfaces:**
- Produces: every repository function, each shaped `(db: DbClient, workspaceId: string, …) => Promise<…>`, plus
  ```ts
  export function scoped<A extends unknown[], R>(name: string, fn: (db: DbClient, workspaceId: string, ...rest: A) => Promise<R>): ScopedFn<A, R>;
  export const REPO_FUNCTIONS: Record<string, ScopedFn<never[], unknown>>;  // every scoped() result, by name
  export function upsertResponse(db: DbClient, workspaceId: string, input: { attemptId: string; questionId: string; value: unknown; clientSeq: number; savedAt: number }): Promise<{ stored: boolean }>;
  ```

This task owns Review Focus items 1 and 3.

`scoped()` is how the guard becomes structural: a repository function is only reachable through it, it throws when `workspaceId` is empty or malformed, and it registers itself in `REPO_FUNCTIONS` so a test can enumerate every one of them and prove the scoping — including ones added in Phase 7 by someone who never read this plan.

`upsertResponse` writes only when the incoming `clientSeq` is greater than the stored one, in a single statement: `INSERT … ON CONFLICT (attempt_id, question_id) DO UPDATE SET … WHERE excluded.client_seq > response.client_seq`. One D1 write, no read-then-write race, and a late retry cannot overwrite newer work.

- [ ] **Step 1: Write the failing test**

```ts
it("S-09 / AC-23: a read scoped to workspace A cannot see a row in workspace B", async () => {
  await seedTwoWorkspaces();
  expect(await listTests(db, "wsp_a")).toHaveLength(1);
  expect(await getTest(db, "wsp_a", testInB)).toBeNull();
});

it("every exported repository function requires a workspace ID", async () => {
  for (const [name, fn] of Object.entries(REPO_FUNCTIONS)) {
    await expect(fn(db, "", ...stubArgs(name)), name).rejects.toThrow(/workspace/i);
  }
});

it("every exported repository function is registered through scoped()", async () => {
  const exported = Object.keys(await import("../src/repo/index.js")).filter(isRepoFunctionName);
  expect(new Set(exported)).toEqual(new Set(Object.keys(REPO_FUNCTIONS)));
});

it("an answer with a lower client_seq never overwrites a higher one", async () => {
  await upsertResponse(db, ws, { ...a, clientSeq: 5, value: "latest" });
  await upsertResponse(db, ws, { ...a, clientSeq: 4, value: "stale" });
  expect(await readResponse(db, ws, a)).toMatchObject({ value: "latest", clientSeq: 5 });
});

it("the same client_seq sent twice is idempotent and writes once", async () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/db/test/repo`
Expected: FAIL.

- [ ] **Step 3: Implement `guard.ts` and the four repository modules**

Keep each module to the entities named in its filename. `audit.ts` exposes only `appendAudit` and reads — no update, no delete, because the log is append-only (`S-18`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/db`
Expected: PASS on both dialects.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -s -m "feat(db): workspace-scoped repository layer with sequence-safe answer upsert"
```

---

## Task 5: Storage adapters and signed URLs

**Files:**
- Create: `packages/storage/src/adapter.ts`, `r2.ts`, `s3.ts`, `disk.ts`, `memory.ts`, `sign.ts`
- Create: `packages/storage/test/adapter.test.ts`, `packages/storage/test/sign.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StorageAdapter {
    put(key: string, body: ArrayBuffer | Uint8Array, opts: { contentType: string }): Promise<void>;
    get(key: string): Promise<ArrayBuffer | null>;
    delete(keys: string[]): Promise<void>;          // batched; one call, not one per key
    list(prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }>;
    signedUrl(key: string, opts: { expiresInSeconds: number; now: number }): Promise<string>;
  }
  export const SIGNED_URL_TTL_SECONDS = 600;
  export function verifyDiskSignature(url: URL, secret: string, now: number): boolean;
  ```

`now` is a parameter, never `Date.now()` inside the adapter, so expiry is testable without faking the clock. This task owns Review Focus item 4.

- [ ] **Step 1: Write the failing test**

A shared suite runs against `memory`, `disk` and `s3` (through a local MinIO container, skipped when unavailable):

```ts
it("round-trips an object and lists it under its prefix", async () => { /* … */ });

it("delete removes several keys in one call", async () => {
  const calls = countAdapterCalls(() => adapter.delete(["a", "b", "c"]));
  expect(calls).toBe(1);
});

it("AC-26 / S-16: a signed URL stops working after 10 minutes", async () => {
  const url = await adapter.signedUrl("snap/1.jpg", { expiresInSeconds: SIGNED_URL_TTL_SECONDS, now: T });
  expect(verify(url, T + 599_000)).toBe(true);
  expect(verify(url, T + 601_000)).toBe(false);
});

it("editing the expiry in a signed URL invalidates it", async () => {
  const tampered = withQuery(url, "expires", String(far future));
  expect(verify(tampered, T)).toBe(false);
});

it("a key outside the configured prefix is refused rather than written", async () => {
  await expect(adapter.put("../escape", body, { contentType: "image/jpeg" })).rejects.toThrow();
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/storage`
Expected: FAIL.

- [ ] **Step 3: Implement the adapters**

R2 and S3 presign with `aws4fetch`'s `AwsClient.sign` with `aws4_x` signing — one code path, two configurations. `disk.ts` signs with an HMAC over `key + expires` using a deployment secret, which `verifyDiskSignature` checks; the expiry is inside the signed string, so Review Focus item 4 cannot regress. Normalise and reject any key containing `..` or a leading `/`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run packages/storage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/storage
git commit -s -m "feat(storage): r2, s3, disk and memory adapters with expiring signed URLs"
```

---

## Task 6: The Hono application and its two entry points

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `src/env.ts`, `src/app.ts`, `src/index.ts`, `src/node.ts`, `src/errors.ts`
- Create: `apps/api/src/middleware/requestId.ts`, `logging.ts`, `security.ts`, `errorEnvelope.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/test/health.test.ts`, `apps/api/test/errors.test.ts`

**Interfaces:**
- Consumes: `DbClient`, `migrate`, `StorageAdapter`.
- Produces:
  ```ts
  export interface AppDeps { db: DbClient; storage: StorageAdapter; now: () => number; env: AppEnv }
  export function createApp(deps: AppDeps): Hono;
  export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) }
  export function parseEnv(raw: Record<string, unknown>, target: "workers" | "node"): AppEnv;
  ```

`now` is injected for the same reason it is in storage: the server timer (`AC-13`) is tested without faking a global clock.

- [x] **Step 1: Write the failing test**

```ts
it("GET /api/v1/health reports ok, the dialect and the migration count", async () => {
  const res = await createApp(testDeps()).request("/api/v1/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", dialect: "sqlite" });
});

it("an unknown route returns the error envelope, not Hono's default text", async () => {
  expect(await (await app.request("/api/v1/nope")).json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
});

it("an unhandled throw becomes a 500 envelope with a request ID and no stack trace", async () => { /* … */ });

it("every response carries the security headers the PRD requires", async () => {
  const h = (await app.request("/api/v1/health")).headers;
  expect(h.get("content-security-policy")).toContain("default-src 'self'");
  expect(h.get("x-content-type-options")).toBe("nosniff");
  expect(h.get("referrer-policy")).toBe("no-referrer");
});

it("parseEnv rejects a missing required secret by name", () => {
  expect(() => parseEnv({}, "workers")).toThrow(/SESSION_SECRET/);
});
```

- [x] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api`
Expected: FAIL.

- [x] **Step 3: Implement `createApp` and the middleware**

`index.ts` and `node.ts` contain binding code only — they build `AppDeps` from their runtime's environment and call `createApp`. No route, no business logic, nothing worth a test lives in either. The CSP is strict and self-only, matching PRD `S-11`'s "no third-party scripts"; it will gain `blob:` for camera frames in Phase 7 and nothing else.

- [x] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api
git commit -s -m "feat(api): hono app, error envelope, security headers and health route"
```

---

## Task 7: The subrequest budget guard

**Files:**
- Create: `apps/api/src/instrument.ts`
- Create: `apps/api/test/budget.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SUBREQUEST_LIMIT = 50;
  export function countingDeps(deps: AppDeps): { deps: AppDeps; counts: () => { db: number; storage: number; total: number } };
  export function expectBudget(route: string, max: number): Promise<void>;   // test helper
  ```

This task owns Review Focus item 2. It exists so the ceiling ADR 0002 names is enforced by a test rather than remembered, and so every later phase inherits the guard for free: adding a route means adding its budget line, and a route that starts looping fails the suite.

- [ ] **Step 1: Write the failing test**

```ts
it("the health route stays within its budget", async () => {
  await expectBudget("/api/v1/health", 1);
});

it("the budget table lists every mounted route, so a new route cannot skip the check", () => {
  expect(new Set(Object.keys(ROUTE_BUDGETS))).toEqual(new Set(mountedRoutes(createApp(testDeps()))));
});

it("no route's declared budget reaches the platform ceiling", () => {
  for (const [route, max] of Object.entries(ROUTE_BUDGETS)) expect(max, route).toBeLessThan(SUBREQUEST_LIMIT);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/budget.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the counting wrapper and `ROUTE_BUDGETS`**

`countingDeps` proxies the db client and storage adapter, incrementing a counter per call. `ROUTE_BUDGETS` lives beside the route table in `app.ts` so the two are edited together.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -s -m "test(api): per-route subrequest budget enforced against the workers ceiling"
```

---

## Task 8: Cloudflare deployment

**Files:**
- Create: `deploy/cloudflare/wrangler.toml`, `deploy/cloudflare/setup.mjs`, `deploy/cloudflare/.dev.vars.example`
- Create: `apps/api/test/worker.test.ts` (Miniflare, via `@cloudflare/vitest-pool-workers`)
- Modify: `deploy/cloudflare/README.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `apps/api/src/index.ts`.
- Produces: a deployed Worker, a D1 database and an R2 bucket, and `pnpm deploy:cf` as the command that updates them.

**Needs from the operator before this task can finish:** Cloudflare account ID, an API token with Workers, D1, R2 and Pages edit rights, and a `workers.dev` subdomain or a domain.

- [ ] **Step 1: Write the failing test**

```ts
it("the worker entry serves health against Miniflare's D1 and R2 bindings", async () => {
  const res = await SELF.fetch("https://example.com/api/v1/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ dialect: "d1" });
});

it("migrations run against the Miniflare D1 binding", async () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/worker.test.ts`
Expected: FAIL — no `wrangler.toml`.

- [ ] **Step 3: Write `wrangler.toml` and the Miniflare test configuration**

Bindings: `DB` (D1), `FILES` (R2), `SESSION_SECRET` and `FIELD_KEY` as secrets, `compatibility_date` set to the current date with `nodejs_compat`. A `[triggers]` block declares the daily cron the retention job uses in Phase 8 — declared now, handler added then.

- [ ] **Step 4: Write `setup.mjs`**

It creates the D1 database and R2 bucket through `wrangler`, writes the resulting IDs into `wrangler.toml`, runs migrations, and prints the next step. It is idempotent: run twice, it reports what already exists and changes nothing.

- [ ] **Step 5: Deploy and verify**

Run: `node deploy/cloudflare/setup.mjs && pnpm deploy:cf`, then `curl https://<worker>/api/v1/health`
Expected: HTTP 200 with `{"status":"ok","dialect":"d1"}`.

- [ ] **Step 6: Run the Miniflare test to verify it passes**

Run: `pnpm vitest run apps/api/test/worker.test.ts`
Expected: PASS.

- [ ] **Step 7: Update the deploy README and commit**

Replace the "planned for v0.1" line with the real steps, including what each secret is for.

```bash
git add deploy/cloudflare apps/api .github/workflows/ci.yml
git commit -s -m "feat(deploy): cloudflare worker, d1 and r2 with an idempotent setup script"
```

---

## Done when

- `pnpm lint typecheck build test` passes, with Postgres and SQLite both migrating in CI.
- A deployed Worker answers `/api/v1/health` with `{"dialect":"d1"}`.
- `REPO_FUNCTIONS` enumerates every repository function and each one rejects an empty workspace ID.
- `ROUTE_BUDGETS` covers every mounted route and no entry reaches 50.
- A signed URL expires in 10 minutes and does not survive having its expiry edited.
