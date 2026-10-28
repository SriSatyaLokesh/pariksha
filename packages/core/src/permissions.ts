// Authorization as pure data: no database, no request context, nothing to
// stub — so every cell of the matrix is testable, and the API and the web
// interface answer the same question the same way.

export const ROLES = ["owner", "admin", "author", "proctor", "reviewer", "viewer"] as const;

export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "members.manage",
  "workspace.settings",
  "tests.view",
  "tests.edit",
  "banks.view",
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

/** A role held on a specific resource (test or bank), elevating or narrowing workspace permissions. */
export interface ResourceGrant {
  resourceType: "test" | "bank";
  resourceId: string;
  role: Role;
}

// Transcribed cell for cell from the permission matrix in docs/PRD.md,
// "Roles and permissions" — one entry per Y, in the table's row order. The
// PRD is the specification; change the table there first, then this.
export const PERMISSIONS: Readonly<Record<Role, readonly Action[]>> = {
  owner: ACTIONS,
  admin: [
    "tests.view",
    "tests.edit",
    "banks.view",
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
  author: ["tests.view", "tests.edit", "banks.view", "banks.edit"],
  proctor: ["tests.view", "attempts.monitor", "candidates.read_personal", "attempts.read_evidence"],
  reviewer: [
    "tests.view",
    "banks.view",
    "candidates.read_personal",
    "attempts.read_evidence",
    "attempts.grade",
    "results.export",
  ],
  viewer: ["tests.view", "banks.view", "candidates.read_personal", "results.export"],
};

/**
 * Whether `role` may perform `action`, optionally on one test or resource — or,
 * given `actions` instead of `role`, whether `action` is one of them.
 *
 * A grant is a union with the workspace role, never a replacement: roles are
 * not a ladder (an Author cannot grade, a Reviewer cannot author), so there
 * is no "higher" role to swap in, and swapping would let a narrow grant take
 * away what the workspace membership already allows.
 *
 * `actions` is a second, independent kind of input: an explicit list rather
 * than a role, which is what an API key's scopes are (Phase 8d Task 2,
 * `K25`/`K26`) — fixed at the key's own creation, not a row this function
 * would otherwise read out of `PERMISSIONS`. Whole-branch review MAJOR-4:
 * before this overload existed, a key's scopes were checked by their own
 * inline `.includes()` in `authorize.ts`'s `requires()` — a second decision
 * path this function never saw, so a future rule added here (a tightened
 * action, a trimmed role) would apply to every session and silently not to
 * a single key. One function now decides both, which is the actual fix:
 * `role` and `actions` are mutually exclusive, and `testId`/`resource`/`grants`
 * apply only to the role path — a key has no role to narrow and no grant.
 */
export function can(
  input:
    | {
        role: Role;
        action: Action;
        testId?: string;
        grants?: readonly TestGrant[] | readonly ResourceGrant[];
        resource?: { type: "test" | "bank"; id: string };
        actions?: undefined;
      }
    | {
        actions: readonly Action[];
        action: Action;
        role?: undefined;
        testId?: undefined;
        grants?: undefined;
        resource?: undefined;
      },
): boolean {
  if (input.actions !== undefined) return input.actions.includes(input.action);

  const { role, action, testId, grants, resource } = input;
  if (PERMISSIONS[role].includes(action)) return true;
  if (grants === undefined) return false;

  const target = resource ?? (testId !== undefined ? { type: "test" as const, id: testId } : undefined);
  if (target === undefined) return false;

  return grants.some((grant) => {
    const matches =
      "resourceType" in grant
        ? grant.resourceType === target.type && grant.resourceId === target.id
        : target.type === "test" && grant.testId === target.id;
    return matches && PERMISSIONS[grant.role].includes(action);
  });
}
