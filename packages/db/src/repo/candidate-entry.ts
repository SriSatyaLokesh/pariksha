// The reads a candidate request makes *before* any workspace is known.
//
// A candidate holds two slugs and nothing else (`T-02`: the candidate URL is
// `/<workspace-slug>/<test-slug>`), and `ADR 0005` is explicit that candidate
// access gives nobody a user row — so there is no session, no membership and
// no workspace ID for `scoped()` to check. The workspace ID is what this
// module *produces*, which is exactly `ADR 0006`'s admission test: "unable to
// know a workspace, not merely awkward to give one."
//
// It is a third module rather than a growth of `identity.ts` because that
// ADR's own "to watch" section says a function that is not about users or
// sessions should take a workspace ID instead — and these cannot. Like
// `identity.ts` and `shortlink.ts` it is deliberately **not** re-exported
// from `repo/index.ts`, so that barrel keeps its rule intact ("every function
// here is scoped") with no exemption list to grow;
// `test/repo/candidate-entry.test.ts` asserts the separation in both
// directions. Every read after this one is an ordinary `scoped()` function
// with the workspace ID this produced.

import type { DbClient } from "../client.js";
import type { Section } from "@pariksha/core";
import { deriveState, type TestSettings, type TestState } from "./test-document.js";

export interface PublishedTest {
  workspaceId: string;
  testId: string;
  testVersionId: string;
  version: number;
  /**
   * The **derived** lifecycle state, not the stored column. `test.status`
   * holds only `draft | published | closed | archived` and can never hold
   * `"open"`: Scheduled and Open are the same stored `published` seen
   * against the clock (`deriveState`), which is why `now` is an argument
   * here and why a scheduled test resolves rather than vanishing.
   */
  state: TestState;
  name: string;
  description: string | null;
  settings: TestSettings;
  sections: Section[];
  /** `workspace.branding_json` — logo, colour and footer (T-23's split). */
  workspaceBranding: unknown;
}

interface PublishedTestRecord {
  workspace_id: string;
  workspace_branding: unknown;
  test_id: string;
  name: string;
  description: string | null;
  status: string;
  version_id: string;
  version: number;
  settings_json: unknown;
  sections_json: unknown;
}

/**
 * One statement, the way `readSessionActor` is one statement: the workspace,
 * the test and the version the test currently points at, joined on
 * `test.current_version`. Null when any link is missing — an unknown
 * workspace, an unknown test, or a test that has never been published — so
 * the route can answer one 404 for all three without learning which
 * (`S-09`'s posture, applied to a caller who has no session at all).
 *
 * A test that has been published and then closed or archived still resolves:
 * the candidate needs to be told *that*, and the route decides which states
 * it will serve. Keeping the decision in the route is also what lets Task 2's
 * access gate and Task 5's `/start` disagree with the landing page about
 * `closed` without a second query shape.
 */
export async function resolvePublishedTest(
  db: DbClient,
  workspaceSlug: string,
  testSlug: string,
  now: number,
): Promise<PublishedTest | null> {
  // `/api/v1/run/attempt/...` (Task 5 onward) and
  // `/api/v1/run/:workspaceSlug/:testSlug` both match three segments. Hono
  // prefers a static segment to a parameter, so the collision does not
  // arise there — but a workspace whose slug really is "attempt" would make
  // every candidate URL under it indistinguishable from an attempt route to
  // anyone reading a log, so it is refused here too, before the query, at
  // the cost of nothing.
  if (workspaceSlug === "attempt") return null;

  const rows = await db.query<PublishedTestRecord>(
    "SELECT w.id AS workspace_id, w.branding_json AS workspace_branding, " +
      "t.id AS test_id, t.name AS name, t.description AS description, t.status AS status, " +
      "v.id AS version_id, v.version AS version, v.settings_json AS settings_json, v.sections_json AS sections_json " +
      "FROM test t JOIN workspace w ON w.id = t.workspace_id " +
      "JOIN test_version v ON v.workspace_id = t.workspace_id AND v.test_id = t.id " +
      "AND v.version = t.current_version AND v.published_at IS NOT NULL " +
      "WHERE w.slug = ? AND t.slug = ?",
    [workspaceSlug, testSlug],
  );
  const row = rows[0];
  if (!row) return null;

  const settings = db.jsonValue<TestSettings>(row.settings_json);
  return {
    workspaceId: row.workspace_id,
    testId: row.test_id,
    testVersionId: row.version_id,
    version: Number(row.version),
    // The cast is the same one `toTestRow` makes and for the same reason:
    // the column is plain text, and its four writers are `createTest`,
    // `publishDraftVersion` and `setTestStatus`.
    state: deriveState(row.status as "draft" | "published" | "closed" | "archived", settings.timing, now),
    name: row.name,
    description: row.description,
    settings,
    sections: db.jsonValue<Section[]>(row.sections_json),
    workspaceBranding: row.workspace_branding == null ? null : db.jsonValue(row.workspace_branding),
  };
}
