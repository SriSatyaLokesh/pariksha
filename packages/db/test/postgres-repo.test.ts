import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgClient, closeClient, type DbClient } from "../src/client.js";
import { migrate } from "../src/migrate.js";
import { newId } from "../src/ids.js";
import { createUser, listUserWorkspaces } from "../src/repo/identity.js";
import * as repo from "../src/repo/index.js";

// Locally the Postgres repo suite skips rather than fails when TEST_POSTGRES_URL
// is unset, allowing developers to run `pnpm test` without a local Postgres daemon.
// In CI (GitHub Actions postgres:16 service) or with `pnpm test:pg`, it runs in full.
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const describePostgres = POSTGRES_URL ? describe : describe.skip;

describePostgres("PostgreSQL Repository & Dialect Suite", () => {
  let db: DbClient;
  const T = 1_700_000_000_000;

  beforeAll(async () => {
    db = pgClient(POSTGRES_URL!);
    // Apply migrations 0000 through 0016
    await migrate(db);
  });

  afterAll(async () => {
    if (db) {
      await closeClient(db);
    }
  });

  describe("workspace CRUD", () => {
    it("creates, retrieves, updates and lists workspaces", async () => {
      const wsId = newId("wsp");
      const user = await createUser(db, {
        email: `owner-${wsId}@example.com`,
        authProvider: "email",
        now: T,
      });

      await repo.createWorkspace(db, wsId, {
        slug: `pg-ws-${wsId.slice(4)}`,
        name: "Postgres Workspace",
        branding: { primary_color: "#4f46e5" },
        settings: { allow_signup: true },
        now: T,
      });

      await repo.addMembership(db, wsId, {
        userId: user,
        role: "owner",
        now: T,
      });

      const ws = await repo.getWorkspace(db, wsId);
      expect(ws).not.toBeNull();
      expect(ws?.id).toBe(wsId);
      expect(ws?.name).toBe("Postgres Workspace");
      expect(ws?.branding).toEqual({ primary_color: "#4f46e5" });
      expect(ws?.settings).toEqual({ allow_signup: true });

      // Update workspace
      await repo.updateWorkspace(db, wsId, {
        name: "Renamed Postgres Workspace",
      });
      const updated = await repo.getWorkspace(db, wsId);
      expect(updated?.name).toBe("Renamed Postgres Workspace");

      // Verify workspace listing via user membership
      const userWorkspaces = await listUserWorkspaces(db, user);
      expect(userWorkspaces.map((w) => w.id)).toContain(wsId);

      // Verify direct workspace table query
      const rows = await db.query<{ id: string; name: string }>(
        "SELECT id, name FROM workspace WHERE id = ?",
        [wsId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Renamed Postgres Workspace");
    });
  });

  describe("test creation and retrieval", () => {
    it("creates test with draft version, publishes, and retrieves", async () => {
      const wsId = newId("wsp");
      await repo.createWorkspace(db, wsId, { slug: `tst-ws-${wsId.slice(4)}`, name: "Test WS", now: T });

      const test = await repo.createTest(db, wsId, {
        slug: "pg-exam",
        name: "PostgreSQL Comprehensive Exam",
        now: T,
        body: {
          settings: { time_limit_mins: 60 },
          sections: [],
        },
      });

      expect(test.id).toMatch(/^tst_/);
      expect(test.slug).toBe("pg-exam");
      expect(test.name).toBe("PostgreSQL Comprehensive Exam");

      const fetched = await repo.getTest(db, wsId, test.id);
      expect(fetched).not.toBeNull();
      expect(fetched?.id).toBe(test.id);

      const tests = await repo.listTests(db, wsId);
      expect(tests.map((t) => t.id)).toContain(test.id);

      // Publish draft version
      const published = await repo.publishDraftVersion(db, wsId, test.id, T + 1000);
      expect(published.version).toBe(1);

      const updatedTest = await repo.getTest(db, wsId, test.id);
      expect(updatedTest?.status).toBe("published");
      expect(updatedTest?.currentVersion).toBe(1);
    });
  });

  describe("candidates & attempts", () => {
    it("creates candidate and attempt with layout_json roundtrip", async () => {
      const wsId = newId("wsp");
      await repo.createWorkspace(db, wsId, { slug: `att-ws-${wsId.slice(4)}`, name: "Attempt WS", now: T });

      const test = await repo.createTest(db, wsId, {
        slug: "attempt-test",
        name: "Attempt Test",
        now: T,
      });

      const draft = await repo.getDraftVersion(db, wsId, test.id);
      expect(draft).not.toBeNull();

      const candidateId = await repo.createCandidate(db, wsId, {
        testId: test.id,
        formValues: { full_name: "Ada Lovelace", email: "ada@example.com" },
        consentVersion: "1.0",
        now: T,
      });
      expect(candidateId).toMatch(/^cnd_/);

      const attemptId = newId("att");
      const layout = {
        questionOrder: ["q1", "q2", "q3"],
        optionsOrder: { q1: [2, 0, 1] },
      };

      await repo.createAttempt(db, wsId, {
        id: attemptId,
        candidateId,
        testVersionId: draft!.id,
        setNo: 1,
        layout,
        startedAt: T,
        deadlineAt: T + 3600_000,
        tokenHash: "hash_abc_123",
      });

      const attempt = await repo.getAttempt(db, wsId, attemptId);
      expect(attempt).not.toBeNull();
      expect(attempt?.id).toBe(attemptId);
      expect(attempt?.candidateId).toBe(candidateId);
      expect(attempt?.layout).toEqual(layout);

      const candidate = await repo.getCandidateById(db, wsId, test.id, candidateId);
      expect(candidate).not.toBeNull();
      expect(candidate?.formValues).toEqual({
        full_name: "Ada Lovelace",
        email: "ada@example.com",
      });
    });
  });

  describe("webhooks & pause sentinel", () => {
    it("queues webhook delivery, retires to PAUSED_SENTINEL on pause, and restores on resume", async () => {
      const wsId = newId("wsp");
      await repo.createWorkspace(db, wsId, { slug: `wh-ws-${wsId.slice(4)}`, name: "WH WS", now: T });

      const { webhookId } = await repo.createWebhook(db, wsId, {
        url: "https://example.com/hooks/pg",
        events: ["attempt.submitted"],
        now: T,
      });

      await repo.queueWebhookDeliveries(db, wsId, [
        {
          webhookId,
          event: "attempt.submitted",
          payload: { candidate: "Ada", score: 100 },
          attemptCount: 0,
          lastStatus: null,
          lastError: null,
          now: T,
        },
      ]);

      // Verify pending delivery exists with next_attempt_at <= T
      const pendingBefore = await db.query<{ id: string; next_attempt_at: number | string }>(
        "SELECT id, next_attempt_at FROM webhook_delivery WHERE workspace_id = ? AND webhook_id = ?",
        [wsId, webhookId],
      );
      expect(pendingBefore).toHaveLength(1);
      expect(Number(pendingBefore[0].next_attempt_at)).toBe(T);

      // Pause webhook: shifts pending deliveries to PAUSED_SENTINEL
      await repo.setWebhookActive(db, wsId, webhookId, false);

      const pausedRows = await db.query<{ id: string; next_attempt_at: number | string }>(
        "SELECT id, next_attempt_at FROM webhook_delivery WHERE workspace_id = ? AND webhook_id = ?",
        [wsId, webhookId],
      );
      expect(Number(pausedRows[0].next_attempt_at)).toBe(repo.PAUSED_SENTINEL);

      // Resume webhook: unpause restores next_attempt_at to given now
      const resumeTime = T + 50_000;
      await repo.setWebhookActive(db, wsId, webhookId, true, resumeTime);

      const resumedRows = await db.query<{ id: string; next_attempt_at: number | string }>(
        "SELECT id, next_attempt_at FROM webhook_delivery WHERE workspace_id = ? AND webhook_id = ?",
        [wsId, webhookId],
      );
      expect(Number(resumedRows[0].next_attempt_at)).toBe(resumeTime);
    });
  });

  describe("dialect-conditional SQL", () => {
    it("extracts retention snapshots_days via (settings_json #>> '{retention,snapshots_days}')::numeric", async () => {
      const wsId = newId("wsp");
      await repo.createWorkspace(db, wsId, { slug: `ret-ws-${wsId.slice(4)}`, name: "Retention WS", now: T });

      const testWithRetention = await repo.createTest(db, wsId, {
        slug: "retention-custom",
        name: "Custom Retention Test",
        now: T,
        body: {
          settings: { retention: { snapshots_days: 42 } },
          sections: [],
        },
      });

      const testDefault = await repo.createTest(db, wsId, {
        slug: "retention-default",
        name: "Default Retention Test",
        now: T,
        body: {
          settings: {},
          sections: [],
        },
      });

      const draftCustom = await repo.getDraftVersion(db, wsId, testWithRetention.id);
      const draftDefault = await repo.getDraftVersion(db, wsId, testDefault.id);

      // Custom extraction
      const customRows = await db.query<{ id: string; snapshots_days: string | number }>(
        `SELECT id, (settings_json #>> '{retention,snapshots_days}')::numeric AS snapshots_days ` +
        `FROM test_version WHERE workspace_id = ? AND id = ?`,
        [wsId, draftCustom!.id],
      );
      expect(Number(customRows[0]?.snapshots_days)).toBe(42);

      // COALESCE fallback when retention.snapshots_days is not set
      const defaultRows = await db.query<{ id: string; snapshots_days: string | number }>(
        `SELECT id, COALESCE((settings_json #>> '{retention,snapshots_days}')::numeric, 90) AS snapshots_days ` +
        `FROM test_version WHERE workspace_id = ? AND id = ?`,
        [wsId, draftDefault!.id],
      );
      expect(Number(defaultRows[0]?.snapshots_days)).toBe(90);
    });

    it("verifies candidate blanked check with form_values_json = '{}'::jsonb", async () => {
      const wsId = newId("wsp");
      await repo.createWorkspace(db, wsId, { slug: `blk-ws-${wsId.slice(4)}`, name: "Blank WS", now: T });

      const test = await repo.createTest(db, wsId, { slug: "blk-test", name: "Blank Test", now: T });

      const candidateA = await repo.createCandidate(db, wsId, {
        testId: test.id,
        formValues: { name: "Candidate To Blank", email: "blank@example.com" },
        consentVersion: "1.0",
        now: T,
      });

      const candidateB = await repo.createCandidate(db, wsId, {
        testId: test.id,
        formValues: { name: "Candidate Preserved", email: "active@example.com" },
        consentVersion: "1.0",
        now: T,
      });

      // Before blanking: neither candidate matches '{}'::jsonb
      const beforeQuery = await db.query<{ id: string }>(
        "SELECT id FROM candidate WHERE workspace_id = ? AND form_values_json = '{}'::jsonb AND external_id IS NULL",
        [wsId],
      );
      expect(beforeQuery.map((r) => r.id)).not.toContain(candidateA);
      expect(beforeQuery.map((r) => r.id)).not.toContain(candidateB);

      // Blank candidate A as GDPR/retention sweep does
      await db.run(
        "UPDATE candidate SET form_values_json = ?::jsonb, external_id = NULL WHERE workspace_id = ? AND id = ?",
        [db.jsonParam({}), wsId, candidateA],
      );

      // After blanking: only candidate A matches
      const afterQuery = await db.query<{ id: string }>(
        "SELECT id FROM candidate WHERE workspace_id = ? AND form_values_json = '{}'::jsonb AND external_id IS NULL",
        [wsId],
      );
      const matched = afterQuery.map((r) => r.id);
      expect(matched).toContain(candidateA);
      expect(matched).not.toContain(candidateB);
    });

    it("handles Teams & RBAC queries: createTeam, addTeamMember, and grantTeamResource", async () => {
      const wsId = newId("wsp");
      await repo.createWorkspace(db, wsId, { slug: `team-ws-${wsId.slice(4)}`, name: "Team WS", now: T });

      const user = await createUser(db, {
        email: `teammate-${wsId}@example.com`,
        authProvider: "email",
        now: T,
      });

      const test = await repo.createTest(db, wsId, { slug: "team-test", name: "Team Test", now: T });

      // createTeam
      const team = await repo.createTeam(db, wsId, {
        name: "Biology Faculty",
        description: "Reviewers and authors for biology curriculum",
      });
      expect(team.id).toMatch(/^team_/);
      expect(team.name).toBe("Biology Faculty");

      // addTeamMember
      await repo.addTeamMember(db, wsId, team.id, user);
      const members = await repo.listTeamMembers(db, wsId, team.id);
      expect(members.map((m) => m.userId)).toContain(user);

      // grantTeamResource
      const grant = await repo.grantTeamResource(db, wsId, {
        teamId: team.id,
        resourceType: "test",
        resourceId: test.id,
        role: "reviewer",
      });
      expect(grant.id).toMatch(/^tgr_/);
      expect(grant.role).toBe("reviewer");

      const grants = await repo.listTeamGrants(db, wsId, team.id);
      expect(grants.map((g) => g.id)).toContain(grant.id);
    });
  });
});
