// The short link's one read: a code to the workspace and test slug a
// candidate URL is built from.
//
// Deliberately outside repo/index.js, the same arrangement identity.ts
// documents for itself: `/t/<code>` names no workspace at all (that is the
// whole point of ADR 0006's precedent and of this code being unique bare,
// not composite with `workspace_id` — Review Focus 5), so there is nothing
// for `scoped()` to check and no workspace ID this function could take.
// `identity.test.ts`'s sibling guard does not watch this module, but the
// same reasoning holds: this is a public, unscoped identity read, not a
// workspace-scoped repository function, and folding it into the barrel
// would force that suite to carve out an exception for it.

import type { DbClient } from "../client.js";

export async function resolveShortCode(
  db: DbClient,
  code: string,
): Promise<{ workspaceSlug: string; testSlug: string } | null> {
  const rows = await db.query<{ workspace_slug: string; test_slug: string }>(
    "SELECT w.slug AS workspace_slug, t.slug AS test_slug FROM test t " +
      "JOIN workspace w ON w.id = t.workspace_id WHERE t.short_code = ?",
    [code],
  );
  const row = rows[0];
  return row ? { workspaceSlug: row.workspace_slug, testSlug: row.test_slug } : null;
}
