// Consent and registration: the second thing a candidate does, and the
// first time the server stores anything they typed (`#67`, P6.3).
//
// Two routes, both behind the single-use `run_entry` token the access gate
// minted. `GET .../form` is what to show them; `POST .../register` is the
// server deciding whether it was valid, which is the only copy of that
// decision that counts (`docs/test-format.md:110`). The browser runs the
// same `validateRegistration` from `@pariksha/core`, which is what makes
// the inline sentence it shows byte-identical to the 422's.
//
// Three things here are not obvious from the plan and each is a ruling:
//
// 1. **A registration fills the candidate's list row in place.**
//    `(test_id, external_id)` is unique, so a second row is impossible
//    rather than untidy, and `set_label` has to survive or `assignSet`
//    loses the `listValue` a candidate's set is drawn from. `source`
//    therefore stops meaning "has this person registered" and
//    `consent_at` starts meaning it.
// 2. **A registered candidate coming back is not an error.** `T-14`'s
//    `attempts_allowed > 1`, a lost cookie, a different device: each
//    brings someone who has already registered back to this route. A 409
//    is right only when a unique value belongs to a *different*
//    candidate. Without this, every multi-attempt test is unusable after
//    the first attempt.
// 3. **The unique-field refusal is the user-visible one.** `T-17`'s
//    `candidate_unique` produces the 409 and positions it on the field;
//    `(test_id, external_id)` is the race backstop underneath, and maps
//    to the same envelope so it can never surface as a 500.

import { Hono, type Context } from "hono";
import { z } from "zod";
import {
  getCandidateById,
  insertAuthToken,
  newId,
  registerCandidate,
  type CandidateRow,
  type PublishedTest,
  type RegisterCandidateInput,
  type UniqueClaim,
} from "@pariksha/db";
import {
  CONSENT_KEY,
  CONSENT_REQUIRED_MESSAGE,
  normaliseUniqueValue,
  normaliseValues,
  uniqueFieldIds,
  validateRegistration,
  type FieldIssue,
  type FormField,
  type RegistrationFormSpec,
  type TestConsent,
} from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { sha256Hex, randomToken } from "../auth/tokens.js";
import { matchBounded } from "./bounded.js";
import { limitOrThrow } from "./limit.js";
import { captchaRequired, verifyCaptcha } from "./captcha.js";
import { POW_DIFFICULTY_BITS, powChallenge, verifyPow } from "./pow.js";
import {
  ENTRY_KIND,
  REGISTRATION_KIND,
  REGISTRATION_TTL_MS,
  entryHash,
  openTest,
  readEntryToken,
  refuse,
  registrationHash,
  type EntryClaim,
} from "./entry.js";

const registerRequest = z.object({
  /** Whatever the candidate filled in. Unknown keys are dropped by
   *  `normaliseValues` rather than refused: a form that gained a field
   *  since the tab was opened must not 400 the whole submission. */
  values: z.record(z.string(), z.unknown()).default({}),
  /** The hosted captcha's token, on an instance that configured one.
   *  Ignored by default, because by default none is (ADR 0009). */
  captchaToken: z.string().max(4000).optional(),
  /** The proof of work: a preimage whose digest over the challenge this
   *  entry token cuts has `POW_DIFFICULTY_BITS` leading zero bits. */
  solution: z.string().max(200).optional(),
});

/** The form a test declares, or an empty one — a test may legitimately ask
 *  a candidate for nothing but their consent. */
const formOf = (test: PublishedTest): RegistrationFormSpec =>
  test.settings.registration_form ?? { fields: [] };

const consentOf = (test: PublishedTest): TestConsent | null => test.settings.consent ?? null;

/**
 * The `Authorization: Bearer` entry token, read but not spent. Spending it
 * here would burn it on a page refresh; `registerCandidate` consumes it in
 * the same batch as the write.
 */
async function entryClaim(deps: AppDeps, c: Context<AppBindings>, test: PublishedTest): Promise<{
  token: string;
  claim: EntryClaim;
}> {
  const header = c.req.header("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (token === "") {
    throw new ApiError(
      401,
      "entry_required",
      "Start from the test page: this step needs the pass the access check gave you.",
    );
  }
  const claim = await readEntryToken(deps, test.testVersionId, token);
  if (!claim) throw refuse("entry_expired");
  return { token, claim };
}

/** The list row the gate bound this entry to, if it bound one. Read, not
 *  assumed: `registeredAt` is what tells a free row from one a sitting
 *  candidate's attempt already points at. */
async function listRow(
  deps: AppDeps,
  test: PublishedTest,
  claim: EntryClaim,
): Promise<CandidateRow | null> {
  if (claim.listRef === undefined) return null;
  return getCandidateById(deps.db, test.workspaceId, test.testId, claim.listRef);
}

/** A `run_registration` token for an existing candidate — the re-entry
 *  path, which writes nothing else. */
async function reissue(
  deps: AppDeps,
  test: PublishedTest,
  candidateId: string,
): Promise<string> {
  const token = randomToken();
  const now = deps.now();
  await insertAuthToken(deps.db, {
    tokenHash: await registrationHash(test.testVersionId, token),
    kind: REGISTRATION_KIND,
    payload: {
      workspaceId: test.workspaceId,
      testVersionId: test.testVersionId,
      candidateId,
    },
    now,
    expiresAt: now + REGISTRATION_TTL_MS,
  });
  return token;
}

const invalid = (issues: FieldIssue[]): ApiError =>
  new ApiError(422, "invalid_registration", "Some answers need another look.", { issues });

export function registrationRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  /**
   * What to put in front of the candidate: the consent text and version
   * (`S-12`), and the form.
   *
   * `S-10`: nothing here names a question, an access code or another
   * candidate. The prefill an organiser uploaded is deliberately **not**
   * returned either — it is the organiser's guess at someone's details
   * and the entry token is 30 minutes of anyone's browser history.
   */
  routes.get("/:workspaceSlug/:testSlug/form", async (c) => {
    const test = await openTest(deps, c);
    const { claim } = await entryClaim(deps, c, test);
    const row = await listRow(deps, test, claim);

    // `T-14`: already registered, and the gate recognised them. Skip the
    // form and hand back the token `/start` spends.
    const registrationToken =
      row?.registeredAt == null ? undefined : await reissue(deps, test, row.id);

    return c.json({
      consent: consentOf(test),
      form: formOf(test),
      ...(registrationToken !== undefined && { registered: true, registrationToken }),
    });
  });

  /**
   * The proof of work the registration below demands (`S-07`, ADR 0009).
   *
   * Behind the entry token on purpose: the challenge **is** a digest of
   * that token, so the route has nothing to mint, nothing to store and
   * nothing to expire — and a caller who has not passed the access gate
   * has no challenge to work on in the first place. `bits` is in the
   * response rather than compiled into the browser, so raising the
   * difficulty against an abusive deployment is an API deploy.
   */
  routes.get("/:workspaceSlug/:testSlug/challenge", async (c) => {
    const test = await openTest(deps, c);
    const { token } = await entryClaim(deps, c, test);
    return c.json({ challenge: await powChallenge(token), bits: POW_DIFFICULTY_BITS });
  });

  /**
   * The server's decision. The order is: read the entry token, check the
   * proof of work, charge the volume limit, validate, hash the unique
   * values, then **one** `db.batch` so a `UNIQUE` violation rolls the
   * whole registration back.
   */
  routes.post("/:workspaceSlug/:testSlug/register", async (c) => {
    const test = await openTest(deps, c);
    const { token, claim } = await entryClaim(deps, c, test);

    const parsed = registerRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "That form could not be read. Try again.");
    }
    // `S-07`'s bot protection, before a line of the submission is looked
    // at: a caller who did not pay for this registration does not get the
    // server's opinion of their form values either. Costs no subrequest —
    // the challenge is a digest of the token already in hand — so the
    // route's measured budget is what it was without it.
    if (!(await verifyPow(token, parsed.data.solution))) throw refuse("bot_check_failed");
    // Charged on every registration, not only on refusals: a registration
    // *is* the volume. Sized at twice the PRD's capacity row, so the
    // cohort it protects cannot reach it.
    //
    // **Below the proof of work, and that is the whole of the defence.**
    // Charged above it, a bucket token cost one bare POST with no body
    // and no solution — and `/access` never charges a success while
    // `readEntryToken` does not consume, so one reusable entry token and
    // ~1000 empty posts emptied the five-minute bucket and answered
    // every real candidate 429 for the rest of the window. The proof of
    // work bounds nothing it is charged after.
    await limitOrThrow(deps, "test_register", test.testVersionId);
    // The per-instance opt-in, and a no-op on an instance that configured
    // no provider — which is every default one (`AC-01`).
    if (
      captchaRequired(deps, test.settings.access) &&
      !(await verifyCaptcha(deps, parsed.data.captchaToken))
    ) {
      throw refuse("bot_check_failed");
    }

    const submitted = parsed.data.values;
    const form = formOf(test);
    const consent = consentOf(test);

    // `S-12`: consent is its own answer, not a form field — it is stored
    // as a version and a time so a later edit to the text stays
    // distinguishable from someone who accepted the earlier one.
    const issues = validateRegistration(form, submitted, { matcher: matchBounded });
    if (consent !== null && submitted[CONSENT_KEY] !== true) {
      issues.unshift({
        field: CONSENT_KEY,
        code: "required",
        message: CONSENT_REQUIRED_MESSAGE,
      });
    }
    if (issues.length > 0) throw invalid(issues);

    const values = normaliseValues(form, submitted);
    const uniques = uniqueFieldIds(form);
    const byId = new Map(form.fields.map((field) => [field.id, field]));
    const claims: UniqueClaim[] = [];
    for (const fieldId of uniques) {
      const field = byId.get(fieldId) as FormField;
      const normalised = normaliseUniqueValue(field, submitted[fieldId]);
      if (normalised === "") continue;
      claims.push({ fieldId, valueHash: await sha256Hex(`${test.testId}:${fieldId}:${normalised}`) });
    }
    // The identity field's own value, written on a self-registration too:
    // without it `(test_id, external_id)` is a backstop only uploads ever
    // populate, and a public test has none at all.
    const identity = uniques[0];
    const externalId =
      identity === undefined
        ? null
        : normaliseUniqueValue(byId.get(identity) as FormField, submitted[identity]) || null;

    const row = await listRow(deps, test, claim);
    // Already registered on this row: re-entry, not a refusal. The write
    // is skipped entirely, so nothing a sitting candidate typed can be
    // overwritten by a second person presenting the same identifier.
    if (row?.registeredAt != null) {
      return c.json({ registrationToken: await reissue(deps, test, row.id) });
    }

    // **On a listed test the gate already settled who this is.** Without
    // this, `21CS0148` passes the gate as themselves and submits
    // `21CS0147`'s roll number: the write fills `21CS0148`'s row but
    // claims `21CS0147`'s identity in `candidate_unique`, so the real
    // `21CS0147` is refused 409 for the rest of the window with no
    // operator path to clear the claim — and the row's stored answers
    // disagree with its own `external_id`, so Phase 8 exports the wrong
    // identity for them. A mistyped roll number does it by accident.
    //
    // This is M17's hole entered from the other end: that one closed
    // re-entry by *values* on a listed test (`row === null` gates it),
    // this closes registration by someone else's *identity*. Ruling 7's
    // "do not refuse a returning candidate" is about the person the gate
    // recognised, never about a different one.
    if (row !== null && identity !== undefined && (externalId ?? "") !== (row.externalId ?? "")) {
      throw invalid([
        {
          field: identity,
          code: "identity_mismatch",
          message: "This does not match the ID you were admitted with. Check what you typed.",
        },
      ]);
    }

    // `row === null` on a test that *has* a candidate list should now be
    // unreachable — every mode either binds a list row or refuses before
    // minting an entry token. It is refused rather than left to the
    // self-registration path because that path would write an unlisted
    // row on a listed test, open the bare-`link_code` re-entry branch
    // Ruling 7 confined to tests with no list, and break the premise the
    // failure path rests on (a `(test_id, external_id)` collision always
    // has a claim behind it — an uploaded row carries none, so the
    // collision would re-throw as a 500 on a candidate path).
    if (row === null && test.settings.access?.candidate_list) throw refuse("code_wrong");

    const now = deps.now();
    const registrationToken = randomToken();
    // Minted here rather than in the repository, so the registration
    // token written inside the same batch already names the candidate it
    // belongs to — otherwise a self-registration would cost a second
    // write to fill the payload in.
    const candidateId = row?.id ?? newId("cnd");
    const input: RegisterCandidateInput = {
      testId: test.testId,
      candidateId,
      listRef: row?.id ?? null,
      externalId: row === null ? externalId : null,
      formValues: values,
      consentVersion: consent?.version ?? "",
      consentAt: now,
      claims,
      entryTokenHash: await entryHash(test.testVersionId, token),
      entryKind: ENTRY_KIND,
      registration: {
        tokenHash: await registrationHash(test.testVersionId, registrationToken),
        kind: REGISTRATION_KIND,
        payload: {
          workspaceId: test.workspaceId,
          testVersionId: test.testVersionId,
          candidateId,
        },
        expiresAt: now + REGISTRATION_TTL_MS,
      },
      now,
    };
    const result = await registerCandidate(deps.db, test.workspaceId, input);

    if ("taken" in result) {
      const owners = new Set(result.taken.map((one) => one.candidateId));
      // Every unique value belongs to one existing candidate: that is the
      // same person coming back, which `T-14` requires to work. One value
      // belonging to someone else — or two values split across two
      // candidates — is the refusal `C-03` names.
      //
      // **Only when the gate bound this entry to no list row** (`row ===
      // null`, the bare `link_code` case the room code was the whole
      // barrier for). On a listed test the gate already said *which*
      // candidate this is, and a candidate admitted as `21CS0148` who
      // types `21CS0147`'s details must not be handed `21CS0147` — the
      // listed re-entry path is `/form`'s `registeredAt` branch, which
      // reissues for the row the gate named and nobody else's.
      if (row === null && owners.size === 1 && result.taken.length === claims.length && claims.length > 0) {
        const [candidateId] = [...owners];
        return c.json({ registrationToken: await reissue(deps, test, candidateId as string) });
      }
      const fields = [...new Set(result.taken.map((one) => one.fieldId))].sort();
      throw new ApiError(
        409,
        "already_registered",
        "Someone has already registered with that. Check what you typed, or contact your organiser.",
        { fields },
      );
    }

    void result;
    return c.json({ registrationToken }, 201);
  });

  return routes;
}
