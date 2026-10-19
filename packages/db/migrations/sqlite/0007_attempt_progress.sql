-- Phase 6 Task 5 (#69, P6.5): the two columns an attempt needs to carry a
-- candidate's progress, and only two.
--
-- `max_index` is the furthest flat question index reached. It carries both
-- navigation rules at once -- `linear` refuses a target below it, and the
-- current section is the one that index falls in -- so section locking needs
-- no column of its own. `section_started_at` is what a per-section deadline
-- is measured from.
--
-- Hand-written rather than taken from `drizzle-kit generate` verbatim, for
-- the reason 0004, 0005 and 0006 record: SQLite refuses `ALTER TABLE ... ADD
-- ... NOT NULL` unless a literal DEFAULT comes with it. `DEFAULT 0` is that
-- literal, and it is also the right value for every attempt already in
-- flight -- an attempt written before this migration has reached no index it
-- can prove, so the safest reading is the first question.
--
-- No PRAGMA foreign_keys: D1 ignores it silently and
-- `no-d1-hostile-sql.test.ts` refuses it.
ALTER TABLE `attempt` ADD `max_index` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `attempt` ADD `section_started_at` integer;
