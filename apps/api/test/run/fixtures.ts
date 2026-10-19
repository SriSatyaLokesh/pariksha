// The candidate runtime's fixtures: workspaces and published tests, written
// through the real repository writers rather than hand-built INSERTs, so a
// change to how a test is published reaches these too.
//
// Written here rather than through the organiser routes on purpose: a
// candidate test needs no session, no membership and no bank, and routing
// every fixture through `POST /tests` plus `PATCH /draft` plus `/publish`
// would make the cheapest suite in the phase the slowest.

import {
  createTest,
  createWorkspace,
  getDraftVersion,
  newId,
  publishDraftVersion,
  putDraftVersion,
  setTestStatus,
  updateTest,
  type TestDocumentBody,
  type TestStatus,
} from "@pariksha/db";
import type { AppDeps } from "../../src/app.js";
import { FIXED_NOW } from "../deps.js";

export const DAY = 86_400_000;
export const iso = (at: number): string => new Date(at).toISOString();

/** The workspace the candidate tests below hang off. */
export async function seedWorkspace(
  deps: AppDeps,
  slug = "alpha",
  name = "Alpha Corp",
): Promise<string> {
  const workspaceId = newId("wsp");
  await createWorkspace(deps.db, workspaceId, {
    slug,
    name,
    branding: {
      logo: "9f1c.png",
      logo_alt: "Alpha Corp",
      primary_colour: "#b63a10",
      footer_text: "Alpha Corp · Hyderabad",
    },
    now: FIXED_NOW,
  });
  return workspaceId;
}

export async function seedTest(
  deps: AppDeps,
  workspaceId: string,
  input: {
    name: string;
    slug: string;
    description?: string;
    body: TestDocumentBody;
    status?: TestStatus;
    publish?: boolean;
  },
): Promise<string> {
  const test = await createTest(deps.db, workspaceId, {
    name: input.name,
    slug: input.slug,
    now: FIXED_NOW,
  });
  // `description` lives on the `test` row, beside `name` and `slug` — the
  // identity fields an organiser edits independently of a draft (T-01) —
  // not in `settings_json`, even though `TestSettings` still carries a key
  // by that name because `Omit<Test, …>` does not remove it.
  if (input.description !== undefined) {
    await updateTest(deps.db, workspaceId, test.id, { description: input.description }, FIXED_NOW);
  }
  const draft = await getDraftVersion(deps.db, workspaceId, test.id);
  if (!draft) throw new Error("createTest did not seed a draft");
  await putDraftVersion(deps.db, workspaceId, draft, input.body, FIXED_NOW);
  if (input.publish !== false) {
    await publishDraftVersion(deps.db, workspaceId, test.id, FIXED_NOW);
  }
  if (input.status) {
    await setTestStatus(deps.db, workspaceId, test.id, input.status, FIXED_NOW);
  }
  return test.id;
}

/**
 * `alpha/aptitude`: 17 questions across three sections, one of each source
 * kind, so the question count is exercised on all three without reading a
 * bank. Plus the sibling tests every refusal case needs.
 */
export async function seedPublishedTest(deps: AppDeps): Promise<string> {
  const workspaceId = await seedWorkspace(deps);

  await seedTest(deps, workspaceId, {
    name: "Aptitude",
    slug: "aptitude",
    description: "A 45-minute aptitude paper.",
    body: {
      settings: {
        // A deliberately *different* value, so the route is proved to read
        // the `test` row rather than this stale document copy.
        description: "The settings blob's own stale copy.",
        timing: {
          duration_minutes: 45,
          timezone: "Asia/Kolkata",
          opens_at: iso(FIXED_NOW - DAY),
          closes_at: iso(FIXED_NOW + DAY),
          latest_start_at: iso(FIXED_NOW + DAY - 3_600_000),
          navigation: "linear",
        },
        access: { mode: "link_code", access_code: "OPENSESAME" },
        proctoring: { profile: "standard" },
        branding: { start_message: "Read every instruction before you begin." },
      },
      sections: [
        {
          id: "logic",
          title: "Logic",
          time_limit_minutes: 15,
          source: { kind: "fixed", questions: ["qst_log1", "qst_log2", "qst_log3", "qst_log4"] },
        },
        {
          id: "numeracy",
          title: "Numeracy",
          source: { kind: "pool", count: 10, filter: { tags: ["LOG-001"] } },
        },
        {
          id: "verbal",
          title: "Verbal",
          source: {
            kind: "sets",
            assignment: "round_robin",
            sets: [
              { set: "A", questions: ["qst_va1", "qst_va2", "qst_va3"] },
              { set: "B", questions: ["qst_vb1", "qst_vb2", "qst_vb3"] },
            ],
          },
        },
      ],
    },
  });

  // A single pooled section, for the "never reads the bank" assertion.
  await seedTest(deps, workspaceId, {
    name: "Pooled",
    slug: "pooled",
    body: {
      settings: { timing: { duration_minutes: 20 } },
      sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 10 } }],
    },
  });

  // Never published.
  await seedTest(deps, workspaceId, {
    name: "Draft only",
    slug: "draft-only",
    body: { settings: {}, sections: [] },
    publish: false,
  });

  // Published, then archived.
  await seedTest(deps, workspaceId, {
    name: "Archived",
    slug: "archived",
    body: { settings: { timing: { duration_minutes: 10 } }, sections: [] },
    status: "archived",
  });

  // Published with a window that has not opened yet (reconciliation row 12:
  // the column holds "published" and `deriveState` answers "scheduled").
  await seedTest(deps, workspaceId, {
    name: "Scheduled",
    slug: "scheduled",
    body: {
      settings: {
        timing: {
          duration_minutes: 30,
          timezone: "Asia/Kolkata",
          opens_at: iso(FIXED_NOW + DAY),
          closes_at: iso(FIXED_NOW + 2 * DAY),
        },
      },
      sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 5 } }],
    },
  });

  // Published, window already over.
  await seedTest(deps, workspaceId, {
    name: "Shut",
    slug: "shut",
    body: {
      settings: {
        timing: {
          duration_minutes: 30,
          opens_at: iso(FIXED_NOW - 2 * DAY),
          closes_at: iso(FIXED_NOW - DAY),
        },
      },
      sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 5 } }],
    },
  });

  // Two workspaces whose slug pair really would resolve, so the route's
  // "the slug 'attempt' cannot shadow the attempt routes" assertion has
  // something to refuse rather than passing on an absent fixture (review
  // finding I-5 / M-1). `attempt/answer` is the exact pair Task 5's
  // `PUT /api/v1/run/attempt/answer` will occupy; `not-attempt/answer` is
  // the control that proves the refusal is about the slug and nothing else.
  for (const slug of ["attempt", "not-attempt"]) {
    const ws = await seedWorkspace(deps, slug, "Shadow Co");
    await seedTest(deps, ws, {
      name: "Answer",
      slug: "answer",
      body: {
        settings: { timing: { duration_minutes: 10 } },
        sections: [{ id: "only", title: "Only", source: { kind: "pool", count: 1 } }],
      },
    });
  }

  return workspaceId;
}
