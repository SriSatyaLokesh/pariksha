// `resolveProctoring()` is the one function every Phase 7 reader resolves
// proctoring settings through: the editor, the candidate-side gates, the
// camera, the consequences. `Q1` — `profile` only supplies defaults; no
// reader branches on it, so every one of those readers can ask this
// function instead of asking "which profile is this?" themselves.

export type ProctoringProfile = "off" | "standard" | "strict";
export type ViolationAction = "warn_only" | "warn_then_flag" | "auto_submit" | "lock";

/** Every field present, no optionals. This is what every reader consumes. */
export interface ResolvedProctoring {
  profile: ProctoringProfile;
  desktopOnly: boolean;
  requireFullscreen: boolean;
  blockCopyPaste: boolean;
  watermark: boolean;
  requireCamera: boolean;
  identityPhoto: boolean;
  /** 0 means off — no capture timer, no uploads, no rows (`Q11b`). */
  snapshotIntervalSeconds: number;
  /** Always resolves false in Phase 7: the control is pre-cut (`Q3`). */
  faceCheck: boolean;
  requireMicrophone: boolean;
  extraMonitorCheck: boolean;
  violationLimit: number;
  violationAction: ViolationAction;
  cameraOutageSeconds: number;
  multiFaceSnapshots: number;
  allowCalculator: boolean;
}

export type ProctoringOverrides = Partial<{
  desktop_only: boolean; require_fullscreen: boolean; block_copy_paste: boolean;
  watermark: boolean; require_camera: boolean; identity_photo: boolean;
  snapshot_interval_seconds: number; face_check: boolean; require_microphone: boolean;
  extra_monitor_check: boolean; violation_limit: number; violation_action: ViolationAction;
  camera_outage_seconds: number; multi_face_snapshots: number; allow_calculator: boolean;
}>;

// The defaults table (phase-7a brief). This task fixes it; later plans only
// read it. Two rulings worth remembering while reading it:
//
// - Strict does not default `violation_action` to `lock`. `lock`'s only way
//   out is an organiser opening the attempt, and Strict already blocks
//   indefinitely on a dead camera (`Q2`) — defaulting to `lock` too would
//   stack the phase's two sharpest edges on an organiser who just picked a
//   preset. `lock` is opt-in.
// - `face_check` is `false` on every row. `Q3` pre-cut it; see
//   `resolveProctoring` below for why it is refused even when overridden.
export const PROCTORING_DEFAULTS: Readonly<Record<ProctoringProfile, ResolvedProctoring>> = {
  off: {
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
  },
  standard: {
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
  },
  strict: {
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
  },
};

/**
 * Reads one override by presence, not by truthiness: an absent key and an
 * explicit `undefined` both fall through to `fallback`. Never `||`, never a
 * bare `??` — several of these keys are legitimately `0` or `false`
 * (`snapshot_interval_seconds: 0` means "snapshots are off"), and either
 * operator would silently replace that value with the profile default.
 */
function overrideOr<K extends keyof ProctoringOverrides>(
  overrides: ProctoringOverrides | undefined,
  key: K,
  fallback: NonNullable<ProctoringOverrides[K]>,
): NonNullable<ProctoringOverrides[K]> {
  if (overrides && key in overrides && overrides[key] !== undefined) {
    return overrides[key];
  }
  return fallback;
}

export function resolveProctoring(
  input: { profile?: ProctoringProfile; overrides?: ProctoringOverrides } | undefined,
): ResolvedProctoring {
  const profile = input?.profile ?? "off";
  // Not reachable today — `profile` is typed to the three keys this table
  // has — but this is a public `@pariksha/core` function whose own doc
  // comment promises every field present, and a later plan calls it from
  // the browser against payload-shaped input it does not control.
  const defaults = PROCTORING_DEFAULTS[profile] ?? PROCTORING_DEFAULTS.off;
  const overrides = input?.overrides;
  return {
    profile,
    desktopOnly: overrideOr(overrides, "desktop_only", defaults.desktopOnly),
    requireFullscreen: overrideOr(overrides, "require_fullscreen", defaults.requireFullscreen),
    blockCopyPaste: overrideOr(overrides, "block_copy_paste", defaults.blockCopyPaste),
    watermark: overrideOr(overrides, "watermark", defaults.watermark),
    requireCamera: overrideOr(overrides, "require_camera", defaults.requireCamera),
    identityPhoto: overrideOr(overrides, "identity_photo", defaults.identityPhoto),
    snapshotIntervalSeconds: overrideOr(
      overrides,
      "snapshot_interval_seconds",
      defaults.snapshotIntervalSeconds,
    ),
    // Q3: pre-cut. Accepted and round-tripped (Task 2) so a document
    // authored for Phase 8 survives, but resolution refuses it outright —
    // not an omission, a deliberate `false` regardless of profile or
    // override, so nothing in Phase 7 can act on it.
    faceCheck: false,
    requireMicrophone: overrideOr(overrides, "require_microphone", defaults.requireMicrophone),
    extraMonitorCheck: overrideOr(overrides, "extra_monitor_check", defaults.extraMonitorCheck),
    violationLimit: overrideOr(overrides, "violation_limit", defaults.violationLimit),
    violationAction: overrideOr(overrides, "violation_action", defaults.violationAction),
    cameraOutageSeconds: overrideOr(overrides, "camera_outage_seconds", defaults.cameraOutageSeconds),
    multiFaceSnapshots: overrideOr(overrides, "multi_face_snapshots", defaults.multiFaceSnapshots),
    allowCalculator: overrideOr(overrides, "allow_calculator", defaults.allowCalculator),
  };
}

/**
 * `Q1b`: plain sentences for the start page, from the same object the
 * runtime enforces — a candidate who will be denied for having no camera
 * learns it before the timer, not from a drifted second copy of this list.
 *
 * Fixed order: desktop, browser, fullscreen, camera, identity photo,
 * images, microphone, extra monitor. A disabled control contributes no
 * line. The browser line itself is backed by no override — it is emitted
 * only when at least one other requirement is enabled (derived from
 * whether any other line was produced, not from `profile`), so Off still
 * produces an empty list. Identity photo and images are additionally
 * gated on `requireCamera`: neither capture can happen without it
 * (`Q11b`), so a document that asks for one without the other promises
 * nothing here — see the checklist's `proctoring_capture_without_camera`
 * row for where that organiser is told instead.
 */
export function proctoringRequirements(resolved: ResolvedProctoring): string[] {
  const lines: string[] = [];

  if (resolved.desktopOnly) {
    lines.push("This test must be taken on a desktop or laptop, not a phone or tablet.");
  }

  const anyOtherRequirement =
    resolved.desktopOnly ||
    resolved.requireFullscreen ||
    resolved.requireCamera ||
    resolved.identityPhoto ||
    resolved.snapshotIntervalSeconds > 0 ||
    resolved.requireMicrophone ||
    resolved.extraMonitorCheck;
  if (anyOtherRequirement) {
    // No device clause here — `desktopOnly` is the only line that names a
    // device, and it already fires whenever a device is actually required
    // (the only time it is true). `desktop_only` is a supported
    // configuration a phone may take, so claiming a laptop or desktop on
    // every other requirement too would tell a phone candidate something
    // false, the same false claim Task 11 deliberately removed from
    // `apps/web/src/routes/exam.tsx`'s device check.
    lines.push("Use a fully updated Chrome, Edge, Firefox or Safari.");
  }

  if (resolved.requireFullscreen) {
    lines.push("The test runs in fullscreen. Leaving it is logged.");
  }
  if (resolved.requireCamera) {
    lines.push("A working camera is required for the whole test.");
  }
  // `identityPhoto` and the per-interval images both need a live camera
  // stream to produce anything — `Q11b`: `require_camera` false means
  // `getUserMedia` is never called, no permission prompt, no indicator, no
  // capture. A document with `require_camera: false, identity_photo: true`
  // must not promise a photo nothing can take. `resolveProctoring` is not
  // the place to paper over that by inferring `requireCamera` from either
  // toggle — a camera requirement blocks an attempt indefinitely by
  // design, and arriving at it from a different control is exactly the
  // inference this phase refuses to make. The organiser is told instead,
  // in the publish checklist's `proctoring_capture_without_camera` row.
  if (resolved.requireCamera && resolved.identityPhoto) {
    lines.push("A photo of your face is taken before you can start.");
  }
  if (resolved.requireCamera && resolved.snapshotIntervalSeconds > 0) {
    lines.push(`The camera captures an image every ${String(resolved.snapshotIntervalSeconds)} seconds.`);
  }
  if (resolved.requireMicrophone) {
    lines.push("A working microphone is required for the whole test.");
  }
  if (resolved.extraMonitorCheck) {
    lines.push("A second monitor is not allowed and is checked for.");
  }

  return lines;
}

// Phase 7a Task 5 (`Q7b`/`Q2`): the closed event vocabulary. A later plan's
// browser-side proctor emits these; Phase 8's monitor and CSV export are the
// readers this union exists for — both need a fixed string literal to switch
// on, so the union is closed (not `string`) and this file is the only place
// new names get added.
export const PROCTORING_EVENTS = [
  "fullscreen_exit", "fullscreen_restore",
  "window_blur", "visibility_hidden",
  "copy_blocked", "paste_blocked", "contextmenu_blocked",
  "extra_monitor", "camera_lost", "camera_restored",
  "identity_photo_captured", "noise_above_threshold",
  "proctoring_unavailable", "snapshot_failed",
  "violation_limit_reached", "attempt_locked", "attempt_unlocked",
] as const;
export type ProctoringEventType = (typeof PROCTORING_EVENTS)[number];

/**
 * `Q2`: the subset that counts toward `violationLimit`. Defined once, here,
 * rather than re-derived by the violation counter and the integrity flag
 * separately — both read this set instead of switching on the event name
 * themselves.
 */
export const VIOLATION_EVENTS: ReadonlySet<ProctoringEventType> = new Set([
  "fullscreen_exit", "window_blur", "visibility_hidden",
  "copy_blocked", "paste_blocked", "contextmenu_blocked",
  "extra_monitor", "camera_lost",
]);

/**
 * `Q6b`: the subset that marks an attempt unobserved rather than suspicious
 * — the proctoring stack itself failed, not the candidate.
 */
export const FAILURE_EVENTS: ReadonlySet<ProctoringEventType> = new Set([
  "proctoring_unavailable", "snapshot_failed",
]);

// Deliberately neither: the four restore/capture/lifecycle types
// (`fullscreen_restore`, `camera_restored`, `identity_photo_captured`,
// `violation_limit_reached`/`attempt_locked`/`attempt_unlocked`) describe
// state, not misbehaviour, so counting them would double up on the events
// that caused them.
//
// `noise_above_threshold` is also neither, and that one is a ruling, not an
// omission: it is recorded and shown on the attempt, but it counts toward
// nothing. A microphone threshold that auto-submits an attempt because a
// door slammed is exactly the false positive this phase exists to avoid —
// nothing in the brief asks noise to gate an attempt, so it stays visible
// without being load-bearing.
export function isViolation(type: ProctoringEventType): boolean {
  return VIOLATION_EVENTS.has(type);
}
