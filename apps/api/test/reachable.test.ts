// T-19's reachability check and its refusals (#58, P5.5) — Review Focus
// item 6.
//
// `deps.http` is a stub in every test here: no network is reached in any
// case, and the refusal tests assert the stub was *never called*, which is
// the only way to prove a refusal happened before the fetch rather than
// after it.

import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS, type AppDeps } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { checkReachable, REACH_TIMEOUT_MS } from "../src/net/reachable.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const T = FIXED_NOW;

/** A `Response` whose body is a tripwire: anything that reads it fails the
 * "the body is never read" assertions below. */
function responseWith(status: number): { response: Response; body: { getReader: ReturnType<typeof vi.fn> } } {
  const body = { getReader: vi.fn(() => { throw new Error("the body must never be read"); }) };
  const response = { status, body } as unknown as Response;
  return { response, body };
}

function okHttp(status: number): typeof globalThis.fetch {
  return vi.fn(async () => responseWith(status).response) as unknown as typeof globalThis.fetch;
}

// --- checkReachable, directly ------------------------------------------

it.each([
  ["file:///etc/passwd", "only http and https"],
  ["ftp://example.com/x", "only http and https"],
  ["javascript:alert(1)", "only http and https"],
  ["not a url at all", "only http and https"],
  ["http://127.0.0.1:5432/", "only links on the standard web ports"],
  ["http://127.0.0.1/", "network address"],
  ["http://169.254.169.254/latest/meta-data/", "network address"],
  ["http://10.0.0.7/", "network address"],
  ["http://localhost/", "network address"],
  ["http://api.localhost/", "network address"],
  ["http://vault.internal/", "network address"],
  ["http://printer.local/", "network address"],
  ["http://intranet/", "network address"],
  ["http://[::1]/", "network address"],
  ["http://[fd00::1]/", "network address"],
  // The WHATWG URL parser normalises every other IPv4 spelling into the
  // dotted quad, so the one regex catches all of them — the classic
  // "decimal IP sneaks past a naive check" bypass.
  ["http://2130706433/", "network address"],
  ["http://0177.0.0.1/", "network address"],
  ["http://0x7f.0.0.1/", "network address"],
  // Userinfo: `http://example.com@169.254.169.254/` is one host to a
  // careless reader and another to the parser.
  ["http://example.com@evil.test/", "username or password"],
  ["https://user:pw@example.com/", "username or password"],
  // The port scanner, against a perfectly public host.
  ["http://example.com:22/", "only links on the standard web ports"],
  ["http://example.com:6379/", "only links on the standard web ports"],
  // Task 5/6 review, C1: the FQDN root label. `URL.hostname` keeps the
  // trailing dot, so every row above used to be bypassable by typing one —
  // and `http://metadata./` even satisfied the "a host with no dot" rule,
  // because `"metadata."` has one. `http://127.0.0.1./` is deliberately not
  // in this group: the IPv4 parser drops the empty part, so the literal
  // rows never had the hole and looking only at them hid it.
  ["http://localhost./", "network address"],
  ["http://metadata.google.internal./", "network address"],
  ["http://foo.local./", "network address"],
  ["http://intranet./", "network address"],
  ["http://metadata./", "network address"],
  // More than one root label, and the full-width stops the WHATWG parser
  // folds into "." before this code ever sees them.
  ["http://localhost../", "network address"],
  ["http://localhost。/", "network address"],
  ["http://metadata．/", "network address"],
])("refuses %s without fetching", async (url, reason) => {
  const http = vi.fn();
  const result = await checkReachable(http as unknown as typeof globalThis.fetch, url, () => T);
  expect(result).toMatchObject({ state: "refused", status: null, reason: expect.stringContaining(reason) });
  expect(result.checkedAt).toBe(T);
  expect(http).not.toHaveBeenCalled();
});

it.each(["https://example.com/cv.pdf", "http://example.com:80/cv.pdf", "https://example.com:443/cv.pdf"])(
  "allows %s through to the fetch",
  async (url) => {
    const http = okHttp(200);
    expect(await checkReachable(http, url, () => T)).toMatchObject({ state: "reachable" });
    expect(http).toHaveBeenCalledTimes(1);
  },
);

it("a 200 is reachable, the body is never read, and the request carries the guard's own options", async () => {
  const { response, body } = responseWith(200);
  const http = vi.fn(async () => response) as unknown as typeof globalThis.fetch;

  expect(await checkReachable(http, "https://example.com/cv.pdf", () => T)).toEqual({
    state: "reachable",
    status: 200,
    checkedAt: T,
  });
  expect(body.getReader).not.toHaveBeenCalled();

  const init = vi.mocked(http).mock.calls[0]?.[1];
  expect(init?.method).toBe("HEAD");
  expect(init?.redirect).toBe("manual");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
});

it("a 404 is unverified with the status, not an error", async () => {
  expect(await checkReachable(okHttp(404), "https://example.com/gone", () => T)).toEqual({
    state: "unverified",
    status: 404,
    checkedAt: T,
  });
});

it("a redirect is not followed and is unverified", async () => {
  const http = okHttp(302);
  expect(await checkReachable(http, "https://example.com/r", () => T)).toEqual({
    state: "unverified",
    status: 302,
    checkedAt: T,
  });
  // The half of Review Focus 6 that a status assertion alone would miss:
  // the 302 could have pointed at 169.254.169.254 and nothing here would
  // know, because nothing here follows it.
  expect(vi.mocked(http).mock.calls[0]?.[1]?.redirect).toBe("manual");
  expect(http).toHaveBeenCalledTimes(1);
});

it("a HEAD rejected with 405 is retried once with GET and no third call", async () => {
  const http = vi.fn(async (_url: unknown, init?: RequestInit) =>
    responseWith(init?.method === "HEAD" ? 405 : 200).response,
  ) as unknown as typeof globalThis.fetch;

  expect(await checkReachable(http, "https://example.com/cv.pdf", () => T)).toMatchObject({
    state: "reachable",
    status: 200,
  });
  expect(http).toHaveBeenCalledTimes(2);
  expect(vi.mocked(http).mock.calls.map((call) => call[1]?.method)).toEqual(["HEAD", "GET"]);
});

it("a 405 on both is unverified, not an infinite retry", async () => {
  const http = okHttp(405);
  expect(await checkReachable(http, "https://example.com/cv.pdf", () => T)).toMatchObject({
    state: "unverified",
    status: 405,
  });
  expect(http).toHaveBeenCalledTimes(2);
});

it("an abort is a timeout, not unreachable", async () => {
  const timeout = Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
  const http = vi.fn(async () => {
    throw timeout;
  }) as unknown as typeof globalThis.fetch;

  expect(await checkReachable(http, "https://example.com/slow", () => T)).toEqual({
    state: "timeout",
    status: null,
    checkedAt: T,
  });
});

it("a transport failure leaks nothing: DNS, refused and TLS are one indistinguishable unverified", async () => {
  // The port-scanner test. Were the reason carried through, this route
  // would answer "is something listening on that host" for any host that
  // got past the refusals.
  const results = [];
  for (const message of ["getaddrinfo ENOTFOUND", "connect ECONNREFUSED 93.184.216.34:443", "self-signed certificate"]) {
    const http = vi.fn(async () => {
      throw new Error(message);
    }) as unknown as typeof globalThis.fetch;
    results.push(await checkReachable(http, "https://example.com/x", () => T));
  }
  expect(results).toEqual([
    { state: "unverified", status: null, checkedAt: T },
    { state: "unverified", status: null, checkedAt: T },
    { state: "unverified", status: null, checkedAt: T },
  ]);
});

it("the timeout is hard and is the one this module declares", () => {
  expect(REACH_TIMEOUT_MS).toBe(5000);
});

// --- the route ---------------------------------------------------------

let workspaceId = "";
let authorCookie = "";
let viewerCookie = "";
let testId = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function checkUrl(ws: string, tid: string): string {
  return `/api/v1/workspaces/${ws}/tests/${tid}/check-url`;
}

/** The same deps every other test here uses, with `http` injected — the
 * seam `AppDeps` has carried since Phase 3's OIDC routes. */
function withHttp(http: typeof globalThis.fetch): AppDeps {
  return { ...deps, http };
}

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 10);
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@reach.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `reach-${suffix}`, name: "Reach Co" }),
  );
  workspaceId = (await created.json()).id;

  const authorId = await createUser(deps.db, {
    email: `author-${suffix}@reach.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  const viewerId = await createUser(deps.db, {
    email: `viewer-${suffix}@reach.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: viewerId, role: "viewer", now: FIXED_NOW });
  viewerCookie = await sessionCookie(deps, (await issueSession(deps, viewerId)).token);

  const test = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    send("POST", authorCookie, { name: "Midterm", slug: `midterm-${suffix}` }),
  );
  testId = (await test.json()).id;
});

it("the route answers 200 with the result even when the result is refused", async () => {
  const http = vi.fn();
  const res = await createApp(withHttp(http as unknown as typeof globalThis.fetch)).request(
    checkUrl(workspaceId, testId),
    send("POST", authorCookie, { url: "http://169.254.169.254/latest/meta-data/" }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ state: "refused", reason: expect.stringContaining("network address") });
  expect(http).not.toHaveBeenCalled();
});

it("the route answers the reachable result for a public link", async () => {
  const res = await createApp(withHttp(okHttp(200))).request(
    checkUrl(workspaceId, testId),
    send("POST", authorCookie, { url: "https://example.com/cv.pdf" }),
  );
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ state: "reachable", status: 200, checkedAt: FIXED_NOW });
});

it("a Viewer cannot call check-url", async () => {
  const http = vi.fn();
  const res = await createApp(withHttp(http as unknown as typeof globalThis.fetch)).request(
    checkUrl(workspaceId, testId),
    send("POST", viewerCookie, { url: "https://example.com/cv.pdf" }),
  );
  expect(res.status).toBe(403);
  expect(http).not.toHaveBeenCalled();
});

it("a test in another workspace is 404 and never fetches — the route is not a general-purpose fetcher", async () => {
  const http = vi.fn();
  const res = await createApp(withHttp(http as unknown as typeof globalThis.fetch)).request(
    checkUrl(workspaceId, "tst_nosuchtest"),
    send("POST", authorCookie, { url: "https://example.com/cv.pdf" }),
  );
  expect(res.status).toBe(404);
  expect(http).not.toHaveBeenCalled();
});

it("a body with no url is 400, not a fetch of undefined", async () => {
  const http = vi.fn();
  const res = await createApp(withHttp(http as unknown as typeof globalThis.fetch)).request(
    checkUrl(workspaceId, testId),
    send("POST", authorCookie, {}),
  );
  expect(res.status).toBe(400);
  expect(http).not.toHaveBeenCalled();
});

it("check-url is guarded by tests.edit", () => {
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/check-url"]).toBe("tests.edit");
});

it("measures the real subrequest cost of check-url, counting the outbound fetch", async () => {
  const counting = countingDeps(withHttp(okHttp(200)));
  const res = await createApp(counting.deps).request(
    checkUrl(workspaceId, testId),
    send("POST", authorCookie, { url: "https://example.com/cv.pdf" }),
  );
  expect(res.status).toBe(200);

  // auth (2) + `getTest` (1) + the one outbound fetch (1). The `http: 1` is
  // the assertion this task's whole budget line rests on: before
  // `countingDeps` wrapped `deps.http`, the one call this route exists to
  // make was the one call the budget could not see, and `total` here read 3.
  expect(counting.counts()).toEqual({ db: 3, storage: 0, http: 1, total: 4 });
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/check-url"]).toBe(4);
});

it("a refused URL costs one subrequest less, because the refusal is before the fetch", async () => {
  const http = vi.fn();
  const counting = countingDeps(withHttp(http as unknown as typeof globalThis.fetch));
  await createApp(counting.deps).request(
    checkUrl(workspaceId, testId),
    send("POST", authorCookie, { url: "http://localhost:8080/" }),
  );
  expect(counting.counts()).toEqual({ db: 3, storage: 0, http: 0, total: 3 });
});
