// Phase 7a Task 1: `resolveProctoring()` is the one function every later
// Phase 7 plan (the editor, the candidate-side gates, the camera, the
// consequences) resolves proctoring settings through. These tests are the
// contract those plans build against — in particular the `||` trap (Review
// Focus 2): `snapshot_interval_seconds: 0` must stay 0 against a profile
// default of 60.

import { describe, expect, it } from "vitest";
import {
  anyProctoringControlActive,
  CANDIDATE_PROCTORING_EVENTS,
  detailFor,
  FAILURE_EVENTS,
  isViolation,
  KB_PER_MB,
  PROCTORING_DEFAULTS,
  PROCTORING_EVENTS,
  proctoringRequirements,
  resolveProctoring,
  SERVER_SYNTHESIZED_EVENTS,
  snapshotCost,
  SNAPSHOT_KB,
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
      aiAudioCheck: false,
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
      aiAudioCheck: false,
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
      aiAudioCheck: false,
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

  // Native on-device face counting (Issue #264).
  it("resolves faceCheck true when overridden", () => {
    expect(resolveProctoring({ profile: "strict", overrides: { face_check: true } }).faceCheck).toBe(true);
    expect(resolveProctoring({ profile: "off", overrides: { face_check: true } }).faceCheck).toBe(true);
    expect(resolveProctoring({ profile: "off", overrides: { face_check: false } }).faceCheck).toBe(false);
  });

  it("resolves require_microphone: true when explicitly overridden", () => {
    const resolved = resolveProctoring({ profile: "off", overrides: { require_microphone: true } });
    expect(resolved.requireMicrophone).toBe(true);
  });

  it("defaults requireMicrophone to false across off, standard, and strict profiles", () => {
    expect(resolveProctoring({ profile: "off" }).requireMicrophone).toBe(false);
    expect(resolveProctoring({ profile: "standard" }).requireMicrophone).toBe(false);
    expect(resolveProctoring({ profile: "strict" }).requireMicrophone).toBe(false);
  });

  // Phase 7e Task 1 (#213) restores this: `violationAction` was refused
  // outright from #214 until `violationOutcome` gave it a consumer. Same
  // shape as the positive-control tests above — the override is honoured
  // exactly like every sibling control, for each of the four real values.
  it.each(["warn_only", "warn_then_flag", "auto_submit", "lock"] as const)(
    "resolves violationAction to whatever the document asks for (%s), leaving its sibling overrides honoured",
    (violation_action) => {
      const r = resolveProctoring({
        profile: "off",
        overrides: { violation_action, desktop_only: true },
      });
      expect(r.desktopOnly).toBe(true);
      expect(r.violationAction).toBe(violation_action);
    },
  );

  // M7: `violation_limit: 0` would make `claimViolationLimit`'s own
  // `violations (0) >= limit (0)` true on the first batch, and
  // `integrityFor`'s identical comparison `high_risk` unconditional —
  // unlike `snapshot_interval_seconds`, 0 here has no legitimate meaning.
  it.each([
    ["violation_limit", "violationLimit"],
    ["camera_outage_seconds", "cameraOutageSeconds"],
    ["multi_face_snapshots", "multiFaceSnapshots"],
  ] as const)("floors %s at 1 — a document-supplied 0 cannot make every attempt high_risk", (override, field) => {
    const r = resolveProctoring({ profile: "strict", overrides: { [override]: 0 } });
    expect(r[field]).toBe(1);
  });

  it.each([
    ["violation_limit", "violationLimit"],
    ["camera_outage_seconds", "cameraOutageSeconds"],
    ["multi_face_snapshots", "multiFaceSnapshots"],
  ] as const)("leaves %s honoured above the floor", (override, field) => {
    const r = resolveProctoring({ profile: "strict", overrides: { [override]: 3 } });
    expect(r[field]).toBe(3);
  });

  it("snapshot_interval_seconds keeps no floor — 0 still means off", () => {
    expect(
      resolveProctoring({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } }).snapshotIntervalSeconds,
    ).toBe(0);
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

  it("emits the exact candidate microphone disclosure sentence", () => {
    const resolved = resolveProctoring({ overrides: { require_microphone: true } });
    expect(proctoringRequirements(resolved)).toContain(
      "Your microphone is on. Noise level is monitored; no audio is recorded or stored."
    );
  });
});

// Review finding 7 (whole-branch): the one "is any proctoring control
// active" predicate `proctoringRequirements` and `ProctoringLayer` both
// read. Untested directly in core before this — only indirectly through
// `proctoringRequirements`'s browser/window-leave lines.
describe("anyProctoringControlActive", () => {
  it("is false when every control is off", () => {
    expect(anyProctoringControlActive(resolveProctoring({ profile: "off" }))).toBe(false);
  });

  it("is true when a boolean control is on", () => {
    expect(
      anyProctoringControlActive(resolveProctoring({ profile: "off", overrides: { desktop_only: true } })),
    ).toBe(true);
  });

  // The one non-boolean field in the predicate: `snapshotIntervalSeconds > 0`,
  // not mere truthiness.
  it("is true when the snapshot interval is set, even with every boolean control off", () => {
    expect(
      anyProctoringControlActive(
        resolveProctoring({ profile: "off", overrides: { snapshot_interval_seconds: 60 } }),
      ),
    ).toBe(true);
  });
});

// `snapshotCost` had no test anywhere in `packages/core/test` before this —
// it was only exercised through `apps/web` and `apps/api`, invisible to
// core's own coverage gate. These pin the function's own doc comment: the
// three early-return guards, the arithmetic, and the floor.
describe("snapshotCost", () => {
  it("returns null when duration is not set yet", () => {
    const resolved = resolveProctoring({ profile: "strict" });
    expect(snapshotCost({ durationMinutes: null, resolved })).toBeNull();
  });

  // Load-bearing (`Q11b`, branch-review Finding 1): `require_camera: false`
  // means `getUserMedia` is never called for video, so nothing is ever
  // captured regardless of the interval. A non-zero interval and a real
  // duration beside the `false` prove the guard — not an interval that was
  // going to be null anyway.
  it("returns null when require_camera is false, even with a real interval and duration", () => {
    const resolved = resolveProctoring({
      profile: "strict",
      overrides: { require_camera: false, snapshot_interval_seconds: 60 },
    });
    expect(snapshotCost({ durationMinutes: 60, resolved })).toBeNull();
  });

  it("returns a real object for the same interval and duration when the camera is required", () => {
    const resolved = resolveProctoring({ profile: "strict" });
    expect(snapshotCost({ durationMinutes: 60, resolved })).not.toBeNull();
  });

  it("returns null when the snapshot interval is 0", () => {
    const resolved = resolveProctoring({
      profile: "strict",
      overrides: { snapshot_interval_seconds: 0 },
    });
    expect(snapshotCost({ durationMinutes: 60, resolved })).toBeNull();
  });

  it("returns null when the snapshot interval is negative", () => {
    const resolved = resolveProctoring({
      profile: "strict",
      overrides: { snapshot_interval_seconds: -1 },
    });
    expect(snapshotCost({ durationMinutes: 60, resolved })).toBeNull();
  });

  // The two worked examples named in the function's own doc comment and in
  // the file-header comment above `SNAPSHOT_KB`: 180 min at a 15 s interval
  // is exactly 18 MB (prints "18", no trailing ".0"); 60 min at 60 s is
  // exactly 1.5 MB. Computed from the exported constants, not hardcoded
  // 25/1000, so a change to either constant moves these with it.
  it("computes images, uploads and megabytes for 180 minutes at a 15s interval (18 MB)", () => {
    const resolved = resolveProctoring({ profile: "strict" });
    const result = snapshotCost({ durationMinutes: 180, resolved: { ...resolved, snapshotIntervalSeconds: 15 } });
    const images = 720;
    expect(result).toEqual({ images, uploads: images, megabytes: (images * SNAPSHOT_KB) / KB_PER_MB });
    expect(String(result?.megabytes)).toBe("18");
  });

  it("computes images, uploads and megabytes for 60 minutes at a 60s interval (1.5 MB)", () => {
    const resolved = resolveProctoring({ profile: "strict" });
    const result = snapshotCost({ durationMinutes: 60, resolved });
    const images = 60;
    expect(result).toEqual({ images, uploads: images, megabytes: (images * SNAPSHOT_KB) / KB_PER_MB });
    expect(String(result?.megabytes)).toBe("1.5");
  });

  // The floor: a duration that does not divide evenly rounds down, not to
  // the nearest or up. 10 minutes at a 7s interval is 85.71... images, not 86.
  it("floors a duration that does not divide evenly by the interval", () => {
    const resolved = resolveProctoring({
      profile: "strict",
      overrides: { snapshot_interval_seconds: 7 },
    });
    const result = snapshotCost({ durationMinutes: 10, resolved });
    expect(result?.images).toBe(85);
    expect(result?.uploads).toBe(85);
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

  it("serialises noise_above_threshold detail carrying only durationMs", () => {
    expect(detailFor(1250)).toEqual({ durationMs: 1250 });
    expect(JSON.parse(JSON.stringify(detailFor(1250)))).toEqual({ durationMs: 1250 });
  });

  it("keeps noise_above_threshold non-punitive (neither violation nor failure event)", () => {
    expect(isViolation("noise_above_threshold")).toBe(false);
    expect(VIOLATION_EVENTS.has("noise_above_threshold")).toBe(false);
    expect(FAILURE_EVENTS.has("noise_above_threshold")).toBe(false);
  });
});

// Phase 7e Task 1 fix round (F1, Critical): the guard that stops a server-
// synthesized type from silently becoming candidate-submittable again.
// `CANDIDATE_PROCTORING_EVENTS` and `SERVER_SYNTHESIZED_EVENTS` are two
// independent, hand-written lists — neither is computed from the other or
// from `PROCTORING_EVENTS` — so both assertions below are real: a type
// added to `PROCTORING_EVENTS` and left off both lists breaks the union,
// and a type listed on both breaks the intersection. Probed (task-1-report.
// md): adding `"attempt_locked"` to `CANDIDATE_PROCTORING_EVENTS` failed
// the intersection assertion with the verbatim array `["attempt_locked"]`.
describe("CANDIDATE_PROCTORING_EVENTS / SERVER_SYNTHESIZED_EVENTS", () => {
  it("partitions PROCTORING_EVENTS exhaustively, with no event type in both", () => {
    const union = new Set<string>([...CANDIDATE_PROCTORING_EVENTS, ...SERVER_SYNTHESIZED_EVENTS]);
    expect(union).toEqual(new Set(PROCTORING_EVENTS));

    const intersection = CANDIDATE_PROCTORING_EVENTS.filter((t) =>
      (SERVER_SYNTHESIZED_EVENTS as readonly string[]).includes(t),
    );
    expect(intersection).toEqual([]);
  });

  it("marks exactly the three server-synthesized lifecycle types as not candidate-submittable", () => {
    expect(SERVER_SYNTHESIZED_EVENTS).toEqual([
      "violation_limit_reached",
      "attempt_locked",
      "attempt_unlocked",
    ]);
  });
});
