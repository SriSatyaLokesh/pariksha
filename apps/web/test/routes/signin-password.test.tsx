import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignIn } from "../../src/routes/signin";
import type { ApiClient } from "../../src/lib/api";

function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    setupStatus: vi.fn(),
    me: vi.fn(),
    workspaces: vi.fn(),
    completeSetup: vi.fn(),
    requestMagicLink: vi.fn(),
    signOut: vi.fn(),
    listBanks: vi.fn(),
    createBank: vi.fn(),
    listQuestions: vi.fn(),
    deleteQuestion: vi.fn(),
    saveQuestion: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe("SignIn component with Password and TOTP (Phase 10)", () => {
  it("renders email and password inputs when password provider is configured", () => {
    const client = mockClient();
    render(
      <SignIn
        client={client}
        providers={[{ id: "password", kind: "password", label: "Email and password" }]}
        returnTo="/"
      />,
    );

    expect(screen.getByLabelText(/Email address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("submits password login and prompts for TOTP when totp_required is returned", async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ status: "totp_required" });
    const client = mockClient({ signInWithPassword });

    render(
      <SignIn
        client={client}
        providers={[{ id: "password", kind: "password", label: "Email and password" }]}
        returnTo="/admin"
      />,
    );

    fireEvent.change(screen.getByLabelText(/Email address/i), {
      target: { value: "admin@pariksha.org" },
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: "Secret12345!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(signInWithPassword).toHaveBeenCalledWith("admin@pariksha.org", "Secret12345!", undefined, "/admin");
      expect(screen.getByLabelText(/Two-factor verification code/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Verify & sign in/i })).toBeInTheDocument();
    });
  });

  it("allows switching to magic link if both are present", () => {
    const client = mockClient();
    render(
      <SignIn
        client={client}
        providers={[
          { id: "password", kind: "password", label: "Email and password" },
          { id: "magic-link", kind: "magic_link", label: "Email a link" },
        ]}
        returnTo="/"
      />,
    );

    const switchBtn = screen.getByRole("button", { name: /Email me a sign-in link instead/i });
    fireEvent.click(switchBtn);

    expect(screen.getByRole("button", { name: "Send me a sign-in link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with password instead/i })).toBeInTheDocument();
  });
});
