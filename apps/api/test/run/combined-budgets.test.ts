// Branch-review M6: the true worst case for both `/attempt/submit` and
// `/attempt/events` combines two deltas that no existing fixture combines.
//
// `submit.test.ts`'s "worst case" fixture (`rel-counted`'s last attempt)
// pays the counted-attempt read (`K6`/`K7`) but registers no webhook, so
// `fireWebhooks` costs it only the unconditional `listActiveWebhooksForEvent`
// read (+1). `webhooks/deliver.test.ts`'s "webhook firing" fixture pays one
// *delivering* hook (+2) but is not a counted-attempt last attempt. Neither
// measures `fireWebhooks`'s own real worst case — `INLINE_FANOUT_LIMIT`
// hooks that all fail and all have to be queued, measured directly in
// `deliver.test.ts` at `{ db: 2, http: INLINE_FANOUT_LIMIT, total: 5 }` — on
// the one request that also pays the counted read. This file is that
// combination, for both routes.

import { afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  closeClient,
  createCandidate,
  createWebhook,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS, type AppDeps } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH } from "../../src/routes/proctoring.js";
import { INLINE_FANOUT_LIMIT } from "../../src/webhooks/deliver.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";

const T = FIXED_NOW;
const SUBMIT_PATH = "/api/v1/run/attempt/submit";
const SLUG = { workspace: "combo", submit: "combo-submit", events: "combo-events" } as const;

/** Every call in this file fails — the point is to never deliver, so every
 *  registered hook is queued and `fireWebhooks` pays its real worst case,
 *  never an accidental real `fetch` to `example.test`. */
function failingHttp(): typeof globalThis.fetch {
  return vi.fn(async () => new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch;
}

const { deps: baseDeps } = await testDeps();
const deps: AppDeps = { ...baseDeps, http: failingHttp() };
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Combo Inc");
const q = await seedBank(deps, workspaceId);

// `INLINE_FANOUT_LIMIT` (3) hooks, all registered for the one event both
// routes can fire — `fireWebhooks`'s own worst case, `deliver.test.ts`'s
// `{ db: 2, http: 3, total: 5 }`, is reachable only when there are at least
// this many active hooks.
for (let i = 0; i < INLINE_FANOUT_LIMIT; i++) {
  await createWebhook(deps.db, workspaceId, {
    url: `https://example.test/combo-hook-${String(i)}`,
    events: ["attempt.submitted"],
    now: T,
  });
}

// `rel-counted`'s own shape (`paper-fixtures.ts`): two attempts,
// `counted_attempt: "highest"`, released at a level that makes `countedFor`
// actually read — built fresh here rather than reused from the shared
// fixture so this file's three webhooks touch no other suite's workspace.
await seedTest(deps, workspaceId, {
  name: "Combo submit",
  slug: SLUG.submit,
  body: {
    settings: {
      timing: {
        duration_minutes: 45,
        opens_at: iso(T - DAY),
        closes_at: iso(T + DAY),
        attempts_allowed: 2,
        counted_attempt: "highest",
      },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      release: { when: "on_submit", show: "full_review" },
    },
    sections: [{ id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } }],
  },
});

// The events-route twin: `auto_submit` at the limit, on a last attempt of a
// counted, released test — `/attempt/events`'s own `submitAttempt` call
// pays the identical counted-read + webhook-fanout combination.
await seedTest(deps, workspaceId, {
  name: "Combo events",
  slug: SLUG.events,
  body: {
    settings: {
      timing: {
        duration_minutes: 45,
        opens_at: iso(T - DAY),
        closes_at: iso(T + DAY),
        attempts_allowed: 2,
        counted_attempt: "highest",
      },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      release: { when: "on_submit", show: "full_review" },
      proctoring: { profile: "standard", overrides: { violation_limit: 1, violation_action: "auto_submit" } },
    },
    sections: [{ id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } }],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers (mirror auto-submit.test.ts / start.test.ts) -----------------

let serial = 1;

async function candidateFor(slug: string): Promise<string> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, slug, T);
  if (!test) throw new Error(`no published test at ${SLUG.workspace}/${slug}`);
  return createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
}

async function start(slug: string, candidateId: string, on = app): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, slug, T);
  if (!test) throw new Error(`no published test at ${SLUG.workspace}/${slug}`);
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await on.request(`/api/v1/run/${SLUG.workspace}/${slug}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status !== 201) throw new Error(`start answered ${String(res.status)}`);
  const paper = (await res.json()) as AttemptPaper;
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    attemptId: paper.attemptId,
  };
}

function post(path: string, body: unknown, cookie: string, on = app): Promise<Response> {
  return on.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await deps.db.run("DELETE FROM event", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM candidate", []);
  await deps.db.run("DELETE FROM audit_log", []);
  await deps.db.run("DELETE FROM auth_token", []);
  await deps.db.run("DELETE FROM webhook_delivery", []);
});

it("M6: the submit route's real worst case is 15 — the counted read plus fireWebhooks' own worst case, combined", async () => {
  const candidateId = await candidateFor(SLUG.submit);

  // First attempt: submitted plainly, so it carries a score for the second
  // (counted) attempt's `attemptFiguresForCandidate` read to find.
  const first = await start(SLUG.submit, candidateId);
  await post("/api/v1/run/attempt/submit", {}, first.cookie);

  // Second, last attempt: this is the one `countedFor` actually reads on.
  const second = await start(SLUG.submit, candidateId);
  const counting = countingDeps(deps);
  const countingApp = createApp(counting.deps);
  const res = await post("/api/v1/run/attempt/submit", {}, second.cookie, countingApp);
  expect(res.status).toBe(200);

  expect(counting.counts().total).toBe(15);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[SUBMIT_PATH] as number);
});

it("M6: the events route's real worst case is 19 — auto-submit at the limit on a counted last attempt, with fireWebhooks' own worst case", async () => {
  const candidateId = await candidateFor(SLUG.events);

  const first = await start(SLUG.events, candidateId);
  await post("/api/v1/run/attempt/submit", {}, first.cookie);

  const second = await start(SLUG.events, candidateId);
  const counting = countingDeps(deps);
  const countingApp = createApp(counting.deps);
  // `violation_limit: 1` — the very first event batch crosses it and
  // `submitAttempt` fires with `reason: "limit"`, the same function
  // `/attempt/submit` calls, on this same (counted, last) attempt.
  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 1 }] }, second.cookie, countingApp);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ submitted: true });

  expect(counting.counts().total).toBe(19);
  expect(counting.counts().total).toBe(ROUTE_BUDGETS[EVENTS_PATH] as number);
});
