import type { TestVersionSummary } from "../../lib/api";

// Screen 12 (docs/design.md's screen inventory) — `UX-18`.
//
// One line, on every screen of a test that has a newer draft than the
// version candidates are sitting: "Version 2 (draft). Attempts in progress
// stay on version 1." It is `role="status"` rather than an alert because
// nothing is wrong — it is the standing fact about what the organiser is
// editing, and a reader arriving mid-edit needs to meet it without being
// interrupted by it.

export function VersionBanner({
  draftVersion,
  publishedVersion,
  onOpenPublished,
}: {
  draftVersion: number;
  publishedVersion: number | null;
  onOpenPublished: () => void;
}) {
  // Nothing published yet: there is no "stays on version 1" to state, and a
  // banner saying only "Version 1 (draft)" is noise on every new test.
  if (publishedVersion === null || draftVersion <= publishedVersion) return null;

  return (
    <p className="version-banner" role="status">
      <span>
        Version {draftVersion} (draft). Attempts in progress stay on version {publishedVersion}.
      </span>{" "}
      <button type="button" className="button-link" onClick={onOpenPublished}>
        View version {publishedVersion}
      </button>
    </p>
  );
}

/** The version history table beside the banner. Published versions carry
 * the time they were frozen and how many attempts are pinned to them; the
 * one open draft carries neither, and says so in words rather than leaving
 * two cells empty. */
export function VersionHistory({ versions }: { versions: readonly TestVersionSummary[] }) {
  if (versions.length === 0) return null;
  return (
    <table className="testbuilder-list">
      <caption>Version history</caption>
      <thead>
        <tr>
          <th scope="col">Version</th>
          <th scope="col">Published</th>
          <th scope="col">Attempts</th>
        </tr>
      </thead>
      <tbody>
        {versions.map((version) => (
          <tr key={version.version}>
            <th scope="row">Version {version.version}</th>
            <td>{version.publishedAt === null ? "Draft — not published yet" : new Date(version.publishedAt).toLocaleString()}</td>
            <td>{version.publishedAt === null ? "—" : version.attemptCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
