import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type ApiClient, type TestFilter, type TestState, type TestSummary } from "../lib/api";
import { ImportDialog } from "../components/authoring/ImportDialog";
import { CardHairline } from "../components/CardHairline";
import { TextField } from "../components/TextField";
import { QrCode } from "../components/QrCode";
import { Icon } from "../components/OrganiserShell";

// Screen 6 (docs/design.md's screen inventory): the test list. T-01 (CRUD),
// T-02 (short link and QR code), T-03 (filter/search/sort) and UX-10's "In
// review" badge (ADR 0007) all live here; the builder itself (sections,
// timing, access…) is Screen 7 onward, Task 3's `test.tsx`.

/** The one rendering of a state's NAME, exported for the same reason
 *  `TestStateBadge` is: Home shows a test's state as a row's reason, and a
 *  second label map is exactly how one screen ends up saying `draft` while
 *  the screen one rail click away says `Draft` (whole-branch review,
 *  Minor 4). */
export const STATE_LABEL: Record<TestState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  closed: "Closed",
  archived: "Archived",
};

// Text plus glyph, never colour alone — the state and the "In review" badge
// both carry one, `aria-hidden` so a screen reader hears only the label.
//
// The five below are still Unicode characters and are NOT this task's to
// move (6.5d Task 6 is scoped to the "In review" diamond, both sites); they
// go with the rest of the repo's icon-glyph sweep, filed as issue 200. The badge's
// own glyph is `Icon name="review"` as of that task — one family, one stroke.
const STATE_GLYPH: Record<TestState, string> = {
  draft: "●",
  scheduled: "◐",
  open: "○",
  closed: "■",
  archived: "▢",
};

/** The one rendering of a test's state, used by this list and by the
 * builder header (`routes/test.tsx`) — the plan asks for "text plus glyph
 * *wherever it appears*", and two copies of a label map is exactly how one
 * of them ends up saying something else. */
export function TestStateBadge({ state }: { state: TestState }) {
  return (
    <span className="test-state">
      <span aria-hidden="true">{STATE_GLYPH[state]}</span> {STATE_LABEL[state]}
    </span>
  );
}

type Sort = "name" | "updated" | "created";

// Whole-branch drift review, M-01. There used to be a `tag` here, a Tag
// box beside Search, and a Tags column — all reads of `test.tags`, which
// **nothing in the product writes**: not the builder, not whole-test
// import, not the create form. `PATCH .../tests/:testId` accepts `tags`
// and the repo filters on them, so the server half is real and stays; it
// is this screen's half that was a filter which could never match and a
// column that read "—" forever. Deleted rather than given an editor,
// because test tags are nobody's requirement — the PRD's tags are the
// question bank's. Restore all three together when something sets them.
interface UrlFilter {
  status: string;
  search: string;
  sort: Sort;
}

function isSort(value: string | null): value is Sort {
  return value === "name" || value === "updated" || value === "created";
}

function filterFromSearch(search: string): UrlFilter {
  const params = new URLSearchParams(search);
  const sort = params.get("sort");
  return {
    status: params.get("status") ?? "",
    search: params.get("search") ?? "",
    sort: isSort(sort) ? sort : "name",
  };
}

/** Built on top of the query string rather than in place of it: `D5` put
 *  the view itself there (`?view=tests`), and a fresh `URLSearchParams`
 *  here would drop it — and `?returnTo=` with it — on the first keystroke
 *  in Search. This screen owns three parameters and touches only those. */
function searchFromFilter(filter: UrlFilter): string {
  const params = new URLSearchParams(window.location.search);
  const owned: [string, string][] = [
    ["status", filter.status],
    ["search", filter.search],
    ["sort", filter.sort === "name" ? "" : filter.sort],
  ];
  for (const [key, value] of owned) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function toApiFilter(filter: UrlFilter): TestFilter {
  return {
    ...(filter.status && { status: filter.status }),
    ...(filter.search && { search: filter.search }),
    sort: filter.sort,
  };
}

/** A download is still a fetch (repo convention, `routes/bank.tsx`'s own
 * note) — `client.exportTest` makes the network call; this only turns an
 * already-fetched document into a saved file. Duplicated from `bank.tsx`
 * rather than shared: six lines, two callers, and a `lib/download.ts` for
 * them would be a module whose whole content is one DOM idiom. */
function downloadJson(doc: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
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

const SLUG_HELP = "Letters, numbers and hyphens, starting with a letter or number.";
const NAME_MAX = 200;

export function TestList({
  workspaceId,
  client,
  onOpenTest,
}: {
  workspaceId: string;
  client: ApiClient;
  /** Task 3 (#55, P5.2): a test's name opens its builder (Screen 7 onward),
   * the same `onOpenBank` pattern `BankList` already follows. */
  onOpenTest: (testId: string) => void;
}) {
  const [filter, setFilter] = useState<UrlFilter>(() => filterFromSearch(window.location.search));
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [createError, setCreateError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const [slugDrafts, setSlugDrafts] = useState<Record<string, string>>({});
  const [slugError, setSlugError] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Task 12 (#63, P5.10): clone, export and import.
  const [importing, setImporting] = useState(false);
  const [activity, setActivity] = useState("");
  const [clonedId, setClonedId] = useState<string | null>(null);
  const clonedRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (f: UrlFilter) => {
      try {
        setTests(await client.tests(workspaceId, toApiFilter(f)));
        setError(undefined);
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Tests could not be loaded.");
      }
    },
    [client, workspaceId],
  );

  // Debounced: `filter` changes on every keystroke in Search, and
  // without this a `GET .../tests` goes out per keystroke rather than once
  // typing settles. Each dependency change clears the previous effect's
  // timer (the cleanup below) before scheduling its own, so only the last
  // one in a burst ever fires — the standard effect-cleanup debounce, no
  // separate debounce helper needed. `load` is itself a dependency here
  // (unlike the URL write below): it only changes identity when `client` or
  // `workspaceId` does, so including it costs nothing and a lint rule that
  // enforces exhaustive deps stays satisfied.
  useEffect(() => {
    const timer = setTimeout(() => void load(filter), 250);
    return () => clearTimeout(timer);
  }, [load, filter.status, filter.search, filter.sort]);

  // Filters and search live in the URL and survive the back button: a
  // `popstate` (the browser's own Back/Forward, or a test dispatching one)
  // re-reads the query string rather than trusting the in-memory state a
  // forward navigation may have left stale.
  useEffect(() => {
    const onPopState = () => setFilter(filterFromSearch(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function updateFilter(patch: Partial<UrlFilter>) {
    const next = { ...filter, ...patch };
    setFilter(next);
    // `replaceState`, not `pushState`: a filter change is not a page the
    // user typed a URL for, and a `pushState` per keystroke turned seven
    // characters typed into Search into seven Back-button stops that each
    // restore one character.
    window.history.replaceState(null, "", `${window.location.pathname}${searchFromFilter(next)}`);
  }

  const hasFilter = filter.status !== "" || filter.search !== "";

  function clearFilters() {
    updateFilter({ status: "", search: "" });
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();
    if (trimmedName.length === 0 || trimmedName.length > NAME_MAX) {
      setCreateError("A test name is 1 to 200 characters.");
      nameRef.current?.focus();
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(trimmedSlug)) {
      setCreateError(SLUG_HELP);
      return;
    }
    setCreateError(undefined);
    setBusy(true);
    try {
      await client.createTest(workspaceId, { name: trimmedName, slug: trimmedSlug });
      setName("");
      setSlug("");
      await load(filter);
    } catch (cause) {
      setCreateError(cause instanceof ApiError ? cause.message : "The test could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function saveSlug(test: TestSummary) {
    const draft = (slugDrafts[test.id] ?? test.slug).trim();
    if (draft === test.slug) return;
    try {
      await client.updateTest(workspaceId, test.id, { slug: draft });
      setSlugError((prev) => ({ ...prev, [test.id]: "" }));
      await load(filter);
    } catch (cause) {
      setSlugError((prev) => ({
        ...prev,
        [test.id]: cause instanceof ApiError ? cause.message : "The slug could not be saved.",
      }));
    }
  }

  async function copyShortLink(test: TestSummary) {
    const url = `${window.location.origin}/t/${test.shortCode}`;
    try {
      await navigator.clipboard?.writeText?.(url);
    } catch {
      // Clipboard access can be refused by the browser; the link is still
      // reachable by hand (it is rendered right beside the button), so a
      // failed copy is not a reason to show an error.
    }
    setCopiedId(test.id);
  }

  // The clone lands as a new row; the organiser's next move is to rename
  // it, so focus goes to that row's own field rather than leaving them to
  // find it. Runs after the reload that put the row on the screen.
  useEffect(() => {
    if (clonedId === null) return;
    clonedRef.current?.focus();
    setClonedId(null);
  }, [clonedId, tests]);

  // Clears on its own, so the confirmation is also feedback for a *second*
  // press of the same button: without this, pressing "Copy short link"
  // twice sets the same id both times, React sees no state change, and the
  // second press produces no visible or announced response at all.
  useEffect(() => {
    if (copiedId === null) return;
    const timer = setTimeout(() => setCopiedId(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedId]);

  // AC-04. The announcement names all three new identifiers *and* what was
  // deliberately left behind: a clone that silently dropped the review flag
  // and the version history is a clone an organiser has to discover the
  // shape of by poking at it.
  async function onClone(test: TestSummary) {
    setActivity(`Duplicating ${test.name}…`);
    try {
      const copy = await client.cloneTest(workspaceId, test.id);
      await load(filter);
      setClonedId(copy.id);
      setActivity(
        `Copied to “${copy.name}” (${copy.id}, ${copy.slug}). Version history and the review flag were not copied.`,
      );
    } catch (cause) {
      setActivity("");
      setError(cause instanceof ApiError ? cause.message : "The test could not be duplicated.");
    }
  }

  async function onExport(test: TestSummary) {
    setActivity(`Exporting ${test.name}…`);
    try {
      const doc = await client.exportTest(workspaceId, test.id);
      const filename = `${test.slug}.json`;
      downloadJson(doc, filename);
      setActivity(`Saved ${filename}.`);
    } catch (cause) {
      setActivity("");
      setError(cause instanceof ApiError ? cause.message : "The test could not be exported.");
    }
  }

  function sortHeaderProps(column: Sort): { "aria-sort"?: "ascending" } {
    return filter.sort === column ? { "aria-sort": "ascending" } : {};
  }

  return (
    <>

        {error !== undefined && (
          <p className="organiser__notice" role="alert">
            {error}
          </p>
        )}

        <CardHairline className="organiser__panel">
          <form className="organiser-form" onSubmit={(event) => void onCreate(event)} noValidate>
            <TextField id="test-name" label="Test name" help="1 to 200 characters." value={name} onChange={setName} inputRef={nameRef} />
            <TextField id="test-slug" label="Slug" help={SLUG_HELP} value={slug} onChange={setSlug} />
            {createError !== undefined && (
              <p className="field-error" role="alert">
                <span aria-hidden="true">⚠</span> <span>{createError}</span>
              </p>
            )}
            <button type="submit" className="button-primary button-primary--surface" disabled={busy}>
              Create test
            </button>
          </form>
        </CardHairline>

        <button
          type="button"
          className="button-secondary"
          aria-expanded={importing}
          onClick={() => setImporting((prev) => !prev)}
        >
          {importing ? "Cancel import" : "Import a test"}
        </button>

        {importing && (
          <ImportDialog
            workspaceId={workspaceId}
            client={client}
            kind="test"
            onClose={() => setImporting(false)}
            onImported={() => {
              setImporting(false);
              void load(filter);
            }}
          />
        )}

        {/* Always present, text swapped in place — a live region inserted
            already carrying its text does not reliably announce. */}
        <p className="organiser__status" role="status">
          {activity}
        </p>

        <form
          className="testbuilder-filters"
          role="search"
          aria-label="Filter tests"
          onSubmit={(event) => event.preventDefault()}
        >
          <TextField
            id="test-search"
            label="Search"
            help="By name."
            value={filter.search}
            onChange={(value) => updateFilter({ search: value })}
          />
          <div className="field">
            <label className="field-label" htmlFor="test-status">
              Status
            </label>
            <select
              id="test-status"
              className="text-input"
              value={filter.status}
              onChange={(event) => updateFilter({ status: event.target.value })}
            >
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="test-sort">
              Sort
            </label>
            <select
              id="test-sort"
              className="text-input"
              value={filter.sort}
              onChange={(event) => updateFilter({ sort: isSort(event.target.value) ? event.target.value : "name" })}
            >
              <option value="name">Name</option>
              <option value="updated">Last edited</option>
              <option value="created">Date created</option>
            </select>
          </div>
        </form>

        {tests === null ? (
          <p className="organiser__status" role="status">
            Loading…
          </p>
        ) : tests.length === 0 ? (
          hasFilter ? (
            <CardHairline className="organiser-empty">
              <h2 className="organiser-empty__title">No tests match your filters</h2>
              <p className="organiser-empty__body">Try a different search or status.</p>
              <button type="button" className="button-secondary" onClick={clearFilters}>
                Clear filters
              </button>
            </CardHairline>
          ) : (
            <CardHairline className="organiser-empty">
              <h2 className="organiser-empty__title">No tests yet</h2>
              <p className="organiser-empty__body">Create one above to give it an ID, a slug and a short link.</p>
              <button type="button" className="button-primary button-primary--surface" onClick={() => nameRef.current?.focus()}>
                Create your first test
              </button>
            </CardHairline>
          )
        ) : (
          <table className="testbuilder-list">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col" {...sortHeaderProps("name")}>
                  Name
                </th>
                <th scope="col">State</th>
                <th scope="col" {...sortHeaderProps("updated")}>
                  Last edited
                </th>
                <th scope="col">Slug</th>
                <th scope="col">Actions</th>
                <th scope="col">Short link</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((test) => {
                const locked = test.currentVersion !== null;
                const slugId = `slug-${test.id}`;
                const shortLinkPath = `/t/${test.shortCode}`;
                return (
                  <tr key={test.id}>
                    <td>
                      <code className="test-id">{test.id}</code>
                    </td>
                    <td>
                      <button type="button" className="button-link" onClick={() => onOpenTest(test.id)}>
                        {test.name}
                      </button>
                    </td>
                    <td>
                      <TestStateBadge state={test.state} />
                      {test.reviewRequested && (
                        <span className="test-badge">
                          <Icon name="review" /> In review
                        </span>
                      )}
                    </td>
                    <td>{new Date(test.updatedAt).toLocaleDateString()}</td>
                    <td>
                      <div className="field">
                        <label className="field-label" htmlFor={slugId}>
                          Slug
                        </label>
                        <input
                          className="text-input"
                          id={slugId}
                          value={slugDrafts[test.id] ?? test.slug}
                          readOnly={locked}
                          ref={clonedId === test.id ? clonedRef : undefined}
                          onChange={(event) =>
                            setSlugDrafts((prev) => ({ ...prev, [test.id]: event.target.value }))
                          }
                          onBlur={() => void saveSlug(test)}
                        />
                        {locked ? (
                          <p className="field-help">Locked because this test has been published.</p>
                        ) : (
                          slugError[test.id] && (
                            <p className="field-error" role="alert">
                              <span aria-hidden="true">⚠</span> <span>{slugError[test.id]}</span>
                            </p>
                          )
                        )}
                      </div>
                    </td>
                    <td>
                      <button type="button" className="button-secondary" onClick={() => void onClone(test)}>
                        Duplicate
                      </button>
                      <button type="button" className="button-secondary" onClick={() => void onExport(test)}>
                        Export
                      </button>
                    </td>
                    <td>
                      <div className="testbuilder-shortlink">
                        <QrCode value={`${window.location.origin}${shortLinkPath}`} label="QR code for the short link" size={64} />
                        <a href={shortLinkPath}>{shortLinkPath}</a>
                        <button type="button" className="button-secondary" onClick={() => void copyShortLink(test)}>
                          Copy short link
                        </button>
                        {/* Rendered on every row, always — only the text
                            content changes. A live region that is inserted
                            already carrying its text does not reliably
                            announce; one that is already present and has
                            its text updated does. */}
                        <p className="organiser__status" role="status">
                          {copiedId === test.id ? "Copied." : ""}
                        </p>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
    </>
  );
}
