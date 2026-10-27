import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ProctoringOverrides, ProctoringProfile } from "@pariksha/core";
import { ProctoringPanel } from "../../src/components/testbuilder/ProctoringPanel";

type Proctoring = { profile: ProctoringProfile; overrides: ProctoringOverrides };

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

describe("ProctoringPanel microphone and face_check controls (Phase 8.5 Task 5)", () => {
  it("require_microphone checkbox is enabled (not disabled)", () => {
    render(<Harness />);
    const micControl = screen.getByLabelText(/Require a microphone/i);
    expect(micControl).toBeInTheDocument();
    expect(micControl).not.toBeDisabled();
  });

  it("require_microphone provides ambient noise copy in accessible description", () => {
    render(<Harness />);
    const micControl = screen.getByLabelText(/Require a microphone/i);
    expect(micControl).toHaveAccessibleDescription(
      /Monitors ambient noise level\. No audio is ever recorded or stored\./i,
    );
  });

  it("checking require_microphone triggers onChange with override", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const micControl = screen.getByLabelText(/Require a microphone/i);
    fireEvent.click(micControl);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overrides: expect.objectContaining({ require_microphone: true }),
      }),
    );
  });

  it("face_check checkbox remains disabled and re-points to Issue #264 without naming Phase 8", () => {
    render(<Harness />);
    const faceControl = screen.getByLabelText(/Count faces in each image/i);
    expect(faceControl).toBeDisabled();
    expect(faceControl).toHaveAccessibleDescription(/Issue #264/);
    expect(faceControl).not.toHaveAccessibleDescription(/Phase 8/);
  });
});
