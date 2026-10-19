// The candidate list panel (Task 9, #60 / #56, P5.7b).
//
// Driven, never poked: every assertion follows a real change or click on a
// control an organiser can see. No `@testing-library/user-event` in this
// workspace, so a file is chosen with `fireEvent.change` carrying a real
// `File` — which is what a native file input actually fires.
//
// Reachability — that the running app mounts this at all, reads the list
// through the real client method and knows whether the actor may upload —
// is proved in `apps/web/test/organiser.test.tsx`, which walks from
// `OrganiserApp`.

import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { FormField, TestAccess } from "@pariksha/core";

import { AccessPanel } from "../../src/components/testbuilder/AccessPanel";
import type { CandidateImportReport, CandidateRow } from "../../src/lib/api";

const EMAIL_FIELD: FormField = {
  id: "email",
  type: "email",
  label: "College email address",
  unique: true,
};

function candidate(externalId: string, setLabel: string | null): CandidateRow {
  return {
    id: `cnd_${externalId}`,
    testId: "tst_1",
    externalId,
    setLabel,
    formValues: {},
    source: "list",
    consentVersion: null,
    createdAt: 0,
  };
}

const THREE: CandidateRow[] = [
  candidate("a@vce.edu.in", "A"),
  candidate("b@vce.edu.in", "B"),
  candidate("c@vce.edu.in", null),
];

function Harness({
  candidates = THREE,
  identityField = EMAIL_FIELD,
  canManageCandidates = true,
  onImportCandidates = async () => ({ imported: 0, issues: [] }),
}: {
  candidates?: readonly CandidateRow[];
  identityField?: FormField | null;
  canManageCandidates?: boolean;
  onImportCandidates?: (csv: string, opts: { dryRun: boolean }) => Promise<CandidateImportReport>;
}) {
  const [access, setAccess] = useState<TestAccess>({ mode: "invite_only" });
  return (
    <AccessPanel
      access={access}
      onChange={setAccess}
      candidates={candidates}
      identityField={identityField}
      canManageCandidates={canManageCandidates}
      onImportCandidates={onImportCandidates}
    />
  );
}

// The exact label, not a regex: the section's own heading ("The candidate
// list") is the accessible name of the region around it, and a loose match
// finds both. Scoped by exactness rather than by renaming the copy.
const fileInput = (): HTMLElement => screen.getByLabelText("Candidate list");

/** A real `File`, so `stage()` goes through `file.text()` exactly as a
 * chosen file does in a browser. */
function csvFile(text: string): File {
  return new File([text], "candidates.csv", { type: "text/csv" });
}

function choose(text: string): void {
  fireEvent.change(fileInput(), { target: { files: [csvFile(text)] } });
}

const CLEAN = "email,set\na@vce.edu.in,A\n";

describe("the candidate list panel", () => {
  it("reports the list's size and how many rows have no set", () => {
    render(<Harness />);
    expect(screen.getByText(/3 candidates · 1 with no set/i)).toBeVisible();
  });

  it("counts one candidate in the singular", () => {
    render(<Harness candidates={[candidate("a@vce.edu.in", "A")]} />);
    expect(screen.getByText(/^1 candidate · 0 with no set$/i)).toBeVisible();
  });

  it("the expected columns are stated before an upload, naming this test's unique field", () => {
    render(<Harness />);
    expect(
      screen.getByText(/email \(required\), set \(optional\), and any other registration field/i),
    ).toBeVisible();
  });

  it("an upload shows the dry-run report before anything is written, one row per issue", async () => {
    const onImportCandidates = vi.fn(async () => ({
      imported: 0,
      issues: [
        { line: 4, field: "email", message: '"a@vce.edu.in" is already used on line 2' },
        { line: 5, field: "set", message: 'no section defines a set "Z"' },
      ],
    }));
    render(<Harness onImportCandidates={onImportCandidates} />);

    choose("email,set\nbad\n");

    expect(await screen.findByText(/nothing was imported/i)).toBeVisible();
    // The dry run is what ran: nothing was written.
    expect(onImportCandidates).toHaveBeenCalledTimes(1);
    expect(onImportCandidates).toHaveBeenCalledWith("email,set\nbad\n", { dryRun: true });
    // One row per issue, each carrying its source line.
    const table = screen.getByRole("table", { name: /what stopped this candidate list/i });
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + two issues
    expect(within(table).getByRole("row", { name: /line 4/ })).toBeVisible();
    expect(within(table).getByText('no section defines a set "Z"')).toBeVisible();
    // No confirmation offered for a file that cannot be imported.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("replacing an existing list confirms first and names what is replaced and what is kept", async () => {
    const onImportCandidates = vi.fn(async () => ({ imported: 6, issues: [] }));
    render(<Harness onImportCandidates={onImportCandidates} />);

    choose(CLEAN);

    const dialog = await screen.findByRole("dialog", { name: /replace the candidate list/i });
    expect(dialog).toHaveTextContent(/replace the 3 listed candidates with the 6 in this file/i);
    expect(screen.getByText(/candidates who have already registered are kept/i)).toBeVisible();
    // Still only the dry run.
    expect(onImportCandidates).toHaveBeenCalledTimes(1);

    fireEvent.click(within(dialog).getByRole("button", { name: /replace the list/i }));
    await waitFor(() => expect(onImportCandidates).toHaveBeenCalledTimes(2));
    expect(onImportCandidates).toHaveBeenLastCalledWith(CLEAN, { dryRun: false });
    await waitFor(() =>
      expect(screen.getByRole("status", { name: "Candidate-list upload" })).toHaveTextContent(
        /6 candidates imported/i,
      ),
    );
  });

  it("cancelling the confirmation writes nothing", async () => {
    const onImportCandidates = vi.fn(async () => ({ imported: 6, issues: [] }));
    render(<Harness onImportCandidates={onImportCandidates} />);

    choose(CLEAN);
    const dialog = await screen.findByRole("dialog", { name: /replace the candidate list/i });
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onImportCandidates).toHaveBeenCalledTimes(1);
    expect(onImportCandidates).toHaveBeenCalledWith(CLEAN, { dryRun: true });
  });

  it("the replace dialog takes Escape, starts focused and gives focus back", async () => {
    render(<Harness onImportCandidates={async () => ({ imported: 6, issues: [] })} />);

    const trigger = fileInput();
    trigger.focus();
    choose(CLEAN);

    const dialog = await screen.findByRole("dialog", { name: /replace the candidate list/i });
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("an Author sees the control in place and disabled, with the reason in text beside it", () => {
    render(<Harness canManageCandidates={false} />);

    expect(fileInput()).toBeDisabled();
    expect(screen.getByText("Needs an Admin — candidate lists are managed by Admins and Owners")).toBeVisible();
    // Read-only, not hidden: an Author should know what their candidates
    // will be matched against.
    expect(screen.getByText(/3 candidates · 1 with no set/i)).toBeVisible();
  });

  it("a test with no unique registration field cannot be keyed, and the panel says so", () => {
    render(<Harness identityField={null} candidates={[]} />);

    expect(fileInput()).toBeDisabled();
    // A fact, not an alert: a draft that has not reached its registration
    // form yet has nothing wrong with it.
    expect(screen.getByText(/no registration field marked unique/i)).toBeVisible();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/\(required\), set \(optional\)/i)).toBeNull();
  });

  it("a transport failure is reported rather than swallowed", async () => {
    render(
      <Harness
        onImportCandidates={async () => {
          throw new Error("A candidate list must be under 2 MB.");
        }}
      />,
    );

    choose(CLEAN);
    expect(await screen.findByText(/a candidate list must be under 2 mb/i)).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the candidate list panel has no axe violations", async () => {
    const { container } = render(<Harness />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the replace dialog has no axe violations either", async () => {
    const { container } = render(<Harness onImportCandidates={async () => ({ imported: 6, issues: [] })} />);
    choose(CLEAN);
    await screen.findByRole("dialog", { name: /replace the candidate list/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
