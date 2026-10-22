// The Results panel's retention fields and cost line (Phase 8a Task 5,
// `K28`/`K35`/`K36`). The release half is `ReleasePanel`'s own behaviour,
// already covered in `release-branding.test.tsx` — this file only covers
// what `ResultsPanel` adds around it.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import type { CostEstimate, TestRelease, TestRetention } from "@pariksha/core";

import { ResultsPanel } from "../../src/components/testbuilder/ResultsPanel";

const props = {
  release: { when: "on_submit" } as TestRelease,
  onReleaseChange: vi.fn(),
  retention: undefined as TestRetention | undefined,
  onRetentionChange: vi.fn(),
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
