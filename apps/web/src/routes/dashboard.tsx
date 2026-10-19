import { useState } from "react";
import { CardHairline } from "../components/CardHairline";
import { MonoCaption } from "../components/MonoCaption";
import { OrganiserHeader } from "../components/OrganiserHeader";
import type { Actor, Workspace } from "../lib/api";

// Screen 3 of 3: the workspace dashboard. Test authoring (a `Test` entity,
// sections, pools) is still Phase 5 — but Phase 4 built question banks, and
// fix round (whole-branch review, C1) gave them a real entry point here:
// "Create your first test" below still states a real gap (no `Test` can be
// built yet), but no longer claims that gap closes "with the question
// bank" — the question bank is what "Question banks" below actually opens.
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
}: {
  actor: Actor;
  workspace: Workspace;
  onSignOut: () => void;
  onOpenBanks: () => void;
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
          <h2 className="organiser-empty__title">No tests yet</h2>
          <p className="organiser-empty__body">
            Nothing has been authored in this workspace. A test begins as a
            draft you can edit freely, and only becomes visible to candidates
            when it is published.
          </p>
          {/* ponytail: the one next action, with nowhere to go until Phase
              5's test authoring lands (docs/design.md's screen inventory).
              Saying so is better than a disabled button or a link to a 404;
              swap the handler for the real route when that screen exists. */}
          <button
            type="button"
            className="button-primary button-primary--surface"
            onClick={() => setNoted(true)}
          >
            Create your first test
          </button>
          {noted && (
            <p className="organiser__status" role="status">
              Test authoring is not built yet. This instance's question banks
              are ready for it.
            </p>
          )}
        </CardHairline>
      </main>
    </>
  );
}
