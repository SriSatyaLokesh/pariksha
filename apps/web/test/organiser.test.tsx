import { describe, it, expect, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";
import type { TestBranding } from "@pariksha/core";

import {
  safeReturnTo,
  signInUrl,
  ApiError,
  type ApiClient,
  type Actor,
  type IdentityProvider,
  type Workspace,
} from "../src/lib/api";
import { OrganiserApp } from "../src/routes/organiser";
import { tokens, type TypographyName } from "../src/styles/tokens";
import { declarations, parseRuleBodies, readResolvedCss } from "./css-chain";
import { SignIn } from "../src/routes/signin";
import { Setup } from "../src/routes/setup";

const GOOGLE: IdentityProvider = {
  id: "google",
  kind: "oidc",
  label: "Google Workspace",
};
const EMAIL: IdentityProvider = {
  id: "email",
  kind: "magic_link",
  label: "Email me a sign-in link",
};

const WORKSPACE: Workspace = { id: "wsp_1", name: "Placement cell" };

const ACTOR: Actor = {
  userId: "usr_1",
  email: "rao@example.edu",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

// The whole mock: one typed object literal implementing ApiClient. No MSW,
// no mock server, no network — the screens take their data access as a prop,
// which is the only reason that is enough.
function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: async () => ({ needed: false, providers: [GOOGLE] }),
    me: async () => null,
    workspaces: async () => [WORKSPACE],
    completeSetup: async () => WORKSPACE,
    requestMagicLink: async () => undefined,
    signOut: async () => undefined,
    // Phase 4 Task 2: none of this screen's tests exercise banks or
    // questions, so these never get called — only present to satisfy
    // `ApiClient`'s shape.
    listBanks: async () => [],
    createBank: async () => {
      throw new Error("not used by this test file");
    },
    listQuestions: async () => ({ questions: [] }),
    deleteQuestion: async () => undefined,
    saveQuestion: async () => {
      throw new Error("not used by this test file");
    },
    listTags: async () => [],
    listGroups: async () => [],
    createGroup: async () => {
      throw new Error("not used by this test file");
    },
    updateGroup: async () => {
      throw new Error("not used by this test file");
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
    checkUrl: async () => {
      throw new Error("not used");
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
    ...overrides,
  };
}

/** Phase 6.5d Task 1 (`D7`): the five settings are collapsed rows now, so a
 *  settings panel is one click deeper than it was. `D14` is unchanged by
 *  that — reachability is still proved from the app's own entry point, now
 *  through the row an organiser actually sees and clicks. */
async function openSetting(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(`^${label} —`) }));
}

describe("safeReturnTo (Review Focus 2: no open redirect)", () => {
  it("keeps a same-origin path", () => {
    expect(safeReturnTo("/dashboard?tab=tests")).toBe("/dashboard?tab=tests");
  });

  it.each([
    ["an absolute URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash-smuggled host", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a scheme-relative path with whitespace", "/ /evil.example"],
    ["a bare word", "dashboard"],
    ["nothing at all", undefined],
    ["an empty string", ""],
  ])("rejects %s and falls back to /", (_name, raw) => {
    expect(safeReturnTo(raw)).toBe("/");
  });
});

describe("signInUrl", () => {
  it("sends the provider's start endpoint a validated returnTo", () => {
    expect(signInUrl("google", "/dashboard")).toBe(
      "/api/v1/auth/google/start?returnTo=%2Fdashboard",
    );
  });

  it("never forwards a hostile returnTo to the server", () => {
    expect(signInUrl("google", "https://evil.example")).toBe(
      "/api/v1/auth/google/start?returnTo=%2F",
    );
  });
});

describe("SignIn", () => {
  it("shows only the providers setup/status reports", () => {
    render(<SignIn client={fakeClient()} providers={[GOOGLE]} returnTo="/" />);

    expect(
      screen.getByRole("link", { name: /google workspace/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sign-in link/i)).not.toBeInTheDocument();
  });

  it("offers the magic-link form only when the instance configures it", () => {
    render(<SignIn client={fakeClient()} providers={[EMAIL]} returnTo="/" />);

    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /google/i })).toBeNull();
  });

  it("builds the provider link from a hostile returnTo without leaving the origin", () => {
    render(
      <SignIn
        client={fakeClient()}
        providers={[GOOGLE]}
        returnTo="https://evil.example"
      />,
    );

    expect(
      screen.getByRole("link", { name: /google workspace/i }),
    ).toHaveAttribute("href", "/api/v1/auth/google/start?returnTo=%2F");
  });

  it("sends the typed address when the magic-link form is submitted", async () => {
    const requestMagicLink = vi.fn(async () => undefined);
    render(
      <SignIn
        client={fakeClient({ requestMagicLink })}
        providers={[EMAIL]}
        returnTo="/"
      />,
    );

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "rao@example.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(requestMagicLink).toHaveBeenCalledWith("rao@example.edu");
    expect(await screen.findByRole("status")).toHaveTextContent(
      /rao@example\.edu/,
    );
  });

  it("names the shape of a real address rather than saying the input is invalid", async () => {
    render(<SignIn client={fakeClient()} providers={[EMAIL]} returnTo="/" />);

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "rao" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("⚠");
    expect(error).toHaveTextContent(/name@college\.edu/i);
    expect(error).not.toHaveTextContent(/invalid/i);
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("renders the error envelope's message, never a raw status code", async () => {
    const requestMagicLink = vi.fn(async () => {
      throw new ApiError(429, "rate_limited", "Too many links requested. Try again in a minute.");
    });
    render(
      <SignIn
        client={fakeClient({ requestMagicLink })}
        providers={[EMAIL]}
        returnTo="/"
      />,
    );

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "rao@example.edu" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(/too many links requested/i);
    expect(error).not.toHaveTextContent("429");
  });

  it("says so plainly when the instance has configured no provider at all", () => {
    render(<SignIn client={fakeClient()} providers={[]} returnTo="/" />);

    expect(
      screen.getByText(/no sign-in method is configured/i),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <SignIn client={fakeClient()} providers={[GOOGLE, EMAIL]} returnTo="/" />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Setup (the first-run wizard)", () => {
  it("asks for one field at a time", () => {
    render(<Setup client={fakeClient()} onComplete={() => undefined} />);

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByLabelText(/workspace name/i)).toBeInTheDocument();
  });

  it("creates the workspace and hands control back when the name is given", async () => {
    const completeSetup = vi.fn(async () => WORKSPACE);
    const onComplete = vi.fn();
    render(
      <Setup client={fakeClient({ completeSetup })} onComplete={onComplete} />,
    );

    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Placement cell" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(completeSetup).toHaveBeenCalledWith({
      workspaceName: "Placement cell",
    });
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });

  it("says what a workspace name looks like rather than 'invalid format'", async () => {
    const completeSetup = vi.fn(async () => WORKSPACE);
    render(
      <Setup
        client={fakeClient({ completeSetup })}
        onComplete={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("⚠");
    expect(error).toHaveTextContent(/1 to 60 characters/i);
    expect(error).toHaveTextContent(/placement cell/i);
    expect(error).not.toHaveTextContent(/invalid/i);
    expect(completeSetup).not.toHaveBeenCalled();
  });

  it("moves focus to the field it refused, so the error is reachable", async () => {
    render(<Setup client={fakeClient()} onComplete={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/workspace name/i)).toHaveFocus(),
    );
  });

  it("renders the error envelope's message when the server refuses", async () => {
    const completeSetup = vi.fn(async () => {
      throw new ApiError(409, "setup_already_complete", "This instance already has an owner. Sign in instead.");
    });
    render(
      <Setup
        client={fakeClient({ completeSetup })}
        onComplete={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText(/workspace name/i), {
      target: { value: "Placement cell" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /already has an owner/i,
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Setup client={fakeClient()} onComplete={() => undefined} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

// D14: Home is reached the way an organiser reaches it — by signing in —
// rather than by rendering `Dashboard` with five props. Phase 6.5c Task 1
// moved the workspace name, the role crumb and sign-out out of this screen
// and into the shell, and a test that rendered the screen alone could not
// tell whether anything still carries them.
describe("Home (the dashboard, inside the shell)", () => {
  function renderHome(actor: Actor = ACTOR) {
    return render(<OrganiserApp client={fakeClient({ me: async () => actor })} />);
  }

  // Phase 6.5c Task 3 (`D6`/`D6a`): the two look-alike cards are gone and
  // the screen is an agenda. The ways into Banks and Tests are the shell's
  // rail, which is how twelve screens have them rather than one.
  it("names the workspace and leads with the two scale figures", async () => {
    renderHome();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What needs you" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recently edited" })).toBeInTheDocument();
    expect(screen.getByTestId("home-lead")).toHaveTextContent("0 tests");
  });

  it("offers exactly one next action out of the empty state", async () => {
    renderHome();
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    expect(
      await screen.findByRole("button", { name: /create your first test/i }),
    ).toBeEnabled();
  });

  // docs/design.md UX-11: the publish boundary is shown, not discovered —
  // the role you hold is stated on arrival rather than found at the moment
  // an action is refused. It is the shell's crumb now, which is how every
  // screen gets it rather than only this one.
  it("states the role the signed-in actor holds in this workspace", async () => {
    renderHome({
      ...ACTOR,
      memberships: [{ workspaceId: "wsp_1", role: "author", grants: [] }],
    });

    expect(await screen.findByText("Workspace · author")).toBeInTheDocument();
  });

  it("signs out through the client", async () => {
    const signOut = vi.fn(async () => undefined);
    render(<OrganiserApp client={fakeClient({ me: async () => ACTOR, signOut })} />);
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("has no axe violations", async () => {
    const { container } = renderHome();
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("OrganiserApp routes on state, not on a URL", () => {
  it("shows sign-in to a visitor the API does not recognise", async () => {
    render(<OrganiserApp client={fakeClient({ me: async () => null })} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it("shows the wizard to a signed-in visitor of an instance with no owner", async () => {
    render(
      <OrganiserApp
        client={fakeClient({
          setupStatus: async () => ({ needed: true, providers: [GOOGLE] }),
          me: async () => ACTOR,
        })}
      />,
    );

    expect(await screen.findByLabelText(/workspace name/i)).toBeInTheDocument();
  });

  it("shows the dashboard once the instance has an owner and the visitor is signed in", async () => {
    render(<OrganiserApp client={fakeClient({ me: async () => ACTOR })} />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();
  });

  it("sends a signed-out visitor of a dashboard URL to sign-in, carrying returnTo", async () => {
    render(<OrganiserApp client={fakeClient()} returnTo="/dashboard" />);

    expect(
      await screen.findByRole("link", { name: /google workspace/i }),
    ).toHaveAttribute("href", "/api/v1/auth/google/start?returnTo=%2Fdashboard");
  });

  it("drops a cross-origin returnTo before it reaches the sign-in link", async () => {
    render(
      <OrganiserApp client={fakeClient()} returnTo="https://evil.example" />,
    );

    expect(
      await screen.findByRole("link", { name: /google workspace/i }),
    ).toHaveAttribute("href", "/api/v1/auth/google/start?returnTo=%2F");
  });

  it("re-reads the API after the wizard, landing on the new workspace", async () => {
    let needed = true;
    render(
      <OrganiserApp
        client={fakeClient({
          setupStatus: async () => ({ needed, providers: [GOOGLE] }),
          me: async () => ACTOR,
          completeSetup: async () => {
            needed = false;
            return WORKSPACE;
          },
        })}
      />,
    );

    fireEvent.change(await screen.findByLabelText(/workspace name/i), {
      target: { value: "Placement cell" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create workspace/i }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();
  });

  it("renders the error envelope's message when the boot call fails", async () => {
    render(
      <OrganiserApp
        client={fakeClient({
          setupStatus: async () => {
            throw new ApiError(503, "unavailable", "Pariksha is restarting. Reload in a moment.");
          },
        })}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /pariksha is restarting/i,
    );
  });

  // Fix round (whole-branch review, C1): the whole point of this finding is
  // that a test rendering `BankBrowser` directly (apps/web/test/authoring/
  // bank-browser.test.tsx) cannot see that nothing in the running app ever
  // mounts it. This one starts from `OrganiserApp` — the real entry point
  // admin-main.tsx renders — and walks Dashboard -> Banks -> BankBrowser ->
  // QuestionScreen the only way an Author actually can, with no shortcut
  // that renders a screen in isolation.
  it("reaches a question editor from the app's own entry point", async () => {
    const bank = {
      id: "bnk_1",
      name: "Reasoning aptitude",
      description: null,
      license: null,
      tags: [],
      questionCount: 1,
      createdAt: 0,
      updatedAt: 0,
    };
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          listBanks: async () => [bank],
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Banks" }));
    fireEvent.click(await screen.findByRole("button", { name: /reasoning aptitude/i }));
    fireEvent.click(await screen.findByRole("button", { name: "New question" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "New question" }),
    ).toBeInTheDocument();
  });

  // Task 2 fix round, Critical 1: the Phase 4 C1 finding verbatim, for the
  // other screen the empty dashboard opens onto. A test that renders
  // `TestList` directly (apps/web/test/testbuilder/test-list.test.tsx)
  // cannot see that nothing in the running app ever mounts it.
  it("reaches the test list from the app's own entry point", async () => {
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: /create your first test/i }));

    expect(await screen.findByRole("heading", { level: 1, name: "Tests" })).toBeInTheDocument();
  });

  // Task 3 (#55, P5.2), same lesson applied a third time: a test that
  // renders `SectionList`/`TestBuilder` directly (apps/web/test/testbuilder/
  // sections.test.tsx) cannot see that nothing in the running app ever
  // mounts them. This one walks Dashboard -> Tests -> the builder the only
  // way an Author actually can.
  it("reaches the test builder from the app's own entry point", async () => {
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [
            {
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
            },
          ],
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
            body: { settings: {}, sections: [] },
            publishedAt: null,
            createdAt: 0,
            draw: {},
            setPoints: {},
            points: {},
          }),
        })}
      />,
    );

    expect(
      await screen.findByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Midterm" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sections" })).toBeInTheDocument();
  });

  // Task 4 (#56, P5.3), the same lesson a fourth time: sets.test.tsx
  // renders `SetsPanel` directly and so cannot see whether anything in the
  // running app mounts it. This walks Dashboard -> Tests -> the builder ->
  // the section's own disclosure, which is the only route an Author has to
  // T-09's assignment control and T-10's shuffle switch.
  it("reaches the set assignment and shuffle controls from the app's own entry point", async () => {
    const TEST_ROW = {
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
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => ({
            id: "ver_1",
            testId: "tst_1",
            version: 1,
            body: {
              settings: {},
              sections: [
                {
                  id: "reasoning",
                  title: "Reasoning",
                  source: {
                    kind: "sets" as const,
                    assignment: "round_robin" as const,
                    sets: [
                      { set: "A", questions: ["qst_a1"] },
                      { set: "B", questions: ["qst_b1"] },
                    ],
                  },
                },
              ],
            },
            publishedAt: null,
            createdAt: 0,
            draw: {},
            setPoints: {},
            points: {},
          }),
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Reasoning ·/i }));

    expect(await screen.findByRole("radio", { name: /round robin/i })).toBeChecked();
    expect(screen.getByText(/candidates sitting next to each other get different sets/i)).toBeVisible();
    expect(
      within(screen.getByRole("group", { name: /shuffling/i })).getByRole("checkbox", {
        name: /shuffle questions within this section/i,
      }),
    ).toBeChecked();
  });

  // Task 5 (#57, P5.4), the same lesson a fifth time: form-builder.test.tsx
  // renders `FormBuilder` directly and so cannot see whether anything in the
  // running app mounts it. This walks Dashboard -> Tests -> the builder, adds
  // a field the only way an Author can, and checks the save went out through
  // the one draft route Tasks 4-9 share — a settings patch, not a route of
  // its own.
  it("reaches the registration form builder from the app's own entry point and saves through the draft route", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: {}, sections: [] },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
    const patchDraft = vi.fn(async () => DRAFT);
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Registration");
    expect(await screen.findByRole("heading", { name: "Registration form" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/field type/i), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));

    // The preview is the candidate renderer, mounted by the running app.
    // Named exactly: Task 10's branding panel mounts three more previews
    // into this same shell, and /preview/i now matches all four.
    expect(
      within(screen.getByRole("region", { name: "Preview" })).getByLabelText(/^Email/),
    ).toBeInTheDocument();

    // The shell debounces at 250 ms (apps/web/src/routes/test.tsx).
    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(patchDraft.mock.calls[0]).toEqual([
      "wsp_1",
      "tst_1",
      { settings: { registration_form: { fields: [{ id: "email", type: "email", label: "Email" }] } } },
    ]);
  });

  // Task 6 (#58, P5.5). url-check.test.tsx drives `FormBuilder` with a
  // `checkUrl` closure of its own and so cannot see whether the running app
  // ever wires one to `ApiClient.checkUrl` — which is the whole wire this
  // task adds on the browser side.
  it("reaches T-19's link check from the app's own entry point, through ApiClient.checkUrl", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: {
        settings: {
          registration_form: {
            fields: [
              {
                id: "resume_url",
                type: "url" as const,
                label: "Link to your resume",
                validation: { check_reachable: true },
              },
            ],
          },
        },
        sections: [],
      },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
    const checkUrl = vi.fn(async () => ({
      state: "unverified" as const,
      status: 404,
      checkedAt: 1_760_000_000_000,
    }));

    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft: async () => DRAFT,
          checkUrl,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Registration");
    fireEvent.change(await screen.findByLabelText(/try a link/i), {
      target: { value: "https://drive.example/cv.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^check$/i }));

    await waitFor(() =>
      expect(screen.getByRole("status", { name: /link check/i })).toHaveTextContent(/unverified/i),
    );
    // Workspace first, then the test, then the URL — the path is
    // workspace-scoped and `requires()` reads the workspace out of its own
    // `:id` segment, so the plan's own `checkUrl(testId, url)` sketch could
    // not have reached the API at all.
    expect(checkUrl).toHaveBeenCalledWith("wsp_1", "tst_1", "https://drive.example/cv.pdf");
  });
  // Task 7 (#59, P5.6), the same lesson a seventh time: timing.test.tsx
  // renders `TimingPanel` directly and so cannot see whether anything in
  // the running app mounts it. This walks Dashboard -> Tests -> the
  // builder, changes the overall duration the only way an Author can, and
  // checks the save went out through the one draft route Tasks 4-10 share.
  it("reaches the timing panel from the app's own entry point and saves through the draft route", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: { timing: { timezone: "Asia/Kolkata", duration_minutes: 60 } }, sections: [] },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
    const patchDraft = vi.fn(async () => DRAFT);
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Timing");
    expect(await screen.findByRole("heading", { name: "Timing and attempts" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/overall duration/i), { target: { value: "90" } });

    // The shell debounces at 250 ms (apps/web/src/routes/test.tsx).
    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(patchDraft.mock.calls[0]).toEqual([
      "wsp_1",
      "tst_1",
      { settings: { timing: { timezone: "Asia/Kolkata", duration_minutes: 90 } } },
    ]);
  });
  // Task 8 (#60, P5.7), an eighth time: access.test.tsx renders
  // `AccessPanel` directly. This walks the app to it and checks the save
  // goes out through the one draft route — and, the point of Review Focus
  // 3, that switching mode sends an `access` object with the old mode's
  // code *gone* rather than merged over, because the server merges
  // `settings` one level deep and would keep whatever arrives.
  it("reaches the access panel from the app's own entry point and drops the old mode's code on the wire", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: { access: { mode: "link_code" as const, access_code: "APTI-2026" } }, sections: [] },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
    const patchDraft = vi.fn(async () => DRAFT);
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Access");
    expect(await screen.findByRole("heading", { name: "Who can take this test" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /single sign-on/i }));

    // The shell debounces at 250 ms (apps/web/src/routes/test.tsx).
    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(patchDraft.mock.calls[0]).toEqual(["wsp_1", "tst_1", { settings: { access: { mode: "sso" } } }]);
    expect(JSON.stringify(patchDraft.mock.calls[0])).not.toContain("APTI-2026");
  });
  // task 7/8/10 review, M8. `setPending` replaced rather than merged, so
  // two panels touched inside the 250 ms debounce dropped the first patch
  // — silently, because the local `setDraft` had already applied it and
  // the follow-up GET keeps `body: prev.body`. Tasks 7, 8 and 10 took
  // this screen from two writers to six, so it is reachable by ordinary
  // use: add a section, pick an access mode a moment later, reload, and
  // the section is gone.
  it("two panels edited inside the debounce window both reach the one patch", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: {}, sections: [] },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
    const patchDraft = vi.fn(async () => DRAFT);
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
    await openSetting("Access");
    await screen.findByRole("heading", { name: "Who can take this test" });

    // Three writers, synchronously — well inside the shell's 250 ms. Two of
    // them are now in different settings panels and `D7` opens one at a
    // time, so a row toggle sits between them: closing a panel mid-burst
    // must not drop the patch that panel already wrote.
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    fireEvent.click(screen.getByRole("radio", { name: /single sign-on/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Timing —/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^linear$/i }));

    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(patchDraft).toHaveBeenCalledTimes(1);
    const [, , patch] = patchDraft.mock.calls[0] as unknown as [string, string, Record<string, unknown>];
    expect(patch.sections).toHaveLength(1);
    expect(patch.settings).toMatchObject({ access: { mode: "sso" }, timing: { navigation: "linear" } });
  });

  // Task 9 (#60 / #56, P5.7b), the candidate list.
  // `candidate-list.test.tsx` renders the panel directly, so it cannot see
  // whether the running app mounts it, reads the list through the real
  // client method, knows which actor is looking, or re-reads storage after
  // an upload instead of trusting the report it just rendered.
  it("reaches the candidate list from the app's own entry point and uploads through the real client", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: {
        settings: {
          registration_form: {
            fields: [
              { id: "full_name", type: "short_text" as const, label: "Full name" },
              { id: "email", type: "email" as const, label: "College email address", unique: true },
            ],
          },
        },
        sections: [],
      },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };

    const listed = {
      id: "cnd_1",
      testId: "tst_1",
      externalId: "a@vce.edu.in",
      setLabel: null,
      formValues: {},
      source: "list" as const,
      consentVersion: null,
      createdAt: 0,
    };
    // The second read is what the shell does after a real upload: the
    // count on screen has to come from storage, not from the report.
    const candidates = vi.fn().mockResolvedValueOnce([listed]).mockResolvedValue([listed, { ...listed, id: "cnd_2" }]);
    const importCandidates = vi.fn(async () => ({ imported: 2, issues: [] }));

    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft: async () => DRAFT,
          candidates,
          importCandidates,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Access");
    expect(await screen.findByRole("heading", { name: "The candidate list" })).toBeInTheDocument();
    // Read through the real client method, not invented by the panel, and
    // the expected columns name the form's own first unique field.
    await waitFor(() => expect(candidates).toHaveBeenCalledWith("wsp_1", "tst_1"));
    expect(screen.getByText(/1 candidate · 1 with no set/i)).toBeVisible();
    expect(screen.getByText(/email \(required\), set \(optional\)/i)).toBeVisible();

    const csv = "email,set\na@vce.edu.in,\nb@vce.edu.in,\n";
    fireEvent.change(screen.getByLabelText("Candidate list"), {
      target: { files: [new File([csv], "candidates.csv", { type: "text/csv" })] },
    });

    const dialog = await screen.findByRole("dialog", { name: /replace the candidate list/i });
    expect(importCandidates).toHaveBeenCalledWith("wsp_1", "tst_1", csv, { dryRun: true });

    fireEvent.click(within(dialog).getByRole("button", { name: /replace the list/i }));
    await waitFor(() => expect(importCandidates).toHaveBeenLastCalledWith("wsp_1", "tst_1", csv, { dryRun: false }));
    // Re-read, not taken from the report.
    await waitFor(() => expect(screen.getByText(/2 candidates · 2 with no set/i)).toBeVisible());
    expect(candidates).toHaveBeenCalledTimes(2);
  });

  // The Author half of the same screen: the permission matrix's own
  // "Manage candidate lists and invites" line, proved against the running
  // app rather than against a prop.
  it("an Author reaches the candidate list, cannot upload, and the app never asks for it", async () => {
    const AUTHOR = {
      userId: "usr_2",
      email: "author@example.edu",
      memberships: [{ workspaceId: "wsp_1", role: "author" as const, grants: [] }],
    };
    const TEST_ROW = {
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
    const candidates = vi.fn(async () => []);

    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => AUTHOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
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
          candidates,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Access");
    expect(await screen.findByRole("heading", { name: "The candidate list" })).toBeInTheDocument();
    expect(screen.getByLabelText("Candidate list")).toBeDisabled();
    expect(screen.getByText("Needs an Admin — candidate lists are managed by Admins and Owners")).toBeVisible();
    // The route is `candidates.manage`, so asking would 403 and fail the
    // whole load. The shell does not ask.
    expect(candidates).not.toHaveBeenCalled();
  });

  // Task 10 (#61, P5.8), a ninth time. release-branding.test.tsx renders
  // both panels directly, so it cannot see whether the running app mounts
  // them, reads workspace branding at all, or knows which actor is
  // looking — the last of which is what makes the workspace half
  // read-only for an Author.
  it("reaches the release and branding panels from the app's own entry point", async () => {
    const TEST_ROW = {
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
    const DRAFT = {
      id: "ver_1",
      testId: "tst_1",
      version: 1,
      body: { settings: {}, sections: [] },
      publishedAt: null,
      createdAt: 0,
      draw: {},
      setPoints: {},
      points: {},
    };
    const patchDraft = vi.fn(async () => DRAFT);
    const saveWorkspaceBranding = vi.fn(async (_ws: string, branding: TestBranding) => branding);
    const uploadMedia = vi.fn(async () => ({ key: "media/wsp_1/abc.png" }));
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => ACTOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
          draft: async () => DRAFT,
          patchDraft,
          workspaceBranding: async () => ({ footer_text: "Alpha College" }),
          saveWorkspaceBranding,
          // The shell hangs the logo on the workspace's first bank — the
          // only media route this product has.
          listBanks: async () => [
            {
              id: "bnk_1",
              name: "Bank",
              description: null,
              license: null,
              tags: [],
              questionCount: 0,
              createdAt: 0,
              updatedAt: 0,
            },
          ],
          uploadMedia,
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Results");
    expect(await screen.findByRole("heading", { name: "When candidates see their result" })).toBeInTheDocument();
    // One at a time (`D7`), so the branding panel is reached by its own row
    // rather than found already mounted beside this one.
    await openSetting("Branding");
    expect(await screen.findByRole("heading", { name: "Branding" })).toBeInTheDocument();
    // Read through the real client method, not invented by the panel.
    expect(screen.getByLabelText(/footer text/i)).toHaveValue("Alpha College");

    // The per-test half rides the one draft route, like every other panel.
    fireEvent.change(screen.getByLabelText(/start message/i), { target: { value: "Good luck." } });
    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(patchDraft.mock.calls[0]).toEqual([
      "wsp_1",
      "tst_1",
      { settings: { branding: { start_message: "Good luck." } } },
    ]);

    // task 7/8/10 review, M1: the logo upload is the one path none of the
    // three reachability tests drove, and it is where the alt text was
    // being dropped — the panel test asserted a stub's argument, and the
    // shell's `uploadLogo` never had one. Driven here through the real
    // call site, and asserted on what the workspace write carries.
    fireEvent.change(screen.getByLabelText(/logo file/i), {
      target: { files: [new File([new Uint8Array([137, 80, 78, 71])], "crest.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText(/alt text/i), { target: { value: "Alpha College crest" } });
    fireEvent.click(screen.getByRole("button", { name: /^upload$/i }));
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledWith("wsp_1", "bnk_1", expect.any(File)));

    // The workspace half does not ride the draft route: it is
    // `PATCH /workspaces/:id`.
    fireEvent.change(screen.getByLabelText(/primary colour/i), { target: { value: "#b63a10" } });
    fireEvent.click(screen.getByRole("button", { name: /save workspace branding/i }));
    await waitFor(() => expect(saveWorkspaceBranding).toHaveBeenCalled());
    expect(saveWorkspaceBranding).toHaveBeenCalledWith("wsp_1", {
      footer_text: "Alpha College",
      logo: "media/wsp_1/abc.png",
      logo_alt: "Alpha College crest",
      primary_colour: "#b63a10",
    });
  });

  // ACTOR above is an owner. An Author reaching the same screen must see
  // the workspace half and be unable to save it — the PRD's own split,
  // proved against the running app rather than against a prop.
  it("an Author reaches the branding panel but cannot change the workspace half", async () => {
    const AUTHOR = {
      userId: "usr_2",
      email: "author@example.edu",
      memberships: [{ workspaceId: "wsp_1", role: "author" as const, grants: [] }],
    };
    const TEST_ROW = {
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
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => AUTHOR,
          tests: async () => [TEST_ROW],
          test: async () => TEST_ROW,
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
          workspaceBranding: async () => ({ footer_text: "Alpha College" }),
        })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    await openSetting("Branding");
    expect(await screen.findByRole("heading", { name: "Branding" })).toBeInTheDocument();
    expect(screen.getByLabelText(/primary colour/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /save workspace branding/i })).toBeDisabled();
    // Still readable: an Author needs to know what their candidates see.
    expect(screen.getByLabelText(/footer text/i)).toHaveValue("Alpha College");
    expect(screen.getByLabelText(/start message/i)).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// Phase 6.5c Task 1 (#181, D3): the chrome is hoisted out of the eleven
// `case` arms into one shell, so there is one sidebar for the whole
// organiser instead of twelve copies of `OrganiserHeader`.
//
// D14: every assertion starts at `OrganiserApp` and clicks its way there. A
// test that rendered `OrganiserShell` directly could not see whether any
// screen is actually wrapped in it — which is the only thing this task does.
const SHELL_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/styles/shell.css",
);

describe("the organiser shell (D3)", () => {
  function renderOrganiser(overrides: Partial<ApiClient> = {}) {
    return render(<OrganiserApp client={fakeClient({ me: async () => ACTOR, ...overrides })} />);
  }

  /** Home has painted — the point every walk below starts from. */
  function signedIn(): Promise<HTMLElement> {
    return screen.findByRole("heading", { level: 1, name: "Placement cell" });
  }

  function nav(): HTMLElement {
    return screen.getByRole("navigation", { name: "Organiser" });
  }

  it("shows one persistent sidebar across Home, Banks and Tests", async () => {
    renderOrganiser();
    await signedIn();

    fireEvent.click(within(nav()).getByRole("button", { name: "Banks" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Banks" })).toBeVisible();
    expect(screen.getAllByRole("navigation", { name: "Organiser" })).toHaveLength(1);

    fireEvent.click(within(nav()).getByRole("button", { name: "Tests" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Tests" })).toBeVisible();
    expect(screen.getAllByRole("navigation", { name: "Organiser" })).toHaveLength(1);

    fireEvent.click(within(nav()).getByRole("button", { name: "Home" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Placement cell" })).toBeVisible();
    expect(screen.getAllByRole("navigation", { name: "Organiser" })).toHaveLength(1);
  });

  // D3: "you are here" is three signals, never hue alone. Two of them are in
  // the DOM and asserted here; the third — the heavier label — is a
  // font-weight that jsdom has no layout engine to compute, and it is
  // asserted against the shipped stylesheet in the test below this one.
  it("marks the current screen with aria-current and an accent bar, not with hue alone", async () => {
    renderOrganiser();
    await signedIn();

    const home = within(nav()).getByRole("button", { name: "Home" });
    const banks = within(nav()).getByRole("button", { name: "Banks" });

    expect(home).toHaveAttribute("aria-current", "page");
    expect(banks).not.toHaveAttribute("aria-current");
    expect(home.querySelector(".shell__nav-bar")).not.toBeNull();
    expect(banks.querySelector(".shell__nav-bar")).toBeNull();

    fireEvent.click(banks);
    await screen.findByRole("heading", { level: 1, name: "Banks" });
    expect(within(nav()).getByRole("button", { name: "Banks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav()).getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // Signal three of three. jsdom applies no external stylesheet, so this is
  // the one signal no amount of clicking can reach — and a comment claiming
  // it is covered is worse than no comment (fix round 1, finding 2). Read
  // out of the file that ships, with the parser the suite already owns, and
  // compared against the resting weight rather than against a literal: the
  // claim D3 makes is "heavier", not "600".
  it("gives the current rail item a heavier label than the resting one (D3)", () => {
    const rules = parseRuleBodies(readResolvedCss(SHELL_CSS_PATH));
    const weightOf = (selector: string): number => {
      const body = rules.find((rule) => rule.selector === selector)?.body;
      expect(body, `no rule for ${selector} in shell.css`).toBeDefined();
      const declared = declarations(body as string)
        .find((decl) => /^font-weight\s*:/.test(decl))
        ?.split(":")[1]
        ?.trim();
      expect(declared, `no font-weight on ${selector}`).toBeDefined();
      const token = /^var\(--type-([a-z0-9-]+)-weight\)$/.exec(declared as string)?.[1];
      return token === undefined
        ? Number(declared)
        : (tokens.typography[token as TypographyName].fontWeight as number);
    };

    const resting = weightOf(".shell__nav-item");
    const here = weightOf('.shell__nav-item[aria-current="page"]');

    expect(resting).toBe(400);
    expect(here).toBeGreaterThan(resting);
  });

  // Fix round 1, finding 3. The browser renders no <h1> of its own — before
  // this, the one organiser screen whose document outline started at <h2>.
  it("gives the bank browser an <h1> carrying the bank's own name", async () => {
    const bank = {
      id: "bnk_1",
      name: "Reasoning aptitude",
      description: null,
      license: null,
      tags: [],
      questionCount: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    renderOrganiser({ listBanks: async () => [bank] });
    await signedIn();

    fireEvent.click(within(nav()).getByRole("button", { name: "Banks" }));
    fireEvent.click(await screen.findByRole("button", { name: /reasoning aptitude/i }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Reasoning aptitude" }),
    ).toBeVisible();
  });

  // `D18`: "Bank browser opens with the rail collapsed. Browsing is where the
  // page wants width; the toggle still restores it." Both halves, because
  // neither works alone — `AG1`'s density gate measured the rail collapse as
  // worth exactly nothing while the page was still clamped at 1080px (the
  // grid track goes 1204px -> 1384px and both are over the clamp), and the
  // row stayed wrapped at 145px against `main`'s 101px.
  //
  // The clamp half is asserted as an invariant rather than exercised (`AG3`):
  // jsdom has no layout, so the width this buys is measured by
  // `e2e/measurement/density.spec.ts` in a real browser instead.
  it("opens the bank browser unclamped and with the rail collapsed", async () => {
    const bank = {
      id: "bnk_1",
      name: "Reasoning aptitude",
      description: null,
      license: null,
      tags: [],
      questionCount: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    renderOrganiser({ listBanks: async () => [bank] });
    await signedIn();

    const toggle = screen.getByRole("button", { name: /navigation/i });
    fireEvent.click(within(nav()).getByRole("button", { name: "Banks" }));
    await screen.findByRole("heading", { level: 1, name: "Banks" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("#main-content")).toHaveClass("organiser--wide");

    fireEvent.click(await screen.findByRole("button", { name: /reasoning aptitude/i }));
    await screen.findByRole("heading", { level: 1, name: "Reasoning aptitude" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("#main-content")).toHaveClass("organiser--full");
    expect(document.querySelector("#main-content")).not.toHaveClass("organiser--wide");

    // Leaving puts both back: the collapse is this screen's default, not a
    // state the reader is left holding.
    fireEvent.click(within(nav()).getByRole("button", { name: "Banks" }));
    await screen.findByRole("heading", { level: 1, name: "Banks" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("#main-content")).toHaveClass("organiser--wide");
  });

  // ...and a deep link, which has no list behind it to carry a name, still
  // starts the page at <h1> rather than at the passage-groups <h2>.
  it("still starts the bank browser at <h1> when it is deep-linked", async () => {
    window.history.replaceState(null, "", "/?view=bank&bank=bnk_1");
    try {
      renderOrganiser();
      expect(await screen.findByRole("heading", { level: 1, name: "Bank" })).toBeVisible();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("does not render the sidebar on sign-in", async () => {
    render(<OrganiserApp client={fakeClient({ me: async () => null })} />);

    await screen.findByRole("heading", { level: 1, name: /sign in/i });
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
  });

  it("does not render the sidebar during the first-run wizard", async () => {
    renderOrganiser({ setupStatus: async () => ({ needed: true, providers: [GOOGLE] }) });

    await screen.findByLabelText(/workspace name/i);
    expect(screen.queryByRole("navigation", { name: "Organiser" })).toBeNull();
  });

  it("omits Results and Grading entirely", async () => {
    renderOrganiser();
    await signedIn();

    expect(screen.queryByRole("button", { name: /results|grading/i })).toBeNull();
  });

  it("collapses the rail to icons and back, keeping every destination reachable", async () => {
    renderOrganiser();
    await signedIn();

    const toggle = screen.getByRole("button", { name: /navigation/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Collapsed is icons-only to the eye, never to a screen reader: the
    // destinations keep their names and stay clickable.
    fireEvent.click(within(nav()).getByRole("button", { name: "Tests" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Tests" })).toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("carries the workspace, the signed-in address and sign-out in the top bar", async () => {
    const signOut = vi.fn(async () => undefined);
    renderOrganiser({ signOut });
    await signedIn();

    expect(screen.getByText("Placement cell", { selector: ".shell__workspace" })).toBeVisible();
    expect(screen.getByText(ACTOR.email)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("has no axe violations with a screen inside the shell", async () => {
    const { container } = renderOrganiser();
    await signedIn();

    expect(await axe(container)).toHaveNoViolations();
  });
});

// ---------------------------------------------------------------------------
// Phase 6.5c Task 4 (#181, D4/D4a/D4b): the top bar always names the
// workspace; it becomes a *switcher* only above one membership, and a switch
// resets the view to `?view=home`.
//
// D4a is the half no prototype can show and the half that ships broken:
// under D5 the view lives in the query string as `?view=test&test=tst_8c21a4`,
// so a switch that keeps that string asks workspace B for a test id belonging
// to workspace A. AG3: asserted by switching with a test id in the URL, never
// by reading the reducer.
const NORTHFIELD: Workspace = { id: "wsp_2", name: "Northfield" };

const TWO_MEMBERSHIPS: Actor = {
  ...ACTOR,
  memberships: [
    { workspaceId: "wsp_1", role: "owner", grants: [] },
    { workspaceId: "wsp_2", role: "owner", grants: [] },
  ],
};

const MIDTERM = {
  id: "tst_8c21a4",
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

const MIDTERM_DRAFT = {
  id: "ver_1",
  testId: "tst_8c21a4",
  version: 1,
  body: { settings: {}, sections: [] },
  publishedAt: null,
  createdAt: 0,
  draw: {},
  setPoints: {},
  points: {},
};

describe("the workspace switcher (D4, D4a, D4b)", () => {
  function switcher(): HTMLElement {
    return screen.getByRole("combobox", { name: /workspace/i });
  }

  it("names the workspace and offers no switcher at one membership", async () => {
    render(<OrganiserApp client={fakeClient({ me: async () => ACTOR })} />);
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    expect(screen.getByText("Placement cell", { selector: ".shell__workspace" })).toBeVisible();
    expect(screen.queryByRole("combobox", { name: /workspace/i })).toBeNull();
  });

  it("becomes a switcher at two memberships", async () => {
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => TWO_MEMBERSHIPS,
          workspaces: async () => [WORKSPACE, NORTHFIELD],
        })}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    expect(await screen.findByRole("combobox", { name: /workspace/i })).toBeVisible();
    expect(switcher()).toHaveValue("wsp_1");
  });

  it("clears every id-bearing parameter when the workspace changes", async () => {
    window.history.replaceState(null, "", "/?view=test&test=tst_8c21a4&panel=timing");
    try {
      render(
        <OrganiserApp
          client={fakeClient({
            me: async () => TWO_MEMBERSHIPS,
            workspaces: async () => [WORKSPACE, NORTHFIELD],
            test: async () => MIDTERM,
            draft: async () => MIDTERM_DRAFT,
          })}
        />,
      );
      await screen.findByRole("heading", { level: 1, name: "Midterm" });

      fireEvent.change(switcher(), { target: { value: "wsp_2" } });

      expect(await screen.findByRole("heading", { level: 1, name: "Northfield" })).toBeVisible();
      expect(window.location.search).toBe("?view=home");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  // The assertion that matters: not that the URL is tidy, but that no call
  // carrying workspace A's test id is ever sent to workspace B.
  //
  // Walked rather than deep-linked, so there is real history behind the
  // builder, and the walk ends on a Back press — because the entry a switch
  // leaves behind is itself a loaded gun. `popstate` rebuilds the view from
  // the URL against whatever workspace is CURRENT, so an entry naming
  // workspace A's test, one press away from workspace B, is the same
  // cross-tenant read by a slower route.
  it("replaces the entry naming the old workspace's test, so Back cannot reopen it", async () => {
    const carrying: string[] = [];
    const record = (workspaceId: string, testId: string) => {
      if (testId === "tst_8c21a4") carrying.push(workspaceId);
      // What the server does with a stale entry, stood up here so the web
      // side asserts the boundary rather than assuming it (whole-branch
      // review, Minor 5). `membershipOr404` in apps/api resolves membership
      // from the path parameter, so a test id belonging to workspace A is
      // NOT FOUND in workspace B — a refusal, never a cross-tenant read.
      if (testId === "tst_8c21a4" && workspaceId !== "wsp_1") {
        throw new ApiError(404, "not_found", "That test could not be found in this workspace.");
      }
    };
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => TWO_MEMBERSHIPS,
          workspaces: async () => [WORKSPACE, NORTHFIELD],
          tests: async () => [MIDTERM],
          test: async (workspaceId, testId) => {
            record(workspaceId, testId);
            return MIDTERM;
          },
          draft: async (workspaceId, testId) => {
            record(workspaceId, testId);
            return MIDTERM_DRAFT;
          },
          versions: async (workspaceId, testId) => {
            record(workspaceId, testId);
            return [];
          },
          checklist: async (workspaceId, testId) => {
            record(workspaceId, testId);
            return [];
          },
          candidates: async (workspaceId, testId) => {
            record(workspaceId, testId);
            return [];
          },
        })}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
    await screen.findByRole("heading", { level: 1, name: "Midterm" });
    expect(carrying).not.toHaveLength(0);

    fireEvent.change(switcher(), { target: { value: "wsp_2" } });
    expect(await screen.findByRole("heading", { level: 1, name: "Northfield" })).toBeVisible();

    // The builder's own entry is the one `resetViewForWorkspace` replaced,
    // so Back skips straight past it to the list. Under `pushState` this
    // press lands on `?view=test&test=tst_8c21a4` instead and the builder
    // remounts under workspace B, which is how this assertion discriminates.
    window.history.back();
    expect(await screen.findByRole("heading", { level: 1, name: "Tests" })).toBeVisible();

    expect(carrying.filter((id) => id !== "wsp_1")).toEqual([]);
  });

  // The boundary the test above does NOT cover, asserted rather than left in
  // a report's concerns list (whole-branch review, Minor 5).
  // `resetViewForWorkspace` replaces ONE entry — the one you switched from.
  // Navigate on after opening a test and the builder's entry is no longer
  // the current one, so the switch cannot reach it, and Back walks into a
  // URL still naming workspace A's test under workspace B.
  //
  // The request is therefore made. That is the honest shape, and it is why
  // neither test here is named "never": what closes it is the server.
  // `membershipOr404` resolves membership from the path parameter, so
  // workspace A's test id is NOT FOUND in workspace B — a refusal, never a
  // cross-tenant read — and the builder shows the refusal in place of the
  // test. `fromUrl`'s standing answer, exercised: an id in a URL is a claim,
  // and the screen's own fetch is the side that decides.
  it("refuses, rather than serves, a stale entry Back reaches from deeper in the stack", async () => {
    const carrying: string[] = [];
    const refuseAcrossWorkspaces = (workspaceId: string, testId: string) => {
      if (testId !== "tst_8c21a4") return;
      carrying.push(workspaceId);
      if (workspaceId !== "wsp_1") {
        throw new ApiError(404, "not_found", "That test could not be found in this workspace.");
      }
    };
    render(
      <OrganiserApp
        client={fakeClient({
          me: async () => TWO_MEMBERSHIPS,
          workspaces: async () => [WORKSPACE, NORTHFIELD],
          tests: async () => [MIDTERM],
          test: async (workspaceId, testId) => {
            refuseAcrossWorkspaces(workspaceId, testId);
            return MIDTERM;
          },
          draft: async (workspaceId, testId) => {
            refuseAcrossWorkspaces(workspaceId, testId);
            return MIDTERM_DRAFT;
          },
        })}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    // Tests -> the builder -> Banks. The builder's entry is now behind the
    // current one, which is the entry the switch will replace.
    fireEvent.click(await screen.findByRole("button", { name: "Tests" }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));
    await screen.findByRole("heading", { level: 1, name: "Midterm" });
    fireEvent.click(screen.getByRole("button", { name: "Banks" }));
    await screen.findByRole("heading", { level: 1, name: "Banks" });

    fireEvent.change(switcher(), { target: { value: "wsp_2" } });
    await screen.findByRole("heading", { level: 1, name: "Northfield" });
    expect(carrying.filter((id) => id !== "wsp_1")).toEqual([]);

    window.history.back();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be found in this workspace/i,
    );
    expect(screen.queryByRole("heading", { level: 1, name: "Midterm" })).toBeNull();
    expect(carrying).toContain("wsp_2");
  });

  // D4b's whole argument is that a native <select> carries an accessible
  // name for free — so the shape that can lose it is the one worth an axe
  // pass. The existing shell axe test renders one membership and therefore
  // never sees this control at all.
  it("has no axe violations with the switcher rendered", async () => {
    const { container } = render(
      <OrganiserApp
        client={fakeClient({
          me: async () => TWO_MEMBERSHIPS,
          workspaces: async () => [WORKSPACE, NORTHFIELD],
        })}
      />,
    );
    await screen.findByRole("heading", { level: 1, name: "Placement cell" });

    expect(await axe(container)).toHaveNoViolations();
  });

  // D3a takes the rail out of the grid below 719px. It does not say
  // navigation disappears — and before this task only the wordmark was wired
  // to Home, so Banks and Tests were unreachable on a phone. The rail becomes
  // a horizontal strip at that width: the same <nav>, the same items, the
  // same aria-current, no second construct to keep in step. The clicking
  // half of this is already proved above ("shows one persistent sidebar");
  // the half jsdom cannot reach is the media query, which has no layout
  // engine to evaluate it — so the INVARIANT is asserted instead (AG3):
  // nothing inside the narrow block takes the nav, its items or their labels
  // off the screen.
  it("does not hide the Organiser nav below 719px (D3a)", () => {
    const css = readResolvedCss(SHELL_CSS_PATH);
    const start = css.indexOf("@media (max-width: 719px)");
    expect(start, "shell.css has no 719px block").toBeGreaterThan(-1);
    const open = css.indexOf("{", start);
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    const narrow = parseRuleBodies(css.slice(open + 1, i - 1));

    const hidden = narrow
      .filter((rule) => /shell__(rail|nav)/.test(rule.selector))
      .filter((rule) =>
        declarations(rule.body).some((decl) =>
          /^(display\s*:\s*none|visibility\s*:\s*hidden|clip\s*:\s*rect)/.test(decl),
        ),
      )
      .map((rule) => rule.selector);

    expect(hidden).toEqual([]);
  });
});
