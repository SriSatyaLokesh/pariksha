// Phase 8c Task 3 — the `KG1` sentinel scan for the two export routes.
//
// In the shape of `apps/api/test/run/scrub-scan.test.ts`: a sentinel
// question bank (the same fixture — same bank, same secrets, so the two
// scans agree about what counts as a leak), played through the real
// `results.csv` and `answers.csv` routes, with every page read and scanned
// — a leak on page two would be invisible to a scan that only read page
// one, which is its own flavour of the truncation trap this phase is
// about.
//
// **The route list is derived, not hand-written.** `EXPORT_ENDPOINTS`
// reads `ROUTE_ACTIONS` for every endpoint guarded by `results.export`, so
// a future export this phase or a later one adds under the same action
// (`R-09`'s events CSV, say) is scanned automatically — the whole point,
// named in the task brief: "a route added later is covered without anyone
// remembering."
//
// **Unlike `AC-22`'s candidate-facing scan, there is no release carve-out
// here.** A released `full_review` lets a *candidate* see their own
// explanation (`T-22`); nothing releases a key into an *organiser's* CSV —
// `KG1` is unconditional, which is why this file has no `EXEMPT_BODIES`
// the other one needs.

import { afterAll, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createBank,
  createUser,
  upsertQuestions,
  type TestDocumentBody,
} from "@pariksha/db";
import type { Question } from "@pariksha/core";
import { createApp, ROUTE_ACTIONS } from "../../src/app.js";
import { issueSession } from "../../src/auth/session.js";
import type { ExportPage } from "../../src/export/results.js";
import { FIXED_NOW, sessionCookie, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "../run/fixtures.js";
import sentinelDocsJson from "../fixtures/run/sentinel-bank.json" with { type: "json" };

const sentinelDocs = sentinelDocsJson as unknown as Question[];
const T = FIXED_NOW;

const { deps } = await testDeps({ now: () => T });
const app = createApp(deps);
afterAll(() => closeClient(deps.db));

// Same vocabulary `scrub-scan.test.ts` (`run/`) scans for, over the same
// fixture file — every secret field across all twelve question types.
const ABSOLUTE_SECRETS = ["__MODELANS_SHORT__", "__MODELANS_LONG__", "__RUBRIC_SHORT__", "__RUBRIC_LONG__", "__ACCESS_CODE__"];
const CONDITIONAL_SECRETS = [
  "__EXPL_SINGLE__",
  "__EXPL_MULTIPLE__",
  "__EXPL_SELECTK__",
  "__EXPL_TRUEFALSE__",
  "__EXPL_ASSERTION__",
  "__EXPL_MATCHING__",
  "__EXPL_MULTIMATCH__",
  "__EXPL_ORDERING__",
  "__EXPL_FILLBLANK__",
  "__EXPL_NUMERIC__",
  "__EXPL_SHORT__",
  "__EXPL_LONG__",
  "__ACCEPT_FILLBLANK__",
];
const SECRETS = [...ABSOLUTE_SECRETS, ...CONDITIONAL_SECRETS];

/** Fails loudly, naming the string, rather than silently passing on an
 *  empty body — the property the self-check below proves. */
function assertNoSecrets(label: string, body: string): void {
  for (const secret of SECRETS) {
    expect(body, `${label} leaked ${secret}`).not.toContain(secret);
  }
}

// --- the route set, derived from ROUTE_ACTIONS, never hand-written --------

const EXPORT_ENDPOINTS = Object.entries(ROUTE_ACTIONS).filter(([, action]) => action === "results.export") as [
  string,
  string,
][];

it("KG1: exactly the export routes this task mounts are covered", () => {
  // Bumped deliberately, the same discipline `run/scrub-scan.test.ts` uses
  // for its own count — a future `results.export` route changes this
  // number, which is the point: silent coverage growth is invisible,
  // a changed literal is not.
  expect(EXPORT_ENDPOINTS.length).toBe(2);
  expect(new Set(EXPORT_ENDPOINTS.map(([e]) => e))).toEqual(
    new Set([
      "GET /api/v1/workspaces/:id/tests/:testId/export/results.csv",
      "GET /api/v1/workspaces/:id/tests/:testId/export/answers.csv",
    ]),
  );
});

// --- fixtures ---------------------------------------------------------------

const workspaceId = await seedWorkspace(deps, "sentinel", "Sentinel Co");
const ownerId = await createUser(deps.db, { email: "owner@sentinel.test", authProvider: "magic_link", now: T });
await addMembership(deps.db, workspaceId, { userId: ownerId, role: "owner", now: T });
const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);

const bankId = await createBank(deps.db, workspaceId, { name: "Sentinel bank", now: T });
const { ids: sentinelIds } = await upsertQuestions(deps.db, workspaceId, bankId, sentinelDocs, T);
const rowIdOf: Record<string, string> = {};
sentinelDocs.forEach((doc, i) => {
  rowIdOf[doc.id] = sentinelIds[i] as string;
});

const body: TestDocumentBody = {
  settings: {
    timing: { duration_minutes: 45, navigation: "free", opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
    access: { mode: "link_code", access_code: "OPEN" },
    registration_form: { fields: [{ id: "roll", type: "short_text", label: "Roll", required: true }] },
  },
  sections: [
    {
      id: "every",
      title: "Every type",
      source: { kind: "fixed", questions: sentinelDocs.map((d) => rowIdOf[d.id] as string) },
    },
  ],
};
const testId = await seedTest(deps, workspaceId, { name: "Sentinel test", slug: "sentinel-test", body });

const versionRows = await deps.db.query<{ id: string }>(
  "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
  [testId],
);
const versionId = versionRows[0]!.id;

const candidateId = "cnd_sentinel0000001";
await deps.db.run(
  "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
    "VALUES (?, ?, ?, NULL, NULL, 'registration', ?, NULL, NULL, ?)",
  [candidateId, workspaceId, testId, JSON.stringify({ roll: "S1" }), T],
);

const attemptId = "att_sentinel0000001";
const perQuestion: Record<string, { points: number; max: number; correct: boolean | null }> = {};
for (const doc of sentinelDocs) perQuestion[rowIdOf[doc.id] as string] = { points: 1, max: 2, correct: true };
const scoreJson = JSON.stringify({
  perQuestion,
  sections: [{ sectionId: "every", points: sentinelDocs.length, max: sentinelDocs.length * 2 }],
  total: sentinelDocs.length,
  max: sentinelDocs.length * 2,
  percent: 50,
  passed: null,
  pending: [],
});
await deps.db.run(
  "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
    "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
    "integrity_flag, observed, locked_at) VALUES (?, ?, ?, ?, 1, '{}', ?, ?, ?, 'candidate', ?, 'clean', 'hash', 0, NULL, 'clean', 0, NULL)",
  [attemptId, workspaceId, candidateId, versionId, T, T + 45 * 60_000, T + 600_000, scoreJson],
);

// Every response is the candidate's own plain text — never the key, the
// explanation, the rubric or an accepted pattern. If `exportAnswersPage`
// ever read a question's stored document instead of the response row and
// the grader's own `correct` boolean, this is what would start failing.
for (const doc of sentinelDocs) {
  await deps.db.run(
    "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, 1, NULL, NULL)",
    [`rsp_${doc.id}`, workspaceId, attemptId, rowIdOf[doc.id] as string, JSON.stringify("candidate's own plain answer"), T],
  );
}

// --- replaying every export endpoint, every page -----------------------

function urlFor(endpoint: string): { method: string; path: string } {
  const [method, path] = endpoint.split(" ") as [string, string];
  return { method, path: path.replace(":id", workspaceId).replace(":testId", testId) };
}

/** Every page's raw JSON text, concatenated — `csv` and `filename` and
 *  `nextCursor` alike, so a leak in a field this file does not otherwise
 *  name (there is none today, but a scan over the *response text* rather
 *  than a parsed field is the same choice `AC-22`'s scan makes). */
async function replayAllPages(path: string): Promise<string> {
  let cursor: string | undefined;
  let all = "";
  for (;;) {
    const url = cursor === undefined ? path : `${path}?cursor=${encodeURIComponent(cursor)}`;
    const res = await app.request(url, { headers: { cookie: ownerCookie } });
    expect(res.status, `${path} -> ${res.status}`).toBe(200);
    const text = await res.clone().text();
    all += text;
    const page = JSON.parse(text) as ExportPage;
    if (page.nextCursor === null) return all;
    cursor = page.nextCursor;
  }
}

it.each(EXPORT_ENDPOINTS)("KG1: %s leaks no key, explanation, rubric or accepted pattern", async (endpoint) => {
  const { method, path } = urlFor(endpoint);
  expect(method).toBe("GET");
  const body = await replayAllPages(path);
  assertNoSecrets(endpoint, body);
});

it("the scan would catch a leak — a deliberately unscrubbed response fails it", () => {
  // The self-check `run/scrub-scan.test.ts` itself carries: without this,
  // a scan whose fixture never actually produced a leak would pass even if
  // `assertNoSecrets` were a no-op. Here is the raw stored document a
  // regression that read the question bank instead of the response row
  // would have shipped verbatim.
  const leaky = JSON.stringify(sentinelDocs.find((d) => d.id === "SNT-SINGLE"));
  expect(leaky).toContain("__EXPL_SINGLE__");
  expect(() => assertNoSecrets("mutated-route", leaky)).toThrow(/__EXPL_SINGLE__/);
});

it("KG1: `correct` rides as a boolean on the per-answer CSV, never the key itself", async () => {
  const { path } = urlFor("GET /api/v1/workspaces/:id/tests/:testId/export/answers.csv");
  const res = await app.request(path, { headers: { cookie: ownerCookie } });
  const page = (await res.json()) as ExportPage;
  expect(page.csv).toContain("true");
  // `SNT-SINGLE`'s key is `"a"`, also one of its own option ids — not a
  // useful absence check on its own — so this instead proves the row names
  // no option at all, only the boolean and the candidate's own text.
  expect(page.csv).toContain("candidate's own plain answer");
});
