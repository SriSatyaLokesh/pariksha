// Sections and question sources (#55, P5.2) — UX-12, UX-14, UX-15, UX-16.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Section } from "@pariksha/core";

import { ApiError, type ApiClient, type Bank, type QuestionSummary, type StoredSection, type TestVersionRow } from "../../src/lib/api";
import { SectionList } from "../../src/components/testbuilder/SectionList";
import { TestBuilder } from "../../src/routes/test";

function noop(): void {
  /* no-op */
}

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => null,
    workspaces: async () => [],
    completeSetup: async () => ({ id: "wsp_1", name: "W" }),
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    createBank: async () => {
      throw new Error("not used");
    },
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: async () => {
      throw new Error("not used");
    },
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: async () => {
      throw new Error("not used");
    },
    updateGroup: async () => {
      throw new Error("not used");
    },
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    exportQuestion: async () => {
      throw new Error("not used");
    },
    tests: async () => [],
    createTest: async () => {
      throw new Error("not used");
    },
    test: async () => {
      throw new Error("not used");
    },
    updateTest: async () => {
      throw new Error("not used");
    },
    draft: async () => {
      throw new Error("not used");
    },
    patchDraft: async () => {
      throw new Error("not used");
    },
    ...overrides,
  };
}

/** A thin harness: `SectionList` is controlled (`sections`/`openSectionId`
 * are props, not state), so a test that wants a real reorder/open/delete to
 * stick needs something owning that state — the same role `TestBuilder`
 * plays for real, stood in for here with nothing else attached so a test
 * that only exercises `SectionList` does not also have to fake a whole
 * draft fetch. */
function Harness({
  initial,
  client = fakeClient(),
  draw = {},
  setPoints = {},
  points = {},
}: {
  initial: StoredSection[];
  client?: ApiClient;
  draw?: Record<string, { matching: number; wanted: number }>;
  setPoints?: Record<string, { set: string; points: number }[]>;
  points?: Record<string, { min: number; max: number }>;
}) {
  const [sections, setSections] = useState(initial);
  const [openSectionId, setOpenSectionId] = useState<string | null>(initial[0]?.id ?? null);
  return (
    <SectionList
      sections={sections}
      draw={draw}
      setPoints={setPoints}
      points={points}
      onChange={setSections}
      openSectionId={openSectionId}
      onOpenSection={setOpenSectionId}
      client={client}
      workspaceId="wsp_1"
    />
  );
}

const QUANT: StoredSection = {
  id: "quant",
  title: "Quantitative aptitude",
  time_limit_minutes: 15,
  source: { kind: "pool", bank: "bnk_1", count: 4, filter: { tags: ["quantitative"] } },
};

describe("SectionList", () => {
  it("UX-12: a collapsed section reads title, source, question count, points and time", () => {
    render(<Harness initial={[QUANT]} points={{ quant: { min: 8, max: 8 } }} />);
    expect(
      screen.getByRole("button", { name: /Quantitative aptitude · pool · 4 questions · 8 points · 15 min/i }),
    ).toBeVisible();
  });

  it("sections reorder by keyboard and the new position is announced", () => {
    const sections: StoredSection[] = [
      { ...QUANT },
      { id: "verbal", title: "Verbal", source: { kind: "fixed", questions: [] } },
      { id: "logical", title: "Logical", source: { kind: "fixed", questions: [] } },
    ];
    render(<Harness initial={sections} />);

    // No @testing-library/user-event in this workspace (see
    // apps/web/test/authoring/reorder.test.tsx) — a focused native
    // <button>'s real Enter/Space activation is a `click` in every browser,
    // so `fireEvent.click` after `.focus()` exercises the same code path a
    // keyboard user reaches.
    const down = screen.getByRole("button", { name: /move section Quantitative aptitude down/i });
    down.focus();
    fireEvent.click(down);

    expect(screen.getByRole("status")).toHaveTextContent(/moved to position 2 of 3/i);
  });

  it("UX-15: a shortfall states the number short, in text plus glyph", () => {
    render(<Harness initial={[QUANT]} draw={{ quant: { matching: 7, wanted: 10 } }} />);
    expect(screen.getByText(/3 short — needs 10, 7 match/i)).toBeVisible();
  });

  it("UX-15: a healthy pool section still shows the live draw, not only a shortfall", () => {
    render(<Harness initial={[QUANT]} draw={{ quant: { matching: 14, wanted: 10 } }} />);
    expect(screen.getByText(/10 drawn from 14 matching/i)).toBeVisible();
    expect(screen.queryByText(/short/i)).not.toBeInTheDocument();
  });

  it("UX-16: the balance strip has a table equivalent, not only bars", () => {
    const reasoning: StoredSection = {
      id: "reasoning",
      title: "Reasoning",
      source: {
        kind: "sets",
        assignment: "round_robin",
        sets: [
          { set: "A", questions: ["qst_a1"] },
          { set: "B", questions: ["qst_b1"] },
        ],
      },
    };
    render(
      <Harness
        initial={[reasoning]}
        setPoints={{
          reasoning: [
            { set: "A", points: 8 },
            { set: "B", points: 8 },
          ],
        }}
      />,
    );
    // Both sets are 8 — that is what "balanced" means, so there are
    // genuinely two "8" cells, not one (`getByText`'s usual single-match
    // call would be ambiguous here on purpose).
    const table = within(screen.getByRole("table", { name: /points per set/i }));
    expect(table.getAllByText("8")).toHaveLength(2);
  });

  it("switching a section's source names what is actually being discarded (fixed)", () => {
    const fixed: StoredSection = {
      id: "written",
      title: "Written",
      source: { kind: "fixed", questions: ["qst_1", "qst_2"] },
    };
    render(<Harness initial={[fixed]} />);
    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: "pool" } });
    expect(screen.getByRole("dialog")).toHaveTextContent(/hand-picked list of 2 questions/i);
  });

  it("switching a section's source names what is actually being discarded (pool)", () => {
    render(<Harness initial={[QUANT]} />);
    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: "fixed" } });
    expect(screen.getByRole("dialog")).toHaveTextContent(/its bank, count and filter/i);
  });

  it("deleting a section confirms and offers undo", () => {
    render(<Harness initial={[QUANT]} />);
    fireEvent.click(screen.getByRole("button", { name: /delete section/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    // `ReorderableList`'s own live region is also `role="status"` (empty,
    // here — nothing was reordered), so the one this test wants is found by
    // its own Undo button instead of by role alone.
    const status = screen.getByRole("status", { name: /section deleted/i });
    expect(status).toHaveTextContent(/undo/i);
    expect(within(status).getByRole("button", { name: /undo/i })).toBeInTheDocument();
  });

  it("fix round (task 3 review, I9): Escape cancels the delete dialog, focus moves in and back", () => {
    render(<Harness initial={[QUANT]} />);
    const trigger = screen.getByRole("button", { name: /delete section/i });
    // No @testing-library/user-event in this workspace: a real click
    // focuses the element it activates, which `fireEvent.click` alone does
    // not simulate — the same `.focus()` + `fireEvent.click` precedent
    // `sections reorder by keyboard` (above) already uses.
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /delete this section/i });
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("fix round (task 3 review, I9): Escape cancels the source-switch dialog, focus moves in and back", () => {
    render(<Harness initial={[QUANT]} />);
    const select = screen.getByLabelText(/source/i);
    select.focus();
    fireEvent.change(select, { target: { value: "fixed" } });

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The source select is still "pool" — Escape cancelled, it did not switch.
    expect(screen.getByLabelText(/source/i)).toHaveValue("pool");
    expect(select).toHaveFocus();
  });

  it("fix round (task 3 review, I9): Escape closes the question picker and returns focus to Add questions", () => {
    const fixed: StoredSection = { id: "written", title: "Written", source: { kind: "fixed", questions: [] } };
    render(<Harness initial={[fixed]} />);

    const trigger = screen.getByRole("button", { name: /add questions/i });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /add questions/i });
    expect(dialog).toHaveFocus();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("UX-14: the picker is a drawer over the builder, with the bank browser's filters and a running footer", async () => {
    const bank: Bank = {
      id: "bnk_1",
      name: "Reasoning aptitude",
      description: null,
      license: null,
      tags: [],
      questionCount: 12,
      createdAt: 0,
      updatedAt: 0,
    };
    const questions: QuestionSummary[] = Array.from({ length: 12 }, (_, i) => ({
      id: `qst_${i}`,
      bankId: "bnk_1",
      refId: `Q${i}`,
      document: { id: `Q${i}`, type: "true_false", prompt: `Question ${i}`, key: true },
      points: 2,
      usedInTests: 0,
      updatedAt: 0,
    }));
    const fixed: StoredSection = {
      id: "written",
      title: "Written",
      source: { kind: "fixed", questions: questions.map((q) => q.id) },
    };

    render(
      <Harness
        initial={[fixed]}
        client={fakeClient({
          listBanks: async () => [bank],
          listQuestions: async () => ({ questions }),
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add questions/i }));
    expect(screen.getByRole("dialog", { name: /add questions/i })).toBeVisible();

    // The bank <option> itself arrives async (client.listBanks), so the
    // option must exist before a <select> will accept a change to its
    // value — jsdom (like a real browser) ignores a value with no matching
    // option.
    await screen.findByRole("option", { name: /reasoning aptitude/i });
    fireEvent.change(screen.getByLabelText(/bank/i), { target: { value: "bnk_1" } });
    expect(await screen.findByText(/12 selected · 24 points/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: /sections/i })).toBeVisible();
  });

  it("the collapsed row stays readable at 400 px", () => {
    // Fix round (task 3 review, I11): jsdom performs no layout, so
    // `container.style.width = "400px"` changes nothing a query can see —
    // the old assertion (`toHaveClass("section-row__summary")`) passed
    // against the exact truncation (`white-space: nowrap; text-overflow:
    // ellipsis`) the comment claimed to guard against. The honest pin
    // reads the stylesheet itself and asserts the wrapping declaration on
    // the class the collapsed row actually carries.
    const css = readFileSync(
      resolve(import.meta.dirname, "../../src/styles/testbuilder.css"),
      "utf8",
    );
    const rule = /\.section-row__summary\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toMatch(/overflow-wrap:\s*anywhere/);

    render(<Harness initial={[QUANT]} points={{ quant: { min: 8, max: 8 } }} />);
    const button = screen.getByRole("button", { name: /^Quantitative aptitude ·/i });
    expect(button).toHaveClass("section-row__summary");
  });

  it("fix round (task 3 review, I12): counts, points and durations use tabular figures", () => {
    const css = readFileSync(resolve(import.meta.dirname, "../../src/styles/testbuilder.css"), "utf8");
    for (const selector of [".section-row__summary", ".section-row__balance th", ".picker-drawer__points"]) {
      const escaped = selector.replace(/[.]/g, "\\.");
      const rule = new RegExp(`${escaped}[^{]*\\{[^}]*\\}`).exec(css)?.[0] ?? "";
      expect(rule, `${selector}'s rule`).toMatch(/font-variant-numeric:\s*tabular-nums/);
    }
  });

  it("the section list and the picker drawer have no axe violations", async () => {
    const { container: closed } = render(<Harness initial={[QUANT]} points={{ quant: { min: 8, max: 8 } }} />);
    expect(await axe(closed)).toHaveNoViolations();

    const bank: Bank = {
      id: "bnk_1",
      name: "Bank",
      description: null,
      license: null,
      tags: [],
      questionCount: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const fixed: StoredSection = { id: "written", title: "Written", source: { kind: "fixed", questions: [] } };
    const { container: open } = render(
      <Harness initial={[fixed]} client={fakeClient({ listBanks: async () => [bank] })} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /add questions/i })[0]!);
    expect(await axe(open)).toHaveNoViolations();
  });
});

describe("TestBuilder (the open section lives in the URL)", () => {
  it("the open section is in the URL, so a reload returns to it", async () => {
    const section: Section = { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } };
    window.history.replaceState(null, "", "/");

    render(
      <TestBuilder
        workspaceId="wsp_1"
        testId="tst_1"
        actorEmail="rao@example.edu"
        onSignOut={noop}
        onBack={noop}
        client={fakeClient({
          test: async () => ({
            id: "tst_1",
            name: "Midterm",
            slug: "midterm",
            description: null,
            shortCode: "ab12cd",
            state: "draft",
            currentVersion: null,
            draftVersion: 1,
            reviewRequested: false,
            tags: [],
            updatedAt: 0,
          }),
          draft: async () => ({
            id: "ver_1",
            testId: "tst_1",
            version: 1,
            body: { settings: {}, sections: [section] },
            publishedAt: null,
            createdAt: 0,
            draw: {},
            setPoints: {},
            points: {},
          }),
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Quantitative aptitude ·/i }));
    expect(window.location.search).toBe("?section=quant");
  });

  it("fix round (task 3 review, I10): a reload with ?section= already in the URL opens that section", async () => {
    // The test above only asserts the *write* — `sectionFromUrl()`'s own
    // initial read (`useState(() => sectionFromUrl())`) was never driven.
    // Changing that initializer to `useState<string | null>(null)` would
    // leave the suite green without this mount: the URL already carries
    // `?section=quant` before `TestBuilder` ever renders, simulating the
    // reload #55's own acceptance box describes.
    const section: Section = { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } };
    window.history.replaceState(null, "", "/?section=quant");

    render(
      <TestBuilder
        workspaceId="wsp_1"
        testId="tst_1"
        actorEmail="rao@example.edu"
        onSignOut={noop}
        onBack={noop}
        client={fakeClient({
          test: async () => ({
            id: "tst_1",
            name: "Midterm",
            slug: "midterm",
            description: null,
            shortCode: "ab12cd",
            state: "draft",
            currentVersion: null,
            draftVersion: 1,
            reviewRequested: false,
            tags: [],
            updatedAt: 0,
          }),
          draft: async () => ({
            id: "ver_1",
            testId: "tst_1",
            version: 1,
            body: { settings: {}, sections: [section] },
            publishedAt: null,
            createdAt: 0,
            draw: {},
            setPoints: {},
            points: {},
          }),
        })}
      />,
    );

    // Open only when the section was already expanded — the editor's own
    // "Delete section" button only renders inside the open section.
    expect(await screen.findByRole("button", { name: /delete section/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Quantitative aptitude ·/i })).toHaveAttribute("aria-expanded", "true");
  });
});

describe("TestBuilder (debounced, sequenced save — task 3 review, I4)", () => {
  const BASE_TEST = {
    id: "tst_1",
    name: "Midterm",
    slug: "midterm",
    description: null,
    shortCode: "ab12cd",
    state: "draft" as const,
    currentVersion: null,
    draftVersion: 1,
    reviewRequested: false,
    tags: [],
    updatedAt: 0,
  };

  function baseDraft(sections: StoredSection[]): TestVersionRow {
    return {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: {}, sections },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
  }

  function renderBuilder(client: Partial<ApiClient>) {
    return render(
      <TestBuilder
        workspaceId="wsp_1"
        testId="tst_1"
        actorEmail="rao@example.edu"
        onSignOut={noop}
        onBack={noop}
        client={fakeClient({ test: async () => BASE_TEST, ...client })}
      />,
    );
  }

  it("collapses rapid edits into one PATCH, not one per keystroke", async () => {
    const section: Section = { id: "s1", title: "One", source: { kind: "fixed", questions: [] } };
    const patchDraft = vi.fn(async (_ws: string, _id: string, patch: { sections?: StoredSection[] }) =>
      baseDraft(patch.sections ?? []),
    );
    renderBuilder({ draft: async () => baseDraft([section]), patchDraft });

    const add = await screen.findByRole("button", { name: /add section/i });
    fireEvent.click(add);
    fireEvent.click(add);
    fireEvent.click(add);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));
    // Four sections: the one the draft loaded with, plus the three clicks —
    // one request, reflecting where the burst of edits settled.
    expect(patchDraft.mock.calls[0]![2]).toMatchObject({ sections: expect.arrayContaining([expect.objectContaining({ id: "s1" })]) });
    expect((patchDraft.mock.calls[0]![2] as { sections: StoredSection[] }).sections).toHaveLength(4);
  });

  it("a failed save surfaces an error", async () => {
    const section: Section = { id: "s1", title: "One", source: { kind: "fixed", questions: [] } };
    renderBuilder({
      draft: async () => baseDraft([section]),
      patchDraft: async () => {
        throw new ApiError(500, "server_error", "The draft could not be saved.");
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: /add section/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/draft could not be saved/i);
  });

  it("a slow, superseded response does not clobber a later save", async () => {
    const section: Section = { id: "s1", title: "One", source: { kind: "fixed", questions: [] } };
    const resolvers: ((row: TestVersionRow) => void)[] = [];
    const patchDraft = vi.fn(
      async () =>
        new Promise<TestVersionRow>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderBuilder({ draft: async () => baseDraft([section]), patchDraft });

    const add = await screen.findByRole("button", { name: /add section/i });
    fireEvent.click(add);
    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(1));

    fireEvent.click(add);
    await waitFor(() => expect(patchDraft).toHaveBeenCalledTimes(2));

    // The second (newer) request resolves first; the first (now stale,
    // superseded) request resolves after it, with a body that would be
    // obviously wrong to apply — it must be ignored.
    resolvers[1]!(
      baseDraft([
        section,
        { id: "s2", title: "S2", source: { kind: "fixed", questions: [] } },
        { id: "s3", title: "S3", source: { kind: "fixed", questions: [] } },
      ]),
    );
    await screen.findByRole("button", { name: /move section S2 down/i });

    resolvers[0]!(baseDraft([section]));
    // A macrotask flush, not just a microtask one: the stale response's own
    // `await client.patchDraft(...)` needs a full turn of the loop to reach
    // its (ignored) continuation before this assertion can trust the DOM.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("button", { name: /move section S2 down/i })).toBeInTheDocument();
  });
});
