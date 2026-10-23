// Phase 8e Task 2 (`S-14`, #101): `CandidateDataPanel`'s own behaviour and
// the `axe` pass `ui-ux-pro-max` and `D1`/`D20` ask of every organiser
// surface — the typed confirmation gate, the Owner-only disablement, and
// the dialog accessible under `jest-axe` the same way `ProctoringPanel`'s
// own confirmation dialog is checked in `proctoring-a11y.test.tsx`.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";

import { CandidateDataPanel } from "../../src/components/organiser/CandidateDataPanel";

describe("CandidateDataPanel (S-14)", () => {
  it("disables export and erasure for a non-Owner, and says why", () => {
    render(<CandidateDataPanel candidateLabel="ROLL-001" isOwner={false} onExport={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Download their data/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Erase this candidate's data/i })).toBeDisabled();
    expect(screen.getByText(/Needs an Owner/i)).toBeVisible();
  });

  it("calls onExport for an Owner", () => {
    const onExport = vi.fn();
    render(<CandidateDataPanel candidateLabel="ROLL-001" isOwner onExport={onExport} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Download their data/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it("keeps the erase button disabled until ERASE is typed exactly", async () => {
    render(<CandidateDataPanel candidateLabel="ROLL-001" isOwner onExport={vi.fn()} onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Erase this candidate's data/i }));
    const confirmButton = await screen.findByRole("button", { name: /Erase permanently/i });
    expect(confirmButton).toBeDisabled();

    const typed = screen.getByLabelText(/Type ERASE to confirm/i);
    fireEvent.change(typed, { target: { value: "erase" } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(typed, { target: { value: "ERASE" } });
    expect(confirmButton).toBeEnabled();
  });

  it("sends keepAnonymisedScore as chosen and reports success", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<CandidateDataPanel candidateLabel="ROLL-001" isOwner onExport={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("radio", { name: /Remove the attempt entirely/i }));
    fireEvent.click(screen.getByRole("button", { name: /Erase this candidate's data/i }));
    fireEvent.change(await screen.findByLabelText(/Type ERASE to confirm/i), { target: { value: "ERASE" } });
    fireEvent.click(screen.getByRole("button", { name: /Erase permanently/i }));

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ keepAnonymisedScore: false }));
    expect(await screen.findByText(/data has been erased/i)).toBeVisible();
  });

  it("shows the server's own message when erasure is refused (409, an attempt in progress)", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("Cannot erase this candidate: an attempt is in progress."));
    render(<CandidateDataPanel candidateLabel="ROLL-001" isOwner onExport={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole("button", { name: /Erase this candidate's data/i }));
    fireEvent.change(await screen.findByLabelText(/Type ERASE to confirm/i), { target: { value: "ERASE" } });
    fireEvent.click(screen.getByRole("button", { name: /Erase permanently/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/attempt is in progress/i);
  });

  it("has no axe violations in the default state", async () => {
    const { container } = render(
      <CandidateDataPanel candidateLabel="ROLL-001" isOwner onExport={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with the typed-confirmation dialog open", async () => {
    const { container } = render(
      <CandidateDataPanel candidateLabel="ROLL-001" isOwner onExport={vi.fn()} onDelete={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Erase this candidate's data/i }));
    await screen.findByRole("alertdialog");
    expect(await axe(container)).toHaveNoViolations();
  });
});
