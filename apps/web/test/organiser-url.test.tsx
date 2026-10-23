// View state in the query string (spec §5, `D5`) — `?view=…&test=…&bank=…`,
// read on first paint and on `popstate`, written by every navigation.
//
// `D5` buys one thing and owes one thing. It buys a URL an organiser can
// bookmark, reload and share. It owes Back: a persistent nav makes "you are
// here" and the browser's own Back button a visible problem, and a deep link
// is a string anyone can edit — so an id in it is a claim, never a fact.
// Both halves are asserted here.
//
// `D14`: every assertion starts at `OrganiserApp`. A deep link cannot be
// clicked to, so those tests set the URL and mount the real entry point,
// which is exactly what a reload does.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  ApiError,
  type Actor,
  type ApiClient,
  type Bank,
  type TestSummary,
  type Workspace,
} from "../src/lib/api";
import { OrganiserApp } from "../src/routes/organiser";

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const BANK: Bank = {
  id: "bnk_1",
  name: "SQL basics",
  description: null,
  license: null,
  tags: [],
  questionCount: 1,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
};

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

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [] }),
    me: async () => ACTOR,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    listBanks: async () => [BANK],
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
    test: async () => TEST_ROW,
    updateTest: async () => {
      throw new Error("not used");
    },
    draft: async () => ({
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: {}, sections: [] },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    }),
    patchDraft: async () => {
      throw new Error("not used");
    },
    publishTest: async () => {
      throw new Error("not used");
    },
    closeTest: async () => {
      throw new Error("not used");
    },
    archiveTest: async () => {
      throw new Error("not used");
    },
    versions: async () => [],
    checklist: async () => [],
    cloneTest: async () => {
      throw new Error("not used");
    },
    exportTest: async () => {
      throw new Error("not used");
    },
    importTest: async () => ({ testId: null, imported: false, issues: [], rebound: [] }),
    checkUrl: async () => {
      throw new Error("not used");
    },
    workspaceBranding: async () => ({}),
    saveWorkspaceBranding: async () => {
      throw new Error("not used");
    },
    uploadMedia: async () => {
      throw new Error("not used");
    },
    candidates: async () => [],
    importCandidates: async () => {
      throw new Error("not used");
    },
    gradingQueue: async () => {
      throw new Error("not used by this test file");
    },
    grade: async () => {
      throw new Error("not used by this test file");
    },
    recordVerdict: async () => {
      throw new Error("not used by this test file");
    },
    exportCandidateData: async () => {
      throw new Error("not used");
    },
    deleteCandidateData: async () => {
      throw new Error("not used");
    },
    usage: async () => undefined,
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
    ...overrides,
  };
}

/** A reload at `search`: the URL is set before the app's first paint, which
 *  is the only difference between a deep link and a click. */
function reloadAt(search: string, client: ApiClient = fakeClient()) {
  window.history.replaceState(null, "", `/admin${search}`);
  return render(<OrganiserApp client={client} />);
}

/** Home is the workspace name plus the nav saying so — there is no "Home"
 *  heading until `D6` gives the screen one, so "we are home" is asserted the
 *  way a visitor reads it: the rail's own current-page marking. */
async function expectHome() {
  // `waitFor` around the attribute, not `findBy` around the element: the
  // Home button exists on every screen in the shell, so awaiting the
  // *element* resolves immediately and asserts against whatever view is
  // still mounted. History traversal is a queued task in jsdom exactly as
  // it is in a browser, so this has to be allowed to arrive.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    ),
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin");
});

afterEach(() => {
  window.history.replaceState(null, "", "/admin");
});

describe("the view lives in the query string (D5)", () => {
  it("opens the view named in the query string on first paint", async () => {
    reloadAt("?view=banks");
    expect(await screen.findByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
  });

  it("opens a test named in the query string on first paint", async () => {
    reloadAt("?view=test&test=tst_1");
    expect(await screen.findByRole("heading", { level: 1, name: "Midterm" })).toBeVisible();
  });

  it("writes the view it navigated to, so a reload returns to it", async () => {
    render(<OrganiserApp client={fakeClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    await screen.findByRole("heading", { level: 1, name: "Tests" });
    expect(new URLSearchParams(window.location.search).get("view")).toBe("tests");
  });

  it("names the test it opened, not only the list", async () => {
    render(<OrganiserApp client={fakeClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
    await screen.findByRole("heading", { level: 1, name: "Midterm" });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("view")).toBe("test");
    expect(params.get("test")).toBe("tst_1");
  });
});

describe("Back and Forward (D5 — the nav makes Back a visible problem)", () => {
  it("follows the Back button between views", async () => {
    render(<OrganiserApp client={fakeClient()} />);
    await expectHome();

    fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
    await screen.findByRole("heading", { level: 1, name: "Banks" });

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    await screen.findByRole("heading", { level: 1, name: "Tests" });

    window.history.back();
    expect(await screen.findByRole("heading", { level: 1, name: "Banks" })).toBeVisible();

    window.history.back();
    await expectHome();
  });

  it("does not stack a Back stop for a destination already open", async () => {
    // Clicking Tests while on Tests is a no-op an organiser can perform
    // five times without noticing. Five identical history entries make the
    // Back button look broken, which is the failure `D5` is most exposed
    // to now that the nav is persistent and always one click away.
    render(<OrganiserApp client={fakeClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    await screen.findByRole("heading", { level: 1, name: "Tests" });

    fireEvent.click(screen.getByRole("button", { name: "Tests" }));
    fireEvent.click(screen.getByRole("button", { name: "Tests" }));

    window.history.back();
    await expectHome();
  });

  it("does not stack a Back stop for a URL that was typed rather than written", async () => {
    // Fix round 1, Minor 4: an identity provider (or a person) can hand the
    // app `?returnTo=/admin` with a raw slash, where `writeView` would
    // write `%2F`. Comparing the two as strings makes the first click on
    // the destination already open look like a navigation, and one Back
    // press then appears to do nothing — the defect `5d9a8b0` fixed,
    // surviving in the encoding corner.
    window.history.pushState(null, "", "/admin?view=banks&returnTo=/admin");
    render(<OrganiserApp client={fakeClient()} returnTo="/admin" />);
    await screen.findByRole("heading", { level: 1, name: "Banks" });

    fireEvent.click(screen.getByRole("button", { name: "Banks" }));

    window.history.back();
    await expectHome();
  });

  it("goes forward again after a Back", async () => {
    render(<OrganiserApp client={fakeClient()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
    await screen.findByRole("heading", { level: 1, name: "Banks" });

    window.history.back();
    await expectHome();

    window.history.forward();
    expect(await screen.findByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
  });
});

describe("a deep link is a claim, not a fact", () => {
  it("lands on an error when the query string names a test the actor cannot reach", async () => {
    reloadAt(
      "?view=test&test=tst_nope",
      fakeClient({
        test: async () => {
          throw new ApiError(404, "not_found", "That test does not exist.");
        },
        draft: async () => {
          throw new ApiError(404, "not_found", "That test does not exist.");
        },
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("That test does not exist.");
    // Fix round 1, Minor 1: the error is the whole answer. A "Loading…"
    // left running beside it says the screen is still coming, which is the
    // first thing a stale bookmark would show.
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("lands on an error when the query string names a bank the actor cannot reach", async () => {
    const refuse = async () => {
      throw new ApiError(404, "not_found", "That bank does not exist.");
    };
    reloadAt(
      "?view=bank&bank=bnk_nope",
      fakeClient({ listQuestions: refuse, listTags: refuse, listGroups: refuse }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("That bank does not exist.");
  });

  it("restores the bank, not an editor, when the query string names a question", async () => {
    // Fix round 1, Important: `QuestionScreen` fetches nothing — it takes
    // `bankId` as a string — so `?view=question&bank=…` used to render a
    // whole interactive editor around a bank nobody had checked, and the
    // actor found out at Save. The bank browser does fetch, so landing
    // there is what turns the claim in the URL into an answer.
    const refuse = async () => {
      throw new ApiError(403, "forbidden", "That bank belongs to another workspace.");
    };
    reloadAt(
      "?view=question&bank=bnk_other_workspace",
      fakeClient({ listQuestions: refuse, listTags: refuse, listGroups: refuse }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That bank belongs to another workspace.",
    );
    expect(screen.queryByRole("heading", { level: 1, name: "New question" })).toBeNull();
  });

  it("lands on Home when the query string names a test but no id", async () => {
    reloadAt("?view=test");
    await expectHome();
    // Never a shell wrapped around nothing: the builder is not mounted at
    // all, so there is no "Loading…" that never resolves.
    expect(screen.queryByRole("heading", { level: 1, name: "Test builder" })).toBeNull();
  });

  it("lands on Home when the query string names a bank but no id", async () => {
    reloadAt("?view=bank");
    await expectHome();
  });

  it("ignores an unknown view name", async () => {
    reloadAt("?view=wat");
    await expectHome();
  });
});

describe("?returnTo= is left alone (Phase 3 Review Focus 2)", () => {
  it("still reaches the sign-in link when the URL also names a view", async () => {
    // `admin-main.tsx` reads `?returnTo=` once, at module load, and hands it
    // down as a prop — `readView` never touches it. The URL carrying a view
    // beside it must not change that.
    window.history.replaceState(null, "", "/admin?returnTo=%2Fadmin&view=banks");
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => null,
          setupStatus: async () => ({
            needed: false,
            providers: [{ id: "google", kind: "oidc", label: "Google Workspace" }],
          }),
        })}
        returnTo="/admin"
      />,
    );

    const link = await screen.findByRole("link", { name: /Google Workspace/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("returnTo=%2Fadmin"));
  });

  it("survives a navigation that rewrites the view", async () => {
    reloadAt("?returnTo=%2Fadmin&view=banks");
    await screen.findByRole("heading", { level: 1, name: "Banks" });

    fireEvent.click(screen.getByRole("button", { name: "Tests" }));
    await screen.findByRole("heading", { level: 1, name: "Tests" });

    const params = new URLSearchParams(window.location.search);
    expect(params.get("returnTo")).toBe("/admin");
    expect(params.get("view")).toBe("tests");
  });

  it("survives a filter the test list writes", async () => {
    // `TestList` owns `?status=`/`?search=`/`?sort=` and rewrites the query
    // string when a filter changes. It must not take the view with it.
    reloadAt("?view=tests");
    await screen.findByRole("heading", { level: 1, name: "Tests" });

    fireEvent.change(screen.getByLabelText(/^status$/i), { target: { value: "published" } });

    await waitFor(() =>
      expect(window.location.search).toContain("status=published"),
    );
    expect(new URLSearchParams(window.location.search).get("view")).toBe("tests");
  });
});
