// `AnalyticsRoute` (Phase 8c Task 1/2, `R-06`/`R-07`, #94/#95). The app's
// own entry point (the test builder's "Analytics" button, `View`'s
// `analytics` kind, `readView`/`paramsOf`) is not covered here — this file
// is only what the screen itself does once mounted, the same split
// `webhook-panel.test.tsx` keeps for `WebhookPanel`.

import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { ItemStat, TestAnalytics } from "../../src/lib/api";
import { AnalyticsRoute } from "../../src/routes/analytics";
import { fakeClient } from "../fixtures/api-client";

const WORKSPACE_ID = "wsp_1";
const TEST_ID = "tst_1";

const BASE_ANALYTICS: TestAnalytics = {
  counts: { registered: 10, inProgress: 0, submitted: 9, autoSubmitted: 0, locked: 1 },
  distribution: [0, 0, 0, 0, 1, 2, 3, 2, 1, 0],
  mean: 64.2,
  median: 66,
  passRate: null,
  completionRate: 1,
  averageSeconds: 1800,
  integrity: { clean: 8, review: 1, high_risk: 0 },
  perSet: [{ setNo: 1, n: 9, mean: 64.2 }],
};

const ITEMS: ItemStat[] = [
  {
    questionId: "qst_1",
    shareCorrect: 0.3,
    discrimination: 0.42,
    discriminationWithheld: null,
    optionPickRates: { a: 0.3, b: 0.7 },
    n: 20,
  },
  {
    questionId: "qst_2",
    shareCorrect: 0.9,
    discrimination: null,
    discriminationWithheld: "too_few_attempts",
    optionPickRates: {},
    n: 6,
  },
  {
    questionId: "qst_3",
    shareCorrect: 1,
    discrimination: null,
    discriminationWithheld: "no_variance",
    optionPickRates: {},
    n: 20,
  },
];

function renderReady(overrides: { analytics?: Partial<TestAnalytics>; items?: ItemStat[] } = {}) {
  const analytics: TestAnalytics = { ...BASE_ANALYTICS, ...overrides.analytics };
  const items = overrides.items ?? ITEMS;
  return render(
    <AnalyticsRoute
      workspaceId={WORKSPACE_ID}
      testId={TEST_ID}
      client={fakeClient({ analytics: async () => ({ analytics, items }) })}
    />,
  );
}

function questionOrder(): string[] {
  return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell")[0]!.textContent ?? "");
}

describe("AnalyticsRoute — R-06 figures", () => {
  it("renders the five counts", async () => {
    renderReady();
    expect(await screen.findByText("Registered")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText("A proctoring violation ended the attempt.")).toBeInTheDocument();
  });

  it("buckets the distribution into ten rows", async () => {
    renderReady();
    await screen.findByText("Score distribution");
    expect(screen.getAllByRole("progressbar")).toHaveLength(10 + 1 /* share-correct */ * ITEMS.length + 1 /* set */ + 3 /* integrity */);
  });

  it("renders the absent pass rate in words, with both misreadings negated", async () => {
    renderReady({ analytics: { passRate: null } });
    expect(await screen.findByText("no pass mark set")).toBeInTheDocument();
    expect(
      screen.getByText("This test sets no pass mark, so there is no pass rate to compute. Not zero, and not pending."),
    ).toBeInTheDocument();
    // The histogram draws no pass line, and says why.
    expect(
      screen.getByText(/no pass line is drawn/),
    ).toBeInTheDocument();
  });

  it("renders a real pass rate as a percentage, not in words", async () => {
    renderReady({ analytics: { passRate: 0.68 } });
    expect(await screen.findByText("68%")).toBeInTheDocument();
    expect(screen.queryByText("no pass mark set")).not.toBeInTheDocument();
  });

  it("names every integrity count by word, not only by the tone on its bar", async () => {
    renderReady();
    await screen.findByText("Integrity");
    expect(screen.getByText("Clean")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText("High risk")).toBeInTheDocument();
  });

  it("shows the zero-attempt empty state rather than a mean of null", async () => {
    renderReady({
      analytics: {
        counts: { registered: 2, inProgress: 0, submitted: 0, autoSubmitted: 0, locked: 0 },
        mean: null,
        median: null,
        distribution: new Array(10).fill(0),
        perSet: [],
      },
    });
    expect(await screen.findByText("Nothing has been attempted yet")).toBeInTheDocument();
    expect(screen.queryByText("Score distribution")).not.toBeInTheDocument();
  });

  it("states the missing-time omission on the surface (K2)", async () => {
    renderReady();
    expect(
      await screen.findByText("There is no time column here, and there is not one anywhere else either."),
    ).toBeInTheDocument();
  });

  it("surfaces a load failure rather than a blank screen", async () => {
    render(
      <AnalyticsRoute
        workspaceId={WORKSPACE_ID}
        testId={TEST_ID}
        client={fakeClient({
          analytics: async () => {
            throw new Error("boom");
          },
        })}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Analytics could not be loaded.");
  });
});

describe("AnalyticsRoute — R-07 item table", () => {
  it("withholds the discrimination index below ten attempts and names n", async () => {
    renderReady();
    await screen.findByText("withheld");
    expect(screen.getByText(/n=6, under 10/)).toBeInTheDocument();
  });

  it("withholds the index for a question with no variance, and says which way it collapsed", async () => {
    renderReady();
    await screen.findByText("no variance");
    expect(screen.getByText("all correct")).toBeInTheDocument();
  });

  it("defaults to question order", async () => {
    renderReady();
    await screen.findByText("Every question");
    expect(questionOrder()).toEqual(["qst_1", "qst_2", "qst_3"]);
  });

  it("sorts by share correct on request, and keeps the sort client-side (no new fetch)", async () => {
    renderReady();
    await screen.findByText("Every question");
    fireEvent.click(screen.getByRole("button", { name: /Share correct/ }));
    expect(questionOrder()).toEqual(["qst_3", "qst_2", "qst_1"]);
    // Clicking again reverses it.
    fireEvent.click(screen.getByRole("button", { name: /Share correct/ }));
    expect(questionOrder()).toEqual(["qst_1", "qst_2", "qst_3"]);
  });

  it("returns to question order from the accessible Sort by control", async () => {
    renderReady();
    await screen.findByText("Every question");
    fireEvent.click(screen.getByRole("button", { name: /Discrimination/ }));
    expect(questionOrder()[0]).toBe("qst_1"); // the only present value, sorts first descending
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "order" } });
    expect(questionOrder()).toEqual(["qst_1", "qst_2", "qst_3"]);
  });

  it("gives option pick rates without inventing a key the interface does not carry", async () => {
    renderReady();
    await screen.findByText("Every question");
    expect(screen.getByText("b 70%")).toBeInTheDocument();
    expect(screen.getAllByText("no option data").length).toBeGreaterThan(0);
  });
});

describe("AnalyticsRoute — axe", () => {
  it("the loaded screen has no axe violations", async () => {
    const { container } = renderReady();
    await screen.findByText("Every question");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("the empty state has no axe violations", async () => {
    const { container } = renderReady({
      analytics: {
        counts: { registered: 0, inProgress: 0, submitted: 0, autoSubmitted: 0, locked: 0 },
      },
    });
    await screen.findByText("Nothing has been attempted yet");
    expect(await axe(container)).toHaveNoViolations();
  });

  // The probe that proves axe actually works here, not merely that this
  // screen happens to pass it today. Breaking the one real label
  // association (`<label htmlFor="analytics-sort">`) and re-running axe
  // must report the rule by name — if it did not, the two "no violations"
  // assertions above would be worth nothing.
  it("probe: breaking the Sort by label association makes axe fail, by name", async () => {
    const { container } = renderReady();
    await screen.findByText("Every question");

    // `getByLabelText` would throw once the association is broken — query
    // by role instead, which keeps working with no accessible name at all.
    const select = screen.getByRole("combobox");
    const label = container.querySelector('label[for="analytics-sort"]');
    expect(label).not.toBeNull();
    label!.removeAttribute("for");

    const broken = await axe(container);
    // The brief's own wording ("Form elements must have labels (label)")
    // names the rule axe-core raises for an unlabelled `<input>`/
    // `<textarea>`; this screen's one real form control is a `<select>`,
    // which axe-core flags under its own rule, `select-name` — the same
    // underlying defect (no accessible name), reported by the rule that
    // actually applies to this element. Asserted by rule id, not by a
    // generic "has violations" check, for the same reason the brief's own
    // probe does: proving axe caught *this* break, not some other one.
    expect(broken.violations.map((v) => `${v.help} (${v.id})`)).toContain(
      "Select element must have an accessible name (select-name)",
    );

    // Restore, and prove the restoration is what fixed it — not a stale
    // result from the first run.
    label!.setAttribute("for", "analytics-sort");
    expect(select).toHaveAccessibleName("Sort by");
    expect(await axe(container)).toHaveNoViolations();
  });
});
