// Webhook CRUD, over the real routes (Phase 8d Task 1, `K35`, `K36`, `KG2`,
// `KG5`).

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addMembership, closeClient, createUser, migrate, sqliteClient } from "@pariksha/db";
import { memoryAdapter } from "@pariksha/storage";
import { createApp, type AppDeps } from "../src/app.js";
import type { AppEnv } from "../src/env.js";
import { issueSession } from "../src/auth/session.js";
import { countingDeps } from "../src/instrument.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTES_DIR = resolve(__dirname, "..", "src", "routes");

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

let workspaceId = "";
let ownerCookie = "";
let adminCookie = "";
let authorCookie = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function member(suffix: string, role: "admin" | "author"): Promise<string> {
  const id = await createUser(deps.db, {
    email: `${role}-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: id, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, id)).token);
}

const url = (): string => `/api/v1/workspaces/${workspaceId}/webhooks`;

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `hook-${suffix}`, name: "Alpha" }),
  );
  workspaceId = (await created.json()).id;

  adminCookie = await member(suffix, "admin");
  // `F1`: the role the 403 fixture needs — one that holds neither
  // `keys.manage` nor `workspace.settings`, so a passing 403 could not be
  // explained by the old wiring either.
  authorCookie = await member(suffix, "author");
});

describe("POST — create", () => {
  it("returns the signing secret exactly once, and the list that follows never carries it", async () => {
    const created = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.signingSecret).toMatch(/^whsec_/);

    const listed = await app.request(url(), send("GET", ownerCookie));
    expect(JSON.stringify(await listed.json())).not.toContain(body.signingSecret);
  });

  it("refuses a URL pointing at a private address", async () => {
    const res = await app.request(
      url(),
      send("POST", ownerCookie, { url: "http://169.254.169.254/latest", events: ["attempt.submitted"] }),
    );
    expect(res.status).toBe(422);
  });

  it("accepts an ordinary public URL — control for the test above", async () => {
    const res = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    expect(res.status).toBe(201);
  });

  // MINOR-3 (whole-branch review): the route used to wrap the whole
  // `createWebhook` call in a `catch` that turned ANY throw — a D1 failure
  // included — into `422 url_refused` carrying the driver's own message.
  // Forced here with a `db.run` that throws for the one `INSERT INTO
  // webhook` statement, leaving everything else (including `urlRefusal`'s
  // own pass) working: a genuinely valid URL that fails for a reason that
  // has nothing to do with SSRF must surface as the generic 500 envelope,
  // not a 422 naming a refusal that never happened, and the raw driver
  // message must never reach the response body.
  it("a non-SSRF failure (a DB error) is not reported as url_refused, and its raw message never reaches the client", async () => {
    const failing: typeof deps.db = {
      ...deps.db,
      run: (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO webhook")) {
          return Promise.reject(new Error("SQLITE_CONSTRAINT: a secret connection string, not for the client"));
        }
        return deps.db.run(sql, params);
      },
    };
    const failingApp = createApp({ ...deps, db: failing });

    const res = await failingApp.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/db-failure-hook", events: ["attempt.submitted"] }),
    );

    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain("url_refused");
    expect(body).not.toContain("SQLITE_CONSTRAINT");
    expect(body).not.toContain("secret connection string");
  });

  it("refuses an event outside the closed set", async () => {
    const res = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.invented"] }),
    );
    expect(res.status).toBe(400);
  });

  // `KG2`/`F1`: the 403 beside the 200 that proves which matrix is wired.
  // An Owner 200 would pass under the old `workspace.settings` wiring too —
  // only an Admin 200 paired with an Author 403 can tell the two apart.
  it("an Author cannot create a webhook — it is keys.manage, which Admin holds and Author doesn't", async () => {
    const res = await app.request(
      url(),
      send("POST", authorCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    expect(res.status).toBe(403);
  });

  it("an Admin can create one — the 200 beside the 403 above, proving keys.manage rather than workspace.settings", async () => {
    const res = await app.request(
      url(),
      send("POST", adminCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    expect(res.status).toBe(201);
  });
});

describe("GET — list", () => {
  it("carries costPerCandidate on the workers target — K35", async () => {
    const res = await app.request(url(), send("GET", ownerCookie));
    expect(res.status).toBe(200);
    expect((await res.json()).costPerCandidate).toBe(1);
  });

  // `K36`: omitted on `node`, never sent as `null`.
  it("omits costPerCandidate on the node target", async () => {
    // Built by hand rather than through `testDeps` (always "workers",
    // deps.ts's own comment) — the one thing this test needs to vary.
    const nodeEnv: AppEnv = {
      target: "node",
      sessionSecret: "test-session-secret",
      databaseUrl: "sqlite::memory:",
      storageDir: "/tmp",
      publicUrl: "https://x.test",
      port: 8787,
    };
    const db = sqliteClient(":memory:");
    await migrate(db);
    const nodeDeps: AppDeps = { db, storage: memoryAdapter(), now: () => FIXED_NOW, env: nodeEnv };
    const nodeApp = createApp(nodeDeps);

    const owner = await createUser(db, { email: "owner@node.test", authProvider: "magic_link", now: FIXED_NOW });
    const ownerSession = await sessionCookie(nodeDeps, (await issueSession(nodeDeps, owner)).token);
    const ws = await nodeApp.request("/api/v1/workspaces", send("POST", ownerSession, { slug: "node-ws", name: "Node" }));
    const wsId = (await ws.json()).id;

    const res = await nodeApp.request(`/api/v1/workspaces/${wsId}/webhooks`, send("GET", ownerSession));
    expect(res.status).toBe(200);
    expect(await res.json()).not.toHaveProperty("costPerCandidate");
    await closeClient(db);
  });

  it("an Author cannot list webhooks", async () => {
    expect((await app.request(url(), send("GET", authorCookie))).status).toBe(403);
  });

  it("an Admin can list them — the 200 beside the 403 above, proving keys.manage rather than workspace.settings", async () => {
    expect((await app.request(url(), send("GET", adminCookie))).status).toBe(200);
  });
});

describe("PATCH — toggle active", () => {
  async function createOne(): Promise<string> {
    const res = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    return (await res.json()).id;
  }

  it("turns a webhook off and the list reflects it on the next read", async () => {
    const id = await createOne();
    const res = await app.request(`${url()}/${id}`, send("PATCH", ownerCookie, { active: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id, active: false });

    const listed = await app.request(url(), send("GET", ownerCookie));
    expect((await listed.json()).webhooks.find((w: { id: string }) => w.id === id).active).toBe(false);
  });

  it("404s for a webhook id that does not exist in this workspace", async () => {
    const res = await app.request(`${url()}/whk_doesnotexist0001`, send("PATCH", ownerCookie, { active: false }));
    expect(res.status).toBe(404);
  });

  it("an Author cannot toggle a webhook", async () => {
    const id = await createOne();
    expect((await app.request(`${url()}/${id}`, send("PATCH", authorCookie, { active: false }))).status).toBe(403);
  });

  it("an Admin can — the 200 beside the 403 above, proving keys.manage rather than workspace.settings", async () => {
    const id = await createOne();
    expect((await app.request(`${url()}/${id}`, send("PATCH", adminCookie, { active: false }))).status).toBe(200);
  });
});

describe("DELETE — revoke", () => {
  async function createOne(): Promise<string> {
    const res = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    return (await res.json()).id;
  }

  it("removes the webhook", async () => {
    const id = await createOne();
    expect((await app.request(`${url()}/${id}`, send("DELETE", ownerCookie))).status).toBe(204);
    const listed = await app.request(url(), send("GET", ownerCookie));
    expect((await listed.json()).webhooks).toHaveLength(0);
  });

  it("404s for a webhook id that does not exist in this workspace", async () => {
    const res = await app.request(`${url()}/whk_doesnotexist0001`, send("DELETE", ownerCookie));
    expect(res.status).toBe(404);
  });

  it("an Author cannot delete a webhook", async () => {
    const id = await createOne();
    expect((await app.request(`${url()}/${id}`, send("DELETE", authorCookie))).status).toBe(403);
  });

  it("an Admin can — the 200 beside the 403 above, proving keys.manage rather than workspace.settings", async () => {
    const id = await createOne();
    expect((await app.request(`${url()}/${id}`, send("DELETE", adminCookie))).status).toBe(204);
  });
});

it("measures the real subrequest cost of every route this task mounts", async () => {
  async function measure(method: string, path: string, expected: number, body?: unknown): Promise<string> {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(path, send(method, ownerCookie, body));
    expect(res.status, `${method} ${path} -> ${res.status}`).toBeLessThan(400);
    expect(counting.counts().total, `${method} ${path}`).toBe(expected);
    const parsed = (await res.json().catch(() => null)) as { id?: string } | null;
    return parsed?.id ?? "";
  }

  const id = await measure("POST", url(), 4, { url: "https://example.test/hook", events: ["attempt.submitted"] });
  await measure("GET", url(), 3);
  await measure("PATCH", `${url()}/${id}`, 4, { active: false });
  await measure("DELETE", `${url()}/${id}`, 4);
});

// `KG5`: no response body anywhere may contain `signingSecret` or
// `secret_hash` — except the single creation response that shows it once.
describe("KG5", () => {
  it("list, and an update response, never contain the secret or its field name", async () => {
    const created = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    const { id, signingSecret } = await created.json();

    const listed = await app.request(url(), send("GET", ownerCookie));
    const listedText = JSON.stringify(await listed.json());
    expect(listedText).not.toContain("signingSecret");
    expect(listedText).not.toContain("secret_hash");
    expect(listedText).not.toContain(signingSecret);

    const patched = await app.request(`${url()}/${id}`, send("PATCH", ownerCookie, { active: false }));
    const patchedText = JSON.stringify(await patched.json());
    expect(patchedText).not.toContain("signingSecret");
    expect(patchedText).not.toContain("secret_hash");
    expect(patchedText).not.toContain(signingSecret);
  });

  it("the one creation response is the exception — it does carry signingSecret", async () => {
    const created = await app.request(
      url(),
      send("POST", ownerCookie, { url: "https://example.test/hook", events: ["attempt.submitted"] }),
    );
    expect(await created.json()).toHaveProperty("signingSecret");
  });

  it("no route file other than webhooks.ts mentions signingSecret or secret_hash", () => {
    const hits = grepSource(["signingSecret", "secret_hash"], ROUTES_DIR).filter(
      (hit) => !hit.file.endsWith(`${SEP}webhooks.ts`),
    );
    expect(hits).toEqual([]);
  });

  it("webhooks.ts itself carries the term only twice — both inside the POST handler's local declaration and its one-time response", () => {
    const hits = grepSource(["signingSecret"], ROUTES_DIR).filter((hit) => hit.file.endsWith(`${SEP}webhooks.ts`));
    expect(hits).toHaveLength(2);
  });

  it("the scan finds a match when one is planted — control", () => {
    const dir = mkdtempSync(join(tmpdir(), "kg5-control-"));
    try {
      writeFileSync(join(dir, "leaky.ts"), "return c.json({ signingSecret: row.signingSecret });\n");
      expect(grepSource(["signingSecret"], dir)).not.toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const SEP = process.platform === "win32" ? "\\" : "/";

/** Every `.ts` file under `dir`, grepped line by line for any of `needles`.
 * Used only by the `KG5` scan above — a deliberately small, local helper
 * rather than a shared `scripts/` utility, the same call `no-hex-colors
 * .test.ts` (apps/web) makes for its own single-purpose walk. */
function grepSource(needles: string[], dir: string): { file: string; line: number; text: string }[] {
  const hits: { file: string; line: number; text: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      hits.push(...grepSource(needles, full));
      continue;
    }
    if (!entry.endsWith(".ts")) continue;
    const lines = readFileSync(full, "utf8").split("\n");
    lines.forEach((text, i) => {
      if (needles.some((needle) => text.includes(needle))) {
        hits.push({ file: full, line: i + 1, text });
      }
    });
  }
  return hits;
}
