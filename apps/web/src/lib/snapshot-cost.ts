import { KB_PER_MB, SNAPSHOT_KB, type ResolvedProctoring } from "@pariksha/core";

/**
 * `Q11`: per candidate, never a total — the product does not know the
 * headcount.
 *
 * Counts interval snapshots only; the identity photo sits inside the "≈"
 * (`R1`, task-4-brief.md's ruling over the brief's own contradictory "+1"
 * test). `images = floor(durationMinutes * 60 / snapshotIntervalSeconds)`
 * is the same arithmetic `apps/api/src/publish/checklist.ts`'s
 * `proctoring_snapshot_cost` row already ships, so this panel and that
 * checklist cannot state two different figures for the same settings.
 *
 * The division is guarded before it runs, not sanitised after:
 * `durationMinutes: null` (no duration set yet, #179's shape) returns
 * `null` immediately, and `snapshotIntervalSeconds <= 0` (snapshots off,
 * `Q11b` — 0 means off, including a document whose interval is unset and
 * resolves to 0) returns `null` before `60 * 60 / 0` can ever produce
 * `Infinity`.
 */
export function snapshotCost(input: {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
}): { images: number; megabytes: number; uploads: number } | null {
  const { durationMinutes, resolved } = input;
  if (durationMinutes === null) return null;
  if (resolved.snapshotIntervalSeconds <= 0) return null;

  const images = Math.floor((durationMinutes * 60) / resolved.snapshotIntervalSeconds);
  // Decimal MB, rounded to one place; a plain JS number drops the trailing
  // ".0" on its own, so 18.0 prints as "18" and 1.46… prints as "1.5".
  const megabytes = Math.round(((images * SNAPSHOT_KB) / KB_PER_MB) * 10) / 10;
  // One upload per snapshot. Named beside megabytes because requests, not
  // bytes, are the ceiling that actually stops a test (`Q4`'s worst case:
  // 216,000 Worker requests across 300 candidates against a free-plan
  // 100,000/day limit) — the megabytes figure alone is reassuring and wrong.
  return { images, megabytes, uploads: images };
}
