import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  type ApiClient,
  type Role,
  type Team,
  type TeamGrant,
} from "../../lib/api";
import { useDialogKeys } from "../useDialogKeys";
import { Icon } from "../OrganiserShell";

export interface CollaboratorsDrawerProps {
  client: ApiClient;
  workspaceId: string;
  resourceType: "test" | "bank";
  resourceId: string;
  resourceName?: string;
  onClose: () => void;
}

const COLLABORATOR_ROLES: readonly { role: Role; label: string; description: string }[] = [
  { role: "author", label: "Author", description: "Edit questions and content" },
  { role: "reviewer", label: "Reviewer", description: "Review drafts and questions" },
  { role: "proctor", label: "Proctor", description: "Monitor attempts and evidence" },
];

export function CollaboratorsDrawer({
  client,
  workspaceId,
  resourceType,
  resourceId,
  resourceName,
  onClose,
}: CollaboratorsDrawerProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [assignedGrants, setAssignedGrants] = useState<Array<{ grant: TeamGrant; team: Team }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [selectedRole, setSelectedRole] = useState<Role>("author");
  const [assigning, setAssigning] = useState(false);
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);

  const dialog = useDialogKeys<HTMLDivElement>(true, onClose, { trapTab: true });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { teams: allTeams } = await client.listTeams(workspaceId);
      setTeams(allTeams);

      const results = await Promise.all(
        allTeams.map(async (team) => {
          try {
            const { grants } = await client.listTeamGrants(workspaceId, team.id);
            return grants
              .filter((g) => g.resourceType === resourceType && g.resourceId === resourceId)
              .map((g) => ({ grant: g, team }));
          } catch {
            return [];
          }
        }),
      );
      setAssignedGrants(results.flat());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to load collaborators.");
    } finally {
      setLoading(false);
    }
  }, [client, workspaceId, resourceType, resourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAssign(event: FormEvent) {
    event.preventDefault();
    if (!selectedTeamId) return;

    setAssigning(true);
    setError(undefined);
    try {
      await client.grantTeamResource(workspaceId, selectedTeamId, {
        resourceType,
        resourceId,
        role: selectedRole,
      });
      setSelectedTeamId("");
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to assign team.");
    } finally {
      setAssigning(false);
    }
  }

  async function handleRevoke(teamId: string, grantId: string) {
    if (busyGrantId !== null) return;
    setBusyGrantId(grantId);
    try {
      await client.revokeTeamResource(workspaceId, teamId, grantId);
      await load();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Failed to revoke collaborator grant.");
    } finally {
      setBusyGrantId(null);
    }
  }

  const assignedTeamIds = new Set(assignedGrants.map((ag) => ag.team.id));
  const unassignedTeams = teams.filter((t) => !assignedTeamIds.has(t.id));

  return (
    <div className="bank-confirm" onClick={onClose}>
      <div
        className="card-hairline bank-confirm__dialog collaborators-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaborators-heading"
        ref={dialog.dialogRef}
        tabIndex={-1}
        onKeyDown={dialog.onKeyDown}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="byok-card__header">
          <div>
            <h2 id="collaborators-heading" className="bank-confirm__title">
              Collaborators
            </h2>
            {resourceName && <p className="release-panel__fact">{resourceName}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close collaborators drawer"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="release-panel__risk" role="alert">
            <Icon name="warn" />
            {error}
          </p>
        )}

        <div className="team-details__section">
          <h4>Assigned teams ({assignedGrants.length})</h4>
          {loading ? (
            <p className="release-panel__fact">Loading collaborators…</p>
          ) : assignedGrants.length === 0 ? (
            <p className="release-panel__fact">
              No teams assigned yet. Assign a team below to grant collaborative access.
            </p>
          ) : (
            <div className="table-scroll">
              <table className="teams-table">
                <thead>
                  <tr>
                    <th scope="col">Team</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="acts">
                      <span className="screen-reader-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {assignedGrants.map(({ grant, team }) => (
                    <tr key={grant.id}>
                      <td>{team.name}</td>
                      <td>
                        <span className="team-role-badge">{grant.role}</span>
                      </td>
                      <td className="acts">
                        <button
                          type="button"
                          className="button-secondary"
                          disabled={busyGrantId === grant.id}
                          onClick={() => void handleRevoke(team.id, grant.id)}
                          aria-label={`Revoke access for ${team.name}`}
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

        <div className="team-details__section">
          <h4>Assign team</h4>
          {teams.length === 0 && !loading ? (
            <p className="release-panel__fact">
              No teams exist in this workspace. Create a team in Teams navigation first.
            </p>
          ) : unassignedTeams.length === 0 && !loading ? (
            <p className="release-panel__fact">All teams in this workspace are already assigned.</p>
          ) : (
            <form className="organiser-form" onSubmit={(e) => void handleAssign(e)} noValidate>
              <div className="field">
                <label className="field-label" htmlFor="collaborator-team-select">
                  Team
                </label>
                <select
                  id="collaborator-team-select"
                  className="text-input"
                  value={selectedTeamId}
                  onChange={(e) => setSelectedTeamId(e.target.value)}
                >
                  <option value="">Select a team…</option>
                  {unassignedTeams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="collaborator-role-select">
                  Role
                </label>
                <select
                  id="collaborator-role-select"
                  className="text-input"
                  value={selectedRole}
                  onChange={(e) => setSelectedRole(e.target.value as Role)}
                >
                  {COLLABORATOR_ROLES.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label} — {r.description}
                    </option>
                  ))}
                </select>
              </div>

              <div className="button-row">
                <button
                  type="submit"
                  className="button-primary button-primary--surface"
                  disabled={assigning || !selectedTeamId}
                >
                  Assign team
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
