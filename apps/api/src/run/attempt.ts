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
import { z } from "zod";
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
  submitAttempt,
  upsertResponse,
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
} from "@pariksha/core";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { randomToken, sha256Hex } from "../auth/tokens.js";
import { ATTEMPT_COOKIE, attemptContext } from "../middleware/attemptContext.js";
import { openTest, REGISTRATION_KIND, refuse, registrationHash } from "./entry.js";
import { forCandidate, mediaKeysOf, type CandidateQuestion } from "./scrub.js";
import { EXT_MEDIA_TYPE } from "../routes/media.js";
import {
  assertSectionOpen,
  assertWritable,
  clockOf,
  currentSectionIndex,
  graceMsOf,
  TIMING_DEFAULTS,
  timedOut,
  timingOf,
} from "./clock.js";
import { assertReachable, indexOf, sectionIndexOf } from "./navigation.js";

/** Re-exported here because this is where the brief names it; it is
 *  declared in `middleware/attemptContext.ts`, the module that reads it. */
export { ATTEMPT_COOKIE } from "../middleware/attemptContext.js";

/** How long past the deadline the cookie survives, so the candidate can
 *  still read their receipt and result on the finish page. */
export const RECEIPT_WINDOW_MS = 60 * 60_000;

/**
 * What every `media.src` on a pinned paper is prefixed with (Task 7,
 * #71). The scrubber takes it as `mediaBase`, so a storage key becomes a
 * URL in exactly one place, and the route below is the only thing that
 * answers it: a candidate's browser never names
 * `GET /workspaces/:id/media/:key`, which keeps its `banks.edit` guard
 * (standing decision 4).
 */
export const MEDIA_BASE = "/api/v1/run/attempt/media/";

/**
 * The save path (Task 8, #72), as one constant.
 *
 * `ROUTE_BUDGETS` keys on the mounted path and the browser's queue posts
 * to it; naming it once keeps the declared budget, the measured budget
 * and the URL from drifting apart in three files.
 */
export const ANSWER_PATH = "/api/v1/run/attempt/answer";

/**
 * The longest text one answer may carry, in characters of JSON string.
 *
 * A trust boundary, not a product rule: `max_length` is per question and
 * belongs to grading, but *something* has to stop a candidate's browser —
 * or a script wearing its cookie — from writing a megabyte into a D1 row
 * on a 100,000-write daily budget. Generous enough that no real
 * `long_answer` meets it.
 */
export const MAX_ANSWER_TEXT = 50_000;

/**
 * `ResponseValue`, at the door.
 *
 * `@pariksha/core` declares the union as a type and the graders are
 * already defensive about it (`r.kind === "number"` and so on), so this
 * is not about correctness downstream — it is about never storing a shape
 * nobody will ever be able to read, and about bounding what one row can
 * hold. The nine arms are `ResponseValue`'s nine arms; a tenth added
 * there without a line here is a 400 on a real answer, which is a failing
 * test rather than a silent acceptance.
 */
const answerText = z.string().max(MAX_ANSWER_TEXT);
const answerKey = z.string().min(1).max(400);
const answerList = z.array(answerKey).max(400);

const responseValue: z.ZodType<ResponseValue> = z.union([
  z.object({ kind: z.literal("option"), option: answerKey }),
  z.object({ kind: z.literal("options"), options: answerList }),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }),
  z.object({ kind: z.literal("map"), pairs: z.record(answerKey, answerKey) }),
  z.object({ kind: z.literal("multimap"), pairs: z.record(answerKey, answerList) }),
  z.object({ kind: z.literal("order"), items: answerList }),
  z.object({ kind: z.literal("blanks"), values: z.record(answerKey, answerText) }),
  z.object({ kind: z.literal("number"), value: z.number().finite() }),
  z.object({ kind: z.literal("text"), text: answerText }),
]);

const answerRequest = z.object({
  questionId: z.string().min(1).max(200),
  /** `null` is a cleared answer, which is a save and not an absence. */
  value: responseValue.nullable(),
  /** The browser's own monotonic counter. `upsertResponse` compares it,
   *  and `AttemptPaper.clientSeq` is what a fresh client seeds it from. */
  clientSeq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

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
  /**
   * The highest `client_seq` the server holds for this attempt, and 0 on
   * a fresh one — **the seed for the browser's own counter** (Task 8).
   *
   * Without it, a second tab or a wiped `localStorage` restarts that
   * counter at 1, every save comes back `superseded` because
   * `upsertResponse` stores only a strictly higher sequence, the queue
   * drops each one as "the server holds newer", and the candidate is
   * shown "Saved" over answers that were never written. It is the one
   * data-loss path in this design that passes every other test.
   */
  clientSeq: number;
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
  /**
   * What actually threw, for the **audit row only**.
   *
   * Converting every throw into an `ApiError` means this path never
   * reaches `errorEnvelope`, which is the one place a non-`ApiError` is
   * logged with its message and stack — so without this the next genuine
   * defect in the selection code ships as a 409 reading "tell your
   * organiser", and the organiser is sent to fix a bank that is not
   * broken. The audit row is same-tenant and organiser-facing, which is
   * the right home for it; the candidate's body keeps `details` and
   * nothing more.
   */
  diagnosis?: string,
): Promise<never> {
  await appendAudit(deps.db, test.workspaceId, {
    actor: "candidate",
    action: `attempt.${code}`,
    target: test.testVersionId,
    detail: diagnosis === undefined ? details : { ...details, reason: diagnosis },
    now: deps.now(),
  });
  throw conflict(code, message, details);
}

/** `name: message`, from anything a `throw` can carry. */
const diagnosisOf = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Every throw out of drawing a candidate's paper, as the one 409.
 *
 * Two call sites — the selection and the scrub — because a stale
 * published version breaks both: `layoutForAttempt` throws for a `fixed`
 * or `sets` question that has been deleted, and the scrub throws for an
 * options list that has gone since publish.
 */
async function staleRefusal(
  deps: AppDeps,
  test: PublishedTest,
  bank: readonly Question[],
  error: unknown,
): Promise<never> {
  if (error instanceof PoolTooSmallError) {
    return unavailable(
      deps,
      test,
      "pool_too_small",
      STALE_MESSAGE,
      { section: error.sectionId, wanted: error.wanted, available: error.available },
      diagnosisOf(error),
    );
  }
  return unavailable(
    deps,
    test,
    "paper_unavailable",
    STALE_MESSAGE,
    { ...(missingReference(test.sections, bank) ?? {}) },
    diagnosisOf(error),
  );
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

/**
 * The first selected question whose passage group the bank no longer
 * holds — an author removed or renamed it in `groups_json` after
 * publish.
 *
 * Checked rather than tolerated: a comprehension question pinned with no
 * passage is an unanswerable question, and because the paper is pinned
 * it would be unanswerable **permanently** for that candidate, silently,
 * on a 201. The same shape as `missingReference` above and for the same
 * reason — a published version goes stale the moment something it
 * references is deleted.
 */
function missingGroup(
  layout: AttemptLayout,
  byId: Map<string, { question: Question; bankId: string }>,
  groups: Map<string, PassageGroup>,
): { section: string; question: string; group: string } | null {
  for (const pinned of layout.sections) {
    for (const id of pinned.questionIds) {
      const held = byId.get(id);
      const ref = held?.question.group;
      if (held === undefined || ref === undefined) continue;
      if (!groups.has(`${held.bankId}:${ref}`)) {
        return { section: pinned.sectionId, question: id, group: ref };
      }
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
          // The paper carries URLs; `layout.media`, pinned from the same
          // questions by `mediaKeysOf`, carries the bare storage keys the
          // media route authorises against. One prefix, applied here.
          mediaBase: MEDIA_BASE,
          ...(group === undefined ? {} : { group }),
        });
      }),
    };
  });
}

// --- the paper, from a row ---------------------------------------------

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
  clientSeq: number;
  now: number;
}): AttemptPaper {
  const timing = timingOf(input.settings);
  // The same `clockOf` every write is judged by, so the number the browser
  // anchors its countdown on and the number that decides whether an answer
  // is in time cannot drift apart (`AC-13`).
  const clock = clockOf(input, input.now);
  return {
    attemptId: input.attemptId,
    sections: input.layout.paper,
    ...(input.layout.setNo === undefined ? {} : { setNo: input.layout.setNo }),
    responses: input.responses,
    clientSeq: input.clientSeq,
    navigation: timing.navigation ?? TIMING_DEFAULTS.navigation,
    maxIndex: input.maxIndex,
    remainingMs: clock.remainingMs,
    sectionRemainingMs: clock.sectionRemainingMs,
    warnAtMinutes: [...(timing.warn_at_minutes ?? TIMING_DEFAULTS.warn_at_minutes)],
    lateSyncGraceSeconds: graceMsOf(input.settings) / 1000,
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
  const allowed = timing.attempts_allowed ?? TIMING_DEFAULTS.attempts_allowed;
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
    // Three sources besides the short pool: a deleted `fixed` or `sets`
    // question (`findQuestion`), a set label no section carries, and an
    // assignment with no value. Each would be a 500 on a candidate's
    // screen; each is a 409 instead, with the thrown message on the
    // audit row so the next real defect is diagnosable.
    await staleRefusal(deps, test, bank, error);
    throw error; // unreachable: `staleRefusal` never returns
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

  // **Inside the net too.** The scrub is the second half of drawing the
  // paper, and a stale version breaks it the way it breaks the
  // selection: a group that has gone would silently pin a question with
  // no passage, and an options list that has gone throws. Both are the
  // organiser's 409 — never a 201 nobody can fix, and never a 500.
  const absentGroup = missingGroup(layout, byId, groups);
  if (absentGroup !== null) {
    await unavailable(
      deps,
      test,
      "paper_unavailable",
      STALE_MESSAGE,
      absentGroup,
      `the bank no longer holds passage group "${absentGroup.group}"`,
    );
  }
  let paper: PaperSection[];
  try {
    paper = paperSections(test, layout, byId, groups);
  } catch (error) {
    await staleRefusal(deps, test, bank, error);
    throw error; // unreachable: `staleRefusal` never returns
  }

  const pinned: PinnedLayout = {
    ...layout,
    media: mediaKeysOf(selected),
    paper,
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
      clientSeq: 0,
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
    // **Before `openTest`, so a caller with no credential costs no read
    // at all.** The candidate floor the whole budget model rests on is
    // 0, and resolving a test for somebody who cannot possibly start it
    // is a subrequest spent on a stranger. It discloses nothing either:
    // the 401 is the same whether the slug pair exists or not.
    const header = c.req.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (token === "") {
      throw new ApiError(
        401,
        "registration_required",
        "Start from the test page: this step needs the pass your registration gave you.",
      );
    }
    const test = await openTest(deps, c);
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
    const now = deps.now();

    /**
     * `C-07`, the half with no client in it: **the first request past the
     * deadline submits the attempt.**
     *
     * There is no sweeper in this phase — nothing here gets a Cron Trigger
     * — so a candidate who closes the tab and never comes back leaves an
     * attempt that is submitted when it is next read. Whichever of the
     * browser at zero and this happens first wins, and the other is a
     * no-op (`WHERE submitted_at IS NULL`).
     *
     * **Past the grace, not past the deadline.** A resume at
     * `deadline + 20 s` with a 30-second grace must *not* materialise the
     * timeout: the queue is about to drain answers that were made in time,
     * and every one of them would take a 409 against an attempt this read
     * had just closed. That is the ordering bug this condition exists to
     * avoid, and it is why the stamp is `deadline_at` itself rather than
     * `now` — the attempt ended when the clock ran out, not when somebody
     * next looked at it.
     */
    let submittedAt = attempt.submittedAt;
    if (submittedAt === null && timedOut(attempt, now)) {
      submittedAt = attempt.deadlineAt;
      await submitAttempt(deps.db, attempt.workspaceId, {
        attemptId: attempt.attemptId,
        submittedAt,
        reason: "timeout",
      });
    }

    const rows = await listResponses(deps.db, attempt.workspaceId, attempt.attemptId);
    const responses: Record<string, ResponseValue | null> = {};
    for (const row of rows) responses[row.questionId] = row.value as ResponseValue | null;
    return c.json(
      paperFrom({
        // Task 8's seed, off the rows this read already returned — so it
        // is free, and so a browser that has lost its counter cannot
        // restart below what the server holds.
        clientSeq: rows.reduce((highest, row) => Math.max(highest, row.clientSeq), 0),
        attemptId: attempt.attemptId,
        layout: attempt.layout,
        settings: attempt.settings,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        submittedAt,
        sectionStartedAt: attempt.sectionStartedAt,
        maxIndex: attempt.maxIndex,
        responses,
        now,
      }),
    );
  });

  /**
   * Saving one answer (Task 8, #72) — the hot path, and **Review Focus 3**.
   *
   * Two subrequests and no more: the attempt join the cookie resolves
   * through, and the one conditional upsert. The PRD's non-functional
   * table budgets this at one D1 write plus at most one R2 call and a
   * candidate makes hundreds of them, so the number is pinned with `toBe`
   * in `test/run/answer.test.ts` rather than bounded.
   *
   * **The write is not re-implemented here.** `upsertResponse` is one
   * statement — `INSERT … ON CONFLICT DO UPDATE … WHERE
   * excluded.client_seq > response.client_seq` — which is already the
   * idempotent, sequence-safe upsert this route needs, and `{ stored }`
   * already says whether this call was the one that won. All this handler
   * does is map that to a wire word.
   *
   * **The outcomes are distinct, and that is the whole point.** A queue
   * that drains on HTTP 200 drains correctly on `superseded` and *also*
   * drains on every refusal, marks the answer saved, and drops it:
   *
   *  * `accepted` (200) — stored. Drop it from the queue.
   *  * `superseded` (200) — the server holds a higher sequence. Drop it;
   *    a late retry of 4 after 5 must not regress the answer.
   *  * 409 — refused. **Keep it**, and never show "Saved". Submitted
   *    today; Task 9 adds the deadline and Task 10 the navigation rule to
   *    this same handler, and the queue needs no change when they do
   *    because it reads the status, not a list of codes.
   *  * 404 — the question is not on this candidate's pinned paper.
   *    Nothing was written and nothing ever will be, so the queue drops
   *    it and says so — but it is not a save, and must not read "Saved"
   *    either.
   *
   * `savedAt` is the server's clock. The browser's is a value a candidate
   * can change, and `saved_at` is evidence.
   */
  routes.put("/attempt/answer", attemptContext(deps), async (c) => {
    const attempt = c.get("attempt");
    const parsed = answerRequest.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "That answer could not be read. Try again.");
    }
    const { questionId, value, clientSeq } = parsed.data;
    const now = deps.now();

    // Time, then the paper, then navigation — in that order, because a
    // candidate whose attempt is over should be told *that*, not told
    // their question does not exist or that they are out of order.
    if (attempt.submittedAt !== null) {
      throw conflict(
        "already_submitted",
        "You have already submitted this test, so this answer was not saved.",
      );
    }
    // `AC-13`'s server half, and the only clock a write is judged by:
    // `deadline_at + late_sync_grace_seconds`, never the test's window.
    // `deriveState(...) === "open"` gates ENTRY only — re-checking it here
    // would refuse exactly the late offline saves `AC-14` exists to
    // deliver, on any test whose `closes_at` is tight.
    assertWritable(attempt, now);

    // Membership in the pinned layout, in memory, off the row the cookie
    // already resolved — the same reading the media route authorises by,
    // and the same single 404 body every refusal in this runtime answers
    // with (`S-10`). `-1` is "not on this paper"; a question that *is* on
    // the paper but is behind the lock is the 403 below, deliberately
    // distinguishable.
    const target = indexOf(attempt.layout, questionId);
    if (target < 0) throw new ApiError(404, "not_found", "No such resource.");

    // `C-07`: a section whose time has ended refuses a write into it and
    // names the next one. Before the navigation rule, for the same reason
    // the deadline is: time is the more urgent truth.
    assertSectionOpen(attempt, target, now);

    // `AC-15`, asserted against this route and not against the function it
    // calls: the attack is a candidate scripting a `PUT` at an earlier
    // question after the interface stopped offering it.
    assertReachable(
      attempt.layout,
      timingOf(attempt.settings).navigation ?? TIMING_DEFAULTS.navigation,
      attempt.maxIndex,
      questionId,
    );

    // The one write, and — only when the candidate has actually moved
    // forward — the progress bump riding the **same** `db.batch`, which
    // D1 counts as one subrequest. Re-editing an answer in place, the
    // common case by far, issues no second statement at all.
    const movedOn = target > attempt.maxIndex;
    const enteringLater =
      movedOn && sectionIndexOf(attempt.layout, target) > currentSectionIndex(attempt);
    const { stored } = await upsertResponse(deps.db, attempt.workspaceId, {
      attemptId: attempt.attemptId,
      questionId,
      value,
      clientSeq,
      savedAt: now,
      ...(movedOn
        ? {
            advance: {
              maxIndex: target,
              // Stamped once per section, by `max_index < ?` in the same
              // statement: the second save inside a section finds the
              // column already past it and changes nothing.
              ...(enteringLater ? { sectionStartedAt: now } : {}),
            },
          }
        : {}),
    });

    return c.json({
      outcome: stored ? "accepted" : "superseded",
      // `AC-13`'s anchor on the hottest path there is: the countdown
      // re-anchors from every save, so a tab that slept for an hour is
      // corrected by the next keystroke rather than by a reload.
      remainingMs: clockOf(attempt, now).remainingMs,
    });
  });

  /**
   * The images on this candidate's own paper (Task 7, #71) — **Review
   * Focus 2**.
   *
   * The authorisation is membership in `attempt.layout.media`, the array
   * `/start` pinned from the very questions it selected. It is **not**
   * "the attempt names a workspace, so serve anything under that
   * workspace's prefix", and the difference is invisible from the
   * outside: every candidate's own images load either way, every test
   * passes either way, and the workspace reading additionally hands each
   * candidate the diagram in a question they were never given, in a bank
   * belonging to a different test, in a draft nobody published. The keys
   * are SHA-256 content addresses so guessing is not the threat; a
   * candidate who sat an earlier version of this test, or who has read a
   * leaked bank export, is.
   *
   * It costs nothing to do it right: the array is already on the row the
   * cookie resolved, so the check is an `includes` in memory and the
   * route's whole budget is the attempt join plus the object read. A
   * measurement above 2 means the workspace was consulted after all.
   *
   * The workspace still names the *storage path* — the bytes live under
   * `media/<workspaceId>/<key>` and nowhere else — which is why the same
   * key under two tenants serves two different objects. Scoping storage
   * and authorising access are two questions and this route answers them
   * from two different places.
   *
   * Everything refused is one 404 with one body (`S-10`): a key outside
   * this paper, a key from another tenant, an extension that is not a
   * servable image, and an object that is simply missing are
   * indistinguishable to the holder. Phase 4's two properties come with
   * it verbatim — `private, max-age=31536000, immutable` (the response
   * needed a credential and carries no `Vary`), and no `image/svg+xml`,
   * because an SVG can carry `<script>` and `script-src 'self'` should
   * not be the only thing between a stored one and XSS.
   */
  routes.get("/attempt/media/:key", attemptContext(deps), async (c) => {
    const attempt = c.get("attempt");
    const key = c.req.param("key");
    const contentType = EXT_MEDIA_TYPE[key.slice(key.lastIndexOf(".") + 1)];
    const notFound = new ApiError(404, "not_found", "No such resource.");

    // Checked before the read, so a key this candidate was never given
    // costs no storage call and leaves no trace of having been asked for.
    if (contentType === undefined || !attempt.layout.media.includes(key)) throw notFound;

    const bytes = await deps.storage.get(`media/${attempt.workspaceId}/${key}`);
    if (!bytes) throw notFound;

    return c.body(bytes, 200, {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  });

  return routes;
}
