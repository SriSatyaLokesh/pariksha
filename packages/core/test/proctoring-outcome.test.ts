// Phase 7e Task 1 (`P-09`, issue #213): `violationOutcome()` is the one
// place "violations >= limit" turns into a decision. These are the brief's
// own fixtures and assertions verbatim (task-1-brief.md).

import { describe, expect, it } from "vitest";
import { PROCTORING_DEFAULTS, violationOutcome, type ResolvedProctoring } from "../src/index.js";

const resolved = (action: ResolvedProctoring["violationAction"]): ResolvedProctoring => ({
  ...PROCTORING_DEFAULTS.standard,
  violationLimit: 5,
  violationAction: action,
});

const warnOnly5 = resolved("warn_only");
const warnThenFlag5 = resolved("warn_then_flag");
const autoSubmit5 = resolved("auto_submit");
const lock5 = resolved("lock");

describe("violationOutcome", () => {
  it("warns below the limit", () => {
    expect(violationOutcome({ violations: 2, resolved: warnThenFlag5, alreadyActioned: false }))
      .toEqual({ kind: "warn", count: 2, limit: 5 });
  });

  it("fires the configured action at the limit", () => {
    expect(violationOutcome({ violations: 5, resolved: autoSubmit5, alreadyActioned: false }))
      .toEqual({ kind: "auto_submit" });
    expect(violationOutcome({ violations: 5, resolved: lock5, alreadyActioned: false }))
      .toEqual({ kind: "lock" });
  });

  it("flags rather than submits or locks under warn_then_flag at the limit", () => {
    expect(violationOutcome({ violations: 5, resolved: warnThenFlag5, alreadyActioned: false }))
      .toEqual({ kind: "flag" });
  });

  // Review Focus 1 — once, not twice.
  it("does not fire the action again once it has fired", () => {
    expect(violationOutcome({ violations: 6, resolved: autoSubmit5, alreadyActioned: true }))
      .toEqual({ kind: "none" });
  });

  it("warn_only never escalates at the limit", () => {
    expect(violationOutcome({ violations: 9, resolved: warnOnly5, alreadyActioned: false }))
      .toEqual({ kind: "warn", count: 9, limit: 5 });
  });

  // Not in the brief's list verbatim, but the same "once, not twice" shape
  // one event batch away: a candidate who crosses the limit mid-batch still
  // only hears about it once per outcome computed, and a batch that never
  // reaches the limit never fires at all regardless of `alreadyActioned`.
  it("stays none past the limit once actioned, for every configured action", () => {
    for (const action of ["warn_then_flag", "auto_submit", "lock"] as const) {
      expect(violationOutcome({ violations: 9, resolved: resolved(action), alreadyActioned: true }))
        .toEqual({ kind: "none" });
    }
  });
});
