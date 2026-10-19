// The pre-workspace candidate read, and the separation that keeps it out of
// the scoped barrel.
//
// ADR 0006's pattern, as a third module beside `identity.ts` and
// `shortlink.ts`: `resolvePublishedTest` cannot take a workspace ID because
// the workspace ID is what it *produces*. `identity.test.ts` is the template
// — the same two guards, in both directions, so neither half can drift into
// the other by accident.

import { afterAll, expect, it } from "vitest";
import {
  closeClient,
  createTest,
  createWorkspace,
  getDraftVersion,
  migrate,
  newId,
  publishDraftVersion,
  putDraftVersion,
  setTestStatus,
  sqliteClient,
  type DbClient,
  type TestDocumentBody,
} from "../../src/index.js";
import * as candidateEntry from "../../src/repo/candidate-entry.js";
import { REPO_FUNCTIONS } from "../../src/repo/guard.js";
import * as repo from "../../src/repo/index.js";
import { resolvePublishedTest } from "../../src/repo/candidate-entry.js";

// ADR 0006: a function belongs here only when the workspace ID is what it
// *produces*. Both of these are handed a slug pair or a token hash and
// nothing else, so there is no workspace for `scoped()` to check.
const UNSCOPED_BY_DESIGN = ["resolvePublishedTest", "readAttemptByTokenHash"];

function functionNames(module: Record<string, unknown>): string[] {
  return Object.entries(module)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);
}

it("the unscoped set is exactly the one named here", () => {
  expect(new Set(functionNames(candidateEntry))).toEqual(new Set(UNSCOPED_BY_DESIGN));
});

it("no unscoped function reaches the scoped barrel or its registry", () => {
  for (const name of UNSCOPED_BY_DESIGN) {
    expect(repo, `${name} is exported from repo/index.ts`).not.toHaveProperty(name);
    expect(REPO_FUNCTIONS, `${name} is registered as a scoped function`).not.toHaveProperty(name);
  }
});

// --- the read itself ----------------------------------------------------

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
const iso = (at: number) => new Date(at).toISOString();

const db: DbClient = sqliteClient(":memory:");
await migrate(db);

afterAll(() => closeClient(db));

/** One D1 call per raw operation, the way `countingDeps` counts them in the
 * API. Local rather than shared: six lines, one caller. */
function countingClient(inner: DbClient): { db: DbClient; count: () => number } {
  let calls = 0;
  const bump = <T>(run: () => T): T => {
    calls += 1;
    return run();
  };
  return {
    db: {
      ...inner,
      exec: (sql) => bump(() => inner.exec(sql)),
      all: <T>(sql: string) => bump(() => inner.all<T>(sql)),
      query: <T>(sql: string, params?: unknown[]) => bump(() => inner.query<T>(sql, params)),
      run: (sql, params) => bump(() => inner.run(sql, params)),
      batch: (statements) => bump(() => inner.batch(statements)),
    },
    count: () => calls,
  };
}

const body = (settings: TestDocumentBody["settings"]): TestDocumentBody => ({
  settings,
  sections: [{ id: "s1", title: "Logic", source: { kind: "fixed", questions: ["qst_1"] } }],
});

/** A workspace with one published test, built through the real writers. */
async function publish(
  workspaceSlug: string,
  testSlug: string,
  settings: TestDocumentBody["settings"],
): Promise<{ workspaceId: string; testId: string }> {
  const workspaceId = newId("wsp");
  await createWorkspace(db, workspaceId, {
    slug: workspaceSlug,
    name: workspaceSlug,
    branding: { footer_text: `${workspaceSlug} footer` },
    now: NOW,
  });
  const test = await createTest(db, workspaceId, { name: testSlug, slug: testSlug, now: NOW });
  const draft = await getDraftVersion(db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");
  await putDraftVersion(db, workspaceId, draft, body(settings), NOW);
  await publishDraftVersion(db, workspaceId, test.id, NOW);
  return { workspaceId, testId: test.id };
}

const open = { timing: { duration_minutes: 45 } };

const wspA = (await publish("alpha", "aptitude", open)).workspaceId;
await publish("beta", "aptitude", open);
// Never published: createTest seeds draft version 1 and nothing stamps it.
await createTest(db, wspA, { name: "Draft only", slug: "draft-only", now: NOW });
// Published, then archived.
const archived = await publish("alpha-archived", "archived", open);
await setTestStatus(db, archived.workspaceId, archived.testId, "archived", NOW);
// Published with a window that has not opened yet.
await publish("alpha-sched", "scheduled", {
  timing: { duration_minutes: 45, opens_at: iso(NOW + DAY), closes_at: iso(NOW + 2 * DAY) },
});
// Published with a window that is already over.
await publish("alpha-shut", "shut", {
  timing: { duration_minutes: 45, opens_at: iso(NOW - 2 * DAY), closes_at: iso(NOW - DAY) },
});

it("resolves a published test from the slug pair alone, in one statement", async () => {
  const counting = countingClient(db);
  expect(await resolvePublishedTest(counting.db, "alpha", "aptitude", NOW)).toMatchObject({
    workspaceId: wspA,
    version: 1,
    // Derived, never stored: `test.status` holds "published" and the column
    // can never hold "open" (reconciliation row 12, `deriveState`).
    state: "open",
    name: "aptitude",
  });
  expect(counting.count()).toBe(1);
});

it("two workspaces may hold the same test slug and resolve to different tests", async () => {
  expect((await resolvePublishedTest(db, "alpha", "aptitude", NOW))!.testId).not.toBe(
    (await resolvePublishedTest(db, "beta", "aptitude", NOW))!.testId,
  );
});

it("a test with current_version null resolves to null", async () => {
  expect(await resolvePublishedTest(db, "alpha", "draft-only", NOW)).toBeNull();
});

it("the slug 'attempt' never resolves, so it cannot shadow the attempt routes", async () => {
  // The workspace really exists and really has a published test at this
  // slug pair — so the only thing that can make this null is the refusal
  // itself. Asserting against a workspace that happens not to have the
  // test would pass with the guard deleted.
  await publish("attempt", "anything", open);
  expect(await resolvePublishedTest(db, "attempt", "anything", NOW)).toBeNull();
  // The control: the same test, reached by any other workspace slug,
  // resolves perfectly.
  await publish("not-attempt", "anything", open);
  expect(await resolvePublishedTest(db, "not-attempt", "anything", NOW)).not.toBeNull();
});

it("a current_version pointing at an unpublished row resolves to null", async () => {
  // `publishDraftVersion` is the only writer of `current_version` and it
  // stamps `published_at` in the same batch, so this state is not
  // reachable through the repository — which is exactly why the join's
  // `published_at IS NOT NULL` is worth having and worth proving. Written
  // directly, because a half-written lifecycle in a later phase is the
  // thing that would otherwise serve a candidate an unpublished paper.
  const { workspaceId, testId } = await publish("alpha-halfway", "halfway", open);
  await db.run("UPDATE test SET current_version = ? WHERE id = ?", [2, testId]);
  expect(await resolvePublishedTest(db, "alpha-halfway", "halfway", NOW)).toBeNull();
  // Version 2 is the draft `publishDraftVersion` opened, and it is really
  // there — so what refused is the `published_at` predicate, not a missing row.
  const rows = await db.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM test_version WHERE workspace_id = ? AND test_id = ? AND version = 2",
    [workspaceId, testId],
  );
  expect(Number(rows[0]?.n)).toBe(1);
});

it("an archived test still resolves, carrying its archived state for the route to refuse", async () => {
  expect(await resolvePublishedTest(db, "alpha-archived", "archived", NOW)).toMatchObject({
    state: "archived",
  });
});

it("a test whose window has not opened resolves as scheduled, not as a 404", async () => {
  const resolved = await resolvePublishedTest(db, "alpha-sched", "scheduled", NOW);
  expect(resolved).toMatchObject({ state: "scheduled" });
  // And the same row reads Open once the clock passes `opens_at`, with no
  // write in between — the whole reason the state is derived.
  expect((await resolvePublishedTest(db, "alpha-sched", "scheduled", NOW + 2 * DAY - 1))!.state).toBe("open");
});

it("a test whose window has closed resolves as closed", async () => {
  expect((await resolvePublishedTest(db, "alpha-shut", "shut", NOW))!.state).toBe("closed");
});

it("carries the version body and the workspace branding the landing page renders", async () => {
  const resolved = await resolvePublishedTest(db, "alpha", "aptitude", NOW);
  expect(resolved).toMatchObject({
    settings: open,
    sections: body(open).sections,
    workspaceBranding: { footer_text: "alpha footer" },
  });
  expect(resolved!.testVersionId).toMatch(/^ver_/);
});
