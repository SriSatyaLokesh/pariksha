// Phase 7e Task 4 (`Q5a`): the organiser's one read and the unlock it
// drives. Mounts `LockedAttempts` directly behind a local, stateful
// `Harness` — `proctoring-controls.test.tsx`'s own header is why: this
// panel is controlled (`routes/test.tsx` owns the fetch and the write), so
// reachability from `OrganiserApp` is not this file's question, only what
// the panel itself renders and does with the one gesture it offers.
//
// No `@testing-library/user-event` in this workspace — `fireEvent.click`
// is this repo's own idiom for it (`proctoring-controls.test.tsx`).

import { useState } from "react";
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { LockedAttempts } from "../../src/components/testbuilder/LockedAttempts";
import type { LockedAttemptRow } from "../../src/lib/api";

const LOCKED: LockedAttemptRow = {
  attemptId: "att_1",
  candidateLabel: "21CS0147",
  lockedAt: 1_760_000_000_000,
  violations: 5,
  remainingSeconds: 600,
};

/** The panel is controlled; a static `attempts` prop would assert on a
 *  component that can never change. `onUnlock` stands in for `routes/
 *  test.tsx`'s real handler, which calls `client.unlockAttempt` and then
 *  drops the row from its own state — this harness does the same thing
 *  without a network call. */
function Harness({ attempts = [LOCKED] }: { attempts?: LockedAttemptRow[] }) {
  const [rows, setRows] = useState<readonly LockedAttemptRow[]>(attempts);
  return (
    <LockedAttempts
      attempts={rows}
      onUnlock={async (attemptId) => {
        setRows((current) => current.filter((row) => row.attemptId !== attemptId));
      }}
    />
  );
}

async function openBuilderWithLockedAttempt(): Promise<void> {
  render(<Harness />);
  await screen.findByRole("heading", { name: /Locked attempts/i });
}

describe("the locked-attempts panel and its one gesture (Q5a)", () => {
  it("shows locked attempts on the test and unlocks from there, after a confirm (M5)", async () => {
    await openBuilderWithLockedAttempt();
    expect(screen.getByText("21CS0147")).toBeInTheDocument();
    // First click only arms — M5: there is no re-lock surface anywhere in
    // the product, so a single click must not fire the request.
    fireEvent.click(await screen.findByRole("button", { name: /Unlock/ }));
    expect(screen.getByText("21CS0147")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Confirm unlock$/i }));
    await waitFor(() => expect(screen.queryByText("21CS0147")).toBeNull());
  });

  it("M5: Cancel backs out of an armed unlock without calling onUnlock", async () => {
    await openBuilderWithLockedAttempt();
    fireEvent.click(await screen.findByRole("button", { name: /Unlock/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    expect(screen.getByText("21CS0147")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Unlock 21CS0147/i })).toBeInTheDocument();
  });

  it("says plainly that nothing else tells the organiser a lock happened", async () => {
    await openBuilderWithLockedAttempt();
    expect(screen.getByText(/A locked attempt clears only when you unlock it here\./)).toBeVisible();
  });

  // The ruling the brief names explicitly: this list does not join
  // `apps/web/e2e/density.ts` because it is empty on almost every test —
  // and "empty" has to actually render nothing, not an empty table.
  it("renders nothing when there is nothing locked", () => {
    const { container } = render(<Harness attempts={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // `candidateLabel` names the row AND the button's own accessible name —
  // the one thing an organiser unlocking the wrong row among several would
  // get wrong silently otherwise.
  it("names which attempt each Unlock button acts on", async () => {
    render(
      <Harness
        attempts={[
          LOCKED,
          { ...LOCKED, attemptId: "att_2", candidateLabel: "21CS0148" },
        ]}
      />,
    );
    expect(await screen.findByRole("button", { name: /Unlock 21CS0147/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unlock 21CS0148/ })).toBeInTheDocument();
  });
});
