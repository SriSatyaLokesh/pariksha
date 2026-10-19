import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type ApiClient, type TestFilter, type TestState, type TestSummary } from "../lib/api";
import { CardHairline } from "../components/CardHairline";
import { MonoCaption } from "../components/MonoCaption";
import { OrganiserHeader } from "../components/OrganiserHeader";
import { TextField } from "../components/TextField";
import { QrCode } from "../components/QrCode";

// Screen 6 (docs/design.md's screen inventory): the test list. T-01 (CRUD),
// T-02 (short link and QR code), T-03 (filter/search/sort) and UX-10's "In
// review" badge (ADR 0007) all live here; the builder itself (sections,
// timing, access…) is Screen 7 onward, Task 3's `test.tsx`.

const STATE_LABEL: Record<TestState, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  open: "Open",
  // Interim, same reason `lib/api.ts`'s `TestState` carries it: Task 11's
  // `deriveState()` replaces "published" with "Scheduled" or "Open" once
  // `timing` exists to tell them apart.
  published: "Published",
  closed: "Closed",
  archived: "Archived",
};

// Text plus glyph, never colour alone — the state and the "In review" badge
// both carry one, `aria-hidden` so a screen reader hears only the label.
const STATE_GLYPH: Record<TestState, string> = {
  draft: "●",
  scheduled: "◐",
  open: "○",
  published: "◎",
  closed: "■",
  archived: "▢",
};

type Sort = "name" | "updated" | "created";

interface UrlFilter {
  tag: string;
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
    tag: params.get("tag") ?? "",
    status: params.get("status") ?? "",
    search: params.get("search") ?? "",
    sort: isSort(sort) ? sort : "name",
  };
}

function searchFromFilter(filter: UrlFilter): string {
  const params = new URLSearchParams();
  if (filter.tag) params.set("tag", filter.tag);
  if (filter.status) params.set("status", filter.status);
  if (filter.search) params.set("search", filter.search);
  if (filter.sort !== "name") params.set("sort", filter.sort);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function toApiFilter(filter: UrlFilter): TestFilter {
  return {
    ...(filter.tag && { tag: filter.tag }),
    ...(filter.status && { status: filter.status }),
    ...(filter.search && { search: filter.search }),
    sort: filter.sort,
  };
}

const SLUG_HELP = "Letters, numbers and hyphens, starting with a letter or number.";
const NAME_MAX = 200;

export function TestList({
  workspaceId,
  client,
  actorEmail,
  onSignOut,
  onBack,
}: {
  workspaceId: string;
  client: ApiClient;
  actorEmail: string;
  onSignOut: () => void;
  onBack: () => void;
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

  useEffect(() => {
    void load(filter);
    // `load` itself is intentionally not a dependency: it is recreated only
    // when `client`/`workspaceId` change, and including it would re-run this
    // effect on every render of those for no reason beyond satisfying a
    // lint rule this project does not enable.
  }, [load, filter.tag, filter.status, filter.search, filter.sort]);

  // Filters, tags and search live in the URL and survive the back button: a
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
    window.history.pushState(null, "", `${window.location.pathname}${searchFromFilter(next)}`);
  }

  const hasFilter = filter.tag !== "" || filter.status !== "" || filter.search !== "";

  function clearFilters() {
    updateFilter({ tag: "", status: "", search: "" });
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

  function sortHeaderProps(column: Sort): { "aria-sort"?: "ascending" } {
    return filter.sort === column ? { "aria-sort": "ascending" } : {};
  }

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <OrganiserHeader email={actorEmail} onSignOut={onSignOut} onBack={onBack} backLabel="Back to dashboard" />

      <main id="main-content" className="organiser organiser--wide">
        <MonoCaption>Tests</MonoCaption>
        <h1 className="organiser__title">Tests</h1>

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
          <TextField
            id="test-tag"
            label="Tag"
            help="Exact tag match."
            value={filter.tag}
            onChange={(value) => updateFilter({ tag: value })}
          />
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
              <p className="organiser-empty__body">Try a different search, tag or status.</p>
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
                <th scope="col" {...sortHeaderProps("name")}>
                  Name
                </th>
                <th scope="col">State</th>
                <th scope="col">Tags</th>
                <th scope="col" {...sortHeaderProps("updated")}>
                  Last edited
                </th>
                <th scope="col">Slug</th>
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
                    <td>{test.name}</td>
                    <td>
                      <span className="test-state">
                        <span aria-hidden="true">{STATE_GLYPH[test.state]}</span> {STATE_LABEL[test.state]}
                      </span>
                      {test.reviewRequested && (
                        <span className="test-badge">
                          <span aria-hidden="true">◆</span> In review
                        </span>
                      )}
                    </td>
                    <td>{test.tags.length > 0 ? test.tags.join(", ") : "—"}</td>
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
                      <div className="testbuilder-shortlink">
                        <QrCode value={`${window.location.origin}${shortLinkPath}`} label="QR code for the short link" size={64} />
                        <a href={shortLinkPath}>{shortLinkPath}</a>
                        <button type="button" className="button-secondary" onClick={() => void copyShortLink(test)}>
                          Copy short link
                        </button>
                        {copiedId === test.id && (
                          <p className="organiser__status" role="status">
                            Copied.
                          </p>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
