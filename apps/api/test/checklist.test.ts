// Pre-publish warnings (#64, P5.11) — T-11's "the builder warns" half.
//
// Review Focus 4 is the whole point of this file: `GET .../checklist` and
// `POST .../publish` are one function with two callers, so the test that
// matters most here is the one that asserts they return the same rows.
// Everything is driven over the mounted routes.

import { afterAll, beforeEach, expect, it } from "vitest";
import { addMembership, closeClient, createUser } from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_BUDGETS } from "../src/app.js";
import { countingDeps } from "../src/instrument.js";
import { issueSession } from "../src/auth/session.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";

const { deps } = await testDeps();
const app = createApp(deps);

afterAll(() => closeClient(deps.db));

const DAY = 86_400_000;
const past = new Date(FIXED_NOW - DAY).toISOString();
const future = new Date(FIXED_NOW + DAY).toISOString();

interface Row {
  id: string;
  severity: "blocking" | "advisory";
  message: string;
  field: string;
  sectionId?: string;
}

let workspaceId = "";
let adminCookie = "";
let authorCookie = "";
let testId = "";
let bankId = "";
let quantIds: string[] = [];
let suffix = 0;

function send(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}
const get = (cookie: string): RequestInit => send("GET", cookie);
const post = (body: unknown, cookie: string): RequestInit => send("POST", cookie, body);

async function member(ws: string, role: "admin" | "author", tag: string): Promise<string> {
  const userId = await createUser(deps.db, {
    email: `${role}-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  await addMembership(deps.db, ws, { userId, role, now: FIXED_NOW });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

async function question(id: string, points: number, tags: string[]): Promise<string> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/banks/${bankId}/questions`,
    post(
      { id, type: "true_false", prompt: "The sky is blue.", key: true, tags, scoring: { points } },
      authorCookie,
    ),
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return (await res.json()).id;
}

/** A test whose only complaint is a pool shortfall: 7 tagged questions and
 * a pool asking for 10. Every case below starts here and changes one
 * thing. */
beforeEach(async () => {
  suffix += 1;
  const tag = `c${suffix}`;

  const ownerId = await createUser(deps.db, {
    email: `owner-${tag}@alpha.test`,
    authProvider: "magic_link",
    now: FIXED_NOW,
  });
  const ownerCookie = await sessionCookie(deps, (await issueSession(deps, ownerId)).token);
  workspaceId = (
    await (await app.request("/api/v1/workspaces", send("POST", ownerCookie, { slug: `chk-${tag}`, name: "Chk Co" }))).json()
  ).id;

  adminCookie = await member(workspaceId, "admin", tag);
  authorCookie = await member(workspaceId, "author", tag);

  bankId = (
    await (await app.request(`/api/v1/workspaces/${workspaceId}/banks`, post({ name: "Bank" }, authorCookie))).json()
  ).id;

  quantIds = [];
  for (let i = 0; i < 7; i += 1) quantIds.push(await question(`QNT-${i}`, 2, ["quantitative"]));

  testId = (
    await (
      await app.request(
        `/api/v1/workspaces/${workspaceId}/tests`,
        post({ name: "Midterm", slug: `midterm-${tag}` }, authorCookie),
      )
    ).json()
  ).id;

  await saveDraft({
    settings: {
      timing: { duration_minutes: 60, opens_at: past, closes_at: future },
      registration_form: { fields: [{ id: "email", type: "email", label: "Email", unique: true }] },
    },
    sections: [
      {
        id: "quant",
        title: "Quantitative aptitude",
        source: { kind: "pool", bank: bankId, count: 10, filter: { tags: ["quantitative"] } },
      },
    ],
  });
});

async function saveDraft(patch: unknown): Promise<void> {
  const res = await app.request(
    `/api/v1/workspaces/${workspaceId}/tests/${testId}/draft`,
    send("PATCH", authorCookie, patch),
  );
  expect(res.status, await res.clone().text()).toBe(200);
}

const checklistUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/${testId}/checklist`;
const publishUrl = (): string => `/api/v1/workspaces/${workspaceId}/tests/${testId}/publish`;

async function rows(cookie = authorCookie): Promise<Row[]> {
  const res = await app.request(checklistUrl(), get(cookie));
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()).rows as Row[];
}

const ids = (list: readonly Row[]): string[] => list.map((r) => r.id);

async function publish(): Promise<Response> {
  return app.request(publishUrl(), post({}, adminCookie));
}

// --- T-11: the two rows that warn rather than block --------------------

it("a pool shortfall is advisory and states both numbers", async () => {
  const row = (await rows()).find((r) => r.id === "pool_short");
  expect(row).toMatchObject({ severity: "advisory", sectionId: "quant" });
  // The measured fact, in `validateTest`'s own words — the same sentence an
  // import of the same document would refuse over, so the checklist and the
  // import can never report different numbers.
  expect(row?.message).toBe('section "quant" draws 10 questions but only 7 match its filter');
});

it("unequal sets are advisory, name each set's total, and say where the tolerance lives", async () => {
  const [a, b] = [await question("SET-A", 8, []), await question("SET-B", 6, [])];
  await saveDraft({
    sections: [
      {
        id: "reasoning",
        title: "Reasoning",
        source: {
          kind: "sets",
          assignment: "round_robin",
          sets: [
            { set: "A", questions: [a] },
            { set: "B", questions: [b] },
          ],
        },
      },
    ],
  });

  const row = (await rows()).find((r) => r.id === "sets_unbalanced");
  expect(row).toMatchObject({ severity: "advisory", sectionId: "reasoning" });
  expect(row?.message).toContain("A: 8, B: 6");
  expect(row?.message).toContain("the tolerance is 0");
  // The recorded trap: there is no UI control for
  // `scoring.set_points_tolerance`, so the row has to say where the knob is
  // or it is a permanently red advisory with nothing to change.
  expect(row?.message).toMatch(/set_points_tolerance.*test file/);
});

// The second half of the same trap: precedence in `validate.ts` is
// `options.setPointsTolerance ?? doc.scoring.set_points_tolerance ?? 0`,
// which overrides in *either* direction — so a gate passing the
// apparently-harmless `{ setPointsTolerance: 0 }` silently discards a
// tolerance the file set. This gate passes no option at all, and this is
// what proves it.
it("a tolerance set in the test file is honoured by the gate, not overridden by it", async () => {
  const [a, b] = [await question("TOL-A", 8, []), await question("TOL-B", 6, [])];
  await saveDraft({
    settings: { scoring: { set_points_tolerance: 2 } },
    sections: [
      {
        id: "reasoning",
        title: "Reasoning",
        source: {
          kind: "sets",
          assignment: "round_robin",
          sets: [
            { set: "A", questions: [a] },
            { set: "B", questions: [b] },
          ],
        },
      },
    ],
  });

  expect(ids(await rows())).not.toContain("sets_unbalanced");
});

it("T-11: publish succeeds over advisory rows and refuses over blocking ones", async () => {
  expect(ids(await rows())).toContain("pool_short");
  expect((await publish()).status).toBe(200);

  await saveDraft({ sections: [{ id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } }] });
  const refused = await publish();
  expect(refused.status).toBe(422);
  expect((await refused.json()).error.details.rows.map((r: Row) => r.id)).toContain("section_empty");
});

it("import refuses the same pool shortfall that publish only warns about", async () => {
  // docs/test-format.md § "Rules checked on import": "Import is stricter."
  // Same rule, same numbers, two severities — which is why the checklist
  // reads them off `validateTest` rather than re-deriving them.
  const { validateTest } = await import("@pariksha/core");
  const doc = {
    format: "pariksha/test@1",
    name: "M",
    slug: "m",
    timing: { duration_minutes: 60 },
    sections: [{ id: "quant", title: "Q", source: { kind: "pool", count: 10, filter: { tags: ["quantitative"] } } }],
  };
  const result = validateTest(doc, []);
  expect(result.ok).toBe(false);
});

// --- Review Focus 4: one function, two callers -------------------------

it("the checklist and publish compute the same rows — one function, two callers", async () => {
  await saveDraft({ sections: [{ id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } }] });

  const fromGet = (await rows()).filter((r) => r.severity === "blocking");
  const refused = await publish();
  const fromPublish = (await refused.json()).error.details.rows as Row[];

  expect(fromPublish).toEqual(fromGet);
  expect(fromPublish.length).toBeGreaterThan(0);
});

it("the checklist is readable by an Author, who is the person who has to fix it", async () => {
  expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/checklist"]).toBe("tests.edit");
  expect((await app.request(checklistUrl(), get(authorCookie))).status).toBe(200);
});

// --- the form and allowlist advisories ---------------------------------

it("a form with no unique field is advisory, and a form with one is silent", async () => {
  await saveDraft({ settings: { registration_form: { fields: [{ id: "name", type: "short_text", label: "Name" }] } } });
  expect((await rows()).find((r) => r.id === "no_unique_field")).toMatchObject({
    severity: "advisory",
    message: "no registration field is unique, so a candidate can register twice",
  });

  await saveDraft({
    settings: { registration_form: { fields: [{ id: "email", type: "email", label: "Email", unique: true }] } },
  });
  expect(ids(await rows())).not.toContain("no_unique_field");
});

it("an allowlist set and then emptied is advisory — it reads as a restriction and is none", async () => {
  await saveDraft({ settings: { access: { mode: "link_code", access_code: "APTI-2026", allow_email_domains: [] } } });

  const row = (await rows()).find((r) => r.id === "allowlist_empty");
  expect(row).toMatchObject({ severity: "advisory" });
  expect(row?.message).toContain("Anyone with the link and the code.");
  expect(row?.message).toContain("restricts nobody");
});

it("an allowlist with entries in it says nothing", async () => {
  await saveDraft({
    settings: { access: { mode: "sso", allow_email_domains: ["*.ac.in"] } },
  });
  expect(ids(await rows())).not.toContain("allowlist_empty");
});

// --- the candidate list -------------------------------------------------

async function uploadCandidates(csv: string): Promise<void> {
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/tests/${testId}/candidates/import`, {
    method: "POST",
    headers: { cookie: adminCookie, "content-type": "text/csv" },
    body: csv,
  });
  expect(res.status, await res.clone().text()).toBe(200);
}

it("an empty candidate list is advisory for invite_only and does not appear otherwise", async () => {
  await saveDraft({ settings: { access: { mode: "invite_only" } } });
  expect((await rows()).find((r) => r.id === "candidate_list_empty")).toMatchObject({
    severity: "advisory",
    message: "the candidate list has no rows, so nobody can enter yet",
  });

  await saveDraft({ settings: { access: { mode: "link_code", access_code: "APTI-2026" } } });
  expect(ids(await rows())).not.toContain("candidate_list_empty");
});

it("an invite_only test with an empty candidate list publishes — the roster is uploaded afterwards", async () => {
  await saveDraft({ settings: { access: { mode: "invite_only" } } });
  expect(ids(await rows())).toContain("candidate_list_empty");
  expect((await publish()).status).toBe(200);
});

it("candidates with no set are advisory and state the count", async () => {
  const [a, b] = [await question("CS-A", 4, []), await question("CS-B", 4, [])];
  await saveDraft({
    settings: { access: { mode: "invite_only" } },
    sections: [
      {
        id: "reasoning",
        title: "Reasoning",
        source: {
          kind: "sets",
          assignment: "from_candidate_list",
          sets: [
            { set: "A", questions: [a] },
            { set: "B", questions: [b] },
          ],
        },
      },
    ],
  });
  await uploadCandidates("email,set\none@ac.in,A\ntwo@ac.in,\nthree@ac.in,\n");

  expect((await rows()).find((r) => r.id === "candidate_no_set")).toMatchObject({
    severity: "advisory",
    message: "2 of 3 candidates have no set, and cannot start",
  });
});

it("the candidate rows say nothing when nothing depends on the list", async () => {
  await uploadCandidates("email,set\none@ac.in,\n");
  const list = ids(await rows());
  expect(list).not.toContain("candidate_list_empty");
  expect(list).not.toContain("candidate_no_set");
});

// --- shape and cost -----------------------------------------------------

const GREEN_SECTIONS = [
  { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] as string[] } },
];

it("an all-green test returns nothing that blocks", async () => {
  await saveDraft({ sections: [{ ...GREEN_SECTIONS[0], source: { kind: "fixed", questions: quantIds } }] });
  // The fixture's window is already open (`opens_at: past`), which is the
  // ordinary case and is why `window_open_already` is advisory. Nothing
  // else has anything to say.
  expect(await rows()).toEqual([expect.objectContaining({ id: "window_open_already", severity: "advisory" })]);
});

// Whole-branch spec review, Minor 1. #59 asks for "opens in the past" on
// blur **and again at the publish checklist (#64)". The blur nag landed
// (`TimingPanel.tsx:297-306`); the checklist half did not, and the
// shortfall was recorded nowhere — not in the plan's Known deferrals, not
// in a ruling, not in the ROADMAP row.
it("#59: a window already open is an advisory row, never a refusal", async () => {
  await saveDraft({ sections: [{ ...GREEN_SECTIONS[0], source: { kind: "fixed", questions: quantIds } }] });

  expect((await rows()).find((r) => r.id === "window_open_already")).toMatchObject({
    severity: "advisory",
    field: "timing.opens_at",
    message: expect.stringMatching(/opened \d+ day\(s\) ago, so this test is open the moment it is published/),
  });
  // Advisory means it publishes. A blocking row here would refuse the
  // ordinary case of publishing a test that starts immediately.
  expect((await publish()).status).toBe(200);
});

it("#59: a window that has not opened yet says nothing", async () => {
  await saveDraft({
    settings: { timing: { duration_minutes: 60, opens_at: future, closes_at: new Date(FIXED_NOW + 2 * DAY).toISOString() } },
    sections: [{ ...GREEN_SECTIONS[0], source: { kind: "fixed", questions: quantIds } }],
  });
  expect(ids(await rows())).not.toContain("window_open_already");
});

// Already closed is the blocking case and keeps its own row: the two must
// not both fire, or the screen tells an organiser the test is open and
// closed at once.
it("#59: a window that has already closed blocks, and the advisory stays quiet", async () => {
  await saveDraft({
    settings: { timing: { duration_minutes: 60, opens_at: past, closes_at: past } },
    sections: [{ ...GREEN_SECTIONS[0], source: { kind: "fixed", questions: quantIds } }],
  });
  const list = ids(await rows());
  expect(list).toContain("window_past");
  expect(list).not.toContain("window_open_already");
});

it("every row names a field a screen can navigate to", async () => {
  await saveDraft({ settings: { access: { mode: "invite_only", allow_ip_ranges: [] } }, sections: [] });
  const list = await rows();
  expect(list.length).toBeGreaterThan(2);
  for (const row of list) {
    expect(row.field, row.id).not.toBe("");
    expect(row.message, row.id).not.toBe("");
  }
});

// --- proctoring advisories (Phase 7a Task 6, Q1c) -----------------------
//
// All three are advisory — Phase 7 adds no blocking row (`Q1c`). The lock
// row that was going to block has nowhere to send an organiser: no
// support-email, reply-to or from-address field exists anywhere in the
// schema yet, and inventing one belongs to whoever owns organiser contact
// details, not this task.

it("advises on Strict without a camera, and never blocks", async () => {
  await saveDraft({ settings: { proctoring: { profile: "strict", overrides: { require_camera: false } } } });
  const list = await rows();
  expect(list.find((r) => r.id === "proctoring_strict_no_camera")?.severity).toBe("advisory");
  expect(list.filter((r) => r.severity === "blocking")).toHaveLength(0);
});

it("states images, megabytes and uploads per candidate on an expensive configuration", async () => {
  await saveDraft({
    settings: {
      timing: { duration_minutes: 180, opens_at: past, closes_at: future },
      proctoring: { profile: "strict", overrides: { snapshot_interval_seconds: 15 } },
    },
  });
  const row = (await rows()).find((r) => r.id === "proctoring_snapshot_cost");
  expect(row?.message).toMatch(/720 images.*18 MB.*720 uploads/);
});

it("is silent about cost when snapshots are off", async () => {
  await saveDraft({
    settings: { proctoring: { profile: "strict", overrides: { snapshot_interval_seconds: 0 } } },
  });
  expect(ids(await rows())).not.toContain("proctoring_snapshot_cost");
});

// This was nearly the one blocking row Phase 7 added — a `lock` has no way
// out but an organiser opening the attempt — and is deliberately advisory
// instead, for the reason stated above. Both halves of that ruling need a
// row of their own: present, and never blocking.
it("a lock with no way to reach the organiser is advisory, and never blocks", async () => {
  await saveDraft({ settings: { proctoring: { profile: "standard", overrides: { violation_action: "lock" } } } });
  const list = await rows();
  expect(list.find((r) => r.id === "proctoring_lock_without_recourse")).toMatchObject({
    severity: "advisory",
    message: expect.stringContaining("phase 8"),
  });
  expect(list.filter((r) => r.severity === "blocking")).toHaveLength(0);
});

it("measures the real subrequest cost of the checklist route, flat in candidates and sections", async () => {
  await uploadCandidates("email,set\none@ac.in,\ntwo@ac.in,\nthree@ac.in,\nfour@ac.in,\n");

  const first = countingDeps(deps);
  expect((await createApp(first.deps).request(checklistUrl(), get(authorCookie))).status).toBe(200);
  expect(first.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/checklist"]);

  await saveDraft({
    sections: [1, 2, 3, 4].map((n) => ({
      id: `s${n}`,
      title: `Section ${n}`,
      source: { kind: "fixed", questions: quantIds },
    })),
  });
  const second = countingDeps(deps);
  expect((await createApp(second.deps).request(checklistUrl(), get(authorCookie))).status).toBe(200);
  expect(second.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/checklist"]);
  // Whole-branch test-honesty review, §4. The measurement alone is one
  // lock: it catches a regression that adds a query. The literal is the
  // second: without it, a one-character edit to `app.ts` makes the
  // measurement agree with itself again and both go green. Standing
  // decision 5's "update the pin and the table together" needs both.
  expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/checklist"]).toBe(6);
});
