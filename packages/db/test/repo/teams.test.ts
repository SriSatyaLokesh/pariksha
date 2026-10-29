import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteClient, closeClient, type DbClient } from "../../src/client.js";
import { migrate } from "../../src/migrate.js";
import { newId } from "../../src/ids.js";
import { createUser } from "../../src/repo/identity.js";
import * as repo from "../../src/repo/index.js";

let db: DbClient;
const WS_A = newId("wsp");
const WS_B = newId("wsp");
let userA: string;
let userB: string;

beforeAll(async () => {
  db = sqliteClient(":memory:");
  await migrate(db);

  await repo.createWorkspace(db, WS_A, { slug: "workspace-a", name: "Workspace A" });
  await repo.createWorkspace(db, WS_B, { slug: "workspace-b", name: "Workspace B" });

  userA = await createUser(db, { email: "alice@example.com", authProvider: "email", now: Date.now() });
  userB = await createUser(db, { email: "bob@example.com", authProvider: "email", now: Date.now() });
});

afterAll(() => closeClient(db));

describe("Teams repository", () => {
  describe("team CRUD", () => {
    it("creates a team with team_ prefix, lists teams and retrieves by ID", async () => {
      const team = await repo.createTeam(db, WS_A, {
        name: "Grading Committee",
        description: "Evaluates midterm exam submissions",
      });

      expect(team.id).toMatch(/^team_[0-9a-z]{12}$/);
      expect(team.workspaceId).toBe(WS_A);
      expect(team.name).toBe("Grading Committee");
      expect(team.description).toBe("Evaluates midterm exam submissions");
      expect(team.createdAt).toBeGreaterThan(0);

      const fetched = await repo.getTeam(db, WS_A, team.id);
      expect(fetched).toEqual(team);

      const list = await repo.listTeams(db, WS_A);
      expect(list).toContainEqual(team);
    });

    it("returns null when getting a nonexistent team", async () => {
      expect(await repo.getTeam(db, WS_A, "team_nonexistent12")).toBeNull();
    });

    it("updates team name and description", async () => {
      const team = await repo.createTeam(db, WS_A, {
        name: "Proctor Squad",
      });
      expect(team.description).toBeNull();

      const updated = await repo.updateTeam(db, WS_A, team.id, {
        name: "Exam Proctors",
        description: "Monitors active exams",
      });

      expect(updated).toMatchObject({
        id: team.id,
        name: "Exam Proctors",
        description: "Monitors active exams",
      });

      const updatedNameOnly = await repo.updateTeam(db, WS_A, team.id, {
        name: "Lead Proctors",
      });
      expect(updatedNameOnly?.name).toBe("Lead Proctors");
      expect(updatedNameOnly?.description).toBe("Monitors active exams");
    });

    it("deletes a team and cascades member & grant cleanup", async () => {
      const team = await repo.createTeam(db, WS_A, { name: "Temporary Team" });
      const tempTest = await repo.createTest(db, WS_A, { slug: "tst-temp", name: "Temp Test" });
      await repo.addTeamMember(db, WS_A, team.id, userA);
      await repo.grantTeamResource(db, WS_A, {
        teamId: team.id,
        resourceType: "test",
        resourceId: tempTest.id,
        role: "reviewer",
      });

      expect(await repo.listTeamMembers(db, WS_A, team.id)).toHaveLength(1);
      expect(await repo.listTeamGrants(db, WS_A, team.id)).toHaveLength(1);

      await repo.deleteTeam(db, WS_A, team.id);

      expect(await repo.getTeam(db, WS_A, team.id)).toBeNull();
      expect(await repo.listTeamMembers(db, WS_A, team.id)).toHaveLength(0);
      expect(await repo.listTeamGrants(db, WS_A, team.id)).toHaveLength(0);
    });
  });

  describe("team members", () => {
    it("adds, lists, and removes team members", async () => {
      const team = await repo.createTeam(db, WS_A, { name: "Science Faculty" });

      await repo.addTeamMember(db, WS_A, team.id, userA);
      await repo.addTeamMember(db, WS_A, team.id, userB);

      const members = await repo.listTeamMembers(db, WS_A, team.id);
      expect(members).toHaveLength(2);
      expect(members.map((m) => m.userId).sort()).toEqual([userA, userB].sort());
      expect(members.find((m) => m.userId === userA)?.email).toBe("alice@example.com");

      // Idempotent add
      await repo.addTeamMember(db, WS_A, team.id, userA);
      expect(await repo.listTeamMembers(db, WS_A, team.id)).toHaveLength(2);

      // List teams for user
      const userTeams = await repo.listUserTeams(db, WS_A, userA);
      expect(userTeams.map((t) => t.id)).toContain(team.id);

      // Remove member
      await repo.removeTeamMember(db, WS_A, team.id, userA);
      const remaining = await repo.listTeamMembers(db, WS_A, team.id);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].userId).toBe(userB);
    });

    it("throws when adding a member to nonexistent team", async () => {
      await expect(
        repo.addTeamMember(db, WS_A, "team_doesnotexist", userA),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe("team resource grants", () => {
    it("grants, updates, lists and revokes resource grants", async () => {
      const team = await repo.createTeam(db, WS_A, { name: "Physics Dept" });
      const physTest = await repo.createTest(db, WS_A, { slug: "phys-101", name: "Physics 101" });
      await repo.addTeamMember(db, WS_A, team.id, userA);

      const grant = await repo.grantTeamResource(db, WS_A, {
        teamId: team.id,
        resourceType: "test",
        resourceId: physTest.id,
        role: "author",
      });

      expect(grant.id).toMatch(/^tgr_[0-9a-z]{12}$/);
      expect(grant.workspaceId).toBe(WS_A);
      expect(grant.teamId).toBe(team.id);
      expect(grant.resourceType).toBe("test");
      expect(grant.resourceId).toBe(physTest.id);
      expect(grant.role).toBe("author");

      // Updating role for existing resource grant
      const updatedGrant = await repo.grantTeamResource(db, WS_A, {
        teamId: team.id,
        resourceType: "test",
        resourceId: physTest.id,
        role: "reviewer",
      });
      expect(updatedGrant.id).toBe(grant.id);
      expect(updatedGrant.role).toBe("reviewer");

      // List grants for team
      const teamGrants = await repo.listTeamGrants(db, WS_A, team.id);
      expect(teamGrants).toHaveLength(1);
      expect(teamGrants[0].role).toBe("reviewer");

      // List grants for resource
      const resourceGrants = await repo.listTeamGrantsForResource(
        db,
        WS_A,
        "test",
        physTest.id,
      );
      expect(resourceGrants).toHaveLength(1);
      expect(resourceGrants[0].teamName).toBe("Physics Dept");
      expect(resourceGrants[0].role).toBe("reviewer");

      // List user team grants for resource
      const userGrants = await repo.listUserTeamGrantsForResource(
        db,
        WS_A,
        userA,
        "test",
        physTest.id,
      );
      expect(userGrants).toHaveLength(1);
      expect(userGrants[0].teamId).toBe(team.id);
      expect(userGrants[0].role).toBe("reviewer");

      // User B has not joined Physics Dept, so has no grants
      const userBGrants = await repo.listUserTeamGrantsForResource(
        db,
        WS_A,
        userB,
        "test",
        physTest.id,
      );
      expect(userBGrants).toHaveLength(0);

      // Revoke grant
      await repo.revokeTeamResource(db, WS_A, grant.id);
      expect(await repo.listTeamGrants(db, WS_A, team.id)).toHaveLength(0);
      expect(
        await repo.listUserTeamGrantsForResource(db, WS_A, userA, "test", physTest.id),
      ).toHaveLength(0);
    });

    it("throws when granting resource to nonexistent team", async () => {
      await expect(
        repo.grantTeamResource(db, WS_A, {
          teamId: "team_doesnotexist",
          resourceType: "bank",
          resourceId: "bnk_123456789012",
          role: "author",
        }),
      ).rejects.toThrow(/not found/i);
    });

    it("throws when granting a resource belonging to a different workspace (#280)", async () => {
      const team = await repo.createTeam(db, WS_A, { name: "Audit Team" });
      const testInB = await repo.createTest(db, WS_B, { slug: "test-b-isolation", name: "Test B" });

      await expect(
        repo.grantTeamResource(db, WS_A, {
          teamId: team.id,
          resourceType: "test",
          resourceId: testInB.id,
          role: "reviewer",
        }),
      ).rejects.toThrow(/not found in workspace/i);
    });
  });

  describe("tenant isolation", () => {
    it("workspace A cannot see or modify workspace B teams", async () => {
      const teamInB = await repo.createTeam(db, WS_B, { name: "Team in B" });

      // getTeam returns null across workspaces
      expect(await repo.getTeam(db, WS_A, teamInB.id)).toBeNull();

      // listTeams does not leak
      const listA = await repo.listTeams(db, WS_A);
      expect(listA.find((t) => t.id === teamInB.id)).toBeUndefined();

      // updateTeam does not affect team in B
      await repo.updateTeam(db, WS_A, teamInB.id, { name: "Hacked Team" });
      const teamBAfter = await repo.getTeam(db, WS_B, teamInB.id);
      expect(teamBAfter?.name).toBe("Team in B");

      // deleteTeam in A cannot delete team in B
      await repo.deleteTeam(db, WS_A, teamInB.id);
      expect(await repo.getTeam(db, WS_B, teamInB.id)).not.toBeNull();
    });
  });

  describe("api_key.created_by and revokeApiKeysByCreator", () => {
    it("stores created_by and allows revoking keys by creator", async () => {
      const now = Date.now();
      const { apiKeyId: keyA } = await repo.createApiKey(db, WS_A, {
        name: "Alice Key",
        scopes: ["results.export"],
        now,
        createdBy: userA,
      });

      const { apiKeyId: keyB } = await repo.createApiKey(db, WS_A, {
        name: "Bob Key",
        scopes: ["results.export"],
        now,
        createdBy: userB,
      });

      const keys = await repo.listApiKeys(db, WS_A);
      expect(keys.find((k) => k.id === keyA)?.createdBy).toBe(userA);
      expect(keys.find((k) => k.id === keyB)?.createdBy).toBe(userB);

      // Revoke all keys created by userA
      const revokedCount = await repo.revokeApiKeysByCreator(db, WS_A, userA, now + 1000);
      expect(revokedCount).toBe(1);

      const keysAfter = await repo.listApiKeys(db, WS_A);
      expect(keysAfter.find((k) => k.id === keyA)?.revokedAt).toBe(now + 1000);
      expect(keysAfter.find((k) => k.id === keyB)?.revokedAt).toBeNull();
    });
  });
});
