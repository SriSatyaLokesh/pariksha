// T-19's builder affordance (#58, P5.5): the three states an organiser can
// see, and what each of them is allowed to imply.
//
// The whole point of this file is the wording. `unverified` is "the server
// could not confirm it", `timeout` is "we did not get an answer in time",
// and neither is "your link is wrong" — a builder that says "invalid" over
// a slow CDN teaches organisers to ignore the flag, which is worse than not
// having one.

import { useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { axe } from "jest-axe";
import type { RegistrationFormSpec } from "@pariksha/core";

import { FormBuilder } from "../../src/components/testbuilder/FormBuilder";
import { PANEL_KEYS } from "../../src/components/testbuilder/SettingRow";
import type {
  Actor,
  ApiClient,
  ReachResult,
  TestSummary,
  TestVersionRow,
  Workspace,
} from "../../src/lib/api";
import { fakeClient as sharedClient } from "../fixtures/api-client";
import { OrganiserApp } from "../../src/routes/organiser";

const CHECKED_AT = 1_760_000_000_000;

const RESUME: RegistrationFormSpec = {
  fields: [
    {
      id: "resume_url",
      type: "url",
      label: "Link to your resume",
      required: true,
      validation: { check_reachable: true },
    },
  ],
};

function renderBuilder(checkUrl: (url: string) => Promise<ReachResult>) {
  const changes: RegistrationFormSpec[] = [];
  function Harness() {
    const [form, setForm] = useState<RegistrationFormSpec | undefined>(RESUME);
    return (
      <FormBuilder
        form={form}
        onChange={(next) => {
          changes.push(next);
          setForm(next);
        }}
        checkUrl={checkUrl}
      />
    );
  }
  const result = render(<Harness />);
  return { ...result, changes };
}

function answering(result: ReachResult): (url: string) => Promise<ReachResult> {
  return vi.fn(async () => result);
}

/** The affordance's own live region. `ReorderableList` has an unnamed
 * `role="status"` on this screen too, which is exactly why this one is
 * named. */
function status(): HTMLElement {
  return screen.getByRole("status", { name: /link check/i });
}

function tryLink(url = "https://example.com/cv.pdf"): void {
  fireEvent.change(screen.getByLabelText(/try a link/i), { target: { value: url } });
  fireEvent.click(screen.getByRole("button", { name: /^check$/i }));
}

describe("the url field's reachability affordance (T-19)", () => {
  it("the flag says the check is not built yet, and cannot be ticked", () => {
    // T-19 is deferred: fetching an organiser-chosen URL on the
    // registration path is an SSRF surface inside a 10 ms CPU budget, and
    // Phase 6 has nowhere to show the flag it would raise. The switch is
    // disabled with copy naming the phase rather than removed, because a
    // switch that silently does nothing is worse than an absent one — an
    // organiser would tick it and believe links were being checked.
    renderBuilder(answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT }));
    const flag = screen.getByRole("checkbox", { name: /check the link is reachable/i });
    expect(flag).toBeChecked();
    expect(flag).toBeDisabled();
    expect(screen.getByText(/not built yet/i)).toBeVisible();
    expect(screen.getByText(/never refused, and nothing blocked/i)).toBeVisible();
  });

  it("the three states are text plus glyph, and unverified never reads as invalid", async () => {
    renderBuilder(answering({ state: "unverified", status: 403, checkedAt: CHECKED_AT }));

    expect(status()).toHaveTextContent(/^Not checked$/);
    tryLink();

    await waitFor(() => expect(status()).toHaveTextContent(/unverified — the link did not return 200 \(403\)/i));
    expect(status().querySelector("svg")).toBeInTheDocument();
    expect(status()).not.toHaveTextContent(/invalid/i);
    expect(status()).not.toHaveTextContent(/unreachable/i);
  });

  it("a reachable link says so, with its own glyph", async () => {
    renderBuilder(answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT }));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/reachable — the link returned 200/i));
    expect(status().querySelector("svg")).toBeInTheDocument();
  });

  it("a refused link says why, and says it is not a verdict on the link", async () => {
    renderBuilder(
      answering({
        state: "refused",
        status: null,
        reason: "a link to a network address cannot be checked",
        checkedAt: CHECKED_AT,
      }),
    );
    tryLink("http://169.254.169.254/");
    await waitFor(() =>
      expect(status()).toHaveTextContent(/not checked — a link to a network address cannot be checked/i),
    );
  });

  it("the check shows it is running", async () => {
    let settle: (result: ReachResult) => void = () => undefined;
    const pending = new Promise<ReachResult>((resolve) => {
      settle = resolve;
    });
    renderBuilder(() => pending);

    tryLink();
    expect(status()).toHaveTextContent(/checking/i);
    // And it cannot be fired twice while it is in flight.
    expect(screen.getByRole("button", { name: /^check$/i })).toBeDisabled();

    settle({ state: "reachable", status: 200, checkedAt: CHECKED_AT });
    await waitFor(() => expect(status()).toHaveTextContent(/reachable/i));
  });

  it("a timeout reports a timeout with a retry, not unreachable", async () => {
    renderBuilder(answering({ state: "timeout", status: null, checkedAt: CHECKED_AT }));
    tryLink();

    await waitFor(() => expect(status()).toHaveTextContent(/timed out/i));
    expect(status()).not.toHaveTextContent(/unreachable/i);
    expect(screen.getByRole("button", { name: /check again/i })).toBeEnabled();
  });

  it("the result says when it was checked", async () => {
    renderBuilder(answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT }));
    tryLink();
    // Fixed and locale-independent: the organiser needs to know whether a
    // result is a minute old or a week old, not what their browser calls
    // Tuesday.
    await waitFor(() => expect(status()).toHaveTextContent("Checked at 2025-10-09 08:53 UTC."));
  });

  it("a request that fails outright is reported as a failed check, not as a failed link", async () => {
    renderBuilder(() => Promise.reject(new Error("network down")));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/the check could not be run/i));
    // Not reported as a statement about the link: the request failed, which
    // is a different fact.
    expect(status()).not.toHaveTextContent(/unverified/i);
  });

  it("an unverified result blocks nothing — the field is still editable and still saves", async () => {
    const { changes } = renderBuilder(answering({ state: "unverified", status: 404, checkedAt: CHECKED_AT }));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/unverified/i));

    const before = changes.length;
    fireEvent.change(screen.getByLabelText(/visible label/i), { target: { value: "Resume link" } });

    // The draft save path is `onChange` (the shell debounces it into one
    // `PATCH .../draft`): it still fires, with the edit in it.
    expect(changes.length).toBe(before + 1);
    expect(changes.at(-1)?.fields[0]?.label).toBe("Resume link");
    expect(screen.getByLabelText(/visible label/i)).toBeEnabled();
    // And nothing from the check was written onto the field.
    expect(JSON.stringify(changes.at(-1))).not.toContain("unverified");
  });

  it("the check is only offered once the flag is on", () => {
    const off: RegistrationFormSpec = { fields: [{ id: "resume_url", type: "url", label: "Resume" }] };
    render(<FormBuilder form={off} onChange={() => undefined} checkUrl={answering({ state: "reachable", status: 200, checkedAt: CHECKED_AT })} />);
    expect(screen.queryByLabelText(/try a link/i)).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /check the link is reachable/i }));
    // Uncontrolled here on purpose: `onChange` is a no-op, so the flag does
    // not flip — which is what proves the affordance is driven by the
    // stored `check_reachable`, not by local checkbox state.
    expect(screen.queryByLabelText(/try a link/i)).toBeNull();
  });

  it("the url field row has no axe violations", async () => {
    const { container } = renderBuilder(answering({ state: "unverified", status: 404, checkedAt: CHECKED_AT }));
    tryLink();
    await waitFor(() => expect(status()).toHaveTextContent(/unverified/i));
    expect(await axe(container)).toHaveNoViolations();
    expect(
      await axe(within(container).getByRole("group", { name: /Link to your resume/i })),
    ).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// `D7` + `D5`: which setting is open is part of where you are.
//
// The five rows above collapse the builder's settings; a row an organiser
// opened is a place they can be sent back to, so it lives in `?panel=` the
// way `?section=` already lives in the URL. `view-url.ts` owns the parser —
// nothing below reads the query string for itself — and deliberately does
// not validate, so the check that `?panel=` names one of the five belongs
// to the screen that owns the union.
//
// `D14`: a deep link cannot be clicked to, so these mount the real entry
// point with the URL already set, which is exactly what a reload does.

const VIEW_WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const VIEW_ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const VIEW_TEST: TestSummary = {
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

/** One section, so the spine has something to open, and settings in every
 *  block, so each row states a value rather than a default. */
const VIEW_DRAFT: TestVersionRow = {
  id: "ver_1",
  testId: "tst_1",
  version: 1,
  body: {
    settings: {
      timing: { timezone: "Asia/Kolkata", duration_minutes: 60 },
      access: { mode: "link_code", access_code: "APTI-2026" },
      release: { when: "on_submit", show: "score_and_sections" },
    },
    sections: [
      { id: "quant", title: "Quantitative aptitude", source: { kind: "fixed", questions: [] } },
    ],
  },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

function viewClient(): ApiClient {
  return sharedClient({
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => VIEW_ACTOR,
    workspaces: async () => [VIEW_WORKSPACE],
    completeSetup: async () => VIEW_WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [],
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    listTags: async () => [],
    listGroups: async () => [],
    deleteGroup: async () => undefined,
    importBank: async () => ({ imported: 0, issues: [] }),
    exportBank: async () => ({ format: "pariksha/bank@1", name: "Exported", questions: [] }),
    tests: async () => [VIEW_TEST],
    test: async () => VIEW_TEST,
    draft: async () => VIEW_DRAFT,
    patchDraft: async () => VIEW_DRAFT,
    versions: async () => [],
    checklist: async () => [],
    readiness: async () => ({}),
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    workspaceBranding: async () => ({}),
    candidates: async () => [],
    lockedAttempts: async () => [],
    usage: async () => undefined,
  });
}

/** A reload at `search`: the URL is set before the app's first paint, which
 *  is the only difference between a deep link and a click. */
async function openBuilder({ search }: { search: string }) {
  window.history.replaceState(null, "", `/admin${search}`);
  const view = render(<OrganiserApp client={viewClient()} />);
  await screen.findByRole("heading", { level: 1, name: "Midterm" });
  return view;
}

/** The setting row's own control, named by its label (settings-rows.test.tsx). */
function rowFor(label: string): HTMLElement {
  const settings = screen.getByRole("region", { name: "Settings" });
  return within(settings).getByRole("button", { name: new RegExp(`^${label}\\b`) });
}

/** The section's disclosure, which is the spine's half of the argument. */
function sectionRow(): HTMLElement {
  return screen.getByRole("button", { name: /^Quantitative aptitude ·/i });
}

/** Derived from the union's own tuple, not written out a second time: a
 *  sixth panel added to `PANEL_KEYS` is checked by `expectNoPanelOpen`
 *  without anyone remembering this file. The five labels are the keys
 *  capitalised (`SettingRow`'s `label` prop in `test.tsx`), and a future
 *  label that is not would fail `rowFor` loudly rather than quietly
 *  skipping a row. */
const PANEL_LABELS = PANEL_KEYS.map((key) => key[0]!.toUpperCase() + key.slice(1));

function expectNoPanelOpen(): void {
  for (const label of PANEL_LABELS) {
    expect(rowFor(label)).toHaveAttribute("aria-expanded", "false");
  }
}

describe("the open setting lives in the query string (D7, D5)", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/admin");
  });

  afterEach(() => {
    window.history.replaceState(null, "", "/admin");
  });

  it("opens the panel named in the query string", async () => {
    await openBuilder({ search: "?view=test&test=tst_1&panel=access" });
    expect(rowFor("Access")).toHaveAttribute("aria-expanded", "true");
    // Open, not merely marked open: the panel itself is mounted.
    expect(await screen.findByRole("heading", { name: "Who can take this test" })).toBeVisible();
    // And one at a time still holds on the way in.
    expect(rowFor("Timing")).toHaveAttribute("aria-expanded", "false");
  });

  it("puts the open panel in the query string", async () => {
    const { unmount } = await openBuilder({ search: "?view=test&test=tst_1" });
    expect(new URLSearchParams(window.location.search).get("panel")).toBeNull();

    fireEvent.click(rowFor("Timing"));
    const written = new URLSearchParams(window.location.search);
    expect(written.get("panel")).toBe("timing");
    // The parameters this screen does not own are undisturbed, so the link
    // still names the test it was written from.
    expect(written.get("view")).toBe("test");
    expect(written.get("test")).toBe("tst_1");

    // Closing the row takes it back out rather than leaving a stale claim.
    fireEvent.click(rowFor("Timing"));
    expect(new URLSearchParams(window.location.search).get("panel")).toBeNull();
    unmount();

    // The key this write is most likely to destroy. `writeView` deletes
    // every id it owns that the params handed to it omit, so a
    // `togglePanel` that built a `ViewParams` from scratch rather than
    // reading the current one would write `?panel=` and silently drop
    // `?section=` — the open section would survive in React state and
    // vanish from the URL, and the next reload or Back would lose it.
    await openBuilder({ search: "?view=test&test=tst_1&section=quant" });
    expect(new URLSearchParams(window.location.search).get("section")).toBe("quant");

    fireEvent.click(rowFor("Access"));
    const beside = new URLSearchParams(window.location.search);
    expect(beside.get("panel")).toBe("access");
    expect(beside.get("section")).toBe("quant");
    expect(beside.get("test")).toBe("tst_1");
  });

  it("follows Back from an open panel to the closed builder", async () => {
    await openBuilder({ search: "?view=test&test=tst_1" });
    fireEvent.click(rowFor("Access"));
    expect(rowFor("Access")).toHaveAttribute("aria-expanded", "true");

    window.history.back();

    // History traversal is a queued task in jsdom exactly as it is in a
    // browser, so the listener has to be allowed to arrive.
    await waitFor(() => expect(rowFor("Access")).toHaveAttribute("aria-expanded", "false"));
    expect(screen.queryByRole("heading", { name: "Who can take this test" })).toBeNull();
    // Back closed the panel; it did not leave the builder.
    expect(screen.getByRole("heading", { level: 1, name: "Midterm" })).toBeVisible();
  });

  it("ignores an unknown panel name and opens none", async () => {
    // `view-url.ts` deliberately returns what the string said — an id in a
    // URL is a claim anyone can type. The union lives on this screen, so
    // the refusal does too.
    const { unmount } = await openBuilder({ search: "?view=test&test=tst_1&panel=payments" });
    expectNoPanelOpen();
    unmount();

    // The control, down the identical mount path: a name that IS one of the
    // five opens. Without it, "opens none" is satisfied just as well by a
    // screen that never reads `?panel=` at all.
    await openBuilder({ search: "?view=test&test=tst_1&panel=branding" });
    expect(rowFor("Branding")).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the section when ?section= and ?panel= are both present, and no panel", async () => {
    // The ruling (6.5d): the spine wins. A stale URL that opens a section
    // instead of a setting costs one click to correct; the reverse hides
    // the thing being edited behind a settings panel.
    const { unmount } = await openBuilder({
      search: "?view=test&test=tst_1&section=quant&panel=access",
    });
    expect(sectionRow()).toHaveAttribute("aria-expanded", "true");
    expectNoPanelOpen();
    expect(screen.queryByRole("heading", { name: "Who can take this test" })).toBeNull();
    unmount();

    // The control: the same `?panel=access`, alone, does open Access — so
    // the refusal above is the ruling being applied and not the parameter
    // being ignored.
    await openBuilder({ search: "?view=test&test=tst_1&panel=access" });
    expect(rowFor("Access")).toHaveAttribute("aria-expanded", "true");
  });
});
