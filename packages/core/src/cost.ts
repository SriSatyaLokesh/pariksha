// Phase 8a Task 5 (`K28`, `K35`): `TestRetention` (`types.ts`) models S-13's
// deletion defaults; `estimateCost` turns a test's proctoring and webhook
// settings into the per-candidate request/byte figures the Results panel,
// the webhook panel (8d), the free-tier dashboard (8e) and the publish
// checklist all read from one place rather than growing independent copies
// of the same arithmetic — `snapshotCost`'s own history (`proctoring.ts`) is
// the reason: it shipped on two surfaces, was wrong on both, and only
// became correct when it moved to one function here.
//
// No I/O, no runtime dependencies: packages/core is a pure, leaf package.

import { snapshotCost, type ResolvedProctoring } from "./proctoring.js";
import type { TestRetention } from "./types.js";

/** S-13's defaults: snapshots 90 days, personal data and answers 12 months. */
export const RETENTION_DEFAULTS: { personalDataDays: 365; snapshotsDays: 90 } = {
  personalDataDays: 365,
  snapshotsDays: 90,
};

/** Reads each field by presence, so a document that sets one does not lose
 *  the other's default — the same shape `proctoring.ts`'s `overrideOr`
 *  reads overrides with, simplified: both fields here are plain positive
 *  integers (`minimum: 1` in the schema), so an absent key and `??` agree. */
export function resolveRetention(
  r: TestRetention | undefined,
): { personalDataDays: number; snapshotsDays: number } {
  return {
    personalDataDays: r?.personal_data_days ?? RETENTION_DEFAULTS.personalDataDays,
    snapshotsDays: r?.snapshots_days ?? RETENTION_DEFAULTS.snapshotsDays,
  };
}

export interface CostLine {
  /** Which control this line is about, for the panel to place it. */
  key: "snapshots" | "identity_photo" | "webhooks";
  /** Metered Worker requests per candidate. The headline figure. */
  requestsPerCandidate: number;
  /** Decimal MB per candidate, or null where the line costs no storage. */
  megabytesPerCandidate: number | null;
}

export interface CostEstimate {
  lines: CostLine[];
  /** requestsPerCandidate summed, times `candidates`. */
  totalRequests: number;
  candidates: number;
}

/**
 * Returns null when nothing costs anything, so a caller renders nothing
 * rather than "0 requests". Composes `snapshotCost` (`K35`); never
 * re-derives its arithmetic — the unit is requests first because that
 * function's own comment already says why: "requests, not bytes, are the
 * ceiling that actually stops a test… the megabytes figure alone is
 * reassuring and wrong."
 *
 * `durationMinutes: null` (#179's shape — a test with no duration set yet)
 * returns null too, before any line is built, not only the snapshots one.
 * `snapshotCost` already refuses to guess that figure; letting the other
 * lines answer anyway would make a document with an unknown cost read as
 * "costs only what the camera and webhooks add", which is still a number
 * that reassures someone it is cheaper than reality. Task 8 (#179) refuses
 * to publish this same document for the same unknown; the two agree that
 * "no duration" means "no cost figure", never "free".
 */
export function estimateCost(input: {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
  webhookCount: number;
  candidates: number;
}): CostEstimate | null {
  const { durationMinutes, resolved, webhookCount, candidates } = input;
  if (durationMinutes === null) return null;

  const lines: CostLine[] = [];

  const snaps = snapshotCost({ durationMinutes, resolved });
  if (snaps !== null) {
    lines.push({
      key: "snapshots",
      requestsPerCandidate: snaps.uploads,
      megabytesPerCandidate: snaps.megabytes,
    });
  }
  // One request per candidate — the photo is a single upload, not a
  // per-interval series. Gated on `requireCamera` the same way
  // `snapshotCost` and `proctoringRequirements` are (`Q11b`): no camera
  // means `getUserMedia` is never called, so nothing is ever captured
  // regardless of `identityPhoto`.
  if (resolved.requireCamera && resolved.identityPhoto) {
    lines.push({ key: "identity_photo", requestsPerCandidate: 1, megabytesPerCandidate: null });
  }
  // One delivery attempt per subscribed hook per candidate. No bytes line:
  // a webhook payload is small and fixed-shape, not worth a figure that
  // would just restate "small" with false precision.
  if (webhookCount > 0) {
    lines.push({ key: "webhooks", requestsPerCandidate: webhookCount, megabytesPerCandidate: null });
  }

  if (lines.length === 0) return null;

  const requestsPerCandidate = lines.reduce((n, l) => n + l.requestsPerCandidate, 0);
  return { lines, totalRequests: requestsPerCandidate * candidates, candidates };
}
