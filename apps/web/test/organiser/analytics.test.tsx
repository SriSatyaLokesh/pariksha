// `AnalyticsRoute` (Phase 8c Task 1/2, `R-06`/`R-07`, #94/#95). The app's
// own entry point (the test builder's "Analytics" button, `View`'s
// `analytics` kind, `readView`/`paramsOf`) is not covered here — this file
// is only what the screen itself does once mounted, the same split
// `webhook-panel.test.tsx` keeps for `WebhookPanel`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import { ApiError, type ApiClient, type ItemStat, type TestAnalytics } from "../../src/lib/api";
import { AnalyticsRoute } from "../../src/routes/analytics";
import { fakeClient } from "../fixtures/api-client";

type AnalyticsFn = ApiClient["analytics"];
type ExportPageFn = ApiClient["exportPage"];

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
  truncated: false,
};

const ITEMS: ItemStat[] = [
  {
    questionId: "qst_1",
    stem: "A train 180 m long crosses a platform in 24 s. Find the platform length.",
    shareCorrect: 0.3,
    discrimination: 0.42,
    discriminationWithheld: null,
    optionPickRates: { a: 0.3, b: 0.7 },
    n: 20,
  },
  {
    questionId: "qst_2",
    stem: "Which figure completes the series shown above?",
    shareCorrect: 0.9,
    discrimination: null,
    discriminationWithheld: "too_few_attempts",
    optionPickRates: {},
    n: 6,
  },
  {
    questionId: "qst_3",
    stem: "Select the odd one out from the five words given.",
    shareCorrect: 1,
    discrimination: null,
    discriminationWithheld: "no_variance",
    optionPickRates: {},
    n: 20,
  },
];

function renderReady(
  overrides: {
    analytics?: Partial<TestAnalytics>;
    items?: ItemStat[];
    itemsTruncated?: boolean;
    analyticsSpy?: ReturnType<typeof vi.fn<AnalyticsFn>>;
  } = {},
) {
  const analytics: TestAnalytics = { ...BASE_ANALYTICS, ...overrides.analytics };
  const items = overrides.items ?? ITEMS;
  const itemsTruncated = overrides.itemsTruncated ?? false;
  const fetchAnalytics: AnalyticsFn =
    overrides.analyticsSpy ?? (async () => ({ analytics, items, itemsTruncated }));
  if (overrides.analyticsSpy) {
    overrides.analyticsSpy.mockResolvedValue({ analytics, items, itemsTruncated });
  }
  return render(
    <AnalyticsRoute
      workspaceId={WORKSPACE_ID}
      testId={TEST_ID}
      client={fakeClient({ analytics: fetchAnalytics })}
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
    // 10 histogram buckets + one share-correct bar per item + one
    // discrimination gauge per PRESENT item (qst_1 only — the two absent
    // rows render a hatch/flat mark instead, Important 3's own fix) + one
    // per-set bar + the integrity band's three.
    const presentDiscriminationCount = ITEMS.filter((i) => i.discriminationWithheld === null).length;
    expect(screen.getAllByRole("progressbar")).toHaveLength(
      10 + ITEMS.length + presentDiscriminationCount + 1 + 3,
    );
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
    // Fix round 1, Minor 2: the original version of this test asserted
    // only the resulting order, which would pass even if sorting issued a
    // fresh request per click — a test that does not test its own name.
    // The spy is what actually proves "client-side".
    const analyticsSpy = vi.fn<AnalyticsFn>();
    renderReady({ analyticsSpy });
    await screen.findByText("Every question");
    expect(analyticsSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Share correct/ }));
    expect(questionOrder()).toEqual(["qst_3", "qst_2", "qst_1"]);
    expect(analyticsSpy).toHaveBeenCalledTimes(1);

    // Clicking again reverses it.
    fireEvent.click(screen.getByRole("button", { name: /Share correct/ }));
    expect(questionOrder()).toEqual(["qst_1", "qst_2", "qst_3"]);
    expect(analyticsSpy).toHaveBeenCalledTimes(1);
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

  // Fix round 1, Important 2.
  it("renders the question's own stem, joined by the route, not a bare id", async () => {
    renderReady();
    await screen.findByText("Every question");
    expect(screen.getByText(ITEMS[0]!.stem)).toBeInTheDocument();
    expect(screen.getByText(ITEMS[1]!.stem)).toBeInTheDocument();
  });

  // Fix round 1, Important 3: a present discrimination value gets the same
  // `.analytics-disc` gauge the two absent states use, not bare text.
  it("renders a gauge bar for a present discrimination value, aligned with the absent states", async () => {
    renderReady();
    await screen.findByText("Every question");
    // qst_1's 0.42 is the only present value among the three fixture rows.
    expect(screen.getByLabelText("Discrimination index")).toBeInTheDocument();
  });

  // Fix round 1, Minor 1: the approved prototype's own glyph for a
  // negative index is △ (outlined), not ▲ (filled).
  it("marks a negative discrimination with the prototype's own outlined triangle", async () => {
    renderReady({
      items: [
        {
          questionId: "qst_14",
          stem: "A bad question.",
          shareCorrect: 0.31,
          discrimination: -0.14,
          discriminationWithheld: null,
          optionPickRates: {},
          n: 290,
        },
      ],
    });
    await screen.findByText("Every question");
    expect(screen.getByText("-0.14")).toBeInTheDocument();
    const row = screen.getByText("-0.14").closest("tr")!;
    expect(within(row).getByText("△")).toBeInTheDocument();
    expect(within(row).queryByText("▲")).not.toBeInTheDocument();
  });
});

describe("AnalyticsRoute — truncation (Fix round 1, Important 1)", () => {
  it("states when the R-06 figures cover fewer attempts than the full cohort", async () => {
    renderReady({ analytics: { truncated: true } });
    // "cohort" is R-06's own banner wording; R-07's reads "roster" at the
    // same spot — distinct so this assertion cannot pass off the wrong one.
    expect(await screen.findByText(/not the whole cohort/)).toBeInTheDocument();
    expect(screen.queryByText(/not the whole roster/)).not.toBeInTheDocument();
  });

  it("says nothing about truncation when neither fetch was truncated", async () => {
    renderReady();
    await screen.findByText("Test analytics");
    expect(screen.queryByText(/larger than one pass could read/)).not.toBeInTheDocument();
  });

  it("states when the R-07 item figures cover fewer attempts than the full cohort", async () => {
    renderReady({ itemsTruncated: true });
    expect(await screen.findByText(/not the whole roster/)).toBeInTheDocument();
    expect(screen.queryByText(/not the whole cohort/)).not.toBeInTheDocument();
  });
});

/** What the browser was handed to save — the same capture technique
 *  `authoring/import.test.tsx`'s own `captureDownloads()` uses: jsdom
 *  performs no real download, so the Blob handed to `createObjectURL` and
 *  the anchor's own `download` attribute are the whole observable effect. */
function captureDownloads(): { name: string; blob: Blob }[] {
  const saved: { name: string; blob: Blob }[] = [];
  let pending: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    pending = blob as Blob;
    return "blob:sample";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (pending !== undefined) saved.push({ name: this.download, blob: pending });
  });
  return saved;
}

function renderWithExport(exportPage: ExportPageFn) {
  return render(
    <AnalyticsRoute
      workspaceId={WORKSPACE_ID}
      testId={TEST_ID}
      client={fakeClient({
        analytics: async () => ({ analytics: BASE_ANALYTICS, items: ITEMS, itemsTruncated: false }),
        exportPage,
      })}
    />,
  );
}

describe("AnalyticsRoute — the download buttons drain every page (Phase 8c Task 3, K38)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drains every page in cursor order and downloads one assembled file", async () => {
    const saved = captureDownloads();
    const pages = [
      { csv: "header\r\nrow1\r\n", nextCursor: "cur2", filename: "t_results_20261024-0000.csv" },
      { csv: "row2\r\n", nextCursor: "cur3", filename: "t_results_20261024-0000.csv" },
      { csv: "row3\r\n", nextCursor: null, filename: "t_results_20261024-0000.csv" },
    ];
    const seenCursors: (string | undefined)[] = [];
    const exportPage: ExportPageFn = vi.fn(async (_workspaceId, _testId, kind, cursor) => {
      expect(kind).toBe("results");
      seenCursors.push(cursor);
      const page = pages[seenCursors.length - 1];
      if (page === undefined) throw new Error("drained more pages than the fixture has — the loop did not stop");
      return page;
    });
    renderWithExport(exportPage);
    await screen.findByText("Test analytics");

    fireEvent.click(screen.getByRole("button", { name: "Export results CSV" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    // Every page requested, in cursor order — never out of order, never a
    // round number capped short of `nextCursor: null`.
    expect(seenCursors).toEqual([undefined, "cur2", "cur3"]);
    expect(await saved[0]!.blob.text()).toBe("header\r\nrow1\r\nrow2\r\nrow3\r\n");
    expect(saved[0]!.name).toBe("t_results_20261024-0000.csv");
  });

  it("shows real progress while a multi-page drain is in flight, not a frozen button", async () => {
    let resolveSecondPage: (() => void) | undefined;
    const exportPage: ExportPageFn = vi.fn(async (_workspaceId, _testId, _kind, cursor) => {
      if (cursor === undefined) return { csv: "a\r\n", nextCursor: "cur2", filename: "f.csv" };
      await new Promise<void>((resolve) => {
        resolveSecondPage = resolve;
      });
      return { csv: "b\r\n", nextCursor: null, filename: "f.csv" };
    });
    captureDownloads();
    renderWithExport(exportPage);
    await screen.findByText("Test analytics");

    fireEvent.click(screen.getByRole("button", { name: "Export results CSV" }));

    // Page 1 announced before page 2 even starts — real per-page feedback,
    // not a spinner that could as easily be decorative.
    await screen.findByText("Downloading results CSV — page 1…");
    expect(screen.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export answers CSV" })).toBeDisabled();

    resolveSecondPage?.();
    await waitFor(() => expect(screen.queryByText(/Downloading/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Export results CSV" })).not.toBeDisabled();
  });

  it("fails the whole download when page two fails, and never hands over page one", async () => {
    const saved = captureDownloads();
    const exportPage: ExportPageFn = vi.fn(async (_workspaceId, _testId, _kind, cursor) => {
      if (cursor === undefined) return { csv: "header\r\nrow1\r\n", nextCursor: "cur2", filename: "f.csv" };
      throw new ApiError(500, "server_error", "Export page 2 failed.");
    });
    renderWithExport(exportPage);
    await screen.findByText("Test analytics");

    fireEvent.click(screen.getByRole("button", { name: "Export results CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The results CSV export failed: Export page 2 failed. — nothing was downloaded.",
    );
    // The user is told, and is not handed page one as though it were the
    // whole file — nothing reached `createObjectURL`/the anchor at all.
    expect(saved).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Export results CSV" })).not.toBeDisabled();
  });

  it("downloads the answers CSV from its own button, independently of the results one", async () => {
    const saved = captureDownloads();
    const exportPage: ExportPageFn = vi.fn(async (_workspaceId, _testId, kind) => {
      expect(kind).toBe("answers");
      return { csv: "h\r\nr\r\n", nextCursor: null, filename: "t_answers_20261024-0000.csv" };
    });
    renderWithExport(exportPage);
    await screen.findByText("Test analytics");

    fireEvent.click(screen.getByRole("button", { name: "Export answers CSV" }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("t_answers_20261024-0000.csv");
  });

  // Fix round 1, Important 1. `everEnded === 0` (nothing submitted,
  // auto-submitted or locked yet) does not mean "nothing to export" — a
  // live test with every candidate still mid-attempt is exactly the state
  // `R-10` names ("available during the test, for partial results"), and
  // the empty-state branch used to render with no buttons at all.
  it("shows both export buttons, and lets a drain succeed, before any attempt has ended", async () => {
    const saved = captureDownloads();
    const liveAnalytics: TestAnalytics = {
      ...BASE_ANALYTICS,
      counts: { registered: 200, inProgress: 200, submitted: 0, autoSubmitted: 0, locked: 0 },
    };
    const exportPage: ExportPageFn = vi.fn(async () => ({
      csv: "header\r\nrow1\r\n",
      nextCursor: null,
      filename: "t_answers_20261024-0000.csv",
    }));
    render(
      <AnalyticsRoute
        workspaceId={WORKSPACE_ID}
        testId={TEST_ID}
        client={fakeClient({
          analytics: async () => ({ analytics: liveAnalytics, items: [], itemsTruncated: false }),
          exportPage,
        })}
      />,
    );

    await screen.findByText("Nothing has been attempted yet");
    expect(screen.getByRole("button", { name: "Export results CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export answers CSV" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Export answers CSV" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]!.name).toBe("t_answers_20261024-0000.csv");
  });

  it("the in-progress export state has no axe violations", async () => {
    const exportPage: ExportPageFn = vi.fn(async (_workspaceId, _testId, _kind, cursor) => {
      if (cursor === undefined) return { csv: "a\r\n", nextCursor: "cur2", filename: "f.csv" };
      return new Promise<never>(() => {}); // page two hangs forever
    });
    captureDownloads();
    const { container } = renderWithExport(exportPage);
    await screen.findByText("Test analytics");

    fireEvent.click(screen.getByRole("button", { name: "Export results CSV" }));
    await screen.findByText("Downloading results CSV — page 1…");

    expect(await axe(container)).toHaveNoViolations();
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
