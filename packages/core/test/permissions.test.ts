import { describe, it, expect } from "vitest";
import { ACTIONS, PERMISSIONS, ROLES, can } from "../src/permissions.js";

describe("the permission matrix", () => {
  it("AC-23: the matrix matches the PRD table cell for cell", () => {
    expect(PERMISSIONS.owner).toEqual(ACTIONS);
    expect(PERMISSIONS.admin).toEqual([
      "tests.edit",
      "banks.edit",
      "tests.publish",
      "candidates.manage",
      "attempts.monitor",
      "candidates.read_personal",
      "attempts.read_evidence",
      "attempts.grade",
      "results.export",
      "keys.manage",
    ]);
    expect(PERMISSIONS.author).toEqual(["tests.edit", "banks.edit"]);
    expect(PERMISSIONS.proctor).toEqual([
      "attempts.monitor",
      "candidates.read_personal",
      "attempts.read_evidence",
    ]);
    expect(PERMISSIONS.reviewer).toEqual([
      "candidates.read_personal",
      "attempts.read_evidence",
      "attempts.grade",
      "results.export",
    ]);
    expect(PERMISSIONS.viewer).toEqual(["candidates.read_personal", "results.export"]);
    expect(PERMISSIONS.admin).not.toContain("members.manage");
    expect(PERMISSIONS.admin).not.toContain("candidates.delete");
  });

  it("every row lists its actions in the PRD's row order", () => {
    for (const role of ROLES) {
      const indexes = PERMISSIONS[role].map((action) => ACTIONS.indexOf(action));
      expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
      expect(indexes).not.toContain(-1);
    }
  });

  it("only the owner can delete candidate data or manage members", () => {
    for (const role of ROLES.filter((r) => r !== "owner")) {
      expect(can({ role, action: "candidates.delete" })).toBe(false);
      expect(can({ role, action: "members.manage" })).toBe(false);
    }
    expect(can({ role: "owner", action: "candidates.delete" })).toBe(true);
    expect(can({ role: "owner", action: "members.manage" })).toBe(true);
  });

  it("a per-test grant raises the role for that test only", () => {
    const grants = [{ testId: "tst_a", role: "reviewer" as const }];
    expect(can({ role: "viewer", action: "attempts.grade", testId: "tst_a", grants })).toBe(true);
    expect(can({ role: "viewer", action: "attempts.grade", testId: "tst_b", grants })).toBe(false);
  });

  it("a per-test grant never lowers the workspace role", () => {
    expect(
      can({
        role: "admin",
        action: "tests.publish",
        testId: "tst_a",
        grants: [{ testId: "tst_a", role: "viewer" }],
      }),
    ).toBe(true);
  });

  it("a grant is ignored when the check names no test", () => {
    const grants = [{ testId: "tst_a", role: "reviewer" as const }];
    expect(can({ role: "viewer", action: "attempts.grade", grants })).toBe(false);
  });

  it("every role and action pair resolves without throwing", () => {
    for (const role of ROLES) for (const action of ACTIONS) expect(typeof can({ role, action })).toBe("boolean");
  });

  // A pin, not a red test: ADR 0007 decided the fourteenth action, `tests.comment`,
  // is added by the task that builds commenting (Phase 5), not by this ADR. These
  // two assertions already pass on the day they are written; they exist so the
  // addition of `tests.comment` is a deliberate, reviewed edit to this test rather
  // than a silent drift.
  it("no permission action is about comments yet (ADR 0007)", () => {
    expect(ACTIONS).toHaveLength(13);
    expect(ACTIONS.filter((a) => a.includes("comment"))).toEqual([]);
  });

  it("ADR 0007: a Reviewer holds no tests.edit, which is why commenting needs its own action", () => {
    expect(can({ role: "reviewer", action: "tests.edit" })).toBe(false);
  });
});
