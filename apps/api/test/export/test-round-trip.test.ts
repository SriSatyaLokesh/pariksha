// AC-04: the worked example round-trips through whole-test import and
// export (#63, P5.10), over the real routes.
//
// The fixture names its bank **`questions.json`** — the string
// `examples/reasoning-aptitude/test.json` uses in `banks` and in its pool
// section's `source.bank`. Inside a workspace there is no file, so a
// bank's *name* is what plays that part in both directions (see
// `apps/api/src/export/test.ts`'s header); naming it so is what makes the
// round trip an equality rather than a comparison with exceptions.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { validateTest } from "@pariksha/core";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../../src/app.js";
import { validateTestDocumentStructure } from "../../src/import/schema.js";
import { countingDeps } from "../../src/instrument.js";
import { issueSession } from "../../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (name: string): string => readFileSync(join(repoRoot, "examples/reasoning-aptitude", name), "utf8");

const exampleBank = JSON.parse(read("questions.json")) as Record<string, unknown>;
const exampleTest = JSON.parse(read("test.json")) as Record<string, unknown>;

let workspaceId = "";
let authorCookie = "";
let bankId = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);

beforeAll(async () => {
  const ownerId = await createUser(deps.db, {
    email: "owner-rt@alpha.test",
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  workspaceId = (
    await (await app.request("/api/v1/workspaces", send("POST", ownerCookie, { slug: "rt", name: "RT Co" }))).json()
  ).id;

  const authorId = await createUser(deps.db, {
    email: "author-rt@alpha.test",
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: authorId, role: "author", now: FIXED_NOW });
  authorCookie = await sessionCookie(deps, (await issueSession(deps, authorId)).token);

  // The bank the test file names, by that name.
  bankId = (
    await (await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "questions.json" }, authorCookie))).json()
  ).id;
  const imported = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/import`,
    post(exampleBank, authorCookie),
  );
  expect(imported.status, await imported.clone().text()).toBe(200);
});

const importUrl = (dryRun = false): string =>
  `/api/v1/workspaces/${workspaceId}/tests/import${dryRun ? "?dryRun=1" : ""}`;

async function importTest(doc: unknown, dryRun = false): Promise<Response> {
  return app.request(importUrl(dryRun), post(doc, authorCookie));
}

/** The worked example with its slug changed, so each test here imports its
 * own copy rather than colliding with the last one's. */
let seq = 0;
function copyOfExample(patch: (doc: Record<string, unknown>) => void = () => undefined): Record<string, unknown> {
  seq += 1;
  const doc = JSON.parse(JSON.stringify(exampleTest)) as Record<string, unknown>;
  doc.slug = `${exampleTest.slug as string}-${seq}`;
  patch(doc);
  return doc;
}

async function importedTestId(doc: Record<string, unknown>): Promise<string> {
  const res = await importTest(doc);
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).testId as string;
}

const exportUrl = (testId: string, version?: number): string =>
  `/api/v1/workspaces/${workspaceId}/tests/${testId}/export${version === undefined ? "" : `?version=${version}`}`;

async function exported(testId: string, version?: number): Promise<Record<string, unknown>> {
  const res = await app.request(exportUrl(testId, version), get(authorCookie));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

// --- AC-04 --------------------------------------------------------------

it("AC-04: the worked example round-trips through import and export", async () => {
  const doc = copyOfExample();
  const out = await exported(await importedTestId(doc));

  // Everything but `$schema`, which is never stored (there is no column for
  // it) and is always re-stamped with `schemas/test-1.json`'s own `$id`.
  expect(out).toEqual({ ...doc, $schema: expect.any(String) });
  expect(out.$schema).toMatch(/test-1\.json$/);
});

it("the exported document validates against test-1.json and validateTest", async () => {
  const out = await exported(await importedTestId(copyOfExample()));
  expect(validateTestDocumentStructure(out)).toEqual([]);

  const bankQuestions = (exampleBank.questions as { id: string }[]) ?? [];
  expect(validateTest(out, bankQuestions as never).ok).toBe(true);
});

it("export carries no internal identifier", async () => {
  const text = JSON.stringify(await exported(await importedTestId(copyOfExample())));
  for (const leak of ["workspace_id", "wsp_", "tst_", "qst_", "bnk_", "ver_"]) {
    expect(text, leak).not.toContain(leak);
  }
});

it("export carries no review comment key (ADR 0007)", async () => {
  const out = await exported(await importedTestId(copyOfExample()));
  expect(Object.keys(out)).not.toContain("comments");
});

it("blocks Phase 5 has no editor for survive the round trip", async () => {
  const doc = copyOfExample();
  const out = await exported(await importedTestId(doc));
  for (const key of ["consent", "proctoring", "retention"]) {
    expect(out[key], key).toEqual(doc[key]);
  }
});

it("?version= exports a published version and the default exports the current one", async () => {
  const testId = await importedTestId(copyOfExample());

  // The imported draft is version 1; publish it, edit, publish again.
  const adminCookie = await adminFor();
  const publish = async (): Promise<void> => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`, post({}, adminCookie));
    expect(res.status, await res.clone().text()).toBe(200);
  };
  await publish();

  const first = await exported(testId);
  const patched = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", authorCookie, { settings: { description: "Second edition." } }),
  );
  expect(patched.status).toBe(200);
  await publish();

  expect((await exported(testId)).description).toBe("Second edition.");
  expect((await exported(testId, 1)).description).toBe(first.description);
});

// --- Review Focus 3, finally proved where the plan asked for it --------
//
// "The proof is an **export** assertion, not a read-back of the patch."
// Task 8 made it one step earlier, on the stored draft read back through
// `GET .../draft`, because `exportTest` did not exist yet. It does now, so
// the assertion is re-run here against the document that actually leaves
// the workspace — the thing Review Focus 3 is written about ("a stale code
// … publishes, and leaves the workspace inside an exported file").
it("Review Focus 3: switching access.mode away from link_code drops the code from the exported file", async () => {
  const testId = await importedTestId(copyOfExample());
  // The worked example is `link_code` with `access_code: "APTI-2026"`.
  expect(JSON.stringify(await exported(testId))).toContain("APTI-2026");

  const patched = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", authorCookie, { settings: { access: { mode: "sso", allow_email_domains: ["*.ac.in"] } } }),
  );
  expect(patched.status, await patched.clone().text()).toBe(200);

  const out = await exported(testId);
  expect(JSON.stringify(out)).not.toContain("APTI-2026");
  expect(out.access).toEqual({ mode: "sso", allow_email_domains: ["*.ac.in"] });
});

// --- refusals -----------------------------------------------------------

it("a bad section in the file imports nothing and reports the position and reason", async () => {
  const before = await testCount();
  const res = await importTest(
    copyOfExample((doc) => {
      const sections = doc.sections as { source: { sets: { questions: string[] }[] } }[];
      sections[1]!.source.sets[0]!.questions[0] = "NOPE-001";
    }),
  );

  expect(res.status).toBe(422);
  expect(await testCount()).toBe(before);
  expect((await res.json()).error.details.issues[0]).toMatchObject({
    index: 1,
    field: "source.sets",
    questionId: "NOPE-001",
  });
});

it("a document that is not a test at all is refused structurally, naming the field", async () => {
  const res = await importTest({ format: "pariksha/test@1", name: "X" });
  expect(res.status).toBe(422);
  const fields = (await res.json()).error.details.issues.map((i: { field: string }) => i.field);
  expect(fields).toContain("slug");
});

it("T-05: a slug already used in the workspace is 409 with the field named", async () => {
  const doc = copyOfExample();
  await importedTestId(doc);

  const again = await importTest(doc);
  expect(again.status).toBe(409);
  const body = await again.json();
  expect(body.error.code).toBe("duplicate_slug");
  expect(body.error.details.field).toBe("slug");
});

// task 7/8/10 review, M7 put the brand-colour rule in `validateTest`
// specifically so import is not a third ungated path to a colour a
// candidate cannot read. This is that path, exercised.
it("an unreadable brand colour is refused at import, not only on the two PATCH routes", async () => {
  const before = await testCount();
  const res = await importTest(copyOfExample((doc) => (doc.branding = { primary_colour: "#ffff00" })));

  expect(res.status).toBe(422);
  expect(await testCount()).toBe(before);
  const fields = (await res.json()).error.details.issues.map((i: { field: string }) => i.field);
  expect(fields).toContain("branding.primary_colour");
});

// Whole-branch security review, M1: the fold landed on `PATCH .../draft`
// under a comment calling that "the one route that writes them". It was
// not — this path stored them exactly as typed, and on test day Phase 6's
// lower-cased matcher refuses every candidate. Read back through the real
// export, so it cannot pass against a mapper that folds on the way out.
it("an allowlist arrives from import folded to lower case, as it does from the draft route", async () => {
  const testId = await importedTestId(
    copyOfExample((doc) => {
      doc.access = {
        mode: "link_code",
        access_code: "APTI-2026",
        allow_email_domains: ["Example.COM", "*.AC.in"],
        allow_ip_ranges: ["2001:DB8::/32"],
      };
    }),
  );

  expect((await exported(testId)).access).toEqual({
    mode: "link_code",
    access_code: "APTI-2026",
    allow_email_domains: ["example.com", "*.ac.in"],
    allow_ip_ranges: ["2001:db8::/32"],
  });
});

it("a question resolving into a different bank imports and is reported in rebound", async () => {
  // LOG-001 lives in "questions.json"; a file that declares a different
  // bank name still imports, and says where the question actually came
  // from rather than silently binding it.
  const res = await importTest(copyOfExample((doc) => (doc.banks = ["aptitude.json"])));
  expect(res.status, await res.clone().text()).toBe(201);

  const report = await res.json();
  expect(report.imported).toBe(true);
  expect(report.rebound).toContainEqual({ questionId: "LOG-001", bankName: "questions.json" });
});

it("a dry run reports and writes nothing", async () => {
  const before = await testCount();
  const res = await importTest(copyOfExample(), true);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ imported: false, testId: null, issues: [] });
  expect(await testCount()).toBe(before);
});

it("export refuses a test too unfinished to import back — never a file we would not take", async () => {
  const created = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    post({ name: "Empty", slug: "empty-shell" }, authorCookie),
  );
  const testId = (await created.json()).id as string;

  const res = await app.request(exportUrl(testId), get(authorCookie));
  expect(res.status).toBe(422);
  expect((await res.json()).error.code).toBe("not_exportable");
});

// --- guards and cost ----------------------------------------------------

it("export and import are guarded by tests.edit", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/export"]).toBe("tests.edit");
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/import"]).toBe("tests.edit");
});

it("measures the real subrequest cost of export and import, flat in question count", async () => {
  // The worked example's sections name 8 questions outright and draw a
  // pool from a 17-question bank — the heavy case this fixture has.
  const doc = copyOfExample();

  const importCounting = countingDeps(deps);
  const res = await createApp(importCounting.deps).request(importUrl(), post(doc, authorCookie));
  expect(res.status, await res.clone().text()).toBe(201);
  expect(importCounting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/import"]);

  const testId = (await res.json()).testId as string;
  const exportCounting = countingDeps(deps);
  const out = await createApp(exportCounting.deps).request(exportUrl(testId), get(authorCookie));
  expect(out.status, await out.clone().text()).toBe(200);
  expect(exportCounting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/export"]);
});

async function testCount(): Promise<number> {
  const rows = await deps.db.query<{ n: number }>("SELECT COUNT(*) AS n FROM test WHERE workspace_id = ?", [
    workspaceId,
  ]);
  return Number(rows[0]?.n ?? 0);
}

let adminCookieCache = "";
async function adminFor(): Promise<string> {
  if (adminCookieCache !== "") return adminCookieCache;
  const adminId = await createUser(deps.db, {
    email: "admin-rt@alpha.test",
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, workspaceId, { userId: adminId, role: "admin", now: FIXED_NOW });
  adminCookieCache = await sessionCookie(deps, (await issueSession(deps, adminId)).token);
  return adminCookieCache;
}
