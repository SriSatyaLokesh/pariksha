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

  it("face_check checkbox is enabled and toggles on-device face counting (Issue #264)", () => {
    render(<Harness />);
    const faceControl = screen.getByLabelText(/Count faces in each image/i);
    expect(faceControl).toBeEnabled();
    expect(faceControl).toHaveAccessibleDescription(/Native on-device face counting/i);
    expect(faceControl).not.toHaveAccessibleDescription(/Phase 8/);
  });

  it("ai_audio_check checkbox is enabled and toggles AI speech evaluation", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const aiAudioControl = screen.getByLabelText(/AI speech evaluation/i);
    expect(aiAudioControl).toBeEnabled();
    expect(aiAudioControl).toHaveAccessibleDescription(/Evaluates spoken audio via browser Web Speech API or workspace BYOK models/i);

    fireEvent.click(aiAudioControl);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overrides: expect.objectContaining({ ai_audio_check: true }),
      }),
    );
  });
});
