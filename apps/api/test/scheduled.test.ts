// The registry itself, exercised with fakes — not the jobs 8b/8d/8e add,
// which each own their own test file next to the job they register.

import { beforeEach, expect, it, vi } from "vitest";
import { SCHEDULED_JOBS, runScheduled, type ScheduledJob } from "../src/scheduled.js";
import { webhookDrainJob } from "../src/webhooks/drain.js";
import { testDeps } from "./deps.js";

const { deps } = await testDeps();

// Snapshotted at module load — before any `beforeEach` below has run.
// `beforeEach` applies to every test in this file regardless of where it
// is declared relative to them, so reading `SCHEDULED_JOBS` directly from
// inside a test reads an array the hook already emptied: the assertion
// would pass no matter what shipped. This constant is the registry as the
// module actually exported it.
const shippedWith = [...SCHEDULED_JOBS];

function fake(name: string, cron: string): ScheduledJob {
  return { name, cron, run: vi.fn(async () => ({ summary: name })) };
}

function throwing(name: string, cron: string): ScheduledJob {
  return {
    name,
    cron,
    run: vi.fn(async () => {
      throw new Error(`${name} blew up`);
    }),
  };
}

// Pinned before any test pushes a job, per K27: a plan that registers one
// must edit this line, which is how the registry's contents stay visible
// rather than accumulating unseen. 8d is the first to (`webhookDrainJob`,
// K22); 8b and 8e each add theirs to the same array, on another branch.
it("ships with exactly the jobs registered so far", async () => {
  expect(shippedWith).toEqual([webhookDrainJob]); // 8b and 8e each change this line
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
