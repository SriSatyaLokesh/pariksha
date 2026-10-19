// Candidate list ingest (Task 9, #60 / #56, P5.7b), over the real routes.
//
// The identity column is **the test's first `unique: true` registration
// field**. For `examples/reasoning-aptitude/test.json` that is `email`, not
// `roll_number`: the form lists `full_name`, then `email` (unique), then
// `phone`, then `roll_number` (also unique). The plan's prose says
// `roll_number` is the first one, which the example document contradicts —
// the rule is implemented as stated and the worked example still imports
// whole, keyed on the email column its own candidates.csv already carries.

import { afterAll, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  addMembership,
  closeClient,
  countCandidates,
  createUser,
  listCandidates,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = (name: string): string =>
  readFileSync(join(repoRoot, "apps/api/test/fixtures/candidates", name), "utf8");
const workedExample = readFileSync(join(repoRoot, "examples/reasoning-aptitude/candidates.csv"), "utf8");

/** The two registration fields the worked example's CSV is keyed and
 * filled from, in the document's own order — `email` first, so `email` is
 * the identity. */
const FORM = {
  fields: [
    { id: "full_name", type: "short_text", label: "Full name" },
    { id: "email", type: "email", label: "College email address", unique: true },
    { id: "roll_number", type: "short_text", label: "Roll number", unique: true },
  ],
};

/** Two sets, "A" and "B" — what the worked example's `set` column names.
 * The questions are real rows: the draft route refuses a section naming a
 * question that is not in this workspace, whatever its spelling. */
function setsSection(questionIds: readonly string[]) {
  return {
    id: "reasoning",
    title: "Reasoning",
    source: {
      kind: "sets",
      sets: [
        { set: "A", questions: [questionIds[0]] },
        { set: "B", questions: [questionIds[1]] },
      ],
    },
  };
}

let workspaceId = "";
let adminCookie = "";
let authorCookie = "";
let testId = "";

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

function postCsv(csv: string, cookie: string): RequestInit {
  return { method: "POST", headers: { cookie, "content-type": "text/csv" }, body: csv };
}

async function cookieFor(suffix: string, role: "owner" | "admin" | "author"): Promise<string> {
  const userId = await createUser(deps.db, {
    email: `${role}-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  if (role !== "owner") await addMembership(deps.db, workspaceId, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

let suffix = 0;

beforeEach(async () => {
  suffix += 1;
  const ownerId = await createUser(deps.db, {
    email: `owner-${suffix}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  const created = await app.request(
    "/api/v1/workspaces",
    send("POST", ownerCookie, { slug: `cnd-${suffix}`, name: "Candidates Co" }),
  );
  workspaceId = ((await created.json()) as { id: string }).id;

  adminCookie = await cookieFor(String(suffix), "admin");
  authorCookie = await cookieFor(String(suffix), "author");

  const test = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests`,
    send("POST", ownerCookie, { name: "Placement", slug: `placement-${suffix}` }),
  );
  testId = ((await test.json()) as { id: string }).id;

  const bank = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks`,
    send("POST", ownerCookie, { name: "Reasoning" }),
  );
  const bankId = ((await bank.json()) as { id: string }).id;
  const questionIds: string[] = [];
  for (const refId of ["LOG-001", "LOG-002"]) {
    const created = await app.request(
      `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
      send("POST", ownerCookie, { id: refId, type: "true_false", prompt: "True?", key: true }),
    );
    questionIds.push(((await created.json()) as { id: string }).id);
  }

  // The registration form and the sets both live on the draft, which is
  // where the import reads them from.
  const patched = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", ownerCookie, {
      settings: { registration_form: FORM },
      sections: [setsSection(questionIds)],
    }),
  );
  if (patched.status !== 200) throw new Error(`draft patch ${patched.status}: ${await patched.text()}`);
});

const importUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/${testId}/candidates/import`;
const listUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/${testId}/candidates`;

async function importCsv(csv: string, cookie = adminCookie, query = ""): Promise<Response> {
  return app.request(`${importUrl()}${query}`, postCsv(csv, cookie));
}

function issuesOf(body: unknown): { field: string; message: string; line: number }[] {
  return (body as { error: { details: { issues: { field: string; message: string; line: number }[] } } }).error.details
    .issues;
}

it("the worked example's list imports whole, keyed on the test's first unique field", async () => {
  const res = await importCsv(workedExample);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ imported: 6, issues: [] });

  const stored = await listCandidates(deps.db, workspaceId, testId);
  expect(stored).toHaveLength(6);
  expect(stored[0]).toMatchObject({
    externalId: "ananya.rao@vce.edu.in",
    setLabel: "A",
    source: "list",
    // The identity column is not repeated in the prefill, and `set` is not
    // a registration field at all.
    formValues: { full_name: "Ananya Rao", roll_number: "21CS0147" },
    consentVersion: null,
  });
});

it("a column that is neither `set` nor a registration field id is a positioned error on the header", async () => {
  const res = await importCsv(fixture("unknown-column.csv"));
  expect(res.status).toBe(422);
  expect(issuesOf(await res.json())[0]).toMatchObject({
    line: 1,
    field: "header",
    message: expect.stringMatching(/"cgpa_v2" is not a field of this test's registration form/),
  });
});

it("a test with no unique registration field refuses the upload and says what is missing", async () => {
  await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", adminCookie, {
      settings: { registration_form: { fields: [{ id: "full_name", type: "short_text", label: "Full name" }] } },
    }),
  );

  const res = await importCsv(workedExample);
  expect(res.status).toBe(422);
  expect(issuesOf(await res.json())[0]).toMatchObject({
    line: 1,
    field: "header",
    message: expect.stringMatching(/needs a registration field marked unique/),
  });
});

it("a duplicate identity in the file reports its line and imports nothing", async () => {
  const res = await importCsv(fixture("duplicate-email.csv"));
  expect(res.status).toBe(422);
  // Line 4 is the third data row: line 1 is the header.
  expect(issuesOf(await res.json())[0]).toMatchObject({ line: 4, field: "email" });
  expect(await countCandidates(deps.db, workspaceId, testId)).toEqual({ total: 0, withoutSet: 0 });
});

it("a set value naming no set in any sets section reports its line", async () => {
  const res = await importCsv(fixture("set-z.csv"));
  expect(res.status).toBe(422);
  expect(issuesOf(await res.json())[0]).toMatchObject({
    line: 3,
    field: "set",
    message: expect.stringMatching(/no section defines a set "Z"/),
  });
});

it("dryRun reports exactly what a real import would and writes nothing", async () => {
  const dry = await importCsv(workedExample, adminCookie, "?dryRun=1");
  expect(dry.status).toBe(200);
  expect(await dry.json()).toEqual({ imported: 6, issues: [] });
  expect(await countCandidates(deps.db, workspaceId, testId)).toEqual({ total: 0, withoutSet: 0 });

  const real = await importCsv(workedExample);
  expect(await real.json()).toEqual({ imported: 6, issues: [] });
  expect((await countCandidates(deps.db, workspaceId, testId)).total).toBe(6);
});

it("a re-upload replaces the list rather than appending to it", async () => {
  await importCsv(workedExample);
  await importCsv("email,set\nananya.rao@vce.edu.in,B\n");

  const stored = await listCandidates(deps.db, workspaceId, testId);
  expect(stored.map((row) => [row.externalId, row.setLabel])).toEqual([["ananya.rao@vce.edu.in", "B"]]);
});

it("an Author cannot upload a candidate list — it is candidates.manage", async () => {
  expect((await importCsv(workedExample, authorCookie)).status).toBe(403);
  expect((await app.request(listUrl(), send("GET", authorCookie))).status).toBe(403);
  expect(await countCandidates(deps.db, workspaceId, testId)).toEqual({ total: 0, withoutSet: 0 });
});

it("an Admin can, and the upload writes one audit entry", async () => {
  expect((await importCsv(workedExample)).status).toBe(200);

  const audit = await deps.db.query<{ action: string; target: string; detail_json: unknown }>(
    "SELECT action, target, detail_json FROM audit_log WHERE workspace_id = ? AND action = ?",
    [workspaceId, "candidates.import"],
  );
  expect(audit).toHaveLength(1);
  expect(audit[0]?.target).toBe(testId);

  // A dry run changes nothing, so it records nothing.
  await importCsv(workedExample, adminCookie, "?dryRun=1");
  expect(
    await deps.db.query("SELECT 1 FROM audit_log WHERE workspace_id = ? AND action = ?", [
      workspaceId,
      "candidates.import",
    ]),
  ).toHaveLength(1);
});

it("GET answers the stored list", async () => {
  await importCsv(workedExample);
  const res = await app.request(listUrl(), send("GET", adminCookie));
  expect(res.status).toBe(200);
  expect((await res.json()).candidates).toHaveLength(6);
});

it("both routes are guarded by candidates.manage", () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/candidates"]).toBe("candidates.manage");
  expect(ROUTE_ACTIONS["POST /api/v1/workspaces/:id/tests/:testId/candidates/import"]).toBe("candidates.manage");
});

it("importing 500 rows stays at the route's budget — the cost is flat in row count", async () => {
  const many = `email,set\n${Array.from(
    { length: 500 },
    (_, i) => `candidate-${i}@vce.edu.in,${i % 2 === 0 ? "A" : "B"}`,
  ).join("\n")}\n`;

  const counting = countingDeps(deps);
  const res = await createApp(counting.deps).request(importUrl(), postCsv(many, adminCookie));
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ imported: 500 });
  expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/candidates/import"]);
});

it("measures the real subrequest cost of both routes", async () => {
  const importCounting = countingDeps(deps);
  const imported = await createApp(importCounting.deps).request(importUrl(), postCsv(workedExample, adminCookie));
  expect(imported.status).toBe(200);
  // auth 2 + getDraftVersion 1 + replaceCandidateList's one batch 1 +
  // appendAudit 1.
  expect(importCounting.counts().total).toBe(5);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/candidates/import"]).toBe(5);

  const listCounting = countingDeps(deps);
  const listed = await createApp(listCounting.deps).request(listUrl(), send("GET", adminCookie));
  expect(listed.status).toBe(200);
  // auth 2 + listCandidates 1.
  expect(listCounting.counts().total).toBe(3);
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/candidates"]).toBe(3);
});
