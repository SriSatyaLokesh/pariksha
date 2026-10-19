// Every `/api/v1/run/...` route: the candidate runtime.
//
// Candidate traffic is the application's **third request authority**. It
// mounts outside `/api/v1/workspaces/:id/...` and carries no `requires()`,
// because `guard()` reads `c.req.param("id")` and a candidate has no user
// row to hold a membership (ADR 0005) — and because a workspace ID in a
// candidate URL would hand a stranger a workspace identifier, which is the
// opposite of the 404-not-403 posture `authorize.ts` was written for. What
// replaces the guard is not nothing: it is `ROUTE_AUTH` in `app.ts`, which
// names this route's authority out loud and is checked against the live
// route table in both directions (`test/route-authority.test.ts`). See
// ADR 0008.
//
// `{test}` is the slug pair, because `T-02` fixes the candidate URL at
// `/<workspace-slug>/<test-slug>` and two slugs are the only identifier a
// candidate ever holds.

import { Hono } from "hono";
// `instant` rather than a second `Date.parse` here: the window this route
// reports and the window `deriveState` judged it against must be the same
// reading of the same string (reconciliation row 12).
import { instant, resolvePublishedTest, type PublishedTest } from "@pariksha/db";
import { NAVIGATION_CONSEQUENCE, type AccessMode, type Section, type TestTiming } from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";

/** The `proctoring` block is in `schemas/test-1.json` but not modelled in
 * `@pariksha/core` ("not modelled here yet. Add each when a phase needs
 * it."), and Phase 6 needs exactly one field of it. */
type ProctoringProfile = "off" | "standard" | "strict";

export interface LandingPayload {
  name: string;
  description: string | null;
  durationMinutes: number;
  questionCount: number;
  sections: { id: string; title: string; questionCount: number; timeLimitMinutes: number | null }[];
  rules: string | null;
  proctoring: ProctoringProfile;
  accessMode: AccessMode;
  /** The derived state, never the stored column (reconciliation row 12). */
  state: PublishedTest["state"];
  opensAt: number | null;
  closesAt: number | null;
  latestStartAt: number | null;
  timezone: string;
  branding: {
    logo: string | null;
    logoAlt: string | null;
    primaryColour: string | null;
    footerText: string | null;
    startMessage: string | null;
  };
  serverNow: number;
}

/**
 * How many questions a section puts in front of one candidate, from
 * `sections_json` alone — so the landing route never touches the bank and
 * therefore cannot name a question (`S-10`). A `pool` reports what it asks
 * for rather than what the bank can supply: `pool_short` is an advisory
 * checklist row, not a blocking one, and `/start` is where a short pool is
 * refused (Task 5).
 */
function sectionQuestionCount(section: Section): number {
  const source = section.source;
  switch (source.kind) {
    case "fixed":
      return source.questions.length;
    case "pool":
      return source.count;
    case "sets":
      // One candidate sits one set. The largest, so the count is never
      // understated on a test whose sets are unbalanced (also advisory).
      return Math.max(0, ...source.sets.map((set) => set.questions.length));
  }
}

function landingPayload(test: PublishedTest, now: number): LandingPayload {
  // Reconciliation row 8: these defaults exist only in the builder UI, so
  // the server applies its own. `timing` is optional on `Test` by design.
  const timing: Partial<TestTiming> = test.settings.timing ?? {};
  const closesAt = instant(timing.closes_at);
  const branding = test.settings.branding ?? {};
  const workspaceBranding = (test.workspaceBranding ?? {}) as {
    logo?: string;
    logo_alt?: string;
    primary_colour?: string;
    footer_text?: string;
  };
  const proctoring = (test.settings as { proctoring?: { profile?: ProctoringProfile } }).proctoring;
  const sections = test.sections.map((section) => ({
    id: section.id,
    title: section.title,
    questionCount: sectionQuestionCount(section),
    timeLimitMinutes: section.time_limit_minutes ?? null,
  }));

  return {
    name: test.name,
    description: test.description,
    durationMinutes: timing.duration_minutes ?? 0,
    questionCount: sections.reduce((total, section) => total + section.questionCount, 0),
    sections,
    // `rules` is not a field of `pariksha/test@1`. The one rule a candidate
    // must be told before starting is the navigation mode they are about to
    // be held to, and `@pariksha/core` already owns that sentence — stated
    // once here, in the builder and in the publish checklist, rather than
    // worded a third way.
    rules: NAVIGATION_CONSEQUENCE[timing.navigation ?? "free"],
    proctoring: proctoring?.profile ?? "off",
    // No `access` block at all still renders a gate; which one Task 2 owns.
    accessMode: test.settings.access?.mode ?? "link_code",
    state: test.state,
    opensAt: instant(timing.opens_at),
    closesAt,
    // `docs/test-format.md`: `latest_start_at` defaults to `closes_at`.
    latestStartAt: instant(timing.latest_start_at) ?? closesAt,
    // "instance default" in the format table; UTC is this instance's.
    timezone: timing.timezone ?? "UTC",
    branding: {
      logo: workspaceBranding.logo ?? null,
      logoAlt: workspaceBranding.logo_alt ?? null,
      primaryColour: workspaceBranding.primary_colour ?? null,
      footerText: workspaceBranding.footer_text ?? null,
      startMessage: branding.start_message ?? null,
    },
    // AC-13's anchor: the browser's countdown is a delta from the server's
    // own reading, never from `Date.now()` (Review Focus 4).
    serverNow: now,
  };
}

export function runRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // C-01 in one read. Consent is deliberately not here: it arrives after
  // the access gate (Task 3).
  routes.get("/:workspaceSlug/:testSlug", async (c) => {
    const now = deps.now();
    const test = await resolvePublishedTest(
      deps.db,
      c.req.param("workspaceSlug"),
      c.req.param("testSlug"),
      now,
    );
    // One answer for "no such workspace", "no such test", "never
    // published" and "archived" alike: a candidate holds no credential
    // that could distinguish them, and telling them apart would turn the
    // slug pair into an enumeration oracle for an organiser's draft names.
    // `closed` and `scheduled` are *not* refused — a candidate who arrives
    // early or late needs to be told which, and that is what the window in
    // the payload is for.
    if (!test || test.state === "draft" || test.state === "archived") {
      throw new ApiError(404, "not_found", "No such resource.");
    }
    return c.json(landingPayload(test, now));
  });

  return routes;
}
