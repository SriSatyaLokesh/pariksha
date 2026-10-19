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
  /** Task 4's proof of work. Accepted and ignored until it lands, so the
   *  browser's request shape does not change when it does. */
  captchaToken: z.string().max(4000).optional(),
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
   * The server's decision. The order is: read the entry token, charge the
   * volume limit, validate, hash the unique values, then **one**
   * `db.batch` so a `UNIQUE` violation rolls the whole registration back.
   */
  routes.post("/:workspaceSlug/:testSlug/register", async (c) => {
    const test = await openTest(deps, c);
    const { token, claim } = await entryClaim(deps, c, test);
    // Charged on every registration, not only on refusals: a registration
    // *is* the volume. Sized at twice the PRD's capacity row, so the
    // cohort it protects cannot reach it.
    await limitOrThrow(deps, "test_register", test.testVersionId);

    const parsed = registerRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "That form could not be read. Try again.");
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
        message: "Tick the box to say you have read and accepted this.",
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
