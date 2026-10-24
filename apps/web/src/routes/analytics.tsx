import { useCallback, useEffect, useMemo, useState } from "react";
import { DISCRIMINATION_MIN_N } from "@pariksha/core";
import { ApiError, type ApiClient, type ItemStat, type TestAnalytics } from "../lib/api";

// Phase 8c Task 3 (`R-08`/`R-09`, `K38`, #97) — the download buttons. Both
// CSVs page over the same cursor contract: a page that reached its bound
// always carries a `nextCursor`, so there is no shape where a full-looking
// page is secretly a partial file (`K38`). The browser's half of that
// promise is this loop never stopping early, never assembling out of
// order, and never handing over what it has so far when a page fails.
type ExportKind = "results" | "answers";

const EXPORT_LABEL: Record<ExportKind, string> = {
  results: "results CSV",
  answers: "answers CSV",
};

/**
 * Requests pages in order and concatenates them in the order they arrive —
 * never out of order, never skipping ahead. `typeof nextCursor === "string"`
 * is the loop condition rather than `!= null`: defensive, since `typeof`
 * also covers an absent field, which these two routes cannot send
 * (`ExportPage`'s own contract makes `nextCursor` `string | null`, never
 * absent — `K38`) but a sibling export route could. A page request that
 * throws propagates straight out of this function with whatever was
 * assembled so far discarded by the caller — there is no code path that
 * returns a partial `csv` as though it were the whole file.
 */
async function drainExport(
  client: ApiClient,
  workspaceId: string,
  testId: string,
  kind: ExportKind,
  onPage: (pages: number) => void,
): Promise<{ csv: string; filename: string }> {
  let csv = "";
  let pages = 0;
  // Every page of one export answers the same filename (`ExportPage`'s own
  // doc comment, `apps/api/src/export/results.ts`) — the first page's is
  // as good as the last's, so it is read once rather than reassigned once
  // per page for a value that never changes.
  const first = await client.exportPage(workspaceId, testId, kind, undefined);
  csv += first.csv;
  pages += 1;
  onPage(pages);
  let cursor: string | undefined = typeof first.nextCursor === "string" ? first.nextCursor : undefined;
  while (cursor !== undefined) {
    const page = await client.exportPage(workspaceId, testId, kind, cursor);
    csv += page.csv;
    pages += 1;
    onPage(pages);
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : undefined;
  }
  return { csv, filename: first.filename };
}

/** Hands the assembled file to the browser. Not `lib/download.ts`'s
 *  `downloadJson` — that always `JSON.stringify`s its argument and labels
 *  the blob `application/json`; the pages here are already-serialised CSV
 *  text (BOM included on the first one), so this is the same object-URL
 *  create/click/revoke shape with a different blob type, not a second copy
 *  of the JSON one. */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Test and item analytics (Phase 8c Task 1/2, `R-06`/`R-07`, #94/#95). One
// screen, now two fetch shapes — `client.analytics()` for the figures below
// and `client.exportPage()` for the download buttons (Task 3) — rendered in
// the language `.prototypes/analytics.html` (D11) established: the Signal
// ground, `.card-hairline` panels, and the two-absences-without-hue
// discrimination cell.
//
// `ItemStat` (`@pariksha/core`) carries no question stem, type, section or
// correct-option id — only `questionId`, `shareCorrect`, `discrimination`,
// `discriminationWithheld`, `optionPickRates` and `n`. That stays true: it
// is a pure-function type and is not this task's to widen. The *route's*
// own response shape is not that type, though — `apps/api/src/routes/
// analytics.ts` joins each row's `stem` from `workspaceQuestions` (fix
// round 1, Important 2), the way `GradingQueueRow` joins a question's
// `prompt` one file over — and `web/lib/api.ts`'s own `ItemStat` wire type
// carries that extra field. The prototype's "✓ key" / "▲ over-polling"
// pick-rate markers are still not rendered: the data has no correct-option
// id to mark either against, stem or no stem.
//
// `K2`, stated on the surface: no time figure anywhere below, and the foot
// note says so in words rather than being an omission a reader has to
// notice.

type SortKey = "order" | "shareCorrect" | "discrimination";
type SortDir = "asc" | "desc";
interface SortState {
  key: SortKey;
  dir: SortDir;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; analytics: TestAnalytics; items: ItemStat[]; itemsTruncated: boolean };

/**
 * `"order"` is the array order `itemAnalysis` returns — first appearance in
 * the response set, the closest honest stand-in for "question order" this
 * interface carries (it has no section/paper position of its own). A null
 * `discrimination` (either withheld reason) never competes against a real
 * magnitude: it sorts after every question that has one, in both
 * directions — "which questions have the weakest index" and "which are
 * withheld" are different questions, so this answers only the first.
 */
function sortItems(items: readonly ItemStat[], sort: SortState): ItemStat[] {
  if (sort.key === "order") return [...items];
  const key = sort.key;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const av = a.item[key];
      const bv = b.item[key];
      if (av === null && bv === null) return a.index - b.index;
      if (av === null) return 1;
      if (bv === null) return -1;
      const diff = sort.dir === "asc" ? av - bv : bv - av;
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((w) => w.item);
}

function ariaSortOf(sort: SortState, key: SortKey): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function SortButton({
  label,
  column,
  sort,
  onSort,
}: {
  label: string;
  column: SortKey;
  sort: SortState;
  onSort: (sort: SortState) => void;
}) {
  return (
    <button
      type="button"
      className="analytics-sort-button"
      onClick={() =>
        onSort({
          key: column,
          dir: sort.key === column && sort.dir === "desc" ? "asc" : "desc",
        })
      }
    >
      {label}
      {sort.key === column ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** The discrimination cell's three renderings — one present, two absent.
 *  Neither absence is tinted (D11): both share `.analytics-label`'s plain
 *  secondary ink, because colouring either would restore the "the number
 *  came out bad" reading the construct exists to kill. */
function DiscriminationCell({ item }: { item: ItemStat }) {
  if (item.discriminationWithheld === "too_few_attempts") {
    return (
      <div className="analytics-disc">
        <span className="analytics-disc__gauge">
          <span className="analytics-disc__hatch" aria-hidden="true" />
        </span>
        <span className="analytics-disc__absent">
          <span className="analytics-label">withheld</span>
          <span className="analytics-meta analytics-disc__qualifier">
            n={item.n}, under {DISCRIMINATION_MIN_N}
          </span>
        </span>
      </div>
    );
  }
  if (item.discriminationWithheld === "no_variance") {
    return (
      <div className="analytics-disc">
        <span className="analytics-disc__gauge">
          <span className="analytics-disc__flat" aria-hidden="true" />
        </span>
        <span className="analytics-disc__absent">
          <span className="analytics-label">no variance</span>
          <span className="analytics-meta analytics-disc__qualifier">
            {item.shareCorrect === 1 ? "all correct" : item.shareCorrect === 0 ? "none correct" : "no spread"}
          </span>
        </span>
      </div>
    );
  }
  // Present. Fix round 1, Important 3: this branch used to render bare
  // text with no `.analytics-disc` wrapper at all, which broke the
  // column's alignment against the two absent states above and dropped
  // one of the prototype's three negative-index signals (the bar running
  // the other way from a centre baseline). `value + 1` over `max={2}`
  // keeps discrimination's -1..1 domain inside a `<progress>`'s own 0..max
  // fill model — no inline style, native `role="progressbar"` — with a
  // static centre tick (`.analytics-disc__zero`, plain CSS, the same
  // non-text 3:1 rule the two absences' hatch/flat marks already use) as
  // the reference a shorter-than-half fill reads against.
  const value = item.discrimination ?? 0;
  const negative = value < 0;
  const gaugeValue = Math.min(2, Math.max(0, value + 1));
  return (
    <div className="analytics-disc">
      <span className="analytics-disc__gauge">
        {/* m5 fixed aria-valuetext so the ANNOUNCED number is real (0.42,
            not a 0..2-fill percentage). Recorded, not fixed (round 3
            review): the native valuemin/valuemax/valuenow beneath it still
            read 0/2/<value+1>, so an AT that reads the range alongside the
            text presents a scale that contradicts aria-valuetext. Properly
            closing this means either a non-native gauge or faking
            aria-valuemin/-max/-now too (role="progressbar" is native here,
            so those aren't freely overridable the way they are on a div) —
            out of scope for this round. */}
        <progress
          className={negative ? "analytics-progress analytics-disc__progress--neg" : "analytics-progress"}
          value={gaugeValue}
          max={2}
          aria-label="Discrimination index"
          aria-valuetext={value.toFixed(2)}
        />
        <span className="analytics-disc__zero" aria-hidden="true" />
      </span>
      <span className={negative ? "analytics-meta analytics-risk" : "analytics-meta"}>
        {negative && <span aria-hidden="true">{"△ "}</span>}
        {value.toFixed(2)}
      </span>
    </div>
  );
}

function OptionPickRates({ item }: { item: ItemStat }) {
  const entries = Object.entries(item.optionPickRates);
  if (entries.length === 0) {
    // The real interface cannot tell "not a choice question" apart from
    // "nobody reached it" — both arrive as `{}` (`itemAnalysis`'s own
    // contract) and neither carries a question type to disambiguate with.
    return <span className="analytics-meta">no option data</span>;
  }
  entries.sort(([, a], [, b]) => b - a);
  return (
    <div className="analytics-picks">
      {entries.map(([optionId, share]) => (
        <span className="analytics-meta" key={optionId}>
          {optionId} {pct(share)}
        </span>
      ))}
    </div>
  );
}

export function AnalyticsRoute({
  workspaceId,
  testId,
  client,
}: {
  workspaceId: string;
  testId: string;
  client: ApiClient;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [sort, setSort] = useState<SortState>({ key: "order", dir: "asc" });
  const [exporting, setExporting] = useState<{ kind: ExportKind; pages: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const onExport = useCallback(
    async (kind: ExportKind) => {
      setExportError(null);
      setExporting({ kind, pages: 0 });
      try {
        const { csv, filename } = await drainExport(client, workspaceId, testId, kind, (pages) =>
          setExporting({ kind, pages }),
        );
        downloadCsv(csv, filename);
      } catch (cause) {
        // Never a partial file: `drainExport` already discarded whatever it
        // had assembled by the time control reaches here, so the only
        // thing left to do is say so, visibly, rather than hand over
        // nothing and let the organiser believe the download simply never
        // started.
        setExportError(
          `The ${EXPORT_LABEL[kind]} export failed${cause instanceof ApiError ? `: ${cause.message}` : ""} — nothing was downloaded.`,
        );
      } finally {
        setExporting(null);
      }
    },
    [client, workspaceId, testId],
  );

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const { analytics, items, itemsTruncated } = await client.analytics(workspaceId, testId);
      setState({ status: "ready", analytics, items, itemsTruncated });
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof ApiError ? cause.message : "Analytics could not be loaded.",
      });
    }
  }, [client, workspaceId, testId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => (state.status === "ready" ? sortItems(state.items, sort) : []),
    [state, sort],
  );

  if (state.status === "loading") {
    return (
      <p className="organiser__status" role="status">
        Loading analytics…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="field-error">
        {state.message}
      </p>
    );
  }

  const { analytics, itemsTruncated } = state;
  const { counts } = analytics;
  const everEnded = counts.submitted + counts.autoSubmitted + counts.locked;

  // Fix round 1, Important 1: `everEnded === 0` does not mean "nothing to
  // export" — `R-10`'s own requirement is that both exports are available
  // *during* the test, and "live, nobody has submitted yet" (candidates
  // still mid-attempt) is exactly the state that sentence exists for. The
  // buttons and their status/alert pair are hoisted above the empty-state
  // branch below so both render whether or not a single attempt has ended.
  const exportBar = (
    <>
      {/* The live region moved into the button row, so it no longer draws
          the outer column's gap — the wrapper it replaced was still a flex
          child of `.analytics`, and so still cost 32px above and below while
          empty. `.analytics-actions` has no border and takes its height from
          the buttons, so an empty status costs nothing in either branch. */}
      <div className="analytics-actions">
        <button
          type="button"
          className="button-secondary"
          disabled={exporting !== null}
          onClick={() => void onExport("results")}
        >
          {exporting?.kind === "results" ? "Exporting…" : "Export results CSV"}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={exporting !== null}
          onClick={() => void onExport("answers")}
        >
          {exporting?.kind === "answers" ? "Exporting…" : "Export answers CSV"}
        </button>
        {/* Always present, text swapped in place (`routes/tests.tsx`'s own
            live-region comment) — a region inserted already carrying its
            text does not reliably announce. */}
        <p className="organiser__status" role="status">
          {exporting === null ? "" : `Downloading ${EXPORT_LABEL[exporting.kind]} — page ${exporting.pages}…`}
        </p>
      </div>
      {exportError !== null && (
        <p role="alert" className="field-error">
          {exportError}
        </p>
      )}
    </>
  );

  // The state every test is in on the day it is published (CLAUDE.md's
  // own ruling for this screen) — a mean of `null`, an empty histogram and
  // sixty `no_variance` rows is worse than a line saying nothing has
  // happened yet, so it ships with the screen rather than being left for
  // the first candidate to uncover.
  if (everEnded === 0) {
    return (
      <div className="organiser-empty">
        <h2 className="organiser-empty__title">Nothing has been attempted yet</h2>
        <p className="organiser-empty__body">
          {counts.registered} candidate{counts.registered === 1 ? "" : "s"} registered, and none has finished an
          attempt. Analytics appear once the first candidate submits.
        </p>
        {exportBar}
      </div>
    );
  }

  const maxBucket = Math.max(1, ...analytics.distribution);
  const scoredCount = analytics.distribution.reduce((sum, n) => sum + n, 0);
  const totalIntegrity = analytics.integrity.clean + analytics.integrity.review + analytics.integrity.high_risk;

  return (
    <div className="analytics">
      <div className="analytics-band">
        <h2 className="analytics-band__title">Test analytics</h2>
        <span className="analytics-meta analytics-band__meta">R-06 · {counts.registered} registered</span>
      </div>
      {exportBar}

      {analytics.truncated && (
        <p className="analytics-hint" role="status">
          This test's attempt cohort is larger than one pass could read. The figures below cover the first{" "}
          {counts.inProgress + counts.submitted + counts.autoSubmitted + counts.locked} attempts read, not the whole
          cohort — not wrong, but not complete either.
        </p>
      )}

      <section className="card-hairline analytics-counts" aria-label="Attempt counts">
        <div className="analytics-count">
          <p className="analytics-count__label">
            <span className="analytics-count__dot" aria-hidden="true" />
            <span className="analytics-meta">Registered</span>
          </p>
          <p className="analytics-count__value">{counts.registered}</p>
        </div>
        <div className="analytics-count">
          <p className="analytics-count__label">
            <span className="analytics-count__dot" data-live="true" aria-hidden="true" />
            <span className="analytics-meta">In progress</span>
          </p>
          <p className="analytics-count__value">{counts.inProgress}</p>
        </div>
        <div className="analytics-count">
          <p className="analytics-count__label">
            <span className="analytics-count__dot" aria-hidden="true" />
            <span className="analytics-meta">Submitted</span>
          </p>
          <p className="analytics-count__value">{counts.submitted}</p>
        </div>
        <div className="analytics-count">
          <p className="analytics-count__label">
            <span className="analytics-count__dot" aria-hidden="true" />
            <span className="analytics-meta">Auto-submitted</span>
          </p>
          <p className="analytics-count__value">{counts.autoSubmitted}</p>
          <p className="analytics-hint analytics-count__hint">Time ran out mid-attempt.</p>
        </div>
        <div className="analytics-count">
          <p className="analytics-count__label">
            <span className="analytics-count__dot" aria-hidden="true" />
            <span className="analytics-meta">Locked</span>
          </p>
          <p className="analytics-count__value">{counts.locked}</p>
          <p className="analytics-hint analytics-count__hint">A proctoring violation ended the attempt.</p>
        </div>
      </section>

      <div className="analytics-cols">
        <section className="card-hairline" aria-label="Score distribution">
          <div className="analytics-panel__head">
            <h3 className="analytics-panel__title">Score distribution</h3>
            <span className="analytics-meta">ten fixed buckets, percent</span>
          </div>
          <div className="analytics-hist">
            {analytics.distribution.map((count, i) => (
              <div className="analytics-hist__row" key={i}>
                <span className="analytics-meta">
                  {i * 10}
                  {"–"}
                  {i * 10 + 10}
                </span>
                <progress className="analytics-progress" value={count} max={maxBucket} aria-label={`${i * 10} to ${i * 10 + 10} percent`} />
                <span className="analytics-meta">{count}</span>
              </div>
            ))}
          </div>
          <p className="analytics-hint analytics-hist__note">
            {scoredCount} scored attempt{scoredCount === 1 ? "" : "s"}.{" "}
            {analytics.mean !== null && analytics.median !== null
              ? `Mean ${analytics.mean.toFixed(1)}, median ${analytics.median.toFixed(1)}.`
              : ""}{" "}
            {analytics.passRate === null
              ? "This test sets no pass mark, so no pass line is drawn — there is nothing to draw it at."
              : null}
          </p>
        </section>

        <div className="analytics-side">
          <section className="card-hairline" aria-label="Summary">
            <div className="analytics-panel__head">
              <h3 className="analytics-panel__title">Summary</h3>
            </div>
            <div className="analytics-stats">
              <div className="analytics-stat">
                <span className="analytics-meta">Mean</span>
                <span className="analytics-stat__value">{analytics.mean === null ? "—" : analytics.mean.toFixed(1)}</span>
              </div>
              <div className="analytics-stat">
                <span className="analytics-meta">Median</span>
                <span className="analytics-stat__value">
                  {analytics.median === null ? "—" : analytics.median.toFixed(1)}
                </span>
              </div>
              <div className="analytics-stat">
                <span className="analytics-meta">Pass rate</span>
                {analytics.passRate === null ? (
                  <>
                    <span className="analytics-stat__value analytics-stat__value--absent">no pass mark set</span>
                    <p className="analytics-hint analytics-stat__hint">
                      This test sets no pass mark, so there is no pass rate to compute. Not zero, and not pending.
                    </p>
                  </>
                ) : (
                  <span className="analytics-stat__value">{pct(analytics.passRate)}</span>
                )}
              </div>
              <div className="analytics-stat">
                <span className="analytics-meta">Completion rate</span>
                <span className="analytics-stat__value">{pct(analytics.completionRate)}</span>
                <p className="analytics-hint analytics-stat__hint">
                  Excludes {counts.locked} locked attempt{counts.locked === 1 ? "" : "s"} from the denominator.
                </p>
              </div>
              <div className="analytics-stat">
                <span className="analytics-meta">Average time taken</span>
                <span className="analytics-stat__value">
                  {analytics.averageSeconds === null ? "—" : `${Math.round(analytics.averageSeconds / 60)} min`}
                </span>
              </div>
            </div>
          </section>

          <section className="card-hairline" aria-label="Integrity">
            <div className="analytics-panel__head">
              <h3 className="analytics-panel__title">Integrity</h3>
              <span className="analytics-meta">{totalIntegrity} attempts</span>
            </div>
            <div className="analytics-integrity">
              <div className="analytics-integrity__row">
                <span className="analytics-integrity__glyph" aria-hidden="true">
                  {"○"}
                </span>
                <progress
                  className="analytics-progress analytics-integrity__progress"
                  data-tone="clean"
                  value={analytics.integrity.clean}
                  max={Math.max(1, totalIntegrity)}
                  aria-label="Clean"
                />
                <span className="analytics-meta">{analytics.integrity.clean}</span>
                <span className="analytics-label analytics-integrity__name">Clean</span>
              </div>
              <div className="analytics-integrity__row">
                <span className="analytics-integrity__glyph" aria-hidden="true">
                  {"△"}
                </span>
                <progress
                  className="analytics-progress analytics-integrity__progress"
                  data-tone="review"
                  value={analytics.integrity.review}
                  max={Math.max(1, totalIntegrity)}
                  aria-label="Review"
                />
                <span className="analytics-meta">{analytics.integrity.review}</span>
                <span className="analytics-label analytics-integrity__name">Review</span>
              </div>
              <div className="analytics-integrity__row">
                <span className="analytics-integrity__glyph" aria-hidden="true">
                  {"◆"}
                </span>
                <progress
                  className="analytics-progress analytics-integrity__progress"
                  data-tone="high_risk"
                  value={analytics.integrity.high_risk}
                  max={Math.max(1, totalIntegrity)}
                  aria-label="High risk"
                />
                <span className="analytics-meta">{analytics.integrity.high_risk}</span>
                <span className="analytics-label analytics-integrity__name">High risk</span>
              </div>
            </div>
          </section>
        </div>
      </div>

      {analytics.perSet.length > 0 && (
        <section className="card-hairline" aria-label="Per-set comparison">
          <div className="analytics-panel__head">
            <h3 className="analytics-panel__title">Sets</h3>
            <span className="analytics-meta">were the shuffled papers equally hard?</span>
          </div>
          <div className="analytics-sets">
            {analytics.perSet.map((set) => (
              <div className="analytics-set" key={set.setNo}>
                <span className="analytics-set__name">Set {set.setNo}</span>
                <span className="analytics-meta">n={set.n}</span>
                <progress className="analytics-progress" value={set.mean ?? 0} max={100} aria-label={`Set ${set.setNo} mean`} />
                <span className="analytics-meta analytics-set__value">{set.mean === null ? "—" : set.mean.toFixed(1)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="analytics-band">
        <h2 className="analytics-band__title">Item analysis</h2>
        <span className="analytics-meta analytics-band__meta">R-07 · {sorted.length} questions</span>
      </div>

      {itemsTruncated && (
        <p className="analytics-hint" role="status">
          This test's attempt cohort is larger than one pass could read, so the figures below are computed from the
          first attempts read, not the whole roster — not wrong, but not complete either.
        </p>
      )}

      <section className="card-hairline" aria-label="Item analysis">
        <div className="analytics-panel__head">
          <h3 className="analytics-panel__title">Every question</h3>
          <div className="field">
            <label className="field-label" htmlFor="analytics-sort">
              Sort by
            </label>
            <select
              className="text-input"
              id="analytics-sort"
              value={sort.key}
              onChange={(event) => setSort({ key: event.target.value as SortKey, dir: "desc" })}
            >
              <option value="order">Question order</option>
              <option value="shareCorrect">Share correct</option>
              <option value="discrimination">Discrimination</option>
            </select>
          </div>
        </div>
        <div className="analytics-items">
          <table>
            <thead>
              <tr>
                <th scope="col">Q</th>
                <th scope="col">Question</th>
                <th scope="col">n</th>
                <th scope="col" aria-sort={ariaSortOf(sort, "shareCorrect")}>
                  <SortButton label="Share correct" column="shareCorrect" sort={sort} onSort={setSort} />
                </th>
                <th scope="col" aria-sort={ariaSortOf(sort, "discrimination")}>
                  <SortButton label="Discrimination" column="discrimination" sort={sort} onSort={setSort} />
                </th>
                <th scope="col">Option pick rates</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((item) => (
                <tr key={item.questionId}>
                  <td>
                    <span className="analytics-meta">{item.questionId}</span>
                  </td>
                  <td>
                    <span className="analytics-label analytics-items__stem">{item.stem}</span>
                  </td>
                  <td>
                    <span className="analytics-meta">{item.n}</span>
                  </td>
                  <td>
                    <progress className="analytics-progress" value={item.shareCorrect} max={1} aria-label="Share correct" />{" "}
                    <span className="analytics-meta">{item.shareCorrect.toFixed(2)}</span>
                  </td>
                  <td>
                    <DiscriminationCell item={item} />
                  </td>
                  <td>
                    <OptionPickRates item={item} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* `K2`, stated on the surface. */}
      <p className="analytics-hint">
        <strong className="analytics-label">
          There is no time column here, and there is not one anywhere else either.
        </strong>{" "}
        Per-question time has never been measured by this product, so no figure is shown rather than a wrong one.
      </p>
    </div>
  );
}
