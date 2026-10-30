# Batch 2 Issue Triage & Core Invariants Design Document

**Milestone:** Issue Triage & Quality Hardening — Batch 2  
**Target Issues:** [#156](https://github.com/SriSatyaLokesh/pariksha/issues/156), [#197](https://github.com/SriSatyaLokesh/pariksha/issues/197), [#180](https://github.com/SriSatyaLokesh/pariksha/issues/180), [#182](https://github.com/SriSatyaLokesh/pariksha/issues/182)  
**Date:** 2026-10-30  
**Status:** Under Review  
**Applied Skills:** `ponytail` (minimal shortest diffs, no unnecessary refactoring), `senior-backend` (domain invariants & checklist validation), `senior-fullstack` (API & test synchronization).

---

## 1. Intent & Context

Batch 2 targets core publishing invariants, candidate security boundaries, and Postgres dialect resolution:
1. **#156 (db.jsonParam() throws on Postgres):** Resolved in commit `c33a981` (`packages/db/src/client.ts:225` using `JSON.stringify(value)` and verified in `packages/db/test/client-json.test.ts`). Needs audit verification and formal issue closure.
2. **#197 (A pool section that cannot fill publishes on an advisory, not a refusal):** `selectForSection` in `@pariksha/core` throws `PoolTooSmallError` whenever `matching.length < source.count`. Because `pool_short` in `apps/api/src/publish/checklist.ts` is currently advisory, tests with unfillable pools publish and break candidate attempts with fatal 409 errors. Upgrading `pool_short` to `blocking` ensures tests cannot publish when question pools are unsatisfiable.
3. **#180 (Free navigation plus per-section time limits):** A single `section_started_at` cannot hold multiple timing anchors. In `free` mode, jumping back and forth closes timed sections when left. To avoid expensive schema migrations while being honest with test authors, the publish checklist will surface an advisory row (`free_nav_section_timers`) alerting authors to this behaviour, and `docs/test-format.md` will document it.
4. **#182 (Candidate OIDC provider restriction):** Caller-supplied `?provider=` in `apps/api/src/routes/run.ts:345` must validate against configured `deps.env.oidcProviders` so arbitrary or unconfigured identity providers cannot be injected to spoof identity assertions.

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- Formally verify and close #156 with test evidence from `client-json.test.ts`.
- Upgrade `pool_short` severity in `apps/api/src/publish/checklist.ts` to `blocking` so unfillable pools cannot be published (#197).
- Add `free_nav_section_timers` advisory row to `buildChecklist` when `navigation.mode === "free"` and timed sections exist, and document in `docs/test-format.md` (#180).
- Validate `?provider=` query against configured `deps.env.oidcProviders` in `apps/api/src/routes/run.ts:345` with unit test (#182).
- Update associated checklist and run tests to align with these invariants.

### Non-Goals
- Do not migrate database schema to add multi-column section timer history (YAGNI / Ponytail ladder; checklist warning and doc accurately solves #180).
- Do not rewrite candidate SSO pipelines or introduce complex provider discovery proxies (#182).

### Anti-Goals
- Introducing any new external dependencies.
- Breaking valid test publishing where question pools are completely satisfied.

---

## 3. Approaches Considered

### Strategy 1: Core Domain Invariants & Publishing Safety (Chosen)
- Close #156 on verified evidence from commit `c33a981`.
- Make `pool_short` a blocking checklist row in `apps/api/src/publish/checklist.ts`.
- Add advisory checklist warning and documentation for free navigation + section time limits.
- Validate `c.req.query("provider")` against configured OIDC providers.
- **Trade-off:** High safety, addresses the exact root causes, zero schema migrations.

### Strategy 2: Multi-Column Timestamp Migration for Free Navigation (Rejected)
- Add per-section JSON timestamps column to the attempts table and migrate SQLite/Postgres schemas.
- **Reason for Rejection:** High risk, high blast radius, violates Ponytail rung 1 for an uncommon test configuration that is cleanly addressed via author advisory and documentation.

---

## 4. Detailed Changes

### 1. #156 Verification
- Run: `pnpm --filter @pariksha/db test test/client-json.test.ts`.
- Close #156 citing commit `c33a981`.

### 2. #197 Pool Underfill Publish Refusal
- In `apps/api/src/publish/checklist.ts`:
  - Change `"source.count": [{ id: "pool_short", severity: "advisory" }]` to `severity: "blocking"`.
- Update `apps/api/test/checklist.test.ts` to assert that `pool_short` is a blocking row that refuses publish with 422.

### 3. #180 Free Navigation + Section Timers Advisory
- In `apps/api/src/publish/checklist.ts`:
  - When `settings.navigation?.mode === "free"` and `sections.some(s => (s.time_limit_minutes ?? 0) > 0)`:
  - Add advisory row:
    ```ts
    {
      id: "free_nav_section_timers",
      severity: "advisory",
      field: "navigation.mode",
      message: "free navigation with per-section time limits closes each timed section permanently once left, because the server tracks a single section clock",
    }
    ```
- In `docs/test-format.md`: Document this behaviour.
- In `apps/api/test/checklist.test.ts`: Add test asserting `free_nav_section_timers` advisory row.

### 4. #182 Candidate OIDC Provider Whitelist
- In `apps/api/src/routes/run.ts`:
  - Update `providerFor`:
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
- Add test in `apps/api/test/run/sso.test.ts` verifying unknown provider query rejects with incomplete error.
- Close #182 with audit comment.
