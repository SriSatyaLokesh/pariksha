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
// `K31`: projected from rows this instance already holds, plus the
// workspace's own configured open tests — no Cloudflare API token, no
// outbound call, no per-request counter. `estimated: true` is not a label
// bolted onto the UI; the surface renders the literal word "estimated"
// because that is what `spentToday` and `projected` both are: the former
// counts rows 1:1 as the requests that wrote them (the honest
// simplification a first cut makes — an `attempt_events` request can batch
// up to ten rows, so this leans toward counting more requests than were
// actually spent, never fewer, which is the direction an early warning
// should err in), and the latter composes `estimateCost` (8a) exactly as
// the publish checklist and the webhook panel (8d) do.
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
 * What today's rows already imply was spent. One field per table this
 * instance counts, each a 1:1 stand-in for the request that wrote the row —
 * deliberately the simple (and, for `events`, which batches up to ten rows
 * a request, slightly generous-to-the-warning) reading, not a weighted one:
 * `K40`'s first cut.
 */
export interface UsageCounts {
  /** `attempt` rows started today — `/start` and the timeout-materialising
   *  read both write one of these, so this undercounts slightly; the other
   *  two fields' overcounting is the one this project leans toward. */
  attempts: number;
  /** `snapshot` rows today — one row per `/attempt/snapshot` request. */
  snapshots: number;
  /** `event` rows today — up to ten batch into one `/attempt/events`
   *  request, so this overcounts the true request total, never under. */
  events: number;
}

/** Exactly `estimateCost`'s own parameter shape (`packages/core/src/cost.ts`)
 *  — composed, never re-derived. */
export interface TestCostInput {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
  webhookCount: number;
  candidates: number;
}

export interface UsageProjection {
  /** Backward: what rows we already hold imply was spent today. */
  spentToday: number;
  /** Forward: what the workspace's configured open tests will spend. */
  projected: number;
  limit: number;
  warn: boolean;
  /** Always true. The surface renders this as a label. */
  estimated: true;
}

/** Returns null on the node target (`K36`). */
export function projectUsage(input: {
  target: "workers" | "node";
  counts: UsageCounts;
  openTests: TestCostInput[];
}): UsageProjection | null {
  if (input.target === "node") return null;

  const spentToday = input.counts.attempts + input.counts.snapshots + input.counts.events;
  const projected = input.openTests.reduce(
    (total, test) => total + (estimateCost(test)?.totalRequests ?? 0),
    0,
  );
  const limit = FREE_PLAN_REQUESTS_PER_DAY;

  return {
    spentToday,
    projected,
    limit,
    warn: (spentToday + projected) / limit >= WARN_AT,
    estimated: true,
  };
}

const DAY_MS = 86_400_000;

interface CountsRow {
  attempts: number;
  snapshots: number;
  events: number;
}

/** Today's row counts, scoped to one workspace — one statement, three
 *  correlated subqueries, flat regardless of how many rows any of the
 *  three tables holds. */
async function countsToday(
  db: DbClient,
  workspaceId: string,
  dayStart: number,
): Promise<UsageCounts> {
  const rows = await db.query<CountsRow>(
    "SELECT " +
      "(SELECT COUNT(*) FROM attempt WHERE workspace_id = ? AND started_at >= ?) AS attempts, " +
      "(SELECT COUNT(*) FROM snapshot WHERE workspace_id = ? AND taken_at >= ?) AS snapshots, " +
      "(SELECT COUNT(*) FROM event WHERE workspace_id = ? AND server_ts >= ?) AS events",
    [workspaceId, dayStart, workspaceId, dayStart, workspaceId, dayStart],
  );
  const row = rows[0];
  return {
    attempts: Number(row?.attempts ?? 0),
    snapshots: Number(row?.snapshots ?? 0),
    events: Number(row?.events ?? 0),
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
 * `GET /api/v1/workspaces/:id/usage`, mounted directly in `app.ts` behind
 * `requireMember()` — membership is the whole check, the same authority
 * `GET /api/v1/workspaces/:id` already carries.
 *
 * `K36`: on the `node` target this issues no query at all (there is
 * nothing a self-hosted container needs projected against a plan it is not
 * on) and answers `{}` — the field is omitted, never sent as `null`.
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
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;

    // `target === "node"` short-circuits the ternary's `: null` branch
    // without ever evaluating the one that queries — so a self-hosted
    // container pays no subrequest for a figure it will not be shown,
    // and `projectUsage`'s own `K36` check (already proved in isolation by
    // "returns null on the node target" above) is never the only thing
    // standing between a `node` request and this field. One gate, not two:
    // everything this response sends funnels through the line below.
    const usage =
      target === "node"
        ? null
        : projectUsage({
            target,
            counts: await countsToday(deps.db, workspaceId, dayStart),
            openTests: await openTestCosts(deps.db, workspaceId, now),
          });

    return c.json(usage === null ? {} : { usage });
  };
}
