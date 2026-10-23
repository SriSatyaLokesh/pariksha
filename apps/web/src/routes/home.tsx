import { useEffect, useState } from "react";
import type { Actor, ApiClient, TestSummary, Workspace } from "../lib/api";
// One vocabulary for a test's state across both screens that name it
// (whole-branch review, Minor 4): this row used to render the raw wire
// value, so Home said `draft`/`open` where the test list says `Draft`/`Open`.
import { STATE_LABEL } from "./tests";
import { UsagePanel } from "../components/organiser/UsagePanel";

// Home (spec §5, `D6`/`D6a`/`D6b`; §11, `D21`/`D21b`).
//
// `D6` is the constraint that shapes everything below: Home may call **no
// endpoint that does not already exist**. `client.tests(workspaceId)` and
// `client.listBanks(workspaceId)` answer every figure on this page between
// them, and if a future figure needs an aggregate, that is Phase 8's
// analytics work and the answer is no.
//
// Phase 8e Task 3 (`K31`, `K36`, issue 102) tried amending this rule with a
// third automatic call, `client.usage(workspaceId)` — the whole-branch
// review (`C2`, CRITICAL) found that trade wrong: the alternative it was
// weighed against (riding the projection along on `client.workspaces()`,
// already called at boot) is strictly worse, but the comparison never
// included the option `D6` itself already names, "don't put an aggregate
// on Home." **The amendment is reverted.** `UsagePanel` (below) owns its
// own fetch now, behind an explicit organiser gesture — see that
// component's own header. Home still calls exactly the two endpoints `D6`
// always allowed.
//
// `D6a` refused the four-metric-tile grid: a label, a number and a sentence
// tells an organiser nothing actionable. What replaces it is an agenda —
// 40px single-line rows grouped by time horizon, bounded in height, the
// same shape at four items and at forty.
//
// `D21` then amended `D6a`: a tile strip DOES return at the foot, as a
// control rather than a readout. Each pill selects the set it counts, which
// answers "which ones?" — the question a count always provokes and never
// answers. The two scale figures are deliberately NOT pills (they would be
// dead on click), so they are the page lead instead.
//
// Everything derived here is a pure function over the two payloads, and
// lives beside the component rather than in a module of its own until a
// second caller exists.

const DAY = 86_400_000;
/** Rows past this in one horizon collapse to a single "N more" line. The
 *  agenda's height is bounded by this number times three horizons, which is
 *  what makes it read the same at four items and at forty (`D6a`). */
const SHOWN_PER_HORIZON = 5;

type Horizon = "today" | "week" | "later";
type SetKey = "closing" | "review" | "changed" | "draft";

const HORIZONS: { key: Horizon; name: string; more: string }[] = [
  { key: "today", name: "Today", more: "more today" },
  { key: "week", name: "This week", more: "more in this week" },
  { key: "later", name: "Whenever you like", more: "more whenever you like" },
];

/**
 * The four sets, each a pill and each a reason a row exists.
 *
 * `horizon` is the one the set's rows always land in; `null` means the row
 * carries a real deadline and the clock decides. That split is the honest
 * one: a test's closing time is a fact about the future, while "awaiting
 * review" and "never published" have no deadline at all — they have an
 * urgency, which is what a fixed horizon states.
 *
 * "Blocking publish" is deliberately **not** here: it needs one checklist
 * computation per test and lives in the builder's rail (`D7`), where the
 * checklist already runs.
 */
const SETS: {
  key: SetKey;
  label: string;
  tone: string;
  horizon: Horizon | null;
  holds: (test: TestSummary, now: number) => boolean;
}[] = [
  {
    key: "closing",
    label: "Closing",
    tone: "risk",
    horizon: null,
    // The state, not the timestamp alone. `closeTest`/`archiveTest` go
    // through `setTestStatus`, which writes `status` and nothing else, so
    // the published `closes_at` survives an early close — a test the server
    // already calls `closed` arrives with `closesAt` still in the future.
    // Without this gate Home renders it under Closing with a risk dot and
    // tells an organiser a test is closing that is already shut.
    holds: (test, now) =>
      (test.state === "open" || test.state === "scheduled") &&
      closingAt(test) !== null &&
      (closingAt(test) as number) > now,
  },
  {
    key: "review",
    label: "Awaiting review",
    tone: "warn",
    horizon: "today",
    holds: (test) => test.reviewRequested,
  },
  {
    key: "changed",
    label: "Changes since publish",
    tone: "accent",
    horizon: "week",
    holds: (test) =>
      test.currentVersion !== null &&
      test.draftVersion !== null &&
      test.draftVersion > test.currentVersion,
  },
  {
    key: "draft",
    label: "Never published",
    tone: "muted",
    horizon: "later",
    holds: (test) => test.currentVersion === null,
  },
];

/**
 * `closesAt`, or `null` when there is no usable one.
 *
 * The wire type says `number | null`, so the `Number.isFinite` guard is
 * about bodies this client did not mint — an older server, a proxy, a
 * replayed fixture. A `NaN` that reaches the sort below would make the
 * comparator inconsistent and the grouping arbitrary, which is a bug that
 * reads as "the agenda is in the wrong order" rather than as a crash. One
 * guard at the one place the value is read.
 */
function closingAt(test: TestSummary): number | null {
  return test.closesAt !== null && Number.isFinite(test.closesAt) ? test.closesAt : null;
}

const sameDay = (a: number, b: number): boolean =>
  new Date(a).toDateString() === new Date(b).toDateString();

function horizonOf(at: number | null, now: number): Horizon {
  if (at === null) return "later";
  if (sameDay(at, now)) return "today";
  return at < now + 7 * DAY ? "week" : "later";
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The mono column on the left of every row: a clock inside the day, a
 * weekday and a clock inside the week, a date beyond it.
 *
 * Fixed names rather than `Intl.DateTimeFormat`: this column is two or
 * three glyphs wide by design and a locale that spells the weekday out
 * would break the row, not translate it. The product is English-only today;
 * when it is not, this is the one function that changes.
 */
function timeLabel(at: number | null, now: number): string {
  if (at === null) return "—";
  const when = new Date(at);
  const clock = `${pad(when.getHours())}:${pad(when.getMinutes())}`;
  if (sameDay(at, now)) return clock;
  if (Math.abs(at - now) < 7 * DAY) return `${WEEKDAYS[when.getDay()] ?? ""} ${clock}`;
  return `${when.getDate()} ${MONTHS[when.getMonth()] ?? ""}`;
}

interface Row {
  key: string;
  testId: string;
  name: string;
  set: SetKey;
  reason: string;
  tone: string;
  at: number | null;
  horizon: Horizon;
}

/**
 * The sets a test is in — the ONE place that decides, so a row in Recently
 * edited marks under the same pill its agenda row does.
 *
 * `listTests` applies no status filter unless it is passed one and `D6`
 * forbids Home passing one, so an archived test arrives like any other. It
 * belongs on nobody's agenda: archiving an abandoned draft is exactly how
 * an organiser clears it, and a Home that then re-nags about it under
 * "Never published / Whenever you like" forever has made archiving useless.
 * One predicate, not a second call — `state` is already on the wire.
 */
function setsFor(test: TestSummary, now: number): typeof SETS {
  if (test.state === "archived") return [];
  return SETS.filter((set) => set.holds(test, now));
}

/** Every reason a test is on the agenda — a test in two sets is two rows,
 *  so a pill's count and the rows it marks are the same number. */
function agendaRows(tests: TestSummary[], now: number): Row[] {
  return tests.flatMap((test) =>
    setsFor(test, now).map((set) => {
      const at = set.key === "closing" ? closingAt(test) : null;
      return {
        key: `${set.key}-${test.id}`,
        testId: test.id,
        name: test.name,
        set: set.key,
        reason: set.label,
        tone: set.tone,
        at,
        horizon: set.horizon ?? horizonOf(at, now),
      };
    }),
  );
}

/** Soonest first, undated last, then by name — a total order, so the list
 *  is stable whatever order the server answered in. */
function bySoonest(a: Row, b: Row): number {
  if (a.at !== b.at) {
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at - b.at;
  }
  return a.name.localeCompare(b.name);
}

function Dot({ tone }: { tone: string }) {
  return <span className="home__dot" data-tone={tone} aria-hidden="true" />;
}

/** One 40px line: time, urgency, subject, reason, and the action the hover
 *  or the focus reveals. Shared by both panes, so the strip marks one
 *  construct rather than two. */
function RowLine({
  time,
  tone,
  subject,
  reason,
  marked,
  onOpen,
}: {
  time: string;
  tone: string;
  subject: string;
  reason: string;
  marked: "on" | "off" | undefined;
  onOpen: () => void;
}) {
  return (
    <li className="home__row" data-marked={marked} data-tone={tone}>
      <span className="home__row-time">{time}</span>
      <Dot tone={tone} />
      <span className="home__row-subject">{subject}</span>
      <span className="home__row-reason">{reason}</span>
      <button
        type="button"
        className="home__row-action"
        aria-label={`Open ${subject}`}
        onClick={onOpen}
      >
        Open
      </button>
    </li>
  );
}

export function Home({
  client,
  workspace,
  actor,
  onOpenTest,
  onOpenTests,
}: {
  client: ApiClient;
  workspace: Workspace;
  actor: Actor;
  onOpenTest: (testId: string) => void;
  onOpenTests: () => void;
}) {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [questions, setQuestions] = useState(0);
  // The clock is read ONCE, when the two reads land, and not again.
  // `D21` says nothing moves when a pill is pressed — and a `Date.now()`
  // read during render would advance on every re-render, so a row sitting
  // on a horizon boundary could change group as a side effect of marking.
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SetKey | null>(null);
  // Said rather than derived: "Selection cleared." is only true after
  // something was cleared, and a live region that announces it on arrival
  // would be reporting an event that never happened.
  const [status, setStatus] = useState("");

  // `D6`: two calls, and the screen never grows a third. They run in
  // sequence rather than in parallel because the recording guard in
  // `test/organiser-home.test.tsx` asserts the order, and because two reads
  // on a page that is already waiting for its boot are not a latency
  // problem worth a `Promise.all`'s error handling.
  useEffect(() => {
    // Cleared first, because this effect re-runs on a workspace SWITCH and
    // `OrganiserApp` renders Home without a key: without this the previous
    // workspace's agenda, figures and marking stay on screen under the new
    // workspace's name until the two reads land.
    setTests(null);
    setQuestions(0);
    setSelected(null);
    setStatus("");
    setError(null);

    let live = true;
    void (async () => {
      try {
        const rows = await client.tests(workspace.id);
        const banks = await client.listBanks(workspace.id);
        if (!live) return;
        setNow(Date.now());
        setTests(rows);
        setQuestions(banks.reduce((total, bank) => total + bank.questionCount, 0));
      } catch {
        if (!live) return;
        setError("Pariksha could not load this workspace. Reload to try again.");
        // Out of "loading" as well as into "error": without this both panes
        // read "Loading…" under the alert, for ever.
        setTests([]);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, workspace.id]);

  // `D21`: Escape puts the marking back, the same as pressing the pill
  // again or pressing Clear. On the window rather than on a container,
  // because the key has to work wherever focus happens to be after a click
  // on a pill.
  useEffect(() => {
    if (selected === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSelected(null);
      setStatus("Selection cleared.");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  const rows = agendaRows(tests ?? [], now);
  const counts: Record<SetKey, number> = { closing: 0, review: 0, changed: 0, draft: 0 };
  for (const row of rows) counts[row.set] += 1;

  const role = actor.memberships.find((m) => m.workspaceId === workspace.id)?.role;
  const marking = (set: SetKey): "on" | "off" | undefined =>
    selected === null ? undefined : set === selected ? "on" : "off";

  const recent = [...(tests ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  /** One place decides what is selected and what the live region says. */
  function select(next: SetKey | null, label = "", count = 0) {
    setSelected(next);
    // Tests, not rows. A pill counts AGENDA rows, and marking also reaches
    // the Recently edited pane — so "1 row marked" was announced while two
    // rows carried data-marked="on", and a horizon past SHOWN_PER_HORIZON
    // counts rows the agenda has collapsed and cannot mark. Within one set
    // a row is a test, so the count is exact when it is said that way.
    setStatus(
      next === null
        ? "Selection cleared."
        : `${label}: ${count} test${count === 1 ? "" : "s"} marked.`,
    );
  }

  return (
    // `data-state` is the one honest signal that the two reads have landed:
    // the heading and the lead paint on mount, so "the screen is up" and
    // "the screen has its data" are different moments and a test that waits
    // for the first gets a half-built agenda.
    <div className="home" data-state={tests === null ? "loading" : "ready"}>
      <p className="home__crumb">
        {role === undefined ? "Workspace" : `Workspace · ${role}`}
      </p>
      <h1 className="home__title">{workspace.name}</h1>

      {/* `D21`'s page lead. Not pills: a pill that counts a set with no rows
          on this page would be dead on click, and these two count things
          that are not rows at all. */}
      <p className="home__lead" data-testid="home-lead">
        <span className="home__figure">{tests?.length ?? 0}</span> tests
        <span className="home__sep" aria-hidden="true">
          ·
        </span>
        <span className="home__figure">{questions}</span> questions
      </p>

      {/* Phase 8e Task 3 (`K31`, `K36`, issue 102), reverted `D6` amendment
          (branch review `C2`): owns its own fetch, behind its own button —
          Home makes no `usage()` call of any kind. */}
      <UsagePanel client={client} workspaceId={workspace.id} />

      {error !== null && (
        <p className="home__empty" role="alert">
          {error}
        </p>
      )}

      <div className="home__panes">
        <section className="home__pane" aria-labelledby="home-agenda-title">
          <h2 className="home__pane-title" id="home-agenda-title">
            What needs you
          </h2>
          <div className="home__scroll">
            {tests === null ? (
              <p className="home__empty">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="home__empty">Nothing needs you right now.</p>
            ) : (
              HORIZONS.map(({ key, name, more }) => {
                const group = rows.filter((row) => row.horizon === key).sort(bySoonest);
                // `D6a`: a horizon with nothing in it is not rendered.
                if (group.length === 0) return null;
                const shown = group.slice(0, SHOWN_PER_HORIZON);
                const hidden = group.length - shown.length;
                return (
                  <div className="home__group" key={key}>
                    <h3 className="home__group-head">
                      <span className="home__group-name">{name}</span>
                      <span className="home__group-count">{group.length}</span>
                    </h3>
                    <ul className="home__rows">
                      {shown.map((row) => (
                        <RowLine
                          key={row.key}
                          time={timeLabel(row.at, now)}
                          tone={row.tone}
                          subject={row.name}
                          reason={row.reason}
                          marked={marking(row.set)}
                          onOpen={() => onOpenTest(row.testId)}
                        />
                      ))}
                    </ul>
                    {hidden > 0 && (
                      <p className="home__more">{`${hidden} ${more}`}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="home__pane" aria-labelledby="home-recent-title">
          <h2 className="home__pane-title" id="home-recent-title">
            Recently edited
          </h2>
          <div className="home__scroll">
            {tests === null ? (
              <p className="home__empty">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="home__empty">
                No tests yet.{" "}
                <button type="button" className="home__empty-action" onClick={onOpenTests}>
                  Create your first test
                </button>
              </p>
            ) : (
              <ul className="home__rows">
                {recent.map((test) => {
                  const sets = setsFor(test, now);
                  const first = sets[0];
                  return (
                    <RowLine
                      key={test.id}
                      time={timeLabel(test.updatedAt, now)}
                      tone={first?.tone ?? "muted"}
                      subject={test.name}
                      reason={STATE_LABEL[test.state]}
                      marked={
                        selected === null
                          ? undefined
                          : sets.some((set) => set.key === selected)
                            ? "on"
                            : "off"
                      }
                      onOpen={() => onOpenTest(test.id)}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* `D21`: the strip is a control, and it never scrolls away. `D21b`:
          the tone on a pill is a round dot, not a rail — the same construct
          the rows above use for urgency, so the strip and the list speak one
          language. */}
      <div className="home__strip" role="group" aria-label="Mark rows by">
        {SETS.map((set) => (
          <button
            key={set.key}
            type="button"
            className="home__pill"
            data-tone={set.tone}
            aria-pressed={selected === set.key}
            aria-label={`${set.label}, ${counts[set.key]}`}
            disabled={counts[set.key] === 0}
            onClick={() =>
              select(selected === set.key ? null : set.key, set.label, counts[set.key])
            }
          >
            <Dot tone={set.tone} />
            <span className="home__pill-label">{set.label}</span>
            <span className="home__pill-count">{counts[set.key]}</span>
          </button>
        ))}
        <button
          type="button"
          className="home__clear"
          disabled={selected === null}
          onClick={() => select(null)}
        >
          Clear
        </button>
      </div>

      {/* `D21`: a live region reports the count, so the marking is not a
          colour-only answer to "which ones?". */}
      <p className="visually-hidden" role="status">
        {status}
      </p>
    </div>
  );
}
