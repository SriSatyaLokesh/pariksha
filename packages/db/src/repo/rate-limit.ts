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
 * ponytail: rows are never swept. One per bucket, and a bucket is a test
 * version or a short code, so the table's size is the instance's test
 * count — the `window_start` index is there for the sweep Phase 11's
 * retention job can add when that stops being true.
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
