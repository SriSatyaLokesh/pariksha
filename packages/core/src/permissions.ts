// Authorization as pure data: no database, no request context, nothing to
// stub — so every cell of the matrix is testable, and the API and the web
// interface answer the same question the same way.

export const ROLES = ["owner", "admin", "author", "proctor", "reviewer", "viewer"] as const;

export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "members.manage",
  "workspace.settings",
  "tests.edit",
  "banks.edit",
  "tests.publish",
  "candidates.manage",
  "attempts.monitor",
  "candidates.read_personal",
  "attempts.read_evidence",
  "attempts.grade",
  "results.export",
  "candidates.delete",
  "keys.manage",
] as const;

export type Action = (typeof ACTIONS)[number];

/** A role held on one test only, narrowing a workspace membership (`S-08`). */
export interface TestGrant {
  testId: string;
  role: Role;
}

// Transcribed cell for cell from the permission matrix in docs/PRD.md,
// "Roles and permissions" — one entry per Y, in the table's row order. The
// PRD is the specification; change the table there first, then this.
export const PERMISSIONS: Readonly<Record<Role, readonly Action[]>> = {
  owner: ACTIONS,
  admin: [
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
  ],
  author: ["tests.edit", "banks.edit"],
  proctor: ["attempts.monitor", "candidates.read_personal", "attempts.read_evidence"],
  reviewer: [
    "candidates.read_personal",
    "attempts.read_evidence",
    "attempts.grade",
    "results.export",
  ],
  viewer: ["candidates.read_personal", "results.export"],
};

/**
 * Whether `role` may perform `action`, optionally on one test.
 *
 * A grant is a union with the workspace role, never a replacement: roles are
 * not a ladder (an Author cannot grade, a Reviewer cannot author), so there
 * is no "higher" role to swap in, and swapping would let a narrow grant take
 * away what the workspace membership already allows.
 */
export function can(input: {
  role: Role;
  action: Action;
  testId?: string;
  grants?: readonly TestGrant[];
}): boolean {
  const { role, action, testId, grants } = input;
  if (PERMISSIONS[role].includes(action)) return true;
  if (testId === undefined || grants === undefined) return false;
  return grants.some((grant) => grant.testId === testId && PERMISSIONS[grant.role].includes(action));
}
