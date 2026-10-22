// Phase 7b Task 4 (`Q11`, `Q11a`): the panel states what the current
// settings cost per candidate — images, megabytes and uploads.
//
// `R1` (task-4-brief.md ruling, correcting the brief): the cost counts
// interval snapshots only; the identity photo sits inside the "≈". The
// brief's own two worked assertions ("images: 60" at duration 60 with
// `strictResolved`, then "images: 61" after spreading in
// `identityPhoto: true` — already `true` on `PROCTORING_DEFAULTS.strict`,
// so that spread is a no-op) contradict each other, and three sources
// agree against the "+1": the spec's own panel example, the spec's 720-
// image worked example, and 7a's shipped `proctoring_snapshot_cost`
// checklist row. So the second test below is rewritten as the invariant
// it should have been — turning `identity_photo` on changes nothing — and
// the third is widened: a zero interval returns `null` even with the
// identity photo on.
//
// Mounts `ProctoringPanel` directly behind a local, stateful `Harness` —
// `openProctoringPanel` is a local helper per test file, not a shared one
// (Tasks 2 and 3's own files each keep their own copy; this one adds
// `durationMinutes` to the shape it hands in, since this is the first
// panel test file that needs to vary it).
//
// R2 (proctoring-profile.test.tsx, carried here): every negative assertion
// is paired with a proof the same query matches when the thing IS present
// — `queryBy*` expecting `null` passes for free against a wrong query.
// "says the figure cannot be computed" and "shows uploads beside
// megabytes" below are each other's positive control for the two
// `queryByText(null)` assertions in "renders nothing when snapshots are
// off": the first proves `/Set a duration/i` matches when the panel really
// renders it, the second proves `/per candidate/` matches when the panel
// really renders it.

import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  PROCTORING_DEFAULTS,
  snapshotCost,
  type ProctoringOverrides,
  type ProctoringProfile,
  type ResolvedProctoring,
} from "@pariksha/core";

import { ProctoringPanel } from "../../src/components/testbuilder/ProctoringPanel";

type Proctoring = { profile: ProctoringProfile; overrides: ProctoringOverrides };

const strictResolved: ResolvedProctoring = PROCTORING_DEFAULTS.strict;

describe("snapshotCost (Q11, R1)", () => {
  it("counts images, megabytes and uploads per candidate", () => {
    expect(snapshotCost({ durationMinutes: 60, resolved: strictResolved })).toEqual({
      images: 60,
      megabytes: 1.5,
      uploads: 60,
    });
  });

  // R1's rewrite of the brief's contradictory second test: the identity
  // photo sits inside the "≈" and changes nothing about the figure.
  it("does not change when the identity photo is toggled on", () => {
    const withPhoto = { ...strictResolved, identityPhoto: true };
    const withoutPhoto = { ...strictResolved, identityPhoto: false };
    expect(snapshotCost({ durationMinutes: 60, resolved: withPhoto })).toEqual(
      snapshotCost({ durationMinutes: 60, resolved: withoutPhoto }),
    );
    expect(snapshotCost({ durationMinutes: 60, resolved: withPhoto })?.images).toBe(60);
  });

  // R1's widening of Step 3's "null when the interval is 0 and no identity
  // photo": the identity photo being on does not rescue a zero interval.
  it("returns null when snapshots are off, even with the identity photo on", () => {
    expect(
      snapshotCost({
        durationMinutes: 60,
        resolved: { ...strictResolved, snapshotIntervalSeconds: 0, identityPhoto: true },
      }),
    ).toBeNull();
  });

  // Review Focus 3 — #179's shape: a test with no duration.
  it("returns null rather than NaN when the test has no duration", () => {
    expect(snapshotCost({ durationMinutes: null, resolved: strictResolved })).toBeNull();
  });

  // Branch-review Finding 1: `require_camera: false` means `getUserMedia`
  // is never called for video at all (`Q11b`) — no stream, nothing to
  // snapshot — regardless of what the interval says. Strict's own interval
  // (60 s over a 60-minute test) would otherwise price a camera that is
  // never on.
  it("returns null when there is no camera, even with a real interval and duration", () => {
    expect(
      snapshotCost({ durationMinutes: 60, resolved: { ...strictResolved, requireCamera: false } }),
    ).toBeNull();
  });

  // The spec's own 180-minute, 15 s-interval worked example (§14, `Q11`),
  // checked against the same function the 60-minute case above uses.
  it("matches the spec's 180-minute, 15 s worked example", () => {
    const resolved = { ...strictResolved, snapshotIntervalSeconds: 15 };
    expect(snapshotCost({ durationMinutes: 180, resolved })).toEqual({
      images: 720,
      megabytes: 18,
      uploads: 720,
    });
  });
});

/** Controlled, like Tasks 2 and 3's own `Harness` — a static `value` prop
 *  would assert on a component that can never change. Adds
 *  `durationMinutes`, which neither of those files needed to vary. */
function Harness({
  profile = "off",
  overrides = {},
  durationMinutes = null,
  onChange,
}: {
  profile?: ProctoringProfile;
  overrides?: ProctoringOverrides;
  durationMinutes?: number | null;
  onChange?: (next: Proctoring) => void;
}) {
  const [proctoring, setProctoring] = useState<Proctoring>({ profile, overrides });
  return (
    <ProctoringPanel
      value={proctoring}
      durationMinutes={durationMinutes}
      onChange={(next) => {
        onChange?.(next);
        setProctoring(next);
      }}
    />
  );
}

async function openProctoringPanel(
  init: { profile?: ProctoringProfile; overrides?: ProctoringOverrides } = {},
  opts: { durationMinutes?: number | null; onChange?: (next: Proctoring) => void } = {},
): Promise<void> {
  render(<Harness {...init} {...opts} />);
  await screen.findByRole("group", { name: /Proctoring/i });
}

describe("the panel states the cost, on the screen (Q11)", () => {
  it("says the figure cannot be computed until a duration is set", async () => {
    await openProctoringPanel({ profile: "strict", overrides: {} }, { durationMinutes: null });
    expect(await screen.findByText(/Set a duration under Timing to see what this costs/i)).toBeVisible();
  });

  it("shows uploads beside megabytes", async () => {
    await openProctoringPanel({ profile: "strict", overrides: {} }, { durationMinutes: 60 });
    expect(await screen.findByText(/≈ 60 images · ≈ 1\.5 MB · ≈ 60 uploads per candidate/)).toBeVisible();
  });

  // Not asked by the brief's own test bodies, but the shape `Q11b` names
  // ("off means off, all the way down") and the one branch the two tests
  // above do not exercise: a duration IS set, but snapshots are off, so
  // there is nothing to cost and no missing input to name either.
  it("renders neither message when snapshots are off and a duration is set", async () => {
    await openProctoringPanel(
      { profile: "strict", overrides: { snapshot_interval_seconds: 0 } },
      { durationMinutes: 60 },
    );
    expect(screen.queryByText(/per candidate/)).toBeNull();
    expect(screen.queryByText(/Set a duration/i)).toBeNull();
  });

  // Branch-review Finding 1: no camera means nothing captured (`Q11b`), so
  // the panel states neither message — the same state `snapshotCost`'s own
  // unit test above covers, confirmed here at the rendered level too
  // (positive control: the test right above proves the same query matches
  // once the figure IS shown).
  it("renders neither message when the camera is off, even with a duration set", async () => {
    await openProctoringPanel(
      { profile: "strict", overrides: { require_camera: false } },
      { durationMinutes: 60 },
    );
    expect(screen.queryByText(/per candidate/)).toBeNull();
    expect(screen.queryByText(/Set a duration/i)).toBeNull();
  });

  // Branch-review Finding 7: this used to claim its render "confirms the
  // two layers (panel body, collapsed row) agree on the same figure" — it
  // renders `ProctoringPanel` directly and never touches `SettingRow` or
  // `proctoringSummary`, so it confirms nothing about the row. The row's
  // own summary string is asserted directly, with no render at all, in
  // `proctoring-row.test.tsx`'s `proctoringSummary` suite; the shared
  // figure the two surfaces cannot disagree on is `snapshotCost` itself,
  // now the one function both of them call (branch-review Finding 6).
  it("live-updates as the organiser sets a duration", async () => {
    const onChange = () => undefined;
    const { rerender } = render(
      <ProctoringPanel value={{ profile: "strict", overrides: {} }} durationMinutes={null} onChange={onChange} />,
    );
    await screen.findByRole("group", { name: /Proctoring/i });
    expect(screen.getByText(/Set a duration under Timing/i)).toBeVisible();

    rerender(
      <ProctoringPanel value={{ profile: "strict", overrides: {} }} durationMinutes={60} onChange={onChange} />,
    );
    expect(await screen.findByText(/≈ 60 images/)).toBeVisible();
    expect(screen.queryByText(/Set a duration/i)).toBeNull();
  });
});
