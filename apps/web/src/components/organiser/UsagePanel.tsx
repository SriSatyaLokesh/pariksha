import { useState } from "react";
import type { ApiClient, UsageProjection } from "../../lib/api";

// Phase 8e Task 3 (`K31`, `K36`, issue 102): the free-tier meter, on Home.
//
// Branch review fix wave, `C2` (CRITICAL) + `m1` (MINOR): this used to be a
// third call `Home`'s own boot effect made automatically, which amended
// `D6` ("Home may call no endpoint that does not already exist"). The
// review's finding was that the amendment traded away the metered
// dimension `D6` exists to protect — see `usage/project.ts`'s own header
// for the row-cost reasoning. **`D6` is no longer amended**: this
// component owns its own fetch, triggered only by an explicit organiser
// gesture (the button below), never by Home mounting or by a workspace
// switch. `home.tsx` makes no `usage` call at all any more.
//
// `undefined` after a check renders nothing beyond the button — not a
// loading state, not a zeroed meter: that is the shape `K36` sends on the
// `node` target (the field omitted, never `null`), and the honest reading
// of "nothing to show" either way.
//
// `K31`'s honesty is the feature: the word "estimated" is in the sentence
// itself, not a tooltip a pointer has to find — the same bar `ResultsPanel`'s
// own `K36` note holds every other cost figure to.
//
// No new colour anywhere in this file. `.home__dot[data-tone]` is
// `home.css`'s own existing background-only tone indicator (reused, not
// duplicated — the dot's own tone colour is never load-bearing on its own,
// because the sentence beside it says the same thing in words, which is
// `color-not-only`'s whole point). `.home__usage-text` is the one class
// that sets `color` at all — `--ink-2` on the same `signal-bg` /
// `signal-l-bg` pairing `.home__lead` already proves passes
// `contrast-usage.test.ts`, not a new pair to score — and the button below
// reuses that exact class rather than a styled `<button>` of its own, so
// there is nothing new for that gate to account for.

export function UsagePanel({ client, workspaceId }: { client: ApiClient; workspaceId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [usage, setUsage] = useState<UsageProjection | undefined>(undefined);

  async function check() {
    setStatus("loading");
    try {
      const result = await client.usage(workspaceId);
      setUsage(result);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  // Rounded for the sentence, not stored: `warn` is the server's own
  // judgement (`WARN_AT`), read as-is rather than re-derived from this
  // rounded figure, so the two can never disagree over a boundary value a
  // display rounds away.
  const pct = usage === undefined ? null : Math.round(((usage.projected + (usage.spentToday ?? 0)) / usage.limit) * 100);

  return (
    <p className="home__usage">
      {/* G2-07 / O-09 (Phase 8h): this used to be `.home__usage-text
          .home__usage-check` (home.css — another lane's file), which is
          `padding: 0` plus `text-decoration: underline` — a hyperlink
          where a button belongs, and an 18px line box under WCAG 2.5.8's
          24px floor. `.button-secondary` (primitives.css, this lane's own)
          is already the product's one secondary-action button and already
          clears 44px, so this swaps the borrowed look for the one the rest
          of the app already uses, with no new rule and no edit to home.css. */}
      <button
        type="button"
        className="button-secondary"
        onClick={() => void check()}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Checking…" : "Check free-plan usage"}
      </button>
      {status === "error" && (
        <span className="home__usage-text" role="alert">
          Could not check usage. Try again.
        </span>
      )}
      {pct !== null && usage !== undefined && (
        <span className="home__usage-text" aria-live="polite">
          <span className="home__dot" data-tone={usage.warn ? "warn" : "accent"} aria-hidden="true" />{" "}
          <strong className="home__usage-figure">{pct}%</strong> of your daily limit, estimated
          {usage.warn && " — approaching the free-plan ceiling"}
        </span>
      )}
    </p>
  );
}
