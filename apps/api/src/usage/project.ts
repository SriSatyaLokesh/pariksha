// Phase 8e Task 3 (`K31`, `K36`, `KG8`, #102): the free-tier meter.
//
// Pariksha runs on Cloudflare's free plan — metered with a free allowance,
// not unmetered (CLAUDE.md). `FREE_PLAN_REQUESTS_PER_DAY` is the Workers
// free-plan daily request ceiling itself, the same figure `snapshotCost`'s
// own comment already cites as the thing that actually stops a test
// (`packages/core/src/proctoring.ts`'s "216,000 Worker requests across 300
// candidates against a free-plan 100,000/day limit"). This module turns
// that into a projection an organiser sees before they find out from a
// bill, not after.
//
// `K31`: projected from the workspace's own configured open tests — no
// Cloudflare API token, no outbound call, no per-request counter.
// `estimated: true` is not a label bolted onto the UI; the surface renders
// the literal word "estimated" because that is what `projected` is: it
// composes `estimateCost` (8a) exactly as the publish checklist and the
// webhook panel (8d) do, plus `BASELINE_REQUESTS_PER_CANDIDATE` (see
// below, `M1`).
//
// `K31` also fixes the only production caller `estimateCost` has had since
// Phase 8a shipped it (`ResultsPanel.tsx`'s own header: "No route emits a
// cost figure yet… until 8d/8e… thread it through").
//
// `K36`: `projectUsage` returns `null` on the `node` target, and
// `usageRoute` below answers with the key omitted entirely rather than a
// `null` or `undefined` value — the same shape `ResultsPanel.tsx`'s `cost`
// prop already establishes for this exact distinction ("absent, not
// `null` — the caller that reads `AppEnv.target` omits it rather than
// sending a figure that describes nothing on an operator's own
// container").
//
// This is the phase's first cut (`K40`'s cut order): cutting it does not
// cut the cost surface, because `K35`'s per-control estimates live with
// their controls in 8a's checklist and 8d's webhook panel, not here.
//
// **Branch review, `C2` (CRITICAL) — `spentToday`/`countsToday`/
// `UsageCounts` are deleted.** They existed to report what today's rows
// already imply was spent, and every one of the three tables they counted
// (`attempt`, `snapshot`, `event`) is indexed on `workspace_id` alone — no
// `(workspace_id, started_at)`/`(workspace_id, taken_at)`/
// `(workspace_id, server_ts)`. A `COUNT(*) WHERE workspace_id = ? AND
// <date> >= ?` against that index reads every row the workspace holds in
// that table before the date half of the condition ever narrows anything,
// because D1 bills rows *examined*, not rows returned — windowing the
// query to "today" (which it already was) does not change that cost; only
// a composite index would, and that is a migration this branch must not
// add (`K10`). One call against the 216,000-snapshot workspace this same
// module's own worst-case scenario names would read ~216,000 rows to
// answer a number that is normally zero. `projected` below is the half
// that was always cheap — `openTestCosts`'s three reads are each bounded
// by configuration (test count, candidate count, webhook count), never by
// event volume — and the half an organiser can actually act on: "you
// already spent 12,400 requests today" changes no decision; "the test you
// are about to open will spend 216,000" changes one.
//
// **Branch review, the `D6` amendment is reverted, not kept.** Home no
// longer calls `usage()` automatically on mount — see `home.tsx`'s own
// header, which no longer carries an amendment at all. This route is
// reached only on an explicit organiser gesture now, which was the option
// `D6` itself already named ("if it wants an aggregate endpoint, that is
// Phase 8's analytics work and the answer is no") and the one the original
// cut-this-call argument never compared against.
//
// The queries below are raw SQL rather than a `packages/db` repo function
// behind `scoped()` (`packages/db/src/repo/guard.ts`): Tasks 1, 2 and 4 on
// this branch already touched `packages/db`, and this task is additive, so
// it stays out of that package entirely. Every statement still carries its
// own `workspace_id = ?` — the property `scoped()` would otherwise enforce
// — by hand.

import {
  deriveState,
  type DbClient,
  type TestSettings,
} from "@pariksha/db";
import { estimateCost, resolveProctoring, type ResolvedProctoring } from "@pariksha/core";
import type { Handler } from "hono";
import type { AppBindings, AppDeps } from "../app.js";

/** The Workers free-plan daily request ceiling (ADR-level fact, not a
 *  config value — raising it means moving off the free plan). */
export const FREE_PLAN_REQUESTS_PER_DAY = 100_000;

/** The organiser sees amber from 70% of the daily ceiling, not at 100% —
 *  the point of a projection is the warning arriving before the bill does. */
export const WARN_AT = 0.7;

/**
 * Branch review `M1` (MAJOR): `estimateCost` (`packages/core/src/cost.ts`)
 * returns `null` unless snapshots, an identity photo or webhooks are
 * configured — correct for *its own* job (a per-control panel answering
 * "what do these controls add"), and wrong once reused as a *total*: the
 * default proctoring profile (`off`) and `standard` both leave every one
 * of those three off, so a 300-candidate test at the product's defaults
 * projected as exactly **0** — a confident green reading on the single
 * most common test shape, while the real spend (one `/start`, one
 * `/submit` and a save per answer, per candidate) is in the tens of
 * thousands. Every candidate costs requests whether or not anyone is
 * watching them.
 *
 * A flat per-candidate floor, not a per-question one: `TestCostInput`
 * carries no section/question count (only `estimateCost`'s own four
 * fields), and threading one through `openTestCosts` to make this
 * proportional is more than this fix wave's finding asks for.
 *
 * ponytail: flat, not proportional to paper length — the honest simple
 * reading, the same direction `K40`'s other first-cut numbers already
 * lean. Refine (a real per-question estimate) once `openTestCosts` carries
 * enough of the paper to compute one; until then this is the floor that
 * keeps the meter from ever reading exactly zero for a test with a roster.
 */
export const BASELINE_REQUESTS_PER_CANDIDATE = 50;

/** Exactly `estimateCost`'s own parameter shape (`packages/core/src/cost.ts`)
 *  — composed, never re-derived. */
export interface TestCostInput {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
  webhookCount: number;
  candidates: number;
}

export interface UsageProjection {
  /** Forward: what the workspace's configured open tests will spend. */
  projected: number;
  spentToday: number;
  limit: number;
  warn: boolean;
  /** Always true. The surface renders this as a label. */
  estimated: true;
}

/** Returns null on the node target (`K36`). */
export function projectUsage(input: {
  target: "workers" | "node";
  openTests: TestCostInput[];
  spentToday?: number;
}): UsageProjection | null {
  if (input.target === "node") return null;

  const projected = input.openTests.reduce(
    (total, test) =>
      total + (estimateCost(test)?.totalRequests ?? 0) + test.candidates * BASELINE_REQUESTS_PER_CANDIDATE,
    0,
  );
  const spentToday = input.spentToday ?? 0;
  const limit = FREE_PLAN_REQUESTS_PER_DAY;
  const total = projected + spentToday;

  return {
    projected,
    spentToday,
    limit,
    warn: total / limit >= WARN_AT,
    estimated: true,
  };
}

interface PublishedTestRow {
  id: string;
  settings_json: unknown;
}

interface CandidateCountRow {
  test_id: string;
  n: number;
}

/**
 * Every currently-open test in the workspace, as `estimateCost` input.
 * Three statements total, however many tests or candidates the workspace
 * holds:
 *
 * 1. every published test's own settings (one JOIN, flat in test count —
 *    `current_version` already pins the one row per test that matters);
 * 2. every test's candidate count, grouped in one query rather than one
 *    `COUNT` per test;
 * 3. the workspace's active webhook subscriptions — `webhook` is
 *    workspace-scoped, not per-test (`packages/db/src/schema/columns.ts`:
 *    no `test_id` column), so this one count applies to every open test
 *    alike rather than being fetched per test.
 */
async function openTestCosts(
  db: DbClient,
  workspaceId: string,
  now: number,
): Promise<TestCostInput[]> {
  const [published, candidateCounts, webhookRows] = await Promise.all([
    db.query<PublishedTestRow>(
      "SELECT t.id AS id, tv.settings_json AS settings_json " +
        "FROM test t JOIN test_version tv " +
        "ON tv.workspace_id = t.workspace_id AND tv.test_id = t.id AND tv.version = t.current_version " +
        "WHERE t.workspace_id = ? AND t.status = 'published'",
      [workspaceId],
    ),
    db.query<CandidateCountRow>(
      "SELECT test_id, COUNT(*) AS n FROM candidate WHERE workspace_id = ? GROUP BY test_id",
      [workspaceId],
    ),
    db.query<{ n: number }>(
      // `1`, not `true` — better-sqlite3 binds only numbers, strings,
      // bigints, buffers and null, and every bool column in this schema is
      // written as a plain 0/1 integer (`createTest`'s own
      // `review_requested` insert is the precedent).
      "SELECT COUNT(*) AS n FROM webhook WHERE workspace_id = ? AND active = ?",
      [workspaceId, 1],
    ),
  ]);

  const candidatesByTest = new Map(candidateCounts.map((row) => [row.test_id, Number(row.n)]));
  const webhookCount = Number(webhookRows[0]?.n ?? 0);

  const openTests: TestCostInput[] = [];
  for (const row of published) {
    const settings = db.jsonValue<TestSettings>(row.settings_json);
    if (deriveState("published", settings.timing, now) !== "open") continue;
    openTests.push({
      durationMinutes: settings.timing?.duration_minutes ?? null,
      resolved: resolveProctoring(settings.proctoring),
      webhookCount,
      candidates: candidatesByTest.get(row.id) ?? 0,
    });
  }
  return openTests;
}

/**
 * Backward-looking spend for today (Phase 8e / Issue #232).
 * Backed by migration 0016 composite indexes:
 * `(workspace_id, started_at)` on attempt,
 * `(workspace_id, taken_at)` on snapshot, and
 * `(workspace_id, server_ts)` on event.
 */
export async function querySpentToday(
  db: DbClient,
  workspaceId: string,
  now: number,
): Promise<number> {
  const startOfDay = Math.floor(now / 86_400_000) * 86_400_000;
  const rows = await db.query<{ spent: number | string }>(
    "SELECT " +
      "(SELECT COUNT(*) FROM attempt WHERE workspace_id = ? AND started_at >= ?) * 50 + " +
      "(SELECT COUNT(*) FROM snapshot WHERE workspace_id = ? AND taken_at >= ?) * 1 + " +
      "(SELECT COUNT(*) FROM event WHERE workspace_id = ? AND server_ts >= ?) * 1 AS spent",
    [workspaceId, startOfDay, workspaceId, startOfDay, workspaceId, startOfDay],
  );
  return Number(rows[0]?.spent ?? 0);
}

/**
 * `GET /api/v1/workspaces/:id/usage`, mounted directly in `app.ts` behind
 * `requireMember()` — membership is the whole check, the same authority
 * `GET /api/v1/workspaces/:id` already carries.
 *
 * `K36`: on the `node` target this issues no query at all (there is
 * nothing a self-hosted container needs projected against a plan it is not
 * on) and answers `{}` — the field is omitted, never sent as `null`.
 *
 * Branch review `C2`: reached only when the organiser's own browser calls
 * it — no caller in `apps/web` issues this on a mount or a timer (see
 * `UsagePanel.tsx`). The reads below are bounded by configuration and
 * migration 0016 composite indexes.
 */
export function usageRoute(deps: AppDeps): Handler<AppBindings> {
  return async (c) => {
    const target = deps.env.target;
    // `requireMember()` (mounted ahead of this handler in `app.ts`) already
    // refuses a route with no `:id` before this ever runs — `?? ""` only
    // satisfies a `Handler<AppBindings>` typed generically over every path,
    // the same fallback `shortlinkRoute`'s `:code` param uses for the same
    // reason.
    const workspaceId = c.req.param("id") ?? "";
    const now = deps.now();

    // `target === "node"` short-circuits the query branch without ever
    // evaluating it — so a self-hosted container pays no subrequest for a
    // figure it will not be shown, and `projectUsage`'s own `K36` check
    // is never the only thing standing between a `node` request and this field.
    let usage: UsageProjection | null = null;
    if (target !== "node") {
      const [openTests, spentToday] = await Promise.all([
        openTestCosts(deps.db, workspaceId, now),
        querySpentToday(deps.db, workspaceId, now),
      ]);
      usage = projectUsage({ target, openTests, spentToday });
    }

    return c.json(usage === null ? {} : { usage });
  };
}
