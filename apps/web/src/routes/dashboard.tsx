import { CardHairline } from "../components/CardHairline";

// Screen 3 of 3: the workspace dashboard. Phase 4 gave question banks a real
// entry point here; Phase 5 Task 2 does the same for tests — "Create your
// first test" now opens the real test list (apps/web/src/routes/tests.tsx),
// not a placeholder notice.
//
// Phase 6.5c Task 1 (D3): the chrome is gone. The workspace name, the role
// the actor holds in it (docs/design.md UX-11 — the publish boundary is
// shown, not discovered) and the way out are `OrganiserShell`'s now, which
// is how twelve screens get them instead of four. What is left is the
// screen itself: two ways in, each with its own next action.

export function Dashboard({
  onOpenBanks,
  onOpenTests,
}: {
  onOpenBanks: () => void;
  onOpenTests: () => void;
}) {
  return (
    <>
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
    </>
  );
}
