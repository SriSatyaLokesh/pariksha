// The Results panel's retention fields and cost line (Phase 8a Task 5,
// `K28`/`K35`/`K36`). The release half is `ReleasePanel`'s own behaviour,
// already covered in `release-branding.test.tsx` — this file only covers
// what `ResultsPanel` adds around it.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { CostEstimate, TestRelease, TestRetention } from "@pariksha/core";

import { ResultsPanel } from "../../src/components/testbuilder/ResultsPanel";
import type { CandidateRow } from "../../src/lib/api";

function candidate(input: Partial<CandidateRow> & { id: string }): CandidateRow {
  return {
    testId: "tst_1",
    externalId: null,
    setLabel: null,
    formValues: {},
    source: "registration",
    consentVersion: "v1",
    createdAt: 0,
    ...input,
  };
}

const CANDIDATES: CandidateRow[] = [
  candidate({
    id: "cnd_jane",
    externalId: "jane@example.com",
    formValues: { full_name: "Jane Rivera", email: "jane@example.com" },
  }),
  candidate({
    id: "cnd_jaden",
    externalId: "ROLL-002",
    formValues: { full_name: "Jaden Okafor", email: "jaden@example.com" },
  }),
];

const props = {
  release: { when: "on_submit" } as TestRelease,
  onReleaseChange: vi.fn(),
  retention: undefined as TestRetention | undefined,
  onRetentionChange: vi.fn(),
  // Phase 8e Task 2 (`S-14`, fix round 2): the candidate-search lookup.
  candidates: CANDIDATES,
  canDeleteCandidateData: true,
  onExportCandidateData: vi.fn(),
  onDeleteCandidateData: vi.fn().mockResolvedValue(undefined),
};

const estimate: CostEstimate = {
  lines: [
    { key: "snapshots", requestsPerCandidate: 60, megabytesPerCandidate: 1.5 },
    { key: "identity_photo", requestsPerCandidate: 1, megabytesPerCandidate: null },
  ],
  totalRequests: 18_300,
  candidates: 300,
};

describe("ResultsPanel", () => {
  it("renders the retention fields", () => {
    render(<ResultsPanel {...props} />);
    expect(screen.getByLabelText(/Delete snapshots after/)).toHaveValue(90);
    expect(screen.getByLabelText(/Delete personal data and answers after/)).toHaveValue(365);
  });

  it("an override on one field is sent alone, the other default left for the resolver", () => {
    const onRetentionChange = vi.fn();
    render(<ResultsPanel {...props} onRetentionChange={onRetentionChange} />);

    fireEvent.change(screen.getByLabelText(/Delete snapshots after/), { target: { value: "30" } });

    expect(onRetentionChange).toHaveBeenCalledWith({ snapshots_days: 30 });
  });

  it("a stored override is shown instead of the default", () => {
    render(<ResultsPanel {...props} retention={{ snapshots_days: 30 }} />);
    expect(screen.getByLabelText(/Delete snapshots after/)).toHaveValue(30);
    expect(screen.getByLabelText(/Delete personal data and answers after/)).toHaveValue(365);
  });

  it("shows the cost line when given an estimate", () => {
    render(<ResultsPanel {...props} cost={estimate} />);
    expect(screen.getByText(/60 requests per candidate/)).toBeInTheDocument();
  });

  // Control for the test above — `K36`'s "the field is absent on node"
  // assertion is the exact vacuous shape (`queryBy…toBeNull`) that needs
  // one: this proves "per candidate" renders at all when `cost` is given,
  // so its absence just above means the prop, not a typo in the regex.
  it("renders no cost line at all without one", () => {
    render(<ResultsPanel {...props} cost={undefined} />);
    expect(screen.queryByText(/per candidate/)).toBeNull();
  });

  it("the results panel has no axe violations", async () => {
    const { container } = render(<ResultsPanel {...props} cost={estimate} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

// Phase 8e Task 2 (`S-14`, fix round 2, `AC-25`): the candidate-search
// lookup. Fix round 1 took a typed `cnd_…` id, which a request-driven
// erasure never arrives holding ("delete my data, I'm jane@example.com")
// — fix round 2 searches the test's own already-fetched candidate list by
// `external_id` and every registration answer instead. The panel's own
// behaviour (the typed confirmation, the Owner gate) is covered in
// `test/organiser/candidate-data-panel.test.tsx`; this file covers the
// search and that the resolved internal id reaches the callbacks.
describe("ResultsPanel's candidate-data lookup", () => {
  it("shows no matches and no candidate panel before anything is typed", () => {
    render(<ResultsPanel {...props} />);
    expect(screen.queryByRole("group", { name: /Candidate data/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Jane Rivera/ })).toBeNull();
  });

  it("finds a candidate by email, not just by name", () => {
    render(<ResultsPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "jane@example.com" } });
    expect(screen.getByRole("button", { name: /Jane Rivera/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Jaden Okafor/ })).toBeNull();
  });

  it("finds a candidate by external_id (a roll number)", () => {
    render(<ResultsPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "roll-002" } });
    expect(screen.getByRole("button", { name: /Jaden Okafor/ })).toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    render(<ResultsPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "no-such-person" } });
    expect(screen.getByText(/No candidate on this test matches/i)).toBeVisible();
  });

  it("selecting a match mounts CandidateDataPanel and resolves the internal id for export/delete", async () => {
    const onExportCandidateData = vi.fn();
    const onDeleteCandidateData = vi.fn().mockResolvedValue(undefined);
    render(
      <ResultsPanel
        {...props}
        onExportCandidateData={onExportCandidateData}
        onDeleteCandidateData={onDeleteCandidateData}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "jane" } });
    fireEvent.click(screen.getByRole("button", { name: /Jane Rivera/ }));

    expect(await screen.findByRole("group", { name: /Candidate data/i })).toBeInTheDocument();
    // Never the internal id — S-14's whole point.
    expect(screen.queryByText(/cnd_jane/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Download their data/i }));
    expect(onExportCandidateData).toHaveBeenCalledWith("cnd_jane");

    fireEvent.click(screen.getByRole("button", { name: /Erase this candidate's data/i }));
    fireEvent.change(await screen.findByLabelText(/Type ERASE to confirm/i), { target: { value: "ERASE" } });
    fireEvent.click(screen.getByRole("button", { name: /Erase permanently/i }));
    await screen.findByText(/data has been erased/i);
    expect(onDeleteCandidateData).toHaveBeenCalledWith("cnd_jane", true);
  });

  it("truncates a broad match past MAX_MATCHES_SHOWN and says how many more", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      candidate({ id: `cnd_${String(i)}`, formValues: { full_name: `Broad Match ${String(i)}` } }),
    );
    render(<ResultsPanel {...props} candidates={many} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "broad match" } });
    expect(screen.getAllByRole("button", { name: /Broad Match/ })).toHaveLength(20);
    expect(screen.getByText(/5 more match/i)).toBeVisible();
  });

  it("disables export and erasure for a non-Owner, once a match is selected", async () => {
    render(<ResultsPanel {...props} canDeleteCandidateData={false} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "jane" } });
    fireEvent.click(screen.getByRole("button", { name: /Jane Rivera/ }));

    expect(await screen.findByRole("button", { name: /Download their data/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Erase this candidate's data/i })).toBeDisabled();
  });

  it("returning to the lookup clears the query and the selection", async () => {
    render(<ResultsPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "jane" } });
    fireEvent.click(screen.getByRole("button", { name: /Jane Rivera/ }));
    await screen.findByRole("group", { name: /Candidate data/i });

    fireEvent.click(screen.getByRole("button", { name: /Look up a different candidate/i }));

    expect(screen.queryByRole("group", { name: /Candidate data/i })).toBeNull();
    expect(screen.getByLabelText(/Find a candidate/i)).toHaveValue("");
  });

  it("has no axe violations with search results showing", async () => {
    const { container } = render(<ResultsPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "jane" } });
    await screen.findByRole("button", { name: /Jane Rivera/ });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with the candidate panel loaded", async () => {
    const { container } = render(<ResultsPanel {...props} />);
    fireEvent.change(screen.getByLabelText(/Find a candidate/i), { target: { value: "jane" } });
    fireEvent.click(screen.getByRole("button", { name: /Jane Rivera/ }));
    await screen.findByRole("group", { name: /Candidate data/i });
    expect(await axe(container)).toHaveNoViolations();
  });
});
