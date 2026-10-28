# Teams, RBAC & Credential Lifecycle Specification

| | |
| --- | --- |
| **Status** | Approved |
| **Last updated** | 2026-10-28 |
| **Implements** | PRD v0.2 Teams & Security, Issues #175, #176, #177, #234 |
| **Approach** | Approach A (Lightweight Teams with Resource Grants & Core RBAC Unlocking) |

---

## 1. Context & Motivation

Pariksha’s authorization system was designed as a pure data structure in `@pariksha/core` (`permissions.ts`), evaluated by the Hono middleware `requires(action)` in `apps/api`. While the foundation is solid, four key gaps prevent multi-user collaborative operations across universities and testing departments:

1. **Read Lockout (#175):** All test and bank read routes are guarded by their edit actions (`tests.edit`, `banks.edit`). Consequently, `reviewer` and `viewer` roles receive a `403 Forbidden` on the very tests and banks they are tasked with reviewing.
2. **Dormant Per-Test Grants (#176, #177):** `S-08` promises optional per-test grants. The database column `test_grants_json` and the `can()` union logic exist, but no route in `apps/api` accepts or writes `testGrants`.
3. **Lack of Named Teams:** In academic institutions, permissions are managed by departments or squads (e.g. "Physics Faculty", "Midterm Reviewers"). Without teams, organizers must manually configure individual grants for dozens of colleagues on every test.
4. **API Key Creator Demotion (#234):** API keys have no `created_by` foreign key. When an admin or organizer is removed or demoted, their issued keys continue operating indefinitely with full elevated scopes.

---

## 2. Invariants & Constraints

1. **The 50-Subrequest Budget (Cloudflare Workers):** `readSessionActor` authenticates every request in exactly **one joined SQL statement** (`session JOIN "user" LEFT JOIN membership`). We must not execute N+1 database queries on every authenticated request.
2. **Multi-Dialect Parity:** All schema changes must be provided as paired migrations for both SQLite/D1 and PostgreSQL 16.
3. **Pure Policy Engine:** `can()` in `packages/core/src/permissions.ts` must remain pure data and I/O-free.
4. **Union Grants, Not Overrides:** A grant (personal or team-based) is an elevation, never a restriction. A user with workspace `admin` never loses admin powers on a specific exam because of a narrow grant.
5. **Zero External Identity SaaS:** No external scripts or auth vendors. All team and role state is self-hosted within the tenant workspace.

---

## 3. Data Model & Schema (Migration `0016`)

### 3.1 Tables

```sql
-- SQLite & PostgreSQL Migration: 0016_teams_and_rbac

-- 1. Organiser Teams
CREATE TABLE IF NOT EXISTS team (
  id TEXT PRIMARY KEY,                       -- 'team_...' (ksuid/nanoid)
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                        -- 1-64 characters
  description TEXT,                          -- optional, up to 256 characters
  created_at INTEGER NOT NULL                -- timestamp ms
);
CREATE INDEX IF NOT EXISTS team_workspace_idx ON team(workspace_id);

-- 2. Team Memberships
CREATE TABLE IF NOT EXISTS team_member (
  team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_member_user_idx ON team_member(user_id);

-- 3. Team Resource Grants (elevated roles on specific tests or banks)
CREATE TABLE IF NOT EXISTS team_grant (
  id TEXT PRIMARY KEY,                       -- 'tgr_...'
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,               -- 'test' | 'bank'
  resource_id TEXT NOT NULL,                 -- testId ('tst_...') or bankId ('bnk_...')
  role TEXT NOT NULL,                        -- 'author' | 'reviewer' | 'proctor'
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS team_grant_resource_uq ON team_grant(team_id, resource_type, resource_id);
CREATE INDEX IF NOT EXISTS team_grant_workspace_resource_idx ON team_grant(workspace_id, resource_type, resource_id);

-- 4. Add created_by to api_key
ALTER TABLE api_key ADD COLUMN created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL;
```

---

## 4. Policy & Core RBAC (`@pariksha/core`)

### 4.1 Permission Matrix Update

Add `tests.view` and `banks.view` to `ACTIONS`:

```ts
export const ACTIONS = [
  "members.manage",
  "workspace.settings",
  "tests.view",       // NEW: Read tests, sections, and metadata
  "tests.edit",
  "banks.view",       // NEW: Read banks and questions
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
```

Matrix mapping:
- `owner`: all actions.
- `admin`: includes `"tests.view"`, `"banks.view"`.
- `author`: includes `"tests.view"`, `"banks.view"`.
- `proctor`: includes `"tests.view"`.
- `reviewer`: includes `"tests.view"`, `"banks.view"`, `"attempts.read_evidence"`, `"attempts.grade"`, `"results.export"`.
- `viewer`: includes `"tests.view"`, `"banks.view"`, `"results.export"`.

### 4.2 Resource Grants Union in `can()`

```ts
export interface ResourceGrant {
  resourceType: "test" | "bank";
  resourceId: string;
  role: Role;
}

export function can(input: {
  role: Role;
  action: Action;
  resource?: { type: "test" | "bank"; id: string };
  grants?: readonly ResourceGrant[];
}): boolean {
  if (PERMISSIONS[input.role].includes(input.action)) return true;
  if (!input.resource || !input.grants) return false;

  return input.grants.some(
    (g) =>
      g.resourceType === input.resource!.type &&
      g.resourceId === input.resource!.id &&
      PERMISSIONS[g.role].includes(input.action)
  );
}
```

---

## 5. API Platform Updates (`apps/api`)

### 5.1 Route Guard Repointing
- `GET /workspaces/:id/tests` -> `requires("tests.view")`
- `GET /workspaces/:id/tests/:testId` -> `requires("tests.view")`
- `GET /workspaces/:id/tests/:testId/draft` -> `requires("tests.view")`
- `GET /workspaces/:id/banks` -> `requires("banks.view")`
- `GET /workspaces/:id/banks/:bankId` -> `requires("banks.view")`
- `GET /workspaces/:id/banks/:bankId/questions` -> `requires("banks.view")`

### 5.2 Writable Personal Grants
- `POST /workspaces/:id/members` schema accepts `testGrants?: Record<string, Role>`.
- `PATCH /workspaces/:id/members/:userId` accepts `role?: Role` and `testGrants?: Record<string, Role>`.

### 5.3 Teams & Team Grants Routes (`/routes/teams.ts`)
- `GET /workspaces/:id/teams` (`requireMember`)
- `POST /workspaces/:id/teams` (`requires("members.manage")`)
- `GET /workspaces/:id/teams/:teamId` (`requireMember`)
- `PATCH /workspaces/:id/teams/:teamId` (`requires("members.manage")`)
- `DELETE /workspaces/:id/teams/:teamId` (`requires("members.manage")`)
- `POST /workspaces/:id/teams/:teamId/members` (`requires("members.manage")`)
- `DELETE /workspaces/:id/teams/:teamId/members/:userId` (`requires("members.manage")`)
- `GET /workspaces/:id/teams/:teamId/grants` (`requireMember`)
- `POST /workspaces/:id/teams/:teamId/grants` (`requires("members.manage")`)
- `DELETE /workspaces/:id/teams/:teamId/grants/:grantId` (`requires("members.manage")`)

### 5.4 API Key Demotion Safety
- Store `actor.userId` in `created_by` on API key creation.
- On `DELETE /workspaces/:id/members/:userId` or role demotion to `viewer`/`reviewer`:
  - Automatically revoke or deactivate all keys where `created_by == userId AND workspace_id == id`.
  - Log audit event `api_key.demotion_revoked`.

---

## 6. Web UI Experience (`apps/web`)

1. **Workspace Teams View:** Added under `/org/settings/teams` with team lists, member badges, and grant summaries.
2. **Resource Collaborator Drawer:** Available on Test Builder (`/org/tests/:id`) and Bank Browser (`/org/banks/:id`) allowing organizers to attach Teams or individual users with explicit roles.
3. **Members & Roles Management:** `/org/settings/members` updated with interactive test grants editing and assigned team indicators.
