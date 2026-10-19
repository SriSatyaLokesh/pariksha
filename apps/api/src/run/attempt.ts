// Minting the attempt: the row every later request in the candidate
// runtime reads (`#69`, P6.5).
//
// `/start` spends the single-use `run_registration` token, decides which
// set this candidate sits, draws their paper once, and writes one row
// carrying the version it drew from, the pinned paper, the media keys
// that paper may load, the deadline and the digest of a 256-bit token.
// Everything after it — the runner, the autosave, the timer, the
// navigation rule, the submission, the result — reads that row.
//
// Four decisions here are load-bearing and each is a ruling:
//
// 1. **The candidate comes from the token's payload and from nowhere
//    else.** This route reads no body at all. Task 3's ownership audit
//    found one path it could not bind — on a bare `link_code` test with
//    no candidate list, knowing another candidate's unique values yields
//    their registration token — so the token is the *only* proof of
//    identity the runtime has, and an id, an email or an external id in
//    a request body would be a second, weaker one beside it.
//
// 2. **The paper is pinned here and never recomputed.** `layout_json`
//    carries the selection, the option order *and* the scrubbed
//    questions. Questions are mutable rows with no version of their own:
//    under a re-read, an author's edit mid-window would change a live
//    paper and a deletion would throw on resume, locking a candidate out
//    with every answer stranded. `AC-11`'s "a refresh keeps each order"
//    and `AC-14`'s "resumes with the same questions" are properties of
//    reading one column. Scoring (Phase 8) still reads the live key,
//    which is the half that must stay live so a regrade works.
//
// 3. **Every throw out of the layout is a 409, never a 500.**
//    `PoolTooSmallError` is the documented one, but `findQuestion` throws
//    a plain `Error` for a fixed or sets question that has been deleted
//    since publish, and that is the *likely* stale case — `pool_short` is
//    advisory at publish and `deleteQuestion` is not refused for a
//    published test. A candidate must be told the paper is unavailable
//    and the organiser must get an audit row, not a stack trace.
//
// 4. **A live attempt is 409, not a second row.** Minting again would
//    orphan the first attempt's answers, and rotating `token_hash` would
//    kill the tab that is still working.

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import {
  appendAudit,
  countAttemptsForCandidate,
  countAttemptsForVersion,
  consumeAuthToken,
  createAttempt,
  getCandidateById,
  instant,
  listResponses,
  newId,
  workspaceGroups,
  workspaceQuestions,
  type PublishedTest,
} from "@pariksha/db";
import {
  assignSet,
  layoutForAttempt,
  PoolTooSmallError,
  type AttemptLayout,
  type NavigationMode,
  type PassageGroup,
  type Question,
  type ResponseValue,
  type Section,
  type SetAssignment,
  type TestTiming,
} from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import { ATTEMPT_COOKIE, attemptContext } from "../middleware/attemptContext.js";
import { openTest, REGISTRATION_KIND, refuse, registrationHash } from "./entry.js";
import { forCandidate, mediaKeysOf, type CandidateQuestion } from "./scrub.js";

/** Re-exported here because this is where the brief names it; it is
 *  declared in `middleware/attemptContext.ts`, the module that reads it. */
export { ATTEMPT_COOKIE } from "../middleware/attemptContext.js";

/** How long past the deadline the cookie survives, so the candidate can
 *  still read their receipt and result on the finish page. */
export const RECEIPT_WINDOW_MS = 60 * 60_000;

/** Reconciliation row 8: `timing` is optional on `Test` and these
 *  defaults live only in the builder UI, so the server applies its own —
 *  the same `??` shape `landingPayload` uses, stated at each use rather
 *  than through a module nothing else would import. */
const DEFAULT_WARN_AT = [10, 2];
const DEFAULT_GRACE_SECONDS = 30;

export interface PaperSection {
  id: string;
  title: string;
  instructions: string | null;
  timeLimitMinutes: number | null;
  questions: CandidateQuestion[];
}

/**
 * What `attempt.layout_json` holds.
 *
 * `AttemptLayout` is `@pariksha/core`'s selection — section by section,
 * which question ids in which order and which option order — and Phase 8
 * scores against it. `media` is every storage key those questions
 * reference, which is what Task 7's media route authorises by membership
 * in. `paper` is the same questions already scrubbed for the candidate,
 * which is what makes a resume one read of one column.
 */
export type PinnedLayout = AttemptLayout & { media: string[]; paper: PaperSection[] };

/** `auth_token.payload_json` for a `run_registration` row (Task 3). */
export interface RegistrationClaim {
  workspaceId: string;
  testVersionId: string;
  candidateId: string;
}

/** The one payload `/start` and `GET /attempt` both answer with. */
export interface AttemptPaper {
  attemptId: string;
  sections: PaperSection[];
  /** The set label this candidate drew, when the test has sets (`T-09`).
   *  The **label**, not `attempt.set_no`: the column is an integer index
   *  and the label is what a receipt and a regrade have to agree on. */
  setNo?: string;
  responses: Record<string, ResponseValue | null>;
  navigation: NavigationMode;
  maxIndex: number;
  remainingMs: number;
  sectionRemainingMs: number | null;
  warnAtMinutes: number[];
  lateSyncGraceSeconds: number;
  /** `docs/test-format.md` puts this in the `proctoring.overrides` table,
   *  not at the top level of the document. */
  allowCalculator: boolean;
  /** `AC-13`'s anchor: the browser's countdown is a delta from this. */
  serverNow: number;
  submittedAt: number | null;
}

// --- reading the version's settings ------------------------------------

interface Proctoring {
  overrides?: { allow_calculator?: boolean };
}

const timingOf = (settings: unknown): Partial<TestTiming> =>
  (settings as { timing?: Partial<TestTiming> }).timing ?? {};

const graceMsOf = (settings: unknown): number =>
  (timingOf(settings).late_sync_grace_seconds ?? DEFAULT_GRACE_SECONDS) * 1000;

const allowCalculator = (settings: unknown): boolean =>
  (settings as { proctoring?: Proctoring }).proctoring?.overrides?.allow_calculator ?? false;

// --- refusals ----------------------------------------------------------

const conflict = (code: string, message: string, details?: unknown): ApiError =>
  new ApiError(409, code, message, details);

/**
 * The stale-version refusals. All 409, all audited, never a 500: a
 * published version goes stale the moment a question it draws is
 * deleted, and the only person who can fix it is the organiser.
 */
async function unavailable(
  deps: AppDeps,
  test: PublishedTest,
  code: string,
  message: string,
  details: Record<string, unknown>,
): Promise<never> {
  await appendAudit(deps.db, test.workspaceId, {
    actor: "candidate",
    action: `attempt.${code}`,
    target: test.testVersionId,
    detail: details,
    now: deps.now(),
  });
  throw conflict(code, message, details);
}

const STALE_MESSAGE =
  "This paper cannot be prepared right now. Tell your organiser, then try again — nothing you have done is lost.";

// --- the set a candidate sits ------------------------------------------

const setsSectionOf = (sections: Section[]): Section | undefined =>
  sections.find((section) => section.source.kind === "sets");

/**
 * Which set, as an index for the column and a label for the layout.
 *
 * `T-09`'s `from_candidate_list` reads the label off the candidate's own
 * list row. Three things can go wrong with that and each has a ruling:
 *
 *  * **No list row, or a null `set_label`** — the CSV's `set` column is
 *    optional and `candidate_no_set` is only advisory at publish. Falling
 *    back to `round_robin` for that candidate keeps them sitting a real
 *    paper; the row stays null and the attempt carries the label it got,
 *    which is the only truth Phase 8 should read.
 *  * **A label no `sets` section carries** — the CSV was validated
 *    against the *draft* and publish does not re-check it. 409
 *    `set_unknown`, audited, naming the label: `pickQuestions` would
 *    otherwise throw a plain `Error` and 500 on the candidate.
 *  * **Two `sets` sections whose labels disagree** — one integer column
 *    cannot express it, so the integer is the index into the **first**
 *    `sets` section and the label in `layout_json` is authoritative.
 */
async function setForAttempt(
  deps: AppDeps,
  test: PublishedTest,
  candidateId: string,
): Promise<{ label: string | undefined; index: number }> {
  const section = setsSectionOf(test.sections);
  if (!section || section.source.kind !== "sets") return { label: undefined, index: 0 };

  const labels = section.source.sets.map((one) => one.set);
  const assignment: SetAssignment = section.source.assignment ?? "round_robin";

  let listValue: string | undefined;
  if (assignment === "from_candidate_list") {
    const row = await getCandidateById(deps.db, test.workspaceId, test.testId, candidateId);
    listValue = row?.setLabel ?? undefined;
    if (listValue !== undefined && !labels.includes(listValue)) {
      await unavailable(deps, test, "set_unknown", STALE_MESSAGE, {
        section: section.id,
        set: listValue,
      });
    }
  }

  // Round robin and random need a running counter; `hash` and a list
  // value need none, so a test that uses those never pays for the read.
  const needsIndex = listValue === undefined && assignment !== "hash";
  const registrationIndex = needsIndex
    ? await countAttemptsForVersion(deps.db, test.workspaceId, test.testVersionId)
    : 0;

  const label = assignSet({
    sets: labels,
    assignment: listValue === undefined && assignment === "from_candidate_list" ? "round_robin" : assignment,
    registrationIndex,
    candidateId,
    ...(listValue === undefined ? {} : { listValue }),
  });
  return { label, index: Math.max(0, labels.indexOf(label)) };
}

// --- drawing the paper -------------------------------------------------

/** The first fixed or sets question a section names that the bank no
 *  longer holds. Walked only on the error path, in memory, so the 409 can
 *  name what an organiser has to fix instead of parsing a message. */
function missingReference(sections: Section[], bank: readonly Question[]): { section: string; question: string } | null {
  const known = new Set(bank.map((q) => q.id));
  for (const section of sections) {
    const source = section.source;
    const named =
      source.kind === "fixed"
        ? source.questions
        : source.kind === "sets"
          ? source.sets.flatMap((one) => one.questions)
          : [];
    for (const id of named) {
      if (!known.has(id)) return { section: section.id, question: id };
    }
  }
  return null;
}

function paperSections(
  test: PublishedTest,
  layout: AttemptLayout,
  byId: Map<string, { question: Question; bankId: string }>,
  groups: Map<string, PassageGroup>,
): PaperSection[] {
  const sectionById = new Map(test.sections.map((section) => [section.id, section]));
  return layout.sections.map((pinned) => {
    const section = sectionById.get(pinned.sectionId) as Section;
    return {
      id: section.id,
      title: section.title,
      instructions: section.instructions ?? null,
      timeLimitMinutes: section.time_limit_minutes ?? null,
      questions: pinned.questionIds.map((id) => {
        const held = byId.get(id) as { question: Question; bankId: string };
        const group =
          held.question.group === undefined
            ? undefined
            : groups.get(`${held.bankId}:${held.question.group}`);
        return forCandidate(held.question, {
          ...(pinned.optionOrder[id] === undefined ? {} : { optionOrder: pinned.optionOrder[id] }),
          // Task 7 turns a storage key into a URL; until then the paper
          // carries the key `layout.media` was pinned from.
          mediaBase: "",
          ...(group === undefined ? {} : { group }),
        });
      }),
    };
  });
}

// --- the paper, from a row ---------------------------------------------

/** Which section a flat question index falls in, and where that section
 *  starts. One walk, so `linear` and `per_section` read the same number. */
function sectionAt(sections: PaperSection[], index: number): PaperSection | undefined {
  let seen = 0;
  for (const section of sections) {
    seen += section.questions.length;
    if (index < seen) return section;
  }
  return sections[sections.length - 1];
}

export function paperFrom(input: {
  attemptId: string;
  layout: PinnedLayout;
  settings: unknown;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  sectionStartedAt: number | null;
  maxIndex: number;
  responses: Record<string, ResponseValue | null>;
  now: number;
}): AttemptPaper {
  const timing = timingOf(input.settings);
  const current = sectionAt(input.layout.paper, input.maxIndex);
  const limit = current?.timeLimitMinutes ?? null;
  return {
    attemptId: input.attemptId,
    sections: input.layout.paper,
    ...(input.layout.setNo === undefined ? {} : { setNo: input.layout.setNo }),
    responses: input.responses,
    navigation: timing.navigation ?? "free",
    maxIndex: input.maxIndex,
    remainingMs: Math.max(0, input.deadlineAt - input.now),
    sectionRemainingMs:
      limit === null
        ? null
        : Math.max(0, (input.sectionStartedAt ?? input.startedAt) + limit * 60_000 - input.now),
    warnAtMinutes: timing.warn_at_minutes ?? DEFAULT_WARN_AT,
    lateSyncGraceSeconds: timing.late_sync_grace_seconds ?? DEFAULT_GRACE_SECONDS,
    allowCalculator: allowCalculator(input.settings),
    serverNow: input.now,
    submittedAt: input.submittedAt,
  };
}

// --- the start gate ----------------------------------------------------

export async function startAttempt(
  deps: AppDeps,
  test: PublishedTest,
  claim: RegistrationClaim,
  now: number,
): Promise<{ attemptId: string; token: string; deadlineAt: number; paper: AttemptPaper }> {
  const timing = timingOf(test.settings);

  // `T-12`. `openTest` has already refused anything `deriveState` calls
  // shut; this is the separate rule `deriveState` does not consider —
  // "you may sit this test, but not start it this late". Uncapped by
  // `closes_at` on purpose: `docs/test-format.md` makes
  // `latest_start_at` the organiser's hard close, and a deadline clipped
  // to `closes_at` would hand the last candidate a shorter paper.
  const latestStart = instant(timing.latest_start_at) ?? instant(timing.closes_at);
  if (latestStart !== null && now > latestStart) throw refuse("window_closed");

  // `T-14`, against the candidate the token names and no other.
  const attempts = await countAttemptsForCandidate(
    deps.db,
    test.workspaceId,
    claim.candidateId,
    // An attempt inside its late-sync grace is still live: its last
    // answers may yet arrive, and a second row would strand them.
    now - graceMsOf(test.settings),
  );
  if (attempts.liveDeadlineAt !== null) {
    throw conflict(
      "attempt_in_progress",
      "You already have this test open. Open it in the browser you started it in; a different device needs a proctor to unlock it.",
    );
  }
  const allowed = timing.attempts_allowed ?? 1;
  if (attempts.count >= allowed) {
    throw conflict(
      "attempts_exhausted",
      allowed === 1
        ? "You have already taken this test. Contact your organiser if you think that is wrong."
        : `You have used all ${String(allowed)} attempts at this test. Contact your organiser if you think that is wrong.`,
      { attemptsAllowed: allowed, attemptsUsed: attempts.count },
    );
  }
  const cooldownMs = (timing.cooldown_minutes ?? 0) * 60_000;
  const readyAt = (attempts.lastEndedAt ?? 0) + cooldownMs;
  if (cooldownMs > 0 && attempts.lastEndedAt !== null && now < readyAt) {
    const retryAfterSeconds = Math.ceil((readyAt - now) / 1000);
    throw conflict(
      "cooldown_active",
      `This test asks you to wait ${String(timing.cooldown_minutes ?? 0)} minutes between attempts. Try again shortly.`,
      { retryAfterSeconds },
    );
  }

  const { label, index } = await setForAttempt(deps, test, claim.candidateId);

  // The bank, exactly as `checklistFor` builds it: the whole workspace's
  // questions re-keyed by **row id**, because a stored `fixed` or `sets`
  // section names `qst_` row ids and not the bank file's `ref_id`. One
  // statement, never one per question.
  const held = await workspaceQuestions(deps.db, test.workspaceId);
  const bank: Question[] = held.map((one) => ({ ...one.document, id: one.id }));

  // The id first, because it is the shuffle seed: the order is
  // reproducible from the row and nothing else has to store a seed.
  const attemptId = newId("att");
  let layout: AttemptLayout;
  try {
    layout = layoutForAttempt({
      sections: test.sections,
      bank,
      seed: attemptId,
      ...(label === undefined ? {} : { setNo: label }),
    });
  } catch (error) {
    if (error instanceof PoolTooSmallError) {
      await unavailable(deps, test, "pool_too_small", STALE_MESSAGE, {
        section: error.sectionId,
        wanted: error.wanted,
        available: error.available,
      });
    }
    // Everything else out of the layout, and there are three sources:
    // a deleted `fixed` or `sets` question (`findQuestion`), a set label
    // no section carries, and an assignment with no value. Each would be
    // a 500 on a candidate's screen; each is this 409 instead.
    await unavailable(deps, test, "paper_unavailable", STALE_MESSAGE, {
      ...(missingReference(test.sections, bank) ?? {}),
    });
    throw error; // unreachable: `unavailable` never returns
  }

  const byId = new Map(held.map((one) => [one.id, { question: { ...one.document, id: one.id }, bankId: one.bankId }]));
  const selected = layout.sections.flatMap((section) =>
    section.questionIds.map((id) => (byId.get(id) as { question: Question }).question),
  );
  // Read only when a selected question actually shares a passage, so a
  // test with no comprehension sections never pays for it.
  const groups = selected.some((question) => question.group !== undefined)
    ? await workspaceGroups(deps.db, test.workspaceId)
    : new Map<string, PassageGroup>();

  const pinned: PinnedLayout = {
    ...layout,
    media: mediaKeysOf(selected),
    paper: paperSections(test, layout, byId, groups),
  };

  const token = randomToken();
  // `AC-13`: from the server's clock, and **not** clipped to `closes_at`.
  const deadlineAt = now + (timing.duration_minutes ?? 0) * 60_000;
  await createAttempt(deps.db, test.workspaceId, {
    id: attemptId,
    candidateId: claim.candidateId,
    testVersionId: test.testVersionId,
    setNo: index,
    layout: pinned,
    startedAt: now,
    deadlineAt,
    tokenHash: await sha256Hex(token),
  });

  return {
    attemptId,
    token,
    deadlineAt,
    paper: paperFrom({
      attemptId,
      layout: pinned,
      settings: test.settings,
      startedAt: now,
      deadlineAt,
      submittedAt: null,
      sectionStartedAt: null,
      maxIndex: 0,
      responses: {},
      now,
    }),
  };
}

// --- the routes --------------------------------------------------------

export function attemptRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  /**
   * Mint the attempt.
   *
   * **This handler reads no request body.** The candidate is whoever the
   * `run_registration` token names and nobody else; an id, an email or
   * an external id alongside it would be a second identity claim the
   * server would have to choose between, and Task 3's audit is explicit
   * that on a bare `link_code` test the token is the only binding there
   * is.
   *
   * The token is consumed *before* the paper is drawn, so two tabs
   * pressing Start together cannot both mint an attempt — the
   * single-use `UPDATE … WHERE used_at IS NULL RETURNING` is the lock.
   * A candidate refused after it is spent is not stranded: the gate and
   * `GET .../form` recognise a registered candidate and reissue.
   */
  routes.post("/:workspaceSlug/:testSlug/start", async (c) => {
    const test = await openTest(deps, c);
    const header = c.req.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (token === "") {
      throw new ApiError(
        401,
        "registration_required",
        "Start from the test page: this step needs the pass your registration gave you.",
      );
    }
    const payload = (await consumeAuthToken(
      deps.db,
      await registrationHash(test.testVersionId, token),
      REGISTRATION_KIND,
      deps.now(),
    )) as Partial<RegistrationClaim> | null;
    // Unknown, expired, already spent and minted for another test are one
    // answer, the way the gate's are: none of them is distinguishable to
    // the person holding it, and telling them apart would say whether a
    // token ever existed.
    if (
      !payload ||
      payload.workspaceId !== test.workspaceId ||
      payload.testVersionId !== test.testVersionId ||
      typeof payload.candidateId !== "string"
    ) {
      throw refuse("entry_expired");
    }

    const now = deps.now();
    const started = await startAttempt(deps, test, payload as RegistrationClaim, now);
    setCookie(c, ATTEMPT_COOKIE, started.token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      // Narrower than the session cookie's `/`: nothing outside the
      // candidate runtime has any use for it.
      path: "/api/v1/run",
      // Past the deadline by the late-sync grace and the time it takes to
      // read a receipt — the finish page is `GET /attempt` after submit.
      maxAge: Math.ceil(
        (started.deadlineAt - now + graceMsOf(test.settings) + RECEIPT_WINDOW_MS) / 1000,
      ),
    });
    // The body never carries the token. It is in the cookie, which rides
    // every fetch on its own and no script can read (`S-06`).
    return c.json(started.paper, 201);
  });

  /**
   * Resume. The cookie travels on its own, so this takes nothing at all.
   *
   * Two reads: the attempt with its version settings, and the answers.
   * The paper itself is not rebuilt — it is the column `/start` pinned,
   * which is what makes `AC-14` and `C-06` properties of storage rather
   * than of the bank holding still for 45 minutes.
   */
  routes.get("/attempt", attemptContext(deps), async (c) => {
    const attempt = c.get("attempt");
    const rows = await listResponses(deps.db, attempt.workspaceId, attempt.attemptId);
    const responses: Record<string, ResponseValue | null> = {};
    for (const row of rows) responses[row.questionId] = row.value as ResponseValue | null;
    return c.json(
      paperFrom({
        attemptId: attempt.attemptId,
        layout: attempt.layout,
        settings: attempt.settings,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        submittedAt: attempt.submittedAt,
        sectionStartedAt: attempt.sectionStartedAt,
        maxIndex: attempt.maxIndex,
        responses,
        now: deps.now(),
      }),
    );
  });

  return routes;
}
