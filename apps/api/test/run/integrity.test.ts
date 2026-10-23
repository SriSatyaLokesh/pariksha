// Phase 7e Task 5 (`Q6`, `P7E-R9`): `integrityFor` (`@pariksha/core`) wired
// into the two real callers — this proves the wiring, not the decision
// table, which `packages/core/test/integrity.test.ts` already covers.
//
// Review Focus 5 — the two axes (`flag`, grading's, and `integrityFlag`,
// proctoring's) stay independent at the call site, not just in the schema:
// a `scoring_blocked` attempt still recomputes `integrityFlag` on submit,
// and `setIntegrity` never touches `flag`.

import { afterAll, expect, it } from "vitest";
import { closeClient, createCandidate, insertAuthToken, newId, resolvePublishedTest } from "@pariksha/db";
import { createApp } from "../../src/app.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH } from "../../src/routes/proctoring.js";
import type { AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedPublishedTest, seedTest } from "./fixtures.js";
import { PAPER_FORM, seedAttemptTests, startAttemptFor } from "./paper-fixtures.js";

const T = FIXED_NOW;

const { deps } = await testDeps();
const app = createApp(deps);

// `seedPublishedTest` + `seedAttemptTests` builds `alpha/badregex` (and
// everything else that suite needs) — reused here rather than rebuilt, so
// the scoring_blocked case below is the real route's real un-runnable
// pattern (#129), not a second copy of it.
const workspaceId = await seedPublishedTest(deps);
const q = await seedAttemptTests(deps, workspaceId);

// A Standard-profile proctored test of our own, same workspace — one
// ordinary question off the shared bank `seedAttemptTests` already built.
await seedTest(deps, workspaceId, {
  name: "Proctored",
  slug: "proctored",
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      // Standard's limit (5) is nowhere near crossed by the single
      // violation this suite posts — the recompute is what is under test,
      // not the limit or the lock.
      proctoring: { profile: "standard" },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

async function attemptRow(
  attemptId: string,
): Promise<{ flag: string; integrityFlag: string; observed: boolean }> {
  const rows = await deps.db.query<{ flag: string; integrity_flag: string; observed: number }>(
    "SELECT flag, integrity_flag, observed FROM attempt WHERE id = ?",
    [attemptId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no attempt row for ${attemptId}`);
  return { flag: row.flag, integrityFlag: row.integrity_flag, observed: Boolean(row.observed) };
}

function post(path: string, body: unknown, cookie: string): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

let serial = 1;

async function startProctored(): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, "alpha", "proctored", T);
  if (!test) throw new Error("no published test at alpha/proctored");
  const candidateId = await createCandidate(deps.db, test.workspaceId, {
    testId: test.testId,
    formValues: { roll: `R${String(serial++)}` },
    consentVersion: "2026-10-01",
    now: T,
  });
  const token = `reg-${String(serial++)}-${newId("cnd")}`;
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: { workspaceId: test.workspaceId, testVersionId: test.testVersionId, candidateId },
    now: T,
    expiresAt: T + REGISTRATION_TTL_MS,
  });
  const res = await app.request("/api/v1/run/alpha/proctored/start", {
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

// --- a submit always recomputes, and never touches `flag` -----------------

it("leaves a scoring_blocked flag alone when integrity recomputes on submit", async () => {
  const started = await startAttemptFor(deps, app, "badregex");
  expect(started.status).toBe(201);
  const paper = started.paper as AttemptPaper;

  const res = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: started.cookie },
  });
  expect(res.status).toBe(200);

  const row = await attemptRow(paper.attemptId);
  expect(row.flag).toBe("scoring_blocked");
  // `badregex` carries no proctoring overrides (`off`, the default): no
  // violation, no camera, nothing watched or expected — `clean`/`observed:
  // true` is `integrityFor`'s honest answer, computed independently of the
  // grading verdict beside it.
  expect(row.integrityFlag).toBe("clean");
  expect(row.observed).toBe(true);
});

// --- a violation recomputes immediately, not only at submit ---------------

it("recomputes on every violation, not only on submit", async () => {
  const { cookie, attemptId } = await startProctored();
  expect((await attemptRow(attemptId)).integrityFlag).toBe("clean");

  const res = await post(EVENTS_PATH, { events: [{ type: "window_blur", clientTs: 1 }] }, cookie);
  expect(res.status).toBe(200);

  expect((await attemptRow(attemptId)).integrityFlag).toBe("review");
  // Standard's profile never promised a camera, so this is `Q6`'s "review
  // on any violation" alone — not the unwatched floor `P7E-R9` adds.
  expect((await attemptRow(attemptId)).observed).toBe(true);
});

// --- the hard boundary: an unwatched review never gates a consequence -----

it("never auto-submits or locks off an unwatched review alone", async () => {
  // Standard never promises a camera (`requireCamera: false`), so no batch
  // on this profile can ever produce `observed: false` — this is the
  // scoping ruling itself, proved at the route rather than only in
  // `packages/core`: nothing here can accidentally fire a consequence off a
  // signal `P7E-R9` says must stay organiser-facing only.
  const { cookie, attemptId } = await startProctored();
  const events = Array.from({ length: 3 }, (_, i) => ({ type: "snapshot_failed" as const, clientTs: i }));
  await post(EVENTS_PATH, { events }, cookie);
  const row = await attemptRow(attemptId);
  expect(row.observed).toBe(true);
  const state = await deps.db.query<{ submitted_at: number | null; locked_at: number | null }>(
    "SELECT submitted_at, locked_at FROM attempt WHERE id = ?",
    [attemptId],
  );
  expect(state[0]?.submitted_at).toBeNull();
  expect(state[0]?.locked_at).toBeNull();
});
