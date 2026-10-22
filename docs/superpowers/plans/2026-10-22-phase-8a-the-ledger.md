# Phase 8a — The Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every later Phase 8 plan one scoring path, one counted figure, one CSV writer, one cost estimator and one migration — and close the two Phase 6 defects that live in the files this plan already opens.

**Architecture:** The 60-line scoring block inside `submitAttempt` becomes `rescoreAttempt()`, which submit, grading and regrade all call. Four new pure functions land in `@pariksha/core` (`countedScore`, `toCsv`, `csvFilename`, `estimateCost`) because two or three surfaces consume each and the phase's own anti-goal is two surfaces disagreeing. One migration, `0010`, carries everything schema-shaped the whole phase needs. `scheduled` ships as an empty, tested job registry so three parallel plans can each register one job without owning the file.

**Tech Stack:** TypeScript (strict), Vitest, Drizzle (D1 / SQLite / Postgres), Hono, Preact/React.

**Spec:** [`../specs/2026-10-22-phase-8-results-design.md`](../specs/2026-10-22-phase-8-results-design.md) — `K5`, `K6`, `K7`, `K8`, `K9`, `K10`, `K12`, `K27`, `K28`, `K32`, `K33`, `K35`, `K36`, `K38`, `K41`, `K42`, `KG6`, `KG8`.

**Depends on:** nothing. First plan of the phase, and the only one with no predecessor.

**Goals covered:** none on its own — it is the floor `G1`–`G6` are built on.

## Global Constraints

Every task's requirements implicitly include this section.

- **`K9`** — no route issues a query per attempt, per candidate or per question. Every new route gets a **measured** `ROUTE_BUDGETS` entry (`countingDeps`) against a **300-candidate** fixture, and a `ROUTE_AUTH` declaration. `budget.test.ts` and `routeAuthorities()` read the live route table; a route without both fails CI.
- **`K36`** — no cost figure, in any payload or any screen, when `env.target === "node"`. The API **omits the field**; it does not send a null.
- Migrations are written for D1, SQLite **and** Postgres. **Five files, not two:** both dialect `.sql` files, both modules in `packages/db/src/schema/`, `columns.ts`'s `TABLE_MANIFEST`, and `migrations.generated.ts` regenerated with `node packages/db/scripts/bundle-migrations.mjs` (never by hand). Plus `apps/api/test/worker.test.ts`'s hard-coded filename list and `migrations: N` count.
- **D1 takes one `ADD COLUMN` per `ALTER`**, statements separated by `--> statement-breakpoint`. SQLite refuses `ADD … NOT NULL` without a literal `DEFAULT`. **No `PRAGMA` of any kind.**
- `apps/api`'s test script is `vitest run && vitest run -c vitest.workers.config.ts`. **`worker.test.ts` runs only under the second.** A focused run can be entirely green while the branch is red.
- A **stale `dist/`** in `@pariksha/core` or `@pariksha/db` makes a new export import as `undefined` through the package boundary, failing far from its cause. Before debugging anything of that shape, and on **both** sides of every probe: `SITE_URL='https://pariksha.example' npx turbo run build --filter=@pariksha/core --filter=@pariksha/db`.
- `pnpm build` needs `SITE_URL`. **`pnpm test --force` does not work** — use `npx turbo run test --force --concurrency=1`. Full-suite runs use **`--no-file-parallelism`**.
- Coverage gates live in **CI, not in the suite**. Moving code into `packages/core` without moving its tests drops the gate below 100% functions and nothing local tells you. `AG5`: fix the coverage, never the threshold.
- **Every negative assertion needs a positive control beside it.** `expect(queryBy…).toBeNull()` and `expect(grepSource(…)).toEqual([])` are the exact shapes that shipped vacuous three times in 7c.
- **Never create a git worktree.** Three fixed clones only. Read a frozen commit with `git show <sha>:<path>`.
- Git identity is `Satya K <srisatyalokesh2.12@gmail.com>`. **Never `git add -A`** — untracked notes live in these trees.
- **Commit as soon as you have something coherent, then refine.** An uncommitted implementer tree is unrecoverable.
- Record each ruling as `Ruling: <what> — <why> — <cost if wrong>` in `.superpowers/sdd/phase-8a/progress.md`.
- **Stop and ask** for: an irreversible operation, a security-sensitive action, a side effect outside the worktree, or a plan so broken every path forward is a guess.

## Review Focus

1. **An attempt whose `flag` is already `"scoring_blocked"` when it is rescored.** `submit.ts` writes it on a `bounded.ts` refusal. `rescoreAttempt` is now called by grading and regrade too, and neither may erase it — the columns are separate for exactly this reason. Task 2.
2. **A rescore of an attempt containing a question deleted since submission.** `blockedQuestions` finds it, `rescoreAttempt` must null it before grading or `scoring.mode: "negative"` takes marks off for a question that no longer exists, and `pending` must carry it. The original code gets this right; the extraction must not lose it. Task 2.
3. **A candidate on attempt 2 of 3 under `counted_attempt: "highest"` and `release.show: "score_only"`.** `K7` suppresses the counted figure while attempts remain, because `release.ts` deliberately refused to disclose a prior attempt's score mid-series. The suppression is the test, and a positive control on the last attempt is what proves the query is real. Task 3.
4. **A CSV cell containing a comma, a double quote, a newline and a non-Latin name, all at once.** `AC-27` is explicit about Excel opening it correctly. One cell carrying all four is the only honest test of RFC 4180 quoting plus the BOM. Task 4.
5. **A test with `duration_minutes` unset reaching the cost estimator and the publish checklist.** `snapshotCost` already returns `null` for it; `estimateCost` must not turn that `null` into a `0` that reads as "free". `#179` makes the same document unpublishable in the same plan — the two must agree about what an absent duration means. Tasks 5 and 8.

---

### Task 1: Migration `0010`

**Files:**
- Create: `packages/db/migrations/sqlite/0010_results_and_delivery.sql`
- Create: `packages/db/migrations/pg/0010_results_and_delivery.sql`
- Modify: `packages/db/src/schema/sqlite.ts`, `packages/db/src/schema/pg.ts`
- Modify: `packages/db/src/schema/columns.ts` (`TABLE_MANIFEST`)
- Modify: `packages/db/src/migrations.generated.ts` (regenerate, never hand-edit)
- Modify: `apps/api/test/worker.test.ts` (the filename list and the `migrations: N` count)
- Test: `packages/db/test/parity.test.ts`, `migrate.test.ts`, `migrations-bundle.test.ts` (existing, must stay green)

**Interfaces:**
- Produces: the `webhook_delivery` table, `attempt.proctor_message`, `attempt.proctor_message_at`, and an index on `response(workspace_id, question_id)`. Consumed by 8b (`K42`'s index), 8c (`K42`'s index), 8d (`webhook_delivery`) and 8g (the two `attempt` columns).

**`K10`** — this is the phase's **only** migration, and it is `0010` because 7e takes `0009`. **Whichever of 7e and this lands second yields and renumbers.** Say so in the migration's own header comment.

**`K42`** — the index is here rather than in 8b or 8c because both need it and both run in parallel; a later plan discovering it needs schema is the renumbering `K10` exists to prevent.

The three additions, with the reason each is in this file:

| addition | shape | for |
| --- | --- | --- |
| `webhook_delivery` | tenant table: `webhook_id`, `event`, `payload_json`, `attempt_count` (int), `next_attempt_at` (ts), `last_status` (int, null), `last_error` (text, null), `delivered_at` (ts, null), `created_at` (ts). Indexes `["workspace_id"]`, `["next_attempt_at"]` | 8d's drain (`K22`) |
| `attempt.proctor_message` | `text`, **nullable** | 8g's broadcast (`K12`) |
| `attempt.proctor_message_at` | `ts`, **nullable** | 8g's broadcast (`K12`) |
| index on `response` | `["workspace_id", "question_id"]` | 8b's by-question grading, 8c's option pick rates (`K42`) |

Both `attempt` columns are nullable, so neither needs a `DEFAULT` and neither raises a backfill question. `next_attempt_at` is indexed because the drain's only query is "deliveries due before now".

- [ ] **Step 1: Write the failing manifest test**

In `packages/db/test/parity.test.ts`'s existing style — it compares **three** sources (both dialect modules and `TABLE_MANIFEST`), and a column present in two of three fails it. Add nothing new; the existing test fails as soon as the manifest and the modules disagree, which is the point.

Add to `packages/db/test/schema.test.ts` (or the nearest existing manifest test):

```ts
it("0010 adds webhook_delivery and the two broadcast columns", () => {
  const names = TABLE_MANIFEST.map((t) => t.name);
  expect(names).toContain("webhook_delivery");

  const attempt = TABLE_MANIFEST.find((t) => t.name === "attempt");
  const cols = attempt?.columns.map((c) => c.name) ?? [];
  expect(cols).toContain("proctor_message");
  expect(cols).toContain("proctor_message_at");

  const response = TABLE_MANIFEST.find((t) => t.name === "response");
  expect(response?.indexes).toContainEqual(["workspace_id", "question_id"]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/db && npx vitest run test/schema.test.ts -t "0010"`
Expected: FAIL — `webhook_delivery` is not in the manifest.

- [ ] **Step 3: Write both `.sql` files**

One `ADD COLUMN` per `ALTER TABLE`, `--> statement-breakpoint` between statements, no `PRAGMA`. The Postgres sibling uses the same defaults so the dialects agree. Use the `ColumnClass` vocabulary from `columns.ts` (`bool` is SQLite `integer` / Postgres `boolean`).

- [ ] **Step 4: Add the table and columns to both dialect modules and to `TABLE_MANIFEST`**

Three sources, as `parity.test.ts` requires.

- [ ] **Step 5: Regenerate the bundle**

Run: `node packages/db/scripts/bundle-migrations.mjs`
Never hand-edit `migrations.generated.ts`; `migrations-bundle.test.ts` asserts it is byte-identical to the generator's output.

- [ ] **Step 6: Extend `worker.test.ts`'s filename list and count**

Both are deliberately literal ("Named, not counted"). Extend them; never make them dynamic. **This is also the only guard against a duplicate `0010` from a parallel branch** — `migrations-bundle.test.ts` does *not* catch that (`K10`).

- [ ] **Step 7: Run the full db suite, both api configs, and the free Cloudflare checks**

Run: `cd packages/db && npx vitest run --no-file-parallelism`
Run: `cd apps/api && npx vitest run -c vitest.workers.config.ts`
Run: `node deploy/cloudflare/setup.mjs --dry-run`

The dry run exercises the whole setup flow twice against an in-memory Cloudflare and asserts the
second run is a no-op — it is how a migration is proved without touching the account. **Never run
`setup.mjs` without `--dry-run`**: that one applies migrations to the production database.
Expected: PASS. `migrate.test.ts` executes the SQL against real SQLite, which rejects exactly what D1 rejects — it is what catches a merged `ALTER TABLE … ADD COLUMN a, ADD COLUMN b` that `no-d1-hostile-sql.test.ts` (a `PRAGMA` grep) does not.

- [ ] **Step 8: Probe — prove `migrate.test.ts` catches a merged ALTER**

Merge the two `attempt` `ADD COLUMN`s into one `ALTER TABLE`. Run `migrate.test.ts`. Record the verbatim failure line in the ledger. Restore. **No probe appears in a commit.**

- [ ] **Step 9: Commit**

```bash
git add packages/db/migrations packages/db/src/schema packages/db/src/migrations.generated.ts packages/db/test apps/api/test/worker.test.ts
git commit -m "feat(db): 0010 — webhook_delivery, the broadcast columns and the response index (K10, K12, K42)"
```

---

### Task 2: `rescoreAttempt()` — one scoring path

**Files:**
- Create: `apps/api/src/run/rescore.ts`
- Modify: `apps/api/src/run/submit.ts:288-348` (replace the block with a call)
- Test: `apps/api/test/run/rescore.test.ts`
- Test: `apps/api/test/run/submit.test.ts` (existing — must stay green unchanged, which is the proof the extraction is behaviour-preserving)

**Interfaces:**
- Consumes: `scoreAttempt`, `AttemptScore` (`@pariksha/core`); `liveQuestions`, `blockedQuestions`, `scoringOf`, `defaultsOf` (existing in `apps/api/src/run/`).
- Produces:

```ts
export interface RescoreResult {
  /** null when the grading engine threw — the attempt is stamped with no
   *  score and `blocked` carries `{ questionId: "*", reason }`. */
  score: AttemptScore | null;
  blocked: { questionId: string; reason: string }[];
}

export async function rescoreAttempt(
  deps: AppDeps,
  input: {
    workspaceId: string;
    layout: PinnedLayout;
    settings: unknown;
    responses: Record<string, ResponseValue | null>;
    awards: Record<string, RubricAward>;
  },
): Promise<RescoreResult>;
```

Consumed by 8b (grading, `K14`; regrade, `K17`).

**`K5`** — `submitAttempt` calls this with `awards: {}`. Phase 8 adds **no second place** where an `AttemptScore` is produced.

The four behaviours the extraction must preserve, each already correct in `submit.ts` and each with a test here:

1. A blocked question is nulled **before** grading, never handed to the grader.
2. A blocked question still counts toward `max` and still costs its points.
3. A throw out of the engine returns `score: null` and a `{ questionId: "*" }` blocked entry — never a 500.
4. `pending` is the union of `scoreAttempt`'s own pending list and the blocked ids, deduplicated.

- [ ] **Step 1: Write the failing tests**

```ts
describe("rescoreAttempt", () => {
  it("never hands a blocked question to the grader", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked("q2"));
    // negative mode would take marks off a graded-wrong q2; nulled, it cannot
    expect(score?.perQuestion.q2.points).toBe(0);
  });

  it("keeps a blocked question's points in max", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked("q2"));
    expect(score?.max).toBe(THREE_QUESTION_MAX);
  });

  it("lists a blocked question as pending", async () => {
    const { score } = await rescoreAttempt(deps, withBlocked("q2"));
    expect(score?.pending).toContain("q2");
  });

  it("returns score null and a '*' blocked entry when the engine throws", async () => {
    const { score, blocked } = await rescoreAttempt(deps, withThrowingQuestion());
    expect(score).toBeNull();
    expect(blocked).toContainEqual({ questionId: "*", reason: expect.stringContaining("threw") });
  });

  it("applies a rubric award to a manual question and drops it from pending", async () => {
    // RubricAward is { levels: string[] } — level names from the question's
    // own `rubric` array, never a raw points number. gradeManual resolves
    // the points; a level the question does not define is worth nothing.
    const { score } = await rescoreAttempt(deps, { ...base, awards: { q3: { levels: ["thorough"] } } });
    expect(score?.perQuestion.q3.points).toBe(4);
    expect(score?.pending).not.toContain("q3");
  });

  it("leaves an ungraded manual question pending", async () => {
    const { score } = await rescoreAttempt(deps, { ...base, awards: {} });
    expect(score?.pending).toContain("q3");
  });
});
```

The last two are the new capability — `submit.ts` has only ever passed `{}`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/api && npx vitest run test/run/rescore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Move the block into `rescore.ts` and call it from `submit.ts`**

A move, not a rewrite. Carry the existing comments with it — they explain why a blocked question is nulled and why a throw is not a 500, and both reasons outlive the move.

- [ ] **Step 4: Run both suites**

Run: `cd apps/api && npx vitest run test/run/rescore.test.ts test/run/submit.test.ts`
Expected: PASS, with `submit.test.ts` **unchanged**. If a submit test needed editing, the extraction changed behaviour — find out why before continuing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/run/rescore.ts apps/api/src/run/submit.ts apps/api/test/run/rescore.test.ts
git commit -m "refactor(api): one scoring path — extract rescoreAttempt from submitAttempt (K5)"
```

---

### Task 3: `countedScore()` and the candidate's two figures

**Files:**
- Create: `packages/core/src/counted.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `apps/api/src/run/release.ts` (the counted figure on `ReleasedResult`)
- Modify: `apps/web/src/components/exam/Receipt.tsx`
- Test: `packages/core/test/counted.test.ts`
- Test: `apps/api/test/run/release.test.ts`
- Test: `apps/web/test/exam/receipt.test.tsx`

**Interfaces:**
- Produces:

```ts
export type CountedAttempt = "highest" | "latest" | "average";

export interface AttemptFigure {
  attemptId: string;
  /** 0-100, as AttemptScore.percent already is. */
  percent: number;
  submittedAt: number;
}

export interface CountedResult {
  percent: number;
  /** null under "average" — the figure belongs to no single attempt. */
  attemptId: string | null;
  /** How many attempts the figure was computed from. */
  of: number;
}

/** Returns null for an empty list. Rounds to 2dp, as AttemptScore does. */
export function countedScore(
  attempts: readonly AttemptFigure[],
  mode: CountedAttempt,
): CountedResult | null;
```

Consumed by 8c (the results CSV and the analytics screen).

**`K6`** — one function, three readers. `counted_attempt` has been settable since Phase 5 and has had **no reader at all**.

**`K7`** — the counted line is governed by the same `release.show` / `release.when` as every other figure on the page, **and is suppressed entirely while the candidate has attempts remaining.** `release.ts` refused to read prior attempts here deliberately; the suppression is what keeps that refusal true. The route reads prior attempts **only on the last attempt**, and that read is in its measured `ROUTE_BUDGETS` entry.

- [ ] **Step 1: Write the failing core tests**

```ts
it("highest takes the best attempt and names it", () => {
  expect(countedScore([a(72, "att_1"), a(81, "att_2")], "highest"))
    .toEqual({ percent: 81, attemptId: "att_2", of: 2 });
});

it("latest takes the most recently submitted, not the last in the array", () => {
  expect(countedScore([late(81, "att_2"), early(72, "att_1")], "latest"))
    .toEqual({ percent: 81, attemptId: "att_2", of: 2 });
});

it("average belongs to no attempt and rounds to 2dp", () => {
  expect(countedScore([a(72, "att_1"), a(81, "att_2"), a(70, "att_3")], "average"))
    .toEqual({ percent: 74.33, attemptId: null, of: 3 });
});

it("returns null for no attempts", () => {
  expect(countedScore([], "highest")).toBeNull();
});
```

- [ ] **Step 2: Write the failing release test — the suppression and its positive control**

Both in the same file. The positive control is what makes the suppression assertion mean anything (`E-R5`).

```ts
it("omits the counted figure while attempts remain", async () => {
  const body = await releasedResultFor({ attemptsRemaining: 1, countedAttempt: "highest" });
  expect(body).not.toHaveProperty("counted");
});

it("includes it on the last attempt — the control for the assertion above", async () => {
  const body = await releasedResultFor({ attemptsRemaining: 0, countedAttempt: "highest" });
  expect(body.counted).toEqual({ percent: 81, attemptId: "att_2", of: 2 });
});

it("omits it under show: none even on the last attempt", async () => {
  const body = await releasedResultFor({ attemptsRemaining: 0, show: "none" });
  expect(body).not.toHaveProperty("counted");
});

it("omits it under counted_attempt: latest, where it equals this attempt", async () => {
  const body = await releasedResultFor({ attemptsRemaining: 0, countedAttempt: "latest" });
  expect(body).not.toHaveProperty("counted");
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `cd packages/core && npx vitest run test/counted.test.ts` — FAIL, module not found.
Run: `cd apps/api && npx vitest run test/run/release.test.ts -t counted` — FAIL, `counted` is always absent.

- [ ] **Step 4: Implement `countedScore` and wire it into `releasedResult`**

`average` is the mean of `percent`, rounded with `round2` from `@pariksha/core` — the package's own arithmetic, not a local `Math.round`.

- [ ] **Step 5: Render both figures in `Receipt.tsx`**

Exact copy, fixed here because `K7` fixes it: the headline is `This attempt: {percent}%` and the second line is `Counted for your result: {percent}%, your best of {of}` for `highest`, `…your average of {of}` for `average`. Rendered only when `counted` is present, which the server has already decided.

- [ ] **Step 6: Write the failing web test, driven from `ExamApp`**

Not by rendering `Receipt` directly — three defects of exactly that shape shipped in Phase 6 behind component-level tests.

```ts
it("shows both figures on the last attempt", async () => {
  await submitThrough(ExamApp, { counted: { percent: 81, attemptId: "att_2", of: 2 } });
  expect(await screen.findByText(/This attempt: 72%/)).toBeInTheDocument();
  expect(screen.getByText(/Counted for your result: 81%, your best of 2/)).toBeInTheDocument();
});

it("shows only this attempt's figure when the server sent no counted block", async () => {
  await submitThrough(ExamApp, { counted: undefined });
  expect(await screen.findByText(/This attempt: 72%/)).toBeInTheDocument();
  expect(screen.queryByText(/Counted for your result/)).toBeNull();
});
```

The second test's positive control is the first — same query, present in one and absent in the other.

- [ ] **Step 7: Run all three suites**

Run: `cd packages/core && npx vitest run && cd ../../apps/api && npx vitest run test/run/release.test.ts && cd ../web && npx vitest run test/exam/receipt.test.tsx --no-file-parallelism`
Expected: PASS.

- [ ] **Step 8: Add the core coverage this move needs**

`@pariksha/core`'s CI gate is 100% functions / 98% statements and does **not** run in `pnpm test`. 7b lost a fix round to exactly this. Verify with the explicit flags before committing.

Run: `cd packages/core && npx vitest run --coverage --coverage.thresholds.functions=100 --coverage.thresholds.statements=98`

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/counted.ts packages/core/src/index.ts packages/core/test/counted.test.ts apps/api/src/run/release.ts apps/api/test/run/release.test.ts apps/web/src/components/exam/Receipt.tsx apps/web/test/exam/receipt.test.tsx
git commit -m "feat(core,api,web): countedScore, and the candidate's two figures gated by release (K6, K7)"
```

---

### Task 4: `toCsv()`, the filename, and the paging shape

**Files:**
- Create: `packages/core/src/csv.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/csv.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CsvColumn<T> {
  /** The header cell, verbatim. R-08 uses registration-field labels here. */
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/** RFC 4180 quoting, CRLF line endings, and a leading UTF-8 BOM when
 *  `bom` is true. `bom: false` is for appending a later page to a file
 *  that already carries one (`K38`). */
export function toCsv<T>(
  rows: readonly T[],
  columns: readonly CsvColumn<T>[],
  opts?: { bom?: boolean; header?: boolean },
): string;

/** `<slug>_<kind>_<YYYYMMDD-HHMM>.csv`, R-10's exact shape. */
export function csvFilename(slug: string, kind: string, at: number): string;

/** One page of an export. A route that reached its bound ALWAYS returns a
 *  cursor — there is no shape where a full-looking page is a partial file. */
export interface CsvPage {
  csv: string;
  nextCursor: string | null;
}
```

Consumed by 8c (all four exports) and 8e (the candidate data export).

**`K8`** — one serialiser. **`K38`** — paging, never silent truncation.

- [ ] **Step 1: Write the failing tests**

`KG6` is this test file. Review Focus item 4 is the fourth case.

```ts
it("leads with a UTF-8 BOM", () => {
  expect([...new TextEncoder().encode(toCsv([{ a: 1 }], [col("a")]))].slice(0, 3))
    .toEqual([0xef, 0xbb, 0xbf]);
});

it("omits the BOM and the header on a continuation page", () => {
  const page = toCsv([{ a: 1 }], [col("a")], { bom: false, header: false });
  expect(page.startsWith("﻿")).toBe(false);
  expect(page).toBe("1\r\n");
});

it("quotes a cell holding a comma, a quote, a newline and a non-Latin name", () => {
  const nasty = 'சத்யா, "the" tester\nsecond line';
  const out = toCsv([{ a: nasty }], [col("a")]);
  expect(out).toContain('"சத்யா, ""the"" tester\nsecond line"');
});

it("round-trips through the repo's own reader", () => {
  const rows = [{ a: 'x,"y"', b: "z" }];
  const out = toCsv(rows, [col("a"), col("b")]);
  expect(readDelimited(out.replace(/^﻿/, ""))).toEqual([["a", "b"], ['x,"y"', "z"]]);
});

it("writes an absent value as an empty cell, never as 'undefined'", () => {
  expect(toCsv([{ a: undefined }], [col("a")])).toContain("\r\n\r\n");
});

it("names the file R-10's way", () => {
  expect(csvFilename("math-final", "results", Date.UTC(2026, 9, 22, 14, 35)))
    .toBe("math-final_results_20261022-1435.csv");
});
```

The round-trip uses `readDelimited` from `apps/api/src/import/rows.ts` — the repo's existing reader. Writer and reader proving each other is cheaper than a second grammar.

- [ ] **Step 2: Run and watch fail**

Run: `cd packages/core && npx vitest run test/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `toCsv` and `csvFilename`**

A cell is quoted when it contains any of `, " \r \n`; an embedded quote doubles. `csvFilename` formats in **UTC** — a filename that differs by the organiser's timezone is two files for one export.

- [ ] **Step 4: Run, and run the coverage gate**

Run: `cd packages/core && npx vitest run test/csv.test.ts`
Run: `cd packages/core && npx vitest run --coverage --coverage.thresholds.functions=100 --coverage.thresholds.statements=98`
Expected: PASS both.

- [ ] **Step 5: Probe — prove the BOM assertion can fail**

Delete the BOM from the implementation, rebuild `@pariksha/core` (a probe that does not rebuild tests the old build and proves nothing), run, record the verbatim failure. Restore and rebuild.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/csv.ts packages/core/src/index.ts packages/core/test/csv.test.ts
git commit -m "feat(core): toCsv with a BOM, csvFilename, and the paging shape (K8, K38, KG6)"
```

---

### Task 5: `estimateCost()`, `TestRetention`, and the Results panel

**Files:**
- Create: `packages/core/src/cost.ts`
- Modify: `packages/core/src/types.ts` (`TestRetention`, `Test.retention`)
- Modify: `packages/core/src/index.ts`
- Modify: `apps/web/src/components/testbuilder/ResultsPanel.tsx` (the two retention fields and the cost line)
- Test: `packages/core/test/cost.test.ts`
- Test: `apps/web/test/testbuilder/results-panel.test.tsx`

**Interfaces:**
- Consumes: `snapshotCost`, `SNAPSHOT_KB`, `KB_PER_MB`, `ResolvedProctoring` (`@pariksha/core`, 7b).
- Produces:

```ts
export interface TestRetention {
  personal_data_days?: number;
  snapshots_days?: number;
}

/** S-13's defaults: snapshots 90 days, personal data and answers 12 months. */
export const RETENTION_DEFAULTS: { personalDataDays: 365; snapshotsDays: 90 };
export function resolveRetention(r: TestRetention | undefined): {
  personalDataDays: number; snapshotsDays: number;
};

export interface CostLine {
  /** Which control this line is about, for the panel to place it. */
  key: "snapshots" | "identity_photo" | "webhooks";
  /** Metered Worker requests per candidate. The headline figure. */
  requestsPerCandidate: number;
  /** Decimal MB per candidate, or null where the line costs no storage. */
  megabytesPerCandidate: number | null;
}

export interface CostEstimate {
  lines: CostLine[];
  /** requestsPerCandidate summed, times `candidates`. */
  totalRequests: number;
  candidates: number;
}

/** Returns null when nothing costs anything, so a caller renders nothing
 *  rather than "0 requests". Composes snapshotCost; never re-derives it. */
export function estimateCost(input: {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
  webhookCount: number;
  candidates: number;
}): CostEstimate | null;
```

Consumed by 8d (the webhook line), 8e (the dashboard), and the publish checklist.

**`K35`** — the unit is **requests first**. `snapshotCost`'s own comment is the reason: *"requests, not bytes, are the ceiling that actually stops a test… the megabytes figure alone is reassuring and wrong."*

**`K36`** — nothing here renders on `node`. The panel receives no cost prop at all on that target; see Task 7's payload work and `KG8`.

**`K28`** — the two retention integers join the **existing** Results panel, not a seventh `PANEL_KEYS` row.

- [ ] **Step 1: Write the failing cost tests**

Review Focus item 5 is the second test.

```ts
it("composes snapshotCost rather than re-deriving it", () => {
  const e = estimateCost({ durationMinutes: 60, resolved: strict, webhookCount: 0, candidates: 300 });
  const snaps = snapshotCost({ durationMinutes: 60, resolved: strict })!;
  expect(e!.lines.find((l) => l.key === "snapshots")!.requestsPerCandidate).toBe(snaps.uploads);
});

it("returns null for a test with no duration — never a zero that reads as free", () => {
  expect(estimateCost({ durationMinutes: null, resolved: strict, webhookCount: 0, candidates: 300 }))
    .toBeNull();
});

it("returns null when nothing costs anything", () => {
  expect(estimateCost({ durationMinutes: 60, resolved: off, webhookCount: 0, candidates: 300 }))
    .toBeNull();
});

it("counts the identity photo as one request and snapshots separately", () => {
  const e = estimateCost({ durationMinutes: 60, resolved: strict, webhookCount: 0, candidates: 1 });
  expect(e!.lines.find((l) => l.key === "identity_photo")!.requestsPerCandidate).toBe(1);
});

it("counts one webhook delivery per subscribed hook per candidate", () => {
  const e = estimateCost({ durationMinutes: 60, resolved: off, webhookCount: 2, candidates: 10 });
  expect(e!.lines.find((l) => l.key === "webhooks")!.requestsPerCandidate).toBe(2);
  expect(e!.totalRequests).toBe(20);
});

it("multiplies by the real candidate count", () => {
  const e = estimateCost({ durationMinutes: 60, resolved: strict, webhookCount: 0, candidates: 300 });
  expect(e!.totalRequests).toBe(e!.lines.reduce((n, l) => n + l.requestsPerCandidate, 0) * 300);
});
```

- [ ] **Step 2: Write the failing retention test**

```ts
it("applies S-13's defaults", () => {
  expect(resolveRetention(undefined)).toEqual({ personalDataDays: 365, snapshotsDays: 90 });
});

it("lets a document override one without losing the other", () => {
  expect(resolveRetention({ snapshots_days: 30 })).toEqual({ personalDataDays: 365, snapshotsDays: 30 });
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `cd packages/core && npx vitest run test/cost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement, and model `retention` on `Test`**

`types.ts:192`'s comment says `retention` is unmodelled *"until a phase needs it"* — **replace that comment**, do not leave it contradicting the code.

- [ ] **Step 5: Add the two fields and the cost line to `ResultsPanel.tsx`**

The two integer boxes follow the existing `SettingRow` idiom. The cost line renders only when the panel is given a cost prop — which `K36` means is absent on `node`.

Note the standing hole, do not fix it here: the `min={1}` integer boxes across all six panels commit schema-rejecting values with no `issueFor` surface. 7b left this deliberately — *"fixing one panel of six makes the inconsistency worse."* These two boxes match their five siblings.

- [ ] **Step 6: Write the failing panel test, with both grounds honest**

```ts
it("renders the retention fields", async () => {
  render(<ResultsPanel {...props} />);
  expect(screen.getByLabelText(/Delete snapshots after/)).toHaveValue(90);
});

it("shows the cost line when given an estimate", () => {
  render(<ResultsPanel {...props} cost={estimate} />);
  expect(screen.getByText(/60 requests per candidate/)).toBeInTheDocument();
});

it("renders no cost line at all without one — control is the test above", () => {
  render(<ResultsPanel {...props} cost={undefined} />);
  expect(screen.queryByText(/per candidate/)).toBeNull();
});
```

One honest `axe` pass, not two. Toggling `data-theme` in jsdom injects no stylesheet and `colour-contrast` cannot run, so two iterations produce an identical DOM and rule set — 7b settled this. Real per-ground ratios live in `contrast-usage.test.ts`.

- [ ] **Step 7: Run, including the core coverage gate**

Run: `cd packages/core && npx vitest run --coverage --coverage.thresholds.functions=100 --coverage.thresholds.statements=98`
Run: `cd apps/web && npx vitest run test/testbuilder/results-panel.test.tsx --no-file-parallelism`

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/cost.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/test/cost.test.ts apps/web/src/components/testbuilder/ResultsPanel.tsx apps/web/test/testbuilder/results-panel.test.tsx
git commit -m "feat(core,web): estimateCost, TestRetention, and both in the Results panel (K28, K35)"
```

---

### Task 6: The `scheduled` job registry

**Files:**
- Create: `apps/api/src/scheduled.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/test/scheduled.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ScheduledJob {
  name: string;
  /** The cron expression this job runs under, matched verbatim against
   *  `ScheduledController.cron`. */
  cron: string;
  run(deps: AppDeps): Promise<{ summary: string }>;
}

/** Ships EMPTY. 8b, 8d and 8e each append one entry. */
export const SCHEDULED_JOBS: ScheduledJob[] = [];

export async function runScheduled(
  cron: string,
  deps: AppDeps,
): Promise<{ ran: string[] }>;
```

Consumed by 8b (the regrade drain), 8d (the webhook drain), 8e (retention and the rate-limit sweep).

**`K27`** — it ships registering **nothing**. Four later jobs need the handler and three of them are in plans that run in parallel; whichever shipped it first would own a file the other three edit.

`wrangler.toml` already declares `crons = ["17 3 * * *"]` with a comment reading *"Until `apps/api/src/index.ts` exports `scheduled`, the nightly invocation has no handler."* This task is what that comment is waiting for. **It does not add the second cron entry** — 8d adds that beside the drain it exists for (`K22`).

- [ ] **Step 1: Write the failing tests**

```ts
it("runs no job for an unknown cron", async () => {
  expect(await runScheduled("* * * * *", deps)).toEqual({ ran: [] });
});

it("runs every job registered for a matching cron", async () => {
  SCHEDULED_JOBS.push(fake("a", "17 3 * * *"), fake("b", "17 3 * * *"), fake("c", "*/5 * * * *"));
  expect((await runScheduled("17 3 * * *", deps)).ran).toEqual(["a", "b"]);
});

it("one job throwing does not stop the others", async () => {
  SCHEDULED_JOBS.push(throwing("a", "17 3 * * *"), fake("b", "17 3 * * *"));
  expect((await runScheduled("17 3 * * *", deps)).ran).toEqual(["b"]);
});

it("ships with no jobs registered", async () => {
  expect(SCHEDULED_JOBS).toEqual([]);   // 8b, 8d and 8e each change this line
});
```

The last test is deliberately brittle: a plan registering a job must edit it, which is how the registry's contents stay visible rather than accumulating unseen.

- [ ] **Step 2: Run and watch fail**

Run: `cd apps/api && npx vitest run test/scheduled.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `runScheduled` and export `scheduled` from `index.ts`**

A job that throws is caught, logged and skipped; the handler never rejects. A nightly sweep failing must not take the next one down with it.

- [ ] **Step 4: Run**

Run: `cd apps/api && npx vitest run test/scheduled.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduled.ts apps/api/src/index.ts apps/api/test/scheduled.test.ts
git commit -m "feat(api): the scheduled job registry, shipped empty (K27)"
```

---

### Task 7: The organiser's attempt reads

**Files:**
- Create: `packages/db/src/repo/results.ts`
- Modify: `packages/db/src/repo/index.ts`
- Test: `packages/db/test/repo/results.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AttemptSummary {
  attemptId: string;
  candidateId: string;
  setNo: number;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  submitReason: string | null;
  scoreJson: unknown;
  flag: string;
  integrityFlag: string;
  observed: boolean;
  /** K11: max(response.saved_at, event.server_ts, snapshot.taken_at). */
  lastContactAt: number | null;
  violations: number;
  answered: number;
}

/** ONE query (K9). Never one per attempt. `testId` joins through
 *  test_version, because `attempt` carries `test_version_id` and not
 *  `test_id`. */
export const listAttemptsForTest: Scoped<(
  testId: string,
  opts?: { limit?: number; cursor?: string },
) => Promise<{ rows: AttemptSummary[]; nextCursor: string | null }>>;

export const countedFiguresForTest: Scoped<(
  testId: string,
) => Promise<Map<string, AttemptFigure[]>>>;   // candidateId -> figures
```

Consumed by 8b (the grading queue's attempt list), 8c (the CSV and analytics), 8g (the monitor).

**`K9`** and **`KG3`** — this is the function the whole phase's budget rests on. It is measured against **300 candidates**, not ten.

**`K11`** — `lastContactAt` is derived here, in SQL, as the max of three timestamps, and is `null` when there is none. It is not a column and there is no heartbeat.

- [ ] **Step 1: Write the failing tests, with a 300-row fixture**

```ts
it("returns one row per attempt with the derived last contact", async () => {
  const { rows } = await listAttemptsForTest(db, wsp, testId);
  expect(rows[0].lastContactAt).toBe(LATEST_OF_THE_THREE);
});

it("reports null last contact for an attempt that has never contacted the server", async () => {
  const { rows } = await listAttemptsForTest(db, wsp, quietTestId);
  expect(rows[0].lastContactAt).toBeNull();
});

it("reads 300 attempts in a bounded number of statements", async () => {
  const counting = countingDeps(deps);
  await listAttemptsForTest(counting.deps.db, wsp, testIdWith300);
  expect(counting.counts().db).toBeLessThanOrEqual(3);
});

it("joins through test_version — an attempt of another version of the same test is included", async () => {
  const { rows } = await listAttemptsForTest(db, wsp, testId);
  expect(rows.map((r) => r.attemptId)).toContain(attemptOnV1);
});

it("refuses a workspace it was not scoped to", async () => {
  const { rows } = await listAttemptsForTest(db, otherWsp, testId);
  expect(rows).toEqual([]);
});

it("returns a cursor when it reaches the limit, and null when it does not", async () => {
  expect((await listAttemptsForTest(db, wsp, testIdWith300, { limit: 100 })).nextCursor).not.toBeNull();
  expect((await listAttemptsForTest(db, wsp, testIdWith300, { limit: 500 })).nextCursor).toBeNull();
});
```

The third test is `KG3`. It is the reason the fixture is 300: at ten rows a per-attempt query passes.

- [ ] **Step 2: Run and watch fail**

Run: `cd packages/db && npx vitest run test/repo/results.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement through `scoped()`**

Every repository function is reachable only through `scoped()`, which registers it in `REPO_FUNCTIONS`; a test enumerates that registry and proves the workspace rule for every function that exists. Do not bypass it.

The counts (`violations`, `answered`) and `lastContactAt` are aggregates in the same statement, not follow-up queries.

- [ ] **Step 4: Run**

Run: `cd packages/db && npx vitest run --no-file-parallelism`
Expected: PASS, including `scoped.test.ts`'s registry sweep.

- [ ] **Step 5: Probe — prove the 300-row budget test can fail**

Rewrite the aggregate as a per-attempt follow-up query. Run the budget test. Record the verbatim failure line. Restore. This probe is the one that proves `KG3` works at all, and 7a found a real blind spot with exactly this technique.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/repo/results.ts packages/db/src/repo/index.ts packages/db/test/repo/results.test.ts
git commit -m "feat(db): the organiser's set-based attempt reads, with derived last contact (K9, K11)"
```

---

### Task 8: The two inherited defects, and the PRD correction

**Files:**
- Modify: `apps/api/src/run/submit.ts` (`Receipt` gains `finishMessage`)
- Modify: `apps/web/src/components/exam/Receipt.tsx`
- Modify: `apps/api/src/publish/checklist.ts` (the blocking duration row)
- Modify: `apps/api/src/routes/run.ts:138` (stop advertising `durationMinutes: 0`)
- Modify: `docs/PRD.md` (the `:568` snapshot and heartbeat sentences)
- Test: `apps/web/test/exam/receipt.test.tsx`, `apps/api/test/publish/checklist.test.ts`, `apps/api/test/run/landing.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Receipt.finishMessage?: string`.

**`K32`** — both defects live in files this plan already opens. **`K33`** — the PRD sentences are corrected here because this is the phase that depends on snapshot rows existing.

**`#186`** — `branding.finish_message` has a writer (`BrandingPanel.tsx:267`), is stored, exported and re-imported, and **no candidate will ever see it**. It is test content, not candidate data, so it needs no scrub exception — confirm that against `scrub-scan.test.ts` rather than assuming it.

**`#179`** — a published version with no `duration_minutes` advertises a 0-minute test on the landing page and then 409s on `/start`. The right fix is that such a version is **not publishable**: a blocking checklist row, not an advisory one. Phase 7 added four advisory rows and no blocking one; this is the phase's first.

- [ ] **Step 1: Write the failing `#186` test, from `ExamApp`**

Clicked through to submission, not by rendering `Receipt` directly. The issue says so, and names three Phase 6 defects that shipped behind component-level tests.

```ts
it("shows the organiser's finish message after submitting", async () => {
  await submitThrough(ExamApp, { branding: { finish_message: "Results in 3 days." } });
  expect(await screen.findByText("Results in 3 days.")).toBeInTheDocument();
});

it("shows no finish-message element when the test sets none", async () => {
  await submitThrough(ExamApp, { branding: {} });
  expect(screen.queryByTestId("finish-message")).toBeNull();
});
```

- [ ] **Step 2: Write the failing `#179` tests**

```ts
it("blocks publishing a version with no duration", async () => {
  const rows = await checklistFor(testWithNoDuration);
  expect(rows.find((r) => r.id === "timing_no_duration")).toMatchObject({ level: "blocking" });
});

it("refuses the publish itself, not only the checklist", async () => {
  await expect(publish(testWithNoDuration)).rejects.toMatchObject({ status: 422 });
});

it("still publishes a version that has one — control for both above", async () => {
  await expect(publish(testWithDuration)).resolves.toBeDefined();
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `cd apps/web && npx vitest run test/exam/receipt.test.tsx --no-file-parallelism`
Run: `cd apps/api && npx vitest run test/publish/checklist.test.ts`

- [ ] **Step 4: Carry `finishMessage` on the Receipt and render it**

Beside the counts the finish page already shows, the way `exam.tsx:183` renders the start message on the landing page.

- [ ] **Step 5: Add the blocking row, and stop the landing page advertising zero**

`GET …/checklist` and `POST …/publish` compute the same rows from the same function (#64) — add the row once. With the version unpublishable, `run.ts:138`'s `durationMinutes: timing.duration_minutes ?? 0` is unreachable for a published version; make it say so rather than coalescing. The issue also asks to check the same shape elsewhere: `questionCount` summing to 0 over empty sections. Check it; report what you find rather than silently fixing a third thing.

- [ ] **Step 6: Check the sibling branding fields**

`#186` step 4: confirm nothing else in `branding` has a writer and no reader. `branding.logo` is known and deliberate — it is unservable to a candidate without its own branding-scoped route, and never via `layout.media`, which is the authorisation set for the paper. Report anything else.

- [ ] **Step 7: Correct the two PRD sentences**

`docs/PRD.md:568`. *"Interval snapshots get no database row"* is false — Phase 7's `Q4f` ruled *"the row exists if and only if the object does"* and shipped it. The heartbeat sentence is true only under Strict, since `PROCTORING_DEFAULTS.standard` resolves `snapshotIntervalSeconds: 0`.

- [ ] **Step 8: Run the whole branch**

Run: `npx turbo run test --force --concurrency=1`
Then: `cd apps/api && npx vitest run -c vitest.workers.config.ts`
Expected: PASS both. The second config is where `worker.test.ts` lives and Task 1 edited it.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/run/submit.ts apps/web/src/components/exam/Receipt.tsx apps/api/src/publish/checklist.ts apps/api/src/routes/run.ts docs/PRD.md apps/web/test apps/api/test
git commit -m "fix(api,web,docs): the finish message gets a reader, a duration-less test cannot publish, and the PRD stops contradicting Q4f (#186, #179, K32, K33)"
```

---

## Before this plan merges

**`K41` — `0010` is applied to the live database *before* this branch merges, not after.**

`CLAUDE.md` carries this as a repository-wide rule, and it is written from this repository's own
scar: **`0008` merged with Phase 7a and went four days unapplied**, while the Drizzle schema already
declared `integrity_flag` and `observed` — so every live `attempt` select failed with
`no such column` until setup was run on **2026-10-22**. `deploy.yml` redeploys `main` on every push
and applies no migrations; `setup.mjs` applies them and a human runs it.

**`0008` is applied as of 2026-10-22.** It is no longer outstanding, and this plan may assume those
two columns exist. `0010` is the only migration this phase gates on.

**The agent's pre-merge evidence** — both free, neither touches the account:

```
node deploy/cloudflare/setup.mjs --dry-run
pnpm --filter @pariksha/api test
```

The first runs the whole setup flow twice against an in-memory Cloudflare and asserts the second run
is a no-op. The second includes `worker.test.ts`, the real Worker entry against **Miniflare, which
is D1's own engine running locally** — that is where a migration is proved, because no test in this
repository reaches Cloudflare.

**The owner's step**, which the sandbox classifier refuses for the agent:

```
! node deploy/cloudflare/setup.mjs
```

**After the merge, check the count.** `GET /api/v1/health` answers `{"migrations":N}`, and **N must
equal the number of files in `packages/db/migrations/sqlite/`** — eleven once `0010` lands, twelve
if 7e's `0009` is already in. A mismatch means the deploy shipped ahead of the schema.
