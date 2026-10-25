// The reads a candidate request makes *before* any workspace is known.
//
// A candidate holds two slugs and nothing else (`T-02`: the candidate URL is
// `/<workspace-slug>/<test-slug>`), and `ADR 0005` is explicit that candidate
// access gives nobody a user row — so there is no session, no membership and
// no workspace ID for `scoped()` to check. The workspace ID is what this
// module *produces*, which is exactly `ADR 0006`'s admission test: "unable to
// know a workspace, not merely awkward to give one."
//
// It is a third module rather than a growth of `identity.ts` because that
// ADR's own "to watch" section says a function that is not about users or
// sessions should take a workspace ID instead — and these cannot. Like
// `identity.ts` and `shortlink.ts` it is deliberately **not** re-exported
// from `repo/index.ts`, so that barrel keeps its rule intact ("every function
// here is scoped") with no exemption list to grow;
// `test/repo/candidate-entry.test.ts` asserts the separation in both
// directions. Every read after this one is an ordinary `scoped()` function
// with the workspace ID this produced.

import type { DbClient } from "../client.js";
import type { Section } from "@pariksha/core";
import { deriveState, type TestSettings, type TestState } from "./test-document.js";

/** First path segments of `/api/v1/run/...` that are routes, not
 *  workspace slugs. */
const RESERVED_RUN_SEGMENTS = new Set(["attempt", "result"]);

export interface PublishedTest {
  workspaceId: string;
  testId: string;
  testVersionId: string;
  version: number;
  /**
   * The **derived** lifecycle state, not the stored column. `test.status`
   * holds only `draft | published | closed | archived` and can never hold
   * `"open"`: Scheduled and Open are the same stored `published` seen
   * against the clock (`deriveState`), which is why `now` is an argument
   * here and why a scheduled test resolves rather than vanishing.
   */
  state: TestState;
  name: string;
  description: string | null;
  settings: TestSettings;
  sections: Section[];
  /** `workspace.branding_json` — logo, colour and footer (T-23's split). */
  workspaceBranding: unknown;
}

interface PublishedTestRecord {
  workspace_id: string;
  workspace_branding: unknown;
  test_id: string;
  name: string;
  description: string | null;
  status: string;
  version_id: string;
  version: number;
  settings_json: unknown;
  sections_json: unknown;
}

/**
 * One statement, the way `readSessionActor` is one statement: the workspace,
 * the test and the version the test currently points at, joined on
 * `test.current_version`. Null when any link is missing — an unknown
 * workspace, an unknown test, or a test that has never been published — so
 * the route can answer one 404 for all three without learning which
 * (`S-09`'s posture, applied to a caller who has no session at all).
 *
 * A test that has been published and then closed or archived still resolves:
 * the candidate needs to be told *that*, and the route decides which states
 * it will serve. Keeping the decision in the route is also what lets Task 2's
 * access gate and Task 5's `/start` disagree with the landing page about
 * `closed` without a second query shape.
 */
export async function resolvePublishedTest(
  db: DbClient,
  workspaceSlug: string,
  testSlug: string,
  now: number,
): Promise<PublishedTest | null> {
  // `/api/v1/run/attempt/...` (Task 5 onward), `/api/v1/run/result/...`
  // (Task 11) and `/api/v1/run/:workspaceSlug/:testSlug` all match three
  // segments. Hono prefers a static segment to a parameter, so the
  // collision does not arise there — but a workspace whose slug really is
  // one of these would make every candidate URL under it
  // indistinguishable from a runtime route to anyone reading a log, so
  // each is refused here too, before the query, at the cost of nothing.
  //
  // A set rather than a comparison, so the next static first segment is
  // one word here and not a second `if` somebody forgets.
  if (RESERVED_RUN_SEGMENTS.has(workspaceSlug)) return null;

  const rows = await db.query<PublishedTestRecord>(
    "SELECT w.id AS workspace_id, w.branding_json AS workspace_branding, " +
      "t.id AS test_id, t.name AS name, t.description AS description, t.status AS status, " +
      "v.id AS version_id, v.version AS version, v.settings_json AS settings_json, v.sections_json AS sections_json " +
      "FROM test t JOIN workspace w ON w.id = t.workspace_id " +
      "JOIN test_version v ON v.workspace_id = t.workspace_id AND v.test_id = t.id " +
      "AND v.version = t.current_version AND v.published_at IS NOT NULL " +
      "WHERE w.slug = ? AND t.slug = ?",
    [workspaceSlug, testSlug],
  );
  const row = rows[0];
  if (!row) return null;

  const settings = db.jsonValue<TestSettings>(row.settings_json);
  return {
    workspaceId: row.workspace_id,
    testId: row.test_id,
    testVersionId: row.version_id,
    version: Number(row.version),
    // The cast is the same one `toTestRow` makes and for the same reason:
    // the column is plain text, and its four writers are `createTest`,
    // `publishDraftVersion` and `setTestStatus`.
    state: deriveState(row.status as "draft" | "published" | "closed" | "archived", settings.timing, now),
    name: row.name,
    description: row.description,
    settings,
    sections: db.jsonValue<Section[]>(row.sections_json),
    workspaceBranding: row.workspace_branding == null ? null : db.jsonValue(row.workspace_branding),
  };
}

/**
 * Phase 6 Task 5 (#69, P6.5): the attempt a candidate's cookie names,
 * and the second function here that cannot take a workspace ID.
 *
 * A candidate presents one 256-bit token in an `HttpOnly` cookie and
 * nothing else — no slug pair, no workspace, no session. The workspace is
 * what this produces, which is ADR 0006's admission test again, so it
 * lives beside `resolvePublishedTest` rather than in the scoped barrel.
 *
 * **One statement**, joining `attempt` to `test_version`, for the same
 * reason `readSessionActor` is one: this runs on every request of a live
 * attempt — the autosave, the timer, the navigation check, the
 * submission — and a second round trip there is a second round trip
 * fifty times per candidate per paper.
 *
 * A **submitted** attempt still resolves. The receipt and the result are
 * read through this same cookie after `submitted_at` is stamped, so the
 * row going quiet at submission would log the candidate out of their own
 * result page; refusing a submitted attempt is the answer route's job,
 * not this read's, which is why `submittedAt` is on the record.
 */
export interface AttemptRecord {
  attemptId: string;
  workspaceId: string;
  candidateId: string;
  testId: string;
  testVersionId: string;
  version: number;
  /**
   * The **index** into the first `sets` section's `sets` array, not the
   * label — the column is an `int` and always was (`columns.ts`, Phase 2).
   * The label a candidate's receipt shows is `layout.setNo`, which is a
   * string and is the authoritative one: a version with two `sets`
   * sections whose labels disagree cannot be expressed by one integer.
   */
  setNo: number;
  /** `PinnedLayout`, as stored. The whole paper, pinned at `/start`. */
  layout: unknown;
  startedAt: number;
  deadlineAt: number;
  submittedAt: number | null;
  submitReason: string | null;
  sectionStartedAt: number | null;
  maxIndex: number;
  flag: string;
  /** Phase 7e Task 3 (`E-R1`): null means never locked, a timestamp is
   *  when the lock fired (`lockAttempt`, `repo/attempts.ts`). On the
   *  record for the same reason `submittedAt` is — the write routes that
   *  refuse a locked attempt (`run/attempt.ts`'s `assertNotLocked`) read
   *  it off the row this middleware already resolved, no second read. */
  lockedAt: number | null;
  /** Phase 8g Task 3 (`K12`, `K13`): proctor message pending delivery. */
  proctorMessage: string | null;
  proctorMessageAt: number | null;
  /** `AttemptScore`, as `finishAttempt` stored it, and `null` until an
   *  attempt has been scored. On the record because the receipt and the
   *  result are read through the same cookie *after* submission (Task 11):
   *  without it, answering a second `POST /submit` or a `GET /result`
   *  would cost a second read of a row the middleware just resolved. */
  score: unknown;
  /** Joined from `test_version`, so the timer, the navigation rule and the
   *  grace period come back with the attempt rather than costing a read. */
  settings: unknown;
  sections: unknown;
}

interface AttemptRecordRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  test_id: string;
  test_version_id: string;
  version: number;
  set_no: number;
  layout_json: unknown;
  started_at: number;
  deadline_at: number;
  submitted_at: number | null;
  submit_reason: string | null;
  section_started_at: number | null;
  max_index: number;
  flag: string;
  locked_at: number | null;
  proctor_message: string | null;
  proctor_message_at: number | null;
  score_json: unknown;
  settings_json: unknown;
  sections_json: unknown;
}

export async function readAttemptByTokenHash(
  db: DbClient,
  tokenHash: string,
): Promise<AttemptRecord | null> {
  const rows = await db.query<AttemptRecordRow>(
    "SELECT a.id, a.workspace_id, a.candidate_id, a.test_version_id, a.set_no, a.layout_json, " +
      "a.started_at, a.deadline_at, a.submitted_at, a.submit_reason, a.section_started_at, " +
      "a.max_index, a.flag, a.locked_at, a.score_json, a.proctor_message, a.proctor_message_at, " +
      "v.test_id AS test_id, v.version AS version, v.settings_json AS settings_json, " +
      "v.sections_json AS sections_json " +
      "FROM attempt a JOIN test_version v ON v.id = a.test_version_id " +
      "WHERE a.token_hash = ?",
    [tokenHash],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    attemptId: row.id,
    workspaceId: row.workspace_id,
    candidateId: row.candidate_id,
    testId: row.test_id,
    testVersionId: row.test_version_id,
    version: Number(row.version),
    setNo: Number(row.set_no),
    layout: db.jsonValue(row.layout_json),
    startedAt: Number(row.started_at),
    deadlineAt: Number(row.deadline_at),
    submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
    submitReason: row.submit_reason,
    sectionStartedAt: row.section_started_at === null ? null : Number(row.section_started_at),
    maxIndex: Number(row.max_index),
    flag: row.flag,
    lockedAt: row.locked_at === null ? null : Number(row.locked_at),
    proctorMessage: row.proctor_message ?? null,
    proctorMessageAt: row.proctor_message_at == null ? null : Number(row.proctor_message_at),
    score: row.score_json == null ? null : db.jsonValue(row.score_json),
    settings: db.jsonValue(row.settings_json),
    sections: db.jsonValue(row.sections_json),
  };
}

/**
 * One finished attempt, by the reference printed on its receipt (`C-09`).
 *
 * The third read that *produces* a workspace. A candidate coming back a
 * week later holds two things — the `att_` reference on their receipt and
 * their own email address — and no cookie, no workspace and no test id, so
 * there is nothing for `scoped()` to check (ADR 0006).
 *
 * **The reference alone is not a credential.** It is printed on a receipt
 * and it is guessable in the way any id is; what authorises the result is
 * the emailed code the caller then has to hold. So this read deliberately
 * answers the same shape for every live reference and the route it serves
 * answers identically whether this returned a row or null — the candidate's
 * registration answers come back with it precisely so the route can compare
 * the address *in memory*, in constant time, rather than make the database
 * tell two cases apart by returning rows for one of them.
 */
export interface AttemptReference {
  attemptId: string;
  workspaceId: string;
  candidateId: string;
  /** The candidate's identity column — the email itself when the form's
   *  first unique field is the email (the importer does not repeat an
   *  identity value into the prefill). */
  externalId: string | null;
  /** `candidate.form_values_json` — where a non-identity email lives. */
  formValues: Record<string, unknown>;
  submittedAt: number | null;
  /** `AttemptScore`, as `finishAttempt` stored it, or `null` on an attempt
   *  that was stamped without being scored. */
  score: unknown;
  settings: TestSettings;
  /** `PinnedLayout`: the paper, for the section titles a released result
   *  names and the question ids a review walks. */
  layout: unknown;
}

interface AttemptReferenceRow {
  id: string;
  workspace_id: string;
  candidate_id: string;
  external_id: string | null;
  form_values_json: unknown;
  submitted_at: number | null;
  score_json: unknown;
  layout_json: unknown;
  settings_json: unknown;
}

export async function findAttemptByReference(
  db: DbClient,
  attemptRef: string,
): Promise<AttemptReference | null> {
  const rows = await db.query<AttemptReferenceRow>(
    // Only the columns `result.ts` reads. `test_id`, `test_version_id`
    // and `sections_json` were on this row and nothing touched any of
    // them — and `sections_json` is the whole section array of the test
    // version, carried across a public route for nothing.
    "SELECT a.id, a.workspace_id, a.candidate_id, a.submitted_at, " +
      "a.score_json, a.layout_json, " +
      "c.external_id AS external_id, c.form_values_json AS form_values_json, " +
      "v.settings_json AS settings_json " +
      "FROM attempt a JOIN test_version v ON v.id = a.test_version_id " +
      "JOIN candidate c ON c.id = a.candidate_id " +
      "WHERE a.id = ?",
    [attemptRef],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    attemptId: row.id,
    workspaceId: row.workspace_id,
    candidateId: row.candidate_id,
    externalId: row.external_id,
    formValues: db.jsonValue<Record<string, unknown>>(row.form_values_json) ?? {},
    submittedAt: row.submitted_at === null ? null : Number(row.submitted_at),
    score: row.score_json == null ? null : db.jsonValue(row.score_json),
    settings: db.jsonValue(row.settings_json),
    layout: db.jsonValue(row.layout_json),
  };
}
