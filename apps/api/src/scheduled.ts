// The cron job registry (`deploy/cloudflare/wrangler.toml`'s `crons`, K27).
// Shipped EMPTY on purpose: three later plans (8b, 8d, 8e) each append one
// job here, in parallel, and none of them should have to own this file to
// do it. The last test in `test/scheduled.test.ts` pins the list's exact
// contents so a plan that forgets to register its job fails loudly instead
// of landing silently unscheduled.
//
// Phase 8d Task 4 registers `webhookDrainJob` (`*/5 * * * *`, K22) — the
// first entry here. Phase 8b Task 4 (`K18`) adds `regradeJob`, staggered
// onto its own `2-59/5 * * * *` trigger so it never shares an invocation
// (and its 50-subrequest ceiling) with `webhookDrainJob`. 8e adds
// `retentionJob` and `rateLimitJob` on the nightly trigger.

import type { AppDeps } from "./app.js";
import { regradeJob } from "./grade/regrade.js";
import { rateLimitJob, retentionJob } from "./retention/sweep.js";
import { demoCleanupJob } from "./retention/demo-sweep.js";
import { webhookDrainJob } from "./webhooks/drain.js";

export interface ScheduledJob {
  name: string;
  /** The cron expression this job runs under, matched verbatim against
   *  `ScheduledController.cron`. */
  cron: string;
  /**
   * Branch review C2: the ceiling is 50 subrequests per **invocation**, not
   * per job (`instrument.ts`'s own first line) — `runScheduled` awaits
   * every job sharing a `cron` inside the one `scheduled()` call. A job
   * declares the worst case it measured for one tick; `scheduled.test.ts`
   * sums every declared `maxSubrequests` by `cron` and pins the total under
   * `SUBREQUEST_LIMIT`, so two jobs that each fit alone but not together
   * fail the suite instead of one silently losing `Too many subrequests`
   * on every contended tick.
   */
  maxSubrequests: number;
  run(deps: AppDeps): Promise<{ summary: string }>;
}

/**
 * Shipped EMPTY; 8b, 8d and 8e each append one entry. 8d's `webhookDrainJob`
 * landed first; 8e adds `retentionJob` and `rateLimitJob`
 * (`apps/api/src/retention/sweep.ts`, K30, AC-24, #101) beside it.
 *
 * **Order is declaration order, and that is a guarantee, not an accident** —
 * `runScheduled` iterates this array as written. Three plans append here
 * blind and in parallel, so the rule has to be stated rather than inferred:
 * a job must not depend on another job's writes within the same run. If one
 * ever genuinely must follow another, say so at the registration site; do
 * not rely on where a merge happened to put the lines.
 *
 * `retentionJob` and `rateLimitJob` satisfy that rule between themselves —
 * one expires `snapshot` rows and overdue `candidate` rows (Task 4's
 * `AC-24` pass subsumed the retired `response` pass — see `sweep.ts`'s own
 * header), the other `rate_limit` rows, and neither reads what the other
 * writes — so their relative order here is arbitrary. `webhookDrainJob` runs
 * on a different cron string (the 5-minutely drain cadence vs. the nightly
 * `17 3 * * *`, `deploy/cloudflare/wrangler.toml`), so `runScheduled`'s
 * `job.cron !== cron` guard already keeps it out of the same invocation as
 * the other two — nothing here shares a 50-subrequest budget with anything
 * else.
 */
export const SCHEDULED_JOBS: ScheduledJob[] = [
  webhookDrainJob,
  retentionJob,
  rateLimitJob,
  regradeJob,
  demoCleanupJob,
];

/**
 * Runs every job registered for `cron`, in order. One job throwing is
 * caught, logged and skipped, never left to reject this function — that
 * would take every job after it down too and (per Workers' retry
 * behaviour) re-run the ones that already succeeded.
 *
 * `failed` names what it caught (`M-3`): every job still runs regardless
 * of whether an earlier one threw (`K27`'s isolation — unchanged by this),
 * but the caller now has what it needs to make the cron invocation itself
 * report failure to Cloudflare instead of a silent 100% on the dashboard.
 */
export async function runScheduled(
  cron: string,
  deps: AppDeps,
): Promise<{ ran: string[]; failed: string[] }> {
  const ran: string[] = [];
  const failed: string[] = [];
  for (const job of SCHEDULED_JOBS) {
    if (job.cron !== cron) continue;
    try {
      await job.run(deps);
      ran.push(job.name);
    } catch (err) {
      failed.push(job.name);
      console.error(
        JSON.stringify({
          level: "error",
          job: job.name,
          cron,
          error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        }),
      );
    }
  }
  return { ran, failed };
}
