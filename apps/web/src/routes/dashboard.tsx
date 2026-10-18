import { useState } from "react";
import { CardHairline } from "../components/CardHairline";
import { MonoCaption } from "../components/MonoCaption";
import type { Actor, Workspace } from "../lib/api";

// Screen 3 of 3: the workspace dashboard, which in Phase 3 is always empty
// — nothing can author a test until Phase 5.
//
// docs/design.md UX-11 ("the publish boundary is shown, not discovered")
// is the one decision in that document that reaches this screen, and the
// dashboard is the earliest place to honour it: the role you hold is
// stated on arrival, beside the workspace name, rather than being
// discovered at the moment an action is refused.

export function Dashboard({
  actor,
  workspace,
  onSignOut,
}: {
  actor: Actor;
  workspace: Workspace;
  onSignOut: () => void;
}) {
  const [noted, setNoted] = useState(false);
  const role = actor.memberships.find(
    (membership) => membership.workspaceId === workspace.id,
  )?.role;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="organiser-bar">
        <p className="organiser-bar__mark">Pariksha</p>
        <div className="organiser-bar__actions">
          <MonoCaption>{actor.email}</MonoCaption>
          <button
            type="button"
            className="button-secondary"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      </header>

      <main id="main-content" className="organiser organiser--wide">
        <MonoCaption>
          {role === undefined ? "Workspace" : `Workspace · ${role}`}
        </MonoCaption>
        <h1 className="organiser__title">{workspace.name}</h1>

        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">No tests yet</h2>
          <p className="organiser-empty__body">
            Nothing has been authored in this workspace. A test begins as a
            draft you can edit freely, and only becomes visible to candidates
            when it is published.
          </p>
          {/* ponytail: the one next action, with nowhere to go until the
              authoring screens land in Phases 4 and 5 (docs/design.md's
              screen inventory, rows 1-12). Saying so is better than a
              disabled button or a link to a 404; swap the handler for the
              real route when that screen exists. */}
          <button
            type="button"
            className="button-primary button-primary--surface"
            onClick={() => setNoted(true)}
          >
            Create your first test
          </button>
          {noted && (
            <p className="organiser__status" role="status">
              Test authoring is not built yet — it arrives with the question
              bank. This instance is ready for it.
            </p>
          )}
        </CardHairline>
      </main>
    </>
  );
}
