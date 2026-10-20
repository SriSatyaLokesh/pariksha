// `S-07`'s volume defence: one fixed window per bucket, in one statement.
//
// **Deliberately outside `repo/index.ts`, and unscoped**, for the reason
// `shortlink.ts` is: the buckets this counts have no workspace. A `/t/:code`
// miss is a six-character code and nothing else, and a sentinel workspace id
// would be a lie in the one column `S-09` audits. Every bucket string embeds
// a globally unique id (a `ver_`, a digest), so the table's primary key is
// the whole of the tenancy it needs. `auth_token` is the precedent.
//
// **It counts; it does not decide.** Which bucket, how many and over what
// window are `apps/api/src/run/limit.ts`'s (`LIMITS`), because sizing a
// limit is a product judgement about a 500-seat hall, not a storage one.

import type { DbClient } from "../client.js";

/**
 * Adds one to `bucket`'s count and returns the new total, resetting first
 * when the window it was counting has passed.
 *
 * One statement, because the alternative — SELECT, decide, UPDATE — is the
 * same race `consumeAuthToken` was written to avoid, and on D1 it is three
 * subrequests on a path a candidate waits on. The `CASE`s read the stored
 * `window_start` twice rather than using `excluded`, because `excluded`
 * carries the row this call *tried* to insert, not the one that is there.
 *
 * A fixed window, not a sliding one: at the sizes `LIMITS` uses (hundreds
 * per minute) the boundary effect is a doubling that no honest cohort can
 * reach and no attacker is helped by.
 *
 * Rows are swept by `sweepRateLimits`, not here: a sweep is a second
 * statement and this one has to answer with a count, so the two cannot
 * share a subrequest.
 */
export async function takeRateToken(
  db: DbClient,
  bucket: string,
  windowMs: number,
  now: number,
): Promise<number> {
  const since = now - windowMs;
  const rows = await db.query<{ count: number }>(
    "INSERT INTO rate_limit (bucket, window_start, count) VALUES (?, ?, 1) " +
      "ON CONFLICT (bucket) DO UPDATE SET " +
      "window_start = CASE WHEN rate_limit.window_start <= ? THEN ? ELSE rate_limit.window_start END, " +
      "count = CASE WHEN rate_limit.window_start <= ? THEN 1 ELSE rate_limit.count + 1 END " +
      "RETURNING count",
    [bucket, now, since, now, since],
  );
  return Number(rows[0]?.count ?? 1);
}

/**
 * Deletes every bucket whose window closed before `before`.
 *
 * A bucket keyed on a test version or an attempt is bounded by what the
 * instance holds, and `short_link`'s is one row forever — but a bucket
 * keyed on a digest of an address a stranger typed is not bounded by
 * anything, and the note above (one row per test) stopped being true the
 * moment one landed. Two permanent rows per unauthenticated request is a
 * D1 daily write budget spent on garbage.
 *
 * **`before` must be older than the longest window of any kind**, not
 * the caller's own: one `DELETE` sees every kind's rows, and clearing a
 * row whose window is still open resets its count — which is a way past
 * the limit rather than a tidy-up. `limitOrThrow` passes
 * `now - MAX_WINDOW_MS` for exactly that reason.
 *
 * One statement, on the index `window_start` was created for.
 */
export async function sweepRateLimits(db: DbClient, before: number): Promise<number> {
  const { changes } = await db.run("DELETE FROM rate_limit WHERE window_start <= ?", [before]);
  return changes;
}
