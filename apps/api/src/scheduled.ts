// The cron job registry (`deploy/cloudflare/wrangler.toml`'s
// `crons`, K27). Shipped EMPTY; three plans (8b, 8d, 8e) each append one job
// here, in parallel — the last test in `test/scheduled.test.ts` pinned the
// list empty so a plan that forgot to register its job would fail loudly
// instead of landing silently unscheduled. Phase 8b Task 4 (`K18`) is the
// first to land: `regradeJob` runs on the frequent `*/5 * * * *` trigger,
// not the nightly one.

import type { AppDeps } from "./app.js";
import { regradeJob } from "./grade/regrade.js";

export interface ScheduledJob {
  name: string;
  /** The cron expression this job runs under, matched verbatim against
   *  `ScheduledController.cron`. */
  cron: string;
  run(deps: AppDeps): Promise<{ summary: string }>;
}

/**
 * Ships EMPTY. 8b, 8d and 8e each append one entry.
 *
 * **Order is declaration order, and that is a guarantee, not an accident** —
 * `runScheduled` iterates this array as written. Three plans append here
 * blind and in parallel, so the rule has to be stated rather than inferred:
 * a job must not depend on another job's writes within the same run. If one
 * ever genuinely must follow another, say so at the registration site; do
 * not rely on where a merge happened to put the lines.
 */
export const SCHEDULED_JOBS: ScheduledJob[] = [regradeJob];

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
