// The organiser app's one door to the API.
//
// Phase 3 Task 9. Every endpoint below is specified by
// docs/superpowers/plans/2026-10-16-phase-3-auth-roles-and-landing.md and is
// being built in parallel (issues #26-#30); nothing here may run against a
// deployed Worker to be believed, which is why `ApiClient` is an interface
// the screens take as a prop and the tests satisfy with a typed object
// literal.

// The matrix these roles index lives in @pariksha/core (#25); the type is
// re-exported here so the screens have one import for the whole API surface.
import {
  type Bank as BankDocument,
  type Difficulty,
  type ImportIssue,
  type PassageGroup,
  type Question,
  type QuestionType,
  type Role,
  type Action,
  type Section,
  type Test,
  type TestBranding,
} from "@pariksha/core";
export type { Role, Action };
// Aliased on import: this file's own `Bank` (below) is the `BankRow` wire
// shape every other bank route already answers with, not the
// `pariksha/bank@1` document export produces — same name, two different
// things, so the core type keeps its own.
export type { BankDocument };

// Phase 4 Task 2: banks and questions. Mirrors
// `packages/db/src/repo/banks.ts`'s `BankRow`/`QuestionRow` — this is the
// JSON those rows serialise to, not a separate shape of its own.
export interface Bank {
  id: string;
  name: string;
  description: string | null;
  license: string | null;
  tags: string[];
  questionCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface QuestionSummary {
  id: string;
  bankId: string;
  refId: string;
  document: Question;
  points: number;
  usedInTests: number;
  updatedAt: number;
}

/** Phase 4 Task 6: a bank's passage groups, each with how many of the
 * bank's questions currently reference it — `packages/db/src/repo/banks.ts`'s
 * `listGroups` return type, unchanged over the wire. */
export type PassageGroupSummary = PassageGroup & { questionCount: number };

/** Task 7 (#51, P4.7): `apps/api/src/import/json.ts`'s `ImportReport`,
 * unchanged over the wire — `issues` is empty on a clean import. */
export interface ImportReport {
  imported: number;
  issues: (ImportIssue & { line?: number })[];
}

// Phase 5 Task 2 (#54): tests. Mirrors `packages/db/src/repo/tests.ts`'s
// `TestRow`, widened at the wire boundary the way `apps/api/src/routes/
// tests.ts`'s own `toWire` builds it, and `draftVersion` is the version
// number of the test's unpublished draft.
//
// Task 11 (#62, P5.9): `state` is now the **derived** five-state value
// `deriveState` computes server-side, so `"published"` is gone from this
// union — the stored status by that name is Scheduled or Open depending on
// the published version's own window, and the browser is never the place
// that decides which (Review Focus 2 and 4 both).
export type TestState = "draft" | "scheduled" | "open" | "closed" | "archived";

/** Task 11 (#62, P5.9): one row of `GET .../versions` — mirrors
 * `TestVersionSummary` (`packages/db/src/repo/tests.ts`). `publishedAt` is
 * null for the one open draft, which the history shows rather than hides. */
export interface TestVersionSummary {
  version: number;
  publishedAt: number | null;
  attemptCount: number;
}

/** Task 11/13: one row of the publish checklist — mirrors `ChecklistRow`
 * (`apps/api/src/publish/checklist.ts`). The screen renders this array and
 * computes nothing (Review Focus 4). */
/** One `pariksha/test@1` document, as `GET .../export` hands it out and
 * `POST .../tests/import` takes it back. `Test` is `@pariksha/core`'s own
 * type; the `$schema` key export always stamps is the only addition. */
export type TestDocument = Test & { $schema?: string };

/** Mirrors `TestImportReport` (`apps/api/src/import/test.ts`). */
export interface TestImportReport {
  testId: string | null;
  imported: boolean;
  issues: (ImportIssue & { line?: number })[];
  rebound: { questionId: string; bankName: string }[];
}

export interface ChecklistRow {
  id: string;
  severity: "blocking" | "advisory";
  message: string;
  field: string;
  sectionId?: string;
}

export interface TestSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortCode: string;
  state: TestState;
  currentVersion: number | null;
  draftVersion: number | null;
  reviewRequested: boolean;
  tags: string[];
  updatedAt: number;
  /** When the published window shuts, as an epoch, or `null` — never
   * published, no closing time set, or a stored one that would not parse.
   * Phase 6.5c (`D6b`): Home's agenda cannot say the one thing that
   * matters most without it, and the server was already holding it. */
  closesAt: number | null;
}

export interface TestFilter {
  // Whole-branch drift review, M-01: no `tag`. `GET .../tests` supports
  // one and the repo implements it, but nothing in the product writes
  // `test.tags`, so the client half was a filter that could never match.
  // Add it back alongside whatever first sets a tag.
  status?: string;
  search?: string;
  sort?: "name" | "updated" | "created";
}

export interface TestPatch {
  name?: string;
  slug?: string;
  description?: string;
  tags?: string[];
  reviewRequested?: boolean;
}

// Phase 5 Task 3 (#55, P5.2): the draft. Mirrors
// `packages/db/src/repo/test-document.ts`'s own `TestSettings`/
// `StoredSection`/`TestDocumentBody` — the same `Bank`/`BankRow`,
// `TestSummary`/`TestWire` split every other wire type here keeps, so this
// package never depends on `@pariksha/db`.
/** Everything a `pariksha/test@1` document carries except `name`/`slug`
 * (their own fields on `TestSummary`) and `sections` (its own array,
 * below). A block Phase 5 builds no editor for — `consent`, `proctoring`,
 * `retention` — rides along inside this type as an unlisted field exactly
 * the way it rides through the server's own mapper: nothing here needs to
 * name it for a `{ ...settings, access: {...} }` patch to leave it alone. */
export type TestSettings = Omit<Test, "$schema" | "format" | "name" | "slug" | "sections">;
/** A `Section` naming `qst_`/`bnk_` row ids — what the builder works in
 * throughout; only export (a later task) ever sees the bank file's own
 * ids. */
export type StoredSection = Section;
export interface TestDocumentBody {
  settings: TestSettings;
  sections: StoredSection[];
}
/** `GET`/`PATCH .../draft`'s wire shape. `draw`/`setPoints`/`points` are
 * UX-15/UX-16/UX-12's live numbers — present on every `GET` and omitted by
 * `PATCH` (nothing reads them off a save response; a screen that wants
 * fresh numbers right after one re-fetches `draft()`). */
export interface TestVersionRow {
  id: string;
  testId: string;
  version: number;
  body: TestDocumentBody;
  publishedAt: number | null;
  createdAt: number;
  draw?: Record<string, { matching: number; wanted: number }>;
  setPoints?: Record<string, { set: string; points: number }[]>;
  /** UX-12's collapsed-row points figure, one per section, every source
   * kind — `{ min, max }`, `min === max` for `fixed` (exact) and `sets` (one
   * set's own total). `pool` is a real range: the cheapest and the dearest
   * `count` matching questions, since a real pool's questions usually
   * differ in points and the real draw is random per attempt. Render
   * "N points" when `min === max`, else "min–max points" (task 3 review,
   * I3 — a single estimate stated a fact the engine does not honour). */
  points?: Record<string, { min: number; max: number }>;
}
/** `PATCH .../draft`'s body. Each named top-level block replaces whole —
 * `settings` one level deep, `sections` as a full array — never merges
 * below it (Review Focus item 3). */
export interface DraftPatch {
  settings?: Partial<TestSettings>;
  sections?: StoredSection[];
}

/** Task 6 (#58, P5.5): `POST .../check-url`'s answer. Mirrors
 * `apps/api/src/net/reachable.ts`'s `ReachResult`, the same boundary every
 * other wire type here keeps — this package never imports apps/api.
 *
 * Advisory in every state. `unverified` means "the link did not answer
 * 200", never "the link is wrong"; `refused` means the check itself cannot
 * be made (a network address, a non-web port, a scheme that is not http);
 * `timeout` is its own state so the screen can offer a retry rather than
 * report a link as unreachable on one slow response. `status` is null for
 * every transport-level outcome, deliberately — the server does not tell
 * the browser which one it was. */
export type ReachState = "reachable" | "unverified" | "timeout" | "refused";

export interface ReachResult {
  state: ReachState;
  status: number | null;
  reason?: string;
  checkedAt: number;
}

export interface QuestionListFilter {
  type?: QuestionType;
  tag?: string;
  difficulty?: Difficulty;
  unused?: boolean;
  search?: string;
  cursor?: string;
}

/** `apps/api/src/auth/identity.ts`, per the Phase 3 plan's Task 3. */
export interface IdentityProvider {
  id: string;
  kind: "oidc" | "magic_link" | "password";
  label: string;
}

export interface SetupStatus {
  needed: boolean;
  providers: IdentityProvider[];
}

export interface Membership {
  workspaceId: string;
  role: Role;
  grants: { testId: string; role: Role }[];
}

/** The Phase 3 Task 2 `Actor`: who is signed in and what they may reach. */
export interface Actor {
  userId: string;
  email: string;
  memberships: Membership[];
}

// The plan never states a workspace's wire shape. Two fields are what the
// dashboard reads; widen it when a route needs more.
export interface Workspace {
  id: string;
  name: string;
}

/**
 * Phase 8e Task 3 (`K31`, `K36`, issue 102). Mirrors `UsageProjection`
 * (`apps/api/src/usage/project.ts`) field for field — a second declaration
 * rather than a cross-app import, the same way `TestSummary` above
 * redeclares its own wire shape instead of reaching into `apps/api`.
 *
 * Branch review `C2` (CRITICAL): `spentToday` is gone. It cost every row
 * the workspace held in three uncomposited tables to answer a number that
 * was normally zero; `projected` alone is what an organiser can act on.
 */
export interface UsageProjection {
  projected: number;
  limit: number;
  warn: boolean;
  estimated: true;
}

/**
 * Every failure response is `{ error: { code, message, details? } }`. This
 * carries all three so a screen can render `message` — the human half —
 * and never a bare status code.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface ApiClient {
  setupStatus(): Promise<SetupStatus>;
  /** The signed-in actor, or null when the API answers 401. */
  me(): Promise<Actor | null>;
  workspaces(): Promise<Workspace[]>;
  completeSetup(input: { workspaceName: string }): Promise<Workspace>;
  requestMagicLink(email: string): Promise<void>;
  signOut(): Promise<void>;

  listBanks(workspaceId: string): Promise<Bank[]>;
  createBank(workspaceId: string, input: { name: string }): Promise<Bank>;
  // Fix round (whole-branch review, M1/M3): `getBank`/`updateBank`/
  // `deleteBank` were deleted here — no screen in apps/web ever called them,
  // only test fixtures implementing this interface's shape. The API routes
  // (GET/PATCH/DELETE .../banks/:bankId) stay; add these back, with a real
  // caller, when a bank-settings screen exists.
  listQuestions(
    workspaceId: string,
    bankId: string,
    filter?: QuestionListFilter,
  ): Promise<{ questions: QuestionSummary[]; cursor?: string }>;
  deleteQuestion(workspaceId: string, bankId: string, questionId: string): Promise<void>;
  /**
   * Phase 4 Task 3. One route for create and update: `POST
   * /banks/:bankId/questions` (`apps/api/src/routes/questions.ts`) matches
   * on `(bankId, doc.id)` and upserts either way, returning the saved row
   * directly — no follow-up GET, and no second method for "update".
   */
  saveQuestion(workspaceId: string, bankId: string, doc: Question): Promise<QuestionSummary>;
  /** Tags already used anywhere in the workspace (UX-03's autocomplete). */
  listTags(workspaceId: string): Promise<string[]>;

  /** Phase 4 Task 6: a bank's passage groups — a handful at most, so one
   * route answers all of them (`GET /banks/:bankId/groups`), the same shape
   * `listQuestions` for tags already follows. */
  listGroups(workspaceId: string, bankId: string): Promise<PassageGroupSummary[]>;
  createGroup(
    workspaceId: string,
    bankId: string,
    input: { id: string; title?: string; passage: string },
  ): Promise<PassageGroupSummary>;
  updateGroup(
    workspaceId: string,
    bankId: string,
    groupId: string,
    patch: { title?: string; passage?: string },
  ): Promise<PassageGroupSummary>;
  deleteGroup(workspaceId: string, bankId: string, groupId: string): Promise<void>;

  /**
   * Task 7 (#51, P4.7): whole-bank JSON import. `dryRun: true` validates and
   * reports without writing. A validation failure (422) and a clean
   * dry-run both come back as an `ImportReport` rather than a thrown
   * `ApiError` — `ImportDialog` renders one report shape either way; a
   * genuine transport/size failure (413, 404, …) still throws.
   *
   * Task 8 (#52, P4.8): `opts.format` sends `doc` (a `string` in this case,
   * not a parsed document — `ImportDialog` reads the file as text rather
   * than `JSON.parse`ing it) as the request body verbatim, on the same
   * route and with `?format=csv|gift` added, instead of JSON-encoding it.
   */
  importBank(
    workspaceId: string,
    bankId: string,
    doc: unknown,
    opts?: { dryRun?: boolean; format?: "csv" | "gift" },
  ): Promise<ImportReport>;

  /**
   * Task 9 (#53, P4.9): the whole bank, or just `ids`, as one
   * `pariksha/bank@1` document (`GET /banks/:bankId/export`,
   * apps/api/src/routes/banks.ts). `ids`, when given, names questions by
   * their own document `id` (a `QuestionSummary.refId`, never `.id` — the
   * row id a URL path segment uses), not by how many are selected: the
   * route's cost is the same either way.
   */
  exportBank(workspaceId: string, bankId: string, ids?: string[]): Promise<BankDocument>;

  /**
   * Fix round (whole-branch review, M3): `exportBank`'s single-question
   * sibling (`GET .../questions/:qid/export`, apps/api/src/routes/
   * banks.ts) had a route, a budget line and five tests but no client
   * method — this was its only missing half. Returns the question document
   * itself, not a whole `pariksha/bank@1` — `questionId` is the row id
   * (`QuestionSummary.id`), the same id `deleteQuestion` already takes.
   */
  exportQuestion(workspaceId: string, bankId: string, questionId: string): Promise<Question>;

  // Phase 5 Task 2 (#54): test CRUD. `tests` takes a filter rather than the
  // raw query-string shape `apps/api/src/routes/tests.ts` reads — the
  // screen builds a `TestFilter`, this is the one place that becomes `?`.
  tests(workspaceId: string, filter?: TestFilter): Promise<TestSummary[]>;
  createTest(workspaceId: string, input: { name: string; slug: string }): Promise<TestSummary>;
  test(workspaceId: string, testId: string): Promise<TestSummary>;
  updateTest(workspaceId: string, testId: string, patch: TestPatch): Promise<TestSummary>;

  // Task 3 (#55, P5.2): the draft itself — the one pair Tasks 4 through 9
  // all write through.
  draft(workspaceId: string, testId: string): Promise<TestVersionRow>;
  patchDraft(workspaceId: string, testId: string, patch: DraftPatch): Promise<TestVersionRow>;

  // Task 11 (#62, P5.9): the lifecycle. Each answers with the same
  // `TestSummary` every other test route returns, so the screen that
  // called one has the new state without a second read.
  publishTest(workspaceId: string, testId: string): Promise<TestSummary>;
  closeTest(workspaceId: string, testId: string): Promise<TestSummary>;
  archiveTest(workspaceId: string, testId: string): Promise<TestSummary>;
  versions(workspaceId: string, testId: string): Promise<TestVersionSummary[]>;
  /** Task 13 (#64, P5.11): the same rows `publishTest` enforces, read
   * rather than enforced — one function, two callers (Review Focus 4). */
  checklist(workspaceId: string, testId: string): Promise<ChecklistRow[]>;

  // Task 12 (#63, P5.10): AC-04's three.
  /** A new Draft from this test's editable head, with a new id, short code
   * and `-copy` slug. Version history and the review flag are not copied. */
  cloneTest(workspaceId: string, testId: string): Promise<TestSummary>;
  /** One `pariksha/test@1` document. `version` names a frozen one; the
   * default is the current published version, or the draft head when
   * nothing is published. */
  exportTest(workspaceId: string, testId: string, version?: number): Promise<TestDocument>;
  /** Whole-test import. `dryRun: true` validates and reports without
   * writing. A 422 comes back as a report rather than a thrown `ApiError`,
   * the same normalisation `importBank` does and for the same reason —
   * `ImportDialog` renders one shape either way. A **409** (`T-05`: a slug
   * the file named is already taken) still throws: there is nothing
   * positioned to render, and the organiser has to change the slug. */
  importTest(workspaceId: string, doc: unknown, opts?: { dryRun?: boolean }): Promise<TestImportReport>;

  // Task 6 (#58, P5.5). `workspaceId` first, like every sibling above — the
  // plan's own sketch wrote `checkUrl(testId, url)`, which cannot reach the
  // API at all (the path is workspace-scoped, and `requires()` reads the
  // workspace out of its own `:id` segment).
  checkUrl(workspaceId: string, testId: string, url: string): Promise<ReachResult>;

  // T-23's workspace half (Task 10, #61, P5.8). Three methods rather than
  // one, because the PRD splits branding across two owners: the logo, the
  // colour and the footer are workspace settings behind
  // `workspace.settings`, while the start and finish messages are the
  // test's own and ride `patchDraft` with everything else.
  /** The workspace's own branding, or `{}` when it has none yet. */
  workspaceBranding(workspaceId: string): Promise<TestBranding>;
  saveWorkspaceBranding(workspaceId: string, branding: TestBranding): Promise<TestBranding>;
  /**
   * The logo's bytes, through Phase 4's existing media route — the only
   * one this product has. Answers the content-addressed key, which is
   * what `branding.logo` stores.
   */
  uploadMedia(workspaceId: string, bankId: string, file: File): Promise<{ key: string }>;

  // Task 9 (#60 / #56, P5.7b): the candidate list. `workspaceId` first,
  // like every sibling — the plan's sketch wrote `candidates(testId)`,
  // which cannot reach a workspace-scoped path at all, the same slip its
  // `checkUrl(testId, url)` made.
  candidates(workspaceId: string, testId: string): Promise<CandidateRow[]>;
  /**
   * Uploads a candidate list as CSV. `dryRun: true` converts and reports
   * without writing. A refusal (422) comes back as a report rather than a
   * thrown `ApiError`, the same normalisation `importBank` does and for
   * the same reason: the panel renders one report shape either way, and a
   * genuine transport failure (413, 404, 403) still throws.
   */
  importCandidates(
    workspaceId: string,
    testId: string,
    csv: string,
    opts?: { dryRun?: boolean },
  ): Promise<CandidateImportReport>;

  // Phase 7e Task 4 (`Q5a`): the minimal pair — a locked-attempts read and
  // the unlock. Both gated server-side on `attempts.monitor`; Phase 8's
  // monitor replaces both.
  lockedAttempts(workspaceId: string, testId: string): Promise<LockedAttemptRow[]>;
  unlockAttempt(workspaceId: string, testId: string, attemptId: string): Promise<void>;

  // Phase 8e Task 2 (`S-14`, issue 101): `candidates.delete`, Owner-only —
  // both methods share the one permission. `exportCandidateData` hands
  // back the parsed document and the filename the server named it, rather
  // than the raw `Response`, so a caller can go straight to
  // `downloadJson` (`lib/download.ts`) the same way `exportBank` already
  // does.
  exportCandidateData(workspaceId: string, candidateId: string): Promise<{ data: unknown; filename: string }>;
  deleteCandidateData(
    workspaceId: string,
    candidateId: string,
    keepAnonymisedScore: boolean,
  ): Promise<{ tablesTouched: string[] }>;

  // Phase 8e Task 3 (`K31`, `K36`, issue 102): the free-tier meter. `undefined`,
  // not `null` — `GET .../usage` omits the field entirely on the `node`
  // target (`K36`), and `undefined` is what reading an absent key off a
  // parsed body already gives for free, with no `?? null` to invent a
  // second "nothing" the type does not need.
  usage(workspaceId: string): Promise<UsageProjection | undefined>;
  // Phase 8d Task 1: webhooks, behind `workspace.settings` like branding
  // above. `costPerCandidate` is absent on the `node` target (`K36`) — the
  // route omits the field rather than sending `null`.
  listWebhooks(workspaceId: string): Promise<{ webhooks: Webhook[]; costPerCandidate?: number }>;
  /** The one call that ever sees `signingSecret` (`KG5`) — shown once, by
   *  the panel, and never fetched again. */
  createWebhook(
    workspaceId: string,
    input: { url: string; events: WebhookEvent[] },
  ): Promise<{ id: string; url: string; events: WebhookEvent[]; signingSecret: string }>;
  setWebhookActive(workspaceId: string, webhookId: string, active: boolean): Promise<void>;
  deleteWebhook(workspaceId: string, webhookId: string): Promise<void>;

  // Phase 8d Task 2 (K25, K26, KG5): scoped API keys, behind `keys.manage`
  // like webhooks above.
  listApiKeys(workspaceId: string): Promise<{ keys: ApiKey[] }>;
  /** The one call that ever sees `secret` (`KG5`) — shown once, by the
   *  panel, and never fetched again. */
  createApiKey(
    workspaceId: string,
    input: { name: string; scopes: Action[] },
  ): Promise<{ id: string; name: string; scopes: Action[]; secret: string }>;
  revokeApiKey(workspaceId: string, keyId: string): Promise<void>;
}

/** Mirrors `packages/db/src/repo/webhooks.ts`'s `WebhookRow` — the wire
 * shape, never `signingSecret`. */
export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdAt: number;
}

/** The closed set `packages/db/src/repo/webhooks.ts` exports as
 * `WEBHOOK_EVENTS`. Not re-exported from `@pariksha/db` here —
 * `apps/web` does not depend on that package — so the two strings are
 * typed by hand; `WebhookPanel.tsx`'s own test pins them against the
 * route's actual `GET .../webhooks` response, which is what would catch
 * the two ever drifting apart. `K43`: "attempt.flagged" is deliberately
 * not a member — see `webhooks.ts`'s own header. MAJOR-3 (whole-branch
 * review): "attempt.started" is the identical defect and was dropped the
 * same way — nothing ever fired it, and offering it in this selector with
 * no caller behind it is `Q1b`.
 */
export type WebhookEvent = "attempt.submitted" | "test.closed";
export const WEBHOOK_EVENTS: readonly WebhookEvent[] = ["attempt.submitted", "test.closed"];

/** Mirrors `packages/db/src/repo/keys.ts`'s `ApiKeyRow` — the wire shape,
 * never the secret (`KG5`). */
export interface ApiKey {
  id: string;
  name: string;
  scopes: Action[];
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** One row of the uploaded list. Mirrors `CandidateRow` in
 * `packages/db/src/repo/candidates.ts` — the wire shape, not the row. */
export interface CandidateRow {
  id: string;
  testId: string;
  externalId: string | null;
  setLabel: string | null;
  formValues: Record<string, unknown>;
  source: "list" | "registration";
  consentVersion: string | null;
  createdAt: number;
}

// Phase 7e Task 4 (`Q5a`): the minimal pair — mirrors `LockedAttemptRow`
// (`apps/api/src/routes/attempts.ts`), the wire shape verbatim.
export interface LockedAttemptRow {
  attemptId: string;
  candidateLabel: string;
  lockedAt: number;
  violations: number;
  remainingSeconds: number;
}

export interface CandidateIssue {
  field: string;
  message: string;
  /** The physical line of the uploaded file this is about. */
  line: number;
}

export interface CandidateImportReport {
  imported: number;
  issues: CandidateIssue[];
}

const API = "/api/v1";

/**
 * Review Focus item 2 of the Phase 3 plan: `?returnTo=https://evil.example`
 * is an open redirect. A return target is a same-origin *path* and nothing
 * else — so it must start with a single `/`, and carry no backslash (which
 * browsers normalise to `/`, smuggling `//evil.example` past a naive check)
 * and no whitespace (which can hide a scheme).
 *
 * `apps/api/src/auth/oidc.ts` validates the same thing server-side. Both
 * halves check it: this one decides where the browser is sent, that one
 * decides what the callback honours.
 */
const SAFE_RETURN_TO = /^\/(?![/\\])[^\s\\]*$/;

export function safeReturnTo(raw: string | null | undefined): string {
  return raw !== null && raw !== undefined && SAFE_RETURN_TO.test(raw)
    ? raw
    : "/";
}

/** Where the browser goes to start a sign-in. A navigation, not a fetch. */
export function signInUrl(
  providerId: string,
  returnTo: string | null | undefined,
): string {
  const params = new URLSearchParams({ returnTo: safeReturnTo(returnTo) });
  return `${API}/auth/${encodeURIComponent(providerId)}/start?${params}`;
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const error = (value as { error?: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  // Sessions are an HttpOnly cookie (Phase 3 Task 2), so every call is
  // credentialed. Same-origin only — the CSP is `connect-src 'self'`.
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { Accept: "application/json" },
    ...init,
  });
  if (response.ok) return response;

  const body: unknown = await response.json().catch(() => null);
  if (isErrorEnvelope(body)) {
    throw new ApiError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.details,
    );
  }
  // A failure that is not the envelope is a bug or a proxy in the way; say
  // something a person can act on rather than echoing the status.
  throw new ApiError(
    response.status,
    "unexpected_response",
    "Pariksha could not be reached. Check the server is running, then try again.",
  );
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await request(path, init)).json() as Promise<T>;
}

function withBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  };
}

const post = (body: unknown): RequestInit => withBody("POST", body);
const patchBody = (body: unknown): RequestInit => withBody("PATCH", body);

function query(params: Record<string, string | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function createApiClient(): ApiClient {
  return {
    setupStatus: () => json<SetupStatus>("/setup/status"),

    // The two routes below answer envelopes the screens do not use. This
    // file was written against a sketch of the API months before the
    // routes shipped, and the end-to-end flow is what caught the drift:
    // `/me` nests the account under `user`, and `/workspaces` returns a
    // named list rather than a bare array. The decoding belongs here — the
    // screens and their tests speak `Actor` and `Workspace`.
    async me() {
      try {
        const body = await json<{
          user: { id: string; email: string };
          memberships: Membership[];
        }>("/me");
        return {
          userId: body.user.id,
          email: body.user.email,
          memberships: body.memberships,
        };
      } catch (error) {
        // 401 is the ordinary answer for "nobody is signed in", not a
        // failure worth showing anyone.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },

    workspaces: async () =>
      (await json<{ workspaces: Workspace[] }>("/workspaces")).workspaces,

    completeSetup: (input) =>
      json<Workspace>("/setup/complete", post({ name: input.workspaceName })),

    async requestMagicLink(email) {
      await request("/auth/magic-link", post({ email }));
    },

    async signOut() {
      await request("/auth/signout", post({}));
    },

    listBanks: async (workspaceId) =>
      (await json<{ banks: Bank[] }>(`/workspaces/${workspaceId}/banks`)).banks,

    createBank: (workspaceId, input) =>
      json<Bank>(`/workspaces/${workspaceId}/banks`, post(input)),

    async listQuestions(workspaceId, bankId, filter = {}) {
      const qs = query({
        type: filter.type,
        tag: filter.tag,
        difficulty: filter.difficulty,
        unused: filter.unused,
        search: filter.search,
        cursor: filter.cursor,
      });
      return json<{ questions: QuestionSummary[]; cursor?: string }>(
        `/workspaces/${workspaceId}/banks/${bankId}/questions${qs}`,
      );
    },

    async deleteQuestion(workspaceId, bankId, questionId) {
      await request(`/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}`, {
        method: "DELETE",
      });
    },

    saveQuestion: (workspaceId, bankId, doc) =>
      json<QuestionSummary>(`/workspaces/${workspaceId}/banks/${bankId}/questions`, post(doc)),

    listTags: async (workspaceId) => (await json<{ tags: string[] }>(`/workspaces/${workspaceId}/tags`)).tags,

    listGroups: async (workspaceId, bankId) =>
      (await json<{ groups: PassageGroupSummary[] }>(`/workspaces/${workspaceId}/banks/${bankId}/groups`)).groups,

    createGroup: (workspaceId, bankId, input) =>
      json<PassageGroupSummary>(`/workspaces/${workspaceId}/banks/${bankId}/groups`, post(input)),

    // Fix round 1, finding 2: `groupId` is author-written (`newGroup.id`,
    // `apps/api/src/routes/banks.ts`), unlike every other ID this client
    // interpolates into a path — a question's `:qid` is the server-generated
    // row id, never what an author typed. Encoded here the way `:qid` never
    // needs to be.
    updateGroup: (workspaceId, bankId, groupId, patch) =>
      json<PassageGroupSummary>(
        `/workspaces/${workspaceId}/banks/${bankId}/groups/${encodeURIComponent(groupId)}`,
        patchBody(patch),
      ),

    async deleteGroup(workspaceId, bankId, groupId) {
      await request(`/workspaces/${workspaceId}/banks/${bankId}/groups/${encodeURIComponent(groupId)}`, {
        method: "DELETE",
      });
    },

    async importBank(workspaceId, bankId, doc, opts = {}) {
      const params = new URLSearchParams();
      if (opts.dryRun) params.set("dryRun", "1");
      if (opts.format) params.set("format", opts.format);
      const qs = params.toString() ? `?${params}` : "";
      // Task 8: a CSV/GIFT import sends `doc` (already a string — see this
      // method's own doc comment) as the body verbatim; JSON keeps `post`'s
      // existing `JSON.stringify` + `Content-Type: application/json`.
      const init: RequestInit = opts.format
        ? { method: "POST", headers: { "Content-Type": "text/plain", Accept: "application/json" }, body: doc as string }
        : post(doc);
      try {
        return await json<ImportReport>(`/workspaces/${workspaceId}/banks/${bankId}/import${qs}`, init);
      } catch (error) {
        // Fix round 1, finding 9: a validation failure
        // (apps/api/src/import/json.ts) is a 422 whose `details` *is* an
        // `ImportReport` (`imported: 0`, `issues` populated) — the server
        // throws that exact shape rather than a bare `{ issues }`, so this
        // is the one type used uniformly on both outcomes, not two
        // identically-named types with opposite invariants. Normalised here
        // so `ImportDialog` renders one report shape whether the import
        // succeeded or not, rather than a try/catch of its own around every
        // call.
        if (error instanceof ApiError && error.status === 422 && isImportReport(error.details)) {
          return error.details;
        }
        throw error;
      }
    },

    exportBank: (workspaceId, bankId, ids) => {
      const qs = ids && ids.length > 0 ? `?ids=${ids.map(encodeURIComponent).join(",")}` : "";
      return json<BankDocument>(`/workspaces/${workspaceId}/banks/${bankId}/export${qs}`);
    },

    exportQuestion: (workspaceId, bankId, questionId) =>
      json<Question>(`/workspaces/${workspaceId}/banks/${bankId}/questions/${questionId}/export`),

    async tests(workspaceId, filter = {}) {
      const qs = query({
        status: filter.status,
        search: filter.search,
        sort: filter.sort,
      });
      return (await json<{ tests: TestSummary[] }>(`/workspaces/${workspaceId}/tests${qs}`)).tests;
    },

    createTest: (workspaceId, input) => json<TestSummary>(`/workspaces/${workspaceId}/tests`, post(input)),

    test: (workspaceId, testId) => json<TestSummary>(`/workspaces/${workspaceId}/tests/${testId}`),

    updateTest: (workspaceId, testId, patch) =>
      json<TestSummary>(`/workspaces/${workspaceId}/tests/${testId}`, patchBody(patch)),

    publishTest: (workspaceId, testId) =>
      json<TestSummary>(`/workspaces/${workspaceId}/tests/${testId}/publish`, post({})),
    closeTest: (workspaceId, testId) =>
      json<TestSummary>(`/workspaces/${workspaceId}/tests/${testId}/close`, post({})),
    archiveTest: (workspaceId, testId) =>
      json<TestSummary>(`/workspaces/${workspaceId}/tests/${testId}/archive`, post({})),
    versions: async (workspaceId, testId) =>
      (await json<{ versions: TestVersionSummary[] }>(`/workspaces/${workspaceId}/tests/${testId}/versions`)).versions,
    checklist: async (workspaceId, testId) =>
      (await json<{ rows: ChecklistRow[] }>(`/workspaces/${workspaceId}/tests/${testId}/checklist`)).rows,

    cloneTest: (workspaceId, testId) =>
      json<TestSummary>(`/workspaces/${workspaceId}/tests/${testId}/clone`, post({})),

    exportTest: (workspaceId, testId, version) =>
      json<TestDocument>(
        `/workspaces/${workspaceId}/tests/${testId}/export${version === undefined ? "" : `?version=${version}`}`,
      ),

    async importTest(workspaceId, doc, opts = {}) {
      try {
        return await json<TestImportReport>(
          `/workspaces/${workspaceId}/tests/import${opts.dryRun ? "?dryRun=1" : ""}`,
          post(doc),
        );
      } catch (error) {
        // Whole-branch drift review, M-03. This was a cast where its two
        // siblings (`importBank`, `importCandidates`) use a guard, so a
        // 422 whose `details` is *not* the route's report became a report
        // with zero issues and `ImportDialog` rendered a dialog saying
        // nothing happened and not why. Guarded now, and the fallbacks go
        // with the cast: a report with no issues is not a thing this route
        // produces, so inventing one hides whatever really went wrong.
        if (error instanceof ApiError && error.status === 422 && isTestImportDetails(error.details)) {
          return { testId: null, imported: false, issues: error.details.issues, rebound: error.details.rebound };
        }
        throw error;
      }
    },

    draft: (workspaceId, testId) => json<TestVersionRow>(`/workspaces/${workspaceId}/tests/${testId}/draft`),

    patchDraft: (workspaceId, testId, patch) =>
      json<TestVersionRow>(`/workspaces/${workspaceId}/tests/${testId}/draft`, patchBody(patch)),

    checkUrl: (workspaceId, testId, url) =>
      json<ReachResult>(`/workspaces/${workspaceId}/tests/${testId}/check-url`, post({ url })),

    workspaceBranding: async (workspaceId) =>
      (await json<{ branding: TestBranding | null }>(`/workspaces/${workspaceId}`)).branding ?? {},

    saveWorkspaceBranding: async (workspaceId, branding) =>
      (await json<{ branding: TestBranding | null }>(`/workspaces/${workspaceId}`, patchBody({ branding })))
        .branding ?? {},

    uploadMedia: (workspaceId, bankId, file) =>
      json<{ key: string }>(`/workspaces/${workspaceId}/banks/${bankId}/media`, {
        method: "POST",
        // The route reads the image type off `Content-Type` and the bytes
        // off the body — no multipart wrapper to unpick on a Worker.
        headers: { "Content-Type": file.type, Accept: "application/json" },
        body: file,
      }),

    candidates: async (workspaceId, testId) =>
      (await json<{ candidates: CandidateRow[] }>(`/workspaces/${workspaceId}/tests/${testId}/candidates`)).candidates,

    async importCandidates(workspaceId, testId, csv, opts = {}) {
      const qs = opts.dryRun ? "?dryRun=1" : "";
      try {
        return await json<CandidateImportReport>(
          `/workspaces/${workspaceId}/tests/${testId}/candidates/import${qs}`,
          { method: "POST", headers: { "Content-Type": "text/csv", Accept: "application/json" }, body: csv },
        );
      } catch (error) {
        // The 422's `details` *is* the report (`imported: 0`, `issues`
        // populated), so the panel renders one shape whether the upload
        // landed or not. Anything else — 403, 404, 413 — still throws.
        if (error instanceof ApiError && error.status === 422 && isCandidateReport(error.details)) {
          return error.details;
        }
        throw error;
      }
    },

    lockedAttempts: async (workspaceId, testId) =>
      (
        await json<{ attempts: LockedAttemptRow[] }>(
          `/workspaces/${workspaceId}/tests/${testId}/attempts?status=locked`,
        )
      ).attempts,

    async unlockAttempt(workspaceId, testId, attemptId) {
      await json(`/workspaces/${workspaceId}/tests/${testId}/attempts/${attemptId}/unlock`, post({}));
    },

    async exportCandidateData(workspaceId, candidateId) {
      const response = await request(`/workspaces/${workspaceId}/candidates/${candidateId}/data`);
      // The route names the file in `content-disposition` (`errors.ts`'s
      // own envelope carries no filename, so this is the one place it
      // lives); a filename here is only a fallback for a proxy that drops
      // the header, never the expected path.
      const match = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
      const filename = match?.[1] ?? `candidate_${candidateId}_export.json`;
      return { data: (await response.json()) as unknown, filename };
    },

    deleteCandidateData: (workspaceId, candidateId, keepAnonymisedScore) =>
      json<{ tablesTouched: string[] }>(`/workspaces/${workspaceId}/candidates/${candidateId}/data`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepAnonymisedScore }),
      }),

    usage: async (workspaceId) =>
      (await json<{ usage?: UsageProjection }>(`/workspaces/${workspaceId}/usage`)).usage,
    listWebhooks: (workspaceId) =>
      json<{ webhooks: Webhook[]; costPerCandidate?: number }>(`/workspaces/${workspaceId}/webhooks`),

    createWebhook: (workspaceId, input) =>
      json(`/workspaces/${workspaceId}/webhooks`, post(input)),

    async setWebhookActive(workspaceId, webhookId, active) {
      await request(`/workspaces/${workspaceId}/webhooks/${webhookId}`, patchBody({ active }));
    },

    async deleteWebhook(workspaceId, webhookId) {
      await request(`/workspaces/${workspaceId}/webhooks/${webhookId}`, { method: "DELETE" });
    },

    listApiKeys: (workspaceId) => json<{ keys: ApiKey[] }>(`/workspaces/${workspaceId}/keys`),

    createApiKey: (workspaceId, input) => json(`/workspaces/${workspaceId}/keys`, post(input)),

    async revokeApiKey(workspaceId, keyId) {
      await request(`/workspaces/${workspaceId}/keys/${keyId}`, { method: "DELETE" });
    },
  };
}

function isCandidateReport(value: unknown): value is CandidateImportReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { imported?: unknown }).imported === "number" &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}

/** The same kind of shape test its two siblings use, against what
 * `POST .../tests/import` actually puts in a 422's `details` — the
 * report's two lists, without the `testId`/`imported` the route already
 * knows the answer to (`apps/api/src/routes/tests.ts`). */
function isTestImportDetails(
  value: unknown,
): value is Pick<TestImportReport, "issues" | "rebound"> {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { issues?: unknown }).issues) &&
    Array.isArray((value as { rebound?: unknown }).rebound)
  );
}

function isImportReport(value: unknown): value is ImportReport {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { imported?: unknown }).imported === "number" &&
    Array.isArray((value as { issues?: unknown }).issues)
  );
}
