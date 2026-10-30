# Issue Triage Batch 2 (#156, #197, #180, #182) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve and close the second batch of open issues (#156, #197, #180, #182) by hardening publishing invariants, preventing unfillable pool publishing, warning on lossy timer configurations, restricting candidate SSO providers, and verifying Postgres dialect integrity.

**Architecture:** Enforce core test validation gates in `apps/api/src/publish/checklist.ts` to block publishing when question pools underfill, emit advisory guidance for free navigation with per-section timers, constrain candidate SSO provider query resolution in `apps/api/src/routes/run.ts`, and verify Postgres JSON serialization in `packages/db`.

**Tech Stack:** TypeScript, Hono, Vitest, Git, GitHub CLI (`gh`).

**Spec:** `docs/superpowers/specs/2026-10-30-issue-triage-batch-2-design.md`

## Global Constraints

- **Ponytail Ladder:** Shortest working diffs, zero unnecessary schema migrations, YAGNI.
- **Commit Format:** `--author="Satya K <srisatyalokesh2.12@gmail.com>"` with signed-off DCO (`-s`).
- **Zero New Dependencies:** No new npm or external dependencies.
- **Audit Integrity:** Issue close comments must state the exact commit SHAs or test verification evidence.

## Review Focus

1. Severity enforcement: ensure `pool_short` cannot be published and triggers 422 `checklist_blocked`.
2. Advisory precision: ensure `free_nav_section_timers` only triggers when `navigation.mode === "free"` AND at least one section has a positive `time_limit_minutes`.
3. SSO provider containment: ensure unconfigured `?provider=` queries reject with 400 `incomplete` rather than falling through.
4. Preserved DCO sign-offs: all commits must have `Signed-off-by: Satya K <srisatyalokesh2.12@gmail.com>`.
5. Non-breaking: ensure valid tests with satisfied pools and balanced sets continue to publish with 200 OK.

---

### Task 1: Verify & Formally Close Postgres db.jsonParam() Fix (#156)

**Files:**
- Verify: `packages/db/src/client.ts:225`
- Verify: `packages/db/test/client-json.test.ts`

**Interfaces:**
- Consumes: `packages/db/test/client-json.test.ts`
- Produces: Verified evidence and closed issue #156.

- [ ] **Step 1: Run client JSON unit tests**
  - Run: `pnpm --filter @pariksha/db test test/client-json.test.ts`
  - Expected: 2 passed tests in `test/client-json.test.ts`.

- [ ] **Step 2: Confirm commit resolution in git history**
  - Run: `git log -S "jsonParam" -n 1 --oneline packages/db/src/client.ts`
  - Expected: Commit `c33a981` updating `jsonParam` to `JSON.stringify(value)` and `jsonValue` to pass-through.

- [ ] **Step 3: Close GitHub Issue #156 with commit citation**
  - Command:
    ```bash
    gh issue close 156 --comment "Resolved in commit c33a981 which updated pgClient.jsonParam to JSON.stringify(value) and pgClient.jsonValue to pass-through parsed values, verified by packages/db/test/client-json.test.ts."
    ```

---

### Task 2: Upgrade pool_short to Blocking Publish Refusal (#197)

**Files:**
- Modify: `apps/api/src/publish/checklist.ts:117`
- Test: `apps/api/test/checklist.test.ts:148-223`

**Interfaces:**
- Consumes: `apps/api/src/publish/checklist.ts`
- Produces: `pool_short` checklist row with `severity: "blocking"` that refuses publishing when matching questions < requested pool count.

- [ ] **Step 1: Write failing test in `apps/api/test/checklist.test.ts`**
  - Update `it("a pool shortfall is advisory and states both numbers")` to:
    ```ts
    it("a pool shortfall is blocking and states both numbers", async () => {
      const row = (await rows()).find((r) => r.id === "pool_short");
      expect(row).toMatchObject({ severity: "blocking", sectionId: "quant" });
      expect(row?.message).toBe('section "quant" draws 10 questions but only 7 match its filter');
    });
    ```
  - In `it("T-11: publish succeeds over advisory rows and refuses over blocking ones")`:
    Assert that publish is refused when `pool_short` is present (`status: 422`), and verify that advisory rows (like `sets_unbalanced`) succeed when no blocking rows exist.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/api test test/checklist.test.ts`
  - Expected: FAIL (`expected 'advisory' to be 'blocking'`).

- [ ] **Step 3: Implement severity change in `apps/api/src/publish/checklist.ts`**
  - In `apps/api/src/publish/checklist.ts:117`:
    Change:
    ```ts
    "source.count": [{ id: "pool_short", severity: "blocking" }],
    ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `pnpm --filter @pariksha/api test test/checklist.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/api/src/publish/checklist.ts apps/api/test/checklist.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "fix(api): upgrade pool_short to blocking publish refusal (closes #197)"
    ```

- [ ] **Step 6: Close GitHub Issue #197**
  - Command:
    ```bash
    gh issue close 197 --comment "Fixed in commit $(git rev-parse --short HEAD): upgraded pool_short from advisory to blocking in apps/api/src/publish/checklist.ts, preventing tests from publishing when question pools have fewer matching questions than requested."
    ```

---

### Task 3: Add Free Navigation + Section Timers Advisory Row & Docs (#180)

**Files:**
- Modify: `apps/api/src/publish/checklist.ts`
- Modify: `docs/test-format.md`
- Test: `apps/api/test/checklist.test.ts`

**Interfaces:**
- Consumes: `apps/api/src/publish/checklist.ts`, `docs/test-format.md`
- Produces: `free_nav_section_timers` advisory checklist row when `settings.navigation?.mode === "free"` and timed sections exist.

- [ ] **Step 1: Write failing test in `apps/api/test/checklist.test.ts`**
  - Add test:
    ```ts
    it("free navigation with timed sections generates an advisory checklist row (#180)", async () => {
      await saveDraft({
        settings: { navigation: { mode: "free" } },
        sections: [
          {
            id: "timed_sec",
            title: "Timed Section",
            time_limit_minutes: 15,
            source: { kind: "fixed", questions: [q1Id] },
          },
        ],
      });
      const row = (await rows()).find((r) => r.id === "free_nav_section_timers");
      expect(row).toMatchObject({
        severity: "advisory",
        field: "navigation.mode",
      });
      expect(row?.message).toContain("free navigation with per-section time limits closes each timed section permanently once left");
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/api test test/checklist.test.ts`
  - Expected: FAIL (`expected undefined to match object`).

- [ ] **Step 3: Implement checklist row in `apps/api/src/publish/checklist.ts`**
  - In `buildChecklist`:
    ```ts
    if (settings.navigation?.mode === "free" && sections.some((s) => (s.time_limit_minutes ?? 0) > 0)) {
      rows.push({
        id: "free_nav_section_timers",
        severity: "advisory",
        field: "navigation.mode",
        message: "free navigation with per-section time limits closes each timed section permanently once left, because the server tracks a single section clock",
      });
    }
    ```
  - In `docs/test-format.md`: Add a subsection under Navigation noting that free navigation combined with per-section time limits closes timed sections when left.

- [ ] **Step 4: Run test to verify it passes**
  - Run: `pnpm --filter @pariksha/api test test/checklist.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/api/src/publish/checklist.ts docs/test-format.md apps/api/test/checklist.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "feat(api): add publish advisory and documentation for free navigation with section timers (closes #180)"
    ```

- [ ] **Step 6: Close GitHub Issue #180**
  - Command:
    ```bash
    gh issue close 180 --comment "Resolved in commit $(git rev-parse --short HEAD): added free_nav_section_timers advisory checklist row warning authors that free navigation with timed sections permanently closes sections once left, and documented the behaviour in docs/test-format.md."
    ```

---

### Task 4: Enforce Candidate OIDC Provider Whitelist (#182)

**Files:**
- Modify: `apps/api/src/routes/run.ts:345-347`
- Test: `apps/api/test/run/access.test.ts`

**Interfaces:**
- Consumes: `apps/api/src/routes/run.ts`
- Produces: Constrained `providerFor` rejecting unconfigured providers with 400 `incomplete`.

- [ ] **Step 1: Write failing test in `apps/api/test/run/access.test.ts`**
  - Add test:
    ```ts
    it("sso: an unconfigured provider in ?provider= query is refused (#182)", async () => {
      const res = await app.request("/api/v1/run/alpha/sso/sso/start?provider=evil_corp");
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain("Unknown identity provider");
    });
    ```

- [ ] **Step 2: Run test to verify it fails**
  - Run: `pnpm --filter @pariksha/api test test/run/access.test.ts`
  - Expected: FAIL (500 or redirect rather than 400 with "Unknown identity provider").

- [ ] **Step 3: Update `providerFor` in `apps/api/src/routes/run.ts`**
  - Update:
    ```ts
    const providerFor = (deps: AppDeps, c: Context<AppBindings>): string => {
      const providers = deps.env.oidcProviders ?? [];
      const requested = c.req.query("provider");
      if (requested) {
        const match = providers.find((p) => p.id === requested);
        if (!match) throw incomplete("Unknown identity provider.");
        return match.id;
      }
      return providers[0]?.id ?? "";
    };
    ```

- [ ] **Step 4: Run test to verify it passes**
  - Run: `pnpm --filter @pariksha/api test test/run/access.test.ts`
  - Expected: PASS.

- [ ] **Step 5: Commit changes**
  - Command:
    ```bash
    git add apps/api/src/routes/run.ts apps/api/test/run/access.test.ts
    git commit -s --author="Satya K <srisatyalokesh2.12@gmail.com>" -m "security(api): validate candidate SSO provider query against configured providers (closes #182)"
    ```

- [ ] **Step 6: Close GitHub Issue #182**
  - Command:
    ```bash
    gh issue close 182 --comment "Resolved in commit $(git rev-parse --short HEAD): constrained providerFor in apps/api/src/routes/run.ts to validate caller-requested ?provider= against configured oidcProviders, refusing unconfigured providers with 400."
    ```
