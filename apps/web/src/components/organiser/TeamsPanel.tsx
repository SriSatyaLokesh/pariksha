import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  type Actor,
  type ApiClient,
  type Team,
  type TeamGrant,
  type TeamMember,
  type Workspace,
} from "../../lib/api";
import { CardHairline } from "../CardHairline";
import { TextField } from "../TextField";
import { useDialogKeys } from "../useDialogKeys";
import { Icon } from "../OrganiserShell";

export interface TeamsPanelProps {
  client: ApiClient;
  workspace: Workspace;
  actor: Actor;
}

export function TeamsPanel({ client, workspace }: TeamsPanelProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState<string | undefined>(undefined);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMember[]>>({});
  const [teamGrants, setTeamGrants] = useState<Record<string, TeamGrant[]>>({});
  const [workspaceMembers, setWorkspaceMembers] = useState<
    Array<{ id: string; userId: string; role: string; email?: string }>
  >([]);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createNameError, setCreateNameError] = useState<string | undefined>(undefined);
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [createBusy, setCreateBusy] = useState(false);

  // Add member state
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addMemberError, setAddMemberError] = useState<string | undefined>(undefined);
  const [addMemberBusy, setAddMemberBusy] = useState(false);

  // Row busy states
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyTeamId, setBusyTeamId] = useState<string | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);

  const createDialog = useDialogKeys<HTMLDivElement>(showCreate, () => setShowCreate(false), {
    trapTab: true,
  });

  const loadTeamDetails = useCallback(
    async (teamId: string) => {
      try {
        const [mRes, gRes] = await Promise.all([
          client.listTeamMembers(workspace.id, teamId),
          client.listTeamGrants(workspace.id, teamId),
        ]);
        setTeamMembers((prev) => ({ ...prev, [teamId]: mRes.members }));
        setTeamGrants((prev) => ({ ...prev, [teamId]: gRes.grants }));
      } catch (cause) {
        setPanelError(cause instanceof ApiError ? cause.message : "Failed to load team details.");
      }
    },
    [client, workspace.id],
  );

  const loadTeams = useCallback(async () => {
    try {
      const res = await client.listTeams(workspace.id);
      setTeams(res.teams);
      if (res.teams.length > 0) {
        // Load member counts for table
        const membersMap: Record<string, TeamMember[]> = {};
        await Promise.all(
          res.teams.map(async (t) => {
            try {
              const m = await client.listTeamMembers(workspace.id, t.id);
              membersMap[t.id] = m.members;
            } catch {
              membersMap[t.id] = [];
            }
          }),
        );
        setTeamMembers(membersMap);
      }
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "Failed to load teams.");
    } finally {
      setLoading(false);
    }
  }, [client, workspace.id]);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (selectedTeamId !== null) {
      void loadTeamDetails(selectedTeamId);
    }
  }, [selectedTeamId, loadTeamDetails]);

  useEffect(() => {
    if (client.listWorkspaceMembers) {
      client.listWorkspaceMembers(workspace.id).then(
        (res) => setWorkspaceMembers(res.members),
        () => {},
      );
    }
  }, [client, workspace.id]);

  function toggleSelectTeam(teamId: string) {
    if (selectedTeamId === teamId) {
      setSelectedTeamId(null);
    } else {
      setSelectedTeamId(teamId);
      setSelectedUserId("");
      setAddMemberError(undefined);
    }
  }

  async function handleCreateTeam(event: FormEvent) {
    event.preventDefault();
    setCreateNameError(undefined);
    setCreateError(undefined);

    const name = createName.trim();
    if (name.length === 0) {
      setCreateNameError("A team requires a name.");
      return;
    }

    setCreateBusy(true);
    try {
      const res = await client.createTeam(workspace.id, {
        name,
        description: createDescription.trim() || null,
      });
      setShowCreate(false);
      setCreateName("");
      setCreateDescription("");
      await loadTeams();
      setSelectedTeamId(res.team.id);
    } catch (cause) {
      setCreateError(cause instanceof ApiError ? cause.message : "Failed to create team. Try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleDeleteTeam(teamId: string) {
    if (busyTeamId !== null) return;
    setBusyTeamId(teamId);
    try {
      await client.deleteTeam(workspace.id, teamId);
      setConfirmDeleteId(null);
      if (selectedTeamId === teamId) {
        setSelectedTeamId(null);
      }
      await loadTeams();
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "Failed to delete team.");
    } finally {
      setBusyTeamId(null);
    }
  }

  async function handleAddMember(event: FormEvent) {
    event.preventDefault();
    if (!selectedTeamId) return;
    const userId = selectedUserId.trim();
    if (!userId) {
      setAddMemberError("Select or enter a member user ID.");
      return;
    }

    setAddMemberBusy(true);
    setAddMemberError(undefined);
    try {
      await client.addTeamMember(workspace.id, selectedTeamId, userId);
      setSelectedUserId("");
      await loadTeamDetails(selectedTeamId);
    } catch (cause) {
      setAddMemberError(cause instanceof ApiError ? cause.message : "Failed to add member to team.");
    } finally {
      setAddMemberBusy(false);
    }
  }

  async function handleRemoveMember(teamId: string, userId: string) {
    if (busyMemberId !== null) return;
    setBusyMemberId(userId);
    try {
      await client.removeTeamMember(workspace.id, teamId, userId);
      await loadTeamDetails(teamId);
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "Failed to remove member.");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function handleRevokeGrant(teamId: string, grantId: string) {
    if (busyGrantId !== null) return;
    setBusyGrantId(grantId);
    try {
      await client.revokeTeamResource(workspace.id, teamId, grantId);
      await loadTeamDetails(teamId);
    } catch (cause) {
      setPanelError(cause instanceof ApiError ? cause.message : "Failed to revoke grant.");
    } finally {
      setBusyGrantId(null);
    }
  }

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);
  const currentMembers = selectedTeamId ? (teamMembers[selectedTeamId] ?? []) : [];
  const currentGrants = selectedTeamId ? (teamGrants[selectedTeamId] ?? []) : [];

  const existingUserIds = new Set(currentMembers.map((m) => m.userId));
  const availableWorkspaceMembers = workspaceMembers.filter((wm) => !existingUserIds.has(wm.userId));

  return (
    <>
      <div className="teams-bar">
        <button
          type="button"
          className="button-primary button-primary--surface"
          onClick={() => {
            setCreateName("");
            setCreateDescription("");
            setCreateNameError(undefined);
            setCreateError(undefined);
            setShowCreate(true);
          }}
        >
          New team
        </button>
      </div>

      {panelError && (
        <p className="release-panel__risk" role="alert">
          <Icon name="warn" />
          {panelError}
        </p>
      )}

      {loading ? (
        <p className="release-panel__fact">Loading teams…</p>
      ) : teams.length === 0 ? (
        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No teams yet</h2>
          <p className="organiser-empty__body">
            Group workspace members into teams to grant collaborative access to tests and question banks.
          </p>
          <button
            type="button"
            className="button-primary button-primary--surface"
            onClick={() => setShowCreate(true)}
          >
            Create a team
          </button>
        </CardHairline>
      ) : (
        <div className="organiser__panel">
          <div className="table-scroll">
            <table className="teams-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Description</th>
                  <th scope="col">Members</th>
                  <th scope="col" className="acts">
                    <span className="screen-reader-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const count = (teamMembers[team.id] ?? []).length;
                  const isSelected = selectedTeamId === team.id;
                  return (
                    <tr key={team.id}>
                      <td>
                        <button
                          type="button"
                          className="button-link"
                          onClick={() => toggleSelectTeam(team.id)}
                          aria-expanded={isSelected}
                        >
                          {team.name}
                        </button>
                      </td>
                      <td>{team.description || "—"}</td>
                      <td className="teams-table-num">{count}</td>
                      <td className="acts">
                        <div className="button-row">
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => toggleSelectTeam(team.id)}
                          >
                            {isSelected ? "Hide" : "Manage"}
                          </button>
                          {confirmDeleteId === team.id ? (
                            <>
                              <button
                                type="button"
                                className="button-danger"
                                disabled={busyTeamId === team.id}
                                onClick={() => void handleDeleteTeam(team.id)}
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                className="button-secondary"
                                onClick={() => setConfirmDeleteId(null)}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="button-secondary"
                              disabled={busyTeamId === team.id}
                              onClick={() => setConfirmDeleteId(team.id)}
                              aria-label={`Delete team ${team.name}`}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedTeam && (
            <CardHairline className="release-panel__group team-details-panel">
              <div className="team-details__header">
                <h3>{selectedTeam.name} details</h3>
                {selectedTeam.description && (
                  <p className="release-panel__fact">{selectedTeam.description}</p>
                )}
              </div>

              <div className="team-details__section">
                <h4>Team members ({currentMembers.length})</h4>
                {currentMembers.length === 0 ? (
                  <p className="release-panel__fact">No members in this team yet.</p>
                ) : (
                  <ul className="team-members-list">
                    {currentMembers.map((m) => (
                      <li key={m.userId} className="team-member-item">
                        <span className="team-member-name">{m.email ?? m.userId}</span>
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={busyMemberId === m.userId}
                          onClick={() => void handleRemoveMember(selectedTeam.id, m.userId)}
                          aria-label={`Remove ${m.email ?? m.userId} from team`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <form className="team-add-member-form" onSubmit={(e) => void handleAddMember(e)} noValidate>
                  {workspaceMembers.length > 0 ? (
                    <div className="field">
                      <label className="field-label" htmlFor="select-workspace-member">
                        Add workspace member
                      </label>
                      <select
                        id="select-workspace-member"
                        className="text-input"
                        value={selectedUserId}
                        onChange={(e) => setSelectedUserId(e.target.value)}
                      >
                        <option value="">Select a member…</option>
                        {availableWorkspaceMembers.map((wm) => (
                          <option key={wm.userId} value={wm.userId}>
                            {wm.email ?? wm.userId} ({wm.role})
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <TextField
                      id="add-member-user-id"
                      label="Add member by user ID"
                      help="User ID of the workspace member to add (e.g. usr_123)."
                      value={selectedUserId}
                      onChange={setSelectedUserId}
                    />
                  )}
                  <button
                    type="submit"
                    className="button-secondary"
                    disabled={addMemberBusy || !selectedUserId.trim()}
                  >
                    Add member
                  </button>
                  {addMemberError && (
                    <p className="release-panel__risk" role="alert">
                      <Icon name="warn" />
                      {addMemberError}
                    </p>
                  )}
                </form>
              </div>

              <div className="team-details__section">
                <h4>Resource grants ({currentGrants.length})</h4>
                {currentGrants.length === 0 ? (
                  <p className="release-panel__fact">
                    No resources granted to this team yet. Use Collaborators in Test Builder or Question Bank to
                    assign access.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table className="teams-table">
                      <thead>
                        <tr>
                          <th scope="col">Resource</th>
                          <th scope="col">ID</th>
                          <th scope="col">Role</th>
                          <th scope="col" className="acts">
                            <span className="screen-reader-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentGrants.map((g) => (
                          <tr key={g.id}>
                            <td>
                              {g.resourceType === "test" ? "Test" : "Bank"}
                            </td>
                            <td>
                              <code>{g.resourceId}</code>
                            </td>
                            <td>
                              <span className="team-role-badge">{g.role}</span>
                            </td>
                            <td className="acts">
                              <button
                                type="button"
                                className="button-secondary"
                                disabled={busyGrantId === g.id}
                                onClick={() => void handleRevokeGrant(selectedTeam.id, g.id)}
                                aria-label={`Revoke grant for ${g.resourceId}`}
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </CardHairline>
          )}
        </div>
      )}

      {showCreate && (
        <div className="bank-confirm" onClick={() => setShowCreate(false)}>
          <div
            className="card-hairline bank-confirm__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-team-title"
            ref={createDialog.dialogRef}
            tabIndex={-1}
            onKeyDown={createDialog.onKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="create-team-title" className="bank-confirm__title">
              Create a new team
            </h2>
            <form className="organiser-form" onSubmit={(e) => void handleCreateTeam(e)} noValidate>
              <TextField
                id="create-team-name"
                label="Team name"
                help="A name you'll recognise later — e.g. Mathematics Authors, QA Reviewers."
                error={createNameError}
                value={createName}
                onChange={setCreateName}
              />
              <TextField
                id="create-team-description"
                label="Description"
                help="Optional description of this team."
                value={createDescription}
                onChange={setCreateDescription}
              />
              {createError && (
                <p className="release-panel__risk" role="alert">
                  <Icon name="warn" />
                  {createError}
                </p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button-primary button-primary--surface"
                  disabled={createBusy}
                >
                  Create team
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
