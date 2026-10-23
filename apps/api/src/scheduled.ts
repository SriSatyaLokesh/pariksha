// The nightly cron's job registry (`deploy/cloudflare/wrangler.toml`'s
// `crons = ["17 3 * * *"]`, K27). Ships EMPTY on purpose: three later plans
// (8b, 8d, 8e) each append one job here, in parallel, and none of them
// should have to own this file to do it. The last test in
// `test/scheduled.test.ts` pins the list empty so a plan that forgets to
// register its job fails loudly instead of landing silently unscheduled.

import type { AppDeps } from "./app.js";
import { rateLimitJob, retentionJob } from "./retention/sweep.js";

export interface ScheduledJob {
  name: string;
  /** The cron expression this job runs under, matched verbatim against
   *  `ScheduledController.cron`. */
  cron: string;
  run(deps: AppDeps): Promise<{ summary: string }>;
}

/**
 * Shipped EMPTY; 8b, 8d and 8e each append one entry. 8e is first to land:
 * `retentionJob` and `rateLimitJob` (`apps/api/src/retention/sweep.ts`,
 * K30, AC-24, #101).
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
 * writes — so their relative order here is arbitrary.
 */
export const SCHEDULED_JOBS: ScheduledJob[] = [retentionJob, rateLimitJob];

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
