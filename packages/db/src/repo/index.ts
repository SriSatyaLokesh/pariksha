// Every repository function, and nothing else.
//
// The suite reads this module's exports and asserts that each one is
// registered through `scoped()` — so a function added here without the guard
// fails the build rather than shipping an unscoped read. Keep it to
// functions: a type or constant exported here would look like an unguarded
// repository function to that test.

export * from "./workspaces.js";
export * from "./tests.js";
export * from "./attempts.js";
export * from "./audit.js";
export * from "./banks.js";
export * from "./candidates.js";
// Phase 6 (#66): the candidate runtime's scoped reads and writes. Its
// `INVITE_KIND` string rides along — the rule above is about functions,
// and `scoping.test.ts` enumerates only those.
export * from "./run.js";
// Phase 8a Task 7 (K9, KG3): the organiser's first attempt read.
export * from "./results.js";
// Phase 8b Task 1 (K14): manual grading's writes and the grading queue's
// one read.
export * from "./grading.js";
// Phase 8b Task 3 (K16): the reviewer's verdict, append-only.
export * from "./review.js";
