// Reviewer verdicts (Phase 8b Task 3, `K16`): a human judgement about one
// attempt, kept apart from the machine score `grading.ts` writes.
//
// `K16`: `review` is append-only, and has existed since `0000` with exactly
// these columns — `recordVerdict` never updates or deletes a row, only
// inserts one, so a reviewer who changes their mind leaves a second row
// rather than overwriting the first. That is deliberate: a verdict is a
// judgement call about a candidate, and losing who said what and when to an
// `UPDATE` would erase the one thing worth keeping if it is ever disputed.
//
// Review Focus (this task): a verdict must not silently change the score,
// and a later regrade must not silently invalidate the verdict. This file
// makes that true by construction rather than by a check — it never reads
// `attempt.score_json` and `rescoreAttempt` (`run/rescore.ts`) never reads
// `review` — the two tables have no foreign key and no trigger between
// them, so a regrade after a verdict exists leaves every review row exactly
// as it was. Task 4 (regrade after a key change) is free to decide later
// whether a stale verdict should prompt a fresh one; nothing here answers
// that question, because nothing in this task's brief asked it to.

import type { DbClient } from "../client.js";
import { newId } from "../ids.js";
import { scoped } from "./guard.js";

export type Verdict = "clear" | "suspicious" | "disqualified";

interface ReviewRecord {
  id: string;
  attempt_id: string;
  reviewer: string;
  verdict: string;
  note: string | null;
  at: number;
}

/** Appends one verdict row. Never updates or deletes — `K16`. */
export const recordVerdict = scoped(
  "recordVerdict",
  async (
    db: DbClient,
    workspaceId: string,
    input: {
      attemptId: string;
      reviewer: string;
      verdict: Verdict;
      note?: string;
      now: number;
    },
  ): Promise<{ reviewId: string }> => {
    const reviewId = newId("rev");
    await db.run(
      "INSERT INTO review (id, workspace_id, attempt_id, reviewer, verdict, note, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        reviewId,
        workspaceId,
        input.attemptId,
        input.reviewer,
        input.verdict,
        input.note ?? null,
        input.now,
      ],
    );
    return { reviewId };
  },
);

/**
 * The latest verdict for each of `attemptIds` — latest-wins, ordered by
 * `(at, id)` so two verdicts recorded in the same millisecond still pick a
 * deterministic winner (`K16`; Phase 8a hit the same bare-`created_at` trap
 * and had to add this tiebreaker).
 *
 * One query however many ids are asked for, which is why this reads the
 * *workspace's* whole verdict history rather than `WHERE attempt_id IN
 * (...)`: D1 caps bound parameters at 100, so an `IN` over 300 attempt ids
 * (a mid-sized cohort, and 8c's own caller shape — "once for a whole test")
 * would have to chunk into several queries, which is exactly the one-query
 * promise this function exists to keep. `review` is scoped to verdicts a
 * reviewer actually recorded, not to every attempt a workspace has ever
 * run, so reading it whole costs the same one query at 3 attempts or 3,000.
 *
 * ponytail: this is a full scan of the workspace's `review` table, not of
 * just `attemptIds` — bounded by how many verdicts a human has ever
 * clicked, not by cohort size, so it stays small for years at realistic
 * review volume. If a workspace's verdict history ever grows large enough
 * for that to matter, the upgrade path is `WHERE at > ?` (a time floor,
 * set from the caller's own cutoff) or a `test_id` column to scope the
 * scan — not a chunked `IN`, which would break the one-query contract this
 * function exists to keep.
 */
export const latestVerdicts = scoped(
  "latestVerdicts",
  async (
    db: DbClient,
    workspaceId: string,
    attemptIds: readonly string[],
  ): Promise<
    Map<
      string,
      { verdict: Verdict; note: string | null; reviewer: string; at: number }
    >
  > => {
    if (attemptIds.length === 0) return new Map();
    const wanted = new Set(attemptIds);
    const rows = await db.query<ReviewRecord>(
      "SELECT id, attempt_id, reviewer, verdict, note, at FROM review WHERE workspace_id = ? ORDER BY at ASC, id ASC",
      [workspaceId],
    );
    const latest = new Map<
      string,
      { verdict: Verdict; note: string | null; reviewer: string; at: number }
    >();
    for (const row of rows) {
      if (!wanted.has(row.attempt_id)) continue;
      // Rows arrive oldest-first, so the last assignment for a given
      // attempt is the one `ORDER BY (at, id)` ranks highest — no separate
      // comparison needed.
      latest.set(row.attempt_id, {
        verdict: row.verdict as Verdict,
        note: row.note,
        reviewer: row.reviewer,
        at: Number(row.at),
      });
    }
    return latest;
  },
);
