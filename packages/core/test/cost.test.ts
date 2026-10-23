// `estimateCost()` and `resolveRetention()` (Phase 8a Task 5, `K28`/`K35`).

import { describe, expect, it } from "vitest";
import { PROCTORING_DEFAULTS, snapshotCost } from "../src/proctoring.js";
import { RETENTION_DEFAULTS, estimateCost, resolveRetention } from "../src/cost.js";

const strict = PROCTORING_DEFAULTS.strict;
const off = PROCTORING_DEFAULTS.off;

describe("estimateCost", () => {
  it("composes snapshotCost rather than re-deriving it", () => {
    const e = estimateCost({ durationMinutes: 60, resolved: strict, webhookCount: 0, candidates: 300 });
    const snaps = snapshotCost({ durationMinutes: 60, resolved: strict })!;
    expect(e!.lines.find((l) => l.key === "snapshots")!.requestsPerCandidate).toBe(snaps.uploads);
  });

  it("returns null for a test with no duration — never a zero that reads as free", () => {
    expect(estimateCost({ durationMinutes: null, resolved: strict, webhookCount: 0, candidates: 300 }))
      .toBeNull();
  });

  it("returns null when nothing costs anything", () => {
    expect(estimateCost({ durationMinutes: 60, resolved: off, webhookCount: 0, candidates: 300 }))
      .toBeNull();
  });

  it("counts the identity photo as one request and snapshots separately", () => {
    const e = estimateCost({ durationMinutes: 60, resolved: strict, webhookCount: 0, candidates: 1 });
    expect(e!.lines.find((l) => l.key === "identity_photo")!.requestsPerCandidate).toBe(1);
  });

  it("counts one webhook delivery per subscribed hook per candidate", () => {
    const e = estimateCost({ durationMinutes: 60, resolved: off, webhookCount: 2, candidates: 10 });
    expect(e!.lines.find((l) => l.key === "webhooks")!.requestsPerCandidate).toBe(2);
    expect(e!.totalRequests).toBe(20);
  });

  it("multiplies by the real candidate count", () => {
    const e = estimateCost({ durationMinutes: 60, resolved: strict, webhookCount: 0, candidates: 300 });
    expect(e!.totalRequests).toBe(e!.lines.reduce((n, l) => n + l.requestsPerCandidate, 0) * 300);
  });

  // No camera means neither capture happens (`Q11b`) — an identity photo
  // requested without the camera that would take it promises a request
  // that never fires, the same refusal `snapshotCost` and
  // `proctoringRequirements` already make.
  it("never counts the identity photo without require_camera", () => {
    const e = estimateCost({
      durationMinutes: 60,
      resolved: { ...off, identityPhoto: true },
      webhookCount: 0,
      candidates: 10,
    });
    expect(e).toBeNull();
  });

  it("megabytes is null for lines that cost no storage", () => {
    const e = estimateCost({ durationMinutes: 60, resolved: off, webhookCount: 1, candidates: 1 });
    expect(e!.lines.find((l) => l.key === "webhooks")!.megabytesPerCandidate).toBeNull();
  });
});

describe("resolveRetention", () => {
  it("applies S-13's defaults", () => {
    expect(resolveRetention(undefined)).toEqual({ personalDataDays: 365, snapshotsDays: 90 });
  });

  it("lets a document override one without losing the other", () => {
    expect(resolveRetention({ snapshots_days: 30 })).toEqual({ personalDataDays: 365, snapshotsDays: 30 });
  });

  it("the defaults constant matches both figures literally", () => {
    expect(RETENTION_DEFAULTS).toEqual({ personalDataDays: 365, snapshotsDays: 90 });
  });
});
