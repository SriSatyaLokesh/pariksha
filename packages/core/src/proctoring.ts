// `resolveProctoring()` is the one function every Phase 7 reader resolves
// proctoring settings through: the editor, the candidate-side gates, the
// camera, the consequences. `Q1` — `profile` only supplies defaults; no
// reader branches on it, so every one of those readers can ask this
// function instead of asking "which profile is this?" themselves.

export type ProctoringProfile = "off" | "standard" | "strict";
export type ViolationAction = "warn_only" | "warn_then_flag" | "auto_submit" | "lock";

// Phase 7b Task 4 (`Q11a`): one JPEG snapshot's size, publicly stated
// already at `apps/web/src/sections/signal/Tail.tsx:125` ("320×240 JPEG
// snapshots, about 25 KB each") — not a guess invented for this figure.
// `KB_PER_MB` is decimal (SI), not the binary 1024: it is the only
// conversion that reproduces both worked examples with no rounding fudge
// — 180 min at a 15 s interval is exactly 18 MB, and the design spec's
// 60 min at 60 s is exactly 1.5 MB. Binary MiB rounds one of the two to
// a different figure.
//
// Moved here from `apps/api/src/publish/checklist.ts` (where this comment
// originated) because `apps/web`'s `snapshot-cost.ts` needs the same two
// numbers and cannot import across apps — one promise, one source, two
// readers (`R2`, task-4-brief.md ruling).
export const SNAPSHOT_KB = 25;
export const KB_PER_MB = 1000;

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
  /** Phase 8.5 (#209): microphone noise monitoring enabled via overrides. */
  requireMicrophone: boolean;
  extraMonitorCheck: boolean;
  violationLimit: number;
  /** Phase 7e Task 1 (issue #213) restores this: `resolveProctoring`
   *  resolves the real override/default again, the same as every other
   *  control. Was hardcoded to `"warn_only"` from #214 until a consumer
   *  existed — `violationOutcome` (`proctoring-outcome.ts`) is that
   *  consumer, called from `apps/api/src/routes/proctoring.ts`'s ingest. */
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

// Phase 7b branch-review Finding 9: the one place these three display names
// live. `ProctoringPanel.tsx` (the control) and `SettingRow.tsx` (the
// collapsed row) used to carry two mechanisms for the same three strings —
// a table here would have made one of them redundant from the start, and a
// reader who grepped for the word a screen actually shows ("Strict") could
// not find the capitalising function that produced it.
export const PROFILE_LABEL: Readonly<Record<ProctoringProfile, string>> = {
  off: "Off",
  standard: "Standard",
  strict: "Strict",
};

// The defaults table (phase-7a brief). This task fixes it; later plans only
// read it. Two rulings worth remembering while reading it:
//
// - Strict never defaulted `violation_action` to `lock` even before issue
//   #214 below made the whole table `warn_only`: `lock`'s only way out is an
//   organiser opening the attempt, and Strict already blocks indefinitely on
//   a dead camera (`Q2`) — stacking the phase's two sharpest edges on an
//   organiser who just picked a preset was never the plan.
// - `face_check` is `false` on every row. `Q3` pre-cut it; see
//   `resolveProctoring` below for why it is refused even when overridden.
// - `require_microphone` is `false` on every row: profiles default it off,
//   and organizers enable it explicitly via overrides (Phase 8.5, issue #209).
// - `violation_action` was `warn_only` on every row from issue #214 until
//   Phase 7e Task 1 (#213) gave it a consumer (`violationOutcome`) and
//   restored Standard and Strict to their intended `warn_then_flag` —
//   `resolveProctoring` resolves the real value again below. `off` stays
//   `warn_only`: it never defaulted to anything else, #214 or not.
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
    // Phase 8.5 (#209): microphone proctoring resolved from overrides or defaults.
    requireMicrophone: overrideOr(overrides, "require_microphone", defaults.requireMicrophone),
    extraMonitorCheck: overrideOr(overrides, "extra_monitor_check", defaults.extraMonitorCheck),
    // M7: `PUT /draft` and `POST /tests/import` accept arbitrary JSON —
    // `violation_limit: 0` would lock (or flag `high_risk`) every candidate
    // on their very first event batch, `0 >= 0` being true from the start.
    // The UI already floors this control at 1; this is the server-side
    // floor that a hand-edited or imported document cannot route around.
    // `snapshotIntervalSeconds` above keeps accepting 0 on purpose — that
    // one really does mean "off".
    violationLimit: Math.max(1, overrideOr(overrides, "violation_limit", defaults.violationLimit)),
    // Phase 7e Task 1 (#213): restored to a real `overrideOr`, the same
    // shape as every other control. Was hardcoded `"warn_only"` from #214
    // until a consumer existed — `violationOutcome` (`proctoring-outcome.ts`)
    // is that consumer. `apps/web/ProctoringPanel.tsx`'s select stays
    // `disabled` (unchanged by this task; it shows the raw document value
    // either way), so an organiser cannot yet *drive* this from the UI, but
    // a document that already holds `auto_submit`/`lock`/`warn_then_flag`
    // (round-tripped since #214) now resolves to it for real.
    violationAction: overrideOr(overrides, "violation_action", defaults.violationAction),
    // M7: same floor, same reason — `0` would make `high_risk` unconditional
    // in `integrityFor`.
    cameraOutageSeconds: Math.max(1, overrideOr(overrides, "camera_outage_seconds", defaults.cameraOutageSeconds)),
    multiFaceSnapshots: Math.max(1, overrideOr(overrides, "multi_face_snapshots", defaults.multiFaceSnapshots)),
    allowCalculator: overrideOr(overrides, "allow_calculator", defaults.allowCalculator),
  };
}

/**
 * Review finding 7 (whole-branch): the one "is any proctoring control
 * active" fact, read by both packages that need to ask it —
 * `proctoringRequirements` below (the browser line and the window-leave
 * line) and `ProctoringLayer` (whether to monitor window-leave at all).
 * One definition, here, rather than two expressions that can read
 * differently the moment someone adds a control to one and not the other.
 */
export function anyProctoringControlActive(resolved: ResolvedProctoring): boolean {
  return (
    resolved.desktopOnly ||
    resolved.requireFullscreen ||
    resolved.blockCopyPaste ||
    resolved.watermark ||
    resolved.requireCamera ||
    resolved.identityPhoto ||
    resolved.snapshotIntervalSeconds > 0 ||
    resolved.requireMicrophone ||
    resolved.extraMonitorCheck
  );
}

/**
 * `Q11`: per candidate, never a total — the product does not know the
 * headcount.
 *
 * Counts interval snapshots only; the identity photo sits inside the "≈"
 * (`R1`, task-4-brief.md's ruling over the brief's own contradictory "+1"
 * test). `images = floor(durationMinutes * 60 / snapshotIntervalSeconds)`
 * is the one arithmetic both `apps/web`'s panel/row and
 * `apps/api/src/publish/checklist.ts`'s `proctoring_snapshot_cost` row
 * read — moved here (Phase 7b branch-review Finding 6) so a rounding or
 * floor change can no longer diverge between the two readers the way two
 * copies of the same expression could.
 *
 * The division is guarded before it runs, not sanitised after:
 * `durationMinutes: null` (no duration set yet, #179's shape) returns
 * `null` immediately. `!resolved.requireCamera` returns `null` too — `Q11b`
 * is explicit that `require_camera: false` means `getUserMedia` is never
 * called for video at all, so there is no stream to snapshot and nothing is
 * ever captured regardless of what the interval says (branch-review
 * Finding 1: this used to be true of the panel's *images* clause but not
 * of this function, so a camera-off Strict test stated a non-zero cost for
 * images it also said it would never take). And
 * `snapshotIntervalSeconds <= 0` (snapshots off, `Q11b` — 0 means off,
 * including a document whose interval is unset and resolves to 0) returns
 * `null` before `60 * 60 / 0` can ever produce `Infinity`.
 */
export function snapshotCost(input: {
  durationMinutes: number | null;
  resolved: ResolvedProctoring;
}): { images: number; megabytes: number; uploads: number } | null {
  const { durationMinutes, resolved } = input;
  if (durationMinutes === null) return null;
  if (!resolved.requireCamera) return null;
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

/**
 * `Q1b`: plain sentences for the start page, from the same object the
 * runtime enforces — a candidate who will be denied for having no camera
 * learns it before the timer, not from a drifted second copy of this list.
 * `T5-R3` (7c Task 5): `blockCopyPaste` and `watermark` get a sentence here
 * too — the same reason a camera does: the candidate learns what is
 * enforced before the timer starts, not after a paste is refused or their
 * watermark shows up across the page. Standard defaults `blockCopyPaste`
 * true, so this is the sentence that changes Standard's resolved list.
 * Review finding 3: window-leave is monitored and counted whenever
 * `anyProctoringControlActive` is true, not only under
 * `requireFullscreen` — the sentence below is gated on that same
 * predicate, so the two cannot diverge again.
 *
 * Fixed order: desktop, browser, window-leave, fullscreen, copy/paste,
 * watermark, camera, identity photo, images, microphone, extra monitor —
 * `ResolvedProctoring`'s own field order, with the two sentences that have
 * no dedicated field (browser, window-leave) ahead of it. A disabled
 * control contributes no line. The browser and window-leave lines are
 * backed by no override of their own — both are emitted only when
 * `anyProctoringControlActive` is true, so Off still produces an empty
 * list. Identity photo and images are additionally gated on
 * `requireCamera`: neither capture can happen without it (`Q11b`), so a
 * document that asks for one without the other promises nothing here —
 * see the checklist's `proctoring_capture_without_camera` row for where
 * that organiser is told instead.
 */
export function proctoringRequirements(resolved: ResolvedProctoring): string[] {
  const lines: string[] = [];

  if (resolved.desktopOnly) {
    lines.push("This test must be taken on a desktop or laptop, not a phone or tablet.");
  }

  const anyControlActive = anyProctoringControlActive(resolved);
  if (anyControlActive) {
    // No device clause here — `desktopOnly` is the only line that names a
    // device, and it already fires whenever a device is actually required
    // (the only time it is true). `desktop_only` is a supported
    // configuration a phone may take, so claiming a laptop or desktop on
    // every other requirement too would tell a phone candidate something
    // false, the same false claim Task 11 deliberately removed from
    // `apps/web/src/routes/exam.tsx`'s device check.
    lines.push("Use a fully updated Chrome, Edge, Firefox or Safari.");
    // Review finding 3: `window_blur`/`visibility_hidden` are monitored
    // and counted whenever any control is active (`ProctoringLayer`), not
    // only under `requireFullscreen` — this line keeps that true for the
    // candidate as well as for the runtime.
    lines.push("Leaving this browser tab or window is logged.");
  }

  if (resolved.requireFullscreen) {
    lines.push("The test runs in fullscreen. Leaving it is logged.");
  }
  if (resolved.blockCopyPaste) {
    lines.push("Copying, pasting and right-click are disabled, and attempts are logged.");
  }
  if (resolved.watermark) {
    lines.push("Your attempt id and the time are shown as a watermark across the page.");
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
    lines.push("Your microphone is on. Noise level is monitored; no audio is recorded or stored.");
  }
  if (resolved.extraMonitorCheck) {
    // Review finding 2: nothing refuses or blocks on `extra_monitor` — it
    // is recorded and counted as a violation, never more than that.
    // "Not allowed" overclaimed; this says what the code actually does.
    lines.push("A second monitor is checked for and recorded.");
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

// Phase 7e Task 1 fix round (F1, Critical): `PROCTORING_EVENTS` above is
// every type `appendEvents` can store, but three of them are written only
// by server-side route logic — never a candidate's own POST. Before this,
// `apps/api/src/routes/proctoring.ts`'s `eventItem` accepted the whole
// union from the candidate's own request body, which let a candidate POST
// `{"type":"violation_limit_reached"}` at violation 0 and forge the one
// fact `violationOutcome`'s `alreadyActioned` is gated on — permanently
// switching their own attempt's consequences off (`Q7a` exactly inverted:
// the client handing the server its own decision).
//
// Two independent, hand-written lists, not one computed as "whatever's
// left" from the other: a derived complement is complete by construction,
// so a test asserting it partitions `PROCTORING_EVENTS` could never fail —
// which is exactly how a third server-only type joined this union
// unnoticed in the first place (Phase 7d). `proctoring.test.ts`'s own
// partition test can fail two real ways: a type in neither list (added to
// `PROCTORING_EVENTS` but never classified) or a type in both (misclassified
// — the shape of this very bug, run in reverse).

/**
 * Written only by this package's own server-side route logic — a lock
 * firing, an unlock, the violation limit being reached. Never legitimately
 * present in a candidate's own `POST /attempt/events` body.
 */
export const SERVER_SYNTHESIZED_EVENTS = [
  "violation_limit_reached", "attempt_locked", "attempt_unlocked",
] as const satisfies readonly ProctoringEventType[];

/**
 * The events a candidate's browser can legitimately observe and report.
 * `eventItem` (`apps/api/src/routes/proctoring.ts`) is built from this, not
 * from `PROCTORING_EVENTS` — a server-synthesized type is refused with a
 * 400 at the schema, before anything is written.
 */
export const CANDIDATE_PROCTORING_EVENTS = [
  "fullscreen_exit", "fullscreen_restore",
  "window_blur", "visibility_hidden",
  "copy_blocked", "paste_blocked", "contextmenu_blocked",
  "extra_monitor", "camera_lost", "camera_restored",
  "identity_photo_captured", "noise_above_threshold",
  "proctoring_unavailable", "snapshot_failed",
] as const satisfies readonly ProctoringEventType[];

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

/**
 * `Q7b`: the detail shape each event this phase's gate task (7c Task 4)
 * emits. The handoff's open question 2 assigns shape-declaring to whoever
 * emits an event — 7d declares camera/snapshot/noise, 7e the lifecycle
 * ones. The wire stays `z.unknown()` in `apps/api/src/routes/proctoring.ts`
 * by that same route's own comment ("belongs to the plan that emits each
 * event, not to the route that merely stores whatever it is handed") — this
 * is the producer's own contract for what it puts in the field, not a
 * schema change.
 *
 * `fullscreen_exit`/`fullscreen_restore` pair up and need nothing beyond
 * the event envelope itself. `window_blur`/`visibility_hidden` do not pair
 * with a second event (`T4-R4`'s ruling): the duration is carried on the
 * leave event itself, sent once the candidate returns — `null` when a page
 * unload flushed the queue before a return was ever observed.
 */
export type FullscreenExitDetail = Record<string, never>;
export type FullscreenRestoreDetail = Record<string, never>;
export interface WindowBlurDetail {
  /** `Date.now()` on return minus `Date.now()` when the departure started;
   *  `null` when the queue flushed this event before a return happened
   *  (the page unloaded while away). */
  awayMs: number | null;
}
export type VisibilityHiddenDetail = WindowBlurDetail;

/**
 * `T5-R4` (7c Task 5): the four this task emits — `copy_blocked`,
 * `paste_blocked` and `contextmenu_blocked` need nothing beyond the
 * envelope itself, the same as the fullscreen pair above; `extra_monitor`
 * carries no payload either — `P-08`'s own ruling is read-only
 * (`window.screen.isExtended`), so there is no second fact to attach
 * beyond the event having fired.
 */
export type CopyBlockedDetail = Record<string, never>;
export type PasteBlockedDetail = Record<string, never>;
export type ContextmenuBlockedDetail = Record<string, never>;
export type ExtraMonitorDetail = Record<string, never>;

/**
 * #209: The event's `detail` contains only a duration — no samples, no levels,
 * no derived audio features.
 */
export interface NoiseAboveThresholdDetail {
  durationMs: number;
}

export function detailFor(durationMs: number): NoiseAboveThresholdDetail {
  return { durationMs };
}
