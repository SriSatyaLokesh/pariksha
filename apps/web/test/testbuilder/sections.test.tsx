// Sections and question sources (#55, P5.2) — UX-12, UX-14, UX-15, UX-16.

import { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Section } from "@pariksha/core";

import type { ApiClient, Bank, QuestionSummary, StoredSection } from "../../src/lib/api";
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
  points?: Record<string, number>;
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
    render(<Harness initial={[QUANT]} points={{ quant: 8 }} />);
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
    const { container } = render(<Harness initial={[QUANT]} points={{ quant: 8 }} />);
    container.style.width = "400px";
    const button = screen.getByRole("button", { name: /^Quantitative aptitude ·/i });
    expect(button).toBeVisible();
    // UX-12: the collapsed sentence wraps (testbuilder.css's own
    // `overflow-wrap: anywhere`) rather than truncating — this is the class
    // that rule is scoped to, so a change that drops it is what this test
    // catches.
    expect(button).toHaveClass("section-row__summary");
  });

  it("the section list and the picker drawer have no axe violations", async () => {
    const { container: closed } = render(<Harness initial={[QUANT]} points={{ quant: 8 }} />);
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
});
