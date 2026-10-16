# Phase 3 — Organiser Auth, Roles, First Run and Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the deployed API from Phase 2 into something a person can sign into and own. OIDC and email magic-link sign-in, server-side sessions, workspaces and memberships, the PRD's permission matrix enforced on every request, the append-only audit log, the first-run wizard that creates the instance owner, and `apps/web` — the React application carrying the landing page, sign-in, the wizard and an empty workspace dashboard, built from design tokens generated out of `DESIGN.md`.

**Architecture:** The permission matrix lives in `packages/core` as pure data with a pure `can()` function, so it is exhaustively testable without a database and identical on both deployment targets. Authentication is an adapter seam like the other two: `IdentityProvider` has an OIDC implementation and a magic-link implementation, and Phase 11 adds a password one for Docker. Sessions are opaque random tokens in an HttpOnly cookie, stored hashed — the cookie carries no claims, so a role change takes effect on the next request rather than at the next token expiry. `apps/web` is a Vite application with two entry points, `candidate` and `admin`, split from the first commit so the candidate bundle never grows an admin dependency by accident.

**Tech Stack:** `jose` (JWKS verification and JWT handling — works on Workers), WebCrypto for PKCE and token hashing, React 19, Vite 7, TanStack Router, Hono's `getSignedCookie`/`setSignedCookie` for the session cookie, Vitest + Testing Library, Playwright for the one end-to-end flow.

**Spec:** [`docs/PRD.md`](../../PRD.md#authentication-authorization-and-privacy) (`S-01`–`S-05`, `S-08`, `S-09`, `S-18`; roles and permissions table) · [`DESIGN.md`](../../../DESIGN.md) · [`docs/ROADMAP.md`](../../ROADMAP.md#phase-3--organiser-auth-roles-first-run-and-landing-page)

## Global Constraints

- Everything from Phases 1 and 2 still holds: Node 22, pnpm, strict TypeScript, DCO sign-off, epoch-millisecond timestamps, the subrequest budget, 404-not-403 across workspaces.
- **No password hashing on Cloudflare.** The Workers free plan gives 10 ms of CPU per invocation, which is not enough for Argon2id (`S-01`, ADR 0002). Email-and-password sign-in is a Phase 11 Docker-only feature; this phase ships OIDC and magic link only.
- **Sessions** (`S-03`): HttpOnly, Secure, `SameSite=Lax`, path `/`, 12-hour idle timeout, rotated on sign-in and on any role change, with "sign out everywhere" clearing every session row for a user.
- **The server is the only authority.** The interface hides what a role cannot do; the API refuses it independently (PRD "Roles and permissions").
- **No third-party requests from the browser** (`S-11`). Fonts (Anek Latin, Anek Telugu, Anek Devanagari, JetBrains Mono — all SIL OFL) are self-hosted and subset. The CSP stays `default-src 'self'`.
- **Every colour, font size, radius and spacing value comes from `DESIGN.md`'s front matter** through the generated token files. No hex literal is typed into a component.
- **Accessibility is a requirement, not a later pass** (`O-04`, WCAG 2.1 AA): every control reachable by keyboard, every input labelled, visible focus, and the contrast ratios `DESIGN.md` states.
- Audit entries (`S-18`) are written for sign-in, sign-out, role change, member invite, member removal and workspace setting changes. The table is append-only — the repository exposes no update or delete.

## Review Focus

1. **The first-run wizard reachable after setup completes.** An unauthenticated endpoint that creates an instance owner is an instance takeover if it stays live one request too long. It must refuse once any user exists, checked server-side on every call, not guarded by a flag in configuration a redeploy can reset. — Task 6.
2. **`returnTo` after sign-in used as an open redirect.** `?returnTo=https://evil.example` sends a freshly authenticated organiser off-site, and the OIDC callback is the natural place for it to slip in. Only same-origin paths are accepted. — Task 3.
3. **A magic-link token that can be replayed, or that reveals whether an email has an account.** Both are the same endpoint's problem: the token must be single-use and time-boxed, and the response must be identical whether or not the address is known. — Task 4.
4. **A session not rotated when a role changes.** A member demoted from Admin to Viewer keeps Admin for up to twelve hours if the session record is not re-issued, which makes the permission matrix advisory rather than enforced. — Tasks 2 and 5.
5. **OIDC `state` or `nonce` not bound to the browser that started the flow.** Without binding, a callback can be replayed into another person's session; `state` must be stored server-side against the pre-session and consumed exactly once. — Task 3.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/permissions.ts` | Role, Action, the matrix as data, `can()` |
| `apps/api/src/auth/session.ts` | Create, read, rotate and revoke sessions |
| `apps/api/src/auth/oidc.ts` | Discovery, PKCE, authorization URL, callback exchange, JWKS verify |
| `apps/api/src/auth/magicLink.ts` | Token issue, single-use consume |
| `apps/api/src/auth/identity.ts` | `IdentityProvider` interface and the registry |
| `apps/api/src/email/adapter.ts` | `EmailSender` interface, HTTP and console implementations |
| `apps/api/src/middleware/authenticate.ts` | Session cookie to `Actor` |
| `apps/api/src/middleware/authorize.ts` | `requires(action)` route guard |
| `apps/api/src/routes/auth.ts` | `/auth/*` |
| `apps/api/src/routes/setup.ts` | `/setup/*` — first run only |
| `apps/api/src/routes/workspaces.ts` | `/workspaces`, members, settings |
| `apps/api/src/routes/me.ts` | The signed-in actor and their memberships |
| `scripts/tokens.mjs` | `DESIGN.md` front matter to `tokens.css` and `tokens.ts` |
| `apps/web/src/styles/tokens.css`, `tokens.ts` | Generated — never edited by hand |
| `apps/web/src/routes/landing.tsx` | The public landing page |
| `apps/web/src/routes/signin.tsx`, `setup.tsx`, `dashboard.tsx` | Organiser surfaces |
| `apps/web/src/components/*` | `hero-section`, `button-primary`, `text-input`, `top-nav` from `DESIGN.md` |
| `apps/web/e2e/first-run.spec.ts` | Playwright: landing to dashboard |

---

## Task 1: The permission matrix as pure data

**Files:**
- Create: `packages/core/src/permissions.ts`
- Create: `packages/core/test/permissions.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ROLES = ["owner","admin","author","proctor","reviewer","viewer"] as const;
  export type Role = (typeof ROLES)[number];
  export const ACTIONS = [
    "members.manage","workspace.settings","tests.edit","banks.edit","tests.publish",
    "candidates.manage","attempts.monitor","candidates.read_personal","attempts.read_evidence",
    "attempts.grade","results.export","candidates.delete","keys.manage",
  ] as const;
  export type Action = (typeof ACTIONS)[number];
  export const PERMISSIONS: Readonly<Record<Role, readonly Action[]>>;
  export function can(input: { role: Role; action: Action; testId?: string; grants?: readonly { testId: string; role: Role }[] }): boolean;
  ```

The thirteen actions are the thirteen rows of the PRD's permission matrix, in order. `can()` also resolves per-test grants (PRD: "Permissions can be narrowed to specific tests"): a grant for a test raises the role for that test only, and never lowers the workspace role.

- [ ] **Step 1: Write the failing test**

```ts
it("AC-23: the matrix matches the PRD table cell for cell", () => {
  expect(PERMISSIONS.owner).toEqual(ACTIONS);                       // owner has every action
  expect(PERMISSIONS.author).toEqual(["tests.edit","banks.edit"]);
  expect(PERMISSIONS.viewer).toEqual(["candidates.read_personal","results.export"]);
  expect(PERMISSIONS.proctor).toEqual(["attempts.monitor","candidates.read_personal","attempts.read_evidence"]);
  expect(PERMISSIONS.reviewer).toEqual(["candidates.read_personal","attempts.read_evidence","attempts.grade","results.export"]);
  expect(PERMISSIONS.admin).not.toContain("members.manage");
  expect(PERMISSIONS.admin).not.toContain("candidates.delete");
});

it("only the owner can delete candidate data or manage members", () => {
  for (const role of ROLES.filter(r => r !== "owner")) {
    expect(can({ role, action: "candidates.delete" })).toBe(false);
    expect(can({ role, action: "members.manage" })).toBe(false);
  }
});

it("a per-test grant raises the role for that test only", () => {
  const grants = [{ testId: "tst_a", role: "reviewer" as const }];
  expect(can({ role: "viewer", action: "attempts.grade", testId: "tst_a", grants })).toBe(true);
  expect(can({ role: "viewer", action: "attempts.grade", testId: "tst_b", grants })).toBe(false);
});

it("a per-test grant never lowers the workspace role", () => {
  expect(can({ role: "admin", action: "tests.publish", testId: "tst_a", grants: [{ testId: "tst_a", role: "viewer" }] })).toBe(true);
});

it("every role and action pair resolves without throwing", () => {
  for (const role of ROLES) for (const action of ACTIONS) expect(typeof can({ role, action })).toBe("boolean");
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run packages/core/test/permissions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `permissions.ts`**

Transcribe the PRD's permission matrix. Put a comment above `PERMISSIONS` naming the PRD section it mirrors, so a future edit goes to the spec first.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run packages/core/test/permissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/permissions.ts packages/core/test/permissions.test.ts packages/core/src/index.ts
git commit -s -m "feat(core): permission matrix and can() with per-test grants"
```

---

## Task 2: Sessions

**Files:**
- Create: `apps/api/src/auth/session.ts`
- Create: `apps/api/test/auth/session.test.ts`
- Modify: `packages/db/src/repo/workspaces.ts` (add the `session` and `user` reads and writes)

**Interfaces:**
- Produces:
  ```ts
  export const SESSION_COOKIE = "pk_session";
  export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
  export interface Actor { userId: string; email: string; memberships: { workspaceId: string; role: Role; grants: { testId: string; role: Role }[] }[] }
  export function issueSession(deps: AppDeps, userId: string): Promise<{ token: string; expiresAt: number }>;
  export function readSession(deps: AppDeps, token: string): Promise<Actor | null>;
  export function rotateSession(deps: AppDeps, token: string): Promise<{ token: string } | null>;
  export function revokeSession(deps: AppDeps, token: string): Promise<void>;
  export function revokeAllSessions(deps: AppDeps, userId: string): Promise<void>;
  ```

The cookie value is 32 bytes from `crypto.getRandomValues`, base64url. Only its SHA-256 is stored, so a database dump does not yield live sessions. `readSession` slides the idle window forward on each use and returns `null` past it. This task owns half of Review Focus item 4.

- [ ] **Step 1: Write the failing test**

```ts
it("S-03: a session expires after 12 hours of inactivity", async () => {
  const { token } = await issueSession(deps(at(T)), user);
  expect(await readSession(deps(at(T + SESSION_IDLE_MS - 1000)), token)).not.toBeNull();
  expect(await readSession(deps(at(T + SESSION_IDLE_MS + 1000)), token)).toBeNull();
});

it("activity slides the idle window forward", async () => { /* read at +11h, still valid at +22h */ });

it("only the hash of a session token is stored", async () => {
  const { token } = await issueSession(deps, user);
  expect(await rawSessionRows(db)).not.toContainEqual(expect.objectContaining({ token }));
});

it("rotation invalidates the previous token", async () => {
  const next = await rotateSession(deps, token);
  expect(await readSession(deps, token)).toBeNull();
  expect(await readSession(deps, next!.token)).not.toBeNull();
});

it("sign out everywhere revokes every session a user holds", async () => { /* three sessions, all dead */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/auth/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `session.ts`**

`readSession` loads the user and their memberships in **one query with a join**, not one per membership — the subrequest budget from Phase 2 applies to the authentication path on every single request, which makes it the hottest path in the application.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/auth/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/session.ts apps/api/test packages/db
git commit -s -m "feat(api): hashed server-side sessions with sliding idle expiry"
```

---

## Task 3: OIDC sign-in

**Files:**
- Create: `apps/api/src/auth/oidc.ts`, `apps/api/src/auth/identity.ts`
- Create: `apps/api/test/auth/oidc.test.ts`

**Interfaces:**
- Consumes: `issueSession`.
- Produces:
  ```ts
  export interface IdentityProvider { id: string; kind: "oidc" | "magic_link" | "password"; label: string }
  export function authorizationUrl(deps: AppDeps, providerId: string, returnTo: string): Promise<{ url: string; stateId: string }>;
  export function handleCallback(deps: AppDeps, providerId: string, params: { code: string; state: string }): Promise<{ userId: string; email: string; returnTo: string }>;
  export function safeReturnTo(raw: string | undefined): string;   // same-origin path, or "/"
  ```

Authorization code flow with PKCE (S256). `state`, the PKCE verifier and `returnTo` are stored server-side in a short-lived row keyed by `stateId`, consumed exactly once on callback — binding the callback to the browser that started it. The ID token is verified against the provider's JWKS with `jose`: signature, `iss`, `aud`, `exp` and `nonce`. This task owns Review Focus items 2 and 5.

- [ ] **Step 1: Write the failing test**

```ts
it("the authorization URL carries state, a S256 code challenge and the configured scopes", async () => { /* … */ });

it("a callback whose state was already used is refused", async () => {
  await handleCallback(deps, "google", params);
  await expect(handleCallback(deps, "google", params)).rejects.toThrow(/state/i);
});

it("a callback with a state this browser never started is refused", async () => { /* … */ });

it("an ID token with a wrong nonce, audience or issuer is refused", async () => {
  for (const bad of [wrongNonce, wrongAud, wrongIss, expired]) {
    await expect(handleCallback(deps, "google", bad)).rejects.toThrow();
  }
});

it("safeReturnTo accepts only same-origin paths", () => {
  expect(safeReturnTo("/w/acme/tests")).toBe("/w/acme/tests");
  for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/\\evil.example", undefined]) {
    expect(safeReturnTo(bad)).toBe("/");
  }
});

it("a second sign-in with the same provider subject reuses the user rather than creating one", async () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/auth/oidc.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `oidc.ts`**

Discovery documents and JWKS are fetched once and cached in memory for the isolate's lifetime — two subrequests on a cold isolate, zero on a warm one. `safeReturnTo` rejects anything that is not a single leading `/` followed by a non-`/` and non-`\` character.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/auth/oidc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/test/auth
git commit -s -m "feat(api): OIDC sign-in with PKCE, server-side state and a safe returnTo"
```

---

## Task 4: Magic-link sign-in and the email adapter

**Files:**
- Create: `apps/api/src/auth/magicLink.ts`, `apps/api/src/email/adapter.ts`, `apps/api/src/email/http.ts`, `apps/api/src/email/console.ts`
- Create: `apps/api/test/auth/magicLink.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface EmailSender { send(msg: { to: string; subject: string; text: string; html?: string }): Promise<void> }
  export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
  export function requestMagicLink(deps: AppDeps, email: string): Promise<void>;          // always resolves
  export function consumeMagicLink(deps: AppDeps, token: string): Promise<{ userId: string; email: string }>;
  ```

`requestMagicLink` resolves identically whether or not the address belongs to a user, and the route returns the same body and status either way. The token is 32 random bytes; only its hash is stored, with a `used_at` column set on consumption inside the same statement that selects it, so a replay finds nothing. This task owns Review Focus item 3.

- [ ] **Step 1: Write the failing test**

```ts
it("a link can be used once", async () => {
  await expect(consumeMagicLink(deps, token)).resolves.toMatchObject({ email });
  await expect(consumeMagicLink(deps, token)).rejects.toThrow(/invalid|used/i);
});

it("a link expires after 15 minutes", async () => { /* … */ });

it("the response is identical for a known and an unknown address", async () => {
  const a = await app.request("/api/v1/auth/magic-link", post({ email: "known@example.com" }));
  const b = await app.request("/api/v1/auth/magic-link", post({ email: "nobody@example.com" }));
  expect([a.status, await a.text()]).toEqual([b.status, await b.text()]);
});

it("no email is sent to an unknown address", async () => {
  expect(sent.map(m => m.to)).not.toContain("nobody@example.com");
});

it("only the hash of a magic-link token is stored", async () => { /* … */ });

it("the console sender is used when no email credentials are configured, and logs no token to production logs", async () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/auth/magicLink.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the adapter and the flow**

`http.ts` posts to a configured transactional-email endpoint with a bearer token — one adapter, any provider with a free tier, no SDK. `console.ts` is the development fallback and is refused when `env.NODE_ENV === "production"` unless explicitly enabled.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/auth/magicLink.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/magicLink.ts apps/api/src/email apps/api/test/auth/magicLink.test.ts
git commit -s -m "feat(api): single-use magic links with an enumeration-safe response"
```

---

## Task 5: Authentication and authorization middleware, workspace routes, audit log

**Files:**
- Create: `apps/api/src/middleware/authenticate.ts`, `apps/api/src/middleware/authorize.ts`
- Create: `apps/api/src/routes/auth.ts`, `apps/api/src/routes/me.ts`, `apps/api/src/routes/workspaces.ts`
- Create: `apps/api/test/authorization.test.ts`, `apps/api/test/workspaces.test.ts`
- Modify: `apps/api/src/app.ts` (mount the routes, extend `ROUTE_BUDGETS`)

**Interfaces:**
- Consumes: `can`, `readSession`, `rotateSession`, `appendAudit`.
- Produces:
  ```ts
  export function authenticate(): MiddlewareHandler;        // sets c.var.actor, or null
  export function requires(action: Action): MiddlewareHandler; // 401 when anonymous, 403 when forbidden, 404 across workspaces
  ```

Routes: `POST /auth/magic-link`, `GET /auth/:provider/start`, `GET /auth/:provider/callback`, `POST /auth/signout`, `POST /auth/signout-everywhere`, `GET /me`, `GET/POST /workspaces`, `GET/PATCH /workspaces/:id`, `GET/POST/DELETE /workspaces/:id/members`.

Changing a member's role calls `revokeAllSessions` for that user — the other half of Review Focus item 4. A member removed or demoted loses access on their next request, not at the end of a twelve-hour window.

- [ ] **Step 1: Write the failing test**

A table-driven suite over every (role, action) pair, since this is the gate for `AC-23`:

```ts
it("AC-23: every allowed action succeeds and every other returns 403", async () => {
  for (const role of ROLES) for (const action of ACTIONS) {
    const res = await callRouteFor(action, asMember(role));
    if (can({ role, action })) expect(res.status, `${role}/${action}`).not.toBe(403);
    else expect(res.status, `${role}/${action}`).toBe(403);
  }
});

it("S-09: a member of workspace A gets 404, not 403, for a workspace-B resource", async () => {
  expect((await app.request(`/api/v1/workspaces/${wspB}`, asMember("owner", wspA))).status).toBe(404);
});

it("an anonymous request to a guarded route is 401, not 403", async () => { /* … */ });

it("every guarded route is covered by this table", () => {
  expect(new Set(guardedRoutes(app))).toEqual(new Set(Object.keys(ROUTE_ACTIONS)));
});

it("changing a member's role revokes that member's sessions", async () => {
  await patchRole(adminSession, { userId: bob, role: "viewer" });
  expect(await readSession(deps, bobSession)).toBeNull();
});

it("S-18: sign-in, role change and member removal each append one audit entry with actor, action and target", async () => { /* … */ });

it("the audit repository exposes no update or delete", () => {
  expect(Object.keys(auditRepo)).toEqual(["appendAudit", "listAudit"]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/authorization.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the middleware and routes**

`ROUTE_ACTIONS` maps every guarded route to its `Action`, lives beside `ROUTE_BUDGETS` in `app.ts`, and the coverage assertion above means a route mounted without an entry fails the suite rather than shipping unguarded.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/api`
Expected: PASS, including the Phase 2 budget suite with its new entries.

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -s -m "feat(api): server-enforced authorization, workspace routes and audit log"
```

---

## Task 6: First-run wizard

**Files:**
- Create: `apps/api/src/routes/setup.ts`
- Create: `apps/api/test/setup.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/setup/status` → `{ needed: boolean; providers: IdentityProvider[] }`, and `POST /api/v1/setup/complete` → creates the instance owner from the current sign-in and the first workspace.

This task owns Review Focus item 1. Setup is **not** a configuration flag: `needed` is computed as "no user row exists", and `complete` re-checks it inside the same transaction that inserts, so two simultaneous requests cannot both succeed.

- [ ] **Step 1: Write the failing test**

```ts
it("on an empty instance, setup is needed and lists the configured providers", async () => {
  expect(await json("/api/v1/setup/status")).toEqual({ needed: true, providers: expect.any(Array) });
});

it("completing setup creates the instance owner and the first workspace", async () => { /* … */ });

it("after setup, status reports needed false and complete returns 409", async () => {
  expect((await app.request("/api/v1/setup/complete", post(body))).status).toBe(409);
});

it("two concurrent completions produce exactly one owner", async () => {
  const [a, b] = await Promise.all([complete(), complete()]);
  expect([a.status, b.status].sort()).toEqual([200, 409]);
  expect(await userCount(db)).toBe(1);
});

it("setup cannot be re-enabled by any request", async () => {
  for (const attempt of [post({ force: true }), post({ needed: true }), del()]) {
    expect((await app.request("/api/v1/setup/complete", attempt)).status).not.toBe(200);
  }
});

it("the workspace slug is validated and must be unique", async () => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/api/test/setup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `setup.ts`**

`complete` requires an authenticated session — the operator signs in through OIDC or a magic link first, and that identity becomes the instance owner. It never accepts an email in its body.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run apps/api/test/setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/setup.ts apps/api/test/setup.test.ts
git commit -s -m "feat(api): first-run wizard that cannot be re-opened after setup"
```

---

## Task 7: Design tokens generated from DESIGN.md

**Files:**
- Create: `scripts/tokens.mjs`
- Create: `scripts/tokens.test.mjs` (or `scripts/__tests__/tokens.test.ts`)
- Create (generated, committed): `apps/web/src/styles/tokens.css`, `apps/web/src/styles/tokens.ts`
- Modify: root `package.json` (add `tokens` script; make `build` depend on it)

**Interfaces:**
- Produces:
  ```ts
  export function parseDesignTokens(markdown: string): { colors: Record<string,string>; typography: Record<string, TypeToken>; spacing: Record<string,string>; radii: Record<string,string>; elevation: Record<string,string> };
  export function toCss(tokens: DesignTokens): string;   // :root { --color-voltage: #e24c18; … }
  export function toTs(tokens: DesignTokens): string;    // export const tokens = { … } as const
  ```

`DESIGN.md` keeps its YAML front matter as the single source. The generated files are committed so a clone builds without running the generator, and CI fails if they are stale.

- [ ] **Step 1: Write the failing test**

```ts
it("reads every colour from DESIGN.md's front matter", () => {
  const t = parseDesignTokens(readFileSync("DESIGN.md", "utf8"));
  expect(t.colors.voltage).toBe("#e24c18");
  expect(t.colors.cream).toBe("#fffbf5");
  expect(Object.keys(t.colors).length).toBeGreaterThanOrEqual(20);
});

it("emits a CSS custom property per colour and per typography token", () => {
  expect(toCss(t)).toContain("--color-voltage: #e24c18;");
  expect(toCss(t)).toContain("--type-display-xl-size: 56px;");
});

it("the committed token files match what the generator produces", () => {
  expect(readFileSync("apps/web/src/styles/tokens.css", "utf8")).toBe(toCss(t));
  expect(readFileSync("apps/web/src/styles/tokens.ts", "utf8")).toBe(toTs(t));
});

it("no source file outside the generated tokens contains a hex colour literal", () => {
  expect(filesWithHexLiterals("apps/web/src", { except: ["styles/tokens.ts", "styles/tokens.css"] })).toEqual([]);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run scripts`
Expected: FAIL.

- [ ] **Step 3: Implement `tokens.mjs` and generate the files**

Parse the front matter with a small YAML reader — the front matter is flat enough that `yaml` as a devDependency is the honest choice over hand-rolling one. Write a header comment into both generated files saying they are generated from `DESIGN.md` and must not be edited.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm tokens && pnpm vitest run scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts apps/web/src/styles package.json
git commit -s -m "build(web): generate design tokens from DESIGN.md front matter"
```

---

## Task 8: The web application shell and the landing page

**Files:**
- Create: `apps/web/package.json`, `vite.config.ts`, `index.html`, `admin.html`
- Create: `apps/web/src/components/HeroSection.tsx`, `ButtonPrimary.tsx`, `ButtonSecondary.tsx`, `TopNav.tsx`, `FeatureCell.tsx`, `CardHairline.tsx`
- Create: `apps/web/src/routes/landing.tsx`
- Create: `apps/web/public/fonts/*` (Anek Latin, Anek Telugu, Anek Devanagari, JetBrains Mono — subset, WOFF2, SIL OFL with licence files)
- Create: `apps/web/test/landing.test.tsx`, `apps/web/test/contrast.test.ts`

**Interfaces:**
- Consumes: `tokens.ts`.
- Produces: the component set `DESIGN.md` names, each taking its values from tokens only.

Two Vite entries from the first commit — `index.html` for the candidate bundle and `admin.html` for the admin bundle (PRD: "the candidate bundle is split from the admin bundle"). The landing page is the full-bleed voltage hero: 56px Anek Latin at weight 500 in cream, one lead sentence, a cream pill CTA.

- [ ] **Step 1: Write the failing test**

```tsx
it("the landing hero renders the product name, one lead sentence and one CTA", () => {
  render(<Landing />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Pariksha/);
  expect(screen.getAllByRole("link", { name: /start|deploy|try/i })).toHaveLength(1);
});

it("the hero uses the voltage canvas and cream text from the tokens, not literals", () => {
  expect(getComputedStyle(hero).backgroundColor).toBe(rgb(tokens.colors.voltage));
});

it("every stated contrast pair in DESIGN.md actually meets its ratio", () => {
  for (const pair of DESIGN_CONTRAST_PAIRS) {
    expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(pair.min);
  }
});

it("the page is navigable by keyboard and every interactive element has an accessible name", async () => {
  expect(await axe(container)).toHaveNoViolations();
});

it("the candidate bundle does not import anything from the admin entry", () => {
  expect(bundleGraph("index.html")).not.toContain("routes/dashboard");
});

it("no font is loaded from a third-party origin", () => {
  expect(cssFontSources()).toEqual(expect.arrayContaining([expect.stringMatching(/^\/fonts\//)]));
  expect(cssFontSources().some(s => s.startsWith("http"))).toBe(false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run apps/web`
Expected: FAIL.

- [ ] **Step 3: Build the shell, the components and the landing page**

`DESIGN_CONTRAST_PAIRS` is extracted from `DESIGN.md`'s colour tables by the Task 7 generator — the ratios are already written down there, and this test is what stops them becoming aspirational. Fonts are subset to Latin, Telugu and Devanagari ranges and self-hosted with their OFL licence files alongside.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run apps/web && pnpm --filter @pariksha/web build`
Expected: PASS. The candidate bundle is under 300 KB gzipped (PRD non-functional requirements).

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -s -m "feat(web): vite shell, design-system components and the landing page"
```

---

## Task 9: Sign-in, wizard and dashboard screens, and the end-to-end flow

**Files:**
- Create: `apps/web/src/routes/signin.tsx`, `setup.tsx`, `dashboard.tsx`
- Create: `apps/web/src/lib/api.ts` (typed fetch wrapper, credentials included, error envelope decoded)
- Create: `apps/web/e2e/first-run.spec.ts`, `playwright.config.ts`
- Modify: `.github/workflows/ci.yml` (add the Playwright job), `README.md`, `apps/web/README.md`, `apps/api/README.md`

**Interfaces:**
- Consumes: `/api/v1/setup/status`, `/api/v1/auth/*`, `/api/v1/me`, `/api/v1/workspaces`.

- [ ] **Step 1: Write the failing end-to-end test**

```ts
test("AC-01 (partial): a fresh deployment goes landing → sign in → wizard → dashboard", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /get started/i }).click();
  await signInWithStubProvider(page);
  await page.getByLabel("Workspace name").fill("Placement cell");
  await page.getByRole("button", { name: /create workspace/i }).click();
  await expect(page.getByRole("heading", { name: "Placement cell" })).toBeVisible();
  await expect(page.getByText(/no tests yet/i)).toBeVisible();
});

test("visiting /setup after setup is complete redirects to sign-in, not to the wizard", async ({ page }) => { /* … */ });

test("a signed-out visitor sent to a dashboard URL lands on sign-in and returns there after signing in", async ({ page }) => { /* returnTo, same-origin only */ });

test("the sign-in page shows only the providers the instance has configured", async ({ page }) => { /* … */ });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @pariksha/web e2e`
Expected: FAIL.

- [ ] **Step 3: Build the three screens and the API client**

The wizard shows one field at a time with the `DESIGN.md` registration-form components — `field-label`, `field-help`, `field-error` with its `⚠` glyph and a message that says what the right format looks like, never "Invalid format". The empty dashboard states plainly that there are no tests yet and offers the one next action.

- [ ] **Step 4: Run the end-to-end flow and the whole suite**

Run: `pnpm lint && pnpm typecheck && pnpm build && pnpm test && pnpm --filter @pariksha/web e2e`
Expected: all pass.

- [ ] **Step 5: Add the Playwright CI job, update the READMEs and commit**

Change the status lines in `apps/web/README.md` and `apps/api/README.md` from planned to shipped, and add a "Running Pariksha locally" section to the root `README.md`.

```bash
git add apps/web apps/api/README.md README.md .github/workflows/ci.yml
git commit -s -m "feat(web): sign-in, first-run wizard and dashboard with an end-to-end flow"
```

---

## Done when

- A fresh deployment reaches a signed-in, empty dashboard through the browser, with no manual database work.
- `AC-23` passes: every (role, action) pair behaves as the PRD matrix says, and a cross-workspace resource is 404.
- A role change revokes that member's sessions immediately.
- `/api/v1/setup/complete` returns 409 once an owner exists, and two concurrent calls produce one owner.
- No hex colour literal exists in `apps/web/src` outside the generated token files, and every contrast pair `DESIGN.md` states is verified by test.
- The candidate bundle is under 300 KB gzipped and loads no third-party origin.
