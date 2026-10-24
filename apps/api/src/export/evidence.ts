// Phase 8c Task 4 (`R-09`, `K1`, `K3`, `K4`, `KG1`, `K38`, `#98`) — the
// organiser's evidence exports: the events CSV, the snapshot manifest, and
// the test definition reached from a second, more permissive door.
//
// **`test.json` is an alias, not a serialiser (`K8`'s own instinct, applied
// to a whole document instead of a CSV).** `exportTest` (`export/test.ts`)
// already turns a test version into the `pariksha/test@1` document; the only
// thing new here is a second route that reaches the same function under
// `results.export` instead of `tests.edit`, because a Viewer who may export
// results still needs the definition that explains their CSV's columns.
//
// **Audit correction, round 1: this route needs no `KG1` exemption for a
// question's key/explanation/rubric, because it never carries one at all.**
// The original draft's comment here claimed the opposite — that the
// document was "deliberately not scrubbed" of them, as if it were an
// organiser-only answer key. `toTestDocument`
// (`packages/db/src/repo/test-document.ts`) says otherwise: a section's
// `source` names question *ids* (translated to the bank file's own ref
// ids), never a question's `key_json`/`explanation_json`/`rubric_json` —
// that content lives only in the bank format, reachable through
// `export/bank.ts` under `banks.edit`, a permission a Viewer does not hold.
// `scrub-scan.test.ts`'s `KG1` scan covers `test.json` in its ordinary
// loop, with no exemption, and proves the point by finding nothing to
// redact there.
//
// **Audit correction, round 2 (fix round 1, C1 — a Critical found in
// review, after the first correction above still shipped the bug): the
// document is not otherwise harmless.** `pariksha/test@1` also carries
// `access`, including `access_code` — the `link_code` credential
// itself, an `ABSOLUTE_SECRET` in both scrub-scan fixtures
// (`apps/api/test/run/scrub-scan.test.ts`,
// `apps/api/test/export/scrub-scan.test.ts`) — and `allow_email_domains`/
// `allow_ip_ranges`, the perimeter a Viewer has no need to read. The route
// below drops the whole `access` block before responding, at this door
// only; the `tests.edit` route an Author uses still returns it whole.
//
// **`K3`: the snapshot export is a manifest, never a ZIP.** One R2 `get` is
// one subrequest, a single Strict attempt at the 60s default holds ~60
// images, and a ZIP of even one attempt's worth already exceeds the
// 50-subrequest ceiling. So: one CSV row per snapshot, a presigned URL
// (`StorageAdapter.signedUrl`, the one storage call `instrument.ts`
// deliberately never counts — `K4`), and a documented `curl`/`wget`
// one-liner in `docs/exports.md`, referenced from the manifest's own header
// comment row.
//
// **A dead object gets a word, not a silent dead link.** A snapshot row can
// outlive its object — Phase 8e's retention sweep deletes objects on a
// schedule, and a URL to a missing one 404s silently inside a download loop.
// Existence is checked with up to `MAX_LIST_PAGES_PER_ATTEMPT` (2)
// `StorageAdapter.list` calls against the attempt's own key prefix
// (`snapshot/<attemptId>/`), never one `get` per key, which is the ceiling
// problem again. A row the capped listing cannot rule out reads `unknown`
// and **keeps its URL** — that link may well 404, and a visible 404 beats a
// confident `deleted` about evidence that still exists.
//
// **`K1`: `null` is "not counted", never "zero".** `snapshot.face_count` is
// written `null` for every row the product has ever produced (on-device face
// counting is cut — `attempts.ts`'s own doc comment on `recordSnapshot`).
// Rendered as `not counted` here, the one place this column reaches an
// organiser's eyes outside the live proctoring view.

import { Hono } from "hono";
import type { Context } from "hono";
import { csvFilename, toCsv, type CsvColumn } from "@pariksha/core";
import {
  getTest,
  listAttemptsForTest,
  listEventsForTest,
  listSnapshotsForAttempts,
  type EventRow,
  type TestRow,
} from "@pariksha/db";
import { SIGNED_URL_TTL_SECONDS } from "@pariksha/storage";
import type { AppBindings, AppDeps } from "../app.js";
import { ApiError } from "../errors.js";
import { requires } from "../middleware/authorize.js";
import { exportTest } from "./test.js";
import type { ExportPage, ExportPageOptions } from "./results.js";

async function requireTest(deps: AppDeps, workspaceId: string, testId: string): Promise<TestRow> {
  const test = await getTest(deps.db, workspaceId, testId);
  if (!test) throw new ApiError(404, "not_found", "No such resource.");
  return test;
}

/** Cursor and limit, read the same way `export/results.ts`'s own
 *  `pageOptions` does — duplicated rather than imported, the same choice
 *  that file's `originOf` makes and names out loud: a four-line query-param
 *  reader is cheaper to repeat than to couple two route files over. */
function pageOptions(c: Context<AppBindings>): { cursor?: string; limit?: number } {
  const cursor = c.req.query("cursor");
  const limitRaw = c.req.query("limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new ApiError(400, "invalid_request", "The request body is not valid.", {
      issues: [{ path: "limit", message: "must be a positive integer" }],
    });
  }
  return {
    ...(cursor !== undefined && { cursor }),
    ...(limit !== undefined && { limit }),
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();

// --- the events CSV (`R-09`) -------------------------------------------------

const cellOf = (value: unknown): string => (value === null || value === undefined ? "" : JSON.stringify(value));

const EVENT_COLUMNS: CsvColumn<EventRow>[] = [
  { header: "Attempt", value: (row) => row.attemptId },
  { header: "Candidate", value: (row) => row.candidateId },
  { header: "Type", value: (row) => row.type },
  // Telemetry the candidate's own client reported (`fullscreen_exit`,
  // `tab_blur`, …) — never a question, a response or anything the bank
  // holds, so there is nothing here for `KG1` to catch, unlike the
  // per-answer CSV it governs directly.
  { header: "Detail", value: (row) => cellOf(row.detail) },
  { header: "Client time", value: (row) => iso(row.clientTs) },
  { header: "Server time", value: (row) => iso(row.serverTs) },
];

/**
 * One page of the events CSV, keyset-paged over the whole test
 * (`listEventsForTest`'s own cursor) — `K38`: a filled page always carries a
 * `nextCursor`, so there is no shape where a full-looking page is secretly
 * partial.
 */
export async function exportEventsPage(
  deps: AppDeps,
  workspaceId: string,
  testId: string,
  opts: ExportPageOptions = {},
): Promise<ExportPage> {
  const test = await requireTest(deps, workspaceId, testId);
  const { rows, nextCursor } = await listEventsForTest(deps.db, workspaceId, testId, {
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.cursor !== undefined && { cursor: opts.cursor }),
  });

  const firstPage = opts.cursor === undefined;
  return {
    csv: toCsv(rows, EVENT_COLUMNS, { bom: firstPage, header: firstPage }),
    nextCursor,
    filename: csvFilename(test.slug, "events", deps.now()),
  };
}

// --- the snapshot manifest (`K3`, `K4`, `K1`) --------------------------------

/**
 * Clamped the same way `export/results.ts`'s `ANSWERS_PAGE_LIMIT_MAX` is,
 * for the same reason stated there and a second one of this file's own: the
 * existence check below spends up to `MAX_LIST_PAGES_PER_ATTEMPT` `list`
 * calls per attempt in the page, not a flat one — and that cost, not the D1
 * bound-parameter cap, is what the 50-subrequest ceiling actually limits
 * here.
 *
 * Budget decision (resume-plan review): the draft set this to 40, which
 * worked out to auth (2) + `getTest` (1) + `listAttemptsForTest` (1) +
 * `listSnapshotsForAttempts` (1) + up to 40 `list` calls = 45 against a
 * ceiling of 50 — five subrequests of headroom, so one more fixed call
 * added anywhere in the request path later (a webhook check, an audit
 * write) breaks this route in production with no test ever turning red.
 * Lowered to 20 (worst case 25, half the ceiling).
 *
 * Fix round 1, `I2`: lowered again, to 10, when the existence check itself
 * grew a second `list` call per attempt (below) — following `list`'s own
 * pagination cursor, since dropping it silently misreported live snapshots
 * as deleted past R2's 1000-key page. Worst case stays exactly 25: auth (2)
 * + `getTest` (1) + `listAttemptsForTest` (1) + `listSnapshotsForAttempts`
 * (1) + (10 attempts × up to 2 `list` pages each) = 25. `signedUrl` still
 * costs nothing (`K4`). This halves the rows a caller gets per request, which
 * the manifest's own paging absorbs; what it buys is that the worst case
 * was before this fix.
 */
const SNAPSHOTS_PAGE_LIMIT_MAX = 10;

export interface SnapshotManifestRow {
  attemptId: string;
  candidateId: string;
  takenAt: number;
  reason: string;
  faceCount: number | null;
  /** `"ok"`: the listing (complete or not) found this key. `"deleted"`: a
   *  *complete* listing did not — the retention sweep took it. `"unknown"`
   *  (`I2`): the listing was capped before finishing and did not find the
   *  key, so whether the object still exists is genuinely unknown, not
   *  confidently no — rendering `"deleted"` here would be a confident lie
   *  about proctoring evidence, which fix round 1 ruled strictly worse than
   *  a URL that might 404. */
  status: "ok" | "deleted" | "unknown";
  /** `null` only for a `"deleted"` row. A `"unknown"` row still gets a URL
   *  — minted on the chance the object is there, same as an `"ok"` row. */
  url: string | null;
}

/** The key prefix a snapshot's own key (`proctoring.ts`'s
 *  `snapshot/<attemptId>/<takenAt>-<reason>.jpg`) always falls under — a
 *  `list()` against it answers "does this attempt's object still exist" for
 *  every snapshot that attempt has, in the one-to-two subrequests `K3`
 *  budgets for (`MAX_LIST_PAGES_PER_ATTEMPT`). */
const snapshotPrefix = (attemptId: string): string => `snapshot/${attemptId}/`;

/**
 * Fix round 1, `I2`: the draft's existence check read exactly one `list`
 * page per attempt and treated anything past it as deleted. R2 pages at up
 * to 1000 keys and sets `StorageAdapter.list`'s own `cursor` whenever it
 * truncates (`packages/storage/src/r2.ts`) — and `snapshot_interval_seconds`
 * has `"minimum": 0` with no maximum (`schemas/test-1.json`), where 0 means
 * snapshots off, so the smallest capture-producing interval is **1 second**
 * and a 60-minute test can produce ~3600 objects under one attempt's prefix,
 * well past the first page. Dropping the cursor there meant
 * live snapshots 1001 onward quietly rendered `deleted`, a confident lie
 * about evidence that still exists — worse than the 404 the existence
 * check exists to prevent, because a 404 is visible and a wrong `deleted`
 * is not.
 *
 * Follows the cursor, but bounded at `MAX_LIST_PAGES_PER_ATTEMPT` (2) pages
 * — an unbounded follow would make this function's own cost unbounded,
 * which breaks the ceiling `SNAPSHOTS_PAGE_LIMIT_MAX`'s own fix-round-1
 * lowering exists to hold. Two pages covers up to ~2000 objects per
 * attempt, comfortably over the ~1800 a 60-minute test can produce even at
 * the floor interval. `truncated` tells the caller whether the listing it
 * got back is known-complete (so "not found" really does mean deleted) or
 * capped (so "not found" means genuinely unknown).
 */
const MAX_LIST_PAGES_PER_ATTEMPT = 2;

async function listLiveKeys(deps: AppDeps, attemptId: string): Promise<{ keys: Set<string>; truncated: boolean }> {
  const keys = new Set<string>();
  let cursor: string | undefined;
  let pagesRead = 0;
  // No initial value: the loop below always runs at least once and
  // assigns this before anything reads it (ESLint's own
  // `no-useless-assignment` flags a `= false` here as dead).
  let hasMore: boolean;
  do {
    const page = await deps.storage.list(snapshotPrefix(attemptId), cursor);
    for (const key of page.keys) keys.add(key);
    pagesRead += 1;
    cursor = page.cursor;
    hasMore = cursor !== undefined;
  } while (hasMore && pagesRead < MAX_LIST_PAGES_PER_ATTEMPT);
  return { keys, truncated: hasMore };
}

/**
 * Mints a manifest row per snapshot behind `opts.attemptIds`, checking each
 * one's object against a prefix listing taken once per **attempt** (`K3`)
 * rather than once per key, and minting `signedUrl` for a key the listing
 * found or could not rule out (`I2`) — never for one a *complete* listing
 * confirmed gone.
 *
 * `signedUrl` itself spends no storage subrequest at all (`instrument.ts`'s
 * own ruling, `K4`), so this function's whole storage cost is the `list`
 * calls — up to `MAX_LIST_PAGES_PER_ATTEMPT` per **distinct** attempt that
 * has at least one snapshot, not flat the way a single-page read was:
 * a key past the first 1000 costs the second `list`. A page beyond the cap
 * costs nothing, because it is never read.
 * Exported on its own, apart from the paged route below, so that cost shape
 * is provable independent of `SNAPSHOTS_PAGE_LIMIT_MAX`.
 */
export async function snapshotManifest(
  deps: AppDeps,
  workspaceId: string,
  opts: { attemptIds: readonly string[] },
): Promise<SnapshotManifestRow[]> {
  const rows = await listSnapshotsForAttempts(deps.db, workspaceId, opts.attemptIds);
  const attemptIds = [...new Set(rows.map((row) => row.attemptId))];
  const liveKeys = new Map<string, { keys: Set<string>; truncated: boolean }>();
  for (const attemptId of attemptIds) {
    liveKeys.set(attemptId, await listLiveKeys(deps, attemptId));
  }

  const now = deps.now();
  const out: SnapshotManifestRow[] = [];
  for (const row of rows) {
    const listing = liveKeys.get(row.attemptId);
    const found = listing?.keys.has(row.storageKey) ?? false;
    const truncated = listing?.truncated ?? false;
    const status: SnapshotManifestRow["status"] = found ? "ok" : truncated ? "unknown" : "deleted";
    const url =
      status === "deleted" ? null : await deps.storage.signedUrl(row.storageKey, { expiresInSeconds: SIGNED_URL_TTL_SECONDS, now });
    out.push({
      attemptId: row.attemptId,
      candidateId: row.candidateId,
      takenAt: row.takenAt,
      reason: row.reason,
      faceCount: row.faceCount,
      status,
      url,
    });
  }
  return out;
}

const MANIFEST_COLUMNS: CsvColumn<SnapshotManifestRow>[] = [
  { header: "Attempt", value: (row) => row.attemptId },
  { header: "Candidate", value: (row) => row.candidateId },
  { header: "Taken at", value: (row) => iso(row.takenAt) },
  { header: "Reason", value: (row) => row.reason },
  // `K1`: never a bare `0` — `null` means the product has not counted faces
  // on this snapshot, not that it counted zero.
  { header: "Face count", value: (row) => (row.faceCount === null ? "not counted" : row.faceCount) },
  { header: "Status", value: (row) => row.status },
  { header: "URL", value: (row) => row.url ?? "" },
];

/** `K4`: states its own expiry rather than leaving an organiser to guess why
 *  a URL from an hour ago stopped working, and points at `K3`'s documented
 *  one-liner instead of this file inventing a second explanation of it.
 *  Fix round 1, `I2`: also states the existence check's own page cap —
 *  bounded-and-said, never bounded-and-silent, the same ruling this phase
 *  already made for the 500-attempt export truncation. No commas — this
 *  line rides above `toCsv`'s own quoting, not through it. */
const MANIFEST_HEADER_COMMENT = (): string =>
  `# Pariksha snapshot manifest - each URL expires ${SIGNED_URL_TTL_SECONDS} seconds after this file was generated; ` +
  `existence is checked against the first ${String(MAX_LIST_PAGES_PER_ATTEMPT)} page(s) of up to 1000 objects each, per attempt; ` +
  `a row past that reads "unknown" rather than "deleted" and still carries a URL; ` +
  `see docs/exports.md for a curl/wget one-liner to pull them down before then.\r\n`;

/**
 * One page of the snapshot manifest — paged over **attempts**
 * (`listAttemptsForTest`'s own cursor, the same shape `exportAnswersPage`
 * uses), flattened to one row per snapshot within that page. An attempt with
 * no snapshots simply contributes no row, same as `exportAnswersPage`'s
 * unanswered question.
 */
export async function exportSnapshotsPage(
  deps: AppDeps,
  workspaceId: string,
  testId: string,
  opts: ExportPageOptions = {},
): Promise<ExportPage> {
  const test = await requireTest(deps, workspaceId, testId);
  const limit = Math.min(opts.limit ?? SNAPSHOTS_PAGE_LIMIT_MAX, SNAPSHOTS_PAGE_LIMIT_MAX);

  const { rows: attempts, nextCursor } = await listAttemptsForTest(deps.db, workspaceId, testId, {
    limit,
    ...(opts.cursor !== undefined && { cursor: opts.cursor }),
  });

  // Audit fix (not in the original draft): this called a `snapshotManifestRows`
  // helper that was never defined (TS2552 — the file never compiled).
  // `snapshotManifest` above already does exactly this work — fetch,
  // check existence per attempt, mint URLs — given a set of attempt ids;
  // call it instead of duplicating `listSnapshotsForAttempts` and inventing
  // a second, half-written path to the same rows.
  const manifestRows = await snapshotManifest(deps, workspaceId, {
    attemptIds: attempts.map((row) => row.attemptId),
  });

  const firstPage = opts.cursor === undefined;
  const csv = toCsv(manifestRows, MANIFEST_COLUMNS, { bom: firstPage, header: firstPage });
  return {
    // The escape sequence rather than a literal BOM character in the regex
    // below: ESLint's no-irregular-whitespace rule flags a literal BOM
    // inside a regex (unlike inside a string, which it skips by default)
    // (audit fix — the draft's own literal-BOM regex here never passed lint).
    csv: firstPage ? csv.replace(/^(\uFEFF)?/, `$1${MANIFEST_HEADER_COMMENT()}`) : csv,
    nextCursor,
    filename: csvFilename(test.slug, "snapshots", deps.now()),
  };
}

// --- `test.json`: the existing export, reached from `results.export` --------

function versionQueryParam(c: Context<AppBindings>): number | undefined {
  const raw = c.req.query("version");
  if (raw === undefined) return undefined;
  const version = Number(raw);
  if (!Number.isInteger(version)) {
    throw new ApiError(400, "invalid_request", "The request body is not valid.", {
      issues: [{ path: "version", message: "must be a version number" }],
    });
  }
  return version;
}

/**
 * `GET …/export/events.csv`, `GET …/export/snapshots.csv` — both
 * `attempts.read_evidence`, held by Proctor, Reviewer, Admin and Owner but
 * not Viewer (`permissions.ts`) — and `GET …/export/test.json` —
 * `results.export`, held by Viewer too. The same `exportTest` the original
 * `tests.edit` route (`routes/tests.ts`) calls, minus `access`
 * (fix round 1, `C1` — see the file header); a second door onto the same
 * function, not a second serialiser.
 */
export function evidenceExportRoutes(deps: AppDeps): Hono<AppBindings> {
  const routes = new Hono<AppBindings>();

  routes.get("/:id/tests/:testId/export/events.csv", requires("attempts.read_evidence"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    return c.json(await exportEventsPage(deps, workspaceId, testId, pageOptions(c)));
  });

  routes.get("/:id/tests/:testId/export/snapshots.csv", requires("attempts.read_evidence"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    return c.json(await exportSnapshotsPage(deps, workspaceId, testId, pageOptions(c)));
  });

  routes.get("/:id/tests/:testId/export/test.json", requires("results.export"), async (c) => {
    const workspaceId = c.req.param("id");
    const testId = c.req.param("testId");
    // Fix round 1, C1: `exportTest`'s document carries `access` in
    // full — `access_code` is the credential `routes/run.ts`'s `sameSecret`
    // compares to admit a `link_code` candidate (an `ABSOLUTE_SECRET` in
    // both scrub-scan fixtures), and `allow_email_domains`/`allow_ip_ranges`
    // are perimeter configuration a reader has no need for either. Dropped
    // here, at the more permissive door only — `routes/tests.ts`'s own `/export`
    // still returns it whole, because an author editing the test needs its
    // own access policy. The result is evidence rather than a
    // policy document: `access` is not in `schemas/test-1.json`'s root
    // `required`, so this still imports — it simply yields a test carrying
    // no access policy of its own.
    const { access: _access, ...doc } = await exportTest(deps, workspaceId, testId, versionQueryParam(c));
    return c.json(doc);
  });

  return routes;
}
