import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { axe } from "jest-axe";

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
import { SignIn } from "../src/routes/signin";
import { Setup } from "../src/routes/setup";
import { Dashboard } from "../src/routes/dashboard";

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
    ...overrides,
  };
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

describe("Dashboard", () => {
  it("names the workspace and offers a way into tests and banks", () => {
    render(
      <Dashboard
        actor={ACTOR}
        workspace={WORKSPACE}
        onSignOut={() => undefined}
        onOpenBanks={() => undefined}
        onOpenTests={() => undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Placement cell" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /tests/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /question banks/i })).toBeInTheDocument();
  });

  it("offers exactly one next action out of the empty state", () => {
    render(
      <Dashboard
        actor={ACTOR}
        workspace={WORKSPACE}
        onSignOut={() => undefined}
        onOpenBanks={() => undefined}
        onOpenTests={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: /create your first test/i }),
    ).toBeEnabled();
  });

  // docs/design.md UX-11: the publish boundary is shown, not discovered —
  // the role you hold is stated on the dashboard rather than found at the
  // moment an action is refused.
  it("states the role the signed-in actor holds in this workspace", () => {
    render(
      <Dashboard
        actor={{
          ...ACTOR,
          memberships: [{ workspaceId: "wsp_1", role: "author", grants: [] }],
        }}
        workspace={WORKSPACE}
        onSignOut={() => undefined}
        onOpenBanks={() => undefined}
        onOpenTests={() => undefined}
      />,
    );

    expect(screen.getByText("Workspace · author")).toBeInTheDocument();
  });

  it("signs out through the client", async () => {
    const onSignOut = vi.fn();
    render(
      <Dashboard actor={ACTOR} workspace={WORKSPACE} onSignOut={onSignOut} onOpenBanks={() => undefined} onOpenTests={() => undefined} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Dashboard
        actor={ACTOR}
        workspace={WORKSPACE}
        onSignOut={() => undefined}
        onOpenBanks={() => undefined}
        onOpenTests={() => undefined}
      />,
    );
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

    fireEvent.click(screen.getByRole("button", { name: "Question banks" }));
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

    fireEvent.click(screen.getByRole("button", { name: /create your first test/i }));

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

    fireEvent.click(screen.getByRole("button", { name: /create your first test/i }));
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

    fireEvent.click(await screen.findByRole("button", { name: /create your first test/i }));
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

    fireEvent.click(await screen.findByRole("button", { name: /create your first test/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Midterm" }));

    expect(await screen.findByRole("heading", { name: "Registration form" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/field type/i), { target: { value: "email" } });
    fireEvent.click(screen.getByRole("button", { name: /add field/i }));

    // The preview is the candidate renderer, mounted by the running app.
    expect(
      within(screen.getByRole("region", { name: /preview/i })).getByLabelText(/^Email/),
    ).toBeInTheDocument();

    // The shell debounces at 250 ms (apps/web/src/routes/test.tsx).
    await waitFor(() => expect(patchDraft).toHaveBeenCalled(), { timeout: 2000 });
    expect(patchDraft.mock.calls[0]).toEqual([
      "wsp_1",
      "tst_1",
      { settings: { registration_form: { fields: [{ id: "email", type: "email", label: "Email" }] } } },
    ]);
  });
});
