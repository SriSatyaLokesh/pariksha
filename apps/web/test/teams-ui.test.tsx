import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Actor, ApiClient, Team, TeamGrant, TeamMember, Workspace } from "../src/lib/api";
import { fakeClient as sharedClient } from "./fixtures/api-client";
import { TeamsPanel } from "../src/components/organiser/TeamsPanel";
import { CollaboratorsDrawer } from "../src/components/organiser/CollaboratorsDrawer";
import { readView } from "../src/lib/view-url";

const WORKSPACE: Workspace = {
  id: "wsp_1",
  name: "Acme Assessments",
};

const ACTOR: Actor = {
  userId: "usr_owner",
  email: "owner@acme.com",
  memberships: [{ workspaceId: "wsp_1", role: "owner", grants: [] }],
};

const TEAM_1: Team = {
  id: "team_1",
  workspaceId: "wsp_1",
  name: "Engineering Authors",
  description: "Core authoring team for engineering questions",
  createdAt: 1000,
};

const TEAM_2: Team = {
  id: "team_2",
  workspaceId: "wsp_1",
  name: "QA Reviewers",
  description: "Reviewers team",
  createdAt: 2000,
};

const MEMBER_1: TeamMember = {
  teamId: "team_1",
  userId: "usr_alice",
  email: "alice@acme.com",
  createdAt: 1000,
};

const MEMBER_2: TeamMember = {
  teamId: "team_1",
  userId: "usr_bob",
  email: "bob@acme.com",
  createdAt: 1050,
};

const GRANT_1: TeamGrant = {
  id: "grant_1",
  workspaceId: "wsp_1",
  teamId: "team_1",
  resourceType: "test",
  resourceId: "tst_1",
  role: "author",
  createdAt: 1000,
};

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return sharedClient({
    listTeams: async () => ({ teams: [] }),
    listTeamMembers: async () => ({ members: [] }),
    listTeamGrants: async () => ({ grants: [] }),
    listWorkspaceMembers: async () => ({ members: [] }),
    createTeam: async () => ({ team: TEAM_1 }),
    deleteTeam: async () => undefined,
    addTeamMember: async () => undefined,
    removeTeamMember: async () => undefined,
    grantTeamResource: async () => ({ grant: GRANT_1 }),
    revokeTeamResource: async () => undefined,
    ...overrides,
  });
}

describe("Teams URL routing", () => {
  it("readView parses ?view=teams cleanly", () => {
    expect(readView("?view=teams")).toEqual({ view: "teams" });
  });
});

describe("TeamsPanel — listing & empty state", () => {
  it("shows empty state when no teams exist", async () => {
    render(
      <TeamsPanel
        client={fakeClient({ listTeams: async () => ({ teams: [] }) })}
        workspace={WORKSPACE}
        actor={ACTOR}
      />,
    );

    expect(await screen.findByText(/No teams yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a team" })).toBeInTheDocument();
  });

  it("lists existing teams with names, descriptions and member counts", async () => {
    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1, TEAM_2] }),
      listTeamMembers: async (_ws, teamId) => ({
        members: teamId === "team_1" ? [MEMBER_1, MEMBER_2] : [],
      }),
    });

    render(<TeamsPanel client={client} workspace={WORKSPACE} actor={ACTOR} />);

    expect(await screen.findByText(TEAM_1.name)).toBeInTheDocument();
    expect(screen.getByText(TEAM_2.name)).toBeInTheDocument();
    expect(screen.getByText(TEAM_1.description!)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});

describe("TeamsPanel — create team", () => {
  it("opens create modal, validates required name, and calls client.createTeam", async () => {
    const createTeam = vi.fn().mockResolvedValue({ team: TEAM_1 });
    const listTeams = vi
      .fn()
      .mockResolvedValueOnce({ teams: [] })
      .mockResolvedValueOnce({ teams: [TEAM_1] });

    const client = fakeClient({ listTeams, createTeam });

    render(<TeamsPanel client={client} workspace={WORKSPACE} actor={ACTOR} />);
    await screen.findByText(/No teams yet/);

    // Open modal via New team button
    fireEvent.click(screen.getByRole("button", { name: "New team" }));
    expect(await screen.findByRole("heading", { name: "Create a new team" })).toBeInTheDocument();

    // Submit empty should trigger validation
    fireEvent.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByText("A team requires a name.")).toBeInTheDocument();
    expect(createTeam).not.toHaveBeenCalled();

    // Fill in team name and description
    fireEvent.change(screen.getByLabelText(/Team name/), {
      target: { value: "Engineering Authors" },
    });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Core authoring team" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create team" }));

    await waitFor(() => {
      expect(createTeam).toHaveBeenCalledWith("wsp_1", {
        name: "Engineering Authors",
        description: "Core authoring team",
      });
    });
  });
});

describe("TeamsPanel — team details (members and grants)", () => {
  it("shows members and active resource grants when managing a team", async () => {
    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1] }),
      listTeamMembers: async () => ({ members: [MEMBER_1] }),
      listTeamGrants: async () => ({ grants: [GRANT_1] }),
    });

    render(<TeamsPanel client={client} workspace={WORKSPACE} actor={ACTOR} />);
    expect(await screen.findByText(TEAM_1.name)).toBeInTheDocument();

    // Click Manage to inspect team details
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));

    expect(await screen.findByText("Engineering Authors details")).toBeInTheDocument();
    expect(screen.getByText("alice@acme.com")).toBeInTheDocument();
    expect(screen.getByText("tst_1")).toBeInTheDocument();
    expect(screen.getByText("author")).toBeInTheDocument();
  });

  it("allows adding a member to the selected team", async () => {
    const addTeamMember = vi.fn().mockResolvedValue(undefined);
    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1] }),
      listTeamMembers: async () => ({ members: [MEMBER_1] }),
      listTeamGrants: async () => ({ grants: [] }),
      listWorkspaceMembers: async () => ({
        members: [
          { id: "mem_1", userId: "usr_alice", role: "author", email: "alice@acme.com" },
          { id: "mem_2", userId: "usr_bob", role: "author", email: "bob@acme.com" },
        ],
      }),
      addTeamMember,
    });

    render(<TeamsPanel client={client} workspace={WORKSPACE} actor={ACTOR} />);
    expect(await screen.findByText(TEAM_1.name)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText("Engineering Authors details")).toBeInTheDocument();

    // Select Bob from dropdown
    const select = await screen.findByLabelText(/Add workspace member/);
    fireEvent.change(select, { target: { value: "usr_bob" } });

    fireEvent.click(screen.getByRole("button", { name: "Add member" }));

    await waitFor(() => {
      expect(addTeamMember).toHaveBeenCalledWith("wsp_1", "team_1", "usr_bob");
    });
  });

  it("allows removing a member and revoking a grant", async () => {
    const removeTeamMember = vi.fn().mockResolvedValue(undefined);
    const revokeTeamResource = vi.fn().mockResolvedValue(undefined);

    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1] }),
      listTeamMembers: async () => ({ members: [MEMBER_1] }),
      listTeamGrants: async () => ({ grants: [GRANT_1] }),
      removeTeamMember,
      revokeTeamResource,
    });

    render(<TeamsPanel client={client} workspace={WORKSPACE} actor={ACTOR} />);
    expect(await screen.findByText(TEAM_1.name)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText("alice@acme.com")).toBeInTheDocument();

    // Remove member
    fireEvent.click(screen.getByLabelText("Remove alice@acme.com from team"));
    await waitFor(() => {
      expect(removeTeamMember).toHaveBeenCalledWith("wsp_1", "team_1", "usr_alice");
    });

    // Revoke grant
    fireEvent.click(screen.getByLabelText("Revoke grant for tst_1"));
    await waitFor(() => {
      expect(revokeTeamResource).toHaveBeenCalledWith("wsp_1", "team_1", "grant_1");
    });
  });

  it("deleting a team requires confirmation", async () => {
    const deleteTeam = vi.fn().mockResolvedValue(undefined);
    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1] }),
      deleteTeam,
    });

    render(<TeamsPanel client={client} workspace={WORKSPACE} actor={ACTOR} />);
    expect(await screen.findByText(TEAM_1.name)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(`Delete team ${TEAM_1.name}`));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      expect(deleteTeam).toHaveBeenCalledWith("wsp_1", "team_1");
    });
  });
});

describe("CollaboratorsDrawer", () => {
  it("renders active team grants for the specified resource", async () => {
    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1, TEAM_2] }),
      listTeamGrants: async (_ws, teamId) => ({
        grants: teamId === "team_1" ? [GRANT_1] : [],
      }),
    });

    render(
      <CollaboratorsDrawer
        client={client}
        workspaceId="wsp_1"
        resourceType="test"
        resourceId="tst_1"
        resourceName="Frontend Assessment"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Frontend Assessment")).toBeInTheDocument();
    expect(screen.getByText("Engineering Authors")).toBeInTheDocument();
    expect(screen.getByText("author")).toBeInTheDocument();
  });

  it("assigns an unassigned team with selected role", async () => {
    const grantTeamResource = vi.fn().mockResolvedValue({
      grant: {
        id: "grant_2",
        workspaceId: "wsp_1",
        teamId: "team_2",
        resourceType: "test",
        resourceId: "tst_1",
        role: "reviewer",
        createdAt: 2000,
      },
    });

    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1, TEAM_2] }),
      listTeamGrants: async (_ws, teamId) => ({
        grants: teamId === "team_1" ? [GRANT_1] : [],
      }),
      grantTeamResource,
    });

    render(
      <CollaboratorsDrawer
        client={client}
        workspaceId="wsp_1"
        resourceType="test"
        resourceId="tst_1"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Engineering Authors")).toBeInTheDocument();

    // Select team_2 in dropdown
    const teamSelect = screen.getByLabelText(/^Team$/);
    fireEvent.change(teamSelect, { target: { value: "team_2" } });

    // Select reviewer role
    const roleSelect = screen.getByLabelText(/^Role$/);
    fireEvent.change(roleSelect, { target: { value: "reviewer" } });

    fireEvent.click(screen.getByRole("button", { name: "Assign team" }));

    await waitFor(() => {
      expect(grantTeamResource).toHaveBeenCalledWith("wsp_1", "team_2", {
        resourceType: "test",
        resourceId: "tst_1",
        role: "reviewer",
      });
    });
  });

  it("revokes a team grant and closes on cancel", async () => {
    const revokeTeamResource = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const client = fakeClient({
      listTeams: async () => ({ teams: [TEAM_1] }),
      listTeamGrants: async () => ({ grants: [GRANT_1] }),
      revokeTeamResource,
    });

    render(
      <CollaboratorsDrawer
        client={client}
        workspaceId="wsp_1"
        resourceType="test"
        resourceId="tst_1"
        onClose={onClose}
      />,
    );

    expect(await screen.findByText("Engineering Authors")).toBeInTheDocument();

    // Revoke
    fireEvent.click(screen.getByRole("button", { name: `Revoke access for ${TEAM_1.name}` }));
    await waitFor(() => {
      expect(revokeTeamResource).toHaveBeenCalledWith("wsp_1", "team_1", "grant_1");
    });

    // Close
    fireEvent.click(screen.getByLabelText("Close collaborators drawer"));
    expect(onClose).toHaveBeenCalled();
  });
});
