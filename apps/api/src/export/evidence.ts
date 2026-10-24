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
// **Audit correction (not in the original draft): this route needs no `KG1`
// exemption, because it never carries a key or an explanation at all.**
// The draft's own comment here claimed the opposite — that the document was
// "deliberately not scrubbed" of them, as if it were an organiser-only
// answer key. `toTestDocument` (`packages/db/src/repo/test-document.ts`)
// says otherwise: a section's `source` names question *ids* (translated to
// the bank file's own ref ids), never a question's `key_json`/
// `explanation_json`/`rubric_json` — that content lives only in the bank
// format, reachable through `export/bank.ts` under `banks.edit`, a
// permission a Viewer does not hold. `scrub-scan.test.ts`'s `KG1` scan
// covers `test.json` in its ordinary loop, with no exemption, and proves
// the point by finding nothing to redact.
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
// **Dead objects get a word, never a dead link.** A snapshot row can outlive
// its object — Phase 8e's retention sweep deletes objects on a schedule, and
// a URL to a missing one 404s silently inside a download loop. Existence is
// checked with one `StorageAdapter.list` per attempt's own key prefix
// (`snapshot/<attemptId>/`) — one subrequest for however many snapshots that
// attempt has, never one `get` per key, which is the ceiling problem again.
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
 * existence check below spends one `StorageAdapter.list` per attempt in the
 * page, and that cost — not the D1 bound-parameter cap — is what the
 * 50-subrequest ceiling actually limits here.
 *
 * Budget decision (resume-plan review): the draft set this to 40, which
 * worked out to auth (2) + `getTest` (1) + `listAttemptsForTest` (1) +
 * `listSnapshotsForAttempts` (1) + up to 40 `list` calls = 45 against a
 * ceiling of 50 — five subrequests of headroom, so one more fixed call
 * added anywhere in the request path later (a webhook check, an audit
 * write) breaks this route in production with no test ever turning red.
 * Lowered to 20 (worst case 25, half the ceiling): the manifest already
 * pages, and `signedUrl` costs nothing (`K4`), so a smaller page is nearly
 * free here in a way the heavier CSV exports' page sizes are not. Still
 * flat in how many snapshots any one attempt holds — a Strict attempt's
 * ~60 images cost the same single `list` as a Flexible attempt's one.
 */
const SNAPSHOTS_PAGE_LIMIT_MAX = 20;

export interface SnapshotManifestRow {
  attemptId: string;
  candidateId: string;
  takenAt: number;
  reason: string;
  faceCount: number | null;
  /** `null` when the object's prefix listing came back without this row's
   *  key — the retention sweep already took it. */
  url: string | null;
}

/** The key prefix a snapshot's own key (`proctoring.ts`'s
 *  `snapshot/<attemptId>/<takenAt>-<reason>.jpg`) always falls under — one
 *  `list()` against it answers "does this attempt's object still exist" for
 *  every snapshot that attempt has, in the one subrequest `K3` budgets for. */
const snapshotPrefix = (attemptId: string): string => `snapshot/${attemptId}/`;

/**
 * Mints a manifest row per snapshot behind `opts.attemptIds`, checking each
 * one's object against a prefix listing taken once per **attempt** (`K3`)
 * rather than once per key, and minting `signedUrl` only for a key the
 * listing actually returned — never handing out a URL to an object the
 * retention sweep already took.
 *
 * `signedUrl` itself spends no storage subrequest at all (`instrument.ts`'s
 * own ruling, `K4`), so this function's whole storage cost is the `list`
 * calls — one per **distinct** attempt that has at least one snapshot, flat
 * in how many snapshots that attempt actually has (a Strict attempt's ~60
 * images cost the same single `list` as a Flexible attempt's one). Exported
 * on its own, apart from the paged route below, so that cost shape is
 * provable independent of `SNAPSHOTS_PAGE_LIMIT_MAX`.
 */
export async function snapshotManifest(
  deps: AppDeps,
  workspaceId: string,
  opts: { attemptIds: readonly string[] },
): Promise<SnapshotManifestRow[]> {
  const rows = await listSnapshotsForAttempts(deps.db, workspaceId, opts.attemptIds);
  const attemptIds = [...new Set(rows.map((row) => row.attemptId))];
  const liveKeys = new Map<string, Set<string>>();
  for (const attemptId of attemptIds) {
    const { keys } = await deps.storage.list(snapshotPrefix(attemptId));
    liveKeys.set(attemptId, new Set(keys));
  }

  const now = deps.now();
  const out: SnapshotManifestRow[] = [];
  for (const row of rows) {
    const exists = liveKeys.get(row.attemptId)?.has(row.storageKey) ?? false;
    const url = exists
      ? await deps.storage.signedUrl(row.storageKey, { expiresInSeconds: SIGNED_URL_TTL_SECONDS, now })
      : null;
    out.push({
      attemptId: row.attemptId,
      candidateId: row.candidateId,
      takenAt: row.takenAt,
      reason: row.reason,
      faceCount: row.faceCount,
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
  { header: "Status", value: (row) => (row.url === null ? "deleted" : "ok") },
  { header: "URL", value: (row) => row.url ?? "" },
];

/** `K4`: states its own expiry rather than leaving an organiser to guess why
 *  a URL from an hour ago stopped working, and points at `K3`'s documented
 *  one-liner instead of this file inventing a second explanation of it. No
 *  commas — this line rides above `toCsv`'s own quoting, not through it. */
const MANIFEST_HEADER_COMMENT = (): string =>
  `# Pariksha snapshot manifest - each URL expires ${SIGNED_URL_TTL_SECONDS} seconds after this file was generated; ` +
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
 * `tests.edit` route (`routes/tests.ts`) calls; this is a second door onto
 * it, not a second serialiser.
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
    return c.json(await exportTest(deps, workspaceId, testId, versionQueryParam(c)));
  });

  return routes;
}
