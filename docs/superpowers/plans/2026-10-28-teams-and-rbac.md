# Teams, RBAC & Credential Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock Reviewer and Viewer roles with granular read permissions, activate per-test access grants (`S-08`), introduce lightweight persistent Organiser Teams, and automate API key revocation on member demotion.

**Architecture:** Extend `@pariksha/core` permissions with `tests.view` and `banks.view`, repointing API read guards without third-party auth vendors. Apply paired migration `0016` (SQLite and PostgreSQL) introducing `team`, `team_member`, and `team_grant` tables alongside `api_key.created_by`. Expose Teams CRUD and test/bank collaborator management in `apps/api` and `apps/web` while preserving the single-query session authentication invariant.

**Tech Stack:** TypeScript, Hono, Drizzle ORM (SQLite / PostgreSQL), React, Tailwind CSS / Signal tokens, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-28-teams-and-rbac-design.md`](../specs/2026-10-28-teams-and-rbac-design.md)

---

## Global Constraints

- **Edge Subrequest Ceiling:** Every authenticated request must continue resolving user, session, and workspace membership in a single query (`readSessionActor`). No per-request N+1 queries.
- **Dialect Parity:** Migrations and Drizzle schemas must be byte-tested and functionally identical on both SQLite/D1 and PostgreSQL 16.
- **Zero External SaaS:** Strict Content-Security-Policy with zero third-party auth script or vendor origin exceptions.
- **Pure Union Grants:** Grants on tests or banks only ever elevate permissions and never override or restrict broader workspace roles.
- **Commit Author:** All commits must use `--author="Satya K <srisatyalokesh2.12@gmail.com>"`.

---

## Review Focus

1. **Reviewer Read Access:** A user with role `reviewer` must successfully fetch `GET /workspaces/:id/tests/:testId` and `GET .../draft` without 403 Forbidden.
2. **Viewer Bank Inspection:** A user with role `viewer` must successfully read question banks via `GET /workspaces/:id/banks` while write operations (`POST`, `PATCH`) return 403.
3. **Per-Test Elevation (`S-08`):** A workspace `viewer` with a per-test grant `{ role: "author" }` on `tst_math` can edit `tst_math`, but receives 403 on `tst_physics`.
4. **Team Grant Inheritance:** A user in team "Graders" (granted `reviewer` on `tst_final`) can review `tst_final` even if their workspace role is `viewer`.
5. **API Key Demotion Revocation:** Demoting an `admin` to `viewer` or deleting the member immediately revokes all API keys they minted, preventing unauthorized programmatic access.

---

## Task Decomposition

### Task 1: Core RBAC Read Actions & Pure Matrix Test Suite (`@pariksha/core`)

**Files:**
- Modify: `packages/core/src/permissions.ts:9-60`
- Test: `packages/core/test/permissions.test.ts`

**Interfaces:**
- Consumes: Existing `ROLES`, `PERMISSIONS`, and `can()` in `@pariksha/core`.
- Produces: Updated `ACTIONS` array containing `"tests.view"` and `"banks.view"`, expanded `PERMISSIONS` matrix, and enhanced `can()` evaluator supporting resource grants.

- [ ] **Step 1: Write the failing test**

In `packages/core/test/permissions.test.ts`, add test cases asserting:
```ts
it("allows reviewer and viewer to perform tests.view and banks.view", () => {
  expect(can({ role: "reviewer", action: "tests.view" })).toBe(true);
  expect(can({ role: "reviewer", action: "banks.view" })).toBe(true);
  expect(can({ role: "viewer", action: "tests.view" })).toBe(true);
  expect(can({ role: "viewer", action: "banks.view" })).toBe(true);
  expect(can({ role: "viewer", action: "tests.edit" })).toBe(false);
});

it("evaluates resource grants for tests and banks as pure union", () => {
  const grants = [{ resourceType: "test" as const, resourceId: "tst_123", role: "author" as const }];
  expect(can({ role: "viewer", action: "tests.edit", resource: { type: "test", id: "tst_123" }, grants })).toBe(true);
  expect(can({ role: "viewer", action: "tests.edit", resource: { type: "test", id: "tst_999" }, grants })).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/core test`
Expected: FAIL with missing action or property in `can()`

- [ ] **Step 3: Update `packages/core/src/permissions.ts`**

1. Add `"tests.view"` and `"banks.view"` to `ACTIONS`.
2. Update `PERMISSIONS`:
   - `admin`, `author`, `reviewer`, `viewer`: include `"tests.view"` and `"banks.view"`.
   - `proctor`: include `"tests.view"`.
3. Update `can()` signature and implementation to support `{ type: "test" | "bank", id: string }` and `ResourceGrant[]` (while maintaining backward compatibility with `testId` and `TestGrant[]`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/core test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/permissions.ts packages/core/test/permissions.test.ts
git commit -m "feat(core): add tests.view and banks.view actions and resource grant union" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 2: API Route Guard Repointing & Writable Per-Test Grants (`apps/api`)

**Files:**
- Modify: `apps/api/src/app.ts:310-360`
- Modify: `apps/api/src/routes/workspaces.ts:95-150`
- Modify: `apps/api/src/middleware/authorize.ts:110-130`
- Test: `apps/api/test/routes/rbac-view-routes.test.ts`

**Interfaces:**
- Consumes: `tests.view`, `banks.view` from Task 1, `addMembership`, `updateMembership` in `packages/db`.
- Produces: Repointed read endpoints, writable `testGrants` in `POST/PATCH /workspaces/:id/members`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/routes/rbac-view-routes.test.ts`:
1. Authenticate as a `reviewer` in workspace `ws_1`.
2. Request `GET /api/v1/workspaces/ws_1/tests/tst_1`. Assert status is 200 (not 403).
3. Request `GET /api/v1/workspaces/ws_1/banks/bnk_1`. Assert status is 200.
4. As `owner`, `POST /api/v1/workspaces/ws_1/members` with `{ email: "grader@test.com", role: "viewer", testGrants: { "tst_1": "author" } }`. Verify `test_grants_json` is stored.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api test rbac-view-routes`
Expected: FAIL with 403 Forbidden on test/bank reads.

- [ ] **Step 3: Implement route changes and grant writing**

1. In `apps/api/src/app.ts`, change:
   - `GET /workspaces/:id/tests` -> `requires("tests.view")`
   - `GET /workspaces/:id/tests/:testId` -> `requires("tests.view")`
   - `GET /workspaces/:id/tests/:testId/draft` -> `requires("tests.view")`
   - `GET /workspaces/:id/banks` -> `requires("banks.view")`
   - `GET /workspaces/:id/banks/:bankId` -> `requires("banks.view")`
   - `GET /workspaces/:id/banks/:bankId/questions` -> `requires("banks.view")`
2. In `apps/api/src/routes/workspaces.ts`, extend `memberInput` and `updateMemberInput` schemas to accept `testGrants: z.record(z.enum(ROLES)).optional()`. Pass `testGrants` to repository.
3. In `apps/api/src/middleware/authorize.ts`, verify `requires(action)` extracts `testId` or `bankId` and supplies it to `can()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api test rbac-view-routes`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/routes/workspaces.ts apps/api/src/middleware/authorize.ts apps/api/test/routes/rbac-view-routes.test.ts
git commit -m "feat(api): repoint read routes to view actions and allow writing test grants" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 3: Database Migration `0016_teams_and_rbac` & Teams Repository (`packages/db`)

**Files:**
- Create: `packages/db/src/migrations/0016_teams_and_rbac.sql`
- Create: `packages/db/src/migrations/pg/0016_teams_and_rbac.sql`
- Modify: `packages/db/src/schema/sqlite.ts`
- Modify: `packages/db/src/schema/pg.ts`
- Create: `packages/db/src/repo/teams.ts`
- Test: `packages/db/test/teams-repo.test.ts`

**Interfaces:**
- Consumes: `DbClient`, `schema` from `packages/db`.
- Produces: `team`, `team_member`, `team_grant` table definitions, `created_by` on `api_key`, and repository functions: `createTeam`, `listTeams`, `getTeam`, `updateTeam`, `deleteTeam`, `addTeamMember`, `removeTeamMember`, `listTeamMembers`, `grantTeamResource`, `revokeTeamResource`, `listTeamGrantsForResource`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/teams-repo.test.ts` testing:
1. Migration `0016` applies cleanly on SQLite in-memory and PostgreSQL.
2. `createTeam` creates team with `team_` ID.
3. `addTeamMember` adds user; `listTeamMembers` returns members.
4. `grantTeamResource` inserts grant on test/bank; `listTeamGrantsForResource` finds matching teams.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/db test teams-repo`
Expected: FAIL with missing tables or repository functions.

- [ ] **Step 3: Implement migrations and repository**

1. Write `packages/db/src/migrations/0016_teams_and_rbac.sql` and `pg/0016_teams_and_rbac.sql` matching Spec Section 3.
2. Update `packages/db/src/schema/sqlite.ts` and `pg.ts` with Drizzle definitions.
3. Implement `packages/db/src/repo/teams.ts` with typed methods.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/db test`
Expected: PASS across all suites including migration parity test.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/ packages/db/src/schema/ packages/db/src/repo/teams.ts packages/db/test/teams-repo.test.ts
git commit -m "feat(db): add migration 0016 for teams, team grants, and api_key.created_by" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 4: Teams REST API & API Key Demotion Cascade (`apps/api`)

**Files:**
- Create: `apps/api/src/routes/teams.ts`
- Modify: `apps/api/src/app.ts` (mount teams router)
- Modify: `apps/api/src/routes/workspaces.ts` (attach `created_by` on key creation, demote cascade)
- Test: `apps/api/test/routes/teams.test.ts`
- Test: `apps/api/test/routes/api-key-demotion.test.ts`

**Interfaces:**
- Consumes: `packages/db/src/repo/teams.ts`, `packages/db/src/repo/apiKeys.ts`.
- Produces: REST endpoints for `/workspaces/:id/teams/*`, automated key revocation upon member demotion.

- [ ] **Step 1: Write the failing tests**

1. In `teams.test.ts`:
   - Admin creates a team "Physics Faculty".
   - Admin adds a user to the team.
   - Admin grants team `reviewer` on `tst_physics`.
   - Verify that team member now inherits `reviewer` access on `tst_physics`.
2. In `api-key-demotion.test.ts`:
   - Admin creates an API key with scopes `["tests.edit"]`. Key operates with 200.
   - Workspace owner demotes the admin to `viewer`.
   - Subsequent call with that API key returns 401/403 (revoked/inactive).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/api test teams api-key-demotion`
Expected: FAIL with 404 route not found.

- [ ] **Step 3: Implement Teams routes and key demotion cascade**

1. Create `apps/api/src/routes/teams.ts` with full CRUD for teams, members, and resource grants.
2. Mount in `apps/api/src/app.ts`.
3. In `apps/api/src/routes/workspaces.ts`:
   - On `POST .../api-keys`, save `created_by: actor.userId`.
   - On `PATCH .../members/:userId` (when role drops below author) and `DELETE .../members/:userId`:
     Query and revoke all keys with `created_by === userId && workspace_id === id`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/api test teams api-key-demotion`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/teams.ts apps/api/src/app.ts apps/api/src/routes/workspaces.ts apps/api/test/routes/teams.test.ts apps/api/test/routes/api-key-demotion.test.ts
git commit -m "feat(api): implement teams CRUD and auto-revoke API keys on member demotion" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 5: Organiser Teams UI & Collaborators Drawer (`apps/web`)

**Files:**
- Create: `apps/web/src/routes/org/teams.tsx`
- Create: `apps/web/src/components/org/TeamModal.tsx`
- Create: `apps/web/src/components/org/CollaboratorsDrawer.tsx`
- Modify: `apps/web/src/routes/org/test-builder.tsx` (add "Share / Collaborators" button)
- Modify: `apps/web/src/routes/org/bank-detail.tsx` (add "Share / Collaborators" button)
- Modify: `apps/web/src/routes/org/settings.tsx` (add Teams tab)
- Test: `apps/web/test/teams-ui.test.tsx`

**Interfaces:**
- Consumes: Teams API endpoints from Task 4.
- Produces: Interactive web screens for managing teams, assigning team grants to tests and banks, and viewing member roles.

- [ ] **Step 1: Write the failing UI test**

Create `apps/web/test/teams-ui.test.tsx`:
1. Render `TeamsView` with mocked teams list.
2. Assert team names, member counts, and "Create Team" button render with Signal tokens.
3. Open `CollaboratorsDrawer` on a test: assert assigned teams and individual grants are displayed with ability to add or remove grants.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pariksha/web test teams-ui`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement components and routing**

1. Create `TeamModal.tsx` allowing name/description input and member selection.
2. Create `teams.tsx` route with responsive tables adhering to `DESIGN.md` Signal palette.
3. Build `CollaboratorsDrawer.tsx` to mount in Test Builder and Bank Detail headers.
4. Wire API client calls to `GET/POST /workspaces/:id/teams` and `.../grants`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pariksha/web test teams-ui`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/org/teams.tsx apps/web/src/components/org/TeamModal.tsx apps/web/src/components/org/CollaboratorsDrawer.tsx apps/web/src/routes/org/test-builder.tsx apps/web/src/routes/org/bank-detail.tsx apps/web/test/teams-ui.test.tsx
git commit -m "feat(web): add teams settings page and test/bank collaborator management drawer" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```

---

### Task 6: Monorepo Verification, Documentation & Roadmap Sign-off

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/PRD.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: All deliverables from Tasks 1 through 5.
- Produces: 100% green monorepo CI verification, updated documentation, and closed GitHub issues.

- [ ] **Step 1: Run full monorepo build, lint, and test suite**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: All packages pass with 0 errors.

- [ ] **Step 2: Update documentation**

1. Update `docs/ROADMAP.md`: update v0.2 milestone status to record that Teams, RBAC read actions, and S-08 grants are fully implemented.
2. Update `CHANGELOG.md`: add an entry under `[Unreleased]` detailing the Teams & RBAC feature release.

- [ ] **Step 3: Commit and Push**

```bash
git add docs/ROADMAP.md docs/PRD.md CHANGELOG.md
git commit -m "docs: finalize roadmap and changelog for Teams and RBAC milestone" --author="Satya K <srisatyalokesh2.12@gmail.com>"
```
