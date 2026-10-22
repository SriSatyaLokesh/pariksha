// Phase 7b Task 2 (`Q8`): the fifteen proctoring overrides, in three
// `D16` field-row groups. Task 1's `proctoring-row.test.tsx` already proves
// the panel mounts as the sixth setting row off `OrganiserApp` (`D14`,
// `Q10b`); this file is about the CONTROLS inside it, so — like
// `timing.test.tsx` and `access.test.tsx` beside it — it mounts
// `ProctoringPanel` directly behind a local, stateful `Harness`, never
// `OrganiserApp`. Reachability is proved there, not repeated here.
//
// No `@testing-library/user-event` in this workspace (apps/web's
// package.json carries @testing-library/react and jest-dom only — see
// apps/web/test/testbuilder/form-builder.test.tsx's own note). `user`
// below is a local shim over `fireEvent`, the same shape
// `proctoring-row.test.tsx` already uses for `.click`, extended with
// `.clear`/`.type` so the brief's test bodies read exactly as written.
//
// `R1` (pre-flight ruling, progress.md / T2-R1): `getComputedStyle(el)
// .appearance` cannot see a stylesheet jsdom never applied — it resolves
// `""` regardless of what the CSS says, so the brief's own last test is
// rewritten onto this repo's real mechanism: `paintsIn`, which resolves the
// organiser's actual `@import` chain (`admin.html`) and reads which rule
// really wins on a rendered element. `apps/web/test/exam/controls.test.tsx`
// is the existing user of this mechanism and its own comment at :251 is the
// reason a half-resolved chain is not good enough either.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProctoringOverrides, ProctoringProfile } from "@pariksha/core";

import { ProctoringPanel } from "../../src/components/testbuilder/ProctoringPanel";
import { paintsIn, resolvedChain } from "../css-chain";

const ADMIN_CSS = resolvedChain("admin.html");

const user = {
  click: (el: Element) => fireEvent.click(el),
  /** `fireEvent.change` with an empty value — the one DOM event a real
   *  "select all, delete" leaves behind. */
  clear: (el: HTMLInputElement) => {
    fireEvent.change(el, { target: { value: "" } });
  },
  /** Cumulative `fireEvent.change` calls, one per character, starting from
   *  whatever the control already holds — close enough to real typing for
   *  every assertion in this file, which only ever types onto an
   *  already-cleared box. */
  type: (el: HTMLInputElement, text: string) => {
    let next = el.value;
    for (const ch of text) {
      next += ch;
      fireEvent.change(el, { target: { value: next } });
    }
  },
};

type Proctoring = { profile: ProctoringProfile; overrides: ProctoringOverrides };

/** The panel is controlled; a static `value` prop would assert on a
 *  component that can never change. Holds the state the real shell
 *  (apps/web/src/routes/test.tsx) holds, the same shape
 *  `timing.test.tsx`'s and `access.test.tsx`'s own `Harness` already use. */
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
  // Spread, not a named prop per field: `exactOptionalPropertyTypes` tells
  // "omitted" and "explicitly undefined" apart, and `init.profile` typed
  // `ProctoringProfile | undefined` would be the latter if passed as
  // `profile={init.profile}` whenever a caller leaves it out.
  render(<Harness {...init} {...opts} />);
  await screen.findByRole("group", { name: /Proctoring/i });
}

describe("the fifteen proctoring controls, in three field-row groups (Q8)", () => {
  it("renders all fifteen controls across three groups", async () => {
    await openProctoringPanel({});
    for (const name of [
      "Block phones and tablets",
      "Require fullscreen",
      "Require a camera",
      "Identity photo",
      "Images every",
      "Count faces in each image",
      "Require a microphone",
      "Warn after",
      "When the limit is reached",
      "Camera may be lost for",
      "Flag on faces in",
      "Block copy and paste",
      "Watermark the paper",
      "Detect extra monitors",
      "Allow the calculator",
    ]) {
      expect(screen.getByLabelText(new RegExp(name, "i")), name).toBeInTheDocument();
    }
  });

  // Review Focus 2 — 0 is a value, and the off switch must survive the round trip to the DOM.
  it("shows 0 in the interval field rather than a blank", async () => {
    await openProctoringPanel({ profile: "strict", overrides: { snapshot_interval_seconds: 0 } });
    expect(screen.getByLabelText(/Images every/i)).toHaveValue(0);
  });

  it("sends 0 up when the interval is cleared to zero", async () => {
    const onChange = vi.fn();
    await openProctoringPanel({ profile: "strict", overrides: {} }, { onChange });
    user.clear(screen.getByLabelText(/Images every/i) as HTMLInputElement);
    user.type(screen.getByLabelText(/Images every/i) as HTMLInputElement, "0");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: expect.objectContaining({ snapshot_interval_seconds: 0 }) }),
    );
  });

  // Review Focus 4 — the disabled control explains itself to a screen reader.
  it("names the phase in the face check's own accessible description", async () => {
    await openProctoringPanel({});
    const control = screen.getByLabelText(/Count faces in each image/i);
    expect(control).toBeDisabled();
    expect(control).toHaveAccessibleDescription(/Phase 8/);
  });

  // A positive control beside it, per the standing ruling (progress.md, "a
  // negative assertion needs a positive control"): the enabled checkboxes
  // right beside the disabled one prove `toBeDisabled()` can fail — they
  // are not disabled, and the assertion below is run against them too, the
  // other way round, to show it is really reading the attribute.
  it("leaves every other checkbox enabled, so the disabled assertion above is not vacuous", async () => {
    await openProctoringPanel({});
    expect(screen.getByLabelText(/Require a camera/i)).not.toBeDisabled();
    expect(screen.getByLabelText(/Require a microphone/i)).not.toBeDisabled();
  });

  it("uses no browser-default checkbox or radio", async () => {
    await openProctoringPanel({});
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBe(10); // nine editable + the disabled face-check box
    for (const el of boxes) {
      expect(paintsIn(el, "appearance", ADMIN_CSS)).toBe("none");
    }
  });
});

// Branch-review Finding 2: every assertion above reads a label, a DOM
// attribute or a rendered value — none of them clicks a checkbox, picks a
// select option, or reads which KEY an `onChange` payload carries.
// Swapping the override key two controls write (e.g. wiring "Watermark the
// paper" to `block_copy_paste` instead of `watermark`) left all 2166 tests
// in the branch green. This table drives each control the way an organiser
// would and asserts the key in the resulting `onChange` payload.
//
// Fourteen of the panel's fifteen override keys are driven below — nine
// checkboxes, four number boxes, one select. The fifteenth, `face_check`,
// ships permanently `disabled` (`Q3` — Phase 8 feature, pre-cut in Phase
// 7), so there is no organiser gesture that can drive it; "checking %s
// writes true" above has nothing to click. Its label and accessible
// description are pinned by "names the phase in the face check's own
// accessible description" above, and what it renders as checked — the raw
// imported document value, never the resolved (always-`false`) one — is
// exercised by `proctoring-profile.test.tsx`'s profile-change coverage of
// the same key.
describe("each override key is written by the control its label names (branch-review Finding 2)", () => {
  it.each([
    ["Block phones and tablets", "desktop_only"],
    ["Require fullscreen", "require_fullscreen"],
    ["Block copy and paste", "block_copy_paste"],
    ["Watermark the paper", "watermark"],
    ["Detect extra monitors", "extra_monitor_check"],
    ["Allow the calculator", "allow_calculator"],
    ["Require a camera", "require_camera"],
    ["Identity photo", "identity_photo"],
    ["Require a microphone", "require_microphone"],
  ] as const)("checking %s writes override.%s = true", async (label, key) => {
    const onChange = vi.fn();
    await openProctoringPanel({}, { onChange });
    user.click(screen.getByLabelText(new RegExp(label, "i")));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: expect.objectContaining({ [key]: true }) }),
    );
  });

  it.each([
    ["Images every", "snapshot_interval_seconds", "45"],
    ["Warn after", "violation_limit", "7"],
    ["Camera may be lost for", "camera_outage_seconds", "90"],
    ["Flag on faces in", "multi_face_snapshots", "4"],
  ] as const)("typing into %s writes override.%s", async (label, key, typed) => {
    const onChange = vi.fn();
    await openProctoringPanel({ profile: "strict", overrides: {} }, { onChange });
    const el = screen.getByLabelText(new RegExp(label, "i")) as HTMLInputElement;
    user.clear(el);
    user.type(el, typed);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: expect.objectContaining({ [key]: Number(typed) }) }),
    );
  });

  it("selecting an option in When the limit is reached writes override.violation_action", async () => {
    const onChange = vi.fn();
    await openProctoringPanel({}, { onChange });
    fireEvent.change(screen.getByLabelText(/When the limit is reached/i), {
      target: { value: "lock" },
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ overrides: expect.objectContaining({ violation_action: "lock" }) }),
    );
  });
});
