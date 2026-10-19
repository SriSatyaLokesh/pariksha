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
  replaceCandidateList,
  setTestStatus,
  updateTest,
  type NewCandidate,
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

  await seedAccessModeTests(deps, workspaceId);

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

// --- Task 2 (#66, P6.2): one published test per access mode ------------

/**
 * The registration form the candidate-list tests are keyed on. `roll_number`
 * is the first `unique: true` field, so it is `external_id` (`identityField`,
 * `src/import/candidates.ts`); `email` is the first `type: "email"` field, so
 * it is where `MintedInvite.email` is read from — reconciliation row 14, the
 * `candidate` table has no email column.
 */
export const LISTED_FORM = {
  fields: [
    { id: "roll_number", type: "short_text" as const, label: "Roll number", unique: true },
    { id: "email", type: "email" as const, label: "College email address" },
    { id: "full_name", type: "short_text" as const, label: "Full name" },
  ],
};

/** One entry with an email in its prefill and one without, so
 *  `MintedInvite.email` is proved to be `null` rather than `undefined` or
 *  the identifier when the form value is absent. */
export const LISTED_CANDIDATES: NewCandidate[] = [
  { externalId: "21CS0147", setLabel: "A", formValues: { email: "ananya@vce.ac.in", full_name: "Ananya" } },
  { externalId: "21CS0148", setLabel: "B", formValues: { full_name: "Bharat" } },
];

/** `invited`'s list is a superset: the two extra identifiers are the ones
 *  that prove a list lookup is scoped to its own test rather than to the
 *  workspace, and give the invite tests rows nothing else has spent. */
export const INVITED_CANDIDATES: NewCandidate[] = [
  ...LISTED_CANDIDATES,
  { externalId: "21CS0149", setLabel: "A", formValues: { full_name: "Chetan" } },
  { externalId: "21CS0150", setLabel: "B", formValues: { email: "deepa@vce.ac.in", full_name: "Deepa" } },
  { externalId: "21CS0151", setLabel: "A", formValues: { full_name: "Esha" } },
];

const openWindow = {
  duration_minutes: 30,
  opens_at: iso(FIXED_NOW - DAY),
  closes_at: iso(FIXED_NOW + DAY),
};

const oneSection = [{ id: "only", title: "Only", source: { kind: "pool" as const, count: 5 } }];

/**
 * `alpha/listed`, `alpha/otp`, `alpha/lab`, `alpha/invited`, `alpha/sso` and
 * `alpha/gauntlet` — one published test per gate the access route has to
 * pass or refuse, plus the uploaded candidate lists the list-gated ones read.
 */
export async function seedAccessModeTests(deps: AppDeps, workspaceId: string): Promise<void> {
  // `link_code` behind a candidate list (T-21).
  const listed = await seedTest(deps, workspaceId, {
    name: "Listed",
    slug: "listed",
    body: {
      settings: {
        timing: openWindow,
        access: { mode: "link_code", access_code: "OPENSESAME", candidate_list: "list.csv" },
        registration_form: LISTED_FORM,
      },
      sections: oneSection,
    },
  });
  await replaceCandidateList(deps.db, workspaceId, listed, LISTED_CANDIDATES, FIXED_NOW);

  // `email_code`, with a domain allowlist so the pre-switch block has
  // something to refuse on the same route.
  await seedTest(deps, workspaceId, {
    name: "Otp",
    slug: "otp",
    body: {
      settings: {
        timing: openWindow,
        access: { mode: "email_code", allow_email_domains: ["*.ac.in"] },
        registration_form: LISTED_FORM,
      },
      sections: oneSection,
    },
  });

  // `link_code` behind a network allowlist. The range is lower-case
  // already; `foldAllowlistCase` is what guarantees that for a real test.
  await seedTest(deps, workspaceId, {
    name: "Lab",
    slug: "lab",
    body: {
      settings: {
        timing: openWindow,
        access: { mode: "link_code", access_code: "OPENSESAME", allow_ip_ranges: ["10.0.0.0/8"] },
      },
      sections: oneSection,
    },
  });

  // `invite_only`, over the same list. The invite proves list membership,
  // so this one takes no identifier at the gate.
  const invited = await seedTest(deps, workspaceId, {
    name: "Invited",
    slug: "invited",
    body: {
      settings: {
        timing: openWindow,
        access: { mode: "invite_only", candidate_list: "list.csv" },
        registration_form: LISTED_FORM,
      },
      sections: oneSection,
    },
  });
  await replaceCandidateList(deps.db, workspaceId, invited, INVITED_CANDIDATES, FIXED_NOW);

  // `sso`, with the domain rule the callback names in its refusal.
  await seedTest(deps, workspaceId, {
    name: "Sso",
    slug: "sso",
    body: {
      settings: {
        timing: openWindow,
        access: { mode: "sso", allow_email_domains: ["*.ac.in"] },
      },
      sections: oneSection,
    },
  });

  // A second `invite_only` test with **no** candidate list, so an invite
  // presented at the wrong test reaches the invite branch instead of
  // being short-circuited by T-21's list check. That is the only way to
  // see whether the token's digest is really salted with its test.
  await seedTest(deps, workspaceId, {
    name: "Open invite",
    slug: "open-invite",
    body: {
      settings: { timing: openWindow, access: { mode: "invite_only" } },
      sections: oneSection,
    },
  });

  // `sso` behind a candidate list. The candidate types nothing at this
  // gate, so the verified address is the identity T-21 is checked
  // against — which is why this form's first unique field is the email.
  const ssoListed = await seedTest(deps, workspaceId, {
    name: "Sso listed",
    slug: "sso-listed",
    body: {
      settings: {
        timing: openWindow,
        access: { mode: "sso", allow_email_domains: ["*.ac.in"], candidate_list: "list.csv" },
        registration_form: {
          fields: [
            { id: "email", type: "email" as const, label: "College email address", unique: true },
            { id: "full_name", type: "short_text" as const, label: "Full name" },
          ],
        },
      },
      sections: oneSection,
    },
  });
  await replaceCandidateList(
    deps.db,
    workspaceId,
    ssoListed,
    [{ externalId: "s@college.ac.in", setLabel: "A", formValues: { full_name: "Sita" } }],
    FIXED_NOW,
  );

  // Every gate at once — a domain rule, a candidate list and a mode whose
  // own gate consumes a token. It is the only combination that spends the
  // declared `/access` budget, so it is what the budget is measured on.
  const gauntlet = await seedTest(deps, workspaceId, {
    name: "Gauntlet",
    slug: "gauntlet",
    body: {
      settings: {
        timing: openWindow,
        access: {
          mode: "email_code",
          candidate_list: "list.csv",
          allow_email_domains: ["*.ac.in"],
        },
        registration_form: LISTED_FORM,
      },
      sections: oneSection,
    },
  });
  await replaceCandidateList(deps.db, workspaceId, gauntlet, LISTED_CANDIDATES, FIXED_NOW);
}
