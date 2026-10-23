import type { UsageProjection } from "../../lib/api";

// Phase 8e Task 3 (`K31`, `K36`, issue 102): the free-tier meter, on Home.
//
// `undefined` renders nothing — not a loading state, not a zeroed meter: the
// field is absent on the `node` target (`K36`) and on the first render
// before the fetch lands, and this component cannot tell those two apart
// from its props alone, so it treats both the one honest way, by showing
// nothing rather than a number that might be wrong.
//
// `K31`'s honesty is the feature: the word "estimated" is in the sentence
// itself, not a tooltip a pointer has to find — the same bar `ResultsPanel`'s
// own `K36` note holds every other cost figure to.
//
// No new colour: `.home__dot[data-tone]` is `home.css`'s own existing
// background-only tone indicator (reused, not duplicated — the dot's own
// tone colour is never load-bearing on its own, because the sentence beside
// it says the same thing in words, which is `color-not-only`'s whole
// point). The one new class this file adds that sets `color` at all is
// `.home__usage-text`, carrying `--ink-2` on the same `signal-bg` /
// `signal-l-bg` pairing `.home__lead` already proves passes
// `contrast-usage.test.ts` — not a new pair to score.

export function UsagePanel({ usage }: { usage: UsageProjection | undefined }) {
  if (usage === undefined) return null;

  // Rounded for the sentence, not stored: `warn` is the server's own
  // judgement (`WARN_AT`), read as-is rather than re-derived from this
  // rounded figure, so the two can never disagree over a boundary value a
  // display rounds away.
  const pct = Math.round(((usage.spentToday + usage.projected) / usage.limit) * 100);
  const tone = usage.warn ? "warn" : "accent";

  return (
    <p className="home__usage">
      <span className="home__dot" data-tone={tone} aria-hidden="true" />
      <span className="home__usage-text">
        <strong className="home__usage-figure">{pct}%</strong> of your daily limit, estimated
        {usage.warn && " — approaching the free-plan ceiling"}
      </span>
    </p>
  );
}
