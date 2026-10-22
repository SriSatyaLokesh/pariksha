// Phase 7a Task 1: `resolveProctoring()` is the one function every later
// Phase 7 plan (the editor, the candidate-side gates, the camera, the
// consequences) resolves proctoring settings through. These tests are the
// contract those plans build against — in particular the `||` trap (Review
// Focus 2): `snapshot_interval_seconds: 0` must stay 0 against a profile
// default of 60.

import { describe, expect, it } from "vitest";
import {
  FAILURE_EVENTS,
  isViolation,
  PROCTORING_DEFAULTS,
  PROCTORING_EVENTS,
  proctoringRequirements,
  resolveProctoring,
  VIOLATION_EVENTS,
} from "../src/index.js";

describe("resolveProctoring", () => {
  it("returns fully-populated Off for undefined", () => {
    expect(resolveProctoring(undefined)).toEqual(PROCTORING_DEFAULTS.off);
  });

  it("returns fully-populated Off for an empty object", () => {
    expect(resolveProctoring({})).toEqual(PROCTORING_DEFAULTS.off);
  });

  // The two tests above compare `resolveProctoring` to `PROCTORING_DEFAULTS`
  // itself, which proves resolution reaches the table but asserts nothing
  // about what the table says — in particular `violationLimit`,
  // `cameraOutageSeconds` and `multiFaceSnapshots` had no assertion anywhere
  // in the tree, and those are three of the thresholds a later plan computes
  // the integrity flag from. These pin today's table against literals, one
  // profile at a time.
  it("pins Off's defaults", () => {
    expect(PROCTORING_DEFAULTS.off).toEqual({
      profile: "off",
      desktopOnly: false,
      requireFullscreen: false,
      blockCopyPaste: false,
      watermark: false,
      requireCamera: false,
      identityPhoto: false,
      snapshotIntervalSeconds: 0,
      faceCheck: false,
      requireMicrophone: false,
      extraMonitorCheck: false,
      violationLimit: 5,
      violationAction: "warn_only",
      cameraOutageSeconds: 120,
      multiFaceSnapshots: 2,
      allowCalculator: false,
    });
  });

  it("pins Standard's defaults", () => {
    expect(PROCTORING_DEFAULTS.standard).toEqual({
      profile: "standard",
      desktopOnly: true,
      requireFullscreen: true,
      blockCopyPaste: true,
      watermark: false,
      requireCamera: false,
      identityPhoto: false,
      snapshotIntervalSeconds: 0,
      faceCheck: false,
      requireMicrophone: false,
      extraMonitorCheck: false,
      violationLimit: 5,
      violationAction: "warn_then_flag",
      cameraOutageSeconds: 120,
      multiFaceSnapshots: 2,
      allowCalculator: false,
    });
  });

  it("pins Strict's defaults", () => {
    expect(PROCTORING_DEFAULTS.strict).toEqual({
      profile: "strict",
      desktopOnly: true,
      requireFullscreen: true,
      blockCopyPaste: true,
      watermark: true,
      requireCamera: true,
      identityPhoto: true,
      snapshotIntervalSeconds: 60,
      faceCheck: false,
      requireMicrophone: false,
      extraMonitorCheck: true,
      violationLimit: 5,
      violationAction: "warn_then_flag",
      cameraOutageSeconds: 120,
      multiFaceSnapshots: 2,
      allowCalculator: false,
    });
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

  // Phase 7c Task 5 (`T5-R3`): blocked paste and the watermark get the
  // same before-the-timer sentence a camera does.
  it("names copy/paste blocking and the watermark when each is on", () => {
    const lines = proctoringRequirements(resolveProctoring({ profile: "strict" }));
    expect(lines.join(" ")).toMatch(/pasting/i);
    expect(lines.join(" ")).toMatch(/watermark/i);
  });

  it("omits both when neither is on", () => {
    const lines = proctoringRequirements(
      resolveProctoring({
        profile: "strict",
        overrides: { block_copy_paste: false, watermark: false },
      }),
    );
    expect(lines.join(" ")).not.toMatch(/pasting/i);
    expect(lines.join(" ")).not.toMatch(/watermark/i);
  });

  // `Q11b`: no camera requirement means no stream is ever acquired, so a
  // document asking for an identity photo or snapshots without a camera
  // must not tell the candidate a capture is coming — nothing can take it.
  it("omits the identity photo and the images when require_camera is false", () => {
    const lines = proctoringRequirements(
      resolveProctoring({
        profile: "strict",
        overrides: { require_camera: false, identity_photo: true, snapshot_interval_seconds: 60 },
      }),
    );
    expect(lines.join(" ")).not.toMatch(/photo/i);
    expect(lines.join(" ")).not.toMatch(/every 60 seconds/i);
  });
});

// Task 5 (Q2/Q7b): the closed event vocabulary and its violation/failure
// split. One definition here; Phase 8's monitor and CSV, and the violation
// counter and integrity flag, all read it instead of re-deriving it.
describe("proctoring events", () => {
  it("never classifies an event type as both a violation and a failure", () => {
    for (const t of PROCTORING_EVENTS) {
      expect([VIOLATION_EVENTS.has(t), FAILURE_EVENTS.has(t)].filter(Boolean).length, t)
        .toBeLessThanOrEqual(1);
    }
  });

  it("counts a camera loss as a violation and an upload failure as a failure", () => {
    expect(isViolation("camera_lost")).toBe(true);
    expect(isViolation("snapshot_failed")).toBe(false);
    expect(FAILURE_EVENTS.has("snapshot_failed")).toBe(true);
  });

  it("does not count noise toward a limit", () => {
    expect(isViolation("noise_above_threshold")).toBe(false);
    expect(FAILURE_EVENTS.has("noise_above_threshold")).toBe(false);
  });
});
