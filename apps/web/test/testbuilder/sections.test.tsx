// Sections and question sources (#55, P5.2) — UX-12, UX-14, UX-15, UX-16.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import type { Section } from "@pariksha/core";

import {
  ApiError,
  type ApiClient,
  type Bank,
  type QuestionSummary,
  type StoredSection,
  type TestSummary,
  type TestVersionRow,
  type Workspace,
} from "../../src/lib/api";
import { SectionList } from "../../src/components/testbuilder/SectionList";
import { OrganiserApp } from "../../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

/** The one row the test list shows, so the walk below has something to click. */
const TEST_ROW: TestSummary = {
  id: "tst_1",
  name: "Midterm",
  slug: "midterm",
  description: null,
  shortCode: "ab12cd",
  closesAt: null,
  state: "draft",
  currentVersion: null,
  draftVersion: 1,
  reviewRequested: false,
  tags: [],
  updatedAt: 0,
};

/** Task 10: `TestBuilder` takes the whole actor now, because T-23's
 * workspace branding is readable by every member and writable only by an
 * owner. An owner here, so the branding half renders enabled. */
const ACTOR = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner" as const, grants: [] }],
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
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
    tests: async () => [TEST_ROW],
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
    publishTest: async () => {
      throw new Error("not used by this test file");
    },
    closeTest: async () => {
      throw new Error("not used by this test file");
    },
    archiveTest: async () => {
      throw new Error("not used by this test file");
    },
    versions: async () => [],
    checklist: async () => [],
    cloneTest: async () => {
      throw new Error("not used by this test file");
    },
    exportTest: async () => {
      throw new Error("not used by this test file");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    // Task 6 (#58, P5.5): present only to satisfy `ApiClient`'s shape --
    // nothing in this file reaches T-19's link check.
    checkUrl: async () => {
      throw new Error("not used by this test file");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used by this test file");
    },
    uploadMedia: async () => {
      throw new Error("not used by this test file");
    },
    candidates: async () => [],
    importCandidates: async () => {
      throw new Error("not used by this test file");
    },
    listWebhooks: async () => {
      throw new Error("not used by this test file");
    },
    createWebhook: async () => {
      throw new Error("not used by this test file");
    },
    setWebhookActive: async () => {
      throw new Error("not used by this test file");
    },
    deleteWebhook: async () => {
      throw new Error("not used by this test file");
    },
    listApiKeys: async () => ({ keys: [] }),
    createApiKey: async () => {
      throw new Error("not used by this test file");
    },
    revokeApiKey: async () => {
      throw new Error("not used by this test file");
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
    // Not a bare /short/i: fix round I13's type filter <select> legitimately
    // renders a "short_answer" <option>.
    expect(screen.queryByText(/\d+ short —/i)).not.toBeInTheDocument();
  });

  it("fix round (task 3 review, I13): T-08/AC-10 — a pool's filter can be given a difficulty and a type, not only tags", () => {
    render(<Harness initial={[QUANT]} />);
    const difficulty = screen.getByLabelText(/^difficulty$/i);
    const type = screen.getByLabelText(/^type$/i);
    const tags = screen.getByLabelText(/tags/i);
    expect(tags).toHaveValue("quantitative");

    fireEvent.change(difficulty, { target: { value: "medium" } });
    expect(difficulty).toHaveValue("medium");
    // Setting difficulty does not disturb the existing tags filter.
    expect(tags).toHaveValue("quantitative");

    fireEvent.change(type, { target: { value: "single" } });
    expect(type).toHaveValue("single");
    expect(difficulty).toHaveValue("medium");

    fireEvent.change(difficulty, { target: { value: "" } });
    expect(difficulty).toHaveValue("");
    // Clearing difficulty back to "Any" does not clear type or tags.
    expect(type).toHaveValue("single");
    expect(tags).toHaveValue("quantitative");
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

  // Task 4 (#56, P5.3): `SetsPanel`/`ShuffleFieldset` are unit-tested in
  // sets.test.tsx; these three prove the open section actually mounts them
  // and writes what they report back onto the section.
  it("task 4: a sets section's assignment is the radio group, not a select", () => {
    const reasoning: StoredSection = {
      id: "reasoning",
      title: "Reasoning",
      source: {
        kind: "sets",
        assignment: "hash",
        sets: [
          { set: "A", questions: ["qst_a1"] },
          { set: "B", questions: ["qst_b1"] },
        ],
      },
    };
    render(<Harness initial={[reasoning]} />);
    expect(screen.getByRole("radio", { name: /hash/i })).toBeChecked();
    expect(screen.getByRole("group", { name: /set assignment/i })).toBeVisible();
  });

  it("task 4: T-10 belongs to every section, not only a sets one", () => {
    render(<Harness initial={[QUANT]} />);
    const group = screen.getByRole("group", { name: /shuffling/i });
    expect(within(group).getByRole("checkbox", { name: /shuffle questions within this section/i })).toBeChecked();
  });

  it("task 4: the two controls both reach the section, and neither undoes the other", () => {
    const reasoning: StoredSection = {
      id: "reasoning",
      title: "Reasoning",
      source: {
        kind: "sets",
        assignment: "hash",
        sets: [
          { set: "A", questions: ["qst_a1"] },
          { set: "B", questions: ["qst_b1"] },
        ],
      },
    };
    render(<Harness initial={[reasoning]} />);

    // Each write goes through `onChange` and comes back as a new
    // `sections` prop, so a wiring that fired two separate updates from one
    // handler — each rebuilt from the same stale section — would show the
    // second silently undoing the first here.
    fireEvent.click(screen.getByRole("checkbox", { name: /shuffle questions within this section/i }));
    expect(screen.getByRole("checkbox", { name: /shuffle questions within this section/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /hash/i })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /round robin/i }));
    expect(screen.getByRole("radio", { name: /round robin/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /shuffle questions within this section/i })).not.toBeChecked();
    // And the sets themselves survive both writes — one "Add questions"
    // button per set, still two.
    expect(screen.getAllByRole("button", { name: /add questions/i })).toHaveLength(2);
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

  it("Load more appends the next page and keeps the first page's points", async () => {
    // Fix round (task 3 review, I14): `listQuestions` has paged since Phase 4,
    // but the drawer rendered only the first page with no control to reach the
    // rest — a 300-question bank's later pages could not be put in a fixed list
    // at all. The footer total is the half that would have silently undercounted:
    // it must count both pages, not only the one currently rendered.
    const bank: Bank = {
      id: "bnk_1",
      name: "Reasoning aptitude",
      description: null,
      license: null,
      tags: [],
      questionCount: 3,
      createdAt: 0,
      updatedAt: 0,
    };
    // Annotated, not inferred: without it `document.type` widens to
    // `string`, the fixture stops being a `Question`, and `pnpm typecheck`
    // fails on a file the suite still runs green (task 3 re-review).
    const page1: QuestionSummary[] = Array.from({ length: 2 }, (_, i) => ({
      id: `qst_a${i}`,
      bankId: "bnk_1",
      refId: `A${i}`,
      document: { id: `A${i}`, type: "true_false", prompt: `First ${i}`, key: true },
      points: 3,
      usedInTests: 0,
      updatedAt: 0,
    }));
    const page2: QuestionSummary[] = [
      {
        id: "qst_b0",
        bankId: "bnk_1",
        refId: "B0",
        document: { id: "B0", type: "true_false", prompt: "Second 0", key: true },
        points: 5,
        usedInTests: 0,
        updatedAt: 0,
      },
    ];

    let calls = 0;
    render(
      <Harness
        initial={[
          {
            id: "written",
            title: "Written",
            source: { kind: "fixed", questions: [...page1, ...page2].map((q) => q.id) },
          } as StoredSection,
        ]}
        client={fakeClient({
          listBanks: async () => [bank],
          listQuestions: async () => {
            calls += 1;
            return calls === 1
              ? { questions: page1, cursor: "page-2" }
              : { questions: page2 };
          },
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /add questions/i }));
    await screen.findByRole("option", { name: /reasoning aptitude/i });
    fireEvent.change(screen.getByLabelText(/bank/i), { target: { value: "bnk_1" } });

    expect(await screen.findByText(/First 0/)).toBeVisible();
    expect(screen.queryByText(/Second 0/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));

    // Appended, not replaced: page one is still on screen beside page two.
    expect(await screen.findByText(/Second 0/)).toBeVisible();
    expect(screen.getByText(/First 0/)).toBeVisible();

    // 2 x 3 + 1 x 5. A total built only from the rendered page would read 5.
    expect(await screen.findByText(/3 selected . 11 points/i)).toBeVisible();

    // The cursor is spent, so the control retires rather than paging forever.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
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


// D14: Home -> Tests -> the builder, the only route an organiser has. The
// three renders below used to mount `TestBuilder` directly with six props,
// two of which Phase 6.5c Task 1 deleted with `OrganiserHeader`.
async function openBuilder(client: ApiClient) {
  const view = render(<OrganiserApp client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
  fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  return view;
}

/** The same screen, reached the other way an organiser reaches it: a URL
 *  typed, bookmarked or reloaded. `D5` made that a first-class entry — the
 *  app still boots from `OrganiserApp`, it just reads where to land from
 *  the query string instead of from a click. */
async function reloadIntoBuilder(search: string, client: ApiClient) {
  window.history.replaceState(null, "", search);
  const view = render(<OrganiserApp client={client} />);
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  return view;
}

describe("TestBuilder (the open section lives in the URL)", () => {
  it("the open section is in the URL, so a reload returns to it", async () => {
    const section: Section = { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } };
    window.history.replaceState(null, "", "/");

    await openBuilder(fakeClient({
          test: async () => ({
            id: "tst_1",
            name: "Midterm",
            slug: "midterm",
            description: null,
            shortCode: "ab12cd",
            closesAt: null,
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
        }));

    fireEvent.click(await screen.findByRole("button", { name: /^Quantitative aptitude ·/i }));
    // The whole query string also carries `?view=test&test=tst_1` now
    // (`D5`), so this asserts the parameter this screen owns rather than
    // the string every screen shares — and then the two it must not
    // disturb. Fix round 1, Minor 2: without them, an `openSection` that
    // rebuilt the view from `readView`'s `"home"` default would write
    // `?view=home&section=quant`, the reload would land on Home, and this
    // suite would stay green on a link that no longer works.
    const written = new URLSearchParams(window.location.search);
    expect(written.get("section")).toBe("quant");
    expect(written.get("view")).toBe("test");
    expect(written.get("test")).toBe("tst_1");
  });

  it("fix round (task 3 review, I10): a reload with ?section= already in the URL opens that section", async () => {
    // The test above only asserts the *write* — the initial read
    // (`useState(() => readView(...).section)`) was never driven. Changing
    // that initializer to `useState<string | null>(null)` would leave the
    // suite green without this mount: the URL already carries
    // `?section=quant` before `TestBuilder` ever renders, simulating the
    // reload #55's own acceptance box describes.
    //
    // It is a reload now rather than a walk: under `D5` a navigation
    // rewrites the whole view, so clicking Tests on the way in is exactly
    // what clears a stale `?section=` — which is the behaviour wanted, and
    // means this test has to arrive the way the reload it describes does.
    const section: Section = { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } };

    await reloadIntoBuilder("/?view=test&test=tst_1&section=quant", fakeClient({
          test: async () => ({
            id: "tst_1",
            name: "Midterm",
            slug: "midterm",
            description: null,
            shortCode: "ab12cd",
            closesAt: null,
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
        }));

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
    closesAt: null,
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
    return openBuilder(fakeClient({ test: async () => BASE_TEST, ...client }));
  }

  it("collapses rapid edits into one PATCH, not one per keystroke", async () => {
    const section: Section = { id: "s1", title: "One", source: { kind: "fixed", questions: [] } };
    const patchDraft = vi.fn(async (_ws: string, _id: string, patch: { sections?: StoredSection[] }) =>
      baseDraft(patch.sections ?? []),
    );
    await renderBuilder({ draft: async () => baseDraft([section]), patchDraft });

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
    await renderBuilder({
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
    await renderBuilder({ draft: async () => baseDraft([section]), patchDraft });

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

  // Task 3 re-review: the I4 debounce fix replaced the post-save
  // `setDraft(await client.draft(...))` with a merge of the PATCH
  // response's `body` alone — but PATCH deliberately returns no
  // `draw`/`setPoints`/`points` (apps/api/src/routes/tests.ts), and `load`
  // runs on mount only. From the first edit onward UX-15's live draw and
  // UX-12's points figure were frozen for the rest of the session, which is
  // exactly the defect I2 was raised for.
  it("task 3 re-review: the derived numbers refresh after a save, not only on mount", async () => {
    const section: StoredSection = {
      id: "quant",
      title: "Quantitative aptitude",
      source: { kind: "pool", count: 10, filter: { tags: ["sql"] } },
    };
    let reads = 0;
    const draftFn = vi.fn(async (): Promise<TestVersionRow> => {
      reads += 1;
      return { ...baseDraft([section]), draw: { quant: { matching: reads === 1 ? 14 : 11, wanted: 10 } } };
    });
    await renderBuilder({
      draft: draftFn,
      patchDraft: async (_ws: string, _id: string, patch: { sections?: StoredSection[] }) =>
        baseDraft(patch.sections ?? []),
    });

    expect(await screen.findByText(/10 drawn from 14 matching/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /add section/i }));

    expect(await screen.findByText(/10 drawn from 11 matching/i)).toBeVisible();
    // And the refresh must not undo the edit that triggered it: this
    // fixture's GET always answers one section, so a refresh that replaced
    // the whole local body would make the section just added disappear.
    expect(screen.getByRole("button", { name: /move section Untitled section down/i })).toBeInTheDocument();
  });
});
