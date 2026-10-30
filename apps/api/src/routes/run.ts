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

import { Hono, type Context } from "hono";
import { z } from "zod";
// `instant` rather than a second `Date.parse` here: the window this route
// reports and the window `deriveState` judged it against must be the same
// reading of the same string (reconciliation row 12).
import {
  consumeAuthToken,
  getCandidateByExternalId,
  instant,
  INVITE_KIND,
  resolvePublishedTest,
  type InvitePayload,
  type PublishedTest,
} from "@pariksha/db";
import {
  NAVIGATION_CONSEQUENCE,
  normaliseEmail,
  normaliseUniqueValue,
  proctoringRequirements,
  resolveProctoring,
  type AccessMode,
  type ProctoringProfile,
  type Section,
  type TestAccess,
  type TestTiming,
} from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { authorizationUrl, verifiedCallback } from "../auth/oidc.js";
import { emailSender } from "../email/adapter.js";
import {
  consumeEmailCode,
  EMAIL_CODE_TTL_MS,
  inviteHash,
  issueEmailCode,
  issueEntryToken,
  openTest,
  refuse,
  sameSecret,
  type EntryClaim,
} from "../run/entry.js";
import { limitMisses, limitOrThrow } from "../run/limit.js";
import { sha256Hex } from "../auth/tokens.js";
import { registrationRoutes } from "../run/registration.js";
import { attemptRoutes } from "../run/attempt.js";
import { resultRoutes } from "../run/result.js";
import { clientIp, emailInDomains, ipInRanges } from "../run/net.js";
import { identityField } from "../import/candidates.js";

export interface LandingPayload {
  name: string;
  description: string | null;
  durationMinutes: number;
  questionCount: number;
  sections: { id: string; title: string; questionCount: number; timeLimitMinutes: number | null }[];
  rules: string | null;
  /**
   * The resolved requirements the runtime will enforce, never the resolved
   * object itself: this payload is reachable by anyone holding the link,
   * and the resolved object (with its `violationLimit`) rides
   * `GET /api/v1/run/attempt` instead, which is `attempt`-authority
   * (`AC-22`). `profile` is carried only for display — no reader may
   * branch on it (`Q1`).
   */
  proctoring: { profile: ProctoringProfile; requirements: string[] };
  accessMode: AccessMode;
  /**
   * Whether the organiser uploaded a candidate list — so the gate's own
   * form can make the identifier required instead of labelling it
   * optional and then refusing a blank one with `code_wrong`, which is
   * the byte-identical answer to a wrong access code (`T-21`).
   *
   * **Not an `S-10` disclosure.** `S-10` is about never revealing
   * anything about a *person* — whether some identifier is on the list.
   * This is a property of the test, identical for every visitor holding
   * the link and already implied by the field the form shows; a
   * candidate who cannot see it cannot comply with it.
   */
  candidateList: boolean;
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
  const resolvedProctoring = resolveProctoring(test.settings.proctoring);
  const sections = test.sections.map((section) => ({
    id: section.id,
    title: section.title,
    questionCount: sectionQuestionCount(section),
    timeLimitMinutes: section.time_limit_minutes ?? null,
  }));

  // #179: `buildChecklist`'s `timing_missing` row now refuses to publish any
  // version with no duration (or `duration_minutes < 1`), so a *published*
  // version's duration is never missing here — `?? 0` used to let this very
  // route advertise the 0-minute test #179 closed the publish gate against.
  // Failing loud on the one route that could still be handed a version from
  // before that gate existed (a direct write, never the publish route) is
  // truer than silently printing a number nobody chose.
  const durationMinutes = timing.duration_minutes;
  if (durationMinutes === undefined || durationMinutes < 1) {
    throw new Error("unreachable: #179 refuses to publish a version with no duration");
  }

  return {
    name: test.name,
    description: test.description,
    durationMinutes,
    questionCount: sections.reduce((total, section) => total + section.questionCount, 0),
    sections,
    // `rules` is not a field of `pariksha/test@1`. The one rule a candidate
    // must be told before starting is the navigation mode they are about to
    // be held to, and `@pariksha/core` already owns that sentence — stated
    // once here, in the builder and in the publish checklist, rather than
    // worded a third way.
    rules: NAVIGATION_CONSEQUENCE[timing.navigation ?? "free"],
    proctoring: {
      profile: resolvedProctoring.profile,
      requirements: proctoringRequirements(resolvedProctoring),
    },
    // No `access` block at all still renders a gate; which one Task 2 owns.
    accessMode: test.settings.access?.mode ?? "link_code",
    // The boolean, never the file name the organiser uploaded.
    candidateList: Boolean(test.settings.access?.candidate_list),
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


// --- Task 2 (#66, P6.2): the access gate -------------------------------
//
// One handler, one `switch` on `access.mode`, with the three allowlists —
// network, email domain and candidate list — checked *before* the switch
// (`docs/test-format.md:72`, `T-21`), so an off-network candidate never
// learns whether their code was right.
//
// `S-10` is the shape of the whole block: a wrong code and an identifier
// that is not on the list answer with the same bytes, because a gate that
// told them apart would be an enumeration oracle over an organiser's roll
// numbers. The network refusal is its own code deliberately — a candidate
// who is on the wrong network has to be told *that* or they will keep
// retyping a code that was always right — and it is answered identically
// whether the code was right or wrong, which is the property that matters.

const accessRequest = z.object({
  code: z.string().max(200).optional(),
  invite: z.string().max(500).optional(),
  email: z.string().max(320).optional(),
  otp: z.string().max(20).optional(),
  /** The test's first `unique: true` registration field, typed at the gate
   *  on a candidate-listed test — the gate runs before the form is shown,
   *  so this one value arrives ahead of the rest of the registration. */
  identifier: z.string().max(200).optional(),
  /** Task 4's proof of work. Accepted and ignored here so the browser's
   *  request shape does not change when it lands. */
  captchaToken: z.string().max(4000).optional(),
});

const emailCodeRequest = z.object({ email: z.string().min(3).max(320) });

/** A malformed or incomplete request, which is not a refusal: "you sent
 *  nothing" says nothing about the secret, so it may be said plainly. */
const incomplete = (message: string): ApiError => new ApiError(400, "invalid_request", message);

/**
 * Checked first, and refused when the request carries no address at all.
 * Failing open on an allowlist is the whole of the bug: a deployment
 * behind a proxy that strips the header would otherwise admit everyone.
 */
function checkNetwork(c: Context<AppBindings>, access: TestAccess | undefined): void {
  const ranges = access?.allow_ip_ranges ?? [];
  if (ranges.length === 0) return;
  const ip = clientIp(c);
  if (ip === null || !ipInRanges(ip, ranges)) throw refuse("ip_not_allowed");
}

/**
 * The domain rule, named in the refusal. Naming it is not a leak: the
 * candidate supplied the address it refused, and an organiser's whole
 * intent is that a candidate who used the wrong one is told which to use.
 */
function checkDomain(access: TestAccess | undefined, email: string | undefined): void {
  const globs = access?.allow_email_domains ?? [];
  if (globs.length === 0 || email === undefined) return;
  if (!emailInDomains(email, globs)) {
    throw refuse("domain_not_allowed", ` Allowed: ${globs.join(", ")}.`);
  }
}

/**
 * `T-21`: only listed identities may get in. `null` when the test sets no
 * list, in which case an identifier it never asked for is ignored rather
 * than refused.
 *
 * The refusal is `code_wrong`, byte for byte — see the header.
 *
 * The typed value passes through the same `normaliseUniqueValue` the CSV
 * upload wrote `external_id` with, so the two compare exactly: an email
 * identity listed as `Ravi@College.ac.in` matches `ravi@college.ac.in`
 * typed at the door, and a roll number keeps the case the organiser
 * chose. Four normalisations that drift is how `T-21` refuses a listed
 * person on test day.
 *
 * `email_code` and `sso` call this with the **verified address**, so on a
 * listed test in either mode the form's first `unique` field has to be
 * the email one — there is no other value the gate holds. A roll-number
 * list under those modes matches nobody, which is a publish-time
 * misconfiguration rather than a runtime branch.
 */
function identityKey(test: PublishedTest, value: string | undefined): string {
  const field = identityField(test.settings.registration_form);
  return field === null ? (value ?? "").trim() : normaliseUniqueValue(field, value ?? "");
}

async function listEntry(
  deps: AppDeps,
  test: PublishedTest,
  identifier: string | undefined,
): Promise<{ id: string } | null> {
  if (!test.settings.access?.candidate_list) return null;
  const typed = identityKey(test, identifier);
  if (typed === "") throw refuse("code_wrong");
  const entry = await getCandidateByExternalId(deps.db, test.workspaceId, test.testId, typed);
  if (!entry) throw refuse("code_wrong");
  return entry;
}

async function consumeInvite(deps: AppDeps, test: PublishedTest, token: string): Promise<InvitePayload> {
  const raw = (await consumeAuthToken(
    deps.db,
    await inviteHash(test.testId, token),
    INVITE_KIND,
    deps.now(),
  )) as Partial<InvitePayload> | null;
  // Unknown, expired, already spent and minted for another workspace are
  // one answer, and it is the PRD's own wording.
  if (!raw || raw.workspaceId !== test.workspaceId || typeof raw.candidateId !== "string") {
    throw refuse("invite_used");
  }
  return raw as InvitePayload;
}

/** The absolute origin links and callbacks are built from. `APP_URL` when
 *  it is configured, and the request's own origin when it is not — a
 *  self-hoster who has not set it still gets working links. */
const originOf = (deps: AppDeps, c: Context<AppBindings>): string =>
  (deps.env.appUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");

const candidatePath = (c: Context<AppBindings>): string =>
  `/${encodeURIComponent(c.req.param("workspaceSlug") ?? "")}/${encodeURIComponent(c.req.param("testSlug") ?? "")}`;

/**
 * Which provider the candidate leg uses.
 *
 * ponytail: the instance's first configured provider, overridable with
 * `?provider=`. `TestAccess` has no provider field, so there is nothing on
 * the test to read, and every instance this ships to has one. The upgrade
 * when one has two is a field in `access`, not a change here.
 *
 * **And on an instance with two it is load-bearing, not cosmetic.** The
 * verified address is this gate's identity (`listEntry` below), so a
 * caller choosing the provider chooses which issuer gets to assert it —
 * the same shape as the `email_code` laundering the final review found,
 * one level up. A second provider must land together with the `access`
 * field that pins which one a test accepts.
 */
const providerFor = (deps: AppDeps, c: Context<AppBindings>): string => {
  const providers = deps.env.oidcProviders ?? [];
  const requested = c.req.query("provider");
  if (requested) {
    const match = providers.find((p) => p.id === requested);
    if (!match) throw incomplete("Unknown identity provider.");
    return match.id;
  }
  return providers[0]?.id ?? "";
};

function ssoTest(test: PublishedTest): TestAccess {
  const access = test.settings.access;
  if ((access?.mode ?? "link_code") !== "sso") {
    throw incomplete("This test does not use single sign-on. Use the access form on the test page.");
  }
  return access as TestAccess;
}

export function runRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  // **Mounted before the slug-pair routes below, and that is
  // load-bearing.** Hono runs every handler whose path matches, in
  // registration order, so `GET /attempt/result` would otherwise be
  // answered by `GET /:workspaceSlug/:testSlug` — two segments match two
  // segments, and the landing handler throws its 404 before the static
  // route is ever reached. `GET /attempt` escapes that only by being one
  // segment. `resolvePublishedTest` refuses both of these first segments
  // as workspace slugs as well, so the two can never be confused even by
  // someone reading a log.

  // Task 5 (#69, P6.5): minting the attempt, resuming it, saving an
  // answer, the paper's images, and Task 11's submission and result.
  routes.route("/", attemptRoutes(deps));

  // Task 11 (#75, P6.11): `C-09`'s return visit, with no credential at
  // all — the attempt cookie is long gone by the time it is used.
  routes.route("/", resultRoutes(deps));

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

  // The one place all four modes end: a single-use `run_entry` token.
  routes.post("/:workspaceSlug/:testSlug/access", async (c) => {
    const parsed = accessRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw incomplete("That request could not be read. Try again.");
    const input = parsed.data;

    const test = await openTest(deps, c);
    // `S-07`: refusals are charged, successes are not — so 500 candidates
    // opening the one link they were given pay nothing, and this route's
    // measured budget is the same as it was before the limiter existed.
    return limitMisses(deps, "test_access", test.testVersionId, async () => {
    const access = test.settings.access;
    const mode: AccessMode = access?.mode ?? "link_code";

    // The three allowlists, before the mode's own gate.
    checkNetwork(c, access);
    checkDomain(access, input.email);
    // **When a mode verifies an identity, the list row is resolved from
    // that identity and never from the body.** `link_code` is the only
    // mode that verifies nothing about a person — a room code is all it
    // has — so it is the only one that may read the typed identifier.
    // The other three bind the row inside their own leg: from the
    // invite's payload, and from the address the mode proved.
    const entry = mode === "link_code" ? await listEntry(deps, test, input.identifier) : null;

    const claim: EntryClaim = { testVersionId: test.testVersionId, workspaceId: test.workspaceId };
    if (entry) claim.listRef = entry.id;

    switch (mode) {
      case "link_code": {
        const expected = access?.access_code ?? "";
        if (input.code === undefined) throw incomplete("Enter the access code from your invitation.");
        // Trimmed on the candidate's side only: a code pasted out of an
        // email arrives with a space more often than not, and that is not
        // a wrong code. The comparison itself is exact and constant-time.
        if (expected === "" || !(await sameSecret(input.code.trim(), expected))) throw refuse("code_wrong");
        break;
      }
      case "invite_only": {
        if (input.invite === undefined) throw incomplete("Open the invite link your organiser sent you.");
        const payload = await consumeInvite(deps, test, input.invite);
        // **By `external_id`, never by the `cnd_` id in the payload.** A
        // list re-upload deletes and re-inserts every unregistered row,
        // so each gets a fresh id while its `external_id` stays exactly
        // what the organiser chose — an invite that keyed on the row id
        // would be dead the moment an organiser fixed a typo and
        // re-uploaded, and 500 emailed links with it.
        const invited = await getCandidateByExternalId(
          deps.db,
          test.workspaceId,
          test.testId,
          payload.externalId,
        );
        // Refused, not admitted unbound. An invite whose identity is no
        // longer on the list belongs to a candidate the organiser has
        // removed; letting it through would make a listed test's
        // registration take the *unlisted* path — a row with no set and
        // no prefill, the bare-`link_code` re-entry branch reachable,
        // and a `(test_id, external_id)` collision with a surviving row
        // that has no claim behind it to turn into a 409. `code_wrong`
        // is the same refusal an off-list identifier gets, byte for
        // byte (`S-10`). The link is spent either way: the payload is
        // the only place the identity lives, so it cannot be checked
        // before the token is consumed.
        if (!invited) throw refuse("code_wrong");
        claim.listRef = invited.id;
        break;
      }
      case "email_code": {
        if (input.email === undefined || input.otp === undefined) {
          throw incomplete("Enter your email address and the code we sent you.");
        }
        const email = input.email.trim().toLowerCase();
        const spent = await consumeEmailCode(deps, {
          testVersionId: test.testVersionId,
          email,
          code: input.otp.trim(),
        });
        if (!spent) throw refuse("code_expired");
        // `T-21`, from the address the code just proved — the `sso` leg's
        // rule, and for the same reason. Reading `input.identifier` here
        // instead admitted anyone holding a code at their own inbox as
        // any listed candidate they could name.
        //
        // **After the redemption, never before.** A list check on the
        // typed address would answer `code_wrong` where a wrong code
        // answers `code_expired`, and that difference is a membership
        // oracle over the organiser's list to a caller holding no code
        // at all.
        //
        // A typed identifier is not the identity, so it is not looked up
        // — but one naming a different row is a mismatch, refused with
        // the same bytes as every other refusal (`S-10`). Compared as
        // normalised keys rather than as a second lookup, so the route
        // still spends what its budget says. A blank one is what the
        // gate's own form calls optional: ignored, not refused.
        const listed = await listEntry(deps, test, email);
        if (listed) {
          const typed = identityKey(test, input.identifier);
          if (typed !== "" && typed !== identityKey(test, email)) throw refuse("code_wrong");
          claim.listRef = listed.id;
        }
        break;
      }
      case "sso":
        throw incomplete("This test uses single sign-on. Use the sign-in button to continue.");
    }

    return c.json({ entryToken: await issueEntryToken(deps, claim) });
    });
  });

  // The `email_code` mode's first leg. 202 whatever happens next, because
  // the code goes to an inbox and the browser learns nothing from this.
  routes.post("/:workspaceSlug/:testSlug/email-code", async (c) => {
    const parsed = emailCodeRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw incomplete("Enter your email address.");

    const test = await openTest(deps, c);
    const access = test.settings.access;
    checkNetwork(c, access);
    if ((access?.mode ?? "link_code") !== "email_code") {
      throw incomplete("This test does not use an emailed code. Use the access form on the test page.");
    }
    // Before anything is sent: an open relay to any address a stranger
    // types is what skipping this would be.
    checkDomain(access, parsed.data.email);

    // `S-07`, and the most expensive route in the candidate runtime to
    // leave open: every call past this point writes a row **and** sends
    // a message to an address a stranger typed, so within an allowed
    // domain an unlimited `/email-code` is a mailbomb aimed at third
    // parties and an uncapped bill aimed at the operator.
    //
    // Charged **before** `issueEmailCode`, so a refusal costs neither.
    // Charged on every request rather than on misses alone, because here
    // the request *is* the cost — there is no "miss" to count, which is
    // the same reason `test_register` is charged outright.
    //
    // Two keys, never an address in the clear: the test version bounds
    // the spray, the digest of the normalised address bounds the bombing
    // of one inbox, and `normaliseEmail` is the same function
    // `emailCodeHash` uses, so a capital letter does not buy a second
    // allowance.
    await limitOrThrow(deps, "email_code", test.testVersionId);
    await limitOrThrow(
      deps,
      "email_code_address",
      await sha256Hex(normaliseEmail(parsed.data.email)),
    );

    const code = await issueEmailCode(deps, {
      testVersionId: test.testVersionId,
      workspaceId: test.workspaceId,
      email: parsed.data.email,
    });
    await (deps.email ?? emailSender(deps.env)).send({
      to: parsed.data.email.trim(),
      subject: `Your access code for ${test.name}`,
      text:
        `Your access code for ${test.name} is ${code}\n\n` +
        `The code works once and expires in ${String(EMAIL_CODE_TTL_MS / 60_000)} minutes. ` +
        "If you did not ask for it, nothing has happened and you can ignore this message.",
    });
    return c.json({ status: "sent" }, 202);
  });

  // The `sso` mode, which is the organiser OIDC flow's discovery, PKCE and
  // ID-token verification with the last step replaced: no user row, no
  // session cookie, a `run_entry` token instead (ADR 0005).
  routes.get("/:workspaceSlug/:testSlug/sso/start", async (c) => {
    const test = await openTest(deps, c);
    const access = ssoTest(test);
    checkNetwork(c, access);
    const { url } = await authorizationUrl(
      deps,
      providerFor(deps, c),
      candidatePath(c),
      deps.http,
      // The candidate's own callback, not the organiser's. It is stored
      // with the state, so the token exchange repeats the same value.
      `${originOf(deps, c)}/api/v1/run${candidatePath(c)}/sso/callback`,
    );
    return c.redirect(url, 302);
  });

  routes.get("/:workspaceSlug/:testSlug/sso/callback", async (c) => {
    const test = await openTest(deps, c);
    const access = ssoTest(test);
    checkNetwork(c, access);

    let email: string;
    try {
      ({ email } = await verifiedCallback(
        deps,
        providerFor(deps, c),
        { code: c.req.query("code") ?? "", state: c.req.query("state") ?? "" },
        deps.http,
      ));
    } catch (error) {
      // The one refusal a candidate can act on, restated for them: the
      // organiser flow's 400 is written for someone who can change the
      // provider configuration, and a candidate cannot.
      if (error instanceof ApiError && error.code === "email_not_verified") {
        throw new ApiError(
          401,
          "email_not_verified",
          "Your provider did not confirm this address is yours. Sign in with a verified address, or ask your organiser.",
        );
      }
      throw error;
    }

    checkDomain(access, email);
    // `T-21` for the one mode where the candidate types nothing: the
    // verified address is the identity, so it is what the list is checked
    // against.
    const entry = await listEntry(deps, test, email);

    const claim: EntryClaim = {
      testVersionId: test.testVersionId,
      workspaceId: test.workspaceId,
    };
    if (entry) claim.listRef = entry.id;
    const token = await issueEntryToken(deps, claim);
    // Back to the test the candidate started from, carrying the token —
    // and carrying no cookie, which is the whole point.
    //
    // In the query string, judged and kept (final review, minor): it is
    // single-use, dead in 30 minutes, and `Referrer-Policy: no-referrer`
    // (both `_headers` and `middleware/security.ts`) keeps it off every
    // onward request. What it does land in is an edge access log in
    // front of the static site, where a 30-minute replay window needs
    // the log *and* a candidate who has not yet reached `/register`. A
    // fragment would not, and is the upgrade — but it is a change on the
    // browser side of this redirect, which this wave does not own.
    return c.redirect(`${candidatePath(c)}?entry=${token}`, 302);
  });

  // Task 3 (#67, P6.3): consent and registration, behind the entry token
  // the four modes above all end in.
  routes.route("/", registrationRoutes(deps));

  return routes;
}
