import { CardHairline } from "../components/CardHairline";
import { MonoCaption } from "../components/MonoCaption";
import { OrganiserHeader } from "../components/OrganiserHeader";
import type { Actor, Workspace } from "../lib/api";

// Screen 3 of 3: the workspace dashboard. Phase 4 gave question banks a real
// entry point here; Phase 5 Task 2 does the same for tests — "Create your
// first test" now opens the real test list (apps/web/src/routes/tests.tsx),
// not a placeholder notice.
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
  onOpenBanks,
  onOpenTests,
}: {
  actor: Actor;
  workspace: Workspace;
  onSignOut: () => void;
  onOpenBanks: () => void;
  onOpenTests: () => void;
}) {
  const role = actor.memberships.find(
    (membership) => membership.workspaceId === workspace.id,
  )?.role;

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actor.email} onSignOut={onSignOut} />

      <main id="main-content" className="organiser organiser--wide">
        <MonoCaption>
          {role === undefined ? "Workspace" : `Workspace · ${role}`}
        </MonoCaption>
        <h1 className="organiser__title">{workspace.name}</h1>

        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">Question banks</h2>
          <p className="organiser-empty__body">
            Write and organise the questions a test will later draw from.
          </p>
          <button
            type="button"
            className="button-primary button-primary--surface"
            onClick={onOpenBanks}
          >
            Question banks
          </button>
        </CardHairline>

        <CardHairline className="organiser-empty">
          <h2 className="organiser-empty__title">Tests</h2>
          <p className="organiser-empty__body">
            A test begins as a draft you can edit freely, and only becomes
            visible to candidates when it is published.
          </p>
          <button
            type="button"
            className="button-primary button-primary--surface"
            onClick={onOpenTests}
          >
            Create your first test
          </button>
        </CardHairline>
      </main>
    </>
  );
}
