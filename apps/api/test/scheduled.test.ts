// The registry itself, exercised with fakes — not the jobs 8b/8d/8e add,
// which each own their own test file next to the job they register.

import { beforeEach, expect, it, vi } from "vitest";
import { SCHEDULED_JOBS, runScheduled, type ScheduledJob } from "../src/scheduled.js";
import { regradeJob } from "../src/grade/regrade.js";
import { SUBREQUEST_LIMIT } from "../src/instrument.js";
import { webhookDrainJob } from "../src/webhooks/drain.js";
import { rateLimitJob, retentionJob } from "../src/retention/sweep.js";
import { demoCleanupJob } from "../src/retention/demo-sweep.js";
import { testDeps } from "./deps.js";

const { deps } = await testDeps();

// Snapshotted at module load — before any `beforeEach` below has run.
// `beforeEach` applies to every test in this file regardless of where it
// is declared relative to them, so reading `SCHEDULED_JOBS` directly from
// inside a test reads an array the hook already emptied: the assertion
// would pass no matter what shipped. This constant is the registry as the
// module actually exported it.
const shippedWith = [...SCHEDULED_JOBS];

function fake(name: string, cron: string, maxSubrequests = 1): ScheduledJob {
  return { name, cron, maxSubrequests, run: vi.fn(async () => ({ summary: name })) };
}

function throwing(name: string, cron: string): ScheduledJob {
  return {
    name,
    cron,
    maxSubrequests: 1,
    run: vi.fn(async () => {
      throw new Error(`${name} blew up`);
    }),
  };
}

// Pinned before any test pushes a job, per K27: a plan that registers one
// must edit this line, which is how the registry's contents stay visible
// rather than accumulating unseen. 8d landed first (`webhookDrainJob`,
// K22); 8e added `retentionJob` and `rateLimitJob` beside it
// (`apps/api/src/scheduled.ts`'s own header on declaration order); 8b adds
// `regradeJob` last, staggered onto its own cron (`REGRADE_CRON`).
it("ships with exactly the jobs this branch registers", async () => {
  expect(shippedWith).toEqual([webhookDrainJob, retentionJob, rateLimitJob, regradeJob, demoCleanupJob]);
});

beforeEach(() => {
  SCHEDULED_JOBS.length = 0;
});

it("runs no job for an unknown cron", async () => {
  expect(await runScheduled("* * * * *", deps)).toEqual({ ran: [], failed: [] });
});

it("runs every job registered for a matching cron", async () => {
  SCHEDULED_JOBS.push(
    fake("a", "17 3 * * *"),
    fake("b", "17 3 * * *"),
    fake("c", "*/5 * * * *"),
  );

  const result = await runScheduled("17 3 * * *", deps);
  expect(result.ran).toEqual(["a", "b"]);
  // Positive control beside the negative below (`one job throwing does not
  // stop the others`): nothing threw here, so `failed` is empty — not a
  // vacuous `toEqual([])` on its own (`M-5`'s standard).
  expect(result.failed).toEqual([]);
});

// The positive control for the throw test below: without this, a reader
// cannot tell whether "b" ran because the registry works or because
// nothing ever stops it from running.
it("one job throwing does not stop the others", async () => {
  const a = throwing("a", "17 3 * * *");
  const b = fake("b", "17 3 * * *");
  SCHEDULED_JOBS.push(a, b);

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  const result = await runScheduled("17 3 * * *", deps);
  expect(result.ran).toEqual(["b"]);
  // `M-3`: the caller (`index.ts`'s `scheduled`) needs the failed job's
  // name to make the cron invocation itself report failure.
  expect(result.failed).toEqual(["a"]);
  expect(a.run).toHaveBeenCalledTimes(1);
  expect(b.run).toHaveBeenCalledTimes(1);
  // The throw is observable, not swallowed: logged with the job name and
  // the cron it ran under.
  expect(errorSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy.mock.calls[0]?.[0]).toContain("\"job\":\"a\"");
  expect(errorSpy.mock.calls[0]?.[0]).toContain("a blew up");

  errorSpy.mockRestore();
});

// Branch review C2: the ceiling is 50 subrequests per **invocation**, not
// per job — `runScheduled` awaits every job sharing a `cron` inside the one
// `scheduled()` call, matched verbatim against `job.cron`. Each job's own
// test proves its own tick stays under the ceiling alone; nothing proved
// the *sum* for jobs landing on the exact same cron string, which is what
// actually runs on Cloudflare. The primary fix (coordinator follow-up) was
// staggering `regradeJob` off 8d's `webhookDrainJob` cron entirely
// (`apps/api/src/grade/regrade.ts`'s `REGRADE_CRON` header) — two jobs on
// different strings never share an invocation at all. This test is the
// backstop: a future job that genuinely does need the same trigger as
// another still fails loudly here instead of losing "Too many
// subrequests" on every contended tick.
it("every cron's registered jobs stay under the subrequest ceiling together, not just alone", () => {
  const shippedByCron = new Map<string, number>();
  for (const job of shippedWith) {
    shippedByCron.set(job.cron, (shippedByCron.get(job.cron) ?? 0) + job.maxSubrequests);
  }
  for (const [cron, total] of shippedByCron) {
    expect(total, `${cron}'s jobs together`).toBeLessThanOrEqual(SUBREQUEST_LIMIT);
  }
  // A positive control: the check itself can see a real violation, not
  // just pass on an empty registry.
  const overBudget = new Map<string, number>();
  for (const job of [fake("x", "*/5 * * * *", 30), fake("y", "*/5 * * * *", 30)]) {
    overBudget.set(job.cron, (overBudget.get(job.cron) ?? 0) + job.maxSubrequests);
  }
  expect(overBudget.get("*/5 * * * *")).toBeGreaterThan(SUBREQUEST_LIMIT);
});
