// Phase 7a Task 1: `resolveProctoring()` is the one function every later
// Phase 7 plan (the editor, the candidate-side gates, the camera, the
// consequences) resolves proctoring settings through. These tests are the
// contract those plans build against — in particular the `||` trap (Review
// Focus 2): `snapshot_interval_seconds: 0` must stay 0 against a profile
// default of 60.

import { describe, expect, it } from "vitest";
import { PROCTORING_DEFAULTS, proctoringRequirements, resolveProctoring } from "../src/index.js";

describe("resolveProctoring", () => {
  it("returns fully-populated Off for undefined", () => {
    expect(resolveProctoring(undefined)).toEqual(PROCTORING_DEFAULTS.off);
  });

  it("returns fully-populated Off for an empty object", () => {
    expect(resolveProctoring({})).toEqual(PROCTORING_DEFAULTS.off);
  });

  it("takes defaults from the profile", () => {
    const r = resolveProctoring({ profile: "strict" });
    expect(r.requireCamera).toBe(true);
    expect(r.snapshotIntervalSeconds).toBe(60);
    expect(r.violationAction).toBe("warn_then_flag");
  });

  // Review Focus 2 — the `||` trap. 0 is a value, not an absence.
  it("honours snapshot_interval_seconds: 0 as off against a profile that sets 60", () => {
    const r = resolveProctoring({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } });
    expect(r.snapshotIntervalSeconds).toBe(0);
  });

  it("honours false against a profile default of true", () => {
    const r = resolveProctoring({ profile: "strict", overrides: { desktop_only: false } });
    expect(r.desktopOnly).toBe(false);
  });

  it("treats an explicit undefined exactly as an absent key", () => {
    const explicit = resolveProctoring({ profile: "strict", overrides: { watermark: undefined } });
    expect(explicit).toEqual(resolveProctoring({ profile: "strict" }));
  });

  // Q3 — pre-cut.
  it("resolves faceCheck false even when the document asks for it", () => {
    expect(resolveProctoring({ profile: "strict", overrides: { face_check: true } }).faceCheck).toBe(false);
  });

  it("has no undefined on any key for any profile", () => {
    for (const profile of ["off", "standard", "strict"] as const) {
      for (const [k, v] of Object.entries(resolveProctoring({ profile }))) {
        expect(v, k).not.toBeUndefined();
      }
    }
  });
});

describe("proctoringRequirements", () => {
  it("names the camera and the images for Strict", () => {
    const lines = proctoringRequirements(resolveProctoring({ profile: "strict" }));
    expect(lines.join(" ")).toMatch(/camera/i);
    expect(lines.join(" ")).toMatch(/every 60 seconds/i);
  });

  it("is empty for Off", () => {
    expect(proctoringRequirements(resolveProctoring({ profile: "off" }))).toEqual([]);
  });

  it("omits images when the interval is 0 but keeps the camera line", () => {
    const lines = proctoringRequirements(
      resolveProctoring({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } }),
    );
    expect(lines.join(" ")).toMatch(/camera/i);
    expect(lines.join(" ")).not.toMatch(/every/i);
  });
});
