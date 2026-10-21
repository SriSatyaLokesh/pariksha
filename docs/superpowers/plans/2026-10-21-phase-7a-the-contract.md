# Phase 7a — The Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every later Phase 7 plan one resolved proctoring object, one closed event vocabulary, and the two attempt columns the integrity flag needs — and convert the three readers that branch on `profile` today, before a fourth is written.

**Architecture:** `resolveProctoring(profile, overrides)` lands in `packages/core` as a pure function over a defaults table, returning a `ResolvedProctoring` with every field present and no optionals. `schemas/test-1.json` gains three overrides and relaxes one minimum. `attempt` gains `integrity_flag` and `observed` across all three dialects, because `attempt.flag` already carries `"scoring_blocked"` from grading. `LandingPayload.proctoring` — today a bare `"off" | "standard" | "strict"` that `exam.tsx` switches on — is **replaced** by the resolved requirements the runtime will enforce, which means a `scrub-scan` replay.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle (D1 / SQLite / Postgres), Hono, Preact/React.

**Spec:** [`docs/superpowers/specs/2026-10-21-phase-7-proctoring-design.md`](../specs/2026-10-21-phase-7-proctoring-design.md) — `Q1`, `Q1b`, `Q1c`, `Q3a`, `Q6`, `Q7b`, `Q11`, `Q12`, §3.

**Depends on:** nothing. This is the phase's first plan and the only one with no predecessor.

**Goals covered:** `G1` — every control under `proctoring.overrides` has a reader that honours it, and the three profiles resolve through one pure function.

## Global Constraints

Copied from the spec's §17. Every task's requirements implicitly include this section.

- **`AG1`** — a proctoring stack failure never blocks answering. `Q2`'s camera requirement is the single stated exception.
- **`AG2`** — no video and no audio is ever recorded or stored. **`AG3`** — no biometric template, anywhere.
- **`AG5`** — never make a gate green by moving a bar. A failing guard is fixed, not relaxed.
- Every mounted route needs a **measured** `ROUTE_BUDGETS` entry and a `ROUTE_AUTH` declaration; `budget.test.ts` and `routeAuthorities()` both read the live route table.
- Migrations are written for D1, SQLite **and** Postgres, with `parity.test.ts` and `no-d1-hostile-sql.test.ts` green.
- `pnpm build` needs `SITE_URL`: `SITE_URL='https://pariksha.example' pnpm build`. `pnpm test --force` does not work — use `npx turbo run test --force --concurrency=1`.
- **Never create a git worktree beside this one.** Read a frozen commit with `git show <sha>:<path>`.
- `apps/web`'s vitest is capped at `maxWorkers: min(availableParallelism(), 4)`. `findBy*`/`waitFor` carry their own **1 s** `asyncUtilTimeout`.
- `no-hex-colors.test.ts` strips only `/* */` comments — issue references in CSS go in block comments.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. Never `git add -A`.
- Record each ruling as `Ruling: … — why — cost if wrong` in `.superpowers/sdd/phase-7a/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree (**a merge to `main` is the owner's**), or a plan so broken every path is a guess.

## Review Focus

1. **A published attempt resolving against a profile whose defaults changed after publication** — `Q1`'s stated cost. The frozen version's stored overrides must win; resolving a published attempt must never read today's defaults table for a field the document pins. Task 1.
2. **An override object with `undefined` for a key versus the key absent** — JSON import, a partial `PATCH`, and `structuredClone` all produce different shapes here, and `??` and `||` disagree on `0`. `snapshot_interval_seconds: 0` is now *meaningful* (`Q11`), so a `||` anywhere in resolution silently turns "off" back into the profile default. Task 1.
3. **An attempt whose `flag` is already `"scoring_blocked"` when the integrity flag is first computed** — `submit.ts:357` writes it, and `Q6`'s recompute must not erase it. The columns are separate for this reason; the test proves they are. Task 3.
4. **A test document imported with `face_check: true`** — `Q3` pre-cut the control, so the field validates and round-trips while enforcing nothing. Import must not reject it, resolution must not drop it, and nothing downstream may act on it. Task 2.
5. **A candidate reaching the landing payload for a test with no proctoring block at all** — `proctoring` is optional in the schema and most existing fixtures omit it. The resolved object must come back as fully-populated Off, not as `undefined` reaching `exam.tsx`. Task 4.

---

### Task 1: `resolveProctoring()` and the defaults table

**Files:**
- Create: `packages/core/src/proctoring.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/proctoring.test.ts`

**Interfaces:**
- Produces:

```ts
export type ProctoringProfile = "off" | "standard" | "strict";
export type ViolationAction = "warn_only" | "warn_then_flag" | "auto_submit" | "lock";

/** Every field present, no optionals. This is what every reader consumes. */
export interface ResolvedProctoring {
  profile: ProctoringProfile;
  desktopOnly: boolean;
  requireFullscreen: boolean;
  blockCopyPaste: boolean;
  watermark: boolean;
  requireCamera: boolean;
  identityPhoto: boolean;
  /** 0 means off — no capture timer, no uploads, no rows (`Q11b`). */
  snapshotIntervalSeconds: number;
  /** Always resolves false in Phase 7: the control is pre-cut (`Q3`). */
  faceCheck: boolean;
  requireMicrophone: boolean;
  extraMonitorCheck: boolean;
  violationLimit: number;
  violationAction: ViolationAction;
  cameraOutageSeconds: number;
  multiFaceSnapshots: number;
  allowCalculator: boolean;
}

export type ProctoringOverrides = Partial<{
  desktop_only: boolean; require_fullscreen: boolean; block_copy_paste: boolean;
  watermark: boolean; require_camera: boolean; identity_photo: boolean;
  snapshot_interval_seconds: number; face_check: boolean; require_microphone: boolean;
  extra_monitor_check: boolean; violation_limit: number; violation_action: ViolationAction;
  camera_outage_seconds: number; multi_face_snapshots: number; allow_calculator: boolean;
}>;

export const PROCTORING_DEFAULTS: Readonly<Record<ProctoringProfile, ResolvedProctoring>>;

export function resolveProctoring(
  input: { profile?: ProctoringProfile; overrides?: ProctoringOverrides } | undefined,
): ResolvedProctoring;

/** `Q1b`: plain sentences for the start page, from the same object the runtime enforces. */
export function proctoringRequirements(resolved: ResolvedProctoring): string[];
```

**`Q1`** — `profile` supplies defaults and has no independent effect. No reader branches on `profile`.

**The defaults table**, which this task fixes and later plans only read:

| override | off | standard | strict |
| --- | --- | --- | --- |
| `desktop_only` | false | **true** | **true** |
| `require_fullscreen` | false | **true** | **true** |
| `block_copy_paste` | false | **true** | **true** |
| `watermark` | false | false | **true** |
| `require_camera` | false | false | **true** |
| `identity_photo` | false | false | **true** |
| `snapshot_interval_seconds` | 0 | 0 | **60** |
| `face_check` | false | false | false |
| `require_microphone` | false | false | false |
| `extra_monitor_check` | false | false | **true** |
| `violation_limit` | 5 | 5 | 5 |
| `violation_action` | `warn_only` | `warn_then_flag` | `warn_then_flag` |
| `camera_outage_seconds` | 120 | 120 | 120 |
| `multi_face_snapshots` | 2 | 2 | 2 |
| `allow_calculator` | false | false | false |

**Ruling — Strict does not default to `lock`.** `P-09` leaves the default action unspecified. `Q5` ships `lock` with only "an organiser opens the attempt" as the way out, and `Q2` already blocks a Strict attempt indefinitely on a dead camera. Defaulting Strict to `lock` would stack the phase's two sharpest edges on an organiser who picked a preset. `lock` is opt-in. *Cost if wrong:* an organiser who wanted Strict to mean "locks on abuse" must set one more control, and the panel's summary row states the action, so they can see it is not set.

**Ruling — `face_check` resolves false under every profile.** `Q3` pre-cut it. The field is accepted and round-tripped (Task 2) so a document authored for Phase 8 survives; resolution refuses it so nothing in Phase 7 can act on it. *Cost if wrong:* an organiser setting `face_check: true` gets no face counting and no error. The panel ships the control disabled with copy naming the phase (7b), which is where they learn it.

- [ ] **Step 1: Write the failing tests**

```ts
describe("resolveProctoring", () => {
  it("returns fully-populated Off for undefined", () => {
    expect(resolveProctoring(undefined)).toEqual(PROCTORING_DEFAULTS.off);
  });

  it("returns fully-populated Off for an empty object", () => {
    expect(resolveProctoring({})).toEqual(PROCTORING_DEFAULTS.off);
  });

  it("takes defaults from the profile", () => {
    const r = resolveProctoring({ profile: "strict" });
    expect(r.requireCamera).toBe(true);
    expect(r.snapshotIntervalSeconds).toBe(60);
    expect(r.violationAction).toBe("warn_then_flag");
  });

  // Review Focus 2 — the `||` trap. 0 is a value, not an absence.
  it("honours snapshot_interval_seconds: 0 as off against a profile that sets 60", () => {
    const r = resolveProctoring({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } });
    expect(r.snapshotIntervalSeconds).toBe(0);
  });

  it("honours false against a profile default of true", () => {
    const r = resolveProctoring({ profile: "strict", overrides: { desktop_only: false } });
    expect(r.desktopOnly).toBe(false);
  });

  it("treats an explicit undefined exactly as an absent key", () => {
    const explicit = resolveProctoring({ profile: "strict", overrides: { watermark: undefined } });
    expect(explicit).toEqual(resolveProctoring({ profile: "strict" }));
  });

  // Q3 — pre-cut.
  it("resolves faceCheck false even when the document asks for it", () => {
    expect(resolveProctoring({ profile: "strict", overrides: { face_check: true } }).faceCheck).toBe(false);
  });

  it("has no undefined on any key for any profile", () => {
    for (const profile of ["off", "standard", "strict"] as const) {
      for (const [k, v] of Object.entries(resolveProctoring({ profile }))) {
        expect(v, k).not.toBeUndefined();
      }
    }
  });
});

describe("proctoringRequirements", () => {
  it("names the camera and the images for Strict", () => {
    const lines = proctoringRequirements(resolveProctoring({ profile: "strict" }));
    expect(lines.join(" ")).toMatch(/camera/i);
    expect(lines.join(" ")).toMatch(/every 60 seconds/i);
  });

  it("is empty for Off", () => {
    expect(proctoringRequirements(resolveProctoring({ profile: "off" }))).toEqual([]);
  });

  it("omits images when the interval is 0 but keeps the camera line", () => {
    const lines = proctoringRequirements(
      resolveProctoring({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } }),
    );
    expect(lines.join(" ")).toMatch(/camera/i);
    expect(lines.join(" ")).not.toMatch(/every/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/core/test/proctoring.test.ts`
Expected: FAIL — `resolveProctoring` is not exported.

- [ ] **Step 3: Implement `packages/core/src/proctoring.ts`**

Resolution reads each key with `in`-presence and an `undefined` check — **never `||`, and never `??` on a key that may legitimately be `0` or `false`**. Export from `packages/core/src/index.ts` beside the other `export *` lines.

`proctoringRequirements` returns one sentence per *enabled* requirement, in the fixed order: desktop, browser, fullscreen, camera, identity photo, images, microphone, extra monitor. A disabled control contributes no line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/proctoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proctoring.ts packages/core/src/index.ts packages/core/test/proctoring.test.ts
git commit -m "feat(core): resolve proctoring from a profile and its overrides"
```

---

### Task 2: three new overrides, one relaxed minimum, and the ADR

**Files:**
- Modify: `schemas/test-1.json:184-209`
- Create: `docs/adr/0011-proctoring-overrides-grow-by-three.md`
- Modify: `docs/test-format.md` (the `proctoring.overrides` table)
- Test: `apps/api/test/export/test-round-trip.test.ts`

**Interfaces:**
- Consumes: `ProctoringOverrides` from Task 1 — the schema and the type must name the same fifteen keys.
- Produces: a `proctoring` block that round-trips through import, clone and export with the three new keys intact.

**`Q6`** — `camera_outage_seconds` and `multi_face_snapshots` are the two thresholds `P-10` names and the schema lacks. **`Q12`** — `require_microphone`. **`Q11`** — `snapshot_interval_seconds` relaxes from `minimum: 15` to `minimum: 0`, where 0 means off, making "camera on, one identity photo, then stop" expressible for the first time.

The ADR records why the block grew under `additionalProperties: false` without a format bump: three *optional* keys on an *override* object are additive — a `pariksha/test@1` document written before them still validates, and one written after them still validates against a reader that ignores them, because every key is already optional and resolution supplies the default. A `minimum` that *widens* admits documents the old schema rejected and rejects none it accepted.

- [ ] **Step 1: Write the failing test**

Add to `apps/api/test/export/test-round-trip.test.ts`:

```ts
it("round-trips the three overrides Phase 7 adds, including 0 as off", async () => {
  const doc = testFixture({
    proctoring: {
      profile: "strict",
      overrides: {
        snapshot_interval_seconds: 0,
        camera_outage_seconds: 90,
        multi_face_snapshots: 3,
        require_microphone: true,
        face_check: true, // Review Focus 4: accepted, round-tripped, never acted on
      },
    },
  });
  const exported = await roundTrip(doc);
  expect(exported.proctoring).toEqual(doc.proctoring);
});

it("rejects a negative snapshot interval", async () => {
  await expect(importTest(testFixture({
    proctoring: { profile: "strict", overrides: { snapshot_interval_seconds: -1 } },
  }))).rejects.toThrow(/snapshot_interval_seconds/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/api/test/export/test-round-trip.test.ts -t "three overrides"`
Expected: FAIL — the schema rejects the unknown keys under `additionalProperties: false`.

- [ ] **Step 3: Add the three keys and relax the minimum in `schemas/test-1.json`**

`camera_outage_seconds`: integer, `minimum: 1`. `multi_face_snapshots`: integer, `minimum: 1`. `require_microphone`: boolean. `snapshot_interval_seconds`: `minimum: 0`, with a `description` naming 0 as off.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run apps/api/test/export/test-round-trip.test.ts`
Expected: PASS

- [ ] **Step 5: Write ADR 0011 and update `docs/test-format.md`'s overrides table**

The ADR's decision is the paragraph above; its consequence is that Phase 8 may add a fourth optional override the same way, and that a *required* key or a *narrowed* constraint would need the bump this one does not.

- [ ] **Step 6: Commit**

```bash
git add schemas/test-1.json docs/adr/0011-proctoring-overrides-grow-by-three.md docs/test-format.md apps/api/test/export/test-round-trip.test.ts
git commit -m "feat(schema): three proctoring overrides, and 0 means no snapshots"
```

---

### Task 3: `integrity_flag` and `observed` on `attempt`

**Files:**
- Modify: `packages/db/src/schema/sqlite.ts:240-260`, `packages/db/src/schema/pg.ts`
- Create: `packages/db/migrations/sqlite/0008_attempt_integrity.sql`, `packages/db/migrations/pg/0008_attempt_integrity.sql`
- Test: `packages/db/test/parity.test.ts`, `packages/db/test/repo/attempts.test.ts`

**Interfaces:**
- Produces: `attempt.integrityFlag: "clean" | "review" | "high_risk"` (NOT NULL, default `"clean"`) and `attempt.observed: boolean` (NOT NULL, default true). Consumed by 7e's `Q6` computation and 7b's panel copy.

**`Q6`** — integrity is a different axis from grading. `attempt.flag` is `NOT NULL` and `submit.ts:357` already writes `"scoring_blocked"` into it on a `bounded.ts` refusal; overloading one column would mean every integrity recompute risks erasing a grading state.

- [ ] **Step 1: Write the failing tests**

```ts
// Review Focus 3 — the two axes are independent.
it("keeps a scoring_blocked flag through an integrity update", async () => {
  const id = await seedAttempt({ flag: "scoring_blocked" });
  await setIntegrity(db, workspaceId, { attemptId: id, integrityFlag: "high_risk", observed: false });
  const row = await readAttempt(db, workspaceId, id);
  expect(row.flag).toBe("scoring_blocked");
  expect(row.integrityFlag).toBe("high_risk");
  expect(row.observed).toBe(false);
});

it("defaults a fresh attempt to clean and observed", async () => {
  const row = await readAttempt(db, workspaceId, await seedAttempt({}));
  expect(row.integrityFlag).toBe("clean");
  expect(row.observed).toBe(true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/db/test/repo/attempts.test.ts -t integrity`
Expected: FAIL — no such column.

- [ ] **Step 3: Write both migrations and both schema definitions**

SQLite/D1: `ALTER TABLE attempt ADD COLUMN integrity_flag TEXT NOT NULL DEFAULT 'clean';` and `ADD COLUMN observed INTEGER NOT NULL DEFAULT 1;` — two statements, because D1 takes one `ADD COLUMN` per `ALTER`. Postgres: the same two columns with `BOOLEAN NOT NULL DEFAULT TRUE`.

Add `setIntegrity` to `packages/db/src/repo/attempts.ts` beside `appendEvents`, through the same `scoped()` wrapper so it cannot write without a workspace id.

- [ ] **Step 4: Run the migration, parity and hostile-SQL suites**

Run: `npx vitest run packages/db/test/parity.test.ts packages/db/test/no-d1-hostile-sql.test.ts packages/db/test/migrate.test.ts packages/db/test/repo/attempts.test.ts`
Expected: PASS on all four.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src packages/db/migrations packages/db/test
git commit -m "feat(db): integrity_flag and observed on attempt, three dialects"
```

---

### Task 4: convert the three `profile` readers

**Files:**
- Modify: `apps/api/src/routes/run.ts:64-80,141-161`
- Modify: `apps/web/src/lib/run.ts:34`
- Modify: `apps/web/src/routes/exam.tsx:111,193`
- Test: `apps/api/test/run/scrub-scan.test.ts`, `apps/web/test/exam/start-requirements.test.tsx`

**Interfaces:**
- Consumes: `resolveProctoring`, `proctoringRequirements`, `ResolvedProctoring` (Task 1).
- Produces: `LandingPayload.proctoring: { profile: ProctoringProfile; requirements: string[] }` — replacing the bare `ProctoringProfile`. 7c and 7d read `requirements` for the start page and the resolved object from `GET /api/v1/run/attempt`.

**§3** — `routes/run.ts:141` reads `profile` and ships it; `lib/run.ts:34` types it; `exam.tsx:111,193` renders it through `PROCTORING_LABEL`, **branching on `profile`**, which is what `Q1` forbids. `routes/run.ts:64`'s comment ("not modelled in `@pariksha/core`") is now false and goes with it.

**`Q1b`** — the start page shows the requirements the runtime will enforce, from the same object, so a candidate who will be denied for having no camera learns it before the timer.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/test/exam/start-requirements.test.tsx — D14: start at ExamApp, click there.
it("lists Strict's requirements on the start page", async () => {
  await openCandidateLanding({ proctoring: { profile: "strict", requirements: [
    "A laptop or desktop computer.", "A working camera, on for the whole test.",
  ] } });
  expect(await screen.findByText(/A working camera, on for the whole test\./)).toBeVisible();
});

// Review Focus 5 — most fixtures have no proctoring block at all.
it("shows no requirements and no error when the test has no proctoring block", async () => {
  await openCandidateLanding({ proctoring: { profile: "off", requirements: [] } });
  expect(screen.queryByRole("list", { name: /requirements/i })).toBeNull();
});
```

```ts
// apps/api/test/run/scrub-scan.test.ts — the payload changed shape, so replay the scan.
it("ships requirements as sentences and never an override object", async () => {
  const body = await landing({ proctoring: { profile: "strict", overrides: { violation_limit: 3 } } });
  expect(body.proctoring.requirements.every((s: unknown) => typeof s === "string")).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/violation_limit/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx turbo run test --filter=@pariksha/api --filter=@pariksha/web -- -t "requirements"`
Expected: FAIL — `requirements` is not on the payload.

- [ ] **Step 3: Replace the payload field and delete `PROCTORING_LABEL`**

`routes/run.ts` calls `resolveProctoring` on the stored settings and ships `{ profile, requirements: proctoringRequirements(resolved) }`. The **resolved object itself is not shipped to the landing page** — only the profile name and the sentences; the enforcement object rides `GET /api/v1/run/attempt`, which is `attempt`-authority. `exam.tsx` renders `requirements` as a list and the local `ProctoringProfile` type and `PROCTORING_LABEL` map are deleted.

- [ ] **Step 4: Run the full scrub scan and the web suite**

Run: `npx vitest run apps/api/test/run/scrub-scan.test.ts && npx turbo run test --filter=@pariksha/web`
Expected: PASS. The scan's endpoint count is unchanged — this task adds no route.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/run.ts apps/web/src/lib/run.ts apps/web/src/routes/exam.tsx apps/api/test apps/web/test
git commit -m "refactor(run): the landing payload carries requirements, not a profile to switch on"
```

---

### Task 5: the closed event vocabulary

**Files:**
- Modify: `packages/core/src/proctoring.ts`
- Test: `packages/core/test/proctoring.test.ts`

**Interfaces:**
- Produces:

```ts
export const PROCTORING_EVENTS = [
  "fullscreen_exit", "fullscreen_restore",
  "window_blur", "visibility_hidden",
  "copy_blocked", "paste_blocked", "contextmenu_blocked",
  "extra_monitor", "camera_lost", "camera_restored",
  "identity_photo_captured", "noise_above_threshold",
  "proctoring_unavailable", "snapshot_failed",
  "violation_limit_reached", "attempt_locked", "attempt_unlocked",
] as const;
export type ProctoringEventType = (typeof PROCTORING_EVENTS)[number];

/** `Q2`: the subset that counts toward `violation_limit`. */
export const VIOLATION_EVENTS: ReadonlySet<ProctoringEventType>;
/** `Q6b`: the subset that marks an attempt unobserved rather than suspicious. */
export const FAILURE_EVENTS: ReadonlySet<ProctoringEventType>;
export function isViolation(type: ProctoringEventType): boolean;
```

**`Q7b`** — a closed string union, so Phase 8's monitor and CSV have something to switch on. **`Q2`** — the violation/failure split lives here, once, rather than being re-derived by the counter and the flag separately.

`VIOLATION_EVENTS`: `fullscreen_exit`, `window_blur`, `visibility_hidden`, `copy_blocked`, `paste_blocked`, `contextmenu_blocked`, `extra_monitor`, `camera_lost`.
`FAILURE_EVENTS`: `proctoring_unavailable`, `snapshot_failed`.
Neither: the four restore/capture/lifecycle types and `noise_above_threshold`.

**Ruling — `noise_above_threshold` is neither a violation nor a failure in Phase 7.** It is recorded and shown, and it does not count toward a limit or an integrity flag. A microphone threshold that auto-submits an attempt because a door slammed is the kind of false positive `AG1` exists to prevent, and nothing in `P-01`–`P-10` asks for it. *Cost if wrong:* an organiser who wants noise to count cannot have it; the event is on the attempt, so they can see it and judge.

- [ ] **Step 1: Write the failing tests**

```ts
it("classifies every event type exactly once as violation, failure or neither", () => {
  for (const t of PROCTORING_EVENTS) {
    expect([VIOLATION_EVENTS.has(t), FAILURE_EVENTS.has(t)].filter(Boolean).length, t)
      .toBeLessThanOrEqual(1);
  }
});

it("counts a camera loss as a violation and an upload failure as a failure", () => {
  expect(isViolation("camera_lost")).toBe(true);
  expect(isViolation("snapshot_failed")).toBe(false);
  expect(FAILURE_EVENTS.has("snapshot_failed")).toBe(true);
});

it("does not count noise toward a limit", () => {
  expect(isViolation("noise_above_threshold")).toBe(false);
  expect(FAILURE_EVENTS.has("noise_above_threshold")).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run packages/core/test/proctoring.test.ts -t event`
Expected: FAIL — `PROCTORING_EVENTS` is not exported.

- [ ] **Step 3: Add the union and the two sets to `packages/core/src/proctoring.ts`**

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run packages/core/test/proctoring.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/proctoring.ts packages/core/test/proctoring.test.ts
git commit -m "feat(core): the closed proctoring event vocabulary and its violation split"
```

---

### Task 6: the advisory checklist rows

**Files:**
- Modify: `apps/api/src/publish/checklist.ts:151-330`
- Test: `apps/api/test/publish/checklist.test.ts`

**Interfaces:**
- Consumes: `resolveProctoring` (Task 1), `buildChecklist(input: ChecklistInput): ChecklistRow[]` as it stands.
- Produces: three advisory rows, reachable from both `GET …/checklist` and `POST …/publish` because both already call the one function.

**`Q1c`** — Phase 7 adds **no blocking row**. The rows:

1. `proctoring_strict_no_camera` — Strict with `require_camera` false. *"Strict without a camera requirement observes nothing a candidate can see."*
2. `proctoring_snapshot_cost` — fires when images per candidate exceed 200. Text states the figure the organiser is choosing: *"≈ 720 images · ≈ 18 MB · ≈ 720 uploads per candidate."*
3. `proctoring_lock_without_recourse` — `violation_action` is `lock`. *"A locked attempt clears only when an organiser opens it. Phase 8 adds the monitor."*

**`Q11`** — the cost row names uploads beside megabytes, because requests are the ceiling that stops a test and bytes are the cost an organiser pays.

- [ ] **Step 1: Write the failing tests**

```ts
it("advises on Strict without a camera, and never blocks", () => {
  const rows = buildChecklist(input({ proctoring: { profile: "strict", overrides: { require_camera: false } } }));
  const row = rows.find((r) => r.id === "proctoring_strict_no_camera");
  expect(row?.severity).toBe("advisory");
  expect(blockingRows(rows)).toHaveLength(0);
});

it("states images, megabytes and uploads per candidate on an expensive configuration", () => {
  const rows = buildChecklist(input({
    durationMinutes: 180,
    proctoring: { profile: "strict", overrides: { snapshot_interval_seconds: 15 } },
  }));
  expect(rows.find((r) => r.id === "proctoring_snapshot_cost")?.message)
    .toMatch(/720 images.*18 MB.*720 uploads/);
});

it("is silent about cost when snapshots are off", () => {
  const rows = buildChecklist(input({
    proctoring: { profile: "strict", overrides: { snapshot_interval_seconds: 0 } },
  }));
  expect(rows.find((r) => r.id === "proctoring_snapshot_cost")).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/api/test/publish/checklist.test.ts -t proctoring`
Expected: FAIL — no such rows.

- [ ] **Step 3: Add the three rows to `buildChecklist`**

Image count is `floor(durationMinutes * 60 / snapshotIntervalSeconds)` when the interval is non-zero, plus one when `identity_photo` is set. Megabytes use the 25 KB that `Tail.tsx:125` already states publicly (`Q11a`).

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run apps/api/test/publish/checklist.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/publish/checklist.ts apps/api/test/publish/checklist.test.ts
git commit -m "feat(publish): three advisory proctoring rows, including what the images cost"
```

---

## Done when

`resolveProctoring` is the only thing in the tree that knows what a profile means; no reader branches on `profile`; `attempt` carries integrity on its own two columns across three dialects; the event vocabulary is closed; the checklist states the cost; and `scrub-scan`, `parity`, `no-d1-hostile-sql` and `budget` are all green with no bar moved.
