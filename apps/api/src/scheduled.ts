// The nightly cron's job registry (`deploy/cloudflare/wrangler.toml`'s
// `crons = ["17 3 * * *"]`, K27). Ships EMPTY on purpose: three later plans
// (8b, 8d, 8e) each append one job here, in parallel, and none of them
// should have to own this file to do it. The last test in
// `test/scheduled.test.ts` pins the list empty so a plan that forgets to
// register its job fails loudly instead of landing silently unscheduled.

import type { AppDeps } from "./app.js";

export interface ScheduledJob {
  name: string;
  /** The cron expression this job runs under, matched verbatim against
   *  `ScheduledController.cron`. */
  cron: string;
  run(deps: AppDeps): Promise<{ summary: string }>;
}

/** Ships EMPTY. 8b, 8d and 8e each append one entry. */
export const SCHEDULED_JOBS: ScheduledJob[] = [];

/**
 * Runs every job registered for `cron`, in order. One job throwing is
 * caught, logged and skipped — never left to reject the handler, which
 * would take every job after it down too and (per Workers' retry behaviour)
 * re-run the ones that already succeeded.
 */
export async function runScheduled(
  cron: string,
  deps: AppDeps,
): Promise<{ ran: string[] }> {
  const ran: string[] = [];
  for (const job of SCHEDULED_JOBS) {
    if (job.cron !== cron) continue;
    try {
      await job.run(deps);
      ran.push(job.name);
    } catch (err) {
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
  return { ran };
}
