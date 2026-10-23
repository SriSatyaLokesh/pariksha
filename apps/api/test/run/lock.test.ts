// Phase 7e Task 3 (`E-R1`/`E-R2`): the lock at the limit — the fourth and
// last consumer of `violationOutcome`'s branches (Task 1,
// `proctoring-outcome.ts`). `lockAttempt` (`packages/db/src/repo/
// attempts.ts`) is not a second idempotency check: `claimViolationLimit`'s
// own atomic claim is what makes "fires once" true, and this function only
// writes once that claim is won.
//
// Mirrors `auto-submit.test.ts`'s own helpers (`start`, `post`,
// `attemptState`) rather than importing them — a one-file duplication, the
// same call this repo's own `D-R4` pattern makes for its own helpers.

import { afterAll, beforeEach, expect, it, vi } from "vitest";
import {
  closeClient,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
} from "@pariksha/db";
import { createApp, ROUTE_BUDGETS } from "../../src/app.js";
import { countingDeps } from "../../src/instrument.js";
import { REGISTRATION_KIND, REGISTRATION_TTL_MS, registrationHash } from "../../src/run/entry.js";
import { EVENTS_PATH, SNAPSHOT_PATH } from "../../src/routes/proctoring.js";
import { ANSWER_PATH, type AttemptPaper } from "../../src/run/attempt.js";
import { FIXED_NOW, testDeps } from "../deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./fixtures.js";
import { PAPER_FORM, seedBank } from "./paper-fixtures.js";

const T = FIXED_NOW;
const SLUG = { workspace: "theta", test: "lock" } as const;

const { deps } = await testDeps();
const app = createApp(deps);
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Theta Inc");
const q = await seedBank(deps, workspaceId);

// `lock5`: `violation_limit: 5`, `violation_action: "lock"` — the one
// combination this file exists to prove wired end to end.
await seedTest(deps, workspaceId, {
  name: "Lock",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 45, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      access: { mode: "link_code", access_code: "OPENSESAME" },
      registration_form: PAPER_FORM,
      proctoring: { profile: "standard", overrides: { violation_limit: 5, violation_action: "lock" } },
    },
    sections: [
      { id: "only", title: "Only", source: { kind: "fixed", questions: [q["LOG-001"] as string] } },
    ],
  },
});

afterAll(() => closeClient(deps.db));

// --- helpers (mirrors auto-submit.test.ts) ----------------------------------

let serial = 1;

async function start(): Promise<{ cookie: string; attemptId: string }> {
  const test = await resolvePublishedTest(deps.db, SLUG.workspace, SLUG.test, T);
  if (!test) throw new Error(`no published test at ${SLUG.workspace}/${SLUG.test}`);
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
  const res = await app.request(`/api/v1/run/${SLUG.workspace}/${SLUG.test}/start`, {
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

function put(path: string, body: unknown, cookie: string, on = app): Promise<Response> {
  return on.request(path, {
    method: "PUT",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** `auto-submit.test.ts`'s own helper, widened with `locked_at`. */
async function attemptState(
  attemptId: string,
): Promise<{ status: "in_progress" | "submitted" | "locked"; lockedAt: number | null }> {
  const rows = await deps.db.query<{ submitted_at: number | null; locked_at: number | null }>(
    "SELECT submitted_at, locked_at FROM attempt WHERE id = ?",
    [attemptId],
  );
  const row = rows[0];
  const submittedAt = row?.submitted_at ?? null;
  const lockedAt = row?.locked_at ?? null;
  return {
    status: submittedAt !== null ? "submitted" : lockedAt !== null ? "locked" : "in_progress",
    lockedAt,
  };
}

async function lockedEventCount(attemptId: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM event WHERE attempt_id = ? AND type = 'attempt_locked'",
    [attemptId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function totalEventCount(attemptId: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM event WHERE attempt_id = ?",
    [attemptId],
  );
  return Number(rows[0]?.n ?? 0);
}

async function reachLimit(cookie: string, n = 5): Promise<Response> {
  return post(
    EVENTS_PATH,
    { events: Array.from({ length: n }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    cookie,
  );
}

/** `snapshot.test.ts`'s own helper pattern. */
function postBytes(path: string, body: Uint8Array, cookie: string, on = app): Promise<Response> {
  return on.request(path, {
    method: "POST",
    headers: { "content-type": "image/jpeg", cookie },
    body,
  });
}

/** A real JPEG magic-byte prefix — `snapshot.test.ts`'s own fixture,
 *  reused rather than re-minted: `D-R8` checks the bytes, not the header. */
const jpegFixture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function listSnapshots(attemptId: string): Promise<number> {
  const rows = await deps.db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM snapshot WHERE attempt_id = ?",
    [attemptId],
  );
  return Number(rows[0]?.n ?? 0);
}

let attemptCookie = "";
let attemptId = "";

beforeEach(async () => {
  await deps.db.run("DELETE FROM event", []);
  await deps.db.run("DELETE FROM response", []);
  await deps.db.run("DELETE FROM snapshot", []);
  await deps.db.run("DELETE FROM attempt", []);
  await deps.db.run("DELETE FROM audit_log", []);
  await deps.db.run("DELETE FROM auth_token", []);
  const started = await start();
  attemptCookie = started.cookie;
  attemptId = started.attemptId;
});

// --- the brief's own tests ---------------------------------------------------

it("locks the attempt at the limit and refuses further answers", async () => {
  const res = await reachLimit(attemptCookie, 5);
  expect(await res.json()).toMatchObject({ violations: 5, limit: 5, action: "lock", locked: true });

  expect((await attemptState(attemptId)).status).toBe("locked");

  const answer = await put(ANSWER_PATH, { questionId: q["LOG-001"] as string, value: { kind: "option", option: "a" }, clientSeq: 1 }, attemptCookie);
  expect(answer.status).toBe(409);
  expect((await answer.json()) as { error: { code: string } }).toMatchObject({
    error: { code: "attempt_locked" },
  });
});

// Review Focus 2 — a submitted attempt is not lockable.
it("does not lock an already-submitted attempt", async () => {
  const submitRes = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: attemptCookie },
  });
  expect(submitRes.status).toBe(200);

  const res = await reachLimit(attemptCookie, 5);
  expect(res.status).toBeLessThan(500);
  expect((await attemptState(attemptId)).status).toBe("submitted");
  expect(await lockedEventCount(attemptId)).toBe(0);
});

// `Q5c` — the clock does not stop and is not refunded through a lock.
it("keeps counting down through a lock", async () => {
  const before = (await app.request("/api/v1/run/attempt", { headers: { cookie: attemptCookie } }).then(
    (r) => r.json(),
  )) as AttemptPaper;
  await reachLimit(attemptCookie, 5);
  expect((await attemptState(attemptId)).status).toBe("locked");

  const laterDeps = { ...deps, now: () => T + 300_000 };
  const laterApp = createApp(laterDeps);
  const after = (await laterApp
    .request("/api/v1/run/attempt", { headers: { cookie: attemptCookie } })
    .then((r) => r.json())) as AttemptPaper;
  expect(after.remainingMs).toBeLessThan(before.remainingMs - 290_000);
});

// Review Focus 1 — one lock, whatever the flush carried: a single request
// whose own batch pushes the count from 0 straight past the limit (the 5th
// and a 6th violation together) must still only lock once.
it("locks once when the fifth and sixth violations arrive together", async () => {
  const res = await reachLimit(attemptCookie, 6);
  expect(await res.json()).toMatchObject({ violations: 6, locked: true });
  expect(await lockedEventCount(attemptId)).toBe(1);
  expect((await attemptState(attemptId)).status).toBe("locked");
});

// A late flush after the attempt already locked must not fire a second
// `attempt_locked` marker or re-stamp `locked_at` — `claimViolationLimit`'s
// own atomicity is what this proves end to end.
it("does not lock a second time on a later flush past the limit", async () => {
  await reachLimit(attemptCookie, 5);
  const first = await attemptState(attemptId);

  const res = await reachLimit(attemptCookie, 1);
  expect(await res.json()).toMatchObject({ locked: false });
  const second = await attemptState(attemptId);
  expect(second.lockedAt).toBe(first.lockedAt);
  expect(await lockedEventCount(attemptId)).toBe(1);
});

// A locked attempt's own Submit press is refused too — `E-R2`'s own "the
// only way out is an organiser" would otherwise let a candidate end the
// very attempt an organiser is meant to review.
it("refuses a locked attempt's own Submit press", async () => {
  await reachLimit(attemptCookie, 5);
  const res = await app.request("/api/v1/run/attempt/submit", {
    method: "POST",
    headers: { cookie: attemptCookie },
  });
  expect(res.status).toBe(409);
  expect((await attemptState(attemptId)).status).toBe("locked");
});

// `E-R2`: the one request a locked candidate must still be able to make.
// If the guard had gone in `attemptContext` (the task text's own mistake),
// this would 401/409 too.
it("still answers GET /attempt for a locked candidate, with lockedAt set", async () => {
  await reachLimit(attemptCookie, 5);
  const res = await app.request("/api/v1/run/attempt", { headers: { cookie: attemptCookie } });
  expect(res.status).toBe(200);
  const paper = (await res.json()) as AttemptPaper;
  expect(paper.lockedAt).not.toBeNull();
  expect(paper.submittedAt).toBeNull();
});

// The overlay must be unreachable for a candidate who was never locked —
// the negative the brief asks to test, not only the positive.
it("never locks an attempt that stays under the limit", async () => {
  await reachLimit(attemptCookie, 4);
  expect((await attemptState(attemptId)).status).toBe("in_progress");
  const answer = await put(ANSWER_PATH, { questionId: q["LOG-001"] as string, value: { kind: "option", option: "a" }, clientSeq: 1 }, attemptCookie);
  expect(answer.status).not.toBe(409);
});

// --- fix round 1 (CRITICAL) — the lock does not clear itself -------------

// `GET /attempt`'s own timeout materialisation (`C-07`) must not stamp
// `submitted_at` for a locked attempt once its deadline passes — that is
// the one path `attemptContext`'s read-only exemption (`E-R2`) left open,
// and without `attempt.lockedAt === null` in its own condition it would
// have walked a locked candidate to a clean receipt with no organiser ever
// involved, past the 45-minute duration plus the 30-second grace this
// test's own fixture carries (`clock.ts`'s `TIMING_DEFAULTS`).
it("stays locked and unsubmitted after its deadline passes, even on GET /attempt", async () => {
  await reachLimit(attemptCookie, 5);
  expect((await attemptState(attemptId)).status).toBe("locked");

  const pastDeadlineDeps = { ...deps, now: () => T + 45 * 60_000 + 31_000 };
  const pastDeadlineApp = createApp(pastDeadlineDeps);
  const res = await pastDeadlineApp.request("/api/v1/run/attempt", { headers: { cookie: attemptCookie } });
  expect(res.status).toBe(200);
  const paper = (await res.json()) as AttemptPaper;
  expect(paper.submittedAt).toBeNull();
  expect(paper.lockedAt).not.toBeNull();

  const state = await attemptState(attemptId);
  expect(state.status).toBe("locked");
});

// --- fix round 1 (MAJOR) — the snapshot route writes nothing while locked -

// `POST /attempt/snapshot` was never one of `E-R2`'s enumerated guarded
// routes — it is neither a read nor one of the two write routes
// `assertNotLocked` covers — so without its own `lockedAt` no-op (mirroring
// the pre-existing `submittedAt` one, same file) a locked candidate's
// browser kept driving real R2 `put`s and real `snapshot` row inserts
// indefinitely against a metered live Cloudflare account.
it("writes nothing to R2 or the database when a snapshot is posted on a locked attempt", async () => {
  await reachLimit(attemptCookie, 5);
  expect((await attemptState(attemptId)).status).toBe("locked");

  const putSpy = vi.fn(deps.storage.put.bind(deps.storage));
  const realPut = deps.storage.put;
  deps.storage.put = putSpy;
  try {
    const res = await postBytes(`${SNAPSHOT_PATH}?reason=interval`, jpegFixture, attemptCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: true });
    expect(putSpy).not.toHaveBeenCalled();
    expect(await listSnapshots(attemptId)).toBe(0);
  } finally {
    deps.storage.put = realPut;
  }
});

// `POST /attempt/events` was never one of `E-R2`'s enumerated guarded
// routes either, and its own `attempt.submittedAt === null` no-op (the
// same shape `/attempt/snapshot`'s pre-fix-round guard had) never checked
// `lockedAt` — so a locked candidate's browser kept driving real
// `appendEvents` inserts into `event` on every further violation,
// indefinitely, against the same metered D1 budget the MAJOR fix closed
// for R2.
it("writes no further event rows once an attempt is locked", async () => {
  await reachLimit(attemptCookie, 5);
  expect((await attemptState(attemptId)).status).toBe("locked");
  const before = await totalEventCount(attemptId);

  const res = await reachLimit(attemptCookie, 3);
  expect(res.status).toBeLessThan(500);
  expect(await totalEventCount(attemptId)).toBe(before);
});

// --- the budget: the worst case is declared and measured -------------------

// Base **7** (the limit-reaching 5, plus `lockAttempt`'s own write and one
// more `appendEvents` call for the `attempt_locked` marker — `events.test.ts`'s
// own comment has the detail on the 5). Phase 7e Task 5 (`Q6a`) adds its own
// +3 on top: locking never submits, so the `!submitted` guard that skips
// `routes/proctoring.ts`'s own `recomputeIntegrity` call for an auto-submit
// never fires here — **10**.
it("the batch that first locks costs 10, measured — under the declared ceiling", async () => {
  const counting = countingDeps(deps);
  const res = await post(
    EVENTS_PATH,
    { events: Array.from({ length: 5 }, (_, i) => ({ type: "window_blur" as const, clientTs: i })) },
    attemptCookie,
    createApp(counting.deps),
  );
  expect((await res.json() as { locked: boolean }).locked).toBe(true);
  expect(counting.counts().total).toBe(10);
  expect(counting.counts().total).toBeLessThanOrEqual(ROUTE_BUDGETS[EVENTS_PATH]);
});
