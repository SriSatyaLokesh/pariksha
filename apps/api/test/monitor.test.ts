import { afterAll, describe, expect, it } from "vitest";
import {
  addMembership,
  closeClient,
  createBank,
  createUser,
  newId,
  upsertQuestions,
} from "@pariksha/db";
import { createApp, ROUTE_ACTIONS, ROUTE_AUTH, ROUTE_BUDGETS } from "../src/app.js";
import { issueSession } from "../src/auth/session.js";
import { countingDeps } from "../src/instrument.js";
import { FIXED_NOW, sessionCookie, testDeps } from "./deps.js";
import { DAY, iso, seedTest, seedWorkspace } from "./run/fixtures.js";

const T = FIXED_NOW;
const KEY_SENTINEL = "__SECRET_KEY_SENTINEL__";

const { deps } = await testDeps({ now: () => T });
const app = createApp(deps);
afterAll(() => closeClient(deps.db));

async function cookieFor(
  ws: string,
  role: "owner" | "admin" | "author" | "proctor" | "viewer",
  email: string,
): Promise<string> {
  const userId = await createUser(deps.db, { email, authProvider: "magic_link", now: T });
  await addMembership(deps.db, ws, { userId, role, now: T });
  return sessionCookie(deps, (await issueSession(deps, userId)).token);
}

const workspaceId = await seedWorkspace(deps, "alpha-mon", "Alpha Monitor");
const proctorCookie = await cookieFor(workspaceId, "proctor", "proctor@alpha-mon.test");
const authorCookie = await cookieFor(workspaceId, "author", "author@alpha-mon.test");

// Seed bank with secret key sentinel for KG1 test
const bankId = await createBank(deps.db, workspaceId, { name: "Mon Bank", now: T });
await upsertQuestions(
  deps.db,
  workspaceId,
  bankId,
  [
    {
      id: "Q-001",
      type: "single",
      prompt: "Question 1?",
      options: [
        { id: "a", text: "Opt A" },
        { id: "b", text: "Opt B" },
      ],
      key: "a",
      scoring: { points: 1 },
      explanation: `Secret explanation ${KEY_SENTINEL}`,
    },
  ],
  T,
);

// Test 1: Strict proctoring (requires camera)
const testId300 = await seedTest(deps, workspaceId, {
  name: "Strict 300 Cohort",
  slug: "strict-300",
  body: {
    settings: {
      timing: { duration_minutes: 60, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      proctoring: { profile: "strict", overrides: { require_camera: true } },
    },
    sections: [{ id: "sec1", title: "Sec 1", source: { kind: "bank", bankId, count: 1 } }],
  },
});

// Test 2: Standard proctoring (camera not required)
const testIdStandard = await seedTest(deps, workspaceId, {
  name: "Standard Test",
  slug: "std-test",
  body: {
    settings: {
      timing: { duration_minutes: 60, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      proctoring: { profile: "standard", overrides: { require_camera: false } },
    },
    sections: [{ id: "sec1", title: "Sec 1", source: { kind: "bank", bankId, count: 1 } }],
  },
});

// Test 3: Small test (3 candidates) for KG3 comparison
const testId3 = await seedTest(deps, workspaceId, {
  name: "Small 3 Test",
  slug: "small-3",
  body: {
    settings: {
      timing: { duration_minutes: 60, opens_at: iso(T - DAY), closes_at: iso(T + DAY) },
      proctoring: { profile: "strict", overrides: { require_camera: true } },
    },
    sections: [{ id: "sec1", title: "Sec 1", source: { kind: "bank", bankId, count: 1 } }],
  },
});

// Helper to seed candidates and attempts
async function seedCohort(
  testId: string,
  count: number,
  config?: { quietAttemptIndex?: number },
): Promise<{ quietAttemptId: string | null; attemptIds: string[] }> {
  const versionRow = await deps.db.query<{ id: string }>(
    "SELECT id FROM test_version WHERE test_id = ? AND published_at IS NOT NULL",
    [testId],
  );
  const versionId = versionRow[0]!.id;
  let quietAttemptId: string | null = null;
  const attemptIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const candId = newId("cnd");
    const attId = newId("att");
    attemptIds.push(attId);

    const isQuiet = config?.quietAttemptIndex === i;
    if (isQuiet) {
      quietAttemptId = attId;
    }

    await deps.db.run(
      "INSERT INTO candidate (id, workspace_id, test_id, external_id, set_label, source, form_values_json, consent_version, consent_at, created_at) " +
        "VALUES (?, ?, ?, ?, NULL, 'registration', ?, '2026-10-01', ?, ?)",
      [
        candId,
        workspaceId,
        testId,
        `cand_${i}@alpha.test`,
        JSON.stringify({ name: `Candidate ${i}`, email: `cand_${i}@alpha.test` }),
        T,
        T,
      ],
    );

    // Distribution for count=300:
    // 80 submitted (manual)
    // 8 auto-submitted (limit or timeout)
    // 212 in progress (some answered, some started, some locked)
    let submittedAt: number | null = null;
    let submitReason: string | null = null;
    let lockedAt: number | null = null;
    let integrityFlag = "clean";
    let flag = "clean";

    if (count === 300) {
      if (i < 80) {
        submittedAt = T - 1000;
        submitReason = "manual";
      } else if (i < 88) {
        submittedAt = T - 500;
        submitReason = "timeout";
      } else if (i < 98) {
        // 10 locked
        lockedAt = T - 2000;
      }
      if (i >= 88 && i < 110) {
        integrityFlag = "review";
      }
      if (i === 120) {
        flag = "scoring_blocked";
      }
    } else {
      // Small cohort: 1 in progress, 2 submitted
      if (i > 0) {
        submittedAt = T - 1000;
        submitReason = "manual";
      }
    }

    const layoutJson = JSON.stringify({
      sections: [{ sectionId: "sec1", questionIds: ["q1"], optionOrder: {} }],
    });

    await deps.db.run(
      "INSERT INTO attempt (id, workspace_id, candidate_id, test_version_id, set_no, layout_json, started_at, " +
        "deadline_at, submitted_at, submit_reason, score_json, flag, token_hash, max_index, section_started_at, " +
        "integrity_flag, observed, locked_at) " +
        "VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL, ?, 1, ?)",
      [
        attId,
        workspaceId,
        candId,
        versionId,
        layoutJson,
        T - 100_000,
        T + 50_000,
        submittedAt,
        submitReason,
        flag,
        `token_hash_${attId}`,
        integrityFlag,
        lockedAt,
      ],
    );

    // Add contact signals if not quiet
    if (!isQuiet) {
      // Recent contact: response at T - 30_000
      await deps.db.run(
        "INSERT INTO response (id, workspace_id, attempt_id, question_id, value_json, saved_at, client_seq, points, graded_by) " +
          "VALUES (?, ?, ?, 'q1', '\"a\"', ?, 1, 1, 'auto')",
        [newId("rsp"), workspaceId, attId, T - 30_000],
      );

      // Event
      await deps.db.run(
        "INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) " +
          "VALUES (?, ?, ?, 'window_blur', NULL, ?, ?)",
        [newId("evt"), workspaceId, attId, T - 40_000, T - 40_000],
      );

      // Camera event
      if (i % 2 === 0) {
        await deps.db.run(
          "INSERT INTO event (id, workspace_id, attempt_id, type, detail_json, client_ts, server_ts) " +
            "VALUES (?, ?, ?, 'camera_lost', NULL, ?, ?)",
          [newId("evt"), workspaceId, attId, T - 35_000, T - 35_000],
        );
      }
    }
  }

  return { quietAttemptId, attemptIds };
}

// Seed the cohorts
const { quietAttemptId: quietAttempt } = await seedCohort(testId300, 300, { quietAttemptIndex: 299 });
await seedCohort(testIdStandard, 3);
await seedCohort(testId3, 3);

const monitorUrl = `/api/v1/workspaces/${workspaceId}/tests/${testId300}/monitor`;
const monitorUrlStandard = `/api/v1/workspaces/${workspaceId}/tests/${testIdStandard}/monitor`;

describe("GET /api/v1/workspaces/:id/tests/:testId/monitor", () => {
  it("declares route in registries", () => {
    expect(ROUTE_AUTH["GET /api/v1/workspaces/:id/tests/:testId/monitor"]).toBe("workspace");
    expect(ROUTE_ACTIONS["GET /api/v1/workspaces/:id/tests/:testId/monitor"]).toBe("attempts.monitor");
    expect(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/monitor"]).toBeDefined();
  });

  it("returns the five counts and one row per attempt", async () => {
    const res = await app.request(monitorUrl, { headers: { cookie: proctorCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.counts).toMatchObject({ registered: 300, inProgress: 212, submitted: 80, autoSubmitted: 8 });
    expect(body.rows).toHaveLength(300);
  });

  it("reports last contact as null for an attempt that has never contacted the server", async () => {
    const res = await app.request(monitorUrl, { headers: { cookie: proctorCookie } });
    const body = await res.json();
    const quietRow = body.rows.find((r: { attemptId: string }) => r.attemptId === quietAttempt);
    expect(quietRow).toBeDefined();
    expect(quietRow.lastContactAt).toBeNull();
  });

  it("costs the same number of statements for 300 candidates as for 3", async () => {
    const three = countingDeps(deps);
    const res3 = await createApp(three.deps).request(`/api/v1/workspaces/${workspaceId}/tests/${testId3}/monitor`, {
      headers: { cookie: proctorCookie },
    });
    expect(res3.status).toBe(200);

    const many = countingDeps(deps);
    const res300 = await createApp(many.deps).request(monitorUrl, {
      headers: { cookie: proctorCookie },
    });
    expect(res300.status).toBe(200);

    expect(many.counts().db).toBe(three.counts().db);
  });

  it("reports camera status as not required when the profile does not require one", async () => {
    const res = await app.request(monitorUrlStandard, { headers: { cookie: proctorCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows[0].camera).toBe("not_required");
  });

  it("filters to flagged only", async () => {
    const res = await app.request(`${monitorUrl}?flagged=1`, { headers: { cookie: proctorCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows.every((r: { integrityFlag: string }) => r.integrityFlag !== "clean")).toBe(true);
  });

  it("filters to inactive beyond two minutes", async () => {
    const res = await app.request(`${monitorUrl}?inactive=1`, { headers: { cookie: proctorCookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.map((r: { attemptId: string }) => r.attemptId)).toEqual([quietAttempt]);
  });

  it("refuses an Author, who holds tests.edit and not attempts.monitor", async () => {
    const res = await app.request(monitorUrl, { headers: { cookie: authorCookie } });
    expect(res.status).toBe(403);
  });

  it("admits a Proctor — control for the test above", async () => {
    const res = await app.request(monitorUrl, { headers: { cookie: proctorCookie } });
    expect(res.status).toBe(200);
  });

  it("carries no answer key — KG1", async () => {
    const res = await app.request(monitorUrl, { headers: { cookie: proctorCookie } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY_SENTINEL);
  });

  it("measures the real subrequest cost of the monitor route", async () => {
    const counting = countingDeps(deps);
    const res = await createApp(counting.deps).request(monitorUrl, {
      headers: { cookie: proctorCookie },
    });
    expect(res.status).toBe(200);
    expect(counting.counts().total).toBe(ROUTE_BUDGETS["/api/v1/workspaces/:id/tests/:testId/monitor"]);
  });
});
