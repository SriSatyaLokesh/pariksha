// Phase 7e Task 1 — the count has a limit (`P-09`, issue #213).
//
// `Q7a`: the server counts, so the server decides. This is the one place
// "violations >= limit" turns into a decision — every caller (today just
// `apps/api/src/routes/proctoring.ts`'s ingest) asks this function instead
// of comparing the two numbers itself.
//
// Pure, per `packages/core`'s purity gate: no `new Date()`, no I/O. The
// caller supplies the count, the resolved proctoring settings, and whether
// the limit has already fired once for this attempt — this module has no
// way to know that on its own.

import type { ResolvedProctoring } from "./proctoring.js";

export type ViolationOutcome =
  | { kind: "none" }
  | { kind: "warn"; count: number; limit: number }
  | { kind: "flag" }
  | { kind: "auto_submit" }
  | { kind: "lock" };

/**
 * `Q7a`/`Review Focus 1`: below the limit, every call is a `warn` — a
 * candidate at violation 9 of a 5-limit `warn_only` test still reads
 * "Warning 9 of 5" forever, because `warn_only` has no further action to
 * take. At or past the limit, the configured `violationAction` fires
 * **once**: `alreadyActioned` (true once a `violation_limit_reached` event
 * already exists for this attempt — the caller's job, not this function's)
 * turns every later call into `{ kind: "none" }` rather than re-submitting
 * or re-locking an attempt that has already taken the consequence.
 */
export function violationOutcome(input: {
  /** The count AFTER this batch — `countViolations`'s own figure, never a
   *  client-supplied one (`Q7a`). */
  violations: number;
  resolved: ResolvedProctoring;
  /** Whether the limit has already fired for this attempt before. */
  alreadyActioned: boolean;
}): ViolationOutcome {
  const { violations, resolved, alreadyActioned } = input;
  const { violationLimit: limit, violationAction: action } = resolved;

  if (violations < limit) return { kind: "warn", count: violations, limit };
  if (alreadyActioned) return { kind: "none" };

  switch (action) {
    case "warn_only":
      return { kind: "warn", count: violations, limit };
    case "warn_then_flag":
      return { kind: "flag" };
    case "auto_submit":
      return { kind: "auto_submit" };
    case "lock":
      return { kind: "lock" };
  }
}
