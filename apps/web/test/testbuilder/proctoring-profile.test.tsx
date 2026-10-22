// Phase 7b Task 3 (`Q8a`): the profile rewrites the rest, visibly. Two
// pieces: a marker on every override that differs from its profile
// default, and a confirmation — naming the count — before changing the
// profile discards them.
//
// Mounts `ProctoringPanel` directly behind a local, stateful `Harness`,
// the same pattern `proctoring-controls.test.tsx` (Task 2) already uses —
// `openProctoringPanel` is not a shared helper (task-3-brief.md's own
// trap note), so this file keeps its own copy rather than reaching across.
//
// No `@testing-library/user-event` in this workspace — see
// `form-builder.test.tsx`'s own note. `user` below is the same local shim,
// extended with `.selectOptions` (`fireEvent.change` on a <select>, the one
// DOM event a real pick leaves behind).
//
// Two rulings from task-3-brief.md bind the shape of these tests:
//
// R1 — `getByRole("group", { name: /Require a camera/i })` cannot match:
// Task 2 shipped exactly two kinds of `group` here (the three `<fieldset>`s
// and the panel's own `role="group"`), and no group is named for one
// control. The marker lives in the field's help track, reached through
// `aria-describedby`, so the assertion is `toHaveAccessibleDescription`
// on the control itself, plus the visible text — not a `within(row)` query
// against a role nothing renders.
//
// R2 — every negative assertion gets a positive control beside it: there is
// no `role="alertdialog"` anywhere else in this app, so a bare
// `queryByRole("alertdialog")).toBeNull()` would pass against a panel that
// never built one at all. Each `null` assertion below is paired with a test
// that proves the same query matches when it should.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ProctoringOverrides, ProctoringProfile } from "@pariksha/core";

import { ProctoringPanel } from "../../src/components/testbuilder/ProctoringPanel";

const user = {
  click: (el: Element) => fireEvent.click(el),
  selectOptions: (el: Element, value: string) => fireEvent.change(el, { target: { value } }),
};

type Proctoring = { profile: ProctoringProfile; overrides: ProctoringOverrides };

/** Controlled, like Task 2's own `Harness` — a static `value` prop would
 *  assert on a component that can never change. */
function Harness({
  profile = "off",
  overrides = {},
  onChange,
}: {
  profile?: ProctoringProfile;
  overrides?: ProctoringOverrides;
  onChange?: (next: Proctoring) => void;
}) {
  const [proctoring, setProctoring] = useState<Proctoring>({ profile, overrides });
  return (
    <ProctoringPanel
      value={proctoring}
      durationMinutes={null}
      onChange={(next) => {
        onChange?.(next);
        setProctoring(next);
      }}
    />
  );
}

async function openProctoringPanel(
  init: { profile?: ProctoringProfile; overrides?: ProctoringOverrides } = {},
  opts: { onChange?: (next: Proctoring) => void } = {},
): Promise<void> {
  // Spread, not a named prop per field — same `exactOptionalPropertyTypes`
  // reason Task 2's own helper gives.
  render(<Harness {...init} {...opts} />);
  await screen.findByRole("group", { name: /Proctoring/i });
}

describe("the profile rewrites the controls, visibly (Q8a)", () => {
  describe("the marker", () => {
    it("marks an override that differs from its profile default", async () => {
      await openProctoringPanel({ profile: "strict", overrides: { require_camera: false } });
      const control = screen.getByLabelText(/Require a camera/i);
      expect(control).toHaveAccessibleDescription(/changed from Strict/i);
      expect(screen.getByText(/changed from Strict/i)).toBeVisible();
    });

    it("marks nothing when every control sits at its profile default", async () => {
      await openProctoringPanel({ profile: "strict", overrides: {} });
      expect(screen.queryByText(/changed from/i)).toBeNull();
    });

    // Positive control for the test above (R2): the SAME query, against a
    // render where one control really is overridden, proves `/changed
    // from/i` is not a query that could never match anything in this panel.
    it("positive control: the same query matches once something really is overridden", async () => {
      await openProctoringPanel({ profile: "strict", overrides: { watermark: false } });
      expect(screen.getByText(/changed from/i)).toBeVisible();
    });

    // "Easy to get subtly wrong" #1: an absent key is not a difference, and
    // an override equal to its own profile default is not a difference
    // either — neither marks, so the dialog later has nothing to count.
    it("does not mark an override that happens to equal its profile default", async () => {
      // Strict's own default for require_camera is true — setting the
      // override to the SAME value is not a change.
      await openProctoringPanel({ profile: "strict", overrides: { require_camera: true } });
      expect(screen.queryByText(/changed from/i)).toBeNull();
      expect(screen.getByLabelText(/Require a camera/i)).not.toHaveAccessibleDescription(/changed from/i);
    });

    // "Easy to get subtly wrong" #2: 0 is a real value and must survive as
    // a genuine difference from a non-zero default, never read as "unset".
    it("marks the interval when it is explicitly 0 and the profile default is not", async () => {
      await openProctoringPanel({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } });
      expect(screen.getByLabelText(/Images every/i)).toHaveAccessibleDescription(/changed from Strict/i);
    });

    it("names the CURRENT profile in the marker text", async () => {
      await openProctoringPanel({ profile: "standard", overrides: { desktop_only: false } });
      expect(screen.getByText(/changed from Standard/i)).toBeVisible();
    });
  });

  describe("the confirmation", () => {
    // Review Focus 1 — visible, confirmable, not silent.
    it("asks before a profile change discards overrides, and names how many", async () => {
      await openProctoringPanel({ profile: "strict", overrides: { require_camera: false, watermark: false } });
      user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
      expect(await screen.findByText(/2 settings/)).toBeVisible();
    });

    // Positive control for the "no ask" test below (R2): `role="alertdialog"`
    // does not exist anywhere else in this app, so its `null` only means
    // something once this proves the same query matches when a dialog is
    // really open.
    it("positive control: the dialog really is role=alertdialog, aria-modal, with an accessible name", async () => {
      await openProctoringPanel({ profile: "strict", overrides: { require_camera: false } });
      user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleName(/standard/i);
    });

    it("changes the profile without asking when nothing was overridden", async () => {
      const onChange = vi.fn();
      await openProctoringPanel({ profile: "strict", overrides: {} }, { onChange });
      user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
      expect(onChange).toHaveBeenLastCalledWith({ profile: "standard", overrides: {} });
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });

    it("confirming clears the overrides and applies the new profile", async () => {
      const onChange = vi.fn();
      await openProctoringPanel(
        { profile: "strict", overrides: { require_camera: false, watermark: false } },
        { onChange },
      );
      user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
      const dialog = await screen.findByRole("alertdialog");
      user.click(within(dialog).getByRole("button", { name: /change profile/i }));

      expect(onChange).toHaveBeenLastCalledWith({ profile: "standard", overrides: {} });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.queryByText(/changed from/i)).toBeNull();
    });

    it("cancelling the confirmation keeps the old profile and every override", async () => {
      const onChange = vi.fn();
      await openProctoringPanel(
        { profile: "strict", overrides: { require_camera: false } },
        { onChange },
      );
      user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
      const dialog = await screen.findByRole("alertdialog");
      user.click(within(dialog).getByRole("button", { name: /cancel/i }));

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByLabelText(/Profile/i)).toHaveValue("strict");
      expect(screen.getByLabelText(/Require a camera/i)).toHaveAccessibleDescription(/changed from Strict/i);
    });

    // `Q2b`'s focus-trap discipline, `axe` does not test Escape — this is
    // the behavioural test of its own it needs. Unlike the candidate's
    // overlay (`R3`), THIS dialog takes Escape: it is a cancellable
    // confirmation on the organiser's own surface.
    it("the confirmation takes Escape, starts focused and gives focus back", async () => {
      await openProctoringPanel({ profile: "strict", overrides: { require_camera: false } });
      const trigger = screen.getByLabelText(/Profile/i);
      (trigger as HTMLSelectElement).focus();
      user.selectOptions(trigger, "standard");

      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toHaveFocus();

      fireEvent.keyDown(dialog, { key: "Escape" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(trigger).toHaveFocus();
    });
  });

  it("the panel has no axe violations", async () => {
    const { container } = await (async () => {
      const result = render(<Harness profile="strict" overrides={{ require_camera: false }} />);
      await screen.findByRole("group", { name: /Proctoring/i });
      return result;
    })();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the confirmation dialog has no axe violations either", async () => {
    const { container } = render(<Harness profile="strict" overrides={{ require_camera: false }} />);
    await screen.findByRole("group", { name: /Proctoring/i });
    user.selectOptions(screen.getByLabelText(/Profile/i), "standard");
    await screen.findByRole("alertdialog");
    expect(await axe(container)).toHaveNoViolations();
  });
});
