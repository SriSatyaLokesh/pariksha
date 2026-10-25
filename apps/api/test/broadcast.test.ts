import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeClient,
  createBank,
  createCandidate,
  insertAuthToken,
  newId,
  resolvePublishedTest,
  setProctorMessage,
  upsertQuestions,
  type AttemptPaper,
} from "@pariksha/db";
import { createApp } from "../src/app.js";
import { registrationHash, REGISTRATION_KIND, REGISTRATION_TTL_MS } from "../src/run/entry.js";
import { FIXED_NOW, testDeps } from "./deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./run/fixtures.js";
import { PAPER_FORM, seedBank } from "./run/paper-fixtures.js";

const T = FIXED_NOW;
const { deps } = await testDeps({ now: () => T });
const app = createApp(deps);
afterAll(() => closeClient(deps.db));

const SLUG = { workspace: "alpha-broadcast", test: "broadcast-paper" };
const workspaceId = await seedWorkspace(deps, SLUG.workspace, "Alpha Broadcast Workspace");
const q = await seedBank(deps, workspaceId);

await seedTest(deps, workspaceId, {
  name: "Broadcast Test",
  slug: SLUG.test,
  body: {
    settings: {
      timing: { duration_minutes: 60, attempts_allowed: 1, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      registration_form: PAPER_FORM,
      proctoring: { profile: "strict" },
    },
    sections: [{ id: "sec1", title: "Sec 1", source: { kind: "fixed", questions: [q["LOG-001"] as string] } }],
  },
});

let serial = 1;

async function startAttempt(): Promise<{ cookie: string; attemptId: string; questionId: string }> {
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
  if (res.status !== 201) {
    const errText = await res.text();
    throw new Error(`start answered ${String(res.status)}: ${errText}`);
  }
  const paper = (await res.json()) as AttemptPaper;
  return {
    cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
    attemptId: paper.attemptId,
    questionId: paper.sections[0]!.questions[0]!.id,
  };
}

const jpegFixture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

describe("Proctor Broadcast (C-10, K12, K13)", () => {
  it("omits message and messageAt when none is pending", async () => {
    const { cookie, questionId } = await startAttempt();

    // 1. events
    const eventsRes = await app.request("/api/v1/run/attempt/events", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "window_blur", clientTs: T }] }),
    });
    expect(eventsRes.status).toBe(200);
    const eventsBody = (await eventsRes.json()) as Record<string, unknown>;
    expect(eventsBody.message).toBeUndefined();
    expect(eventsBody.messageAt).toBeUndefined();

    // 2. answer
    const answerRes = await app.request("/api/v1/run/attempt/answer", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId, value: { kind: "option", option: "a" }, clientSeq: 1 }),
    });
    expect(answerRes.status).toBe(200);
    const answerBody = (await answerRes.json()) as Record<string, unknown>;
    expect(answerBody.message).toBeUndefined();
    expect(answerBody.messageAt).toBeUndefined();

    // 3. snapshot
    const snapshotRes = await app.request("/api/v1/run/attempt/snapshot?reason=interval", {
      method: "POST",
      headers: { cookie, "content-type": "image/jpeg" },
      body: jpegFixture,
    });
    expect(snapshotRes.status).toBe(200);
    const snapshotBody = (await snapshotRes.json()) as Record<string, unknown>;
    expect(snapshotBody.message).toBeUndefined();
    expect(snapshotBody.messageAt).toBeUndefined();
  });

  it("carries pending message on events response and clears on delivery", async () => {
    const { cookie, attemptId } = await startAttempt();
    const messageAt = T + 1000;
    await setProctorMessage(deps.db, workspaceId, attemptId, "Please adjust your webcam", messageAt);

    // First events call carries the message
    const res1 = await app.request("/api/v1/run/attempt/events", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "window_blur", clientTs: T }] }),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.message).toBe("Please adjust your webcam");
    expect(body1.messageAt).toBe(messageAt);

    // Second events call no longer carries it (cleared on delivery)
    const res2 = await app.request("/api/v1/run/attempt/events", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ events: [{ type: "window_blur", clientTs: T + 1 }] }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.message).toBeUndefined();
    expect(body2.messageAt).toBeUndefined();
  });

  it("carries pending message on answer response and clears on delivery", async () => {
    const { cookie, attemptId, questionId } = await startAttempt();
    const messageAt = T + 2000;
    await setProctorMessage(deps.db, workspaceId, attemptId, "Quiet in the room please", messageAt);

    // First answer call carries message
    const res1 = await app.request("/api/v1/run/attempt/answer", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId, value: { kind: "option", option: "a" }, clientSeq: 1 }),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.message).toBe("Quiet in the room please");
    expect(body1.messageAt).toBe(messageAt);

    // Subsequent answer call has no message
    const res2 = await app.request("/api/v1/run/attempt/answer", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId, value: { kind: "option", option: "b" }, clientSeq: 2 }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.message).toBeUndefined();
    expect(body2.messageAt).toBeUndefined();
  });

  it("carries pending message on snapshot response and clears on delivery", async () => {
    const { cookie, attemptId } = await startAttempt();
    const messageAt = T + 3000;
    await setProctorMessage(deps.db, workspaceId, attemptId, "Ensure face is visible", messageAt);

    // First snapshot call carries message
    const res1 = await app.request("/api/v1/run/attempt/snapshot?reason=interval", {
      method: "POST",
      headers: { cookie, "content-type": "image/jpeg" },
      body: jpegFixture,
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as Record<string, unknown>;
    expect(body1.message).toBe("Ensure face is visible");
    expect(body1.messageAt).toBe(messageAt);

    // Subsequent snapshot call has no message
    const res2 = await app.request("/api/v1/run/attempt/snapshot?reason=interval", {
      method: "POST",
      headers: { cookie, "content-type": "image/jpeg" },
      body: jpegFixture,
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as Record<string, unknown>;
    expect(body2.message).toBeUndefined();
    expect(body2.messageAt).toBeUndefined();
  });

  it("replaces undelivered message rather than queueing a second", async () => {
    const { cookie, attemptId, questionId } = await startAttempt();
    await setProctorMessage(deps.db, workspaceId, attemptId, "First message", T + 100);
    await setProctorMessage(deps.db, workspaceId, attemptId, "Second updated message", T + 200);

    const res = await app.request("/api/v1/run/attempt/answer", {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ questionId, value: { kind: "option", option: "a" }, clientSeq: 1 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.message).toBe("Second updated message");
    expect(body.messageAt).toBe(T + 200);
  });
});
